-- Migração 15 · Visão geral com o CSP 360: leads, clientes novos e custo por cliente novo (docs/dados/metricas.md,
--   seções 3.1, 3.4 a 3.6, 4.3 e 6.1)
--
-- O que faz: cria as views base do lead e do cliente novo (mkt.v_first_orders, mkt.v_leads, mkt.v_new_customers),
--   com a classificação da origem (mkt.classify_lead_origin) e a lista mkt.attribution_status, e troca a
--   api.kpi_overview para devolver, além da mídia, os leads (VG3), os clientes novos contados pelo pedido (VG2, o grupo
--   em "As duas"), os clientes novos que vieram de campanha (VG10), o custo por cliente novo (VG1: investimento ÷
--   clientes novos atribuídos), os pedidos enviados (VG5, VG6 e VG8), os leads sem marca (VG11) e, por marca e por
--   canal, leads, custo por lead, clientes novos e custo por cliente novo (VG12 e VG13), e por dia (VG15). Tudo com a
--   base do CSP 360 (mkt.source_covered('csp360'), decisão 0034): antes da primeira rodada boa da réplica, "Sem dados".
-- Fica para depois: o valor faturado (N5, até o Control abrir o canal), o alcance do Instagram e o custo com origem
--   paga virando canal (decisão 0032: com origem ou representante, o custo continua nulo, como na migração 13).
-- Risco: baixo. Só cria views e funções de leitura (security invoker: a RLS das tabelas vale) e troca uma função de
--   leitura com a mesma assinatura; nada grava.
-- Como reverter (só no projeto de teste, antes de produção, e depois de reverter as migrações seguintes):
--   reaplicar api.kpi_overview de 20261126120000_kpi_overview_midia.sql; -- do "create or replace" ao "end $$;"
--   drop view mkt.v_new_customers, mkt.v_leads, mkt.v_first_orders;
--   drop function mkt.classify_lead_origin(text, text, text, text[]);
--   drop domain mkt.attribution_status;
-- Conferir (como o dono, no SQL Editor):
--   select api.kpi_overview('{"period": "this_month"}');

-- ---------- Lista: situação da atribuição do lead (metricas.md, seção 8) ----------
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'mkt' and t.typname = 'attribution_status') then
    create domain mkt.attribution_status as text
      constraint attribution_status_check check (value in ('attributed', 'ambiguous', 'no_match', 'no_utm'));
  end if;
end $$;

-- ---------- Origem do lead (seção 3.1) ----------
create or replace function mkt.classify_lead_origin(p_referrer text, p_utm_source text, p_utm_medium text,
                                                    p_own_hosts text[]) returns mkt.lead_origin
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  with v as (
    select lower(btrim(coalesce(p_utm_source, ''))) as src,
           lower(btrim(coalesce(p_utm_medium, ''))) as med,
           coalesce(mkt.url_host(p_referrer), '') as h
  )
  select (case
    when src <> '' then case mkt.utm_source_family(src)
      when 'ai_assistant' then 'ai_assistant'
      when 'meta'   then 'meta'
      when 'tiktok' then 'tiktok'
      when 'search' then
        case when med = any ('{cpc,ppc,paid,paidsearch,paid_social,paidsocial,cpm,display,pmax,video,ads}')
             then 'google' else 'organic' end
      when 'sdr'    then 'sdr'
      when 'site'   then 'site'
      when 'direct' then 'direct'
      else 'referral' end
    when h = '' then 'direct'
    when mkt.host_matches(h, '{googleads.g.doubleclick.net,googleadservices.com,syndicatedsearch.goog}') then 'google'
    when mkt.ai_source_of(h, null) is not null then 'ai_assistant'
    when mkt.host_matches(h, '{google.,bing.com,duckduckgo.com,yahoo.com,ecosia.org}') then 'organic'
    when mkt.host_matches(h, p_own_hosts) then 'site'
    else 'referral'
  end)::mkt.lead_origin
  from v
$$;

-- ---------- O 1º pedido por cliente e marca (seção 3.5) ----------
create or replace view mkt.v_first_orders with (security_invoker = true) as
with sent as (
  select o.id, o.customer_id, o.brand_id, o.total_cents, o.is_invoiced,
         coalesce(o.sent_at, o.source_created_at) as order_at
    from mkt.crm_orders o
   where o.status = 'sent' and o.customer_id is not null
),
firsts as (
  select distinct on (s.customer_id, s.brand_id)
         s.customer_id, s.brand_id, s.id as first_order_id, s.order_at as first_order_at,
         mkt.sp_day(s.order_at) as first_order_on, s.total_cents as first_order_total_cents,
         s.is_invoiced as first_order_is_invoiced
    from sent s
   order by s.customer_id, s.brand_id, s.order_at, s.id
),
erp as (   -- a compra do ERP mais antiga já vista por marca (decisão 0042): só essa data decide
  select cb.customer_id, cb.brand_id, cb.erp_earliest_purchase_on
    from mkt.crm_customer_brands cb
),
flagged as (
  select f.*,
         coalesce(e.erp_earliest_purchase_on < f.first_order_on, false) as is_known_before,
         row_number() over (partition by f.customer_id order by f.first_order_at, f.brand_id) = 1 as is_group_first,
         min(f.first_order_on) over (partition by f.customer_id) as group_first_order_on
    from firsts f
    left join erp e using (customer_id, brand_id)
)
select f.*,
       exists (select 1 from erp e
                where e.customer_id = f.customer_id
                  and e.erp_earliest_purchase_on < f.group_first_order_on) as is_group_known_before
  from flagged f;

-- ---------- O lead (seção 3.4) ----------
create or replace view mkt.v_leads with (security_invoker = true) as
with own_hosts as (
  select coalesce(array_agg(distinct w.host) filter (where w.host is not null), '{}') as hosts
    from mkt.web_properties w
),
base as (
  select l.*,
         -- Meia-noite UTC em ponto é data pura (a tela do CRM grava só o dia): vale a data como veio (decisão 0041).
         case when (l.source_created_at at time zone 'UTC')::time = time '00:00'
              then (l.source_created_at at time zone 'UTC')::date
              else mkt.sp_day(l.source_created_at) end as created_on,
         m.origin as mapped_origin
    from mkt.crm_leads l
    left join mkt.crm_origin_map m on m.raw_value = lower(btrim(l.crm_origin_raw))
   -- O negócio aberto à mão pelo time comercial não é lead: o de-para marca a origem dele (decisão 0041, item 9).
   where l.kind = 'sdr' or coalesce(m.is_lead, true)
),
-- 1. O negócio da conversão de um lead do SDR (origem "SDR WhatsApp", decisão 0041, item 3): conta uma vez, como o
--    lead do SDR. Pelo dia, porque o negócio da tela do CRM vem só com o dia (item 5).
sdr_link as (
  select distinct on (d.id) d.id as deal_id, s.id as sdr_id, d.brand_id as deal_brand_id, d.source_created_at
    from base d
    join base s on s.kind = 'sdr' and s.customer_id = d.customer_id
               and s.created_on <= d.created_on
   where d.kind = 'deal' and d.crm_origin_raw = 'sdr whatsapp'
   order by d.id, s.source_created_at desc, s.code desc
),
leads as (
  select b.id, b.code, b.kind, b.customer_id, b.crm_origin_raw, b.is_origin_unmapped, b.mapped_origin, b.utm_source,
         b.utm_medium, b.utm_campaign, b.referrer_host, b.assigned_rep_id, b.source_created_at, b.created_on,
         coalesce(b.brand_id, (select k.deal_brand_id from sdr_link k
                                where k.sdr_id = b.id and k.deal_brand_id is not null
                                order by k.source_created_at limit 1)) as brand_id
    from base b
   where not exists (select 1 from sdr_link k where k.deal_id = b.id)
),
-- 2. UTM de primeiro contato do cliente: só para o negócio do site que a gravou.
first_touch as (
  select distinct on (l.customer_id) l.id
    from leads l
    join mkt.crm_customers c on c.id = l.customer_id
   where l.kind = 'deal' and l.utm_source is null and l.utm_campaign is null
     and c.first_utm_source is not null
     and lower(btrim(l.crm_origin_raw)) = lower(btrim(c.first_utm_source))
   order by l.customer_id, l.source_created_at, l.code
),
utm as (
  select l.*,
         case when l.utm_source is not null or l.utm_campaign is not null then 'lead'
              when ft.id is not null then 'customer_first_touch' end as utm_from,
         coalesce(l.utm_source,   case when ft.id is not null then c.first_utm_source end)   as eff_utm_source,
         coalesce(l.utm_medium,   case when ft.id is not null then c.first_utm_medium end)   as eff_utm_medium,
         coalesce(l.utm_campaign, case when ft.id is not null then c.first_utm_campaign end) as eff_utm_campaign
    from leads l
    left join first_touch ft on ft.id = l.id
    left join mkt.crm_customers c on c.id = l.customer_id
),
-- 3. Origem pela regra (SDR, UTM, referrer, de-para, texto do CRM).
classified as (
  select u.*,
         case when u.kind = 'sdr' then 'sdr'::mkt.lead_origin
              when u.utm_from is not null
                then mkt.classify_lead_origin(u.referrer_host, u.eff_utm_source, u.eff_utm_medium, o.hosts)
              when u.referrer_host is not null
                then mkt.classify_lead_origin(u.referrer_host, null, null, o.hosts)
              when u.mapped_origin is not null then u.mapped_origin
              when u.is_origin_unmapped then 'referral'::mkt.lead_origin   -- texto do CRM fora do de-para (não gravado)
              else mkt.classify_lead_origin(null, u.crm_origin_raw, null, o.hosts)
         end as origin_by_rule
    from utm u cross join own_hosts o
),
-- 4. Campanha: primeiro pelo id da plataforma; sem candidata pelo id, pelo nome. Sempre a mesma marca (se o lead tem)
--    e a mesma plataforma (se a origem é paga).
by_id as (
  select l.id as lead_id, c.id as campaign_id, c.platform
    from classified l
    join mkt.campaigns c on c.external_id = btrim(l.eff_utm_campaign)
   where (l.brand_id is null or c.brand_id = l.brand_id)
     and (l.origin_by_rule::text not in ('meta', 'tiktok', 'google') or c.platform::text = l.origin_by_rule::text)
),
by_name as (
  select l.id as lead_id, c.id as campaign_id, c.platform
    from classified l
    join mkt.campaigns c on c.utm_campaign_key = mkt.utm_key(l.eff_utm_campaign)
   where not exists (select 1 from by_id b where b.lead_id = l.id)
     and (l.brand_id is null or c.brand_id = l.brand_id)
     and (l.origin_by_rule::text not in ('meta', 'tiktok', 'google') or c.platform::text = l.origin_by_rule::text)
),
candidates as (
  select u.*, count(*) over (partition by u.lead_id) as n
    from (select * from by_id union all select * from by_name) u
),
attribution as (
  select lead_id,
         case when max(n) = 1 then (array_agg(campaign_id))[1] end as campaign_id,
         case when max(n) = 1 then (array_agg(platform))[1] end    as platform,
         (case when max(n) = 1 then 'attributed' else 'ambiguous' end)::mkt.attribution_status as status
    from candidates group by lead_id
),
-- 5. Conversão: o 1º pedido que fez do cliente um cliente novo da marca do lead, depois de o lead chegar.
conversion as (
  select distinct on (l.id) l.id as lead_id, f.brand_id as converted_brand_id,
         f.first_order_at, f.first_order_on, f.first_order_is_invoiced
    from classified l
    join mkt.v_first_orders f
      on f.customer_id = l.customer_id
     and (l.brand_id is null or f.brand_id = l.brand_id)
     and not f.is_known_before
     and f.first_order_at >= l.source_created_at
   order by l.id, f.first_order_at, f.brand_id
)
select l.id, l.code, l.kind, l.brand_id, l.customer_id, l.assigned_rep_id, l.referrer_host,
       l.source_created_at as created_at, l.created_on,
       l.eff_utm_source as utm_source, l.eff_utm_medium as utm_medium, l.eff_utm_campaign as utm_campaign, l.utm_from,
       coalesce(a.platform::text::mkt.lead_origin, l.origin_by_rule) as origin,   -- a campanha casada decide o canal
       a.campaign_id as attributed_campaign_id,
       coalesce(a.status, (case when l.eff_utm_campaign is null then 'no_utm' else 'no_match' end)::mkt.attribution_status)
         as attribution_status,
       cv.converted_brand_id, cv.first_order_at, cv.first_order_on,
       (case when cv.first_order_is_invoiced then 'invoiced'
             when cv.first_order_at is not null then 'first_order'
             when c.id is not null and (c.is_known_by_erp or c.has_app_owner or c.crm_status <> 'prospect')
               then 'registered'
             when c.id is not null then 'prospect'
             else 'lead' end)::mkt.lead_stage as stage,
       l.is_origin_unmapped
  from classified l
  left join attribution a on a.lead_id = l.id
  left join conversion cv on cv.lead_id = l.id
  left join mkt.crm_customers c on c.id = l.customer_id;

-- ---------- Cliente novo e o lead que leva o crédito (seção 3.6) ----------
create or replace view mkt.v_new_customers with (security_invoker = true) as
with new_rows as (
  select 'brand'::text as scope, f.customer_id, f.brand_id, f.first_order_id, f.first_order_at,
         f.first_order_on, f.first_order_total_cents
    from mkt.v_first_orders f
   where not f.is_known_before
  union all
  select 'group', f.customer_id, f.brand_id, f.first_order_id, f.first_order_at,
         f.first_order_on, f.first_order_total_cents
    from mkt.v_first_orders f
   where f.is_group_first and not f.is_group_known_before
),
credit as (   -- primeiro toque (decisão 0031)
  select n.scope, n.customer_id, n.brand_id, l.id as lead_id, l.origin, l.attributed_campaign_id,
         l.assigned_rep_id, l.referrer_host,
         row_number() over (partition by n.scope, n.customer_id, n.brand_id order by l.created_at, l.code) as rn
    from new_rows n
    join mkt.v_leads l
      on l.customer_id = n.customer_id
     and l.created_at <= n.first_order_at
     and (n.scope = 'group' or l.brand_id is null or l.brand_id = n.brand_id)
)
select n.*, c.lead_id, c.origin, c.attributed_campaign_id, c.assigned_rep_id, c.referrer_host,
       -- novo na marca, mas já comprava de outra marca do grupo (nota da tabela por marca)
       (n.scope = 'brand' and not exists (select 1 from new_rows g
                                           where g.scope = 'group' and g.customer_id = n.customer_id
                                             and g.brand_id = n.brand_id)) as is_cross_brand
  from new_rows n
  left join credit c on c.scope = n.scope and c.customer_id = n.customer_id
                    and c.brand_id = n.brand_id and c.rn = 1;

-- ---------- A Visão geral (seção 6.1) ----------
create or replace function api.kpi_overview(p_filters jsonb) returns jsonb
language plpgsql stable security invoker set search_path = pg_catalog, pg_temp as $$
declare
  f         mkt.kpi_filters;
  w         mkt.period_window;
  v_ads     boolean;
  v_crm     boolean;
  v_cost    boolean;   -- o custo vale para o recorte (sem origem nem representante, decisão 0032)
  v_orders  boolean;   -- o pedido não tem canal, campanha, operador, origem nem representante: só a marca recorta
  v_scope   text;      -- cliente novo: o grupo em "As duas", a marca com marca (decisão 0030)
  v_span    daterange;
  v_vazio   jsonb;
  v_r       jsonb;
begin
  -- Permissão antes de tudo: quem não pode recebe KPI-403, nunca KPI-400 nem um 0 da RLS.
  if not (authz.can('view_numbers') and authz.can('view_leads') and authz.can('view_traffic')
          and authz.can('view_connectors')) then
    raise sqlstate 'PT403' using message = 'KPI-403';
  end if;
  f := mkt.parse_filters(p_filters);
  w := mkt.period_window(f.period, mkt.complete_through('meta'));
  v_ads := mkt.ads_covered(f.brand_id, f.platform);
  v_crm := mkt.source_covered('csp360');
  v_cost := f.origin is null and f.sales_rep_id is null;
  v_orders := v_crm and f.platform is null and f.campaign_ids is null and f.operator is null and f.origin is null
              and f.sales_rep_id is null;
  v_scope := case when f.brand_id is null then 'group' else 'brand' end;
  v_span := daterange(lower(w.previous_window), upper(w.current_window));
  v_vazio := mkt.metric(null, null, null, f.compare);

  with
  camp as materialized (
    select c.id, c.brand_id, c.platform from mkt.campaigns c
     where (f.brand_id is null or c.brand_id = f.brand_id)
       and (f.platform is null or c.platform = f.platform)
       and (f.operator is null or c.managed_by = f.operator)
       and (f.campaign_ids is null or c.id = any (f.campaign_ids))
  ),
  d as materialized (
    select d.metric_on, d.spend_cents, d.impressions, d.clicks, c.brand_id, c.platform
      from mkt.ad_campaign_daily d join camp c on c.id = d.campaign_id
     where d.metric_on <@ v_span
  ),
  -- Leads do recorte (o sem marca entra em toda marca, decisão 0014); o canal do lead é a origem dele.
  ld as materialized (
    select l.created_on, l.brand_id, l.origin, k.brand_id as camp_brand_id, k.platform as camp_platform
      from mkt.v_leads l
      left join mkt.campaigns c on c.id = l.attributed_campaign_id
      left join camp k on k.id = l.attributed_campaign_id
     where v_crm and l.created_on <@ v_span
       and (f.brand_id is null or l.brand_id = f.brand_id or l.brand_id is null)
       and (f.origin is null or l.origin = f.origin)
       and (f.platform is null or l.origin::text = f.platform::text)
       and (f.operator is null or c.managed_by = f.operator)
       and (f.campaign_ids is null or l.attributed_campaign_id = any (f.campaign_ids))
       and (f.sales_rep_id is null or l.assigned_rep_id = f.sales_rep_id)
  ),
  -- Clientes novos dos dois escopos: o total usa v_scope; a linha de cada marca, o da marca.
  nc as materialized (
    select n.scope, n.first_order_on, n.brand_id, n.origin, n.is_cross_brand,
           k.brand_id as camp_brand_id, k.platform as camp_platform
      from mkt.v_new_customers n
      left join mkt.campaigns c on c.id = n.attributed_campaign_id
      left join camp k on k.id = n.attributed_campaign_id
     where v_crm and n.first_order_on <@ v_span
       and (f.brand_id is null or n.brand_id = f.brand_id)
       and (f.origin is null or n.origin = f.origin)
       and (f.platform is null or n.origin::text = f.platform::text)
       and (f.operator is null or c.managed_by = f.operator)
       and (f.campaign_ids is null or n.attributed_campaign_id = any (f.campaign_ids))
       and (f.sales_rep_id is null or n.assigned_rep_id = f.sales_rep_id)
  ),
  ped as materialized (
    select mkt.sp_day(coalesce(o.sent_at, o.source_created_at)) as sent_on, o.total_cents, o.is_invoiced
      from mkt.crm_orders o
     where v_orders and o.status = 'sent'
       and (f.brand_id is null or o.brand_id = f.brand_id)
       and mkt.sp_day(coalesce(o.sent_at, o.source_created_at)) <@ v_span
  ),
  -- Um lado por janela: atual (até hoje), atual comparável e anterior comparável (dias completos).
  lados(lado, janela) as (values ('a', w.current_window), ('cc', w.comparable_current), ('cp', w.comparable_previous)),
  -- As linhas: o total, uma por marca (só em "As duas") e uma por canal (sem filtro de canal).
  chaves(grupo, chave, brand_id, platform, n_scope, ads_base) as (
    select 'total', null::text, f.brand_id, f.platform, v_scope, v_ads
    union all
    select 'brand', b.code::text, b.id, f.platform, 'brand', mkt.ads_covered(b.id, f.platform)
      from mkt.brands b where f.brand_id is null or b.id = f.brand_id
    union all
    select 'platform', p, f.brand_id, p::mkt.platform, v_scope, mkt.ads_covered(f.brand_id, p::mkt.platform)
      from unnest(array['meta', 'tiktok', 'google']) p
     where f.platform is null or p = f.platform::text
  ),
  conta as (
    select k.grupo, k.chave, k.ads_base, l.lado,
           case when l.janela is not null then
             (select coalesce(sum(d.spend_cents), 0) from d
               where d.metric_on <@ l.janela
                 and (k.brand_id is null or d.brand_id = k.brand_id)
                 and (k.platform is null or d.platform = k.platform)) end as inv,
           case when l.janela is not null then
             (select count(*) from ld
               where ld.created_on <@ l.janela
                 and (k.brand_id is null or ld.brand_id = k.brand_id or ld.brand_id is null)
                 and (k.platform is null or ld.origin::text = k.platform::text)) end as leads,
           case when l.janela is not null then
             (select count(*) from ld
               where ld.created_on <@ l.janela and ld.camp_brand_id is not null
                 and (k.brand_id is null or ld.camp_brand_id = k.brand_id)
                 and (k.platform is null or ld.camp_platform = k.platform)) end as att_leads,
           case when l.janela is not null then
             (select count(*) from nc
               where nc.scope = k.n_scope and nc.first_order_on <@ l.janela
                 and (k.brand_id is null or nc.brand_id = k.brand_id)
                 and (k.platform is null or nc.origin::text = k.platform::text)) end as novos,
           case when l.janela is not null then
             (select count(*) from nc
               where nc.scope = k.n_scope and nc.first_order_on <@ l.janela and nc.camp_brand_id is not null
                 and (k.brand_id is null or nc.camp_brand_id = k.brand_id)
                 and (k.platform is null or nc.camp_platform = k.platform)) end as att_novos,
           case when l.janela is not null then
             (select count(*) from nc
               where nc.scope = k.n_scope and nc.first_order_on <@ l.janela and nc.is_cross_brand
                 and (k.brand_id is null or nc.brand_id = k.brand_id)) end as cross_novos
      from chaves k cross join lados l
  ),
  linhas as (
    select c.grupo, c.chave, c.ads_base,
           max(c.inv) filter (where c.lado = 'a') as inv_a, max(c.inv) filter (where c.lado = 'cc') as inv_cc,
           max(c.inv) filter (where c.lado = 'cp') as inv_cp,
           max(c.leads) filter (where c.lado = 'a') as leads_a, max(c.leads) filter (where c.lado = 'cc') as leads_cc,
           max(c.leads) filter (where c.lado = 'cp') as leads_cp,
           max(c.att_leads) filter (where c.lado = 'a') as al_a, max(c.att_leads) filter (where c.lado = 'cc') as al_cc,
           max(c.att_leads) filter (where c.lado = 'cp') as al_cp,
           max(c.novos) filter (where c.lado = 'a') as n_a, max(c.novos) filter (where c.lado = 'cc') as n_cc,
           max(c.novos) filter (where c.lado = 'cp') as n_cp,
           max(c.att_novos) filter (where c.lado = 'a') as an_a, max(c.att_novos) filter (where c.lado = 'cc') as an_cc,
           max(c.att_novos) filter (where c.lado = 'cp') as an_cp,
           max(c.cross_novos) filter (where c.lado = 'a') as cross_a
      from conta c group by c.grupo, c.chave, c.ads_base
  ),
  js as (
    select x.grupo, x.chave,
           case when x.ads_base and v_cost
                then mkt.metric(x.inv_a, x.inv_cc, x.inv_cp, f.compare, 'money')
                else mkt.metric(null, null, null, f.compare, 'money') end as investment,
           case when v_crm then mkt.metric(x.leads_a, x.leads_cc, x.leads_cp, f.compare) else v_vazio end as leads,
           case when v_crm then mkt.metric(x.n_a, x.n_cc, x.n_cp, f.compare) else v_vazio end as new_customers,
           case when v_crm and x.ads_base and v_cost
                then mkt.metric(mkt.ratio(x.inv_a, x.al_a), mkt.ratio(x.inv_cc, x.al_cc), mkt.ratio(x.inv_cp, x.al_cp),
                                f.compare, 'money')
                else mkt.metric(null, null, null, f.compare, 'money') end as cost_per_lead,
           case when v_crm and x.ads_base and v_cost
                then mkt.metric(mkt.ratio(x.inv_a, x.an_a), mkt.ratio(x.inv_cc, x.an_cc), mkt.ratio(x.inv_cp, x.an_cp),
                                f.compare, 'money')
                else mkt.metric(null, null, null, f.compare, 'money') end as cost_per_new_customer,
           case when v_crm then x.an_a end as attributed_new_customers,
           case when v_crm then x.cross_a end as cross_brand_new_customers
      from linhas x
  ),
  tot as (
    select l.lado,
           case when l.janela is not null then coalesce(sum(d.impressions) filter (where d.metric_on <@ l.janela), 0) end
             as imp,
           case when l.janela is not null then coalesce(sum(d.clicks) filter (where d.metric_on <@ l.janela), 0) end
             as cli
      from lados l left join d on true
     group by l.lado, l.janela
  ),
  ped_tot as (
    select l.lado,
           case when l.janela is not null then count(p.*) filter (where p.sent_on <@ l.janela) end as qtd,
           case when l.janela is not null then coalesce(sum(p.total_cents) filter (where p.sent_on <@ l.janela), 0) end
             as valor,
           case when l.janela is not null then count(p.*) filter (where p.sent_on <@ l.janela and p.is_invoiced) end
             as faturados
      from lados l left join ped p on true
     group by l.lado, l.janela
  ),
  dias as (
    select x::date as dia,
           (select sum(d.spend_cents) from d where d.metric_on = x::date) as inv,
           (select count(*) from ld where ld.created_on = x::date) as leads,
           (select count(*) from nc where nc.scope = v_scope and nc.first_order_on = x::date) as novos
      from generate_series(lower(w.current_window), upper(w.current_window) - 1, interval '1 day') x
  )
  select jsonb_build_object(
    'investment', (select j.investment from js j where j.grupo = 'total'),
    'leads', (select j.leads from js j where j.grupo = 'total'),
    'new_customers', (select j.new_customers from js j where j.grupo = 'total'),
    'cost_per_new_customer', (select j.cost_per_new_customer from js j where j.grupo = 'total'),
    'attributed_new_customers', (select j.attributed_new_customers from js j where j.grupo = 'total'),
    'leads_without_brand', case when v_crm then
                             (select count(*) from ld where ld.brand_id is null and ld.created_on <@ w.current_window)
                           end,
    'impressions', case when v_ads
                        then mkt.metric((select imp from tot where lado = 'a'), (select imp from tot where lado = 'cc'),
                                        (select imp from tot where lado = 'cp'), f.compare)
                        else v_vazio end,
    'clicks', case when v_ads
                   then mkt.metric((select cli from tot where lado = 'a'), (select cli from tot where lado = 'cc'),
                                   (select cli from tot where lado = 'cp'), f.compare)
                   else v_vazio end,
    'orders', jsonb_build_object(
      'count', case when v_orders
                    then mkt.metric((select qtd from ped_tot where lado = 'a'), (select qtd from ped_tot where lado = 'cc'),
                                    (select qtd from ped_tot where lado = 'cp'), f.compare)
                    else v_vazio end,
      'total_cents', case when v_orders
                          then mkt.metric((select valor from ped_tot where lado = 'a'),
                                          (select valor from ped_tot where lado = 'cc'),
                                          (select valor from ped_tot where lado = 'cp'), f.compare, 'money')
                          else mkt.metric(null, null, null, f.compare, 'money') end,
      'invoiced_count', case when v_orders
                             then mkt.metric((select faturados from ped_tot where lado = 'a'),
                                             (select faturados from ped_tot where lado = 'cc'),
                                             (select faturados from ped_tot where lado = 'cp'), f.compare)
                             else v_vazio end,
      -- N5: o valor faturado só existe quando o Control abrir o canal.
      'invoiced_total_cents', mkt.metric(null, null, null, f.compare, 'money')),
    'by_brand', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'brand', j.chave, 'investment', j.investment, 'leads', j.leads, 'cost_per_lead', j.cost_per_lead,
               'new_customers', j.new_customers, 'cost_per_new_customer', j.cost_per_new_customer,
               'attributed_new_customers', j.attributed_new_customers,
               'cross_brand_new_customers', j.cross_brand_new_customers)
             order by j.chave collate "C"), '[]')
        from js j where j.grupo = 'brand'),
    'by_platform', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'platform', j.chave, 'investment', j.investment, 'leads', j.leads, 'cost_per_lead', j.cost_per_lead,
               'new_customers', j.new_customers, 'cost_per_new_customer', j.cost_per_new_customer,
               'attributed_new_customers', j.attributed_new_customers)
             order by mkt.list_rank('lead_origin', j.chave)), '[]')
        from js j where j.grupo = 'platform'),
    'daily', (
      -- Dia sem linha: 0 com base; nulo sem base.
      select coalesce(jsonb_agg(jsonb_build_object(
               'metric_on', x.dia,
               'investment_cents', case when v_ads and v_cost then coalesce(x.inv, 0) end,
               'leads', case when v_crm then x.leads end,
               'new_customers', case when v_crm then x.novos end)
             order by x.dia), '[]')
        from dias x))
    into v_r;

  return v_r || jsonb_build_object(
    'period', mkt.period_json(w),
    'coverage', jsonb_build_object('ads', v_ads, 'csp360', v_crm),
    'has_data', v_ads or v_crm,
    'updated_at', (select min(c.last_success_at) from mkt.connectors c
                    where c.code in ('meta', 'tiktok', 'google_ads', 'csp360') and c.first_success_at is not null));
end $$;

-- ---------- Quem executa ----------
grant execute on function mkt.classify_lead_origin(text, text, text, text[]) to authenticated, mkt_worker, mkt_executor;
revoke all on mkt.v_first_orders, mkt.v_leads, mkt.v_new_customers from public, anon;
grant select on mkt.v_first_orders, mkt.v_leads, mkt.v_new_customers to authenticated;
revoke all on function api.kpi_overview(jsonb) from public, anon;
grant execute on function api.kpi_overview(jsonb) to authenticated;

-- Migração 13 · Visão geral, a parte da mídia (docs/dados/metricas.md, seções 4.2, 5 e 6.1; adianta da fase 4 o que a
--   Visão geral precisa para mostrar o gasto da Meta antes de o CSP 360 chegar)
--
-- O que faz: cria api.kpi_overview com o investimento (VG4) do período e por marca e por canal (VG12 e VG13, só a
--   coluna do investimento), as impressões e os cliques do recorte e o investimento por dia, com a comparação só com os
--   dias completos dos anúncios (decisão 0026) e a base de cada canal (mkt.ads_covered, decisão 0034). Leads, clientes
--   novos, custo por cliente novo, pedidos e alcance do Instagram (VG1 a VG3, VG5 a VG11, VG15) saem nulos ("Sem
--   dados") com coverage.csp360 = false: entram na mesma função, numa migração seguinte, quando a réplica do CSP 360 e
--   mkt.acquisition existirem. Com filtro de origem ou de representante, o investimento fica nulo (decisão 0032: o
--   custo com origem ou representante segue mkt.cost_scope, que vem com o CSP 360).
-- Risco: baixo. Só cria uma função de leitura (security invoker: a RLS das tabelas vale, view_numbers e
--   view_connectors); nada grava. Confere as permissões antes de ler os filtros (KPI-403) e recusa filtro desconhecido
--   (KPI-400, de mkt.parse_filters).
-- Como reverter (só no projeto de teste, antes de produção, e depois de reverter as migrações seguintes):
--   drop function api.kpi_overview(jsonb);
-- Conferir (a resposta da tela, como o dono, no SQL do projeto de teste):
--   select api.kpi_overview('{"brand": "cs", "period": "last_30_days"}');

create or replace function api.kpi_overview(p_filters jsonb) returns jsonb
language plpgsql stable security invoker set search_path = pg_catalog, pg_temp as $$
declare
  f         mkt.kpi_filters;
  w         mkt.period_window;
  v_ads     boolean;
  v_cost    boolean;   -- o investimento vale para o recorte (sem origem nem representante, decisão 0032)
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
  v_cost := f.origin is null and f.sales_rep_id is null;
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
     where d.metric_on between lower(w.previous_window) and upper(w.current_window) - 1
  ),
  -- Um lado por janela: atual (até hoje), atual comparável e anterior comparável (dias completos).
  lados(lado, janela) as (values ('a', w.current_window), ('cc', w.comparable_current), ('cp', w.comparable_previous)),
  tot as (
    select l.lado,
           case when l.janela is not null then coalesce(sum(d.spend_cents) filter (where d.metric_on <@ l.janela), 0) end
             as inv,
           case when l.janela is not null then coalesce(sum(d.impressions) filter (where d.metric_on <@ l.janela), 0) end
             as imp,
           case when l.janela is not null then coalesce(sum(d.clicks) filter (where d.metric_on <@ l.janela), 0) end
             as cli
      from lados l left join d on true
     group by l.lado, l.janela
  ),
  marcas as (
    select b.id as brand_id, b.code as brand from mkt.brands b where f.brand_id is null or b.id = f.brand_id
  ),
  canais as (
    select p::mkt.platform as platform from unnest(array['meta', 'tiktok', 'google']) p
     where f.platform is null or p = f.platform::text
  ),
  por_marca as (
    select m.brand, mkt.ads_covered(m.brand_id, f.platform) and v_cost as base,
           coalesce(sum(d.spend_cents) filter (where d.metric_on <@ w.current_window), 0) as a,
           case when w.comparable_current is not null
                then coalesce(sum(d.spend_cents) filter (where d.metric_on <@ w.comparable_current), 0) end as cc,
           case when w.comparable_previous is not null
                then coalesce(sum(d.spend_cents) filter (where d.metric_on <@ w.comparable_previous), 0) end as cp
      from marcas m left join d on d.brand_id = m.brand_id
     group by m.brand, m.brand_id
  ),
  por_canal as (
    select k.platform, mkt.ads_covered(f.brand_id, k.platform) and v_cost as base,
           coalesce(sum(d.spend_cents) filter (where d.metric_on <@ w.current_window), 0) as a,
           case when w.comparable_current is not null
                then coalesce(sum(d.spend_cents) filter (where d.metric_on <@ w.comparable_current), 0) end as cc,
           case when w.comparable_previous is not null
                then coalesce(sum(d.spend_cents) filter (where d.metric_on <@ w.comparable_previous), 0) end as cp
      from canais k left join d on d.platform = k.platform
     group by k.platform
  ),
  dias as (
    select x::date as dia,
           (select sum(d.spend_cents) from d where d.metric_on = x::date) as inv
      from generate_series(lower(w.current_window), upper(w.current_window) - 1, interval '1 day') x
  )
  select jsonb_build_object(
    'investment', case when v_ads and v_cost
                       then mkt.metric((select inv from tot where lado = 'a'), (select inv from tot where lado = 'cc'),
                                       (select inv from tot where lado = 'cp'), f.compare, 'money')
                       else mkt.metric(null, null, null, f.compare, 'money') end,
    'impressions', case when v_ads
                        then mkt.metric((select imp from tot where lado = 'a'), (select imp from tot where lado = 'cc'),
                                        (select imp from tot where lado = 'cp'), f.compare)
                        else v_vazio end,
    'clicks', case when v_ads
                   then mkt.metric((select cli from tot where lado = 'a'), (select cli from tot where lado = 'cc'),
                                   (select cli from tot where lado = 'cp'), f.compare)
                   else v_vazio end,
    'by_brand', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'brand', p.brand,
               'investment', case when p.base then mkt.metric(p.a, p.cc, p.cp, f.compare, 'money')
                                  else mkt.metric(null, null, null, f.compare, 'money') end)
             order by p.brand collate "C"), '[]')
        from por_marca p),
    'by_platform', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'platform', p.platform,
               'investment', case when p.base then mkt.metric(p.a, p.cc, p.cp, f.compare, 'money')
                                  else mkt.metric(null, null, null, f.compare, 'money') end)
             order by mkt.list_rank('lead_origin', p.platform::text)), '[]')
        from por_canal p),
    'daily', (
      -- Dia sem linha: 0 com base; nulo sem base.
      select coalesce(jsonb_agg(jsonb_build_object(
               'metric_on', x.dia,
               'investment_cents', case when v_ads and v_cost then coalesce(x.inv, 0) end,
               'leads', null, 'new_customers', null)
             order by x.dia), '[]')
        from dias x))
    into v_r;

  return v_r || jsonb_build_object(
    'period', mkt.period_json(w),
    'coverage', jsonb_build_object('ads', v_ads, 'csp360', false),
    'has_data', v_ads,
    'updated_at', (select min(c.last_success_at) from mkt.connectors c
                    where c.code in ('meta', 'tiktok', 'google_ads') and c.first_success_at is not null),
    'leads', v_vazio,
    'new_customers', v_vazio,
    'cost_per_new_customer', mkt.metric(null, null, null, f.compare, 'money'),
    'attributed_new_customers', null,
    'leads_without_brand', null);
end $$;

revoke all on function api.kpi_overview(jsonb) from public, anon;
grant execute on function api.kpi_overview(jsonb) to authenticated;

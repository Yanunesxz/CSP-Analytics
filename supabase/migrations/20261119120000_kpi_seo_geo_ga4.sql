-- Migração 12 · SEO e GEO, a parte do GA4 (docs/dados/metricas.md, seções 1.1, 2.1, 2.3, 2.5, 4.8, 6.7 e 8; plano.md,
--   "Ordem das migrações": adianta da fase 4 o que a tela SEO e GEO precisa para mostrar o GA4)
--
-- O que faz: cria a base comum das funções de tela que a tela SEO e GEO usa: o objeto de filtros (mkt.kpi_filters e
--   mkt.parse_filters), a janela do período com os dias completos (mkt.period_window e mkt.period_json, decisão 0026),
--   o número com comparação (mkt.round_as e mkt.metric), a base do Search Console e do GA4 (mkt.web_covered), o último
--   dia completo de cada fonte (mkt.complete_through) e a ordem das listas (mkt.list_rank). Do GA4: o canal derivado da
--   linha bruta (mkt.ga4_channel_of), as sessões por canal e por assistente de IA (mkt.v_ga4_channel_daily e
--   mkt.v_ga4_ai_daily) e api.kpi_seo_geo com SG8 a SG12 e o selo do GA4. O Search Console (SG1 a SG7), os leads e
--   clientes novos (SG13 a SG17), a checagem dos sites (SG18) e as pendências (SG19) entram na mesma função, numa
--   migração seguinte, quando as fontes deles existirem; até lá a resposta não traz essas chaves.
-- Risco: baixo. Só cria tipos, funções e views de leitura; nada grava. Toda view nasce com security_invoker e a função
--   de tela é security invoker: a RLS das tabelas vale (view_numbers e view_connectors). A função confere as permissões
--   antes de ler os filtros (KPI-403) e recusa filtro desconhecido (KPI-400).
--   Tipos criados só se ainda não existem e funções com "create or replace": uma branch que adiante a mesma base
--   (feat/kpi-resumo) não quebra, mas a última a rodar fica com o corpo dela. Conferir a junção das duas.
-- Como reverter (só no projeto de teste, antes de produção, e depois de reverter as migrações seguintes):
--   drop function api.kpi_seo_geo(jsonb);
--   drop view mkt.v_ga4_ai_daily, mkt.v_ga4_channel_daily;
--   drop function mkt.ga4_channel_of(text, text), mkt.list_rank(text, text), mkt.complete_through(mkt.connector_code),
--     mkt.web_covered(uuid, mkt.web_property_kind), mkt.metric(numeric, numeric, numeric, boolean, text),
--     mkt.round_as(numeric, text), mkt.period_json(mkt.period_window),
--     mkt.period_window(mkt.period_code, date, date), mkt.parse_filters(jsonb);
--   drop type mkt.period_window, mkt.kpi_filters;
-- Conferir (a resposta da tela, como o dono, no SQL do projeto de teste):
--   select api.kpi_seo_geo('{"brand": "cs", "period": "last_30_days"}');

-- ---------- Filtros (metricas.md, seção 1.1) ----------

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'mkt' and t.typname = 'kpi_filters') then
    create type mkt.kpi_filters as (
      brand_id     uuid,              -- nulo = as duas
      period       mkt.period_code,
      compare      boolean,
      platform     mkt.platform,      -- nulo = todos os canais
      campaign_ids uuid[],            -- nulo = todas; vazio = a campanha da URL não existe
      operator     mkt.operator,      -- nulo = os dois
      origin       mkt.lead_origin,   -- nulo = todas
      sales_rep_id uuid               -- nulo = todos
    );
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'mkt' and t.typname = 'period_window') then
    create type mkt.period_window as (
      current_window      daterange,   -- [início, hoje] em dias de São Paulo: o valor mostrado
      previous_window     daterange,   -- o período anterior inteiro
      comparable_current  daterange,   -- [início, último dia completo da fonte]; nulo sem dia completo
      comparable_previous daterange,   -- os mesmos N dias, contados do início do anterior
      days                integer
    );
  end if;
end $$;

create or replace function mkt.parse_filters(p jsonb) returns mkt.kpi_filters
language plpgsql stable set search_path = pg_catalog, pg_temp as $$
declare
  f mkt.kpi_filters;
  v_none constant uuid := '00000000-0000-0000-0000-000000000000';   -- não casa com nenhuma linha
begin
  p := coalesce(p, '{}');
  if jsonb_typeof(p) <> 'object' or exists (
       select 1 from jsonb_object_keys(p) k
        where k not in ('brand', 'period', 'compare', 'platform', 'campaign', 'operator', 'origin', 'sales_rep')) then
    raise sqlstate 'PT400' using message = 'KPI-400';
  end if;

  if p->>'brand' is not null then
    f.brand_id := coalesce((select b.id from mkt.brands b where b.code = (p->>'brand')::mkt.brand_code), v_none);
  end if;
  f.period   := coalesce(p->>'period', 'this_month');
  f.compare  := coalesce((p->>'compare')::boolean, true);
  f.platform := p->>'platform';
  f.operator := p->>'operator';
  f.origin   := p->>'origin';
  if p->>'campaign' is not null then
    f.campaign_ids := array(select c.id from mkt.campaigns c
                             where c.id::text = p->>'campaign'
                                or c.external_id = btrim(p->>'campaign')
                                or c.utm_campaign_key = mkt.utm_key(p->>'campaign'));
  end if;
  if p->>'sales_rep' is not null then
    f.sales_rep_id := coalesce((select r.id from mkt.sales_reps r where r.code = p->>'sales_rep'), v_none);
  end if;
  return f;
exception
  when check_violation or invalid_text_representation then
    raise sqlstate 'PT400' using message = 'KPI-400';
end $$;

-- ---------- Período e dias completos (metricas.md, seção 2.1; decisão 0026) ----------

create or replace function mkt.period_window(p_period mkt.period_code, p_complete_through date default null,
                                             p_today date default null)
returns mkt.period_window
language plpgsql stable set search_path = pg_catalog, pg_temp as $$
declare
  v_today      date := coalesce(p_today, mkt.today());
  v_month      date := date_trunc('month', v_today)::date;
  v_prev_month date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_n          integer;
  v_start      date;
  w            mkt.period_window;
  v_end        date;
begin
  if p_period = 'this_month' then
    w.current_window  := daterange(v_month, v_today, '[]');
    -- os mesmos dias do mês anterior, até o último dia dele (decisão 0026).
    w.previous_window := daterange(v_prev_month, least(v_prev_month + (v_today - v_month), v_month - 1), '[]');
    w.days := v_today - v_month + 1;
  elsif p_period = 'last_month' then
    w.current_window  := daterange(v_prev_month, v_month - 1, '[]');
    w.previous_window := daterange((v_prev_month - interval '1 month')::date, v_prev_month - 1, '[]');
    w.days := v_month - v_prev_month;
  else
    v_n := case p_period when 'last_7_days' then 7 when 'last_30_days' then 30 else 90 end;
    v_start := v_today - (v_n - 1);
    w.current_window  := daterange(v_start, v_today, '[]');
    w.previous_window := daterange(v_start - v_n, v_start - 1, '[]');
    w.days := v_n;
  end if;

  -- Dias completos: corta o atual no último dia fechado da fonte e o anterior no mesmo número de dias.
  v_end := least(upper(w.current_window) - 1, coalesce(p_complete_through, upper(w.current_window) - 1));
  if v_end >= lower(w.current_window) then
    w.comparable_current  := daterange(lower(w.current_window), v_end, '[]');
    w.comparable_previous := case
      -- "Mês passado" com o mês todo fechado: o mês antes dele, inteiro (decisão 0026), mesmo quando é mais longo.
      when p_period = 'last_month' and v_end = upper(w.current_window) - 1 then w.previous_window
      else daterange(lower(w.previous_window),
                     least(lower(w.previous_window) + (v_end - lower(w.current_window)),
                           upper(w.previous_window) - 1), '[]')
    end;
  end if;
  return w;
end $$;

-- Para a tela montar o rótulo ("vs. 1º a 3 de outubro") sem fazer conta de data.
create or replace function mkt.period_json(w mkt.period_window) returns jsonb
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select jsonb_build_object(
    'start_on', lower(w.current_window), 'end_on', upper(w.current_window) - 1,
    'compared_through_on', upper(w.comparable_current) - 1,
    'previous_start_on', lower(w.comparable_previous), 'previous_end_on', upper(w.comparable_previous) - 1,
    'days', w.days)
$$;

-- ---------- Número com comparação (metricas.md, seção 2.5) ----------

create or replace function mkt.round_as(p numeric, p_kind text) returns numeric
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select case p_kind
           when 'money'    then round(p)       -- centavos inteiros; meio centavo arredonda para cima
           when 'fraction' then round(p, 4)    -- taxa e parte, de 0 a 1
           when 'decimal'  then round(p, 2)    -- ROAS
           else p end                          -- contagem
$$;

-- O valor mostrado é o de até agora; a variação compara os dias completos dos dois lados (seção 2.1).
create or replace function mkt.metric(p_current numeric, p_comparable_current numeric, p_comparable_previous numeric,
                                      p_compare boolean, p_kind text default 'count') returns jsonb
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select jsonb_build_object(
    'current',   mkt.round_as(p_current, p_kind),
    'previous',  case when p_compare then mkt.round_as(p_comparable_previous, p_kind) end,
    'variation', case when p_compare
                      then round(mkt.ratio(p_comparable_current - p_comparable_previous, abs(p_comparable_previous)), 4)
                 end)
$$;

-- ---------- Base e dias completos de cada fonte (metricas.md, seções 2.1 e 2.3) ----------

-- Search Console e GA4: o conector tem base e a propriedade ativa da marca daquele tipo já foi lida.
create or replace function mkt.web_covered(p_brand_id uuid, p_kind mkt.web_property_kind) returns boolean
language sql stable set search_path = pg_catalog, pg_temp as $$
  select mkt.source_covered((case p_kind when 'ga4_property' then 'ga4' else 'search_console' end)::mkt.connector_code)
     and exists (select 1 from mkt.web_properties w
                  where w.is_active and w.kind = p_kind and w.first_read_at is not null
                    and (p_brand_id is null or w.brand_id = p_brand_id))
$$;

-- O último dia fechado de cada fonte: anúncios e CSP 360 = ontem; GA4 = o último dia lido 12 h depois de fechar (o GA4
-- muda o dia recente); Search Console = o maior dia lido; Instagram = anteontem. Nulo quando a fonte nunca leu um dia
-- fechado: a variação fica nula.
create or replace function mkt.complete_through(p_code mkt.connector_code) returns date
language sql stable set search_path = pg_catalog, pg_temp as $$
  select case p_code
    when 'ga4' then (select max(t.metric_on) from mkt.ga4_traffic_daily t
                      where t.fetched_at >= ((t.metric_on + 1)::timestamp at time zone 'America/Sao_Paulo')
                                            + interval '12 hours')
    when 'search_console' then (select max(s.metric_on) from mkt.seo_daily s)
    when 'instagram' then mkt.today() - 2
    else mkt.today() - 1
  end
$$;

-- ---------- Ordem das listas (metricas.md, seção 8) ----------

create or replace function mkt.list_rank(p_list text, p_code text) returns integer
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select array_position(case p_list
    when 'lead_stage'         then array['lead','prospect','registered','first_order','invoiced']
    when 'lead_origin'        then array['meta','tiktok','google','site','organic','ai_assistant','sdr','referral','direct']
    when 'ai_source'          then array['chatgpt','perplexity','claude','gemini','copilot','other']
    when 'level'              then array['low','medium','high']
    when 'action_status'      then array['idea','failed','approved','running','done','discarded']
    when 'customer_situation' then array['active','inactive_recent','inactive_old','lost','lead']
    when 'recency_bucket'     then array['up_to_30','31_to_90','91_to_180','181_to_365','over_365']
    when 'connector_menu'     then array['csp360','meta','tiktok','google_ads','instagram','search_console','ga4']
  end, p_code)
$$;

-- ---------- GA4: canal e assistente (metricas.md, seção 4.8) ----------

create or replace function mkt.ga4_channel_of(p_channel_group text, p_session_source text) returns mkt.ga4_channel
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select (case
    when mkt.ai_source_of(p_session_source, p_channel_group) is not null then 'ai_assistant'
    when p_channel_group = 'Organic Search' then 'organic_search'
    when p_channel_group = 'Direct'         then 'direct'
    when p_channel_group = 'Paid Search'    then 'paid_search'
    when p_channel_group = 'Paid Social'    then 'paid_social'
    when p_channel_group = 'Organic Social' then 'organic_social'
    when p_channel_group = 'Referral'       then 'referral'
    else 'other' end)::mkt.ga4_channel             -- inclui Cross-network, Email, Unassigned
$$;

create or replace view mkt.v_ga4_channel_daily with (security_invoker = true) as
select t.brand_id, t.web_property_id, t.metric_on,
       mkt.ga4_channel_of(t.channel_group_raw, t.session_source) as channel,
       sum(t.sessions) as sessions, sum(t.lead_events) as lead_events
  from mkt.ga4_traffic_daily t
 group by 1, 2, 3, 4;

create or replace view mkt.v_ga4_ai_daily with (security_invoker = true) as
select t.brand_id, t.web_property_id, t.metric_on,
       mkt.ai_source_of(t.session_source, t.channel_group_raw) as ai_source, sum(t.sessions) as sessions
  from mkt.ga4_traffic_daily t
 where mkt.ai_source_of(t.session_source, t.channel_group_raw) is not null
 group by 1, 2, 3, 4;

-- ---------- Tela SEO e GEO: api.kpi_seo_geo (metricas.md, seções 5 e 6.7) ----------

-- Por enquanto, SG8 a SG12 (GA4) e o selo do GA4. As marcas sem propriedade do GA4 lida ficam fora da conta e da
-- série; sem nenhuma, os números são nulos ("Sem dados"), nunca 0 (N1). Sessões de IA = Σ mkt.v_ga4_ai_daily; parcela =
-- IA ÷ todas as sessões, das mesmas marcas. Comparação só com os dias completos do GA4.
create or replace function api.kpi_seo_geo(p_filters jsonb) returns jsonb
language plpgsql stable security invoker set search_path = pg_catalog, pg_temp as $$
declare
  f         mkt.kpi_filters;
  w         mkt.period_window;
  v_covered boolean;
  v_geo     jsonb;
begin
  -- Permissão antes de tudo: quem não pode recebe KPI-403, nunca KPI-400 nem um 0 da RLS.
  if not (authz.can('view_numbers') and authz.can('view_leads') and authz.can('view_traffic')
          and authz.can('view_connectors')) then
    raise sqlstate 'PT403' using message = 'KPI-403';
  end if;
  f := mkt.parse_filters(p_filters);
  w := mkt.period_window(f.period, mkt.complete_through('ga4'));
  v_covered := mkt.web_covered(f.brand_id, 'ga4_property');

  if v_covered then
    with
    -- As marcas com propriedade do GA4 lida: as outras ficam fora (a tela diz "Sem dados" nelas).
    marcas as (
      select b.id as brand_id, b.code as brand
        from mkt.brands b
       where (f.brand_id is null or b.id = f.brand_id) and mkt.web_covered(b.id, 'ga4_property')
    ),
    janela as (
      select lower(w.previous_window) as inicio, upper(w.current_window) - 1 as fim
    ),
    canais as materialized (
      select c.brand_id, c.metric_on, c.channel, c.sessions
        from mkt.v_ga4_channel_daily c
        join marcas m on m.brand_id = c.brand_id
        join mkt.web_properties p on p.id = c.web_property_id and p.is_active
       where c.metric_on between (select inicio from janela) and (select fim from janela)
    ),
    ia as materialized (
      select a.brand_id, a.metric_on, a.ai_source, a.sessions
        from mkt.v_ga4_ai_daily a
        join marcas m on m.brand_id = a.brand_id
        join mkt.web_properties p on p.id = a.web_property_id and p.is_active
       where a.metric_on between (select inicio from janela) and (select fim from janela)
    ),
    totais as (
      select
        coalesce(sum(sessions) filter (where metric_on <@ w.current_window), 0) as todas_atual,
        coalesce(sum(sessions) filter (where metric_on <@ w.comparable_current), 0) as todas_cc,
        coalesce(sum(sessions) filter (where metric_on <@ w.comparable_previous), 0) as todas_cp
        from canais
    ),
    totais_ia as (
      select
        coalesce(sum(sessions) filter (where metric_on <@ w.current_window), 0) as ia_atual,
        case when w.comparable_current is not null
             then coalesce(sum(sessions) filter (where metric_on <@ w.comparable_current), 0) end as ia_cc,
        case when w.comparable_previous is not null
             then coalesce(sum(sessions) filter (where metric_on <@ w.comparable_previous), 0) end as ia_cp
        from ia
    ),
    por_assistente as (
      select s.ai_source,
             coalesce(sum(i.sessions) filter (where i.metric_on <@ w.current_window), 0) as atual,
             case when w.comparable_current is not null
                  then coalesce(sum(i.sessions) filter (where i.metric_on <@ w.comparable_current), 0) end as cc,
             case when w.comparable_previous is not null
                  then coalesce(sum(i.sessions) filter (where i.metric_on <@ w.comparable_previous), 0) end as cp
        from unnest(array['chatgpt', 'perplexity', 'claude', 'gemini', 'copilot', 'other']) s(ai_source)
        left join ia i on i.ai_source = s.ai_source
       group by s.ai_source
    ),
    por_canal as (
      select c.channel, sum(c.sessions) as sessoes
        from canais c
       where c.metric_on <@ w.current_window
       group by c.channel
      having sum(c.sessions) > 0
    ),
    -- Retrato: o dia sem nenhuma linha da marca fica nulo; com linha e sem IA, 0.
    dias as (
      select m.brand, d::date as dia,
             (select sum(c.sessions) from canais c where c.brand_id = m.brand_id and c.metric_on = d::date) as todas,
             (select sum(i.sessions) from ia i where i.brand_id = m.brand_id and i.metric_on = d::date) as de_ia
        from marcas m
        cross join generate_series(lower(w.current_window), upper(w.current_window) - 1, interval '1 day') d
    )
    select jsonb_build_object(
      'ai_sessions', mkt.metric(ti.ia_atual, ti.ia_cc, ti.ia_cp, f.compare),
      'ai_share', mkt.metric(mkt.ratio(ti.ia_atual, t.todas_atual),
                             mkt.ratio(ti.ia_cc, t.todas_cc), mkt.ratio(ti.ia_cp, t.todas_cp), f.compare, 'fraction'),
      'sessions', mkt.metric(t.todas_atual, case when w.comparable_current is not null then t.todas_cc end,
                             case when w.comparable_previous is not null then t.todas_cp end, f.compare),
      'by_ai_source', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'ai_source', a.ai_source,
                 'sessions', mkt.metric(a.atual, a.cc, a.cp, f.compare),
                 'share', mkt.round_as(mkt.ratio(a.atual, ti.ia_atual), 'fraction'))
               order by a.atual desc, mkt.list_rank('ai_source', a.ai_source)), '[]')
          from por_assistente a),
      'by_channel', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'channel', c.channel, 'sessions', c.sessoes,
                 'share', mkt.round_as(mkt.ratio(c.sessoes, t.todas_atual), 'fraction'))
               order by c.sessoes desc, c.channel collate "C"), '[]')
          from por_canal c),
      'daily', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'brand', d.brand, 'metric_on', d.dia,
                 'ai_sessions', case when d.todas is null then null else coalesce(d.de_ia, 0) end)
               order by d.brand collate "C", d.dia), '[]')
          from dias d))
      into v_geo
      from totais t, totais_ia ti;
  else
    v_geo := jsonb_build_object(
      'ai_sessions', mkt.metric(null, null, null, f.compare),
      'ai_share', mkt.metric(null, null, null, f.compare, 'fraction'),
      'sessions', mkt.metric(null, null, null, f.compare),
      'by_ai_source', '[]'::jsonb, 'by_channel', '[]'::jsonb, 'daily', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'period', mkt.period_json(w),
    'coverage', jsonb_build_object('ga4', v_covered),
    'has_data', v_covered,
    'geo', v_geo,
    'sources', jsonb_build_object('ga4', (
      -- A situação do cartão, simplificada até mkt.v_connector_health (metricas.md, seção 4.9): desligado, a ligar
      -- (nunca leu), atrasado (passou da frequência mais a folga) ou em dia.
      select jsonb_build_object('last_success_at', c.last_success_at,
                                'complete_through_on', mkt.complete_through('ga4'),
                                'covered', v_covered,
                                'status', case
                                  when c.setup_state = 'disabled' then 'disabled'
                                  when c.last_success_at is null then 'not_connected'
                                  when c.last_success_at < mkt.now() - make_interval(
                                         mins => c.expected_every_minutes + c.late_tolerance_minutes) then 'late'
                                  else 'ok' end)
        from mkt.connectors c where c.code = 'ga4')));
end $$;

-- ---------- Quem executa ----------
-- As fórmulas de mkt ficam com o padrão do esquema (a tela, o worker e o executor); as views de mkt, só a tela, que as
-- lê pela função de tela (security invoker); a função de tela, só quem tem login.

grant execute on function mkt.parse_filters(jsonb), mkt.period_window(mkt.period_code, date, date),
  mkt.period_json(mkt.period_window), mkt.round_as(numeric, text),
  mkt.metric(numeric, numeric, numeric, boolean, text), mkt.web_covered(uuid, mkt.web_property_kind),
  mkt.complete_through(mkt.connector_code), mkt.list_rank(text, text), mkt.ga4_channel_of(text, text)
  to authenticated, mkt_worker, mkt_executor;
revoke all on mkt.v_ga4_channel_daily, mkt.v_ga4_ai_daily from public, anon;
grant select on mkt.v_ga4_channel_daily, mkt.v_ga4_ai_daily to authenticated;
revoke all on function api.kpi_seo_geo(jsonb) from public, anon;
grant execute on function api.kpi_seo_geo(jsonb) to authenticated;

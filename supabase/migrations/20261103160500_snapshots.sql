-- Migração 06 · snapshots de mídia paga, Instagram, SEO, GEO e GA4 (docs/dados/plano.md, "Ordem das migrações")
--
-- O que faz: cria ad_campaign_daily, ad_activity_log, ig_account_daily, ig_media, ig_media_daily, seo_daily,
--   seo_query_daily, ga4_traffic_daily e site_checks (docs/dados/tabelas.md, seção 3), cada uma com a marca da conta,
--   da campanha, do perfil, do post ou da propriedade pela chave composta, a chave natural como idempotência, a RLS
--   ligada, a leitura de quem tem a permissão (view_numbers; as alterações nas plataformas, view_traffic) e a do worker;
--   o executor lê só o gasto por campanha (ad_campaign_daily). E mkt.valid_activity_details, que confere o jsonb de uma
--   alteração: só o tipo do objeto, o id, o campo e os valores antes e depois, nunca o nome de quem mudou; eventos de
--   usuário, papel e cobrança ficam fora.
-- Risco: baixo. Só cria; as tabelas nascem vazias. Nada lê as plataformas: o worker grava pelas funções ingest.*
--   (migração 10).
-- Como reverter (só no projeto de teste, antes de produção, e depois de reverter as migrações seguintes):
--   drop table mkt.site_checks, mkt.ga4_traffic_daily, mkt.seo_query_daily, mkt.seo_daily, mkt.ig_media_daily,
--     mkt.ig_media, mkt.ig_account_daily, mkt.ad_activity_log, mkt.ad_campaign_daily;
--   drop function mkt.valid_activity_details(text, jsonb);
-- Conferir (cada snapshot com a RLS ligada e quem lê):
--   select c.relname, c.relrowsecurity, string_agg(p.policyname, ', ' order by p.policyname)
--     from pg_class c left join pg_policies p on p.schemaname = 'mkt' and p.tablename = c.relname
--    where c.relnamespace = 'mkt'::regnamespace
--      and c.relname in ('ad_campaign_daily', 'ad_activity_log', 'ig_account_daily', 'ig_media', 'ig_media_daily',
--                        'seo_daily', 'seo_query_daily', 'ga4_traffic_daily', 'site_checks')
--    group by 1, 2 order by 1;

-- ---------- Regra pura ----------

-- O que mudou numa conta de anúncio (Meta activities e Google change_event; tabelas.md, ad_activity_log). O jsonb guarda
-- só estas chaves: object_type (conta, campanha, conjunto ou anúncio), object_id (o id ou o nome do recurso na
-- plataforma, sem espaço), field (o campo, como a plataforma chama), old_value e new_value (texto até 300 letras sem @,
-- número, sim ou não, ou nulo). Nunca object_name, actor_* nem o nome de quem mudou. Evento de usuário, papel ou cobrança
-- (pelo tipo, change_kind) fica fora: o objeto pode ser uma pessoa. Chave a mais, tipo errado ou valor de fora: falso.
create or replace function mkt.valid_activity_details(p_change_kind text, p_details jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  v_key text;
  v_value jsonb;
  v_text text;
  v_ok boolean;
begin
  if p_change_kind is null or jsonb_typeof(p_details) is distinct from 'object'
     or lower(p_change_kind) ~ '(^|[^a-z])(users?|roles?|billing|payments?|invoices?|funding)([^a-z]|$)' then
    return false;
  end if;
  for v_key, v_value in select e.key, e.value from jsonb_each(p_details) e loop
    v_text := case when jsonb_typeof(v_value) = 'string' then v_value #>> '{}' end;
    v_ok := case
      when v_key = 'object_type' then v_text in ('account', 'campaign', 'ad_set', 'ad')
      when v_key = 'object_id' then v_text ~ '^[A-Za-z0-9_./:~-]{1,120}$'
      when v_key = 'field' then v_text ~ '^[A-Za-z0-9_.]{1,80}$'
      when v_key in ('old_value', 'new_value') then
        jsonb_typeof(v_value) in ('null', 'boolean', 'number')
        or (length(v_text) <= 300 and strpos(v_text, '@') = 0)
      else false
    end;
    if not coalesce(v_ok, false) then
      return false;
    end if;
  end loop;
  return true;
end $$;

-- ---------- Tabelas ----------

-- Gasto e resultado por campanha e dia (no fuso da conta). A marca e a plataforma vêm da campanha. Quem gravou por
-- último: a API da plataforma ou o CSV de reserva (a API regrava o CSV, nunca o contrário; regra de ingest.*).
create table if not exists mkt.ad_campaign_daily (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  brand_id uuid not null,
  platform mkt.platform not null,
  metric_on date not null,
  spend_cents bigint not null default 0 check (spend_cents >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  platform_leads bigint not null default 0 check (platform_leads >= 0),
  conversions numeric(14,2) not null default 0 check (conversions >= 0),
  conversion_value_cents bigint not null default 0 check (conversion_value_cents >= 0),
  source mkt.data_source not null check (source in ('meta_ads', 'tiktok_ads', 'google_ads', 'csv')),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (campaign_id, metric_on),
  foreign key (campaign_id, brand_id, platform) references mkt.campaigns (id, brand_id, platform)
);
alter table mkt.ad_campaign_daily enable row level security;
create index if not exists ad_campaign_daily_brand_day on mkt.ad_campaign_daily (brand_id, metric_on);
create index if not exists ad_campaign_daily_day on mkt.ad_campaign_daily (metric_on);

-- Alterações feitas nas contas (Meta e Google; o TikTok não tem registro): o que mudou fora da central. Só se foi a
-- credencial de escrita do CSP-MKT, nunca quem foi. Guarda 13 meses (limpeza no pg_cron, migração 13).
create table if not exists mkt.ad_activity_log (
  id uuid primary key default gen_random_uuid(),
  ad_account_id uuid not null,
  brand_id uuid not null,
  platform mkt.platform not null,
  campaign_id uuid references mkt.campaigns(id),
  source mkt.data_source not null check (source in ('meta_ads', 'google_ads')),
  external_id text not null,
  occurred_at timestamptz not null,
  change_kind text not null check (change_kind ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  is_by_csp_mkt boolean not null,
  details jsonb not null default '{}' check (mkt.valid_activity_details(change_kind, details)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (source, external_id),
  foreign key (ad_account_id, brand_id, platform) references mkt.ad_accounts (id, brand_id, platform)
);
alter table mkt.ad_activity_log enable row level security;
create index if not exists ad_activity_log_account_time on mkt.ad_activity_log (ad_account_id, occurred_at desc);

-- Perfil do Instagram por dia. Nulo = a API não devolveu a métrica no dia (diferente de 0).
create table if not exists mkt.ig_account_daily (
  id uuid primary key default gen_random_uuid(),
  ig_account_id uuid not null,
  brand_id uuid not null,
  metric_on date not null,
  followers_count bigint check (followers_count >= 0),
  reach bigint check (reach >= 0),
  views bigint check (views >= 0),
  total_interactions bigint check (total_interactions >= 0),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (ig_account_id, metric_on),
  foreign key (ig_account_id, brand_id) references mkt.ig_accounts (id, brand_id)
);
alter table mkt.ig_account_daily enable row level security;

-- Posts do Instagram: o começo da legenda (até 120 letras, sem as menções, que o worker tira) e o link.
create table if not exists mkt.ig_media (
  id uuid primary key default gen_random_uuid(),
  ig_account_id uuid not null,
  brand_id uuid not null,
  source mkt.data_source not null default 'instagram',
  external_id text not null,
  media_type mkt.ig_media_type not null,
  published_at timestamptz not null,
  caption_excerpt text check (length(caption_excerpt) <= 120),
  permalink text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (source, external_id),
  unique (id, brand_id),
  foreign key (ig_account_id, brand_id) references mkt.ig_accounts (id, brand_id)
);
alter table mkt.ig_media enable row level security;
create index if not exists ig_media_brand_published on mkt.ig_media (brand_id, published_at);

-- O retrato diário de cada post: valores acumulados até o retrato (a tela usa o mais recente).
create table if not exists mkt.ig_media_daily (
  id uuid primary key default gen_random_uuid(),
  ig_media_id uuid not null,
  brand_id uuid not null,
  captured_on date not null,
  reach bigint check (reach >= 0),
  views bigint check (views >= 0),
  likes bigint check (likes >= 0),
  comments bigint check (comments >= 0),
  saves bigint check (saves >= 0),
  shares bigint check (shares >= 0),
  total_interactions bigint check (total_interactions >= 0),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (ig_media_id, captured_on),
  foreign key (ig_media_id, brand_id) references mkt.ig_media (id, brand_id) on delete cascade
);
alter table mkt.ig_media_daily enable row level security;

-- Search Console (relatório "Web"), por propriedade e dia (fuso do Pacífico).
create table if not exists mkt.seo_daily (
  id uuid primary key default gen_random_uuid(),
  web_property_id uuid not null,
  brand_id uuid not null,
  metric_on date not null,
  impressions bigint not null check (impressions >= 0),
  clicks bigint not null check (clicks >= 0),
  position numeric(7,2) check (position > 0),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (web_property_id, metric_on),
  foreign key (web_property_id, brand_id) references mkt.web_properties (id, brand_id)
);
alter table mkt.seo_daily enable row level security;

-- As consultas de cada dia (o worker guarda as 1.000 com mais cliques por dia e propriedade).
create table if not exists mkt.seo_query_daily (
  id uuid primary key default gen_random_uuid(),
  web_property_id uuid not null,
  brand_id uuid not null,
  metric_on date not null,
  query text not null check (length(query) between 1 and 500),
  impressions bigint not null check (impressions >= 0),
  clicks bigint not null check (clicks >= 0),
  position numeric(7,2) check (position > 0),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (web_property_id, metric_on, query),
  foreign key (web_property_id, brand_id) references mkt.web_properties (id, brand_id)
);
alter table mkt.seo_query_daily enable row level security;
create index if not exists seo_query_daily_brand_day on mkt.seo_query_daily (brand_id, metric_on);

-- Sessões do GA4 por origem, meio e canal, como o GA4 devolve: o canal e o assistente de IA são derivados em SQL
-- (mkt.v_ga4_channel_daily e mkt.v_ga4_ai_daily, migração 11).
create table if not exists mkt.ga4_traffic_daily (
  id uuid primary key default gen_random_uuid(),
  web_property_id uuid not null,
  brand_id uuid not null,
  metric_on date not null,
  session_source text not null,
  session_medium text not null,
  channel_group_raw text not null,
  sessions bigint not null check (sessions >= 0),
  lead_events bigint check (lead_events >= 0),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (web_property_id, metric_on, session_source, session_medium, channel_group_raw),
  foreign key (web_property_id, brand_id) references mkt.web_properties (id, brand_id)
);
alter table mkt.ga4_traffic_daily enable row level security;
create index if not exists ga4_traffic_daily_brand_day on mkt.ga4_traffic_daily (brand_id, metric_on);

-- Checagem diária dos sites (robots.txt, llms.txt e JSON-LD): o achado em lista fechada; o estado sai dele.
create table if not exists mkt.site_checks (
  id uuid primary key default gen_random_uuid(),
  web_property_id uuid not null,
  brand_id uuid not null,
  host text not null,
  item mkt.site_check_item not null,
  finding mkt.site_check_finding not null,
  http_status integer check (http_status between 100 and 599),
  detail text check (length(detail) <= 300),
  checked_at timestamptz not null,
  checked_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (web_property_id, item, checked_on),
  foreign key (web_property_id, brand_id) references mkt.web_properties (id, brand_id)
);
alter table mkt.site_checks enable row level security;

-- ---------- Gatilhos ----------

create or replace trigger ad_campaign_daily_updated_at before update on mkt.ad_campaign_daily
  for each row execute function private.set_updated_at();
create or replace trigger ad_activity_log_updated_at before update on mkt.ad_activity_log
  for each row execute function private.set_updated_at();
create or replace trigger ig_account_daily_updated_at before update on mkt.ig_account_daily
  for each row execute function private.set_updated_at();
create or replace trigger ig_media_updated_at before update on mkt.ig_media
  for each row execute function private.set_updated_at();
create or replace trigger ig_media_daily_updated_at before update on mkt.ig_media_daily
  for each row execute function private.set_updated_at();
create or replace trigger seo_daily_updated_at before update on mkt.seo_daily
  for each row execute function private.set_updated_at();
create or replace trigger seo_query_daily_updated_at before update on mkt.seo_query_daily
  for each row execute function private.set_updated_at();
create or replace trigger ga4_traffic_daily_updated_at before update on mkt.ga4_traffic_daily
  for each row execute function private.set_updated_at();
create or replace trigger site_checks_updated_at before update on mkt.site_checks
  for each row execute function private.set_updated_at();

-- ---------- Políticas (papeis-e-rls.md) ----------
-- Só leitura: authenticated pela permissão, o worker em todas e o executor só no gasto por campanha (o limite do mês).

drop policy if exists ad_campaign_daily_read on mkt.ad_campaign_daily;
create policy ad_campaign_daily_read on mkt.ad_campaign_daily
  for select to authenticated using ((select authz.can('view_numbers')));
drop policy if exists ad_campaign_daily_worker_read on mkt.ad_campaign_daily;
create policy ad_campaign_daily_worker_read on mkt.ad_campaign_daily
  for select to mkt_worker using (true);
drop policy if exists ad_campaign_daily_executor_read on mkt.ad_campaign_daily;
create policy ad_campaign_daily_executor_read on mkt.ad_campaign_daily
  for select to mkt_executor using (true);

drop policy if exists ad_activity_log_read on mkt.ad_activity_log;
create policy ad_activity_log_read on mkt.ad_activity_log
  for select to authenticated using ((select authz.can('view_traffic')));
drop policy if exists ad_activity_log_worker_read on mkt.ad_activity_log;
create policy ad_activity_log_worker_read on mkt.ad_activity_log
  for select to mkt_worker using (true);

drop policy if exists ig_account_daily_read on mkt.ig_account_daily;
create policy ig_account_daily_read on mkt.ig_account_daily
  for select to authenticated using ((select authz.can('view_numbers')));
drop policy if exists ig_account_daily_worker_read on mkt.ig_account_daily;
create policy ig_account_daily_worker_read on mkt.ig_account_daily
  for select to mkt_worker using (true);

drop policy if exists ig_media_read on mkt.ig_media;
create policy ig_media_read on mkt.ig_media
  for select to authenticated using ((select authz.can('view_numbers')));
drop policy if exists ig_media_worker_read on mkt.ig_media;
create policy ig_media_worker_read on mkt.ig_media
  for select to mkt_worker using (true);

drop policy if exists ig_media_daily_read on mkt.ig_media_daily;
create policy ig_media_daily_read on mkt.ig_media_daily
  for select to authenticated using ((select authz.can('view_numbers')));
drop policy if exists ig_media_daily_worker_read on mkt.ig_media_daily;
create policy ig_media_daily_worker_read on mkt.ig_media_daily
  for select to mkt_worker using (true);

drop policy if exists seo_daily_read on mkt.seo_daily;
create policy seo_daily_read on mkt.seo_daily
  for select to authenticated using ((select authz.can('view_numbers')));
drop policy if exists seo_daily_worker_read on mkt.seo_daily;
create policy seo_daily_worker_read on mkt.seo_daily
  for select to mkt_worker using (true);

drop policy if exists seo_query_daily_read on mkt.seo_query_daily;
create policy seo_query_daily_read on mkt.seo_query_daily
  for select to authenticated using ((select authz.can('view_numbers')));
drop policy if exists seo_query_daily_worker_read on mkt.seo_query_daily;
create policy seo_query_daily_worker_read on mkt.seo_query_daily
  for select to mkt_worker using (true);

drop policy if exists ga4_traffic_daily_read on mkt.ga4_traffic_daily;
create policy ga4_traffic_daily_read on mkt.ga4_traffic_daily
  for select to authenticated using ((select authz.can('view_numbers')));
drop policy if exists ga4_traffic_daily_worker_read on mkt.ga4_traffic_daily;
create policy ga4_traffic_daily_worker_read on mkt.ga4_traffic_daily
  for select to mkt_worker using (true);

drop policy if exists site_checks_read on mkt.site_checks;
create policy site_checks_read on mkt.site_checks
  for select to authenticated using ((select authz.can('view_numbers')));
drop policy if exists site_checks_worker_read on mkt.site_checks;
create policy site_checks_worker_read on mkt.site_checks
  for select to mkt_worker using (true);

-- ---------- Quem lê e quem executa ----------
-- authenticated já tem só select pelo privilégio padrão de mkt (migração 01). Os serviços, tabela por tabela.
-- mkt.valid_activity_details fica com o padrão da 01 (tela, worker e executor): é regra pura, sem leitura de tabela.
grant select on mkt.ad_campaign_daily, mkt.ad_activity_log, mkt.ig_account_daily, mkt.ig_media, mkt.ig_media_daily,
  mkt.seo_daily, mkt.seo_query_daily, mkt.ga4_traffic_daily, mkt.site_checks
  to mkt_worker;
grant select on mkt.ad_campaign_daily to mkt_executor;

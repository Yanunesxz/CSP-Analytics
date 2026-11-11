-- Migração 04 · dimensões: marcas, contas de anúncio, campanhas, representantes, perfis e sites (docs/dados/plano.md)
--
-- O que faz: cria brands (as duas marcas, sem o id do CRM, que o worker preenche na primeira leitura), ad_accounts,
--   campaigns, campaign_managed_by_history, sales_reps, sales_rep_app_logins, ig_accounts e web_properties
--   (docs/dados/tabelas.md, seção 1). Cada tabela nasce com a RLS ligada, a leitura de quem tem a permissão
--   (view_numbers; o histórico de operador, view_traffic) e a do worker e do executor, só nas tabelas da lista de cada
--   um (papeis-e-rls.md). Gatilhos: o operador da campanha só muda por api.change_campaign_operator (migração 09),
--   pela API e com configure_traffic; campanha nova nasce do humano, e do Claude só com a ação que a criou; toda troca
--   vai para o histórico, que é só de acréscimo; o código REP- do representante vem da sequência, nunca muda e não gasta
--   número na releitura.
-- Risco: baixo. Só cria; as tabelas nascem vazias, menos brands (as duas marcas). Nada lê o CRM nem as plataformas.
-- Como reverter (só no projeto de teste, antes de produção, e depois de reverter as migrações seguintes):
--   drop table mkt.web_properties, mkt.ig_accounts, mkt.sales_rep_app_logins, mkt.sales_reps,
--     mkt.campaign_managed_by_history, mkt.campaigns, mkt.ad_accounts, mkt.brands;
--   drop function private.campaigns_managed_by_guard(), private.campaigns_managed_by_audit(),
--     private.sales_reps_code();
-- Conferir (as duas marcas; as políticas de cada tabela):
--   select code, name, source, external_id from mkt.brands order by code;
--   select tablename, string_agg(policyname || ' ' || array_to_string(roles, ','), '; ' order by policyname)
--     from pg_policies
--    where schemaname = 'mkt' and tablename in ('brands', 'ad_accounts', 'campaigns', 'campaign_managed_by_history',
--          'sales_reps', 'sales_rep_app_logins', 'ig_accounts', 'web_properties')
--    group by 1 order by 1;

-- ---------- Tabelas ----------

-- Marcas do grupo (decisão 0003). Uma terceira marca é uma linha nova, sem mudar a estrutura.
create table if not exists mkt.brands (
  id uuid primary key default gen_random_uuid(),
  code mkt.brand_code not null unique,
  name text not null check (length(name) between 2 and 60),
  source mkt.data_source not null default 'csp360',
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (source, external_id)
);
alter table mkt.brands enable row level security;

-- As duas marcas, sem o marcas.id do CRM: o worker grava o id e o nome na primeira leitura, pela sigla.
insert into mkt.brands (code, name) values
  ('cs', 'Corpo Sensual'),
  ('plumene', 'Plumene')
on conflict (code) do nothing;

-- Contas de anúncio: a marca vem da conta (cada marca tem a sua conta em cada plataforma). O teto (spend_cap) só existe
-- na Meta; o 0 da Meta quer dizer "sem teto" e entra nulo.
create table if not exists mkt.ad_accounts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references mkt.brands(id),
  platform mkt.platform not null,
  source mkt.data_source not null check (source in ('meta_ads', 'tiktok_ads', 'google_ads')),
  external_id text not null,
  name text not null,
  currency text not null default 'BRL' check (currency = 'BRL'),
  time_zone text not null default 'America/Sao_Paulo',
  is_active boolean not null default true,
  last_seen_at timestamptz,
  spend_cap_cents bigint check (spend_cap_cents > 0),   -- o 0 da Meta (sem teto) entra nulo
  amount_spent_cents bigint check (amount_spent_cents >= 0),
  first_read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (source, external_id),
  unique (id, brand_id, platform),
  check (platform = 'meta' or (spend_cap_cents is null and amount_spent_cents is null))
);
alter table mkt.ad_accounts enable row level security;

-- Campanhas, com o operador (decisão 0008). A marca e a plataforma são as da conta, pela chave composta. A chave
-- created_by_action_id → traffic_actions entra na migração do tráfego, que vem depois.
create table if not exists mkt.campaigns (
  id uuid primary key default gen_random_uuid(),
  ad_account_id uuid not null,
  brand_id uuid not null,
  platform mkt.platform not null,
  source mkt.data_source not null check (source in ('meta_ads', 'tiktok_ads', 'google_ads')),
  external_id text not null,
  name text not null,
  utm_campaign_key text generated always as (mkt.utm_key(name)) stored,
  managed_by mkt.operator not null default 'human',
  status mkt.campaign_status not null,
  daily_budget_cents bigint check (daily_budget_cents >= 0),
  spend_cap_cents bigint check (spend_cap_cents >= 0),
  is_smart_plus boolean not null default false check (not is_smart_plus or platform = 'tiktok'),
  created_by_action_id uuid,
  source_created_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (source, external_id),
  unique (id, brand_id),
  unique (id, brand_id, platform),
  foreign key (ad_account_id, brand_id, platform) references mkt.ad_accounts (id, brand_id, platform)
);
alter table mkt.campaigns enable row level security;
-- O casamento da UTM filtra pela chave; o mesmo nome na mesma marca deixa a UTM repetida (metricas.md, 3.2).
create index if not exists campaigns_utm on mkt.campaigns (utm_campaign_key, brand_id);
create index if not exists campaigns_brand_status on mkt.campaigns (brand_id, status);

-- Troca de operador: quem, quando e por quê (decisão 0008). Só o gatilho de campaigns grava; só acréscimo.
create table if not exists mkt.campaign_managed_by_history (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references mkt.campaigns(id),
  from_operator mkt.operator,
  to_operator mkt.operator not null,
  reason mkt.operator_change_reason not null,
  note text check (note is null or (length(note) between 10 and 500 and not mkt.has_personal_data(note))),
  actor_kind mkt.actor_kind not null,
  changed_by uuid references mkt.profiles(id),
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  check (reason <> 'other' or note is not null),
  check ((actor_kind = 'user') = (changed_by is not null))
);
alter table mkt.campaign_managed_by_history enable row level security;
create index if not exists campaign_managed_by_history_campaign
  on mkt.campaign_managed_by_history (campaign_id, changed_at desc);

-- Representantes, sem nome (decisão 0025): dimensão compartilhada, sem marca. O código REP- vem da sequência, por
-- gatilho; o nome fica no CRM.
create table if not exists mkt.sales_reps (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  source mkt.data_source not null default 'csp360',
  external_id text,
  crm_role mkt.rep_crm_role,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (source, external_id)
);
alter table mkt.sales_reps enable row level security;

-- Login do app de cada marca, só como resumo HMAC-SHA256: o login em claro (e-mail, documento ou nome) nunca entra.
create table if not exists mkt.sales_rep_app_logins (
  id uuid primary key default gen_random_uuid(),
  sales_rep_id uuid not null references mkt.sales_reps(id) on delete cascade,
  brand_id uuid not null references mkt.brands(id),
  app_login_key text not null check (app_login_key ~ '^[0-9a-f]{64}$'),   -- resumo HMAC-SHA256, nunca o login
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (brand_id, app_login_key)
);
alter table mkt.sales_rep_app_logins enable row level security;

-- Perfis do Instagram de cada marca, cadastrados por script (setup.register_ig_account).
create table if not exists mkt.ig_accounts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references mkt.brands(id),
  source mkt.data_source not null default 'instagram',
  external_id text not null,
  username text not null,
  is_active boolean not null default true,
  first_read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (source, external_id),
  unique (id, brand_id)
);
alter table mkt.ig_accounts enable row level security;

-- Propriedades do GA4 e do Search Console de cada marca (substituem GA4_PROPERTY_ID_* e GSC_SITE_* do .env.example).
create table if not exists mkt.web_properties (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references mkt.brands(id),
  kind mkt.web_property_kind not null,
  source mkt.data_source not null check (source in ('ga4', 'search_console')),
  external_id text not null,
  host text not null check (host = lower(host) and host !~ '^www\.'),
  is_active boolean not null default true,
  first_read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (source, external_id),
  unique (id, brand_id),
  check ((kind = 'ga4_property') = (source = 'ga4'))
);
alter table mkt.web_properties enable row level security;

-- ---------- Gatilhos ----------

create or replace trigger brands_updated_at before update on mkt.brands
  for each row execute function private.set_updated_at();
create or replace trigger ad_accounts_updated_at before update on mkt.ad_accounts
  for each row execute function private.set_updated_at();
create or replace trigger campaigns_updated_at before update on mkt.campaigns
  for each row execute function private.set_updated_at();
create or replace trigger campaign_managed_by_history_updated_at before update on mkt.campaign_managed_by_history
  for each row execute function private.set_updated_at();
create or replace trigger sales_reps_updated_at before update on mkt.sales_reps
  for each row execute function private.set_updated_at();
create or replace trigger sales_rep_app_logins_updated_at before update on mkt.sales_rep_app_logins
  for each row execute function private.set_updated_at();
create or replace trigger ig_accounts_updated_at before update on mkt.ig_accounts
  for each row execute function private.set_updated_at();
create or replace trigger web_properties_updated_at before update on mkt.web_properties
  for each row execute function private.set_updated_at();

-- O operador da campanha (tabelas.md, campaigns; papeis-e-rls.md, "Gatilhos que conferem quem pede"). Na inserção:
-- campanha nova nasce do humano; do Claude, só a que a central criou, com a ação (decisão 0008). Depois, o operador só
-- muda dentro de api.change_campaign_operator: com a chave da transação (set_config('mkt.allow_operator_change', 'on',
-- true)), pela API (session_user authenticator, que uma sessão direta não troca) e com configure_traffic. O worker e o
-- executor nunca mudam o operador, nem com o token de alguém.
create or replace function private.campaigns_managed_by_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.managed_by = 'claude' and new.created_by_action_id is null then
      raise sqlstate 'PT422' using message = 'TRF-422';
    end if;
    return new;
  end if;

  if new.managed_by is not distinct from old.managed_by then
    return new;
  end if;
  if coalesce(current_setting('mkt.allow_operator_change', true), '') <> 'on'
     or session_user::text <> 'authenticator'
     or not authz.can('configure_traffic') then
    raise sqlstate 'PT403' using message = 'TRF-403';
  end if;
  return new;
end $$;

create or replace trigger campaigns_managed_by_guard before insert or update on mkt.campaigns
  for each row execute function private.campaigns_managed_by_guard();

-- Toda campanha nova e toda troca de operador vão para o histórico. Na inserção: importada (o sistema) ou criada pela
-- central (o Claude). Na troca, a pessoa que pediu, com o motivo e a nota que api.change_campaign_operator deixa na
-- transação (set_config('mkt.operator_change_reason', …, true) e set_config('mkt.operator_change_note', …, true)).
create or replace function private.campaigns_managed_by_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into mkt.campaign_managed_by_history (campaign_id, from_operator, to_operator, reason, actor_kind)
    values (new.id, null, new.managed_by,
            case when new.managed_by = 'claude' then 'created_by_claude' else 'imported' end,
            case when new.managed_by = 'claude' then 'claude' else 'system' end);
  elsif new.managed_by is distinct from old.managed_by then
    insert into mkt.campaign_managed_by_history (campaign_id, from_operator, to_operator, reason, note, actor_kind,
                                                 changed_by)
    values (new.id, old.managed_by, new.managed_by,
            nullif(current_setting('mkt.operator_change_reason', true), '')::mkt.operator_change_reason,
            nullif(current_setting('mkt.operator_change_note', true), ''),
            'user', auth.uid());
  end if;
  return null;
end $$;

create or replace trigger campaigns_managed_by_audit after insert or update of managed_by on mkt.campaigns
  for each row execute function private.campaigns_managed_by_audit();

-- O histórico de operador é só de acréscimo: ninguém altera, apaga nem esvazia, nem o dono do banco. Não tem prazo de
-- guarda (docs/dados/README.md), então nem a limpeza apaga.
create or replace trigger campaign_managed_by_history_append_only
  before update or delete on mkt.campaign_managed_by_history
  for each row execute function private.append_only();
create or replace trigger campaign_managed_by_history_no_truncate before truncate on mkt.campaign_managed_by_history
  for each statement execute function private.append_only();

-- Código REP- do representante (seção 9 do padrão). Na releitura (insert … on conflict), quem já existe fica com o
-- mesmo código e a sequência não anda: só representante novo gasta número. O código que vier no insert é ignorado, e o
-- código nunca muda.
create or replace function private.sales_reps_code() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
begin
  if tg_op = 'UPDATE' then
    if new.code is distinct from old.code then
      raise sqlstate 'PT422' using message = 'COD-422';
    end if;
    return new;
  end if;

  select r.code into v_code
    from mkt.sales_reps r
   where r.source = new.source and r.external_id = new.external_id;
  if v_code is null then
    v_code := private.next_code('REP', 'mkt.sales_rep_code_seq');
  end if;
  new.code := v_code;
  return new;
end $$;

create or replace trigger sales_reps_code before insert or update of code on mkt.sales_reps
  for each row execute function private.sales_reps_code();

-- ---------- Políticas (papeis-e-rls.md) ----------
-- Só leitura: authenticated pela permissão, o worker nas tabelas da lista dele e o executor nas dele (marcas, contas e
-- campanhas). Nenhuma política nem grant de escrita: o worker e o executor gravam pelas funções ingest.*.

drop policy if exists brands_read on mkt.brands;
create policy brands_read on mkt.brands
  for select to authenticated using ((select authz.can('view_numbers')));
drop policy if exists brands_worker_read on mkt.brands;
create policy brands_worker_read on mkt.brands
  for select to mkt_worker using (true);
drop policy if exists brands_executor_read on mkt.brands;
create policy brands_executor_read on mkt.brands
  for select to mkt_executor using (true);

drop policy if exists ad_accounts_read on mkt.ad_accounts;
create policy ad_accounts_read on mkt.ad_accounts
  for select to authenticated using ((select authz.can('view_numbers')));
drop policy if exists ad_accounts_worker_read on mkt.ad_accounts;
create policy ad_accounts_worker_read on mkt.ad_accounts
  for select to mkt_worker using (true);
drop policy if exists ad_accounts_executor_read on mkt.ad_accounts;
create policy ad_accounts_executor_read on mkt.ad_accounts
  for select to mkt_executor using (true);

drop policy if exists campaigns_read on mkt.campaigns;
create policy campaigns_read on mkt.campaigns
  for select to authenticated using ((select authz.can('view_numbers')));
drop policy if exists campaigns_worker_read on mkt.campaigns;
create policy campaigns_worker_read on mkt.campaigns
  for select to mkt_worker using (true);
drop policy if exists campaigns_executor_read on mkt.campaigns;
create policy campaigns_executor_read on mkt.campaigns
  for select to mkt_executor using (true);

drop policy if exists campaign_managed_by_history_read on mkt.campaign_managed_by_history;
create policy campaign_managed_by_history_read on mkt.campaign_managed_by_history
  for select to authenticated using ((select authz.can('view_traffic')));
drop policy if exists campaign_managed_by_history_worker_read on mkt.campaign_managed_by_history;
create policy campaign_managed_by_history_worker_read on mkt.campaign_managed_by_history
  for select to mkt_worker using (true);

drop policy if exists sales_reps_read on mkt.sales_reps;
create policy sales_reps_read on mkt.sales_reps
  for select to authenticated using ((select authz.can('view_numbers')));
drop policy if exists sales_reps_worker_read on mkt.sales_reps;
create policy sales_reps_worker_read on mkt.sales_reps
  for select to mkt_worker using (true);

drop policy if exists sales_rep_app_logins_read on mkt.sales_rep_app_logins;
create policy sales_rep_app_logins_read on mkt.sales_rep_app_logins
  for select to authenticated using ((select authz.can('view_numbers')));
drop policy if exists sales_rep_app_logins_worker_read on mkt.sales_rep_app_logins;
create policy sales_rep_app_logins_worker_read on mkt.sales_rep_app_logins
  for select to mkt_worker using (true);

drop policy if exists ig_accounts_read on mkt.ig_accounts;
create policy ig_accounts_read on mkt.ig_accounts
  for select to authenticated using ((select authz.can('view_numbers')));
drop policy if exists ig_accounts_worker_read on mkt.ig_accounts;
create policy ig_accounts_worker_read on mkt.ig_accounts
  for select to mkt_worker using (true);

drop policy if exists web_properties_read on mkt.web_properties;
create policy web_properties_read on mkt.web_properties
  for select to authenticated using ((select authz.can('view_numbers')));
drop policy if exists web_properties_worker_read on mkt.web_properties;
create policy web_properties_worker_read on mkt.web_properties
  for select to mkt_worker using (true);

-- ---------- Quem lê e quem executa ----------
-- authenticated já tem só select pelo privilégio padrão de mkt (migração 01). Os serviços, tabela por tabela.
grant select on mkt.brands, mkt.ad_accounts, mkt.campaigns, mkt.campaign_managed_by_history, mkt.sales_reps,
  mkt.sales_rep_app_logins, mkt.ig_accounts, mkt.web_properties
  to mkt_worker;
grant select on mkt.brands, mkt.ad_accounts, mkt.campaigns to mkt_executor;

-- Os gatilhos ninguém chama: só o dono, pelas tabelas.
revoke all on function private.campaigns_managed_by_guard(), private.campaigns_managed_by_audit(),
  private.sales_reps_code() from public, anon, authenticated;

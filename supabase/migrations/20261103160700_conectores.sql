-- Migração 08 · conectores, rodadas, CSV de reserva, credenciais e a fila de avisos (docs/dados/plano.md, "Ordem das
--   migrações"; decisões 0017, 0019, 0024 e 0035)
--
-- O que faz: cria connectors (as sete linhas, com a frequência esperada e a folga de cada uma), connector_jobs (uma
--   linha por trabalho agendado de docs/dados/integracoes.md, seção 2.1), sync_runs, csv_imports,
--   private.connector_credentials (só o apontador para o segredo no Vault e o estado; a credencial de escrita tem só
--   a linha de estado, sem segredo) e notification_outbox (decisão 0019), e mkt.valid_notice_payload, que confere as
--   chaves do aviso: título, números, código e link, nunca dado de cliente nem de lead. Cada tabela nasce com a RLS
--   ligada. Conectores, trabalhos, rodadas e arquivos CSV: lê quem tem view_connectors, e o worker; o executor lê só
--   connectors. As credenciais e a fila de avisos não têm leitura para ninguém pela API, nem para o dono.
-- Risco: baixo. Só cria; as tabelas nascem vazias, menos connectors e connector_jobs (configuração, sem segredo).
-- Como reverter (só no projeto de teste, antes de produção, e depois de reverter as migrações seguintes):
--   drop table mkt.notification_outbox, private.connector_credentials, mkt.csv_imports, mkt.sync_runs,
--     mkt.connector_jobs, mkt.connectors;
--   drop function mkt.valid_notice_payload(mkt.notice_kind, jsonb);
-- Conferir (cada conector com a frequência, a folga e os trabalhos; e que a API não lê credencial nem fila):
--   select c.code, c.setup_state, c.expected_every_minutes, c.late_tolerance_minutes,
--          string_agg(j.job || ' ' || j.expected_every_minutes || '+' || j.late_tolerance_minutes, ', ' order by j.job)
--     from mkt.connectors c join mkt.connector_jobs j on j.connector_id = c.id group by 1, 2, 3, 4 order by 1;
--   select has_table_privilege('authenticated', 'mkt.notification_outbox', 'select') as le_fila,
--          has_schema_privilege('authenticated', 'private', 'usage') as alcanca_credenciais;

-- ---------- Regra pura: o que um aviso leva ----------

-- O payload de cada aviso (tabelas.md, notification_outbox; decisão 0019): o título e o link (caminho dentro do
-- sistema, que o n8n completa com o endereço) em todo aviso, mais as chaves do fato de cada um: códigos das listas,
-- ids, datas e números (contagem e centavos inteiros, a partir de 0; nulo = "Sem dados"). Chave de outro aviso, tipo
-- errado, código fora da lista, link para fora ou texto com dado pessoal: falso. Obrigatórias, além do título e do
-- link: o conector (e o estado) no conector parado; a marca e a conta no gasto perto do limite; a marca no custo por
-- lead; a marca e o código da ação na proposta; as datas no relatório da semana; o conector e a finalidade na
-- credencial; a parada no "Parar tudo sem confirmação"; e o conector e a rodada na exclusão em massa segurada.
create or replace function mkt.valid_notice_payload(p_notice mkt.notice_kind, p_payload jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  c_keys constant jsonb := $keys${
    "connector_down": {"connector": "connector", "status": "connector_status", "since_at": "timestamp",
                       "late_jobs": "sync_jobs", "failures": "count", "error_code": "error_code"},
    "spend_near_limit": {"brand": "brand", "platform": "platform", "ad_account_id": "uuid", "month_on": "date",
                         "spend_cents": "count", "limit_cents": "count", "projected_cents": "count",
                         "usage_ratio": "ratio"},
    "cost_per_lead_high": {"brand": "brand", "platform": "platform", "month_on": "date", "spend_cents": "count",
                           "leads": "count", "cost_per_lead_cents": "count", "target_cost_per_lead_cents": "count"},
    "proposal_to_approve": {"brand": "brand", "platform": "platform", "action_code": "action_code",
                            "kind": "action_kind", "cost_cents": "count"},
    "weekly_report": {"brand": "brand", "from_on": "date", "to_on": "date", "spend_cents": "count",
                      "leads": "count", "new_customers": "count", "cost_per_lead_cents": "count",
                      "cost_per_new_customer_cents": "count"},
    "credential_expiring": {"connector": "connector", "purpose": "credential_purpose",
                            "status": "credential_status", "expires_at": "timestamp"},
    "stop_not_confirmed": {"brand": "brand", "traffic_stop_id": "uuid", "campaigns_count": "count",
                           "requested_at": "timestamp"},
    "mass_delete_blocked": {"connector": "connector", "sync_run_id": "uuid", "table_name": "table_name",
                            "rows_to_delete": "count", "consecutive_runs": "count"}
  }$keys$;
  c_required constant jsonb := $keys${
    "connector_down": ["connector", "status"],
    "spend_near_limit": ["brand", "ad_account_id"],
    "cost_per_lead_high": ["brand"],
    "proposal_to_approve": ["brand", "action_code"],
    "weekly_report": ["from_on", "to_on"],
    "credential_expiring": ["connector", "purpose"],
    "stop_not_confirmed": ["traffic_stop_id"],
    "mass_delete_blocked": ["connector", "sync_run_id"]
  }$keys$;
  v_keys jsonb;
  v_required text[];
  v_key text;
  v_value jsonb;
  v_kind text;
  v_item jsonb;
  v_text text;
begin
  if p_notice is null or jsonb_typeof(p_payload) is distinct from 'object' then
    return false;
  end if;
  v_keys := (c_keys -> p_notice::text) || '{"title": "title", "link": "link"}'::jsonb;
  v_required := array(select jsonb_array_elements_text(c_required -> p_notice::text)) || array['title', 'link'];
  if not p_payload ?& v_required then
    return false;
  end if;

  for v_key, v_value in select e.key, e.value from jsonb_each(p_payload) e loop
    v_kind := v_keys ->> v_key;
    if v_kind is null then
      return false;   -- chave de outro aviso ou de fora (nome, e-mail, telefone, cliente, lead…)
    end if;
    if jsonb_typeof(v_value) = 'null' then
      if v_key = any(v_required) then
        return false;
      end if;
      continue;
    end if;

    if v_kind in ('count', 'ratio') then
      if jsonb_typeof(v_value) <> 'number' then
        return false;
      end if;
      if v_value::numeric < 0 or (v_kind = 'count' and v_value::numeric <> trunc(v_value::numeric)) then
        return false;
      end if;
      continue;
    end if;

    if v_kind = 'sync_jobs' then
      if jsonb_typeof(v_value) <> 'array' then
        return false;
      end if;
      for v_item in select a.value from jsonb_array_elements(v_value) a loop
        if jsonb_typeof(v_item) <> 'string' then
          return false;
        end if;
        perform (v_item #>> '{}')::mkt.sync_job;
      end loop;
      continue;
    end if;

    if jsonb_typeof(v_value) <> 'string' then
      return false;
    end if;
    v_text := v_value #>> '{}';
    case v_kind
      when 'title' then
        if length(btrim(v_text)) not between 1 and 140 or mkt.has_personal_data(v_text) then
          return false;
        end if;
      when 'link' then
        -- Caminho dentro do sistema ("/conectores", "/trafego?acao=ACT-0012"), nunca outro endereço.
        if length(v_text) > 300 or v_text !~ '^/([A-Za-z0-9_.~-][A-Za-z0-9/_.~?=&-]*)?$'
           or mkt.has_personal_data(v_text) then
          return false;
        end if;
      when 'brand' then perform v_text::mkt.brand_code;
      when 'platform' then perform v_text::mkt.platform;
      when 'connector' then perform v_text::mkt.connector_code;
      when 'connector_status' then perform v_text::mkt.connector_status;
      when 'credential_purpose' then perform v_text::mkt.credential_purpose;
      when 'credential_status' then perform v_text::mkt.credential_status;
      when 'action_kind' then perform v_text::mkt.action_kind;
      when 'uuid' then perform v_text::uuid;
      when 'action_code' then
        if v_text !~ '^ACT-[0-9]{4,}$' then
          return false;
        end if;
      when 'error_code' then
        if v_text !~ '^[A-Z0-9_-]{2,40}$' then
          return false;
        end if;
      when 'table_name' then
        if v_text !~ '^[a-z_]{3,63}$' then
          return false;
        end if;
      when 'date' then
        if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
          return false;
        end if;
      when 'timestamp' then
        -- Instante ISO com o fuso: 2026-11-03T10:30:00Z ou 2026-11-03T10:30:00.123+00:00.
        if v_text !~ ('^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?'
                      || '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$') then
          return false;
        end if;
      else
        return false;
    end case;
  end loop;
  return true;
exception
  when check_violation or invalid_text_representation then
    return false;   -- código fora da lista ou id que não é uuid
end $$;

-- ---------- Tabelas ----------

-- Uma linha por integração. O estado da tela (ok, late, down, not_connected, disabled) é calculado em
-- mkt.v_connector_health (migração 11); aqui ficam a configuração e as datas da primeira e da última rodada boa,
-- gravadas por ingest.finish_run (migração 10).
create table if not exists mkt.connectors (
  id uuid primary key default gen_random_uuid(),
  code mkt.connector_code not null unique,
  setup_state mkt.connector_setup_state not null default 'not_connected',
  expected_every_minutes integer not null check (expected_every_minutes > 0),
  late_tolerance_minutes integer not null check (late_tolerance_minutes >= 0),
  first_success_at timestamptz,
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  check ((first_success_at is null) = (last_success_at is null))
);
alter table mkt.connectors enable row level security;

-- As sete integrações, a ligar. A frequência: 5 min no CSP 360, 60 na mídia e no Instagram, 1.440 (uma vez por dia)
-- no GA4 e no Search Console; a folga antes de "Atrasado" é 10% da frequência, no mínimo 5 min.
insert into mkt.connectors (code, expected_every_minutes, late_tolerance_minutes) values
  ('csp360', 5, 5),
  ('meta', 60, 6),
  ('instagram', 60, 6),
  ('tiktok', 60, 6),
  ('google_ads', 60, 6),
  ('ga4', 1440, 144),
  ('search_console', 1440, 144)
on conflict (code) do nothing;

-- Cada trabalho agendado de cada conector: o cartão fica "Atrasado" quando qualquer um atrasa, não só o mais
-- frequente (a passada completa do CRM, que apaga o que saiu de lá, nunca fica parada sem ninguém ver). O CSV não tem
-- linha: roda quando chega um arquivo.
create table if not exists mkt.connector_jobs (
  id uuid primary key default gen_random_uuid(),
  connector_id uuid not null references mkt.connectors(id),
  job mkt.sync_job not null,
  expected_every_minutes integer not null check (expected_every_minutes > 0),
  late_tolerance_minutes integer not null check (late_tolerance_minutes >= 0),
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (connector_id, job)
);
alter table mkt.connector_jobs enable row level security;

-- Os trabalhos de integracoes.md, seção 2.1, com a mesma regra de folga: de hora em hora (60 + 6), uma vez por dia
-- (1.440 + 144) e o incremental do CRM a cada 5 min (5 + 5). As alterações nas contas só na Meta e no Google.
insert into mkt.connector_jobs (connector_id, job, expected_every_minutes, late_tolerance_minutes)
select c.id, j.job, j.every_minutes, j.tolerance_minutes
  from (values
    ('csp360', 'crm_incremental', 5, 5),
    ('csp360', 'crm_full_pass', 1440, 144),
    ('meta', 'ads_hourly', 60, 6),
    ('meta', 'ads_backfill', 1440, 144),
    ('meta', 'ads_activity', 1440, 144),
    ('tiktok', 'ads_hourly', 60, 6),
    ('tiktok', 'ads_backfill', 1440, 144),
    ('google_ads', 'ads_hourly', 60, 6),
    ('google_ads', 'ads_backfill', 1440, 144),
    ('google_ads', 'ads_activity', 1440, 144),
    ('instagram', 'ig_hourly', 60, 6),
    ('instagram', 'ig_daily', 1440, 144),
    ('ga4', 'ga4_daily', 1440, 144),
    ('search_console', 'gsc_daily', 1440, 144)
  ) as j(connector, job, every_minutes, tolerance_minutes)
  join mkt.connectors c on c.code = j.connector
on conflict (connector_id, job) do nothing;

-- Cada rodada de cada conector: o diário da sincronização e a marca d'água da réplica (decisão 0006). "Tentar de
-- novo" cria uma rodada requested, uma por vez por conector; cada CSV tem a sua. Guarda 90 dias.
create table if not exists mkt.sync_runs (
  id uuid primary key default gen_random_uuid(),
  connector_id uuid not null references mkt.connectors(id),
  job mkt.sync_job not null,
  run_trigger mkt.sync_trigger not null,
  status mkt.sync_status not null,
  brand_id uuid references mkt.brands(id),
  requested_by uuid references mkt.profiles(id),
  requested_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  rows_written integer not null default 0 check (rows_written >= 0),
  rows_deleted integer not null default 0 check (rows_deleted >= 0),
  rows_refused integer not null default 0 check (rows_refused >= 0),
  watermark_from_at timestamptz,
  watermark_to_at timestamptz,
  personal_data_dropped integer not null default 0 check (personal_data_dropped >= 0),
  error_code text check (error_code ~ '^[A-Z0-9_-]{2,40}$'),
  error_message text check (length(error_message) <= 300),
  mass_delete_confirmed_by uuid references mkt.profiles(id),
  mass_delete_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  check (run_trigger not in ('manual_retry', 'csv_upload') or requested_by is not null),
  check ((mass_delete_confirmed_by is null) = (mass_delete_confirmed_at is null))
);
alter table mkt.sync_runs enable row level security;
create index if not exists sync_runs_connector_time on mkt.sync_runs (connector_id, started_at desc);
create unique index if not exists sync_runs_one_request on mkt.sync_runs (connector_id)
  where status = 'requested' and run_trigger = 'manual_retry';

-- O relatório de campanha exportado da plataforma, enquanto a API não é aprovada (decisão 0035). O conteúdo fica só
-- até o worker ler (relatório de campanha, sem dado de pessoa); depois sai, e fica o registro. Guarda 90 dias.
create table if not exists mkt.csv_imports (
  id uuid primary key default gen_random_uuid(),
  connector_id uuid not null references mkt.connectors(id),
  brand_id uuid not null references mkt.brands(id),
  file_name text not null check (length(file_name) between 1 and 200),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  content text,
  uploaded_by uuid not null references mkt.profiles(id),
  uploaded_at timestamptz not null default now(),
  sync_run_id uuid references mkt.sync_runs(id) on delete set null,
  rows_imported integer check (rows_imported >= 0),
  rows_refused integer check (rows_refused >= 0),
  refusal_code text check (refusal_code ~ '^[A-Z0-9_-]{2,40}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now())
);
alter table mkt.csv_imports enable row level security;

-- Credenciais que renovam (decisão 0017): o segredo fica no Vault (cifrado); aqui só o apontador e o estado. A
-- credencial de escrita fica só nas variáveis do executor e tem aqui só a linha de estado, sem segredo: é por ela que o
-- banco sabe se pode executar. Leitura sempre com o segredo, escrita nunca. Nenhuma política e nenhum grant para a
-- API, nem para o dono; o worker lê e troca o segredo de leitura só por função (migração 10).
create table if not exists private.connector_credentials (
  id uuid primary key default gen_random_uuid(),
  connector_id uuid not null references mkt.connectors(id),
  purpose mkt.credential_purpose not null,
  account_ref text,
  vault_secret_id uuid,
  status mkt.credential_status not null default 'valid',
  expires_at timestamptz,
  last_rotated_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique nulls not distinct (connector_id, purpose, account_ref),
  check ((purpose = 'write') = (vault_secret_id is null))
);
alter table private.connector_credentials enable row level security;

-- A fila de avisos (decisão 0019): o banco decide o que avisar e quando (send_after_at); o n8n lê, envia e marca só
-- pelas funções de notify (migração 13). O mesmo fato não vira dois avisos (dedupe_key). Guarda 90 dias.
create table if not exists mkt.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references mkt.profiles(id) on delete cascade,
  notice mkt.notice_kind not null,
  channel mkt.notice_channel not null,
  dedupe_key text not null unique,
  payload jsonb not null check (mkt.valid_notice_payload(notice, payload)),
  send_after_at timestamptz not null,
  status mkt.outbox_status not null default 'pending',
  attempts integer not null default 0 check (attempts between 0 and 5),
  sent_at timestamptz,
  error_code text check (error_code ~ '^[A-Z0-9_-]{2,40}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now())
);
alter table mkt.notification_outbox enable row level security;
create index if not exists notification_outbox_pending on mkt.notification_outbox (send_after_at)
  where status = 'pending';

-- ---------- Gatilhos ----------

create or replace trigger connectors_updated_at before update on mkt.connectors
  for each row execute function private.set_updated_at();
create or replace trigger connector_jobs_updated_at before update on mkt.connector_jobs
  for each row execute function private.set_updated_at();
create or replace trigger sync_runs_updated_at before update on mkt.sync_runs
  for each row execute function private.set_updated_at();
create or replace trigger csv_imports_updated_at before update on mkt.csv_imports
  for each row execute function private.set_updated_at();
create or replace trigger connector_credentials_updated_at before update on private.connector_credentials
  for each row execute function private.set_updated_at();
create or replace trigger notification_outbox_updated_at before update on mkt.notification_outbox
  for each row execute function private.set_updated_at();

-- ---------- Políticas (papeis-e-rls.md) ----------
-- Só leitura: authenticated com view_connectors e o worker (que grava pelas funções ingest.*); o executor lê só
-- connectors (o conector desligado bloqueia a execução). As credenciais e a fila de avisos não têm política nenhuma:
-- com a RLS ligada, ninguém além do dono do banco lê, e o n8n usa as funções de notify.

drop policy if exists connectors_read on mkt.connectors;
create policy connectors_read on mkt.connectors
  for select to authenticated using ((select authz.can('view_connectors')));
drop policy if exists connectors_worker_read on mkt.connectors;
create policy connectors_worker_read on mkt.connectors
  for select to mkt_worker using (true);
drop policy if exists connectors_executor_read on mkt.connectors;
create policy connectors_executor_read on mkt.connectors
  for select to mkt_executor using (true);

drop policy if exists connector_jobs_read on mkt.connector_jobs;
create policy connector_jobs_read on mkt.connector_jobs
  for select to authenticated using ((select authz.can('view_connectors')));
drop policy if exists connector_jobs_worker_read on mkt.connector_jobs;
create policy connector_jobs_worker_read on mkt.connector_jobs
  for select to mkt_worker using (true);

drop policy if exists sync_runs_read on mkt.sync_runs;
create policy sync_runs_read on mkt.sync_runs
  for select to authenticated using ((select authz.can('view_connectors')));
drop policy if exists sync_runs_worker_read on mkt.sync_runs;
create policy sync_runs_worker_read on mkt.sync_runs
  for select to mkt_worker using (true);

drop policy if exists csv_imports_read on mkt.csv_imports;
create policy csv_imports_read on mkt.csv_imports
  for select to authenticated using ((select authz.can('view_connectors')));
drop policy if exists csv_imports_worker_read on mkt.csv_imports;
create policy csv_imports_worker_read on mkt.csv_imports
  for select to mkt_worker using (true);

-- ---------- Quem lê ----------
-- authenticated já tem select pelo privilégio padrão de mkt (migração 01), menos na fila de avisos (RLS-19). Em
-- private não há privilégio padrão: ninguém além do dono. Os serviços, tabela por tabela.
revoke all on mkt.notification_outbox from public, anon, authenticated;
revoke all on private.connector_credentials from public, anon, authenticated;
grant select on mkt.connectors, mkt.connector_jobs, mkt.sync_runs, mkt.csv_imports to mkt_worker;
grant select on mkt.connectors to mkt_executor;

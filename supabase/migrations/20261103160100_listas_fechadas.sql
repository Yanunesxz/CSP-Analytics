-- Migração 02 · listas fechadas, permissões e feriados (docs/dados/plano.md, "Ordem das migrações")
--
-- O que faz: cria um domain por lista fechada de docs/dados/listas.md (o código em inglês; o rótulo e a cor ficam no
--   packages/shared/src/labels.ts, e o teste de paridade RLS-25 confere os dois lados) e, adiantado das funções de
--   KPI, mkt.period_code (o período dos filtros, que "Meus filtros" guarda na migração 03); a tabela role_permissions,
--   a única lista do que cada papel pode (listas.md, "Permissões"); e holidays, com os feriados nacionais de 2026 e
--   2027. As duas tabelas nascem com a RLS ligada e só a leitura do worker: a de quem tem perfil ativo usa
--   authz.is_active_user e entra na 03.
-- Risco: baixo. Só cria; não toca em dado. Domain nunca é apagado: mudar uma lista é "alter domain" numa migração
--   nova, com o labels.ts no mesmo PR (listas.md).
-- Como reverter (só no projeto de teste, antes de produção, e depois de reverter as migrações seguintes: authz.can,
--   da 03, lê role_permissions sem que o banco registre a dependência, e as tabelas das seguintes usam os domains):
--   drop table mkt.holidays, mkt.role_permissions;
--   drop domain mkt.<cada domain desta migração>;
-- Conferir (o que cada papel pode; e cada lista com os códigos):
--   select role, string_agg(action, ', ' order by action) from mkt.role_permissions group by role order by role;
--   select t.typname, pg_get_constraintdef(c.oid) from pg_type t join pg_constraint c on c.contypid = t.oid
--    where t.typnamespace = 'mkt'::regnamespace order by 1;

-- Um domain por lista (decisão 0016), criado só se ainda não existe: rodar de novo não desfaz o "alter domain" de
-- uma migração seguinte. O check fica com o nome <lista>_check, o que o "alter domain … drop constraint" de listas.md
-- usa.
do $$
declare
  v record;
begin
  for v in
    select l.nome, l.codigos
      from (values
        -- Listas que já estão no labels.ts, na ordem de lá (listas.md)
        ('brand_code',             array['cs', 'plumene']),
        ('platform',               array['meta', 'tiktok', 'google']),
        ('operator',               array['human', 'claude']),
        ('campaign_status',        array['active', 'paused', 'ended']),
        ('lead_stage',             array['lead', 'prospect', 'registered', 'first_order', 'invoiced']),
        ('lead_origin',            array['meta', 'tiktok', 'google', 'site', 'organic', 'ai_assistant', 'sdr',
                                         'referral', 'direct']),
        ('customer_situation',     array['active', 'inactive_recent', 'inactive_old', 'lost', 'lead']),
        ('order_status',           array['quote', 'sent', 'cancelled']),
        ('ig_media_type',          array['image', 'video', 'carousel', 'reel']),
        ('ai_source',              array['chatgpt', 'perplexity', 'claude', 'gemini', 'copilot', 'other']),
        ('action_kind',            array['create', 'pause', 'budget', 'bid', 'creative', 'pending_fix']),
        ('action_status',          array['idea', 'failed', 'approved', 'running', 'done', 'discarded']),
        ('level',                  array['low', 'medium', 'high']),
        ('connector_code',         array['meta', 'instagram', 'tiktok', 'google_ads', 'ga4', 'search_console',
                                         'csp360']),
        ('connector_status',       array['ok', 'late', 'down', 'not_connected', 'disabled']),
        ('role',                   array['owner', 'traffic_manager']),
        -- Origem e réplica
        ('data_source',            array['csp360', 'meta_ads', 'tiktok_ads', 'google_ads', 'instagram', 'ga4',
                                         'search_console', 'csv']),
        ('lead_kind',              array['deal', 'sdr']),
        ('crm_customer_status',    array['prospect', 'active', 'inactive']),
        ('upstream_trigger',       array['cron', 'manual', 'script']),
        -- Os papéis de usuarios.papel no CRM; o de atendimento entrou no lugar do de relacionamento (decisão 0041)
        ('rep_crm_role',           array['manager', 'supervisor', 'internal_seller', 'field_rep',
                                         'customer_service']),
        ('web_property_kind',      array['ga4_property', 'gsc_site']),
        -- Canais, SEO e GEO
        ('ga4_channel',            array['organic_search', 'ai_assistant', 'direct', 'paid_search', 'paid_social',
                                         'organic_social', 'referral', 'other']),
        ('site_check_item',        array['robots_txt', 'llms_txt', 'json_ld']),
        ('site_check_finding',     array['found', 'missing', 'blocks_ai_bots', 'blocks_ai_training', 'invalid',
                                         'unreachable']),
        ('site_check_status',      array['ok', 'warning']),
        -- Tráfego
        ('discard_reason',         array['not_worth_it', 'wrong_numbers', 'bad_timing', 'duplicate',
                                         'against_strategy', 'other']),
        ('done_via',               array['platform_api', 'manual']),
        ('operator_change_reason', array['imported', 'created_by_claude', 'handover_to_claude', 'back_to_human',
                                         'correction', 'other']),
        ('actor_kind',             array['user', 'claude', 'system']),
        ('run_status',             array['running', 'succeeded', 'failed']),
        ('stop_scope',             array['claude_only']),
        ('execution_operation',    array['pause', 'activate', 'set_daily_budget', 'create_campaign',
                                         'set_account_spend_cap']),
        ('execution_status',       array['queued', 'blocked', 'sent', 'confirmed', 'failed', 'cancelled']),
        ('execution_block_reason', array['no_write_credential', 'no_spend_limit', 'over_spend_limit', 'stopped',
                                         'approval_invalid', 'campaign_ended', 'connector_disabled']),
        ('traffic_event',          array['action_proposed', 'action_approved', 'action_running', 'action_done',
                                         'action_failed', 'action_discarded', 'stop_all', 'stop_undone',
                                         'limit_changed', 'strategy_saved', 'operator_changed', 'execution_retried',
                                         'execution_status_changed']),
        -- Conectores, usuários e avisos
        ('connector_setup_state',  array['connected', 'not_connected', 'disabled']),
        ('sync_job',               array['crm_incremental', 'crm_full_pass', 'ads_hourly', 'ig_hourly',
                                         'ads_backfill', 'ig_daily', 'ads_activity', 'ga4_daily', 'gsc_daily',
                                         'csv_import']),
        ('sync_trigger',           array['schedule', 'manual_retry', 'backfill', 'csv_upload']),
        ('sync_status',            array['requested', 'running', 'succeeded', 'partial', 'failed']),
        ('credential_purpose',     array['read', 'write']),
        ('credential_status',      array['valid', 'expiring', 'invalid', 'revoked']),
        ('app_action',             array['view_numbers', 'view_leads', 'view_lead_personal_data', 'view_traffic',
                                         'operate_traffic', 'approve_action', 'stop_all', 'configure_traffic',
                                         'view_connectors', 'retry_connector', 'manage_users', 'view_diagnostics',
                                         'edit_settings']),
        ('theme_preference',       array['device', 'light', 'dark']),
        ('view_mode',              array['viewer', 'manager']),
        ('notice_kind',            array['connector_down', 'spend_near_limit', 'cost_per_lead_high',
                                         'proposal_to_approve', 'weekly_report', 'credential_expiring',
                                         'stop_not_confirmed', 'mass_delete_blocked']),
        ('notice_channel',         array['email', 'whatsapp']),
        ('outbox_status',          array['pending', 'sent', 'failed', 'skipped']),
        ('saved_filter_scope',     array['bar', 'traffic_list']),
        ('audit_event',            array['first_owner_created', 'invite_sent', 'invite_revoked', 'role_changed',
                                         'access_revoked', 'connector_state_changed', 'connector_retry_requested',
                                         'mass_delete_confirmed', 'credential_status_changed']),
        ('deactivation_reason',    array['left_company', 'role_changed', 'security', 'other']),
        -- Entrada dos filtros (metricas.md, 1.1), adiantada: mkt.valid_saved_filters (migração 03) confere o período
        ('period_code',            array['this_month', 'last_month', 'last_7_days', 'last_30_days', 'last_90_days'])
      ) as l(nome, codigos)
  loop
    if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                    where n.nspname = 'mkt' and t.typname = v.nome) then
      execute format('create domain mkt.%I as text check (value in (%s))', v.nome,
                     (select string_agg(quote_literal(u.codigo), ', ' order by u.ordem)
                        from unnest(v.codigos) with ordinality as u(codigo, ordem)));
    end if;
  end loop;
end $$;

-- O que cada papel pode: a única lista de permissões (decisão 0018). Toda política e toda função de ação consultam
-- esta tabela por authz.can (migração 03); a tela lê em api.my_permissions().
create table if not exists mkt.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role mkt.role not null,
  action mkt.app_action not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (role, action)
);
alter table mkt.role_permissions enable row level security;

create or replace trigger role_permissions_updated_at before update on mkt.role_permissions
  for each row execute function private.set_updated_at();

-- listas.md, "Permissões". Ninguém tem view_lead_personal_data: a ficha fica no CSP 360. Mudar é uma migração nova.
insert into mkt.role_permissions (role, action)
select p.role, unnest(p.actions)
  from (values
    ('owner', array['view_numbers', 'view_leads', 'view_traffic', 'operate_traffic', 'approve_action', 'stop_all',
                    'configure_traffic', 'view_connectors', 'retry_connector', 'manage_users', 'view_diagnostics',
                    'edit_settings']),
    ('traffic_manager', array['view_numbers', 'view_leads', 'view_traffic', 'operate_traffic', 'view_connectors',
                              'edit_settings'])
  ) as p(role, actions)
on conflict (role, action) do nothing;

-- Feriados nacionais (horário comercial dos avisos, mkt.next_business_slot). Os do ano seguinte entram por migração
-- até 1º de dezembro (item fixo de "Próximos passos" no ESTADO.md). Carnaval e Corpus Christi são ponto facultativo.
create table if not exists mkt.holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_on date not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now())
);
alter table mkt.holidays enable row level security;

create or replace trigger holidays_updated_at before update on mkt.holidays
  for each row execute function private.set_updated_at();

insert into mkt.holidays (holiday_on, name) values
  ('2026-01-01', 'Confraternização Universal'),
  ('2026-04-03', 'Paixão de Cristo'),
  ('2026-04-21', 'Tiradentes'),
  ('2026-05-01', 'Dia do Trabalho'),
  ('2026-09-07', 'Independência do Brasil'),
  ('2026-10-12', 'Nossa Senhora Aparecida'),
  ('2026-11-02', 'Finados'),
  ('2026-11-15', 'Proclamação da República'),
  ('2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'),
  ('2026-12-25', 'Natal'),
  ('2027-01-01', 'Confraternização Universal'),
  ('2027-03-26', 'Paixão de Cristo'),
  ('2027-04-21', 'Tiradentes'),
  ('2027-05-01', 'Dia do Trabalho'),
  ('2027-09-07', 'Independência do Brasil'),
  ('2027-10-12', 'Nossa Senhora Aparecida'),
  ('2027-11-02', 'Finados'),
  ('2027-11-15', 'Proclamação da República'),
  ('2027-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'),
  ('2027-12-25', 'Natal')
on conflict (holiday_on) do nothing;

-- Quem lê: o worker (a lista dele em papeis-e-rls.md) e, pela política da 03, quem tem perfil ativo. Ninguém grava
-- além das migrações; authenticated já tem só select pelo privilégio padrão de mkt (migração 01).
grant select on mkt.role_permissions, mkt.holidays to mkt_worker;

drop policy if exists role_permissions_worker_read on mkt.role_permissions;
create policy role_permissions_worker_read on mkt.role_permissions
  for select to mkt_worker using (true);

drop policy if exists holidays_worker_read on mkt.holidays;
create policy holidays_worker_read on mkt.holidays
  for select to mkt_worker using (true);

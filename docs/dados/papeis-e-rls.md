# Papéis, acesso e RLS

> Proposta da fase 3. Base: decisões 0005, 0011, 0013, 0017 e 0023. O SQL é rascunho. Nada foi criado.

## Quem acessa o banco

| Quem | Como entra | O que pode |
|---|---|---|
| `anon` | chamada à API sem login | **Nada.** Sem `usage` em nenhum esquema; a API responde negado |
| `authenticated` com perfil ativo `owner` | login (Supabase Auth), pela API | Lê tudo o que as telas mostram; grava só pelas funções `api.*`, conforme `role_permissions` |
| `authenticated` com perfil ativo `traffic_manager` | login, pela API | Lê números, leads (sem dado pessoal, como todos), tráfego e conectores; propõe, salva estratégia e marca como feita; não aprova, não para tudo, não mexe em limite, usuários nem conectores |
| `authenticated` sem perfil, ou com perfil inativo | login de quem não foi convidado ou perdeu o acesso | **Nada**: `authz.can()` devolve falso para toda ação, e toda política depende dela. Só `api.my_profile()` responde, com o próprio perfil inativo |
| `authenticator` | o PostgREST (a API) | Troca para `anon` ou `authenticated` a cada chamada. É o `session_user` de toda chamada pela API: os gatilhos conferem esse nome para separar a pessoa dos serviços |
| `mkt_worker` | conexão Postgres própria do worker de leitura (decisão 0017) | Lê as tabelas de `mkt` da lista dele (nunca as de pessoas: perfis, convites, preferências, filtros, auditoria e fila de avisos); grava só pelas funções `ingest.*` dele; lê e troca só credenciais de **leitura** (`private.read_credential`, `private.rotate_credential`). Não chama `api.*` e não escreve nas plataformas |
| `mkt_executor` | conexão Postgres própria do executor, um serviço à parte no Railway (decisão 0017) | Lê as tabelas de tráfego, contas, campanhas, gasto, limites e conectores; executa só `ingest.next_execution`, `ingest.update_execution` e `ingest.set_action_progress`. É o único com os tokens de escrita das plataformas, que ficam só nas variáveis dele: o executor não lê o Vault |
| `mkt_setup` | conexão usada só pelos scripts de configuração (`MKT_SETUP_DATABASE_URL`, lida do `.env` na hora, nunca no Railway) | Só as funções `setup.*`: cadastrar conta de anúncio, perfil do Instagram, propriedade de site, credencial e o convite do primeiro dono, e marcar o funil antigo dos leads do site (`setup.mark_lead_funnel`, decisão 0041). `setup.register_credential(connector_code, purpose, account_ref, secret, expires_at)` cria o segredo no Vault e a linha de `private.connector_credentials`, com o segredo como parâmetro ligado, nunca no texto do SQL; a credencial de escrita ganha só a linha de estado, sem segredo |
| `n8n_notifier` | conexão Postgres própria do n8n | Só `notify.claim_pending`, `notify.mark_sent` e `notify.mark_failed`. Não lê tabela nenhuma |
| `service_role` | chave do projeto, só nas Edge Functions `convidar` e `tirar-acesso` e no job manual do primeiro dono | Usada só para o que o Auth exige: mandar o convite, bloquear o login, derrubar sessão e trocar o e-mail de quem perdeu o acesso. Nunca no worker, nunca no front |
| `postgres` | CI, ao aplicar migrações | Dono dos objetos; não é usado por pessoa nem por serviço no dia a dia |

Nenhum papel de serviço tem `bypassrls`, `superuser`, `createrole` ou `createdb`. O papel da pessoa vem de
`mkt.profiles.role`, nunca do token: trocar ou tirar o papel vale na próxima chamada, sem esperar o login vencer. O
toggle Visualizador · Gestor de tráfego não aparece aqui: muda a tela, não o acesso (decisão 0011).

## Funções de apoio (esquema `authz`)

As funções que as políticas chamam ficam num esquema só delas, `authz`. Assim `authenticated` não precisa de
`usage` em `private`, onde ficam as credenciais e as filas.

```sql
-- Ações que pedem o segundo fator (TOTP; decisão 0023): a lista mora só aqui, e authz.can,
-- api.my_permissions() e api.list_role_permissions() chamam esta função. Parar tudo nunca pede.
create or replace function authz.requires_second_factor(p_action mkt.app_action) returns boolean
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select p_action in ('approve_action', 'configure_traffic', 'manage_users', 'retry_connector')
$$;

-- Permissão do usuário logado: perfil ativo + papel com a ação em role_permissions.
create or replace function authz.can(p_action mkt.app_action) returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select exists (
    select 1
      from mkt.profiles p
      join mkt.role_permissions rp on rp.role = p.role and rp.action = p_action
     where p.id = auth.uid() and p.is_active
       -- O que gasta dinheiro ou mexe em acesso pede o segundo fator (TOTP; decisão 0023).
       and (not authz.requires_second_factor(p_action)
            or coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
  )
$$;

create or replace function authz.is_active_user() returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select exists (select 1 from mkt.profiles p where p.id = auth.uid() and p.is_active)
$$;

revoke all on function authz.can(mkt.app_action), authz.requires_second_factor(mkt.app_action),
  authz.is_active_user(), authz.display_name(uuid) from public;
grant usage on schema authz to authenticated;
grant execute on function authz.can(mkt.app_action), authz.requires_second_factor(mkt.app_action),
  authz.is_active_user(), authz.display_name(uuid) to authenticated;
```

`role_permissions` é a única lista de permissões: a tela lê as do usuário em `api.my_permissions()` e não tem cópia em
TypeScript (decisão 0018). As políticas usam `(select authz.can(...))`, que o Postgres calcula uma vez por consulta,
não uma vez por linha.

## Privilégios por esquema

```sql
-- Migração 01, antes de qualquer função. O Postgres dá EXECUTE a PUBLIC em toda função nova; "in schema" não desfaz
-- isso. Só o revoke global, sem "in schema", tira.
alter default privileges for role postgres revoke execute on functions from public;
revoke execute on all functions in schema mkt, api, authz, ingest, notify, private, setup from public;

revoke all on schema mkt, api, authz, ingest, notify, private, setup from public, anon;
revoke all on all tables in schema mkt from public, anon, authenticated;
alter default privileges for role postgres in schema mkt revoke all on tables from public, anon;

-- authenticated: lê pelas views e funções de api; a RLS das tabelas decide as linhas
grant usage on schema api, mkt, authz to authenticated;
grant select on all tables in schema mkt to authenticated;   -- nunca insert, update, delete
alter default privileges for role postgres in schema mkt grant select on tables to authenticated;
revoke select on mkt.notification_outbox from authenticated;
grant select on all tables in schema api to authenticated;   -- as views security_invoker
grant execute on all functions in schema mkt to authenticated, mkt_worker, mkt_executor;   -- fórmulas (security invoker)
alter default privileges for role postgres in schema mkt
  grant execute on functions to authenticated, mkt_worker, mkt_executor;   -- e as das migrações seguintes
-- Funções de api: grant uma a uma, na migração que cria cada uma (exemplo em "Funções de ação").

-- worker de leitura: lê as tabelas que usa, tabela por tabela (nunca as de pessoas)
grant usage on schema mkt, ingest, private to mkt_worker;
grant select on mkt.brands, mkt.ad_accounts, mkt.campaigns, mkt.campaign_managed_by_history, mkt.sales_reps,
  mkt.sales_rep_app_logins, mkt.ig_accounts, mkt.web_properties, mkt.crm_funnels, mkt.crm_origin_map,
  mkt.crm_customers, mkt.crm_customer_brands, mkt.crm_customer_reps, mkt.crm_leads, mkt.crm_orders,
  mkt.crm_upstream_runs, mkt.ad_campaign_daily, mkt.ad_activity_log, mkt.ig_account_daily, mkt.ig_media,
  mkt.ig_media_daily, mkt.seo_daily, mkt.seo_query_daily, mkt.ga4_traffic_daily, mkt.site_checks,
  mkt.traffic_strategies, mkt.spend_limits, mkt.claude_runs, mkt.traffic_actions, mkt.connectors,
  mkt.connector_jobs, mkt.sync_runs, mkt.csv_imports, mkt.holidays, mkt.role_permissions
  to mkt_worker;
-- e as views mkt.v_* que mkt.claude_context lê, na migração que cria cada uma
grant execute on function ingest.start_run(…), ingest.finish_run(…), ingest.take_requested_run(…),
  ingest.upsert_…(…), ingest.replace_day(…), ingest.delete_missing(text, uuid),
  ingest.record_claude_run(…), ingest.add_claude_proposal(…) to mkt_worker;          -- uma a uma, nunca "all"
grant execute on function private.read_credential(uuid), private.rotate_credential(uuid, text, timestamptz)
  to mkt_worker;

-- executor: só o tráfego
grant usage on schema mkt, ingest, private to mkt_executor;
grant select on mkt.brands, mkt.ad_accounts, mkt.campaigns, mkt.ad_campaign_daily, mkt.spend_limits,
  mkt.traffic_actions, mkt.traffic_stops, mkt.traffic_stop_campaigns, mkt.platform_executions, mkt.connectors
  to mkt_executor;
grant execute on function ingest.next_execution(), ingest.update_execution(…), ingest.set_action_progress(…)
  to mkt_executor;
-- nenhum grant em private.read_credential: o segredo de escrita fica nas variáveis do executor, não no Vault

-- n8n: só a fila, função por função
grant usage on schema notify to n8n_notifier;
grant execute on function notify.claim_pending(integer), notify.mark_sent(uuid), notify.mark_failed(uuid, text)
  to n8n_notifier;

-- scripts de configuração
grant usage on schema setup to mkt_setup;
grant execute on function setup.register_ad_account(…), setup.register_ig_account(…),
  setup.register_web_property(…), setup.mark_lead_funnel(text), setup.register_credential(…),
  setup.create_first_owner_invitation(…) to mkt_setup;
```

- `grant select` em `mkt` não abre as tabelas na API: o esquema não está na lista do PostgREST. Serve para as views
  `security_invoker` e as funções de KPI, que rodam com os direitos de quem chama.
- Tabela nova entra na lista do worker ou do executor só se ele precisar dela, na migração que a cria.
- As funções que enfileiram avisos e as filas de execução (`private.queue_execution`, `private.queue_stop_executions`,
  `private.queue_monthly_spend_caps`, `private.enqueue_*`) não têm `grant` para ninguém: só as funções de `api`, os
  gatilhos e o `pg_cron`, todos com dono `postgres`, chamam.
- O GraphQL do Supabase fica desligado (decisão 0013).

## Matriz de acesso

L = lê pela API (views e funções de `api`) ou, nos papéis de serviço, por `select` · F = altera só por função de ação,
que confere a permissão · — = nada. `anon` e "sem perfil ou inativo" ficam com — em todas as linhas.

| Tabela ou view | `owner` | `traffic_manager` | `mkt_worker` | `mkt_executor` | `n8n_notifier` |
|---|---|---|---|---|---|
| `brands`, `ad_accounts` | L | L | L, grava por `ingest` | L | — |
| `ig_accounts`, `web_properties`, `sales_reps`, `sales_rep_app_logins` | L | L | L, grava por `ingest` | — | — |
| `campaigns` | L, F (operador: `change_campaign_operator`) | L | L, grava por `ingest` (nunca muda o operador) | L, grava por `ingest` (o status relido e a campanha criada pela central) | — |
| `campaign_managed_by_history` | L | L | L | — | — |
| `crm_customers`, `crm_customer_brands`, `crm_customer_reps`, `crm_orders` | L | L | L, grava por `ingest` | — | — |
| `crm_leads`, `crm_funnels` | L | L | L, grava por `ingest` | — | — |
| `crm_origin_map` | L | L | L (só a migração grava) | — | — |
| `crm_upstream_runs` | L | L | L, grava por `ingest` | — | — |
| `ad_campaign_daily` | L | L | L, grava por `ingest` | L | — |
| Outros snapshots (`ig_*`, `seo_*`, `ga4_traffic_daily`, `site_checks`) | L | L | L, grava por `ingest` | — | — |
| `ad_activity_log` | L | L | L, grava por `ingest` | — | — |
| `traffic_strategies` | L, F (`save_strategy`) | L, F (`save_strategy`) | L | — | — |
| `spend_limits` | L, F (`set_spend_limit`) | L | L | L | — |
| `claude_runs` | L | L | L, grava por `ingest` | — | — |
| `traffic_actions` | L, F (propor, aprovar, descartar, marcar como feita) | L, F (propor, marcar como feita) | L, grava por `ingest` (só as propostas do Claude, em `idea`) | L, grava por `ingest` (`running`, `done`, `failed`) | — |
| `traffic_stops`, `traffic_stop_campaigns` | L, F (`stop_all`, `undo_stop`) | L | — | L | — |
| `platform_executions` | L | L | — | L, grava por `ingest` | — |
| `traffic_log` | L | L | — | — (o gatilho grava o andamento) | — |
| `connectors`, `connector_jobs` | L, F (`retry_connector`, `set_connector_state`) | L | L, grava por `ingest` | L (`connectors`) | — |
| `sync_runs` | L, F (`retry_connector` cria o pedido; `upload_csv` cria a rodada do arquivo; `confirm_mass_delete`) | L | L, grava por `ingest` | — | — |
| `csv_imports` | L, F (`upload_csv`) | L | L, grava por `ingest` (resultado e limpeza do conteúdo) | — | — |
| `connector_credentials` (esquema `private`) | só o estado, por `api.credential_status()` | só o estado | só as de leitura, por função | — (a linha de estado é lida por `mkt.execution_allowed`, dentro de `ingest.next_execution`) | — |
| `profiles` | L (todos), F (papel, acesso, as próprias preferências) | L (o próprio), F (as próprias preferências) | — | — | — |
| `invitations` | L, F (`invite_user`, `revoke_invitation`) | — | — | — | — |
| `notification_preferences`, `saved_filters` | L e F, só os próprios | L e F, só os próprios | — | — | — |
| `notification_outbox` | — | — | — | — | por `notify.*` |
| `holidays`, `role_permissions` | L | L | L | — | — |
| `audit_log` | L | — | — (grava por `ingest`, sem ler) | — | — |

O protótipo esconde o "Tentar de novo" do gestor (`tentar_conector_de_novo` só no dono): a matriz segue o mesmo.

## Políticas

Todas as tabelas de `mkt` têm `enable row level security`. As políticas para `authenticated` são só de `select`;
não há política de `insert`, `update` ou `delete` para ele, e também não há `grant`: as duas travas juntas.

```sql
-- Modelo: números (o mesmo para dimensões, réplica de clientes e pedidos, snapshots e spend_limits)
alter table mkt.ad_campaign_daily enable row level security;
create policy ad_campaign_daily_read on mkt.ad_campaign_daily
  for select to authenticated using ((select authz.can('view_numbers')));
create policy ad_campaign_daily_worker_read on mkt.ad_campaign_daily
  for select to mkt_worker using (true);
create policy ad_campaign_daily_executor_read on mkt.ad_campaign_daily
  for select to mkt_executor using (true);

-- Leads
create policy crm_leads_read on mkt.crm_leads
  for select to authenticated using ((select authz.can('view_leads')));

-- Tráfego (estratégia, ações, rodadas do Claude, paradas, execuções, diário, histórico de operador)
create policy traffic_actions_read on mkt.traffic_actions
  for select to authenticated using ((select authz.can('view_traffic')));

-- Conectores e rodadas
create policy sync_runs_read on mkt.sync_runs
  for select to authenticated using ((select authz.can('view_connectors')));

-- Perfis: o próprio, ou todos para quem gere usuários
create policy profiles_read on mkt.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select authz.can('manage_users')));

-- Preferências e meus filtros: só os próprios, e só com perfil ativo
create policy saved_filters_read on mkt.saved_filters
  for select to authenticated
  using (profile_id = (select auth.uid()) and (select authz.is_active_user()));
create policy notification_preferences_read on mkt.notification_preferences
  for select to authenticated
  using (profile_id = (select auth.uid()) and (select authz.is_active_user()));

-- Convites e auditoria: só quem gere usuários
create policy invitations_read on mkt.invitations
  for select to authenticated using ((select authz.can('manage_users')));
create policy audit_log_read on mkt.audit_log
  for select to authenticated using ((select authz.can('manage_users')));

-- Listas de apoio: qualquer perfil ativo
create policy role_permissions_read on mkt.role_permissions
  for select to authenticated using ((select authz.is_active_user()));
create policy holidays_read on mkt.holidays
  for select to authenticated using ((select authz.is_active_user()));

-- Fila de avisos: RLS ligada e nenhuma política para authenticated (o n8n usa funções)
alter table mkt.notification_outbox enable row level security;
```

| Política | Tabelas |
|---|---|
| `view_numbers` | `brands`, `ad_accounts`, `campaigns`, `sales_reps`, `sales_rep_app_logins`, `ig_accounts`, `web_properties`, `crm_customers`, `crm_customer_brands`, `crm_customer_reps`, `crm_orders`, `ad_campaign_daily`, `ig_account_daily`, `ig_media`, `ig_media_daily`, `seo_daily`, `seo_query_daily`, `ga4_traffic_daily`, `site_checks`, `spend_limits` |
| `view_leads` | `crm_leads`, `crm_funnels`, `crm_origin_map` |
| `view_traffic` | `campaign_managed_by_history`, `ad_activity_log`, `traffic_strategies`, `claude_runs`, `traffic_actions`, `traffic_stops`, `traffic_stop_campaigns`, `platform_executions`, `traffic_log` |
| `view_connectors` | `connectors`, `connector_jobs`, `sync_runs`, `crm_upstream_runs`, `csv_imports` |
| o próprio ou `manage_users` | `profiles` |
| só o próprio | `notification_preferences`, `saved_filters` |
| `manage_users` | `invitations`, `audit_log` |
| perfil ativo | `role_permissions`, `holidays` |
| nenhuma | `notification_outbox`, `private.connector_credentials` |

A política `<tabela>_worker_read` (`for select to mkt_worker using (true)`) existe só nas tabelas da lista do worker, e
`<tabela>_executor_read` só nas do executor (seção "Privilégios por esquema"). Perfis, convites, preferências, meus
filtros, auditoria, fila de avisos e as tabelas de `private` não têm nenhuma das duas.

**Views.** Toda view de `api` nasce com `with (security_invoker = true, security_barrier = true)`: roda com os
direitos de quem chama, então a RLS das tabelas vale. Uma view sem `security_invoker` rodaria com os direitos do dono
e pularia a RLS; o teste de RLS confere a opção em todas (`pg_class.reloptions`).

**Colunas.** A RLS corta linhas, não colunas. O que nenhum papel deve ver não está no banco (dado pessoal de lead e
cliente) ou fica fora das views: o e-mail do usuário (só `api.list_users`, para quem gere usuários), o prompt e o
contexto do Claude (nenhuma view de `api` os devolve na v1: `api.v_traffic_actions` sai sem prompt), as credenciais
(só o estado).

## Funções de ação

Regras de todas:

- **Toda função dos sete esquemas** (`mkt`, `api`, `authz`, `ingest`, `notify`, `private` e `setup`; `security
  definer` ou `invoker`, `sql` ou `plpgsql`, também as de gatilho) tem `set search_path = pg_catalog, pg_temp`, com o
  `pg_temp` explícito e por último: sem o `pg_temp` no caminho, o esquema temporário da sessão é procurado primeiro
  para tipos e tabelas, e um serviço com conexão própria criaria lá um `uuid` ou um `text` com um `check` que roda
  como o dono da função (RLS-27). Nomes de fora do `pg_catalog` vão sempre qualificados (`mkt.traffic_actions`).
- **Toda função `security definer`, de qualquer esquema** (`api`, `authz`, `ingest`, `notify`, `private`, `setup` e as
  de gatilho), tem dono `postgres`, com `revoke execute … from public, anon` e `grant execute` só ao papel que a usa.
  As de `api` são executáveis só por `authenticated`; nenhuma pelo worker, pelo executor nem pelo n8n.
- A primeira linha confere `authz.can(...)`. Depois, a trava otimista: a tela manda o `updated_at` que leu; se mudou,
  nada é gravado e a tela diz "Outra pessoa alterou este registro" e recarrega (seção 9 do padrão). O `updated_at` é
  gravado em milissegundos, para o valor lido pela tela voltar igual (texto no Supabase, `Date` no PGlite).
- Erros com o código HTTP no `sqlstate` (o PostgREST devolve `PT403` como 403) e o código da tela na mensagem
  (`TRF-409`), sem texto técnico: `PT403` sem permissão · `PT404` não achou · `PT409` alterado por outra pessoa ·
  `PT422` não pode neste estado.
- O diário (`traffic_log`) e a auditoria (`audit_log`) são gravados na mesma transação, com `auth.uid()` como autor.
- **Usuários uma chamada por vez:** a primeira linha de `api.invite_user`, `api.revoke_invitation`, `api.change_role`
  e `api.revoke_access` é `perform pg_advisory_xact_lock(hashtext('mkt.manage_users'))`. Depois vêm a conferência da
  permissão e a contagem de donos. Duas chamadas ao mesmo tempo passam uma de cada vez, e a segunda vê o resultado da
  primeira (dois donos não tiram o acesso um do outro, e quem acabou de perder o papel não age mais).

| Função | Permissão | O que confere | O que grava | Trilha |
|---|---|---|---|---|
| `api.propose_action(brand, platform, campaign_id, kind, title, rationale, params, impact, effort, cost_cents, approve_now)` | `operate_traffic`; com `approve_now`, também `approve_action` | `private.validate_action` (a mesma do Claude): marca, conta e campanha existem e batem; `params` do tipo e da plataforma; sem dado pessoal; ajuste de orçamento só em campanha com orçamento próprio; `approve_now` sem permissão → `PT403` | ação `idea` com `proposed_by = auth.uid()`; `ad_account_id` = a conta da campanha, ou, sem campanha, a única conta ativa da marca no canal (ou já `approved`, como o "Pausar" e o "Ajustar" da tela de canal para o dono) | `action_proposed` (+ `action_approved`) |
| `api.approve_action(action_id, expected_updated_at)` | `approve_action` | status `idea` ou `failed`; não é `pending_fix`; trava otimista | `approved`, `approved_by`, `approved_at`; cria a execução em `queued` quando o tipo executa numa plataforma (na v1: `pause`, `budget`, `create`) | `action_approved` |
| `api.discard_action(action_id, reason, note, expected_updated_at)` | `approve_action` | status `idea`, `approved` ou `failed`; motivo da lista; nota de 10 letras; sem execução já enviada | `discarded`, `discarded_by`, `discarded_at`, motivo e nota; cancela execução `queued` ou `blocked` | `action_discarded` |
| `api.mark_action_done(action_id, result, expected_updated_at)` | `operate_traffic` | status `approved`, `failed` ou `running` com execução bloqueada, ou `pending_fix` em `idea`; resultado de 5 letras | `done`, `done_via = 'manual'`, `done_by`, `executed_at`, `result`; cancela execução `queued` ou `blocked`; **não** preenche o aprovador | `action_done` |
| `api.save_strategy(brand, month_on, body, budget_cents, metas…, expected_updated_at)` | `operate_traffic` | mês com dia 1; sem dado pessoal; trava otimista quando a linha já existe | `traffic_strategies` (insere ou atualiza) | `strategy_saved` com `{campo: {antes, depois}}` |
| `api.set_spend_limit(ad_account_id, monthly_limit_cents, expected_updated_at)` | `configure_traffic` | conta ativa; valor ≥ 0; trava otimista na linha de hoje | `spend_limits` com `valid_from_on` = hoje em São Paulo; na Meta com credencial de escrita, a execução `set_account_spend_cap` | `limit_changed` com antes e depois |
| `api.stop_all(brand, expected_count)` | `stop_all` | uma parada por vez (trava); as campanhas ativas do Claude da marca (nulo = as duas), em todos os canais, que ainda não estão numa parada aberta; a contagem é a que a tela mostrou (senão `PT409`) | `traffic_stops`, `traffic_stop_campaigns` e uma execução `pause` por campanha; bloqueia (`stopped`) as execuções na fila da marca que podem aumentar o gasto; o status da campanha só muda quando a plataforma confirmar | `stop_all` |
| `api.retry_execution(execution_id, expected_updated_at)` | `approve_action` | execução `blocked`; a ação que a gerou ainda `approved` ou `running` (na parada: a parada ainda aberta, para a pausa; no teto da conta: o limite ainda vigente) | volta para `queued`; o executor confere tudo de novo antes de mandar | `execution_retried` |
| `api.undo_stop(stop_id, expected_updated_at)` | `stop_all` | parada não desfeita; só as campanhas dela que a última leitura mostra pausadas e que não estão em outra parada aberta | `undone_by`, `undone_at`; uma execução `activate` por campanha (passa pelo limite do mês, como todo aumento de gasto) | `stop_undone` |
| `api.change_campaign_operator(campaign_id, to_operator, reason, note, expected_updated_at)` | `configure_traffic` | operador diferente do atual; motivo da lista (nota com `other`) | `campaigns.managed_by` (liga `mkt.allow_operator_change` na transação; o gatilho grava o histórico) | `operator_changed` |
| `api.retry_connector(connector_code)` | `retry_connector` | conector ligado; se já há pedido ou rodada em andamento, devolve a mesma | `sync_runs` com `status = 'requested'` e `run_trigger = 'manual_retry'` | `audit_log` `connector_retry_requested` |
| `api.set_connector_state(connector_code, state, expected_updated_at)` | `retry_connector` | `connected` só depois da primeira rodada boa (o worker liga); o dono só desliga e religa | `connectors.setup_state` | `audit_log` `connector_state_changed` |
| `api.confirm_mass_delete(run_id)` | `retry_connector` | a rodada terminou `partial` com `MASS_DELETE_BLOCKED` | marca a confirmação; a passada completa seguinte apaga ([`integracoes.md`](integracoes.md), seção 3.4) | `audit_log` `mass_delete_confirmed` |
| `api.upload_csv(connector_code, brand, file_name, content)` | `retry_connector` | conector de anúncio (`meta`, `tiktok`, `google_ads`); marca existe; até 5 MB; o cabeçalho do arquivo sem coluna de pessoa (a conferência linha a linha é do worker) | `csv_imports` e a rodada `requested` com `csv_upload` (decisão 0035) | `csv_imports.uploaded_by` e `sync_runs.requested_by` |
| `api.invite_user(email, display_name, role)` | `manage_users` | e-mail válido (minúsculas, sem espaço); nome de 2 a 80 letras; não tem perfil; sem convite aberto | `invitations` com o nome, o papel e validade de 7 dias; devolve o id e o e-mail para a Edge Function `convidar` | `audit_log` `invite_sent` (só `invitation_id` e o papel) |
| `api.revoke_invitation(invitation_id)` | `manage_users` | convite aberto | `revoked_at`, `revoked_by` | `audit_log` `invite_revoked` |
| `api.change_role(profile_id, role, expected_updated_at)` | `manage_users` | não é o próprio perfil; não tira o último dono ativo | `profiles.role` (liga `mkt.allow_role_change` na transação; o gatilho confere também quem chama); marca como `skipped` os avisos `pending` daquele perfil que o papel novo não pode receber | `audit_log` `role_changed` |
| `api.revoke_access(profile_id, reason, note, expected_updated_at)` | `manage_users` | não é o próprio perfil; não é o último dono ativo; motivo da lista (nota com `other`) | `is_active = false`, `deactivated_*`, `deactivation_reason` e a nota; apaga `whatsapp_digits`, as `notification_preferences` e os `saved_filters` da pessoa; marca como `skipped` os avisos `pending` dela. A RLS nega na hora; a Edge Function `tirar-acesso` bloqueia o login, derruba as sessões e troca o e-mail do login por `removido+<id>@invalid`. Para devolver o acesso, convide de novo: nascem um login e um perfil novos, e o antigo fica na trilha | `audit_log` `access_revoked` |
| `api.save_profile_preferences(theme, default_brand, default_view, whatsapp_digits)` | `edit_settings` | só o próprio perfil; WhatsApp `55` + DDD | `profiles` (só essas colunas) | — |
| `api.save_notification_preference(notice, email, whatsapp)` | `edit_settings` | aviso que o papel pode receber (a regra de `mkt.notice_default`) | `notification_preferences` | — |
| `api.save_filter(scope, name, filters)` · `api.delete_saved_filter(id)` | `edit_settings` | só os próprios; chaves de filtro válidas | `saved_filters` | — |

Funções de leitura com regra de acesso própria (`security definer`, conferem a permissão antes de ler):
`api.my_profile()` (o próprio perfil e o e-mail do login; responde também com o perfil inativo, para a tela dizer "Seu
acesso foi tirado"), `api.my_permissions()` (as ações do perfil ativo, de `role_permissions`, e quais pedem o segundo
fator, por `authz.requires_second_factor`), `api.list_role_permissions()` (perfil ativo: papel e ação, de
`role_permissions`, e se a ação pede o segundo fator, pela mesma função, para o quadro "Pode / Não pode" dos dois papéis
na tela de Usuários), `api.check_text(p_text)` (se o texto tem dado
pessoal, por `mkt.has_personal_data`: a tela avisa antes de enviar com a mesma regra do banco), `api.list_users()`
(`manage_users`: nome, e-mail e papel de todos),
`api.credential_status()` (`view_connectors`: conector, finalidade, estado e validade, nunca o segredo) e
`api.my_notification_preferences()` (as próprias, com o padrão quando não há linha).

`authz.display_name(profile_id)` (`security definer`, executável por `authenticated`, como `authz.can`) devolve só
o nome de quem fez um passo do tráfego, e só para quem tem `view_traffic`: o `traffic_manager` não lê o perfil dos
outros, mas o diário e a fila mostram "Aprovada por {nome}". As funções de KPI (`api.kpi_*`, `api.list_customers`,
`api.list_leads`, `api.list_traffic_actions`, `api.list_traffic_log`, `api.preview_action`) são `security invoker`:
conferem a permissão na primeira linha e leem as views base com a RLS de quem chama ([`metricas.md`](metricas.md),
decisão 0034).

**Edge Functions `convidar` e `tirar-acesso`.** Verificação do JWT ligada. Com o JWT de quem chamou, elas chamam
primeiro a função do banco (`api.invite_user` ou `api.revoke_access`). Só se ela der certo usam a `service_role`, com o
id e o e-mail que o banco devolveu, nunca os do corpo do pedido. CORS só com o endereço do sistema. O log leva só o
código do resultado, nunca e-mail ou id.

### Gatilhos que conferem quem pede

`auth.uid()` vem de `request.jwt.claims`, que qualquer sessão SQL direta (worker, executor, n8n) consegue definir.
Por isso os gatilhos que protegem aprovação, papel e operador conferem também o `session_user`, que a sessão não troca:

- `traffic_actions_transition`: → `approved` (também na inserção com `approve_now`) e → `discarded` só com
  `session_user = 'authenticator'` (a API), `authz.can('approve_action')` e `approved_by` (ou `discarded_by`) =
  `auth.uid()`. → `done` com `done_via = 'manual'` só pela API e com `done_by = auth.uid()`. `approved` →
  `running | done | failed` e `running` → `done | failed` só com `session_user = 'mkt_executor'` (`done` com
  `done_via = 'platform_api'`). Inserção pelo `mkt_worker` só em `idea`, com `proposed_by_kind = 'claude'`.
- `profiles_guard` e `campaigns_managed_by_guard`: além da chave da transação (`mkt.allow_role_change`,
  `mkt.allow_operator_change`), `session_user = 'authenticator'` e a permissão (`manage_users`, `configure_traffic`).
  O `profiles_guard` conta os donos ativos depois de `select … for update` neles. O `campaigns_managed_by_guard` tem
  uma exceção, só com `session_user = 'mkt_executor'`: a campanha que a leitura importou do humano antes de a criação
  ser confirmada passa para o Claude na transação que confirma, com a ação `create` da mesma conta cuja execução essa
  transação confirmou, sem mudar a conta nem o nome no mesmo `update`, o código dela no fim do nome, nenhuma troca de
  operador anterior por uma pessoa e importada depois da primeira execução de criar da ação: a campanha que já
  existia, mesmo renomeada com o código, continua do humano (o `created_at` só o dono do banco grava;
  [`tabelas.md`](tabelas.md), `campaigns`).
- `platform_executions_guard`: `insert` só pela API (dentro das funções de ação) ou por
  `private.queue_monthly_spend_caps`, que só o `pg_cron` chama; `request`, `operation`, `idempotency_key`,
  `traffic_action_id`, `traffic_stop_campaign_id`, `spend_limit_id`, `campaign_id` e `ad_account_id` nunca mudam; o
  status só passa por `queued` → `blocked | sent | confirmed | cancelled` (`confirmed` direto quando a releitura antes
  de mandar já mostra o pedido feito), `blocked` → `queued | cancelled` e `sent` → `sent | confirmed | failed`.

### Exemplo: aprovar

```sql
create or replace function api.approve_action(p_action_id uuid, p_expected_updated_at timestamptz)
returns mkt.traffic_actions
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v mkt.traffic_actions;
begin
  if not authz.can('approve_action') then
    raise sqlstate 'PT403' using message = 'TRF-403';
  end if;

  select * into v from mkt.traffic_actions where id = p_action_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'TRF-404';
  end if;
  if v.updated_at is distinct from p_expected_updated_at then
    raise sqlstate 'PT409' using message = 'TRF-409';
  end if;
  if v.status not in ('idea', 'failed') or v.kind = 'pending_fix' then
    raise sqlstate 'PT422' using message = 'TRF-422';
  end if;

  update mkt.traffic_actions
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_action_id
  returning * into v;                      -- o gatilho traffic_actions_log grava "action_approved"

  perform private.queue_execution(v.id);   -- execução em "queued" quando o tipo executa numa plataforma
  return v;
end $$;

revoke execute on function api.approve_action(uuid, timestamptz) from public, anon;
grant execute on function api.approve_action(uuid, timestamptz) to authenticated;
```

### Exemplo: parar tudo

```sql
create or replace function api.stop_all(p_brand mkt.brand_code, p_expected_count integer)
returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_stop uuid;
  v_brand uuid := (select id from mkt.brands where code = p_brand);   -- nulo = as duas marcas
  v_count integer;
begin
  if not authz.can('stop_all') then
    raise sqlstate 'PT403' using message = 'STP-403';
  end if;
  -- Uma parada por vez: a segunda chamada espera a primeira e vê o que ela gravou.
  perform pg_advisory_xact_lock(hashtext('mkt.stop_all'));

  -- As ativas do Claude que ainda não estão numa parada aberta (a pausa delas já foi pedida).
  select count(*) into v_count
    from mkt.campaigns c
   where c.managed_by = 'claude' and c.status = 'active'
     and (v_brand is null or c.brand_id = v_brand)
     and not exists (select 1 from mkt.traffic_stop_campaigns sc
                       join mkt.traffic_stops s on s.id = sc.traffic_stop_id
                      where sc.campaign_id = c.id and s.undone_at is null);
  if v_count = 0 then
    raise sqlstate 'PT422' using message = 'STP-422';
  end if;
  if v_count <> p_expected_count then
    raise sqlstate 'PT409' using message = 'STP-409';  -- a tela mostrava outro número: recarrega e confirma de novo
  end if;

  insert into mkt.traffic_stops (brand_id, scope, requested_by)
  values (v_brand, 'claude_only', auth.uid())
  returning id into v_stop;

  insert into mkt.traffic_stop_campaigns (traffic_stop_id, campaign_id, brand_id, status_before)
  select v_stop, c.id, c.brand_id, c.status
    from mkt.campaigns c
   where c.managed_by = 'claude' and c.status = 'active'
     and (v_brand is null or c.brand_id = v_brand)
     and not exists (select 1 from mkt.traffic_stop_campaigns sc
                       join mkt.traffic_stops s on s.id = sc.traffic_stop_id
                      where sc.campaign_id = c.id and s.undone_at is null and s.id <> v_stop);

  -- Nada que aumente o gasto sai da fila depois da parada.
  update mkt.platform_executions e
     set status = 'blocked', blocked_reason = 'stopped'
   where e.status = 'queued'
     and mkt.execution_may_increase_spend(e.id)
     and (v_brand is null or e.brand_id = v_brand);

  perform private.queue_stop_executions(v_stop, 'pause');  -- uma execução por campanha
  insert into mkt.traffic_log (event, brand_id, actor_kind, actor_id, traffic_stop_id)
  values ('stop_all', v_brand, 'user', auth.uid(), v_stop);
  return v_stop;
end $$;
```

O botão de emergência nunca é recusado por já haver uma parada: a segunda parada pega só as campanhas que a primeira
não pegou. "Desfazer" uma parada nunca reativa campanha que está em outra parada aberta. Enquanto houver parada aberta
na marca, o executor bloqueia (`stopped`) toda operação que pode aumentar o gasto ([`integracoes.md`](integracoes.md),
seção 14).

Sem credencial de escrita (o começo da v1), o executor marca cada execução como `blocked` (`no_write_credential`) e a
tela diz "Pause no gerenciador de cada plataforma", com a lista: a parada fica registrada e ninguém acha que a
plataforma parou sem ter parado. Se a pausa ficar em `queued` por mais de 2 min (executor fora do ar), a tela mostra a
mesma lista e sai o aviso urgente "Parar tudo sem confirmação" (decisão 0022).

### O que o worker, o executor, o n8n e os scripts chamam

| Função | Quem | O que faz |
|---|---|---|
| `ingest.upsert_*` (uma por tabela de fora) | `mkt_worker` | Insere ou atualiza pela chave natural; converte nada (já chega convertido); aplica a regra CSV × API; trata o texto que vem do CRM ([`tabelas.md`](tabelas.md), seção 2) |
| `ingest.replace_day(…)` | `mkt_worker` | Releitura: grava as linhas lidas e apaga as do mesmo dia e da mesma conta, perfil ou propriedade que não vieram, numa transação ([`integracoes.md`](integracoes.md), seção 2.3) |
| `ingest.delete_missing(p_table, p_run_id)` | `mkt_worker` | `p_table` só da lista fixa (`crm_funnels`, `crm_customers`, `crm_customer_brands`, `crm_customer_reps`, `crm_leads`, `crm_orders`, `sales_reps`, `sales_rep_app_logins`; `crm_upstream_runs` fica fora: a leitura traz só as últimas rodadas de cada marca, e o `pg_cron` apaga o que passou de 90 dias), montada com `format('delete from mkt.%I …', p_table)`. O corte é o `started_at` da rodada `p_run_id`, que precisa ser `crm_full_pass` em `running`. A função conta antes de apagar; acima de 20% da tabela, não apaga nada e devolve `MASS_DELETE_BLOCKED`, a menos que o dono tenha confirmado a rodada anterior (`api.confirm_mass_delete`). Em `crm_customer_brands`, o par que tem a compra do ERP mais antiga já vista não sai: perde só o retrato, e a data fica (decisão 0042; sai com o cliente, pela cascata); ali a trava conta só o que a chamada muda |
| `ingest.start_run`, `ingest.finish_run`, `ingest.take_requested_run` | `mkt_worker` | Abre, fecha e pega pedidos de rodada em `sync_runs`; `finish_run` atualiza `connectors` e `connector_jobs` |
| `mkt.claude_context(brand_id)` | `mkt_worker` | Devolve o contexto da rodada do Claude ([`integracoes.md`](integracoes.md), seção 15): só agregados, com as chaves que `mkt.valid_claude_context` aceita. Não grava nada. É `security invoker`: as views `mkt.v_*` que ela lê entram no `grant select` do `mkt_worker`, na migração que as cria |
| `ingest.record_claude_run`, `ingest.add_claude_proposal` | `mkt_worker` | Grava a rodada (upsert pelo id que o worker cria antes de chamar a API) e as propostas, por `(claude_run_id, claude_item)`: repetir não duplica. Cada proposta passa por `private.validate_action`, a mesma de `api.propose_action`, e nasce `idea` |
| `ingest.next_execution`, `ingest.update_execution`, `ingest.set_action_progress` | `mkt_executor` | Pega a próxima execução, confere `mkt.execution_allowed` (aprovação, credencial, limite, parada, campanha), anda com o status, com a ação e com a campanha relida. A conferência roda com os direitos da função, que lê perfis e o estado das credenciais; o executor não lê essas tabelas |
| `private.read_credential(id)` | `mkt_worker` (só leitura) | Lê o segredo no Vault; recusa a finalidade de escrita e qualquer `session_user` que não seja `mkt_worker` |
| `private.rotate_credential(id, secret, expires_at)` | `mkt_worker` | Troca o segredo no Vault. O worker manda o segredo só como parâmetro ligado no servidor (psycopg 3), nunca no texto do SQL; a função não repete o segredo em mensagem de erro |
| `notify.claim_pending(limit)` | `n8n_notifier` | Devolve os avisos vencidos com o endereço de entrega (e-mail do login ou WhatsApp do perfil) e marca a tentativa. Só devolve aviso de perfil ativo, cujo papel ainda tem a permissão do aviso e cuja preferência ainda liga o canal; os outros viram `skipped` na mesma chamada. O que não é urgente e cai no mesmo horário vai num resumo por pessoa e canal |
| `notify.mark_sent(id)`, `notify.mark_failed(id, error_code)` | `n8n_notifier` | Fecha o aviso (e todas as linhas do resumo) |
| `setup.register_ad_account`, `setup.register_ig_account`, `setup.register_web_property`, `setup.create_first_owner_invitation` | `mkt_setup` | Cadastro feito pelos scripts com `--executar` ([`plano.md`](plano.md), seção "Seed"): a conta, o perfil ou a propriedade com a marca |
| `setup.mark_lead_funnel(external_id)` | `mkt_setup` | Marca uma vez, pelo id do funil no CRM, o funil antigo dos leads do site como funil de leads (decisão 0041, item 1), para o histórico encerrado entrar na passada completa seguinte. Confere o `session_user` (o dono do banco recebe `SET-403`). Recusa o funil que a réplica ainda não leu (`SET-404`: rodar depois da primeira passada completa) e o funil padrão, que já é de leads pela regra (`SET-422`). Rodar de novo não muda nada; a leitura dos funis não tira a marca. Quando e com que id: [`plano.md`](plano.md), seção "Seed" |
| `setup.register_credential(connector_code, purpose, account_ref, secret, expires_at)` | `mkt_setup` | Cria o segredo no Vault e a linha de `private.connector_credentials`, com o segredo como parâmetro ligado, nunca no texto do SQL. A credencial de escrita, que fica só nas variáveis do executor, ganha só a linha de estado, sem segredo, quando a plataforma aprova a escrita |

## Teste de RLS (portão da fase 3)

O portão pede: um usuário de cada papel (`owner`, `traffic_manager`) e sem login (`anon`), tentando ler, inserir,
alterar, apagar e chamar função, e sendo negado no que não devia. Sem Supabase CLI nem Docker nesta máquina, o teste
fica em duas camadas.

### Camada 1 — PGlite no `pnpm verify` (todo PR, sem internet)

- Pacote de teste novo (`supabase/tests`, Vitest) com o PGlite, o Postgres que roda em WebAssembly (decisão 0018).
- Antes das migrações, um arquivo de apoio (`supabase/tests/supabase-shim.sql`) cria o que o Supabase traz pronto:
  os papéis `anon`, `authenticated`, `service_role`, `authenticator` (membro de `anon` e `authenticated`),
  `mkt_worker`, `mkt_executor`, `mkt_setup` e `n8n_notifier`; o esquema `auth` com `auth.users`, `auth.uid()` e
  `auth.jwt()` lendo `request.jwt.claims`, como o Supabase faz; os esquemas `cron` e `vault` com `cron.schedule`,
  `cron.unschedule`, `vault.create_secret` e a view `vault.decrypted_secrets`, para as migrações rodarem iguais; e a
  tabela `test.clock`, que fixa o relógio dos testes (`mkt.now()`, [`metricas.md`](metricas.md), seção 2.1), com `usage`
  no esquema `test` e `select` em `test.clock` para `authenticated`, `mkt_worker` e `mkt_executor` (`mkt.now()` roda
  com os direitos de quem chama). Depois roda **as mesmas migrações** de `supabase/migrations/`.
- Cada caso abre uma transação, entra como o papel e o usuário, tenta, confere e desfaz. Caso de quem usa a API entra
  com `set session authorization authenticator` antes do `set role`, para o `session_user` ser o da API; caso de
  serviço entra com `set session authorization mkt_worker` (ou o papel do serviço):

```sql
begin;
set session authorization authenticator;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "<id do gestor de teste>", "role": "authenticated", "aal": "aal1"}', true);
select api.approve_action('<id da ação>', '<updated_at lido>');   -- esperado: erro PT403 / TRF-403
rollback;
```

- **Prova:** políticas, `grant`s, as conferências de cada função, os `check`, os gatilhos (só-acréscimo, papel
  protegido, operador protegido, transições da ação, execução protegida), `security_invoker` em toda view, o catálogo
  (RLS-27, também o caminho de busca: um `domain` com nome de tipo do catálogo no `pg_temp` de cada serviço não roda
  como o dono em nenhuma função `security definer` que o serviço executa) e a paridade dos `domain` com o
  `labels.ts`.
- **Não prova:** a configuração do projeto Supabase (esquemas expostos, GraphQL desligado, cadastro aberto desligado,
  `grant`s que o Supabase cria sozinho), o login de verdade e o token, as Edge Functions, a conexão do worker, do
  executor e do n8n.
- Conferir na fase 4, com um caso-sentinela, que o PGlite aplica RLS depois de `set role`; se não aplicar, esta camada
  fica com funções, restrições e gatilhos, e a RLS inteira passa para a camada 2.

### Camada 2 — pela API, num projeto Supabase de teste (o portão)

- Projeto separado do de produção, com as mesmas migrações aplicadas pelo CI (veja [`plano.md`](plano.md)).
- Script `scripts/testar-rls.mjs` (Node ESM): só cria os usuários de teste com `--executar`; gera as senhas na hora,
  nunca as imprime; cadastra o TOTP do dono de teste e entra com o segundo fator; entra como cada um pela API do
  Supabase (a mesma que o front usa); roda os casos; imprime só o código do caso e se passou; apaga os usuários de teste
  no fim. Só roda no projeto de teste.
- **Prova:** o sistema publicado, de ponta a ponta: a API nega sem login, cada papel lê e grava só o que a matriz
  diz, o que não está exposto não responde, as Edge Functions recusam quem não pode e o cadastro aberto está desligado.
- Em produção, só o caso `anon` (não precisa de usuário): uma chamada sem login a cada esquema e função tem de voltar
  negada.

### Casos (os mesmos nas duas camadas, menos onde a linha diz)

| # | Quem | Tenta | Esperado |
|---|---|---|---|
| RLS-01 | `anon` | ler `api.v_traffic_actions` e `api.v_traffic_log`; chamar `api.list_users`, `api.my_profile` e `api.credential_status` (na fase 4, também as `api.kpi_*`) | negado (sem `usage` no esquema) |
| RLS-02 | `anon` | chamar `api.approve_action`, `api.stop_all`, `api.invite_user` | negado |
| RLS-03 | `anon` | ler `mkt.crm_leads` pela API | negado (esquema não exposto) |
| RLS-04 | `anon` e qualquer um logado | `insert`, `update` ou `delete` direto em qualquer tabela de `mkt` | negado (sem `grant`) |
| RLS-05 | `traffic_manager` | ler `api.v_traffic_actions` e `api.v_traffic_log`; chamar `api.credential_status` (na fase 4, números e leads pelas `api.kpi_*`) | **permitido** (controle positivo) |
| RLS-06 | `traffic_manager` | `approve_action`, `discard_action`, `retry_execution`, `propose_action` com `approve_now` | `PT403` |
| RLS-07 | `traffic_manager` | `stop_all`, `undo_stop`, `set_spend_limit`, `change_campaign_operator` | `PT403` |
| RLS-08 | `traffic_manager` | `invite_user`, `change_role` (inclusive o próprio), `revoke_access`, `list_users` | `PT403` |
| RLS-09 | `traffic_manager` | chamar `api.list_users`; ler `invitations`, `audit_log` e perfis dos outros (só na camada 1, porque não há view exposta) | `PT403`; zero linhas |
| RLS-10 | `traffic_manager` | `retry_connector`, `set_connector_state`, `confirm_mass_delete` | `PT403` |
| RLS-11 | `traffic_manager` | `propose_action` com e-mail ou telefone no "por quê" | recusado pelo `check` |
| RLS-12 | `traffic_manager` | `mark_action_done` numa ideia que não é pendência | `PT422` |
| RLS-13 | `traffic_manager` | ler ou apagar os "Meus filtros" e as preferências do dono | zero linhas / nada apagado |
| RLS-14 | `owner` | `change_role` e `revoke_access` no próprio perfil; tirar o último dono | `PT422` |
| RLS-15 | `owner` | aprovar com `updated_at` antigo; controle: aprovar com o `updated_at` lido, passado por `Date` | `PT409`, nada gravado; o controle é aceito |
| RLS-16 | `owner` | aprovar pendência de medição; descartar sem motivo | `PT422` / recusado pelo `check` |
| RLS-17 | `owner` | alterar ou apagar linha de `traffic_log`, `audit_log` ou `campaign_managed_by_history` | negado (sem `grant` e gatilho de só-acréscimo) |
| RLS-18 | `owner`; e como `authenticated` com `set role`, na camada 1 | ler `private.connector_credentials`, chamar `private.read_credential`; ler `vault.decrypted_secrets` (`anon`, `authenticated`, `mkt_worker` e `n8n_notifier`) | negado |
| RLS-19 | `owner` | ler `mkt.notification_outbox` | negado (sem `grant`; e a RLS não tem política para `authenticated`) |
| RLS-20 | usuário com acesso tirado (token ainda válido) | ler qualquer view e chamar qualquer função | zero linhas / `PT403`; a exceção é `api.my_profile()`, que devolve só o próprio perfil, com `is_active = false` |
| RLS-21 | logado sem perfil (sem convite) | o mesmo de RLS-20 | zero linhas / `PT403` |
| RLS-22 | `mkt_worker` | chamar `api.approve_action`; alterar `traffic_actions` direto; mudar `campaigns.managed_by` | negado |
| RLS-23 | `n8n_notifier` | ler qualquer tabela de `mkt` | negado |
| RLS-24 | qualquer view de `api` e de `mkt` | conferir `security_invoker = true` | todas |
| RLS-25 | cada `domain` × `labels.ts` | comparar | iguais |
| RLS-26 | `traffic_manager` | `upload_csv`; ler `csv_imports` | `PT403`; leitura permitida (controle positivo) |
| RLS-27 | catálogo (camada 1); e cada serviço que executa função `security definer` (`mkt_worker`, `mkt_executor`, `mkt_setup`; o `n8n_notifier` quando houver `notify.*`) | toda tabela de `mkt` e `private` com `relrowsecurity`; toda função dos sete esquemas com `search_path=pg_catalog, pg_temp` em `proconfig`; `has_function_privilege` de `anon`, `authenticated`, `mkt_worker`, `mkt_executor`, `mkt_setup` e `n8n_notifier` em cada função de `mkt`, `api`, `authz`, `ingest`, `notify`, `private` e `setup` igual à lista permitida do teste; nenhuma sequência com privilégio para `anon` ou `authenticated`; nenhum papel de serviço com `bypassrls`; como cada serviço, criar no `pg_temp` um `domain` com o nome de cada tipo do catálogo que as funções usam sem esquema (`uuid`, `text`, `jsonb`, `date`, `timestamptz` e `regproc`), com um `check` que anota quem roda, e chamar cada função `security definer` que ele executa | tudo bate; o `check` nunca roda como o dono das funções |
| RLS-28 | `traffic_manager`, `owner`, `n8n_notifier` | chamar `private.read_credential`, `private.rotate_credential` e `private.queue_execution`; ler `vault.decrypted_secrets` | negado |
| RLS-29 | cada papel | `POST`, `PATCH` e `DELETE` em cada view de `api` | negado |
| RLS-30 | `mkt_worker` | ler `profiles`, `invitations`, `notification_preferences`, `saved_filters` e `audit_log`; com `request.jwt.claims` do dono, aprovar ou descartar por cada `ingest.*`; levar uma ação de `idea` a `approved`; `ingest.delete_missing` fora da lista da réplica; chamar `ingest.next_execution`; ler credencial de escrita | negado, nada muda |
| RLS-31 | `traffic_manager`, logado sem perfil, `anon` (camada 2) | chamar as Edge Functions `convidar` e `tirar-acesso` | 401 ou 403, nada muda no Auth |
| RLS-32 | login criado sem convite, com convite vencido ou revogado; `signUp` pela API do projeto (camada 2) | entrar | sem perfil; o `signUp` é recusado (prova que o cadastro aberto está desligado) |
| RLS-33 | aviso pendente de quem perdeu o acesso ou o papel | `notify.claim_pending` | o aviso não sai (vira `skipped`) |
| RLS-34 | `mkt_executor` | chamar `ingest.upsert_*`, `ingest.add_claude_proposal`, `api.*` e `private.read_credential` (de qualquer finalidade); ler `crm_leads` | negado |
| RLS-35 | `owner` sem o segundo fator (`aal1`) | `approve_action`, `set_spend_limit`, `invite_user`, `retry_connector`; controle: `stop_all` | `PT403`; o controle é aceito |

Os casos 22, 23, 28 (a parte do `n8n_notifier`), 30 e 34 rodam na camada 1 e na conexão de teste de cada serviço; o 27
só na camada 1; o 31 e a parte de `signUp` do 32, só na camada 2; os outros, nas duas. No portão da fase 3 rodam os
casos sobre o que existe até ali (migrações 01 a 10 e as views de `api` adiantadas, [`plano.md`](plano.md)); RLS-01,
05, 20, 21 e 24 voltam inteiros na fase 4, com a migração 12. O portão fecha quando a camada 2 passar inteira no projeto
de teste, e o resultado (data, casos, quem rodou) vai para o `ESTADO.md`.

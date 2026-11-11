-- Migração 11, adiantada · as views de api do Tráfego (docs/dados/plano.md, "Ordem das migrações": a parte da 11 que
--   entra no portão da fase 3; o resto das views, as de KPI, fica para a fase 4)
--
-- O que faz: cria a lista de saída mkt.action_alert (metricas.md, seção 8) e a função de mesmo nome, o alerta de cada
--   ação da fila (metricas.md, seção 4.6: campanha encerrada, já pausada, só vale com a campanha ativa, a plataforma
--   recusou, conta sem limite, passa do limite do mês); e as duas views que a API expõe: api.v_traffic_actions (cada
--   ação com a marca, a conta, a campanha, o alerta, a última execução e só o nome de quem propôs, aprovou, descartou
--   ou marcou como feita; nunca o prompt nem o contexto do Claude) e api.v_traffic_log (o diário, com só o nome de
--   quem fez). As duas com security_invoker e security_barrier: rodam com os direitos de quem lê, e a RLS das tabelas
--   vale (view_traffic; a campanha e a conta, view_numbers). Só authenticated lê, e só lê.
-- Risco: baixo. Só cria uma lista, uma função e duas views; nada grava. Uma view sem security_invoker pularia a RLS: o
--   teste de RLS confere a opção em todas (RLS-24).
-- Como reverter (só no projeto de teste, antes de produção):
--   drop view api.v_traffic_log, api.v_traffic_actions;
--   drop function mkt.action_alert(uuid);
--   drop domain mkt.action_alert;
-- Conferir (as opções de cada view de api e de mkt; e quem lê as de api):
--   select c.oid::regclass, c.reloptions, has_table_privilege('authenticated', c.oid, 'select') as tela,
--          has_table_privilege('anon', c.oid, 'select') as anon
--     from pg_class c where c.relnamespace in ('api'::regnamespace, 'mkt'::regnamespace) and c.relkind = 'v';

-- ---------- O alerta de cada ação (metricas.md, seções 4.6 e 8) ----------

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'mkt' and t.typname = 'action_alert') then
    create domain mkt.action_alert as text check (value in ('campaign_ended', 'already_paused', 'waits_campaign_active',
                                                            'platform_refused', 'no_spend_limit',
                                                            'exceeds_month_limit'));
  end if;
end $$;

-- Nesta ordem: feita ou descartada → nenhum; campanha encerrada; pausa de campanha pausada; orçamento, lance ou
-- criativo em campanha pausada (só vale quando ela voltar); falhou (a plataforma recusou; o código fica na execução);
-- e, só no que aumenta o gasto e com a conta da ação: conta sem limite vigente; passa do limite do mês, ou sem base
-- para a conta (a mesma conta da trava da execução, mkt.action_exceeds_limit). Ação sem canal não tem alerta de limite.
create or replace function mkt.action_alert(p_action_id uuid) returns mkt.action_alert
language sql stable set search_path = '' as $$
  select (case
    when a.status in ('done', 'discarded') then null
    when c.status = 'ended' then 'campaign_ended'
    when a.kind = 'pause' and c.status = 'paused' then 'already_paused'
    when a.kind in ('budget', 'bid', 'creative') and c.status = 'paused' then 'waits_campaign_active'
    when a.status = 'failed' then 'platform_refused'
    when a.ad_account_id is null or not x.increases then null
    when m.ad_account_id is null or m.monthly_limit_cents is null then 'no_spend_limit'
    when coalesce(mkt.action_exceeds_limit(a.id), true) then 'exceeds_month_limit'
  end)::mkt.action_alert
    from mkt.traffic_actions a
    left join mkt.campaigns c on c.id = a.campaign_id
    left join mkt.v_account_month m on m.ad_account_id = a.ad_account_id
   cross join lateral (
     select case a.kind
              when 'create' then true
              when 'budget' then coalesce((a.params ->> 'daily_budget_cents')::bigint > c.daily_budget_cents, true)
              when 'bid' then coalesce(a.cost_cents > 0, true)
              when 'creative' then coalesce(a.cost_cents > 0, true)
              else false
            end as increases) x
   where a.id = p_action_id
$$;

grant execute on function mkt.action_alert(uuid) to authenticated, mkt_worker, mkt_executor;

-- ---------- As views da API (só leitura; a RLS das tabelas decide as linhas) ----------

-- Cada ação de tráfego, sem prompt nem contexto do Claude: a marca, a conta, a campanha, o alerta da fila, a última
-- execução (com o updated_at dela, para o "Tentar de novo") e só o nome de cada pessoa da trilha.
create or replace view api.v_traffic_actions with (security_invoker = true, security_barrier = true) as
select a.id, a.code, b.code as brand, a.platform, a.kind, a.status, a.title, a.rationale, a.params, a.impact, a.effort,
       a.cost_cents, a.ad_account_id, acc.name as account_name, a.campaign_id, c.name as campaign_name,
       c.status as campaign_status, c.managed_by as campaign_operator,
       c.daily_budget_cents as campaign_daily_budget_cents, a.proposed_by_kind,
       authz.display_name(a.proposed_by) as proposed_by_name, a.claude_run_id, a.approved_at,
       authz.display_name(a.approved_by) as approved_by_name, a.discarded_at,
       authz.display_name(a.discarded_by) as discarded_by_name, a.discard_reason, a.discard_note, a.done_via,
       a.executed_at, authz.display_name(a.done_by) as done_by_name, a.result, mkt.action_alert(a.id) as alert,
       e.id as execution_id, e.operation as execution_operation, e.status as execution_status,
       e.blocked_reason as execution_blocked_reason, e.error_code as execution_error_code,
       e.http_status as execution_http_status, e.attempts as execution_attempts,
       e.updated_at as execution_updated_at, a.created_at, a.updated_at
  from mkt.traffic_actions a
  left join mkt.brands b on b.id = a.brand_id
  left join mkt.ad_accounts acc on acc.id = a.ad_account_id
  left join mkt.campaigns c on c.id = a.campaign_id
  left join lateral (
    select x.id, x.operation, x.status, x.blocked_reason, x.error_code, x.http_status, x.attempts, x.updated_at
      from mkt.platform_executions x
     where x.traffic_action_id = a.id
     order by x.created_at desc, x.id desc
     limit 1) e on true;

-- O diário de tráfego, com só o nome de quem fez (authz.display_name) e o código da ação e o nome da campanha de que o
-- evento fala. A ordem da página é (occurred_at desc, seq desc).
create or replace view api.v_traffic_log with (security_invoker = true, security_barrier = true) as
select l.id, l.seq, l.occurred_at, l.event, b.code as brand, l.platform, l.actor_kind,
       authz.display_name(l.actor_id) as actor_name, l.traffic_action_id, a.code as action_code, l.campaign_id,
       c.name as campaign_name, l.traffic_stop_id, l.spend_limit_id, l.traffic_strategy_id, l.platform_execution_id,
       l.changes
  from mkt.traffic_log l
  left join mkt.brands b on b.id = l.brand_id
  left join mkt.traffic_actions a on a.id = l.traffic_action_id
  left join mkt.campaigns c on c.id = l.campaign_id;

-- Em api não há privilégio padrão: só authenticated lê, e nada grava pela view (RLS-29).
revoke all on api.v_traffic_actions, api.v_traffic_log from public, anon, authenticated;
grant select on api.v_traffic_actions, api.v_traffic_log to authenticated;

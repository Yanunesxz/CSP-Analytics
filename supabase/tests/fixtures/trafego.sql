-- Dados inventados de tráfego para os testes da migração 07: pelo menos uma linha em cada tabela dela. Depende de
-- fixtures/usuarios.sql (o dono e o gestor) e de fixtures/marketing.sql (contas e campanhas). Os ids são os de
-- tests/apoio/trafego.ts; nada é dado real.
--
--   rodada do Claude ...301 (cs): a ideia ...331 (mais orçamento na campanha do Claude, item 1) e o ajuste de lance
--     ...334 (item 2), descartado pelo dono
--   estratégia ...311 (cs, mês corrente) e o limite ...321 da conta Meta da cs
--   pausa ...332 da campanha do humano, proposta e aprovada pelo dono, com a execução ...351 bloqueada
--   pendência de medição ...333 (GA4), registrada pelo gestor, sem canal
--   parada ...341 (cs, aberta) com a campanha do Claude ...342 e a execução ...352, confirmada
--   teto da conta ...353 (set_account_spend_cap), bloqueado
--
-- As linhas entram já no estado de cada uma, gravadas pelo dono do banco com os gatilhos de passagem da ação e de
-- execução protegida desligados só durante a carga (os testes provam os dois pelo caminho de verdade). Cada mudança
-- de status é um update, para o diário sair dos gatilhos como sairia em produção.
--
-- Só no PGlite: o "supabase test db" roda todo .sql desta pasta.
begin;
do $$
begin
  if version() not like '%PGlite%' then
    raise exception 'fixtures/trafego.sql é só para o PGlite (testes)';
  end if;
end $$;

alter table mkt.traffic_actions disable trigger traffic_actions_transition;
alter table mkt.platform_executions disable trigger platform_executions_guard;

-- ---------- Rodada do Claude, estratégia e limite ----------

insert into mkt.claude_runs (id, brand_id, status, model, prompt_version, prompt, context, output, input_tokens,
                             output_tokens, started_at, finished_at)
select '00000000-0000-4000-8000-000000000301', b.id, 'succeeded', 'modelo-de-teste', 'teste-1',
       'Analise os números do mês e proponha ações dentro do limite e da estratégia.',
       '{"brand": "cs", "generated_at": "2026-11-03T10:30:00Z", "today_on": "2026-11-03",
         "current_month": {"from_on": "2026-11-01", "to_on": "2026-11-03",
                           "totals": {"spend_cents": 150000, "leads": 40, "new_customers": 6},
                           "campaigns": [{"campaign_id": "00000000-0000-4000-8000-000000000212", "platform": "meta",
                                          "name": "cs-remarketing-act-0001", "status": "active",
                                          "operator": "claude", "daily_budget_cents": 3000}]},
         "strategy": {"month_on": "2026-11-01", "body": "Foco em lojistas do Sul.",
                      "target_cost_per_lead_cents": 4000}}',
       '{"proposals": 2}', 1200, 300, now() - interval '1 day', now() - interval '1 day' + interval '40 seconds'
  from mkt.brands b where b.code = 'cs';

insert into mkt.traffic_strategies (id, brand_id, month_on, body, budget_cents, target_cost_per_new_customer_cents,
                                    target_cost_per_lead_cents, target_new_customers, updated_by)
select '00000000-0000-4000-8000-000000000311', b.id, date_trunc('month', current_date)::date,
       'Foco em lojistas do Sul. Manter o custo por cliente novo abaixo de R$ 300.', 1500000, 30000, 4000, 50,
       '00000000-0000-4000-8000-0000000000d1'
  from mkt.brands b where b.code = 'cs';

insert into mkt.spend_limits (id, ad_account_id, brand_id, platform, monthly_limit_cents, valid_from_on, set_by)
select '00000000-0000-4000-8000-000000000321', a.id, a.brand_id, a.platform, 1500000,
       date_trunc('month', current_date)::date, '00000000-0000-4000-8000-0000000000d1'
  from mkt.ad_accounts a where a.id = '00000000-0000-4000-8000-000000000201';

-- ---------- Ações ----------

-- As duas propostas do Claude da rodada.
insert into mkt.traffic_actions (id, brand_id, platform, ad_account_id, campaign_id, kind, title, rationale, params,
                                 impact, effort, cost_cents, proposed_by_kind, claude_run_id, claude_item)
select '00000000-0000-4000-8000-000000000331', c.brand_id, c.platform, c.ad_account_id, c.id, 'budget',
       'Aumentar o orçamento do remarketing', 'O custo por lead do remarketing está 30% abaixo da meta do mês.',
       '{"daily_budget_cents": 4500, "previous_daily_budget_cents": 3000}', 'high', 'low', 45000, 'claude',
       '00000000-0000-4000-8000-000000000301', 1
  from mkt.campaigns c where c.id = '00000000-0000-4000-8000-000000000212';
insert into mkt.traffic_actions (id, brand_id, platform, ad_account_id, campaign_id, kind, title, rationale, params,
                                 impact, effort, cost_cents, proposed_by_kind, claude_run_id, claude_item)
select '00000000-0000-4000-8000-000000000334', c.brand_id, c.platform, c.ad_account_id, c.id, 'bid',
       'Trocar a estratégia de lance', 'O lance automático gastou mais que o previsto na última semana.',
       '{"bid_strategy": "COST_CAP", "target_cpa_cents": 2600}', 'medium', 'medium', null, 'claude',
       '00000000-0000-4000-8000-000000000301', 2
  from mkt.campaigns c where c.id = '00000000-0000-4000-8000-000000000211';
update mkt.traffic_actions
   set status = 'discarded', discarded_by = '00000000-0000-4000-8000-0000000000d1', discarded_at = now(),
       discard_reason = 'against_strategy', discard_note = 'O gestor prefere o lance automático neste mês.'
 where id = '00000000-0000-4000-8000-000000000334';

-- A pausa pedida pelo dono na tela do canal: proposta e aprovada no mesmo passo.
insert into mkt.traffic_actions (id, brand_id, platform, ad_account_id, campaign_id, kind, title, rationale, params,
                                 impact, effort, cost_cents, proposed_by_kind, proposed_by)
select '00000000-0000-4000-8000-000000000332', c.brand_id, c.platform, c.ad_account_id, c.id, 'pause',
       'Pausar cs-prospeccao-lojistas', 'Pausa pedida na tela do canal, sem motivo escrito.', '{"status": "paused"}',
       'medium', 'low', 0, 'human', '00000000-0000-4000-8000-0000000000d1'
  from mkt.campaigns c where c.id = '00000000-0000-4000-8000-000000000211';
update mkt.traffic_actions
   set status = 'approved', approved_by = '00000000-0000-4000-8000-0000000000d1', approved_at = now()
 where id = '00000000-0000-4000-8000-000000000332';

-- A pendência de medição do gestor: sem canal, conta nem campanha.
insert into mkt.traffic_actions (id, brand_id, kind, title, rationale, params, impact, effort, cost_cents,
                                 proposed_by_kind, proposed_by)
select '00000000-0000-4000-8000-000000000333', b.id, 'pending_fix', 'Ligar o GA4 no site da Corpo Sensual',
       'O site ainda não manda as sessões para o GA4.',
       '{"area": "ga4", "env": "NEXT_PUBLIC_GA_ID", "origin": "central"}', 'high', 'medium', 0, 'human',
       '00000000-0000-4000-8000-0000000000e1'
  from mkt.brands b where b.code = 'cs';

-- ---------- Parada ----------

insert into mkt.traffic_stops (id, brand_id, requested_by)
select '00000000-0000-4000-8000-000000000341', b.id, '00000000-0000-4000-8000-0000000000d1'
  from mkt.brands b where b.code = 'cs';
insert into mkt.traffic_stop_campaigns (id, traffic_stop_id, campaign_id, brand_id, status_before)
select '00000000-0000-4000-8000-000000000342', '00000000-0000-4000-8000-000000000341', c.id, c.brand_id, 'active'
  from mkt.campaigns c where c.id = '00000000-0000-4000-8000-000000000212';

-- ---------- Execuções ----------

insert into mkt.platform_executions (id, brand_id, platform, ad_account_id, campaign_id, traffic_action_id, operation,
                                     request, idempotency_key)
select '00000000-0000-4000-8000-000000000351', c.brand_id, c.platform, c.ad_account_id, c.id,
       '00000000-0000-4000-8000-000000000332', 'pause', '{"status": "PAUSED"}', 'exec-teste-0351'
  from mkt.campaigns c where c.id = '00000000-0000-4000-8000-000000000211';
update mkt.platform_executions set status = 'blocked', blocked_reason = 'no_write_credential'
 where id = '00000000-0000-4000-8000-000000000351';

insert into mkt.platform_executions (id, brand_id, platform, ad_account_id, campaign_id, traffic_stop_campaign_id,
                                     operation, request, idempotency_key)
select '00000000-0000-4000-8000-000000000352', c.brand_id, c.platform, c.ad_account_id, c.id,
       '00000000-0000-4000-8000-000000000342', 'pause', '{"status": "PAUSED"}', 'exec-teste-0352'
  from mkt.campaigns c where c.id = '00000000-0000-4000-8000-000000000212';
update mkt.platform_executions set status = 'sent', attempts = 1, sent_at = now()
 where id = '00000000-0000-4000-8000-000000000352';
update mkt.platform_executions
   set status = 'confirmed', http_status = 200, confirmed_at = now(), response = '{"effective_status": "PAUSED"}'
 where id = '00000000-0000-4000-8000-000000000352';

insert into mkt.platform_executions (id, brand_id, platform, ad_account_id, spend_limit_id, operation, request,
                                     idempotency_key)
select '00000000-0000-4000-8000-000000000353', l.brand_id, l.platform, l.ad_account_id, l.id,
       'set_account_spend_cap', '{"spend_cap": 15000, "spend_cap_action": "reset"}', 'exec-teste-0353'
  from mkt.spend_limits l where l.id = '00000000-0000-4000-8000-000000000321';
update mkt.platform_executions set status = 'blocked', blocked_reason = 'no_write_credential'
 where id = '00000000-0000-4000-8000-000000000353';

-- ---------- Diário: o que as funções de ação gravam direto (as ações e as execuções saíram dos gatilhos) ----------

insert into mkt.traffic_log (event, brand_id, actor_kind, actor_id, traffic_strategy_id, changes)
select 'strategy_saved', b.id, 'user', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000000311',
       '{"budget_cents": {"before": null, "after": 1500000}}'
  from mkt.brands b where b.code = 'cs';
insert into mkt.traffic_log (event, brand_id, platform, actor_kind, actor_id, spend_limit_id, changes)
select 'limit_changed', l.brand_id, l.platform, 'user', '00000000-0000-4000-8000-0000000000d1', l.id,
       '{"monthly_limit_cents": {"before": null, "after": 1500000}}'
  from mkt.spend_limits l where l.id = '00000000-0000-4000-8000-000000000321';
insert into mkt.traffic_log (event, brand_id, actor_kind, actor_id, traffic_stop_id)
select 'stop_all', s.brand_id, 'user', s.requested_by, s.id
  from mkt.traffic_stops s where s.id = '00000000-0000-4000-8000-000000000341';

alter table mkt.platform_executions enable trigger platform_executions_guard;
alter table mkt.traffic_actions enable trigger traffic_actions_transition;
commit;

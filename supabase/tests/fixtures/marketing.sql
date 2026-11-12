-- Dados inventados de marketing para os testes das migrações 04 a 06: pelo menos uma linha em cada tabela delas.
-- Nada é dado real: ids, contas, campanhas, códigos e consultas inventados; sites em example.com. Os ids são os de
-- tests/apoio/marketing.ts.
--
--   Corpo Sensual  conta Meta ...201 (com o teto da conta): campanha do humano ...211 e a criada pela central ...212
--                  (do Claude, pela ação ...2f1, ACT-0001); perfil do Instagram ...231 com o post ...291; GA4 ...241 e
--                  Search Console ...242
--   Plumene        conta Google ...202: campanha do humano ...213
--   CRM            funis de leads (decisão 0041): o padrão ...251 e o antigo dos leads do site ...252, já marcado;
--                  cliente ...261 (com UTM de primeiro contato,
--                  carteira na cs e o retrato do ERP de um cliente antigo que recomprou: a compra mais antiga fica) e
--                  prospecto ...262; negócio ...271 da cs; lead do SDR ...272, sem marca, e o negócio ...273 da
--                  conversão dele, que veio do CRM sem funil e sem marca; pedido enviado ...281; representante do CRM
--                  ...221 e um só de app ...222, com um login da cs
--
-- Só no PGlite: o "supabase test db" roda todo .sql desta pasta.
begin;
do $$
begin
  if version() not like '%PGlite%' then
    raise exception 'fixtures/marketing.sql é só para o PGlite (testes)';
  end if;
end $$;

-- ---------- Dimensões (migração 04) ----------

insert into mkt.ad_accounts (id, brand_id, platform, source, external_id, name, spend_cap_cents, amount_spent_cents,
                             last_seen_at, first_read_at)
select '00000000-0000-4000-8000-000000000201', b.id, 'meta', 'meta_ads', 'act_900000000000001', 'Conta Meta de teste',
       1500000, 250000, now(), now() - interval '30 days'
  from mkt.brands b where b.code = 'cs';
insert into mkt.ad_accounts (id, brand_id, platform, source, external_id, name, last_seen_at, first_read_at)
select '00000000-0000-4000-8000-000000000202', b.id, 'google', 'google_ads', '9000000002', 'Conta Google de teste',
       now(), now() - interval '30 days'
  from mkt.brands b where b.code = 'plumene';

-- A ação que criou a campanha do Claude (campaigns.created_by_action_id aponta para traffic_actions desde a migração
-- 07): proposta do Claude, executada pela central. Esta fixture não tem usuários, então a ação entra pronta, gravada
-- direto pelo dono do banco com o gatilho de passagens desligado só nesta linha (os testes da migração 07 provam o
-- quadro de passagens). O código (ACT-0001, o do nome da campanha) e o diário saem dos gatilhos.
alter table mkt.traffic_actions disable trigger traffic_actions_transition;
insert into mkt.traffic_actions (id, brand_id, platform, ad_account_id, kind, title, rationale, params, impact, effort,
                                 cost_cents, status, proposed_by_kind, claude_item, done_via, executed_at)
select '00000000-0000-4000-8000-0000000002f1', a.brand_id, a.platform, a.id, 'create',
       'Criar campanha de remarketing', 'Quem visitou o site nos últimos 30 dias ainda não comprou.',
       '{"objective": "OUTCOME_SALES", "daily_budget_cents": 3000, "name": "cs-remarketing-act-0001",
         "special_ad_categories": []}',
       'medium', 'low', 90000, 'done', 'claude', 1, 'platform_api', now() - interval '3 days'
  from mkt.ad_accounts a where a.id = '00000000-0000-4000-8000-000000000201';
alter table mkt.traffic_actions enable trigger traffic_actions_transition;

-- Importadas da plataforma: nascem do humano. A criada pela central nasce do Claude, com a ação que a criou.
insert into mkt.campaigns (id, ad_account_id, brand_id, platform, source, external_id, name, status, daily_budget_cents,
                           last_seen_at)
select '00000000-0000-4000-8000-000000000211', a.id, a.brand_id, a.platform, a.source, '120200000000000001',
       'cs-prospeccao-lojistas', 'active', 5000, now()
  from mkt.ad_accounts a where a.id = '00000000-0000-4000-8000-000000000201';
insert into mkt.campaigns (id, ad_account_id, brand_id, platform, source, external_id, name, status, daily_budget_cents,
                           managed_by, created_by_action_id, last_seen_at)
select '00000000-0000-4000-8000-000000000212', a.id, a.brand_id, a.platform, a.source, '120200000000000002',
       'cs-remarketing-act-0001', 'paused', 3000, 'claude', '00000000-0000-4000-8000-0000000002f1', now()
  from mkt.ad_accounts a where a.id = '00000000-0000-4000-8000-000000000201';
insert into mkt.campaigns (id, ad_account_id, brand_id, platform, source, external_id, name, status, last_seen_at)
select '00000000-0000-4000-8000-000000000213', a.id, a.brand_id, a.platform, a.source, '7000000001',
       'plumene-busca-marca', 'active', now()
  from mkt.ad_accounts a where a.id = '00000000-0000-4000-8000-000000000202';

-- Representantes, só pelo código: um do CRM e um só de app (o login guardado como resumo, nunca em claro).
insert into mkt.sales_reps (id, external_id, crm_role, last_seen_at)
values ('00000000-0000-4000-8000-000000000221', 'usr-teste-0001', 'internal_seller', now());
insert into mkt.sales_reps (id, external_id, last_seen_at)
values ('00000000-0000-4000-8000-000000000222', null, now());
insert into mkt.sales_rep_app_logins (sales_rep_id, brand_id, app_login_key)
select '00000000-0000-4000-8000-000000000222', b.id, repeat('0123456789abcdef', 4)
  from mkt.brands b where b.code = 'cs';

insert into mkt.ig_accounts (id, brand_id, external_id, username, first_read_at)
select '00000000-0000-4000-8000-000000000231', b.id, '17840000000000001', 'perfil.teste.cs', now() - interval '30 days'
  from mkt.brands b where b.code = 'cs';

insert into mkt.web_properties (id, brand_id, kind, source, external_id, host, first_read_at)
select '00000000-0000-4000-8000-000000000241', b.id, 'ga4_property', 'ga4', '900000001', 'cs.example.com',
       now() - interval '30 days'
  from mkt.brands b where b.code = 'cs';
insert into mkt.web_properties (id, brand_id, kind, source, external_id, host, first_read_at)
select '00000000-0000-4000-8000-000000000242', b.id, 'gsc_site', 'search_console', 'sc-domain:cs.example.com',
       'cs.example.com', now() - interval '30 days'
  from mkt.brands b where b.code = 'cs';

-- ---------- Réplica do CRM (migração 05) ----------

-- Os funis de leads (decisão 0041, item 1): o funil padrão do CRM, em que a ingestão faz is_lead_funnel seguir
-- is_default, e o funil antigo dos leads do site, que o script de configuração marca (setup.mark_lead_funnel).
insert into mkt.crm_funnels (id, external_id, name, is_default, is_lead_funnel, last_seen_at)
values ('00000000-0000-4000-8000-000000000251', 'funil-teste-0001', 'Funil de vendas de teste', true, true, now()),
       ('00000000-0000-4000-8000-000000000252', 'funil-teste-0002', 'Funil antigo de leads de teste', false, true,
        now());

insert into mkt.crm_customers (id, external_id, code, crm_status, is_known_by_erp, has_app_owner, first_utm_source,
                               first_utm_medium, first_utm_campaign, source_created_at, last_seen_at)
values ('00000000-0000-4000-8000-000000000261', 'cli-teste-0001', 'CLI-9001', 'active', true, true, 'meta', 'cpc',
        'cs-prospeccao-lojistas', now() - interval '20 days', now()),
       ('00000000-0000-4000-8000-000000000262', 'cli-teste-0002', 'CLI-9002', 'prospect', false, false, null, null,
        null, now() - interval '5 days', now());

-- A situação e o perdido marcado à mão não vêm do CRM: ficam nulos (decisão 0041, item 6). O retrato do ERP já traz a
-- compra feita pelo app (a última compra anda para a frente); a mais antiga já vista, de antes do 1º pedido do CRM,
-- fica (decisão 0042).
insert into mkt.crm_customer_brands (customer_id, brand_id, situation, is_lost_manual, last_purchase_on,
                                     erp_first_purchase_on, erp_last_purchase_on, erp_earliest_purchase_on,
                                     erp_total_purchased_cents, situation_computed_at, last_seen_at)
select '00000000-0000-4000-8000-000000000261', b.id, null, null, null, null, current_date - 10, current_date - 400,
       480000, null, now()
  from mkt.brands b where b.code = 'cs';
insert into mkt.crm_customer_reps (customer_id, brand_id, sales_rep_id, last_seen_at)
select '00000000-0000-4000-8000-000000000261', b.id, '00000000-0000-4000-8000-000000000221', now()
  from mkt.brands b where b.code = 'cs';

-- O negócio da cs, no funil de leads; o lead do SDR, sem marca e sem código no CRM (o gatilho dá o LEAD-).
insert into mkt.crm_leads (id, kind, external_id, code, brand_id, customer_id, crm_funnel_id, crm_origin_raw,
                           source_created_at, last_seen_at)
select '00000000-0000-4000-8000-000000000271', 'deal', 'neg-teste-0001', 'NEG-9001', b.id,
       '00000000-0000-4000-8000-000000000261', '00000000-0000-4000-8000-000000000251', 'meta',
       now() - interval '20 days', now()
  from mkt.brands b where b.code = 'cs';
insert into mkt.crm_leads (id, kind, external_id, customer_id, source_created_at, last_seen_at)
values ('00000000-0000-4000-8000-000000000272', 'sdr', 'sdr-teste-0001', '00000000-0000-4000-8000-000000000262',
        now() - interval '3 days', now());
-- A conversão do lead do SDR abre um negócio sem funil e sem marca, com a origem "SDR WhatsApp": sem funil é do funil
-- padrão, e a ingestão grava o id dele (decisão 0041, itens 1 e 3).
insert into mkt.crm_leads (id, kind, external_id, code, brand_id, customer_id, crm_funnel_id, crm_origin_raw,
                           source_created_at, last_seen_at)
values ('00000000-0000-4000-8000-000000000273', 'deal', 'neg-teste-0002', 'NEG-9002', null,
        '00000000-0000-4000-8000-000000000262', '00000000-0000-4000-8000-000000000251', 'sdr whatsapp',
        now() - interval '2 days', now());

insert into mkt.crm_orders (id, external_id, brand_id, customer_id, status, total_cents, sales_rep_id,
                            source_created_at, last_seen_at)
select '00000000-0000-4000-8000-000000000281', 'ped-teste-0001', b.id, '00000000-0000-4000-8000-000000000261', 'sent',
       125000, '00000000-0000-4000-8000-000000000221', now() - interval '15 days', now()
  from mkt.brands b where b.code = 'cs';

insert into mkt.crm_upstream_runs (external_id, brand_id, run_trigger, started_at, finished_at, is_ok, last_seen_at)
select 'sinc-teste-0001', b.id, 'cron', now() - interval '20 minutes', now() - interval '19 minutes', true, now()
  from mkt.brands b where b.code = 'cs';

-- ---------- Snapshots (migração 06) ----------

insert into mkt.ad_campaign_daily (campaign_id, brand_id, platform, metric_on, spend_cents, impressions, clicks,
                                   platform_leads, conversions, source, fetched_at)
select c.id, c.brand_id, c.platform, current_date - 1, 4870, 12000, 340, 6, 4.5, c.source, now()
  from mkt.campaigns c where c.id in ('00000000-0000-4000-8000-000000000211', '00000000-0000-4000-8000-000000000213');

insert into mkt.ad_activity_log (ad_account_id, brand_id, platform, campaign_id, source, external_id, occurred_at,
                                 change_kind, is_by_csp_mkt, details)
select a.id, a.brand_id, a.platform, '00000000-0000-4000-8000-000000000212', 'meta_ads', 'atividade-teste-0001',
       now() - interval '2 days', 'update_campaign_run_status', false,
       '{"object_type": "campaign", "object_id": "120200000000000002", "field": "status", "old_value": "ACTIVE",
         "new_value": "PAUSED"}'
  from mkt.ad_accounts a where a.id = '00000000-0000-4000-8000-000000000201';

insert into mkt.ig_account_daily (ig_account_id, brand_id, metric_on, followers_count, reach, views, total_interactions,
                                  fetched_at)
select g.id, g.brand_id, current_date - 1, 15200, 3400, 9100, 410, now()
  from mkt.ig_accounts g where g.id = '00000000-0000-4000-8000-000000000231';

insert into mkt.ig_media (id, ig_account_id, brand_id, external_id, media_type, published_at, caption_excerpt)
select '00000000-0000-4000-8000-000000000291', g.id, g.brand_id, '18000000000000001', 'reel', now() - interval '2 days',
       'Coleção nova de teste'
  from mkt.ig_accounts g where g.id = '00000000-0000-4000-8000-000000000231';
insert into mkt.ig_media_daily (ig_media_id, brand_id, captured_on, reach, views, likes, comments, saves, shares,
                                total_interactions, fetched_at)
select m.id, m.brand_id, current_date, 2100, 5300, 240, 12, 30, 8, 290, now()
  from mkt.ig_media m where m.id = '00000000-0000-4000-8000-000000000291';

insert into mkt.seo_daily (web_property_id, brand_id, metric_on, impressions, clicks, position, fetched_at)
select w.id, w.brand_id, current_date - 3, 5400, 180, 12.4, now()
  from mkt.web_properties w where w.id = '00000000-0000-4000-8000-000000000242';
insert into mkt.seo_query_daily (web_property_id, brand_id, metric_on, query, impressions, clicks, position, fetched_at)
select w.id, w.brand_id, current_date - 3, 'consulta de teste', 800, 40, 4.2, now()
  from mkt.web_properties w where w.id = '00000000-0000-4000-8000-000000000242';

insert into mkt.ga4_traffic_daily (web_property_id, brand_id, metric_on, session_source, session_medium,
                                   channel_group_raw, sessions, lead_events, fetched_at)
select w.id, w.brand_id, current_date - 1, 'google', 'organic', 'Organic Search', 120, 3, now()
  from mkt.web_properties w where w.id = '00000000-0000-4000-8000-000000000241';

insert into mkt.site_checks (web_property_id, brand_id, host, item, finding, http_status, checked_at, checked_on)
select w.id, w.brand_id, w.host, 'robots_txt', 'found', 200, now(), mkt.sp_day(now())
  from mkt.web_properties w where w.id = '00000000-0000-4000-8000-000000000241';
commit;

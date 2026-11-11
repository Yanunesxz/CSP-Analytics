-- Migração 07 · tráfego com IA: estratégia, limite de gasto, rodadas do Claude, ações, paradas, execuções e diário
--   (docs/dados/plano.md, "Ordem das migrações"; decisões 0005, 0008, 0020 a 0023 e 0038)
--
-- O que faz: cria traffic_strategies, spend_limits, claude_runs, traffic_actions (e a chave
--   campaigns.created_by_action_id), traffic_stops, traffic_stop_campaigns, platform_executions e traffic_log
--   (docs/dados/tabelas.md, seção 4). Cada tabela nasce com a RLS ligada, a leitura de quem tem a permissão
--   (view_traffic; o limite de gasto, view_numbers) e a do worker e a do executor só nas tabelas da lista de cada um
--   (papeis-e-rls.md). As conferências de jsonb: mkt.valid_action_params (os parâmetros de cada tipo e plataforma) e
--   mkt.valid_claude_context (só as chaves previstas em cada lugar, nenhum texto com dado pessoal). Os gatilhos: o
--   código ACT- da ação; as passagens de status da ação (o quadro de tabelas.md), conferindo o session_user e a
--   permissão de quem pede, com os parâmetros congelados fora da ideia; a execução protegida (quem cria, o que nunca
--   muda e as passagens de status); o diário da ação e o da execução; e o diário só por acréscimo.
-- Risco: médio. Os gatilhos barram toda escrita de ação e de execução fora das funções de ação (pela API), do worker e
--   do executor (migrações 09 e 10), também a do dono do banco. A chave nova em campaigns valida as linhas que já
--   existem: nenhuma, porque nada grava campanha antes do worker (migração 10).
-- Como reverter (só no projeto de teste, antes de produção, e depois de reverter as migrações seguintes):
--   alter table mkt.campaigns drop constraint if exists campaigns_created_by_action;
--   drop table mkt.traffic_log, mkt.platform_executions, mkt.traffic_stop_campaigns, mkt.traffic_stops,
--     mkt.traffic_actions, mkt.claude_runs, mkt.spend_limits, mkt.traffic_strategies;
--   drop function mkt.valid_action_params(mkt.action_kind, mkt.platform, jsonb), mkt.valid_claude_context(jsonb),
--     private.traffic_actions_code(), private.traffic_actions_transition(), private.traffic_actions_log(),
--     private.platform_executions_guard(), private.platform_executions_log();
-- Conferir (as ações por status; o diário mais recente; os gatilhos de cada tabela):
--   select status, count(*) from mkt.traffic_actions group by 1 order by 1;
--   select occurred_at, seq, event, actor_kind from mkt.traffic_log order by occurred_at desc, seq desc limit 20;
--   select tgrelid::regclass, tgname from pg_trigger
--    where tgrelid in ('mkt.traffic_actions'::regclass, 'mkt.platform_executions'::regclass,
--                      'mkt.traffic_log'::regclass) and not tgisinternal order by 1, 2;

-- ---------- Regras puras: os parâmetros da ação e o contexto do Claude ----------

-- Os parâmetros de cada tipo de ação (tabelas.md, traffic_actions), com os campos que a plataforma exige: o pedido
-- enviado é o que foi aprovado, e o executor nunca inventa campo. Chave de outro tipo ou de outra plataforma, tipo
-- errado ou texto com dado pessoal: falso. Toda ação que não é pendência de medição tem canal. A ideia registrada na
-- central leva também {"origin": "central"}. No Google, contains_eu_political_advertising, se vier, é sempre falso.
-- Os valores em centavos são inteiros de 1 até 10^12 (cabe em bigint mesmo multiplicado pelos dias do mês); o anterior
-- do ajuste de orçamento pode ser 0 ou nulo.
create or replace function mkt.valid_action_params(p_kind mkt.action_kind, p_platform mkt.platform, p_params jsonb)
returns boolean
language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare
  v_required text[];
  v_optional text[] := array['origin'];
  v_key text;
  v_value jsonb;
  v_text text;
  v_item jsonb;
begin
  if p_kind is null or jsonb_typeof(p_params) is distinct from 'object'
     or (p_kind <> 'pending_fix' and p_platform is null) then
    return false;
  end if;

  case p_kind
    when 'budget' then
      v_required := array['daily_budget_cents'];
      v_optional := v_optional || array['previous_daily_budget_cents'];
    when 'pause' then
      v_required := array['status'];
    when 'creative' then
      v_required := array['creative_ref'];
    when 'create' then
      v_required := array['objective', 'daily_budget_cents', 'name']
        || case p_platform
             when 'meta' then array['special_ad_categories']
             when 'google' then array['advertising_channel_type', 'bidding_strategy']
             when 'tiktok' then array['budget_mode']
           end;
      if p_platform = 'google' then
        v_optional := v_optional || array['contains_eu_political_advertising'];
      end if;
    when 'bid' then
      v_required := array['bid_strategy'];
      v_optional := v_optional || array['target_cpa_cents'];
    when 'pending_fix' then
      v_required := array['area'];
      v_optional := v_optional || array['env'];
  end case;

  if not p_params ?& v_required then
    return false;
  end if;

  for v_key, v_value in select e.key, e.value from jsonb_each(p_params) e loop
    if not (v_key = any(v_required) or v_key = any(v_optional)) then
      return false;
    end if;

    if jsonb_typeof(v_value) = 'null' then
      -- Só os opcionais com "?" no quadro podem vir nulos.
      if v_key not in ('previous_daily_budget_cents', 'target_cpa_cents', 'env') then
        return false;
      end if;
      continue;
    end if;

    if v_key in ('daily_budget_cents', 'previous_daily_budget_cents', 'target_cpa_cents') then
      if jsonb_typeof(v_value) <> 'number' then
        return false;
      end if;
      if v_value::numeric <> trunc(v_value::numeric)
         or v_value::numeric > 1000000000000
         or v_value::numeric < (case when v_key = 'previous_daily_budget_cents' then 0 else 1 end) then
        return false;
      end if;
      continue;
    end if;

    if v_key = 'contains_eu_political_advertising' then
      if v_value <> 'false'::jsonb then
        return false;
      end if;
      continue;
    end if;

    if v_key = 'special_ad_categories' then
      -- A Meta pede a lista sempre, vazia quando não há categoria especial.
      if jsonb_typeof(v_value) <> 'array' then
        return false;
      end if;
      for v_item in select a.value from jsonb_array_elements(v_value) a loop
        if jsonb_typeof(v_item) <> 'string' or (v_item #>> '{}') !~ '^[A-Za-z][A-Za-z0-9_]{0,59}$' then
          return false;
        end if;
      end loop;
      continue;
    end if;

    if jsonb_typeof(v_value) <> 'string' then
      return false;
    end if;
    v_text := v_value #>> '{}';
    if not (case
              when v_key = 'status' then v_text = 'paused'
              when v_key = 'origin' then v_text = 'central'
              when v_key = 'area' then v_text in ('ga4', 'search_console', 'site', 'crm', 'pixel')
              -- O nome da campanha nova segue a convenção da utm_campaign (decisão 0009): até 150 letras, sem @.
              when v_key = 'name' then length(btrim(v_text)) between 1 and 150 and strpos(v_text, '@') = 0
              when v_key = 'creative_ref' then v_text ~ '^[A-Za-z0-9_./:~-]{1,200}$'
              when v_key = 'env' then v_text ~ '^[A-Za-z][A-Za-z0-9_]{0,99}$'
              -- objective, advertising_channel_type, bidding_strategy, budget_mode e bid_strategy: o código da
              -- plataforma, nunca texto livre.
              else v_text ~ '^[A-Za-z][A-Za-z0-9_]{0,59}$'
            end)
       or mkt.has_personal_data(v_text) then
      return false;
    end if;
  end loop;
  return true;
end $$;

-- O contexto da rodada do Claude (integracoes.md, seção 15): só agregados por marca, canal, conta e campanha, a
-- estratégia do mês, as pendências, os conectores e as ações dos últimos 30 dias. Cada lugar aceita só as chaves dele
-- (o formato abaixo: a raiz, cada objeto e cada item de lista, pelo nome da chave que o traz), e cada chave tem um tipo
-- fixo; chave fora do lugar (rationale, result, discard_note, impact, email, customer_id, lead…) recusa o contexto
-- inteiro. Das ações vão só as chaves da seção 15, mais proposed_by, que decide o título: ele vai só nas propostas do
-- próprio Claude. Texto livre só no nome de campanha, no título e no texto da estratégia; todo texto passa por
-- mkt.has_personal_data. Recusado, a rodada falha antes de chamar a API (CONTEXT_REFUSED). Formato esperado de
-- mkt.claude_context (migração 12):
--   {brand, generated_at, today_on,
--    current_month e last_30_days: {from_on, to_on, totals: {…números}, channels: [{platform, …números}],
--                                    campaigns: [{campaign_id, platform, name, status, operator, has_own_budget,
--                                                 is_smart_plus, …números}]},
--    accounts: [{ad_account_id, platform, monthly_limit_cents, spend_month_cents, projected_month_cents,
--                remaining_cents, usage_ratio, situation, alert, spend_cap_cents, days_left}],
--    strategy: {month_on, body, budget_cents, target_cost_per_new_customer_cents, target_cost_per_lead_cents,
--               target_new_customers},
--    pending_fixes: [{code, area, env, status, platform, created_on}],
--    connectors: [{connector, status, setup_state, last_success_at}],
--    actions: [{code, kind, status, platform, campaign_id, params: {…de mkt.valid_action_params}, done_via,
--               discard_reason, proposed_by, title (só com proposed_by = claude)}]}
-- Os números: spend_cents, impressions, clicks, platform_leads, conversions, conversion_value_cents, leads,
-- new_customers, revenue_cents, cost_per_lead_cents, cost_per_new_customer_cents, roas, daily_budget_cents,
-- active_campaigns (nulo = "Sem dados").
create or replace function mkt.valid_claude_context(p_context jsonb) returns boolean
language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare
  -- O tipo de cada chave, o mesmo em qualquer lugar.
  c_keys constant jsonb := $keys${
    "accounts": "list", "actions": "list", "active_campaigns": "number", "ad_account_id": "uuid",
    "advertising_channel_type": "code", "alert": "code", "area": "code", "bid_strategy": "code",
    "bidding_strategy": "code", "body": "body", "brand": "code", "budget_cents": "number", "budget_mode": "code",
    "campaign_id": "uuid", "campaigns": "list", "channels": "list", "clicks": "number", "code": "code",
    "connector": "code", "connectors": "list", "contains_eu_political_advertising": "boolean",
    "conversion_value_cents": "number", "conversions": "number", "cost_per_lead_cents": "number",
    "cost_per_new_customer_cents": "number", "created_on": "date", "creative_ref": "ref", "current_month": "object",
    "daily_budget_cents": "number", "days_left": "number", "discard_reason": "code", "done_via": "code",
    "env": "code", "from_on": "date", "generated_at": "timestamp", "has_own_budget": "boolean",
    "impressions": "number", "is_smart_plus": "boolean", "kind": "code", "last_30_days": "object",
    "last_success_at": "timestamp", "leads": "number", "month_on": "date", "monthly_limit_cents": "number",
    "name": "name", "new_customers": "number", "objective": "code", "operator": "code", "origin": "code",
    "params": "object", "pending_fixes": "list", "platform": "code", "platform_leads": "number",
    "previous_daily_budget_cents": "number", "projected_month_cents": "number", "proposed_by": "code",
    "remaining_cents": "number", "revenue_cents": "number", "roas": "number", "setup_state": "code",
    "situation": "code", "special_ad_categories": "codes", "spend_cap_cents": "number", "spend_cents": "number",
    "spend_month_cents": "number", "status": "code", "strategy": "object", "target_cost_per_lead_cents": "number",
    "target_cost_per_new_customer_cents": "number", "target_cpa_cents": "number", "target_new_customers": "number",
    "title": "title", "to_on": "date", "today_on": "date", "totals": "object", "usage_ratio": "number"
  }$keys$;
  -- Os números de um período, de um canal e de uma campanha.
  c_numbers constant text[] := array['spend_cents', 'impressions', 'clicks', 'platform_leads', 'conversions',
    'conversion_value_cents', 'leads', 'new_customers', 'revenue_cents', 'cost_per_lead_cents',
    'cost_per_new_customer_cents', 'roas', 'daily_budget_cents', 'active_campaigns'];
  v_queue jsonb[] := array[p_context];
  v_places text[] := array['$'];
  v_node jsonb;
  v_place text;
  v_allowed text[];
  v_key text;
  v_value jsonb;
  v_kind text;
  v_item jsonb;
  v_text text;
  v_nodes integer := 0;
begin
  if jsonb_typeof(p_context) is distinct from 'object' then
    return false;
  end if;

  while cardinality(v_queue) > 0 loop
    v_node := v_queue[1];
    v_place := v_places[1];
    v_queue := v_queue[2:];
    v_places := v_places[2:];
    v_nodes := v_nodes + 1;
    if v_nodes > 20000 then
      return false;
    end if;
    -- O título vai só nas propostas do próprio Claude; o da pessoa, nunca.
    if v_node ? 'title' and (v_node ->> 'proposed_by') is distinct from 'claude' then
      return false;
    end if;
    -- As chaves de cada lugar ($ é a raiz; o resto, a chave que traz o objeto ou a lista), como no formato acima.
    v_allowed := case v_place
      when '$' then array['brand', 'generated_at', 'today_on', 'current_month', 'last_30_days', 'accounts',
                          'strategy', 'pending_fixes', 'connectors', 'actions']
      when 'current_month' then array['from_on', 'to_on', 'totals', 'channels', 'campaigns']
      when 'last_30_days' then array['from_on', 'to_on', 'totals', 'channels', 'campaigns']
      when 'totals' then c_numbers
      when 'channels' then array['platform'] || c_numbers
      when 'campaigns' then array['campaign_id', 'platform', 'name', 'status', 'operator', 'has_own_budget',
                                  'is_smart_plus'] || c_numbers
      when 'accounts' then array['ad_account_id', 'platform', 'monthly_limit_cents', 'spend_month_cents',
                                 'projected_month_cents', 'remaining_cents', 'usage_ratio', 'situation', 'alert',
                                 'spend_cap_cents', 'days_left']
      when 'strategy' then array['month_on', 'body', 'budget_cents', 'target_cost_per_new_customer_cents',
                                 'target_cost_per_lead_cents', 'target_new_customers']
      when 'pending_fixes' then array['code', 'area', 'env', 'status', 'platform', 'created_on']
      when 'connectors' then array['connector', 'status', 'setup_state', 'last_success_at']
      -- Das ações, só o que a seção 15 lista; nunca o motivo, o resultado, o impacto, o esforço, o custo nem datas.
      when 'actions' then array['code', 'kind', 'status', 'platform', 'campaign_id', 'params', 'done_via',
                                'discard_reason', 'proposed_by', 'title']
      when 'params' then array['origin', 'daily_budget_cents', 'previous_daily_budget_cents', 'status',
                               'creative_ref', 'objective', 'name', 'special_ad_categories',
                               'advertising_channel_type', 'bidding_strategy', 'contains_eu_political_advertising',
                               'budget_mode', 'bid_strategy', 'target_cpa_cents', 'area', 'env']
    end;

    for v_key, v_value in select e.key, e.value from jsonb_each(v_node) e loop
      v_kind := c_keys ->> v_key;
      if v_kind is null or not coalesce(v_key = any(v_allowed), false) then
        return false;
      end if;
      continue when jsonb_typeof(v_value) = 'null';

      if v_kind = 'object' then
        if jsonb_typeof(v_value) <> 'object' then
          return false;
        end if;
        v_queue := v_queue || v_value;
        v_places := v_places || v_key;
      elsif v_kind = 'list' then
        if jsonb_typeof(v_value) <> 'array' then
          return false;
        end if;
        for v_item in select a.value from jsonb_array_elements(v_value) a loop
          if jsonb_typeof(v_item) <> 'object' then
            return false;
          end if;
          v_queue := v_queue || v_item;
          v_places := v_places || v_key;
        end loop;
      elsif v_kind in ('number', 'boolean') then
        if jsonb_typeof(v_value) <> v_kind then
          return false;
        end if;
      elsif v_kind = 'codes' then
        if jsonb_typeof(v_value) <> 'array' then
          return false;
        end if;
        for v_item in select a.value from jsonb_array_elements(v_value) a loop
          if jsonb_typeof(v_item) <> 'string' or (v_item #>> '{}') !~ '^[A-Za-z0-9_.:-]{1,100}$'
             or mkt.has_personal_data(v_item #>> '{}') then
            return false;
          end if;
        end loop;
      else
        if jsonb_typeof(v_value) <> 'string' then
          return false;
        end if;
        v_text := v_value #>> '{}';
        if not (case v_kind
                  when 'code' then v_text ~ '^[A-Za-z0-9_.:-]{1,100}$'
                  when 'ref' then v_text ~ '^[A-Za-z0-9_./:~-]{1,200}$'
                  when 'uuid' then v_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  when 'date' then v_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                  -- Instante ISO com o fuso: 2026-11-03T10:30:00Z ou 2026-11-03T10:30:00.123+00:00.
                  when 'timestamp' then
                    v_text ~ ('^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?'
                              || '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$')
                  when 'name' then length(btrim(v_text)) between 1 and 150
                  when 'title' then length(btrim(v_text)) between 1 and 140
                  when 'body' then length(v_text) <= 4000
                  else false
                end)
           -- Id, data e hora já têm forma fixa; o resto é texto e passa pela regra de dado pessoal.
           or (v_kind not in ('uuid', 'date', 'timestamp') and mkt.has_personal_data(v_text)) then
          return false;
        end if;
      end if;
    end loop;
  end loop;
  return true;
end $$;

-- ---------- Tabelas ----------

-- Estratégia por marca e mês: o único texto livre escrito por pessoa que vai para o Claude. Cada mudança vai para o
-- diário (strategy_saved), por api.save_strategy (migração 09).
create table if not exists mkt.traffic_strategies (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references mkt.brands(id),
  month_on date not null check (extract(day from month_on) = 1),
  body text not null default '' check (length(body) <= 4000 and not mkt.has_personal_data(body)),
  budget_cents bigint check (budget_cents >= 0),
  target_cost_per_new_customer_cents bigint check (target_cost_per_new_customer_cents > 0),
  target_cost_per_lead_cents bigint check (target_cost_per_lead_cents > 0),
  target_new_customers integer check (target_new_customers > 0),
  updated_by uuid not null references mkt.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (brand_id, month_on)
);
alter table mkt.traffic_strategies enable row level security;

-- Limite de gasto por conta e mês (decisão 0021): uma linha por conta e por dia em que o limite mudou; vale a mais
-- recente até o dia consultado. A marca e a plataforma são as da conta, pela chave composta.
create table if not exists mkt.spend_limits (
  id uuid primary key default gen_random_uuid(),
  ad_account_id uuid not null,
  brand_id uuid not null,
  platform mkt.platform not null,
  monthly_limit_cents bigint not null check (monthly_limit_cents >= 0),
  valid_from_on date not null,
  set_by uuid not null references mkt.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (ad_account_id, valid_from_on),
  foreign key (ad_account_id, brand_id, platform) references mkt.ad_accounts (id, brand_id, platform)
);
alter table mkt.spend_limits enable row level security;

-- Rodadas do Claude: o prompt e o contexto uma vez por rodada (decisão 0020), por 13 meses. O worker cria o id antes
-- de chamar a API; gravar de novo é upsert por ele (ingest.record_claude_run, migração 10).
create table if not exists mkt.claude_runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references mkt.brands(id),
  status mkt.run_status not null,
  model text not null,
  prompt_version text not null,
  prompt text not null check (not mkt.has_personal_data(prompt)),
  context jsonb not null check (mkt.valid_claude_context(context)),
  output jsonb,
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  proposals_refused integer not null default 0 check (proposals_refused >= 0),
  error_code text check (error_code ~ '^[A-Z0-9_-]{2,40}$'),
  started_at timestamptz not null,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now())
);
alter table mkt.claude_runs enable row level security;
create index if not exists claude_runs_started on mkt.claude_runs (started_at desc);

-- "O que podemos fazer" e a fila de aprovação. A conta e a campanha são da marca e do canal da ação (chaves
-- compostas); os parâmetros conferem com o tipo e a plataforma e congelam fora da ideia (gatilho de transição).
create table if not exists mkt.traffic_actions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  brand_id uuid not null references mkt.brands(id),
  platform mkt.platform,
  ad_account_id uuid,
  campaign_id uuid,
  kind mkt.action_kind not null,
  title text not null check (length(title) between 5 and 140),
  rationale text not null check (length(rationale) between 10 and 2000),
  params jsonb not null default '{}',
  impact mkt.level not null,
  effort mkt.level not null,
  cost_cents bigint check (cost_cents >= 0),
  status mkt.action_status not null default 'idea',
  proposed_by_kind mkt.operator not null,
  proposed_by uuid references mkt.profiles(id),
  claude_run_id uuid references mkt.claude_runs(id) on delete set null,
  claude_item integer check (claude_item >= 1),
  approved_by uuid references mkt.profiles(id),
  approved_at timestamptz,
  discarded_by uuid references mkt.profiles(id),
  discarded_at timestamptz,
  discard_reason mkt.discard_reason,
  discard_note text check (discard_note is null or length(discard_note) between 10 and 1000),
  done_via mkt.done_via,
  done_by uuid references mkt.profiles(id),
  executed_at timestamptz,
  result text check (result is null or length(result) between 5 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  foreign key (campaign_id, brand_id, platform) references mkt.campaigns (id, brand_id, platform),
  foreign key (ad_account_id, brand_id, platform) references mkt.ad_accounts (id, brand_id, platform),
  unique (claude_run_id, claude_item),
  check (campaign_id is null or platform is not null),
  check (ad_account_id is null or platform is not null),
  check (mkt.valid_action_params(kind, platform, params)),
  check (not mkt.has_personal_data(concat_ws(' ', title, rationale, discard_note, result))),
  check ((proposed_by_kind = 'human') = (proposed_by is not null)),
  check ((proposed_by_kind = 'claude') = (claude_item is not null)),
  check (status not in ('approved', 'running', 'failed') or (approved_by is not null and approved_at is not null)),
  check (status <> 'discarded' or (discarded_by is not null and discarded_at is not null
                                   and discard_reason is not null and discard_note is not null)),
  check (status <> 'done' or (executed_at is not null and done_via is not null)),
  check (done_via is distinct from 'manual' or (done_by is not null and result is not null))
);
alter table mkt.traffic_actions enable row level security;
create index if not exists traffic_actions_status on mkt.traffic_actions (status, brand_id);
create index if not exists traffic_actions_created on mkt.traffic_actions (created_at desc);
create index if not exists traffic_actions_campaign on mkt.traffic_actions (campaign_id);

-- campaigns nasceu antes de traffic_actions (migração 04): a chave de created_by_action_id entra aqui, só se ainda não
-- existe (a migração roda de novo sem erro).
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'mkt.campaigns'::regclass and conname = 'campaigns_created_by_action') then
    alter table mkt.campaigns
      add constraint campaigns_created_by_action foreign key (created_by_action_id)
      references mkt.traffic_actions(id) on delete set null;
  end if;
end $$;

-- "Parar tudo" (decisão 0022): o comando registrado, com quem, quando, a marca (nulo = as duas) e cada campanha. O
-- status da campanha só muda quando a plataforma confirmar a pausa (uma execução por campanha).
create table if not exists mkt.traffic_stops (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references mkt.brands(id),
  scope mkt.stop_scope not null default 'claude_only',
  requested_by uuid not null references mkt.profiles(id),
  requested_at timestamptz not null default now(),
  undone_by uuid references mkt.profiles(id),
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  check ((undone_by is null) = (undone_at is null))
);
alter table mkt.traffic_stops enable row level security;

create table if not exists mkt.traffic_stop_campaigns (
  id uuid primary key default gen_random_uuid(),
  traffic_stop_id uuid not null references mkt.traffic_stops(id),
  campaign_id uuid not null,
  brand_id uuid not null,
  status_before mkt.campaign_status not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (traffic_stop_id, campaign_id),
  foreign key (campaign_id, brand_id) references mkt.campaigns (id, brand_id)
);
alter table mkt.traffic_stop_campaigns enable row level security;

-- Cada escrita numa plataforma (decisões 0020 e 0038): a cópia exata do que foi aprovado, a chave de idempotência e o
-- andamento. Nasce de uma ação aprovada, de uma campanha de uma parada ou do limite da conta (o teto na Meta).
create table if not exists mkt.platform_executions (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  platform mkt.platform not null,
  ad_account_id uuid not null,
  campaign_id uuid references mkt.campaigns(id),
  traffic_action_id uuid references mkt.traffic_actions(id) on delete cascade,
  traffic_stop_campaign_id uuid references mkt.traffic_stop_campaigns(id),
  spend_limit_id uuid references mkt.spend_limits(id),
  operation mkt.execution_operation not null,
  request jsonb not null,
  idempotency_key text not null unique,
  status mkt.execution_status not null default 'queued',
  blocked_reason mkt.execution_block_reason,
  attempts integer not null default 0 check (attempts between 0 and 5),
  http_status integer check (http_status between 100 and 599),
  error_code text check (error_code ~ '^[A-Za-z0-9_.:-]{1,60}$'),
  error_message text check (length(error_message) <= 300),
  response jsonb,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  confirmed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  check (num_nonnulls(traffic_action_id, traffic_stop_campaign_id, spend_limit_id) = 1),
  check ((operation = 'set_account_spend_cap') = (spend_limit_id is not null)),
  check ((status = 'blocked') = (blocked_reason is not null)),
  foreign key (ad_account_id, brand_id, platform) references mkt.ad_accounts (id, brand_id, platform)
);
alter table mkt.platform_executions enable row level security;
create index if not exists platform_executions_open on mkt.platform_executions (status)
  where status in ('queued', 'sent');

-- O diário de tráfego e o histórico de status das ações e das execuções. Só acréscimo (gatilho abaixo); guarda 5 anos
-- (limpeza no pg_cron, migração 13). seq desempata eventos com a mesma hora (a da transação).
create table if not exists mkt.traffic_log (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  occurred_at timestamptz not null default now(),
  event mkt.traffic_event not null,
  brand_id uuid references mkt.brands(id),
  platform mkt.platform,
  actor_kind mkt.actor_kind not null,
  actor_id uuid references mkt.profiles(id),
  traffic_action_id uuid references mkt.traffic_actions(id),
  campaign_id uuid references mkt.campaigns(id),
  traffic_stop_id uuid references mkt.traffic_stops(id),
  spend_limit_id uuid references mkt.spend_limits(id),
  traffic_strategy_id uuid references mkt.traffic_strategies(id),
  platform_execution_id uuid references mkt.platform_executions(id),
  changes jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  check ((actor_kind = 'user') = (actor_id is not null))
);
alter table mkt.traffic_log enable row level security;
create index if not exists traffic_log_time on mkt.traffic_log (occurred_at desc, seq desc);
create index if not exists traffic_log_brand_time on mkt.traffic_log (brand_id, occurred_at desc);
create index if not exists traffic_log_action on mkt.traffic_log (traffic_action_id);

-- A sequência da ordem de gravação é só do dono: ninguém da API nem dos serviços mexe nela.
do $$
begin
  execute format('revoke all on sequence %s from public, anon, authenticated',
                 pg_get_serial_sequence('mkt.traffic_log', 'seq'));
end $$;

-- ---------- Gatilhos ----------

create or replace trigger traffic_strategies_updated_at before update on mkt.traffic_strategies
  for each row execute function private.set_updated_at();
create or replace trigger spend_limits_updated_at before update on mkt.spend_limits
  for each row execute function private.set_updated_at();
create or replace trigger claude_runs_updated_at before update on mkt.claude_runs
  for each row execute function private.set_updated_at();
create or replace trigger traffic_actions_updated_at before update on mkt.traffic_actions
  for each row execute function private.set_updated_at();
create or replace trigger traffic_stops_updated_at before update on mkt.traffic_stops
  for each row execute function private.set_updated_at();
create or replace trigger traffic_stop_campaigns_updated_at before update on mkt.traffic_stop_campaigns
  for each row execute function private.set_updated_at();
create or replace trigger platform_executions_updated_at before update on mkt.platform_executions
  for each row execute function private.set_updated_at();
create or replace trigger traffic_log_updated_at before update on mkt.traffic_log
  for each row execute function private.set_updated_at();

-- Código ACT- da ação (seção 9 do padrão), usado no aviso, no diário e no nome da campanha que a central cria. A mesma
-- proposta do Claude gravada de novo (insert … on conflict pela rodada e pela posição) fica com o código dela e a
-- sequência não anda. O código que vier no insert é ignorado, e o código nunca muda.
create or replace function private.traffic_actions_code() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_code text;
begin
  if tg_op = 'UPDATE' then
    if new.code is distinct from old.code then
      raise sqlstate 'PT422' using message = 'COD-422';
    end if;
    return new;
  end if;

  if new.claude_run_id is not null and new.claude_item is not null then
    select a.code into v_code
      from mkt.traffic_actions a
     where a.claude_run_id = new.claude_run_id and a.claude_item = new.claude_item;
  end if;
  if v_code is null then
    v_code := private.next_code('ACT', 'mkt.traffic_action_code_seq');
  end if;
  new.code := v_code;
  return new;
end $$;

create or replace trigger traffic_actions_code before insert or update of code on mkt.traffic_actions
  for each row execute function private.traffic_actions_code();

-- As passagens de status da ação (o quadro de tabelas.md, traffic_actions; papeis-e-rls.md, "Gatilhos que conferem
-- quem pede"). auth.uid() vem do token, que qualquer sessão direta define; o session_user, não: só a API entra como
-- authenticator, e cada serviço com o próprio papel. Vale também para o dono do banco.
--   (inserção) → idea      a pessoa pela API, com operate_traffic, como quem propõe; ou o worker, a proposta do
--                          Claude, com a rodada
--   (inserção) → approved  a pessoa pela API com operate_traffic e approve_action, como quem propõe e aprova
--                          (propose_action com approve_now); nunca pendência de medição
--   idea, failed → approved                api.approve_action (approve_action), como quem aprova; nunca pendência
--   idea, approved, failed → discarded     api.discard_action (approve_action), como quem descarta
--   idea → done (só pendência), approved, failed, running → done, à mão
--                                          api.mark_action_done (operate_traffic), como quem marca; não preenche o
--                                          aprovador
--   approved → running; approved, running → done (platform_api), failed      só o executor
-- Nada é descartado nem fecha à mão com a execução já enviada à plataforma; de running, à mão, só com a execução
-- bloqueada (nunca na fila). Os parâmetros, o tipo, a conta, a campanha e o texto congelam fora da ideia; cada
-- carimbo (aprovação, descarte, "feita") muda só na passagem dele. Sem permissão ou fora da sessão certa: PT403
-- (TRF-403); passagem fora do quadro ou estado errado: PT422 (TRF-422).
create or replace function private.traffic_actions_transition() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_session text := session_user::text;
  v_uid uuid := auth.uid();
  v_who text;
begin
  if tg_op = 'INSERT' then
    -- Nasce ideia (ou já aprovada, com approve_now), sem descarte e sem "feita"; a proposta do Claude com a rodada,
    -- a da pessoa sem.
    if new.status not in ('idea', 'approved')
       or (new.status = 'idea' and num_nonnulls(new.approved_by, new.approved_at) > 0)
       or (new.status = 'approved' and (new.kind = 'pending_fix' or new.proposed_by_kind = 'claude'))
       or num_nonnulls(new.discarded_by, new.discarded_at, new.discard_reason, new.discard_note, new.done_via,
                       new.done_by, new.executed_at, new.result) > 0
       or (new.proposed_by_kind = 'claude') <> (new.claude_run_id is not null) then
      raise sqlstate 'PT422' using message = 'TRF-422';
    end if;
    if not coalesce(case
         when new.proposed_by_kind = 'claude' then v_session = 'mkt_worker'
         else v_session = 'authenticator' and new.proposed_by = v_uid and authz.can('operate_traffic')
              and (new.status = 'idea' or (new.approved_by = v_uid and authz.can('approve_action')))
       end, false) then
      raise sqlstate 'PT403' using message = 'TRF-403';
    end if;
    return new;
  end if;

  -- O que nunca muda: quem propôs e a posição na resposta; a rodada só cai para nulo (a limpeza de 13 meses de
  -- claude_runs, pela chave). O código tem gatilho próprio.
  if (new.proposed_by_kind, new.proposed_by, new.claude_item, new.created_at)
       is distinct from (old.proposed_by_kind, old.proposed_by, old.claude_item, old.created_at)
     or (new.claude_run_id is not null and new.claude_run_id is distinct from old.claude_run_id) then
    raise sqlstate 'PT422' using message = 'TRF-422';
  end if;

  -- O que a ação faz congela fora da ideia: o que foi aprovado é o que vai para a plataforma. Na ideia, sem passagem,
  -- muda só por quem pode propor: a pessoa pela API (operate_traffic) ou, na proposta do Claude, o worker.
  if (new.kind, new.brand_id, new.platform, new.ad_account_id, new.campaign_id, new.params, new.title,
      new.rationale, new.impact, new.effort, new.cost_cents)
     is distinct from
     (old.kind, old.brand_id, old.platform, old.ad_account_id, old.campaign_id, old.params, old.title,
      old.rationale, old.impact, old.effort, old.cost_cents) then
    if old.status <> 'idea' or new.status <> 'idea' then
      raise sqlstate 'PT422' using message = 'TRF-422';
    end if;
    if not coalesce(case when old.proposed_by_kind = 'claude' then v_session = 'mkt_worker'
                         else v_session = 'authenticator' and authz.can('operate_traffic') end, false) then
      raise sqlstate 'PT403' using message = 'TRF-403';
    end if;
  end if;

  -- Cada carimbo muda só na passagem dele: a aprovação ao chegar em approved, o descarte em discarded e o "feita" em
  -- done.
  if ((new.approved_by, new.approved_at) is distinct from (old.approved_by, old.approved_at)
      and not (new.status = 'approved' and old.status <> 'approved'))
     or ((new.discarded_by, new.discarded_at, new.discard_reason, new.discard_note)
           is distinct from (old.discarded_by, old.discarded_at, old.discard_reason, old.discard_note)
         and not (new.status = 'discarded' and old.status <> 'discarded'))
     or ((new.done_via, new.done_by, new.executed_at, new.result)
           is distinct from (old.done_via, old.done_by, old.executed_at, old.result)
         and not (new.status = 'done' and old.status <> 'done')) then
    raise sqlstate 'PT422' using message = 'TRF-422';
  end if;

  if new.status = old.status then
    return new;
  end if;

  v_who := case
    when old.status in ('idea', 'failed') and new.status = 'approved' and new.kind <> 'pending_fix' then 'approve'
    when old.status in ('idea', 'approved', 'failed') and new.status = 'discarded' then 'approve'
    when new.status = 'done' and new.done_via = 'manual'
         and (old.status in ('approved', 'failed', 'running') or (old.status = 'idea' and new.kind = 'pending_fix'))
      then 'operate'
    when old.status = 'approved' and new.status = 'running' then 'executor'
    when old.status in ('approved', 'running') and new.status = 'failed' then 'executor'
    when old.status in ('approved', 'running') and new.status = 'done' and new.done_via = 'platform_api'
      then 'executor'
  end;
  if v_who is null then
    raise sqlstate 'PT422' using message = 'TRF-422';
  end if;

  if not coalesce(case v_who
       when 'approve' then
         v_session = 'authenticator' and authz.can('approve_action')
         and v_uid = case when new.status = 'approved' then new.approved_by else new.discarded_by end
       when 'operate' then
         v_session = 'authenticator' and authz.can('operate_traffic') and v_uid = new.done_by
       else
         v_session = 'mkt_executor' and new.done_by is null
     end, false) then
    raise sqlstate 'PT403' using message = 'TRF-403';
  end if;

  if v_who <> 'executor' and new.status in ('discarded', 'done')
     and exists (select 1 from mkt.platform_executions e
                  where e.traffic_action_id = new.id
                    and (e.status = 'sent' or (old.status = 'running' and e.status = 'queued'))) then
    raise sqlstate 'PT422' using message = 'TRF-422';
  end if;
  return new;
end $$;

create or replace trigger traffic_actions_transition before insert or update on mkt.traffic_actions
  for each row execute function private.traffic_actions_transition();

-- O diário da ação (tabelas.md, traffic_log): a proposta (da pessoa ou do Claude) e cada mudança de status, com quem
-- fez (a pessoa pelo carimbo da passagem; o executor é o sistema) e {status: {before, after}}, mais o motivo do
-- descarte e o jeito de "feita". A aprovação junto com a proposta (approve_now) grava as duas linhas.
create or replace function private.traffic_actions_log() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into mkt.traffic_log (event, brand_id, platform, actor_kind, actor_id, traffic_action_id, campaign_id)
    values ('action_proposed', new.brand_id, new.platform,
            case when new.proposed_by_kind = 'claude' then 'claude' else 'user' end, new.proposed_by,
            new.id, new.campaign_id);
    if new.status = 'approved' then
      insert into mkt.traffic_log (event, brand_id, platform, actor_kind, actor_id, traffic_action_id, campaign_id,
                                   changes)
      values ('action_approved', new.brand_id, new.platform, 'user', new.approved_by, new.id, new.campaign_id,
              jsonb_build_object('status', jsonb_build_object('before', null, 'after', new.status)));
    end if;
    return null;
  end if;

  if new.status is not distinct from old.status then
    return null;
  end if;
  insert into mkt.traffic_log (event, brand_id, platform, actor_kind, actor_id, traffic_action_id, campaign_id,
                               changes)
  values (case new.status
            when 'approved' then 'action_approved'
            when 'running' then 'action_running'
            when 'done' then 'action_done'
            when 'failed' then 'action_failed'
            when 'discarded' then 'action_discarded'
          end,
          new.brand_id, new.platform,
          case when new.status in ('approved', 'discarded') or new.done_via = 'manual' then 'user' else 'system' end,
          case new.status
            when 'approved' then new.approved_by
            when 'discarded' then new.discarded_by
            when 'done' then new.done_by
          end,
          new.id, new.campaign_id,
          jsonb_build_object('status', jsonb_build_object('before', old.status, 'after', new.status))
            || case new.status
                 when 'discarded' then jsonb_build_object('discard_reason', new.discard_reason)
                 when 'done' then jsonb_build_object('done_via', new.done_via)
                 else '{}'::jsonb
               end);
  return null;
end $$;

create or replace trigger traffic_actions_log after insert or update of status on mkt.traffic_actions
  for each row execute function private.traffic_actions_log();

-- A execução protegida (tabelas.md, platform_executions; papeis-e-rls.md, "Gatilhos que conferem quem pede").
--   Quem cria: as funções de ação, pela API (session_user authenticator), com a permissão da origem (a ação aprovada
--   pede approve_action; a parada, stop_all; o limite, configure_traffic); ou a fila do teto da conta do dia 1
--   (private.queue_monthly_spend_caps), que só o pg_cron chama, como o dono do banco, e só set_account_spend_cap.
--   Nasce na fila, sem andamento, e é da origem dela: a ação ainda aprovada, com a mesma marca, canal, conta e
--   campanha e a operação do tipo (pause, budget → set_daily_budget, create → create_campaign; lance e criativo não
--   executam na v1); a campanha da parada (pausar com a parada aberta, reativar com ela desfeita); ou o limite da
--   conta, só na Meta. A campanha é da conta da execução, e só pausar, reativar e mudar orçamento têm campanha.
--   O que nunca muda: a cópia do que foi aprovado (request), a operação, a chave, a origem, a marca, a conta e a
--   campanha.
--   As passagens: queued → blocked | sent | confirmed | cancelled; blocked → queued | cancelled; sent → sent |
--   confirmed | failed (sent → sent é a nova tentativa). Fora delas nada muda: nem sem passagem na fila ou bloqueada,
--   nem depois de terminar (confirmed, failed, cancelled). O executor manda, relê, confirma, falha e bloqueia; as
--   funções de ação, pela API, bloqueiam no Parar tudo (stop_all), devolvem para a fila ("Tentar de novo",
--   approve_action) e cancelam (ação descartada ou feita à mão).
create or replace function private.platform_executions_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_session text := session_user::text;
  v_ok boolean;
begin
  if tg_op = 'INSERT' then
    if not coalesce(case
         when v_session = 'authenticator' then
           authz.can(case when new.traffic_action_id is not null then 'approve_action'
                          when new.traffic_stop_campaign_id is not null then 'stop_all'
                          else 'configure_traffic' end::mkt.app_action)
         when v_session = 'postgres' then new.operation = 'set_account_spend_cap'
         else false
       end, false) then
      raise sqlstate 'PT403' using message = 'TRF-403';
    end if;
    if num_nonnulls(new.traffic_action_id, new.traffic_stop_campaign_id, new.spend_limit_id) <> 1 then
      return new;   -- o check da tabela recusa: uma origem só
    end if;

    v_ok := new.status = 'queued' and new.attempts = 0
      and num_nonnulls(new.blocked_reason, new.http_status, new.error_code, new.error_message, new.response,
                       new.sent_at, new.confirmed_at, new.failed_at, new.cancelled_at) = 0
      and (new.operation in ('pause', 'activate', 'set_daily_budget')) = (new.campaign_id is not null)
      and (new.campaign_id is null
           or exists (select 1 from mkt.campaigns c
                       where c.id = new.campaign_id
                         and (c.ad_account_id, c.brand_id, c.platform)
                             = (new.ad_account_id, new.brand_id, new.platform)));
    if v_ok and new.traffic_action_id is not null then
      v_ok := exists (select 1 from mkt.traffic_actions a
                       where a.id = new.traffic_action_id and a.status = 'approved'
                         and (a.brand_id, a.platform, a.ad_account_id)
                             is not distinct from (new.brand_id, new.platform, new.ad_account_id)
                         and a.campaign_id is not distinct from new.campaign_id
                         and new.operation = case a.kind
                                               when 'pause' then 'pause'
                                               when 'budget' then 'set_daily_budget'
                                               when 'create' then 'create_campaign'
                                             end);
    elsif v_ok and new.traffic_stop_campaign_id is not null then
      v_ok := exists (select 1
                        from mkt.traffic_stop_campaigns sc
                        join mkt.traffic_stops s on s.id = sc.traffic_stop_id
                       where sc.id = new.traffic_stop_campaign_id
                         and sc.campaign_id = new.campaign_id and sc.brand_id = new.brand_id
                         and new.operation = case when s.undone_at is null then 'pause' else 'activate' end);
    elsif v_ok then
      v_ok := new.platform = 'meta'
        and exists (select 1 from mkt.spend_limits l
                     where l.id = new.spend_limit_id
                       and (l.ad_account_id, l.brand_id, l.platform)
                           = (new.ad_account_id, new.brand_id, new.platform));
    end if;
    if not coalesce(v_ok, false) then
      raise sqlstate 'PT422' using message = 'TRF-422';
    end if;
    return new;
  end if;

  if (new.brand_id, new.platform, new.ad_account_id, new.campaign_id, new.traffic_action_id,
      new.traffic_stop_campaign_id, new.spend_limit_id, new.operation, new.request, new.idempotency_key,
      new.created_at)
     is distinct from
     (old.brand_id, old.platform, old.ad_account_id, old.campaign_id, old.traffic_action_id,
      old.traffic_stop_campaign_id, old.spend_limit_id, old.operation, old.request, old.idempotency_key,
      old.created_at) then
    raise sqlstate 'PT422' using message = 'TRF-422';
  end if;
  if not ((old.status = 'queued' and new.status in ('blocked', 'sent', 'confirmed', 'cancelled'))
          or (old.status = 'blocked' and new.status in ('queued', 'cancelled'))
          or (old.status = 'sent' and new.status in ('sent', 'confirmed', 'failed'))) then
    raise sqlstate 'PT422' using message = 'TRF-422';
  end if;
  if not coalesce(case
       when new.status in ('sent', 'confirmed', 'failed') then
         v_session = 'mkt_executor'
       when new.status = 'blocked' then
         v_session = 'mkt_executor' or (v_session = 'authenticator' and authz.can('stop_all'))
       when new.status = 'queued' then
         v_session = 'authenticator' and authz.can('approve_action')
       else   -- cancelled
         v_session = 'authenticator' and (authz.can('approve_action') or authz.can('operate_traffic'))
     end, false) then
    raise sqlstate 'PT403' using message = 'TRF-403';
  end if;
  return new;
end $$;

create or replace trigger platform_executions_guard before insert or update on mkt.platform_executions
  for each row execute function private.platform_executions_guard();

-- O diário da execução (seção 9 do padrão: mudança de status com histórico por gatilho): ao nascer e a cada mudança
-- de status, execution_status_changed com a execução, a origem, a campanha e {status: {before, after},
-- blocked_reason}. Pela API, quem fez é a pessoa; o executor e o pg_cron são o sistema.
create or replace function private.platform_executions_log() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_uid uuid := case when session_user::text = 'authenticator' then auth.uid() end;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  insert into mkt.traffic_log (event, brand_id, platform, actor_kind, actor_id, traffic_action_id, campaign_id,
                               traffic_stop_id, spend_limit_id, platform_execution_id, changes)
  values ('execution_status_changed', new.brand_id, new.platform,
          case when v_uid is null then 'system' else 'user' end, v_uid,
          new.traffic_action_id, new.campaign_id,
          (select sc.traffic_stop_id from mkt.traffic_stop_campaigns sc where sc.id = new.traffic_stop_campaign_id),
          new.spend_limit_id, new.id,
          jsonb_build_object('status', jsonb_build_object('before', case when tg_op = 'UPDATE' then old.status end,
                                                          'after', new.status))
            || case when new.blocked_reason is null then '{}'::jsonb
                    else jsonb_build_object('blocked_reason', new.blocked_reason) end);
  return null;
end $$;

create or replace trigger platform_executions_log after insert or update of status on mkt.platform_executions
  for each row execute function private.platform_executions_log();

-- O diário é só de acréscimo (o mesmo gatilho de audit_log, migração 03): ninguém altera, apaga nem esvazia, nem o
-- dono do banco; a limpeza do prazo de guarda (pg_cron, migração 13) apaga só a linha com mais de 5 anos.
create or replace trigger traffic_log_append_only before update or delete on mkt.traffic_log
  for each row execute function private.append_only('occurred_at', '5 years');
create or replace trigger traffic_log_no_truncate before truncate on mkt.traffic_log
  for each statement execute function private.append_only();

-- ---------- Políticas (papeis-e-rls.md) ----------
-- Só leitura: authenticated pela permissão (view_traffic; o limite, view_numbers, porque a régua aparece na Visão
-- geral e nos canais), o worker nas tabelas da lista dele (estratégia, limites, rodadas e ações) e o executor nas dele
-- (limites, ações, paradas e execuções). O diário, só pela API. Nenhuma política nem grant de escrita: a tela grava
-- pelas funções api.*, o worker e o executor pelas ingest.*.

drop policy if exists traffic_strategies_read on mkt.traffic_strategies;
create policy traffic_strategies_read on mkt.traffic_strategies
  for select to authenticated using ((select authz.can('view_traffic')));
drop policy if exists traffic_strategies_worker_read on mkt.traffic_strategies;
create policy traffic_strategies_worker_read on mkt.traffic_strategies
  for select to mkt_worker using (true);

drop policy if exists spend_limits_read on mkt.spend_limits;
create policy spend_limits_read on mkt.spend_limits
  for select to authenticated using ((select authz.can('view_numbers')));
drop policy if exists spend_limits_worker_read on mkt.spend_limits;
create policy spend_limits_worker_read on mkt.spend_limits
  for select to mkt_worker using (true);
drop policy if exists spend_limits_executor_read on mkt.spend_limits;
create policy spend_limits_executor_read on mkt.spend_limits
  for select to mkt_executor using (true);

drop policy if exists claude_runs_read on mkt.claude_runs;
create policy claude_runs_read on mkt.claude_runs
  for select to authenticated using ((select authz.can('view_traffic')));
drop policy if exists claude_runs_worker_read on mkt.claude_runs;
create policy claude_runs_worker_read on mkt.claude_runs
  for select to mkt_worker using (true);

drop policy if exists traffic_actions_read on mkt.traffic_actions;
create policy traffic_actions_read on mkt.traffic_actions
  for select to authenticated using ((select authz.can('view_traffic')));
drop policy if exists traffic_actions_worker_read on mkt.traffic_actions;
create policy traffic_actions_worker_read on mkt.traffic_actions
  for select to mkt_worker using (true);
drop policy if exists traffic_actions_executor_read on mkt.traffic_actions;
create policy traffic_actions_executor_read on mkt.traffic_actions
  for select to mkt_executor using (true);

drop policy if exists traffic_stops_read on mkt.traffic_stops;
create policy traffic_stops_read on mkt.traffic_stops
  for select to authenticated using ((select authz.can('view_traffic')));
drop policy if exists traffic_stops_executor_read on mkt.traffic_stops;
create policy traffic_stops_executor_read on mkt.traffic_stops
  for select to mkt_executor using (true);

drop policy if exists traffic_stop_campaigns_read on mkt.traffic_stop_campaigns;
create policy traffic_stop_campaigns_read on mkt.traffic_stop_campaigns
  for select to authenticated using ((select authz.can('view_traffic')));
drop policy if exists traffic_stop_campaigns_executor_read on mkt.traffic_stop_campaigns;
create policy traffic_stop_campaigns_executor_read on mkt.traffic_stop_campaigns
  for select to mkt_executor using (true);

drop policy if exists platform_executions_read on mkt.platform_executions;
create policy platform_executions_read on mkt.platform_executions
  for select to authenticated using ((select authz.can('view_traffic')));
drop policy if exists platform_executions_executor_read on mkt.platform_executions;
create policy platform_executions_executor_read on mkt.platform_executions
  for select to mkt_executor using (true);

drop policy if exists traffic_log_read on mkt.traffic_log;
create policy traffic_log_read on mkt.traffic_log
  for select to authenticated using ((select authz.can('view_traffic')));

-- ---------- Quem lê e quem executa ----------
-- authenticated já tem só select pelo privilégio padrão de mkt (migração 01). Os serviços, tabela por tabela.
grant select on mkt.traffic_strategies, mkt.spend_limits, mkt.claude_runs, mkt.traffic_actions to mkt_worker;
grant select on mkt.spend_limits, mkt.traffic_actions, mkt.traffic_stops, mkt.traffic_stop_campaigns,
  mkt.platform_executions to mkt_executor;

-- As conferências de jsonb ficam com o padrão de mkt (a tela, o worker e o executor): são regras puras, sem leitura
-- de tabela. Os gatilhos ninguém chama: só o dono, pelas tabelas.
revoke all on function private.traffic_actions_code(), private.traffic_actions_transition(),
  private.traffic_actions_log(), private.platform_executions_guard(), private.platform_executions_log()
  from public, anon, authenticated;

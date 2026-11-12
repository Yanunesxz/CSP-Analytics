-- Migração 09 · funções de ação da tela e as de leitura com regra própria (docs/dados/plano.md, "Ordem das
--   migrações"; docs/dados/papeis-e-rls.md, "Funções de ação")
--
-- O que faz: cria as funções api.* que a tela chama para gravar: propor, aprovar, descartar e marcar como feita uma
--   ação; estratégia, limite de gasto, "Parar tudo" e desfazer, "Tentar de novo" numa execução e o operador da
--   campanha; "Tentar de novo", ligar e desligar um conector, confirmar exclusão em massa e enviar CSV; convidar,
--   revogar convite, mudar papel e tirar acesso; tema, avisos e "Meus filtros". E as de leitura com regra própria:
--   api.my_profile, api.my_permissions, api.list_role_permissions, api.check_text, api.list_users,
--   api.credential_status e api.my_notification_preferences. Toda função de api é security definer, com search_path
--   pg_catalog, pg_temp (o esquema temporário da sessão por último), confere a permissão antes de tudo (authz.can;
--   nas de usuários, logo depois da trava de uma chamada por vez; my_profile responde a qualquer pessoa logada),
--   recusa com o código HTTP no sqlstate e o código da tela na mensagem (PT403, PT404, PT409 e PT422; o motivo,
--   quando ajuda a tela, no detail) e só authenticated executa.
--   Cria private.validate_action (a conferência da ação, a mesma da proposta do Claude) e, adiantadas da migração 10
--   porque as funções de ação gravam a fila na mesma transação: private.queue_execution,
--   private.queue_stop_executions, private.queue_spend_cap (o teto da conta na Meta), mkt.execution_may_increase_spend
--   e o pedido no formato de cada plataforma (private.execution_request).
-- Risco: médio. É por aqui que a tela grava: uma conferência errada deixaria alguém gravar o que não pode. Os
--   gatilhos das migrações 03, 04 e 07 conferem de novo quem pede (session_user e permissão). Não toca em dado: só
--   cria funções.
-- Como reverter (só no projeto de teste, antes de produção, e depois de reverter as migrações seguintes): apagar as
--   funções de api (até a 11 só existem estas) e as desta migração nos outros esquemas:
--   select format('drop function %s;', p.oid::regprocedure) from pg_proc p
--    where p.pronamespace = 'api'::regnamespace;   -- e rodar o que sair
--   drop function private.validate_action(mkt.brand_code, mkt.platform, uuid, mkt.action_kind, text, text, jsonb,
--     mkt.level, mkt.level, bigint), private.queue_execution(uuid),
--     private.queue_stop_executions(uuid, mkt.execution_operation), private.queue_spend_cap(uuid, bigint),
--     private.cancel_action_executions(uuid),
--     private.execution_request(mkt.execution_operation, mkt.platform, jsonb, text),
--     private.write_credential_ok(uuid), private.is_stale(timestamptz, timestamptz),
--     private.valid_note(text, integer, integer), private.domain_codes(regtype),
--     mkt.execution_may_increase_spend(uuid), mkt.csv_header_has_personal_data(text);
-- Conferir (cada função de api: definer, search_path pg_catalog, pg_temp e quem executa):
--   select p.oid::regprocedure, p.prosecdef, p.proconfig,
--          has_function_privilege('authenticated', p.oid, 'execute') as tela,
--          has_function_privilege('anon', p.oid, 'execute') as anon,
--          has_function_privilege('mkt_worker', p.oid, 'execute') as worker
--     from pg_proc p where p.pronamespace = 'api'::regnamespace order by 1;

-- ---------- Apoio: trava otimista, textos e listas ----------

-- Trava otimista (seção 9 do padrão): a tela manda o updated_at que leu. Em milissegundos, como o banco grava: o valor
-- lido volta igual (texto no Supabase, Date no PGlite). Sem o valor lido, nunca confere.
create or replace function private.is_stale(p_current timestamptz, p_expected timestamptz) returns boolean
language sql stable parallel safe set search_path = pg_catalog, pg_temp as $$
  select p_expected is null
      or date_trunc('milliseconds', p_current) is distinct from date_trunc('milliseconds', p_expected)
$$;

-- Nota, motivo ou resultado escrito na tela: o tamanho do campo e nada de e-mail, telefone ou documento. É a regra dos
-- check das tabelas, conferida antes para a tela saber o que corrigir.
create or replace function private.valid_note(p_note text, p_min integer, p_max integer) returns boolean
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select p_note is not null and length(p_note) between p_min and p_max and not mkt.has_personal_data(p_note)
$$;

-- Os códigos de uma lista fechada, na ordem dela (listas.md): a lista mora só no check do domain.
create or replace function private.domain_codes(p_domain regtype) returns text[]
language sql stable parallel safe set search_path = pg_catalog, pg_temp as $$
  select coalesce(array_agg(m.found[1] order by m.n), '{}')
    from pg_catalog.pg_constraint c
   cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([^'']*)''', 'g') with ordinality as m(found, n)
   where c.contypid = p_domain and c.contype = 'c'
$$;

-- O arquivo CSV de reserva é relatório de campanha (decisão 0035): coluna de pessoa no cabeçalho (nome, e-mail,
-- telefone, documento, endereço) recusa o arquivo inteiro (CSV_PERSONAL_DATA, integracoes.md, seção 12). "Nome da
-- campanha" e "Campaign name" passam. A conferência linha a linha é do worker.
create or replace function mkt.csv_header_has_personal_data(p_content text) returns boolean
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select exists (
    select 1
      from regexp_split_to_table(split_part(regexp_replace(coalesce(p_content, ''), '^﻿', ''), E'\n', 1),
                                 '[,;\t]') as h(raw)
     cross join lateral (
       select btrim(regexp_replace(translate(lower(h.raw), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
                                   '[^a-z0-9]+', ' ', 'g')) as col
     ) n
     where n.col ~ '^(nome|name|nome completo|full name|first name|last name|primeiro nome|sobrenome)$'
        or n.col ~ '\m(e ?mail|telefone|phone|celular|whatsapp|cpf|cnpj|documento|endereco|address)\M')
$$;

-- ---------- A fila de execução (adiantada da migração 10) ----------
-- As funções de ação criam a execução na mesma transação (integracoes.md, seção 14). Ninguém além das funções do dono
-- (api, gatilhos e pg_cron) chama as de private; o gatilho platform_executions_guard confere de novo quem pede e a
-- origem.

-- O pedido de cada execução, no formato da plataforma (integracoes.md, seção 14; decisão 0038): sempre o valor final,
-- nunca um incremento. Pausar e reativar; o orçamento diário (Meta em centavos, TikTok em reais, Google em micros);
-- criar, sempre pausada, com os campos que cada plataforma exige e o código da ação no fim do nome (o executor procura
-- o nome antes de criar); e o teto da conta na Meta, em reais, com reset. A mesma conta serve à fila e, no executor, à
-- conferência de que o pedido ainda é o aprovado (migração 10).
create or replace function private.execution_request(p_operation mkt.execution_operation, p_platform mkt.platform,
                                                     p_params jsonb default '{}', p_action_code text default null)
returns jsonb
language sql immutable set search_path = pg_catalog, pg_temp as $$
  with v as (
    select (p_params ->> 'daily_budget_cents')::bigint as budget_cents,
           (p_params ->> 'spend_cap_cents')::bigint as cap_cents,
           case when p_action_code is null
                     or right(lower(p_params ->> 'name'), length(p_action_code) + 1) = '-' || lower(p_action_code)
                then p_params ->> 'name'
                else (p_params ->> 'name') || '-' || lower(p_action_code)
           end as name
  )
  select case p_operation
    when 'pause' then
      case p_platform when 'tiktok' then jsonb_build_object('operation_status', 'DISABLE')
                      else jsonb_build_object('status', 'PAUSED') end
    when 'activate' then
      case p_platform when 'meta' then jsonb_build_object('status', 'ACTIVE')
                      when 'tiktok' then jsonb_build_object('operation_status', 'ENABLE')
                      else jsonb_build_object('status', 'ENABLED') end
    when 'set_daily_budget' then
      case p_platform when 'meta' then jsonb_build_object('daily_budget', v.budget_cents)
                      when 'tiktok' then jsonb_build_object('budget', trim_scale(v.budget_cents / 100.0))
                      else jsonb_build_object('amount_micros', v.budget_cents * 10000) end
    when 'create_campaign' then
      case p_platform
        when 'meta' then jsonb_build_object(
          'name', v.name, 'objective', p_params -> 'objective', 'status', 'PAUSED',
          'special_ad_categories', p_params -> 'special_ad_categories', 'daily_budget', v.budget_cents)
        when 'tiktok' then jsonb_build_object(
          'campaign_name', v.name, 'objective_type', p_params -> 'objective', 'budget_mode', p_params -> 'budget_mode',
          'budget', trim_scale(v.budget_cents / 100.0), 'operation_status', 'DISABLE')
        else jsonb_build_object(
          'name', v.name, 'advertising_channel_type', p_params -> 'advertising_channel_type',
          'bidding_strategy', p_params -> 'bidding_strategy', 'status', 'PAUSED',
          'amount_micros', v.budget_cents * 10000, 'contains_eu_political_advertising', false)
      end
    when 'set_account_spend_cap' then
      jsonb_build_object('spend_cap', trim_scale(v.cap_cents / 100.0), 'spend_cap_action', 'reset')
  end
  from v
$$;

-- Credencial de escrita ligada para a conta (integracoes.md, seção 18): a linha de estado da plataforma, válida ou
-- vencendo logo e ainda no prazo, para todas as contas (account_ref nulo) ou para esta. O segredo fica no executor.
create or replace function private.write_credential_ok(p_ad_account_id uuid) returns boolean
language sql stable set search_path = pg_catalog, pg_temp as $$
  select exists (
    select 1
      from mkt.ad_accounts a
      join mkt.connectors k
        on k.code = case a.platform when 'meta' then 'meta' when 'tiktok' then 'tiktok' else 'google_ads' end
      join private.connector_credentials cc on cc.connector_id = k.id
     where a.id = p_ad_account_id
       and cc.purpose = 'write' and cc.status in ('valid', 'expiring')
       and (cc.expires_at is null or cc.expires_at > now())
       and (cc.account_ref is null or cc.account_ref = a.external_id))
$$;

-- Operação que pode aumentar o gasto (metricas.md, seção 4.5): reativar, criar e mudar o orçamento diário para mais
-- que o atual da campanha (ou com o atual desconhecido). Pausar, reduzir e o teto da conta, não. "Parar tudo" bloqueia
-- as da fila (api.stop_all); o executor confere a mesma regra em mkt.execution_allowed (migração 10).
create or replace function mkt.execution_may_increase_spend(p_execution_id uuid) returns boolean
language sql stable set search_path = pg_catalog, pg_temp as $$
  select case e.operation
           when 'activate' then true
           when 'create_campaign' then true
           when 'set_daily_budget' then coalesce((a.params ->> 'daily_budget_cents')::bigint > c.daily_budget_cents, true)
           else false
         end
    from mkt.platform_executions e
    left join mkt.traffic_actions a on a.id = e.traffic_action_id
    left join mkt.campaigns c on c.id = e.campaign_id
   where e.id = p_execution_id
$$;

-- A execução de uma ação aprovada, quando o tipo executa numa plataforma: pausar, orçamento e criar. Lance, criativo e
-- pendência não executam pela central (a tela diz "Faça na plataforma e marque como feita"): devolve nulo.
create or replace function private.queue_execution(p_action_id uuid) returns uuid
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  v mkt.traffic_actions;
  v_operation mkt.execution_operation;
  v_id uuid := gen_random_uuid();
begin
  select a.* into v from mkt.traffic_actions a where a.id = p_action_id;
  if not found or v.status <> 'approved' then
    raise sqlstate 'PT422' using message = 'TRF-422';
  end if;
  v_operation := case v.kind when 'pause' then 'pause' when 'budget' then 'set_daily_budget'
                             when 'create' then 'create_campaign' end;
  if v_operation is null then
    return null;
  end if;
  insert into mkt.platform_executions (id, brand_id, platform, ad_account_id, campaign_id, traffic_action_id,
                                       operation, request, idempotency_key)
  values (v_id, v.brand_id, v.platform, v.ad_account_id, v.campaign_id, v.id, v_operation,
          private.execution_request(v_operation, v.platform, v.params, v.code), v_id::text);
  return v_id;
end $$;

-- Uma execução por campanha de uma parada (decisão 0022): pausar todas as da parada; ao desfazer, reativar só as que a
-- última leitura mostra pausadas e que não estão em outra parada aberta. A chave de idempotência é a da campanha na
-- parada e a operação: pedir de novo não duplica.
create or replace function private.queue_stop_executions(p_stop_id uuid, p_operation mkt.execution_operation)
returns integer
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  v_count integer;
begin
  if p_operation is null or p_operation not in ('pause', 'activate') then
    raise sqlstate 'PT422' using message = 'STP-422';
  end if;
  insert into mkt.platform_executions (brand_id, platform, ad_account_id, campaign_id, traffic_stop_campaign_id,
                                       operation, request, idempotency_key)
  select c.brand_id, c.platform, c.ad_account_id, c.id, sc.id, p_operation,
         private.execution_request(p_operation, c.platform), format('stop:%s:%s', sc.id, p_operation)
    from mkt.traffic_stop_campaigns sc
    join mkt.campaigns c on c.id = sc.campaign_id
   where sc.traffic_stop_id = p_stop_id
     and (p_operation = 'pause'
          or (c.status = 'paused'
              and not exists (select 1
                                from mkt.traffic_stop_campaigns o
                                join mkt.traffic_stops s on s.id = o.traffic_stop_id
                               where o.campaign_id = c.id and o.traffic_stop_id <> p_stop_id
                                 and s.undone_at is null)))
   order by sc.id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- O teto da conta na Meta (decisão 0021): grava com reset o valor pedido (a sobra do limite, quando o dono muda o
-- limite no meio do mês; o limite inteiro, no dia 1, pela migração 13). Só na Meta e só com a credencial de escrita
-- ligada; sem ela, nada (devolve nulo). Na Meta, teto 0 quer dizer "sem teto": o mínimo vai como R$ 0,01, e a
-- plataforma diz se aceita (integracoes.md, seção 19).
create or replace function private.queue_spend_cap(p_spend_limit_id uuid, p_spend_cap_cents bigint) returns uuid
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  v mkt.spend_limits;
  v_id uuid := gen_random_uuid();
begin
  select l.* into v from mkt.spend_limits l where l.id = p_spend_limit_id;
  if not found or v.platform <> 'meta' or not private.write_credential_ok(v.ad_account_id) then
    return null;
  end if;
  insert into mkt.platform_executions (id, brand_id, platform, ad_account_id, spend_limit_id, operation, request,
                                       idempotency_key)
  values (v_id, v.brand_id, v.platform, v.ad_account_id, v.id, 'set_account_spend_cap',
          private.execution_request('set_account_spend_cap', v.platform,
                                    jsonb_build_object('spend_cap_cents', greatest(coalesce(p_spend_cap_cents, 0), 1))),
          v_id::text);
  return v_id;
end $$;

-- A ação descartada ou feita à mão: a execução que ainda não saiu (na fila ou bloqueada) não vai mais acontecer
-- (decisão 0038).
create or replace function private.cancel_action_executions(p_action_id uuid) returns integer
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  v_count integer;
begin
  update mkt.platform_executions e
     set status = 'cancelled', cancelled_at = now(), blocked_reason = null
   where e.traffic_action_id = p_action_id and e.status in ('queued', 'blocked');
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------- A conferência da ação (a mesma da pessoa e do Claude) ----------

-- A ação proposta (papeis-e-rls.md, "Funções de ação"), conferida igual para a pessoa (api.propose_action) e para o
-- Claude (ingest.add_claude_proposal, migração 10): a marca existe; a campanha existe e é da marca e do canal; pausar e
-- ajustar orçamento pedem campanha, criar não tem; ajuste de orçamento só em campanha com orçamento próprio (com
-- orçamento nos conjuntos ou compartilhado: "ajuste na plataforma"); a conta é a da campanha ou, sem campanha, a única
-- conta ativa da marca no canal; os parâmetros são os do tipo e da plataforma; título e porquê no tamanho e sem dado
-- pessoal. Recusa com PT404 (não achou) ou PT422, com o motivo no detail. Devolve a marca e a conta.
create or replace function private.validate_action(
  p_brand mkt.brand_code, p_platform mkt.platform, p_campaign_id uuid, p_kind mkt.action_kind, p_title text,
  p_rationale text, p_params jsonb, p_impact mkt.level, p_effort mkt.level, p_cost_cents bigint,
  out brand_id uuid, out ad_account_id uuid)
language plpgsql stable set search_path = pg_catalog, pg_temp as $$
declare
  v_brand_id uuid;
  v_account_id uuid;
  v_campaign mkt.campaigns;
  v_accounts uuid[];
begin
  select b.id into v_brand_id from mkt.brands b where b.code = p_brand;
  if v_brand_id is null then
    raise sqlstate 'PT404' using message = 'TRF-404', detail = 'brand';
  end if;
  if p_kind is null or p_impact is null or p_effort is null then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'kind';
  end if;
  if p_kind <> 'pending_fix' and p_platform is null then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'platform';
  end if;

  if p_campaign_id is not null then
    select c.* into v_campaign from mkt.campaigns c where c.id = p_campaign_id;
    if not found then
      raise sqlstate 'PT404' using message = 'TRF-404', detail = 'campaign';
    end if;
    if v_campaign.brand_id <> v_brand_id or v_campaign.platform is distinct from p_platform then
      raise sqlstate 'PT422' using message = 'TRF-422', detail = 'campaign';
    end if;
  end if;
  if (p_kind = 'create' and p_campaign_id is not null) or (p_kind in ('pause', 'budget') and p_campaign_id is null) then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'campaign';
  end if;
  if p_kind = 'budget' and v_campaign.daily_budget_cents is null then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'shared_budget';
  end if;

  if p_campaign_id is not null then
    v_account_id := v_campaign.ad_account_id;
  elsif p_platform is not null then
    select array_agg(a.id) into v_accounts
      from mkt.ad_accounts a
     where a.brand_id = v_brand_id and a.platform = p_platform and a.is_active;
    if coalesce(cardinality(v_accounts), 0) <> 1 then
      raise sqlstate 'PT422' using message = 'TRF-422', detail = 'account';
    end if;
    v_account_id := v_accounts[1];
  end if;

  if not mkt.valid_action_params(p_kind, p_platform, coalesce(p_params, '{}')) then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'params';
  end if;
  if coalesce(length(p_title), 0) not between 5 and 140 or coalesce(length(p_rationale), 0) not between 10 and 2000 then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'text';
  end if;
  if mkt.has_personal_data(concat_ws(' ', p_title, p_rationale)) then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'personal_data';
  end if;
  if p_cost_cents < 0 then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'cost';
  end if;

  brand_id := v_brand_id;
  ad_account_id := v_account_id;
end $$;

-- ---------- Ações de tráfego ----------
-- As passagens de status e o diário da ação saem dos gatilhos da migração 07 (traffic_actions_transition e
-- traffic_actions_log), que conferem de novo o session_user e a permissão; as execuções, do gatilho
-- platform_executions_guard e do diário dele.

-- Propor (operate_traffic): a ideia nasce da pessoa, em nome dela. Com approve_now (o "Pausar" e o "Ajustar" da tela de
-- canal para o dono), já aprovada, o que pede também approve_action, com as duas linhas no diário e a execução na fila.
create or replace function api.propose_action(
  p_brand mkt.brand_code, p_platform mkt.platform, p_campaign_id uuid, p_kind mkt.action_kind, p_title text,
  p_rationale text, p_params jsonb, p_impact mkt.level, p_effort mkt.level, p_cost_cents bigint,
  p_approve_now boolean default false)
returns mkt.traffic_actions
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v mkt.traffic_actions;
  v_checked record;
  v_approve boolean := coalesce(p_approve_now, false);
begin
  if not authz.can('operate_traffic') or (v_approve and not authz.can('approve_action')) then
    raise sqlstate 'PT403' using message = 'TRF-403';
  end if;
  select * into v_checked
    from private.validate_action(p_brand, p_platform, p_campaign_id, p_kind, p_title, p_rationale, p_params,
                                 p_impact, p_effort, p_cost_cents);
  if v_approve and p_kind = 'pending_fix' then
    raise sqlstate 'PT422' using message = 'TRF-422';   -- pendência de medição não se aprova: resolve e marca feita
  end if;

  insert into mkt.traffic_actions (brand_id, platform, ad_account_id, campaign_id, kind, title, rationale, params,
                                   impact, effort, cost_cents, status, proposed_by_kind, proposed_by, approved_by,
                                   approved_at)
  values (v_checked.brand_id, p_platform, v_checked.ad_account_id, p_campaign_id, p_kind, p_title, p_rationale,
          coalesce(p_params, '{}'), p_impact, p_effort, p_cost_cents,
          case when v_approve then 'approved' else 'idea' end, 'human', auth.uid(),
          case when v_approve then auth.uid() end, case when v_approve then now() end)
  returning * into v;

  if v_approve then
    perform private.queue_execution(v.id);
  end if;
  return v;
end $$;

-- Aprovar (approve_action, com o segundo fator): ideia ou o que falhou ("Tentar de novo"), nunca pendência de medição.
-- Cria a execução na fila quando o tipo executa numa plataforma.
create or replace function api.approve_action(p_action_id uuid, p_expected_updated_at timestamptz)
returns mkt.traffic_actions
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v mkt.traffic_actions;
begin
  if not authz.can('approve_action') then
    raise sqlstate 'PT403' using message = 'TRF-403';
  end if;

  select a.* into v from mkt.traffic_actions a where a.id = p_action_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'TRF-404';
  end if;
  if private.is_stale(v.updated_at, p_expected_updated_at) then
    raise sqlstate 'PT409' using message = 'TRF-409';
  end if;
  if v.status not in ('idea', 'failed') or v.kind = 'pending_fix' then
    raise sqlstate 'PT422' using message = 'TRF-422';
  end if;

  update mkt.traffic_actions a
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where a.id = v.id
  returning * into v;                      -- o gatilho traffic_actions_log grava "action_approved"

  perform private.queue_execution(v.id);   -- execução em "queued" quando o tipo executa numa plataforma
  return v;
end $$;

-- Descartar (approve_action): ideia, aprovada ou que falhou, nunca com a execução já enviada à plataforma; motivo da
-- lista e texto de 10 a 1.000 letras, sem dado pessoal. A execução que ainda não saiu é cancelada.
create or replace function api.discard_action(p_action_id uuid, p_reason mkt.discard_reason, p_note text,
                                              p_expected_updated_at timestamptz)
returns mkt.traffic_actions
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v mkt.traffic_actions;
begin
  if not authz.can('approve_action') then
    raise sqlstate 'PT403' using message = 'TRF-403';
  end if;

  select a.* into v from mkt.traffic_actions a where a.id = p_action_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'TRF-404';
  end if;
  if private.is_stale(v.updated_at, p_expected_updated_at) then
    raise sqlstate 'PT409' using message = 'TRF-409';
  end if;
  if v.status not in ('idea', 'approved', 'failed')
     or exists (select 1 from mkt.platform_executions e where e.traffic_action_id = v.id and e.status = 'sent') then
    raise sqlstate 'PT422' using message = 'TRF-422';
  end if;
  if p_reason is null then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'reason';
  end if;
  if not private.valid_note(p_note, 10, 1000) then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'note';
  end if;

  update mkt.traffic_actions a
     set status = 'discarded', discarded_by = auth.uid(), discarded_at = now(), discard_reason = p_reason,
         discard_note = p_note
   where a.id = v.id
  returning * into v;
  perform private.cancel_action_executions(v.id);
  return v;
end $$;

-- Marcar como feita (operate_traffic): o que foi feito fora da central. Aprovada ou que falhou; em execução, só com a
-- execução bloqueada; e a pendência de medição direto da ideia. Resultado de 5 a 1.000 letras, sem dado pessoal. Não
-- preenche o aprovador; a execução que ainda não saiu é cancelada.
create or replace function api.mark_action_done(p_action_id uuid, p_result text, p_expected_updated_at timestamptz)
returns mkt.traffic_actions
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v mkt.traffic_actions;
begin
  if not authz.can('operate_traffic') then
    raise sqlstate 'PT403' using message = 'TRF-403';
  end if;

  select a.* into v from mkt.traffic_actions a where a.id = p_action_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'TRF-404';
  end if;
  if private.is_stale(v.updated_at, p_expected_updated_at) then
    raise sqlstate 'PT409' using message = 'TRF-409';
  end if;
  if not (v.status in ('approved', 'failed')
          or (v.status = 'idea' and v.kind = 'pending_fix')
          or (v.status = 'running'
              and exists (select 1 from mkt.platform_executions e
                           where e.traffic_action_id = v.id and e.status = 'blocked')
              and not exists (select 1 from mkt.platform_executions e
                               where e.traffic_action_id = v.id and e.status = 'queued')))
     or exists (select 1 from mkt.platform_executions e where e.traffic_action_id = v.id and e.status = 'sent') then
    raise sqlstate 'PT422' using message = 'TRF-422';
  end if;
  if not private.valid_note(p_result, 5, 1000) then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'result';
  end if;

  update mkt.traffic_actions a
     set status = 'done', done_via = 'manual', done_by = auth.uid(), executed_at = now(), result = p_result
   where a.id = v.id
  returning * into v;
  perform private.cancel_action_executions(v.id);
  return v;
end $$;

-- "Tentar de novo" numa execução bloqueada (approve_action): volta para a fila quando a origem ainda vale (a ação
-- aprovada ou em execução; a parada ainda aberta, para a pausa, ou desfeita, para reativar; o limite ainda vigente,
-- no teto da conta). O executor confere tudo de novo antes de mandar.
create or replace function api.retry_execution(p_execution_id uuid, p_expected_updated_at timestamptz)
returns mkt.platform_executions
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v mkt.platform_executions;
begin
  if not authz.can('approve_action') then
    raise sqlstate 'PT403' using message = 'TRF-403';
  end if;

  select e.* into v from mkt.platform_executions e where e.id = p_execution_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'TRF-404';
  end if;
  if private.is_stale(v.updated_at, p_expected_updated_at) then
    raise sqlstate 'PT409' using message = 'TRF-409';
  end if;
  if v.status <> 'blocked'
     or not coalesce(case
          when v.traffic_action_id is not null then
            exists (select 1 from mkt.traffic_actions a
                     where a.id = v.traffic_action_id and a.status in ('approved', 'running'))
          when v.traffic_stop_campaign_id is not null then
            exists (select 1
                      from mkt.traffic_stop_campaigns sc
                      join mkt.traffic_stops s on s.id = sc.traffic_stop_id
                     where sc.id = v.traffic_stop_campaign_id and (s.undone_at is null) = (v.operation = 'pause'))
          else
            v.spend_limit_id = (select l.id from mkt.spend_limits l
                                 where l.ad_account_id = v.ad_account_id and l.valid_from_on <= mkt.today()
                                 order by l.valid_from_on desc limit 1)
        end, false) then
    raise sqlstate 'PT422' using message = 'TRF-422';
  end if;

  update mkt.platform_executions e
     set status = 'queued', blocked_reason = null, queued_at = now()
   where e.id = v.id
  returning * into v;
  insert into mkt.traffic_log (event, brand_id, platform, actor_kind, actor_id, traffic_action_id, campaign_id,
                               traffic_stop_id, spend_limit_id, platform_execution_id)
  values ('execution_retried', v.brand_id, v.platform, 'user', auth.uid(), v.traffic_action_id, v.campaign_id,
          (select sc.traffic_stop_id from mkt.traffic_stop_campaigns sc where sc.id = v.traffic_stop_campaign_id),
          v.spend_limit_id, v.id);
  return v;
end $$;

-- Estratégia da marca no mês (operate_traffic): o mês pelo dia 1, texto até 4.000 letras sem dado pessoal (vai para o
-- Claude), verba e metas. Insere ou atualiza, com a trava otimista quando a linha já existe; cada campo que mudou vai
-- para o diário, {campo: {before, after}}. Nada mudou: nada é gravado.
create or replace function api.save_strategy(
  p_brand mkt.brand_code, p_month_on date, p_body text, p_budget_cents bigint,
  p_target_cost_per_new_customer_cents bigint, p_target_cost_per_lead_cents bigint, p_target_new_customers integer,
  p_expected_updated_at timestamptz)
returns mkt.traffic_strategies
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_brand_id uuid;
  v_old mkt.traffic_strategies;
  v mkt.traffic_strategies;
  v_body text := coalesce(p_body, '');
  v_changes jsonb;
begin
  if not authz.can('operate_traffic') then
    raise sqlstate 'PT403' using message = 'TRF-403';
  end if;
  select b.id into v_brand_id from mkt.brands b where b.code = p_brand;
  if v_brand_id is null then
    raise sqlstate 'PT404' using message = 'TRF-404', detail = 'brand';
  end if;
  if p_month_on is null or extract(day from p_month_on) <> 1 then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'month';
  end if;
  if length(v_body) > 4000 then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'text';
  end if;
  if mkt.has_personal_data(v_body) then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'personal_data';
  end if;
  if p_budget_cents < 0 or p_target_cost_per_new_customer_cents <= 0 or p_target_cost_per_lead_cents <= 0
     or p_target_new_customers <= 0 then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'targets';
  end if;

  -- Uma gravação por marca e mês de cada vez: a segunda vê a primeira (e a trava otimista recusa).
  perform pg_advisory_xact_lock(hashtext('mkt.save_strategy'), hashtext(v_brand_id::text || p_month_on::text));
  select s.* into v_old from mkt.traffic_strategies s
   where s.brand_id = v_brand_id and s.month_on = p_month_on for update;
  if found and private.is_stale(v_old.updated_at, p_expected_updated_at) then
    raise sqlstate 'PT409' using message = 'TRF-409';
  end if;

  select coalesce(jsonb_object_agg(x.field, jsonb_build_object('before', x.before, 'after', x.after)), '{}')
    into v_changes
    from (values ('body', to_jsonb(v_old.body), to_jsonb(v_body)),
                 ('budget_cents', to_jsonb(v_old.budget_cents), to_jsonb(p_budget_cents)),
                 ('target_cost_per_new_customer_cents', to_jsonb(v_old.target_cost_per_new_customer_cents),
                  to_jsonb(p_target_cost_per_new_customer_cents)),
                 ('target_cost_per_lead_cents', to_jsonb(v_old.target_cost_per_lead_cents),
                  to_jsonb(p_target_cost_per_lead_cents)),
                 ('target_new_customers', to_jsonb(v_old.target_new_customers), to_jsonb(p_target_new_customers))
         ) as x(field, before, after)
   where x.before is distinct from x.after;
  if v_old.id is not null and v_changes = '{}' then
    return v_old;
  end if;

  if v_old.id is null then
    insert into mkt.traffic_strategies (brand_id, month_on, body, budget_cents, target_cost_per_new_customer_cents,
                                        target_cost_per_lead_cents, target_new_customers, updated_by)
    values (v_brand_id, p_month_on, v_body, p_budget_cents, p_target_cost_per_new_customer_cents,
            p_target_cost_per_lead_cents, p_target_new_customers, auth.uid())
    returning * into v;
  else
    update mkt.traffic_strategies s
       set body = v_body, budget_cents = p_budget_cents,
           target_cost_per_new_customer_cents = p_target_cost_per_new_customer_cents,
           target_cost_per_lead_cents = p_target_cost_per_lead_cents,
           target_new_customers = p_target_new_customers, updated_by = auth.uid()
     where s.id = v_old.id
    returning * into v;
  end if;

  insert into mkt.traffic_log (event, brand_id, actor_kind, actor_id, traffic_strategy_id, changes)
  values ('strategy_saved', v.brand_id, 'user', auth.uid(), v.id, v_changes);
  return v;
end $$;

-- Limite de gasto da conta no mês (configure_traffic, com o segundo fator; decisão 0021): conta ativa, valor a partir
-- de 0, vale a partir de hoje em São Paulo (mudar duas vezes no mesmo dia atualiza a linha do dia). A trava otimista é
-- a da linha vigente, a que a tela mostrou (sem limite ainda, a tela manda nulo). Na Meta com credencial de escrita, o
-- teto da conta é regravado com a sobra do limite novo (limite − todo o gasto da conta no mês, de qualquer campanha), e
-- a gravação de teto que ainda não saiu fica cancelada (a nova vale).
create or replace function api.set_spend_limit(p_ad_account_id uuid, p_monthly_limit_cents bigint,
                                               p_expected_updated_at timestamptz)
returns mkt.spend_limits
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_account mkt.ad_accounts;
  v_current mkt.spend_limits;
  v mkt.spend_limits;
  v_today date := mkt.today();
  v_spent bigint;
begin
  if not authz.can('configure_traffic') then
    raise sqlstate 'PT403' using message = 'TRF-403';
  end if;
  if p_monthly_limit_cents is null or p_monthly_limit_cents < 0 then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'limit';
  end if;

  -- Um limite por conta de cada vez: a segunda gravação vê a primeira.
  perform pg_advisory_xact_lock(hashtext('mkt.spend_limit'), hashtext(coalesce(p_ad_account_id::text, '')));
  select a.* into v_account from mkt.ad_accounts a where a.id = p_ad_account_id;
  if not found then
    raise sqlstate 'PT404' using message = 'TRF-404';
  end if;
  if not v_account.is_active then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'account';
  end if;

  select l.* into v_current
    from mkt.spend_limits l
   where l.ad_account_id = v_account.id and l.valid_from_on <= v_today
   order by l.valid_from_on desc
   limit 1
     for update;
  if (v_current.id is null and p_expected_updated_at is not null)
     or (v_current.id is not null and private.is_stale(v_current.updated_at, p_expected_updated_at)) then
    raise sqlstate 'PT409' using message = 'TRF-409';
  end if;
  if v_current.monthly_limit_cents is not distinct from p_monthly_limit_cents then
    return v_current;   -- o mesmo limite: nada muda
  end if;

  insert into mkt.spend_limits (ad_account_id, brand_id, platform, monthly_limit_cents, valid_from_on, set_by)
  values (v_account.id, v_account.brand_id, v_account.platform, p_monthly_limit_cents, v_today, auth.uid())
  on conflict (ad_account_id, valid_from_on)
  do update set monthly_limit_cents = excluded.monthly_limit_cents, set_by = excluded.set_by
  returning * into v;

  insert into mkt.traffic_log (event, brand_id, platform, actor_kind, actor_id, spend_limit_id, changes)
  values ('limit_changed', v.brand_id, v.platform, 'user', auth.uid(), v.id,
          jsonb_build_object('monthly_limit_cents',
                             jsonb_build_object('before', v_current.monthly_limit_cents,
                                                'after', v.monthly_limit_cents)));

  update mkt.platform_executions e
     set status = 'cancelled', cancelled_at = now(), blocked_reason = null
   where e.ad_account_id = v.ad_account_id and e.operation = 'set_account_spend_cap'
     and e.status in ('queued', 'blocked');
  select coalesce(sum(d.spend_cents), 0)::bigint into v_spent
    from mkt.ad_campaign_daily d
    join mkt.campaigns c on c.id = d.campaign_id
   where c.ad_account_id = v.ad_account_id
     and d.metric_on between date_trunc('month', v_today::timestamp)::date and v_today;
  perform private.queue_spend_cap(v.id, v.monthly_limit_cents - v_spent);
  return v;
end $$;

-- "Parar tudo" (stop_all, sem o segundo fator: é o botão de emergência; decisão 0022): as campanhas ativas do Claude da
-- marca (nulo = as duas), em todos os canais, que ainda não estão numa parada aberta. A contagem é a que a tela mostrou
-- (senão PT409, e a tela confirma de novo). O que pode aumentar o gasto sai da fila (bloqueado, "stopped"), e cada
-- campanha ganha a sua pausa; o status da campanha só muda quando a plataforma confirmar.
create or replace function api.stop_all(p_brand mkt.brand_code, p_expected_count integer)
returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_stop uuid;
  v_brand uuid;
  v_count integer;
begin
  if not authz.can('stop_all') then
    raise sqlstate 'PT403' using message = 'STP-403';
  end if;
  -- Uma parada por vez: a segunda chamada espera a primeira e vê o que ela gravou.
  perform pg_advisory_xact_lock(hashtext('mkt.stop_all'));

  if p_brand is not null then
    select b.id into v_brand from mkt.brands b where b.code = p_brand;
    if v_brand is null then
      raise sqlstate 'PT404' using message = 'STP-404';
    end if;
  end if;

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
  if v_count is distinct from p_expected_count then
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

-- Desfazer a parada (stop_all): parada ainda aberta; a pausa dela que ainda não saiu fica cancelada (a campanha segue
-- como está), e reativa só as campanhas dela que a última leitura mostra pausadas e que não estão em outra parada
-- aberta. A reativação passa pelo limite do mês no executor, como todo aumento de gasto.
create or replace function api.undo_stop(p_stop_id uuid, p_expected_updated_at timestamptz)
returns mkt.traffic_stops
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v mkt.traffic_stops;
begin
  if not authz.can('stop_all') then
    raise sqlstate 'PT403' using message = 'STP-403';
  end if;
  perform pg_advisory_xact_lock(hashtext('mkt.stop_all'));

  select s.* into v from mkt.traffic_stops s where s.id = p_stop_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'STP-404';
  end if;
  if private.is_stale(v.updated_at, p_expected_updated_at) then
    raise sqlstate 'PT409' using message = 'STP-409';
  end if;
  if v.undone_at is not null then
    raise sqlstate 'PT422' using message = 'STP-422';
  end if;

  update mkt.platform_executions e
     set status = 'cancelled', cancelled_at = now(), blocked_reason = null
    from mkt.traffic_stop_campaigns sc
   where sc.traffic_stop_id = v.id and e.traffic_stop_campaign_id = sc.id
     and e.operation = 'pause' and e.status in ('queued', 'blocked');

  update mkt.traffic_stops s
     set undone_by = auth.uid(), undone_at = now()
   where s.id = v.id
  returning * into v;
  perform private.queue_stop_executions(v.id, 'activate');
  insert into mkt.traffic_log (event, brand_id, actor_kind, actor_id, traffic_stop_id)
  values ('stop_undone', v.brand_id, 'user', auth.uid(), v.id);
  return v;
end $$;

-- O operador da campanha (configure_traffic, com o segundo fator; decisão 0008): outro que o atual; motivo da lista
-- (passar para o Claude só para o Claude, voltar para o humano só para o humano; "outro" pede nota de 10 a 500 letras,
-- sem dado pessoal). A chave da transação deixa o gatilho trocar, e ele grava o histórico com o motivo e a nota.
create or replace function api.change_campaign_operator(p_campaign_id uuid, p_to_operator mkt.operator,
                                                        p_reason mkt.operator_change_reason, p_note text,
                                                        p_expected_updated_at timestamptz)
returns mkt.campaigns
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_old mkt.campaigns;
  v mkt.campaigns;
begin
  if not authz.can('configure_traffic') then
    raise sqlstate 'PT403' using message = 'TRF-403';
  end if;

  select c.* into v_old from mkt.campaigns c where c.id = p_campaign_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'TRF-404';
  end if;
  if private.is_stale(v_old.updated_at, p_expected_updated_at) then
    raise sqlstate 'PT409' using message = 'TRF-409';
  end if;
  if p_to_operator is null or p_to_operator = v_old.managed_by then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'operator';
  end if;
  if p_reason is null or p_reason not in ('handover_to_claude', 'back_to_human', 'correction', 'other')
     or (p_reason = 'handover_to_claude' and p_to_operator <> 'claude')
     or (p_reason = 'back_to_human' and p_to_operator <> 'human') then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'reason';
  end if;
  if (p_reason = 'other' or p_note is not null) and not private.valid_note(p_note, 10, 500) then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'note';
  end if;

  perform set_config('mkt.allow_operator_change', 'on', true);
  perform set_config('mkt.operator_change_reason', p_reason, true);
  perform set_config('mkt.operator_change_note', coalesce(p_note, ''), true);
  update mkt.campaigns c set managed_by = p_to_operator where c.id = v_old.id returning * into v;
  perform set_config('mkt.allow_operator_change', 'off', true);
  perform set_config('mkt.operator_change_reason', '', true);
  perform set_config('mkt.operator_change_note', '', true);

  insert into mkt.traffic_log (event, brand_id, platform, actor_kind, actor_id, campaign_id, changes)
  values ('operator_changed', v.brand_id, v.platform, 'user', auth.uid(), v.id,
          jsonb_build_object('managed_by', jsonb_build_object('before', v_old.managed_by, 'after', v.managed_by),
                             'reason', p_reason));
  return v;
end $$;

-- ---------- Conectores ----------

-- "Tentar de novo" (retry_connector, com o segundo fator): só no conector ligado. Pede a rodada do trabalho principal
-- (CRM: incremental; anúncios: o de hora em hora; Instagram, GA4 e Search Console: o diário), que o worker pega em até
-- 1 min. Se já há pedido ou rodada em andamento, devolve a mesma.
create or replace function api.retry_connector(p_connector_code mkt.connector_code)
returns mkt.sync_runs
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_connector mkt.connectors;
  v mkt.sync_runs;
begin
  if not authz.can('retry_connector') then
    raise sqlstate 'PT403' using message = 'CON-403';
  end if;
  select k.* into v_connector from mkt.connectors k where k.code = p_connector_code;
  if not found then
    raise sqlstate 'PT404' using message = 'CON-404';
  end if;
  if v_connector.setup_state <> 'connected' then
    raise sqlstate 'PT422' using message = 'CON-422';
  end if;

  perform pg_advisory_xact_lock(hashtext('mkt.retry_connector'), hashtext(v_connector.id::text));
  select r.* into v
    from mkt.sync_runs r
   where r.connector_id = v_connector.id
     and ((r.status = 'requested' and r.run_trigger = 'manual_retry') or (r.status = 'running' and r.job <> 'csv_import'))
   order by coalesce(r.started_at, r.requested_at, r.created_at) desc
   limit 1;
  if found then
    return v;
  end if;

  insert into mkt.sync_runs (connector_id, job, run_trigger, status, requested_by, requested_at)
  values (v_connector.id,
          case v_connector.code when 'csp360' then 'crm_incremental' when 'instagram' then 'ig_daily'
                                when 'ga4' then 'ga4_daily' when 'search_console' then 'gsc_daily'
                                else 'ads_hourly' end,
          'manual_retry', 'requested', auth.uid(), now())
  returning * into v;
  insert into mkt.audit_log (actor_kind, actor_id, event, target_table, target_id, changes)
  values ('user', auth.uid(), 'connector_retry_requested', 'sync_runs', v.id,
          jsonb_build_object('connector', v_connector.code, 'sync_run_id', v.id));
  return v;
end $$;

-- Ligar e desligar (retry_connector, com o segundo fator): o dono desliga e religa; "Ligado" só depois da primeira
-- rodada boa (o worker liga). Religar o que nunca deu certo volta para "A ligar".
create or replace function api.set_connector_state(p_connector_code mkt.connector_code,
                                                   p_state mkt.connector_setup_state,
                                                   p_expected_updated_at timestamptz)
returns mkt.connectors
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_old mkt.connectors;
  v mkt.connectors;
begin
  if not authz.can('retry_connector') then
    raise sqlstate 'PT403' using message = 'CON-403';
  end if;
  select k.* into v_old from mkt.connectors k where k.code = p_connector_code for update;
  if not found then
    raise sqlstate 'PT404' using message = 'CON-404';
  end if;
  if private.is_stale(v_old.updated_at, p_expected_updated_at) then
    raise sqlstate 'PT409' using message = 'CON-409';
  end if;
  if p_state is null or p_state = v_old.setup_state
     or (p_state = 'connected' and v_old.first_success_at is null)
     or (p_state = 'not_connected' and (v_old.setup_state <> 'disabled' or v_old.first_success_at is not null)) then
    raise sqlstate 'PT422' using message = 'CON-422';
  end if;

  update mkt.connectors k set setup_state = p_state where k.id = v_old.id returning * into v;
  insert into mkt.audit_log (actor_kind, actor_id, event, target_table, target_id, changes)
  values ('user', auth.uid(), 'connector_state_changed', 'connectors', v.id,
          jsonb_build_object('connector', v.code,
                             'setup_state', jsonb_build_object('before', v_old.setup_state, 'after', v.setup_state)));
  return v;
end $$;

-- Confirmar a exclusão em massa (retry_connector, com o segundo fator): a rodada que a trava de 20% segurou
-- (partial, MASS_DELETE_BLOCKED); a passada completa seguinte apaga (integracoes.md, seção 3.4). Confirmar de novo
-- não muda nada.
create or replace function api.confirm_mass_delete(p_run_id uuid)
returns mkt.sync_runs
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v mkt.sync_runs;
begin
  if not authz.can('retry_connector') then
    raise sqlstate 'PT403' using message = 'CON-403';
  end if;
  select r.* into v from mkt.sync_runs r where r.id = p_run_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'CON-404';
  end if;
  if v.status <> 'partial' or v.error_code is distinct from 'MASS_DELETE_BLOCKED' then
    raise sqlstate 'PT422' using message = 'CON-422';
  end if;
  if v.mass_delete_confirmed_at is not null then
    return v;
  end if;

  update mkt.sync_runs r
     set mass_delete_confirmed_by = auth.uid(), mass_delete_confirmed_at = now()
   where r.id = v.id
  returning * into v;
  insert into mkt.audit_log (actor_kind, actor_id, event, target_table, target_id, changes)
  values ('user', auth.uid(), 'mass_delete_confirmed', 'sync_runs', v.id,
          jsonb_build_object('connector', (select k.code from mkt.connectors k where k.id = v.connector_id),
                             'sync_run_id', v.id));
  return v;
end $$;

-- Enviar o CSV de reserva (retry_connector, com o segundo fator; decisão 0035): conector de anúncio, marca que existe,
-- nome de 1 a 200 letras, de 1 byte a 5 MB e nenhuma coluna de pessoa no cabeçalho. Grava o arquivo e a rodada pedida
-- dele, que o worker lê. A trilha é quem enviou e quem pediu. Devolve o id do arquivo (o conteúdo não volta).
create or replace function api.upload_csv(p_connector_code mkt.connector_code, p_brand mkt.brand_code,
                                          p_file_name text, p_content text)
returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_connector_id uuid;
  v_brand_id uuid;
  v_size integer := octet_length(p_content);
  v_run uuid;
  v_id uuid;
begin
  if not authz.can('retry_connector') then
    raise sqlstate 'PT403' using message = 'CON-403';
  end if;
  if p_connector_code is null or p_connector_code not in ('meta', 'tiktok', 'google_ads') then
    raise sqlstate 'PT422' using message = 'CON-422', detail = 'connector';
  end if;
  select k.id into v_connector_id from mkt.connectors k where k.code = p_connector_code;
  if v_connector_id is null then
    raise sqlstate 'PT404' using message = 'CON-404', detail = 'connector';
  end if;
  select b.id into v_brand_id from mkt.brands b where b.code = p_brand;
  if v_brand_id is null then
    raise sqlstate 'PT404' using message = 'CON-404', detail = 'brand';
  end if;
  if p_file_name is null or length(p_file_name) not between 1 and 200 then
    raise sqlstate 'PT422' using message = 'CON-422', detail = 'file_name';
  end if;
  if v_size is null or v_size not between 1 and 5242880 then
    raise sqlstate 'PT422' using message = 'CON-422', detail = 'size';
  end if;
  if mkt.csv_header_has_personal_data(p_content) then
    raise sqlstate 'PT422' using message = 'CON-422', detail = 'personal_data';
  end if;

  insert into mkt.sync_runs (connector_id, job, run_trigger, status, brand_id, requested_by, requested_at)
  values (v_connector_id, 'csv_import', 'csv_upload', 'requested', v_brand_id, auth.uid(), now())
  returning id into v_run;
  insert into mkt.csv_imports (connector_id, brand_id, file_name, size_bytes, content, uploaded_by, sync_run_id)
  values (v_connector_id, v_brand_id, p_file_name, v_size, p_content, auth.uid(), v_run)
  returning id into v_id;
  return v_id;
end $$;

-- ---------- Usuários ----------
-- Uma chamada por vez (papeis-e-rls.md, "Funções de ação"): a primeira linha é a trava, antes da permissão e da
-- contagem de donos. Duas chamadas ao mesmo tempo passam uma de cada vez, e a segunda vê o resultado da primeira.

-- Convidar (manage_users, com o segundo fator): e-mail válido (minúsculas, sem espaço), nome de 2 a 80 letras, papel;
-- o e-mail não tem perfil e não tem convite aberto (o vencido, que ainda conta como aberto, é revogado antes). O
-- convite vale 7 dias; a auditoria leva só o id e o papel. Devolve o id e o e-mail para a Edge Function convidar.
create or replace function api.invite_user(p_email text, p_display_name text, p_role mkt.role)
returns table (id uuid, email text, expires_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_email text := lower(btrim(p_email));
  v_name text := btrim(p_display_name);
  v_open mkt.invitations;
  v mkt.invitations;
begin
  perform pg_advisory_xact_lock(hashtext('mkt.manage_users'));
  if not authz.can('manage_users') then
    raise sqlstate 'PT403' using message = 'USR-403';
  end if;
  if v_email is null or length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise sqlstate 'PT422' using message = 'USR-422', detail = 'email';
  end if;
  if v_name is null or length(v_name) not between 2 and 80 then
    raise sqlstate 'PT422' using message = 'USR-422', detail = 'display_name';
  end if;
  if p_role is null then
    raise sqlstate 'PT422' using message = 'USR-422', detail = 'role';
  end if;
  if exists (select 1 from auth.users u join mkt.profiles p on p.id = u.id where lower(btrim(u.email)) = v_email) then
    raise sqlstate 'PT422' using message = 'USR-422', detail = 'has_profile';
  end if;

  select i.* into v_open
    from mkt.invitations i
   where i.email_normalized = v_email and i.accepted_at is null and i.revoked_at is null
     for update;
  if found then
    if v_open.expires_at > now() then
      raise sqlstate 'PT422' using message = 'USR-422', detail = 'open_invitation';
    end if;
    update mkt.invitations i set revoked_at = now(), revoked_by = auth.uid() where i.id = v_open.id;
    insert into mkt.audit_log (actor_kind, actor_id, event, target_table, target_id, changes)
    values ('user', auth.uid(), 'invite_revoked', 'invitations', v_open.id,
            jsonb_build_object('invitation_id', v_open.id));
  end if;

  insert into mkt.invitations (email_normalized, display_name, role, invited_by, expires_at)
  values (v_email, v_name, p_role, auth.uid(), now() + interval '7 days')
  returning * into v;
  insert into mkt.audit_log (actor_kind, actor_id, event, target_table, target_id, changes)
  values ('user', auth.uid(), 'invite_sent', 'invitations', v.id,
          jsonb_build_object('invitation_id', v.id, 'role', v.role));
  return query select v.id, v.email_normalized, v.expires_at;
end $$;

-- Revogar um convite aberto (manage_users, com o segundo fator).
create or replace function api.revoke_invitation(p_invitation_id uuid)
returns mkt.invitations
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v mkt.invitations;
begin
  perform pg_advisory_xact_lock(hashtext('mkt.manage_users'));
  if not authz.can('manage_users') then
    raise sqlstate 'PT403' using message = 'USR-403';
  end if;
  select i.* into v from mkt.invitations i where i.id = p_invitation_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'USR-404';
  end if;
  if v.accepted_at is not null or v.revoked_at is not null then
    raise sqlstate 'PT422' using message = 'USR-422';
  end if;

  update mkt.invitations i set revoked_at = now(), revoked_by = auth.uid() where i.id = v.id returning * into v;
  insert into mkt.audit_log (actor_kind, actor_id, event, target_table, target_id, changes)
  values ('user', auth.uid(), 'invite_revoked', 'invitations', v.id, jsonb_build_object('invitation_id', v.id));
  return v;
end $$;

-- Mudar o papel (manage_users, com o segundo fator): de outra pessoa com acesso. A chave da transação deixa o gatilho
-- profiles_guard trocar, e ele conta os donos ativos (o último não perde o papel). Os avisos na fila que o papel novo
-- não recebe viram "não enviado". O mesmo papel: nada muda.
create or replace function api.change_role(p_profile_id uuid, p_role mkt.role, p_expected_updated_at timestamptz)
returns mkt.profiles
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_old mkt.profiles;
  v mkt.profiles;
begin
  perform pg_advisory_xact_lock(hashtext('mkt.manage_users'));
  if not authz.can('manage_users') then
    raise sqlstate 'PT403' using message = 'USR-403';
  end if;
  select p.* into v_old from mkt.profiles p where p.id = p_profile_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'USR-404';
  end if;
  if private.is_stale(v_old.updated_at, p_expected_updated_at) then
    raise sqlstate 'PT409' using message = 'USR-409';
  end if;
  if v_old.id = auth.uid() or not v_old.is_active or p_role is null then
    raise sqlstate 'PT422' using message = 'USR-422';
  end if;
  if p_role = v_old.role then
    return v_old;
  end if;

  perform set_config('mkt.allow_role_change', 'on', true);
  update mkt.profiles p set role = p_role where p.id = v_old.id returning * into v;
  perform set_config('mkt.allow_role_change', 'off', true);

  update mkt.notification_outbox o
     set status = 'skipped'
   where o.profile_id = v.id and o.status = 'pending'
     and not exists (select 1 from mkt.role_permissions rp
                      where rp.role = v.role and rp.action = (mkt.notice_default(o.notice)).required_action);
  insert into mkt.audit_log (actor_kind, actor_id, event, target_table, target_id, changes)
  values ('user', auth.uid(), 'role_changed', 'profiles', v.id,
          jsonb_build_object('role', jsonb_build_object('before', v_old.role, 'after', v.role)));
  return v;
end $$;

-- Tirar o acesso (manage_users, com o segundo fator): de outra pessoa que ainda tem acesso; motivo da lista ("outro"
-- pede nota de 10 a 500 letras, sem dado pessoal). O gatilho conta os donos ativos (o último não perde o acesso). Saem
-- o WhatsApp, as preferências de aviso e os "Meus filtros" da pessoa, e os avisos dela na fila viram "não enviado". A
-- RLS nega na hora. Devolve o id e o e-mail do login para a Edge Function tirar-acesso (que bloqueia o login, derruba
-- as sessões e troca o e-mail). Para devolver o acesso, convide de novo.
create or replace function api.revoke_access(p_profile_id uuid, p_reason mkt.deactivation_reason, p_note text,
                                             p_expected_updated_at timestamptz)
returns table (id uuid, email text)
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_old mkt.profiles;
begin
  perform pg_advisory_xact_lock(hashtext('mkt.manage_users'));
  if not authz.can('manage_users') then
    raise sqlstate 'PT403' using message = 'USR-403';
  end if;
  select p.* into v_old from mkt.profiles p where p.id = p_profile_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'USR-404';
  end if;
  if private.is_stale(v_old.updated_at, p_expected_updated_at) then
    raise sqlstate 'PT409' using message = 'USR-409';
  end if;
  if v_old.id = auth.uid() or not v_old.is_active then
    raise sqlstate 'PT422' using message = 'USR-422';
  end if;
  if p_reason is null then
    raise sqlstate 'PT422' using message = 'USR-422', detail = 'reason';
  end if;
  if (p_reason = 'other' or p_note is not null) and not private.valid_note(p_note, 10, 500) then
    raise sqlstate 'PT422' using message = 'USR-422', detail = 'note';
  end if;

  perform set_config('mkt.allow_role_change', 'on', true);
  update mkt.profiles p
     set is_active = false, deactivated_at = now(), deactivated_by = auth.uid(), deactivation_reason = p_reason,
         deactivation_note = p_note, whatsapp_digits = null
   where p.id = v_old.id;
  perform set_config('mkt.allow_role_change', 'off', true);

  delete from mkt.notification_preferences np where np.profile_id = v_old.id;
  delete from mkt.saved_filters f where f.profile_id = v_old.id;
  update mkt.notification_outbox o set status = 'skipped' where o.profile_id = v_old.id and o.status = 'pending';
  insert into mkt.audit_log (actor_kind, actor_id, event, target_table, target_id, changes)
  values ('user', auth.uid(), 'access_revoked', 'profiles', v_old.id, jsonb_build_object('reason', p_reason));
  return query select v_old.id, (select u.email::text from auth.users u where u.id = v_old.id);
end $$;

-- ---------- Configurações da própria pessoa ----------

-- Tema, marca e visão padrão e o WhatsApp dos avisos (edit_settings), só do próprio perfil. O WhatsApp aceita máscara e
-- o número com ou sem o 55 e grava só dígitos, 55 + DDD + número; vazio tira o número.
create or replace function api.save_profile_preferences(p_theme mkt.theme_preference, p_default_brand mkt.brand_code,
                                                        p_default_view mkt.view_mode, p_whatsapp_digits text)
returns mkt.profiles
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v mkt.profiles;
  v_digits text := nullif(regexp_replace(coalesce(p_whatsapp_digits, ''), '[^0-9]', '', 'g'), '');
begin
  if not authz.can('edit_settings') then
    raise sqlstate 'PT403' using message = 'CFG-403';
  end if;
  if p_theme is null or p_default_view is null then
    raise sqlstate 'PT422' using message = 'CFG-422', detail = 'preferences';
  end if;
  if length(v_digits) in (10, 11) then
    v_digits := '55' || v_digits;
  end if;
  if v_digits !~ '^55[0-9]{10,11}$' then
    raise sqlstate 'PT422' using message = 'CFG-422', detail = 'whatsapp';
  end if;

  update mkt.profiles p
     set theme_preference = p_theme, default_brand = p_default_brand, default_view = p_default_view,
         whatsapp_digits = v_digits
   where p.id = auth.uid()
  returning * into v;
  return v;
end $$;

-- Um aviso e os canais dele (edit_settings), só da própria pessoa e só aviso que o papel dela recebe (a regra de
-- mkt.notice_default: quem não pode ver o que o aviso aponta não recebe).
create or replace function api.save_notification_preference(p_notice mkt.notice_kind, p_email boolean,
                                                            p_whatsapp boolean)
returns mkt.notification_preferences
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v mkt.notification_preferences;
begin
  if not authz.can('edit_settings') then
    raise sqlstate 'PT403' using message = 'CFG-403';
  end if;
  if p_notice is null or p_email is null or p_whatsapp is null then
    raise sqlstate 'PT422' using message = 'CFG-422', detail = 'preference';
  end if;
  if not exists (select 1
                   from mkt.profiles p
                   join mkt.role_permissions rp on rp.role = p.role
                  where p.id = auth.uid() and rp.action = (mkt.notice_default(p_notice)).required_action) then
    raise sqlstate 'PT422' using message = 'CFG-422', detail = 'notice';
  end if;

  insert into mkt.notification_preferences (profile_id, notice, is_email_enabled, is_whatsapp_enabled)
  values (auth.uid(), p_notice, p_email, p_whatsapp)
  on conflict (profile_id, notice)
  do update set is_email_enabled = excluded.is_email_enabled, is_whatsapp_enabled = excluded.is_whatsapp_enabled
  returning * into v;
  return v;
end $$;

-- "Meus filtros" (edit_settings), só os próprios: nome de 1 a 40 letras e só as chaves de filtro daquela barra.
-- Salvar de novo com o mesmo nome substitui (o id continua o mesmo).
create or replace function api.save_filter(p_scope mkt.saved_filter_scope, p_name text, p_filters jsonb)
returns mkt.saved_filters
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v mkt.saved_filters;
  v_name text := btrim(p_name);
begin
  if not authz.can('edit_settings') then
    raise sqlstate 'PT403' using message = 'CFG-403';
  end if;
  if p_scope is null or v_name is null or length(v_name) not between 1 and 40 then
    raise sqlstate 'PT422' using message = 'CFG-422', detail = 'name';
  end if;
  if not mkt.valid_saved_filters(p_scope, coalesce(p_filters, '{}')) then
    raise sqlstate 'PT422' using message = 'CFG-422', detail = 'filters';
  end if;

  insert into mkt.saved_filters (profile_id, scope, name, filters)
  values (auth.uid(), p_scope, v_name, coalesce(p_filters, '{}'))
  on conflict (profile_id, scope, name) do update set filters = excluded.filters
  returning * into v;
  return v;
end $$;

-- Apagar um dos próprios "Meus filtros" (edit_settings). O de outra pessoa não aparece: PT404.
create or replace function api.delete_saved_filter(p_id uuid)
returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if not authz.can('edit_settings') then
    raise sqlstate 'PT403' using message = 'CFG-403';
  end if;
  delete from mkt.saved_filters f where f.id = p_id and f.profile_id = auth.uid();
  if not found then
    raise sqlstate 'PT404' using message = 'CFG-404';
  end if;
end $$;

-- ---------- Leitura com regra própria ----------

-- O próprio perfil e o e-mail do login, de qualquer pessoa logada: também com o acesso tirado, para a tela dizer "Seu
-- acesso foi tirado". Sem perfil, nada.
create or replace function api.my_profile()
returns table (id uuid, email text, display_name text, role mkt.role, is_active boolean,
               theme_preference mkt.theme_preference, default_brand mkt.brand_code, default_view mkt.view_mode,
               whatsapp_digits text, deactivated_at timestamptz, created_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select p.id, u.email::text, p.display_name, p.role, p.is_active, p.theme_preference, p.default_brand,
         p.default_view, p.whatsapp_digits, p.deactivated_at, p.created_at, p.updated_at
    from mkt.profiles p
    left join auth.users u on u.id = p.id
   where p.id = auth.uid()
$$;

-- As ações do perfil ativo (role_permissions, a única lista), quais pedem o segundo fator e se valem agora (com o
-- segundo fator da sessão): a tela mostra ou esconde os botões. Sem perfil ativo, nenhuma.
create or replace function api.my_permissions()
returns table (action mkt.app_action, requires_second_factor boolean, is_allowed boolean)
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select rp.action, authz.requires_second_factor(rp.action), authz.can(rp.action)
    from mkt.profiles p
    join mkt.role_permissions rp on rp.role = p.role
   where p.id = auth.uid() and p.is_active
   order by array_position(private.domain_codes('mkt.app_action'), rp.action::text)
$$;

-- O quadro "Pode / Não pode" dos dois papéis (tela de Usuários): papel, ação e se pede o segundo fator, para quem tem
-- perfil ativo (a regra da política de role_permissions).
create or replace function api.list_role_permissions()
returns table (role mkt.role, action mkt.app_action, requires_second_factor boolean)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  if not authz.is_active_user() then
    raise sqlstate 'PT403' using message = 'USR-403';
  end if;
  return query
    select rp.role, rp.action, authz.requires_second_factor(rp.action)
      from mkt.role_permissions rp
     order by array_position(private.domain_codes('mkt.role'), rp.role::text),
              array_position(private.domain_codes('mkt.app_action'), rp.action::text);
end $$;

-- Se o texto tem dado pessoal (e-mail, telefone, CPF, CNPJ), pela mesma regra dos check do banco: a tela avisa antes de
-- enviar (decisão 0018). Para quem tem perfil ativo.
create or replace function api.check_text(p_text text)
returns boolean
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  if not authz.is_active_user() then
    raise sqlstate 'PT403' using message = 'USR-403';
  end if;
  return mkt.has_personal_data(p_text);
end $$;

-- Usuários (manage_users, com o segundo fator): nome, e-mail do login, papel e acesso de todos, o dono primeiro e
-- depois o nome.
create or replace function api.list_users()
returns table (id uuid, display_name text, email text, role mkt.role, is_active boolean, deactivated_at timestamptz,
               created_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  if not authz.can('manage_users') then
    raise sqlstate 'PT403' using message = 'USR-403';
  end if;
  return query
    select p.id, p.display_name, u.email::text, p.role, p.is_active, p.deactivated_at, p.created_at, p.updated_at
      from mkt.profiles p
      left join auth.users u on u.id = p.id
     order by p.role <> 'owner', lower(p.display_name), p.id;
end $$;

-- O estado das credenciais (view_connectors): conector, finalidade, conta, estado e validade. Nunca o segredo nem o
-- apontador para ele.
create or replace function api.credential_status()
returns table (connector mkt.connector_code, purpose mkt.credential_purpose, account_ref text,
               status mkt.credential_status, expires_at timestamptz, last_checked_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  if not authz.can('view_connectors') then
    raise sqlstate 'PT403' using message = 'CON-403';
  end if;
  return query
    select k.code, cc.purpose, cc.account_ref, cc.status, cc.expires_at, cc.last_checked_at
      from private.connector_credentials cc
      join mkt.connectors k on k.id = cc.connector_id
     order by k.code, cc.purpose, cc.account_ref nulls first;
end $$;

-- Os avisos da própria pessoa (edit_settings), na ordem da lista: só os que o papel dela recebe (mkt.notice_default),
-- com a escolha dela ou, sem linha, o padrão (e-mail em tudo, WhatsApp só no urgente).
create or replace function api.my_notification_preferences()
returns table (notice mkt.notice_kind, is_email_enabled boolean, is_whatsapp_enabled boolean, is_urgent boolean,
               is_default boolean)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  if not authz.can('edit_settings') then
    raise sqlstate 'PT403' using message = 'CFG-403';
  end if;
  return query
    select n.code::mkt.notice_kind, coalesce(np.is_email_enabled, d.is_email_enabled),
           coalesce(np.is_whatsapp_enabled, d.is_whatsapp_enabled), d.is_urgent, np.id is null
      from unnest(private.domain_codes('mkt.notice_kind')) with ordinality as n(code, pos)
     cross join lateral mkt.notice_default(n.code::mkt.notice_kind) d
      join mkt.profiles p on p.id = auth.uid()
      join mkt.role_permissions rp on rp.role = p.role and rp.action = d.required_action
      left join mkt.notification_preferences np on np.profile_id = p.id and np.notice = n.code
     order by n.pos;
end $$;

-- ---------- Quem executa ----------
-- As de api, só a tela (authenticated), uma a uma: nenhuma pelo worker, pelo executor, pelo n8n nem pelos scripts. As
-- de private, ninguém: só as funções do dono (api, gatilhos, pg_cron) chamam. As regras de mkt ficam com o padrão do
-- esquema (a tela, o worker e o executor), escrito aqui.

revoke all on function api.propose_action(mkt.brand_code, mkt.platform, uuid, mkt.action_kind, text, text, jsonb,
  mkt.level, mkt.level, bigint, boolean) from public, anon;
grant execute on function api.propose_action(mkt.brand_code, mkt.platform, uuid, mkt.action_kind, text, text, jsonb,
  mkt.level, mkt.level, bigint, boolean) to authenticated;
revoke all on function api.approve_action(uuid, timestamptz) from public, anon;
grant execute on function api.approve_action(uuid, timestamptz) to authenticated;
revoke all on function api.discard_action(uuid, mkt.discard_reason, text, timestamptz) from public, anon;
grant execute on function api.discard_action(uuid, mkt.discard_reason, text, timestamptz) to authenticated;
revoke all on function api.mark_action_done(uuid, text, timestamptz) from public, anon;
grant execute on function api.mark_action_done(uuid, text, timestamptz) to authenticated;
revoke all on function api.retry_execution(uuid, timestamptz) from public, anon;
grant execute on function api.retry_execution(uuid, timestamptz) to authenticated;
revoke all on function api.save_strategy(mkt.brand_code, date, text, bigint, bigint, bigint, integer, timestamptz)
  from public, anon;
grant execute on function api.save_strategy(mkt.brand_code, date, text, bigint, bigint, bigint, integer, timestamptz)
  to authenticated;
revoke all on function api.set_spend_limit(uuid, bigint, timestamptz) from public, anon;
grant execute on function api.set_spend_limit(uuid, bigint, timestamptz) to authenticated;
revoke all on function api.stop_all(mkt.brand_code, integer) from public, anon;
grant execute on function api.stop_all(mkt.brand_code, integer) to authenticated;
revoke all on function api.undo_stop(uuid, timestamptz) from public, anon;
grant execute on function api.undo_stop(uuid, timestamptz) to authenticated;
revoke all on function api.change_campaign_operator(uuid, mkt.operator, mkt.operator_change_reason, text, timestamptz)
  from public, anon;
grant execute on function api.change_campaign_operator(uuid, mkt.operator, mkt.operator_change_reason, text,
  timestamptz) to authenticated;
revoke all on function api.retry_connector(mkt.connector_code) from public, anon;
grant execute on function api.retry_connector(mkt.connector_code) to authenticated;
revoke all on function api.set_connector_state(mkt.connector_code, mkt.connector_setup_state, timestamptz)
  from public, anon;
grant execute on function api.set_connector_state(mkt.connector_code, mkt.connector_setup_state, timestamptz)
  to authenticated;
revoke all on function api.confirm_mass_delete(uuid) from public, anon;
grant execute on function api.confirm_mass_delete(uuid) to authenticated;
revoke all on function api.upload_csv(mkt.connector_code, mkt.brand_code, text, text) from public, anon;
grant execute on function api.upload_csv(mkt.connector_code, mkt.brand_code, text, text) to authenticated;
revoke all on function api.invite_user(text, text, mkt.role) from public, anon;
grant execute on function api.invite_user(text, text, mkt.role) to authenticated;
revoke all on function api.revoke_invitation(uuid) from public, anon;
grant execute on function api.revoke_invitation(uuid) to authenticated;
revoke all on function api.change_role(uuid, mkt.role, timestamptz) from public, anon;
grant execute on function api.change_role(uuid, mkt.role, timestamptz) to authenticated;
revoke all on function api.revoke_access(uuid, mkt.deactivation_reason, text, timestamptz) from public, anon;
grant execute on function api.revoke_access(uuid, mkt.deactivation_reason, text, timestamptz) to authenticated;
revoke all on function api.save_profile_preferences(mkt.theme_preference, mkt.brand_code, mkt.view_mode, text)
  from public, anon;
grant execute on function api.save_profile_preferences(mkt.theme_preference, mkt.brand_code, mkt.view_mode, text)
  to authenticated;
revoke all on function api.save_notification_preference(mkt.notice_kind, boolean, boolean) from public, anon;
grant execute on function api.save_notification_preference(mkt.notice_kind, boolean, boolean) to authenticated;
revoke all on function api.save_filter(mkt.saved_filter_scope, text, jsonb) from public, anon;
grant execute on function api.save_filter(mkt.saved_filter_scope, text, jsonb) to authenticated;
revoke all on function api.delete_saved_filter(uuid) from public, anon;
grant execute on function api.delete_saved_filter(uuid) to authenticated;
revoke all on function api.my_profile() from public, anon;
grant execute on function api.my_profile() to authenticated;
revoke all on function api.my_permissions() from public, anon;
grant execute on function api.my_permissions() to authenticated;
revoke all on function api.list_role_permissions() from public, anon;
grant execute on function api.list_role_permissions() to authenticated;
revoke all on function api.check_text(text) from public, anon;
grant execute on function api.check_text(text) to authenticated;
revoke all on function api.list_users() from public, anon;
grant execute on function api.list_users() to authenticated;
revoke all on function api.credential_status() from public, anon;
grant execute on function api.credential_status() to authenticated;
revoke all on function api.my_notification_preferences() from public, anon;
grant execute on function api.my_notification_preferences() to authenticated;

revoke all on function private.is_stale(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function private.valid_note(text, integer, integer) from public, anon, authenticated;
revoke all on function private.domain_codes(regtype) from public, anon, authenticated;
revoke all on function private.execution_request(mkt.execution_operation, mkt.platform, jsonb, text)
  from public, anon, authenticated;
revoke all on function private.write_credential_ok(uuid) from public, anon, authenticated;
revoke all on function private.queue_execution(uuid) from public, anon, authenticated;
revoke all on function private.queue_stop_executions(uuid, mkt.execution_operation) from public, anon, authenticated;
revoke all on function private.queue_spend_cap(uuid, bigint) from public, anon, authenticated;
revoke all on function private.cancel_action_executions(uuid) from public, anon, authenticated;
revoke all on function private.validate_action(mkt.brand_code, mkt.platform, uuid, mkt.action_kind, text, text,
  jsonb, mkt.level, mkt.level, bigint) from public, anon, authenticated;

revoke all on function mkt.execution_may_increase_spend(uuid), mkt.csv_header_has_personal_data(text)
  from public, anon;
grant execute on function mkt.execution_may_increase_spend(uuid), mkt.csv_header_has_personal_data(text)
  to authenticated, mkt_worker, mkt_executor;

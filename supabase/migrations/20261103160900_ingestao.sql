-- Migração 10 · ingestão: o que o worker, o executor e os scripts de configuração gravam (docs/dados/plano.md, "Ordem
--   das migrações"; papeis-e-rls.md, "O que o worker, o executor, o n8n e os scripts chamam"; integracoes.md, seções
--   2, 3, 12, 14, 15 e 18)
--
-- O que faz: adianta de docs/dados/metricas.md as fórmulas de que a ingestão e a execução dependem: a origem do lead
--   (mkt.url_host, mkt.host_matches, mkt.ai_source_of, mkt.utm_source_family, mkt.is_known_origin_text) e a conta do
--   limite do mês (os domain mkt.spend_situation e mkt.limit_alert, mkt.ratio, mkt.pace, mkt.limit_alert,
--   mkt.source_covered, mkt.ads_covered, a view mkt.v_account_month, mkt.action_extra_spend_cents,
--   mkt.action_exceeds_limit e mkt.execution_extra_spend_cents). Cria a conferência da execução
--   (mkt.execution_allowed); as credenciais (private.read_credential e private.rotate_credential, só do worker e só as
--   de leitura); as funções ingest.* do worker: as rodadas (start_run, take_requested_run, finish_run), uma upsert por
--   tabela de fora (com a regra CSV × API, a limpeza do texto do CRM, também do nome do funil, e o CRM como ele é,
--   decisões 0041 e 0042: o funil de leads por regra, o negócio sem funil como do funil padrão, o nulo no que o CRM não
--   entrega e a compra do ERP mais antiga já vista), a releitura que troca o dia (replace_day), a passada completa que
--   apaga o que sumiu do CRM com a trava de 20% (delete_missing; o par cliente × marca com a compra do ERP mais antiga
--   já vista perde só o retrato, e a data fica), o estado da credencial e a rodada e as propostas do Claude; as do
--   executor (next_execution, update_execution, set_action_progress; a criação só confirma com a campanha relida, da
--   conta da execução, e a que a leitura importou do humano depois de a ação mandar criar passa para o Claude); e as
--   setup.* dos scripts de configuração, também a que marca o funil antigo dos leads do site (mark_lead_funnel). Toda
--   função de ingest e de setup é security definer, com search_path pg_catalog, pg_temp, e só o papel dela executa; as
--   de ingest e a mark_lead_funnel conferem também o session_user (o worker, o executor ou o script), que uma sessão
--   não troca.
-- Risco: médio. É por aqui que os serviços gravam: uma conferência errada deixaria o worker gravar o que não devia ou o
--   executor mandar o que não foi aprovado. Os gatilhos das migrações 04 e 07 conferem de novo o operador, a ação e a
--   execução. Não toca em dado: só cria funções, dois domain e uma view.
-- Como reverter (só no projeto de teste, antes de produção, e depois de reverter a migração 11):
--   select format('drop function %s;', p.oid::regprocedure) from pg_proc p
--    where p.pronamespace in ('ingest'::regnamespace, 'setup'::regnamespace)
--       or p.oid::regprocedure::text like 'private.ingest\_%' or p.proname in ('read_credential',
--          'rotate_credential', 'refusal_code', 'is_ignored_code', 'clean_crm_text', 'rep_for_login', 'action_progress',
--          'read_back_campaign');   -- e rodar o que sair
--   drop function mkt.execution_allowed(uuid), mkt.execution_extra_spend_cents(uuid), mkt.action_exceeds_limit(uuid),
--     mkt.action_extra_spend_cents(uuid);
--   drop view mkt.v_account_month;
--   drop function mkt.ads_covered(uuid, mkt.platform), mkt.source_covered(mkt.connector_code),
--     mkt.limit_alert(bigint, bigint), mkt.pace(bigint, bigint, integer, integer), mkt.ratio(numeric, numeric),
--     mkt.is_known_origin_text(text), mkt.utm_source_family(text), mkt.ai_source_of(text, text),
--     mkt.host_matches(text, text[]), mkt.url_host(text);
--   drop domain mkt.limit_alert, mkt.spend_situation;
-- Conferir (quem executa cada função de ingest e de setup; e a conta do mês de cada conta ativa):
--   select p.oid::regprocedure, p.prosecdef,
--          array(select r from unnest(array['mkt_worker', 'mkt_executor', 'mkt_setup']) r
--                 where has_function_privilege(r, p.oid, 'execute')) as quem
--     from pg_proc p where p.pronamespace in ('ingest'::regnamespace, 'setup'::regnamespace) order by 1;
--   select ad_account_id, spent_cents, monthly_limit_cents, situation, alert from mkt.v_account_month;

-- ---------- Listas de saída da régua do limite (metricas.md, seção 8) ----------

do $$
declare
  v record;
begin
  for v in
    select l.nome, l.codigos
      from (values
        ('spend_situation', array['over_limit', 'will_exceed', 'on_track']),
        ('limit_alert',     array['near_limit', 'over_limit'])
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

-- ---------- Origem do lead (metricas.md, seção 3.1; adiantadas para as ingest.* que gravam a origem) ----------

-- Host de um endereço: tira protocolo, usuário, porta e caminho; depois www., m., l. e lm. (nessa ordem), como o
-- host() de rules.ts.
create or replace function mkt.url_host(p text) returns text
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select nullif(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      regexp_replace(lower(btrim(coalesce(p, ''))), '^[a-z][a-z0-9+.-]*://(?:[^@/]*@)?([^/:?#]+).*$', '\1'),
      '^www\.', ''), '^m\.', ''), '^l\.', ''), '^lm\.', ''),
    '')
$$;

-- Sufixo terminado em ponto ("google.") vale em qualquer lugar do host; o resto, host igual ou subdomínio.
create or replace function mkt.host_matches(p_host text, p_patterns text[]) returns boolean
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select coalesce(bool_or(case when right(s, 1) = '.' then strpos(p_host, s) > 0
                               else p_host = s or right(p_host, length(s) + 1) = '.' || s end), false)
    from unnest(p_patterns) s
$$;

-- Assistente de IA de uma fonte (utm_source, sessionSource do GA4 ou referrer). A lista mora só aqui.
create or replace function mkt.ai_source_of(p_session_source text, p_channel_group text) returns mkt.ai_source
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select (case
    when mkt.host_matches(h, '{chatgpt.com,chat.openai.com}') or h in ('chatgpt', 'openai') then 'chatgpt'
    when mkt.host_matches(h, '{perplexity.ai}') or h = 'perplexity' then 'perplexity'
    when mkt.host_matches(h, '{claude.ai}') or h in ('claude', 'anthropic') then 'claude'
    when mkt.host_matches(h, '{gemini.google.com}') or h = 'gemini' then 'gemini'
    when mkt.host_matches(h, '{copilot.microsoft.com}') or h = 'copilot' then 'copilot'
    when p_channel_group = 'AI Assistant' then 'other'
  end)::mkt.ai_source
  from (select coalesce(mkt.url_host(p_session_source), '') as h) x
$$;

-- Família da fonte de UTM. A lista de fontes mora só aqui: a classificação e a gravação da origem usam.
create or replace function mkt.utm_source_family(p_source text) returns text
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select case
    when s = '' then null
    when mkt.ai_source_of(s, null) is not null then 'ai_assistant'   -- antes da Meta: "chatgpt.com" é IA
    when s = any ('{meta,facebook,fb,instagram,ig,fbig}') then 'meta'
    when s = any ('{tiktok,tt}') then 'tiktok'
    when s = any ('{google,adwords,googleads,youtube,bing,microsoft}') then 'search'
    when s in ('sdr', 'whatsapp') then 'sdr'
    when s = 'site' then 'site'
    when s in ('direct', '(direct)') then 'direct'
  end
  from (select lower(btrim(coalesce(p_source, ''))) as s) x
$$;

-- O texto de negocios.origem pode ser gravado? Só se é uma fonte conhecida (o de-para é conferido à parte).
create or replace function mkt.is_known_origin_text(p text) returns boolean
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select mkt.utm_source_family(p) is not null
$$;

-- ---------- Ritmo, conta do mês e limite (metricas.md, seções 2.3 e 4.5; decisão 0021) ----------

create or replace function mkt.ratio(p_num numeric, p_den numeric) returns numeric
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select case when p_num is null or p_den is null or p_den = 0 then null else p_num / p_den end
$$;

create or replace function mkt.pace(p_spent bigint, p_target bigint, p_days_elapsed integer, p_days_in_month integer,
  out projection_cents bigint, out expected_today_cents bigint, out usage numeric, out situation mkt.spend_situation)
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select round(p_spent::numeric / p_days_elapsed * p_days_in_month)::bigint,
         round(p_target::numeric * p_days_elapsed / p_days_in_month)::bigint,
         mkt.ratio(p_spent, p_target),
         (case when p_spent is null or p_target is null then null
               when p_spent >= p_target then 'over_limit'          -- como o protótipo: chegou ao limite (também 0 de 0)
               when round(p_spent::numeric / p_days_elapsed * p_days_in_month) > p_target then 'will_exceed'
               else 'on_track' end)::mkt.spend_situation
$$;

-- Recebe o gasto e o limite, não o uso: com limite 0, o uso é nulo, e o alerta precisa dizer "acima", como a situação.
create or replace function mkt.limit_alert(p_spent bigint, p_limit bigint) returns mkt.limit_alert
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select (case when p_spent >= p_limit then 'over_limit'
               when p_spent >= 0.9 * p_limit then 'near_limit' end)::mkt.limit_alert
$$;

-- A fonte tem base quando o conector já trouxe dado alguma vez (decisão 0034).
create or replace function mkt.source_covered(p_code mkt.connector_code) returns boolean
language sql stable set search_path = pg_catalog, pg_temp as $$
  select coalesce((select c.first_success_at is not null from mkt.connectors c where c.code = p_code), false)
$$;

-- Gasto: o canal tem base e a conta da marca nele já foi lida. Sem canal: algum canal com base.
create or replace function mkt.ads_covered(p_brand_id uuid, p_platform mkt.platform) returns boolean
language sql stable set search_path = pg_catalog, pg_temp as $$
  select exists (
    select 1
      from mkt.ad_accounts a
      join mkt.connectors c
        on c.code = case a.platform when 'google' then 'google_ads' else a.platform::text end
     where c.first_success_at is not null and a.first_read_at is not null
       and (p_brand_id is null or a.brand_id = p_brand_id)
       and (p_platform is null or a.platform = p_platform))
$$;

-- Uma linha por conta de anúncio ativa, no mês corrente de São Paulo: o gasto de todas as campanhas da conta até hoje,
-- o limite vigente, a projeção, a situação e o alerta. A mesma régua na Visão geral, nos canais, no Tráfego, no alerta
-- da fila e na trava da execução.
create or replace view mkt.v_account_month with (security_invoker = true) as
with m as (
  select date_trunc('month', mkt.today())::date as month_on, mkt.today() as today,
         (date_trunc('month', mkt.today()) + interval '1 month')::date - 1 as month_end
),
spent as (   -- todo o gasto da conta no mês, de qualquer campanha e status
  select c.ad_account_id, sum(d.spend_cents)::bigint as spent_cents   -- sum(bigint) devolve numeric
    from mkt.ad_campaign_daily d
    join mkt.campaigns c on c.id = d.campaign_id
   cross join m
   where d.metric_on between m.month_on and m.today
   group by c.ad_account_id
),
lim as (     -- o limite vigente hoje
  select distinct on (s.ad_account_id) s.ad_account_id, s.id as spend_limit_id, s.monthly_limit_cents
    from mkt.spend_limits s cross join m
   where s.valid_from_on <= m.today
   order by s.ad_account_id, s.valid_from_on desc
),
camp as (
  select c.ad_account_id,
         count(*) filter (where c.status = 'active') as active_campaigns,
         count(*) filter (where c.status = 'active' and c.managed_by = 'claude') as active_claude_campaigns,
         sum(c.daily_budget_cents) filter (where c.status = 'active')::bigint as active_daily_budget_cents
    from mkt.campaigns c group by c.ad_account_id
),
base as (
  select a.id as ad_account_id, a.brand_id, a.platform, m.month_on,
         m.today - m.month_on + 1 as days_elapsed, m.month_end - m.month_on + 1 as days_in_month,
         -- A base é a da própria conta da linha: conta nova ainda não lida fica "Sem dados", não R$ 0.
         case when a.first_read_at is not null and mkt.ads_covered(a.brand_id, a.platform)
              then coalesce(s.spent_cents, 0) end as spent_cents,
         l.spend_limit_id, l.monthly_limit_cents,
         -- Sem base, "Sem dados" (como o protótipo); com base e nada ativo, 0 e R$ 0.
         case when a.first_read_at is not null and mkt.ads_covered(a.brand_id, a.platform)
              then coalesce(c.active_campaigns, 0) end as active_campaigns,
         case when a.first_read_at is not null and mkt.ads_covered(a.brand_id, a.platform)
              then coalesce(c.active_claude_campaigns, 0) end as active_claude_campaigns,
         case when a.first_read_at is not null and mkt.ads_covered(a.brand_id, a.platform)
              then coalesce(c.active_daily_budget_cents, 0)::bigint end as active_daily_budget_cents
    from mkt.ad_accounts a
   cross join m
    left join spent s on s.ad_account_id = a.id
    left join lim l on l.ad_account_id = a.id
    left join camp c on c.ad_account_id = a.id
   where a.is_active
)
select b.*, p.projection_cents, p.expected_today_cents, p.usage, p.situation,
       mkt.limit_alert(b.spent_cents, b.monthly_limit_cents) as alert
  from base b
 cross join lateral mkt.pace(b.spent_cents, b.monthly_limit_cents, b.days_elapsed, b.days_in_month) p;

-- Gasto a mais no resto do mês, contando hoje (metricas.md, 4.5): o mesmo número no alerta da fila e na trava da
-- execução. Orçamento: só o que passa do atual (o atual relido; sem ele, o anterior dos parâmetros) × dias que faltam.
-- Criar: o orçamento novo × dias que faltam. Lance e criativo: o custo estimado (nulo sem estimativa). O resto, 0.
create or replace function mkt.action_extra_spend_cents(p_action_id uuid) returns bigint
language sql stable set search_path = pg_catalog, pg_temp as $$
  select case a.kind
           when 'budget' then
             greatest(0, (a.params ->> 'daily_budget_cents')::bigint
                         - coalesce(c.daily_budget_cents, (a.params ->> 'previous_daily_budget_cents')::bigint, 0))
             * d.days_left
           when 'create' then (a.params ->> 'daily_budget_cents')::bigint * d.days_left
           when 'bid' then a.cost_cents
           when 'creative' then a.cost_cents
           else 0
         end
    from mkt.traffic_actions a
    left join mkt.campaigns c on c.id = a.campaign_id
   cross join (select (date_trunc('month', mkt.today()) + interval '1 month')::date - mkt.today() as days_left) d
   where a.id = p_action_id
$$;

-- A ação passa do limite do mês: gasto a mais acima de 0 e a projeção do mês mais ele acima do limite. Lance e
-- criativo sem custo estimado: quando o uso do mês passa de 90%. Nulo (sem gasto lido, sem orçamento conhecido, sem
-- limite) fica nulo: a trava da execução e o alerta da fila contam como passando.
create or replace function mkt.action_exceeds_limit(p_action_id uuid) returns boolean
language sql stable set search_path = pg_catalog, pg_temp as $$
  select case
           when a.kind in ('pause', 'pending_fix') then false
           when a.kind in ('bid', 'creative') and a.cost_cents is null then m.usage > 0.9
           else x.extra > 0 and m.projection_cents + x.extra > m.monthly_limit_cents
         end
    from mkt.traffic_actions a
   cross join lateral (select mkt.action_extra_spend_cents(a.id) as extra) x
    left join mkt.v_account_month m on m.ad_account_id = a.ad_account_id
   where a.id = p_action_id
$$;

-- O gasto a mais de uma execução: o da ação que a gerou; reativar (desfazer a parada) conta o orçamento diário da
-- campanha × dias que faltam (nulo sem orçamento conhecido); pausar e o teto da conta, 0.
create or replace function mkt.execution_extra_spend_cents(p_execution_id uuid) returns bigint
language sql stable set search_path = pg_catalog, pg_temp as $$
  select case
           when e.traffic_action_id is not null then mkt.action_extra_spend_cents(e.traffic_action_id)
           when e.operation = 'activate' then
             c.daily_budget_cents * ((date_trunc('month', mkt.today()) + interval '1 month')::date - mkt.today())
           else 0
         end
    from mkt.platform_executions e
    left join mkt.campaigns c on c.id = e.campaign_id
   where e.id = p_execution_id
$$;

-- ---------- Pode executar? (integracoes.md, seção 14, passo 3; decisões 0021, 0022 e 0038) ----------

-- Nesta ordem, o primeiro que falhar vira o motivo do bloqueio: a aprovação confere (quem pediu ainda pode, a origem
-- ainda vale e o pedido é o aprovado) → approval_invalid; o conector ligado → connector_disabled; a credencial de
-- escrita → no_write_credential; a campanha não encerrada → campaign_ended; e, só no que pode aumentar o gasto: parada
-- aberta na marca → stopped; conta sem limite vigente (na Meta, também sem o teto da conta, ou com a sobra do teto
-- acima da sobra do limite) → no_spend_limit; passando do limite do mês, ou sem base para a conta → over_spend_limit.
-- Pausar e reduzir nunca são barrados pelo limite. Lê o estado das credenciais e os perfis: só as funções do dono
-- (ingest.next_execution) chamam.
create or replace function mkt.execution_allowed(p_execution_id uuid,
                                                 out is_allowed boolean, out blocked_reason mkt.execution_block_reason)
language plpgsql stable set search_path = pg_catalog, pg_temp as $$
declare
  e mkt.platform_executions;
  m mkt.v_account_month;
  v_account mkt.ad_accounts;
  v_exceeds boolean;
begin
  select x.* into e from mkt.platform_executions x where x.id = p_execution_id;
  if not found then
    raise sqlstate 'PT404' using message = 'TRF-404';
  end if;

  if not coalesce(case
       when e.traffic_action_id is not null then
         exists (select 1
                   from mkt.traffic_actions a
                   join mkt.profiles p on p.id = a.approved_by and p.is_active
                   join mkt.role_permissions rp on rp.role = p.role and rp.action = 'approve_action'
                  where a.id = e.traffic_action_id and a.status in ('approved', 'running')
                    and e.request = private.execution_request(e.operation, a.platform, a.params, a.code))
       when e.traffic_stop_campaign_id is not null then
         exists (select 1
                   from mkt.traffic_stop_campaigns sc
                   join mkt.traffic_stops s on s.id = sc.traffic_stop_id
                   join mkt.profiles p
                     on p.id = case when e.operation = 'pause' then s.requested_by else s.undone_by end and p.is_active
                   join mkt.role_permissions rp on rp.role = p.role and rp.action = 'stop_all'
                  where sc.id = e.traffic_stop_campaign_id and (s.undone_at is null) = (e.operation = 'pause')
                    and e.request = private.execution_request(e.operation, e.platform))
       else
         -- O teto da conta: o limite ainda vigente, de quem ainda configura, e nunca acima dele.
         exists (select 1
                   from mkt.spend_limits l
                   join mkt.profiles p on p.id = l.set_by and p.is_active
                   join mkt.role_permissions rp on rp.role = p.role and rp.action = 'configure_traffic'
                  where l.id = e.spend_limit_id and e.platform = 'meta'
                    and l.id = (select v.id from mkt.spend_limits v
                                 where v.ad_account_id = e.ad_account_id and v.valid_from_on <= mkt.today()
                                 order by v.valid_from_on desc limit 1)
                    and e.request ->> 'spend_cap_action' = 'reset'
                    and (select count(*) from jsonb_object_keys(e.request)) = 2
                    and (e.request ->> 'spend_cap')::numeric * 100 between 1 and greatest(l.monthly_limit_cents, 1))
     end, false) then
    blocked_reason := 'approval_invalid';
  elsif exists (select 1 from mkt.connectors k
                 where k.code = case e.platform when 'google' then 'google_ads' else e.platform::text end
                   and k.setup_state = 'disabled') then
    blocked_reason := 'connector_disabled';
  elsif not private.write_credential_ok(e.ad_account_id) then
    blocked_reason := 'no_write_credential';
  elsif exists (select 1 from mkt.campaigns c where c.id = e.campaign_id and c.status = 'ended') then
    blocked_reason := 'campaign_ended';
  elsif coalesce(mkt.execution_may_increase_spend(e.id), true) then
    select x.* into m from mkt.v_account_month x where x.ad_account_id = e.ad_account_id;
    select a.* into v_account from mkt.ad_accounts a where a.id = e.ad_account_id;
    v_exceeds := case
      when e.traffic_action_id is not null then mkt.action_exceeds_limit(e.traffic_action_id)
      else mkt.execution_extra_spend_cents(e.id) > 0
           and m.projection_cents + mkt.execution_extra_spend_cents(e.id) > m.monthly_limit_cents
    end;
    if exists (select 1 from mkt.traffic_stops s
                where s.undone_at is null and (s.brand_id is null or s.brand_id = e.brand_id)) then
      blocked_reason := 'stopped';
    elsif m.monthly_limit_cents is null then
      blocked_reason := 'no_spend_limit';
    elsif e.platform = 'meta'
          and (v_account.spend_cap_cents is null
               or coalesce(v_account.spend_cap_cents - coalesce(v_account.amount_spent_cents, 0)
                           > m.monthly_limit_cents - m.spent_cents, false)) then
      blocked_reason := 'no_spend_limit';
    elsif coalesce(v_exceeds, true) then
      blocked_reason := 'over_spend_limit';
    end if;
  end if;
  is_allowed := blocked_reason is null;
end $$;

-- ---------- Credenciais (decisão 0017; integracoes.md, seção 18) ----------

-- O segredo de uma credencial de leitura, do Vault: só para a conexão do worker (o session_user, que a sessão não
-- troca) e nunca a de escrita, que fica só nas variáveis do executor. Não repete o segredo em mensagem de erro.
create or replace function private.read_credential(p_id uuid) returns text
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare
  v private.connector_credentials;
  v_secret text;
begin
  if session_user::text <> 'mkt_worker' then
    raise sqlstate 'PT403' using message = 'CON-403';
  end if;
  select c.* into v from private.connector_credentials c where c.id = p_id;
  if not found then
    raise sqlstate 'PT404' using message = 'CON-404';
  end if;
  if v.purpose <> 'read' or v.vault_secret_id is null then
    raise sqlstate 'PT403' using message = 'CON-403', detail = 'purpose';
  end if;
  if v.status = 'revoked' then
    raise sqlstate 'PT422' using message = 'CON-422', detail = 'revoked';
  end if;
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.id = v.vault_secret_id;
  if v_secret is null then
    raise sqlstate 'PT404' using message = 'CON-404', detail = 'secret';
  end if;
  return v_secret;
end $$;

-- Troca o segredo de uma credencial de leitura que renovou (o token do Instagram de 60 dias, o refresh token): só o
-- worker, com o segredo como parâmetro ligado. A credencial volta a valer; a mudança de estado vai para a auditoria.
create or replace function private.rotate_credential(p_id uuid, p_secret text, p_expires_at timestamptz) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v private.connector_credentials;
begin
  if session_user::text <> 'mkt_worker' then
    raise sqlstate 'PT403' using message = 'CON-403';
  end if;
  select c.* into v from private.connector_credentials c where c.id = p_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'CON-404';
  end if;
  if v.purpose <> 'read' or v.vault_secret_id is null then
    raise sqlstate 'PT403' using message = 'CON-403', detail = 'purpose';
  end if;
  if coalesce(length(p_secret), 0) = 0 then
    raise sqlstate 'PT422' using message = 'CON-422', detail = 'secret';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise sqlstate 'PT422' using message = 'CON-422', detail = 'expires_at';
  end if;

  perform vault.update_secret(v.vault_secret_id, p_secret);
  update private.connector_credentials c
     set status = 'valid', expires_at = p_expires_at, last_rotated_at = now(), last_checked_at = now()
   where c.id = v.id;
  if v.status <> 'valid' then
    insert into mkt.audit_log (actor_kind, event, target_table, target_id, changes)
    select 'system', 'credential_status_changed', 'connector_credentials', v.id,
           jsonb_build_object('connector', k.code, 'purpose', v.purpose,
                              'status', jsonb_build_object('before', v.status, 'after', 'valid'))
      from mkt.connectors k where k.id = v.connector_id;
  end if;
end $$;

-- ---------- Apoio da ingestão (só as funções do dono chamam) ----------

-- Cada registro é o evento de ingestão (integracoes.md, seção 2.2): {kind, source, key, brand, values, fetched_at}. A
-- função de cada tabela diz o tipo, as chaves de key e de values que aceita e as obrigatórias ('key.x', 'values.y' ou
-- 'brand'). Fora do formato: ROW; chave que a tabela não tem (nome, e-mail, telefone…): UNKNOWN_FIELD; obrigatória
-- faltando: NOT_NULL. A fonte do registro é a da rodada: o campo source não decide nada aqui.
create or replace function private.ingest_row_problem(p_row jsonb, p_kind text, p_key text[], p_values text[],
                                                      p_required text[] default '{}')
returns text
language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare
  v_name text;
begin
  if jsonb_typeof(p_row) is distinct from 'object' then
    return 'ROW';
  end if;
  if (p_row ? 'kind' and p_row ->> 'kind' is distinct from p_kind)
     or jsonb_typeof(coalesce(p_row -> 'key', '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_row -> 'values', '{}'::jsonb)) <> 'object' then
    return 'ROW';
  end if;
  for v_name in select jsonb_object_keys(p_row) loop
    if v_name not in ('kind', 'source', 'key', 'brand', 'values', 'fetched_at') then
      return 'UNKNOWN_FIELD';
    end if;
  end loop;
  for v_name in select jsonb_object_keys(coalesce(p_row -> 'key', '{}'::jsonb)) loop
    if not v_name = any (p_key) then
      return 'UNKNOWN_FIELD';
    end if;
  end loop;
  for v_name in select jsonb_object_keys(coalesce(p_row -> 'values', '{}'::jsonb)) loop
    if not v_name = any (p_values) then
      return 'UNKNOWN_FIELD';
    end if;
  end loop;
  foreach v_name in array p_required loop
    if (case split_part(v_name, '.', 1)
          when 'key' then p_row -> 'key' ->> split_part(v_name, '.', 2)
          when 'values' then p_row -> 'values' ->> split_part(v_name, '.', 2)
          else p_row ->> v_name
        end) is null then
      return 'NOT_NULL';
    end if;
  end loop;
  return null;
end $$;

-- O código de uma linha recusada pelo banco (moeda, lista, check): curto, sem a mensagem técnica.
create or replace function private.refusal_code(p_sqlstate text, p_constraint text) returns text
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select case
    when p_constraint = 'ad_accounts_currency_check' then 'CURRENCY'
    when p_sqlstate = '23514' then 'CHECK'
    when p_sqlstate = '23502' then 'NOT_NULL'
    when p_sqlstate = '23503' then 'FOREIGN_KEY'
    when p_sqlstate = '23505' then 'DUPLICATE'
    when left(p_sqlstate, 2) = '22' then 'FORMAT'
    else 'REFUSED'
  end
$$;

-- Linha que não foi gravada e não conta como recusada: conta, perfil ou propriedade que não está cadastrada (é
-- ignorada, integracoes.md, seção 4), negócio de funil que não é de leads, linha do CSV que a da API já cobre e texto
-- com dado pessoal descartado.
create or replace function private.is_ignored_code(p_code text) returns boolean
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select p_code in ('NOT_REGISTERED', 'NOT_LEAD_FUNNEL', 'API_KEPT', 'PERSONAL_DATA_DROPPED')
$$;

-- Texto que vem do CRM (UTM e nome do funil; tabelas.md, seção 2): vira nulo com @ ou, fora o nome de campanha, com
-- dado pessoal (PERSONAL_DATA_DROPPED); entra cortado em 150 letras.
create or replace function private.clean_crm_text(p text, p_is_campaign boolean, out value text, out dropped boolean)
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select case when b.bad then null else left(b.v, 150) end, b.bad
    from (select a.v,
                 coalesce(strpos(a.v, '@') > 0 or (not p_is_campaign and mkt.has_personal_data(a.v)), false) as bad
            from (select nullif(btrim(p), '') as v) a) b
$$;

-- O representante de um login de app (o resumo HMAC de <marca>:<login>; integracoes.md, seção 3.5): o que já existe,
-- ou um representante novo só de app, com código REP- novo. Ver o login (e o representante só de app) marca os dois
-- como vistos na passada completa. O login fora do formato é recusado antes de gastar um número da sequência (que
-- não volta atrás com a linha recusada).
create or replace function private.rep_for_login(p_brand_id uuid, p_login_key text) returns uuid
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  v_rep uuid;
begin
  if p_login_key is null then
    return null;
  end if;
  if p_login_key !~ '^[0-9a-f]{64}$' then
    raise sqlstate '23514' using message = 'ING-422', detail = 'app_login_key',
                                 constraint = 'sales_rep_app_logins_app_login_key_check';
  end if;
  update mkt.sales_rep_app_logins l set sales_rep_id = l.sales_rep_id
   where l.brand_id = p_brand_id and l.app_login_key = p_login_key
  returning l.sales_rep_id into v_rep;
  if v_rep is null then
    insert into mkt.sales_reps (external_id, last_seen_at) values (null, now()) returning id into v_rep;
    insert into mkt.sales_rep_app_logins (sales_rep_id, brand_id, app_login_key) values (v_rep, p_brand_id, p_login_key);
  else
    update mkt.sales_reps r set last_seen_at = now() where r.id = v_rep and r.external_id is null;
  end if;
  return v_rep;
end $$;

-- O lote: confere quem grava (só o worker), a rodada (em andamento, do conector da tabela) e o tamanho (até 1.000),
-- e grava linha por linha pela função da tabela, cada uma no seu bloco: linha recusada não derruba o lote. Devolve só
-- as linhas que não gravou, com o código; as contagens vão para a rodada. Sem conector (a checagem dos sites), não há
-- rodada.
create or replace function private.ingest_batch(p_run_id uuid, p_rows jsonb, p_connectors text[], p_row_function text)
returns table (item integer, code text, is_refused boolean)
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  v_connector text;
  v_job text;
  v_brand_id uuid;
  r record;
  v_code text;
  v_dropped integer;
  v_state text;
  v_constraint text;
  v_written integer := 0;
  v_refused integer := 0;
  v_dropped_total integer := 0;
begin
  if session_user::text <> 'mkt_worker' then
    raise sqlstate 'PT403' using message = 'ING-403';
  end if;
  if p_connectors is not null then
    select k.code, s.job, s.brand_id into v_connector, v_job, v_brand_id
      from mkt.sync_runs s
      join mkt.connectors k on k.id = s.connector_id
     where s.id = p_run_id and s.status = 'running';
    if not found then
      raise sqlstate 'PT422' using message = 'ING-422', detail = 'run';
    end if;
    if not v_connector = any (p_connectors) then
      raise sqlstate 'PT422' using message = 'ING-422', detail = 'connector';
    end if;
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise sqlstate 'PT422' using message = 'ING-422', detail = 'rows';
  end if;
  if jsonb_array_length(p_rows) > 1000 then
    raise sqlstate 'PT422' using message = 'ING-422', detail = 'rows';
  end if;

  for r in select e.value as v, e.ordinality::integer as n from jsonb_array_elements(p_rows) with ordinality as e loop
    begin
      execute format('select x.code, x.dropped from %s($1, $2, $3, $4) as x', p_row_function::regproc)
         into v_code, v_dropped
        using r.v, v_connector, v_job, v_brand_id;
    exception
      when data_exception or integrity_constraint_violation then
        get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name;
        v_code := private.refusal_code(v_state, v_constraint);
        v_dropped := 0;
    end;
    v_dropped_total := v_dropped_total + coalesce(v_dropped, 0);
    if v_code is null then
      v_written := v_written + 1;
    else
      item := r.n;
      code := v_code;
      is_refused := not private.is_ignored_code(v_code);
      if is_refused then
        v_refused := v_refused + 1;
      end if;
      return next;
    end if;
  end loop;

  if p_connectors is not null and v_written + v_refused + v_dropped_total > 0 then
    update mkt.sync_runs s
       set rows_written = s.rows_written + v_written, rows_refused = s.rows_refused + v_refused,
           personal_data_dropped = s.personal_data_dropped + v_dropped_total
     where s.id = p_run_id;
  end if;
end $$;

-- ---------- Uma função por tabela de fora: grava uma linha (chamadas por private.ingest_batch) ----------
-- Todas recebem a linha, o conector, o trabalho e a marca da rodada, e devolvem o código (nulo = gravada) e quantos
-- textos viraram nulo por parecer dado pessoal. A linha atualiza last_seen_at: é por ele que a passada completa sabe o
-- que sumiu do CRM.

-- Marca (marcas): o worker grava o id do CRM e o nome, pela sigla convertida (CS → cs).
create or replace function private.ingest_brand(p_row jsonb, p_connector text, p_job text, p_brand_id uuid,
                                                out code text, out dropped integer)
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  dropped := 0;
  code := private.ingest_row_problem(p_row, 'brand', array['external_id'], array['name'],
                                     array['brand', 'key.external_id']);
  if code is not null then
    return;
  end if;
  update mkt.brands b
     set external_id = p_row #>> '{key,external_id}', name = coalesce(p_row #>> '{values,name}', b.name)
   where b.code = p_row ->> 'brand';
  if not found then
    code := 'UNKNOWN_BRAND';
  end if;
end $$;

-- Funil (funis_venda): nome e padrão. O nome passa pela limpeza do texto do CRM (a segunda barreira, depois da view):
-- com @ ou com cara de dado pessoal, entra o rótulo "Funil " e os 8 primeiros caracteres do id, nunca o texto, e conta
-- PERSONAL_DATA_DROPPED; a linha não é recusada, para o funil de leads não sumir. Funil de leads por regra (decisão
-- 0041, item 1): no funil padrão do CRM, is_lead_funnel segue is_default; o funil que deixa de ser o padrão deixa de
-- ser de leads. O funil antigo dos leads do site, marcado por setup.mark_lead_funnel, continua marcado: a leitura só
-- desmarca o funil que era o padrão. Sem coluna para lembrar a marca, o funil marcado que um dia vira o padrão e
-- depois deixa de ser perde a marca, e o script marca de novo.
create or replace function private.ingest_crm_funnel(p_row jsonb, p_connector text, p_job text, p_brand_id uuid,
                                                     out code text, out dropped integer)
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  v_default boolean;
  v_name text;
  v_name_dropped boolean;
begin
  dropped := 0;
  code := private.ingest_row_problem(p_row, 'crm_funnel', array['external_id'], array['name', 'is_default'],
                                     array['key.external_id', 'values.name']);
  if code is not null then
    return;
  end if;
  v_default := coalesce((p_row #>> '{values,is_default}')::boolean, false);
  select c.value, c.dropped into v_name, v_name_dropped
    from private.clean_crm_text(p_row #>> '{values,name}', false) c;
  dropped := v_name_dropped::integer;
  v_name := coalesce(v_name, 'Funil ' || left(p_row #>> '{key,external_id}', 8));
  insert into mkt.crm_funnels as f (external_id, name, is_default, is_lead_funnel, last_seen_at)
  values (p_row #>> '{key,external_id}', v_name, v_default, v_default, now())
  on conflict (source, external_id) do update
     set name = excluded.name, is_default = excluded.is_default,
         is_lead_funnel = case when excluded.is_default then true
                               when f.is_default then false
                               else f.is_lead_funnel end,
         last_seen_at = excluded.last_seen_at;
end $$;

-- Representante do CRM (usuarios): só o papel e se está ativo, nunca o nome. O papel fora da lista mkt.rep_crm_role
-- entra nulo, sem recusar a linha do usuário (decisão 0041, item 8). O código REP- vem do gatilho e não anda na
-- releitura.
create or replace function private.ingest_sales_rep(p_row jsonb, p_connector text, p_job text, p_brand_id uuid,
                                                    out code text, out dropped integer)
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  v_role text := p_row #>> '{values,crm_role}';
begin
  dropped := 0;
  code := private.ingest_row_problem(p_row, 'sales_rep', array['external_id'], array['crm_role', 'is_active'],
                                     array['key.external_id']);
  if code is not null then
    return;
  end if;
  if not coalesce(v_role = any (private.domain_codes('mkt.rep_crm_role')), false) then
    v_role := null;
  end if;
  insert into mkt.sales_reps as s (external_id, crm_role, is_active, last_seen_at)
  values (p_row #>> '{key,external_id}', v_role, coalesce((p_row #>> '{values,is_active}')::boolean, true), now())
  on conflict (source, external_id) do update
     set crm_role = excluded.crm_role, is_active = excluded.is_active, last_seen_at = excluded.last_seen_at;
end $$;

-- Login de app de um representante do CRM (usuarios.logins_app), já como resumo HMAC. Sem o representante, o login
-- fica com um representante só de app.
create or replace function private.ingest_sales_rep_app_login(p_row jsonb, p_connector text, p_job text,
                                                              p_brand_id uuid, out code text, out dropped integer)
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  v_brand_id uuid;
  v_rep uuid;
begin
  dropped := 0;
  code := private.ingest_row_problem(p_row, 'sales_rep_app_login', array['app_login_key'],
                                     array['sales_rep_external_id'], array['brand', 'key.app_login_key']);
  if code is not null then
    return;
  end if;
  select b.id into v_brand_id from mkt.brands b where b.code = p_row ->> 'brand';
  if v_brand_id is null then
    code := 'UNKNOWN_BRAND';
    return;
  end if;
  if p_row #>> '{values,sales_rep_external_id}' is null then
    perform private.rep_for_login(v_brand_id, p_row #>> '{key,app_login_key}');
    return;
  end if;
  select s.id into v_rep from mkt.sales_reps s
   where s.source = 'csp360' and s.external_id = p_row #>> '{values,sales_rep_external_id}';
  if v_rep is null then
    code := 'UNKNOWN_SALES_REP';
    return;
  end if;
  insert into mkt.sales_rep_app_logins as l (sales_rep_id, brand_id, app_login_key)
  values (v_rep, v_brand_id, p_row #>> '{key,app_login_key}')
  on conflict (brand_id, app_login_key) do update set sales_rep_id = excluded.sales_rep_id;
end $$;

-- Cliente (clientes e as views clientes_utm): código, situação no CRM, se o ERP e o app o conhecem e as UTMs de
-- primeiro contato, limpas (tabelas.md, seção 2). Nunca nome, documento ou contato.
create or replace function private.ingest_crm_customer(p_row jsonb, p_connector text, p_job text, p_brand_id uuid,
                                                       out code text, out dropped integer)
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  x jsonb := coalesce(p_row -> 'values', '{}'::jsonb);
  v_source text;
  v_source_dropped boolean;
  v_medium text;
  v_medium_dropped boolean;
  v_campaign text;
  v_campaign_dropped boolean;
begin
  dropped := 0;
  code := private.ingest_row_problem(p_row, 'crm_customer', array['external_id'],
            array['code', 'crm_status', 'is_known_by_erp', 'has_app_owner', 'first_utm_source', 'first_utm_medium',
                  'first_utm_campaign', 'source_created_at'],
            array['key.external_id', 'values.code', 'values.crm_status', 'values.source_created_at']);
  if code is not null then
    return;
  end if;
  select c.value, c.dropped into v_source, v_source_dropped from private.clean_crm_text(x ->> 'first_utm_source', false) c;
  select c.value, c.dropped into v_medium, v_medium_dropped from private.clean_crm_text(x ->> 'first_utm_medium', false) c;
  select c.value, c.dropped into v_campaign, v_campaign_dropped
    from private.clean_crm_text(x ->> 'first_utm_campaign', true) c;
  dropped := v_source_dropped::integer + v_medium_dropped::integer + v_campaign_dropped::integer;

  insert into mkt.crm_customers as c (external_id, code, crm_status, is_known_by_erp, has_app_owner,
                                      first_utm_source, first_utm_medium, first_utm_campaign, source_created_at,
                                      last_seen_at)
  values (p_row #>> '{key,external_id}', x ->> 'code', x ->> 'crm_status',
          coalesce((x ->> 'is_known_by_erp')::boolean, false), coalesce((x ->> 'has_app_owner')::boolean, false),
          v_source, v_medium, v_campaign, (x ->> 'source_created_at')::timestamptz, now())
  on conflict (source, external_id) do update
     set code = excluded.code, crm_status = excluded.crm_status, is_known_by_erp = excluded.is_known_by_erp,
         has_app_owner = excluded.has_app_owner, first_utm_source = excluded.first_utm_source,
         first_utm_medium = excluded.first_utm_medium, first_utm_campaign = excluded.first_utm_campaign,
         source_created_at = excluded.source_created_at, last_seen_at = excluded.last_seen_at;
end $$;

-- Retrato do ERP por cliente e marca (view clientes_compras_marca) e a situação, quando o CRM a entregar em SQL. O que
-- não vem fica nulo, sem valor inventado (decisão 0041, item 6): a situação, o perdido marcado à mão, a última compra
-- da régua e a hora do cálculo. O total negativo vira nulo, sem recusar a linha (integracoes.md, seção 3.5). A compra
-- do ERP mais antiga já vista é a menor entre a guardada, a primeira e a última compra lidas: só anda para trás
-- (decisão 0042), e o worker não a manda.
create or replace function private.ingest_crm_customer_brand(p_row jsonb, p_connector text, p_job text,
                                                             p_brand_id uuid, out code text, out dropped integer)
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  x jsonb := coalesce(p_row -> 'values', '{}'::jsonb);
  v_customer uuid;
  v_brand_id uuid;
  v_first date;
  v_last date;
  v_total bigint;
begin
  dropped := 0;
  code := private.ingest_row_problem(p_row, 'crm_customer_brand', array['customer_external_id'],
            array['situation', 'is_lost_manual', 'last_purchase_on', 'erp_first_purchase_on', 'erp_last_purchase_on',
                  'erp_total_purchased_cents', 'situation_computed_at'],
            array['brand', 'key.customer_external_id']);
  if code is not null then
    return;
  end if;
  select b.id into v_brand_id from mkt.brands b where b.code = p_row ->> 'brand';
  if v_brand_id is null then
    code := 'UNKNOWN_BRAND';
    return;
  end if;
  select c.id into v_customer from mkt.crm_customers c
   where c.source = 'csp360' and c.external_id = p_row #>> '{key,customer_external_id}';
  if v_customer is null then
    code := 'UNKNOWN_CUSTOMER';
    return;
  end if;
  v_first := (x ->> 'erp_first_purchase_on')::date;
  v_last := (x ->> 'erp_last_purchase_on')::date;
  v_total := (x ->> 'erp_total_purchased_cents')::bigint;
  if v_total < 0 then
    v_total := null;
  end if;
  -- least() deixa o nulo de fora: sem nenhuma das datas, fica a que já estava.
  insert into mkt.crm_customer_brands as cb (customer_id, brand_id, situation, is_lost_manual, last_purchase_on,
                                             erp_first_purchase_on, erp_last_purchase_on, erp_earliest_purchase_on,
                                             erp_total_purchased_cents, situation_computed_at, last_seen_at)
  values (v_customer, v_brand_id, x ->> 'situation', (x ->> 'is_lost_manual')::boolean,
          (x ->> 'last_purchase_on')::date, v_first, v_last, least(v_first, v_last), v_total,
          (x ->> 'situation_computed_at')::timestamptz, now())
  on conflict (customer_id, brand_id) do update
     set situation = excluded.situation, is_lost_manual = excluded.is_lost_manual,
         last_purchase_on = excluded.last_purchase_on, erp_first_purchase_on = excluded.erp_first_purchase_on,
         erp_last_purchase_on = excluded.erp_last_purchase_on,
         erp_earliest_purchase_on = least(cb.erp_earliest_purchase_on, excluded.erp_earliest_purchase_on),
         erp_total_purchased_cents = excluded.erp_total_purchased_cents,
         situation_computed_at = excluded.situation_computed_at, last_seen_at = excluded.last_seen_at;
end $$;

-- Carteira (clientes.donos_app): o cliente na carteira do login de app da marca, já como resumo HMAC.
create or replace function private.ingest_crm_customer_rep(p_row jsonb, p_connector text, p_job text,
                                                           p_brand_id uuid, out code text, out dropped integer)
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  v_customer uuid;
  v_brand_id uuid;
  v_rep uuid;
begin
  dropped := 0;
  code := private.ingest_row_problem(p_row, 'crm_customer_rep', array['customer_external_id', 'app_login_key'],
                                     '{}', array['brand', 'key.customer_external_id', 'key.app_login_key']);
  if code is not null then
    return;
  end if;
  select b.id into v_brand_id from mkt.brands b where b.code = p_row ->> 'brand';
  if v_brand_id is null then
    code := 'UNKNOWN_BRAND';
    return;
  end if;
  select c.id into v_customer from mkt.crm_customers c
   where c.source = 'csp360' and c.external_id = p_row #>> '{key,customer_external_id}';
  if v_customer is null then
    code := 'UNKNOWN_CUSTOMER';
    return;
  end if;
  v_rep := private.rep_for_login(v_brand_id, p_row #>> '{key,app_login_key}');
  insert into mkt.crm_customer_reps as cr (customer_id, brand_id, sales_rep_id, last_seen_at)
  values (v_customer, v_brand_id, v_rep, now())
  on conflict (customer_id, brand_id, sales_rep_id) do update set last_seen_at = excluded.last_seen_at;
end $$;

-- Lead (negocios e leads_sdr; integracoes.md, seção 3.4): o negócio entra se está num funil de leads, se não tem funil
-- ou se já existe aqui, em qualquer funil (o resto é ignorado: NOT_LEAD_FUNNEL); o do SDR, sempre. No CRM, negócio sem
-- funil é do funil padrão, que é de leads (decisão 0041, item 1; é como nasce o negócio da conversão do SDR): ele
-- entra com o funil padrão quando há um só, e sem funil quando não há como saber qual é. A origem do CRM só é guardada
-- se está no de-para, se é uma fonte conhecida ou se é a utm_source de primeiro contato do cliente; outro texto não é
-- gravado e o lead fica is_origin_unmapped. UTM limpa, referrer só o domínio, responsável pelo código do
-- representante: o negócio que vem sem ele (fora da view negocios_responsavel) fica sem, mesmo que antes tivesse. O
-- código do SDR vem do gatilho (LEAD-, não anda na releitura); o do negócio é o NEG- do CRM.
create or replace function private.ingest_crm_lead(p_row jsonb, p_connector text, p_job text, p_brand_id uuid,
                                                   out code text, out dropped integer)
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  k jsonb := p_row -> 'key';
  x jsonb := coalesce(p_row -> 'values', '{}'::jsonb);
  v_kind text := p_row #>> '{key,kind}';
  v_existing uuid;
  v_brand_id uuid;
  v_customer mkt.crm_customers;
  v_funnel mkt.crm_funnels;
  v_origin text;
  v_unmapped boolean := false;
  v_source text;
  v_source_dropped boolean;
  v_medium text;
  v_medium_dropped boolean;
  v_campaign text;
  v_campaign_dropped boolean;
  v_host text;
  v_rep uuid;
begin
  dropped := 0;
  code := private.ingest_row_problem(p_row, 'crm_lead', array['kind', 'external_id'],
            array['code', 'customer_external_id', 'funnel_external_id', 'origin', 'utm_source', 'utm_medium',
                  'utm_campaign', 'referrer_host', 'assigned_rep_external_id', 'source_created_at',
                  'source_updated_at'],
            array['key.kind', 'key.external_id', 'values.source_created_at']);
  if code is not null then
    return;
  end if;
  select l.id into v_existing from mkt.crm_leads l
   where l.source = 'csp360' and l.kind = v_kind and l.external_id = k ->> 'external_id';

  if p_row ->> 'brand' is not null then
    select b.id into v_brand_id from mkt.brands b where b.code = p_row ->> 'brand';
    if v_brand_id is null then
      code := 'UNKNOWN_BRAND';
      return;
    end if;
  end if;
  if x ->> 'customer_external_id' is not null then
    select c.* into v_customer from mkt.crm_customers c
     where c.source = 'csp360' and c.external_id = x ->> 'customer_external_id';
    if not found then
      code := 'UNKNOWN_CUSTOMER';
      return;
    end if;
  end if;
  if v_kind = 'deal' then
    if x ->> 'funnel_external_id' is not null then
      select f.* into v_funnel from mkt.crm_funnels f
       where f.source = 'csp360' and f.external_id = x ->> 'funnel_external_id';
      if v_existing is null and not coalesce(v_funnel.is_lead_funnel, false) then
        code := 'NOT_LEAD_FUNNEL';
        return;
      end if;
    else
      select f.* into v_funnel from mkt.crm_funnels f
       where f.source = 'csp360' and f.is_default
         and not exists (select 1 from mkt.crm_funnels g
                          where g.source = 'csp360' and g.is_default and g.id <> f.id);
    end if;
  end if;

  v_origin := nullif(lower(btrim(x ->> 'origin')), '');
  if v_origin is not null
     and not exists (select 1 from mkt.crm_origin_map o where o.raw_value = v_origin)
     and not mkt.is_known_origin_text(v_origin)
     and v_origin is distinct from lower(btrim(v_customer.first_utm_source)) then
    v_origin := null;
    v_unmapped := true;
  end if;

  select c.value, c.dropped into v_source, v_source_dropped from private.clean_crm_text(x ->> 'utm_source', false) c;
  select c.value, c.dropped into v_medium, v_medium_dropped from private.clean_crm_text(x ->> 'utm_medium', false) c;
  select c.value, c.dropped into v_campaign, v_campaign_dropped from private.clean_crm_text(x ->> 'utm_campaign', true) c;
  dropped := v_source_dropped::integer + v_medium_dropped::integer + v_campaign_dropped::integer;

  v_host := mkt.url_host(x ->> 'referrer_host');
  if v_host !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' then
    if strpos(x ->> 'referrer_host', '@') > 0 then
      dropped := dropped + 1;
    end if;
    v_host := null;
  end if;

  if x ->> 'assigned_rep_external_id' is not null then
    select s.id into v_rep from mkt.sales_reps s
     where s.source = 'csp360' and s.external_id = x ->> 'assigned_rep_external_id';
  end if;

  insert into mkt.crm_leads as l (kind, external_id, code, brand_id, customer_id, crm_funnel_id, crm_origin_raw,
                                  is_origin_unmapped, utm_source, utm_medium, utm_campaign, referrer_host,
                                  assigned_rep_id, source_created_at, source_updated_at, last_seen_at)
  values (v_kind, k ->> 'external_id', case when v_kind = 'deal' then x ->> 'code' end, v_brand_id, v_customer.id,
          case when v_kind = 'deal' then v_funnel.id end, v_origin, v_unmapped, v_source, v_medium, v_campaign,
          v_host, v_rep, (x ->> 'source_created_at')::timestamptz, (x ->> 'source_updated_at')::timestamptz, now())
  on conflict (source, kind, external_id) do update
     set code = case when l.kind = 'deal' then excluded.code else l.code end,
         brand_id = excluded.brand_id, customer_id = excluded.customer_id, crm_funnel_id = excluded.crm_funnel_id,
         crm_origin_raw = excluded.crm_origin_raw, is_origin_unmapped = excluded.is_origin_unmapped,
         utm_source = excluded.utm_source, utm_medium = excluded.utm_medium, utm_campaign = excluded.utm_campaign,
         referrer_host = excluded.referrer_host, assigned_rep_id = excluded.assigned_rep_id,
         source_created_at = excluded.source_created_at, source_updated_at = excluded.source_updated_at,
         last_seen_at = excluded.last_seen_at;
end $$;

-- Pedido (pedidos e a soma dos itens), em todos os status: o faturado é o enviado com o carimbo. Quem vendeu sai do
-- login de app (vendedor_app), já como resumo HMAC.
create or replace function private.ingest_crm_order(p_row jsonb, p_connector text, p_job text, p_brand_id uuid,
                                                    out code text, out dropped integer)
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  x jsonb := coalesce(p_row -> 'values', '{}'::jsonb);
  v_brand_id uuid;
  v_customer uuid;
  v_rep uuid;
begin
  dropped := 0;
  code := private.ingest_row_problem(p_row, 'crm_order', array['external_id'],
            array['customer_external_id', 'status', 'is_invoiced', 'invoiced_at', 'total_cents',
                  'invoiced_total_cents', 'sales_rep_app_login_key', 'sent_at', 'source_created_at',
                  'source_updated_at'],
            array['brand', 'key.external_id', 'values.status', 'values.total_cents', 'values.source_created_at']);
  if code is not null then
    return;
  end if;
  select b.id into v_brand_id from mkt.brands b where b.code = p_row ->> 'brand';
  if v_brand_id is null then
    code := 'UNKNOWN_BRAND';
    return;
  end if;
  if x ->> 'customer_external_id' is not null then
    select c.id into v_customer from mkt.crm_customers c
     where c.source = 'csp360' and c.external_id = x ->> 'customer_external_id';
    if v_customer is null then
      code := 'UNKNOWN_CUSTOMER';
      return;
    end if;
  end if;
  v_rep := private.rep_for_login(v_brand_id, x ->> 'sales_rep_app_login_key');

  insert into mkt.crm_orders as o (external_id, brand_id, customer_id, status, is_invoiced, invoiced_at, total_cents,
                                   invoiced_total_cents, sales_rep_id, sent_at, source_created_at, source_updated_at,
                                   last_seen_at)
  values (p_row #>> '{key,external_id}', v_brand_id, v_customer, x ->> 'status',
          coalesce((x ->> 'is_invoiced')::boolean, false), (x ->> 'invoiced_at')::timestamptz,
          (x ->> 'total_cents')::bigint, (x ->> 'invoiced_total_cents')::bigint, v_rep,
          (x ->> 'sent_at')::timestamptz, (x ->> 'source_created_at')::timestamptz,
          (x ->> 'source_updated_at')::timestamptz, now())
  on conflict (source, external_id) do update
     set brand_id = excluded.brand_id, customer_id = excluded.customer_id, status = excluded.status,
         is_invoiced = excluded.is_invoiced, invoiced_at = excluded.invoiced_at, total_cents = excluded.total_cents,
         invoiced_total_cents = excluded.invoiced_total_cents, sales_rep_id = excluded.sales_rep_id,
         sent_at = excluded.sent_at, source_created_at = excluded.source_created_at,
         source_updated_at = excluded.source_updated_at, last_seen_at = excluded.last_seen_at;
end $$;

-- Rodada apps → CSP 360 (sincronizacoes).
create or replace function private.ingest_crm_upstream_run(p_row jsonb, p_connector text, p_job text,
                                                           p_brand_id uuid, out code text, out dropped integer)
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  x jsonb := coalesce(p_row -> 'values', '{}'::jsonb);
  v_brand_id uuid;
begin
  dropped := 0;
  code := private.ingest_row_problem(p_row, 'crm_upstream_run', array['external_id'],
            array['run_trigger', 'started_at', 'finished_at', 'is_ok'],
            array['key.external_id', 'values.run_trigger', 'values.started_at', 'values.is_ok']);
  if code is not null then
    return;
  end if;
  if p_row ->> 'brand' is not null then
    select b.id into v_brand_id from mkt.brands b where b.code = p_row ->> 'brand';
    if v_brand_id is null then
      code := 'UNKNOWN_BRAND';
      return;
    end if;
  end if;
  insert into mkt.crm_upstream_runs as u (external_id, brand_id, run_trigger, started_at, finished_at, is_ok,
                                          last_seen_at)
  values (p_row #>> '{key,external_id}', v_brand_id, x ->> 'run_trigger', (x ->> 'started_at')::timestamptz,
          (x ->> 'finished_at')::timestamptz, (x ->> 'is_ok')::boolean, now())
  on conflict (source, external_id) do update
     set brand_id = excluded.brand_id, run_trigger = excluded.run_trigger, started_at = excluded.started_at,
         finished_at = excluded.finished_at, is_ok = excluded.is_ok, last_seen_at = excluded.last_seen_at;
end $$;

-- Conta de anúncio: só a cadastrada (setup.register_ad_account; a que o token vê e não está cadastrada é ignorada).
-- O worker grava o que veio: nome, moeda (só real: CURRENCY), fuso, se está ativa e, na Meta, o teto da conta (o 0, sem
-- teto, entra nulo) e o gasto contado nele. A leitura dá base à conta (first_read_at).
create or replace function private.ingest_ad_account(p_row jsonb, p_connector text, p_job text, p_brand_id uuid,
                                                     out code text, out dropped integer)
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  x jsonb := coalesce(p_row -> 'values', '{}'::jsonb);
begin
  dropped := 0;
  code := private.ingest_row_problem(p_row, 'ad_account', array['external_id'],
            array['name', 'currency', 'time_zone', 'is_active', 'spend_cap_cents', 'amount_spent_cents'],
            array['key.external_id']);
  if code is not null then
    return;
  end if;
  update mkt.ad_accounts a
     set name = case when x ? 'name' then x ->> 'name' else a.name end,
         currency = case when x ? 'currency' then x ->> 'currency' else a.currency end,
         time_zone = case when x ? 'time_zone' then x ->> 'time_zone' else a.time_zone end,
         is_active = case when x ? 'is_active' then (x ->> 'is_active')::boolean else a.is_active end,
         spend_cap_cents = case when x ? 'spend_cap_cents' then nullif((x ->> 'spend_cap_cents')::bigint, 0)
                                else a.spend_cap_cents end,
         amount_spent_cents = case when x ? 'amount_spent_cents' then (x ->> 'amount_spent_cents')::bigint
                                   else a.amount_spent_cents end,
         last_seen_at = now(), first_read_at = coalesce(a.first_read_at, now())
   where a.source = case p_connector when 'meta' then 'meta_ads' when 'tiktok' then 'tiktok_ads' else 'google_ads' end
     and a.external_id = p_row #>> '{key,external_id}';
  if not found then
    code := 'NOT_REGISTERED';
  end if;
end $$;

-- Campanha: da conta cadastrada (a de fora é ignorada). No CSV de reserva, sem a conta no arquivo, vale a única conta
-- ativa da marca no canal, e a campanha que nasce dele leva a fonte e o id da plataforma (decisão 0035). Campanha
-- nova nasce do humano; do Claude só a criada pela central, reconhecida pelo código da ação create no fim do nome,
-- com a execução enviada ou confirmada na mesma conta e a ação ainda sem campanha (decisão 0008: uma ação create, uma
-- campanha; a que o gestor criar depois com o mesmo código nasce do humano). O operador nunca muda aqui: a que entrou
-- do humano antes de a criação ser confirmada passa para o Claude na confirmação (private.read_back_campaign). Só os
-- campos que vieram mudam (o CSV não traz orçamento).
create or replace function private.ingest_campaign(p_row jsonb, p_connector text, p_job text, p_brand_id uuid,
                                                   out code text, out dropped integer)
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  x jsonb := coalesce(p_row -> 'values', '{}'::jsonb);
  v_source text := case p_connector when 'meta' then 'meta_ads' when 'tiktok' then 'tiktok_ads' else 'google_ads' end;
  v_platform text := case p_connector when 'meta' then 'meta' when 'tiktok' then 'tiktok' else 'google' end;
  v_account mkt.ad_accounts;
  v_campaign mkt.campaigns;
  v_accounts uuid[];
  v_action uuid;
begin
  dropped := 0;
  code := private.ingest_row_problem(p_row, 'campaign', array['external_id'],
            array['account_external_id', 'name', 'status', 'daily_budget_cents', 'spend_cap_cents', 'is_smart_plus',
                  'source_created_at'],
            case when p_job = 'csv_import' then array['key.external_id']
                 else array['key.external_id', 'values.account_external_id'] end);
  if code is not null then
    return;
  end if;

  if x ->> 'account_external_id' is not null then
    select a.* into v_account from mkt.ad_accounts a
     where a.source = v_source and a.external_id = x ->> 'account_external_id';
    if not found then
      code := 'NOT_REGISTERED';
      return;
    end if;
  else
    select array_agg(a.id) into v_accounts from mkt.ad_accounts a
     where a.brand_id = p_brand_id and a.platform = v_platform and a.is_active;
    if coalesce(cardinality(v_accounts), 0) <> 1 then
      code := 'ACCOUNT';
      return;
    end if;
    select a.* into v_account from mkt.ad_accounts a where a.id = v_accounts[1];
  end if;
  if p_job = 'csv_import' and v_account.brand_id is distinct from p_brand_id then
    code := 'BRAND_MISMATCH';
    return;
  end if;

  select c.* into v_campaign from mkt.campaigns c
   where c.source = v_source and c.external_id = p_row #>> '{key,external_id}'
     for update;
  if found then
    if v_campaign.ad_account_id <> v_account.id then
      code := 'ACCOUNT';
      return;
    end if;
    update mkt.campaigns c
       set name = case when x ? 'name' then x ->> 'name' else c.name end,
           status = case when x ? 'status' then x ->> 'status' else c.status end,
           daily_budget_cents = case when x ? 'daily_budget_cents' then (x ->> 'daily_budget_cents')::bigint
                                     else c.daily_budget_cents end,
           spend_cap_cents = case when x ? 'spend_cap_cents' then (x ->> 'spend_cap_cents')::bigint
                                  else c.spend_cap_cents end,
           is_smart_plus = case when x ? 'is_smart_plus' then (x ->> 'is_smart_plus')::boolean else c.is_smart_plus end,
           source_created_at = coalesce((x ->> 'source_created_at')::timestamptz, c.source_created_at),
           last_seen_at = now()
     where c.id = v_campaign.id;
    return;
  end if;

  select a.id into v_action
    from mkt.traffic_actions a
   where a.code = upper(substring(lower(x ->> 'name') from '-(act-[0-9]{4,})$'))
     and a.kind = 'create' and a.ad_account_id = v_account.id
     and exists (select 1 from mkt.platform_executions e
                  where e.traffic_action_id = a.id and e.status in ('sent', 'confirmed')
                    and e.ad_account_id = v_account.id)
     and not exists (select 1 from mkt.campaigns o where o.created_by_action_id = a.id);
  insert into mkt.campaigns (ad_account_id, brand_id, platform, source, external_id, name, status, daily_budget_cents,
                             spend_cap_cents, is_smart_plus, source_created_at, last_seen_at, managed_by,
                             created_by_action_id)
  values (v_account.id, v_account.brand_id, v_account.platform, v_source, p_row #>> '{key,external_id}',
          x ->> 'name', x ->> 'status', (x ->> 'daily_budget_cents')::bigint, (x ->> 'spend_cap_cents')::bigint,
          coalesce((x ->> 'is_smart_plus')::boolean, false), (x ->> 'source_created_at')::timestamptz, now(),
          case when v_action is not null then 'claude' else 'human' end, v_action);
end $$;

-- Gasto e resultado por campanha e dia. CSV × API (decisão 0035): a API regrava a linha do CSV, e nunca o contrário
-- (a linha do CSV que a da API já cobre fica como está: API_KEPT). A linha de um CSV leva source = 'csv' e só entra em
-- campanha da marca do arquivo. Gravar dá base à conta (first_read_at).
create or replace function private.ingest_ad_campaign_daily(p_row jsonb, p_connector text, p_job text,
                                                            p_brand_id uuid, out code text, out dropped integer)
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  x jsonb := coalesce(p_row -> 'values', '{}'::jsonb);
  v_source text := case p_connector when 'meta' then 'meta_ads' when 'tiktok' then 'tiktok_ads' else 'google_ads' end;
  v_row_source text;
  v_campaign mkt.campaigns;
  v_count integer;
begin
  dropped := 0;
  code := private.ingest_row_problem(p_row, 'ad_campaign_daily', array['campaign_external_id', 'metric_on'],
            array['spend_cents', 'impressions', 'clicks', 'platform_leads', 'conversions', 'conversion_value_cents'],
            array['key.campaign_external_id', 'key.metric_on']);
  if code is not null then
    return;
  end if;
  select c.* into v_campaign from mkt.campaigns c
   where c.source = v_source and c.external_id = p_row #>> '{key,campaign_external_id}';
  if not found then
    code := 'UNKNOWN_CAMPAIGN';
    return;
  end if;
  if p_job = 'csv_import' and v_campaign.brand_id is distinct from p_brand_id then
    code := 'BRAND_MISMATCH';
    return;
  end if;
  v_row_source := case when p_job = 'csv_import' then 'csv' else v_source end;

  insert into mkt.ad_campaign_daily as d (campaign_id, brand_id, platform, metric_on, spend_cents, impressions, clicks,
                                          platform_leads, conversions, conversion_value_cents, source, fetched_at)
  values (v_campaign.id, v_campaign.brand_id, v_campaign.platform, (p_row #>> '{key,metric_on}')::date,
          coalesce((x ->> 'spend_cents')::bigint, 0), coalesce((x ->> 'impressions')::bigint, 0),
          coalesce((x ->> 'clicks')::bigint, 0), coalesce((x ->> 'platform_leads')::bigint, 0),
          coalesce((x ->> 'conversions')::numeric, 0), coalesce((x ->> 'conversion_value_cents')::bigint, 0),
          v_row_source, coalesce((p_row ->> 'fetched_at')::timestamptz, now()))
  on conflict (campaign_id, metric_on) do update
     set spend_cents = excluded.spend_cents, impressions = excluded.impressions, clicks = excluded.clicks,
         platform_leads = excluded.platform_leads, conversions = excluded.conversions,
         conversion_value_cents = excluded.conversion_value_cents, source = excluded.source,
         fetched_at = excluded.fetched_at
   where excluded.source <> 'csv' or d.source = 'csv';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    code := 'API_KEPT';
    return;
  end if;
  update mkt.ad_accounts a set first_read_at = now() where a.id = v_campaign.ad_account_id and a.first_read_at is null;
end $$;

-- Alteração feita na conta (Meta activities, Google change_event): só o tipo, o objeto, o campo e os valores
-- (mkt.valid_activity_details recusa o resto e os eventos de usuário, papel e cobrança).
create or replace function private.ingest_ad_activity(p_row jsonb, p_connector text, p_job text, p_brand_id uuid,
                                                      out code text, out dropped integer)
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  x jsonb := coalesce(p_row -> 'values', '{}'::jsonb);
  v_source text := case p_connector when 'meta' then 'meta_ads' else 'google_ads' end;
  v_account mkt.ad_accounts;
  v_campaign uuid;
begin
  dropped := 0;
  code := private.ingest_row_problem(p_row, 'ad_activity', array['external_id'],
            array['account_external_id', 'campaign_external_id', 'occurred_at', 'change_kind', 'is_by_csp_mkt',
                  'details'],
            array['key.external_id', 'values.account_external_id', 'values.occurred_at', 'values.change_kind',
                  'values.is_by_csp_mkt']);
  if code is not null then
    return;
  end if;
  select a.* into v_account from mkt.ad_accounts a
   where a.source = v_source and a.external_id = x ->> 'account_external_id';
  if not found then
    code := 'NOT_REGISTERED';
    return;
  end if;
  select c.id into v_campaign from mkt.campaigns c
   where c.source = v_source and c.external_id = x ->> 'campaign_external_id' and c.ad_account_id = v_account.id;
  insert into mkt.ad_activity_log as l (ad_account_id, brand_id, platform, campaign_id, source, external_id,
                                        occurred_at, change_kind, is_by_csp_mkt, details)
  values (v_account.id, v_account.brand_id, v_account.platform, v_campaign, v_source, p_row #>> '{key,external_id}',
          (x ->> 'occurred_at')::timestamptz, x ->> 'change_kind', (x ->> 'is_by_csp_mkt')::boolean,
          coalesce(x -> 'details', '{}'::jsonb))
  on conflict (source, external_id) do update
     set campaign_id = excluded.campaign_id, occurred_at = excluded.occurred_at, change_kind = excluded.change_kind,
         is_by_csp_mkt = excluded.is_by_csp_mkt, details = excluded.details;
end $$;

-- Perfil do Instagram: só o cadastrado (setup.register_ig_account); o @ e se está ativo. A leitura dá base ao perfil.
create or replace function private.ingest_ig_account(p_row jsonb, p_connector text, p_job text, p_brand_id uuid,
                                                     out code text, out dropped integer)
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  x jsonb := coalesce(p_row -> 'values', '{}'::jsonb);
begin
  dropped := 0;
  code := private.ingest_row_problem(p_row, 'ig_account', array['external_id'], array['username', 'is_active'],
                                     array['key.external_id']);
  if code is not null then
    return;
  end if;
  if x ? 'username' and coalesce(x ->> 'username', '') !~ '^[A-Za-z0-9._]{1,30}$' then
    code := 'FORMAT';
    return;
  end if;
  update mkt.ig_accounts g
     set username = case when x ? 'username' then x ->> 'username' else g.username end,
         is_active = case when x ? 'is_active' then (x ->> 'is_active')::boolean else g.is_active end,
         first_read_at = coalesce(g.first_read_at, now())
   where g.source = 'instagram' and g.external_id = p_row #>> '{key,external_id}';
  if not found then
    code := 'NOT_REGISTERED';
  end if;
end $$;

-- Perfil por dia: os seguidores saem da leitura de hora em hora e o resto do relatório do dia, em chamadas
-- diferentes; só as métricas que vieram mudam (nulo = a API não devolveu, diferente de 0).
create or replace function private.ingest_ig_account_daily(p_row jsonb, p_connector text, p_job text,
                                                           p_brand_id uuid, out code text, out dropped integer)
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  x jsonb := coalesce(p_row -> 'values', '{}'::jsonb);
  v_account mkt.ig_accounts;
begin
  dropped := 0;
  code := private.ingest_row_problem(p_row, 'ig_account_daily', array['account_external_id', 'metric_on'],
            array['followers_count', 'reach', 'views', 'total_interactions'],
            array['key.account_external_id', 'key.metric_on']);
  if code is not null then
    return;
  end if;
  select g.* into v_account from mkt.ig_accounts g
   where g.source = 'instagram' and g.external_id = p_row #>> '{key,account_external_id}';
  if not found then
    code := 'NOT_REGISTERED';
    return;
  end if;
  insert into mkt.ig_account_daily as d (ig_account_id, brand_id, metric_on, followers_count, reach, views,
                                         total_interactions, fetched_at)
  values (v_account.id, v_account.brand_id, (p_row #>> '{key,metric_on}')::date, (x ->> 'followers_count')::bigint,
          (x ->> 'reach')::bigint, (x ->> 'views')::bigint, (x ->> 'total_interactions')::bigint,
          coalesce((p_row ->> 'fetched_at')::timestamptz, now()))
  on conflict (ig_account_id, metric_on) do update
     set followers_count = case when x ? 'followers_count' then excluded.followers_count else d.followers_count end,
         reach = case when x ? 'reach' then excluded.reach else d.reach end,
         views = case when x ? 'views' then excluded.views else d.views end,
         total_interactions = case when x ? 'total_interactions' then excluded.total_interactions
                                   else d.total_interactions end,
         fetched_at = excluded.fetched_at;
  update mkt.ig_accounts g set first_read_at = now() where g.id = v_account.id and g.first_read_at is null;
end $$;

-- Post: o começo da legenda sem as menções @, até 120 letras, e nulo se parecer dado pessoal; o link só do Instagram.
create or replace function private.ingest_ig_media(p_row jsonb, p_connector text, p_job text, p_brand_id uuid,
                                                   out code text, out dropped integer)
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  x jsonb := coalesce(p_row -> 'values', '{}'::jsonb);
  v_account mkt.ig_accounts;
  v_caption text;
begin
  dropped := 0;
  code := private.ingest_row_problem(p_row, 'ig_media', array['external_id'],
            array['account_external_id', 'media_type', 'published_at', 'caption_excerpt', 'permalink'],
            array['key.external_id', 'values.account_external_id', 'values.media_type', 'values.published_at']);
  if code is not null then
    return;
  end if;
  select g.* into v_account from mkt.ig_accounts g
   where g.source = 'instagram' and g.external_id = x ->> 'account_external_id';
  if not found then
    code := 'NOT_REGISTERED';
    return;
  end if;
  v_caption := nullif(btrim(regexp_replace(regexp_replace(coalesce(x ->> 'caption_excerpt', ''),
                                                          '@[A-Za-z0-9._]+', '', 'g'), '\s+', ' ', 'g')), '');
  if mkt.has_personal_data(v_caption) then
    v_caption := null;
    dropped := 1;
  end if;
  insert into mkt.ig_media as m (ig_account_id, brand_id, external_id, media_type, published_at, caption_excerpt,
                                 permalink)
  values (v_account.id, v_account.brand_id, p_row #>> '{key,external_id}', x ->> 'media_type',
          (x ->> 'published_at')::timestamptz, left(v_caption, 120),
          case when x ->> 'permalink' ~ '^https://(www\.)?instagram\.com/[A-Za-z0-9_./?=&%-]*$' then x ->> 'permalink' end)
  on conflict (source, external_id) do update
     set media_type = excluded.media_type, published_at = excluded.published_at,
         caption_excerpt = excluded.caption_excerpt, permalink = excluded.permalink;
end $$;

-- O retrato do dia de um post (valores acumulados até o retrato).
create or replace function private.ingest_ig_media_daily(p_row jsonb, p_connector text, p_job text, p_brand_id uuid,
                                                         out code text, out dropped integer)
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  x jsonb := coalesce(p_row -> 'values', '{}'::jsonb);
  v_media mkt.ig_media;
begin
  dropped := 0;
  code := private.ingest_row_problem(p_row, 'ig_media_daily', array['media_external_id', 'captured_on'],
            array['reach', 'views', 'likes', 'comments', 'saves', 'shares', 'total_interactions'],
            array['key.media_external_id', 'key.captured_on']);
  if code is not null then
    return;
  end if;
  select m.* into v_media from mkt.ig_media m
   where m.source = 'instagram' and m.external_id = p_row #>> '{key,media_external_id}';
  if not found then
    code := 'UNKNOWN_MEDIA';
    return;
  end if;
  insert into mkt.ig_media_daily as d (ig_media_id, brand_id, captured_on, reach, views, likes, comments, saves, shares,
                                       total_interactions, fetched_at)
  values (v_media.id, v_media.brand_id, (p_row #>> '{key,captured_on}')::date, (x ->> 'reach')::bigint,
          (x ->> 'views')::bigint, (x ->> 'likes')::bigint, (x ->> 'comments')::bigint, (x ->> 'saves')::bigint,
          (x ->> 'shares')::bigint, (x ->> 'total_interactions')::bigint,
          coalesce((p_row ->> 'fetched_at')::timestamptz, now()))
  on conflict (ig_media_id, captured_on) do update
     set reach = excluded.reach, views = excluded.views, likes = excluded.likes, comments = excluded.comments,
         saves = excluded.saves, shares = excluded.shares, total_interactions = excluded.total_interactions,
         fetched_at = excluded.fetched_at;
end $$;

-- Search Console, totais do dia, da propriedade cadastrada. Gravar dá base à propriedade (first_read_at).
create or replace function private.ingest_seo_daily(p_row jsonb, p_connector text, p_job text, p_brand_id uuid,
                                                    out code text, out dropped integer)
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  x jsonb := coalesce(p_row -> 'values', '{}'::jsonb);
  v_property mkt.web_properties;
begin
  dropped := 0;
  code := private.ingest_row_problem(p_row, 'seo_daily', array['property_external_id', 'metric_on'],
            array['impressions', 'clicks', 'position'],
            array['key.property_external_id', 'key.metric_on', 'values.impressions', 'values.clicks']);
  if code is not null then
    return;
  end if;
  select w.* into v_property from mkt.web_properties w
   where w.source = 'search_console' and w.external_id = p_row #>> '{key,property_external_id}';
  if not found then
    code := 'NOT_REGISTERED';
    return;
  end if;
  insert into mkt.seo_daily as s (web_property_id, brand_id, metric_on, impressions, clicks, position, fetched_at)
  values (v_property.id, v_property.brand_id, (p_row #>> '{key,metric_on}')::date, (x ->> 'impressions')::bigint,
          (x ->> 'clicks')::bigint, (x ->> 'position')::numeric, coalesce((p_row ->> 'fetched_at')::timestamptz, now()))
  on conflict (web_property_id, metric_on) do update
     set impressions = excluded.impressions, clicks = excluded.clicks, position = excluded.position,
         fetched_at = excluded.fetched_at;
  update mkt.web_properties w set first_read_at = now() where w.id = v_property.id and w.first_read_at is null;
end $$;

-- Search Console, consultas do dia. A consulta com cara de dado pessoal (e-mail, telefone, documento) não é gravada.
create or replace function private.ingest_seo_query_daily(p_row jsonb, p_connector text, p_job text, p_brand_id uuid,
                                                          out code text, out dropped integer)
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  x jsonb := coalesce(p_row -> 'values', '{}'::jsonb);
  v_property mkt.web_properties;
begin
  dropped := 0;
  code := private.ingest_row_problem(p_row, 'seo_query_daily', array['property_external_id', 'metric_on', 'query'],
            array['impressions', 'clicks', 'position'],
            array['key.property_external_id', 'key.metric_on', 'key.query', 'values.impressions', 'values.clicks']);
  if code is not null then
    return;
  end if;
  select w.* into v_property from mkt.web_properties w
   where w.source = 'search_console' and w.external_id = p_row #>> '{key,property_external_id}';
  if not found then
    code := 'NOT_REGISTERED';
    return;
  end if;
  if strpos(p_row #>> '{key,query}', '@') > 0 or mkt.has_personal_data(p_row #>> '{key,query}') then
    code := 'PERSONAL_DATA_DROPPED';
    dropped := 1;
    return;
  end if;
  insert into mkt.seo_query_daily as s (web_property_id, brand_id, metric_on, query, impressions, clicks, position,
                                        fetched_at)
  values (v_property.id, v_property.brand_id, (p_row #>> '{key,metric_on}')::date, p_row #>> '{key,query}',
          (x ->> 'impressions')::bigint, (x ->> 'clicks')::bigint, (x ->> 'position')::numeric,
          coalesce((p_row ->> 'fetched_at')::timestamptz, now()))
  on conflict (web_property_id, metric_on, query) do update
     set impressions = excluded.impressions, clicks = excluded.clicks, position = excluded.position,
         fetched_at = excluded.fetched_at;
  update mkt.web_properties w set first_read_at = now() where w.id = v_property.id and w.first_read_at is null;
end $$;

-- GA4: sessões por origem, meio e canal, como vêm. Origem ou meio com cara de dado pessoal: a linha não é gravada.
create or replace function private.ingest_ga4_traffic_daily(p_row jsonb, p_connector text, p_job text,
                                                            p_brand_id uuid, out code text, out dropped integer)
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  k jsonb := p_row -> 'key';
  x jsonb := coalesce(p_row -> 'values', '{}'::jsonb);
  v_property mkt.web_properties;
begin
  dropped := 0;
  code := private.ingest_row_problem(p_row, 'ga4_traffic_daily',
            array['property_external_id', 'metric_on', 'session_source', 'session_medium', 'channel_group_raw'],
            array['sessions', 'lead_events'],
            array['key.property_external_id', 'key.metric_on', 'key.session_source', 'key.session_medium',
                  'key.channel_group_raw', 'values.sessions']);
  if code is not null then
    return;
  end if;
  select w.* into v_property from mkt.web_properties w
   where w.source = 'ga4' and w.external_id = k ->> 'property_external_id';
  if not found then
    code := 'NOT_REGISTERED';
    return;
  end if;
  if strpos(concat_ws(' ', k ->> 'session_source', k ->> 'session_medium'), '@') > 0
     or mkt.has_personal_data(concat_ws(' ', k ->> 'session_source', k ->> 'session_medium')) then
    code := 'PERSONAL_DATA_DROPPED';
    dropped := 1;
    return;
  end if;
  insert into mkt.ga4_traffic_daily as g (web_property_id, brand_id, metric_on, session_source, session_medium,
                                          channel_group_raw, sessions, lead_events, fetched_at)
  values (v_property.id, v_property.brand_id, (k ->> 'metric_on')::date, k ->> 'session_source',
          k ->> 'session_medium', k ->> 'channel_group_raw', (x ->> 'sessions')::bigint,
          (x ->> 'lead_events')::bigint, coalesce((p_row ->> 'fetched_at')::timestamptz, now()))
  on conflict (web_property_id, metric_on, session_source, session_medium, channel_group_raw) do update
     set sessions = excluded.sessions, lead_events = excluded.lead_events, fetched_at = excluded.fetched_at;
  update mkt.web_properties w set first_read_at = now() where w.id = v_property.id and w.first_read_at is null;
end $$;

-- Checagem dos sites (robots.txt, llms.txt, JSON-LD), sem rodada: o achado de cada item, no host da propriedade.
create or replace function private.ingest_site_check(p_row jsonb, p_connector text, p_job text, p_brand_id uuid,
                                                     out code text, out dropped integer)
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  k jsonb := p_row -> 'key';
  x jsonb := coalesce(p_row -> 'values', '{}'::jsonb);
  v_property mkt.web_properties;
  v_detail text;
begin
  dropped := 0;
  code := private.ingest_row_problem(p_row, 'site_check',
            array['property_source', 'property_external_id', 'item', 'checked_on'],
            array['finding', 'http_status', 'detail', 'checked_at'],
            array['key.property_source', 'key.property_external_id', 'key.item', 'key.checked_on', 'values.finding']);
  if code is not null then
    return;
  end if;
  select w.* into v_property from mkt.web_properties w
   where w.source = k ->> 'property_source' and w.external_id = k ->> 'property_external_id';
  if not found then
    code := 'NOT_REGISTERED';
    return;
  end if;
  v_detail := left(btrim(x ->> 'detail'), 300);
  if strpos(v_detail, '@') > 0 or mkt.has_personal_data(v_detail) then
    v_detail := null;
    dropped := 1;
  end if;
  insert into mkt.site_checks as s (web_property_id, brand_id, host, item, finding, http_status, detail, checked_at,
                                    checked_on)
  values (v_property.id, v_property.brand_id, v_property.host, k ->> 'item', x ->> 'finding',
          (x ->> 'http_status')::integer, v_detail, coalesce((x ->> 'checked_at')::timestamptz, now()),
          (k ->> 'checked_on')::date)
  on conflict (web_property_id, item, checked_on) do update
     set host = excluded.host, finding = excluded.finding, http_status = excluded.http_status,
         detail = excluded.detail, checked_at = excluded.checked_at;
end $$;

-- ---------- O que o worker chama: uma upsert por tabela de fora (integracoes.md, seção 2.3) ----------
-- (p_run_id, p_rows): o lote de até 1.000 eventos da rodada em andamento, do conector da tabela. Devolve as linhas que
-- não gravou: item (a posição no lote, a partir de 1), code e is_refused (as recusadas contam em rows_refused; as
-- ignoradas, não).

create or replace function ingest.upsert_brands(p_run_id uuid, p_rows jsonb)
returns table (item integer, code text, is_refused boolean)
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select * from private.ingest_batch(p_run_id, p_rows, array['csp360'], 'private.ingest_brand')
$$;

create or replace function ingest.upsert_crm_funnels(p_run_id uuid, p_rows jsonb)
returns table (item integer, code text, is_refused boolean)
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select * from private.ingest_batch(p_run_id, p_rows, array['csp360'], 'private.ingest_crm_funnel')
$$;

create or replace function ingest.upsert_sales_reps(p_run_id uuid, p_rows jsonb)
returns table (item integer, code text, is_refused boolean)
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select * from private.ingest_batch(p_run_id, p_rows, array['csp360'], 'private.ingest_sales_rep')
$$;

create or replace function ingest.upsert_sales_rep_app_logins(p_run_id uuid, p_rows jsonb)
returns table (item integer, code text, is_refused boolean)
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select * from private.ingest_batch(p_run_id, p_rows, array['csp360'], 'private.ingest_sales_rep_app_login')
$$;

create or replace function ingest.upsert_crm_customers(p_run_id uuid, p_rows jsonb)
returns table (item integer, code text, is_refused boolean)
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select * from private.ingest_batch(p_run_id, p_rows, array['csp360'], 'private.ingest_crm_customer')
$$;

create or replace function ingest.upsert_crm_customer_brands(p_run_id uuid, p_rows jsonb)
returns table (item integer, code text, is_refused boolean)
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select * from private.ingest_batch(p_run_id, p_rows, array['csp360'], 'private.ingest_crm_customer_brand')
$$;

create or replace function ingest.upsert_crm_customer_reps(p_run_id uuid, p_rows jsonb)
returns table (item integer, code text, is_refused boolean)
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select * from private.ingest_batch(p_run_id, p_rows, array['csp360'], 'private.ingest_crm_customer_rep')
$$;

create or replace function ingest.upsert_crm_leads(p_run_id uuid, p_rows jsonb)
returns table (item integer, code text, is_refused boolean)
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select * from private.ingest_batch(p_run_id, p_rows, array['csp360'], 'private.ingest_crm_lead')
$$;

create or replace function ingest.upsert_crm_orders(p_run_id uuid, p_rows jsonb)
returns table (item integer, code text, is_refused boolean)
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select * from private.ingest_batch(p_run_id, p_rows, array['csp360'], 'private.ingest_crm_order')
$$;

create or replace function ingest.upsert_crm_upstream_runs(p_run_id uuid, p_rows jsonb)
returns table (item integer, code text, is_refused boolean)
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select * from private.ingest_batch(p_run_id, p_rows, array['csp360'], 'private.ingest_crm_upstream_run')
$$;

create or replace function ingest.upsert_ad_accounts(p_run_id uuid, p_rows jsonb)
returns table (item integer, code text, is_refused boolean)
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select * from private.ingest_batch(p_run_id, p_rows, array['meta', 'tiktok', 'google_ads'],
                                     'private.ingest_ad_account')
$$;

create or replace function ingest.upsert_campaigns(p_run_id uuid, p_rows jsonb)
returns table (item integer, code text, is_refused boolean)
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select * from private.ingest_batch(p_run_id, p_rows, array['meta', 'tiktok', 'google_ads'], 'private.ingest_campaign')
$$;

create or replace function ingest.upsert_ad_campaign_daily(p_run_id uuid, p_rows jsonb)
returns table (item integer, code text, is_refused boolean)
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select * from private.ingest_batch(p_run_id, p_rows, array['meta', 'tiktok', 'google_ads'],
                                     'private.ingest_ad_campaign_daily')
$$;

create or replace function ingest.upsert_ad_activity_log(p_run_id uuid, p_rows jsonb)
returns table (item integer, code text, is_refused boolean)
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select * from private.ingest_batch(p_run_id, p_rows, array['meta', 'google_ads'], 'private.ingest_ad_activity')
$$;

create or replace function ingest.upsert_ig_accounts(p_run_id uuid, p_rows jsonb)
returns table (item integer, code text, is_refused boolean)
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select * from private.ingest_batch(p_run_id, p_rows, array['instagram'], 'private.ingest_ig_account')
$$;

create or replace function ingest.upsert_ig_account_daily(p_run_id uuid, p_rows jsonb)
returns table (item integer, code text, is_refused boolean)
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select * from private.ingest_batch(p_run_id, p_rows, array['instagram'], 'private.ingest_ig_account_daily')
$$;

create or replace function ingest.upsert_ig_media(p_run_id uuid, p_rows jsonb)
returns table (item integer, code text, is_refused boolean)
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select * from private.ingest_batch(p_run_id, p_rows, array['instagram'], 'private.ingest_ig_media')
$$;

create or replace function ingest.upsert_ig_media_daily(p_run_id uuid, p_rows jsonb)
returns table (item integer, code text, is_refused boolean)
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select * from private.ingest_batch(p_run_id, p_rows, array['instagram'], 'private.ingest_ig_media_daily')
$$;

create or replace function ingest.upsert_seo_daily(p_run_id uuid, p_rows jsonb)
returns table (item integer, code text, is_refused boolean)
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select * from private.ingest_batch(p_run_id, p_rows, array['search_console'], 'private.ingest_seo_daily')
$$;

create or replace function ingest.upsert_seo_query_daily(p_run_id uuid, p_rows jsonb)
returns table (item integer, code text, is_refused boolean)
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select * from private.ingest_batch(p_run_id, p_rows, array['search_console'], 'private.ingest_seo_query_daily')
$$;

create or replace function ingest.upsert_ga4_traffic_daily(p_run_id uuid, p_rows jsonb)
returns table (item integer, code text, is_refused boolean)
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select * from private.ingest_batch(p_run_id, p_rows, array['ga4'], 'private.ingest_ga4_traffic_daily')
$$;

-- A checagem dos sites não tem rodada (integracoes.md, seção 2.1).
create or replace function ingest.upsert_site_checks(p_rows jsonb)
returns table (item integer, code text, is_refused boolean)
language sql security definer set search_path = pg_catalog, pg_temp as $$
  select * from private.ingest_batch(null, p_rows, null, 'private.ingest_site_check')
$$;

-- ---------- Releitura e passada completa ----------

-- A releitura troca o dia inteiro (decisão 0035; integracoes.md, seção 2.3): numa transação, grava as linhas lidas e
-- apaga as do mesmo dia e da mesma conta (ad_campaign_daily, inclusive as do CSV: a API vence) ou da mesma
-- propriedade (ga4_traffic_daily, seo_query_daily) que não vieram. O lote é de um dia e de uma conta ou propriedade
-- só; linha de fora recusa o lote inteiro. A rodada do CSV nunca troca o dia. A linha recusada continua contando como
-- lida: a dela não é apagada.
create or replace function ingest.replace_day(p_run_id uuid, p_table text, p_scope_external_id text, p_metric_on date,
                                              p_rows jsonb)
returns table (item integer, code text, is_refused boolean)
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_connector text;
  v_job text;
  v_source text;
  v_scope uuid;
  v_deleted integer := 0;
begin
  if session_user::text <> 'mkt_worker' then
    raise sqlstate 'PT403' using message = 'ING-403';
  end if;
  select k.code, s.job into v_connector, v_job
    from mkt.sync_runs s join mkt.connectors k on k.id = s.connector_id
   where s.id = p_run_id and s.status = 'running';
  if not found then
    raise sqlstate 'PT422' using message = 'ING-422', detail = 'run';
  end if;
  if v_job = 'csv_import' then
    raise sqlstate 'PT422' using message = 'ING-422', detail = 'csv';
  end if;
  if p_table is null or p_table not in ('ad_campaign_daily', 'ga4_traffic_daily', 'seo_query_daily') then
    raise sqlstate 'PT422' using message = 'ING-422', detail = 'table';
  end if;
  if p_metric_on is null or p_scope_external_id is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise sqlstate 'PT422' using message = 'ING-422', detail = 'rows';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) e
              where jsonb_typeof(e.value) <> 'object'
                 or (e.value #>> '{key,metric_on}') is distinct from to_char(p_metric_on, 'YYYY-MM-DD')
                 or (p_table <> 'ad_campaign_daily'
                     and (e.value #>> '{key,property_external_id}') is distinct from p_scope_external_id)) then
    raise sqlstate 'PT422' using message = 'ING-422', detail = 'scope';
  end if;

  if p_table = 'ad_campaign_daily' then
    if v_connector not in ('meta', 'tiktok', 'google_ads') then
      raise sqlstate 'PT422' using message = 'ING-422', detail = 'connector';
    end if;
    v_source := case v_connector when 'meta' then 'meta_ads' when 'tiktok' then 'tiktok_ads' else 'google_ads' end;
    select a.id into v_scope from mkt.ad_accounts a where a.source = v_source and a.external_id = p_scope_external_id;
    if exists (select 1
                 from jsonb_array_elements(p_rows) e
                 join mkt.campaigns c on c.source = v_source and c.external_id = e.value #>> '{key,campaign_external_id}'
                where c.ad_account_id is distinct from v_scope) then
      raise sqlstate 'PT422' using message = 'ING-422', detail = 'scope';
    end if;
    return query select * from private.ingest_batch(p_run_id, p_rows, array['meta', 'tiktok', 'google_ads'],
                                                    'private.ingest_ad_campaign_daily');
    delete from mkt.ad_campaign_daily d
     using mkt.campaigns c
     where c.id = d.campaign_id and c.ad_account_id = v_scope and d.metric_on = p_metric_on
       and not exists (select 1 from jsonb_array_elements(p_rows) e
                        where e.value #>> '{key,campaign_external_id}' = c.external_id);
    get diagnostics v_deleted = row_count;
  elsif p_table = 'ga4_traffic_daily' then
    select w.id into v_scope from mkt.web_properties w
     where w.source = 'ga4' and w.external_id = p_scope_external_id;
    return query select * from private.ingest_batch(p_run_id, p_rows, array['ga4'],
                                                    'private.ingest_ga4_traffic_daily');
    delete from mkt.ga4_traffic_daily g
     where g.web_property_id = v_scope and g.metric_on = p_metric_on
       and not exists (select 1 from jsonb_array_elements(p_rows) e
                        where e.value #>> '{key,session_source}' = g.session_source
                          and e.value #>> '{key,session_medium}' = g.session_medium
                          and e.value #>> '{key,channel_group_raw}' = g.channel_group_raw);
    get diagnostics v_deleted = row_count;
  else
    select w.id into v_scope from mkt.web_properties w
     where w.source = 'search_console' and w.external_id = p_scope_external_id;
    return query select * from private.ingest_batch(p_run_id, p_rows, array['search_console'],
                                                    'private.ingest_seo_query_daily');
    delete from mkt.seo_query_daily q
     where q.web_property_id = v_scope and q.metric_on = p_metric_on
       and not exists (select 1 from jsonb_array_elements(p_rows) e where e.value #>> '{key,query}' = q.query);
    get diagnostics v_deleted = row_count;
  end if;

  if v_deleted > 0 then
    update mkt.sync_runs s set rows_deleted = s.rows_deleted + v_deleted where s.id = p_run_id;
  end if;
end $$;

-- A passada completa do CRM apaga o que sumiu de lá, sem cópia (decisão 0015; integracoes.md, seção 3.4): só as
-- tabelas da lista fixa, só na rodada crm_full_pass em andamento, e só o que a passada não viu (visto antes do começo
-- dela; o login de app, pelo updated_at). Conta antes: acima de 20% da tabela, não apaga nada e devolve
-- MASS_DELETE_BLOCKED (a rodada termina partial com esse código), a menos que o dono tenha confirmado a passada
-- anterior (api.confirm_mass_delete). crm_upstream_runs fica fora: a leitura traz só as últimas rodadas, e o pg_cron
-- apaga as de mais de 90 dias. O par cliente × marca que a passada não viu e tem a compra do ERP mais antiga já vista
-- não sai: perde só o retrato (fica nulo o que espelha o CRM), e a linha e a data ficam, porque o CRM não a tem mais
-- (decisão 0042); o par sai com o cliente, pela cascata de crm_customers. Ali a trava conta só o que a chamada muda (o
-- par sem a data, que sai, e o que ainda tem retrato), e deleted conta só o que saiu.
create or replace function ingest.delete_missing(p_table text, p_run_id uuid)
returns table (deleted integer, code text)
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_run mkt.sync_runs;
  v_column text;
  v_cutoff timestamptz;
  v_total bigint;
  v_missing bigint;
  v_confirmed boolean;
  v_deleted integer;
begin
  if session_user::text <> 'mkt_worker' then
    raise sqlstate 'PT403' using message = 'ING-403';
  end if;
  if p_table is null or p_table not in ('crm_funnels', 'crm_customers', 'crm_customer_brands', 'crm_customer_reps',
                                        'crm_leads', 'crm_orders', 'sales_reps', 'sales_rep_app_logins') then
    raise sqlstate 'PT422' using message = 'ING-422', detail = 'table';
  end if;
  select r.* into v_run
    from mkt.sync_runs r join mkt.connectors k on k.id = r.connector_id
   where r.id = p_run_id and k.code = 'csp360' and r.job = 'crm_full_pass' and r.status = 'running'
     for update of r;
  if not found then
    raise sqlstate 'PT422' using message = 'ING-422', detail = 'run';
  end if;

  v_column := case when p_table = 'sales_rep_app_logins' then 'updated_at' else 'last_seen_at' end;
  v_cutoff := date_trunc('milliseconds', v_run.started_at);
  if p_table = 'crm_customer_brands' then
    select count(*),
           count(*) filter (where cb.last_seen_at < v_cutoff
                              and (cb.erp_earliest_purchase_on is null
                                   or num_nonnulls(cb.situation, cb.is_lost_manual, cb.last_purchase_on,
                                                   cb.erp_first_purchase_on, cb.erp_last_purchase_on,
                                                   cb.erp_total_purchased_cents, cb.situation_computed_at) > 0))
      into v_total, v_missing
      from mkt.crm_customer_brands cb;
  else
    execute format('select count(*), count(*) filter (where coalesce(t.%I, ''-infinity'') < $1) from mkt.%I t',
                   v_column, p_table)
       into v_total, v_missing using v_cutoff;
  end if;
  if v_missing = 0 then
    deleted := 0;
    return next;
    return;
  end if;

  select coalesce((select r.mass_delete_confirmed_at is not null
                     from mkt.sync_runs r
                    where r.connector_id = v_run.connector_id and r.job = 'crm_full_pass' and r.id <> v_run.id
                      and r.status in ('succeeded', 'partial', 'failed') and r.started_at < v_run.started_at
                    order by r.started_at desc
                    limit 1), false)
    into v_confirmed;
  if v_missing * 5 > v_total and not v_confirmed then
    update mkt.sync_runs r set error_code = 'MASS_DELETE_BLOCKED' where r.id = v_run.id;
    deleted := 0;
    code := 'MASS_DELETE_BLOCKED';
    return next;
    return;
  end if;

  if p_table = 'crm_customer_brands' then
    delete from mkt.crm_customer_brands cb
     where cb.last_seen_at < v_cutoff and cb.erp_earliest_purchase_on is null;
    get diagnostics v_deleted = row_count;
    update mkt.crm_customer_brands cb
       set situation = null, is_lost_manual = null, last_purchase_on = null, erp_first_purchase_on = null,
           erp_last_purchase_on = null, erp_total_purchased_cents = null, situation_computed_at = null
     where cb.last_seen_at < v_cutoff
       and num_nonnulls(cb.situation, cb.is_lost_manual, cb.last_purchase_on, cb.erp_first_purchase_on,
                        cb.erp_last_purchase_on, cb.erp_total_purchased_cents, cb.situation_computed_at) > 0;
  else
    execute format('delete from mkt.%I t where coalesce(t.%I, ''-infinity'') < $1', p_table, v_column)
      using v_cutoff;
    get diagnostics v_deleted = row_count;
  end if;
  update mkt.sync_runs r set rows_deleted = r.rows_deleted + v_deleted where r.id = v_run.id;
  deleted := v_deleted;
  return next;
end $$;

-- ---------- Rodadas (sync_runs) e o estado das credenciais ----------

-- Abre a rodada de um trabalho agendado ou da primeira carga (os pedidos de "Tentar de novo" e os CSV vêm por
-- take_requested_run). O trabalho é um dos do conector (connector_jobs); o conector desligado não roda.
create or replace function ingest.start_run(p_connector mkt.connector_code, p_job mkt.sync_job,
                                            p_trigger mkt.sync_trigger default 'schedule',
                                            p_brand mkt.brand_code default null,
                                            p_watermark_from_at timestamptz default null,
                                            p_watermark_to_at timestamptz default null)
returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_connector mkt.connectors;
  v_brand_id uuid;
  v_id uuid;
begin
  if session_user::text <> 'mkt_worker' then
    raise sqlstate 'PT403' using message = 'ING-403';
  end if;
  if p_trigger is null or p_trigger not in ('schedule', 'backfill') then
    raise sqlstate 'PT422' using message = 'ING-422', detail = 'trigger';
  end if;
  select k.* into v_connector from mkt.connectors k where k.code = p_connector;
  if not found then
    raise sqlstate 'PT404' using message = 'ING-404', detail = 'connector';
  end if;
  if v_connector.setup_state = 'disabled' then
    raise sqlstate 'PT422' using message = 'ING-422', detail = 'disabled';
  end if;
  if not exists (select 1 from mkt.connector_jobs j where j.connector_id = v_connector.id and j.job = p_job) then
    raise sqlstate 'PT422' using message = 'ING-422', detail = 'job';
  end if;
  if p_brand is not null then
    select b.id into v_brand_id from mkt.brands b where b.code = p_brand;
    if v_brand_id is null then
      raise sqlstate 'PT404' using message = 'ING-404', detail = 'brand';
    end if;
  end if;
  insert into mkt.sync_runs (connector_id, job, run_trigger, status, brand_id, started_at, watermark_from_at,
                             watermark_to_at)
  values (v_connector.id, p_job, p_trigger, 'running', v_brand_id, now(), p_watermark_from_at, p_watermark_to_at)
  returning id into v_id;
  return v_id;
end $$;

-- Pega o pedido mais antigo ("Tentar de novo" ou um CSV enviado), de um conector ou de qualquer um, e o põe em
-- andamento. Pedido de conector desligado fica na fila. Sem pedido, nada.
create or replace function ingest.take_requested_run(p_connector mkt.connector_code default null)
returns setof mkt.sync_runs
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_id uuid;
  v_run mkt.sync_runs;
begin
  if session_user::text <> 'mkt_worker' then
    raise sqlstate 'PT403' using message = 'ING-403';
  end if;
  select r.id into v_id
    from mkt.sync_runs r
    join mkt.connectors k on k.id = r.connector_id
   where r.status = 'requested' and k.setup_state <> 'disabled' and (p_connector is null or k.code = p_connector)
   order by r.requested_at nulls last, r.created_at, r.id
   limit 1
     for update of r skip locked;
  if v_id is null then
    return;
  end if;
  update mkt.sync_runs r set status = 'running', started_at = now() where r.id = v_id returning r.* into v_run;
  return next v_run;
end $$;

-- Fecha a rodada (integracoes.md, seção 2.3): succeeded, partial ou failed (os dois últimos com o código). A rodada
-- boa, também a partial e a do CSV, grava a última e a primeira rodada boa do conector (que nunca volta a nula) e a do
-- trabalho; a primeira rodada boa da API liga o conector que estava a ligar (o CSV dá base, mas não liga). Exclusão em
-- massa segurada na passada fica partial com MASS_DELETE_BLOCKED, para o dono poder confirmar. O CSV lido sai da
-- tabela; fica o registro. A mensagem de erro com cara de dado pessoal não é gravada.
create or replace function ingest.finish_run(p_run_id uuid, p_status mkt.sync_status, p_error_code text default null,
                                             p_error_message text default null,
                                             p_watermark_to_at timestamptz default null)
returns mkt.sync_runs
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v mkt.sync_runs;
  v_status mkt.sync_status := p_status;
  v_code text := p_error_code;
  v_message text;
begin
  if session_user::text <> 'mkt_worker' then
    raise sqlstate 'PT403' using message = 'ING-403';
  end if;
  select r.* into v from mkt.sync_runs r where r.id = p_run_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'ING-404', detail = 'run';
  end if;
  if v.status <> 'running' then
    raise sqlstate 'PT422' using message = 'ING-422', detail = 'run';
  end if;
  if v_status is null or v_status not in ('succeeded', 'partial', 'failed') then
    raise sqlstate 'PT422' using message = 'ING-422', detail = 'status';
  end if;
  if v.error_code = 'MASS_DELETE_BLOCKED' and v_status <> 'failed' then
    v_status := 'partial';
    v_code := 'MASS_DELETE_BLOCKED';
  end if;
  if v_status = 'succeeded' then
    v_code := null;
  elsif v_code is null then
    v_code := v.error_code;
  end if;
  if v_status <> 'succeeded' and v_code is null then
    raise sqlstate 'PT422' using message = 'ING-422', detail = 'error_code';
  end if;
  if v_status <> 'succeeded' and p_error_message is not null and strpos(p_error_message, '@') = 0
     and not mkt.has_personal_data(p_error_message) then
    v_message := left(btrim(p_error_message), 300);
  end if;

  update mkt.sync_runs r
     set status = v_status, finished_at = now(), error_code = v_code, error_message = v_message,
         watermark_to_at = coalesce(p_watermark_to_at, r.watermark_to_at)
   where r.id = v.id
  returning * into v;

  if v.status in ('succeeded', 'partial') then
    update mkt.connectors k
       set last_success_at = v.finished_at, first_success_at = coalesce(k.first_success_at, v.finished_at),
           setup_state = case when k.setup_state = 'not_connected' and v.job <> 'csv_import' then 'connected'
                              else k.setup_state end
     where k.id = v.connector_id;
    update mkt.connector_jobs j set last_success_at = v.finished_at
     where j.connector_id = v.connector_id and j.job = v.job;
  end if;
  if v.job = 'csv_import' then
    update mkt.csv_imports c
       set content = null, rows_imported = v.rows_written, rows_refused = v.rows_refused,
           refusal_code = case when v.status <> 'succeeded' then v.error_code end
     where c.sync_run_id = v.id;
  end if;
  return v;
end $$;

-- O estado de uma credencial de leitura que o worker conferiu (vence logo, recusada pela plataforma, de novo válida):
-- a hora da conferência e, quando muda, a auditoria (credential_status_changed). A de escrita não é do worker.
create or replace function ingest.set_credential_status(p_credential_id uuid, p_status mkt.credential_status)
returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v private.connector_credentials;
begin
  if session_user::text <> 'mkt_worker' then
    raise sqlstate 'PT403' using message = 'CON-403';
  end if;
  select c.* into v from private.connector_credentials c where c.id = p_credential_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'CON-404';
  end if;
  if v.purpose <> 'read' then
    raise sqlstate 'PT403' using message = 'CON-403', detail = 'purpose';
  end if;
  if p_status is null then
    raise sqlstate 'PT422' using message = 'CON-422', detail = 'status';
  end if;
  update private.connector_credentials c set status = p_status, last_checked_at = now() where c.id = v.id;
  if p_status <> v.status then
    insert into mkt.audit_log (actor_kind, event, target_table, target_id, changes)
    select 'system', 'credential_status_changed', 'connector_credentials', v.id,
           jsonb_build_object('connector', k.code, 'purpose', v.purpose,
                              'status', jsonb_build_object('before', v.status, 'after', p_status))
      from mkt.connectors k where k.id = v.connector_id;
  end if;
end $$;

-- ---------- O Claude: a rodada e as propostas (integracoes.md, seção 15) ----------

-- A rodada, por id (o worker cria antes de chamar a API): repetir não duplica. Contexto que mkt.valid_claude_context
-- recusa, ou instrução com dado pessoal, não é guardado: a rodada nasce falhada (CONTEXT_REFUSED), e o worker não
-- chama a API. Depois de terminar, a rodada não volta a rodar. O prompt e o contexto não mudam depois de gravados;
-- as propostas recusadas, a resposta e o consumo chegam no fim.
create or replace function ingest.record_claude_run(
  p_id uuid, p_brand mkt.brand_code, p_status mkt.run_status, p_model text, p_prompt_version text, p_prompt text,
  p_context jsonb, p_started_at timestamptz, p_output jsonb default null, p_input_tokens integer default null,
  p_output_tokens integer default null, p_proposals_refused integer default null, p_error_code text default null,
  p_finished_at timestamptz default null)
returns mkt.claude_runs
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v mkt.claude_runs;
  v_brand_id uuid;
  v_refused boolean;
begin
  if session_user::text <> 'mkt_worker' then
    raise sqlstate 'PT403' using message = 'ING-403';
  end if;
  if p_id is null or p_status is null then
    raise sqlstate 'PT422' using message = 'ING-422', detail = 'run';
  end if;
  if p_brand is not null then
    select b.id into v_brand_id from mkt.brands b where b.code = p_brand;
    if v_brand_id is null then
      raise sqlstate 'PT404' using message = 'ING-404', detail = 'brand';
    end if;
  end if;

  select r.* into v from mkt.claude_runs r where r.id = p_id for update;
  if not found then
    v_refused := not coalesce(mkt.valid_claude_context(p_context), false) or mkt.has_personal_data(p_prompt);
    insert into mkt.claude_runs (id, brand_id, status, model, prompt_version, prompt, context, output, input_tokens,
                                 output_tokens, proposals_refused, error_code, started_at, finished_at)
    values (p_id, v_brand_id, case when v_refused then 'failed' else p_status end, p_model, p_prompt_version,
            case when mkt.has_personal_data(p_prompt) then '' else p_prompt end,
            case when v_refused then '{}'::jsonb else p_context end,
            case when v_refused then null else p_output end, p_input_tokens, p_output_tokens,
            coalesce(p_proposals_refused, 0),
            case when v_refused then 'CONTEXT_REFUSED' else p_error_code end,
            coalesce(p_started_at, now()),
            case when v_refused or p_status <> 'running' then coalesce(p_finished_at, now()) end)
    returning * into v;
    return v;
  end if;

  if v.brand_id is distinct from v_brand_id then
    raise sqlstate 'PT422' using message = 'ING-422', detail = 'brand';
  end if;
  if v.status <> 'running' and p_status <> v.status then
    raise sqlstate 'PT422' using message = 'ING-422', detail = 'status';
  end if;
  update mkt.claude_runs r
     set status = p_status, output = coalesce(p_output, r.output),
         input_tokens = coalesce(p_input_tokens, r.input_tokens),
         output_tokens = coalesce(p_output_tokens, r.output_tokens),
         proposals_refused = coalesce(p_proposals_refused, r.proposals_refused),
         error_code = coalesce(p_error_code, r.error_code),
         finished_at = case when p_status <> 'running' then coalesce(r.finished_at, p_finished_at, now()) end
   where r.id = v.id
  returning * into v;
  return v;
end $$;

-- Uma proposta do Claude, pela posição na resposta: passa por private.validate_action (a mesma da pessoa) e nasce
-- ideia, em nome do Claude. Repetir devolve a mesma ação, sem gastar código. A inválida, ou de outra marca que não a da
-- rodada, fica de fora (devolve nulo); o worker conta as de fora em record_claude_run (proposals_refused).
create or replace function ingest.add_claude_proposal(
  p_run_id uuid, p_item integer, p_brand mkt.brand_code, p_platform mkt.platform, p_campaign_id uuid,
  p_kind mkt.action_kind, p_title text, p_rationale text, p_params jsonb, p_impact mkt.level, p_effort mkt.level,
  p_cost_cents bigint)
returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_run mkt.claude_runs;
  v_checked record;
  v_id uuid;
begin
  if session_user::text <> 'mkt_worker' then
    raise sqlstate 'PT403' using message = 'ING-403';
  end if;
  select r.* into v_run from mkt.claude_runs r where r.id = p_run_id;
  if not found then
    raise sqlstate 'PT404' using message = 'ING-404', detail = 'run';
  end if;
  if v_run.status = 'failed' then
    raise sqlstate 'PT422' using message = 'ING-422', detail = 'run';
  end if;
  if p_item is null or p_item < 1 then
    raise sqlstate 'PT422' using message = 'ING-422', detail = 'item';
  end if;
  select a.id into v_id from mkt.traffic_actions a where a.claude_run_id = p_run_id and a.claude_item = p_item;
  if v_id is not null then
    return v_id;
  end if;

  begin
    select * into v_checked
      from private.validate_action(p_brand, p_platform, p_campaign_id, p_kind, p_title, p_rationale, p_params,
                                   p_impact, p_effort, p_cost_cents);
  exception
    when sqlstate 'PT404' or sqlstate 'PT422' then
      return null;
  end;
  if v_run.brand_id is not null and v_checked.brand_id <> v_run.brand_id then
    return null;
  end if;

  insert into mkt.traffic_actions (brand_id, platform, ad_account_id, campaign_id, kind, title, rationale, params,
                                   impact, effort, cost_cents, proposed_by_kind, claude_run_id, claude_item)
  values (v_checked.brand_id, p_platform, v_checked.ad_account_id, p_campaign_id, p_kind, p_title, p_rationale,
          coalesce(p_params, '{}'::jsonb), p_impact, p_effort, p_cost_cents, 'claude', p_run_id, p_item)
  on conflict (claude_run_id, claude_item) do nothing
  returning id into v_id;
  if v_id is null then
    select a.id into v_id from mkt.traffic_actions a where a.claude_run_id = p_run_id and a.claude_item = p_item;
  end if;
  return v_id;
end $$;

-- ---------- O executor (integracoes.md, seção 14; decisão 0038) ----------

-- O andamento da ação pelo executor: aprovada → em execução; aprovada ou em execução → feita (pela plataforma) ou
-- falhou. O mesmo status de novo não muda nada. O gatilho traffic_actions_transition confere de novo o executor.
create or replace function private.action_progress(p_action_id uuid, p_status mkt.action_status)
returns mkt.traffic_actions
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  v mkt.traffic_actions;
begin
  select a.* into v from mkt.traffic_actions a where a.id = p_action_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'TRF-404';
  end if;
  if p_status is null or p_status not in ('running', 'done', 'failed') then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'status';
  end if;
  if v.status = p_status then
    return v;
  end if;
  if not ((v.status = 'approved' and p_status in ('running', 'done', 'failed'))
          or (v.status = 'running' and p_status in ('done', 'failed'))) then
    raise sqlstate 'PT422' using message = 'TRF-422';
  end if;
  update mkt.traffic_actions a
     set status = p_status,
         done_via = case when p_status = 'done' then 'platform_api' else a.done_via end,
         executed_at = case when p_status = 'done' then now() else a.executed_at end
   where a.id = v.id
  returning * into v;
  return v;
end $$;

-- A campanha relida depois da execução confirmada: o status e o orçamento que a plataforma mostra; na criação, a
-- campanha nasce aqui, do Claude e com a ação que a criou (decisão 0008), na mesma transação que confirma. O id
-- relido de uma campanha de outra conta (talvez de outra marca) é recusado (PT422, campaign), e nada muda. Se a
-- leitura de hora em hora chegou antes e a importou do humano, sem a ação (a execução ainda na fila: o executor mandou
-- e caiu antes de gravar "enviada"; ou a ação falhou e foi aprovada de novo, decisão 0038), a confirmação a passa
-- para o Claude, com a ação: só com o código da ação no fim do nome, sem troca de operador anterior por uma pessoa e
-- importada depois da primeira execução de criar da ação (a campanha que já existia, mesmo renomeada com o código,
-- continua do humano). O gatilho campaigns_managed_by_guard confere tudo de novo, e o histórico ganha a linha "criada
-- pelo Claude".
create or replace function private.read_back_campaign(p_execution mkt.platform_executions, p_campaign jsonb)
returns void
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  v_key text;
  v_source text := case p_execution.platform when 'meta' then 'meta_ads' when 'tiktok' then 'tiktok_ads'
                                             else 'google_ads' end;
begin
  if jsonb_typeof(p_campaign) is distinct from 'object' then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'campaign';
  end if;
  for v_key in select jsonb_object_keys(p_campaign) loop
    if v_key not in ('external_id', 'name', 'status', 'daily_budget_cents', 'source_created_at') then
      raise sqlstate 'PT422' using message = 'TRF-422', detail = 'campaign';
    end if;
  end loop;

  if p_execution.operation = 'create_campaign' then
    if p_campaign ->> 'external_id' is null then
      raise sqlstate 'PT422' using message = 'TRF-422', detail = 'campaign';
    end if;
    insert into mkt.campaigns as c (ad_account_id, brand_id, platform, source, external_id, name, status,
                                    daily_budget_cents, managed_by, created_by_action_id, source_created_at,
                                    last_seen_at)
    values (p_execution.ad_account_id, p_execution.brand_id, p_execution.platform, v_source,
            p_campaign ->> 'external_id',
            coalesce(p_campaign ->> 'name', p_execution.request ->> 'name', p_execution.request ->> 'campaign_name'),
            coalesce(p_campaign ->> 'status', 'paused'), (p_campaign ->> 'daily_budget_cents')::bigint, 'claude',
            p_execution.traffic_action_id, (p_campaign ->> 'source_created_at')::timestamptz, now())
    on conflict (source, external_id) do update
       set status = excluded.status, daily_budget_cents = excluded.daily_budget_cents,
           last_seen_at = excluded.last_seen_at
     where c.ad_account_id = excluded.ad_account_id;
    if not found then
      raise sqlstate 'PT422' using message = 'TRF-422', detail = 'campaign';
    end if;
    update mkt.campaigns c
       set managed_by = 'claude', created_by_action_id = a.id
      from mkt.traffic_actions a
     where c.source = v_source and c.external_id = p_campaign ->> 'external_id'
       and c.ad_account_id = p_execution.ad_account_id and c.managed_by = 'human' and c.created_by_action_id is null
       and a.id = p_execution.traffic_action_id and a.kind = 'create'
       and right(lower(c.name), length(a.code) + 1) = '-' || lower(a.code)
       and c.created_at >= (select min(x.created_at) from mkt.platform_executions x
                             where x.traffic_action_id = a.id and x.operation = 'create_campaign')
       and not exists (select 1 from mkt.campaign_managed_by_history h
                        where h.campaign_id = c.id and h.reason <> 'imported');
  elsif p_execution.campaign_id is not null then
    update mkt.campaigns c
       set status = case when p_campaign ? 'status' then p_campaign ->> 'status' else c.status end,
           daily_budget_cents = case when p_campaign ? 'daily_budget_cents'
                                     then (p_campaign ->> 'daily_budget_cents')::bigint else c.daily_budget_cents end,
           last_seen_at = now()
     where c.id = p_execution.campaign_id;
  end if;
end $$;

-- A próxima execução: primeiro a que ficou enviada sem resposta há mais de 2 minutos (o executor caiu no meio: é relida
-- antes de qualquer nova tentativa; a que ele está esperando, com as novas tentativas de 1 a 16 s, não volta); depois a
-- da fila, as do "Parar tudo" na frente, uma por campanha de cada vez (a campanha com execução enviada espera). Cada uma
-- passa por mkt.execution_allowed: a que não pode fica bloqueada com o motivo, e a busca segue. Sem nenhuma, nada.
create or replace function ingest.next_execution()
returns setof mkt.platform_executions
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v mkt.platform_executions;
  v_check record;
begin
  if session_user::text <> 'mkt_executor' then
    raise sqlstate 'PT403' using message = 'TRF-403';
  end if;

  select e.* into v from mkt.platform_executions e
   where e.status = 'sent' and e.sent_at < now() - interval '2 minutes'
   order by e.sent_at, e.id
   limit 1
     for update skip locked;
  if found then
    return next v;
    return;
  end if;

  loop
    select e.* into v
      from mkt.platform_executions e
     where e.status = 'queued'
       and (e.campaign_id is null
            or not exists (select 1 from mkt.platform_executions o
                            where o.campaign_id = e.campaign_id and o.status = 'sent'))
     order by (e.traffic_stop_campaign_id is not null and e.operation = 'pause') desc, e.queued_at, e.id
     limit 1
       for update of e skip locked;
    if not found then
      return;
    end if;
    select * into v_check from mkt.execution_allowed(v.id);
    if v_check.is_allowed then
      return next v;
      return;
    end if;
    update mkt.platform_executions e set status = 'blocked', blocked_reason = v_check.blocked_reason where e.id = v.id;
  end loop;
end $$;

-- O andamento de uma execução: da fila → enviada, confirmada (a releitura antes de mandar já mostra o pedido feito) ou
-- bloqueada; enviada → enviada de novo (nova tentativa, até 5), confirmada ou falhou. A ação acompanha: enviada → em
-- execução; confirmada → feita pela plataforma; falhou → falhou (volta para a fila com o código). Confirmada, a
-- campanha fica com o que foi relido; a criação só confirma com a campanha relida (o id dela na plataforma, numa
-- campanha da conta da execução). A mensagem com cara de dado pessoal não é gravada.
create or replace function ingest.update_execution(
  p_execution_id uuid, p_status mkt.execution_status, p_http_status integer default null,
  p_error_code text default null, p_error_message text default null, p_response jsonb default null,
  p_blocked_reason mkt.execution_block_reason default null, p_campaign jsonb default null)
returns mkt.platform_executions
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v mkt.platform_executions;
  v_message text;
begin
  if session_user::text <> 'mkt_executor' then
    raise sqlstate 'PT403' using message = 'TRF-403';
  end if;
  select e.* into v from mkt.platform_executions e where e.id = p_execution_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'TRF-404';
  end if;
  if p_status is null
     or not ((v.status = 'queued' and p_status in ('sent', 'confirmed', 'blocked'))
             or (v.status = 'sent' and p_status in ('sent', 'confirmed', 'failed'))) then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'status';
  end if;
  if (p_status = 'blocked') <> (p_blocked_reason is not null) then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'blocked_reason';
  end if;
  if p_status = 'sent' and v.attempts >= 5 then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'attempts';
  end if;
  if p_status = 'failed' and p_error_code is null then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'error_code';
  end if;
  if (p_campaign is not null and p_status <> 'confirmed')
     or (p_campaign is null and p_status = 'confirmed' and v.operation = 'create_campaign') then
    raise sqlstate 'PT422' using message = 'TRF-422', detail = 'campaign';
  end if;
  if p_error_message is not null and strpos(p_error_message, '@') = 0 and not mkt.has_personal_data(p_error_message) then
    v_message := left(btrim(p_error_message), 300);
  end if;

  update mkt.platform_executions e
     set status = p_status,
         attempts = case when p_status = 'sent' then e.attempts + 1 else e.attempts end,
         sent_at = case when p_status = 'sent' then now() else e.sent_at end,
         confirmed_at = case when p_status = 'confirmed' then now() else e.confirmed_at end,
         failed_at = case when p_status = 'failed' then now() else e.failed_at end,
         blocked_reason = case when p_status = 'blocked' then p_blocked_reason end,
         http_status = coalesce(p_http_status, e.http_status),
         error_code = coalesce(p_error_code, e.error_code),
         error_message = coalesce(v_message, e.error_message),
         response = coalesce(p_response, e.response)
   where e.id = v.id
  returning * into v;

  if v.traffic_action_id is not null and p_status in ('sent', 'confirmed', 'failed') then
    perform private.action_progress(v.traffic_action_id,
                                    case p_status when 'sent' then 'running' when 'confirmed' then 'done'
                                                  else 'failed' end::mkt.action_status);
  end if;
  if p_status = 'confirmed' and p_campaign is not null then
    perform private.read_back_campaign(v, p_campaign);
  end if;
  return v;
end $$;

-- O andamento da ação, direto (a mesma regra de update_execution): só o executor.
create or replace function ingest.set_action_progress(p_action_id uuid, p_status mkt.action_status)
returns mkt.traffic_actions
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if session_user::text <> 'mkt_executor' then
    raise sqlstate 'PT403' using message = 'TRF-403';
  end if;
  return private.action_progress(p_action_id, p_status);
end $$;

-- ---------- Scripts de configuração (setup.*, papel mkt_setup; plano.md, "Seed") ----------

-- Conta de anúncio com a marca, coisa que só o dono sabe. Rodar de novo atualiza o nome e religa a conta; a conta de
-- outra marca não muda de marca (SET-422).
create or replace function setup.register_ad_account(p_brand mkt.brand_code, p_platform mkt.platform,
                                                     p_external_id text, p_name text)
returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_brand_id uuid;
  v_id uuid;
begin
  select b.id into v_brand_id from mkt.brands b where b.code = p_brand;
  if v_brand_id is null then
    raise sqlstate 'PT404' using message = 'SET-404', detail = 'brand';
  end if;
  if p_platform is null then
    raise sqlstate 'PT422' using message = 'SET-422', detail = 'platform';
  end if;
  if p_external_id is null or p_external_id !~ '^[A-Za-z0-9_.:-]{1,64}$' then
    raise sqlstate 'PT422' using message = 'SET-422', detail = 'external_id';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 200 or mkt.has_personal_data(p_name) then
    raise sqlstate 'PT422' using message = 'SET-422', detail = 'name';
  end if;
  insert into mkt.ad_accounts as a (brand_id, platform, source, external_id, name)
  values (v_brand_id, p_platform,
          case p_platform when 'meta' then 'meta_ads' when 'tiktok' then 'tiktok_ads' else 'google_ads' end,
          p_external_id, btrim(p_name))
  on conflict (source, external_id) do update set name = excluded.name, is_active = true
   where a.brand_id = excluded.brand_id
  returning a.id into v_id;
  if v_id is null then
    raise sqlstate 'PT422' using message = 'SET-422', detail = 'brand';
  end if;
  return v_id;
end $$;

-- Perfil do Instagram com a marca e o @.
create or replace function setup.register_ig_account(p_brand mkt.brand_code, p_external_id text, p_username text)
returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_brand_id uuid;
  v_id uuid;
begin
  select b.id into v_brand_id from mkt.brands b where b.code = p_brand;
  if v_brand_id is null then
    raise sqlstate 'PT404' using message = 'SET-404', detail = 'brand';
  end if;
  if p_external_id is null or p_external_id !~ '^[0-9]{1,30}$' then
    raise sqlstate 'PT422' using message = 'SET-422', detail = 'external_id';
  end if;
  if p_username is null or ltrim(p_username, '@') !~ '^[A-Za-z0-9._]{1,30}$' then
    raise sqlstate 'PT422' using message = 'SET-422', detail = 'username';
  end if;
  insert into mkt.ig_accounts as g (brand_id, external_id, username)
  values (v_brand_id, p_external_id, ltrim(p_username, '@'))
  on conflict (source, external_id) do update set username = excluded.username, is_active = true
   where g.brand_id = excluded.brand_id
  returning g.id into v_id;
  if v_id is null then
    raise sqlstate 'PT422' using message = 'SET-422', detail = 'brand';
  end if;
  return v_id;
end $$;

-- Propriedade do GA4 ou do Search Console com a marca e o domínio do site (sem www).
create or replace function setup.register_web_property(p_brand mkt.brand_code, p_kind mkt.web_property_kind,
                                                       p_external_id text, p_host text)
returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_brand_id uuid;
  v_host text := mkt.url_host(p_host);
  v_id uuid;
begin
  select b.id into v_brand_id from mkt.brands b where b.code = p_brand;
  if v_brand_id is null then
    raise sqlstate 'PT404' using message = 'SET-404', detail = 'brand';
  end if;
  if p_kind is null then
    raise sqlstate 'PT422' using message = 'SET-422', detail = 'kind';
  end if;
  if p_external_id is null or p_external_id !~ '^[A-Za-z0-9_.:/-]{1,200}$' then
    raise sqlstate 'PT422' using message = 'SET-422', detail = 'external_id';
  end if;
  if v_host is null or v_host !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' then
    raise sqlstate 'PT422' using message = 'SET-422', detail = 'host';
  end if;
  insert into mkt.web_properties as w (brand_id, kind, source, external_id, host)
  values (v_brand_id, p_kind, case p_kind when 'ga4_property' then 'ga4' else 'search_console' end, p_external_id,
          v_host)
  on conflict (source, external_id) do update set host = excluded.host, is_active = true
   where w.brand_id = excluded.brand_id
  returning w.id into v_id;
  if v_id is null then
    raise sqlstate 'PT422' using message = 'SET-422', detail = 'brand';
  end if;
  return v_id;
end $$;

-- O funil antigo dos leads do site (decisão 0041, item 1): marcado uma vez como funil de leads, pelo id do funil no
-- CRM, para o histórico encerrado entrar; a passada completa seguinte grava os negócios dele. Só a conexão do script
-- (o session_user, que a sessão não troca: o dono do banco recebe SET-403). O funil precisa já ter sido lido pela
-- réplica: o funil que ainda não veio é recusado (SET-404; rode depois da primeira passada completa), em vez de nascer
-- aqui uma linha sem o nome. O funil padrão também é recusado (SET-422): ele já é de leads pela regra, e a marca não
-- passaria da troca de funil padrão no CRM. Rodar de novo não muda nada.
create or replace function setup.mark_lead_funnel(p_external_id text)
returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v mkt.crm_funnels;
begin
  if session_user::text <> 'mkt_setup' then
    raise sqlstate 'PT403' using message = 'SET-403';
  end if;
  if p_external_id is null or p_external_id !~ '^[A-Za-z0-9_.:-]{1,64}$' then
    raise sqlstate 'PT422' using message = 'SET-422', detail = 'external_id';
  end if;
  select f.* into v
    from mkt.crm_funnels f
   where f.source = 'csp360' and f.external_id = p_external_id
     for update;
  if not found then
    raise sqlstate 'PT404' using message = 'SET-404', detail = 'funnel';
  end if;
  if v.is_default then
    raise sqlstate 'PT422' using message = 'SET-422', detail = 'default_funnel';
  end if;
  update mkt.crm_funnels f set is_lead_funnel = true where f.id = v.id and not f.is_lead_funnel;
  return v.id;
end $$;

-- Credencial (decisão 0017): a de leitura guarda o segredo no Vault (o script manda como parâmetro ligado, nunca no
-- texto do SQL) e a linha aponta para ele; a de escrita, que fica só nas variáveis do executor, ganha só a linha de
-- estado, sem segredo (mandar segredo de escrita é recusado). Registrar de novo troca o segredo e a validade e volta a
-- valer; a mudança de estado vai para a auditoria. O segredo nunca aparece em mensagem de erro.
create or replace function setup.register_credential(p_connector_code mkt.connector_code,
                                                     p_purpose mkt.credential_purpose, p_account_ref text,
                                                     p_secret text, p_expires_at timestamptz)
returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_connector_id uuid;
  v_old private.connector_credentials;
  v_secret_id uuid;
  v_id uuid;
begin
  select k.id into v_connector_id from mkt.connectors k where k.code = p_connector_code;
  if v_connector_id is null then
    raise sqlstate 'PT404' using message = 'CON-404', detail = 'connector';
  end if;
  if p_purpose is null then
    raise sqlstate 'PT422' using message = 'CON-422', detail = 'purpose';
  end if;
  if p_account_ref is not null and p_account_ref !~ '^[A-Za-z0-9_.:/-]{1,120}$' then
    raise sqlstate 'PT422' using message = 'CON-422', detail = 'account_ref';
  end if;
  if (p_purpose = 'write') <> (p_secret is null) or (p_purpose = 'read' and length(p_secret) = 0) then
    raise sqlstate 'PT422' using message = 'CON-422', detail = 'secret';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise sqlstate 'PT422' using message = 'CON-422', detail = 'expires_at';
  end if;

  select c.* into v_old
    from private.connector_credentials c
   where c.connector_id = v_connector_id and c.purpose = p_purpose and c.account_ref is not distinct from p_account_ref
     for update;
  if p_purpose = 'read' then
    if v_old.id is not null then
      perform vault.update_secret(v_old.vault_secret_id, p_secret);
      v_secret_id := v_old.vault_secret_id;
    else
      v_secret_id := vault.create_secret(p_secret, null,
                                         format('CSP-MKT: credencial de leitura do conector %s', p_connector_code));
    end if;
  end if;

  if v_old.id is null then
    insert into private.connector_credentials (connector_id, purpose, account_ref, vault_secret_id, status, expires_at,
                                               last_rotated_at, last_checked_at)
    values (v_connector_id, p_purpose, p_account_ref, v_secret_id, 'valid', p_expires_at,
            case when p_purpose = 'read' then now() end, now())
    returning id into v_id;
  else
    update private.connector_credentials c
       set status = 'valid', expires_at = p_expires_at,
           last_rotated_at = case when p_purpose = 'read' then now() else c.last_rotated_at end, last_checked_at = now()
     where c.id = v_old.id
    returning c.id into v_id;
    if v_old.status <> 'valid' then
      insert into mkt.audit_log (actor_kind, event, target_table, target_id, changes)
      values ('system', 'credential_status_changed', 'connector_credentials', v_id,
              jsonb_build_object('connector', p_connector_code, 'purpose', p_purpose,
                                 'status', jsonb_build_object('before', v_old.status, 'after', 'valid')));
    end if;
  end if;
  return v_id;
end $$;

-- O convite do primeiro dono (o job manual do CI, uma vez): sem quem convidou, papel owner, validade de 7 dias, e só
-- enquanto não há dono ativo. O mesmo convite aberto e válido volta o mesmo; o vencido é revogado antes. O perfil nasce
-- pelo gatilho de novo usuário quando a pessoa aceita o link do Supabase Auth. A auditoria leva só o id e o papel.
create or replace function setup.create_first_owner_invitation(p_email text, p_display_name text)
returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_email text := lower(btrim(p_email));
  v_name text := btrim(p_display_name);
  v_open mkt.invitations;
  v mkt.invitations;
begin
  perform pg_advisory_xact_lock(hashtext('mkt.manage_users'));
  if exists (select 1 from mkt.profiles p where p.role = 'owner' and p.is_active) then
    raise sqlstate 'PT422' using message = 'USR-422', detail = 'owner_exists';
  end if;
  if v_email is null or length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise sqlstate 'PT422' using message = 'USR-422', detail = 'email';
  end if;
  if v_name is null or length(v_name) not between 2 and 80 then
    raise sqlstate 'PT422' using message = 'USR-422', detail = 'display_name';
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
      if v_open.role = 'owner' and v_open.invited_by is null then
        return v_open.id;
      end if;
      raise sqlstate 'PT422' using message = 'USR-422', detail = 'open_invitation';
    end if;
    update mkt.invitations i set revoked_at = now() where i.id = v_open.id;
    insert into mkt.audit_log (actor_kind, event, target_table, target_id, changes)
    values ('system', 'invite_revoked', 'invitations', v_open.id, jsonb_build_object('invitation_id', v_open.id));
  end if;

  insert into mkt.invitations (email_normalized, display_name, role, invited_by, expires_at)
  values (v_email, v_name, 'owner', null, now() + interval '7 days')
  returning * into v;
  insert into mkt.audit_log (actor_kind, event, target_table, target_id, changes)
  values ('system', 'first_owner_created', 'invitations', v.id,
          jsonb_build_object('invitation_id', v.id, 'role', v.role));
  return v.id;
end $$;

-- ---------- Quem executa ----------
-- As fórmulas de mkt ficam com o padrão do esquema (a tela, o worker e o executor), escrito aqui; a conferência da
-- execução lê o estado das credenciais e os perfis, e só as funções do dono a chamam. As de ingest, cada uma só ao seu
-- serviço; as de setup, só aos scripts; as de private, ninguém, menos o segredo de leitura, que é só do worker. A
-- conta do mês entra na leitura do worker (mkt.claude_context, migração 12, lê).

grant execute on function mkt.url_host(text), mkt.host_matches(text, text[]), mkt.ai_source_of(text, text),
  mkt.utm_source_family(text), mkt.is_known_origin_text(text), mkt.ratio(numeric, numeric),
  mkt.pace(bigint, bigint, integer, integer), mkt.limit_alert(bigint, bigint), mkt.source_covered(mkt.connector_code),
  mkt.ads_covered(uuid, mkt.platform), mkt.action_extra_spend_cents(uuid), mkt.action_exceeds_limit(uuid),
  mkt.execution_extra_spend_cents(uuid)
  to authenticated, mkt_worker, mkt_executor;
revoke all on function mkt.execution_allowed(uuid) from public, anon, authenticated, mkt_worker, mkt_executor;
grant select on mkt.v_account_month to mkt_worker;

revoke all on function private.read_credential(uuid), private.rotate_credential(uuid, text, timestamp with time zone)
  from public, anon, authenticated, mkt_executor;
grant execute on function private.read_credential(uuid), private.rotate_credential(uuid, text, timestamp with time zone)
  to mkt_worker;
revoke all on function private.ingest_row_problem(jsonb, text, text[], text[], text[]),
  private.refusal_code(text, text), private.is_ignored_code(text), private.clean_crm_text(text, boolean),
  private.rep_for_login(uuid, text), private.ingest_batch(uuid, jsonb, text[], text),
  private.ingest_brand(jsonb, text, text, uuid), private.ingest_crm_funnel(jsonb, text, text, uuid),
  private.ingest_sales_rep(jsonb, text, text, uuid), private.ingest_sales_rep_app_login(jsonb, text, text, uuid),
  private.ingest_crm_customer(jsonb, text, text, uuid), private.ingest_crm_customer_brand(jsonb, text, text, uuid),
  private.ingest_crm_customer_rep(jsonb, text, text, uuid), private.ingest_crm_lead(jsonb, text, text, uuid),
  private.ingest_crm_order(jsonb, text, text, uuid), private.ingest_crm_upstream_run(jsonb, text, text, uuid),
  private.ingest_ad_account(jsonb, text, text, uuid), private.ingest_campaign(jsonb, text, text, uuid),
  private.ingest_ad_campaign_daily(jsonb, text, text, uuid), private.ingest_ad_activity(jsonb, text, text, uuid),
  private.ingest_ig_account(jsonb, text, text, uuid), private.ingest_ig_account_daily(jsonb, text, text, uuid),
  private.ingest_ig_media(jsonb, text, text, uuid), private.ingest_ig_media_daily(jsonb, text, text, uuid),
  private.ingest_seo_daily(jsonb, text, text, uuid), private.ingest_seo_query_daily(jsonb, text, text, uuid),
  private.ingest_ga4_traffic_daily(jsonb, text, text, uuid), private.ingest_site_check(jsonb, text, text, uuid),
  private.action_progress(uuid, mkt.action_status), private.read_back_campaign(mkt.platform_executions, jsonb)
  from public, anon, authenticated;

revoke all on function ingest.upsert_brands(uuid, jsonb), ingest.upsert_crm_funnels(uuid, jsonb),
  ingest.upsert_sales_reps(uuid, jsonb), ingest.upsert_sales_rep_app_logins(uuid, jsonb),
  ingest.upsert_crm_customers(uuid, jsonb), ingest.upsert_crm_customer_brands(uuid, jsonb),
  ingest.upsert_crm_customer_reps(uuid, jsonb), ingest.upsert_crm_leads(uuid, jsonb),
  ingest.upsert_crm_orders(uuid, jsonb), ingest.upsert_crm_upstream_runs(uuid, jsonb),
  ingest.upsert_ad_accounts(uuid, jsonb), ingest.upsert_campaigns(uuid, jsonb),
  ingest.upsert_ad_campaign_daily(uuid, jsonb), ingest.upsert_ad_activity_log(uuid, jsonb),
  ingest.upsert_ig_accounts(uuid, jsonb), ingest.upsert_ig_account_daily(uuid, jsonb),
  ingest.upsert_ig_media(uuid, jsonb), ingest.upsert_ig_media_daily(uuid, jsonb), ingest.upsert_seo_daily(uuid, jsonb),
  ingest.upsert_seo_query_daily(uuid, jsonb), ingest.upsert_ga4_traffic_daily(uuid, jsonb),
  ingest.upsert_site_checks(jsonb), ingest.replace_day(uuid, text, text, date, jsonb),
  ingest.delete_missing(text, uuid),
  ingest.start_run(mkt.connector_code, mkt.sync_job, mkt.sync_trigger, mkt.brand_code, timestamp with time zone,
                   timestamp with time zone),
  ingest.take_requested_run(mkt.connector_code),
  ingest.finish_run(uuid, mkt.sync_status, text, text, timestamp with time zone),
  ingest.set_credential_status(uuid, mkt.credential_status),
  ingest.record_claude_run(uuid, mkt.brand_code, mkt.run_status, text, text, text, jsonb, timestamp with time zone,
                           jsonb, integer, integer, integer, text, timestamp with time zone),
  ingest.add_claude_proposal(uuid, integer, mkt.brand_code, mkt.platform, uuid, mkt.action_kind, text, text, jsonb,
                             mkt.level, mkt.level, bigint),
  ingest.next_execution(),
  ingest.update_execution(uuid, mkt.execution_status, integer, text, text, jsonb, mkt.execution_block_reason, jsonb),
  ingest.set_action_progress(uuid, mkt.action_status)
  from public, anon, authenticated;

grant execute on function ingest.upsert_brands(uuid, jsonb), ingest.upsert_crm_funnels(uuid, jsonb),
  ingest.upsert_sales_reps(uuid, jsonb), ingest.upsert_sales_rep_app_logins(uuid, jsonb),
  ingest.upsert_crm_customers(uuid, jsonb), ingest.upsert_crm_customer_brands(uuid, jsonb),
  ingest.upsert_crm_customer_reps(uuid, jsonb), ingest.upsert_crm_leads(uuid, jsonb),
  ingest.upsert_crm_orders(uuid, jsonb), ingest.upsert_crm_upstream_runs(uuid, jsonb),
  ingest.upsert_ad_accounts(uuid, jsonb), ingest.upsert_campaigns(uuid, jsonb),
  ingest.upsert_ad_campaign_daily(uuid, jsonb), ingest.upsert_ad_activity_log(uuid, jsonb),
  ingest.upsert_ig_accounts(uuid, jsonb), ingest.upsert_ig_account_daily(uuid, jsonb),
  ingest.upsert_ig_media(uuid, jsonb), ingest.upsert_ig_media_daily(uuid, jsonb), ingest.upsert_seo_daily(uuid, jsonb),
  ingest.upsert_seo_query_daily(uuid, jsonb), ingest.upsert_ga4_traffic_daily(uuid, jsonb),
  ingest.upsert_site_checks(jsonb), ingest.replace_day(uuid, text, text, date, jsonb),
  ingest.delete_missing(text, uuid),
  ingest.start_run(mkt.connector_code, mkt.sync_job, mkt.sync_trigger, mkt.brand_code, timestamp with time zone,
                   timestamp with time zone),
  ingest.take_requested_run(mkt.connector_code),
  ingest.finish_run(uuid, mkt.sync_status, text, text, timestamp with time zone),
  ingest.set_credential_status(uuid, mkt.credential_status),
  ingest.record_claude_run(uuid, mkt.brand_code, mkt.run_status, text, text, text, jsonb, timestamp with time zone,
                           jsonb, integer, integer, integer, text, timestamp with time zone),
  ingest.add_claude_proposal(uuid, integer, mkt.brand_code, mkt.platform, uuid, mkt.action_kind, text, text, jsonb,
                             mkt.level, mkt.level, bigint)
  to mkt_worker;
grant execute on function ingest.next_execution(),
  ingest.update_execution(uuid, mkt.execution_status, integer, text, text, jsonb, mkt.execution_block_reason, jsonb),
  ingest.set_action_progress(uuid, mkt.action_status)
  to mkt_executor;

revoke all on function setup.register_ad_account(mkt.brand_code, mkt.platform, text, text),
  setup.register_ig_account(mkt.brand_code, text, text),
  setup.register_web_property(mkt.brand_code, mkt.web_property_kind, text, text),
  setup.mark_lead_funnel(text),
  setup.register_credential(mkt.connector_code, mkt.credential_purpose, text, text, timestamp with time zone),
  setup.create_first_owner_invitation(text, text)
  from public, anon, authenticated;
grant execute on function setup.register_ad_account(mkt.brand_code, mkt.platform, text, text),
  setup.register_ig_account(mkt.brand_code, text, text),
  setup.register_web_property(mkt.brand_code, mkt.web_property_kind, text, text),
  setup.mark_lead_funnel(text),
  setup.register_credential(mkt.connector_code, mkt.credential_purpose, text, text, timestamp with time zone),
  setup.create_first_owner_invitation(text, text)
  to mkt_setup;

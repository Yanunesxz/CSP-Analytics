-- Migração 01 · esquemas, papéis e funções base (docs/dados/plano.md, "Ordem das migrações")
--
-- O que faz: tira o EXECUTE que o Postgres dá a PUBLIC em toda função nova; cria os esquemas mkt, api, authz,
--   ingest, notify, private e setup e os papéis de serviço mkt_worker, mkt_executor, mkt_setup e n8n_notifier
--   (sem login e sem bypassrls; a senha entra pelo CI); fecha os esquemas para public e anon; liga pg_cron e o
--   Vault onde existem e desliga GraphQL, pg_net, http e dblink; cria as funções base e as sequências dos códigos.
-- Risco: baixo. Não toca em dado. Muda o privilégio padrão das funções criadas pelo postgres daqui em diante.
-- Como reverter (só no projeto de teste, antes de produção):
--   drop schema mkt, api, authz, ingest, notify, private, setup cascade;
--   drop role mkt_worker, mkt_executor, mkt_setup, n8n_notifier;
--   alter default privileges for role postgres grant execute on functions to public;
-- Conferir (anon sem usage em nenhum; authenticated só em api, authz e mkt):
--   select n.nspname, has_schema_privilege('anon', n.oid, 'usage') as anon,
--          has_schema_privilege('authenticated', n.oid, 'usage') as authenticated
--     from pg_namespace n
--    where n.nspname in ('mkt', 'api', 'authz', 'ingest', 'notify', 'private', 'setup')
--    order by 1;

-- Antes de qualquer função: o Postgres dá EXECUTE a PUBLIC em toda função nova, e "in schema" não desfaz isso.
-- Só o revoke global, sem "in schema", tira.
alter default privileges for role postgres revoke execute on functions from public;

-- Esquemas (decisão 0013). Só api fica na lista de esquemas expostos do PostgREST (configuração do projeto).
create schema if not exists mkt;       -- tabelas, views base e fórmulas
create schema if not exists api;       -- o que a tela lê e chama
create schema if not exists authz;     -- as funções que as políticas chamam
create schema if not exists ingest;    -- gravação do worker e do executor
create schema if not exists notify;    -- a fila de avisos do n8n
create schema if not exists private;   -- gatilhos, filas, validação e credenciais
create schema if not exists setup;     -- cadastro pelos scripts de configuração

-- Papéis de serviço (decisão 0017). Sem login: a senha entra pelo CI, nunca neste arquivo.
do $$
declare
  v_papel text;
begin
  foreach v_papel in array array['mkt_worker', 'mkt_executor', 'mkt_setup', 'n8n_notifier'] loop
    if not exists (select 1 from pg_roles where rolname = v_papel) then
      execute format('create role %I nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls',
                     v_papel);
    end if;
  end loop;
  -- Papel que já existia com atributo que pula a RLS ou cria papel: para aqui, ninguém tira à mão sem ver.
  if exists (select 1 from pg_roles
              where rolname in ('mkt_worker', 'mkt_executor', 'mkt_setup', 'n8n_notifier')
                and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication)) then
    raise exception 'MIG-01: papel de serviço com superuser, bypassrls, createrole, createdb ou replication';
  end if;
end $$;

-- Extensões: pg_cron e o Vault só onde existem (o PGlite não tem as duas; o arquivo de apoio dos testes cria os
-- esboços). Nada de saída de rede pelo banco nem GraphQL (decisões 0013 e 0017).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'supabase_vault') then
    create extension if not exists supabase_vault;
  end if;
end $$;
drop extension if exists pg_graphql;
drop extension if exists pg_net;
drop extension if exists http;
drop extension if exists dblink;

-- Privilégios por esquema (docs/dados/papeis-e-rls.md). Tabela e função nascem nas migrações seguintes: aqui só
-- o esquema e o padrão do que vier.
revoke execute on all functions in schema mkt, api, authz, ingest, notify, private, setup from public;
revoke all on schema mkt, api, authz, ingest, notify, private, setup from public, anon;
alter default privileges for role postgres in schema mkt revoke all on tables from public, anon;

-- authenticated lê pelas views e funções de api; a RLS das tabelas decide as linhas. Nunca grava direto.
grant usage on schema api, mkt, authz to authenticated;
alter default privileges for role postgres in schema mkt grant select on tables to authenticated;
-- As fórmulas de mkt (security invoker) servem à tela, ao worker e ao executor. As de api, uma a uma.
alter default privileges for role postgres in schema mkt
  grant execute on functions to authenticated, mkt_worker, mkt_executor;

-- Cada serviço, só o esquema que usa.
grant usage on schema mkt, ingest, private to mkt_worker, mkt_executor;
grant usage on schema notify to n8n_notifier;
grant usage on schema setup to mkt_setup;

-- updated_at por gatilho, em toda tabela, em milissegundos: o valor que a tela lê (texto no Supabase, Date no
-- PGlite) volta igual na trava otimista.
create or replace function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := date_trunc('milliseconds', now());
  return new;
end $$;

-- Dia de São Paulo de um instante. É immutable (o fuso é fixo no nome), então serve em índice.
create or replace function mkt.sp_day(p timestamptz) returns date
language sql immutable parallel safe set search_path = '' as $$
  select (p at time zone 'America/Sao_Paulo')::date
$$;

-- Chave de casamento da UTM com a campanha (decisão 0009): minúsculas, espaços simples, sem espaço nas pontas.
-- A mesma função normaliza o nome da campanha e a utm_campaign do lead.
create or replace function mkt.utm_key(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select nullif(lower(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'))), '')
$$;

-- Barra dado pessoal em texto livre que vai para o Claude ou para a trilha: e-mail, telefone com DDD (com ou sem
-- máscara, com ou sem o 55), CPF e CNPJ. "\y" é o limite de palavra do Postgres: um id de campanha de 18 dígitos
-- ou um "act_…" não parecem telefone nem documento. Só para texto livre; jsonb usa as funções valid_* de chaves.
create or replace function mkt.has_personal_data(p text) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(p, '') ~ '[[:alnum:]_.+-]+@[[:alnum:]_-]+\.[[:alnum:]_.]+'                 -- e-mail
      or coalesce(p, '') ~ '\(?\y(55)?[0-9]{2}\)?\s?9?[0-9]{4}[-\s]?[0-9]{4}\y'             -- telefone com DDD
      or coalesce(p, '') ~ '\y[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2}\y'                    -- CPF
      or coalesce(p, '') ~ '\y[0-9]{2}\.?[0-9]{3}\.?[0-9]{3}/?[0-9]{4}-?[0-9]{2}\y'          -- CNPJ
$$;

-- Última barreira para a UTM que vem do CRM (a função ingest.* já limpou antes): até 150 letras, sem @ e, fora o
-- nome de campanha, sem dado pessoal.
create or replace function mkt.valid_crm_text(p text, p_is_campaign boolean default false) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select p is null or (length(p) <= 150 and strpos(p, '@') = 0
                       and (p_is_campaign or not mkt.has_personal_data(p)))
$$;

-- O relógio do banco (metricas.md, seção 2.1). Só nos testes existe test.clock (o arquivo de apoio do PGlite
-- cria); em produção a tabela não existe e vale now(). Nenhuma sessão muda o "hoje" das contas.
create or replace function mkt.now() returns timestamptz
language plpgsql stable set search_path = '' as $$
declare
  v timestamptz;
begin
  if to_regclass('test.clock') is not null then
    execute 'select max(now_at) from test.clock' into v;
  end if;
  return coalesce(v, now());
end $$;

create or replace function mkt.today() returns date
language sql stable set search_path = '' as $$
  select (mkt.now() at time zone 'America/Sao_Paulo')::date
$$;

-- Código humano PREFIXO-0001 por sequência no banco (seção 9 do padrão). O lpad nunca corta: o 10.000º é
-- LEAD-10000. Só os gatilhos de código chamam (dono postgres).
create sequence if not exists mkt.lead_code_seq;
create sequence if not exists mkt.sales_rep_code_seq;
create sequence if not exists mkt.traffic_action_code_seq;
revoke all on sequence mkt.lead_code_seq, mkt.sales_rep_code_seq, mkt.traffic_action_code_seq
  from public, anon, authenticated;

create or replace function private.next_code(p_prefix text, p_seq regclass) returns text
language sql volatile set search_path = '' as $$
  select p_prefix || '-' || lpad(s.n::text, greatest(4, length(s.n::text)), '0')
    from (select nextval(p_seq) as n) s
$$;

-- Quem executa: as fórmulas de mkt, a tela, o worker e o executor; as de private, ninguém (só o dono).
revoke all on function private.set_updated_at(), private.next_code(text, regclass) from public, anon, authenticated;
grant execute on function mkt.sp_day(timestamptz), mkt.utm_key(text), mkt.has_personal_data(text),
  mkt.valid_crm_text(text, boolean), mkt.now(), mkt.today()
  to authenticated, mkt_worker, mkt_executor;

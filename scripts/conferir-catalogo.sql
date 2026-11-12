-- Conferência do catálogo do CSP-MKT: as regras que toda migração cumpre nos sete esquemas (RLS-27,
-- docs/dados/papeis-e-rls.md), mais o dono de cada objeto.
--
-- O que faz: só lê. Não grava nada e não é migração (migração entra só pelo CI, decisão 0006). Confere:
--   - os sete esquemas e os quatro papéis de serviço existem;
--   - o postgres é o dono de cada esquema, tabela, view, sequência e função dos sete esquemas. As migrações contam com
--     ele: os "alter default privileges for role postgres" da migração 01 só valem para o que o postgres cria;
--   - toda tabela tem RLS;
--   - anon não lê nada, nem por coluna;
--   - PUBLIC, anon e authenticated não gravam direto, nem por coluna, e não usam sequência;
--   - toda função tem search_path = pg_catalog, pg_temp, e nenhuma é executável por PUBLIC ou anon;
--   - nenhum papel de serviço tem superuser, bypassrls, createrole, createdb ou replication.
-- Saída: uma linha por problema, na coluna "achado". Nenhuma linha = tudo certo.
-- Uso: no SQL Editor do Supabase (como postgres) ou com
--   psql "<url do postgres>" -X -v ON_ERROR_STOP=1 -f scripts/conferir-catalogo.sql.
--   A cada pnpm verify, supabase/tests/apoio/catalogo.ts (violacoes) roda este mesmo arquivo sobre as migrações, no
--   PGlite.
with esq(nome) as (
  select unnest(array['mkt', 'api', 'authz', 'ingest', 'notify', 'private', 'setup'])
), rel as (
  select c.oid, c.relkind, c.relrowsecurity, c.relowner
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in (select nome from esq)
), fun as (
  select p.oid, p.proconfig, p.proacl, p.proowner
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in (select nome from esq)
), api(papel) as (values ('public'), ('anon'), ('authenticated'))
select 'esquema que falta: ' || nome as achado
  from esq where nome not in (select nspname from pg_namespace)
union all
select 'papel de serviço que falta: ' || r
  from unnest(array['mkt_worker', 'mkt_executor', 'mkt_setup', 'n8n_notifier']) r
 where r not in (select rolname from pg_roles)
union all
select 'dono ' || pg_get_userbyid(nspowner) || ' no esquema ' || nspname
  from pg_namespace where nspname in (select nome from esq) and pg_get_userbyid(nspowner) <> 'postgres'
union all
-- O índice segue o dono da tabela: fica de fora para não repetir o mesmo achado.
select 'dono ' || pg_get_userbyid(relowner) || ': ' || oid::regclass::text
  from rel where relkind in ('r', 'p', 'v', 'm', 'S', 'f') and pg_get_userbyid(relowner) <> 'postgres'
union all
select 'dono ' || pg_get_userbyid(proowner) || ': ' || oid::regprocedure::text
  from fun where pg_get_userbyid(proowner) <> 'postgres'
union all
-- O "case" protege a ordem: o Postgres não garante avaliar o "and" da esquerda para a direita.
select 'tabela sem RLS: ' || oid::regclass::text
  from rel where relkind in ('r', 'p') and not relrowsecurity
union all
-- has_any_column_privilege vê também o privilégio dado a uma coluna só (e o da tabela inteira); delete e truncate não
-- existem por coluna.
select 'anon lê: ' || oid::regclass::text
  from rel
 where case when relkind in ('r', 'p', 'v', 'm', 'f') then has_any_column_privilege('anon', oid, 'select') end
union all
select 'grava pela API (' || a.papel || '): ' || r.oid::regclass::text
  from rel r cross join api a
 where case when r.relkind in ('r', 'p', 'v', 'm', 'f')
            then has_any_column_privilege(a.papel, r.oid, 'insert, update')
              or has_table_privilege(a.papel, r.oid, 'delete, truncate') end
union all
select 'sequência aberta (' || a.papel || '): ' || r.oid::regclass::text
  from rel r cross join api a
 where case when r.relkind = 'S' then has_sequence_privilege(a.papel, r.oid, 'usage, select, update') end
union all
-- Toda função, definer ou invoker: com o caminho vazio (ou sem pg_temp no fim), o esquema temporário da sessão é
-- procurado primeiro para tipos e tabelas, e o pg_temp de quem chama mudaria o que a função usa.
select 'função sem search_path=pg_catalog, pg_temp: ' || oid::regprocedure::text
  from fun where not coalesce('search_path=pg_catalog, pg_temp' = any(proconfig), false)
union all
select 'executável por PUBLIC: ' || oid::regprocedure::text
  from fun
 where proacl is null
    or exists (select 1 from aclexplode(proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
union all
select 'executável por anon: ' || oid::regprocedure::text
  from fun where has_function_privilege('anon', oid, 'execute')
union all
select 'papel de serviço com atributo proibido: ' || rolname
  from pg_roles
 where rolname in ('mkt_worker', 'mkt_executor', 'mkt_setup', 'n8n_notifier')
   and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication)
order by 1;

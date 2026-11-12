-- Arquivo de apoio da camada 1 (decisão 0018; docs/dados/papeis-e-rls.md, "Camada 1").
--
-- Cria no PGlite o que o Supabase traz pronto e as migrações supõem: os papéis da API, o esquema auth, esboços
-- de cron e vault (mesmas assinaturas, sem agendar nem cifrar nada) e o relógio dos testes (test.clock).
-- Nunca roda no Supabase. Roda de novo sem erro.
--
-- Tem duas partes: a primeira roda antes das migrações; a segunda, depois da marca "@depois-das-migracoes",
-- dá acesso ao relógio aos papéis de serviço, que só existem depois da migração 01 (tests/apoio/banco.ts).

-- Só no PGlite. O "supabase test db" roda todo .sql desta pasta: num banco de verdade, este arquivo tentaria
-- trocar as funções do pg_cron e do Vault pelos esboços. Numa transação só: se a guarda falhar, nada daqui fica,
-- mesmo no psql sem ON_ERROR_STOP.
begin;
do $$
begin
  if version() not like '%PGlite%' then
    raise exception 'supabase-shim.sql é só para o PGlite (testes e modo demonstração)';
  end if;
end $$;

-- Sessão como a do Supabase: fuso UTC (o PGlite herda o da máquina).
set time zone 'UTC';
-- O PGlite roda em modo de um usuário só, e o session_authorization nasce vazio: sem fixar o postgres aqui,
-- o rollback de um caso não desfaz o "set session authorization" que o caso fez.
set session authorization postgres;

-- Papéis do Supabase. O authenticator é o papel do PostgREST: troca para anon, authenticated ou service_role.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;

-- Como o Supabase: o esquema public fica aberto aos papéis da API (o CSP-MKT não usa public).
grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;

-- auth: o login. Só as colunas que as migrações usam e as que o Supabase sempre preenche.
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_anonymous boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
revoke all on auth.users from public, anon, authenticated;

-- As mesmas definições do Supabase: o PostgREST grava o token em request.jwt.claims a cada chamada.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.email() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant execute on function auth.uid(), auth.role(), auth.email(), auth.jwt() to public;

-- cron: esboço do pg_cron. Guarda o trabalho e não roda nada.
create schema if not exists cron;
revoke all on schema cron from public;

create table if not exists cron.job (
  jobid bigserial primary key,
  schedule text not null,
  command text not null,
  nodename text not null default 'localhost',
  nodeport integer not null default 5432,
  database text not null default current_database(),
  username text not null default current_user,
  active boolean not null default true,
  jobname text,
  constraint jobname_username_uniq unique (jobname, username)
);

create or replace function cron.schedule(schedule text, command text) returns bigint
language sql as $$
  insert into cron.job (schedule, command) values ($1, $2) returning jobid
$$;

-- Com nome: o mesmo nome troca o trabalho, como no pg_cron.
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint
language sql as $$
  insert into cron.job (jobname, schedule, command) values ($1, $2, $3)
  on conflict (jobname, username)
  do update set schedule = excluded.schedule, command = excluded.command, active = true
  returning jobid
$$;

-- Trabalho que não existe é erro, como no pg_cron.
create or replace function cron.unschedule(job_id bigint) returns boolean
language plpgsql as $$
begin
  delete from cron.job where jobid = job_id;
  if not found then
    raise exception 'could not find valid entry for job %', job_id;
  end if;
  return true;
end $$;

create or replace function cron.unschedule(job_name text) returns boolean
language plpgsql as $$
begin
  delete from cron.job where jobname = job_name and username = current_user;
  if not found then
    raise exception 'could not find valid entry for job ''%''', job_name;
  end if;
  return true;
end $$;

revoke all on all tables in schema cron from public, anon, authenticated, service_role;
revoke all on all sequences in schema cron from public, anon, authenticated, service_role;
revoke execute on all functions in schema cron from public;

-- vault: esboço do Supabase Vault, com as mesmas assinaturas. Não cifra: guarda o segredo em base64, para quem
-- ler vault.secrets em vez de vault.decrypted_secrets não achar o texto (como no Vault de verdade).
create schema if not exists vault;
revoke all on schema vault from public;

create table if not exists vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text,
  description text not null default '',
  secret text not null,
  key_id uuid,
  nonce bytea,
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp
);
create unique index if not exists secrets_name_idx on vault.secrets (name) where name is not null;

create or replace function vault.create_secret(new_secret text, new_name text default null,
                                               new_description text default '', new_key_id uuid default null)
returns uuid
language sql as $$
  insert into vault.secrets (secret, name, description, key_id)
  values (encode(convert_to($1, 'utf8'), 'base64'), $2, coalesce($3, ''), $4)
  returning id
$$;

create or replace function vault.update_secret(secret_id uuid, new_secret text default null,
                                               new_name text default null, new_description text default null,
                                               new_key_id uuid default null)
returns void
language sql as $$
  update vault.secrets
     set secret = coalesce(encode(convert_to($2, 'utf8'), 'base64'), secret),
         name = coalesce($3, name),
         description = coalesce($4, description),
         key_id = coalesce($5, key_id),
         updated_at = current_timestamp
   where id = $1
$$;

create or replace view vault.decrypted_secrets as
select s.id, s.name, s.description, s.secret,
       convert_from(decode(s.secret, 'base64'), 'utf8') as decrypted_secret,
       s.key_id, s.nonce, s.created_at, s.updated_at
  from vault.secrets s;

revoke all on all tables in schema vault from public, anon, authenticated, service_role;
revoke execute on all functions in schema vault from public;

-- test: o relógio dos testes. mkt.now() lê max(now_at) quando a tabela existe; vazia, vale now().
-- mkt.now() roda com os direitos de quem chama: sem usage no esquema, o to_regclass dá erro em vez de nulo.
create schema if not exists test;
revoke all on schema test from public;

create table if not exists test.clock (
  now_at timestamptz not null
);
revoke all on test.clock from public;
grant usage on schema test to authenticated;
grant select on test.clock to authenticated;
commit;

-- @depois-das-migracoes
-- Os papéis de serviço nascem na migração 01; só então ganham o relógio.
grant usage on schema test to mkt_worker, mkt_executor;
grant select on test.clock to mkt_worker, mkt_executor;

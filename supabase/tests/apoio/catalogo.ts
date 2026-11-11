/**
 * Conferências do catálogo para os testes da camada 1.
 *
 *   violacoes(consulta)  o que fere as regras de toda migração, nos sete esquemas (lista vazia = tudo certo):
 *                        tabela sem RLS; anon lendo; PUBLIC, anon ou authenticated gravando direto (RLS-04,
 *                        RLS-29); sequência aberta a eles; função security definer sem search_path vazio;
 *                        função executável por PUBLIC ou anon; papel de serviço com bypassrls (RLS-27)
 *   retrato(consulta)    o catálogo em forma comparável (esquemas, papéis, privilégios, funções, tabelas,
 *                        colunas, políticas, gatilhos, restrições e quantas linhas cada tabela tem)
 *   domainsDoMkt(consulta)  cada lista fechada (domain de mkt) com os códigos do check; codigosDoDomain(…) só
 *                        os códigos de uma
 *
 * `consulta` é `consultaDe(db)` fora de um caso, ou `s.linhas` dentro de um caso.
 */
import type { PGlite } from '@electric-sql/pglite';

/** Os sete esquemas do CSP-MKT (decisão 0013). */
export const ESQUEMAS = ['mkt', 'api', 'authz', 'ingest', 'notify', 'private', 'setup'] as const;

/** Os papéis que o arquivo de apoio e a migração 01 criam. */
export const PAPEIS = [
  'anon',
  'authenticated',
  'service_role',
  'authenticator',
  'mkt_worker',
  'mkt_executor',
  'mkt_setup',
  'n8n_notifier',
] as const;

// O retrato vê também os esquemas que o arquivo de apoio imita: as migrações põem gatilho em auth.users e
// trabalhos no cron.
const ESQUEMAS_DO_RETRATO = [...ESQUEMAS, 'auth', 'cron', 'vault', 'test', 'public'];

export type Consulta = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

export function consultaDe(db: PGlite): Consulta {
  return async <T>(sql: string, params?: unknown[]) => (await db.query<T>(sql, params)).rows;
}

/** ACL em texto estável: "papel=PRIVILÉGIO" em ordem; "padrão" quando nula (vale o padrão do Postgres). */
function acl(coluna: string): string {
  return `case when ${coluna} is null then 'padrão' else coalesce((
    select string_agg(e, ',' order by e)
      from (select (case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end)
                   || '=' || a.privilege_type || (case when a.is_grantable then '*' else '' end) as e
              from aclexplode(${coluna}) a) x), '') end`;
}

// O "case" protege a ordem: o Postgres não garante avaliar o "and" da esquerda para a direita.
const REGRAS = `
  with rel as (
    select c.oid, c.relkind, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = any($1)
  ), fun as (
    select p.oid, p.prosecdef, p.proconfig, p.proacl
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = any($1)
  ), api(papel) as (values ('public'), ('anon'), ('authenticated'))
  select 'tabela sem RLS: ' || oid::regclass::text as v
    from rel where relkind in ('r', 'p') and not relrowsecurity
  union all
  select 'anon lê: ' || oid::regclass::text
    from rel
   where case when relkind in ('r', 'p', 'v', 'm', 'f') then has_table_privilege('anon', oid, 'select') end
  union all
  select 'grava pela API (' || a.papel || '): ' || r.oid::regclass::text
    from rel r cross join api a
   where case when r.relkind in ('r', 'p', 'v', 'm', 'f')
              then has_table_privilege(a.papel, r.oid, 'insert, update, delete, truncate') end
  union all
  select 'sequência aberta (' || a.papel || '): ' || r.oid::regclass::text
    from rel r cross join api a
   where case when r.relkind = 'S' then has_sequence_privilege(a.papel, r.oid, 'usage, select, update') end
  union all
  select 'security definer sem search_path vazio: ' || oid::regprocedure::text
    from fun where prosecdef and not coalesce('search_path=""' = any(proconfig), false)
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
  order by 1`;

export async function violacoes(consulta: Consulta): Promise<string[]> {
  return (await consulta<{ v: string }>(REGRAS, [ESQUEMAS])).map((l) => l.v);
}

const PARTES_DO_RETRATO: Record<string, string> = {
  esquemas: `select n.nspname as nome, pg_get_userbyid(n.nspowner) as dono, ${acl('n.nspacl')} as acl
               from pg_namespace n where n.nspname = any($1) order by 1`,
  padroes: `select pg_get_userbyid(d.defaclrole) as dono, coalesce(n.nspname, '') as esquema, d.defaclobjtype as tipo,
                   ${acl('d.defaclacl')} as acl
              from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace order by 1, 2, 3`,
  funcoes: `select p.oid::regprocedure::text as funcao, p.prokind, p.prosecdef, p.provolatile, p.proparallel,
                   coalesce(p.proconfig::text, '') as config, ${acl('p.proacl')} as acl,
                   pg_get_userbyid(p.proowner) as dono, md5(p.prosrc) as corpo
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = any($1) order by 1`,
  relacoes: `select c.oid::regclass::text as relacao, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
                    coalesce(c.reloptions::text, '') as opcoes, ${acl('c.relacl')} as acl,
                    pg_get_userbyid(c.relowner) as dono
               from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = any($1) and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f', 'c') order by 1`,
  colunas: `select a.attrelid::regclass::text as relacao, a.attnum, a.attname,
                   format_type(a.atttypid, a.atttypmod) as tipo, a.attnotnull,
                   coalesce(pg_get_expr(d.adbin, d.adrelid), '') as padrao, ${acl('a.attacl')} as acl
              from pg_attribute a
              join pg_class c on c.oid = a.attrelid
              join pg_namespace n on n.oid = c.relnamespace
              left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
             where n.nspname = any($1) and c.relkind in ('r', 'p', 'v', 'm', 'f', 'c')
               and a.attnum > 0 and not a.attisdropped
             order by 1, 2`,
  indices: `select schemaname, tablename, indexname, indexdef from pg_indexes where schemaname = any($1) order by 1, 2, 3`,
  restricoes: `select coalesce(c.conrelid::regclass::text, '') as tabela, coalesce(c.contypid::regtype::text, '') as tipo,
                      c.conname, pg_get_constraintdef(c.oid) as def
                 from pg_constraint c join pg_namespace n on n.oid = c.connamespace
                where n.nspname = any($1) order by 1, 2, 3`,
  tipos: `select t.oid::regtype::text as tipo, t.typtype, format_type(t.typbasetype, t.typtypmod) as base,
                 t.typnotnull, ${acl('t.typacl')} as acl
            from pg_type t join pg_namespace n on n.oid = t.typnamespace
           where n.nspname = any($1) and t.typtype in ('d', 'e', 'r', 'm') order by 1`,
  politicas: `select schemaname, tablename, policyname, permissive, roles::text as papeis, cmd,
                     coalesce(qual, '') as usando, coalesce(with_check, '') as conferindo
                from pg_policies where schemaname = any($1) order by 1, 2, 3`,
  gatilhos: `select t.tgrelid::regclass::text as tabela, t.tgname, pg_get_triggerdef(t.oid) as def, t.tgenabled
               from pg_trigger t
               join pg_class c on c.oid = t.tgrelid
               join pg_namespace n on n.oid = c.relnamespace
              where not t.tgisinternal and n.nspname = any($1) order by 1, 2`,
};

export interface Domain {
  nome: string;
  /** O tipo de base (`text` em toda lista). */
  base: string;
  /** O nome de cada restrição do domain. */
  restricoes: string[];
  /** Cada restrição como o Postgres a mostra (`CHECK ((VALUE = ANY (ARRAY['a'::text, …])))`). */
  definicoes: string[];
  /** Os códigos da lista, lidos do check `value in (…)`; vazio quando o domain não tem esse check só. */
  codigos: string[];
}

// Com um código só, o Postgres guarda o "in" como igualdade: VALUE = 'claude_only'::text.
const FORMA_DA_LISTA = /^CHECK \(\(VALUE = (ANY \(ARRAY\[.+\]\)|'[^']*'::text)\)\)$/;

/** Os domain de mkt, cada um com os códigos do check (docs/dados/listas.md). */
export async function domainsDoMkt(consulta: Consulta): Promise<Domain[]> {
  const linhas = await consulta<Omit<Domain, 'codigos'>>(
    `select t.typname::text as nome, format_type(t.typbasetype, t.typtypmod) as base,
            coalesce(array_agg(c.conname::text order by c.conname) filter (where c.oid is not null), '{}') as restricoes,
            coalesce(array_agg(pg_get_constraintdef(c.oid) order by c.conname) filter (where c.oid is not null), '{}')
              as definicoes
       from pg_type t
       join pg_namespace n on n.oid = t.typnamespace
       left join pg_constraint c on c.contypid = t.oid
      where n.nspname = 'mkt' and t.typtype = 'd'
      group by t.typname, t.typbasetype, t.typtypmod
      order by 1`,
  );
  return linhas.map((l) => {
    const definicao = l.definicoes.length === 1 ? (l.definicoes[0] ?? '') : '';
    const codigos = FORMA_DA_LISTA.test(definicao)
      ? [...definicao.matchAll(/'([^']*)'::text/g)].map((m) => m[1] ?? '')
      : [];
    return { ...l, codigos };
  });
}

/** Os códigos de um domain de mkt (lista vazia quando ele não existe). */
export async function codigosDoDomain(consulta: Consulta, nome: string): Promise<string[]> {
  return (await domainsDoMkt(consulta)).find((d) => d.nome === nome)?.codigos ?? [];
}

export async function retrato(consulta: Consulta): Promise<Record<string, unknown>> {
  const foto: Record<string, unknown> = {};
  for (const [parte, sql] of Object.entries(PARTES_DO_RETRATO)) {
    foto[parte] = await consulta(sql, sql.includes('$1') ? [ESQUEMAS_DO_RETRATO] : undefined);
  }
  foto.papeis = await consulta(
    `select rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls
       from pg_roles where rolname = any($1) order by 1`,
    [PAPEIS],
  );
  foto.membros = await consulta(
    `select r.rolname as papel, m.rolname as membro, am.admin_option, am.inherit_option, am.set_option
       from pg_auth_members am
       join pg_roles r on r.oid = am.roleid
       join pg_roles m on m.oid = am.member
      where r.rolname = any($1) or m.rolname = any($1) order by 1, 2`,
    [PAPEIS],
  );
  foto.extensoes = await consulta(`select extname, extversion from pg_extension order by 1`);
  // Quantas linhas cada tabela tem: seed repetido aparece aqui.
  const tabelas = await consulta<{ tabela: string; contar: string }>(
    `select c.oid::regclass::text as tabela, format('select count(*)::int as n from %I.%I', n.nspname, c.relname) as contar
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1) and c.relkind in ('r', 'p') order by 1`,
    [ESQUEMAS_DO_RETRATO],
  );
  const linhas: Record<string, number> = {};
  for (const t of tabelas) {
    linhas[t.tabela] = (await consulta<{ n: number }>(t.contar))[0]?.n ?? -1;
  }
  foto.linhas = linhas;
  return foto;
}

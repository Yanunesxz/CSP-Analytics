/**
 * Ajudante dos testes da camada 1: o PGlite com o arquivo de apoio e as migrações (decisão 0018).
 *
 *   const db = await abrirBanco();      // uma vez por arquivo de teste (beforeAll); db.close() no afterAll
 *   await caso(db, anon, async (s) => { ... });               // authenticator → anon
 *   await caso(db, usuario(ID, 'aal2'), async (s) => { ... }); // authenticator → authenticated, token com sub e aal
 *   await caso(db, servico('mkt_worker'), async (s) => { ... }); // set session authorization <papel>
 *   await caso(db, postgres, async (s) => { ... });           // o dono dos objetos, para montar o cenário
 *
 * Todo caso é uma transação desfeita no fim (nunca dê commit dentro dele). Dentro do caso:
 *   s.linhas(sql, params?)        as linhas da consulta
 *   s.valor(sql, params?)         a primeira coluna da primeira linha
 *   s.exec(sql)                   vários comandos, sem parâmetros
 *   s.como(quem)                  troca de identidade sem sair da transação
 *   s.erro(codigo, sql, params?)  espera o erro pelo sqlstate (PT403, PT409, PT422, 42501...; ou um de uma lista), num savepoint:
 *                                 o caso continua depois; devolve o erro para conferir a mensagem (TRF-403).
 *                                 Sem params, aceita vários comandos.
 *
 * Dados inventados de um arquivo inteiro: aplicarFixture(db, 'usuarios') (tests/fixtures/usuarios.sql), no
 * beforeAll, depois do abrirBanco; ficam para todos os casos do arquivo, e cada caso desfaz o que mudar nelas.
 *
 * Para o teste de idempotência: novoBanco() (só a 1ª parte do apoio), aplicarMigracoes(db) e completarApoio(db).
 * O PGlite devolve int8 como number (ou bigint, se não couber), timestamptz como Date e date como Date:
 * para comparar datas, converta para texto no SQL.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const PASTA_MIGRACOES = fileURLToPath(new URL('../../migrations/', import.meta.url));
const PASTA_FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));
const ARQUIVO_DE_APOIO = fileURLToPath(new URL('../supabase-shim.sql', import.meta.url));
const MARCA_DEPOIS = '-- @depois-das-migracoes';

export type Aal = 'aal1' | 'aal2';
export type PapelDeServico = 'mkt_worker' | 'mkt_executor' | 'mkt_setup' | 'n8n_notifier';

export type Quem =
  | { tipo: 'postgres' }
  | { tipo: 'anon' }
  | { tipo: 'usuario'; id: string; aal: Aal }
  | { tipo: 'servico'; papel: PapelDeServico; claims?: Record<string, unknown> };

export const postgres: Quem = { tipo: 'postgres' };
export const anon: Quem = { tipo: 'anon' };

/** Usuário logado pela API: o PostgREST entra como authenticator e troca para authenticated. */
export function usuario(id: string, aal: Aal = 'aal1'): Quem {
  return { tipo: 'usuario', id, aal };
}

/** Conexão própria de um serviço; `claims` imita quem tenta se passar por usuário (RLS-30). */
export function servico(papel: PapelDeServico, claims?: Record<string, unknown>): Quem {
  return { tipo: 'servico', papel, claims };
}

export interface ErroDoBanco {
  code: string;
  message: string;
  detail?: string;
  hint?: string;
  where?: string;
  schema?: string;
  table?: string;
  constraint?: string;
}

export interface Sessao {
  linhas<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  valor<T = unknown>(sql: string, params?: unknown[]): Promise<T>;
  exec(sql: string): Promise<void>;
  como(quem: Quem): Promise<void>;
  erro(codigo: string | readonly string[], sql: string, params?: unknown[]): Promise<ErroDoBanco>;
}

export interface Migracao {
  nome: string;
  versao: string;
  sql: string;
}

/** As migrações de supabase/migrations, na ordem do nome. */
export function lerMigracoes(): Migracao[] {
  return readdirSync(PASTA_MIGRACOES)
    .filter((nome) => nome.endsWith('.sql'))
    .sort()
    .map((nome) => ({
      nome,
      versao: nome.slice(0, 14),
      sql: readFileSync(join(PASTA_MIGRACOES, nome), 'utf8'),
    }));
}

/** O arquivo de apoio em duas partes: antes e depois das migrações. */
export function lerApoio(): { antes: string; depois: string } {
  const texto = readFileSync(ARQUIVO_DE_APOIO, 'utf8');
  const i = texto.indexOf(MARCA_DEPOIS);
  if (i < 0) throw new Error(`supabase-shim.sql sem a marca "${MARCA_DEPOIS}"`);
  return { antes: texto.slice(0, i), depois: texto.slice(i) };
}

/** Converte o erro do PGlite; o que não veio do banco segue adiante. */
export function erroDoBanco(e: unknown): ErroDoBanco {
  if (typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string') {
    const d = e as Partial<ErroDoBanco> & { code: string; message?: string };
    return {
      code: d.code,
      message: d.message ?? '',
      detail: d.detail,
      hint: d.hint,
      where: d.where,
      schema: d.schema,
      table: d.table,
      constraint: d.constraint,
    };
  }
  throw e;
}

/** O comando numa linha só e curto, para a mensagem de falha do teste. */
function resumo(sql: string): string {
  const linha = sql.replace(/\s+/g, ' ').trim();
  return linha.length > 160 ? `${linha.slice(0, 160)}…` : linha;
}

/** Linha do arquivo onde o erro apontou (position conta caracteres desde 1). */
function linhaDoErro(sql: string, e: unknown): string {
  const posicao = Number((e as { position?: string }).position);
  if (!Number.isInteger(posicao) || posicao < 1) return '';
  return `, linha ${sql.slice(0, posicao - 1).split('\n').length}`;
}

async function rodarArquivo(db: PGlite, nome: string, sql: string): Promise<void> {
  try {
    await db.exec(sql);
  } catch (e) {
    const erro = erroDoBanco(e);
    const onde = erro.where ? ` (${erro.where})` : '';
    throw new Error(`${nome}${linhaDoErro(sql, e)}: ${erro.code} ${erro.message}${onde}`, { cause: e });
  }
}

/** PGlite novo, só com a primeira parte do arquivo de apoio. */
export async function novoBanco(): Promise<PGlite> {
  const db = await PGlite.create();
  await rodarArquivo(db, 'supabase-shim.sql', lerApoio().antes);
  return db;
}

/** Aplica as migrações em ordem; cada arquivo roda numa transação só. */
export async function aplicarMigracoes(db: PGlite, migracoes: Migracao[] = lerMigracoes()): Promise<void> {
  for (const m of migracoes) await rodarArquivo(db, m.nome, m.sql);
}

/** A segunda parte do arquivo de apoio, que depende dos papéis da migração 01. */
export async function completarApoio(db: PGlite): Promise<void> {
  await rodarArquivo(db, 'supabase-shim.sql (depois das migrações)', lerApoio().depois);
}

/** O banco dos testes: arquivo de apoio, todas as migrações e o resto do apoio. */
export async function abrirBanco(): Promise<PGlite> {
  const db = await novoBanco();
  await aplicarMigracoes(db);
  await completarApoio(db);
  return db;
}

/** Grava os dados inventados de tests/fixtures/<nome>.sql (o nome vem do teste, nunca de fora). */
export async function aplicarFixture(db: PGlite, nome: string): Promise<void> {
  if (!/^[a-z0-9-]+$/.test(nome)) throw new Error(`Nome de fixture inválido: ${nome}`);
  await rodarArquivo(db, `fixtures/${nome}.sql`, readFileSync(join(PASTA_FIXTURES, `${nome}.sql`), 'utf8'));
}

async function definirToken(db: PGlite, claims: Record<string, unknown> | null): Promise<void> {
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims ? JSON.stringify(claims) : '']);
}

async function trocar(db: PGlite, quem: Quem): Promise<void> {
  // Volta ao dono (também tira o set role) e limpa o token antes de cada troca.
  await db.exec('set session authorization postgres');
  await definirToken(db, null);
  switch (quem.tipo) {
    case 'postgres':
      return;
    case 'anon':
      await db.exec('set session authorization authenticator; set local role anon');
      await definirToken(db, { role: 'anon' });
      return;
    case 'usuario':
      await db.exec('set session authorization authenticator; set local role authenticated');
      await definirToken(db, { sub: quem.id, role: 'authenticated', aal: quem.aal });
      return;
    case 'servico':
      // O nome vem de uma lista fechada (PapelDeServico), nunca de fora.
      await db.exec(`set session authorization ${quem.papel}`);
      if (quem.claims) await definirToken(db, quem.claims);
      return;
  }
}

function sessao(db: PGlite): Sessao {
  return {
    async linhas<T>(sql: string, params?: unknown[]) {
      return (await db.query<T>(sql, params)).rows;
    },
    async valor<T>(sql: string, params?: unknown[]) {
      const { rows } = await db.query<unknown[]>(sql, params, { rowMode: 'array' });
      const linha = rows[0];
      if (!linha) throw new Error(`A consulta não devolveu linha: ${resumo(sql)}`);
      return linha[0] as T;
    },
    async exec(sql: string) {
      await db.exec(sql);
    },
    async como(quem: Quem) {
      await trocar(db, quem);
    },
    async erro(codigo: string | readonly string[], sql: string, params?: unknown[]) {
      const esperados: readonly string[] = typeof codigo === 'string' ? [codigo] : codigo;
      await db.exec('savepoint caso_erro');
      let falha: unknown;
      let passou = false;
      try {
        // Sem parâmetros, aceita vários comandos (um arquivo de migração inteiro, por exemplo).
        if (params === undefined) await db.exec(sql);
        else await db.query(sql, params);
        passou = true;
      } catch (e) {
        falha = e;
      }
      if (passou) {
        await db.exec('release savepoint caso_erro');
        throw new Error(`Esperava o erro ${esperados.join(' ou ')}, mas o comando passou: ${resumo(sql)}`);
      }
      await db.exec('rollback to savepoint caso_erro; release savepoint caso_erro');
      const erro = erroDoBanco(falha);
      if (!esperados.includes(erro.code)) {
        throw new Error(
          `Esperava o erro ${esperados.join(' ou ')}, veio ${erro.code} (${erro.message}): ${resumo(sql)}`,
        );
      }
      return erro;
    },
  };
}

/** Roda o corpo como `quem`, numa transação desfeita no fim. */
export async function caso<T>(db: PGlite, quem: Quem, corpo: (s: Sessao) => Promise<T>): Promise<T> {
  await db.exec('begin');
  let resultado: T;
  try {
    await trocar(db, quem);
    resultado = await corpo(sessao(db));
  } finally {
    await db.exec('rollback');
  }
  // O rollback desfaz a troca de identidade (o arquivo de apoio fixa o postgres na sessão); confere.
  const { rows } = await db.query<{ quem: string }>(
    `select session_user || '/' || current_user || '/' || coalesce(current_setting('request.jwt.claims', true), '') as quem`,
  );
  if (rows[0]?.quem !== 'postgres/postgres/') {
    await db.exec('set session authorization postgres');
    throw new Error(`O caso deixou a sessão trocada: ${rows[0]?.quem}`);
  }
  return resultado;
}

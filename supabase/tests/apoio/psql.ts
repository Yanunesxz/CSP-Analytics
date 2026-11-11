/**
 * Um psql mínimo, para rodar no PGlite os scripts da camada 2 (scripts/testar-rls-dados.sql e
 * scripts/testar-rls-servicos.sql). Entende só o que os dois usam:
 *
 *   \set nome valor          variável ('' vira texto vazio)
 *   \o, \o arquivo           ignorado (a saída já não vai para a tela)
 *   \if :{?nome} | \if :nome   \else   \endif
 *   \gset                    no fim do comando ou sozinho: a primeira linha vira variáveis (booleano vira t ou f)
 *   :'nome' e :nome          trocados fora de texto entre aspas, de $$…$$ e de comentário, como no psql
 *
 * Um comando termina no ";" do fim da linha, fora de $$…$$. Como o psql com ON_ERROR_STOP, para no primeiro erro,
 * desfaz a transação aberta e devolve o erro.
 */
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';

export interface ResultadoDoScript {
  variaveis: Record<string, string>;
  /** As linhas do último comando. */
  linhas: Record<string, unknown>[];
  /** As mensagens de NOTICE, na ordem. */
  avisos: string[];
}

const VERDADE = new Set(['t', 'tr', 'tru', 'true', 'y', 'ye', 'yes', 'on', '1']);
const FALSO = new Set(['f', 'fa', 'fal', 'fals', 'false', 'n', 'no', 'of', 'off', '0']);

function booleano(valor: string, onde: string): boolean {
  const v = valor.trim().toLowerCase();
  if (VERDADE.has(v)) return true;
  if (FALSO.has(v)) return false;
  throw new Error(`psql: valor "${valor}" não é booleano em ${onde}`);
}

function literal(valor: string): string {
  return `'${valor.replaceAll("'", "''")}'`;
}

/** Troca :'nome', :"nome" e :nome fora de aspas, de $$…$$ e de comentário; "::" é o cast. */
export function trocarVariaveis(sql: string, vars: Record<string, string>): string {
  let saida = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i] ?? '';
    const resto = sql.slice(i);
    if (resto.startsWith('--')) {
      const fim = sql.indexOf('\n', i);
      const ate = fim < 0 ? sql.length : fim;
      saida += sql.slice(i, ate);
      i = ate;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) j += 2;
          else break;
        } else j += 1;
      }
      saida += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const dolar = /^\$([A-Za-z_][A-Za-z_0-9]*)?\$/.exec(resto);
    if (dolar) {
      const marca = dolar[0];
      const fim = sql.indexOf(marca, i + marca.length);
      if (fim < 0) throw new Error('psql: $$ sem fechar');
      saida += sql.slice(i, fim + marca.length);
      i = fim + marca.length;
      continue;
    }
    if (c === ':' && sql[i + 1] === ':') {
      saida += '::';
      i += 2;
      continue;
    }
    if (c === ':') {
      const comAspas = /^:(['"])([A-Za-z_][A-Za-z_0-9]*)\1/.exec(resto);
      if (comAspas) {
        const [inteiro, aspas, nome = ''] = comAspas;
        const valor = vars[nome];
        if (valor === undefined) throw new Error(`psql: variável ${nome} não definida`);
        saida += aspas === "'" ? literal(valor) : `"${valor.replaceAll('"', '""')}"`;
        i += inteiro.length;
        continue;
      }
      const cru = /^:([A-Za-z_][A-Za-z_0-9]*)/.exec(resto);
      if (cru && vars[cru[1] ?? ''] !== undefined) {
        saida += vars[cru[1] ?? ''];
        i += cru[0].length;
        continue;
      }
    }
    saida += c;
    i += 1;
  }
  return saida;
}

/** Só linhas em branco e comentários: nada a rodar. */
function soComentario(sql: string): boolean {
  return sql.split('\n').every((l) => !l.trim() || l.trim().startsWith('--'));
}

/** O comando acabou: termina em ";" fora de $$…$$ (conta os $$ do texto inteiro). */
function completo(buffer: string): boolean {
  const pares = (buffer.match(/\$\$/g) ?? []).length;
  return pares % 2 === 0 && buffer.trimEnd().endsWith(';');
}

function comoTexto(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 't' : 'f';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Roda o arquivo como a sessão estiver (a identidade é a de quem chama), com as variáveis do -v. */
export async function rodarScript(
  db: PGlite,
  arquivo: URL,
  variaveis: Record<string, string> = {},
): Promise<ResultadoDoScript> {
  const vars: Record<string, string> = { ...variaveis };
  const avisos: string[] = [];
  let linhas: Record<string, unknown>[] = [];
  const pilha: Array<{ ativo: boolean; ja: boolean }> = [];
  const ativo = () => pilha.every((p) => p.ativo);
  let buffer = '';

  const executar = async (gset: boolean) => {
    const sql = trocarVariaveis(buffer, vars).trim();
    buffer = '';
    if (soComentario(sql)) return;
    const r = await db.query<Record<string, unknown>>(sql, [], {
      onNotice: (n) => {
        if (n.severity === 'NOTICE') avisos.push(n.message ?? '');
      },
    });
    linhas = r.rows;
    if (gset) {
      const [primeira] = r.rows;
      if (!primeira) throw new Error(`psql: \\gset sem linha: ${sql.slice(0, 80)}`);
      for (const [nome, valor] of Object.entries(primeira)) vars[nome] = comoTexto(valor);
    }
  };

  const texto = readFileSync(arquivo, 'utf8').replaceAll('\r\n', '\n');
  try {
    for (const [n, linha] of texto.split('\n').entries()) {
      const meta = linha.trim();
      if (meta.startsWith('\\')) {
        const [comando = '', ...args] = meta.split(/\s+/);
        const onde = `linha ${n + 1}`;
        if (comando === '\\if') {
          if (!ativo()) {
            // Dentro de um ramo que não roda, o psql nem avalia a condição.
            pilha.push({ ativo: false, ja: true });
            continue;
          }
          const expr = args.join(' ');
          const definida = /^:\{\?([A-Za-z_][A-Za-z_0-9]*)\}$/.exec(expr);
          const variavel = /^:([A-Za-z_][A-Za-z_0-9]*)$/.exec(expr);
          let cond: boolean;
          if (definida) cond = vars[definida[1] ?? ''] !== undefined;
          else if (variavel) cond = booleano(vars[variavel[1] ?? ''] ?? '', onde);
          else throw new Error(`psql: \\if que este psql não entende, ${onde}`);
          pilha.push({ ativo: cond, ja: cond });
          continue;
        }
        if (comando === '\\else' || comando === '\\endif') {
          const topo = pilha.pop();
          if (!topo) throw new Error(`psql: ${comando} sem \\if, ${onde}`);
          if (comando === '\\else') pilha.push({ ativo: ativo() && !topo.ja, ja: true });
          continue;
        }
        if (!ativo()) continue;
        if (comando === '\\o') continue;
        if (comando === '\\set') {
          const [nome = '', ...valor] = args;
          const junto = valor.join(' ');
          vars[nome] = junto === "''" ? '' : junto;
          continue;
        }
        if (comando === '\\gset') {
          await executar(true);
          continue;
        }
        throw new Error(`psql: ${comando} não é entendido por este psql, ${onde}`);
      }
      if (!ativo()) continue;
      if (/\\gset\s*$/.test(linha)) {
        buffer += `${linha.replace(/\\gset\s*$/, '')}\n`;
        await executar(true);
        continue;
      }
      buffer += `${linha}\n`;
      if (completo(buffer)) await executar(false);
    }
    if (!soComentario(buffer)) {
      throw new Error(`psql: comando sem ";" no fim do arquivo: ${buffer.slice(0, 80)}`);
    }
  } catch (e) {
    // Como o psql que sai no erro: a transação aberta é desfeita.
    await db.exec('rollback').catch(() => undefined);
    throw e;
  }
  return { variaveis: vars, linhas, avisos };
}

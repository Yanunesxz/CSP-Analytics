#!/usr/bin/env node
// Conferências das migrações no CI (docs/dados/plano.md, "Como o CI aplica"):
//   1. nome AAAAMMDDHHMMSS_o_que_faz.sql e versão única;
//   2. migração não toca o cofre: nada de vault.decrypted_secrets, vault.secrets, net.http_*, das funções da extensão
//      http (http_get, http_post, http(…; a coluna http_status não conta) nem de dblink fora de
//      private.read_credential e private.rotate_credential (decisão 0017);
//   3. com --base <ref>: migração que já existe na base não muda nem some (migração nova desfaz; nunca editar).
//
//   node scripts/conferir-migracoes.mjs [--base origin/main]

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

const PASTA = 'supabase/migrations';
const NOME = /^(\d{14})_[a-z0-9_]+\.sql$/;

// Onde o cofre e a rede podem aparecer: só no corpo destas duas funções.
const FUNCOES_LIBERADAS =
  /create\s+(?:or\s+replace\s+)?function\s+private\.(?:read_credential|rotate_credential)\s*\(/gi;
const FORA = 'fora de private.read_credential e private.rotate_credential';
const PROIBIDOS = [
  [
    `vault.decrypted_secrets ou vault.secrets ${FORA}`,
    /"?\bvault"?\s*\.\s*"?(?:decrypted_secrets|secrets)\b/i,
  ],
  [`net.http_* (pg_net) ${FORA}`, /\bnet\s*\.\s*"?http_/i],
  [
    `função da extensão http ${FORA}`,
    /(?<!\bnet\s*\.\s*"?)\bhttp(?:_(?:get|post|put|patch|delete|head|request|set_curlopt|reset_curlopt|list_curlopt))?\s*\(/i,
  ],
  [`dblink ${FORA}`, /\bdblink\w*\s*\(/i],
  [
    'liga pg_net, http ou dblink (ficam desligadas)',
    /\bcreate\s+extension\s+(?:if\s+not\s+exists\s+)?"?(?:pg_net|http|dblink)\b/i,
  ],
];

// Troca um trecho por espaços, mantendo as quebras de linha (o número da linha continua certo).
const apagar = (texto, inicio, fim) =>
  texto.slice(0, inicio) + texto.slice(inicio, fim).replace(/[^\n]/g, ' ') + texto.slice(fim);

function semFuncoesLiberadas(texto) {
  let saida = texto;
  for (const m of texto.matchAll(FUNCOES_LIBERADAS)) {
    const abre = /\$([A-Za-z_]\w*)?\$/g;
    abre.lastIndex = m.index;
    const a = abre.exec(texto);
    if (!a) continue;
    const fecha = texto.indexOf(a[0], a.index + a[0].length);
    if (fecha < 0) continue;
    const fim = texto.indexOf(';', fecha + a[0].length);
    saida = apagar(saida, m.index, fim < 0 ? texto.length : fim + 1);
  }
  return saida;
}

// Comentário não executa: "-- o segredo fica no Vault" não reprova. Texto entre aspas simples fica como está.
function semComentarios(texto) {
  let saida = '';
  for (let i = 0; i < texto.length;) {
    if (texto[i] === "'") {
      const fim = texto.indexOf("'", i + 1);
      const ate = fim < 0 ? texto.length : fim + 1;
      saida += texto.slice(i, ate);
      i = ate;
    } else if (texto.startsWith('--', i)) {
      const fim = texto.indexOf('\n', i);
      const ate = fim < 0 ? texto.length : fim;
      saida += ' '.repeat(ate - i);
      i = ate;
    } else if (texto.startsWith('/*', i)) {
      const fim = texto.indexOf('*/', i + 2);
      const ate = fim < 0 ? texto.length : fim + 2;
      saida += texto.slice(i, ate).replace(/[^\n]/g, ' ');
      i = ate;
    } else {
      saida += texto[i];
      i += 1;
    }
  }
  return saida;
}

function conferirCofre(arquivo, texto) {
  const problemas = [];
  const linhas = semComentarios(semFuncoesLiberadas(texto)).split('\n');
  linhas.forEach((linha, i) => {
    for (const [nome, padrao] of PROIBIDOS) {
      if (padrao.test(linha)) problemas.push(`${arquivo}:${i + 1}: ${nome}`);
    }
  });
  return problemas;
}

function conferirBase(base) {
  const saida = execFileSync('git', ['diff', '--no-renames', '--name-status', base, '--', PASTA], {
    encoding: 'utf8',
  });
  return saida
    .split('\n')
    .filter((l) => /^[MD]\t/.test(l))
    .map(
      (l) =>
        `${l.slice(2)}: migração que já está na base ${l[0] === 'M' ? 'mudou' : 'sumiu'} (faça uma migração nova)`,
    );
}

function principal() {
  const { values } = parseArgs({ options: { base: { type: 'string' } }, strict: true });
  let arquivos = [];
  try {
    arquivos = readdirSync(PASTA)
      .filter((a) => a.endsWith('.sql'))
      .sort();
  } catch {
    arquivos = [];
  }
  const problemas = [];
  const versoes = new Map();
  for (const arquivo of arquivos) {
    const m = NOME.exec(arquivo);
    if (!m) {
      problemas.push(`${arquivo}: nome fora do formato AAAAMMDDHHMMSS_o_que_faz.sql`);
      continue;
    }
    if (versoes.has(m[1])) problemas.push(`${arquivo}: mesma versão de ${versoes.get(m[1])}`);
    versoes.set(m[1], arquivo);
    problemas.push(...conferirCofre(arquivo, readFileSync(join(PASTA, arquivo), 'utf8')));
  }
  if (values.base) problemas.push(...conferirBase(values.base));
  for (const p of problemas) console.error(p);
  console.log(
    problemas.length
      ? `Migrações: ${problemas.length} problema(s).`
      : `Migrações: ${arquivos.length} arquivo(s) conferido(s)${values.base ? ` contra ${values.base}` : ''}, nada a corrigir.`,
  );
  return problemas.length ? 1 : 0;
}

process.exitCode = principal();

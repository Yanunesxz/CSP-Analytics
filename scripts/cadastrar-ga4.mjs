#!/usr/bin/env node
// Cadastro das propriedades do GA4 (docs/dados/integracoes.md, seção 9): escreve no stdout um
// "select setup.register_web_property(...)" por propriedade, para o psql da conexão do mkt_setup.
// Só grava com --executar; sem ele, mostra o que faria. Não imprime senha nem endereço do banco.
//
//   node scripts/cadastrar-ga4.mjs cs=412345678@corposensual.com.br plumene=498765432@plumene.com.br
//   node scripts/cadastrar-ga4.mjs --executar cs=412345678@corposensual.com.br | psql "$MKT_SETUP_DATABASE_URL" -v ON_ERROR_STOP=1
//
// O ID é o número da propriedade (GA4 → Administrador → Detalhes da propriedade), não o "G-…" do site.
// Rodar de novo não duplica: a função atualiza o host da mesma propriedade.

import process from 'node:process';

const MARCAS = new Set(['cs', 'plumene']);

function falhar(mensagem) {
  console.error(mensagem);
  process.exit(2);
}

const args = process.argv.slice(2);
const executar = args.includes('--executar');
const pedidos = args.filter((a) => a !== '--executar');
if (pedidos.length === 0) falhar('Uso: node scripts/cadastrar-ga4.mjs [--executar] marca=ID@host [marca=ID@host]');

const linhas = [];
for (const pedido of pedidos) {
  const m = /^([a-z]+)=(\d{6,12})@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/.exec(pedido.trim().toLowerCase());
  if (!m || !MARCAS.has(m[1])) {
    if (/^[a-z]+=g-/i.test(pedido)) falhar('Esse é o ID do site (G-…). Use o número da propriedade do GA4.');
    falhar(`Fora do formato marca=ID@host (marcas: ${[...MARCAS].join(', ')}): ${pedido}`);
  }
  const [, marca, id, host] = m;
  linhas.push(`select setup.register_web_property('${marca}', 'ga4_property', '${id}', '${host}');`);
}

if (!executar) {
  console.error('Simulação (nada gravado). Com --executar, estas linhas vão para o psql:');
  for (const l of linhas) console.error(`  ${l}`);
  process.exit(0);
}
process.stdout.write(`${linhas.join('\n')}\n`);

#!/usr/bin/env node
// Senha dos papéis de serviço (decisão 0017): escreve no stdout um "alter role … with login password" por papel, com o
// verificador SCRAM-SHA-256 calculado aqui. A senha não vai em texto para o banco (nem para um log de comandos do
// servidor) nem para o log do CI: o stdout segue direto para o psql.
//
//   node scripts/senha-dos-papeis.mjs mkt_worker=MKT_WORKER_DB_PASSWORD_TESTE … | psql "$URL" -v ON_ERROR_STOP=1 -q -o /dev/null
//
// Cada argumento é papel=NOME_DA_VARIÁVEL; a senha vem da variável de ambiente, nunca da linha de comando.

import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import process from 'node:process';

const PAPEIS = new Set(['mkt_worker', 'mkt_executor', 'mkt_setup', 'n8n_notifier']);
const ITERACOES = 4096; // o padrão do Postgres (scram_iterations)

// Formato que o Postgres guarda em pg_authid: SCRAM-SHA-256$<iterações>:<sal>$<StoredKey>:<ServerKey>.
function verificadorScram(senha) {
  const sal = randomBytes(16);
  const salgada = pbkdf2Sync(Buffer.from(senha, 'utf8'), sal, ITERACOES, 32, 'sha256');
  const chaveDoCliente = createHmac('sha256', salgada).update('Client Key').digest();
  const guardada = createHash('sha256').update(chaveDoCliente).digest();
  const doServidor = createHmac('sha256', salgada).update('Server Key').digest();
  const b64 = (b) => b.toString('base64');
  return `SCRAM-SHA-256$${ITERACOES}:${b64(sal)}$${b64(guardada)}:${b64(doServidor)}`;
}

function falhar(mensagem) {
  console.error(mensagem);
  process.exit(2);
}

const pedidos = process.argv.slice(2);
if (pedidos.length === 0) falhar('Uso: node scripts/senha-dos-papeis.mjs papel=VARIAVEL [papel=VARIAVEL …]');

const linhas = [];
for (const pedido of pedidos) {
  const [papel, variavel, ...resto] = pedido.split('=');
  if (resto.length || !PAPEIS.has(papel) || !/^[A-Z][A-Z0-9_]*$/.test(variavel ?? '')) {
    falhar(`Argumento fora do formato papel=VARIAVEL (papéis: ${[...PAPEIS].join(', ')}).`);
  }
  const senha = process.env[variavel] ?? '';
  // Só ASCII visível: o Postgres aplica o SASLprep antes do SCRAM, e assim o verificador daqui é o mesmo do servidor.
  if (senha.length < 20 || !/^[\x21-\x7e]+$/.test(senha)) {
    falhar(`${variavel}: a senha precisa de 20 caracteres ou mais, só ASCII visível (sem espaço).`);
  }
  linhas.push(`alter role ${papel} with login password '${verificadorScram(senha)}';`);
}
process.stdout.write(`${linhas.join('\n')}\n`);

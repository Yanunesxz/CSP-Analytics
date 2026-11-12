#!/usr/bin/env node
// Teste de RLS pela API do Supabase: a camada 2 de docs/dados/papeis-e-rls.md ("Teste de RLS").
//
//   node scripts/testar-rls.mjs                          lista os casos (onde cada um roda) e sai
//   node scripts/testar-rls.mjs --executar               roda no projeto de TESTE (só no job do CI)
//   node scripts/testar-rls.mjs --executar --sem-login   só os casos sem login (RLS-01 a 03); serve à produção
//   node scripts/testar-rls.mjs --limpar                 apaga os usuários de teste que sobraram (projeto de teste)
//   --motivo  no caso que falhou, mostra a etapa e os códigos HTTP e do banco (nunca mensagem, id, e-mail ou token)
//
// Projeto de teste: SUPABASE_URL_TESTE, SUPABASE_ANON_KEY_TESTE e SUPABASE_SERVICE_ROLE_KEY_TESTE; CSP_MKT_PROJETO=teste
// (só o job de teste define); RLS_ETIQUETA (a mesma do passo de dados do CI) e RLS_DADOS (o JSON que
// scripts/testar-rls-dados.sql devolve: só ids inventados). Produção (--sem-login): SUPABASE_URL e SUPABASE_ANON_KEY.
// Nada disso é impresso: nem chave, nem senha (gerada na hora), nem o segredo do TOTP, nem e-mail.
// Só módulos do Node: fetch e node:crypto.

import { createHmac, randomBytes } from 'node:crypto';
import process from 'node:process';
import { parseArgs } from 'node:util';

const ZERO = '00000000-0000-0000-0000-000000000000';
const ANTIGO = '2000-01-01T00:00:00.000Z';
// RFC 2606: ".invalid" nunca é endereço de verdade. Nenhum e-mail sai no teste (o convite é por generate_link).
const DOMINIO_DE_TESTE = 'teste.invalid';
const EMAIL_DE_TESTE = /^rls-[a-z]+-[0-9a-z-]+@teste\.invalid$/;
const VIEWS_DE_API = ['v_traffic_actions', 'v_traffic_log'];
const ESQUEMAS_FECHADOS = [
  'mkt',
  'authz',
  'ingest',
  'notify',
  'private',
  'setup',
  'public',
  'graphql_public',
  'auth',
  'storage',
  'vault',
  'cron',
  'extensions',
];
// As 45 tabelas de mkt (docs/dados/tabelas.md, "Todas as tabelas").
const TABELAS_MKT = [
  'brands',
  'ad_accounts',
  'campaigns',
  'campaign_managed_by_history',
  'sales_reps',
  'sales_rep_app_logins',
  'ig_accounts',
  'web_properties',
  'crm_funnels',
  'crm_origin_map',
  'crm_customers',
  'crm_customer_brands',
  'crm_customer_reps',
  'crm_leads',
  'crm_orders',
  'crm_upstream_runs',
  'ad_campaign_daily',
  'ad_activity_log',
  'ig_account_daily',
  'ig_media',
  'ig_media_daily',
  'seo_daily',
  'seo_query_daily',
  'ga4_traffic_daily',
  'site_checks',
  'traffic_strategies',
  'spend_limits',
  'claude_runs',
  'traffic_actions',
  'traffic_stops',
  'traffic_stop_campaigns',
  'platform_executions',
  'traffic_log',
  'connectors',
  'connector_jobs',
  'sync_runs',
  'csv_imports',
  'profiles',
  'invitations',
  'notification_preferences',
  'saved_filters',
  'notification_outbox',
  'holidays',
  'role_permissions',
  'audit_log',
];

// As funções de api (todas da migração 09), com argumentos inertes: chamadas sem login e por quem perdeu o acesso.
// Mesmo que a proteção falhasse, nada disto grava: id que não existe, updated_at antigo, contagem 0, e-mail inválido.
// Os nomes seguem docs/dados/papeis-e-rls.md ("Funções de ação": p_ + o nome do parâmetro).
const FUNCOES = {
  propose_action: {
    p_brand: 'cs',
    p_platform: 'meta',
    p_campaign_id: ZERO,
    p_kind: 'pause',
    p_title: 'Chamada inerte',
    p_rationale: 'Chamada inerte do teste de RLS.',
    p_params: { status: 'paused' },
    p_impact: 'low',
    p_effort: 'low',
    p_cost_cents: null,
    p_approve_now: false,
  },
  approve_action: { p_action_id: ZERO, p_expected_updated_at: ANTIGO },
  discard_action: {
    p_action_id: ZERO,
    p_reason: 'other',
    p_note: 'Chamada inerte do teste.',
    p_expected_updated_at: ANTIGO,
  },
  mark_action_done: { p_action_id: ZERO, p_result: 'Chamada inerte.', p_expected_updated_at: ANTIGO },
  save_strategy: {
    p_brand: 'cs',
    p_month_on: '2000-01-01',
    p_body: '',
    p_budget_cents: null,
    p_target_cost_per_new_customer_cents: null,
    p_target_cost_per_lead_cents: null,
    p_target_new_customers: null,
    p_expected_updated_at: ANTIGO,
  },
  set_spend_limit: { p_ad_account_id: ZERO, p_monthly_limit_cents: 0, p_expected_updated_at: ANTIGO },
  stop_all: { p_brand: null, p_expected_count: 0 },
  retry_execution: { p_execution_id: ZERO, p_expected_updated_at: ANTIGO },
  undo_stop: { p_stop_id: ZERO, p_expected_updated_at: ANTIGO },
  change_campaign_operator: {
    p_campaign_id: ZERO,
    p_to_operator: 'human',
    p_reason: 'correction',
    p_note: null,
    p_expected_updated_at: ANTIGO,
  },
  retry_connector: { p_connector_code: 'csp360' },
  set_connector_state: { p_connector_code: 'csp360', p_state: 'connected', p_expected_updated_at: ANTIGO },
  confirm_mass_delete: { p_run_id: ZERO },
  upload_csv: { p_connector_code: 'meta', p_brand: 'cs', p_file_name: 'inerte.csv', p_content: '' },
  invite_user: { p_email: 'inerte@invalid', p_display_name: 'X', p_role: 'traffic_manager' },
  revoke_invitation: { p_invitation_id: ZERO },
  change_role: { p_profile_id: ZERO, p_role: 'traffic_manager', p_expected_updated_at: ANTIGO },
  revoke_access: { p_profile_id: ZERO, p_reason: 'other', p_note: null, p_expected_updated_at: ANTIGO },
  save_profile_preferences: {
    p_theme: 'device',
    p_default_brand: null,
    p_default_view: 'viewer',
    p_whatsapp_digits: null,
  },
  save_notification_preference: { p_notice: 'weekly_report', p_email: true, p_whatsapp: false },
  save_filter: { p_scope: 'bar', p_name: 'x', p_filters: {} },
  delete_saved_filter: { p_id: ZERO },
  my_profile: {},
  my_permissions: {},
  list_role_permissions: {},
  check_text: { p_text: 'texto' },
  list_users: {},
  credential_status: {},
  my_notification_preferences: {},
};
// Leitura de lista que, para quem não tem perfil ativo, pode voltar vazia em vez de PT403 ("zero linhas / PT403").
const LEITURAS_QUE_PODEM_VIR_VAZIAS = new Set([
  'my_permissions',
  'list_role_permissions',
  'my_notification_preferences',
]);

// Onde cada parte roda: 'api' (este script), 'servico' (psql na conexão de cada papel, no CI:
// scripts/testar-rls-servicos.sql), 'camada1' (PGlite, no pnpm verify) e 'fase4' (depende das api.kpi_*, das Edge
// Functions ou da migração 13).
const ONDE = {
  api: 'API',
  servico: 'conexão de serviço (psql no CI)',
  camada1: 'só camada 1 (PGlite)',
  fase4: 'fase 4',
};
const p = (onde, texto) => ({ onde, texto });

const CASOS = [
  [
    'RLS-01',
    [
      p(
        'api',
        'anon lê api.v_traffic_actions e api.v_traffic_log e chama list_users, my_profile e credential_status: negado',
      ),
      p('fase4', 'anon nas api.kpi_*'),
    ],
  ],
  [
    'RLS-02',
    [p('api', 'anon chama cada função de api (approve_action, stop_all, invite_user e as outras): negado')],
  ],
  [
    'RLS-03',
    [
      p(
        'api',
        'anon lê mkt.crm_leads pela API: esquema não exposto; nenhum outro esquema exposto; GraphQL desligado',
      ),
    ],
  ],
  ['RLS-04', [p('api', 'anon, dono e gestor: POST, PATCH e DELETE em cada tabela de mkt: negado')]],
  [
    'RLS-05',
    [
      p('api', 'gestor lê as duas views (vê a própria proposta) e chama credential_status: permitido'),
      p('fase4', 'números e leads pelas api.kpi_*'),
    ],
  ],
  [
    'RLS-06',
    [
      p(
        'api',
        'gestor: approve_action, discard_action, retry_execution e propose_action com approve_now: PT403',
      ),
    ],
  ],
  ['RLS-07', [p('api', 'gestor: stop_all, undo_stop, set_spend_limit e change_campaign_operator: PT403')]],
  [
    'RLS-08',
    [p('api', 'gestor: invite_user, change_role (também o próprio), revoke_access e list_users: PT403')],
  ],
  [
    'RLS-09',
    [
      p('api', 'gestor chama list_users: PT403'),
      p('camada1', 'gestor lê invitations, audit_log e perfis dos outros (não há view exposta)'),
    ],
  ],
  ['RLS-10', [p('api', 'gestor: retry_connector, set_connector_state e confirm_mass_delete: PT403')]],
  [
    'RLS-11',
    [p('api', 'gestor: propose_action com e-mail ou telefone no "por quê": recusado; nada gravado')],
  ],
  [
    'RLS-12',
    [
      p(
        'api',
        'gestor: mark_action_done numa ideia que não é pendência: PT422; controle: na pendência, aceito',
      ),
    ],
  ],
  [
    'RLS-13',
    [
      p('api', 'gestor apaga um "Meus filtros" do dono e lê as preferências: nada apagado, nada do dono'),
      p('camada1', 'gestor lê saved_filters e notification_preferences do dono (não há view exposta)'),
    ],
  ],
  ['RLS-14', [p('api', 'dono: change_role e revoke_access no próprio perfil, que é o último dono: PT422')]],
  [
    'RLS-15',
    [
      p(
        'api',
        'dono aprova com updated_at antigo: PT409, nada gravado; controle com o lido, passado por Date',
      ),
    ],
  ],
  [
    'RLS-16',
    [p('api', 'dono aprova pendência de medição: PT422; descarta sem motivo: recusado; controle com motivo')],
  ],
  ['RLS-17', [p('api', 'dono altera ou apaga traffic_log, audit_log e campaign_managed_by_history: negado')]],
  [
    'RLS-18',
    [
      p(
        'api',
        'anon e dono: private.connector_credentials, private.read_credential e vault.decrypted_secrets: negado',
      ),
      p('servico', 'mkt_worker e n8n_notifier leem vault.decrypted_secrets: negado'),
    ],
  ],
  ['RLS-19', [p('api', 'dono lê mkt.notification_outbox: negado')]],
  [
    'RLS-20',
    [
      p(
        'api',
        'gestor com o acesso tirado e o token ainda válido: views vazias, funções PT403, my_profile inativo',
      ),
      p('fase4', 'as api.kpi_*'),
    ],
  ],
  [
    'RLS-21',
    [
      p('api', 'logado sem perfil (sem convite): views vazias, funções PT403, my_profile vazio'),
      p('fase4', 'as api.kpi_*'),
    ],
  ],
  [
    'RLS-22',
    [
      p(
        'servico',
        'mkt_worker: api.approve_action, update em traffic_actions e em campaigns.managed_by: negado',
      ),
    ],
  ],
  ['RLS-23', [p('servico', 'n8n_notifier lê cada tabela e view de mkt: negado')]],
  [
    'RLS-24',
    [
      p(
        'servico',
        'catálogo do projeto: toda view de api e de mkt com security_invoker (e as de api com security_barrier)',
      ),
      p('fase4', 'as views das migrações 11 e 12'),
    ],
  ],
  [
    'RLS-25',
    [p('camada1', 'cada domain × labels.ts (o projeto não tem o labels.ts; as migrações são as mesmas)')],
  ],
  [
    'RLS-26',
    [
      p('api', 'gestor chama upload_csv: PT403'),
      p('fase4', 'gestor lê csv_imports (controle positivo, por api.kpi_connectors)'),
    ],
  ],
  [
    'RLS-27',
    [
      p(
        'camada1',
        'catálogo: RLS, search_path pg_catalog, pg_temp, has_function_privilege, sequências e bypassrls; o pg_temp de cada serviço',
      ),
    ],
  ],
  [
    'RLS-28',
    [
      p('api', 'gestor e dono: private.read_credential, rotate_credential e queue_execution; vault: negado'),
      p('servico', 'n8n_notifier: as mesmas três funções e vault.decrypted_secrets: negado'),
    ],
  ],
  ['RLS-29', [p('api', 'anon, gestor, dono e sem perfil: POST, PATCH e DELETE em cada view de api: negado')]],
  [
    'RLS-30',
    [
      p(
        'servico',
        'mkt_worker: tabelas de pessoas, update de idea para approved com o token do dono, delete_missing fora da lista, as funções do executor e a credencial de escrita: negado',
      ),
      p('camada1', 'mkt_worker com o token do dono aprovando ou descartando por cada ingest.*'),
    ],
  ],
  ['RLS-31', [p('fase4', 'Edge Functions convidar e tirar-acesso: 401 ou 403')]],
  [
    'RLS-32',
    [p('api', 'login sem convite, com convite vencido e com convite revogado: sem perfil; signUp recusado')],
  ],
  ['RLS-33', [p('fase4', 'notify.claim_pending com aviso de quem perdeu o acesso (migração 13)')]],
  [
    'RLS-34',
    [
      p(
        'servico',
        'mkt_executor: ingest.upsert_*, add_claude_proposal, api.*, private.read_credential e crm_leads: negado',
      ),
    ],
  ],
  [
    'RLS-35',
    [
      p(
        'api',
        'dono sem o segundo fator: approve_action, set_spend_limit, invite_user, retry_connector: PT403; controle: stop_all aceito',
      ),
    ],
  ],
];
const SEM_LOGIN = new Set(['RLS-01', 'RLS-02', 'RLS-03']);
// O acesso do gestor é tirado no RLS-20: ele roda por último.
const ORDEM = [...CASOS.map(([codigo]) => codigo).filter((c) => c !== 'RLS-20'), 'RLS-20'];

// ---------- Ambiente ----------

class Recusa extends Error {}

function lerAmbiente({ semLogin, limpar }) {
  const env = process.env;
  if (semLogin && !limpar) {
    // Sem login não cria nada: serve ao projeto de teste e à produção.
    return {
      url: urlDoProjeto(env.SUPABASE_URL ?? env.SUPABASE_URL_TESTE),
      anon: chave(env.SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY_TESTE),
    };
  }
  if (env.CSP_MKT_PROJETO !== 'teste') {
    throw new Recusa(
      'Recusado: --executar e --limpar só rodam no job do projeto de teste (CSP_MKT_PROJETO=teste).',
    );
  }
  const url = urlDoProjeto(env.SUPABASE_URL_TESTE);
  if (env.SUPABASE_URL && urlDoProjeto(env.SUPABASE_URL) === url) {
    throw new Recusa('Recusado: o endereço de teste é o mesmo de SUPABASE_URL.');
  }
  return {
    url,
    anon: chave(env.SUPABASE_ANON_KEY_TESTE),
    servico: chave(env.SUPABASE_SERVICE_ROLE_KEY_TESTE),
  };
}

function urlDoProjeto(valor) {
  let u;
  try {
    u = new URL(String(valor ?? ''));
  } catch {
    throw new Recusa('Falta o endereço do projeto (SUPABASE_URL_TESTE, ou SUPABASE_URL com --sem-login).');
  }
  if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
    throw new Recusa('O endereço do projeto precisa ser https.');
  }
  return u.origin;
}

function chave(valor) {
  if (typeof valor !== 'string' || valor.length < 20)
    throw new Recusa('Falta uma chave do projeto no ambiente.');
  return valor;
}

function lerEtiqueta() {
  const etiqueta = process.env.RLS_ETIQUETA ?? '';
  if (!/^[0-9a-z][0-9a-z-]{0,39}$/.test(etiqueta))
    throw new Recusa('RLS_ETIQUETA ausente ou fora do formato.');
  return etiqueta;
}

function lerDados() {
  let dados;
  try {
    dados = JSON.parse(process.env.RLS_DADOS ?? '');
  } catch {
    throw new Recusa('RLS_DADOS ausente: rode antes o passo de dados (scripts/testar-rls-dados.sql).');
  }
  for (const campo of ['ad_account_id', 'campaign_id']) {
    if (!ehUuid(dados?.[campo])) throw new Recusa(`RLS_DADOS sem ${campo}.`);
  }
  if (Number.isNaN(Date.parse(dados.campaign_updated_at)))
    throw new Recusa('RLS_DADOS sem campaign_updated_at.');
  return dados;
}

// O e-mail de cada usuário de teste. O passo de dados do CI monta os de dono e vencido com o mesmo formato.
const emailDe = (papel, etiqueta) => `rls-${papel}-${etiqueta}@${DOMINIO_DE_TESTE}`;

// ---------- HTTP ----------

const AUTH = { 'X-Supabase-Api-Version': '2024-01-01' };
let projeto = { url: '', anon: '', servico: '' };

// Chave nova (sb_publishable_…, sb_secret_…) vai só no apikey; a antiga, um JWT, também no Authorization.
const ehJwt = (valor) => typeof valor === 'string' && valor.startsWith('eyJ');

async function pedir(
  metodo,
  caminho,
  { chave: apikey = projeto.anon, token, perfil, corpo, cabecalhos = {} } = {},
) {
  const h = { apikey, ...cabecalhos };
  const portador = token ?? (ehJwt(apikey) ? apikey : null);
  if (portador) h.Authorization = `Bearer ${portador}`;
  if (perfil) h[metodo === 'GET' ? 'Accept-Profile' : 'Content-Profile'] = perfil;
  if (corpo !== undefined) h['Content-Type'] = 'application/json';
  let resposta;
  try {
    resposta = await fetch(projeto.url + caminho, {
      method: metodo,
      headers: h,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { status: 0, codigo: 'REDE', json: null };
  }
  const texto = await resposta.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }
  // PostgREST: "code" (SQLSTATE ou PGRST…). Auth: "error_code", ou "code" em texto na versão 2024-01-01.
  let codigo = null;
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    codigo = json.error_code ?? (typeof json.code === 'string' ? json.code : null);
  }
  return { status: resposta.status, codigo, json };
}

const sessaoAnon = { nome: 'anon', token: null };
const ler = (sessao, recurso, consulta = '', perfil = 'api') =>
  pedir('GET', `/rest/v1/${recurso}${consulta ? `?${consulta}` : ''}`, { token: sessao.token, perfil });
const rpc = (sessao, funcao, args = {}, perfil = 'api') =>
  pedir('POST', `/rest/v1/rpc/${funcao}`, { token: sessao.token, perfil, corpo: args });
const escrever = (sessao, metodo, recurso, perfil = 'api') =>
  pedir(metodo, `/rest/v1/${recurso}${metodo === 'POST' ? '' : `?id=eq.${ZERO}`}`, {
    token: sessao.token,
    perfil,
    corpo: metodo === 'DELETE' ? undefined : { id: ZERO },
    cabecalhos: { Prefer: 'return=minimal' },
  });
const admin = (metodo, caminho, corpo) =>
  pedir(metodo, `/auth/v1/admin/${caminho}`, { chave: projeto.servico, corpo, cabecalhos: AUTH });

// ---------- O que conta como negado ----------

const ok = (r) => r.status >= 200 && r.status < 300;
const semPermissao = (r) => (r.status === 401 || r.status === 403) && r.codigo === '42501';
const naoExposto = (r) => r.status === 406 && r.codigo === 'PGRST106';
const naoExiste = (r) => r.status === 404 && ['PGRST202', 'PGRST205', '42P01', '42883'].includes(r.codigo);
const pt = (r, n) => r.status === n && r.codigo === `PT${n}`;
const recusadoPeloCheck = (r) => (r.status === 400 && ['23514', '23502'].includes(r.codigo)) || pt(r, 422);
// Escrita numa view: sem grant (42501) ou view que não aceita escrita (55000, que o PostgREST devolve como 500).
const escritaNegada = (r) =>
  semPermissao(r) || (r.status === 500 && r.codigo === '55000') || r.status === 405;

class Falha extends Error {
  constructor(etapa, r) {
    super(etapa);
    this.etapa = etapa;
    this.status = r?.status;
    this.codigo = r?.codigo;
  }
}

function exigir(condicao, etapa, r) {
  if (!condicao) throw new Falha(etapa, r);
}

// ---------- Leitura das respostas ----------

const ehUuid = (v) =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// Função que devolve uuid, a linha (objeto) ou uma tabela (lista): o id que vier.
function idDe(json, campos = ['id']) {
  if (ehUuid(json)) return json;
  if (Array.isArray(json)) return json.length ? idDe(json[0], campos) : null;
  if (json && typeof json === 'object') {
    for (const c of campos) if (ehUuid(json[c])) return json[c];
  }
  return null;
}

// my_profile: objeto, lista de uma linha, ou nada (null, [], linha toda nula).
function perfilDe(json) {
  const linha = Array.isArray(json) ? json[0] : json;
  if (!linha || typeof linha !== 'object') return null;
  return Object.values(linha).some((v) => v !== null) ? linha : null;
}

const vazio = (json) =>
  json === null ||
  (Array.isArray(json) && json.length === 0) ||
  (typeof json === 'object' && perfilDe(json) === null);

// O updated_at como a tela manda de volta: lido em texto e passado por Date (milissegundos).
const comoNaTela = (valor) => new Date(valor).toISOString();

// ---------- Senha, TOTP e espera ----------

// 24 bytes aleatórios e uma letra de cada tipo, para qualquer regra de senha do projeto. Nunca impressa.
const gerarSenha = () => `${randomBytes(24).toString('base64url')}aA1!`;

function base32(texto) {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = [];
  let bits = 0;
  let valor = 0;
  for (const c of texto.replace(/=+$/, '').toUpperCase()) {
    const i = alfabeto.indexOf(c);
    if (i < 0) throw new Error('TOTP: segredo fora do base32');
    valor = ((valor << 5) | i) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// RFC 6238: HMAC-SHA1, passo de 30 s, 6 dígitos (o TOTP do Supabase Auth).
function totp(segredo, agoraMs = Date.now()) {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(Math.floor(agoraMs / 30_000)));
  const h = createHmac('sha1', base32(segredo)).update(contador).digest();
  const o = h[h.length - 1] & 0x0f;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// O código vale até o fim da janela de 30 s: com menos de 5 s sobrando, espera a próxima.
async function esperarJanelaDoTotp() {
  const resta = 30_000 - (Date.now() % 30_000);
  if (resta < 5_000) await esperar(resta + 500);
}

function aalDoToken(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).aal ?? null;
  } catch {
    return null;
  }
}

async function emLotes(tarefas, tamanho = 8) {
  const resultados = [];
  for (let i = 0; i < tarefas.length; i += tamanho) {
    resultados.push(...(await Promise.all(tarefas.slice(i, i + tamanho).map((t) => t()))));
  }
  return resultados;
}

// ---------- Usuários de teste ----------

const criados = new Set(); // ids no Auth, apagados no fim
const sessoes = []; // tokens, encerrados no fim

// O mesmo caminho da Edge Function convidar: o Auth cria o login com invited_at, e o gatilho do banco cria o perfil
// só se houver convite válido. generate_link não manda e-mail; a senha entra pela API de administração.
async function criarPorConvite(email) {
  const r = await admin('POST', 'generate_link', { type: 'invite', email });
  const id = idDe(r.json) ?? idDe(r.json?.user);
  if (id) criados.add(id);
  exigir(ok(r) && id, 'convite no Auth (generate_link)', r);
  const senha = gerarSenha();
  const r2 = await admin('PUT', `users/${id}`, { password: senha, email_confirm: true });
  exigir(ok(r2), 'senha do usuário convidado', r2);
  return { id, email, senha };
}

// Login criado direto no Auth (como pelo painel), sem convite: invited_at nulo.
async function criarSemConvite(email) {
  const senha = gerarSenha();
  const r = await admin('POST', 'users', { email, password: senha, email_confirm: true });
  const id = idDe(r.json);
  if (id) criados.add(id);
  exigir(ok(r) && id, 'login sem convite (admin)', r);
  return { id, email, senha };
}

async function entrar(nome, usuario) {
  const r = await pedir('POST', '/auth/v1/token?grant_type=password', {
    corpo: { email: usuario.email, password: usuario.senha },
    cabecalhos: AUTH,
  });
  exigir(ok(r) && typeof r.json?.access_token === 'string', `login (${nome})`, r);
  const sessao = { nome, id: usuario.id, token: r.json.access_token };
  sessoes.push(sessao);
  return sessao;
}

// Cadastra o TOTP e sobe a sessão para aal2, com o código calculado aqui (o segredo nunca sai da memória).
async function segundoFator(sessao) {
  const opcoes = { token: sessao.token, cabecalhos: AUTH };
  const r = await pedir('POST', '/auth/v1/factors', {
    ...opcoes,
    corpo: { factor_type: 'totp', friendly_name: 'teste-rls' },
  });
  const segredo = r.json?.totp?.secret;
  exigir(ok(r) && typeof segredo === 'string' && ehUuid(r.json?.id), 'cadastro do TOTP do dono', r);
  await esperarJanelaDoTotp();
  const c = await pedir('POST', `/auth/v1/factors/${r.json.id}/challenge`, { ...opcoes, corpo: {} });
  exigir(ok(c) && ehUuid(c.json?.id), 'desafio do TOTP', c);
  const v = await pedir('POST', `/auth/v1/factors/${r.json.id}/verify`, {
    ...opcoes,
    corpo: { challenge_id: c.json.id, code: totp(segredo) },
  });
  exigir(ok(v) && typeof v.json?.access_token === 'string', 'verificação do TOTP', v);
  exigir(aalDoToken(v.json.access_token) === 'aal2', 'token do dono sem aal2', v);
  const elevada = { nome: 'dono', id: sessao.id, token: v.json.access_token };
  sessoes.push(elevada);
  return elevada;
}

async function meuPerfil(sessao) {
  const r = await rpc(sessao, 'my_profile');
  return { r, perfil: ok(r) ? perfilDe(r.json) : null };
}

async function lerAcao(sessao, id) {
  const r = await ler(sessao, 'v_traffic_actions', `select=*&id=eq.${id}`);
  exigir(ok(r) && Array.isArray(r.json) && r.json.length === 1, 'ler a ação em api.v_traffic_actions', r);
  const acao = r.json[0];
  exigir(
    typeof acao.status === 'string' && !Number.isNaN(Date.parse(acao.updated_at)),
    'ação sem status ou updated_at',
    r,
  );
  return acao;
}

async function acoesComTitulo(sessao, titulo) {
  const r = await ler(sessao, 'v_traffic_actions', `select=*&title=eq.${encodeURIComponent(titulo)}`);
  exigir(ok(r) && Array.isArray(r.json), 'ler ações pelo título', r);
  return r.json.length;
}

const PORQUE = 'Proposta inventada pelo teste de RLS, sem dado de pessoa.';
const proposta = (dados, titulo, extra = {}) => ({
  p_brand: 'cs',
  p_platform: 'meta',
  p_campaign_id: dados.campaign_id,
  p_kind: 'pause',
  p_title: titulo,
  p_rationale: PORQUE,
  p_params: { status: 'paused' },
  p_impact: 'low',
  p_effort: 'low',
  p_cost_cents: null,
  p_approve_now: false,
  ...extra,
});
const pendencia = (dados, titulo) =>
  proposta(dados, titulo, {
    p_platform: null,
    p_campaign_id: null,
    p_kind: 'pending_fix',
    p_params: { area: 'pixel' },
  });
const criativo = (dados, titulo) =>
  proposta(dados, titulo, { p_kind: 'creative', p_params: { creative_ref: 'criativo-inventado' } });

// A API sobe as views só depois que o PostgREST recarrega o esquema (logo depois das migrações).
async function esperarApi() {
  const limite = Date.now() + 90_000;
  for (;;) {
    const r = await ler(sessaoAnon, 'v_traffic_actions', 'select=*&limit=1');
    const carregando = r.status === 0 || r.status === 503 || (r.status === 404 && r.codigo === 'PGRST205');
    if (!carregando) return;
    if (Date.now() > limite) throw new Falha('a API não carregou o esquema api a tempo', r);
    await esperar(3_000);
  }
}

async function preparar(ctx) {
  const { etiqueta, dados } = ctx;

  // Convite vencido antes do dono: nesse momento o vencido é o único caminho para virar o primeiro dono, e só a
  // validade pode barrar (RLS-32).
  const vencido = await entrar('vencido', await criarPorConvite(emailDe('vencido', etiqueta)));
  const pv = await meuPerfil(vencido);
  ctx.respostas.vencido = pv.r;
  // Se o vencido virasse dono, o dono de verdade não nasceria: o motivo certo aparece aqui, não adiante.
  exigir(!pv.perfil, 'login com convite vencido ganhou perfil (RLS-32)', pv.r);

  // Dono: o convite do primeiro dono vem do passo de dados (setup.create_first_owner_invitation, papel mkt_setup).
  const dono = await criarPorConvite(emailDe('dono', etiqueta));
  ctx.dono = await segundoFator(await entrar('dono (aal1)', dono));
  ctx.donoAal1 = await entrar('dono (aal1)', dono);
  const pd = await meuPerfil(ctx.dono);
  exigir(
    pd.perfil?.role === 'owner' && pd.perfil?.is_active === true,
    'perfil do dono nasceu do convite',
    pd.r,
  );

  // Gestor: convidado pelo dono (api.invite_user), como a tela faz.
  const convite = await rpc(ctx.dono, 'invite_user', {
    p_email: emailDe('gestor', etiqueta),
    p_display_name: 'Gestor de teste',
    p_role: 'traffic_manager',
  });
  exigir(ok(convite), 'dono convida o gestor (api.invite_user)', convite);
  ctx.gestor = await entrar('gestor', await criarPorConvite(emailDe('gestor', etiqueta)));
  const pg = await meuPerfil(ctx.gestor);
  exigir(
    pg.perfil?.role === 'traffic_manager' && pg.perfil?.is_active === true,
    'perfil do gestor nasceu do convite',
    pg.r,
  );

  // Convite revogado antes do login (RLS-32).
  const outro = await rpc(ctx.dono, 'invite_user', {
    p_email: emailDe('revogado', etiqueta),
    p_display_name: 'Convite revogado',
    p_role: 'traffic_manager',
  });
  const conviteId = idDe(outro.json, ['id', 'invitation_id']);
  exigir(ok(outro) && conviteId, 'dono convida (api.invite_user devolve o id do convite)', outro);
  const revogar = await rpc(ctx.dono, 'revoke_invitation', { p_invitation_id: conviteId });
  exigir(ok(revogar), 'dono revoga o convite (api.revoke_invitation)', revogar);
  const revogado = await entrar('revogado', await criarPorConvite(emailDe('revogado', etiqueta)));
  ctx.respostas.revogado = (await meuPerfil(revogado)).r;

  // Logado sem perfil: login criado sem convite (RLS-21 e RLS-32).
  ctx.semPerfil = await entrar('sem perfil', await criarSemConvite(emailDe('semconvite', etiqueta)));
  ctx.respostas.semConvite = (await meuPerfil(ctx.semPerfil)).r;

  // A campanha inventada passa para o Claude: o "Parar tudo" do RLS-35 tem o que parar.
  const operador = await rpc(ctx.dono, 'change_campaign_operator', {
    p_campaign_id: dados.campaign_id,
    p_to_operator: 'claude',
    p_reason: 'handover_to_claude',
    p_note: null,
    p_expected_updated_at: comoNaTela(dados.campaign_updated_at),
  });
  exigir(ok(operador), 'dono passa a campanha para o Claude (api.change_campaign_operator)', operador);

  // O gestor propõe (operate_traffic): as ações que os casos usam.
  const propor = async (args, etapa) => {
    const r = await rpc(ctx.gestor, 'propose_action', args);
    const id = idDe(r.json);
    exigir(ok(r) && id, etapa, r);
    return id;
  };
  ctx.acoes = {
    a: await propor(proposta(dados, 'Teste de RLS: pausa A'), 'gestor propõe a pausa A'),
    b: await propor(criativo(dados, 'Teste de RLS: criativo B'), 'gestor propõe o criativo B'),
    c: await propor(criativo(dados, 'Teste de RLS: criativo C'), 'gestor propõe o criativo C'),
    d: await propor(proposta(dados, 'Teste de RLS: pausa D'), 'gestor propõe a pausa D'),
    p1: await propor(pendencia(dados, 'Teste de RLS: pendência 1'), 'gestor registra a pendência 1'),
    p2: await propor(pendencia(dados, 'Teste de RLS: pendência 2'), 'gestor registra a pendência 2'),
  };
}

// No fim, mesmo se um caso falhou: encerra as sessões e apaga os logins. O perfil segura o login (on delete
// restrict), então quem tem perfil fica bloqueado e sem senha conhecida, e o passo de limpeza do CI apaga depois de
// recriar os esquemas (node scripts/testar-rls.mjs --limpar).
async function limparDoExecutar() {
  for (const s of sessoes) {
    await pedir('POST', '/auth/v1/logout?scope=global', { token: s.token, cabecalhos: AUTH });
  }
  let presos = 0;
  for (const id of criados) {
    const r = await admin('DELETE', `users/${id}`);
    if (ok(r) || r.status === 404) continue;
    await admin('PUT', `users/${id}`, { ban_duration: '876000h', password: gerarSenha() });
    presos += 1;
  }
  return presos;
}

// Só os logins com o formato de e-mail do teste; ninguém mais é tocado.
async function usuariosDeTeste() {
  const encontrados = [];
  for (let pagina = 1; pagina <= 50; pagina += 1) {
    const r = await admin('GET', `users?page=${pagina}&per_page=200`);
    if (!ok(r)) throw new Falha('listar os usuários do Auth', r);
    const usuarios = Array.isArray(r.json?.users) ? r.json.users : [];
    for (const u of usuarios) {
      const email = String(u.email ?? '').toLowerCase();
      if (EMAIL_DE_TESTE.test(email) && ehUuid(u.id)) encontrados.push({ id: u.id, email });
    }
    if (usuarios.length < 200) break;
  }
  return encontrados;
}

// --limpar: apaga os logins de teste que sobraram (os esquemas já recriados, nenhum perfil segura).
async function limparSobras() {
  let apagados = 0;
  let presos = 0;
  for (const { id } of await usuariosDeTeste()) {
    const r = await admin('DELETE', `users/${id}`);
    if (ok(r) || r.status === 404) apagados += 1;
    else presos += 1;
  }
  console.log(
    `limpeza: ${apagados} usuário(s) de teste apagado(s)${presos ? `, ${presos} não apagado(s)` : ''}`,
  );
  return presos ? 1 : 0;
}

// ---------- Casos pela API ----------

// Quem perdeu o acesso (RLS-20) ou nunca teve perfil (RLS-21): views vazias, funções PT403; my_profile é a exceção.
async function semAcesso(sessao, { inativo }) {
  for (const v of VIEWS_DE_API) {
    const r = await ler(sessao, v, 'select=*&limit=5');
    exigir(
      ok(r) && Array.isArray(r.json) && r.json.length === 0,
      `${sessao.nome} lê api.${v}: zero linhas`,
      r,
    );
  }
  for (const [funcao, args] of Object.entries(FUNCOES)) {
    if (funcao === 'my_profile') continue;
    const r = await rpc(sessao, funcao, args);
    const vaziaPermitida = LEITURAS_QUE_PODEM_VIR_VAZIAS.has(funcao) && ok(r) && vazio(r.json);
    exigir(pt(r, 403) || vaziaPermitida, `${sessao.nome} chama api.${funcao}: PT403`, r);
  }
  const { r, perfil } = await meuPerfil(sessao);
  if (inativo) {
    exigir(
      perfil?.id === sessao.id && perfil?.is_active === false,
      'my_profile devolve o próprio perfil inativo',
      r,
    );
  } else {
    exigir((ok(r) && vazio(r.json)) || pt(r, 403) || pt(r, 404), 'my_profile sem perfil: vazio', r);
  }
}

async function negarTudo(tarefas) {
  const achados = (await emLotes(tarefas)).filter(Boolean);
  if (achados.length) throw new Falha(achados[0].etapa, achados[0].r);
}

const RODAR = {
  async 'RLS-01'() {
    for (const v of VIEWS_DE_API) {
      const r = await ler(sessaoAnon, v, 'select=*&limit=1');
      exigir(semPermissao(r), `anon lê api.${v}`, r);
    }
    for (const funcao of ['list_users', 'my_profile', 'credential_status']) {
      const r = await rpc(sessaoAnon, funcao, FUNCOES[funcao]);
      exigir(semPermissao(r), `anon chama api.${funcao}`, r);
    }
  },

  async 'RLS-02'() {
    for (const [funcao, args] of Object.entries(FUNCOES)) {
      const r = await rpc(sessaoAnon, funcao, args);
      exigir(semPermissao(r), `anon chama api.${funcao}`, r);
    }
  },

  async 'RLS-03'() {
    let r = await ler(sessaoAnon, 'crm_leads', 'select=*&limit=1', 'mkt');
    exigir(naoExposto(r), 'anon lê mkt.crm_leads', r);
    r = await ler(sessaoAnon, 'crm_leads', 'select=*&limit=1');
    exigir(naoExiste(r), 'anon lê crm_leads pelo esquema padrão', r);
    for (const esquema of ESQUEMAS_FECHADOS) {
      r = await ler(sessaoAnon, 'qualquer', '', esquema);
      exigir(naoExposto(r), `esquema ${esquema} fora da API`, r);
    }
    r = await pedir('POST', '/graphql/v1', { corpo: { query: '{ __typename }' } });
    exigir(!ok(r), 'GraphQL desligado', r);
  },

  async 'RLS-04'(ctx) {
    const tarefas = [];
    for (const sessao of [sessaoAnon, ctx.gestor, ctx.dono]) {
      for (const tabela of TABELAS_MKT) {
        for (const metodo of ['POST', 'PATCH', 'DELETE']) {
          tarefas.push(async () => {
            const r = await escrever(sessao, metodo, tabela, 'mkt');
            return naoExposto(r) ? null : { etapa: `${sessao.nome}: ${metodo} em mkt.${tabela}`, r };
          });
        }
      }
    }
    for (const tabela of TABELAS_MKT) {
      tarefas.push(async () => {
        const r = await escrever(sessaoAnon, 'POST', tabela);
        return naoExiste(r) || semPermissao(r)
          ? null
          : { etapa: `anon: POST em ${tabela} pelo esquema padrão`, r };
      });
    }
    await negarTudo(tarefas);
  },

  async 'RLS-05'(ctx) {
    const acoes = await ler(ctx.gestor, 'v_traffic_actions', `select=*&id=eq.${ctx.acoes.d}`);
    exigir(
      ok(acoes) && Array.isArray(acoes.json) && acoes.json.length === 1,
      'gestor lê a própria proposta',
      acoes,
    );
    const diario = await ler(ctx.gestor, 'v_traffic_log', 'select=*&limit=5');
    exigir(
      ok(diario) && Array.isArray(diario.json) && diario.json.length > 0,
      'gestor lê api.v_traffic_log',
      diario,
    );
    const cred = await rpc(ctx.gestor, 'credential_status');
    exigir(ok(cred), 'gestor chama api.credential_status', cred);
    exigir(
      !JSON.stringify(cred.json).includes('segredo inventado'),
      'credential_status devolve só o estado',
      cred,
    );
  },

  async 'RLS-06'(ctx) {
    const antes = await lerAcao(ctx.dono, ctx.acoes.d);
    const lido = comoNaTela(antes.updated_at);
    let r = await rpc(ctx.gestor, 'approve_action', { p_action_id: antes.id, p_expected_updated_at: lido });
    exigir(pt(r, 403), 'gestor aprova', r);
    r = await rpc(ctx.gestor, 'discard_action', {
      p_action_id: antes.id,
      p_reason: 'other',
      p_note: 'Descarte tentado pelo gestor.',
      p_expected_updated_at: lido,
    });
    exigir(pt(r, 403), 'gestor descarta', r);
    r = await rpc(ctx.gestor, 'retry_execution', { p_execution_id: ZERO, p_expected_updated_at: ANTIGO });
    exigir(pt(r, 403), 'gestor pede a execução de novo', r);
    r = await rpc(
      ctx.gestor,
      'propose_action',
      proposta(ctx.dados, 'Teste de RLS: aprovar agora', { p_approve_now: true }),
    );
    exigir(pt(r, 403), 'gestor propõe com approve_now', r);
    const depois = await lerAcao(ctx.dono, ctx.acoes.d);
    exigir(depois.status === 'idea' && depois.updated_at === antes.updated_at, 'a ação continua como estava');
    exigir(
      (await acoesComTitulo(ctx.dono, 'Teste de RLS: aprovar agora')) === 0,
      'nada gravado pelo approve_now',
    );
  },

  async 'RLS-07'(ctx) {
    const { dados } = ctx;
    let r = await rpc(ctx.gestor, 'stop_all', { p_brand: 'cs', p_expected_count: 1 });
    exigir(pt(r, 403), 'gestor para tudo', r);
    r = await rpc(ctx.gestor, 'undo_stop', { p_stop_id: ZERO, p_expected_updated_at: ANTIGO });
    exigir(pt(r, 403), 'gestor desfaz a parada', r);
    r = await rpc(ctx.gestor, 'set_spend_limit', {
      p_ad_account_id: dados.ad_account_id,
      p_monthly_limit_cents: 100000,
      p_expected_updated_at: null,
    });
    exigir(pt(r, 403), 'gestor muda o limite', r);
    r = await rpc(ctx.gestor, 'change_campaign_operator', {
      p_campaign_id: dados.campaign_id,
      p_to_operator: 'human',
      p_reason: 'back_to_human',
      p_note: null,
      p_expected_updated_at: ANTIGO,
    });
    exigir(pt(r, 403), 'gestor troca o operador', r);
  },

  async 'RLS-08'(ctx) {
    let r = await rpc(ctx.gestor, 'invite_user', {
      p_email: emailDe('intruso', ctx.etiqueta),
      p_display_name: 'Convite do gestor',
      p_role: 'owner',
    });
    exigir(pt(r, 403), 'gestor convida', r);
    for (const [alvo, papel] of [
      [ctx.gestor.id, 'owner'],
      [ctx.dono.id, 'traffic_manager'],
    ]) {
      r = await rpc(ctx.gestor, 'change_role', {
        p_profile_id: alvo,
        p_role: papel,
        p_expected_updated_at: ANTIGO,
      });
      exigir(
        pt(r, 403),
        alvo === ctx.gestor.id ? 'gestor muda o próprio papel' : 'gestor muda o papel do dono',
        r,
      );
    }
    r = await rpc(ctx.gestor, 'revoke_access', {
      p_profile_id: ctx.dono.id,
      p_reason: 'security',
      p_note: null,
      p_expected_updated_at: ANTIGO,
    });
    exigir(pt(r, 403), 'gestor tira o acesso do dono', r);
    r = await rpc(ctx.gestor, 'list_users');
    exigir(pt(r, 403), 'gestor lista os usuários', r);
    const dono = await meuPerfil(ctx.dono);
    exigir(dono.perfil?.role === 'owner' && dono.perfil?.is_active === true, 'o dono continua dono', dono.r);
    const gestor = await meuPerfil(ctx.gestor);
    exigir(gestor.perfil?.role === 'traffic_manager', 'o gestor continua gestor', gestor.r);
  },

  async 'RLS-09'(ctx) {
    const r = await rpc(ctx.gestor, 'list_users');
    exigir(pt(r, 403), 'gestor lista os usuários', r);
  },

  async 'RLS-10'(ctx) {
    let r = await rpc(ctx.gestor, 'retry_connector', { p_connector_code: 'meta' });
    exigir(pt(r, 403), 'gestor tenta o conector de novo', r);
    r = await rpc(ctx.gestor, 'set_connector_state', {
      p_connector_code: 'meta',
      p_state: 'disabled',
      p_expected_updated_at: null,
    });
    exigir(pt(r, 403), 'gestor desliga o conector', r);
    r = await rpc(ctx.gestor, 'confirm_mass_delete', { p_run_id: ctx.dados.rodada_id ?? ZERO });
    exigir(pt(r, 403), 'gestor confirma exclusão em massa', r);
  },

  async 'RLS-11'(ctx) {
    const casos = [
      // Inventados: domínio .invalid e um número de exemplo.
      ['Teste de RLS: com e-mail', 'Falar com fulano.de.tal@exemplo.invalid sobre a campanha.'],
      ['Teste de RLS: com telefone', 'Ligar para (11) 98765-4321 antes de pausar a campanha.'],
      // Espaço depois do 9 e o 0 antes do DDD (revisão de 10/11/2026, achado 5).
      [
        'Teste de RLS: com telefone separado',
        'Ligar para (11) 9 8765-4321 ou 011 98765.4321 antes de pausar.',
      ],
    ];
    for (const [titulo, porque] of casos) {
      const r = await rpc(ctx.gestor, 'propose_action', proposta(ctx.dados, titulo, { p_rationale: porque }));
      exigir(recusadoPeloCheck(r), `proposta ${titulo.slice(14)} recusada`, r);
      exigir((await acoesComTitulo(ctx.gestor, titulo)) === 0, `nada gravado ${titulo.slice(14)}`);
    }
  },

  async 'RLS-12'(ctx) {
    const ideia = await lerAcao(ctx.gestor, ctx.acoes.d);
    let r = await rpc(ctx.gestor, 'mark_action_done', {
      p_action_id: ideia.id,
      p_result: 'Feita fora da central.',
      p_expected_updated_at: comoNaTela(ideia.updated_at),
    });
    exigir(pt(r, 422), 'gestor marca como feita uma ideia', r);
    exigir((await lerAcao(ctx.gestor, ideia.id)).status === 'idea', 'a ideia continua ideia');
    const p2 = await lerAcao(ctx.gestor, ctx.acoes.p2);
    r = await rpc(ctx.gestor, 'mark_action_done', {
      p_action_id: p2.id,
      p_result: 'Pendência resolvida no teste.',
      p_expected_updated_at: comoNaTela(p2.updated_at),
    });
    exigir(ok(r), 'controle: gestor marca a pendência como feita', r);
    exigir((await lerAcao(ctx.gestor, p2.id)).status === 'done', 'a pendência ficou feita');
  },

  async 'RLS-13'(ctx) {
    // A marca não é chave da barra (mkt.valid_saved_filters): o canal é.
    const salvar = () =>
      rpc(ctx.dono, 'save_filter', {
        p_scope: 'bar',
        p_name: 'Filtro do dono',
        p_filters: { platform: 'meta' },
      });
    const primeiro = await salvar();
    const filtro = idDe(primeiro.json);
    exigir(ok(primeiro) && filtro, 'dono salva um filtro (save_filter devolve o id)', primeiro);
    const pref = await rpc(ctx.dono, 'save_notification_preference', {
      p_notice: 'weekly_report',
      p_email: false,
      p_whatsapp: false,
    });
    exigir(ok(pref), 'dono muda uma preferência de aviso', pref);
    // O gestor tenta apagar o filtro do dono: recusado ou sem efeito; salvar de novo devolve o mesmo id.
    await rpc(ctx.gestor, 'delete_saved_filter', { p_id: filtro });
    const segundo = await salvar();
    exigir(ok(segundo) && idDe(segundo.json) === filtro, 'o filtro do dono continua lá', segundo);
    const prefs = await rpc(ctx.gestor, 'my_notification_preferences');
    exigir(ok(prefs), 'gestor lê as próprias preferências', prefs);
    exigir(
      !JSON.stringify(prefs.json).includes(ctx.dono.id),
      'as preferências do gestor não trazem o dono',
      prefs,
    );
    const linhas = Array.isArray(prefs.json) ? prefs.json : [];
    const semanal = linhas.find((l) => l?.notice === 'weekly_report');
    const email =
      semanal && Object.entries(semanal).find(([k, v]) => /email/.test(k) && typeof v === 'boolean');
    exigir(!email || email[1] === true, 'o gestor vê o padrão dele, não a escolha do dono', prefs);
  },

  async 'RLS-14'(ctx) {
    const { r, perfil } = await meuPerfil(ctx.dono);
    exigir(perfil && !Number.isNaN(Date.parse(perfil.updated_at)), 'my_profile do dono com updated_at', r);
    const lido = comoNaTela(perfil.updated_at);
    let t = await rpc(ctx.dono, 'change_role', {
      p_profile_id: ctx.dono.id,
      p_role: 'traffic_manager',
      p_expected_updated_at: lido,
    });
    exigir(pt(t, 422), 'dono muda o próprio papel (o último dono)', t);
    t = await rpc(ctx.dono, 'revoke_access', {
      p_profile_id: ctx.dono.id,
      p_reason: 'security',
      p_note: null,
      p_expected_updated_at: lido,
    });
    exigir(pt(t, 422), 'dono tira o próprio acesso (o último dono)', t);
    const depois = await meuPerfil(ctx.dono);
    exigir(
      depois.perfil?.role === 'owner' && depois.perfil?.is_active === true,
      'o dono continua dono e ativo',
      depois.r,
    );
  },

  async 'RLS-15'(ctx) {
    const antes = await lerAcao(ctx.dono, ctx.acoes.a);
    const velho = comoNaTela(Date.parse(antes.updated_at) - 1000);
    let r = await rpc(ctx.dono, 'approve_action', { p_action_id: antes.id, p_expected_updated_at: velho });
    exigir(pt(r, 409), 'dono aprova com updated_at antigo', r);
    const meio = await lerAcao(ctx.dono, antes.id);
    exigir(
      meio.status === 'idea' && meio.updated_at === antes.updated_at,
      'nada gravado com o updated_at antigo',
    );
    r = await rpc(ctx.dono, 'approve_action', {
      p_action_id: antes.id,
      p_expected_updated_at: comoNaTela(antes.updated_at),
    });
    exigir(ok(r), 'controle: dono aprova com o updated_at lido', r);
    exigir((await lerAcao(ctx.dono, antes.id)).status === 'approved', 'a ação ficou aprovada');
  },

  async 'RLS-16'(ctx) {
    const p1 = await lerAcao(ctx.dono, ctx.acoes.p1);
    let r = await rpc(ctx.dono, 'approve_action', {
      p_action_id: p1.id,
      p_expected_updated_at: comoNaTela(p1.updated_at),
    });
    exigir(pt(r, 422), 'dono aprova uma pendência de medição', r);
    const b = await lerAcao(ctx.dono, ctx.acoes.b);
    const descarte = (motivo) =>
      rpc(ctx.dono, 'discard_action', {
        p_action_id: b.id,
        p_reason: motivo,
        p_note: 'Descartada pelo teste de RLS.',
        p_expected_updated_at: comoNaTela(b.updated_at),
      });
    r = await descarte(null);
    exigir(recusadoPeloCheck(r), 'dono descarta sem motivo', r);
    exigir((await lerAcao(ctx.dono, b.id)).status === 'idea', 'nada gravado sem motivo');
    r = await descarte('other');
    exigir(ok(r), 'controle: dono descarta com motivo', r);
    exigir((await lerAcao(ctx.dono, b.id)).status === 'discarded', 'a ação ficou descartada');
  },

  async 'RLS-17'(ctx) {
    const tarefas = [];
    for (const metodo of ['PATCH', 'DELETE']) {
      tarefas.push(async () => {
        const r = await escrever(ctx.dono, metodo, 'v_traffic_log');
        return escritaNegada(r) ? null : { etapa: `dono: ${metodo} em api.v_traffic_log`, r };
      });
    }
    for (const tabela of ['traffic_log', 'audit_log', 'campaign_managed_by_history']) {
      for (const metodo of ['POST', 'PATCH', 'DELETE']) {
        tarefas.push(async () => {
          const r = await escrever(ctx.dono, metodo, tabela, 'mkt');
          return naoExposto(r) ? null : { etapa: `dono: ${metodo} em mkt.${tabela}`, r };
        });
      }
    }
    await negarTudo(tarefas);
  },

  async 'RLS-18'(ctx) {
    for (const sessao of [sessaoAnon, ctx.dono]) {
      let r = await ler(sessao, 'connector_credentials', 'select=*', 'private');
      exigir(naoExposto(r), `${sessao.nome} lê private.connector_credentials`, r);
      r = await ler(sessao, 'connector_credentials', 'select=*');
      exigir(naoExiste(r), `${sessao.nome} lê connector_credentials pelo esquema padrão`, r);
      r = await rpc(sessao, 'read_credential', { p_id: ZERO }, 'private');
      exigir(naoExposto(r), `${sessao.nome} chama private.read_credential`, r);
      r = await rpc(sessao, 'read_credential', { p_id: ZERO });
      exigir(naoExiste(r), `${sessao.nome} chama read_credential pelo esquema padrão`, r);
      r = await ler(sessao, 'decrypted_secrets', 'select=*', 'vault');
      exigir(naoExposto(r), `${sessao.nome} lê vault.decrypted_secrets`, r);
    }
  },

  async 'RLS-19'(ctx) {
    let r = await ler(ctx.dono, 'notification_outbox', 'select=*', 'mkt');
    exigir(naoExposto(r), 'dono lê mkt.notification_outbox', r);
    r = await ler(ctx.dono, 'notification_outbox', 'select=*');
    exigir(naoExiste(r), 'dono lê notification_outbox pelo esquema padrão', r);
  },

  async 'RLS-20'(ctx) {
    const { r, perfil } = await meuPerfil(ctx.gestor);
    exigir(perfil && !Number.isNaN(Date.parse(perfil.updated_at)), 'my_profile do gestor com updated_at', r);
    const tirar = await rpc(ctx.dono, 'revoke_access', {
      p_profile_id: ctx.gestor.id,
      p_reason: 'security',
      p_note: null,
      p_expected_updated_at: comoNaTela(perfil.updated_at),
    });
    exigir(ok(tirar), 'dono tira o acesso do gestor', tirar);
    await semAcesso(ctx.gestor, { inativo: true });
  },

  async 'RLS-21'(ctx) {
    await semAcesso(ctx.semPerfil, { inativo: false });
  },

  async 'RLS-26'(ctx) {
    const r = await rpc(ctx.gestor, 'upload_csv', {
      p_connector_code: 'meta',
      p_brand: 'cs',
      p_file_name: 'relatorio-teste.csv',
      p_content: 'Campaign ID,Amount spent\nrls,10\n',
    });
    exigir(pt(r, 403), 'gestor envia CSV', r);
  },

  async 'RLS-28'(ctx) {
    for (const sessao of [ctx.gestor, ctx.dono]) {
      for (const funcao of ['read_credential', 'rotate_credential', 'queue_execution']) {
        let r = await rpc(sessao, funcao, { p_id: ZERO }, 'private');
        exigir(naoExposto(r), `${sessao.nome} chama private.${funcao}`, r);
        r = await rpc(sessao, funcao, { p_id: ZERO });
        exigir(naoExiste(r), `${sessao.nome} chama ${funcao} pelo esquema padrão`, r);
      }
      const r = await ler(sessao, 'decrypted_secrets', 'select=*', 'vault');
      exigir(naoExposto(r), `${sessao.nome} lê vault.decrypted_secrets`, r);
    }
  },

  async 'RLS-29'(ctx) {
    const tarefas = [];
    for (const sessao of [sessaoAnon, ctx.gestor, ctx.dono, ctx.semPerfil]) {
      for (const view of VIEWS_DE_API) {
        for (const metodo of ['POST', 'PATCH', 'DELETE']) {
          tarefas.push(async () => {
            const r = await escrever(sessao, metodo, view);
            return escritaNegada(r) ? null : { etapa: `${sessao.nome}: ${metodo} em api.${view}`, r };
          });
        }
      }
    }
    await negarTudo(tarefas);
  },

  async 'RLS-32'(ctx) {
    for (const [nome, r] of [
      ['sem convite', ctx.respostas.semConvite],
      ['convite vencido', ctx.respostas.vencido],
      ['convite revogado', ctx.respostas.revogado],
    ]) {
      exigir((ok(r) && vazio(r.json)) || pt(r, 403) || pt(r, 404), `login com ${nome}: sem perfil`, r);
    }
    const email = emailDe('cadastro', ctx.etiqueta);
    const r = await pedir('POST', '/auth/v1/signup', {
      corpo: { email, password: gerarSenha() },
      cabecalhos: AUTH,
    });
    const criou = (await usuariosDeTesteComEmail(email)).length > 0;
    exigir(
      r.status === 422 && r.codigo === 'signup_disabled',
      'signUp recusado (cadastro aberto desligado)',
      r,
    );
    exigir(!criou, 'signUp não criou login', r);
  },

  async 'RLS-35'(ctx) {
    const c = await lerAcao(ctx.dono, ctx.acoes.c);
    let r = await rpc(ctx.donoAal1, 'approve_action', {
      p_action_id: c.id,
      p_expected_updated_at: comoNaTela(c.updated_at),
    });
    exigir(pt(r, 403), 'dono sem segundo fator aprova', r);
    r = await rpc(ctx.donoAal1, 'set_spend_limit', {
      p_ad_account_id: ctx.dados.ad_account_id,
      p_monthly_limit_cents: 100000,
      p_expected_updated_at: null,
    });
    exigir(pt(r, 403), 'dono sem segundo fator muda o limite', r);
    r = await rpc(ctx.donoAal1, 'invite_user', {
      p_email: emailDe('semfator', ctx.etiqueta),
      p_display_name: 'Convite sem segundo fator',
      p_role: 'traffic_manager',
    });
    exigir(pt(r, 403), 'dono sem segundo fator convida', r);
    r = await rpc(ctx.donoAal1, 'retry_connector', { p_connector_code: 'meta' });
    exigir(pt(r, 403), 'dono sem segundo fator tenta o conector', r);
    exigir((await lerAcao(ctx.dono, c.id)).status === 'idea', 'a ação continua ideia');
    r = await rpc(ctx.donoAal1, 'stop_all', { p_brand: 'cs', p_expected_count: 1 });
    exigir(ok(r), 'controle: dono sem segundo fator para tudo', r);
  },
};

// O signUp que não devia passar: acha o login e põe na lista de apagar, para a limpeza não depender do caso.
async function usuariosDeTesteComEmail(email) {
  const ids = (await usuariosDeTeste()).filter((u) => u.email === email).map((u) => u.id);
  for (const id of ids) criados.add(id);
  return ids;
}

// ---------- Lista, execução e saída ----------

function listar() {
  const largura = Math.max(...Object.values(ONDE).map((t) => t.length));
  console.log('Teste de RLS, camada 2 (docs/dados/papeis-e-rls.md). Sem --executar, só a lista.\n');
  for (const [codigo, partes] of CASOS) {
    partes.forEach((parte, i) => {
      const rotulo = ONDE[parte.onde] + (parte.onde === 'api' && SEM_LOGIN.has(codigo) ? ', sem login' : '');
      console.log(
        `${i === 0 ? codigo : ' '.repeat(codigo.length)}  ${rotulo.padEnd(largura + 2)}${parte.texto}`,
      );
    });
  }
  const contar = (onde) => CASOS.filter(([, partes]) => partes.some((p) => p.onde === onde)).length;
  console.log(
    `\nNo portão: ${contar('api')} casos pela API (este script) e ${contar('servico')} na conexão de cada serviço ` +
      `(scripts/testar-rls-servicos.sql); ${contar('camada1')} com parte só na camada 1 e ${contar('fase4')} com ` +
      'parte na fase 4.',
  );
  console.log(
    'Rodar: --executar no job do projeto de teste (.github/workflows/ci.yml); --executar --sem-login depois da produção.',
  );
}

function descrever(erro) {
  if (erro instanceof Falha) {
    const codigos = [erro.status ? `HTTP ${erro.status}` : null, erro.codigo].filter(Boolean).join(' ');
    return codigos ? `${erro.etapa} · ${codigos}` : erro.etapa;
  }
  return `erro inesperado (${erro?.name ?? 'Error'})`;
}

async function rodarCasos(ctx, codigos, opcoes, placar) {
  for (const codigo of codigos) {
    let erro = null;
    if (opcoes.preparo) erro = opcoes.preparo;
    else {
      try {
        await RODAR[codigo](ctx);
      } catch (e) {
        erro = e;
      }
    }
    if (erro) placar.falharam += 1;
    else placar.passaram += 1;
    const motivo =
      erro && opcoes.motivo ? ` · ${opcoes.preparo ? 'preparação: ' : ''}${descrever(erro)}` : '';
    console.log(`${codigo} ${erro ? 'falhou' : 'passou'}${motivo}`);
  }
}

async function executar({ semLogin, motivo }) {
  const placar = { passaram: 0, falharam: 0 };
  if (semLogin) {
    let preparo = null;
    try {
      await esperarApi();
    } catch (e) {
      preparo = e;
    }
    await rodarCasos({}, [...SEM_LOGIN], { motivo, preparo }, placar);
  } else {
    const ctx = { etiqueta: lerEtiqueta(), dados: lerDados(), respostas: {} };
    try {
      let preparo = null;
      try {
        await esperarApi();
      } catch (e) {
        preparo = e;
      }
      // Sem login primeiro: não depende dos usuários de teste.
      await rodarCasos(ctx, [...SEM_LOGIN], { motivo, preparo }, placar);
      if (!preparo) {
        try {
          await preparar(ctx);
        } catch (e) {
          preparo = e;
        }
      }
      const resto = ORDEM.filter((c) => !SEM_LOGIN.has(c) && RODAR[c]);
      await rodarCasos(ctx, resto, { motivo, preparo }, placar);
    } finally {
      const presos = await limparDoExecutar();
      console.log(
        presos
          ? `limpeza: ${presos} login(s) de teste bloqueado(s); o passo de limpeza do CI apaga depois de recriar os esquemas`
          : 'limpeza: logins de teste apagados',
      );
    }
  }
  console.log(`${placar.passaram} passaram, ${placar.falharam} falharam`);
  return placar.falharam ? 1 : 0;
}

function lerOpcoes() {
  try {
    return parseArgs({
      options: {
        executar: { type: 'boolean', default: false },
        'sem-login': { type: 'boolean', default: false },
        limpar: { type: 'boolean', default: false },
        motivo: { type: 'boolean', default: false },
      },
      strict: true,
    }).values;
  } catch {
    throw new Recusa(
      'Opção desconhecida. Use --executar, --sem-login, --limpar ou --motivo (ou nada, para listar).',
    );
  }
}

async function main() {
  const values = lerOpcoes();
  const semLogin = values['sem-login'];
  if (values.limpar) {
    projeto = lerAmbiente({ semLogin: false, limpar: true });
    return limparSobras();
  }
  if (!values.executar) {
    listar();
    return 0;
  }
  projeto = lerAmbiente({ semLogin, limpar: false });
  return executar({ semLogin, motivo: values.motivo });
}

main().then(
  (codigo) => {
    process.exitCode = codigo;
  },
  (erro) => {
    if (erro instanceof Recusa) console.error(erro.message);
    else console.error(`Teste de RLS parou: ${descrever(erro)}.`);
    process.exitCode = 2;
  },
);

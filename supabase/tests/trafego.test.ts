// Migração 07: os parâmetros de cada tipo de ação e o contexto do Claude (mkt.valid_action_params e
// mkt.valid_claude_context), as restrições das tabelas do tráfego, o código ACT-, o quadro de passagens de status
// da ação, conferindo quem pede pelo session_user e pela permissão, e o diário da ação (docs/dados/tabelas.md,
// seção 4, e papeis-e-rls.md, "Gatilhos que conferem quem pede"). As funções de ação (migração 09) e de ingest
// (migração 10) ainda não existem: test.rodar faz o papel delas, uma função security definer do dono que mantém o
// session_user e o token de quem chamou. Dados inventados de fixtures/usuarios.sql, marketing.sql e trafego.sql.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Quem,
  type Sessao,
  abrirBanco,
  aplicarFixture,
  caso,
  postgres,
  servico,
  usuario,
} from './apoio/banco';
import {
  ACAO_QUE_CRIOU,
  CAMPANHA_CLAUDE_CS,
  CAMPANHA_HUMANO_CS,
  CAMPANHA_HUMANO_PL,
  CLIENTE_A,
  CONTA_GOOGLE_PL,
  CONTA_META_CS,
} from './apoio/marketing';
import {
  ACAO_APROVADA,
  ACAO_DESCARTADA,
  FUNCAO_DE_TESTE,
  IDEIA_DO_CLAUDE,
  PENDENCIA,
  RODADA_DO_CLAUDE,
  pelaFuncao,
} from './apoio/trafego';
import { DONO, EX_GESTOR, GESTOR, SEGUNDO_DONO, SEM_PERFIL } from './apoio/usuarios';

let db: PGlite;

beforeAll(async () => {
  db = await abrirBanco();
  await aplicarFixture(db, 'usuarios');
  await aplicarFixture(db, 'marketing');
  await aplicarFixture(db, 'trafego');
  await db.exec(FUNCAO_DE_TESTE);
});

afterAll(async () => {
  await db.close();
});

const DONO_2F = usuario(DONO, 'aal2');
const GESTOR_LOGADO = usuario(GESTOR, 'aal1');
const EXECUTOR = servico('mkt_executor');
const WORKER = servico('mkt_worker');
const TOKEN_DO_DONO = { sub: DONO, role: 'authenticated', aal: 'aal2' };

/** Ids das ações que os casos criam (cada caso desfaz as suas). */
const NOVA = '00000000-0000-4000-8000-000000000391';
const OUTRA = '00000000-0000-4000-8000-000000000392';
const EXECUCAO = '00000000-0000-4000-8000-000000000395';

// ---------- Como as funções de ação e de ingest gravam ----------

interface Acao {
  id?: string;
  marca?: 'cs' | 'plumene';
  plataforma?: string | null;
  conta?: string | null;
  campanha?: string | null;
  tipo?: string;
  params?: unknown;
  status?: string;
  titulo?: string;
  motivo?: string;
  custo?: number | null;
  /** A proposta do Claude (worker): a posição na resposta da rodada. Sem ela, a proposta é da pessoa. */
  claude?: number;
  /** A rodada da proposta (nulo = sem rodada); por padrão, a do Claude tem a da fixture e a da pessoa, nenhuma. */
  rodada?: string | null;
  /** Quem propõe (a pessoa): o padrão é quem chama (auth.uid()). */
  propostoPor?: string;
  /** Já aprovada (approve_now): 'auth' é quem chama. */
  aprovadoPor?: string;
}

const texto = (v: string | null | undefined): string => (v == null ? 'null' : `'${v}'`);
const pessoa = (v: string): string => (v === 'auth' ? 'auth.uid()' : `'${v}'`);

/** O insert de uma ação; sem nada, a pausa da campanha do humano na conta Meta da cs, proposta por quem chama. */
function proposta(a: Acao = {}): string {
  const claude = a.claude !== undefined;
  const colunas: Record<string, string> = {
    id: texto(a.id ?? NOVA),
    brand_id: `(select id from mkt.brands where code = '${a.marca ?? 'cs'}')`,
    platform: texto(a.plataforma === undefined ? 'meta' : a.plataforma),
    ad_account_id: texto(a.conta === undefined ? CONTA_META_CS : a.conta),
    campaign_id: texto(a.campanha === undefined ? CAMPANHA_HUMANO_CS : a.campanha),
    kind: texto(a.tipo ?? 'pause'),
    title: texto(a.titulo ?? 'Pausar a campanha de teste'),
    rationale: texto(a.motivo ?? 'O custo por lead passou da meta da semana.'),
    params: texto(JSON.stringify(a.params ?? { status: 'paused' })),
    impact: `'medium'`,
    effort: `'low'`,
    cost_cents: a.custo === undefined ? '0' : String(a.custo),
    status: texto(a.status ?? (a.aprovadoPor === undefined ? 'idea' : 'approved')),
    proposed_by_kind: texto(claude ? 'claude' : 'human'),
    proposed_by: claude ? 'null' : pessoa(a.propostoPor ?? 'auth'),
    claude_run_id: texto(a.rodada === undefined ? (claude ? RODADA_DO_CLAUDE : null) : a.rodada),
    claude_item: claude ? String(a.claude) : 'null',
    approved_by: a.aprovadoPor === undefined ? 'null' : pessoa(a.aprovadoPor),
    approved_at: a.aprovadoPor === undefined ? 'null' : 'now()',
  };
  return `insert into mkt.traffic_actions (${Object.keys(colunas).join(', ')})
          values (${Object.values(colunas).join(', ')})`;
}

const onde = (id: string) => `where id = '${id}'`;
const aprovar = (id: string, por = 'auth') =>
  `update mkt.traffic_actions set status = 'approved', approved_by = ${pessoa(por)}, approved_at = now() ${onde(id)}`;
const descartar = (
  id: string,
  por = 'auth',
  motivo = `'duplicate'`,
  nota = `'Já existe outra ação igual na fila.'`,
) =>
  `update mkt.traffic_actions
      set status = 'discarded', discarded_by = ${pessoa(por)}, discarded_at = now(), discard_reason = ${motivo},
          discard_note = ${nota} ${onde(id)}`;
const feitaAMao = (id: string, por = 'auth', resultado = `'Pausada no gerenciador da Meta.'`) =>
  `update mkt.traffic_actions
      set status = 'done', done_via = 'manual', done_by = ${pessoa(por)}, executed_at = now(), result = ${resultado}
    ${onde(id)}`;
const rodando = (id: string) => `update mkt.traffic_actions set status = 'running' ${onde(id)}`;
const falhou = (id: string) => `update mkt.traffic_actions set status = 'failed' ${onde(id)}`;
const feitaNaPlataforma = (id: string) =>
  `update mkt.traffic_actions set status = 'done', done_via = 'platform_api', executed_at = now() ${onde(id)}`;
const voltarParaIdeia = (id: string) => `update mkt.traffic_actions set status = 'idea' ${onde(id)}`;

/** Roda o comando pelo stand-in das funções, como `quem`. */
async function pela(s: Sessao, quem: Quem, sql: string): Promise<void> {
  await s.como(quem);
  await s.linhas(...pelaFuncao(sql));
}

/** Espera o erro do comando pelo stand-in, como `quem`; devolve a mensagem (TRF-403, TRF-422…). */
async function recusa(s: Sessao, codigo: string, quem: Quem, sql: string): Promise<string> {
  await s.como(quem);
  return (await s.erro(codigo, ...pelaFuncao(sql))).message;
}

type Estado = 'idea' | 'approved' | 'running' | 'failed' | 'done' | 'discarded';

/**
 * Uma ação no estado pedido, pelo caminho de verdade: o gestor propõe; o dono aprova ou descarta; o executor anda
 * (a execução feita pela plataforma). Volta como o dono do banco.
 */
async function acaoEm(s: Sessao, estado: Estado, a: Acao = {}): Promise<string> {
  const id = a.id ?? NOVA;
  await pela(s, GESTOR_LOGADO, proposta({ ...a, id }));
  if (estado === 'discarded') await pela(s, DONO_2F, descartar(id));
  if (['approved', 'running', 'failed', 'done'].includes(estado)) await pela(s, DONO_2F, aprovar(id));
  if (estado === 'running') await pela(s, EXECUTOR, rodando(id));
  if (estado === 'failed') await pela(s, EXECUTOR, falhou(id));
  if (estado === 'done') await pela(s, EXECUTOR, feitaNaPlataforma(id));
  await s.como(postgres);
  return id;
}

async function statusDe(s: Sessao, id: string): Promise<string> {
  await s.como(postgres);
  return s.valor<string>('select status::text from mkt.traffic_actions where id = $1', [id]);
}

interface Evento {
  event: string;
  actor_kind: string;
  actor_id: string | null;
  changes: unknown;
}

/** O diário de uma ação, na ordem de gravação (só os eventos da ação, sem os da execução). */
async function diario(s: Sessao, id: string): Promise<Evento[]> {
  await s.como(postgres);
  return s.linhas<Evento>(
    `select event::text, actor_kind::text, actor_id::text, changes from mkt.traffic_log
      where traffic_action_id = $1 and event <> 'execution_status_changed' order by seq`,
    [id],
  );
}

// ---------- Regras puras ----------

describe('mkt.valid_action_params: os campos de cada tipo, com os da plataforma', () => {
  const CRIAR_META = {
    objective: 'OUTCOME_LEADS',
    daily_budget_cents: 9000,
    name: 'cs-lojistas-sul',
    special_ad_categories: [],
  };
  const CRIAR_GOOGLE = {
    objective: 'LEADS',
    daily_budget_cents: 9000,
    name: 'plumene-busca-marca',
    advertising_channel_type: 'SEARCH',
    bidding_strategy: 'MAXIMIZE_CONVERSIONS',
  };
  const CRIAR_TIKTOK = {
    objective: 'LEAD_GENERATION',
    daily_budget_cents: 9000,
    name: 'cs-tiktok-leads',
    budget_mode: 'BUDGET_MODE_DAY',
  };
  const CASOS: Array<[string, string | null, unknown, boolean]> = [
    // Ajustar orçamento: o valor novo e, opcional, o anterior.
    ['budget', 'meta', { daily_budget_cents: 6000 }, true],
    ['budget', 'meta', { daily_budget_cents: 6000, previous_daily_budget_cents: 5000 }, true],
    [
      'budget',
      'google',
      { daily_budget_cents: 6000, previous_daily_budget_cents: null, origin: 'central' },
      true,
    ],
    ['budget', 'meta', { daily_budget_cents: 6000, previous_daily_budget_cents: 0 }, true],
    ['budget', 'meta', { daily_budget_cents: 0 }, false],
    ['budget', 'meta', { daily_budget_cents: -100 }, false],
    ['budget', 'meta', { daily_budget_cents: 60.5 }, false],
    ['budget', 'meta', { daily_budget_cents: '6000' }, false],
    ['budget', 'meta', { daily_budget_cents: null }, false],
    ['budget', 'meta', { daily_budget_cents: 1000000000001 }, false],
    ['budget', 'meta', {}, false],
    ['budget', 'meta', { daily_budget_cents: 6000, status: 'paused' }, false],
    ['budget', null, { daily_budget_cents: 6000 }, false],
    // Pausar: só o status pausado.
    ['pause', 'tiktok', { status: 'paused' }, true],
    ['pause', 'tiktok', { status: 'active' }, false],
    ['pause', 'tiktok', { status: 'paused', origin: 'tela' }, false],
    ['pause', 'tiktok', { status: 'paused', note: 'Pausa pedida' }, false],
    // Trocar criativo: a referência, sem espaço e sem dado pessoal; o id longo da plataforma passa.
    ['creative', 'meta', { creative_ref: 'novo-video-15s' }, true],
    ['creative', 'meta', { creative_ref: '120200000000000123' }, true],
    ['creative', 'meta', { creative_ref: 'video com espaço' }, false],
    ['creative', 'meta', { creative_ref: 'pessoa@example.com' }, false],
    ['creative', 'meta', { creative_ref: '123.456.789-09' }, false],
    // Criar campanha: os campos de todas e os que a plataforma exige; nunca os de outra plataforma.
    ['create', 'meta', CRIAR_META, true],
    ['create', 'meta', { ...CRIAR_META, special_ad_categories: ['HOUSING'] }, true],
    ['create', 'meta', { ...CRIAR_META, special_ad_categories: undefined }, false],
    ['create', 'meta', { ...CRIAR_META, special_ad_categories: 'HOUSING' }, false],
    ['create', 'meta', { ...CRIAR_META, special_ad_categories: ['12345678909'] }, false],
    ['create', 'meta', { ...CRIAR_META, budget_mode: 'BUDGET_MODE_DAY' }, false],
    ['create', 'meta', { ...CRIAR_META, origin: 'central' }, true],
    ['create', 'meta', { ...CRIAR_META, name: 'contato pessoa@example.com' }, false],
    ['create', 'meta', { ...CRIAR_META, name: 'ligar para (11) 98765-4321' }, false],
    ['create', 'meta', { ...CRIAR_META, name: '   ' }, false],
    ['create', 'meta', { ...CRIAR_META, objective: 'leads do mês' }, false],
    ['create', 'meta', { ...CRIAR_META, daily_budget_cents: undefined }, false],
    ['create', 'google', CRIAR_GOOGLE, true],
    ['create', 'google', { ...CRIAR_GOOGLE, contains_eu_political_advertising: false }, true],
    ['create', 'google', { ...CRIAR_GOOGLE, contains_eu_political_advertising: true }, false],
    ['create', 'google', { ...CRIAR_GOOGLE, bidding_strategy: undefined }, false],
    ['create', 'google', { ...CRIAR_GOOGLE, special_ad_categories: [] }, false],
    ['create', 'tiktok', CRIAR_TIKTOK, true],
    ['create', 'tiktok', { ...CRIAR_TIKTOK, budget_mode: undefined }, false],
    ['create', 'tiktok', { ...CRIAR_TIKTOK, contains_eu_political_advertising: false }, false],
    ['create', null, CRIAR_META, false],
    // Ajustar lance: a estratégia e, opcional, o custo alvo.
    ['bid', 'google', { bid_strategy: 'TARGET_CPA', target_cpa_cents: 2600 }, true],
    ['bid', 'google', { bid_strategy: 'TARGET_CPA' }, true],
    ['bid', 'google', { bid_strategy: 'TARGET_CPA', target_cpa_cents: 0 }, false],
    ['bid', 'google', { target_cpa_cents: 2600 }, false],
    // Pendência de medição: a área da lista e, opcional, a variável; com ou sem canal.
    ['pending_fix', null, { area: 'ga4', env: 'NEXT_PUBLIC_GA_ID' }, true],
    ['pending_fix', 'meta', { area: 'pixel' }, true],
    ['pending_fix', null, { area: 'ga4', origin: 'central' }, true],
    ['pending_fix', null, { area: 'erp' }, false],
    ['pending_fix', null, { area: 'site', env: 'chave com espaço' }, false],
    ['pending_fix', null, { env: 'NEXT_PUBLIC_GA_ID' }, false],
    // Forma: só objeto.
    ['pause', 'meta', [], false],
    ['pause', 'meta', 'paused', false],
    ['pause', 'meta', null, false],
  ];

  it('cada tipo aceita só os campos dele e os da plataforma, com o tipo certo e sem dado pessoal', async () => {
    await caso(db, usuario(DONO), async (s) => {
      for (const [tipo, plataforma, params, valido] of CASOS) {
        expect(
          await s.valor('select mkt.valid_action_params($1::mkt.action_kind, $2::mkt.platform, $3::jsonb)', [
            tipo,
            plataforma,
            params === null ? null : JSON.stringify(params),
          ]),
          `${tipo} ${plataforma} ${JSON.stringify(params)}`,
        ).toBe(valido);
      }
    });
  });

  it('a tabela recusa a ação com parâmetros de outro tipo, e quem tem canal precisa dele', async () => {
    await caso(db, postgres, async (s) => {
      await recusa(s, '23514', GESTOR_LOGADO, proposta({ params: { status: 'active' } }));
      await recusa(s, '23514', GESTOR_LOGADO, proposta({ params: { daily_budget_cents: 6000 } }));
      await recusa(
        s,
        '23514',
        GESTOR_LOGADO,
        proposta({
          tipo: 'budget',
          plataforma: null,
          conta: null,
          campanha: null,
          params: { daily_budget_cents: 1 },
        }),
      );
      await pela(
        s,
        GESTOR_LOGADO,
        proposta({ tipo: 'budget', campanha: CAMPANHA_CLAUDE_CS, params: { daily_budget_cents: 4000 } }),
      );
    });
  });
});

describe('mkt.valid_claude_context: só agregados, nenhum texto com dado pessoal', () => {
  const PARAMS_CRIAR = {
    objective: 'OUTCOME_SALES',
    daily_budget_cents: 3000,
    name: 'cs-remarketing-act-0001',
    special_ad_categories: [],
  };
  const CAMPANHA = {
    campaign_id: CAMPANHA_HUMANO_CS,
    platform: 'meta',
    name: 'cs-prospeccao-lojistas',
    status: 'active',
    operator: 'human',
    daily_budget_cents: 5000,
    has_own_budget: true,
    is_smart_plus: false,
    spend_cents: 98000,
    impressions: 81000,
    clicks: 2100,
    platform_leads: 12,
    conversions: 4.5,
    leads: 30,
    new_customers: 5,
    cost_per_lead_cents: 3267,
    cost_per_new_customer_cents: 19600,
    roas: null,
  };
  // Das ações vão só as chaves da seção 15 de integracoes.md, mais proposed_by (que decide o título).
  const DO_CLAUDE = {
    code: 'ACT-0001',
    kind: 'create',
    status: 'done',
    platform: 'meta',
    campaign_id: CAMPANHA_CLAUDE_CS,
    params: PARAMS_CRIAR,
    done_via: 'platform_api',
    proposed_by: 'claude',
    title: 'Criar campanha de remarketing',
  };
  const DA_PESSOA = {
    code: 'ACT-0002',
    kind: 'pause',
    status: 'discarded',
    platform: 'meta',
    campaign_id: CAMPANHA_HUMANO_CS,
    params: { status: 'paused' },
    discard_reason: 'against_strategy',
    proposed_by: 'human',
  };
  const ESTRATEGIA = {
    month_on: '2026-11-01',
    body: 'Foco em lojistas do Sul. Manter o custo por cliente novo abaixo de R$ 300.',
    budget_cents: 1500000,
    target_cost_per_new_customer_cents: 30000,
    target_cost_per_lead_cents: 4000,
    target_new_customers: 50,
  };

  function contexto(
    m: {
      campanha?: Record<string, unknown>;
      acoes?: unknown[];
      estrategia?: Record<string, unknown>;
      pendencias?: unknown[];
      topo?: Record<string, unknown>;
    } = {},
  ): Record<string, unknown> {
    const mes = {
      from_on: '2026-11-01',
      to_on: '2026-11-03',
      totals: { spend_cents: 150000, leads: 40, new_customers: 6, revenue_cents: 360000, roas: 2.4 },
      channels: [
        { platform: 'meta', spend_cents: 150000, impressions: 120000, clicks: 3400, active_campaigns: 2 },
      ],
      campaigns: [m.campanha ?? CAMPANHA],
    };
    return {
      brand: 'cs',
      generated_at: '2026-11-03T10:30:00Z',
      today_on: '2026-11-03',
      current_month: mes,
      last_30_days: { ...mes, from_on: '2026-10-05' },
      accounts: [
        {
          ad_account_id: CONTA_META_CS,
          platform: 'meta',
          monthly_limit_cents: 1500000,
          spend_month_cents: 150000,
          projected_month_cents: 1500000,
          remaining_cents: 1350000,
          usage_ratio: 0.1,
          situation: 'on_track',
          alert: null,
          spend_cap_cents: 1500000,
          days_left: 28,
        },
      ],
      strategy: m.estrategia ?? ESTRATEGIA,
      pending_fixes: m.pendencias ?? [
        { code: 'ACT-0003', area: 'ga4', env: 'NEXT_PUBLIC_GA_ID', status: 'idea', created_on: '2026-11-01' },
      ],
      connectors: [
        {
          connector: 'meta',
          status: 'ok',
          setup_state: 'connected',
          last_success_at: '2026-11-03T10:10:00+00:00',
        },
      ],
      actions: m.acoes ?? [DO_CLAUDE, DA_PESSOA],
      ...m.topo,
    };
  }

  const CASOS: Array<[string, unknown, boolean]> = [
    ['o contexto completo', contexto(), true],
    ['vazio', {}, true],
    [
      'nome de campanha com o id de 18 dígitos da plataforma',
      contexto({ campanha: { ...CAMPANHA, name: 'campanha 120200000000000000' } }),
      true,
    ],
    ['lista em vez de objeto', [], false],
    ['texto em vez de objeto', 'contexto', false],
    [
      'o motivo de uma ação (rationale)',
      contexto({ acoes: [{ ...DA_PESSOA, rationale: 'Porque sim, sem mais.' }] }),
      false,
    ],
    ['o resultado (result)', contexto({ acoes: [{ ...DO_CLAUDE, result: 'Criada na Meta.' }] }), false],
    [
      'o texto do descarte (discard_note)',
      contexto({ acoes: [{ ...DA_PESSOA, discard_note: 'Não agora.' }] }),
      false,
    ],
    [
      'o título da proposta da pessoa',
      contexto({ acoes: [{ ...DA_PESSOA, title: 'Pausar a campanha' }] }),
      false,
    ],
    [
      'o título de uma pendência',
      contexto({ pendencias: [{ code: 'ACT-0003', area: 'ga4', title: 'Ligar o GA4' }] }),
      false,
    ],
    // O que a seção 15 não manda nas ações: impacto, esforço, custo e datas (a pendência leva a data dela).
    ['o impacto de uma ação', contexto({ acoes: [{ ...DA_PESSOA, impact: 'medium' }] }), false],
    ['o esforço de uma ação', contexto({ acoes: [{ ...DA_PESSOA, effort: 'low' }] }), false],
    ['o custo de uma ação', contexto({ acoes: [{ ...DA_PESSOA, cost_cents: 0 }] }), false],
    ['o dia da proposta numa ação', contexto({ acoes: [{ ...DO_CLAUDE, created_on: '2026-10-30' }] }), false],
    [
      'o dia da execução numa ação',
      contexto({ acoes: [{ ...DO_CLAUDE, executed_on: '2026-10-31' }] }),
      false,
    ],
    [
      'a ação com impacto, esforço, custo e datas, da pessoa',
      contexto({
        acoes: [
          {
            code: 'ACT-0001',
            kind: 'pause',
            status: 'done',
            impact: 'high',
            effort: 'low',
            cost_cents: 100,
            created_on: '2026-11-01',
            executed_on: '2026-11-02',
            proposed_by: 'human',
          },
        ],
      }),
      false,
    ],
    // Cada lugar com as chaves dele: a chave certa no lugar errado também recusa. Os textos livres (name, body e
    // title) ficam cada um no seu lugar: o nome de campanha, o texto da estratégia e o título do Claude.
    [
      'o nome numa pendência',
      contexto({ pendencias: [{ code: 'ACT-0003', area: 'ga4', name: 'Ligar o GA4' }] }),
      false,
    ],
    [
      'o texto numa ação',
      contexto({ acoes: [{ ...DA_PESSOA, body: 'Texto de trabalho inventado.' }] }),
      false,
    ],
    ['o nome numa ação da pessoa', contexto({ acoes: [{ ...DA_PESSOA, name: 'Pausar a campanha' }] }), false],
    [
      'o texto nos parâmetros',
      contexto({
        acoes: [{ ...DO_CLAUDE, params: { ...PARAMS_CRIAR, body: 'Texto de trabalho inventado.' } }],
      }),
      false,
    ],
    [
      'o título e quem propôs nos parâmetros',
      contexto({
        acoes: [
          { ...DO_CLAUDE, params: { ...PARAMS_CRIAR, title: 'Criar campanha', proposed_by: 'claude' } },
        ],
      }),
      false,
    ],
    ['o nome na estratégia', contexto({ estrategia: { ...ESTRATEGIA, name: 'Plano de novembro' } }), false],
    [
      'o texto numa campanha',
      contexto({ campanha: { ...CAMPANHA, body: 'Texto de trabalho inventado.' } }),
      false,
    ],
    [
      'o texto num conector',
      contexto({
        topo: { connectors: [{ connector: 'meta', status: 'ok', body: 'Texto de trabalho inventado.' }] },
      }),
      false,
    ],
    [
      'o texto no mês corrente',
      contexto({ topo: { current_month: { from_on: '2026-11-01', body: 'Texto de trabalho inventado.' } } }),
      false,
    ],
    [
      'o texto nos últimos 30 dias',
      contexto({ topo: { last_30_days: { from_on: '2026-10-05', body: 'Texto de trabalho inventado.' } } }),
      false,
    ],
    [
      'o nome nos totais',
      contexto({ topo: { current_month: { totals: { spend_cents: 1, name: 'cs-prospeccao' } } } }),
      false,
    ],
    [
      'o nome num canal',
      contexto({ topo: { current_month: { channels: [{ platform: 'meta', name: 'cs-prospeccao' }] } } }),
      false,
    ],
    [
      'o texto numa conta',
      contexto({
        topo: { accounts: [{ ad_account_id: CONTA_META_CS, body: 'Texto de trabalho inventado.' }] },
      }),
      false,
    ],
    ['o nome no topo', contexto({ topo: { name: 'cs-prospeccao' } }), false],
    // A mesma base, sem a chave fora do lugar, passa: quem recusa acima é o lugar.
    [
      'as bases dos casos acima, sem a chave fora do lugar',
      contexto({
        pendencias: [{ code: 'ACT-0003', area: 'ga4' }],
        topo: {
          connectors: [{ connector: 'meta', status: 'ok' }],
          current_month: {
            from_on: '2026-11-01',
            totals: { spend_cents: 1 },
            channels: [{ platform: 'meta' }],
          },
          last_30_days: { from_on: '2026-10-05' },
          accounts: [{ ad_account_id: CONTA_META_CS }],
        },
      }),
      true,
    ],
    ['quem propôs solto no topo', contexto({ topo: { proposed_by: 'claude' } }), false],
    ['o dia numa campanha', contexto({ campanha: { ...CAMPANHA, created_on: '2026-11-01' } }), false],
    ['o período dentro de uma ação', contexto({ acoes: [{ ...DA_PESSOA, from_on: '2026-11-01' }] }), false],
    ['o nome de campanha numa conta', contexto({ topo: { accounts: [{ name: 'cs-prospeccao' }] } }), false],
    ['chave de cliente na campanha', contexto({ campanha: { ...CAMPANHA, customer_id: CLIENTE_A } }), false],
    ['e-mail solto no topo', contexto({ topo: { email: 'pessoa@example.com' } }), false],
    [
      'e-mail no nome da campanha',
      contexto({ campanha: { ...CAMPANHA, name: 'cs-lojistas pessoa@example.com' } }),
      false,
    ],
    [
      'telefone no nome da campanha',
      contexto({ campanha: { ...CAMPANHA, name: 'ligar para (11) 98765-4321' } }),
      false,
    ],
    [
      'telefone no título do Claude',
      contexto({ acoes: [{ ...DO_CLAUDE, title: 'Ligar para 5511987654321' }] }),
      false,
    ],
    [
      'CPF na estratégia',
      contexto({ estrategia: { ...ESTRATEGIA, body: 'Atender o cliente 123.456.789-09' } }),
      false,
    ],
    [
      'CNPJ na estratégia',
      contexto({ estrategia: { ...ESTRATEGIA, body: 'Loja 12.345.678/0001-90 primeiro' } }),
      false,
    ],
    [
      'estratégia com mais de 4.000 letras',
      contexto({ estrategia: { ...ESTRATEGIA, body: 'a'.repeat(4001) } }),
      false,
    ],
    [
      'chave a mais nos parâmetros',
      contexto({ acoes: [{ ...DO_CLAUDE, params: { ...PARAMS_CRIAR, email: 'x' } }] }),
      false,
    ],
    [
      'documento na lista de categorias',
      contexto({
        acoes: [{ ...DO_CLAUDE, params: { ...PARAMS_CRIAR, special_ad_categories: ['12345678909'] } }],
      }),
      false,
    ],
    ['número como texto', contexto({ campanha: { ...CAMPANHA, spend_cents: '98000' } }), false],
    ['id que não é uuid', contexto({ campanha: { ...CAMPANHA, campaign_id: 'campanha-1' } }), false],
    ['código com espaço', contexto({ topo: { brand: 'Corpo Sensual' } }), false],
    ['lista que não é lista', contexto({ topo: { actions: 'ACT-0001' } }), false],
    ['lista de textos em vez de objetos', contexto({ topo: { actions: ['ACT-0001'] } }), false],
    ['data fora do formato', contexto({ topo: { today_on: '03/11/2026' } }), false],
  ];

  it('aceita só as chaves previstas em cada lugar, cada uma no tipo dela; recusa motivo, resultado, impacto, esforço, custo e datas da ação, título da pessoa e dado pessoal', async () => {
    await caso(db, servico('mkt_worker'), async (s) => {
      for (const [nome, ctx, valido] of CASOS) {
        expect(await s.valor('select mkt.valid_claude_context($1::jsonb)', [JSON.stringify(ctx)]), nome).toBe(
          valido,
        );
      }
      expect(await s.valor('select mkt.valid_claude_context(null)')).toBe(false);
    });
  });

  it('a rodada do Claude recusa o contexto com chave fora da lista e o prompt com dado pessoal', async () => {
    await caso(db, postgres, async (s) => {
      const rodada = (prompt: string, ctx: unknown, codigo: string | null = null) =>
        [
          `insert into mkt.claude_runs (brand_id, status, model, prompt_version, prompt, context, error_code, started_at)
         values (null, 'failed', 'modelo-de-teste', 'teste-1', $1, $2::jsonb, $3, now())`,
          [prompt, JSON.stringify(ctx), codigo],
        ] as [string, unknown[]];
      await s.erro('23514', ...rodada('Analise os números.', contexto({ topo: { lead_id: CLIENTE_A } })));
      await s.erro('23514', ...rodada('Fale com pessoa@example.com sobre o mês.', contexto()));
      await s.erro('23514', ...rodada('Analise os números.', contexto(), 'context refused'));
      expect(await s.linhas(...rodada('Analise os números.', contexto(), 'CONTEXT_REFUSED'))).toHaveLength(0);
      expect(await s.valor(`select count(*)::int from mkt.claude_runs where brand_id is null`)).toBe(1);
    });
  });
});

// ---------- As tabelas ----------

describe('estratégia, limite de gasto e rodada do Claude', () => {
  const mesCorrente = `${new Date().toISOString().slice(0, 8)}01`;

  it('traffic_strategies: o mês pelo dia 1, texto até 4.000 letras sem dado pessoal, metas positivas, uma por marca e mês', async () => {
    await caso(db, postgres, async (s) => {
      const estrategia = (e: {
        marca?: string;
        mes?: string;
        texto?: string;
        verba?: number;
        meta?: number;
        por?: string | null;
      }) =>
        [
          `insert into mkt.traffic_strategies (brand_id, month_on, body, budget_cents, target_cost_per_lead_cents,
                                               updated_by)
           values ((select id from mkt.brands where code = $1), $2, $3, $4, $5, $6)`,
          [
            e.marca ?? 'plumene',
            e.mes ?? '2030-01-01',
            e.texto ?? 'Foco em lojistas do Sul.',
            e.verba ?? null,
            e.meta ?? null,
            e.por === undefined ? DONO : e.por,
          ],
        ] as [string, unknown[]];
      await s.erro('23514', ...estrategia({ mes: '2026-12-02' }));
      await s.erro('23514', ...estrategia({ texto: 'Ligar para pessoa@example.com' }));
      await s.erro('23514', ...estrategia({ texto: 'Falar com (11) 98765-4321' }));
      await s.erro('23514', ...estrategia({ texto: 'a'.repeat(4001) }));
      await s.erro('23514', ...estrategia({ verba: -1 }));
      await s.erro('23514', ...estrategia({ meta: 0 }));
      await s.erro('23502', ...estrategia({ por: null }));
      await s.erro('23505', ...estrategia({ marca: 'cs', mes: mesCorrente }));
      expect(await s.linhas(...estrategia({ texto: 'a'.repeat(4000), verba: 0, meta: 3500 }))).toHaveLength(
        0,
      );
      expect(await s.linhas(...estrategia({ marca: 'cs', mes: '2030-01-01' }))).toHaveLength(0);
    });
  });

  it('spend_limits: a conta com a marca e o canal dela, limite não negativo, uma linha por conta e dia', async () => {
    await caso(db, postgres, async (s) => {
      const limite = (l: { conta?: string; marca?: string; canal?: string; valor?: number; dia?: string }) =>
        [
          `insert into mkt.spend_limits (ad_account_id, brand_id, platform, monthly_limit_cents, valid_from_on, set_by)
           values ($1, (select id from mkt.brands where code = $2), $3, $4, $5, $6)`,
          [
            l.conta ?? CONTA_META_CS,
            l.marca ?? 'cs',
            l.canal ?? 'meta',
            l.valor ?? 2000000,
            l.dia ?? mesCorrente,
            DONO,
          ],
        ] as [string, unknown[]];
      await s.erro('23503', ...limite({ marca: 'plumene', dia: '2030-01-01' }));
      await s.erro('23503', ...limite({ canal: 'google', dia: '2030-01-01' }));
      await s.erro('23503', ...limite({ conta: CONTA_GOOGLE_PL, dia: '2030-01-01' }));
      await s.erro('23514', ...limite({ valor: -1, dia: '2030-01-01' }));
      await s.erro('23505', ...limite({}));
      expect(await s.linhas(...limite({ valor: 0, dia: '2030-01-01' }))).toHaveLength(0);
      expect(
        await s.linhas(
          ...limite({ conta: CONTA_GOOGLE_PL, marca: 'plumene', canal: 'google', dia: '2030-01-01' }),
        ),
      ).toHaveLength(0);
    });
  });

  it('claude_runs: status da lista, contagens não negativas e o código do erro sem texto livre', async () => {
    await caso(db, postgres, async (s) => {
      const rodada = (r: { status?: string; tokens?: number; recusadas?: number; erro?: string | null }) =>
        [
          `insert into mkt.claude_runs (status, model, prompt_version, prompt, context, input_tokens,
                                        proposals_refused, error_code, started_at)
           values ($1, 'modelo-de-teste', 'teste-1', 'Analise os números.', '{}', $2, $3, $4, now())`,
          [r.status ?? 'running', r.tokens ?? null, r.recusadas ?? 0, r.erro ?? null],
        ] as [string, unknown[]];
      await s.erro('23514', ...rodada({ status: 'ok' }));
      await s.erro('23514', ...rodada({ tokens: -1 }));
      await s.erro('23514', ...rodada({ recusadas: -1 }));
      await s.erro('23514', ...rodada({ erro: 'A API caiu' }));
      expect(await s.linhas(...rodada({ status: 'failed', erro: 'HTTP_529' }))).toHaveLength(0);
    });
  });
});

describe('traffic_actions: as restrições de tabelas.md', () => {
  it('título de 5 a 140 letras e o porquê de 10 a 2.000, sem e-mail, telefone nem documento (RLS-11)', async () => {
    await caso(db, postgres, async (s) => {
      for (const a of [
        { titulo: 'Paus' },
        { titulo: 'a'.repeat(141) },
        { motivo: 'Curto.' },
        { motivo: 'a'.repeat(2001) },
        { motivo: 'Quem pediu foi pessoa@example.com, na reunião.' },
        { motivo: 'Ligar para (11) 98765-4321 antes de pausar.' },
        { titulo: 'Pausar a loja 12.345.678/0001-90' },
      ]) {
        await recusa(s, '23514', GESTOR_LOGADO, proposta(a));
      }
      await pela(s, GESTOR_LOGADO, proposta({ titulo: 'a'.repeat(140), motivo: 'a'.repeat(2000) }));
    });
  });

  it('a conta e a campanha são da marca e do canal da ação; campanha ou conta pedem canal; custo e níveis da lista', async () => {
    await caso(db, postgres, async (s) => {
      await recusa(s, '23503', GESTOR_LOGADO, proposta({ campanha: CAMPANHA_HUMANO_PL }));
      await recusa(s, '23503', GESTOR_LOGADO, proposta({ marca: 'plumene' }));
      await recusa(s, '23503', GESTOR_LOGADO, proposta({ conta: CONTA_GOOGLE_PL }));
      await recusa(
        s,
        '23514',
        GESTOR_LOGADO,
        proposta({ tipo: 'pending_fix', plataforma: null, conta: null, params: { area: 'pixel' } }),
      );
      await recusa(
        s,
        '23514',
        GESTOR_LOGADO,
        proposta({ tipo: 'pending_fix', plataforma: null, campanha: null, params: { area: 'pixel' } }),
      );
      await recusa(s, '23514', GESTOR_LOGADO, proposta({ custo: -1 }));
      await recusa(s, '23514', GESTOR_LOGADO, proposta().replace(`'medium'`, `'altissimo'`));
      await pela(
        s,
        GESTOR_LOGADO,
        proposta({
          marca: 'plumene',
          plataforma: 'google',
          conta: CONTA_GOOGLE_PL,
          campanha: CAMPANHA_HUMANO_PL,
          custo: null,
        }),
      );
    });
  });

  it('descarte com motivo da lista e texto de 10 letras (RLS-16); "feita" com a data e, à mão, quem e o resultado', async () => {
    await caso(db, postgres, async (s) => {
      await acaoEm(s, 'approved');
      await recusa(s, '23514', DONO_2F, descartar(NOVA, 'auth', `'duplicate'`, 'null'));
      await recusa(s, '23514', DONO_2F, descartar(NOVA, 'auth', 'null'));
      await recusa(s, '23514', DONO_2F, descartar(NOVA, 'auth', `'demitido'`));
      await recusa(s, '23514', DONO_2F, descartar(NOVA, 'auth', `'duplicate'`, `'Repetida.'`));
      await recusa(s, '23514', DONO_2F, descartar(NOVA, 'auth', `'other'`, `'Fale com pessoa@example.com'`));
      await recusa(s, '23514', GESTOR_LOGADO, feitaAMao(NOVA, 'auth', 'null'));
      await recusa(s, '23514', GESTOR_LOGADO, feitaAMao(NOVA, 'auth', `'Feit'`));
      await recusa(s, '23514', GESTOR_LOGADO, feitaAMao(NOVA, 'auth', `'Feita; avisei pessoa@example.com'`));
      await recusa(
        s,
        '23514',
        EXECUTOR,
        `update mkt.traffic_actions set status = 'done', done_via = 'platform_api' where id = '${NOVA}'`,
      );
      expect(await statusDe(s, NOVA)).toBe('approved');
      await pela(s, DONO_2F, descartar(NOVA, 'auth', `'other'`, `'O gestor já pausou na Meta.'`));
      expect(await statusDe(s, NOVA)).toBe('discarded');
    });
  });
});

describe('o código ACT- (gatilho traffic_actions_code)', () => {
  it('a ação ganha o código da sequência, e o que vier no insert é ignorado', async () => {
    await caso(db, postgres, async (s) => {
      expect(await s.valor(`select code from mkt.traffic_actions where id = $1`, [ACAO_QUE_CRIOU])).toBe(
        'ACT-0001',
      );
      const antes = await s.valor<number>('select last_value::int from mkt.traffic_action_code_seq');
      await pela(
        s,
        GESTOR_LOGADO,
        proposta()
          .replace('insert into mkt.traffic_actions (id,', 'insert into mkt.traffic_actions (code, id,')
          .replace(`values ('${NOVA}'`, `values ('ACT-9999', '${NOVA}'`),
      );
      await s.como(postgres);
      expect(await s.valor(`select code from mkt.traffic_actions where id = $1`, [NOVA])).toBe(
        `ACT-${String(antes + 1).padStart(4, '0')}`,
      );
    });
  });

  it('o código nunca muda, nem pelo dono do banco', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        await recusa(
          s,
          'PT422',
          DONO_2F,
          `update mkt.traffic_actions set code = 'ACT-9999' where id = '${ACAO_APROVADA}'`,
        ),
      ).toBe('COD-422');
      await s.como(postgres);
      expect(
        (await s.erro('PT422', `update mkt.traffic_actions set code = 'ACT-9999' where id = '${PENDENCIA}'`))
          .message,
      ).toBe('COD-422');
    });
  });

  it('a proposta do Claude gravada de novo (on conflict pela rodada e pela posição) fica com o código e não gasta número', async () => {
    await caso(db, postgres, async (s) => {
      const gravar = `${proposta({ claude: 7 })} on conflict (claude_run_id, claude_item) do nothing`;
      await pela(s, WORKER, gravar);
      await s.como(postgres);
      const codigo = await s.valor<string>('select code from mkt.traffic_actions where id = $1', [NOVA]);
      const sequencia = await s.valor<number>('select last_value::int from mkt.traffic_action_code_seq');
      await pela(s, WORKER, gravar.replace(NOVA, OUTRA));
      await s.como(postgres);
      expect(await s.valor('select last_value::int from mkt.traffic_action_code_seq')).toBe(sequencia);
      expect(
        await s.linhas(
          `select id::text, code from mkt.traffic_actions where claude_run_id = $1 and claude_item = 7`,
          [RODADA_DO_CLAUDE],
        ),
      ).toEqual([{ id: NOVA, code: codigo }]);
    });
  });
});

// ---------- O quadro de passagens ----------

interface Passagem {
  para: string;
  sql: (id: string) => string;
  quem: Quem;
}

/** Cada destino com quem pode pedi-lo, quando a passagem existe: assim o erro de fora do quadro é PT422, não PT403. */
const DESTINOS: Passagem[] = [
  { para: 'approved', sql: aprovar, quem: DONO_2F },
  { para: 'discarded', sql: descartar, quem: DONO_2F },
  { para: 'done', sql: feitaAMao, quem: GESTOR_LOGADO },
  { para: 'running', sql: rodando, quem: EXECUTOR },
  { para: 'failed', sql: falhou, quem: EXECUTOR },
  { para: 'done', sql: feitaNaPlataforma, quem: EXECUTOR },
  { para: 'idea', sql: voltarParaIdeia, quem: DONO_2F },
];
const nomeDe = (p: Passagem) =>
  p.sql === feitaAMao ? 'done à mão' : p.sql === feitaNaPlataforma ? 'done pela plataforma' : p.para;

/** O quadro de tabelas.md (traffic_actions), para uma ação que não é pendência de medição. */
const PERMITIDAS: Record<Estado, string[]> = {
  idea: ['approved', 'discarded'],
  approved: ['discarded', 'done à mão', 'running', 'failed', 'done pela plataforma'],
  running: ['done à mão', 'failed', 'done pela plataforma'],
  failed: ['approved', 'discarded', 'done à mão'],
  done: [],
  discarded: [],
};

describe('as passagens de status da ação (gatilho traffic_actions_transition)', () => {
  for (const estado of Object.keys(PERMITIDAS) as Estado[]) {
    it(`de ${estado}: só as passagens do quadro; as outras dão PT422 e nada muda`, async () => {
      for (const destino of DESTINOS) {
        if (destino.para === estado) continue;
        const nome = `${estado} → ${nomeDe(destino)}`;
        await caso(db, postgres, async (s) => {
          await acaoEm(s, estado);
          const antes = (await diario(s, NOVA)).length;
          if (PERMITIDAS[estado].includes(nomeDe(destino))) {
            await pela(s, destino.quem, destino.sql(NOVA));
            expect(await statusDe(s, NOVA), nome).toBe(destino.para);
            expect((await diario(s, NOVA)).length, nome).toBe(antes + 1);
          } else {
            expect(await recusa(s, 'PT422', destino.quem, destino.sql(NOVA)), nome).toBe('TRF-422');
            expect(await statusDe(s, NOVA), nome).toBe(estado);
            expect((await diario(s, NOVA)).length, nome).toBe(antes);
          }
        });
      }
    });
  }

  it('pendência de medição: não se aprova (RLS-16), fecha à mão direto da ideia ou é descartada', async () => {
    await caso(db, postgres, async (s) => {
      expect(await recusa(s, 'PT422', DONO_2F, aprovar(PENDENCIA))).toBe('TRF-422');
      expect(
        await recusa(
          s,
          'PT422',
          DONO_2F,
          proposta({
            tipo: 'pending_fix',
            plataforma: null,
            conta: null,
            campanha: null,
            params: { area: 'ga4' },
            aprovadoPor: 'auth',
          }),
        ),
      ).toBe('TRF-422');
      await pela(s, GESTOR_LOGADO, feitaAMao(PENDENCIA, 'auth', `'Variável do GA4 publicada no site.'`));
      expect(await statusDe(s, PENDENCIA)).toBe('done');
    });
    await caso(db, postgres, async (s) => {
      await pela(s, DONO_2F, descartar(PENDENCIA));
      expect(await statusDe(s, PENDENCIA)).toBe('discarded');
    });
  });

  it('RLS-12: marcar como feita uma ideia que não é pendência dá PT422', async () => {
    await caso(db, postgres, async (s) => {
      expect(await recusa(s, 'PT422', GESTOR_LOGADO, feitaAMao(IDEIA_DO_CLAUDE))).toBe('TRF-422');
      expect(await statusDe(s, IDEIA_DO_CLAUDE)).toBe('idea');
    });
  });

  it('o executor anda com a ação, sem "feita por"; o dono aprova de novo o que falhou ("Tentar de novo")', async () => {
    await caso(db, postgres, async (s) => {
      await acaoEm(s, 'failed');
      await pela(s, DONO_2F, aprovar(NOVA));
      await pela(s, EXECUTOR, rodando(NOVA));
      await pela(s, EXECUTOR, feitaNaPlataforma(NOVA));
      expect(
        await s.linhas(
          `select status::text, done_via::text, done_by, approved_by::text, executed_at is not null as feita
             from mkt.traffic_actions where id = $1`,
          [NOVA],
        ),
      ).toEqual([
        { status: 'done', done_via: 'platform_api', done_by: null, approved_by: DONO, feita: true },
      ]);
    });
  });

  it('"Marcar como feita" não preenche o aprovador, e o descarte guarda quem, quando, o motivo e o texto', async () => {
    await caso(db, postgres, async (s) => {
      await acaoEm(s, 'idea');
      await pela(s, GESTOR_LOGADO, proposta({ id: OUTRA }));
      await pela(s, DONO_2F, aprovar(OUTRA));
      await pela(s, GESTOR_LOGADO, feitaAMao(OUTRA));
      await pela(s, DONO_2F, descartar(NOVA));
      await s.como(postgres);
      expect(
        await s.linhas(
          `select id::text, approved_by::text, done_by::text, done_via::text, discarded_by::text, discard_reason::text,
                  discard_note
             from mkt.traffic_actions where id in ($1, $2) order by id`,
          [NOVA, OUTRA],
        ),
      ).toEqual([
        {
          id: NOVA,
          approved_by: null,
          done_by: null,
          done_via: null,
          discarded_by: DONO,
          discard_reason: 'duplicate',
          discard_note: 'Já existe outra ação igual na fila.',
        },
        {
          id: OUTRA,
          approved_by: DONO,
          done_by: GESTOR,
          done_via: 'manual',
          discarded_by: null,
          discard_reason: null,
          discard_note: null,
        },
      ]);
    });
  });
});

describe('quem pede cada passagem: o session_user e a permissão, nunca só o token', () => {
  const comToken = (papel: 'mkt_worker' | 'mkt_executor' | 'n8n_notifier' | 'mkt_setup') =>
    servico(papel, TOKEN_DO_DONO);

  it('aprovar e descartar: só a pessoa pela API, com approve_action e o segundo fator, em nome próprio (RLS-06, 22, 30, 35)', async () => {
    const tentativas: Array<[string, Estado, Quem, (id: string) => string]> = [
      ['o gestor aprova', 'idea', usuario(GESTOR, 'aal2'), aprovar],
      ['o dono sem o segundo fator aprova', 'idea', usuario(DONO, 'aal1'), aprovar],
      ['o dono aprova em nome do outro dono', 'idea', DONO_2F, (id) => aprovar(id, SEGUNDO_DONO)],
      ['o ex-gestor aprova', 'idea', usuario(EX_GESTOR, 'aal2'), aprovar],
      ['login sem perfil aprova', 'idea', usuario(SEM_PERFIL, 'aal2'), aprovar],
      ['o worker, com o token do dono, aprova', 'idea', comToken('mkt_worker'), aprovar],
      ['o executor, com o token do dono, aprova', 'idea', comToken('mkt_executor'), aprovar],
      ['o n8n, com o token do dono, aprova', 'idea', comToken('n8n_notifier'), aprovar],
      ['o dono sem o segundo fator aprova de novo o que falhou', 'failed', usuario(DONO, 'aal1'), aprovar],
      ['o gestor descarta', 'idea', usuario(GESTOR, 'aal2'), descartar],
      ['o dono sem o segundo fator descarta', 'approved', usuario(DONO, 'aal1'), descartar],
      ['o dono descarta em nome do outro dono', 'approved', DONO_2F, (id) => descartar(id, SEGUNDO_DONO)],
      ['o worker, com o token do dono, descarta', 'approved', comToken('mkt_worker'), descartar],
    ];
    for (const [nome, estado, quem, sql] of tentativas) {
      await caso(db, postgres, async (s) => {
        await acaoEm(s, estado);
        expect(await recusa(s, 'PT403', quem, sql(NOVA)), nome).toBe('TRF-403');
        expect(await statusDe(s, NOVA), nome).toBe(estado);
      });
    }
  });

  it('nem o dono do banco aprova ou anda com a ação direto, com o token do dono', async () => {
    await caso(db, postgres, async (s) => {
      await acaoEm(s, 'idea');
      await s.exec(`select set_config('request.jwt.claims', '${JSON.stringify(TOKEN_DO_DONO)}', true)`);
      expect((await s.erro('PT403', aprovar(NOVA))).message).toBe('TRF-403');
      expect((await s.erro('PT403', descartar(NOVA))).message).toBe('TRF-403');
      await s.erro('PT403', proposta({ id: OUTRA }));
      expect(await statusDe(s, NOVA)).toBe('idea');
    });
  });

  it('marcar como feita: só a pessoa pela API, com operate_traffic, em nome próprio', async () => {
    const tentativas: Array<[string, Quem, (id: string) => string]> = [
      ['o ex-gestor', usuario(EX_GESTOR, 'aal2'), feitaAMao],
      ['login sem perfil', usuario(SEM_PERFIL, 'aal2'), feitaAMao],
      ['o gestor em nome do dono', GESTOR_LOGADO, (id) => feitaAMao(id, DONO)],
      ['o worker, com o token do dono', comToken('mkt_worker'), feitaAMao],
      ['o executor, à mão, com o token do dono', comToken('mkt_executor'), feitaAMao],
    ];
    for (const [nome, quem, sql] of tentativas) {
      await caso(db, postgres, async (s) => {
        await acaoEm(s, 'approved');
        expect(await recusa(s, 'PT403', quem, sql(NOVA)), nome).toBe('TRF-403');
        expect(await statusDe(s, NOVA), nome).toBe('approved');
      });
    }
  });

  it('andar com a execução (running, failed, done pela plataforma): só o executor, e sem "feita por"', async () => {
    const tentativas: Array<[string, Estado, Quem, (id: string) => string]> = [
      ['o dono pela API põe em execução', 'approved', DONO_2F, rodando],
      ['o dono pela API marca como feita pela plataforma', 'approved', DONO_2F, feitaNaPlataforma],
      ['o dono pela API marca como falhou', 'running', DONO_2F, falhou],
      ['o worker põe em execução', 'approved', WORKER, rodando],
      ['o worker marca como falhou', 'running', WORKER, falhou],
      ['o n8n marca como feita pela plataforma', 'running', servico('n8n_notifier'), feitaNaPlataforma],
      [
        'o executor marca como feita pela plataforma em nome do dono',
        'approved',
        comToken('mkt_executor'),
        (id) =>
          `update mkt.traffic_actions set status = 'done', done_via = 'platform_api', done_by = '${DONO}',
             executed_at = now() where id = '${id}'`,
      ],
    ];
    for (const [nome, estado, quem, sql] of tentativas) {
      await caso(db, postgres, async (s) => {
        await acaoEm(s, estado);
        expect(await recusa(s, 'PT403', quem, sql(NOVA)), nome).toBe('TRF-403');
        expect(await statusDe(s, NOVA), nome).toBe(estado);
      });
    }
  });

  it('propor: a pessoa pela API com operate_traffic, como quem propõe; o worker só a proposta do Claude, em ideia', async () => {
    await caso(db, postgres, async (s) => {
      // Controles: o gestor e o dono sem o segundo fator propõem; o worker grava a proposta do Claude.
      await pela(s, GESTOR_LOGADO, proposta());
      await pela(s, usuario(DONO, 'aal1'), proposta({ id: OUTRA }));
      await pela(s, WORKER, proposta({ id: EXECUCAO, claude: 9 }));
      await s.como(postgres);
      expect(
        await s.linhas(
          `select id::text, status::text, proposed_by_kind::text, proposed_by::text from mkt.traffic_actions
            where id in ($1, $2, $3) order by id`,
          [NOVA, OUTRA, EXECUCAO],
        ),
      ).toEqual([
        { id: NOVA, status: 'idea', proposed_by_kind: 'human', proposed_by: GESTOR },
        { id: OUTRA, status: 'idea', proposed_by_kind: 'human', proposed_by: DONO },
        { id: EXECUCAO, status: 'idea', proposed_by_kind: 'claude', proposed_by: null },
      ]);
    });
    const tentativas: Array<[string, Quem, string]> = [
      ['o ex-gestor', usuario(EX_GESTOR, 'aal2'), proposta()],
      ['login sem perfil', usuario(SEM_PERFIL, 'aal2'), proposta()],
      ['o gestor em nome do dono', GESTOR_LOGADO, proposta({ propostoPor: DONO })],
      ['a pessoa propondo como o Claude', DONO_2F, proposta({ claude: 1 })],
      ['o worker propondo como pessoa', comToken('mkt_worker'), proposta()],
      ['o executor propondo como o Claude', EXECUTOR, proposta({ claude: 1 })],
      ['o n8n propondo como o Claude', servico('n8n_notifier'), proposta({ claude: 1 })],
      ['os scripts propondo como o Claude', servico('mkt_setup'), proposta({ claude: 1 })],
      [
        'o gestor já aprovada (approve_now sem approve_action)',
        usuario(GESTOR, 'aal2'),
        proposta({ aprovadoPor: 'auth' }),
      ],
      [
        'o dono já aprovada sem o segundo fator (RLS-35)',
        usuario(DONO, 'aal1'),
        proposta({ aprovadoPor: 'auth' }),
      ],
      ['o dono já aprovada em nome do outro dono', DONO_2F, proposta({ aprovadoPor: SEGUNDO_DONO })],
    ];
    for (const [nome, quem, sql] of tentativas) {
      await caso(db, postgres, async (s) => {
        expect(await recusa(s, 'PT403', quem, sql), nome).toBe('TRF-403');
        await s.como(postgres);
        expect(
          await s.valor('select count(*)::int from mkt.traffic_actions where id = $1', [NOVA]),
          nome,
        ).toBe(0);
      });
    }
  });

  it('a ação nasce ideia (ou aprovada, com approve_now), sem descarte nem "feita"; a do Claude com a rodada, a da pessoa sem', async () => {
    await caso(db, postgres, async (s) => {
      await pela(s, DONO_2F, proposta({ aprovadoPor: 'auth' }));
      expect(await statusDe(s, NOVA)).toBe('approved');
    });
    const tentativas: Array<[string, Quem, string]> = [
      ['nasce em execução', EXECUTOR, proposta({ status: 'running', aprovadoPor: DONO })],
      ['nasce falhada', EXECUTOR, proposta({ status: 'failed', aprovadoPor: DONO })],
      ['nasce feita', DONO_2F, proposta({ status: 'done' })],
      ['nasce descartada', DONO_2F, proposta({ status: 'discarded' })],
      ['ideia com aprovação', DONO_2F, proposta({ status: 'idea', aprovadoPor: 'auth' })],
      ['proposta do Claude sem a rodada', WORKER, proposta({ claude: 1, rodada: null })],
      ['proposta do Claude já aprovada', WORKER, proposta({ claude: 1, aprovadoPor: DONO })],
      ['proposta da pessoa com rodada', GESTOR_LOGADO, proposta({ rodada: RODADA_DO_CLAUDE })],
    ];
    for (const [nome, quem, sql] of tentativas) {
      await caso(db, postgres, async (s) => {
        expect(await recusa(s, 'PT422', quem, sql), nome).toBe('TRF-422');
      });
    }
  });
});

describe('o que congela: os parâmetros fora da ideia, quem propôs e cada carimbo fora da passagem dele', () => {
  it('na ação aprovada, nem o dono muda parâmetros, tipo, campanha, texto ou custo', async () => {
    for (const mudanca of [
      `params = '{"status": "paused", "origin": "central"}'`,
      `kind = 'budget', params = '{"daily_budget_cents": 1000}'`,
      `campaign_id = '${CAMPANHA_CLAUDE_CS}'`,
      `title = 'Pausar outra campanha'`,
      `rationale = 'Outro motivo, depois de aprovada.'`,
      `cost_cents = 99999`,
      `impact = 'high'`,
    ]) {
      await caso(db, postgres, async (s) => {
        expect(
          await recusa(
            s,
            'PT422',
            DONO_2F,
            `update mkt.traffic_actions set ${mudanca} where id = '${ACAO_APROVADA}'`,
          ),
          mudanca,
        ).toBe('TRF-422');
      });
    }
  });

  it('na ideia, quem pode propor a ajusta, sem diário; junto com a passagem, não', async () => {
    await caso(db, postgres, async (s) => {
      await acaoEm(s, 'idea');
      const antes = (await diario(s, NOVA)).length;
      await pela(
        s,
        DONO_2F,
        `update mkt.traffic_actions set title = 'Pausar a campanha de teste hoje' where id = '${NOVA}'`,
      );
      await pela(
        s,
        WORKER,
        `update mkt.traffic_actions set params = '{"daily_budget_cents": 5000}' where id = '${IDEIA_DO_CLAUDE}'`,
      );
      expect((await diario(s, NOVA)).length).toBe(antes);
      expect(
        await recusa(
          s,
          'PT422',
          DONO_2F,
          `update mkt.traffic_actions set status = 'approved', approved_by = auth.uid(), approved_at = now(),
                  params = '{"status": "paused", "origin": "central"}' where id = '${NOVA}'`,
        ),
      ).toBe('TRF-422');
      // A proposta do Claude não é reescrita pela pessoa, nem a da pessoa pelo worker.
      expect(
        await recusa(
          s,
          'PT403',
          GESTOR_LOGADO,
          `update mkt.traffic_actions set title = 'Outro título' where id = '${IDEIA_DO_CLAUDE}'`,
        ),
      ).toBe('TRF-403');
      expect(
        await recusa(
          s,
          'PT403',
          WORKER,
          `update mkt.traffic_actions set title = 'Outro título' where id = '${NOVA}'`,
        ),
      ).toBe('TRF-403');
      expect(
        await recusa(
          s,
          'PT403',
          usuario(EX_GESTOR, 'aal2'),
          `update mkt.traffic_actions set title = 'Outro título' where id = '${NOVA}'`,
        ),
      ).toBe('TRF-403');
    });
  });

  it('quem propôs, a posição na resposta e a rodada não mudam; a rodada só cai para nulo, quando ela sai (13 meses)', async () => {
    for (const mudanca of [
      `proposed_by = '${DONO}'`,
      `proposed_by_kind = 'claude', proposed_by = null, claude_item = 5`,
      `claude_item = 3`,
    ]) {
      await caso(db, postgres, async (s) => {
        const alvo = mudanca.startsWith('claude_item') ? IDEIA_DO_CLAUDE : PENDENCIA;
        expect(
          await recusa(s, 'PT422', DONO_2F, `update mkt.traffic_actions set ${mudanca} where id = '${alvo}'`),
          mudanca,
        ).toBe('TRF-422');
      });
    }
    await caso(db, postgres, async (s) => {
      const outraRodada = await s.valor<string>(
        `insert into mkt.claude_runs (status, model, prompt_version, prompt, context, started_at)
         values ('succeeded', 'modelo-de-teste', 'teste-1', 'Analise os números.', '{}', now()) returning id::text`,
      );
      expect(
        await recusa(
          s,
          'PT422',
          WORKER,
          `update mkt.traffic_actions set claude_run_id = '${outraRodada}' where id = '${IDEIA_DO_CLAUDE}'`,
        ),
      ).toBe('TRF-422');
      await s.como(postgres);
      await s.exec(`delete from mkt.claude_runs where id = '${RODADA_DO_CLAUDE}'`);
      expect(
        await s.linhas(
          `select id::text, claude_run_id, claude_item, status::text from mkt.traffic_actions
            where id in ($1, $2) order by id`,
          [IDEIA_DO_CLAUDE, ACAO_DESCARTADA],
        ),
      ).toEqual([
        { id: IDEIA_DO_CLAUDE, claude_run_id: null, claude_item: 1, status: 'idea' },
        { id: ACAO_DESCARTADA, claude_run_id: null, claude_item: 2, status: 'discarded' },
      ]);
    });
  });

  it('cada carimbo muda só na passagem dele: a aprovação, o descarte e o "feita" não se reescrevem depois', async () => {
    const tentativas: Array<[string, string, Quem]> = [
      ['outro aprovador na ação aprovada', `approved_by = '${SEGUNDO_DONO}'`, DONO_2F],
      ['outra hora de aprovação', `approved_at = now() - interval '1 day'`, DONO_2F],
      ['"feita por" na ação aprovada', `done_by = auth.uid()`, GESTOR_LOGADO],
      ['motivo de descarte na ação aprovada', `discard_reason = 'duplicate'`, DONO_2F],
    ];
    for (const [nome, mudanca, quem] of tentativas) {
      await caso(db, postgres, async (s) => {
        expect(
          await recusa(
            s,
            'PT422',
            quem,
            `update mkt.traffic_actions set ${mudanca} where id = '${ACAO_APROVADA}'`,
          ),
          nome,
        ).toBe('TRF-422');
      });
    }
    await caso(db, postgres, async (s) => {
      expect(
        await recusa(
          s,
          'PT422',
          DONO_2F,
          `update mkt.traffic_actions set discard_reason = 'other' where id = '${ACAO_DESCARTADA}'`,
        ),
      ).toBe('TRF-422');
      expect(
        await recusa(
          s,
          'PT422',
          DONO_2F,
          `update mkt.traffic_actions set approved_by = auth.uid() where id = '${PENDENCIA}'`,
        ),
      ).toBe('TRF-422');
    });
  });
});

describe('a ação e a execução: nada fecha à mão nem é descartado com a execução enviada', () => {
  /** A execução da pausa aprovada (pela API, como o dono), levada ao status pedido pelo executor. */
  async function execucao(s: Sessao, status: 'queued' | 'blocked' | 'sent'): Promise<void> {
    await pela(
      s,
      DONO_2F,
      `insert into mkt.platform_executions (id, brand_id, platform, ad_account_id, campaign_id, traffic_action_id,
                                            operation, request, idempotency_key)
       select '${EXECUCAO}', a.brand_id, a.platform, a.ad_account_id, a.campaign_id, a.id, 'pause',
              '{"status": "PAUSED"}', 'exec-teste-' || a.code
         from mkt.traffic_actions a where a.id = '${NOVA}'`,
    );
    if (status === 'blocked') {
      await pela(
        s,
        EXECUTOR,
        `update mkt.platform_executions set status = 'blocked', blocked_reason = 'no_write_credential' where id = '${EXECUCAO}'`,
      );
    }
    if (status === 'sent') {
      await pela(
        s,
        EXECUTOR,
        `update mkt.platform_executions set status = 'sent', attempts = 1, sent_at = now() where id = '${EXECUCAO}'`,
      );
    }
  }

  it('aprovada com a execução na fila: descartar e marcar como feita passam (a função cancela a execução)', async () => {
    await caso(db, postgres, async (s) => {
      await acaoEm(s, 'approved');
      await execucao(s, 'queued');
      await pela(s, DONO_2F, descartar(NOVA));
      expect(await statusDe(s, NOVA)).toBe('discarded');
    });
    await caso(db, postgres, async (s) => {
      await acaoEm(s, 'approved');
      await execucao(s, 'blocked');
      await pela(s, GESTOR_LOGADO, feitaAMao(NOVA));
      expect(await statusDe(s, NOVA)).toBe('done');
    });
  });

  it('com a execução enviada à plataforma: descartar e marcar como feita dão PT422', async () => {
    for (const [quem, sql] of [
      [DONO_2F, descartar],
      [GESTOR_LOGADO, feitaAMao],
    ] as Array<[Quem, (id: string) => string]>) {
      await caso(db, postgres, async (s) => {
        await acaoEm(s, 'approved');
        await execucao(s, 'sent');
        expect(await recusa(s, 'PT422', quem, sql(NOVA))).toBe('TRF-422');
        expect(await statusDe(s, NOVA)).toBe('approved');
      });
    }
  });

  it('em execução, à mão só com a execução bloqueada: na fila ou enviada, PT422', async () => {
    for (const [status, passa] of [
      ['blocked', true],
      ['queued', false],
      ['sent', false],
    ] as Array<['queued' | 'blocked' | 'sent', boolean]>) {
      await caso(db, postgres, async (s) => {
        await acaoEm(s, 'approved');
        await execucao(s, status);
        await pela(s, EXECUTOR, rodando(NOVA));
        if (passa) {
          await pela(s, GESTOR_LOGADO, feitaAMao(NOVA));
          expect(await statusDe(s, NOVA), status).toBe('done');
        } else {
          expect(await recusa(s, 'PT422', GESTOR_LOGADO, feitaAMao(NOVA)), status).toBe('TRF-422');
          expect(await statusDe(s, NOVA), status).toBe('running');
        }
      });
    }
  });
});

// ---------- O diário da ação ----------

describe('o diário da ação (gatilho traffic_actions_log)', () => {
  const sem = { before: null, after: 'approved' };

  it('a proposta e cada passagem, com quem fez: a pessoa pelo carimbo, o Claude, ou o sistema (o executor)', async () => {
    await caso(db, postgres, async (s) => {
      await acaoEm(s, 'approved');
      await pela(s, EXECUTOR, rodando(NOVA));
      await pela(s, EXECUTOR, falhou(NOVA));
      await pela(s, DONO_2F, aprovar(NOVA));
      await pela(s, EXECUTOR, feitaNaPlataforma(NOVA));
      expect(await diario(s, NOVA)).toEqual([
        { event: 'action_proposed', actor_kind: 'user', actor_id: GESTOR, changes: {} },
        {
          event: 'action_approved',
          actor_kind: 'user',
          actor_id: DONO,
          changes: { status: { before: 'idea', after: 'approved' } },
        },
        {
          event: 'action_running',
          actor_kind: 'system',
          actor_id: null,
          changes: { status: { before: 'approved', after: 'running' } },
        },
        {
          event: 'action_failed',
          actor_kind: 'system',
          actor_id: null,
          changes: { status: { before: 'running', after: 'failed' } },
        },
        {
          event: 'action_approved',
          actor_kind: 'user',
          actor_id: DONO,
          changes: { status: { before: 'failed', after: 'approved' } },
        },
        {
          event: 'action_done',
          actor_kind: 'system',
          actor_id: null,
          changes: { status: { before: 'approved', after: 'done' }, done_via: 'platform_api' },
        },
      ]);
    });
  });

  it('o descarte leva o motivo (nunca o texto); o "feita à mão", quem marcou; a aprovação junto com a proposta, duas linhas', async () => {
    await caso(db, postgres, async (s) => {
      await acaoEm(s, 'idea');
      await pela(s, DONO_2F, descartar(NOVA));
      await pela(s, DONO_2F, proposta({ id: OUTRA, aprovadoPor: 'auth' }));
      await pela(s, GESTOR_LOGADO, feitaAMao(OUTRA));
      expect(await diario(s, NOVA)).toEqual([
        { event: 'action_proposed', actor_kind: 'user', actor_id: GESTOR, changes: {} },
        {
          event: 'action_discarded',
          actor_kind: 'user',
          actor_id: DONO,
          changes: { status: { before: 'idea', after: 'discarded' }, discard_reason: 'duplicate' },
        },
      ]);
      expect(await diario(s, OUTRA)).toEqual([
        { event: 'action_proposed', actor_kind: 'user', actor_id: DONO, changes: {} },
        { event: 'action_approved', actor_kind: 'user', actor_id: DONO, changes: { status: sem } },
        {
          event: 'action_done',
          actor_kind: 'user',
          actor_id: GESTOR,
          changes: { status: { before: 'approved', after: 'done' }, done_via: 'manual' },
        },
      ]);
    });
  });

  it('a proposta do Claude é do Claude; a linha leva a marca, o canal e a campanha da ação', async () => {
    await caso(db, postgres, async (s) => {
      await pela(s, WORKER, proposta({ claude: 8, campanha: CAMPANHA_CLAUDE_CS }));
      await s.como(postgres);
      expect(
        await s.linhas(
          `select l.event::text, l.actor_kind::text, l.actor_id, b.code::text as marca, l.platform::text,
                  l.campaign_id::text
             from mkt.traffic_log l join mkt.brands b on b.id = l.brand_id
            where l.traffic_action_id = $1`,
          [NOVA],
        ),
      ).toEqual([
        {
          event: 'action_proposed',
          actor_kind: 'claude',
          actor_id: null,
          marca: 'cs',
          platform: 'meta',
          campaign_id: CAMPANHA_CLAUDE_CS,
        },
      ]);
    });
  });
});

describe('a chave campaigns.created_by_action_id', () => {
  it('aponta para uma ação que existe; sem a ação, 23503', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro(
        '23503',
        `insert into mkt.campaigns (ad_account_id, brand_id, platform, source, external_id, name, status, managed_by,
                                    created_by_action_id)
         values ($1, (select id from mkt.brands where code = 'cs'), 'meta', 'meta_ads', '120200000000007777',
                 'cs-nova-act-9999', 'paused', 'claude', $2)`,
        [CONTA_META_CS, NOVA],
      );
      expect(
        await s.linhas(
          `select confrelid::regclass::text as tabela, confdeltype from pg_constraint
            where conrelid = 'mkt.campaigns'::regclass and conname = 'campaigns_created_by_action'`,
        ),
      ).toEqual([{ tabela: 'mkt.traffic_actions', confdeltype: 'n' }]);
    });
  });

  it('quando a ação sai (a limpeza de 5 anos), a campanha fica sem ela, e o diário segura a ação enquanto aponta para ela', async () => {
    await caso(db, postgres, async (s) => {
      // A ação com diário não sai: o diário aponta para ela.
      await s.erro('23503', `delete from mkt.traffic_actions where id = '${ACAO_QUE_CRIOU}'`);
      // Sem o diário (a limpeza apaga o diário antes), a ação sai e a campanha fica sem ela.
      await s.exec(`alter table mkt.traffic_log disable trigger traffic_log_append_only`);
      await s.exec(`delete from mkt.traffic_log where traffic_action_id = '${ACAO_QUE_CRIOU}'`);
      await s.exec(`delete from mkt.traffic_actions where id = '${ACAO_QUE_CRIOU}'`);
      expect(
        await s.linhas('select managed_by::text, created_by_action_id from mkt.campaigns where id = $1', [
          CAMPANHA_CLAUDE_CS,
        ]),
      ).toEqual([{ managed_by: 'claude', created_by_action_id: null }]);
    });
  });
});

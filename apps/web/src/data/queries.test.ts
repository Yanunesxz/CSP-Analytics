import { describe, expect, it } from 'vitest';
import type {
  Campaign,
  Connector,
  Customer,
  DailyMetric,
  IgDaily,
  Lead,
  Order,
  TrafficAction,
} from '@csp-mkt/shared';
import { FILTROS_PADRAO, type Filtros } from '../lib/url-state';
import { DADOS_VAZIOS, type Dados } from './dados';
import {
  acoes,
  baseDeClientes,
  conectores,
  custoPorClienteNovo,
  filtrarPeriodo,
  funilChegada,
  instagram,
  kpisVisaoGeral,
  leadsPorOrigem,
  metricasPorCampanha,
  porOperador,
  seoGeo,
} from './queries';
import { gerarDadosDeExemplo } from './sample';

const agora = new Date('2026-10-30T15:00:00-03:00');
const f = (parcial: Partial<Filtros> = {}): Filtros => ({ ...FILTROS_PADRAO, ...parcial });
const iso = (dia: string, hora = 10) => `${dia}T${String(hora).padStart(2, '0')}:00:00-03:00`;

const campanha = (
  p: Partial<Campaign> & Pick<Campaign, 'id' | 'platform' | 'brandId' | 'managedBy' | 'utmCampaign'>,
): Campaign => ({
  externalId: `${p.platform}:${p.id}`,
  name: p.id,
  status: 'active',
  dailyBudgetCents: 10000,
  spendCapCents: 450000,
  ...p,
});

const metrica = (
  campaignId: string,
  date: string,
  p: Partial<DailyMetric>,
  campanhas: Campaign[],
): DailyMetric => {
  const c = campanhas.find((x) => x.id === campaignId)!;
  return {
    date,
    brandId: c.brandId,
    platform: c.platform,
    campaignId,
    spendCents: 0,
    impressions: 0,
    clicks: 0,
    leads: 0,
    conversions: 0,
    revenueCents: 0,
    ...p,
  };
};

const lead = (p: Partial<Lead> & Pick<Lead, 'id' | 'brandId' | 'source' | 'stage' | 'createdAt'>): Lead => ({
  code: p.id.toUpperCase(),
  utmCampaign: null,
  referrerHost: null,
  firstOrderAt: null,
  repId: null,
  crmCustomerId: null,
  ...p,
});

const cliente = (p: Partial<Customer> & Pick<Customer, 'id'>): Customer => ({
  code: p.id.toUpperCase(),
  brands: ['cs'],
  situation: 'active',
  firstOrderAt: null,
  lastOrderAt: null,
  ordersCount: 0,
  revenueCents: 0,
  repId: null,
  ...p,
});

const pedido = (
  id: string,
  customerId: string,
  brandId: Order['brandId'],
  createdAt: string,
  totalCents: number,
  status: Order['status'] = 'sent',
): Order => ({
  id,
  brandId,
  customerId,
  status,
  totalCents,
  invoicedTotalCents: null,
  createdAt,
});

const campaigns = [
  campanha({ id: 'c1', platform: 'meta', brandId: 'cs', managedBy: 'human', utmCampaign: 'cs-a' }),
  campanha({
    id: 'c2',
    platform: 'meta',
    brandId: 'cs',
    managedBy: 'claude',
    utmCampaign: 'cs-b',
    spendCapCents: 100000,
  }),
  campanha({ id: 'c3', platform: 'google', brandId: 'plumene', managedBy: 'human', utmCampaign: 'pl-c' }),
];

const acao = (
  p: Partial<TrafficAction> & Pick<TrafficAction, 'id' | 'proposedBy' | 'status' | 'createdAt' | 'kind'>,
): TrafficAction => ({
  brandId: 'cs',
  platform: 'meta',
  campaignId: 'c1',
  title: p.id,
  rationale: '',
  paramsJson: '{}',
  impact: 'medium',
  effort: 'low',
  costCents: null,
  approvedBy: null,
  approvedAt: null,
  executedAt: null,
  result: null,
  ...p,
});

const conector = (
  id: Connector['id'],
  status: Connector['status'],
  minutosAtras: number | null,
  expectedEveryMinutes: number,
): Connector => ({
  id,
  name: id,
  status,
  lastSyncAt: minutosAtras === null ? null : new Date(agora.getTime() - minutosAtras * 60_000).toISOString(),
  expectedEveryMinutes,
  errors24h: 0,
  rowsWritten: 10,
});

const dados: Dados = {
  ...DADOS_VAZIOS,
  campaigns,
  metrics: [
    metrica(
      'c1',
      '2026-10-05',
      { spendCents: 10000, impressions: 1000, clicks: 50, leads: 4, conversions: 1 },
      campaigns,
    ),
    metrica(
      'c1',
      '2026-10-10',
      { spendCents: 10000, impressions: 1000, clicks: 50, leads: 2, conversions: 1 },
      campaigns,
    ),
    metrica(
      'c1',
      '2026-09-15',
      { spendCents: 8000, impressions: 800, clicks: 40, leads: 3, conversions: 0 },
      campaigns,
    ),
    metrica(
      'c2',
      '2026-10-05',
      { spendCents: 5000, impressions: 500, clicks: 20, leads: 3, conversions: 1, revenueCents: 90000 },
      campaigns,
    ),
    metrica(
      'c3',
      '2026-10-06',
      { spendCents: 7000, impressions: 200, clicks: 10, leads: 3, conversions: 0 },
      campaigns,
    ),
  ],
  leads: [
    lead({
      id: 'l1',
      brandId: 'cs',
      source: 'meta',
      utmCampaign: 'cs-a',
      stage: 'first_order',
      createdAt: iso('2026-10-02'),
      firstOrderAt: iso('2026-10-08'),
      crmCustomerId: 'cli-1',
      repId: 'REP-01',
    }),
    lead({
      id: 'l2',
      brandId: 'cs',
      source: 'meta',
      utmCampaign: 'cs-a',
      stage: 'lead',
      createdAt: iso('2026-10-03'),
    }),
    lead({
      id: 'l3',
      brandId: 'cs',
      source: 'meta',
      utmCampaign: 'cs-b',
      stage: 'invoiced',
      createdAt: iso('2026-09-28'),
      firstOrderAt: iso('2026-10-04'),
      crmCustomerId: 'cli-2',
    }),
    lead({
      id: 'l4',
      brandId: 'plumene',
      source: 'organic',
      referrerHost: 'www.google.com',
      stage: 'prospect',
      createdAt: iso('2026-10-10'),
    }),
    lead({
      id: 'l5',
      brandId: null,
      source: 'sdr',
      stage: 'registered',
      createdAt: iso('2026-10-12'),
      crmCustomerId: 'cli-3',
    }),
    lead({
      id: 'l6',
      brandId: 'plumene',
      source: 'google',
      utmCampaign: 'pl-c',
      stage: 'first_order',
      createdAt: iso('2026-09-10'),
      firstOrderAt: iso('2026-09-20'),
      crmCustomerId: 'cli-4',
    }),
    lead({
      id: 'l7',
      brandId: 'cs',
      source: 'ai_assistant',
      referrerHost: 'chatgpt.com',
      stage: 'lead',
      createdAt: iso('2026-10-15'),
    }),
  ],
  customers: [
    cliente({ id: 'cli-1', firstOrderAt: iso('2026-10-08'), lastOrderAt: iso('2026-10-08'), ordersCount: 1 }),
    cliente({ id: 'cli-2', firstOrderAt: iso('2026-10-04'), lastOrderAt: iso('2026-10-04'), ordersCount: 1 }),
    cliente({ id: 'cli-3', situation: 'lead' }),
    cliente({
      id: 'cli-4',
      brands: ['plumene'],
      firstOrderAt: iso('2026-09-20'),
      lastOrderAt: iso('2026-09-20'),
      ordersCount: 1,
    }),
    cliente({
      id: 'cli-old',
      firstOrderAt: iso('2026-03-01'),
      lastOrderAt: iso('2026-10-20'),
      ordersCount: 9,
    }),
    cliente({
      id: 'cli-inat',
      brands: ['plumene'],
      situation: 'inactive_old',
      firstOrderAt: iso('2025-01-01'),
      lastOrderAt: iso('2026-10-22'),
      ordersCount: 4,
    }),
    cliente({
      id: 'cli-lost',
      situation: 'lost',
      firstOrderAt: iso('2024-01-01'),
      lastOrderAt: iso('2025-02-01'),
      ordersCount: 2,
    }),
  ],
  orders: [
    pedido('o1', 'cli-1', 'cs', iso('2026-10-08'), 100000),
    pedido('o2', 'cli-2', 'cs', iso('2026-10-04'), 200000, 'invoiced'),
    pedido('o3', 'cli-4', 'plumene', iso('2026-09-20'), 150000),
    pedido('o4', 'cli-old', 'cs', iso('2026-10-20'), 50000),
    pedido('o5', 'cli-inat', 'plumene', iso('2026-10-22'), 80000),
    pedido('o6', 'cli-inat', 'plumene', iso('2026-07-01'), 60000),
    pedido('o7', 'cli-old', 'cs', iso('2026-09-25'), 40000),
  ],
  igDaily: [
    { date: '2026-09-30', brandId: 'cs', followers: 95, reach: 5, impressions: 8, engagement: 1 },
    { date: '2026-10-01', brandId: 'cs', followers: 100, reach: 10, impressions: 15, engagement: 1 },
    { date: '2026-10-02', brandId: 'cs', followers: 110, reach: 20, impressions: 30, engagement: 2 },
  ] satisfies IgDaily[],
  actions: [
    acao({
      id: 'a1',
      proposedBy: 'claude',
      status: 'idea',
      kind: 'budget',
      createdAt: iso('2026-10-20'),
      costCents: 5000,
    }),
    acao({
      id: 'a2',
      proposedBy: 'human',
      status: 'done',
      kind: 'pause',
      createdAt: iso('2026-10-10'),
      approvedAt: iso('2026-10-10', 14),
      approvedBy: 'demo-owner',
      executedAt: iso('2026-10-11'),
    }),
    acao({
      id: 'a3',
      proposedBy: 'human',
      status: 'idea',
      kind: 'pending_fix',
      createdAt: iso('2026-10-01'),
      platform: null,
      campaignId: null,
    }),
  ],
  connectors: [
    conector('meta', 'ok', 10, 60),
    conector('tiktok', 'late', 200, 60),
    conector('ga4', 'simulated', null, 1440),
  ],
  geradoEm: agora.toISOString(),
};

describe('filtrarPeriodo', () => {
  it('aceita dia e instante ISO, inclusivo nas pontas, no dia de São Paulo', () => {
    const janela = { inicio: '2026-10-01', fim: '2026-10-30' };
    const linhas = [
      { d: '2026-10-01' },
      { d: '2026-10-30T23:59:00-03:00' },
      { d: '2026-10-31T01:00:00Z' },
      { d: '2026-09-30' },
      { d: null },
    ];
    expect(filtrarPeriodo(linhas, 'd', janela).map((l) => l.d)).toEqual([
      '2026-10-01',
      '2026-10-30T23:59:00-03:00',
      '2026-10-31T01:00:00Z',
    ]);
  });
});

describe('kpisVisaoGeral', () => {
  it('conta leads, clientes novos, investimento e custo por cliente novo, com o período anterior', () => {
    const k = kpisVisaoGeral(dados, f(), agora);
    expect(k.leads).toEqual({ atual: 5, anterior: 2, variacao: 1.5 });
    expect(k.clientesNovos).toEqual({ atual: 2, anterior: 1, variacao: 1 });
    expect(k.investimento).toEqual({ atual: 32000, anterior: 8000, variacao: 3 });
    expect(k.custoPorClienteNovo).toEqual({ atual: 16000, anterior: 8000, variacao: 1 });
    expect(k.custoPorLead.atual).toBe(16000);
    expect(k.pedidos).toEqual({ atual: 4, anterior: 2, variacao: 1 });
    expect(k.valorPedidos.atual).toBe(430000);
    expect(k.faturados.atual).toBe(1);
    expect(k.valorFaturado.atual).toBeNull();
    expect(k.alcanceInstagram).toEqual({ atual: 30, anterior: 5, variacao: 5 });
  });

  it('por canal e por marca', () => {
    const k = kpisVisaoGeral(dados, f(), agora);
    const meta = k.porCanal.find((c) => c.canal === 'meta')!;
    expect(meta.investimento.atual).toBe(25000);
    expect(meta.leads.atual).toBe(2);
    expect(meta.clientesNovos.atual).toBe(2);
    expect(meta.custoPorClienteNovo.atual).toBe(12500);
    const tiktok = k.porCanal.find((c) => c.canal === 'tiktok')!;
    expect(tiktok.investimento.atual).toBe(0);
    expect(tiktok.custoPorClienteNovo.atual).toBeNull();
    const cs = k.porMarca.find((m) => m.marca === 'cs')!;
    expect(cs.clientesNovos.atual).toBe(2);
  });

  it('marca escolhida inclui o lead sem marca; operador filtra pela campanha', () => {
    expect(kpisVisaoGeral(dados, f({ marca: 'cs' }), agora).leads.atual).toBe(4);
    expect(kpisVisaoGeral(dados, f({ marca: 'plumene' }), agora).leads.atual).toBe(2);
    const claude = kpisVisaoGeral(dados, f({ operador: 'claude' }), agora);
    expect(claude.investimento.atual).toBe(5000);
    expect(claude.leads.atual).toBe(0);
    expect(claude.custoPorClienteNovo.atual).toBe(5000);
  });

  it('sem comparar, o anterior e a variação ficam nulos', () => {
    const k = kpisVisaoGeral(dados, f({ comparar: false }), agora);
    expect(k.leads).toEqual({ atual: 5, anterior: null, variacao: null });
  });

  it('conjunto vazio devolve null em tudo, nunca 0 nem NaN', () => {
    const k = kpisVisaoGeral({ ...DADOS_VAZIOS }, f(), agora);
    for (const m of [
      k.leads,
      k.clientesNovos,
      k.custoPorClienteNovo,
      k.investimento,
      k.pedidos,
      k.valorPedidos,
      k.alcanceInstagram,
    ]) {
      expect(m).toEqual({ atual: null, anterior: null, variacao: null });
    }
    expect(k.porCanal.every((c) => c.custoPorClienteNovo.atual === null)).toBe(true);
    expect(JSON.stringify(k)).not.toContain('NaN');
  });
});

describe('funilChegada', () => {
  it('etapas acumuladas com taxas', () => {
    const fu = funilChegada(dados, f(), agora);
    expect(fu.etapas.map((e) => e.total)).toEqual([5, 3, 2, 1, 0]);
    expect(fu.etapas[0]!.taxa).toBeNull();
    expect(fu.etapas[1]!.taxa).toBeCloseTo(0.6);
    expect(fu.etapas[4]!.taxa).toBe(0);
    expect(fu.tempoMedioAtePedidoDias).toBe(6);
    expect(fu.porOrigem.find((o) => o.origem === 'meta')).toMatchObject({
      leads: 2,
      clientesNovos: 1,
      taxa: 0.5,
    });
    expect(fu.coorte).toHaveLength(4);
    expect(fu.coorte[3]).toMatchObject({ mes: '2026-10', leads: 5 });
  });

  it('do 1º pedido em diante só conta quem tem o carimbo do pedido (a mesma regra de cliente novo)', () => {
    const semCarimbo: Dados = {
      ...dados,
      leads: [
        ...dados.leads,
        lead({ id: 'l8', brandId: 'cs', source: 'site', stage: 'first_order', createdAt: iso('2026-10-20') }),
      ],
    };
    expect(funilChegada(semCarimbo, f(), agora).etapas.map((e) => e.total)).toEqual([6, 4, 3, 1, 0]);
  });

  it('coorte com os 4 meses certos também no dia 31 e no fim de março', () => {
    const meses = (instante: string) => funilChegada(dados, f(), new Date(instante)).coorte.map((m) => m.mes);
    expect(meses('2026-10-31T15:00:00-03:00')).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    expect(meses('2027-03-30T15:00:00-03:00')).toEqual(['2026-12', '2027-01', '2027-02', '2027-03']);
    expect(meses('2026-12-31T15:00:00-03:00')).toEqual(['2026-09', '2026-10', '2026-11', '2026-12']);
  });
});

describe('custoPorClienteNovo', () => {
  it('marca × canal com total', () => {
    const c = custoPorClienteNovo(dados, f(), agora);
    expect(c.linhas).toHaveLength(6);
    const csMeta = c.linhas.find((l) => l.marca === 'cs' && l.canal === 'meta')!;
    expect(csMeta.investimento.atual).toBe(25000);
    expect(csMeta.clientesNovos.atual).toBe(2);
    expect(csMeta.custo.atual).toBe(12500);
    expect(c.total.custo).toEqual({ atual: 16000, anterior: 8000, variacao: 1 });
    expect(c.porCanal.find((l) => l.canal === 'google')!.custo.atual).toBeNull();
  });
});

describe('metricasPorCampanha e porOperador', () => {
  it('uma linha por campanha, com CPL, ROAS e uso do teto', () => {
    const m = metricasPorCampanha(dados, f(), agora);
    expect(m.linhas.map((l) => l.campanha.id)).toEqual(['c1', 'c3', 'c2']);
    const c2 = m.linhas.find((l) => l.campanha.id === 'c2')!;
    expect(c2.cpl.atual).toBeCloseTo(5000 / 3);
    expect(c2.roas.atual).toBe(18);
    expect(c2.usoDoTeto).toBe(0.05);
    expect(m.linhas.find((l) => l.campanha.id === 'c1')!.roas.atual).toBeNull();
    expect(m.totais.investimento.atual).toBe(32000);
    expect(m.serie).toHaveLength(30);
    expect(m.serie.find((s) => s.date === '2026-10-05')!.investimento).toBe(15000);
  });

  it('Humano × Claude na mesma linha com diferença em %', () => {
    const o = porOperador(dados, f(), agora);
    const inv = o.linhas.find((l) => l.chave === 'investimento')!;
    expect(inv.humano).toBe(27000);
    expect(inv.claude).toBe(5000);
    expect(inv.diferenca).toBeCloseTo((5000 - 27000) / 27000);
    const cpl = o.linhas.find((l) => l.chave === 'cpl')!;
    expect(cpl.humano).toBe(3000);
    expect(cpl.claude).toBeCloseTo(5000 / 3);
    expect(cpl.menorEhMelhor).toBe(true);
    expect(o.porCanal.find((c) => c.canal === 'meta')!.claude.leads).toBe(3);
    expect(o.linhas.find((l) => l.chave === 'acoesPropostas')).toMatchObject({ humano: 2, claude: 1 });
  });
});

describe('baseDeClientes', () => {
  it('antigos, recompra, reativados e participação na receita', () => {
    const b = baseDeClientes(dados, f(), agora);
    expect(b.total).toBe(7);
    expect(b.antigos).toBe(4);
    expect(b.recompraram.atual).toBe(2);
    expect(b.taxaRecompra.atual).toBe(0.5);
    expect(b.reativados.atual).toBe(1);
    expect(b.receitaAntigos.atual).toBe(130000);
    expect(b.receitaNovos.atual).toBe(300000);
    expect(b.participacaoAntigos.atual).toBeCloseTo(130000 / 430000);
    expect(b.inativosAntigos).toBe(1);
    expect(b.perdidos).toBe(1);
    expect(b.lista.find((c) => c.id === 'cli-inat')).toMatchObject({
      reativado: true,
      comprouNoPeriodo: true,
      diasDesdeUltimaCompra: 8,
    });
  });
});

describe('leadsPorOrigem, instagram, seoGeo', () => {
  it('leads por origem com custo por lead só em canal pago', () => {
    const l = leadsPorOrigem(dados, f(), agora);
    expect(l.total.atual).toBe(5);
    expect(l.semMarca).toBe(1);
    expect(l.linhas[0]).toMatchObject({ origem: 'meta', clientesNovos: 1, custoPorLead: 12500 });
    expect(l.linhas.find((x) => x.origem === 'organic')!.custoPorLead).toBeNull();
    expect(l.porDia).toHaveLength(30);
    expect(l.lista[0]!.code).toBe('L7');
    expect(l.lista.find((x) => x.id === 'l1')!.linkCrm).toContain('cli-1');
    expect(JSON.stringify(l.lista)).not.toMatch(/nome|telefone|email/);
  });

  it('instagram por marca', () => {
    const i = instagram(dados, f({ marca: 'cs' }), agora);
    expect(i.porMarca[0]).toMatchObject({ marca: 'cs', seguidores: 110, posts: null });
    expect(i.porMarca[0]!.variacaoSeguidores.atual).toBe(15);
    expect(i.porMarca[0]!.alcance.atual).toBe(30);
    expect(i.serie).toHaveLength(30);
  });

  it('seo e geo sem dados devolvem null e séries vazias de valor', () => {
    const s = seoGeo(dados, f(), agora);
    expect(s.seo.impressoes.atual).toBeNull();
    expect(s.geo.sessoes.atual).toBeNull();
    expect(s.geo.leadsPorAssistente.atual).toBe(1);
    expect(s.seo.serie).toHaveLength(30);
  });

  it('posição média ponderada pelas impressões; sem impressões é null, nunca 0', () => {
    const comSeo: Dados = {
      ...dados,
      seoDaily: [
        { date: '2026-10-10', brandId: 'cs', impressions: 300, clicks: 9, position: 4 },
        { date: '2026-10-11', brandId: 'cs', impressions: 100, clicks: 1, position: 12 },
        { date: '2026-09-10', brandId: 'cs', impressions: 0, clicks: 0, position: 7 },
      ],
    };
    const s = seoGeo(comSeo, f(), agora);
    expect(s.seo.posicaoMedia.atual).toBe(6);
    expect(s.seo.posicaoMedia.anterior).toBeNull();
    expect(s.seo.posicaoMedia.variacao).toBeNull();
  });
});

describe('acoes e conectores', () => {
  it('fila de aprovação sem pendências de medição, resumo e tetos', () => {
    const a = acoes(dados, f(), agora);
    expect(a.filaDeAprovacao.map((x) => x.id)).toEqual(['a1']);
    expect(a.pendencias.map((x) => x.id)).toEqual(['a3']);
    expect(a.porStatus).toMatchObject({ idea: 2, done: 1, approved: 0 });
    expect(a.resumo.custoEstimadoDaFilaCents).toBe(5000);
    expect(a.resumo.tempoMedioAteAprovacaoHoras).toBe(4);
    expect(a.tetos.find((t) => t.marca === 'cs' && t.canal === 'meta')).toMatchObject({
      investimento: 25000,
      teto: 550000,
      campanhasAtivas: 2,
    });
    expect(acoes(dados, f({ operador: 'claude' }), agora).lista.map((x) => x.id)).toEqual(['a1']);
  });

  it('conectores com atraso', () => {
    const c = conectores(dados, agora);
    expect(c.lista.find((x) => x.id === 'tiktok')).toMatchObject({ atrasoMinutos: 140, atrasado: true });
    expect(c.lista.find((x) => x.id === 'meta')).toMatchObject({ atrasoMinutos: 0, atrasado: false });
    expect(c.lista.find((x) => x.id === 'ga4')).toMatchObject({
      minutosDesdeSync: null,
      atrasoMinutos: null,
    });
    expect(c.resumo).toEqual({ ok: 1, late: 1, down: 0, simulated: 1 });
    expect(conectores({ ...DADOS_VAZIOS }, agora).resumo.ok).toBeNull();
  });
});

describe('com os dados de exemplo', () => {
  const exemplo = gerarDadosDeExemplo({ agora });

  it('a tarefa principal tem número: custo por cliente novo por marca e canal, comparado ao mês anterior', () => {
    const c = custoPorClienteNovo(exemplo, f(), agora);
    expect(c.linhas).toHaveLength(6);
    expect(c.total.custo.atual).toBeGreaterThan(0);
    expect(c.total.custo.anterior).toBeGreaterThan(0);
    expect(c.linhas.filter((l) => l.custo.atual !== null).length).toBeGreaterThanOrEqual(4);
  });

  it('Humano × Claude com CPL diferente e nada de NaN', () => {
    const o = porOperador(exemplo, f({ periodo: '90d' }), agora);
    const cpl = o.linhas.find((l) => l.chave === 'cpl')!;
    expect(cpl.humano).not.toBeNull();
    expect(cpl.claude).not.toBeNull();
    expect(cpl.humano).not.toBe(cpl.claude);
    const tudo = JSON.stringify([
      kpisVisaoGeral(exemplo, f(), agora),
      funilChegada(exemplo, f(), agora),
      metricasPorCampanha(exemplo, f(), agora),
      baseDeClientes(exemplo, f(), agora),
      leadsPorOrigem(exemplo, f(), agora),
      instagram(exemplo, f(), agora),
      seoGeo(exemplo, f(), agora),
      acoes(exemplo, f(), agora),
      conectores(exemplo, agora),
    ]);
    expect(tudo).not.toContain('NaN');
    expect(tudo).not.toContain('Infinity');
  });
});

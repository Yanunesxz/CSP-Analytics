import { describe, expect, it } from 'vitest';
import type { Campaign, Connector, DailyMetric, Lead, TrafficAction } from '@csp-mkt/shared';
import { FILTROS_PADRAO, type Filtros } from '../../lib/url-state';
import { DADOS_VAZIOS, type Dados } from '../dados';
import { gerarDadosDeExemplo } from '../sample';
import { CONSULTA_DO_CANAL, orcamentoPedido, painelDoCanal } from './canais';

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

const campanhas: Campaign[] = [
  campanha({ id: 'm1', platform: 'meta', brandId: 'cs', managedBy: 'human', utmCampaign: 'cs-meta-a' }),
  campanha({
    id: 'm2',
    platform: 'meta',
    brandId: 'cs',
    managedBy: 'claude',
    utmCampaign: 'cs-meta-b',
    dailyBudgetCents: 20000,
    spendCapCents: 900000,
  }),
  campanha({
    id: 'm3',
    platform: 'meta',
    brandId: 'plumene',
    managedBy: 'claude',
    utmCampaign: 'pl-meta-c',
    status: 'paused',
    dailyBudgetCents: 5000,
  }),
  campanha({ id: 't1', platform: 'tiktok', brandId: 'cs', managedBy: 'claude', utmCampaign: 'cs-tt-a' }),
  campanha({ id: 'g1', platform: 'google', brandId: 'plumene', managedBy: 'claude', utmCampaign: 'pl-g-a' }),
  campanha({ id: 'g2', platform: 'google', brandId: 'cs', managedBy: 'human', utmCampaign: 'cs-g-b' }),
];

const metrica = (campaignId: string, date: string, p: Partial<DailyMetric>): DailyMetric => {
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

const acao = (p: Partial<TrafficAction> & Pick<TrafficAction, 'id' | 'kind' | 'status'>): TrafficAction => ({
  proposedBy: 'claude',
  brandId: 'cs',
  platform: 'meta',
  campaignId: null,
  title: p.id,
  rationale: 'Motivo de teste.',
  paramsJson: '{}',
  impact: 'medium',
  effort: 'low',
  costCents: null,
  createdAt: iso('2026-10-20'),
  approvedBy: null,
  approvedAt: null,
  executedAt: null,
  result: null,
  ...p,
});

const conector = (p: Pick<Connector, 'id' | 'status' | 'lastSyncAt'>): Connector => ({
  name: p.id,
  expectedEveryMinutes: 60,
  errors24h: 0,
  rowsWritten: 100,
  ...p,
});

const dados: Dados = {
  ...DADOS_VAZIOS,
  campaigns: campanhas,
  metrics: [
    metrica('m1', '2026-10-05', {
      spendCents: 15000,
      impressions: 10000,
      clicks: 200,
      leads: 5,
      conversions: 1,
    }),
    metrica('m1', '2026-10-06', { spendCents: 5000, impressions: 2000, clicks: 40, leads: 1 }),
    metrica('m2', '2026-10-05', {
      spendCents: 10000,
      impressions: 5000,
      clicks: 100,
      leads: 4,
      conversions: 2,
      revenueCents: 50000,
    }),
    metrica('m2', '2026-09-10', { spendCents: 8000, leads: 2 }),
    metrica('m3', '2026-10-02', { spendCents: 3000, leads: 1 }),
    metrica('t1', '2026-10-05', { spendCents: 7000, leads: 2 }),
    metrica('g1', '2026-10-05', { spendCents: 9000 }),
  ],
  leads: [
    lead({
      id: 'l1',
      brandId: 'cs',
      source: 'meta',
      utmCampaign: 'cs-meta-a',
      stage: 'first_order',
      createdAt: iso('2026-10-03'),
      firstOrderAt: iso('2026-10-10'),
      crmCustomerId: 'cli-1',
    }),
    lead({
      id: 'l2',
      brandId: 'cs',
      source: 'meta',
      utmCampaign: 'cs-meta-b',
      stage: 'invoiced',
      createdAt: iso('2026-10-04'),
      firstOrderAt: iso('2026-10-12'),
      crmCustomerId: 'cli-2',
    }),
    lead({
      id: 'l3',
      brandId: 'plumene',
      source: 'meta',
      utmCampaign: 'pl-meta-c',
      stage: 'lead',
      createdAt: iso('2026-10-07'),
    }),
    lead({ id: 'l4', brandId: null, source: 'sdr', stage: 'lead', createdAt: iso('2026-10-08') }),
  ],
  actions: [
    acao({ id: 'a1', kind: 'budget', status: 'idea', campaignId: 'm2', costCents: 60000 }),
    acao({
      id: 'a2',
      kind: 'pause',
      status: 'approved',
      proposedBy: 'human',
      campaignId: 'm1',
      approvedBy: 'demo-owner',
      approvedAt: iso('2026-10-21'),
    }),
    acao({ id: 'a3', kind: 'budget', status: 'idea', platform: 'tiktok', campaignId: 't1' }),
    acao({
      id: 'a4',
      kind: 'budget',
      status: 'running',
      campaignId: 'm2',
      paramsJson: JSON.stringify({ dailyBudgetCents: 24000 }),
      approvedBy: 'demo-owner',
      approvedAt: iso('2026-10-22'),
    }),
    acao({ id: 'a5', kind: 'pending_fix', status: 'idea', proposedBy: 'human', platform: null }),
    acao({ id: 'a6', kind: 'pause', status: 'done', campaignId: 'm2' }),
  ],
  connectors: [
    conector({ id: 'meta', status: 'ok', lastSyncAt: '2026-10-30T14:40:00-03:00' }),
    conector({ id: 'tiktok', status: 'late', lastSyncAt: '2026-10-30T11:00:00-03:00' }),
    conector({ id: 'google_ads', status: 'down', lastSyncAt: '2026-10-29T08:00:00-03:00' }),
  ],
  geradoEm: '2026-10-30T14:00:00-03:00',
};

describe('painelDoCanal', () => {
  it('KPIs e campanhas só da plataforma da rota, com o período anterior', () => {
    const p = painelDoCanal('meta', dados, f(), agora);
    expect(p.plataforma).toBe('meta');
    expect(p.campanhas.map((l) => l.campanha.id)).toEqual(['m1', 'm2', 'm3']);
    expect(p.totais.investimento).toEqual({ atual: 33000, anterior: 8000, variacao: 25000 / 8000 });
    expect(p.totais.leads.atual).toBe(11);
    expect(p.totais.ctr.atual).toBeCloseTo(340 / 17000);
    expect(p.totais.roas.atual).toBeCloseTo(50000 / 33000);
    expect(p.totais.clientesNovos.atual).toBe(2);
    expect(p.totais.custoPorClienteNovo.atual).toBe(16500);
  });

  it('o canal vem da rota, não do filtro ?canal=', () => {
    const p = painelDoCanal('meta', dados, f({ canal: 'tiktok' }), agora);
    expect(p.campanhas.map((l) => l.campanha.id)).toEqual(['m1', 'm2', 'm3']);
    expect(painelDoCanal('tiktok', dados, f(), agora).campanhas.map((l) => l.campanha.id)).toEqual(['t1']);
  });

  it('ações abertas (aprovadas ou em execução) de pausa e orçamento por campanha', () => {
    const p = painelDoCanal('meta', dados, f(), agora);
    const porId = (id: string) => p.campanhas.find((l) => l.campanha.id === id)!.acoesAbertas;
    expect(porId('m1')).toEqual([{ id: 'a2', kind: 'pause', status: 'approved', dailyBudgetCents: null }]);
    expect(porId('m2')).toEqual([{ id: 'a4', kind: 'budget', status: 'running', dailyBudgetCents: 24000 }]);
    expect(porId('m3')).toEqual([]);
  });

  it('fila de propostas do canal sem pendência de medição nem outra plataforma', () => {
    expect(painelDoCanal('meta', dados, f(), agora).propostas.map((a) => a.id)).toEqual(['a1']);
    expect(painelDoCanal('tiktok', dados, f(), agora).propostas.map((a) => a.id)).toEqual(['a3']);
    expect(painelDoCanal('meta', dados, f({ operador: 'human' }), agora).propostas).toEqual([]);
  });

  it('séries por operador somam o investimento do período', () => {
    const p = painelDoCanal('meta', dados, f(), agora);
    expect(p.series.map((s) => s.operador)).toEqual(['human', 'claude']);
    const somar = (operador: string) =>
      p.series.find((s) => s.operador === operador)!.pontos.reduce((t, x) => t + x.investimento, 0);
    expect(somar('human')).toBe(20000);
    expect(somar('claude')).toBe(13000);
    expect(p.series[0]!.pontos).toHaveLength(30);
    expect(p.series[0]!.pontos.find((x) => x.date === '2026-10-05')).toEqual({
      date: '2026-10-05',
      investimento: 15000,
      leads: 5,
    });
  });

  it('filtro de operador: KPIs, campanhas e série de um só; chips e Humano × Claude seguem com os dois', () => {
    const p = painelDoCanal('meta', dados, f({ operador: 'claude' }), agora);
    expect(p.campanhas.map((l) => l.campanha.id)).toEqual(['m2', 'm3']);
    expect(p.series.map((s) => s.operador)).toEqual(['claude']);
    expect(p.campanhasPorOperador).toEqual({ human: 1, claude: 2 });
    const inv = p.humanoXClaude.find((l) => l.chave === 'investimento')!;
    expect(inv).toMatchObject({ humano: 20000, claude: 13000 });
  });

  it('Humano × Claude com o sentido de cada diferença: custo menor, ROAS maior, volume neutro', () => {
    const linhas = painelDoCanal('meta', dados, f(), agora).humanoXClaude;
    const sentido = (chave: string) => linhas.find((l) => l.chave === chave)!.sentido;
    expect(sentido('cpl')).toBe('menor');
    expect(sentido('cpa')).toBe('menor');
    expect(sentido('custoPorClienteNovo')).toBe('menor');
    expect(sentido('roas')).toBe('maior');
    expect(sentido('investimento')).toBe('neutro');
    expect(sentido('leads')).toBe('neutro');
    expect(sentido('clientesNovos')).toBe('neutro');
  });

  it('verba e teto por conta (marca × plataforma) só com campanhas ativas', () => {
    const p = painelDoCanal('meta', dados, f(), agora);
    expect(p.contas.map((c) => c.marca)).toEqual(['cs', 'plumene']);
    expect(p.contas[0]).toEqual({
      marca: 'cs',
      verbaDiaria: 30000,
      teto: 1350000,
      investimento: 30000,
      uso: 30000 / 1350000,
      campanhasAtivas: 2,
      ativasDoClaude: 1,
    });
    expect(p.contas[1]).toMatchObject({
      marca: 'plumene',
      verbaDiaria: 0,
      teto: 0,
      uso: null,
      campanhasAtivas: 0,
    });
    expect(painelDoCanal('meta', dados, f({ marca: 'plumene' }), agora).contas.map((c) => c.marca)).toEqual([
      'plumene',
    ]);
  });

  it('parar tudo conta as ativas do Claude da marca em todos os canais', () => {
    expect(painelDoCanal('meta', dados, f(), agora).pararTudo).toEqual({
      total: 3,
      porCanal: [
        { canal: 'meta', total: 1 },
        { canal: 'tiktok', total: 1 },
        { canal: 'google', total: 1 },
      ],
    });
    expect(painelDoCanal('meta', dados, f({ marca: 'plumene' }), agora).pararTudo.total).toBe(1);
  });

  it('chips, opções de campanha e conector da plataforma', () => {
    const p = painelDoCanal('meta', dados, f({ marca: 'cs' }), agora);
    expect(p.campanhasPorOperador).toEqual({ human: 1, claude: 1 });
    expect(p.opcoesDeCampanha).toEqual([
      { valor: 'm1', rotulo: 'm1' },
      { valor: 'm2', rotulo: 'm2' },
    ]);
    expect(p.conector).toMatchObject({ id: 'meta', atrasado: false, minutosDesdeSync: 20 });
    expect(painelDoCanal('tiktok', dados, f(), agora).conector).toMatchObject({
      id: 'tiktok',
      atrasado: true,
    });
    expect(painelDoCanal('google', dados, f(), agora).conector).toMatchObject({
      id: 'google_ads',
      status: 'down',
    });
  });

  it('conjunto vazio devolve null em tudo, nunca 0 nem NaN', () => {
    const p = painelDoCanal('meta', { ...DADOS_VAZIOS }, f(), agora);
    expect(p.totais.investimento.atual).toBeNull();
    expect(p.totais.cpl.atual).toBeNull();
    expect(p.totais.clientesNovos.atual).toBeNull();
    expect(p.campanhas).toEqual([]);
    expect(p.series).toEqual([]);
    expect(p.contas.every((c) => c.verbaDiaria === null && c.teto === null && c.uso === null)).toBe(true);
    expect(p.campanhasPorOperador).toEqual({ human: null, claude: null });
    expect(p.pararTudo.total).toBeNull();
    expect(p.propostas).toEqual([]);
    expect(p.conector).toBeNull();
    expect(JSON.stringify(p)).not.toContain('NaN');
  });

  it('a consulta de cada plataforma é estável e igual a painelDoCanal', () => {
    expect(CONSULTA_DO_CANAL.meta).toBe(CONSULTA_DO_CANAL.meta);
    expect(CONSULTA_DO_CANAL.google(dados, f(), agora)).toEqual(painelDoCanal('google', dados, f(), agora));
  });
});

describe('orcamentoPedido', () => {
  it('lê o orçamento diário de uma ação de orçamento', () => {
    expect(orcamentoPedido('{"dailyBudgetCents":24000}')).toBe(24000);
    expect(orcamentoPedido('{}')).toBeNull();
    expect(orcamentoPedido('{"dailyBudgetCents":"muito"}')).toBeNull();
    expect(orcamentoPedido('não é json')).toBeNull();
  });
});

describe('com os dados de exemplo', () => {
  const exemplo = gerarDadosDeExemplo({ agora });

  it('as três plataformas têm campanhas dos dois operadores e nada de NaN', () => {
    for (const plataforma of ['meta', 'tiktok', 'google'] as const) {
      const p = painelDoCanal(plataforma, exemplo, f({ periodo: '90d' }), agora);
      expect(p.campanhas.length).toBeGreaterThan(0);
      expect(p.totais.investimento.atual).toBeGreaterThan(0);
      const texto = JSON.stringify(p);
      expect(texto).not.toContain('NaN');
      expect(texto).not.toContain('Infinity');
      const totalDasSeries = p.series.reduce(
        (t, s) => t + s.pontos.reduce((u, x) => u + x.investimento, 0),
        0,
      );
      expect(totalDasSeries).toBe(p.totais.investimento.atual);
    }
  });
});

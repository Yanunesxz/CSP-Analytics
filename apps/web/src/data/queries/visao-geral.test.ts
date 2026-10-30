import { describe, expect, it } from 'vitest';
import type { Campaign, DailyMetric, Lead, TrafficAction } from '@csp-mkt/shared';
import { FILTROS_PADRAO, type Filtros } from '../../lib/url-state';
import { DADOS_VAZIOS, type Dados } from '../dados';
import { custoPorClienteNovo, kpisVisaoGeral, porOperador } from '../queries';
import { gerarDadosDeExemplo } from '../sample';
import { LIMITE_DE_ALERTA, LINHAS_HUMANO_CLAUDE, visaoGeral } from './visao-geral';

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

const campaigns: Campaign[] = [
  campanha({ id: 'c1', platform: 'meta', brandId: 'cs', managedBy: 'human', utmCampaign: 'cs-a' }),
  campanha({
    id: 'c2',
    platform: 'meta',
    brandId: 'cs',
    managedBy: 'claude',
    utmCampaign: 'cs-b',
    dailyBudgetCents: 5000,
    spendCapCents: 100000,
  }),
  campanha({
    id: 'c3',
    platform: 'google',
    brandId: 'plumene',
    managedBy: 'human',
    utmCampaign: 'pl-c',
    dailyBudgetCents: 8000,
    spendCapCents: 200000,
  }),
  campanha({
    id: 'c4',
    platform: 'tiktok',
    brandId: 'cs',
    managedBy: 'claude',
    utmCampaign: 'cs-t',
    status: 'paused',
    dailyBudgetCents: 6000,
    spendCapCents: 300000,
  }),
];

const metrica = (campaignId: string, date: string, p: Partial<DailyMetric>): DailyMetric => {
  const c = campaigns.find((x) => x.id === campaignId)!;
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

const dados: Dados = {
  ...DADOS_VAZIOS,
  campaigns,
  metrics: [
    metrica('c1', '2026-10-05', { spendCents: 10000, leads: 4 }),
    metrica('c1', '2026-10-10', { spendCents: 10000, leads: 2 }),
    metrica('c1', '2026-09-15', { spendCents: 8000, leads: 3 }),
    metrica('c2', '2026-10-05', { spendCents: 92000, leads: 10 }),
    metrica('c3', '2026-10-06', { spendCents: 185000, leads: 5 }),
    metrica('c4', '2026-10-07', { spendCents: 3000, leads: 1 }),
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
      stage: 'prospect',
      createdAt: iso('2026-10-10'),
    }),
    lead({ id: 'l5', brandId: null, source: 'sdr', stage: 'registered', createdAt: iso('2026-10-12') }),
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
    lead({ id: 'l7', brandId: 'cs', source: 'ai_assistant', stage: 'lead', createdAt: iso('2026-10-15') }),
    // Mesmo cliente do l1: conta uma vez só como cliente novo
    lead({
      id: 'l8',
      brandId: 'cs',
      source: 'site',
      stage: 'first_order',
      createdAt: iso('2026-10-03', 16),
      firstOrderAt: iso('2026-10-08', 18),
      crmCustomerId: 'cli-1',
    }),
    lead({
      id: 'l9',
      brandId: 'plumene',
      source: 'google',
      utmCampaign: 'pl-c',
      stage: 'first_order',
      createdAt: iso('2026-10-11'),
      // 23:30 em São Paulo ainda é dia 20 (02:30 UTC do dia 21)
      firstOrderAt: '2026-10-21T02:30:00Z',
      crmCustomerId: 'cli-5',
    }),
  ],
  actions: [
    acao({ id: 'a1', proposedBy: 'claude', status: 'idea', kind: 'budget', createdAt: iso('2026-10-20') }),
    acao({ id: 'a2', proposedBy: 'human', status: 'done', kind: 'pause', createdAt: iso('2026-10-10') }),
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
  geradoEm: agora.toISOString(),
};

const somaDe = (valores: Array<number | null>) => valores.reduce<number>((s, v) => s + (v ?? 0), 0);

describe('visaoGeral', () => {
  it('traz os números do período iguais aos de kpisVisaoGeral', () => {
    const v = visaoGeral(dados, f(), agora);
    const k = kpisVisaoGeral(dados, f(), agora);
    expect(v.intervalo).toEqual(k.intervalo);
    expect(v.numeros.leads).toEqual(k.leads);
    expect(v.numeros.clientesNovos).toEqual({ atual: 3, anterior: 1, variacao: 2 });
    expect(v.numeros.investimento).toEqual({ atual: 300000, anterior: 8000, variacao: 36.5 });
    expect(v.numeros.custoPorClienteNovo).toEqual({ atual: 100000, anterior: 8000, variacao: 11.5 });
    expect(v.numeros.valorFaturado.atual).toBeNull();
  });

  it('o divisor do custo são os clientes novos que vieram de campanha', () => {
    const v = visaoGeral(dados, f(), agora);
    expect(v.clientesNovosDeCampanha).toBe(3);
    expect(v.numeros.investimento.atual! / v.clientesNovosDeCampanha!).toBe(
      v.numeros.custoPorClienteNovo.atual,
    );
  });

  it('leads e clientes novos por dia, no dia de São Paulo, com o cliente contado uma vez', () => {
    const v = visaoGeral(dados, f(), agora);
    expect(v.porDia).toHaveLength(30);
    expect(v.porDia[0]!.date).toBe('2026-10-01');
    expect(v.porDia[29]!.date).toBe('2026-10-30');
    const dia = (d: string) => v.porDia.find((p) => p.date === d)!;
    expect(dia('2026-10-03')).toEqual({ date: '2026-10-03', leads: 2, clientesNovos: 0 });
    expect(dia('2026-10-04').clientesNovos).toBe(1);
    expect(dia('2026-10-08').clientesNovos).toBe(1);
    expect(dia('2026-10-20').clientesNovos).toBe(1);
    expect(dia('2026-10-21').clientesNovos).toBe(0);
    expect(somaDe(v.porDia.map((p) => p.leads))).toBe(7);
    expect(somaDe(v.porDia.map((p) => p.clientesNovos))).toBe(3);
  });

  it('sinaliza os leads sem marca, que entram nas duas marcas', () => {
    expect(visaoGeral(dados, f(), agora).leadsSemMarca).toBe(1);
    expect(visaoGeral(dados, f({ marca: 'plumene' }), agora).leadsSemMarca).toBe(1);
    expect(visaoGeral(dados, f({ canal: 'meta' }), agora).leadsSemMarca).toBe(0);
  });

  it('por marca e por canal seguem o contexto e o filtro', () => {
    const todas = visaoGeral(dados, f(), agora);
    expect(todas.porMarca.map((l) => l.marca)).toEqual(['cs', 'plumene']);
    expect(todas.porCanal.map((l) => l.canal)).toEqual(['meta', 'tiktok', 'google']);
    const cs = todas.porMarca.find((l) => l.marca === 'cs')!;
    expect(cs.investimento.atual).toBe(115000);
    expect(cs.leads.atual).toBe(2);
    expect(cs.clientesNovos.atual).toBe(2);
    expect(cs.custo.atual).toBe(57500);
    const tiktok = todas.porCanal.find((l) => l.canal === 'tiktok')!;
    expect(tiktok.investimento.atual).toBe(3000);
    expect(tiktok.custo.atual).toBeNull();
    expect(todas.porCanal.find((l) => l.canal === 'meta')!.custo.atual).toBe(56000);

    const soCs = visaoGeral(dados, f({ marca: 'cs' }), agora);
    expect(soCs.porMarca.map((l) => l.marca)).toEqual(['cs']);
    expect(soCs.porCanal).toHaveLength(3);
    const soMeta = visaoGeral(dados, f({ canal: 'meta' }), agora);
    expect(soMeta.porCanal.map((l) => l.canal)).toEqual(['meta']);
    expect(soMeta.porMarca).toHaveLength(2);
  });

  it('na visão Visualizador não calcula o bloco do gestor', () => {
    expect(visaoGeral(dados, f(), agora).gestor).toBeNull();
  });

  it('na visão Gestor: Humano × Claude na ordem da tela, com o lado melhor de cada linha', () => {
    const g = visaoGeral(dados, f({ visao: 'gestor' }), agora).gestor!;
    expect(g.humanoClaude.map((l) => l.chave)).toEqual([...LINHAS_HUMANO_CLAUDE]);
    const op = porOperador(dados, f({ visao: 'gestor' }), agora);
    const cpl = g.humanoClaude.find((l) => l.chave === 'cpl')!;
    expect(cpl).toMatchObject({
      humano: op.linhas.find((l) => l.chave === 'cpl')!.humano,
      sentido: 'menor-melhor',
      claudeMelhor: true,
    });
    expect(cpl.humano).toBeCloseTo(205000 / 11);
    expect(cpl.claude).toBeCloseTo(95000 / 11);
    // Leads das plataformas não se confundem com os leads do CSP 360 do indicador da mesma tela
    expect(cpl.rotulo).toBe('Custo por lead (plataformas)');
    expect(g.humanoClaude.find((l) => l.chave === 'leads')!.rotulo).toBe('Leads (plataformas)');
    expect(g.humanoClaude.find((l) => l.chave === 'custoPorClienteNovo')!.rotulo).toBe(
      'Custo por cliente novo',
    );
    expect(g.humanoClaude.find((l) => l.chave === 'investimento')).toMatchObject({
      sentido: null,
      claudeMelhor: null,
    });
    expect(g.humanoClaude.find((l) => l.chave === 'roas')).toMatchObject({
      sentido: 'maior-melhor',
      claudeMelhor: null,
    });
  });

  it('na visão Gestor: verba e limite por conta, com o aviso de perto do limite', () => {
    const g = visaoGeral(dados, f({ visao: 'gestor' }), agora).gestor!;
    expect(g.contas).toHaveLength(6);
    expect(g.contas.find((c) => c.marca === 'cs' && c.canal === 'meta')).toEqual({
      marca: 'cs',
      canal: 'meta',
      investimento: 112000,
      limite: 550000,
      uso: 112000 / 550000,
      verbaDiaria: 15000,
      campanhasAtivas: 2,
      alerta: null,
    });
    const plGoogle = g.contas.find((c) => c.marca === 'plumene' && c.canal === 'google')!;
    expect(plGoogle.uso).toBeCloseTo(0.925);
    expect(plGoogle.uso! >= LIMITE_DE_ALERTA).toBe(true);
    expect(plGoogle.alerta).toBe('perto');
    // Campanha pausada não entra na verba nem no limite
    expect(g.contas.find((c) => c.marca === 'cs' && c.canal === 'tiktok')).toMatchObject({
      investimento: 0,
      limite: 0,
      uso: null,
      verbaDiaria: 0,
      campanhasAtivas: 0,
      alerta: null,
    });
    expect(visaoGeral(dados, f({ visao: 'gestor', marca: 'cs' }), agora).gestor!.contas).toHaveLength(3);
  });

  it('na visão Gestor: a partir de 100% do limite, o alerta é "acima"', () => {
    const comLimite = (spendCapCents: number): Dados => ({
      ...dados,
      campaigns: campaigns.map((c) => (c.id === 'c3' ? { ...c, spendCapCents } : c)),
    });
    const plGoogle = (d: Dados) =>
      visaoGeral(d, f({ visao: 'gestor', marca: 'plumene', canal: 'google' }), agora).gestor!.contas[0]!;
    expect(plGoogle(comLimite(185000))).toMatchObject({ uso: 1, alerta: 'acima' });
    expect(plGoogle(comLimite(150000)).alerta).toBe('acima');
    expect(plGoogle(comLimite(206000)).alerta).toBe(null);
  });

  it('na visão Gestor: propostas na fila, sem as pendências de medição', () => {
    expect(visaoGeral(dados, f({ visao: 'gestor' }), agora).gestor!.propostasNaFila).toBe(1);
    expect(visaoGeral(dados, f({ visao: 'gestor', marca: 'plumene' }), agora).gestor!.propostasNaFila).toBe(
      0,
    );
  });

  it('conjunto vazio devolve null em tudo, nunca 0 nem NaN', () => {
    const v = visaoGeral({ ...DADOS_VAZIOS }, f({ visao: 'gestor' }), agora);
    for (const m of Object.values(v.numeros))
      expect(m).toEqual({ atual: null, anterior: null, variacao: null });
    expect(v.clientesNovosDeCampanha).toBeNull();
    expect(v.leadsSemMarca).toBeNull();
    expect(v.porDia.every((p) => p.leads === null && p.clientesNovos === null)).toBe(true);
    expect(v.porMarca.every((l) => l.custo.atual === null && l.investimento.atual === null)).toBe(true);
    expect(v.gestor!.propostasNaFila).toBeNull();
    expect(v.gestor!.contas.every((c) => c.investimento === null && c.verbaDiaria === null)).toBe(true);
    expect(v.gestor!.humanoClaude.every((l) => l.humano === null && l.claude === null)).toBe(true);
    expect(JSON.stringify(v)).not.toContain('NaN');
  });
});

describe('visaoGeral com os dados de exemplo', () => {
  const exemplo = gerarDadosDeExemplo({ agora });
  const recortes: Array<Partial<Filtros>> = [
    {},
    { marca: 'cs' },
    { marca: 'plumene' },
    { canal: 'meta' },
    { operador: 'claude' },
    { periodo: '7d' },
    { periodo: 'mes-passado', marca: 'cs' },
    { periodo: '90d', canal: 'google', operador: 'human' },
  ];

  it.each(recortes)('a série por dia soma igual aos KPIs (%o)', (parcial) => {
    const v = visaoGeral(exemplo, f(parcial), agora);
    expect(v.porDia).toHaveLength(v.intervalo.dias);
    expect(somaDe(v.porDia.map((p) => p.leads))).toBe(v.numeros.leads.atual);
    expect(somaDe(v.porDia.map((p) => p.clientesNovos))).toBe(v.numeros.clientesNovos.atual);
  });

  it.each(recortes)('custo por cliente novo = investimento ÷ clientes novos de campanha (%o)', (parcial) => {
    const v = visaoGeral(exemplo, f(parcial), agora);
    const total = custoPorClienteNovo(exemplo, f(parcial), agora).total;
    expect(v.numeros.custoPorClienteNovo.atual).toBe(total.custo.atual);
    if (v.numeros.custoPorClienteNovo.atual !== null) {
      expect(v.numeros.custoPorClienteNovo.atual).toBeCloseTo(
        v.numeros.investimento.atual! / v.clientesNovosDeCampanha!,
      );
    }
  });

  it('a tarefa principal tem número: custo por marca e por canal, comparado ao mês anterior', () => {
    const v = visaoGeral(exemplo, f(), agora);
    expect(v.porMarca).toHaveLength(2);
    expect(v.porCanal).toHaveLength(3);
    expect(v.porMarca.every((l) => l.custo.atual !== null && l.custo.anterior !== null)).toBe(true);
    expect(v.porCanal.filter((l) => l.custo.atual !== null).length).toBeGreaterThanOrEqual(2);
  });

  it('na visão Gestor, nada de NaN nem Infinity', () => {
    const v = visaoGeral(exemplo, f({ visao: 'gestor', periodo: '90d' }), agora);
    expect(v.gestor!.contas).toHaveLength(6);
    expect(v.gestor!.propostasNaFila).toBeGreaterThan(0);
    const texto = JSON.stringify(v);
    expect(texto).not.toContain('NaN');
    expect(texto).not.toContain('Infinity');
  });
});

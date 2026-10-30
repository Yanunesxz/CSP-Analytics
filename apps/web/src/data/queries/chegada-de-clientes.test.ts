import { describe, expect, it } from 'vitest';
import type { Campaign, DailyMetric, Lead } from '@csp-mkt/shared';
import { FILTROS_PADRAO, type Filtros } from '../../lib/url-state';
import { DADOS_VAZIOS, type Dados } from '../dados';
import { custoPorClienteNovo, kpisVisaoGeral } from '../queries';
import { gerarDadosDeExemplo } from '../sample';
import { chegadaDeClientes, filtrosDeCusto } from './chegada-de-clientes';

const agora = new Date('2026-10-30T15:00:00-03:00');
const f = (parcial: Partial<Filtros> = {}): Filtros => ({ ...FILTROS_PADRAO, ...parcial });
const iso = (dia: string, hora = 10) => `${dia}T${String(hora).padStart(2, '0')}:00:00-03:00`;

const campanha = (
  p: Pick<Campaign, 'id' | 'platform' | 'brandId' | 'managedBy' | 'utmCampaign'>,
): Campaign => ({
  externalId: `${p.platform}:${p.id}`,
  name: `Campanha ${p.id}`,
  status: 'active',
  dailyBudgetCents: 10000,
  spendCapCents: 450000,
  ...p,
});

const campaigns = [
  campanha({ id: 'c1', platform: 'meta', brandId: 'cs', managedBy: 'human', utmCampaign: 'cs-a' }),
  campanha({ id: 'c2', platform: 'meta', brandId: 'cs', managedBy: 'claude', utmCampaign: 'cs-b' }),
  campanha({ id: 'c3', platform: 'google', brandId: 'plumene', managedBy: 'human', utmCampaign: 'pl-c' }),
];

const gasto = (campaignId: string, date: string, spendCents: number): DailyMetric => {
  const c = campaigns.find((x) => x.id === campaignId)!;
  return {
    date,
    brandId: c.brandId,
    platform: c.platform,
    campaignId,
    spendCents,
    impressions: 100,
    clicks: 10,
    leads: 1,
    conversions: 0,
    revenueCents: 0,
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

/*
 * Outubro (período "Este mês" com agora = 30/10): 6 leads (l1, l2, l4, l5, l7, l8).
 * Setembro (anterior): 2 leads (l3, l6). Clientes novos em outubro: l1, l3 e l8 (1º pedido no mês).
 */
const dados: Dados = {
  ...DADOS_VAZIOS,
  campaigns,
  metrics: [
    gasto('c1', '2026-10-05', 10000),
    gasto('c1', '2026-10-10', 10000),
    gasto('c1', '2026-09-15', 8000),
    gasto('c2', '2026-10-05', 5000),
    gasto('c3', '2026-10-06', 7000),
    gasto('c3', '2026-09-12', 6000),
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
      repId: 'REP-01',
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
      repId: 'REP-02',
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
    lead({
      id: 'l8',
      brandId: 'plumene',
      source: 'google',
      utmCampaign: 'pl-c',
      stage: 'first_order',
      createdAt: iso('2026-10-05'),
      firstOrderAt: iso('2026-10-25'),
      crmCustomerId: 'cli-5',
      repId: 'REP-02',
    }),
  ],
  geradoEm: agora.toISOString(),
};

describe('filtrosDeCusto', () => {
  it('sem origem nem representante, os filtros valem como estão', () => {
    expect(filtrosDeCusto(f())).toEqual({ filtros: f(), motivo: null });
  });

  it('origem paga vira canal', () => {
    expect(filtrosDeCusto(f({ origem: 'meta' }))).toEqual({
      filtros: f({ canal: 'meta', origem: null }),
      motivo: null,
    });
  });

  it('origem paga diferente do canal fica, para o custo ficar sem base', () => {
    expect(filtrosDeCusto(f({ origem: 'meta', canal: 'google' })).filtros).toMatchObject({
      canal: 'google',
      origem: 'meta',
    });
  });

  it('origem não paga e representante não dividem investimento', () => {
    expect(filtrosDeCusto(f({ origem: 'organic' })).motivo).toBe('origem');
    expect(filtrosDeCusto(f({ representante: 'REP-01' })).motivo).toBe('representante');
    expect(filtrosDeCusto(f({ representante: 'REP-01', origem: 'meta' })).motivo).toBe('representante');
  });
});

describe('chegadaDeClientes', () => {
  const c = chegadaDeClientes(dados, f(), agora);

  it('KPIs com as mesmas contas da Visão geral', () => {
    const k = kpisVisaoGeral(dados, f(), agora);
    expect(c.leads).toEqual(k.leads);
    expect(c.leads.atual).toBe(6);
    expect(c.leads.anterior).toBe(2);
    expect(c.clientesNovos).toEqual(k.clientesNovos);
    expect(c.clientesNovos.atual).toBe(3);
    expect(c.custoPorClienteNovo).toEqual(k.custoPorClienteNovo);
    expect(c.custoPorClienteNovo.atual).toBeCloseTo(32000 / 3);
    expect(c.custoPorClienteNovo.anterior).toBe(14000);
    expect(c.motivoSemCusto).toBeNull();
  });

  it('conversão dos leads do período e tempo até o 1º pedido', () => {
    expect(c.conversao.atual).toBeCloseTo(1 / 3);
    expect(c.conversao.anterior).toBe(1);
    expect(c.conversao.variacao).toBeCloseTo(-2 / 3);
    expect(c.funil.diasAtePedido).toBe(13);
    expect(c.funil.semMarca).toBe(1);
  });

  it('funil com o total, a taxa da etapa anterior, a taxa do total e o período anterior', () => {
    expect(c.funil.etapas.map((e) => e.etapa)).toEqual([
      'lead',
      'prospect',
      'registered',
      'first_order',
      'invoiced',
    ]);
    expect(c.funil.etapas.map((e) => e.total.atual)).toEqual([6, 4, 3, 2, 0]);
    expect(c.funil.etapas.map((e) => e.total.anterior)).toEqual([2, 2, 2, 2, 1]);
    expect(c.funil.etapas[0]!.daAnterior).toBeNull();
    expect(c.funil.etapas[1]!.daAnterior).toBeCloseTo(4 / 6);
    expect(c.funil.etapas[4]!.daAnterior).toBe(0);
    expect(c.funil.etapas.map((e) => e.doTotal)).toEqual([1, 4 / 6, 3 / 6, 2 / 6, 0]);
    expect(c.funil.etapas[3]!.rotulo).toBe('1º pedido enviado');
  });

  it('matriz marca × canal com "As duas" e "Todos os canais"', () => {
    const m = c.custo!;
    expect(m.canais).toEqual(['meta', 'tiktok', 'google', null]);
    expect(m.linhas.map((l) => l.marca)).toEqual(['cs', 'plumene', null]);
    const [cs, pl, duas] = m.linhas;
    expect(cs!.celulas[0]!.custo.atual).toBe(12500);
    expect(cs!.celulas[0]!.investimento.atual).toBe(25000);
    expect(cs!.celulas[0]!.clientesNovos.atual).toBe(2);
    expect(cs!.celulas[1]!.custo.atual).toBeNull();
    expect(cs!.celulas[3]!.custo.atual).toBe(12500);
    expect(pl!.celulas[2]!.custo).toEqual({ atual: 7000, anterior: 6000, variacao: 1 / 6 });
    expect(duas!.celulas[3]!.custo).toEqual(c.custoPorClienteNovo);
    expect(duas!.celulas[0]!.marca).toBeNull();
    expect(duas!.celulas[0]!.canal).toBe('meta');
  });

  it('com uma marca só, sem linha "As duas"; com um canal só, sem coluna de total', () => {
    const soCs = chegadaDeClientes(dados, f({ marca: 'cs' }), agora);
    expect(soCs.custo!.linhas.map((l) => l.marca)).toEqual(['cs']);
    expect(soCs.custo!.canais).toEqual(['meta', 'tiktok', 'google', null]);
    expect(soCs.porMarca).toEqual([]);

    const soMeta = chegadaDeClientes(dados, f({ canal: 'meta' }), agora);
    expect(soMeta.custo!.canais).toEqual(['meta']);
    expect(soMeta.custo!.linhas.map((l) => l.marca)).toEqual(['cs', 'plumene', null]);
    expect(soMeta.custo!.linhas[2]!.celulas[0]!.custo.atual).toBe(12500);
  });

  it('origem paga mostra o custo do canal; origem não paga e representante não têm custo', () => {
    const meta = chegadaDeClientes(dados, f({ origem: 'meta' }), agora);
    expect(meta.custoPorClienteNovo).toEqual(
      custoPorClienteNovo(dados, f({ canal: 'meta' }), agora).total.custo,
    );
    expect(meta.custoPorClienteNovo.atual).toBe(12500);
    expect(meta.leads.atual).toBe(2);

    const organica = chegadaDeClientes(dados, f({ origem: 'organic' }), agora);
    expect(organica.motivoSemCusto).toBe('origem');
    expect(organica.custo).toBeNull();
    expect(organica.operador).toBeNull();
    expect(organica.custoPorClienteNovo).toEqual({ atual: null, anterior: null, variacao: null });
    expect(organica.leads.atual).toBe(1);

    const rep = chegadaDeClientes(dados, f({ representante: 'REP-01' }), agora);
    expect(rep.motivoSemCusto).toBe('representante');
    expect(rep.custo).toBeNull();
    expect(rep.leads.atual).toBe(2);
  });

  it('por origem, do maior para o menor; empate segue a ordem das origens', () => {
    expect(c.porOrigem.map((o) => o.origem)).toEqual(['meta', 'google', 'organic', 'ai_assistant', 'sdr']);
    expect(c.porOrigem[0]).toEqual({ origem: 'meta', leads: 2, viraramCliente: 1, conversao: 0.5 });
    expect(c.porOrigem[1]).toMatchObject({ origem: 'google', viraramCliente: 1, conversao: 1 });
    expect(c.porOrigem[2]).toMatchObject({ origem: 'organic', viraramCliente: 0, conversao: 0 });
  });

  it('por representante e os leads ainda sem representante', () => {
    expect(c.porRepresentante).toEqual([
      { representante: 'REP-01', leads: 2, viraramCliente: 1, conversao: 0.5, diasAtePedido: 6 },
      { representante: 'REP-02', leads: 2, viraramCliente: 1, conversao: 0.5, diasAtePedido: 20 },
    ]);
    expect(c.semRepresentante).toBe(2);
  });

  it('por marca só com "As duas"; o lead sem marca entra nas duas', () => {
    expect(c.porMarca).toEqual([
      { marca: 'cs', leads: 4, viraramCliente: 1, conversao: 0.25, diasAtePedido: 6 },
      { marca: 'plumene', leads: 3, viraramCliente: 1, conversao: 1 / 3, diasAtePedido: 20 },
    ]);
  });

  it('coorte dos últimos 4 meses', () => {
    expect(c.coorte.map((m) => m.mes)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    expect(c.coorte[2]).toEqual({ mes: '2026-09', leads: 2, viraramCliente: 2, conversao: 1 });
    expect(c.coorte[3]).toMatchObject({ leads: 6, viraramCliente: 2 });
    expect(c.coorte[0]).toEqual({ mes: '2026-07', leads: 0, viraramCliente: 0, conversao: null });
  });

  it('Humano × Claude só nas linhas de cliente novo', () => {
    expect(c.operador!.map((l) => l.chave)).toEqual([
      'investimento',
      'parcelaDaVerba',
      'clientesNovos',
      'custoPorClienteNovo',
    ]);
    const novos = c.operador!.find((l) => l.chave === 'clientesNovos')!;
    expect([novos.humano, novos.claude]).toEqual([2, 1]);
    const custo = c.operador!.find((l) => l.chave === 'custoPorClienteNovo')!;
    expect([custo.humano, custo.claude]).toEqual([13500, 5000]);
  });

  it('opções de campanha (da marca) e de representante', () => {
    expect(c.opcoes.representantes).toEqual([
      { valor: 'REP-01', rotulo: 'REP-01' },
      { valor: 'REP-02', rotulo: 'REP-02' },
    ]);
    expect(c.opcoes.campanhas.map((o) => o.valor)).toEqual(['c1', 'c2', 'c3']);
    expect(chegadaDeClientes(dados, f({ marca: 'plumene' }), agora).opcoes.campanhas).toEqual([
      { valor: 'c3', rotulo: 'Campanha c3' },
    ]);
  });

  it('sem comparar, o período anterior fica nulo', () => {
    const s = chegadaDeClientes(dados, f({ comparar: false }), agora);
    expect(s.leads).toEqual({ atual: 6, anterior: null, variacao: null });
    expect(s.funil.etapas[0]!.total).toEqual({ atual: 6, anterior: null, variacao: null });
    expect(s.custoPorClienteNovo.anterior).toBeNull();
  });

  it('filtro que não acha lead: contagens 0, taxas sem base', () => {
    const nada = chegadaDeClientes(dados, f({ origem: 'tiktok' }), agora);
    expect(nada.funil.etapas.map((e) => e.total.atual)).toEqual([0, 0, 0, 0, 0]);
    expect(nada.funil.etapas[1]!.daAnterior).toBeNull();
    expect(nada.conversao.atual).toBeNull();
    expect(nada.porOrigem).toEqual([]);
    expect(nada.semRepresentante).toBe(0);
  });

  it('conjunto vazio devolve null em tudo, nunca 0 nem NaN', () => {
    const v = chegadaDeClientes({ ...DADOS_VAZIOS }, f(), agora);
    expect(v.leads.atual).toBeNull();
    expect(v.clientesNovos.atual).toBeNull();
    expect(v.conversao.atual).toBeNull();
    expect(v.custoPorClienteNovo.atual).toBeNull();
    expect(v.funil.etapas.every((e) => e.total.atual === null && e.doTotal === null)).toBe(true);
    expect(v.funil.diasAtePedido).toBeNull();
    expect(v.funil.semMarca).toBeNull();
    expect(v.custo!.linhas.flatMap((l) => l.celulas).every((x) => x.custo.atual === null)).toBe(true);
    expect(v.porOrigem).toEqual([]);
    expect(v.porRepresentante).toEqual([]);
    expect(v.semRepresentante).toBeNull();
    expect(v.porMarca.every((m) => m.leads === null && m.viraramCliente === null)).toBe(true);
    expect(v.coorte.every((m) => m.leads === null && m.conversao === null)).toBe(true);
    expect(v.operador!.every((l) => l.humano === null && l.claude === null)).toBe(true);
    expect(JSON.stringify(v)).not.toContain('NaN');
  });
});

describe('chegadaDeClientes com os dados de exemplo', () => {
  const exemplo = gerarDadosDeExemplo({ agora });

  it('a tarefa principal tem número: custo por cliente novo por marca e canal, comparado ao mês anterior', () => {
    const c = chegadaDeClientes(exemplo, f(), agora);
    expect(c.custo!.linhas).toHaveLength(3);
    expect(c.custo!.canais).toHaveLength(4);
    const celulas = c.custo!.linhas.flatMap((l) => l.celulas);
    expect(celulas.filter((x) => x.custo.atual !== null).length).toBeGreaterThanOrEqual(6);
    expect(c.custoPorClienteNovo.atual).toBeGreaterThan(0);
    expect(c.custoPorClienteNovo.anterior).toBeGreaterThan(0);
  });

  it('as quebras fecham com o total do funil', () => {
    for (const filtros of [f(), f({ marca: 'cs' }), f({ periodo: '90d' }), f({ canal: 'google' })]) {
      const c = chegadaDeClientes(exemplo, filtros, agora);
      const leads = c.funil.etapas[0]!.total.atual!;
      expect(leads).toBeGreaterThan(0);
      expect(c.porOrigem.reduce((s, o) => s + (o.leads ?? 0), 0)).toBe(leads);
      expect(c.porRepresentante.reduce((s, r) => s + (r.leads ?? 0), 0) + c.semRepresentante!).toBe(leads);
      expect(c.porOrigem.reduce((s, o) => s + (o.viraramCliente ?? 0), 0)).toBe(
        c.funil.etapas[3]!.total.atual,
      );
    }
  });

  it('nada de NaN nem Infinity em nenhum filtro', () => {
    const tudo = JSON.stringify(
      [
        f(),
        f({ marca: 'plumene', periodo: 'mes-passado' }),
        f({ origem: 'ai_assistant' }),
        f({ origem: 'tiktok', operador: 'claude' }),
        f({ representante: 'REP-03', periodo: '7d' }),
        f({ comparar: false, visao: 'gestor' }),
      ].map((filtros) => chegadaDeClientes(exemplo, filtros, agora)),
    );
    expect(tudo).not.toContain('NaN');
    expect(tudo).not.toContain('Infinity');
  });
});

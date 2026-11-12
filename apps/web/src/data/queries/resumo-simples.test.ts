import { describe, expect, it } from 'vitest';
import type { Campaign, DailyMetric, Lead, Order } from '@csp-mkt/shared';
import { FILTROS_PADRAO, type Filtros } from '../../lib/url-state';
import { DADOS_VAZIOS, type Dados } from '../dados';
import { custoPorClienteNovo, kpisVisaoGeral } from '../queries';
import { gerarDadosDeExemplo } from '../sample';
import { resumoSimples, type NumerosDoResumo } from './resumo-simples';

const agora = new Date('2026-10-30T15:00:00-03:00');
const f = (parcial: Partial<Filtros> = {}): Filtros => ({ ...FILTROS_PADRAO, ...parcial });
const iso = (dia: string, hora = 10) => `${dia}T${String(hora).padStart(2, '0')}:00:00-03:00`;

const campanha = (p: Pick<Campaign, 'id' | 'platform' | 'brandId' | 'utmCampaign'>): Campaign => ({
  externalId: `${p.platform}:${p.id}`,
  name: p.id,
  managedBy: 'human',
  status: 'active',
  dailyBudgetCents: 10000,
  spendCapCents: 450000,
  ...p,
});

const campaigns: Campaign[] = [
  campanha({ id: 'c1', platform: 'meta', brandId: 'cs', utmCampaign: 'cs-a' }),
  campanha({ id: 'c2', platform: 'google', brandId: 'plumene', utmCampaign: 'pl-b' }),
  campanha({ id: 'c3', platform: 'meta', brandId: 'plumene', utmCampaign: 'pl-c' }),
  // Sem gasto, lead nem cliente novo em outubro: fica fora da lista
  campanha({ id: 'c4', platform: 'tiktok', brandId: 'cs', utmCampaign: 'cs-t' }),
];

const gasto = (campaignId: string, date: string, spendCents: number): DailyMetric => {
  const c = campaigns.find((x) => x.id === campaignId)!;
  return {
    date,
    brandId: c.brandId,
    platform: c.platform,
    campaignId,
    spendCents,
    impressions: 0,
    clicks: 0,
    leads: 0,
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

const pedido = (id: string, customerId: string, totalCents: number, createdAt: string): Order => ({
  id,
  brandId: 'cs',
  customerId,
  status: 'sent',
  isInvoiced: false,
  totalCents,
  invoicedTotalCents: null,
  createdAt,
});

const dados: Dados = {
  ...DADOS_VAZIOS,
  campaigns,
  metrics: [
    gasto('c1', '2026-10-05', 60000),
    gasto('c1', '2026-10-06', 40000),
    gasto('c2', '2026-10-05', 50000),
    gasto('c3', '2026-10-07', 30000),
    gasto('c1', '2026-09-10', 80000), // setembro: só entra na comparação
    gasto('c4', '2026-08-01', 99000), // fora dos dois períodos
  ],
  leads: [
    // c1: 3 pessoas interessadas em outubro, 2 clientes novos
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
      stage: 'invoiced',
      createdAt: iso('2026-10-03'),
      firstOrderAt: iso('2026-10-09'),
      crmCustomerId: 'cli-2',
    }),
    lead({
      id: 'l3',
      brandId: 'cs',
      source: 'meta',
      utmCampaign: 'cs-a',
      stage: 'lead',
      createdAt: iso('2026-10-04'),
    }),
    // c2: 1 pessoa interessada em outubro e 1 cliente novo que chegou em setembro e comprou em outubro
    lead({
      id: 'l4',
      brandId: 'plumene',
      source: 'google',
      utmCampaign: 'pl-b',
      stage: 'first_order',
      createdAt: iso('2026-09-20'),
      firstOrderAt: iso('2026-10-10'),
      crmCustomerId: 'cli-3',
    }),
    lead({
      id: 'l5',
      brandId: 'plumene',
      source: 'google',
      utmCampaign: 'pl-b',
      stage: 'prospect',
      createdAt: iso('2026-10-11'),
    }),
    // c3: gastou e só trouxe uma pessoa interessada
    lead({
      id: 'l6',
      brandId: 'plumene',
      source: 'meta',
      utmCampaign: 'pl-c',
      stage: 'lead',
      createdAt: iso('2026-10-12'),
    }),
    // Sem anúncio: entra só em "todas as origens"
    lead({
      id: 'l7',
      brandId: 'cs',
      source: 'referral',
      stage: 'first_order',
      createdAt: iso('2026-10-05'),
      firstOrderAt: iso('2026-10-15'),
      crmCustomerId: 'cli-4',
    }),
    // Setembro, c1: o período anterior
    lead({
      id: 'l8',
      brandId: 'cs',
      source: 'meta',
      utmCampaign: 'cs-a',
      stage: 'first_order',
      createdAt: iso('2026-09-05'),
      firstOrderAt: iso('2026-09-12'),
      crmCustomerId: 'cli-5',
    }),
  ],
  orders: [
    pedido('p1', 'cli-1', 150000, iso('2026-10-08')),
    pedido('p1b', 'cli-1', 900000, iso('2026-10-20')), // recompra: não entra no que voltou
    pedido('p2', 'cli-2', 250000, iso('2026-10-09')),
    pedido('p3', 'cli-3', 100000, iso('2026-10-10')),
    pedido('p4', 'cli-4', 700000, iso('2026-10-15')), // cliente sem anúncio
    pedido('p5', 'cli-5', 200000, iso('2026-09-12')),
  ],
};

const outubro = f({ periodo: 'este-mes' });

describe('resumoSimples', () => {
  it('total: gasto, pessoas interessadas, clientes novos, custo e o que voltou', () => {
    const r = resumoSimples(dados, outubro, agora);
    expect(r.total).toEqual<NumerosDoResumo>({
      investimento: 180000,
      interessados: 5, // l1, l2, l3, l5, l6 (o l4 chegou em setembro)
      clientesNovos: 3, // l1, l2, l4
      custoPorClienteNovo: 60000,
      valorDosPrimeirosPedidos: 500000, // 1.500 + 2.500 + 1.000, sem a recompra
      retornoPorReal: 500000 / 180000,
    });
  });

  it('os números do total são os mesmos da tarefa T1 (custoPorClienteNovo)', () => {
    const r = resumoSimples(dados, outubro, agora);
    const t1 = custoPorClienteNovo(dados, outubro, agora).total;
    expect(r.total.investimento).toBe(t1.investimento.atual);
    expect(r.total.interessados).toBe(t1.leads.atual);
    expect(r.total.clientesNovos).toBe(t1.clientesNovos.atual);
    expect(r.total.custoPorClienteNovo).toBe(t1.custo.atual);
  });

  it('todas as origens conta também quem não veio de anúncio, como a Visão geral', () => {
    const r = resumoSimples(dados, outubro, agora);
    const k = kpisVisaoGeral(dados, outubro, agora);
    expect(r.todasAsOrigens).toEqual({ interessados: 6, clientesNovos: 4 });
    expect(r.todasAsOrigens.interessados).toBe(k.leads.atual);
    expect(r.todasAsOrigens.clientesNovos).toBe(k.clientesNovos.atual);
  });

  it('por canal: a parcela do gasto e o que cada canal trouxe', () => {
    const r = resumoSimples(dados, outubro, agora);
    const canal = (c: string) => r.porCanal.find((l) => l.canal === c)!;
    expect(r.porCanal.map((l) => l.canal)).toEqual(['meta', 'tiktok', 'google']);
    expect(canal('meta')).toMatchObject({
      investimento: 130000,
      interessados: 4,
      clientesNovos: 2,
      custoPorClienteNovo: 65000,
      valorDosPrimeirosPedidos: 400000,
    });
    expect(canal('meta').parcelaDoGasto).toBeCloseTo(130000 / 180000);
    expect(canal('google')).toMatchObject({ investimento: 50000, clientesNovos: 1, retornoPorReal: 2 });
    // Sem gasto no canal: R$ 0 gasto, e custo e retorno sem base
    expect(canal('tiktok')).toMatchObject({
      investimento: 0,
      interessados: 0,
      clientesNovos: 0,
      custoPorClienteNovo: null,
      valorDosPrimeirosPedidos: 0,
      retornoPorReal: null,
      parcelaDoGasto: 0,
    });
  });

  it('por marca: as duas em "As duas", uma com a marca escolhida', () => {
    const r = resumoSimples(dados, outubro, agora);
    expect(r.porMarca.map((l) => l.marca)).toEqual(['cs', 'plumene']);
    expect(r.porMarca[0]).toMatchObject({
      investimento: 100000,
      clientesNovos: 2,
      custoPorClienteNovo: 50000,
    });
    expect(r.porMarca[1]).toMatchObject({
      investimento: 80000,
      clientesNovos: 1,
      custoPorClienteNovo: 80000,
    });

    const cs = resumoSimples(dados, f({ periodo: 'este-mes', marca: 'cs' }), agora);
    expect(cs.porMarca.map((l) => l.marca)).toEqual(['cs']);
    expect(cs.total.investimento).toBe(100000);
  });

  it('campanhas: só as que tiveram movimento, da que mais gastou para a que menos', () => {
    const r = resumoSimples(dados, outubro, agora);
    expect(r.campanhas.map((c) => c.campanha.id)).toEqual(['c1', 'c2', 'c3']);
    expect(r.campanhasSemMovimento).toBe(1);
    expect(r.campanhas[0]).toMatchObject({
      investimento: 100000,
      interessados: 3,
      clientesNovos: 2,
      custoPorClienteNovo: 50000,
      valorDosPrimeirosPedidos: 400000,
      retornoPorReal: 4,
    });
    // Gastou e não trouxe cliente novo: custo sem base, retorno zero (decisão 0028)
    expect(r.campanhas[2]).toMatchObject({
      investimento: 30000,
      interessados: 1,
      clientesNovos: 0,
      custoPorClienteNovo: null,
      valorDosPrimeirosPedidos: 0,
      retornoPorReal: 0,
    });
  });

  it('a soma das campanhas fecha com o total', () => {
    const r = resumoSimples(dados, outubro, agora);
    const soma = (campo: keyof NumerosDoResumo) => r.campanhas.reduce((t, c) => t + (c[campo] ?? 0), 0);
    expect(soma('investimento')).toBe(r.total.investimento);
    expect(soma('interessados')).toBe(r.total.interessados);
    expect(soma('clientesNovos')).toBe(r.total.clientesNovos);
    expect(soma('valorDosPrimeirosPedidos')).toBe(r.total.valorDosPrimeirosPedidos);
  });

  it('período anterior: os mesmos números de setembro, e null com a comparação desligada', () => {
    const r = resumoSimples(dados, outubro, agora);
    expect(r.anterior).toEqual<NumerosDoResumo>({
      investimento: 80000,
      interessados: 2, // l4 e l8
      clientesNovos: 1,
      custoPorClienteNovo: 80000,
      valorDosPrimeirosPedidos: 200000,
      retornoPorReal: 2.5,
    });
    expect(resumoSimples(dados, f({ periodo: 'este-mes', comparar: false }), agora).anterior).toBeNull();
  });

  it('cliente novo sem pedido na base: o valor fica sem dados, o resto continua', () => {
    const semPedido: Dados = { ...dados, orders: dados.orders.filter((o) => o.customerId !== 'cli-2') };
    const r = resumoSimples(semPedido, outubro, agora);
    expect(r.total.clientesNovos).toBe(3);
    expect(r.total.valorDosPrimeirosPedidos).toBeNull();
    expect(r.total.retornoPorReal).toBeNull();
    // A campanha do Google não depende desse cliente
    expect(r.campanhas.find((c) => c.campanha.id === 'c2')!.retornoPorReal).toBe(2);
  });

  it('orçamento e pedido cancelado não são o 1º pedido: vale o 1º enviado', () => {
    const comOrcamento: Dados = {
      ...dados,
      orders: [
        { ...pedido('q1', 'cli-1', 5000000, iso('2026-10-01')), status: 'quote' },
        { ...pedido('x1', 'cli-1', 3000000, iso('2026-10-02')), status: 'cancelled' },
        ...dados.orders,
      ],
    };
    expect(resumoSimples(comOrcamento, outubro, agora).total).toEqual(
      resumoSimples(dados, outubro, agora).total,
    );
  });

  it('sem pedidos na base: o que voltou fica sem dados', () => {
    const r = resumoSimples({ ...dados, orders: [] }, outubro, agora);
    expect(r.total.investimento).toBe(180000);
    expect(r.total.valorDosPrimeirosPedidos).toBeNull();
    expect(r.total.retornoPorReal).toBeNull();
  });

  it('conjunto vazio: tudo null, nunca 0 nem NaN', () => {
    const r = resumoSimples({ ...DADOS_VAZIOS }, outubro, agora);
    expect(r.total).toEqual<NumerosDoResumo>({
      investimento: null,
      interessados: null,
      clientesNovos: null,
      custoPorClienteNovo: null,
      valorDosPrimeirosPedidos: null,
      retornoPorReal: null,
    });
    expect(r.todasAsOrigens).toEqual({ interessados: null, clientesNovos: null });
    expect(r.campanhas).toEqual([]);
    expect(r.campanhasSemMovimento).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
  });

  it('dados de exemplo: campanhas e canais fecham com o total, em cada marca e período', () => {
    const exemplo = gerarDadosDeExemplo({ agora });
    for (const marca of ['todas', 'cs', 'plumene'] as const) {
      for (const periodo of ['este-mes', 'mes-passado', '30d'] as const) {
        const r = resumoSimples(exemplo, f({ marca, periodo }), agora);
        const soma = <T extends NumerosDoResumo>(linhas: T[], campo: keyof NumerosDoResumo) =>
          linhas.reduce((t, l) => t + (l[campo] ?? 0), 0);
        for (const campo of ['investimento', 'interessados', 'clientesNovos'] as const) {
          expect(soma(r.campanhas, campo), `${marca} ${periodo} campanhas ${campo}`).toBe(r.total[campo]);
          expect(soma(r.porCanal, campo), `${marca} ${periodo} canais ${campo}`).toBe(r.total[campo]);
        }
        expect(soma(r.campanhas, 'valorDosPrimeirosPedidos')).toBe(r.total.valorDosPrimeirosPedidos);
        expect(r.total.investimento).toBeGreaterThan(0);
      }
    }
  });
});

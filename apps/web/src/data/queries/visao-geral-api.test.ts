import type { ApiKpiOverview } from '@csp-mkt/shared';
import { describe, expect, it } from 'vitest';
import { FILTROS_PADRAO } from '../../lib/url-state';
import { visaoGeralDaApi } from './visao-geral-api';

const M = (current: number | null, previous: number | null = null, variation: number | null = null) => ({
  current,
  previous,
  variation,
});

const linha = (inv: number | null, leads: number | null, novos: number | null, custo: number | null) => ({
  investment: M(inv),
  leads: M(leads),
  cost_per_lead: M(inv !== null && leads ? inv / leads : null),
  new_customers: M(novos),
  cost_per_new_customer: M(custo),
  attributed_new_customers: novos === null ? null : 1,
});

const RESPOSTA: ApiKpiOverview = {
  period: {
    start_on: '2026-11-14',
    end_on: '2026-11-20',
    compared_through_on: '2026-11-19',
    previous_start_on: '2026-11-07',
    previous_end_on: '2026-11-12',
    days: 7,
  },
  coverage: { ads: true, csp360: true },
  has_data: true,
  updated_at: '2026-11-20T12:00:00Z',
  investment: M(32000, 10000, 1.5),
  impressions: M(3200),
  clicks: M(32),
  leads: M(3),
  new_customers: M(2),
  cost_per_new_customer: M(32000),
  attributed_new_customers: 1,
  leads_without_brand: 1,
  orders: { count: M(3), total_cents: M(80000), invoiced_count: M(0), invoiced_total_cents: M(null) },
  by_brand: [
    { brand: 'cs', ...linha(32000, 3, 2, 32000), cross_brand_new_customers: 0 },
    { brand: 'plumene', ...linha(null, 1, 0, null), cross_brand_new_customers: 0 },
  ],
  by_platform: [{ platform: 'meta', ...linha(32000, 1, 1, 32000) }],
  daily: [{ metric_on: '2026-11-14', investment_cents: 0, leads: 0, new_customers: 0 }],
};

describe('visaoGeralDaApi', () => {
  const v = visaoGeralDaApi(RESPOSTA, { ...FILTROS_PADRAO, periodo: '7d' }, new Date('2026-11-20T13:00:00Z'));

  it('só troca os nomes: os números são os do banco, e o faturado sem base fica "Sem dados"', () => {
    expect(v.numeros.investimento).toEqual({ atual: 32000, anterior: 10000, variacao: 1.5 });
    expect(v.numeros.leads.atual).toBe(3);
    expect(v.numeros.clientesNovos.atual).toBe(2);
    expect(v.numeros.custoPorClienteNovo.atual).toBe(32000);
    expect(v.numeros.pedidos.atual).toBe(3);
    expect(v.numeros.valorPedidos.atual).toBe(80000);
    expect(v.numeros.faturados.atual).toBe(0);
    expect(v.numeros.valorFaturado.atual).toBeNull();
    expect(v.clientesNovosDeCampanha).toBe(1);
    expect(v.leadsSemMarca).toBe(1);
  });

  it('por marca e por canal levam investimento, leads, custo por lead, clientes novos e custo', () => {
    expect(v.porMarca.map((l) => [l.marca, l.investimento.atual, l.leads.atual, l.clientesNovos.atual, l.custo.atual]))
      .toEqual([
        ['cs', 32000, 3, 2, 32000],
        ['plumene', null, 1, 0, null],
      ]);
    expect(v.porCanal[0]).toMatchObject({
      canal: 'meta',
      marca: null,
      investimento: { atual: 32000 },
      custoPorLead: { atual: 32000 },
      custo: { atual: 32000 },
    });
  });

  it('o período e a comparação vêm das datas do banco', () => {
    expect(v.intervalo).toMatchObject({ inicio: '2026-11-14', dias: 7, rotuloAnterior: 'vs. 07/11 a 12/11' });
    expect(v.porDia).toEqual([{ date: '2026-11-14', leads: 0, clientesNovos: 0 }]);
  });
});

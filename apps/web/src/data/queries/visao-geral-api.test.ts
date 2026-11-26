import type { ApiKpiOverview } from '@csp-mkt/shared';
import { describe, expect, it } from 'vitest';
import { FILTROS_PADRAO } from '../../lib/url-state';
import { visaoGeralDaApi } from './visao-geral-api';

const M = (current: number | null, previous: number | null = null, variation: number | null = null) => ({
  current,
  previous,
  variation,
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
  coverage: { ads: true, csp360: false },
  has_data: true,
  updated_at: '2026-11-20T12:00:00Z',
  investment: M(32000, 10000, 1.5),
  impressions: M(3200),
  clicks: M(32),
  leads: M(null),
  new_customers: M(null),
  cost_per_new_customer: M(null),
  attributed_new_customers: null,
  leads_without_brand: null,
  by_brand: [
    { brand: 'cs', investment: M(32000) },
    { brand: 'plumene', investment: M(null) },
  ],
  by_platform: [{ platform: 'meta', investment: M(32000) }],
  daily: [{ metric_on: '2026-11-14', investment_cents: 0, leads: null, new_customers: null }],
};

describe('visaoGeralDaApi', () => {
  const v = visaoGeralDaApi(RESPOSTA, { ...FILTROS_PADRAO, periodo: '7d' }, new Date('2026-11-20T13:00:00Z'));

  it('só troca os nomes: o investimento é o do banco, o resto sem base fica "Sem dados"', () => {
    expect(v.numeros.investimento).toEqual({ atual: 32000, anterior: 10000, variacao: 1.5 });
    expect(v.numeros.clientesNovos.atual).toBeNull();
    expect(v.numeros.custoPorClienteNovo.atual).toBeNull();
    expect(v.clientesNovosDeCampanha).toBeNull();
  });

  it('por marca e por canal levam só o investimento', () => {
    expect(v.porMarca.map((l) => [l.marca, l.investimento.atual, l.custo.atual])).toEqual([
      ['cs', 32000, null],
      ['plumene', null, null],
    ]);
    expect(v.porCanal[0]).toMatchObject({ canal: 'meta', marca: null, investimento: { atual: 32000 } });
  });

  it('o período e a comparação vêm das datas do banco', () => {
    expect(v.intervalo).toMatchObject({ inicio: '2026-11-14', dias: 7, rotuloAnterior: 'vs. 07/11 a 12/11' });
    expect(v.porDia).toEqual([{ date: '2026-11-14', leads: null, clientesNovos: null }]);
  });
});

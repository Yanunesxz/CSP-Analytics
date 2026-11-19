import { describe, expect, it } from 'vitest';
import { FILTROS_PADRAO } from '../lib/url-state';
import { filtrosDaApi } from './fonte';

describe('filtrosDaApi', () => {
  it('o padrão da URL vira só período e comparação', () => {
    expect(filtrosDaApi({ ...FILTROS_PADRAO })).toEqual({ period: 'this_month', compare: true });
  });

  it('traduz cada filtro para o código do banco e deixa a visão e o estado de fora', () => {
    expect(
      filtrosDaApi({
        ...FILTROS_PADRAO,
        marca: 'cs',
        periodo: '30d',
        comparar: false,
        canal: 'meta',
        campanha: '120200000000001',
        operador: 'claude',
        origem: 'organic',
        representante: 'REP-0001',
        visao: 'gestor',
        estado: 'erro',
      }),
    ).toEqual({
      brand: 'cs',
      period: 'last_30_days',
      compare: false,
      platform: 'meta',
      campaign: '120200000000001',
      operator: 'claude',
      origin: 'organic',
      sales_rep: 'REP-0001',
    });
  });

  it('os cinco períodos', () => {
    const periodos = (['este-mes', 'mes-passado', '7d', '30d', '90d'] as const).map(
      (periodo) => filtrosDaApi({ ...FILTROS_PADRAO, periodo }).period,
    );
    expect(periodos).toEqual(['this_month', 'last_month', 'last_7_days', 'last_30_days', 'last_90_days']);
  });
});

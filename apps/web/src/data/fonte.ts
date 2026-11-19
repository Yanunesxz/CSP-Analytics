/**
 * Da URL para o banco (docs/dados/metricas.md, seção 1.1): os filtros da tela viram o objeto que as funções `api.kpi_*`
 * recebem, com os códigos em inglês. Só aqui; com teste em `fonte.test.ts`. O que é padrão fica de fora (o banco
 * aplica o mesmo padrão), e o que não vai ao banco (visão, `?estado=`) nunca entra.
 */

import type { Periodo } from '../lib/periodo';
import type { Filtros } from '../lib/url-state';

export type PeriodoDaApi = 'this_month' | 'last_month' | 'last_7_days' | 'last_30_days' | 'last_90_days';

const PERIODO_DA_API: Readonly<Record<Periodo, PeriodoDaApi>> = {
  'este-mes': 'this_month',
  'mes-passado': 'last_month',
  '7d': 'last_7_days',
  '30d': 'last_30_days',
  '90d': 'last_90_days',
};

export interface FiltrosDaApi {
  brand?: 'cs' | 'plumene';
  period: PeriodoDaApi;
  compare: boolean;
  platform?: string;
  campaign?: string;
  operator?: 'human' | 'claude';
  origin?: string;
  sales_rep?: string;
}

export function filtrosDaApi(filtros: Filtros): FiltrosDaApi {
  const f: FiltrosDaApi = { period: PERIODO_DA_API[filtros.periodo], compare: filtros.comparar };
  if (filtros.marca !== 'todas') f.brand = filtros.marca;
  if (filtros.canal) f.platform = filtros.canal;
  if (filtros.campanha) f.campaign = filtros.campanha;
  if (filtros.operador !== 'todos') f.operator = filtros.operador;
  if (filtros.origem) f.origin = filtros.origem;
  if (filtros.representante) f.sales_rep = filtros.representante;
  return f;
}

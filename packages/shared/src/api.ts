/**
 * O formato das respostas das funções de tela (`api.kpi_*`, docs/dados/metricas.md, seções 1 e 6). Códigos em inglês,
 * como o banco devolve; a tela traduz pelo `labels.ts`. Número sem base vem `null` ("Sem dados"), nunca 0.
 */

import type { Brand, ConnectorStatus, GeoSource, Platform } from './types';

/** Número com comparação: o valor de até agora e a variação só com os dias completos da fonte. */
export interface ApiMetric {
  current: number | null;
  previous: number | null;
  variation: number | null;
}

/** O período da resposta, em dias de São Paulo (`AAAA-MM-DD`), para o rótulo da comparação. */
export interface ApiPeriod {
  start_on: string;
  end_on: string;
  /** Até onde a comparação vai; nulo sem dia completo da fonte. */
  compared_through_on: string | null;
  previous_start_on: string | null;
  previous_end_on: string | null;
  days: number;
}

/** Canal do GA4 derivado da linha bruta (`mkt.ga4_channel`). */
export type ApiGa4Channel =
  | 'organic_search'
  | 'ai_assistant'
  | 'direct'
  | 'paid_search'
  | 'paid_social'
  | 'organic_social'
  | 'referral'
  | 'other';

export interface ApiSourceStatus {
  last_success_at: string | null;
  complete_through_on: string | null;
  covered: boolean;
  status: ConnectorStatus;
}

/** `api.kpi_seo_geo`: por enquanto, só a parte do GA4 (SG8 a SG12). */
export interface ApiKpiSeoGeo {
  period: ApiPeriod;
  coverage: { ga4: boolean };
  has_data: boolean;
  geo: {
    ai_sessions: ApiMetric;
    ai_share: ApiMetric;
    sessions: ApiMetric;
    by_ai_source: Array<{ ai_source: GeoSource; sessions: ApiMetric; share: number | null }>;
    by_channel: Array<{ channel: ApiGa4Channel; sessions: number; share: number | null }>;
    daily: Array<{ brand: Brand; metric_on: string; ai_sessions: number | null }>;
  };
  sources: { ga4: ApiSourceStatus };
}

/**
 * `api.kpi_overview`: por enquanto, só a mídia (VG4, VG12 e VG13 na coluna do investimento). Leads, clientes novos,
 * custo por cliente novo, pedidos e Instagram vêm nulos até o CSP 360 chegar (`coverage.csp360`).
 */
export interface ApiKpiOverview {
  period: ApiPeriod;
  coverage: { ads: boolean; csp360: boolean };
  has_data: boolean;
  updated_at: string | null;
  investment: ApiMetric;
  impressions: ApiMetric;
  clicks: ApiMetric;
  leads: ApiMetric;
  new_customers: ApiMetric;
  cost_per_new_customer: ApiMetric;
  attributed_new_customers: number | null;
  leads_without_brand: number | null;
  by_brand: Array<{ brand: Brand; investment: ApiMetric }>;
  by_platform: Array<{ platform: Platform; investment: ApiMetric }>;
  daily: Array<{
    metric_on: string;
    investment_cents: number | null;
    leads: number | null;
    new_customers: number | null;
  }>;
}

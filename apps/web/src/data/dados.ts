/**
 * O conjunto de dados que o store guarda e as queries leem.
 * No modo demonstração vem do gerador de exemplo; com Supabase virá das views (fase 3).
 */

import type {
  Campaign,
  Connector,
  Customer,
  DailyMetric,
  GeoDaily,
  IgDaily,
  IgMedia,
  Lead,
  Order,
  Profile,
  SeoDaily,
  TrafficAction,
} from '@csp-mkt/shared';

export interface Dados {
  campaigns: Campaign[];
  metrics: DailyMetric[];
  leads: Lead[];
  customers: Customer[];
  orders: Order[];
  igDaily: IgDaily[];
  igMedia: IgMedia[];
  seoDaily: SeoDaily[];
  geoDaily: GeoDaily[];
  actions: TrafficAction[];
  connectors: Connector[];
  profiles: Profile[];
  /** Quando o conjunto foi gerado ou sincronizado; `null` quando está vazio. */
  geradoEm: string | null;
}

export const DADOS_VAZIOS: Readonly<Dados> = Object.freeze({
  campaigns: [],
  metrics: [],
  leads: [],
  customers: [],
  orders: [],
  igDaily: [],
  igMedia: [],
  seoDaily: [],
  geoDaily: [],
  actions: [],
  connectors: [],
  profiles: [],
  geradoEm: null,
});

/** Nada chegou ainda: é o "vazio" do modo demonstração sem dados de exemplo. */
export function estaVazio(dados: Dados): boolean {
  return (
    dados.campaigns.length +
      dados.metrics.length +
      dados.leads.length +
      dados.customers.length +
      dados.orders.length +
      dados.igDaily.length +
      dados.igMedia.length +
      dados.seoDaily.length +
      dados.geoDaily.length +
      dados.actions.length +
      dados.connectors.length ===
    0
  );
}

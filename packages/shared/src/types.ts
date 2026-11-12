/**
 * Tipos do domínio do CSP-MKT.
 *
 * Espelham as tabelas que nascem na fase 3 (inglês, snake_case no banco; aqui camelCase).
 * Dinheiro em centavos (`*Cents`), data e hora em ISO 8601 (`*At`, fuso America/Sao_Paulo
 * ao mostrar), só data em `AAAA-MM-DD` (`date`). Listas fechadas em inglês; o rótulo em
 * português vem de `labels.ts`.
 *
 * Nenhum tipo carrega nome, telefone, e-mail ou documento de cliente ou lead (decisão 0006).
 */

/** Marca do grupo. É dimensão do fato, nunca do cliente (decisão 0003). */
export type Brand = 'cs' | 'plumene';

/** Plataforma de mídia paga. */
export type Platform = 'meta' | 'tiktok' | 'google';

/** Quem opera a campanha ou propôs a ação (decisão 0008). */
export type Operator = 'human' | 'claude';

export type CampaignStatus = 'active' | 'paused' | 'ended';

export interface Campaign {
  id: string;
  /** Id na plataforma; junto com `platform` dá a idempotência. */
  externalId: string;
  platform: Platform;
  brandId: Brand;
  name: string;
  /** Casa com `Lead.utmCampaign` para a atribuição (decisão 0009). */
  utmCampaign: string;
  managedBy: Operator;
  status: CampaignStatus;
  dailyBudgetCents: number;
  /** Teto de gasto da campanha (decisão 0005). */
  spendCapCents: number;
}

/** Snapshot diário de uma campanha, como a plataforma reporta. */
export interface DailyMetric {
  date: string;
  brandId: Brand;
  platform: Platform;
  campaignId: string;
  spendCents: number;
  impressions: number;
  clicks: number;
  leads: number;
  conversions: number;
  /** Valor de conversão reportado pela plataforma; 0 quando não há rastreio. */
  revenueCents: number;
}

/** Etapas do funil de chegada (decisão 0012). Cliente novo = `first_order`. */
export type LeadStage = 'lead' | 'prospect' | 'registered' | 'first_order' | 'invoiced';

export type LeadSource =
  'meta' | 'tiktok' | 'google' | 'site' | 'organic' | 'ai_assistant' | 'sdr' | 'referral' | 'direct';

export interface Lead {
  id: string;
  /** Código humano, `LEAD-0001`. É o que a tela mostra no lugar do nome. */
  code: string;
  /** Lead do SDR não tem marca e aparece nas duas como "Sem marca". */
  brandId: Brand | null;
  source: LeadSource;
  utmCampaign: string | null;
  /** Host do `referrer` gravado com o lead; único rastro de orgânico e de assistentes de IA. */
  referrerHost: string | null;
  stage: LeadStage;
  createdAt: string;
  firstOrderAt: string | null;
  repId: string | null;
  /** `clientes.id` no CSP 360: chave de junção e link para a ficha 360. */
  crmCustomerId: string | null;
}

/**
 * Situação pela régua do CRM, da melhor para a pior, e `lead` por último (a ordem de `mkt.list_rank`, que escolhe
 * a melhor situação em "As duas"). `null` enquanto o CRM não expõe a situação calculada.
 */
export type CustomerSituation = 'active' | 'inactive_recent' | 'inactive_old' | 'lost' | 'lead';

export interface Customer {
  id: string;
  code: string;
  /** Marcas em que já comprou (`retrato_marcas`). */
  brands: Brand[];
  situation: CustomerSituation | null;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  ordersCount: number;
  revenueCents: number;
  repId: string | null;
}

/**
 * `quote` = orçamento; `sent` = pedido enviado no CRM (o que conta para cliente novo); `cancelled` = cancelado, sai
 * da conta. Faturado não é status: é o carimbo `isInvoiced` (seção 9 do padrão).
 */
export type OrderStatus = 'quote' | 'sent' | 'cancelled';

export interface Order {
  id: string;
  brandId: Brand;
  customerId: string;
  status: OrderStatus;
  /** O CRM marcou como faturado; só vale para pedido enviado. */
  isInvoiced: boolean;
  totalCents: number;
  /** "Sem dados" até o Control abrir o canal de faturamento (decisão 0004). */
  invoicedTotalCents: number | null;
  createdAt: string;
}

export interface IgDaily {
  date: string;
  brandId: Brand;
  followers: number;
  reach: number;
  impressions: number;
  engagement: number;
}

export type IgMediaType = 'image' | 'video' | 'carousel' | 'reel';

export interface IgMedia {
  id: string;
  brandId: Brand;
  publishedAt: string;
  type: IgMediaType;
  /** Legenda curta inventada no modo demonstração; na API vem truncada. */
  caption: string;
  reach: number;
  likes: number;
  comments: number;
  saves: number;
}

export interface SeoDaily {
  date: string;
  brandId: Brand;
  impressions: number;
  clicks: number;
  position: number;
}

/**
 * Assistente de IA de onde veio a sessão ou o lead (`mkt.ai_source` no banco). `other` = assistente fora da lista,
 * para a sessão não sumir do total.
 */
export type GeoSource = 'chatgpt' | 'perplexity' | 'claude' | 'gemini' | 'copilot' | 'other';

export interface GeoDaily {
  date: string;
  brandId: Brand;
  source: GeoSource;
  sessions: number;
  leads: number;
}

export type ActionKind = 'create' | 'pause' | 'budget' | 'bid' | 'creative' | 'pending_fix';
/** `failed` = a plataforma recusou a escrita; aprovar de novo é "Tentar de novo". */
export type ActionStatus = 'idea' | 'failed' | 'approved' | 'running' | 'done' | 'discarded';
export type Level = 'low' | 'medium' | 'high';

/** Linha da lista "O que podemos fazer" e da trilha de tráfego (decisão 0005). */
export interface TrafficAction {
  id: string;
  proposedBy: Operator;
  brandId: Brand;
  platform: Platform | null;
  campaignId: string | null;
  title: string;
  rationale: string;
  kind: ActionKind;
  paramsJson: string;
  status: ActionStatus;
  impact: Level;
  effort: Level;
  costCents: number | null;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  executedAt: string | null;
  result: string | null;
}

export type ConnectorId =
  'meta' | 'instagram' | 'tiktok' | 'google_ads' | 'ga4' | 'search_console' | 'csp360';

/** `not_connected` = ainda não foi ligado (a ligar); `disabled` = desligado pelo dono. */
export type ConnectorStatus = 'ok' | 'late' | 'down' | 'not_connected' | 'disabled';

export interface Connector {
  id: ConnectorId;
  name: string;
  status: ConnectorStatus;
  lastSyncAt: string | null;
  expectedEveryMinutes: number;
  errors24h: number;
  rowsWritten: number;
}

/** Papéis em lista fechada desde o primeiro PR (decisão 0011). */
export type Role = 'owner' | 'traffic_manager';

export interface Profile {
  id: string;
  name: string;
  email: string;
  role: Role;
}

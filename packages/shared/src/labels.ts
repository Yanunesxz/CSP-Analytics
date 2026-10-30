/**
 * Rótulo em português e cor de cada lista fechada.
 *
 * A cor é sempre um token: `var(--color-series-N)` para marca, canal e operador
 * (decisão 0007: só em gráfico, chip e legenda) e `var(--color-<status>)` para status.
 * A tela nunca escreve a cor; pede aqui.
 */

import type {
  ActionKind,
  ActionStatus,
  Brand,
  CampaignStatus,
  ConnectorId,
  ConnectorStatus,
  CustomerSituation,
  GeoSource,
  IgMediaType,
  LeadSource,
  LeadStage,
  Level,
  Operator,
  OrderStatus,
  Platform,
  Role,
} from './types';

/** Tom de status do padrão (`.yn-badge[data-tone]`). `muted` = sem destaque. */
export type Tom = 'success' | 'info' | 'warning' | 'danger' | 'muted';

export interface Rotulo {
  rotulo: string;
  /** Token CSS completo, pronto para `style={{ color: cor }}`. */
  cor: string;
  /** Só nas listas de status; `undefined` nas listas de série. */
  tom?: Tom;
}

const serie = (n: 1 | 2 | 3 | 4 | 5 | 6, rotulo: string): Rotulo => ({
  rotulo,
  cor: `var(--color-series-${n})`,
});

const status = (tom: Tom, rotulo: string): Rotulo => ({
  rotulo,
  cor: tom === 'muted' ? 'var(--color-text-muted)' : `var(--color-${tom})`,
  tom,
});

type Tabela<C extends string> = Record<C, Rotulo>;

export const LISTAS = {
  brand: {
    cs: serie(2, 'Corpo Sensual'),
    plumene: serie(6, 'Plumene'),
  } satisfies Tabela<Brand>,

  // Séries escolhidas para os pares que aparecem juntos ficarem bem distintos no tema claro:
  // Meta × TikTok × Google (azul, magenta, laranja) e Busca orgânica × Assistente de IA (mint, roxo).
  // Ciano fica com "Site", o par menos disputado (no claro ele é próximo do mint e do azul).
  platform: {
    meta: serie(4, 'Meta Ads'),
    tiktok: serie(2, 'TikTok Ads'),
    google: serie(3, 'Google Ads'),
  } satisfies Tabela<Platform>,

  operator: {
    human: serie(4, 'Humano'),
    claude: serie(3, 'Claude'),
  } satisfies Tabela<Operator>,

  campaignStatus: {
    active: status('success', 'Ativa'),
    paused: status('warning', 'Pausada'),
    ended: status('muted', 'Encerrada'),
  } satisfies Tabela<CampaignStatus>,

  leadStage: {
    lead: status('muted', 'Lead'),
    prospect: status('info', 'Prospecto'),
    registered: status('info', 'Cadastro'),
    first_order: status('success', '1º pedido enviado'),
    invoiced: status('success', 'Faturado'),
  } satisfies Tabela<LeadStage>,

  leadSource: {
    meta: serie(4, 'Meta Ads'),
    tiktok: serie(2, 'TikTok Ads'),
    google: serie(3, 'Google Ads'),
    site: serie(5, 'Site'),
    organic: serie(1, 'Busca orgânica'),
    ai_assistant: serie(6, 'Assistente de IA'),
    // Origens sem série própria ficam em neutros que passam de 3:1 no card nos dois temas (decisão
    // 0007). --color-border-strong não serve: fica abaixo de 2:1 e a barra some no branco e no preto.
    sdr: { rotulo: 'SDR · WhatsApp', cor: 'var(--color-text-muted)' },
    referral: { rotulo: 'Indicação', cor: 'var(--color-text)' },
    direct: { rotulo: 'Direto', cor: 'var(--color-silver)' },
  } satisfies Tabela<LeadSource>,

  customerSituation: {
    lead: status('muted', 'Lead'),
    active: status('success', 'Ativo'),
    inactive_recent: status('warning', 'Inativo recente'),
    inactive_old: status('warning', 'Inativo antigo'),
    lost: status('danger', 'Perdido'),
  } satisfies Tabela<CustomerSituation>,

  orderStatus: {
    sent: status('info', 'Enviado'),
    invoiced: status('success', 'Faturado'),
  } satisfies Tabela<OrderStatus>,

  igMediaType: {
    image: status('muted', 'Imagem'),
    video: status('muted', 'Vídeo'),
    carousel: status('muted', 'Carrossel'),
    reel: status('muted', 'Reel'),
  } satisfies Tabela<IgMediaType>,

  geoSource: {
    chatgpt: serie(1, 'ChatGPT'),
    perplexity: serie(5, 'Perplexity'),
    claude: serie(3, 'Claude'),
    gemini: serie(4, 'Gemini'),
    copilot: serie(6, 'Copilot'),
  } satisfies Tabela<GeoSource>,

  actionKind: {
    create: status('info', 'Criar campanha'),
    pause: status('warning', 'Pausar'),
    budget: status('info', 'Ajustar orçamento'),
    bid: status('info', 'Ajustar lance'),
    creative: status('info', 'Trocar criativo'),
    pending_fix: status('danger', 'Pendência de medição'),
  } satisfies Tabela<ActionKind>,

  actionStatus: {
    idea: status('muted', 'Ideia'),
    approved: status('info', 'Aprovada'),
    running: status('warning', 'Em execução'),
    done: status('success', 'Feita'),
    discarded: status('danger', 'Descartada'),
  } satisfies Tabela<ActionStatus>,

  level: {
    low: status('muted', 'Baixo'),
    medium: status('warning', 'Médio'),
    high: status('danger', 'Alto'),
  } satisfies Tabela<Level>,

  connectorId: {
    meta: status('muted', 'Meta Ads'),
    instagram: status('muted', 'Instagram'),
    tiktok: status('muted', 'TikTok Ads'),
    google_ads: status('muted', 'Google Ads'),
    ga4: status('muted', 'GA4'),
    search_console: status('muted', 'Search Console'),
    csp360: status('muted', 'CSP 360'),
  } satisfies Tabela<ConnectorId>,

  connectorStatus: {
    ok: status('success', 'Funcionando'),
    late: status('warning', 'Atrasado'),
    down: status('danger', 'Caído'),
    // Simulado não pede atenção: etiqueta neutra (cor de status só quando pede ação)
    simulated: status('muted', 'Simulado'),
  } satisfies Tabela<ConnectorStatus>,

  role: {
    owner: status('info', 'Dono'),
    traffic_manager: status('info', 'Gestor de tráfego'),
  } satisfies Tabela<Role>,
} as const;

export type Lista = keyof typeof LISTAS;
export type Codigo<L extends Lista> = keyof (typeof LISTAS)[L] & string;

function entrada<L extends Lista>(lista: L, codigo: string): Rotulo | undefined {
  const tabela = LISTAS[lista] as Record<string, Rotulo>;
  return Object.prototype.hasOwnProperty.call(tabela, codigo) ? tabela[codigo] : undefined;
}

/** Rótulo em português. Código desconhecido volta como veio, para nunca sumir da tela. */
export function rotulo<L extends Lista>(lista: L, codigo: Codigo<L> | string): string {
  return entrada(lista, codigo)?.rotulo ?? codigo;
}

/** Token de cor (`var(--color-…)`). Código desconhecido recebe o cinza de texto secundário. */
export function cor<L extends Lista>(lista: L, codigo: Codigo<L> | string): string {
  return entrada(lista, codigo)?.cor ?? 'var(--color-text-muted)';
}

/** Tom para `.yn-badge[data-tone]`. Listas de série (marca, canal, operador) não têm tom. */
export function tom<L extends Lista>(lista: L, codigo: Codigo<L> | string): Tom | undefined {
  return entrada(lista, codigo)?.tom;
}

/** Todas as opções de uma lista, na ordem declarada: para select, chips e legendas. */
export function opcoes<L extends Lista>(
  lista: L,
): Array<{ codigo: Codigo<L>; rotulo: string; cor: string; tom?: Tom }> {
  const tabela = LISTAS[lista] as Record<string, Rotulo>;
  return (Object.keys(tabela) as Codigo<L>[]).map((codigo) => ({ codigo, ...tabela[codigo]! }));
}

/** Rótulo do filtro de marca: "As duas" é ausência de filtro (decisão 0003). */
export function rotuloMarca(marca: Brand | 'todas' | null | undefined): string {
  if (!marca || marca === 'todas') return 'As duas';
  return rotulo('brand', marca);
}

/** Dado que chegou sem marca (lead do SDR) é sinalizado assim nos totais. */
export const SEM_MARCA = 'Sem marca';

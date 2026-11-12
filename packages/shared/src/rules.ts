/**
 * Regras puras usadas pelo front, pelo banco (como referência das views) e pelo worker.
 * Toda regra daqui tem teste em `rules.test.ts`.
 */

import type { LeadSource, Role } from './types';

/* ---------- Origem do lead (decisão 0009) ---------- */

const HOSTS_IA = [
  'chatgpt.com',
  'chat.openai.com',
  'perplexity.ai',
  'claude.ai',
  'gemini.google.com',
  'copilot.microsoft.com',
];

const HOSTS_BUSCA = ['google.', 'bing.com', 'duckduckgo.com', 'yahoo.com', 'ecosia.org'];

const HOSTS_GOOGLE_ADS = ['googleads.g.doubleclick.net', 'googleadservices.com', 'syndicatedsearch.goog'];

const HOSTS_PROPRIOS = ['corposensual.com.br', 'plumene.com.br'];

const FONTES_META = ['meta', 'facebook', 'fb', 'instagram', 'ig', 'fbig'];
const FONTES_TIKTOK = ['tiktok', 'tt'];
const FONTES_GOOGLE = ['google', 'adwords', 'googleads', 'youtube', 'bing', 'microsoft'];
const MEIOS_PAGOS = [
  'cpc',
  'ppc',
  'paid',
  'paidsearch',
  'paid_social',
  'paidsocial',
  'cpm',
  'display',
  'pmax',
  'video',
  'ads',
];
const FONTES_IA = ['chatgpt', 'openai', 'perplexity', 'claude', 'anthropic', 'gemini', 'copilot'];

function limpar(valor: string | null | undefined): string {
  return (valor ?? '').trim().toLowerCase();
}

function host(valor: string | null | undefined): string {
  let h = limpar(valor);
  if (h.includes('://')) {
    try {
      h = new URL(h).hostname;
    } catch {
      /* fica como veio */
    }
  }
  return h
    .replace(/^www\./, '')
    .replace(/^m\./, '')
    .replace(/^l\./, '')
    .replace(/^lm\./, '');
}

function termina(h: string, sufixos: string[]): boolean {
  return sufixos.some((s) => (s.endsWith('.') ? h.includes(s) : h === s || h.endsWith(`.${s}`)));
}

/**
 * Classifica a origem de um lead.
 *
 * Ordem: UTM quando houver (fonte paga ou nomeada), senão o `referrer`.
 * - `organic` = google/bing/… sem `utm_medium` pago;
 * - `ai_assistant` = chatgpt.com, perplexity.ai, claude.ai, gemini.google.com, copilot.microsoft.com;
 * - `site` = veio de página do próprio site, sem UTM;
 * - `direct` = sem UTM e sem `referrer`;
 * - `referral` = qualquer outro site ou `utm_source` desconhecido.
 */
export function classificarOrigem(
  referrerHost: string | null | undefined,
  utmSource?: string | null,
  utmMedium?: string | null,
): LeadSource {
  const fonte = limpar(utmSource);
  const meio = limpar(utmMedium);
  const pago = MEIOS_PAGOS.includes(meio);

  if (fonte) {
    if (FONTES_META.includes(fonte)) return 'meta';
    if (FONTES_TIKTOK.includes(fonte)) return 'tiktok';
    if (FONTES_GOOGLE.includes(fonte)) return pago ? 'google' : 'organic';
    if (FONTES_IA.includes(fonte)) return 'ai_assistant';
    if (fonte === 'sdr' || fonte === 'whatsapp') return 'sdr';
    if (fonte === 'site') return 'site';
    if (fonte === 'direct' || fonte === '(direct)') return 'direct';
    return 'referral';
  }

  const h = host(referrerHost);
  if (!h) return 'direct';
  if (termina(h, HOSTS_GOOGLE_ADS)) return 'google';
  if (termina(h, HOSTS_IA)) return 'ai_assistant';
  if (termina(h, HOSTS_BUSCA)) return 'organic';
  if (termina(h, HOSTS_PROPRIOS)) return 'site';
  return 'referral';
}

/** É um host de assistente de IA? Usado também no módulo SEO e GEO. */
export function ehAssistenteDeIa(referrerHost: string | null | undefined): boolean {
  return termina(host(referrerHost), HOSTS_IA);
}

/* ---------- Permissões por papel (decisão 0011) ---------- */

/**
 * Ações do sistema. A tela esconde o botão com isto, e a RLS da fase 3 confere o mesmo papel.
 * `ver_lead_dado_pessoal` existe para deixar explícito que ninguém tem: a ficha fica no CSP 360.
 */
export type Acao =
  | 'ver_numeros'
  | 'ver_resumo'
  | 'ver_leads'
  | 'ver_lead_dado_pessoal'
  | 'ver_trafego_ia'
  | 'operar_trafego_ia'
  | 'aprovar_acao'
  | 'parar_tudo'
  | 'ver_conectores'
  | 'tentar_conector_de_novo'
  | 'gerir_usuarios'
  | 'ver_diagnostico'
  | 'editar_configuracoes';

const PERMISSOES: Record<Role, readonly Acao[]> = {
  owner: [
    'ver_numeros',
    'ver_resumo',
    'ver_leads',
    'ver_trafego_ia',
    'operar_trafego_ia',
    'aprovar_acao',
    'parar_tudo',
    'ver_conectores',
    'tentar_conector_de_novo',
    'gerir_usuarios',
    'ver_diagnostico',
    'editar_configuracoes',
  ],
  traffic_manager: [
    'ver_numeros',
    'ver_resumo',
    'ver_leads',
    'ver_trafego_ia',
    'operar_trafego_ia',
    'ver_conectores',
    'editar_configuracoes',
  ],
  // Decisão 0043: só o Resumo simples e as próprias configurações (tema, marca padrão, meus filtros).
  summary_viewer: ['ver_resumo', 'editar_configuracoes'],
};

/** Lista de ações permitidas ao papel. Papel desconhecido não pode nada. */
export function permissoes(role: Role | null | undefined): readonly Acao[] {
  if (!role) return [];
  return PERMISSOES[role] ?? [];
}

export function pode(role: Role | null | undefined, acao: Acao): boolean {
  return permissoes(role).includes(acao);
}

/**
 * Ação exigida para abrir cada rota protegida. Rota fora da lista é aberta a quem está logado.
 * É a mesma ação que esconde o item do menu (decisão 0011): o menu e a rota nunca divergem.
 */
export const ROTAS_PROTEGIDAS: Readonly<Record<string, Acao>> = {
  // As telas de números: todo papel menos o leitor do resumo (decisão 0043)
  '/': 'ver_numeros',
  '/resumo': 'ver_resumo',
  '/chegada': 'ver_numeros',
  '/base': 'ver_numeros',
  '/canais': 'ver_numeros',
  '/instagram': 'ver_numeros',
  '/seo-geo': 'ver_numeros',
  '/leads': 'ver_leads',
  '/trafego': 'ver_trafego_ia',
  '/conectores': 'ver_conectores',
  '/usuarios': 'gerir_usuarios',
  '/diagnostico': 'ver_diagnostico',
};

/** Código humano `PREFIXO-0001` (seção 9 do padrão). */
export function codigo(prefixo: string, numero: number): string {
  return `${prefixo}-${String(numero).padStart(4, '0')}`;
}

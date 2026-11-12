/**
 * Textos e endereços da tela SEO e GEO que dependem de um número já calculado pela consulta.
 * Só formatação: nenhuma conta aqui (a conta vive em data/queries/seo-geo.ts).
 */

import type { FonteDoPainel, SiteDoPainel } from '../../data/queries/seo-geo';
import { atualizadoHa, dataHora, percentual, plural } from '../../lib/format';

/**
 * A ação principal da tela: o Search Console na web. É onde se lê, uma vez por mês, o relatório
 * "Generative AI performance" (impressões em AI Overviews e AI Mode), que não tem API.
 */
export const URL_SEARCH_CONSOLE = 'https://search.google.com/search-console';

/**
 * "atualizado há 6 h" da fonte; null sem o cartão do conector ou quando ele está a ligar ou desligado (o
 * selo diz).
 */
export function frescorDaFonte(fonte: FonteDoPainel | null, agora: Date = new Date()): string | null {
  if (!fonte || fonte.status === 'not_connected' || fonte.status === 'disabled') return null;
  return atualizadoHa(fonte.lastSyncAt, agora);
}

/** "A última sincronização foi em 30/10/2026 09:00." ou "O conector ainda não sincronizou." */
export function textoDaUltimaSincronizacao(lastSyncAt: string | null): string {
  return lastSyncAt
    ? `A última sincronização foi em ${dataHora(lastSyncAt)}.`
    : 'O conector ainda não sincronizou.';
}

/** Resumo ao lado da tabela de consultas: "10 consultas · 64% dos cliques do período". */
export function resumoDasConsultas(quantidade: number, participacao: number | null): string | null {
  if (!Number.isFinite(quantidade) || quantidade <= 0) return null;
  const consultas = plural(quantidade, 'consulta', 'consultas');
  if (participacao === null || !Number.isFinite(participacao)) return consultas;
  return `${consultas} · ${percentual(participacao, 0)} dos cliques do período`;
}

/** Detalhe de uma barra: "12,4% das sessões de IA"; undefined sem base. */
export function parcelaDe(parcela: number | null | undefined, doQue: string): string | undefined {
  if (parcela === null || parcela === undefined || !Number.isFinite(parcela)) return undefined;
  return `${percentual(parcela)} ${doQue}`;
}

/** Rodapé do cartão do site: "Conferido em 30/10/2026 06:00 · 2 itens pedem atenção". */
export function textoDaConferencia(site: Pick<SiteDoPainel, 'conferidoEm' | 'emAtencao'>): string {
  const quando = site.conferidoEm ? `Conferido em ${dataHora(site.conferidoEm)}` : 'Ainda não conferido';
  if (site.emAtencao <= 0) return `${quando} · Tudo em ordem`;
  return `${quando} · ${plural(site.emAtencao, 'item pede atenção', 'itens pedem atenção')}`;
}

/**
 * Ações da tela de canal (camada tela → actions → store, seção 10 do padrão).
 *
 * Pausar e ajustar orçamento viram uma ação de tráfego (`traffic_actions`) proposta pelo humano.
 * Quem pode aprovar (`aprovar_acao`) já a deixa aprovada; quem só opera (`operar_trafego_ia`) a deixa
 * como proposta para o dono. Nada é executado aqui: o worker executa depois de aprovada e só quando
 * houver credencial de escrita (decisão 0005). Os montadores são puros, com teste em `operacoes.test.ts`.
 */

import type { Campaign } from '@csp-mkt/shared';
import { aprovarAcao, proporAcao } from '../../data/actions';
import { dinheiro } from '../../lib/format';
import { custoDoAjuste } from './formatos';

export type NovaAcao = Parameters<typeof proporAcao>[0];

/** Pausa pedida na tela do canal, com o motivo que a pessoa escreveu (opcional). */
export function montarPausa(campanha: Campaign, motivo: string): NovaAcao {
  return {
    proposedBy: 'human',
    brandId: campanha.brandId,
    platform: campanha.platform,
    campaignId: campanha.id,
    title: `Pausar ${campanha.name}`,
    rationale: motivo.trim() || 'Pausa pedida na tela do canal, sem motivo escrito.',
    kind: 'pause',
    paramsJson: JSON.stringify({ status: 'paused' }),
    impact: 'medium',
    effort: 'low',
    costCents: 0,
  };
}

/** Novo orçamento diário pedido na tela do canal; o custo estimado é só o aumento em 30 dias. */
export function montarAjuste(campanha: Campaign, novoCents: number, motivo: string): NovaAcao {
  return {
    proposedBy: 'human',
    brandId: campanha.brandId,
    platform: campanha.platform,
    campaignId: campanha.id,
    title: `Mudar o orçamento diário de ${campanha.name} para ${dinheiro(novoCents)}`,
    rationale: motivo.trim() || 'Ajuste pedido na tela do canal, sem motivo escrito.',
    kind: 'budget',
    paramsJson: JSON.stringify({
      dailyBudgetCents: novoCents,
      previousDailyBudgetCents: campanha.dailyBudgetCents,
    }),
    impact: 'medium',
    effort: 'low',
    costCents: custoDoAjuste(campanha.dailyBudgetCents, novoCents),
  };
}

/**
 * Grava a ação na trilha. Com `aprovadoPor` (quem tem `aprovar_acao`), já sai aprovada;
 * sem ele, fica como proposta (`idea`) na fila de Tráfego com IA.
 */
export function registrarAcao(
  acao: NovaAcao,
  aprovadoPor: string | null,
  agora: Date = new Date(),
): { id: string; aprovada: boolean } {
  const id = proporAcao(acao, agora);
  if (aprovadoPor) aprovarAcao(id, aprovadoPor, agora);
  return { id, aprovada: aprovadoPor !== null };
}

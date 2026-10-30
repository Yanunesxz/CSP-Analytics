/**
 * Textos e cores da tela de Leads que dependem do dado (puros, com teste em `textos.test.ts`).
 * Nenhuma conta aqui: os números chegam prontos de `painelDeLeads`.
 */

import { cor, type Brand } from '@csp-mkt/shared';
import type { CustoNaoSeAplica } from '../../data/queries/leads';
import { numero, percentual, plural } from '../../lib/format';

/** Cor da série de uma marca; o lead sem marca (SDR) fica no cinza do SDR, nunca numa cor de marca. */
export function corDaMarcaDoLead(marca: Brand | null): string {
  return marca ? cor('brand', marca) : cor('leadSource', 'sdr');
}

/** "3 viraram cliente · 25,0%", "1 virou cliente", "—" sem base. */
export function detalheDeConversao(grupo: {
  viraramCliente: number | null;
  taxaConversao: number | null;
}): string {
  if (grupo.viraramCliente === null) return '—';
  const quantos = plural(grupo.viraramCliente, 'virou cliente', 'viraram cliente');
  return grupo.taxaConversao === null ? quantos : `${quantos} · ${percentual(grupo.taxaConversao)}`;
}

/** Nota do indicador "Lead → cliente novo": "2 de 7 leads viraram cliente"; nada sem lead no período. */
export function notaDeConversao(viraram: number | null, total: number | null): string | undefined {
  if (viraram === null || total === null || total === 0) return undefined;
  return `${numero(viraram)} de ${plural(total, 'lead', 'leads')} ${viraram === 1 ? 'virou' : 'viraram'} cliente`;
}

/** Por que o custo por lead não aparece com os filtros de agora. */
export const NOTA_SEM_CUSTO: Record<CustoNaoSeAplica, string> = {
  origem: 'Leads desta origem não têm custo de mídia.',
  representante: 'O investimento não se divide por representante.',
};

/** "Mostrando os 200 mais recentes de 340 leads. …", "52 leads, os mais recentes primeiro." ou "1 lead." */
export function resumoDaLista(mostrando: number, total: number | null): string | null {
  if (total === null || total === 0) return null;
  if (total > mostrando)
    return `Mostrando os ${numero(mostrando)} mais recentes de ${plural(total, 'lead', 'leads')}. Use os filtros para achar um lead.`;
  return total === 1 ? '1 lead.' : `${plural(total, 'lead', 'leads')}, os mais recentes primeiro.`;
}

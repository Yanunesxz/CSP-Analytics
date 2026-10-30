/**
 * Regras pequenas de Configurações: puras, com teste em `textos.test.ts`.
 */

import type { ModoDeAcesso } from '../../lib/auth';
import type { Marca } from '../../lib/url-state';

/** De onde vêm os números do sistema aberto, na mesma voz da faixa do topo. */
export function rotuloDoModo(modo: ModoDeAcesso, comDadosDeExemplo: boolean): string {
  if (modo === 'supabase') return 'Dados reais';
  return comDadosDeExemplo ? 'Demonstração · dados de exemplo' : 'Demonstração · sem dados de exemplo';
}

/** Marcas na ordem do menu: Corpo Sensual, Plumene, As duas. */
export const MARCAS_DO_PADRAO: readonly Marca[] = ['cs', 'plumene', 'todas'];

/**
 * A marca que abre quando o link não diz qual: a última guardada no navegador (a mesma que o menu
 * grava); num navegador que não guarda, a que está valendo agora.
 */
export function marcaPadrao(guardada: Marca | null | undefined, atual: Marca): Marca {
  return guardada ?? atual;
}

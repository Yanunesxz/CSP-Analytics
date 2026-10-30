/**
 * Textos da tela Base de clientes que dependem de um número já calculado pela consulta.
 * Só formatação: nenhuma conta aqui (a conta vive em data/queries/base-de-clientes.ts).
 */

import { rotulo, rotuloMarca, SEM_MARCA, type Brand } from '@csp-mkt/shared';
import type { Metrica } from '../../data/queries';
import { data, numero, percentual, plural } from '../../lib/format';

export const SEM_REPRESENTANTE = 'Sem representante';

function temNumero(valor: number | null | undefined): valor is number {
  return valor !== null && valor !== undefined && Number.isFinite(valor);
}

/** Linha de baixo de "Clientes na base": quantos o CSP 360 ainda não classificou. */
export function notaDaBase(total: number | null, semSituacao: number | null): string | undefined {
  if (!temNumero(total)) return undefined;
  if (temNumero(semSituacao) && semSituacao > 0) return `${numero(semSituacao)} sem situação no CSP 360`;
  return 'Com pedido em alguma marca';
}

/** Linha de baixo de Ativos, Inativos e Perdidos quando o CSP 360 ainda não manda a situação. */
export function notaSemSituacao(situacaoConhecida: boolean, total: number | null): string | undefined {
  return !situacaoConhecida && temNumero(total) ? 'O CSP 360 ainda não envia a situação' : undefined;
}

/** "18 recentes · 15 antigos". */
export function notaInativos(recentes: number | null, antigos: number | null): string | undefined {
  if (!temNumero(recentes) || !temNumero(antigos)) return undefined;
  return `${numero(recentes)} ${recentes === 1 ? 'recente' : 'recentes'} · ${numero(antigos)} ${
    antigos === 1 ? 'antigo' : 'antigos'
  }`;
}

/**
 * Quando a variação não existe porque o período anterior foi 0, o KPI diz o número de antes
 * ("0 no período anterior") em vez de ficar sem comparação.
 */
export function notaDoAnterior(m: Metrica, formatar: (valor: number) => string): string | undefined {
  if (!temNumero(m.atual) || !temNumero(m.anterior) || m.variacao !== null) return undefined;
  return `${formatar(m.anterior)} no período anterior`;
}

/** "01/10/2026 a 30/10/2026". */
export function textoDoPeriodo(inicio: string, fim: string): string {
  return `${data(inicio)} a ${data(fim)}`;
}

/** "hoje", "há 1 dia", "há 140 dias"; null sem data. */
export function tempoDesde(dias: number | null): string | null {
  if (!temNumero(dias)) return null;
  if (dias <= 0) return 'hoje';
  return `há ${plural(dias, 'dia', 'dias')}`;
}

/** Marcas em que o cliente já comprou: "Corpo Sensual", "Plumene", "As duas" ou "Sem marca". */
export function rotuloDasMarcas(marcas: readonly Brand[]): string {
  const [unica] = marcas;
  if (!unica) return SEM_MARCA;
  return marcas.length > 1 ? rotuloMarca('todas') : rotulo('brand', unica);
}

export function rotuloRepresentante(representante: string | null): string {
  return representante ?? SEM_REPRESENTANTE;
}

/** "68,0% da receita". */
export function detalheParticipacao(fracao: number | null): string | undefined {
  return temNumero(fracao) ? `${percentual(fracao)} da receita` : undefined;
}

/** Aviso abaixo da lista quando ela passa do limite. */
export function textoListaCortada(mostrando: number, total: number): string {
  return `Mostrando ${numero(mostrando)} de ${numero(total)} clientes, os que estão há mais tempo sem comprar. Escolha um filtro rápido ou um representante para ver os outros.`;
}

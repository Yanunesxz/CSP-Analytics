/**
 * Filtro rápido da lista de clientes (Ativos, Inativos, Perdidos, Reativados, Sem situação).
 * Fica na URL (`?recorte=inativos`), como todo filtro: o link compartilhado abre igual e o voltar
 * do navegador funciona. Não é filtro global: não segue para outras telas.
 */

import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RECORTES, type Recorte } from '../../data/queries/base-de-clientes';
import { ANCORA_DA_LISTA_DA_BASE } from '../../rotas';

export const CHAVE_RECORTE = 'recorte';

/**
 * Destino dos indicadores da tela: a lista, já no filtro rápido daquele número e rolada até ela
 * (tarefa T5 em um toque). Passe para `linkCom`, que acrescenta marca, visão e período.
 */
export function linkDaLista(recorte: Recorte | null): string {
  return `/base${recorte ? `?${CHAVE_RECORTE}=${recorte}` : ''}#${ANCORA_DA_LISTA_DA_BASE}`;
}

/** Valor da URL → recorte válido; qualquer outra coisa é "Todos" (null). */
export function lerRecorte(valor: string | null | undefined): Recorte | null {
  return RECORTES.find((r) => r.codigo === valor)?.codigo ?? null;
}

/** Cópia dos parâmetros com o recorte (ou sem ele), sem mexer nos outros filtros. */
export function escreverRecorte(params: URLSearchParams, recorte: Recorte | null): URLSearchParams {
  const proximo = new URLSearchParams(params);
  if (recorte) proximo.set(CHAVE_RECORTE, recorte);
  else proximo.delete(CHAVE_RECORTE);
  return proximo;
}

export function useRecorte(): { recorte: Recorte | null; definirRecorte: (recorte: Recorte | null) => void } {
  const [params, setParams] = useSearchParams();
  const recorte = lerRecorte(params.get(CHAVE_RECORTE));
  const definirRecorte = useCallback(
    (proximo: Recorte | null) => setParams((atuais) => escreverRecorte(atuais, proximo), { replace: true }),
    [setParams],
  );
  return { recorte, definirRecorte };
}

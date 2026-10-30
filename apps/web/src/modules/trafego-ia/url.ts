/**
 * Estado da tela Tráfego com IA na URL (regra 13 da seção 7: aba, filtro e página ficam no endereço).
 *
 * São chaves só desta tela, fora de `Filtros` (não seguem para outras telas): `aba`, os filtros da lista
 * (`status`, `impacto`, `esforco`), a proposta aberta na fila (`proposta`) e quantos registros do diário
 * aparecem (`diario`). Os conjuntos salvos da lista ("Meus filtros da lista") guardam também canal,
 * campanha e operador da barra, porque é assim que a pessoa pensa a lista ("ideias do Claude no Meta").
 */

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ActionStatus, Level } from '@csp-mkt/shared';
import {
  LIMITE_DO_DIARIO,
  NIVEIS,
  STATUS_DA_LISTA,
  type FiltrosDaLista,
} from '../../data/queries/trafego-ia';
import { escreverFiltros, type Filtros } from '../../lib/url-state';

export type Aba = 'fila' | 'estrategia' | 'limites' | 'operadores' | 'diario';

export const ABAS: ReadonlyArray<{ codigo: Aba; rotulo: string }> = [
  { codigo: 'fila', rotulo: 'Fila e ações' },
  { codigo: 'estrategia', rotulo: 'Estratégia' },
  { codigo: 'limites', rotulo: 'Limites de gasto' },
  { codigo: 'operadores', rotulo: 'Humano × Claude' },
  { codigo: 'diario', rotulo: 'Diário' },
];

const ABA_PADRAO: Aba = 'fila';
const MAXIMO_DO_DIARIO = 1000;

export interface ParametrosDaTela {
  aba: Aba;
  lista: FiltrosDaLista;
  proposta: string | null;
  diario: number;
}

export type ParcialDaTela = Partial<{
  aba: Aba;
  status: ActionStatus | null;
  impacto: Level | null;
  esforco: Level | null;
  proposta: string | null;
  diario: number | null;
}>;

function entre<T extends string>(valor: string | null, lista: readonly T[]): T | null {
  return valor !== null && (lista as readonly string[]).includes(valor) ? (valor as T) : null;
}

/** Lê as chaves da tela; valor inválido vira o padrão. */
export function lerParametros(params: URLSearchParams): ParametrosDaTela {
  const diario = Number.parseInt(params.get('diario') ?? '', 10);
  return {
    aba:
      entre(
        params.get('aba'),
        ABAS.map((a) => a.codigo),
      ) ?? ABA_PADRAO,
    lista: {
      status: entre(params.get('status'), STATUS_DA_LISTA),
      impacto: entre(params.get('impacto'), NIVEIS),
      esforco: entre(params.get('esforco'), NIVEIS),
    },
    proposta: params.get('proposta') || null,
    diario:
      Number.isFinite(diario) && diario > LIMITE_DO_DIARIO
        ? Math.min(diario, MAXIMO_DO_DIARIO)
        : LIMITE_DO_DIARIO,
  };
}

/** Cópia dos parâmetros com as chaves da tela; null ou o padrão tira a chave da URL. */
export function escreverParametros(params: URLSearchParams, parcial: ParcialDaTela): URLSearchParams {
  const proximo = new URLSearchParams(params);
  for (const [chave, valor] of Object.entries(parcial)) {
    const padrao =
      valor === null ||
      valor === undefined ||
      (chave === 'aba' && valor === ABA_PADRAO) ||
      (chave === 'diario' && Number(valor) <= LIMITE_DO_DIARIO);
    if (padrao) proximo.delete(chave);
    else proximo.set(chave, String(valor));
  }
  return proximo;
}

/* ---------- Meus filtros da lista ---------- */

export interface ConjuntoSalvo {
  nome: string;
  filtros: {
    canal: Filtros['canal'];
    campanha: Filtros['campanha'];
    operador: Filtros['operador'];
    status: ActionStatus | null;
    impacto: Level | null;
    esforco: Level | null;
  };
}

const CHAVE_CONJUNTOS = 'meus-filtros-trafego';

export function lerConjuntos(): ConjuntoSalvo[] {
  try {
    const bruto = localStorage.getItem(CHAVE_CONJUNTOS);
    const lista = bruto ? (JSON.parse(bruto) as unknown) : [];
    return Array.isArray(lista)
      ? (lista as ConjuntoSalvo[]).filter((c) => typeof c?.nome === 'string' && typeof c.filtros === 'object')
      : [];
  } catch {
    return [];
  }
}

export function gravarConjuntos(lista: ConjuntoSalvo[]): void {
  try {
    localStorage.setItem(CHAVE_CONJUNTOS, JSON.stringify(lista));
  } catch {
    /* sem localStorage: os conjuntos valem só nesta aba */
  }
}

/** Um conjunto com os filtros de agora (barra + lista). */
export function conjuntoDe(nome: string, filtros: Filtros, lista: FiltrosDaLista): ConjuntoSalvo {
  return {
    nome,
    filtros: {
      canal: filtros.canal,
      campanha: filtros.campanha,
      operador: filtros.operador,
      status: lista.status,
      impacto: lista.impacto,
      esforco: lista.esforco,
    },
  };
}

/** Aplica um conjunto salvo numa gravação só (barra e lista juntas), voltando a lista para o começo. */
export function aplicarConjunto(params: URLSearchParams, conjunto: ConjuntoSalvo): URLSearchParams {
  const f = conjunto.filtros;
  const comBarra = escreverFiltros(params, {
    canal: f.canal ?? null,
    campanha: f.campanha ?? null,
    operador: f.operador ?? 'todos',
  });
  return escreverParametros(comBarra, {
    status: entre(f.status ?? null, STATUS_DA_LISTA),
    impacto: entre(f.impacto ?? null, NIVEIS),
    esforco: entre(f.esforco ?? null, NIVEIS),
    aba: 'fila',
  });
}

/** Resumo de um conjunto para a lista de "Meus filtros da lista". */
export function quantosFiltros(conjunto: ConjuntoSalvo): number {
  const f = conjunto.filtros;
  return [
    f.canal,
    f.campanha,
    f.operador && f.operador !== 'todos' ? f.operador : null,
    f.status,
    f.impacto,
    f.esforco,
  ].filter(Boolean).length;
}

/* ---------- Hook ---------- */

export interface UsoDaTela extends ParametrosDaTela {
  definir: (parcial: ParcialDaTela) => void;
  aplicar: (conjunto: ConjuntoSalvo) => void;
}

export function useParametrosDaTela(): UsoDaTela {
  const [params, setParams] = useSearchParams();
  const lidos = lerParametros(params);
  const { status, impacto, esforco } = lidos.lista;
  // A lista vira dependência da consulta: só muda de identidade quando um dos três muda
  const lista = useMemo(() => ({ status, impacto, esforco }), [status, impacto, esforco]);

  const definir = useCallback(
    (parcial: ParcialDaTela) => setParams((atuais) => escreverParametros(atuais, parcial), { replace: true }),
    [setParams],
  );
  const aplicar = useCallback(
    (conjunto: ConjuntoSalvo) => setParams((atuais) => aplicarConjunto(atuais, conjunto), { replace: true }),
    [setParams],
  );

  return { ...lidos, lista, definir, aplicar };
}

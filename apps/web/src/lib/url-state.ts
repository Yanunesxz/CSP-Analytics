/**
 * Filtros na URL (lei 13 da seção 7: aba, filtro e página ficam no endereço).
 *
 * A URL vence. `marca` e `visao` são controles globais: também ficam em localStorage
 * ("marca", "visao") como último valor, para valer quando a URL não diz nada.
 * `estado` é parâmetro de demonstração: quando presente, toda tela mostra esse estado.
 */

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Brand, LeadSource, Platform } from '@csp-mkt/shared';
import type { Periodo } from './periodo';

export type Marca = Brand | 'todas';
export type Visao = 'visualizador' | 'gestor';
export type OperadorFiltro = 'human' | 'claude' | 'todos';
export type EstadoDemo = 'carregando' | 'vazio' | 'erro' | 'sem-dados';

export interface Filtros {
  marca: Marca;
  visao: Visao;
  periodo: Periodo;
  comparar: boolean;
  canal: Platform | null;
  campanha: string | null;
  operador: OperadorFiltro;
  origem: LeadSource | null;
  representante: string | null;
  estado: EstadoDemo | null;
}

export type ChaveFiltro = keyof Filtros;

export const FILTROS_PADRAO: Readonly<Filtros> = {
  marca: 'todas',
  visao: 'visualizador',
  periodo: 'este-mes',
  comparar: true,
  canal: null,
  campanha: null,
  operador: 'todos',
  origem: null,
  representante: null,
  estado: null,
};

/** Chaves que seguem a pessoa de uma tela para a outra (links do menu e dos KPIs). */
export const CHAVES_GLOBAIS: readonly ChaveFiltro[] = ['marca', 'visao', 'periodo', 'comparar', 'estado'];

/** Chaves que a tela filtra e que viram chip "ativo" na barra de filtros. */
export const CHAVES_DE_TELA: readonly ChaveFiltro[] = [
  'canal',
  'campanha',
  'operador',
  'origem',
  'representante',
];

const MARCAS: readonly Marca[] = ['cs', 'plumene', 'todas'];
const VISOES: readonly Visao[] = ['visualizador', 'gestor'];
const PERIODOS_VALIDOS: readonly Periodo[] = ['este-mes', 'mes-passado', '7d', '30d', '90d'];
const CANAIS: readonly Platform[] = ['meta', 'tiktok', 'google'];
const OPERADORES: readonly OperadorFiltro[] = ['human', 'claude', 'todos'];
const ORIGENS: readonly LeadSource[] = [
  'meta',
  'tiktok',
  'google',
  'site',
  'organic',
  'ai_assistant',
  'sdr',
  'referral',
  'direct',
];
const ESTADOS: readonly EstadoDemo[] = ['carregando', 'vazio', 'erro', 'sem-dados'];

function entre<T extends string>(valor: string | null, lista: readonly T[]): T | null {
  return valor && (lista as readonly string[]).includes(valor) ? (valor as T) : null;
}

export interface Memoria {
  marca?: Marca | null;
  visao?: Visao | null;
}

/** Último valor guardado de marca e visão. */
export function lerMemoria(): Memoria {
  try {
    return {
      marca: entre(localStorage.getItem('marca'), MARCAS),
      visao: entre(localStorage.getItem('visao'), VISOES),
    };
  } catch {
    return {};
  }
}

export function guardarMemoria(parcial: Memoria): void {
  try {
    if (parcial.marca) localStorage.setItem('marca', parcial.marca);
    if (parcial.visao) localStorage.setItem('visao', parcial.visao);
  } catch {
    /* sem localStorage: vale só a URL */
  }
}

/** Lê os filtros de uma URL. A URL vence; marca e visão caem para a memória e depois para o padrão. */
export function lerFiltros(params: URLSearchParams, memoria: Memoria = {}): Filtros {
  const comparar = params.get('comparar');
  return {
    marca: entre(params.get('marca'), MARCAS) ?? memoria.marca ?? FILTROS_PADRAO.marca,
    visao: entre(params.get('visao'), VISOES) ?? memoria.visao ?? FILTROS_PADRAO.visao,
    periodo: entre(params.get('periodo'), PERIODOS_VALIDOS) ?? FILTROS_PADRAO.periodo,
    comparar: comparar === null ? FILTROS_PADRAO.comparar : comparar !== 'false',
    canal: entre(params.get('canal'), CANAIS),
    campanha: params.get('campanha') || null,
    operador: entre(params.get('operador'), OPERADORES) ?? FILTROS_PADRAO.operador,
    origem: entre(params.get('origem'), ORIGENS),
    representante: params.get('representante') || null,
    estado: entre(params.get('estado'), ESTADOS),
  };
}

/**
 * Grava filtros numa cópia dos parâmetros. Valor igual ao padrão sai da URL, exceto marca e
 * visão, que ficam sempre explícitas (senão a memória venceria a escolha "As duas").
 */
export function escreverFiltros(params: URLSearchParams, parcial: Partial<Filtros>): URLSearchParams {
  const proximo = new URLSearchParams(params);
  for (const [chave, valor] of Object.entries(parcial) as [ChaveFiltro, Filtros[ChaveFiltro]][]) {
    const sempre = chave === 'marca' || chave === 'visao';
    if (valor === null || valor === undefined || (!sempre && valor === FILTROS_PADRAO[chave])) {
      proximo.delete(chave);
    } else {
      proximo.set(chave, String(valor));
    }
  }
  return proximo;
}

/** Só as chaves globais, para o link de outra tela carregar marca, visão e período. */
export function apenasGlobais(params: URLSearchParams): URLSearchParams {
  const proximo = new URLSearchParams();
  for (const chave of CHAVES_GLOBAIS) {
    const valor = params.get(chave);
    if (valor !== null) proximo.set(chave, valor);
  }
  return proximo;
}

function comoSearch(params: URLSearchParams): string {
  const texto = params.toString();
  return texto ? `?${texto}` : '';
}

export interface UsoDeFiltros {
  filtros: Filtros;
  /** Grava um ou mais filtros na URL (e marca/visão na memória). `null` limpa a chave. */
  definir: (parcial: Partial<Filtros>) => void;
  /** Limpa as chaves dadas; sem argumento, limpa os filtros de tela (canal, campanha, operador, origem, representante). */
  limpar: (chaves?: readonly ChaveFiltro[]) => void;
  /** Filtros de tela que estão ativos (diferentes do padrão). */
  ativos: ChaveFiltro[];
  /** Caminho com os filtros globais atuais (e, se quiser, outros) para `<Link to>`. */
  linkCom: (pathname: string, parcial?: Partial<Filtros>) => string;
  /** A string `?…` só com os filtros globais, para links do menu. */
  searchGlobal: string;
}

export function useFiltros(): UsoDeFiltros {
  const [params, setParams] = useSearchParams();

  const filtros = useMemo(() => lerFiltros(params, lerMemoria()), [params]);

  const definir = useCallback(
    (parcial: Partial<Filtros>) => {
      guardarMemoria({ marca: parcial.marca, visao: parcial.visao });
      setParams((atuais) => escreverFiltros(atuais, parcial), { replace: true });
    },
    [setParams],
  );

  const limpar = useCallback(
    (chaves: readonly ChaveFiltro[] = CHAVES_DE_TELA) => {
      const parcial: Partial<Filtros> = {};
      for (const chave of chaves) (parcial as Record<string, unknown>)[chave] = null;
      setParams((atuais) => escreverFiltros(atuais, parcial), { replace: true });
    },
    [setParams],
  );

  const ativos = useMemo(
    () => CHAVES_DE_TELA.filter((chave) => filtros[chave] !== FILTROS_PADRAO[chave]),
    [filtros],
  );

  const searchGlobal = useMemo(() => comoSearch(apenasGlobais(params)), [params]);

  const linkCom = useCallback(
    (pathname: string, parcial: Partial<Filtros> = {}) =>
      `${pathname}${comoSearch(escreverFiltros(apenasGlobais(params), parcial))}`,
    [params],
  );

  return { filtros, definir, limpar, ativos, linkCom, searchGlobal };
}

/**
 * Store de demonstração em memória (`useSyncExternalStore`).
 *
 * - Sem `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`: modo demonstração, abre sem login e vazio.
 * - Com `VITE_SAMPLE_DATA=true`: carrega os dados de exemplo pelo gerador determinístico.
 * - `recomecar()` restaura os dados de exemplo (desfaz o que a pessoa mexeu na demonstração).
 * - As telas não sabem o modo: só chamam `useConsulta(query)` e recebem `estado` + `dados`.
 *
 * Fase 3: o modo Supabase troca `carregarInicial()` por leitura das views, sem mudar as telas.
 */

import { useMemo, useSyncExternalStore } from 'react';
import { modoDeAcesso, type ModoDeAcesso } from '../lib/auth';
import { useFiltros, type EstadoDemo, type Filtros } from '../lib/url-state';
import { DADOS_VAZIOS, estaVazio, type Dados } from './dados';
import { gerarDadosDeExemplo } from './sample';

function comDadosDeExemplo(): boolean {
  return import.meta.env.VITE_SAMPLE_DATA === 'true';
}

function carregarInicial(): Dados {
  if (modoDeAcesso() === 'demonstracao' && comDadosDeExemplo()) return gerarDadosDeExemplo();
  return { ...DADOS_VAZIOS };
}

let dados: Dados = carregarInicial();
const ouvintes = new Set<() => void>();

function avisar(): void {
  ouvintes.forEach((o) => o());
}

export const store = {
  getSnapshot: (): Dados => dados,
  subscribe: (ouvinte: () => void): (() => void) => {
    ouvintes.add(ouvinte);
    return () => {
      ouvintes.delete(ouvinte);
    };
  },
  get modo(): ModoDeAcesso {
    return modoDeAcesso();
  },
  get demonstracao(): boolean {
    return modoDeAcesso() === 'demonstracao';
  },
  get comDadosDeExemplo(): boolean {
    return modoDeAcesso() === 'demonstracao' && comDadosDeExemplo();
  },
  /** Restaura os dados de exemplo (botão "Recomeçar" da faixa de demonstração). */
  recomecar(): void {
    dados = carregarInicial();
    avisar();
  },
  /** Troca o conjunto inteiro (usado pelos `actions` e, na fase 3, pela leitura das views). */
  alterar(mutador: (atual: Dados) => Dados): void {
    dados = mutador(dados);
    avisar();
  },
};

export function recomecar(): void {
  store.recomecar();
}

/** O conjunto de dados atual. Prefira `useConsulta` nas telas. */
export function useDados(): Dados {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export type EstadoDaConsulta = 'carregando' | 'vazio' | 'erro' | 'sem-dados' | 'ok';

export interface Resultado<T> {
  estado: EstadoDaConsulta;
  /** Preenchido em `ok` e `sem-dados` (com métricas null); null em `carregando`, `erro` e `vazio`. */
  dados: T | null;
  /** Código curto para o `.yn-empty__code` quando `estado` é `erro`. */
  codigo: string | null;
  filtros: Filtros;
  /** Quando o conjunto foi gerado ou sincronizado, para "atualizado há X min". */
  atualizadoEm: string | null;
}

export type Consulta<T> = (dados: Dados, filtros: Filtros, agora: Date) => T;

/**
 * Roda uma consulta pura sobre o store com os filtros da URL e honra `?estado=`:
 * `carregando`/`erro` não rodam a consulta; `vazio` e `sem-dados` rodam sobre o conjunto vazio.
 * Sem `?estado=`, um store vazio devolve `vazio` e o resto devolve `ok`.
 */
export function useConsulta<T>(consulta: Consulta<T>): Resultado<T> {
  const atual = useDados();
  const { filtros } = useFiltros();

  return useMemo(() => {
    const base = { filtros, codigo: null, atualizadoEm: atual.geradoEm };
    const demo: EstadoDemo | null = filtros.estado;
    if (demo === 'carregando') return { ...base, estado: 'carregando', dados: null };
    if (demo === 'erro') return { ...base, estado: 'erro', dados: null, codigo: 'DEMO-500' };
    if (demo === 'vazio') return { ...base, estado: 'vazio', dados: null };
    if (demo === 'sem-dados')
      return { ...base, estado: 'sem-dados', dados: consulta({ ...DADOS_VAZIOS }, filtros, new Date()) };
    if (estaVazio(atual)) return { ...base, estado: 'vazio', dados: null };
    return { ...base, estado: 'ok', dados: consulta(atual, filtros, new Date()) };
  }, [atual, filtros, consulta]);
}

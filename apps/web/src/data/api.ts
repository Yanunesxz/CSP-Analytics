/**
 * Leitura das funções de tela (`api.kpi_*`) no modo Supabase, com os mesmos estados de `useConsulta` (carregando,
 * erro, vazio, sem-dados, ok) e o mesmo `?estado=` para forçar um estado. A tela recebe o painel já no formato dela:
 * `mapear` só troca nomes (decisão 0034).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { codigoDoErro, supabase } from '../lib/supabase';
import { useFiltros, type Filtros } from '../lib/url-state';
import { filtrosDaApi } from './fonte';
import type { Resultado } from './store';

interface Leitura<R> {
  chave: string;
  resposta: R | null;
  codigo: string | null;
}

export interface ConsultaDaApi<T> {
  resultado: Resultado<T>;
  /** Lê de novo (botão "Tentar de novo" da falha). */
  recarregar: () => void;
}

export function useConsultaDaApi<R extends { has_data: boolean }, T>(
  funcao: string,
  mapear: (resposta: R, filtros: Filtros, agora: Date) => T,
  atualizadoEm: (resposta: R) => string | null,
): ConsultaDaApi<T> {
  const { filtros } = useFiltros();
  const parametros = useMemo(() => filtrosDaApi(filtros), [filtros]);
  const chave = JSON.stringify(parametros);
  const [vez, setVez] = useState(0);
  const [leitura, setLeitura] = useState<Leitura<R> | null>(null);

  useEffect(() => {
    const cliente = supabase();
    if (!cliente || filtros.estado) return;
    let valendo = true;
    const pedido = `${chave}#${vez}`;
    void cliente.rpc(funcao, { p_filters: JSON.parse(chave) }).then(({ data, error }) => {
      if (!valendo) return;
      setLeitura({
        chave: pedido,
        resposta: error ? null : (data as R),
        codigo: error ? codigoDoErro(error) : null,
      });
    });
    return () => {
      valendo = false;
    };
  }, [funcao, chave, vez, filtros.estado]);

  const recarregar = useCallback(() => setVez((v) => v + 1), []);

  const resultado = useMemo((): Resultado<T> => {
    const base = { filtros, codigo: null, atualizadoEm: null };
    const demo = filtros.estado;
    if (demo === 'carregando') return { ...base, estado: 'carregando', dados: null };
    if (demo === 'erro') return { ...base, estado: 'erro', dados: null, codigo: 'DEMO-500' };
    if (demo === 'vazio') return { ...base, estado: 'vazio', dados: null };
    // Ainda sem a resposta destes filtros: esqueleto (nunca o painel dos filtros anteriores).
    if (!leitura || leitura.chave !== `${chave}#${vez}`)
      return { ...base, estado: 'carregando', dados: null };
    if (leitura.codigo || !leitura.resposta)
      return { ...base, estado: 'erro', dados: null, codigo: leitura.codigo ?? 'API-500' };
    const r = leitura.resposta;
    if (!r.has_data && demo !== 'sem-dados') return { ...base, estado: 'vazio', dados: null };
    return {
      ...base,
      estado: demo === 'sem-dados' || !r.has_data ? 'sem-dados' : 'ok',
      dados: mapear(r, filtros, new Date()),
      atualizadoEm: atualizadoEm(r),
    };
  }, [leitura, chave, vez, filtros, mapear, atualizadoEm]);

  return { resultado, recarregar };
}

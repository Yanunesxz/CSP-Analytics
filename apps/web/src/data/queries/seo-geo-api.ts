/**
 * O painel SEO e GEO a partir de `api.kpi_seo_geo` (modo Supabase). Pura, com teste em `seo-geo-api.test.ts`: só muda
 * o formato (nomes, códigos e a série por marca), nunca soma, conta ou divide (decisão 0034; o banco faz a conta).
 *
 * Por enquanto o banco devolve só o GA4 (SG8 a SG12). Busca orgânica, leads e clientes novos, checagem dos sites e
 * pendências chegam vazios ("Sem dados" em cada bloco) até a função de tela trazer essas fontes.
 */

import type { ApiKpiSeoGeo, ApiMetric, Brand } from '@csp-mkt/shared';
import { partesDoDia } from '../../lib/datas';
import { intervaloDoPeriodo, type Intervalo } from '../../lib/periodo';
import type { Filtros } from '../../lib/url-state';
import type { Metrica } from '../queries';
import type { FonteDoPainel, PainelSeoGeo, SerieDaMarca } from './seo-geo';

const SEM_DADOS: Metrica = Object.freeze({ atual: null, anterior: null, variacao: null });

export function metricaDaApi(m: ApiMetric | null | undefined): Metrica {
  if (!m) return { ...SEM_DADOS };
  return { atual: m.current, anterior: m.previous, variacao: m.variation };
}

function diaMes(dia: string): string {
  const { dia: d, mes } = partesDoDia(dia);
  return `${String(d).padStart(2, '0')}/${String(mes).padStart(2, '0')}`;
}

/** O período da resposta; a comparação diz as datas de verdade, só com os dias completos da fonte. */
export function intervaloDaApi(r: ApiKpiSeoGeo, filtros: Filtros, agora: Date): Intervalo {
  const base = intervaloDoPeriodo(filtros.periodo, agora);
  const p = r.period;
  return {
    ...base,
    inicio: p.start_on,
    fim: p.end_on,
    anteriorInicio: p.previous_start_on ?? base.anteriorInicio,
    anteriorFim: p.previous_end_on ?? base.anteriorFim,
    dias: p.days,
    rotuloAnterior:
      p.previous_start_on && p.previous_end_on
        ? `vs. ${diaMes(p.previous_start_on)} a ${diaMes(p.previous_end_on)}`
        : base.rotuloAnterior,
  };
}

function seriePorMarca(daily: ApiKpiSeoGeo['geo']['daily']): SerieDaMarca[] {
  const porMarca = new Map<Brand, SerieDaMarca>();
  for (const d of daily) {
    let serie = porMarca.get(d.brand);
    if (!serie) {
      serie = { marca: d.brand, pontos: [] };
      porMarca.set(d.brand, serie);
    }
    serie.pontos.push({ x: d.metric_on, y: d.ai_sessions });
  }
  return [...porMarca.values()];
}

export function painelSeoGeoDaApi(r: ApiKpiSeoGeo, filtros: Filtros, agora: Date = new Date()): PainelSeoGeo {
  const ga4 = r.sources.ga4;
  const fonteGa4: FonteDoPainel = {
    id: 'ga4',
    status: ga4.status,
    lastSyncAt: ga4.last_success_at,
    atrasado: ga4.status === 'late',
  };
  return {
    intervalo: intervaloDaApi(r, filtros, agora),
    atualizadoEm: ga4.last_success_at,
    fontes: { search_console: null, ga4: fonteGa4, csp360: null },
    seo: {
      impressoes: { ...SEM_DADOS },
      cliques: { ...SEM_DADOS },
      ctr: { ...SEM_DADOS },
      posicaoMedia: { ...SEM_DADOS },
      cliquesPorDia: [],
      posicaoPorDia: [],
      consultas: [],
      participacaoDasConsultas: null,
      temConsultas: false,
    },
    geo: {
      sessoes: metricaDaApi(r.geo.ai_sessions),
      sessoesDoSite: metricaDaApi(r.geo.sessions),
      parcelaDasSessoes: metricaDaApi(r.geo.ai_share),
      porAssistente: r.geo.by_ai_source.map((a) => ({
        fonte: a.ai_source,
        sessoes: metricaDaApi(a.sessions),
        parcela: a.share,
      })),
      porCanal: r.geo.by_channel.map((c) => ({ canal: c.channel, sessoes: c.sessions, parcela: c.share })),
      sessoesPorDia: seriePorMarca(r.geo.daily),
      temCanais: r.coverage.ga4,
    },
    leads: {
      buscaOrganica: { ...SEM_DADOS },
      clientesNovosDaBusca: { ...SEM_DADOS },
      assistentesDeIa: { ...SEM_DADOS },
      clientesNovosDeIa: { ...SEM_DADOS },
      porFonte: [],
    },
    sites: [],
    pendencias: [],
  };
}

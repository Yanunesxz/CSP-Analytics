import type { ApiKpiSeoGeo } from '@csp-mkt/shared';
import { describe, expect, it } from 'vitest';
import { FILTROS_PADRAO } from '../../lib/url-state';
import { painelSeoGeoDaApi } from './seo-geo-api';

const AGORA = new Date('2026-11-20T13:00:00Z');

const RESPOSTA: ApiKpiSeoGeo = {
  period: {
    start_on: '2026-11-14',
    end_on: '2026-11-20',
    compared_through_on: '2026-11-17',
    previous_start_on: '2026-11-07',
    previous_end_on: '2026-11-10',
    days: 7,
  },
  coverage: { ga4: true },
  has_data: true,
  geo: {
    ai_sessions: { current: 9, previous: 5, variation: 0.8 },
    ai_share: { current: 0.1139, previous: 0.0588, variation: 1.5932 },
    sessions: { current: 79, previous: 85, variation: -0.3059 },
    by_ai_source: [
      { ai_source: 'chatgpt', sessions: { current: 6, previous: 5, variation: 0.2 }, share: 0.6667 },
      { ai_source: 'other', sessions: { current: 1, previous: 0, variation: null }, share: 0.1111 },
    ],
    by_channel: [
      { channel: 'organic_search', sessions: 60, share: 0.7595 },
      { channel: 'other', sessions: 3, share: 0.038 },
    ],
    daily: [
      { brand: 'cs', metric_on: '2026-11-14', ai_sessions: null },
      { brand: 'cs', metric_on: '2026-11-15', ai_sessions: 8 },
    ],
  },
  sources: {
    ga4: {
      last_success_at: '2026-11-20T12:00:00Z',
      complete_through_on: '2026-11-17',
      covered: true,
      status: 'ok',
    },
  },
};

describe('painelSeoGeoDaApi', () => {
  const painel = painelSeoGeoDaApi(RESPOSTA, { ...FILTROS_PADRAO, periodo: '7d' }, AGORA);

  it('só troca os nomes: os números são os do banco', () => {
    expect(painel.geo.sessoes).toEqual({ atual: 9, anterior: 5, variacao: 0.8 });
    expect(painel.geo.parcelaDasSessoes).toEqual({ atual: 0.1139, anterior: 0.0588, variacao: 1.5932 });
    expect(painel.geo.porAssistente).toEqual([
      { fonte: 'chatgpt', sessoes: { atual: 6, anterior: 5, variacao: 0.2 }, parcela: 0.6667 },
      { fonte: 'other', sessoes: { atual: 1, anterior: 0, variacao: null }, parcela: 0.1111 },
    ]);
    expect(painel.geo.porCanal).toEqual([
      { canal: 'organic_search', sessoes: 60, parcela: 0.7595 },
      { canal: 'other', sessoes: 3, parcela: 0.038 },
    ]);
  });

  it('a série por dia fica por marca, com o nulo do dia sem linha', () => {
    expect(painel.geo.sessoesPorDia).toEqual([
      {
        marca: 'cs',
        pontos: [
          { x: '2026-11-14', y: null },
          { x: '2026-11-15', y: 8 },
        ],
      },
    ]);
  });

  it('o período e o rótulo da comparação vêm das datas do banco (só os dias completos)', () => {
    expect(painel.intervalo).toMatchObject({
      inicio: '2026-11-14',
      fim: '2026-11-20',
      anteriorInicio: '2026-11-07',
      anteriorFim: '2026-11-10',
      dias: 7,
      rotulo: 'Últimos 7 dias',
      rotuloAnterior: 'vs. 07/11 a 10/11',
    });
  });

  it('o selo do GA4 e o "atualizado há" vêm do conector; o resto da tela fica "Sem dados"', () => {
    expect(painel.fontes.ga4).toEqual({
      id: 'ga4',
      status: 'ok',
      lastSyncAt: '2026-11-20T12:00:00Z',
      atrasado: false,
    });
    expect(painel.atualizadoEm).toBe('2026-11-20T12:00:00Z');
    expect(painel.fontes.search_console).toBeNull();
    expect(painel.seo.cliques).toEqual({ atual: null, anterior: null, variacao: null });
    expect(painel.leads.assistentesDeIa).toEqual({ atual: null, anterior: null, variacao: null });
    expect(painel.sites).toEqual([]);
  });
});

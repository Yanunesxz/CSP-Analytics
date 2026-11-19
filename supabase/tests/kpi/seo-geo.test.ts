// api.kpi_seo_geo, a parte do GA4 (docs/dados/metricas.md, seções 2.1, 2.3, 2.5, 4.8 e 6.7): sessões de IA, parcela,
// por assistente, por canal e por dia, com a base por propriedade e a comparação só com os dias completos do GA4.
import type { PGlite } from '@electric-sql/pglite';
import type { ApiKpiSeoGeo } from '@csp-mkt/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Sessao, abrirBanco, aplicarFixture, caso, postgres, usuario } from '../apoio/banco';
import { DONO, EX_GESTOR, GESTOR, SEM_PERFIL } from '../apoio/usuarios';

const PROPRIEDADE = '00000000-0000-4000-8000-0000000009a1';

let db: PGlite;

beforeAll(async () => {
  db = await abrirBanco();
  await aplicarFixture(db, 'usuarios');
});

afterAll(async () => {
  await db.close();
});

/**
 * Hoje é 20/11/2026, 10 h em São Paulo. A propriedade da Corpo Sensual tem sessões em 08, 10, 15, 17 e 18/11. O dia 18
 * foi lido só 8 h depois de fechar: o último dia completo do GA4 é 17/11.
 */
async function prepararGa4(s: Sessao, opcoes: { comBase?: boolean } = {}): Promise<void> {
  const comBase = opcoes.comBase ?? true;
  await s.exec(`
    insert into test.clock (now_at) values ('2026-11-20 10:00:00-03');
    insert into mkt.web_properties (id, brand_id, kind, source, external_id, host, first_read_at)
    select '${PROPRIEDADE}', b.id, 'ga4_property', 'ga4', '123456789', 'corposensual.example',
           ${comBase ? "'2026-11-20 09:00:00-03'" : 'null'}
      from mkt.brands b where b.code = 'cs';
    update mkt.connectors
       set first_success_at = ${comBase ? "'2026-11-20 09:00:00-03'" : 'null'},
           last_success_at = ${comBase ? "'2026-11-20 09:00:00-03'" : 'null'}
     where code = 'ga4';
    insert into mkt.ga4_traffic_daily (web_property_id, brand_id, metric_on, session_source, session_medium,
                                       channel_group_raw, sessions, lead_events, fetched_at)
    select w.id, w.brand_id, v.dia::date, v.origem, v.meio, v.canal, v.sessoes, 0, v.lido::timestamptz
      from mkt.web_properties w,
           (values ('2026-11-08', 'google', 'organic', 'Organic Search', 50, '2026-11-20 09:00:00-03'),
                   ('2026-11-08', 'chatgpt.com', 'referral', 'AI Assistant', 5, '2026-11-20 09:00:00-03'),
                   ('2026-11-10', '(direct)', '(none)', 'Direct', 30, '2026-11-20 09:00:00-03'),
                   ('2026-11-15', 'google', 'organic', 'Organic Search', 40, '2026-11-20 09:00:00-03'),
                   ('2026-11-15', 'chatgpt.com', 'referral', 'AI Assistant', 6, '2026-11-20 09:00:00-03'),
                   -- Antes do canal "AI Assistant" do GA4: a origem decide que é IA.
                   ('2026-11-15', 'perplexity.ai', 'referral', 'Referral', 2, '2026-11-20 09:00:00-03'),
                   ('2026-11-17', 'novo-assistente.ai', 'referral', 'AI Assistant', 1, '2026-11-20 09:00:00-03'),
                   ('2026-11-17', 'instagram', 'social', 'Organic Social', 10, '2026-11-20 09:00:00-03'),
                   ('2026-11-18', 'google', 'organic', 'Organic Search', 20, '2026-11-19 08:00:00-03'))
             as v(dia, origem, meio, canal, sessoes, lido)
     where w.id = '${PROPRIEDADE}';`);
}

async function kpi(s: Sessao, filtros: Record<string, unknown>): Promise<ApiKpiSeoGeo> {
  return s.valor<ApiKpiSeoGeo>('select api.kpi_seo_geo($1::jsonb)', [JSON.stringify(filtros)]);
}

describe('api.kpi_seo_geo: GA4', () => {
  it('soma as sessões de IA, a parcela e a comparação só com os dias completos do GA4', async () => {
    await caso(db, postgres, async (s) => {
      await prepararGa4(s);
      await s.como(usuario(DONO));
      const r = await kpi(s, { brand: 'cs', period: 'last_7_days' });

      expect(r.has_data).toBe(true);
      expect(r.coverage).toEqual({ ga4: true });
      // 14 a 20/11, comparado de 14 a 17/11 contra 07 a 10/11.
      expect(r.period).toEqual({
        start_on: '2026-11-14',
        end_on: '2026-11-20',
        compared_through_on: '2026-11-17',
        previous_start_on: '2026-11-07',
        previous_end_on: '2026-11-10',
        days: 7,
      });
      expect(r.sources.ga4.complete_through_on).toBe('2026-11-17');
      expect(r.sources.ga4.status).toBe('ok');
      expect(r.geo.ai_sessions).toEqual({ current: 9, previous: 5, variation: 0.8 });
      expect(r.geo.sessions).toEqual({ current: 79, previous: 85, variation: -0.3059 });
      // 9 ÷ 79 agora; 9 ÷ 59 contra 5 ÷ 85 nos dias completos.
      expect(r.geo.ai_share).toEqual({ current: 0.1139, previous: 0.0588, variation: 1.5932 });
    });
  });

  it('abre por assistente (com "Outro assistente") e por canal, do maior para o menor', async () => {
    await caso(db, postgres, async (s) => {
      await prepararGa4(s);
      await s.como(usuario(DONO));
      const r = await kpi(s, { brand: 'cs', period: 'last_7_days' });

      expect(r.geo.by_ai_source).toEqual([
        { ai_source: 'chatgpt', sessions: { current: 6, previous: 5, variation: 0.2 }, share: 0.6667 },
        { ai_source: 'perplexity', sessions: { current: 2, previous: 0, variation: null }, share: 0.2222 },
        { ai_source: 'other', sessions: { current: 1, previous: 0, variation: null }, share: 0.1111 },
        { ai_source: 'claude', sessions: { current: 0, previous: 0, variation: null }, share: 0 },
        { ai_source: 'gemini', sessions: { current: 0, previous: 0, variation: null }, share: 0 },
        { ai_source: 'copilot', sessions: { current: 0, previous: 0, variation: null }, share: 0 },
      ]);
      expect(r.geo.by_channel).toEqual([
        { channel: 'organic_search', sessions: 60, share: 0.7595 },
        { channel: 'organic_social', sessions: 10, share: 0.1266 },
        { channel: 'ai_assistant', sessions: 9, share: 0.1139 },
      ]);
    });
  });

  it('por dia: nulo no dia sem linha do GA4, 0 no dia com sessões e sem IA', async () => {
    await caso(db, postgres, async (s) => {
      await prepararGa4(s);
      await s.como(usuario(DONO));
      const r = await kpi(s, { period: 'last_7_days' });
      expect(r.geo.daily).toEqual([
        { brand: 'cs', metric_on: '2026-11-14', ai_sessions: null },
        { brand: 'cs', metric_on: '2026-11-15', ai_sessions: 8 },
        { brand: 'cs', metric_on: '2026-11-16', ai_sessions: null },
        { brand: 'cs', metric_on: '2026-11-17', ai_sessions: 1 },
        { brand: 'cs', metric_on: '2026-11-18', ai_sessions: 0 },
        { brand: 'cs', metric_on: '2026-11-19', ai_sessions: null },
        { brand: 'cs', metric_on: '2026-11-20', ai_sessions: null },
      ]);
    });
  });

  it('em "As duas", a marca sem propriedade lida fica fora; sozinha, fica "Sem dados", nunca 0', async () => {
    await caso(db, postgres, async (s) => {
      await prepararGa4(s);
      await s.como(usuario(DONO));
      const duas = await kpi(s, { period: 'last_7_days' });
      expect(duas.geo.ai_sessions.current).toBe(9);

      const plumene = await kpi(s, { brand: 'plumene', period: 'last_7_days' });
      expect(plumene.has_data).toBe(false);
      expect(plumene.geo.ai_sessions).toEqual({ current: null, previous: null, variation: null });
      expect(plumene.geo.ai_share).toEqual({ current: null, previous: null, variation: null });
      expect(plumene.geo.by_ai_source).toEqual([]);
      expect(plumene.geo.daily).toEqual([]);
    });
  });

  it('sem a propriedade lida, nada tem base', async () => {
    await caso(db, postgres, async (s) => {
      await prepararGa4(s, { comBase: false });
      await s.como(usuario(DONO));
      const r = await kpi(s, { brand: 'cs', period: 'last_7_days' });
      expect(r.has_data).toBe(false);
      expect(r.geo.sessions.current).toBeNull();
      expect(r.sources.ga4.last_success_at).toBeNull();
      expect(r.sources.ga4.status).toBe('not_connected');
    });
  });

  it('sem comparar, anterior e variação vêm nulos', async () => {
    await caso(db, postgres, async (s) => {
      await prepararGa4(s);
      await s.como(usuario(DONO));
      const r = await kpi(s, { brand: 'cs', period: 'last_7_days', compare: false });
      expect(r.geo.ai_sessions).toEqual({ current: 9, previous: null, variation: null });
    });
  });

  it('o gestor de tráfego lê; sem perfil ativo é KPI-403, antes de olhar os filtros; filtro desconhecido é KPI-400', async () => {
    await caso(db, postgres, async (s) => {
      await prepararGa4(s);
      await s.como(usuario(GESTOR));
      expect((await kpi(s, { brand: 'cs', period: 'last_7_days' })).geo.ai_sessions.current).toBe(9);
      const e400 = await s.erro('PT400', `select api.kpi_seo_geo('{"marca": "cs"}')`);
      expect(e400.message).toBe('KPI-400');
      await s.erro('PT400', `select api.kpi_seo_geo('{"period": "ontem"}')`);
    });
    for (const quem of [usuario(EX_GESTOR), usuario(SEM_PERFIL)]) {
      await caso(db, quem, async (s) => {
        const e = await s.erro('PT403', `select api.kpi_seo_geo('{"marca": "cs"}')`);
        expect(e.message).toBe('KPI-403');
      });
    }
  });
});

describe('as funções de tela', () => {
  it('são security invoker, com search_path pg_catalog, pg_temp (metricas.md, seção 5)', async () => {
    await caso(db, postgres, async (s) => {
      const linhas = await s.linhas<{ funcao: string; prosecdef: boolean; config: string[] | null }>(
        `select p.oid::regprocedure::text as funcao, p.prosecdef, p.proconfig as config
           from pg_proc p where p.pronamespace = 'api'::regnamespace and p.proname ~ '^kpi_' order by 1`,
      );
      expect(linhas.map((l) => l.funcao)).toEqual(['api.kpi_seo_geo(jsonb)']);
      for (const l of linhas) {
        expect(l.prosecdef, l.funcao).toBe(false);
        expect(l.config, l.funcao).toEqual(['search_path=pg_catalog, pg_temp']);
      }
    });
  });
});

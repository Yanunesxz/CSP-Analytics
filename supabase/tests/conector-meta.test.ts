// Contrato do conector da Meta (apps/worker/csp_worker/meta.py) com a ingestão: os eventos no formato que o adaptador
// gera (os mesmos de apps/worker/tests/test_meta.py) entram pelas funções ingest.* com o papel mkt_worker.
// docs/dados/integracoes.md, seções 2.3 e 4.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { abrirBanco, aplicarFixture, caso, postgres, servico } from './apoio/banco';

let db: PGlite;

beforeAll(async () => {
  db = await abrirBanco();
  for (const f of ['usuarios', 'marketing', 'trafego', 'conectores']) await aplicarFixture(db, f);
});

afterAll(async () => {
  await db.close();
});

const CONTA = {
  kind: 'ad_account',
  source: 'meta_ads',
  brand: 'cs',
  key: { external_id: '900000000000888' },
  values: {
    name: 'CS Anúncios',
    currency: 'BRL',
    time_zone: 'America/Sao_Paulo',
    is_active: true,
    spend_cap_cents: 0,
    amount_spent_cents: 1234567,
  },
  fetched_at: '2026-11-26T13:00:00Z',
};
const campanha = (id: string, status: string, orcamento: number | null) => ({
  kind: 'campaign',
  source: 'meta_ads',
  brand: 'cs',
  key: { external_id: id },
  values: {
    account_external_id: '900000000000888',
    name: `cs-${id}`,
    status,
    daily_budget_cents: orcamento,
    spend_cap_cents: null,
  },
  fetched_at: '2026-11-26T13:00:00Z',
});
const GASTO = [
  {
    kind: 'ad_campaign_daily',
    source: 'meta_ads',
    brand: 'cs',
    key: { campaign_external_id: '111', metric_on: '2026-11-24' },
    values: {
      spend_cents: 53396,
      impressions: 18120,
      clicks: 402,
      platform_leads: 3,
      conversions: '1',
      conversion_value_cents: 19990,
    },
    fetched_at: '2026-11-26T13:00:00Z',
  },
  {
    kind: 'ad_campaign_daily',
    source: 'meta_ads',
    brand: 'cs',
    key: { campaign_external_id: '222', metric_on: '2026-11-24' },
    values: {
      spend_cents: 1000,
      impressions: 5,
      clicks: 0,
      platform_leads: 0,
      conversions: '0',
      conversion_value_cents: 0,
    },
    fetched_at: '2026-11-26T13:00:00Z',
  },
];

describe('conector da Meta: o que o worker gera, o banco grava', () => {
  it('conta cadastrada, campanhas (inclusive a encerrada) e a troca do dia, sem recusa', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(`select setup.register_ad_account('cs', 'meta', '900000000000888', 'Conta CS')`);
      await s.como(servico('mkt_worker'));
      const rodada = await s.valor<string>(
        `select ingest.start_run('meta', 'ads_backfill', 'backfill')::text`,
      );
      const recusadas = async (sql: string, params: unknown[]) =>
        s.linhas(`select item, code from ${sql} where is_refused`, params);
      expect(
        await recusadas('ingest.upsert_ad_accounts($1, $2::jsonb)', [rodada, JSON.stringify([CONTA])]),
      ).toEqual([]);
      expect(
        await recusadas('ingest.upsert_campaigns($1, $2::jsonb)', [
          rodada,
          JSON.stringify([campanha('111', 'active', 5000), campanha('222', 'ended', null)]),
        ]),
      ).toEqual([]);
      expect(
        await recusadas(
          `ingest.replace_day($1, 'ad_campaign_daily', '900000000000888', '2026-11-24'::date, $2::jsonb)`,
          [rodada, JSON.stringify(GASTO)],
        ),
      ).toEqual([]);
      expect(
        await recusadas(
          `ingest.replace_day($1, 'ad_campaign_daily', '900000000000888', '2026-11-25'::date, '[]'::jsonb)`,
          [rodada],
        ),
      ).toEqual([]);
      expect(
        await s.valor<string>(`select (ingest.finish_run($1, 'succeeded')).status::text`, [rodada]),
      ).toBe('succeeded');

      await s.como(postgres);
      expect(
        await s.linhas(
          `select c.external_id, c.status::text, d.spend_cents::int, d.clicks::int, d.platform_leads::int
             from mkt.ad_campaign_daily d join mkt.campaigns c on c.id = d.campaign_id
            where c.source = 'meta_ads' and c.external_id in ('111', '222') order by 1`,
        ),
      ).toEqual([
        { external_id: '111', status: 'active', spend_cents: 53396, clicks: 402, platform_leads: 3 },
        { external_id: '222', status: 'ended', spend_cents: 1000, clicks: 0, platform_leads: 0 },
      ]);
      expect(
        await s.valor<boolean>(
          `select first_read_at is not null and spend_cap_cents is null from mkt.ad_accounts where external_id = '900000000000888'`,
        ),
      ).toBe(true);
    });
  });

  it('conta em outra moeda é recusada (CURRENCY)', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(`select setup.register_ad_account('cs', 'meta', '900000000000889', 'Conta em dólar')`);
      await s.como(servico('mkt_worker'));
      const rodada = await s.valor<string>(`select ingest.start_run('meta', 'ads_hourly', 'schedule')::text`);
      const usd = {
        ...CONTA,
        key: { external_id: '900000000000889' },
        values: { ...CONTA.values, currency: 'USD' },
      };
      expect(
        await s.linhas(`select code from ingest.upsert_ad_accounts($1, $2::jsonb) where is_refused`, [
          rodada,
          JSON.stringify([usd]),
        ]),
      ).toEqual([{ code: 'CURRENCY' }]);
    });
  });
});

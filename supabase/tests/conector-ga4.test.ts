// Contrato do conector do GA4 (apps/worker/csp_worker/ga4.py) com a ingestão: o worker grava pela
// ingest.replace_day, um dia e uma propriedade por vez, com o papel mkt_worker. O arquivo
// fixtures/ga4-eventos.json é gerado pelo adaptador a partir das respostas gravadas em
// apps/worker/tests/gravadas, e o teste do worker confere que o adaptador continua gerando o mesmo.
// docs/dados/integracoes.md, seções 2.3 e 9.
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { abrirBanco, aplicarFixture, caso, postgres, servico } from './apoio/banco';
import { GA4_CS } from './apoio/marketing';

type Evento = { key: { property_external_id: string } };
const EVENTOS = JSON.parse(
  readFileSync(new URL('./fixtures/ga4-eventos.json', import.meta.url), 'utf8'),
) as Record<string, Evento[]>;

let db: PGlite;

beforeAll(async () => {
  db = await abrirBanco();
  for (const f of ['usuarios', 'marketing', 'trafego', 'conectores']) await aplicarFixture(db, f);
});

afterAll(async () => {
  await db.close();
});

describe('conector do GA4: o que o worker gera, o banco grava', () => {
  it('a rodada do worker troca cada dia da propriedade, sem recusa, e liga o conector', async () => {
    await caso(db, postgres, async (s) => {
      await s.como(servico('mkt_worker'));
      const rodada = await s.valor<string>(`select ingest.start_run('ga4', 'ga4_daily', 'schedule')::text`);
      for (const [dia, linhas] of Object.entries(EVENTOS)) {
        const propriedade = linhas[0]?.key.property_external_id ?? '900000001';
        expect(
          await s.linhas(
            `select item, code from ingest.replace_day($1, 'ga4_traffic_daily', $2, $3::date, $4::jsonb) where is_refused`,
            [rodada, propriedade, dia, JSON.stringify(linhas)],
          ),
        ).toEqual([]);
      }
      expect(
        await s.valor<string>(`select (ingest.finish_run($1, 'succeeded')).status::text`, [rodada]),
      ).toBe('succeeded');

      await s.como(postgres);
      expect(
        await s.linhas(
          `select metric_on::text as dia, session_source, channel_group_raw, sessions::int, lead_events::int
             from mkt.ga4_traffic_daily where web_property_id = $1 and metric_on >= '2026-11-15'
            order by 1, 2`,
          [GA4_CS],
        ),
      ).toEqual([
        {
          dia: '2026-11-15',
          session_source: '(direct)',
          channel_group_raw: 'Direct',
          sessions: 17,
          lead_events: 0,
        },
        {
          dia: '2026-11-15',
          session_source: 'google',
          channel_group_raw: 'Organic Search',
          sessions: 42,
          lead_events: 2,
        },
        {
          dia: '2026-11-16',
          session_source: 'chatgpt.com',
          channel_group_raw: 'AI Assistant',
          sessions: 3,
          lead_events: 1,
        },
        {
          dia: '2026-11-16',
          session_source: 'instagram',
          channel_group_raw: 'Organic Social',
          sessions: 9,
          lead_events: 0,
        },
      ]);
      expect(
        await s.linhas(
          `select k.setup_state::text, k.first_success_at is not null as tem_base, w.first_read_at is not null as lida
             from mkt.connectors k, mkt.web_properties w where k.code = 'ga4' and w.id = $1`,
          [GA4_CS],
        ),
      ).toEqual([{ setup_state: 'connected', tem_base: true, lida: true }]);
    });
  });

  it('a releitura do dia sem nenhuma sessão apaga o que o dia tinha', async () => {
    await caso(db, postgres, async (s) => {
      await s.como(servico('mkt_worker'));
      const primeira = await s.valor<string>(`select ingest.start_run('ga4', 'ga4_daily')::text`);
      await s.linhas(
        `select * from ingest.replace_day($1, 'ga4_traffic_daily', '900000001', '2026-11-16', $2::jsonb)`,
        [primeira, JSON.stringify(EVENTOS['2026-11-16'])],
      );
      await s.valor(`select (ingest.finish_run($1, 'succeeded')).status::text`, [primeira]);
      const segunda = await s.valor<string>(`select ingest.start_run('ga4', 'ga4_daily')::text`);
      await s.linhas(
        `select * from ingest.replace_day($1, 'ga4_traffic_daily', '900000001', '2026-11-16', '[]')`,
        [segunda],
      );
      await s.como(postgres);
      expect(
        await s.valor<number>(
          `select count(*)::int from mkt.ga4_traffic_daily where web_property_id = $1 and metric_on = '2026-11-16'`,
          [GA4_CS],
        ),
      ).toBe(0);
    });
  });
});

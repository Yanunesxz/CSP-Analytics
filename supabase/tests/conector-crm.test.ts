// Contrato do conector do CSP 360 (apps/worker/csp_worker/crm.py e rodada_crm.py) com a ingestão: os eventos que o
// worker gera numa passada completa (fixtures/crm-eventos.json, conferido pelo teste do worker) entram pelas funções
// ingest.upsert_* com o papel mkt_worker, na ordem da rodada, e a passada termina com ingest.delete_missing.
// docs/dados/integracoes.md, seções 2.3 e 3.
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { abrirBanco, aplicarFixture, caso, postgres, servico } from './apoio/banco';

const EVENTOS = JSON.parse(
  readFileSync(new URL('./fixtures/crm-eventos.json', import.meta.url), 'utf8'),
) as Record<string, unknown[]>;

let db: PGlite;

beforeAll(async () => {
  db = await abrirBanco();
  for (const f of ['usuarios', 'marketing', 'trafego', 'conectores']) await aplicarFixture(db, f);
});

afterAll(async () => {
  await db.close();
});

describe('conector do CSP 360: o que o worker gera, o banco grava', () => {
  it('a passada completa grava cada tabela na ordem da rodada, sem recusa', async () => {
    await caso(db, postgres, async (s) => {
      await s.como(servico('mkt_worker'));
      const rodada = await s.valor<string>(
        `select ingest.start_run('csp360', 'crm_full_pass', 'schedule')::text`,
      );
      for (const [funcao, eventos] of Object.entries(EVENTOS)) {
        expect(funcao).toMatch(/^upsert_[a-z_]+$/);
        expect(
          await s.linhas(`select item, code from ingest.${funcao}($1, $2::jsonb) where is_refused`, [
            rodada,
            JSON.stringify(eventos),
          ]),
          funcao,
        ).toEqual([]);
      }
      expect(
        await s.valor<string>(`select (ingest.finish_run($1, 'succeeded')).status::text`, [rodada]),
      ).toBe('succeeded');

      await s.como(postgres);
      expect(
        await s.linhas(
          `select b.code::text, b.external_id from mkt.brands b where b.external_id like '00000000-%' order by 1`,
        ),
      ).toEqual([
        { code: 'cs', external_id: '00000000-0000-0000-0000-0000000000c5' },
        { code: 'plumene', external_id: '00000000-0000-0000-0000-0000000000b1' },
      ]);
      expect(
        await s.linhas(
          `select c.code, c.crm_status::text, c.first_utm_campaign, c.is_known_by_erp, c.has_app_owner
             from mkt.crm_customers c where c.external_id like 'c0000000-%' order by 1`,
        ),
      ).toEqual([
        {
          code: 'CLI-1',
          crm_status: 'prospect',
          first_utm_campaign: '120200',
          is_known_by_erp: false,
          has_app_owner: false,
        },
        { code: 'CLI-2', crm_status: 'active', first_utm_campaign: null, is_known_by_erp: true, has_app_owner: true },
      ]);
      expect(
        await s.linhas(
          `select l.kind::text, l.crm_funnel_id is not null as com_funil, l.assigned_rep_id is not null as com_rep,
                  b.code::text as marca
             from mkt.crm_leads l left join mkt.brands b on b.id = l.brand_id
            where l.external_id in ('n1', 's1') order by 1`,
        ),
      ).toEqual([
        { kind: 'deal', com_funil: true, com_rep: true, marca: 'cs' },
        { kind: 'sdr', com_funil: false, com_rep: false, marca: null },
      ]);
      expect(
        await s.linhas(
          `select o.status::text, o.is_invoiced, o.total_cents::int, o.sales_rep_id is not null as com_rep
             from mkt.crm_orders o where o.external_id = 'p1'`,
        ),
      ).toEqual([{ status: 'sent', is_invoiced: true, total_cents: 3031, com_rep: true }]);
      expect(
        await s.valor<number>(
          `select erp_earliest_purchase_on = '2025-03-10'::date and erp_total_purchased_cents = 123457
             from mkt.crm_customer_brands cb join mkt.crm_customers c on c.id = cb.customer_id
            where c.external_id = 'c0000000-0000-0000-0000-000000000002'`,
        ),
      ).toBe(true);
    });
  });

  it('a passada completa chama a exclusão de cada tabela da réplica', async () => {
    await caso(db, postgres, async (s) => {
      await s.como(servico('mkt_worker'));
      const rodada = await s.valor<string>(
        `select ingest.start_run('csp360', 'crm_full_pass', 'schedule')::text`,
      );
      for (const tabela of [
        'crm_orders',
        'crm_leads',
        'crm_customer_reps',
        'crm_customer_brands',
        'crm_customers',
        'sales_rep_app_logins',
        'sales_reps',
        'crm_funnels',
      ]) {
        const [linha] = await s.linhas<{ deleted: number }>(
          `select deleted from ingest.delete_missing($1, $2)`,
          [tabela, rodada],
        );
        expect(linha?.deleted, tabela).toBeGreaterThanOrEqual(0);
      }
    });
  });
});

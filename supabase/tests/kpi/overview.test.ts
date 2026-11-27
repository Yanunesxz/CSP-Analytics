// api.kpi_overview, a parte da mídia (docs/dados/metricas.md, seções 2.1, 2.3, 4.2 e 6.1): investimento do período, por
// marca, por canal e por dia, com a base por canal e a comparação só com os dias completos dos anúncios. Leads, clientes
// novos e custo por cliente novo ficam "Sem dados" até o CSP 360 chegar.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Sessao, abrirBanco, aplicarFixture, caso, postgres, usuario } from '../apoio/banco';
import { DONO, EX_GESTOR, GESTOR, SEM_PERFIL } from '../apoio/usuarios';

const CONTA = '00000000-0000-4000-8000-0000000007a1';
const CAMPANHA = '00000000-0000-4000-8000-0000000007b1';
const CAMPANHA_FUNDO = '00000000-0000-4000-8000-0000000007b2';

type Metrica = { current: number | null; previous: number | null; variation: number | null };
interface Linha {
  brand?: string;
  platform?: string;
  investment: Metrica;
  leads?: Metrica;
  cost_per_lead?: Metrica;
  new_customers?: Metrica;
  cost_per_new_customer?: Metrica;
}
interface Resposta {
  has_data: boolean;
  coverage: { ads: boolean; csp360: boolean };
  investment: Metrica;
  impressions: Metrica;
  clicks: Metrica;
  leads: Metrica;
  new_customers: Metrica;
  cost_per_new_customer: Metrica;
  attributed_new_customers: number | null;
  leads_without_brand: number | null;
  orders: { count: Metrica; total_cents: Metrica; invoiced_count: Metrica; invoiced_total_cents: Metrica };
  by_brand: Linha[];
  by_platform: Linha[];
  daily: { metric_on: string; investment_cents: number | null; leads: number | null; new_customers: number | null }[];
  period: { start_on: string; compared_through_on: string | null };
}

let db: PGlite;

beforeAll(async () => {
  db = await abrirBanco();
  await aplicarFixture(db, 'usuarios');
});

afterAll(async () => {
  await db.close();
});

/** Hoje é 20/11/2026, 10 h em São Paulo. A conta Meta da Corpo Sensual gastou em 08, 15, 19 e 20/11. */
async function prepararMeta(s: Sessao, opcoes: { comBase?: boolean } = {}): Promise<void> {
  const comBase = opcoes.comBase ?? true;
  await s.exec(`
    insert into test.clock (now_at) values ('2026-11-20 10:00:00-03');
    insert into mkt.ad_accounts (id, brand_id, platform, source, external_id, name, first_read_at)
    select '${CONTA}', b.id, 'meta', 'meta_ads', '900000000000777', 'Conta CS', ${comBase ? "'2026-11-20 09:00:00-03'" : 'null'}
      from mkt.brands b where b.code = 'cs';
    update mkt.connectors set first_success_at = ${comBase ? "'2026-11-20 09:00:00-03'" : 'null'},
                              last_success_at = ${comBase ? "'2026-11-20 09:00:00-03'" : 'null'}
     where code = 'meta';
    insert into mkt.campaigns (id, ad_account_id, brand_id, platform, source, external_id, name, status, managed_by)
    select v.id::uuid, a.id, a.brand_id, a.platform, a.source, v.ext, v.nome, 'active', v.op::mkt.operator
      from mkt.ad_accounts a,
           (values ('${CAMPANHA}', '1201', 'cs-topo', 'human'), ('${CAMPANHA_FUNDO}', '1202', 'cs-fundo', 'human'))
             as v(id, ext, nome, op)
     where a.id = '${CONTA}';
    insert into mkt.ad_campaign_daily (campaign_id, brand_id, platform, metric_on, spend_cents, impressions, clicks,
                                       source, fetched_at)
    select c.id, c.brand_id, c.platform, v.dia::date, v.gasto, v.imp, v.cli, 'meta_ads', now()
      from mkt.campaigns c,
           (values ('${CAMPANHA}', '2026-11-08', 10000, 1000, 10),
                   ('${CAMPANHA}', '2026-11-15', 20000, 2000, 20),
                   ('${CAMPANHA_FUNDO}', '2026-11-19', 5000, 500, 5),
                   ('${CAMPANHA}', '2026-11-20', 7000, 700, 7)) as v(camp, dia, gasto, imp, cli)
     where c.id = v.camp::uuid;`);
}

async function kpi(s: Sessao, filtros: Record<string, unknown>): Promise<Resposta> {
  return s.valor<Resposta>('select api.kpi_overview($1::jsonb)', [JSON.stringify(filtros)]);
}

describe('api.kpi_overview: mídia', () => {
  it('soma o investimento do período e compara só com os dias completos dos anúncios', async () => {
    await caso(db, postgres, async (s) => {
      await prepararMeta(s);
      await s.como(usuario(DONO));
      const r = await kpi(s, { period: 'last_7_days' });

      expect(r.has_data).toBe(true);
      expect(r.coverage).toEqual({ ads: true, csp360: false });
      // 14 a 20/11 (hoje entra no valor); comparado de 14 a 19/11 contra 07 a 12/11.
      expect(r.period.start_on).toBe('2026-11-14');
      expect(r.period.compared_through_on).toBe('2026-11-19');
      expect(r.investment).toEqual({ current: 32000, previous: 10000, variation: 1.5 });
      expect(r.impressions.current).toBe(3200);
      expect(r.clicks.current).toBe(32);
    });
  });

  it('quebra por marca e por canal; a marca e o canal sem conta lida ficam "Sem dados"', async () => {
    await caso(db, postgres, async (s) => {
      await prepararMeta(s);
      await s.como(usuario(DONO));
      const r = await kpi(s, { period: 'last_7_days', compare: false });
      expect(r.by_brand.map((b) => [b.brand, b.investment])).toEqual([
        ['cs', { current: 32000, previous: null, variation: null }],
        ['plumene', { current: null, previous: null, variation: null }],
      ]);
      expect(r.by_platform.map((p) => [p.platform, p.investment.current])).toEqual([
        ['meta', 32000],
        ['tiktok', null],
        ['google', null],
      ]);
    });
  });

  it('o dia sem gasto é 0 com base; leads e clientes novos ficam "Sem dados" sem o CSP 360', async () => {
    await caso(db, postgres, async (s) => {
      await prepararMeta(s);
      await s.como(usuario(DONO));
      const r = await kpi(s, { period: 'last_7_days' });
      expect(r.daily.map((d) => d.investment_cents)).toEqual([0, 20000, 0, 0, 0, 5000, 7000]);
      expect(r.leads.current).toBeNull();
      expect(r.new_customers.current).toBeNull();
      expect(r.cost_per_new_customer.current).toBeNull();
    });
  });

  it('respeita o operador e a marca do filtro', async () => {
    await caso(db, postgres, async (s) => {
      await prepararMeta(s);
      await s.como(usuario(DONO));
      expect((await kpi(s, { period: 'last_7_days', operator: 'claude' })).investment.current).toBe(0);
      expect((await kpi(s, { period: 'last_7_days', operator: 'human' })).investment.current).toBe(32000);
      const plumene = await kpi(s, { period: 'last_7_days', brand: 'plumene' });
      expect(plumene.has_data).toBe(false);
      expect(plumene.investment.current).toBeNull();
    });
  });

  it('sem conta lida, tudo "Sem dados", nunca 0', async () => {
    await caso(db, postgres, async (s) => {
      await prepararMeta(s, { comBase: false });
      await s.como(usuario(DONO));
      const r = await kpi(s, { period: 'last_7_days' });
      expect(r.has_data).toBe(false);
      expect(r.investment.current).toBeNull();
      expect(r.daily.every((d) => d.investment_cents === null)).toBe(true);
    });
  });

  it('com origem ou representante, o investimento não se aplica', async () => {
    await caso(db, postgres, async (s) => {
      await prepararMeta(s);
      await s.como(usuario(DONO));
      expect((await kpi(s, { period: 'last_7_days', origin: 'meta' })).investment.current).toBeNull();
    });
  });

  it('o gestor de tráfego lê; sem perfil ativo é KPI-403; filtro desconhecido é KPI-400', async () => {
    await caso(db, postgres, async (s) => {
      await prepararMeta(s);
      await s.como(usuario(GESTOR));
      expect((await kpi(s, { period: 'last_7_days' })).investment.current).toBe(32000);
      const e400 = await s.erro('PT400', `select api.kpi_overview('{"marca": "cs"}')`);
      expect(e400.message).toBe('KPI-400');
    });
    for (const quem of [usuario(EX_GESTOR), usuario(SEM_PERFIL)]) {
      await caso(db, quem, async (s) => {
        const e = await s.erro('PT403', `select api.kpi_overview('{"marca": "cs"}')`);
        expect(e.message).toBe('KPI-403');
      });
    }
  });
});

/**
 * O CSP 360 sobre a mídia de prepararMeta (hoje 20/11). Quatro clientes da Corpo Sensual:
 *   A: lead do site com UTM da campanha 1201 em 15/11 e 1º pedido enviado em 17/11 (R$ 500,00): novo e atribuído;
 *   B: lead sem UTM em 16/11 e 1º pedido enviado em 18/11 (R$ 200,00): novo, sem campanha;
 *   C: lead do SDR, sem marca, em 19/11, sem pedido;
 *   D: pedido enviado em 18/11 (R$ 100,00), mas o ERP já o via comprando a marca em janeiro: não é novo.
 */
async function prepararCrm(s: Sessao): Promise<void> {
  await s.exec(`
    update mkt.connectors set first_success_at = '2026-11-20 09:00:00-03', last_success_at = '2026-11-20 09:00:00-03'
     where code = 'csp360';
    insert into mkt.crm_customers (id, external_id, code, crm_status, source_created_at, last_seen_at)
    values ('00000000-0000-4000-8000-0000000007c1', 'a', 'CLI-A', 'active', '2026-11-15 10:00:00-03', now()),
           ('00000000-0000-4000-8000-0000000007c2', 'b', 'CLI-B', 'active', '2026-11-16 10:00:00-03', now()),
           ('00000000-0000-4000-8000-0000000007c3', 'c', 'CLI-C', 'prospect', '2026-11-19 10:00:00-03', now()),
           ('00000000-0000-4000-8000-0000000007c4', 'd', 'CLI-D', 'active', '2025-01-01 10:00:00-03', now());
    insert into mkt.crm_leads (kind, external_id, code, brand_id, customer_id, utm_source, utm_medium, utm_campaign,
                               source_created_at, last_seen_at)
    select v.kind::mkt.lead_kind, v.ext, v.code, case when v.marca then b.id end, v.cli::uuid, v.src, v.med, v.camp,
           v.em::timestamptz, now()
      from mkt.brands b,
           (values ('deal', 'n-a', 'NEG-A', true, '00000000-0000-4000-8000-0000000007c1', 'facebook', 'cpc', '1201',
                    '2026-11-15 10:00:00-03'),
                   ('deal', 'n-b', 'NEG-B', true, '00000000-0000-4000-8000-0000000007c2', null, null, null,
                    '2026-11-16 10:00:00-03'),
                   ('sdr', 's-c', 'SDR-C', false, '00000000-0000-4000-8000-0000000007c3', null, null, null,
                    '2026-11-19 10:00:00-03'))
             as v(kind, ext, code, marca, cli, src, med, camp, em)
     where b.code = 'cs';
    insert into mkt.crm_orders (external_id, brand_id, customer_id, status, total_cents, sent_at, source_created_at,
                                last_seen_at)
    select v.ext, b.id, v.cli::uuid, 'sent', v.total, v.em::timestamptz, v.em::timestamptz, now()
      from mkt.brands b,
           (values ('p-a', '00000000-0000-4000-8000-0000000007c1', 50000, '2026-11-17 10:00:00-03'),
                   ('p-b', '00000000-0000-4000-8000-0000000007c2', 20000, '2026-11-18 10:00:00-03'),
                   ('p-d', '00000000-0000-4000-8000-0000000007c4', 10000, '2026-11-18 11:00:00-03'))
             as v(ext, cli, total, em)
     where b.code = 'cs';
    insert into mkt.crm_customer_brands (customer_id, brand_id, erp_earliest_purchase_on, last_seen_at)
    select '00000000-0000-4000-8000-0000000007c4', b.id, '2026-01-10', now() from mkt.brands b where b.code = 'cs';`);
}

describe('api.kpi_overview: CSP 360', () => {
  it('conta leads, clientes novos e pedidos, e o custo por cliente novo é o investimento ÷ os que vieram de campanha', async () => {
    await caso(db, postgres, async (s) => {
      await prepararMeta(s);
      await prepararCrm(s);
      await s.como(usuario(DONO));
      const r = await kpi(s, { period: 'last_7_days', compare: false });
      expect(r.coverage).toEqual({ ads: true, csp360: true });
      expect(r.leads.current).toBe(3);
      expect(r.leads_without_brand).toBe(1);
      expect(r.new_customers.current).toBe(2);
      expect(r.attributed_new_customers).toBe(1);
      expect(r.cost_per_new_customer.current).toBe(32000);
      expect(r.orders.count.current).toBe(3);
      expect(r.orders.total_cents.current).toBe(80000);
      expect(r.orders.invoiced_total_cents.current).toBeNull();

      const cs = r.by_brand.find((b) => b.brand === 'cs');
      expect(cs?.leads?.current).toBe(3); // o lead sem marca entra em toda marca
      expect(cs?.new_customers?.current).toBe(2);
      expect(cs?.cost_per_new_customer?.current).toBe(32000);
      expect(cs?.cost_per_lead?.current).toBe(32000);
      const meta = r.by_platform.find((p) => p.platform === 'meta');
      expect(meta?.leads?.current).toBe(1);
      expect(meta?.new_customers?.current).toBe(1);
      expect(r.daily.find((d) => d.metric_on === '2026-11-17')?.new_customers).toBe(1);
    });
  });

  it('com a marca Plumene, sem pedido dela: 0 com base, nunca "Sem dados"', async () => {
    await caso(db, postgres, async (s) => {
      await prepararMeta(s);
      await prepararCrm(s);
      await s.como(usuario(DONO));
      const r = await kpi(s, { period: 'last_7_days', brand: 'plumene', compare: false });
      expect(r.new_customers.current).toBe(0);
      expect(r.orders.count.current).toBe(0);
      expect(r.leads.current).toBe(1); // o do SDR, sem marca
      expect(r.cost_per_new_customer.current).toBeNull();
    });
  });

  it('o filtro de canal não recorta pedido: pedidos ficam "Sem dados"', async () => {
    await caso(db, postgres, async (s) => {
      await prepararMeta(s);
      await prepararCrm(s);
      await s.como(usuario(DONO));
      const r = await kpi(s, { period: 'last_7_days', platform: 'meta', compare: false });
      expect(r.orders.count.current).toBeNull();
      expect(r.new_customers.current).toBe(1);
    });
  });
});

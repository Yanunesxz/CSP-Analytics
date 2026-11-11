// Migração 05: a réplica mínima do CSP 360 — o texto que vem do CRM sem dado pessoal (mkt.valid_crm_text no check), a
// marca (nula só no lead e na rodada apps → CRM, decisão 0014), o pedido com faturado como carimbo, o funil de leads
// (mais de um, decisão 0041), o que o CRM não entrega (nulo, decisão 0041), a compra do ERP mais antiga (decisão
// 0042), o de-para de origem e o código LEAD- do SDR (docs/dados/tabelas.md, seção 2). Dados de fixtures/marketing.sql.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Sessao, abrirBanco, aplicarFixture, caso, postgres } from './apoio/banco';
import {
  CLIENTE_A,
  CLIENTE_B,
  FUNIL_ANTIGO_DE_LEADS,
  FUNIL_DE_LEADS,
  LEAD_NEGOCIO,
  LEAD_SDR,
  PEDIDO,
  REP_DO_CRM,
} from './apoio/marketing';

type Marca = 'cs' | 'plumene' | null;

let db: PGlite;

beforeAll(async () => {
  db = await abrirBanco();
  await aplicarFixture(db, 'marketing');
});

afterAll(async () => {
  await db.close();
});

const MARCA = '(select id from mkt.brands where code = $1)';

/** Um cliente com as UTMs de primeiro contato; sem nada, um prospecto sem UTM. */
function cliente(c: {
  externo?: string;
  fonte?: string | null;
  meio?: string | null;
  campanha?: string | null;
}): [string, unknown[]] {
  return [
    `insert into mkt.crm_customers (external_id, code, crm_status, first_utm_source, first_utm_medium,
                                    first_utm_campaign, source_created_at, last_seen_at)
     values ($1, 'CLI-9100', 'prospect', $2, $3, $4, now(), now()) returning id::text`,
    [c.externo ?? 'cli-teste-0100', c.fonte ?? null, c.meio ?? null, c.campanha ?? null],
  ];
}

/** Um lead; sem nada, um negócio da cs sem origem nem UTM. Devolve o código. */
function lead(l: {
  tipo?: 'deal' | 'sdr';
  externo?: string;
  codigo?: string | null;
  marca?: Marca;
  funil?: string | null;
  origem?: string | null;
  semDePara?: boolean;
  fonte?: string | null;
  meio?: string | null;
  campanha?: string | null;
  referrer?: string | null;
}): [string, unknown[]] {
  const tipo = l.tipo ?? 'deal';
  return [
    `insert into mkt.crm_leads (brand_id, kind, external_id, code, crm_funnel_id, crm_origin_raw, is_origin_unmapped,
                                utm_source, utm_medium, utm_campaign, referrer_host, source_created_at, last_seen_at)
     values (${MARCA}, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now()) returning code`,
    [
      l.marca === undefined ? (tipo === 'deal' ? 'cs' : null) : l.marca,
      tipo,
      l.externo ?? 'neg-teste-0100',
      l.codigo === undefined ? (tipo === 'deal' ? 'NEG-9100' : null) : l.codigo,
      l.funil ?? null,
      l.origem ?? null,
      l.semDePara ?? false,
      l.fonte ?? null,
      l.meio ?? null,
      l.campanha ?? null,
      l.referrer ?? null,
    ],
  ];
}

/** Um pedido; sem nada, um pedido enviado da cs, sem cliente. */
function pedido(p: {
  externo?: string;
  marca?: Marca;
  status?: string;
  faturado?: boolean;
  faturadoEm?: string | null;
  total?: number;
  totalFaturado?: number | null;
}): [string, unknown[]] {
  return [
    `insert into mkt.crm_orders (brand_id, external_id, status, is_invoiced, invoiced_at, total_cents,
                                 invoiced_total_cents, source_created_at, last_seen_at)
     values (${MARCA}, $2, $3, $4, $5::timestamptz, $6, $7, now(), now()) returning id::text`,
    [
      p.marca === undefined ? 'cs' : p.marca,
      p.externo ?? 'ped-teste-0100',
      p.status ?? 'sent',
      p.faturado ?? false,
      p.faturadoEm ?? null,
      p.total ?? 9990,
      p.totalFaturado ?? null,
    ],
  ];
}

describe('texto que vem do CRM: sem dado pessoal (mkt.valid_crm_text, a última barreira)', () => {
  it('UTM de primeiro contato do cliente: e-mail ou telefone recusado; na campanha só o @ barra; até 150 letras', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro('23514', ...cliente({ fonte: 'newsletter@exemplo.com.br' }));
      await s.erro('23514', ...cliente({ fonte: 'whatsapp 11987654321' }));
      await s.erro('23514', ...cliente({ meio: 'ligar (11) 98765-4321' }));
      await s.erro('23514', ...cliente({ meio: 'cpf 123.456.789-01' }));
      await s.erro('23514', ...cliente({ campanha: 'promo-assinante@exemplo.com' }));
      await s.erro('23514', ...cliente({ fonte: 'x'.repeat(151) }));
      await s.erro('23514', ...cliente({ campanha: 'x'.repeat(151) }));
      // O nome de campanha com número (um id, uma data) passa: lá só o @ barra.
      expect(
        await s.linhas(...cliente({ fonte: 'meta', meio: 'cpc', campanha: 'promo 11987654321' })),
      ).toHaveLength(1);
    });
  });

  it('UTM do lead: o mesmo teste; a origem do negócio só normalizada e sem dado pessoal', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro('23514', ...lead({ fonte: 'contato@exemplo.com' }));
      await s.erro('23514', ...lead({ fonte: '5511987654321' }));
      await s.erro('23514', ...lead({ meio: 'CNPJ 12.345.678/0001-90' }));
      await s.erro('23514', ...lead({ campanha: 'lista de pessoa@exemplo.com' }));
      await s.erro('23514', ...lead({ origem: 'Site' }));
      await s.erro('23514', ...lead({ origem: ' site' }));
      await s.erro('23514', ...lead({ origem: 'fulana@exemplo.com' }));
      await s.erro('23514', ...lead({ origem: 'ligou do 11987654321' }));
      // O texto fora do de-para não é gravado: o lead marca a pendência e fica sem o texto.
      await s.erro('23514', ...lead({ origem: 'indicação', semDePara: true }));
      expect(
        await s.linhas(
          ...lead({ origem: 'indicação', fonte: 'meta', meio: 'cpc', campanha: '120200000000000001' }),
        ),
      ).toEqual([{ code: 'NEG-9100' }]);
      expect(
        await s.linhas(...lead({ externo: 'neg-teste-0101', codigo: 'NEG-9101', semDePara: true })),
      ).toHaveLength(1);
    });
  });

  it('nome do funil: e-mail, telefone, documento ou @ recusado; o nome de processo passa', async () => {
    await caso(db, postgres, async (s) => {
      const funil = (nome: string): [string, unknown[]] => [
        `insert into mkt.crm_funnels (external_id, name) values ('funil-teste-0100', $1) returning name`,
        [nome],
      ];
      for (const nome of [
        'Funil contato@exemplo.com',
        'Funil (11) 98765-4321',
        'Funil CPF 123.456.789-01',
        'Leads @equipe',
        'x'.repeat(151),
      ]) {
        await s.erro('23514', ...funil(nome));
      }
      expect(await s.valor(...funil('Reativação 2025'))).toBe('Reativação 2025');
    });
  });

  it('referrer: só o domínio, em minúsculas, sem caminho, porta nem usuário', async () => {
    await caso(db, postgres, async (s) => {
      for (const referrer of [
        'https://chatgpt.com/c/123',
        'chatgpt.com/c',
        'ChatGPT.com',
        'chatgpt.com:443',
        'pessoa@chatgpt.com',
      ]) {
        await s.erro('23514', ...lead({ referrer }));
      }
      expect(await s.linhas(...lead({ referrer: 'chatgpt.com' }))).toHaveLength(1);
    });
  });
});

describe('marca: o lead pode não ter (decisão 0014); pedido, situação e carteira não', () => {
  it('lead sem marca entra ("Sem marca"); pedido, situação e carteira sem marca, não', async () => {
    await caso(db, postgres, async (s) => {
      expect(await s.linhas(...lead({ marca: null }))).toHaveLength(1);
      await s.erro('23502', ...pedido({ marca: null }));
      await s.erro(
        '23502',
        `insert into mkt.crm_customer_brands (customer_id, brand_id, last_seen_at) values ($1, null, now())`,
        [CLIENTE_B],
      );
      await s.erro(
        '23502',
        `insert into mkt.crm_customer_reps (customer_id, brand_id, sales_rep_id, last_seen_at)
         values ($1, null, $2, now())`,
        [CLIENTE_B, REP_DO_CRM],
      );
      // A rodada apps → CRM que não é de uma marca.
      await s.exec(
        `insert into mkt.crm_upstream_runs (external_id, brand_id, run_trigger, started_at, is_ok, last_seen_at)
         values ('sinc-teste-0100', null, 'manual', now(), false, now())`,
      );
    });
  });

  it('clientes e funis são compartilhados: não têm marca', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        await s.valor(
          `select count(*)::int from pg_attribute
            where attrelid in ('mkt.crm_customers'::regclass, 'mkt.crm_funnels'::regclass,
                               'mkt.crm_origin_map'::regclass)
              and attname = 'brand_id' and not attisdropped`,
        ),
      ).toBe(0);
    });
  });
});

describe('pedidos', () => {
  it('faturado é carimbo do enviado, nunca status; a data do faturado só com o carimbo', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro('23514', ...pedido({ status: 'invoiced' }));
      await s.erro('23514', ...pedido({ status: 'faturado' }));
      await s.erro('23514', ...pedido({ status: 'quote', faturado: true }));
      await s.erro('23514', ...pedido({ status: 'cancelled', faturado: true }));
      await s.erro('23514', ...pedido({ faturadoEm: '2026-10-01T15:00:00Z' }));
      expect(
        await s.linhas(
          ...pedido({ faturado: true, faturadoEm: '2026-10-01T15:00:00Z', totalFaturado: 9990 }),
        ),
      ).toHaveLength(1);
      // Enviado e depois cancelado: o status muda e o pedido continua (sai da conta pela view).
      await s.exec(`update mkt.crm_orders set status = 'cancelled' where id = '${PEDIDO}'`);
      expect(await s.valor('select status::text from mkt.crm_orders where id = $1', [PEDIDO])).toBe(
        'cancelled',
      );
    });
  });

  it('valor em centavos, nunca negativo; um pedido por id do CRM', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro('23514', ...pedido({ total: -1 }));
      await s.erro('23514', ...pedido({ totalFaturado: -1, faturado: true }));
      await s.erro('23505', ...pedido({ externo: 'ped-teste-0001' }));
      await s.erro(
        '23502',
        `insert into mkt.crm_orders (brand_id, external_id, status, source_created_at, last_seen_at)
         values (${MARCA}, 'ped-sem-total', 'sent', now(), now())`,
        ['cs'],
      );
    });
  });

  it('o que sai do CRM sai daqui sem travar: o pedido fica "A vincular" e o lead "A cadastrar"; situação e carteira caem junto', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(`delete from mkt.crm_customers where id = '${CLIENTE_A}'`);
      expect(await s.valor('select customer_id from mkt.crm_orders where id = $1', [PEDIDO])).toBeNull();
      expect(await s.valor('select customer_id from mkt.crm_leads where id = $1', [LEAD_NEGOCIO])).toBeNull();
      expect(
        await s.valor('select count(*)::int from mkt.crm_customer_brands where customer_id = $1', [
          CLIENTE_A,
        ]),
      ).toBe(0);
      expect(
        await s.valor('select count(*)::int from mkt.crm_customer_reps where customer_id = $1', [CLIENTE_A]),
      ).toBe(0);

      // O representante que sai: o pedido e o lead ficam sem ele.
      await s.exec(`update mkt.crm_leads set assigned_rep_id = '${REP_DO_CRM}' where id = '${LEAD_SDR}'`);
      await s.exec(`delete from mkt.sales_reps where id = '${REP_DO_CRM}'`);
      expect(await s.valor('select sales_rep_id from mkt.crm_orders where id = $1', [PEDIDO])).toBeNull();
      expect(await s.valor('select assigned_rep_id from mkt.crm_leads where id = $1', [LEAD_SDR])).toBeNull();

      // O funil que sai: o negócio continua lead, sem o funil.
      await s.exec(`delete from mkt.crm_funnels where id = '${FUNIL_DE_LEADS}'`);
      expect(
        await s.valor('select crm_funnel_id from mkt.crm_leads where id = $1', [LEAD_NEGOCIO]),
      ).toBeNull();
    });
  });
});

describe('clientes, situação por marca, carteira e rodadas', () => {
  it('as listas do CRM convertidas: status do cliente, situação da régua e disparo da rodada', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro(
        '23514',
        `insert into mkt.crm_customers (external_id, code, crm_status, source_created_at, last_seen_at)
         values ('cli-teste-0200', 'CLI-9200', 'prospecto', now(), now())`,
      );
      await s.erro(
        '23514',
        `update mkt.crm_customer_brands set situation = 'inativo-recente' where customer_id = '${CLIENTE_A}'`,
      );
      await s.erro('23514', `update mkt.crm_customer_brands set erp_total_purchased_cents = -1`);
      await s.exec(`update mkt.crm_customer_brands set situation = null where customer_id = '${CLIENTE_A}'`);
      await s.erro('23514', `update mkt.crm_upstream_runs set run_trigger = 'agendada'`);
    });
  });

  it('o que o CRM não entrega fica nulo, sem padrão: situação, perdido à mão, última compra da régua e hora do cálculo (decisão 0041)', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        await s.linhas(
          `select attname::text as coluna, attnotnull as obrigatoria, atthasdef as tem_padrao
             from pg_attribute
            where attrelid = 'mkt.crm_customer_brands'::regclass
              and attname in ('situation', 'is_lost_manual', 'last_purchase_on', 'situation_computed_at')
            order by attnum`,
        ),
      ).toEqual([
        { coluna: 'situation', obrigatoria: false, tem_padrao: false },
        { coluna: 'is_lost_manual', obrigatoria: false, tem_padrao: false },
        { coluna: 'last_purchase_on', obrigatoria: false, tem_padrao: false },
        { coluna: 'situation_computed_at', obrigatoria: false, tem_padrao: false },
      ]);
      // A linha que nasce só do retrato do ERP: nada da régua, e o perdido à mão fica nulo ("Sem dados"), não falso.
      await s.exec(
        `insert into mkt.crm_customer_brands (customer_id, brand_id, erp_last_purchase_on, last_seen_at)
         values ('${CLIENTE_B}', (select id from mkt.brands where code = 'plumene'), '2026-09-15', now())`,
      );
      expect(
        await s.linhas(
          `select situation, is_lost_manual, last_purchase_on, situation_computed_at
             from mkt.crm_customer_brands where customer_id = $1`,
          [CLIENTE_B],
        ),
      ).toEqual([
        { situation: null, is_lost_manual: null, last_purchase_on: null, situation_computed_at: null },
      ]);
      // O que a ingestão grava quando o CRM não entrega está em ingestao.test.ts, "retrato do ERP…".
    });
  });

  it('a compra do ERP mais antiga já vista é uma data por cliente e marca, que pode faltar (decisão 0042)', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        await s.linhas(
          `select format_type(atttypid, atttypmod) as tipo, attnotnull as obrigatoria, atthasdef as tem_padrao
             from pg_attribute
            where attrelid = 'mkt.crm_customer_brands'::regclass and attname = 'erp_earliest_purchase_on'`,
        ),
      ).toEqual([{ tipo: 'date', obrigatoria: false, tem_padrao: false }]);
      // Quem calcula a data (só troca por uma anterior) é a ingestão: ingestao.test.ts, "retrato do ERP…"; e a
      // passada completa não a apaga com o par que some: ingestao.test.ts, "o par cliente × marca…".
    });
  });

  it('uma situação por cliente e marca; o mesmo representante uma vez na carteira de cada marca', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro(
        '23505',
        `insert into mkt.crm_customer_brands (customer_id, brand_id, last_seen_at) values ($1, ${MARCA.replace('$1', '$2')}, now())`,
        [CLIENTE_A, 'cs'],
      );
      await s.erro(
        '23505',
        `insert into mkt.crm_customer_reps (customer_id, brand_id, sales_rep_id, last_seen_at)
         values ($1, (select id from mkt.brands where code = 'cs'), $2, now())`,
        [CLIENTE_A, REP_DO_CRM],
      );
      await s.exec(
        `insert into mkt.crm_customer_reps (customer_id, brand_id, sales_rep_id, last_seen_at)
         values ('${CLIENTE_A}', (select id from mkt.brands where code = 'plumene'), '${REP_DO_CRM}', now())`,
      );
      await s.erro('23505', ...cliente({ externo: 'cli-teste-0001' }));
    });
  });
});

describe('funil de leads', () => {
  it('mais de um funil de leads: o padrão e o antigo dos leads do site (decisão 0041); o lead do SDR não tem funil', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        await s.linhas(
          `select external_id, is_default, is_lead_funnel from mkt.crm_funnels where is_lead_funnel order by 1`,
        ),
      ).toEqual([
        { external_id: 'funil-teste-0001', is_default: true, is_lead_funnel: true },
        { external_id: 'funil-teste-0002', is_default: false, is_lead_funnel: true },
      ]);
      // Sem trava de um só: quem decide é a regra da ingestão, não um índice.
      await s.exec(
        `insert into mkt.crm_funnels (external_id, name, is_lead_funnel) values ('funil-teste-0003', 'Mais um funil', true)`,
      );
      await s.erro('23514', ...lead({ tipo: 'sdr', funil: FUNIL_DE_LEADS }));
      expect(await s.linhas(...lead({ funil: FUNIL_DE_LEADS }))).toHaveLength(1);
      expect(
        await s.linhas(
          ...lead({ externo: 'neg-teste-0101', codigo: 'NEG-9101', funil: FUNIL_ANTIGO_DE_LEADS }),
        ),
      ).toHaveLength(1);
    });
  });
});

describe('o código LEAD- do lead do SDR (gatilho crm_leads_code)', () => {
  const proximo = (s: Sessao) =>
    s.valor<number>(
      'select (case when is_called then last_value + 1 else last_value end)::int from mkt.lead_code_seq',
    );
  const codigo = (n: number) => `LEAD-${String(n).padStart(4, '0')}`;

  it('o SDR ganha o código da sequência, e o que vier no insert é ignorado; o negócio fica com o NEG- do CRM', async () => {
    await caso(db, postgres, async (s) => {
      expect(await s.valor('select code from mkt.crm_leads where id = $1', [LEAD_SDR])).toBe('LEAD-0001');
      const n = await proximo(s);
      expect(await s.valor(...lead({ tipo: 'sdr', externo: 'sdr-teste-0100' }))).toBe(codigo(n));
      expect(await s.valor(...lead({ tipo: 'sdr', externo: 'sdr-teste-0101', codigo: 'NEG-9999' }))).toBe(
        codigo(n + 1),
      );
      expect(await s.valor(...lead({ externo: 'neg-teste-0200', codigo: 'NEG-9200' }))).toBe('NEG-9200');
      await s.erro('23502', ...lead({ externo: 'neg-teste-0201', codigo: null }));
      // O mesmo id do CRM em negócio e no SDR são leads diferentes.
      expect(await s.valor(...lead({ tipo: 'sdr', externo: 'neg-teste-0200' }))).toBe(codigo(n + 2));
    });
  });

  it('a chave é o id (decisão 0041, item 2): o NEG- do negócio pode repetir; o LEAD- do SDR, nunca', async () => {
    await caso(db, postgres, async (s) => {
      // O CRM reaproveita o código do negócio apagado: o novo entra antes de a passada completa tirar o antigo.
      expect(await s.valor(...lead({ externo: 'neg-teste-0202', codigo: 'NEG-9001' }))).toBe('NEG-9001');
      expect(await s.valor(`select count(*)::int from mkt.crm_leads where code = 'NEG-9001'`)).toBe(2);
      // A sequência que volta não repete o código do SDR (LEAD-0001 é o da fixture).
      await s.exec(`select setval('mkt.lead_code_seq', 1, false)`);
      const repetido = await s.erro('23505', ...lead({ tipo: 'sdr', externo: 'sdr-teste-0102' }));
      expect(repetido.constraint).toBe('crm_leads_sdr_code');
    });
  });

  it('a releitura não gasta número: insert … on conflict, do update ou do nothing, fica com o mesmo código', async () => {
    await caso(db, postgres, async (s) => {
      const n = await proximo(s);
      for (let i = 0; i < 3; i++) {
        expect(
          await s.valor(
            `insert into mkt.crm_leads (kind, external_id, customer_id, source_created_at, last_seen_at)
             values ('sdr', 'sdr-teste-0001', null, now() - interval '3 days', now())
             on conflict (source, kind, external_id)
             do update set customer_id = excluded.customer_id, last_seen_at = excluded.last_seen_at, code = excluded.code
             returning code`,
          ),
        ).toBe('LEAD-0001');
        expect(
          await s.linhas(
            `insert into mkt.crm_leads (kind, external_id, source_created_at, last_seen_at)
             values ('sdr', 'sdr-teste-0001', now(), now()) on conflict do nothing returning code`,
          ),
        ).toEqual([]);
      }
      expect(await proximo(s)).toBe(n);
      expect(await s.valor('select customer_id from mkt.crm_leads where id = $1', [LEAD_SDR])).toBeNull();
    });
  });

  it('o código do SDR nunca muda; o do negócio acompanha o CRM', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        (await s.erro('PT422', `update mkt.crm_leads set code = 'LEAD-0999' where id = '${LEAD_SDR}'`))
          .message,
      ).toBe('COD-422');
      await s.exec(`update mkt.crm_leads set code = 'NEG-9301' where id = '${LEAD_NEGOCIO}'`);
      expect(await s.valor('select code from mkt.crm_leads where id = $1', [LEAD_NEGOCIO])).toBe('NEG-9301');
      // O resto do lead do SDR muda (a marca que o CRM passou a dar, por exemplo).
      await s.exec(
        `update mkt.crm_leads set brand_id = (select id from mkt.brands where code = 'plumene') where id = '${LEAD_SDR}'`,
      );
      expect(await s.valor('select code from mkt.crm_leads where id = $1', [LEAD_SDR])).toBe('LEAD-0001');
    });
  });
});

describe('de-para de origem (crm_origin_map)', () => {
  it('só valores genéricos, normalizados, sem dado pessoal, e o lead consegue guardar cada um', async () => {
    await caso(db, postgres, async (s) => {
      const mapa = await s.linhas<{
        raw_value: string;
        origin: string | null;
        is_lead: boolean;
        certo: boolean;
      }>(
        `select raw_value, origin::text, is_lead,
                raw_value = lower(btrim(raw_value)) and mkt.valid_crm_text(raw_value)
                  and not mkt.has_personal_data(raw_value) as certo
           from mkt.crm_origin_map order by raw_value`,
      );
      expect(mapa.length).toBeGreaterThanOrEqual(10);
      for (const m of mapa) expect(m.certo, m.raw_value).toBe(true);
      const deLead = mapa.filter((m) => m.is_lead);
      expect(Object.fromEntries(deLead.map((m) => [m.raw_value, m.origin]))).toMatchObject({
        site: 'site',
        whatsapp: 'sdr',
        // A origem que a conversão do lead do SDR grava no negócio (decisão 0041, item 3).
        'sdr whatsapp': 'sdr',
        indicação: 'referral',
        'google ads': 'google',
        direto: 'direct',
      });
      for (const m of deLead) expect(m.origin, m.raw_value).not.toBeNull();
      // O negócio aberto à mão pelo time comercial não é lead (decisão 0041, item 9): só as duas origens dele, com e
      // sem acento, estão no de-para sem origem de lead.
      expect(Object.fromEntries(mapa.filter((m) => !m.is_lead).map((m) => [m.raw_value, m.origin]))).toEqual({
        carteira: null,
        'prospecção ativa': null,
        'prospeccao ativa': null,
      });
      // O "google" sozinho fica para a classificação: pago ou orgânico depende do meio.
      expect(mapa.map((m) => m.raw_value)).not.toContain('google');
      let i = 0;
      for (const m of mapa) {
        i += 1;
        await s.linhas(
          ...lead({
            externo: `neg-origem-${i}`,
            codigo: `NEG-8${String(i).padStart(3, '0')}`,
            origem: m.raw_value,
          }),
        );
      }
    });
  });

  it('valor só normalizado, não vazio, um por texto e com uma origem da lista, ou sem origem e marcado como não lead', async () => {
    await caso(db, postgres, async (s) => {
      const de = (texto: string, origem: string | null, lead?: boolean | null) =>
        (lead === undefined
          ? [`insert into mkt.crm_origin_map (raw_value, origin) values ($1, $2)`, [texto, origem]]
          : [
              `insert into mkt.crm_origin_map (raw_value, origin, is_lead) values ($1, $2, $3)`,
              [texto, origem, lead],
            ]) as [string, unknown[]];
      await s.erro('23514', ...de('Feira', 'referral'));
      await s.erro('23514', ...de(' feira', 'referral'));
      await s.erro('23514', ...de('', 'referral'));
      await s.erro('23514', ...de('feira', 'evento'));
      await s.erro('23505', ...de('site', 'direct'));
      // A origem de lead tem a origem; a que não é de lead não tem (decisão 0041, item 9). O padrão é ser de lead.
      await s.erro('23514', ...de('feira', null));
      await s.erro('23514', ...de('feira', null, true));
      await s.erro('23514', ...de('feira', 'referral', false));
      await s.erro('23502', ...de('feira', 'referral', null));
      await s.linhas(...de('feira', 'referral'));
      await s.linhas(...de('balcão', null, false));
    });
  });
});

describe('funções, gatilhos e índices da migração 05', () => {
  const QUEM = [
    'public',
    'anon',
    'authenticated',
    'service_role',
    'authenticator',
    'mkt_worker',
    'mkt_executor',
    'mkt_setup',
    'n8n_notifier',
  ];

  it('o gatilho de código: security definer, search_path pg_catalog, pg_temp, ninguém executa, ligado na tabela', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        await s.linhas(
          `select prosecdef, proconfig as config from pg_proc where oid = 'private.crm_leads_code()'::regprocedure`,
        ),
      ).toEqual([{ prosecdef: true, config: ['search_path=pg_catalog, pg_temp'] }]);
      expect(
        await s.linhas(
          `select r.papel from unnest($1::text[]) as r(papel)
            where has_function_privilege(r.papel, 'private.crm_leads_code()', 'execute')`,
          [QUEM],
        ),
      ).toEqual([]);
      expect(
        await s.linhas(
          `select tgname::text as gatilho, tgfoid::regprocedure::text as funcao from pg_trigger
            where tgrelid = 'mkt.crm_leads'::regclass and not tgisinternal and tgenabled = 'O' order by 1`,
        ),
      ).toEqual([
        { gatilho: 'crm_leads_code', funcao: 'private.crm_leads_code()' },
        { gatilho: 'crm_leads_updated_at', funcao: 'private.set_updated_at()' },
      ]);
      for (const tabela of [
        'crm_funnels',
        'crm_origin_map',
        'crm_customers',
        'crm_customer_brands',
        'crm_customer_reps',
        'crm_leads',
        'crm_orders',
        'crm_upstream_runs',
      ]) {
        expect(
          await s.valor(
            `select count(*)::int from pg_trigger
              where tgrelid = $1::regclass and tgname = $2 and tgfoid = 'private.set_updated_at()'::regprocedure`,
            [`mkt.${tabela}`, `${tabela}_updated_at`],
          ),
          tabela,
        ).toBe(1);
      }
    });
  });

  it('os índices de tabelas.md, os dos pedidos só nos enviados', async () => {
    await caso(db, postgres, async (s) => {
      const indices = await s.linhas<{ indexname: string; indexdef: string }>(
        `select indexname::text, indexdef from pg_indexes
          where schemaname = 'mkt' and tablename like 'crm\\_%' and indexname not like '%\\_pkey'
            and indexname not like '%\\_key' order by 1`,
      );
      expect(indices.map((i) => i.indexname)).toEqual([
        'crm_customer_brands_brand',
        'crm_customer_reps_rep',
        'crm_customers_code',
        'crm_leads_brand_created',
        'crm_leads_customer',
        'crm_leads_rep',
        'crm_leads_sdr_code',
        'crm_leads_utm',
        'crm_orders_brand_order_on',
        'crm_orders_customer',
        'crm_orders_rep',
        'crm_upstream_runs_started',
      ]);
      for (const nome of ['crm_orders_brand_order_on', 'crm_orders_customer']) {
        expect(indices.find((i) => i.indexname === nome)?.indexdef, nome).toContain(`'sent'`);
      }
      // O código é único só no lead do SDR: o NEG- do negócio pode repetir (decisão 0041, item 2).
      const sdr = indices.find((i) => i.indexname === 'crm_leads_sdr_code')?.indexdef ?? '';
      expect(sdr).toContain('UNIQUE');
      expect(sdr).toContain(`'sdr'`);
      expect(indices.find((i) => i.indexname === 'crm_orders_brand_order_on')?.indexdef).toContain(
        'mkt.sp_day',
      );
      expect(indices.find((i) => i.indexname === 'crm_leads_utm')?.indexdef).toContain('mkt.utm_key');
    });
  });
});

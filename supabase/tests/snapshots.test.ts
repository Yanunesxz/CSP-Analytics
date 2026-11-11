// Migração 06: os snapshots de mídia paga, Instagram, SEO, GEO e GA4 com a marca da conta, da campanha, do perfil, do
// post ou da propriedade (chave composta), a chave natural como idempotência e nada negativo; e as alterações nas
// plataformas, conferidas por mkt.valid_activity_details (docs/dados/tabelas.md, seção 3). Dados de
// fixtures/marketing.sql.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { abrirBanco, aplicarFixture, caso, postgres, servico } from './apoio/banco';
import {
  CAMPANHA_CLAUDE_CS,
  CAMPANHA_HUMANO_CS,
  CAMPANHA_HUMANO_PL,
  CONTA_META_CS,
  GA4_CS,
  GSC_CS,
  PERFIL_IG_CS,
  POST_IG_CS,
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
const ONTEM = `current_date - 1`;

/** Gasto de uma campanha num dia; sem nada, um dia novo da campanha do humano na Meta da cs. */
function gasto(g: {
  campanha?: string;
  marca?: Marca;
  plataforma?: string;
  dia?: string;
  gasto?: number;
  conversoes?: number;
  fonte?: string;
}): [string, unknown[]] {
  return [
    `insert into mkt.ad_campaign_daily (brand_id, campaign_id, platform, metric_on, spend_cents, conversions, source,
                                        fetched_at)
     values (${MARCA}, $2, $3, $4::date, $5, $6, $7, now())`,
    [
      g.marca === undefined ? 'cs' : g.marca,
      g.campanha ?? CAMPANHA_HUMANO_CS,
      g.plataforma ?? 'meta',
      g.dia ?? '2026-10-15',
      g.gasto ?? 1990,
      g.conversoes ?? 1.5,
      g.fonte ?? 'meta_ads',
    ],
  ];
}

/** Uma alteração na conta Meta da cs; sem nada, uma troca de status de campanha. */
function alteracao(a: {
  marca?: Marca;
  conta?: string;
  plataforma?: string;
  fonte?: string;
  externo?: string;
  tipo?: string;
  detalhes?: unknown;
}): [string, unknown[]] {
  return [
    `insert into mkt.ad_activity_log (brand_id, ad_account_id, platform, campaign_id, source, external_id, occurred_at,
                                      change_kind, is_by_csp_mkt, details)
     values (${MARCA}, $2, $3, $4, $5, $6, now(), $7, true, $8::jsonb)`,
    [
      a.marca === undefined ? 'cs' : a.marca,
      a.conta ?? CONTA_META_CS,
      a.plataforma ?? 'meta',
      CAMPANHA_CLAUDE_CS,
      a.fonte ?? 'meta_ads',
      a.externo ?? 'atividade-teste-0100',
      a.tipo ?? 'update_campaign_run_status',
      JSON.stringify(
        a.detalhes ?? {
          object_type: 'campaign',
          object_id: '120200000000000002',
          field: 'status',
          old_value: 'PAUSED',
          new_value: 'ACTIVE',
        },
      ),
    ],
  ];
}

describe('gasto por campanha e dia (ad_campaign_daily)', () => {
  it('a marca e a plataforma são as da campanha (chave composta), e a marca é obrigatória', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro('23503', ...gasto({ marca: 'plumene' }));
      await s.erro('23503', ...gasto({ plataforma: 'google' }));
      await s.erro('23503', ...gasto({ campanha: CAMPANHA_HUMANO_PL }));
      await s.erro('23502', ...gasto({ marca: null }));
      await s.linhas(...gasto({}));
      await s.linhas(
        ...gasto({
          campanha: CAMPANHA_HUMANO_PL,
          marca: 'plumene',
          plataforma: 'google',
          fonte: 'google_ads',
        }),
      );
    });
  });

  it('uma linha por campanha e dia (a releitura regrava); nada negativo; fonte da plataforma ou o CSV', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro(
        '23505',
        `insert into mkt.ad_campaign_daily (brand_id, campaign_id, platform, metric_on, source, fetched_at)
         select brand_id, id, platform, ${ONTEM}, source, now() from mkt.campaigns where id = $1`,
        [CAMPANHA_HUMANO_CS],
      );
      await s.erro('23514', ...gasto({ gasto: -1 }));
      await s.erro('23514', ...gasto({ conversoes: -0.5 }));
      await s.erro('23514', ...gasto({ fonte: 'ga4' }));
      await s.erro('23514', ...gasto({ fonte: 'csp360' }));
      for (const coluna of ['impressions', 'clicks', 'platform_leads', 'conversion_value_cents']) {
        await s.erro(
          '23514',
          `update mkt.ad_campaign_daily set ${coluna} = -1 where campaign_id = '${CAMPANHA_HUMANO_CS}'`,
        );
      }
      await s.linhas(...gasto({ fonte: 'csv' }));
      // Sem número, o dia é 0 (diferente de não ter linha).
      expect(
        await s.linhas(
          `select spend_cents::int, impressions::int, clicks::int, platform_leads::int, conversions::text,
                  conversion_value_cents::int
             from mkt.ad_campaign_daily where campaign_id = $1 and metric_on = '2026-10-15'`,
          [CAMPANHA_HUMANO_CS],
        ),
      ).toEqual([
        {
          spend_cents: 1990,
          impressions: 0,
          clicks: 0,
          platform_leads: 0,
          conversions: '1.50',
          conversion_value_cents: 0,
        },
      ]);
    });
  });
});

describe('alterações nas plataformas (ad_activity_log)', () => {
  it('a marca e a plataforma são as da conta; só Meta e Google; um evento por id da plataforma', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro('23503', ...alteracao({ marca: 'plumene' }));
      await s.erro('23503', ...alteracao({ plataforma: 'google' }));
      await s.erro('23502', ...alteracao({ marca: null }));
      await s.erro('23514', ...alteracao({ fonte: 'tiktok_ads' }));
      await s.erro('23505', ...alteracao({ externo: 'atividade-teste-0001' }));
      await s.linhas(...alteracao({}));
    });
  });

  it('o tipo como a plataforma chama, sem espaço; os detalhes sem e-mail, sem o nome de quem mudou e sem evento de pessoa', async () => {
    await caso(db, postgres, async (s) => {
      for (const tipo of ['', 'update campaign', 'x'.repeat(81), 'mudou@status']) {
        await s.erro('23514', ...alteracao({ tipo }));
      }
      await s.erro('23514', ...alteracao({ detalhes: { new_value: 'gestor@exemplo.com.br' } }));
      await s.erro('23514', ...alteracao({ detalhes: { actor_name: 'Pessoa de teste' } }));
      await s.erro('23514', ...alteracao({ tipo: 'ad_account_add_user_to_role', detalhes: {} }));
      await s.erro('23514', ...alteracao({ detalhes: [] }));
      await s.linhas(...alteracao({ detalhes: {} }));
      expect(
        await s.valor(
          `select details::text from mkt.ad_activity_log where external_id = 'atividade-teste-0100'`,
        ),
      ).toBe('{}');
    });
  });
});

describe('mkt.valid_activity_details', () => {
  const CASOS: Array<[string | null, unknown, boolean]> = [
    [
      'update_campaign_run_status',
      {
        object_type: 'campaign',
        object_id: '120200000000000002',
        field: 'status',
        old_value: 'ACTIVE',
        new_value: 'PAUSED',
      },
      true,
    ],
    [
      'update_ad_set_budget',
      {
        object_type: 'ad_set',
        object_id: '120200000000000003',
        field: 'daily_budget',
        old_value: 5000,
        new_value: 7000,
      },
      true,
    ],
    [
      'update_ad_run_status',
      {
        object_type: 'ad',
        object_id: '120200000000000004',
        field: 'status',
        old_value: null,
        new_value: true,
      },
      true,
    ],
    [
      'ad_account_update_spend_limit',
      {
        object_type: 'account',
        object_id: 'act_900000000000001',
        field: 'spend_cap',
        old_value: '1000000000',
        new_value: '1500000000',
      },
      true,
    ],
    [
      'CAMPAIGN_BUDGET:UPDATE',
      {
        object_type: 'campaign',
        object_id: 'customers/9000000002/campaignBudgets/123',
        field: 'amount_micros',
        old_value: 10000000,
        new_value: 12000000,
      },
      true,
    ],
    [
      'AD_GROUP_AD:UPDATE',
      {
        object_type: 'ad',
        object_id: 'customers/9000000002/adGroupAds/456~789',
        field: 'ad_group_ad.status',
      },
      true,
    ],
    [
      'update_campaign_name',
      { field: 'name', old_value: 'Promo outubro', new_value: 'Promo novembro 2026' },
      true,
    ],
    ['update_campaign_name', {}, true],
    // Valor com e-mail, longo demais ou que não é texto simples.
    ['update_campaign_name', { new_value: 'contato@exemplo.com' }, false],
    ['update_campaign_name', { new_value: 'x'.repeat(301) }, false],
    ['update_ad_set_budget', { new_value: { amount: 7000, currency: 'BRL' } }, false],
    ['update_ad_set_budget', { old_value: [5000] }, false],
    // Chave fora do quadro: o nome do objeto e quem mudou nunca entram.
    ['update_campaign_name', { object_name: 'Campanha de teste' }, false],
    ['update_campaign_name', { actor_name: 'Pessoa de teste' }, false],
    ['update_campaign_name', { actor_id: '100000000000001' }, false],
    // Tipo de objeto, id e campo dentro do formato.
    ['update_campaign_name', { object_type: 'user' }, false],
    ['update_campaign_name', { object_type: 'Campaign' }, false],
    ['update_campaign_name', { object_type: 7 }, false],
    ['update_campaign_name', { object_id: 'conta de fulano' }, false],
    ['update_campaign_name', { object_id: 'pessoa@exemplo.com' }, false],
    ['update_campaign_name', { object_id: 1202000000 }, false],
    ['update_campaign_name', { field: 'status; drop' }, false],
    ['update_campaign_name', { field: '' }, false],
    // Evento de usuário, papel e cobrança: fora, mesmo sem detalhes.
    ['ad_account_add_user_to_role', {}, false],
    ['ad_account_remove_user_from_role', {}, false],
    ['ad_account_billing_charge', {}, false],
    ['add_funding_source', {}, false],
    ['CUSTOMER_USER_ACCESS:CREATE', {}, false],
    ['update_payment_method', {}, false],
    // Forma do jsonb e o tipo nulo.
    ['update_campaign_name', [], false],
    ['update_campaign_name', 'texto', false],
    ['update_campaign_name', null, false],
    [null, {}, false],
  ];

  it('aceita só o tipo do objeto, o id, o campo e os valores antes e depois; recusa evento de pessoa', async () => {
    await caso(db, servico('mkt_worker'), async (s) => {
      for (const [tipo, detalhes, valido] of CASOS) {
        expect(
          await s.valor('select mkt.valid_activity_details($1, $2::jsonb)', [
            tipo,
            detalhes === null ? null : JSON.stringify(detalhes),
          ]),
          `${tipo} ${JSON.stringify(detalhes)}`,
        ).toBe(valido);
      }
    });
  });

  it('regra pura: immutable, sem security definer, search_path vazio; a tela, o worker e o executor executam', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        await s.linhas(
          `select prosecdef, provolatile, proconfig as config
             from pg_proc where oid = 'mkt.valid_activity_details(text, jsonb)'::regprocedure`,
        ),
      ).toEqual([{ prosecdef: false, provolatile: 'i', config: ['search_path=""'] }]);
      expect(
        await s.linhas(
          `select r.papel from unnest($1::text[]) as r(papel)
            where has_function_privilege(r.papel, 'mkt.valid_activity_details(text, jsonb)', 'execute') order by 1`,
          [
            [
              'public',
              'anon',
              'authenticated',
              'service_role',
              'mkt_worker',
              'mkt_executor',
              'mkt_setup',
              'n8n_notifier',
            ],
          ],
        ),
      ).toEqual([{ papel: 'authenticated' }, { papel: 'mkt_executor' }, { papel: 'mkt_worker' }]);
    });
  });
});

describe('Instagram', () => {
  it('perfil por dia com a marca do perfil; nulo é "a API não devolveu" (diferente de 0); nada negativo', async () => {
    await caso(db, postgres, async (s) => {
      const dia = (marca: Marca, data: string, alcance: number | null) =>
        [
          `insert into mkt.ig_account_daily (brand_id, ig_account_id, metric_on, reach, fetched_at)
           values (${MARCA}, $2, $3::date, $4, now())`,
          [marca, PERFIL_IG_CS, data, alcance],
        ] as [string, unknown[]];
      await s.erro('23503', ...dia('plumene', '2026-10-15', 10));
      await s.erro('23502', ...dia(null, '2026-10-15', 10));
      await s.erro('23514', ...dia('cs', '2026-10-15', -1));
      await s.linhas(...dia('cs', '2026-10-15', null));
      await s.erro('23505', ...dia('cs', '2026-10-15', 10));
      for (const coluna of ['followers_count', 'views', 'total_interactions']) {
        await s.erro('23514', `update mkt.ig_account_daily set ${coluna} = -1`);
      }
      expect(
        await s.linhas(
          `select followers_count, reach, views, total_interactions from mkt.ig_account_daily where metric_on = '2026-10-15'`,
        ),
      ).toEqual([{ followers_count: null, reach: null, views: null, total_interactions: null }]);
    });
  });

  it('post com a marca do perfil, tipo da lista e legenda até 120 letras; o retrato com a marca do post, que sai junto', async () => {
    await caso(db, postgres, async (s) => {
      const post = (marca: Marca, tipo: string, legenda: string | null, externo = '18000000000000100') =>
        [
          `insert into mkt.ig_media (brand_id, ig_account_id, external_id, media_type, published_at, caption_excerpt)
           values (${MARCA}, $2, $3, $4, now(), $5)`,
          [marca, PERFIL_IG_CS, externo, tipo, legenda],
        ] as [string, unknown[]];
      await s.erro('23503', ...post('plumene', 'image', null));
      await s.erro('23502', ...post(null, 'image', null));
      await s.erro('23514', ...post('cs', 'story', null));
      await s.erro('23514', ...post('cs', 'IMAGE', null));
      await s.erro('23514', ...post('cs', 'image', 'x'.repeat(121)));
      await s.erro('23505', ...post('cs', 'image', null, '18000000000000001'));
      await s.linhas(...post('cs', 'carousel', 'x'.repeat(120)));

      const retrato = (marca: Marca, dia: string) =>
        [
          `insert into mkt.ig_media_daily (brand_id, ig_media_id, captured_on, reach, fetched_at)
           values (${MARCA}, $2, $3::date, 10, now())`,
          [marca, POST_IG_CS, dia],
        ] as [string, unknown[]];
      await s.erro('23503', ...retrato('plumene', '2026-10-15'));
      await s.erro('23502', ...retrato(null, '2026-10-15'));
      await s.linhas(...retrato('cs', '2026-10-15'));
      await s.erro('23505', ...retrato('cs', '2026-10-15'));
      for (const coluna of ['reach', 'views', 'likes', 'comments', 'saves', 'shares', 'total_interactions']) {
        await s.erro('23514', `update mkt.ig_media_daily set ${coluna} = -1`);
      }
      await s.exec(`delete from mkt.ig_media where id = '${POST_IG_CS}'`);
      expect(await s.valor('select count(*)::int from mkt.ig_media_daily')).toBe(0);
    });
  });
});

describe('Search Console e GA4', () => {
  it('o dia de cada propriedade com a marca dela; posição maior que 0; nada negativo', async () => {
    await caso(db, postgres, async (s) => {
      const dia = (marca: Marca, data: string, posicao: number | null, cliques = 10) =>
        [
          `insert into mkt.seo_daily (brand_id, web_property_id, metric_on, impressions, clicks, position, fetched_at)
           values (${MARCA}, $2, $3::date, 100, $5, $4, now())`,
          [marca, GSC_CS, data, posicao, cliques],
        ] as [string, unknown[]];
      await s.erro('23503', ...dia('plumene', '2026-10-15', 3.2));
      await s.erro('23502', ...dia(null, '2026-10-15', 3.2));
      await s.erro('23514', ...dia('cs', '2026-10-15', 0));
      await s.erro('23514', ...dia('cs', '2026-10-15', 3.2, -1));
      await s.linhas(...dia('cs', '2026-10-15', null));
      await s.erro('23505', ...dia('cs', '2026-10-15', 3.2));
    });
  });

  it('consulta de 1 a 500 letras, uma linha por propriedade, dia e consulta', async () => {
    await caso(db, postgres, async (s) => {
      const consulta = (marca: Marca, texto: string) =>
        [
          `insert into mkt.seo_query_daily (brand_id, web_property_id, metric_on, query, impressions, clicks, fetched_at)
           values (${MARCA}, $2, '2026-10-15', $3, 10, 1, now())`,
          [marca, GSC_CS, texto],
        ] as [string, unknown[]];
      await s.erro('23514', ...consulta('cs', ''));
      await s.erro('23514', ...consulta('cs', 'x'.repeat(501)));
      await s.erro('23503', ...consulta('plumene', 'consulta de teste'));
      await s.erro('23502', ...consulta(null, 'consulta de teste'));
      await s.linhas(...consulta('cs', 'x'.repeat(500)));
      await s.linhas(...consulta('cs', 'consulta de teste'));
      await s.erro('23505', ...consulta('cs', 'consulta de teste'));
    });
  });

  it('GA4: sessões por origem, meio e canal como vêm, com a marca da propriedade; nada negativo', async () => {
    await caso(db, postgres, async (s) => {
      const sessoes = (marca: Marca, origem: string, total: number, leads: number | null = null) =>
        [
          `insert into mkt.ga4_traffic_daily (brand_id, web_property_id, metric_on, session_source, session_medium,
                                              channel_group_raw, sessions, lead_events, fetched_at)
           values (${MARCA}, $2, '2026-10-15', $3, 'referral', 'AI Assistant', $4, $5, now())`,
          [marca, GA4_CS, origem, total, leads],
        ] as [string, unknown[]];
      await s.erro('23503', ...sessoes('plumene', 'chatgpt.com', 5));
      await s.erro('23502', ...sessoes(null, 'chatgpt.com', 5));
      await s.erro('23514', ...sessoes('cs', 'chatgpt.com', -1));
      await s.erro('23514', ...sessoes('cs', 'chatgpt.com', 5, -1));
      await s.linhas(...sessoes('cs', 'chatgpt.com', 5));
      await s.linhas(...sessoes('cs', 'perplexity.ai', 2, 1));
      await s.erro('23505', ...sessoes('cs', 'chatgpt.com', 7));
    });
  });
});

describe('checagem dos sites (site_checks)', () => {
  it('item e achado da lista, HTTP de 100 a 599, detalhe até 300 letras, um por site, item e dia, com a marca do site', async () => {
    await caso(db, postgres, async (s) => {
      const checagem = (c: {
        marca?: Marca;
        item?: string;
        achado?: string;
        http?: number | null;
        detalhe?: string | null;
      }) =>
        [
          `insert into mkt.site_checks (brand_id, web_property_id, host, item, finding, http_status, detail, checked_at,
                                        checked_on)
           values (${MARCA}, $2, 'cs.example.com', $3, $4, $5, $6, now(), '2026-10-15')`,
          [
            c.marca === undefined ? 'cs' : c.marca,
            GA4_CS,
            c.item ?? 'llms_txt',
            c.achado ?? 'missing',
            c.http ?? null,
            c.detalhe ?? null,
          ],
        ] as [string, unknown[]];
      await s.erro('23514', ...checagem({ item: 'sitemap' }));
      await s.erro('23514', ...checagem({ achado: 'ok' }));
      await s.erro('23514', ...checagem({ http: 99 }));
      await s.erro('23514', ...checagem({ http: 600 }));
      await s.erro('23514', ...checagem({ detalhe: 'x'.repeat(301) }));
      await s.erro('23503', ...checagem({ marca: 'plumene' }));
      await s.erro('23502', ...checagem({ marca: null }));
      await s.linhas(...checagem({ http: 404, detalhe: 'x'.repeat(300) }));
      await s.erro('23505', ...checagem({ achado: 'found', http: 200 }));
      await s.linhas(...checagem({ item: 'json_ld', achado: 'invalid', http: 200 }));
    });
  });
});

describe('gatilhos e índices da migração 06', () => {
  const TABELAS = [
    'ad_campaign_daily',
    'ad_activity_log',
    'ig_account_daily',
    'ig_media',
    'ig_media_daily',
    'seo_daily',
    'seo_query_daily',
    'ga4_traffic_daily',
    'site_checks',
  ];

  it('updated_at por gatilho em toda tabela, em milissegundos', async () => {
    await caso(db, postgres, async (s) => {
      for (const tabela of TABELAS) {
        expect(
          await s.valor(
            `select count(*)::int from pg_trigger
              where tgrelid = $1::regclass and tgname = $2 and tgfoid = 'private.set_updated_at()'::regprocedure`,
            [`mkt.${tabela}`, `${tabela}_updated_at`],
          ),
          tabela,
        ).toBe(1);
      }
      await s.exec(
        `update mkt.ad_campaign_daily set clicks = clicks + 1 where campaign_id = '${CAMPANHA_HUMANO_CS}'`,
      );
      expect(
        await s.valor(
          `select updated_at = date_trunc('milliseconds', now()) from mkt.ad_campaign_daily where campaign_id = $1`,
          [CAMPANHA_HUMANO_CS],
        ),
      ).toBe(true);
    });
  });

  it('os índices de tabelas.md', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        await s.linhas(
          `select indexname::text from pg_indexes
            where schemaname = 'mkt' and tablename = any($1) and indexname not like '%\\_pkey'
              and indexname not like '%\\_key' order by 1`,
          [TABELAS],
        ),
      ).toEqual(
        [
          'ad_activity_log_account_time',
          'ad_campaign_daily_brand_day',
          'ad_campaign_daily_day',
          'ga4_traffic_daily_brand_day',
          'ig_media_brand_published',
          'seo_query_daily_brand_day',
        ].map((indexname) => ({ indexname })),
      );
    });
  });
});

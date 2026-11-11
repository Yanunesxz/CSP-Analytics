// Migração 09, o conjunto: as funções de api do quadro de papeis-e-rls.md ("Funções de ação"), cada uma security
// definer com search_path vazio e executável só pela tela; RLS-20 e RLS-21 nas funções (perfil inativo e login sem
// perfil, mesmo com o segundo fator: PT403, menos my_profile e my_permissions); anon e os serviços sem acesso; e as
// regras de apoio (trava otimista, a lista de um domain, o pedido de cada plataforma e o cabeçalho do CSV). Dados
// inventados de fixtures/usuarios.sql, marketing.sql, trafego.sql e conectores.sql.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Quem, abrirBanco, anon, aplicarFixture, caso, postgres, servico, usuario } from './apoio/banco';
import { domainsDoMkt } from './apoio/catalogo';
import { FUNCOES_DE_API, FUNCOES_PRIVADAS, REGRAS_DE_MKT } from './apoio/acoes';
import { DONO, EX_GESTOR, SEM_PERFIL } from './apoio/usuarios';

let db: PGlite;

beforeAll(async () => {
  db = await abrirBanco();
  for (const f of ['usuarios', 'marketing', 'trafego', 'conectores']) await aplicarFixture(db, f);
});

afterAll(async () => {
  await db.close();
});

const PAPEIS = [
  'anon',
  'authenticated',
  'mkt_worker',
  'mkt_executor',
  'mkt_setup',
  'n8n_notifier',
  'service_role',
];
const TELA_E_SERVICOS = ['authenticated', 'mkt_worker', 'mkt_executor'];
const TOKEN_DO_DONO = { sub: DONO, role: 'authenticated', aal: 'aal2' };

/** O que muda quando uma função grava: as linhas de cada tabela que as funções de api tocam. */
const CONTAGEM = `
  select (select count(*) from mkt.traffic_actions) || '/' || (select count(*) from mkt.platform_executions) || '/' ||
         (select count(*) from mkt.traffic_log) || '/' || (select count(*) from mkt.audit_log) || '/' ||
         (select count(*) from mkt.invitations) || '/' || (select count(*) from mkt.sync_runs) || '/' ||
         (select count(*) from mkt.saved_filters) || '/' || (select count(*) from mkt.notification_preferences) || '/' ||
         (select count(*) from mkt.spend_limits) || '/' || (select count(*) from mkt.traffic_strategies) || '/' ||
         (select max(updated_at)::text from mkt.profiles) || '/' || (select max(updated_at)::text from mkt.connectors)`;

describe('as funções de api da migração 09', () => {
  it('são as do quadro de papeis-e-rls.md, uma de cada, todas security definer com search_path vazio', async () => {
    await caso(db, postgres, async (s) => {
      const linhas = await s.linhas<{ funcao: string; prosecdef: boolean; config: string[] | null }>(
        `select p.oid::regprocedure::text as funcao, p.prosecdef, p.proconfig as config
           from pg_proc p where p.pronamespace = 'api'::regnamespace order by 1`,
      );
      expect(linhas.map((l) => l.funcao)).toEqual(
        Object.values(FUNCOES_DE_API)
          .map((f) => f.assinatura)
          .sort(),
      );
      for (const l of linhas) {
        expect(l.prosecdef, l.funcao).toBe(true);
        expect(l.config, l.funcao).toEqual(['search_path=""']);
      }
    });
  });

  it('só a tela executa as de api; as de private, ninguém; as regras de mkt, a tela, o worker e o executor', async () => {
    const quem: Array<[string, string[]]> = [
      ...Object.values(FUNCOES_DE_API).map((f): [string, string[]] => [f.assinatura, ['authenticated']]),
      ...FUNCOES_PRIVADAS.map((f): [string, string[]] => [f, []]),
      ...REGRAS_DE_MKT.map((f): [string, string[]] => [f, TELA_E_SERVICOS]),
    ];
    await caso(db, postgres, async (s) => {
      for (const [funcao, podem] of quem) {
        const linhas = await s.linhas<{ papel: string; executa: boolean }>(
          `select r.papel, has_function_privilege(r.papel, $1::regprocedure, 'execute') as executa
             from unnest($2::text[]) as r(papel)`,
          [funcao, PAPEIS],
        );
        for (const l of linhas) {
          expect(l.executa, `${l.papel} executa ${funcao}`).toBe(podem.includes(l.papel));
        }
      }
    });
  });

  it('as de private e as regras de mkt rodam com os direitos de quem chama (só as de api são definer)', async () => {
    await caso(db, postgres, async (s) => {
      const linhas = await s.linhas<{ funcao: string; prosecdef: boolean; config: string[] | null }>(
        `select p.oid::regprocedure::text as funcao, p.prosecdef, p.proconfig as config
           from pg_proc p where p.oid::regprocedure::text = any($1) order by 1`,
        [[...FUNCOES_PRIVADAS, ...REGRAS_DE_MKT]],
      );
      expect(linhas).toHaveLength(FUNCOES_PRIVADAS.length + REGRAS_DE_MKT.length);
      for (const l of linhas) {
        expect(l.prosecdef, l.funcao).toBe(false);
        expect(l.config, l.funcao).toEqual(['search_path=""']);
      }
    });
  });
});

describe('RLS-20 e RLS-21: quem perdeu o acesso ou nunca teve perfil', () => {
  const pessoas: Array<[string, Quem]> = [
    ['perfil inativo', usuario(EX_GESTOR, 'aal2')],
    ['login sem perfil', usuario(SEM_PERFIL, 'aal2')],
  ];

  for (const [nome, quem] of pessoas) {
    it(`${nome}: toda função de ação e de leitura dá PT403 e nada muda, mesmo com o segundo fator`, async () => {
      await caso(db, postgres, async (s) => {
        const antes = await s.valor<string>(CONTAGEM);
        await s.como(quem);
        for (const [funcao, f] of Object.entries(FUNCOES_DE_API)) {
          if (funcao === 'my_profile' || funcao === 'my_permissions') continue;
          await s.erro('PT403', f.chamada).catch((e: Error) => {
            throw new Error(`${nome}, ${funcao}: ${e.message}`);
          });
        }
        await s.como(postgres);
        expect(await s.valor<string>(CONTAGEM)).toBe(antes);
      });
    });
  }

  it('a exceção: my_profile devolve o próprio perfil inativo (a tela diz "Seu acesso foi tirado"); sem perfil, nada', async () => {
    await caso(db, usuario(EX_GESTOR, 'aal2'), async (s) => {
      expect(await s.linhas('select id::text, role::text, is_active, email from api.my_profile()')).toEqual([
        {
          id: EX_GESTOR,
          role: 'traffic_manager',
          is_active: false,
          email: `removido+${EX_GESTOR}@invalid`,
        },
      ]);
      expect(await s.linhas('select * from api.my_permissions()')).toEqual([]);
    });
    await caso(db, usuario(SEM_PERFIL, 'aal2'), async (s) => {
      expect(await s.linhas('select * from api.my_profile()')).toEqual([]);
      expect(await s.linhas('select * from api.my_permissions()')).toEqual([]);
    });
  });
});

describe('fora da API: anon e os serviços', () => {
  it('RLS-01 e RLS-02: anon não alcança o esquema api, nem as leituras (42501)', async () => {
    for (const [funcao, f] of Object.entries(FUNCOES_DE_API)) {
      await caso(db, anon, async (s) => {
        const e = await s.erro('42501', f.chamada);
        expect(e.message, funcao).toContain('schema api');
      });
    }
  });

  it('RLS-22, 23 e 34: o worker (mesmo com o token do dono), o executor, o n8n e os scripts não chamam api', async () => {
    const servicos: Quem[] = [
      servico('mkt_worker', TOKEN_DO_DONO),
      servico('mkt_executor', TOKEN_DO_DONO),
      servico('n8n_notifier', TOKEN_DO_DONO),
      servico('mkt_setup', TOKEN_DO_DONO),
    ];
    for (const quem of servicos) {
      await caso(db, quem, async (s) => {
        for (const f of Object.values(FUNCOES_DE_API)) await s.erro('42501', f.chamada);
      });
    }
  });

  it('RLS-28: ninguém da tela nem dos serviços chama as de private (as filas, a conferência da ação)', async () => {
    const chamadas = [
      `select private.queue_execution('00000000-0000-0000-0000-000000000000')`,
      `select private.queue_stop_executions('00000000-0000-0000-0000-000000000000', 'pause')`,
      `select private.queue_spend_cap('00000000-0000-0000-0000-000000000000', 1)`,
      `select private.validate_action('cs', 'meta', null, 'pause', 'Título', 'Porquê de teste', '{}', 'low', 'low', null)`,
    ];
    for (const quem of [
      usuario(DONO, 'aal2'),
      servico('mkt_worker'),
      servico('mkt_executor'),
      servico('n8n_notifier'),
    ]) {
      await caso(db, quem, async (s) => {
        for (const sql of chamadas) await s.erro('42501', sql);
      });
    }
  });
});

describe('as regras de apoio', () => {
  it('trava otimista: confere em milissegundos (o valor lido volta igual) e, sem o valor lido, nunca confere', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        await s.linhas(`
          select private.is_stale('2026-11-10 12:00:00.123+00', '2026-11-10 12:00:00.123+00') as igual,
                 private.is_stale('2026-11-10 12:00:00.123+00', '2026-11-10 09:00:00.1234-03') as outro_fuso,
                 private.is_stale('2026-11-10 12:00:00.123+00', '2026-11-10 12:00:00.124+00') as um_ms,
                 private.is_stale('2026-11-10 12:00:00.123+00', null) as sem_valor`),
      ).toEqual([{ igual: false, outro_fuso: false, um_ms: true, sem_valor: true }]);
    });
  });

  it('a lista de um domain sai do check dele, na ordem de listas.md, igual à que o teste de paridade lê', async () => {
    await caso(db, postgres, async (s) => {
      const domains = await domainsDoMkt(s.linhas);
      expect(domains.length).toBeGreaterThan(40);
      for (const d of domains) {
        expect(d.codigos.length, d.nome).toBeGreaterThan(0);
        expect(await s.valor(`select private.domain_codes($1::regtype)`, [`mkt.${d.nome}`]), d.nome).toEqual(
          d.codigos,
        );
      }
    });
  });

  it('o pedido de cada execução, no formato da plataforma: valor final, criar sempre pausada, o código no nome', async () => {
    const criar =
      '{"objective": "OUTCOME_SALES", "daily_budget_cents": 4550, "name": "cs-remarketing", "special_ad_categories": [], "advertising_channel_type": "SEARCH", "bidding_strategy": "MAXIMIZE_CONVERSIONS", "budget_mode": "BUDGET_MODE_DAY"}';
    const casos: Array<[string, string, string, string | null, unknown]> = [
      ['pause', 'meta', '{}', null, { status: 'PAUSED' }],
      ['pause', 'tiktok', '{}', null, { operation_status: 'DISABLE' }],
      ['pause', 'google', '{}', null, { status: 'PAUSED' }],
      ['activate', 'meta', '{}', null, { status: 'ACTIVE' }],
      ['activate', 'tiktok', '{}', null, { operation_status: 'ENABLE' }],
      ['activate', 'google', '{}', null, { status: 'ENABLED' }],
      ['set_daily_budget', 'meta', '{"daily_budget_cents": 4550}', null, { daily_budget: 4550 }],
      ['set_daily_budget', 'tiktok', '{"daily_budget_cents": 4550}', null, { budget: 45.5 }],
      ['set_daily_budget', 'google', '{"daily_budget_cents": 4550}', null, { amount_micros: 45500000 }],
      [
        'create_campaign',
        'meta',
        criar,
        'ACT-0012',
        {
          name: 'cs-remarketing-act-0012',
          objective: 'OUTCOME_SALES',
          status: 'PAUSED',
          special_ad_categories: [],
          daily_budget: 4550,
        },
      ],
      [
        'create_campaign',
        'tiktok',
        criar,
        'ACT-0012',
        {
          campaign_name: 'cs-remarketing-act-0012',
          objective_type: 'OUTCOME_SALES',
          budget_mode: 'BUDGET_MODE_DAY',
          budget: 45.5,
          operation_status: 'DISABLE',
        },
      ],
      [
        'create_campaign',
        'google',
        criar,
        'ACT-0012',
        {
          name: 'cs-remarketing-act-0012',
          advertising_channel_type: 'SEARCH',
          bidding_strategy: 'MAXIMIZE_CONVERSIONS',
          status: 'PAUSED',
          amount_micros: 45500000,
          contains_eu_political_advertising: false,
        },
      ],
      // O nome que já termina com o código não ganha outro.
      [
        'create_campaign',
        'meta',
        '{"objective": "OUTCOME_SALES", "daily_budget_cents": 3000, "name": "cs-remarketing-ACT-0012", "special_ad_categories": []}',
        'ACT-0012',
        {
          name: 'cs-remarketing-ACT-0012',
          objective: 'OUTCOME_SALES',
          status: 'PAUSED',
          special_ad_categories: [],
          daily_budget: 3000,
        },
      ],
      [
        'set_account_spend_cap',
        'meta',
        '{"spend_cap_cents": 1500000}',
        null,
        { spend_cap: 15000, spend_cap_action: 'reset' },
      ],
      [
        'set_account_spend_cap',
        'meta',
        '{"spend_cap_cents": 1}',
        null,
        { spend_cap: 0.01, spend_cap_action: 'reset' },
      ],
    ];
    await caso(db, postgres, async (s) => {
      for (const [operacao, plataforma, params, codigo, esperado] of casos) {
        expect(
          await s.valor('select private.execution_request($1, $2, $3::jsonb, $4)', [
            operacao,
            plataforma,
            params,
            codigo,
          ]),
          `${operacao} ${plataforma}`,
        ).toEqual(esperado);
      }
    });
  });

  it('o cabeçalho do CSV: coluna de pessoa recusa o arquivo; as colunas do relatório de campanha passam', async () => {
    const casos: Array<[string, boolean]> = [
      [
        'Campaign ID,Campaign name,Day,Amount spent (BRL),Impressions,Link clicks\n1,a,2026-11-01,1,1,1',
        false,
      ],
      ['Identificação da campanha;Nome da campanha;Dia;Valor usado (BRL)\r\n1;a;2026-11-01;1', false],
      ['Campaign ID\tCampaign name\tLeads\n', false],
      ['﻿"Campaign ID","Nome do conjunto de anúncios","Resultados"', false],
      ['Campaign ID,E-mail\n1,x', true],
      ['Campaign ID;Email Address', true],
      ['Campaign ID\tNome\n', true],
      ['"Nome completo","Campaign ID"', true],
      ['Campaign ID,Telefone', true],
      ['Campaign ID,Phone number', true],
      ['Campaign ID,WhatsApp', true],
      ['Campaign ID,CPF', true],
      ['Campaign ID,CNPJ do cliente', true],
      ['Campaign ID,Endereço', true],
      ['﻿First name,Last name', true],
      ['', false],
    ];
    await caso(db, postgres, async (s) => {
      for (const [cabecalho, recusa] of casos) {
        expect(await s.valor('select mkt.csv_header_has_personal_data($1)', [cabecalho]), cabecalho).toBe(
          recusa,
        );
      }
    });
  });
});

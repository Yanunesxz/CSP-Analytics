// Migração 01: esquemas, papéis de serviço, privilégios e as funções base (docs/dados/plano.md); e a barreira de dado
// pessoal (mkt.has_personal_data) onde ela é usada, com os dados inventados das fixtures.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  abrirBanco,
  anon,
  aplicarFixture,
  caso,
  lerMigracoes,
  postgres,
  servico,
  usuario,
} from './apoio/banco';
import { ESQUEMAS } from './apoio/catalogo';
import { CAMPANHA_HUMANO_CS } from './apoio/marketing';
import { IDEIA_DO_CLAUDE, PENDENCIA } from './apoio/trafego';
import { DONO, GESTOR } from './apoio/usuarios';

const USUARIO_A = '00000000-0000-4000-8000-00000000000a';
const SERVICOS = ['mkt_executor', 'mkt_setup', 'mkt_worker', 'n8n_notifier'];
// Todo mundo que pode tentar: PUBLIC, os papéis da API e os de serviço.
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
// As fórmulas de mkt servem à tela, ao worker e ao executor (papeis-e-rls.md, "Privilégios por esquema").
const FORMULAS = ['authenticated', 'mkt_worker', 'mkt_executor'];

let db: PGlite;

beforeAll(async () => {
  db = await abrirBanco();
});

afterAll(async () => {
  await db.close();
});

describe('esquemas e papéis', () => {
  it('cria os sete esquemas e os papéis de serviço sem login, sem bypassrls e sem criar papel ou banco', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        await s.linhas<{ nspname: string }>(
          'select nspname from pg_namespace where nspname = any($1) order by 1',
          [ESQUEMAS],
        ),
      ).toEqual([...ESQUEMAS].sort().map((nspname) => ({ nspname })));
      expect(
        await s.linhas(
          `select rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
             from pg_roles where rolname = any($1) order by 1`,
          [SERVICOS],
        ),
      ).toEqual(
        SERVICOS.map((rolname) => ({
          rolname,
          rolcanlogin: false,
          rolsuper: false,
          rolbypassrls: false,
          rolcreaterole: false,
          rolcreatedb: false,
          rolreplication: false,
        })),
      );
    });
  });

  it('nenhum papel de serviço herda outro, e a API (authenticator) não entra como serviço', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        await s.linhas(
          `select r.rolname as papel, m.rolname as membro
             from pg_auth_members am
             join pg_roles r on r.oid = am.roleid
             join pg_roles m on m.oid = am.member
            where m.rolname = any($1)
               or (r.rolname = any($1) and m.rolname in ('anon', 'authenticated', 'service_role', 'authenticator'))`,
          [SERVICOS],
        ),
      ).toEqual([]);
    });
  });

  it('para com MIG-01 se um papel de serviço já existe com bypassrls', async () => {
    const migracao01 = lerMigracoes().find((m) => m.nome === '20261103160000_esquemas_e_papeis.sql');
    expect(migracao01).toBeDefined();
    await caso(db, postgres, async (s) => {
      await s.exec('alter role mkt_executor bypassrls');
      const erro = await s.erro('P0001', migracao01?.sql ?? '');
      expect(erro.message).toContain('MIG-01');
    });
  });

  it('cada papel usa só os esquemas da sua lista, e ninguém cria objeto neles', async () => {
    const uso: Record<string, string[]> = {
      mkt: FORMULAS,
      api: ['authenticated'],
      authz: ['authenticated'],
      ingest: ['mkt_worker', 'mkt_executor'],
      notify: ['n8n_notifier'],
      private: ['mkt_worker', 'mkt_executor'],
      setup: ['mkt_setup'],
    };
    await caso(db, postgres, async (s) => {
      const linhas = await s.linhas<{ esquema: string; papel: string; usa: boolean; cria: boolean }>(
        `select n.nspname as esquema, r.papel,
                has_schema_privilege(r.papel, n.oid, 'usage') as usa,
                has_schema_privilege(r.papel, n.oid, 'create') as cria
           from pg_namespace n cross join unnest($2::text[]) as r(papel)
          where n.nspname = any($1)`,
        [ESQUEMAS, QUEM],
      );
      expect(linhas).toHaveLength(ESQUEMAS.length * QUEM.length);
      for (const l of linhas) {
        expect(l.usa, `${l.papel} usa ${l.esquema}`).toBe(uso[l.esquema]?.includes(l.papel) ?? false);
        expect(l.cria, `${l.papel} cria em ${l.esquema}`).toBe(false);
      }
    });
  });

  it('anon não alcança nada; logado e worker usam as fórmulas de mkt e nada de private', async () => {
    await caso(db, anon, async (s) => {
      await s.erro('42501', `select mkt.utm_key('Black Friday')`);
      await s.erro('42501', 'select mkt.now()');
    });
    await caso(db, usuario(USUARIO_A), async (s) => {
      expect(await s.valor(`select mkt.utm_key('Black Friday')`)).toBe('black friday');
      await s.erro('42501', `select private.next_code('LEAD', 'mkt.lead_code_seq')`);
      await s.erro('42501', `select nextval('mkt.lead_code_seq')`);
    });
    await caso(db, servico('mkt_worker'), async (s) => {
      expect(await s.valor(`select mkt.has_personal_data('ligar para (11) 98765-4321')`)).toBe(true);
      // O worker tem o esquema private, mas não a função: só os gatilhos (dono postgres) geram código.
      await s.erro('42501', `select private.next_code('LEAD', 'mkt.lead_code_seq')`);
    });
    for (const papel of ['mkt_setup', 'n8n_notifier'] as const) {
      await caso(db, servico(papel), async (s) => {
        await s.erro('42501', `select mkt.utm_key('x')`);
      });
    }
  });
});

describe('privilégios das funções', () => {
  const FUNCOES: Record<string, { quem: string[]; volatilidade: string; paralela: string }> = {
    'mkt.sp_day(timestamp with time zone)': { quem: FORMULAS, volatilidade: 'i', paralela: 's' },
    'mkt.utm_key(text)': { quem: FORMULAS, volatilidade: 'i', paralela: 's' },
    'mkt.has_personal_data(text)': { quem: FORMULAS, volatilidade: 'i', paralela: 's' },
    'mkt.valid_crm_text(text,boolean)': { quem: FORMULAS, volatilidade: 'i', paralela: 's' },
    'mkt.now()': { quem: FORMULAS, volatilidade: 's', paralela: 'u' },
    'mkt.today()': { quem: FORMULAS, volatilidade: 's', paralela: 'u' },
    'private.set_updated_at()': { quem: [], volatilidade: 'v', paralela: 'u' },
    'private.next_code(text,regclass)': { quem: [], volatilidade: 'v', paralela: 'u' },
  };

  it('as funções base existem com search_path pg_catalog, pg_temp, sem security definer e com a volatilidade do modelo', async () => {
    await caso(db, postgres, async (s) => {
      const linhas = await s.linhas<{
        funcao: string;
        prosecdef: boolean;
        provolatile: string;
        proparallel: string;
        config: string[] | null;
      }>(
        `select p.oid::regprocedure::text as funcao, p.prosecdef, p.provolatile, p.proparallel, p.proconfig as config
           from pg_proc p where p.oid::regprocedure::text = any($1) order by 1`,
        [Object.keys(FUNCOES)],
      );
      expect(linhas.map((l) => l.funcao)).toEqual(Object.keys(FUNCOES).sort());
      for (const l of linhas) {
        const esperado = FUNCOES[l.funcao];
        expect(l.prosecdef, l.funcao).toBe(false);
        expect(l.config, l.funcao).toEqual(['search_path=pg_catalog, pg_temp']);
        expect(l.provolatile, l.funcao).toBe(esperado?.volatilidade);
        expect(l.proparallel, l.funcao).toBe(esperado?.paralela);
      }
    });
  });

  it('só quem usa executa: as fórmulas de mkt para a tela, o worker e o executor; as de private, ninguém', async () => {
    await caso(db, postgres, async (s) => {
      const linhas = await s.linhas<{ funcao: string; papel: string; executa: boolean }>(
        `select f.funcao, r.papel, has_function_privilege(r.papel, f.funcao::regprocedure, 'execute') as executa
           from unnest($1::text[]) as f(funcao) cross join unnest($2::text[]) as r(papel)`,
        [Object.keys(FUNCOES), QUEM],
      );
      expect(linhas).toHaveLength(Object.keys(FUNCOES).length * QUEM.length);
      for (const l of linhas) {
        expect(l.executa, `${l.papel} executa ${l.funcao}`).toBe(
          FUNCOES[l.funcao]?.quem.includes(l.papel) ?? false,
        );
      }
    });
  });

  it('o que as próximas migrações criarem já nasce fechado: função sem PUBLIC e tabela de mkt só para leitura', async () => {
    const novas = ESQUEMAS.map((esquema) => `${esquema}.funcao_nova_de_teste()`);
    await caso(db, postgres, async (s) => {
      await s.exec('create table mkt.nova (id int);');
      for (const funcao of novas) {
        await s.exec(`create function ${funcao} returns int language sql as 'select 1'`);
      }
      const tabela = await s.linhas<{ papel: string; le: boolean; grava: boolean }>(
        `select r.papel, has_table_privilege(r.papel, 'mkt.nova', 'select') as le,
                has_table_privilege(r.papel, 'mkt.nova', 'insert, update, delete, truncate, references, trigger') as grava
           from unnest($1::text[]) as r(papel)`,
        [QUEM],
      );
      for (const l of tabela) {
        expect(l.le, `${l.papel} lê mkt.nova`).toBe(l.papel === 'authenticated');
        expect(l.grava, `${l.papel} grava em mkt.nova`).toBe(false);
      }
      const funcoes = await s.linhas<{ funcao: string; papel: string; executa: boolean }>(
        `select f.funcao, r.papel, has_function_privilege(r.papel, f.funcao::regprocedure, 'execute') as executa
           from unnest($1::text[]) as f(funcao) cross join unnest($2::text[]) as r(papel)`,
        [novas, QUEM],
      );
      expect(funcoes).toHaveLength(ESQUEMAS.length * QUEM.length);
      for (const l of funcoes) {
        const quem = l.funcao.startsWith('mkt.') ? FORMULAS : [];
        expect(l.executa, `${l.papel} executa ${l.funcao}`).toBe(quem.includes(l.papel));
      }
    });
  });
});

describe('mkt.sp_day', () => {
  it('dá o dia de São Paulo (UTC−3), qualquer que seja o fuso da sessão', async () => {
    await caso(db, usuario(USUARIO_A), async (s) => {
      for (const fuso of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
        await s.exec(`set local time zone '${fuso}'`);
        expect(
          await s.linhas(
            `select mkt.sp_day('2026-11-01 02:59:59+00')::text as antes, mkt.sp_day('2026-11-01 03:00:00+00')::text as depois,
                    mkt.sp_day(null) as nulo`,
          ),
          fuso,
        ).toEqual([{ antes: '2026-10-31', depois: '2026-11-01', nulo: null }]);
      }
    });
  });

  it('sp_day e utm_key são immutable: servem em índice (os de crm_orders e campanhas usam)', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(`
        create table test.instantes (em timestamptz, nome text);
        create index instantes_dia on test.instantes (mkt.sp_day(em));
        create index instantes_chave on test.instantes (mkt.utm_key(nome));
      `);
      expect(await s.valor(`select count(*)::int from pg_indexes where tablename = 'instantes'`)).toBe(2);
    });
  });
});

describe('mkt.utm_key', () => {
  it('minúsculas, espaços simples e sem espaço nas pontas; vazio vira nulo', async () => {
    const casos: [string | null, string | null][] = [
      ['  Black   Friday\t2026\n', 'black friday 2026'],
      ['PROMOÇÃO Dia das Mães', 'promoção dia das mães'],
      ['black-friday_2026', 'black-friday_2026'],
      ['', null],
      [' \t ', null],
      [null, null],
    ];
    await caso(db, usuario(USUARIO_A), async (s) => {
      for (const [texto, chave] of casos) {
        expect(await s.valor('select mkt.utm_key($1)', [texto]), JSON.stringify(texto)).toBe(chave);
      }
    });
  });
});

describe('mkt.has_personal_data', () => {
  const BARRA = [
    'fale com a compradora em loja@exemplo.com.br',
    'ligar para (11) 98765-4321',
    'telefone 11987654321',
    'fixo (11) 3456-7890',
    '+55 11 98765-4321',
    'whatsapp 5511987654321',
    // O 0 ou o 55 antes do DDD, e espaço, ponto ou hífen depois do DDD, depois do 9 e entre os blocos.
    'ligar para (11) 9 8765-4321',
    'ligar para 11 9 8765-4321',
    'ligar para +55 (11) 9 8765-4321',
    'ligar para (11) 9.8765-4321',
    'ligar para 011 98765-4321',
    'ligar para (011) 98765-4321',
    'ligar para 11 98765.4321',
    'ligar para 11.98765.4321',
    'ligar para 11-98765-4321',
    'ligar para (11)9-8765-4321',
    'whatsapp +5511987654321',
    'cliente 123.456.789-01',
    'cpf 12345678901',
    'CNPJ 12.345.678/0001-90',
    'cnpj 12345678000190',
  ];
  const PASSA = [
    'Foco em lojistas novos no Meta; verba de R$ 15.000 no mês.',
    'Repostar o reel do @plumene.oficial com o melhor CTR de outubro.',
    'Testar 3 criativos por 7 dias e pausar quem passar de R$ 40 por lead.',
    'Verba de R$ 1.500.000,00 no ano, de 01/11/2026 a 30/11/2026.',
    'campanha cs-promo-2026-11-28 e cs-lancamento-act-0012',
    'criativo meta:120200000000000301',
    'campanha 120200000000000000',
    // O 55 no meio de um número, seguido de dígitos que parecem DDD e telefone: o \y antes do 55 não deixa casar.
    'campanha 120202551234567890',
    'campanha 125511987654321',
    'conta act_5511987654321',
    'conta act_1234567890',
    'conta act_120200000000000000',
    'campanha 120200000000000000 na conta act_1234567890',
    '',
    null,
  ];

  it('barra e-mail, telefone com e sem máscara (também com o 55 ou o 0 e com separador depois do 9), CPF e CNPJ', async () => {
    await caso(db, usuario(USUARIO_A), async (s) => {
      for (const texto of BARRA) {
        expect(await s.valor('select mkt.has_personal_data($1)', [texto]), texto).toBe(true);
      }
    });
  });

  it('deixa passar texto de trabalho, @ de perfil, id de campanha de 18 dígitos e conta act_', async () => {
    await caso(db, usuario(USUARIO_A), async (s) => {
      for (const texto of PASSA) {
        expect(await s.valor('select mkt.has_personal_data($1)', [texto]), String(texto)).toBe(false);
      }
    });
  });
});

describe('a barreira de dado pessoal onde mkt.has_personal_data é usada', () => {
  // Um formato que o padrão de antes deixava passar: espaço depois do 9 (revisão de 10/11/2026, achado 5).
  const FONE = '(11) 9 8765-4321';
  const MES = `(date_trunc('month', mkt.today()) + interval '2 months')::date`;
  let dados: PGlite;

  beforeAll(async () => {
    dados = await abrirBanco();
    for (const f of ['usuarios', 'marketing', 'trafego']) await aplicarFixture(dados, f);
  });

  afterAll(async () => {
    await dados.close();
  });

  it('estratégia: a tela recebe PT422 com o telefone e grava sem ele; a tabela recusa de novo', async () => {
    await caso(dados, usuario(GESTOR), async (s) => {
      const salvar = `select body from api.save_strategy('cs', ${MES}, $1, 100000, null, null, null, null)`;
      expect((await s.erro('PT422', salvar, [`Ligar para o lojista no ${FONE} antes.`])).detail).toBe(
        'personal_data',
      );
      expect(await s.valor(salvar, ['Ligar para o lojista antes.'])).toBe('Ligar para o lojista antes.');
      await s.como(postgres);
      await s.erro(
        '23514',
        `insert into mkt.traffic_strategies (brand_id, month_on, body, updated_by)
         select b.id, ${MES} + interval '1 month', $1, $2 from mkt.brands b where b.code = 'cs'`,
        [`Ligar no ${FONE}.`, DONO],
      );
    });
  });

  it('ação: a proposta da pessoa e a do Claude são recusadas com o telefone no título ou no porquê, e nos parâmetros', async () => {
    await caso(dados, usuario(GESTOR), async (s) => {
      const propor = `select id from api.propose_action('cs', 'meta', $1, 'pause', $2, $3, '{"status": "paused"}',
                                                        'low', 'low', 0)`;
      for (const [titulo, porque] of [
        ['Pausar a prospecção', `Ligar no ${FONE} antes de pausar.`],
        [`Ligar no ${FONE}`, 'O custo por lead subiu na semana.'],
      ]) {
        expect((await s.erro('PT422', propor, [CAMPANHA_HUMANO_CS, titulo, porque])).detail).toBe(
          'personal_data',
        );
      }
      expect(
        await s.linhas(propor, [
          CAMPANHA_HUMANO_CS,
          'Pausar a prospecção',
          'O custo por lead subiu na semana.',
        ]),
      ).toHaveLength(1);
      const criar = (nome: string) =>
        s.valor(
          `select mkt.valid_action_params('create', 'meta', jsonb_build_object('objective', 'OUTCOME_SALES',
                    'daily_budget_cents', 3000, 'name', $1::text, 'special_ad_categories', '[]'::jsonb))`,
          [nome],
        );
      expect(await criar(`cs-ligar ${FONE}`)).toBe(false);
      expect(await criar('cs-lancamento')).toBe(true);
    });
    await caso(dados, servico('mkt_worker'), async (s) => {
      const rodada = '00000000-0000-4000-8000-0000000005f1';
      await s.linhas(
        `select * from ingest.record_claude_run($1, 'cs', 'running', 'modelo-de-teste', 'teste-1', 'Proponha ações.',
                                                '{"brand": "cs"}', now())`,
        [rodada],
      );
      const proposta = (item: number, porque: string) =>
        s.valor<string | null>(
          `select ingest.add_claude_proposal($1, $2, 'cs', 'meta', $3, 'pause', 'Pausar a prospecção', $4,
                                             '{"status": "paused"}', 'low', 'low', 0)::text`,
          [rodada, item, CAMPANHA_HUMANO_CS, porque],
        );
      expect(await proposta(1, `Ligar no ${FONE} antes de pausar.`)).toBeNull();
      expect(await proposta(2, 'O custo por lead subiu na semana.')).not.toBeNull();
    });
  });

  it('contexto e prompt do Claude: o telefone no texto recusa a rodada antes da API (CONTEXT_REFUSED)', async () => {
    await caso(dados, servico('mkt_worker'), async (s) => {
      const contextos = (texto: string) => [
        { brand: 'cs', strategy: { body: texto } },
        { current_month: { campaigns: [{ name: texto }] } },
        { actions: [{ code: 'ACT-0009', proposed_by: 'claude', title: texto }] },
      ];
      for (const ctx of contextos(`Ligar no ${FONE}`)) {
        expect(await s.valor('select mkt.valid_claude_context($1::jsonb)', [JSON.stringify(ctx)])).toBe(
          false,
        );
      }
      for (const ctx of contextos('Foco no Sul')) {
        expect(await s.valor('select mkt.valid_claude_context($1::jsonb)', [JSON.stringify(ctx)])).toBe(true);
      }
      const rodar = (id: string, prompt: string, ctx: unknown) =>
        s.linhas(
          `select status, error_code, prompt from ingest.record_claude_run($1, 'cs', 'running', 'modelo-de-teste',
                                                                            'teste-1', $2, $3::jsonb, now())`,
          [id, prompt, JSON.stringify(ctx)],
        );
      expect(
        await rodar('00000000-0000-4000-8000-0000000005f2', 'Proponha ações.', {
          brand: 'cs',
          strategy: { body: `Ligar no ${FONE}` },
        }),
      ).toEqual([{ status: 'failed', error_code: 'CONTEXT_REFUSED', prompt: 'Proponha ações.' }]);
      expect(
        await rodar('00000000-0000-4000-8000-0000000005f3', `Ligue para ${FONE}.`, { brand: 'cs' }),
      ).toEqual([{ status: 'failed', error_code: 'CONTEXT_REFUSED', prompt: '' }]);
      expect(await rodar('00000000-0000-4000-8000-0000000005f4', 'Proponha ações.', { brand: 'cs' })).toEqual(
        [{ status: 'running', error_code: null, prompt: 'Proponha ações.' }],
      );
      await s.como(postgres);
      await s.erro(
        '23514',
        `insert into mkt.claude_runs (status, model, prompt_version, prompt, context, started_at)
         values ('failed', 'modelo-de-teste', 'teste-1', $1, '{}', now())`,
        [`Ligue para ${FONE}.`],
      );
    });
  });

  it('trilha: o motivo do descarte, o resultado, a nota da troca de operador e a do acesso tirado recusam o telefone', async () => {
    await caso(dados, usuario(DONO, 'aal2'), async (s) => {
      const lido = (tabela: string, id: string) =>
        s.valor<Date>(`select updated_at from mkt.${tabela} where id = $1`, [id]);
      const nota = `Combinado com o lojista no ${FONE}.`;
      expect(
        (
          await s.erro('PT422', `select id from api.discard_action($1, 'other', $2, $3)`, [
            IDEIA_DO_CLAUDE,
            nota,
            await lido('traffic_actions', IDEIA_DO_CLAUDE),
          ])
        ).detail,
      ).toBe('note');
      expect(
        (
          await s.erro('PT422', `select id from api.mark_action_done($1, $2, $3)`, [
            PENDENCIA,
            nota,
            await lido('traffic_actions', PENDENCIA),
          ])
        ).detail,
      ).toBe('result');
      expect(
        (
          await s.erro(
            'PT422',
            `select id from api.change_campaign_operator($1, 'claude', 'other', $2, $3)`,
            [CAMPANHA_HUMANO_CS, nota, await lido('campaigns', CAMPANHA_HUMANO_CS)],
          )
        ).detail,
      ).toBe('note');
      expect(
        (
          await s.erro('PT422', `select id from api.revoke_access($1, 'other', $2, $3)`, [
            GESTOR,
            nota,
            await lido('profiles', GESTOR),
          ])
        ).detail,
      ).toBe('note');
      // Controle: o mesmo descarte, sem o telefone, passa.
      expect(
        await s.linhas(`select id from api.discard_action($1, 'other', $2, $3)`, [
          IDEIA_DO_CLAUDE,
          'Combinado com o lojista por telefone.',
          await lido('traffic_actions', IDEIA_DO_CLAUDE),
        ]),
      ).toHaveLength(1);
      await s.como(postgres);
      await s.erro(
        '23514',
        `insert into mkt.campaign_managed_by_history (campaign_id, from_operator, to_operator, reason, note,
                                                      actor_kind, changed_by)
         values ($1, 'human', 'claude', 'other', $2, 'user', $3)`,
        [CAMPANHA_HUMANO_CS, nota, DONO],
      );
    });
  });
});

describe('mkt.valid_crm_text', () => {
  it('até 150 letras, sem @ e, fora o nome de campanha, sem dado pessoal; nulo passa', async () => {
    const casos: [string | null, boolean, boolean][] = [
      [null, false, true],
      ['google', false, true],
      ['a'.repeat(150), false, true],
      ['a'.repeat(151), false, false],
      ['a'.repeat(151), true, false],
      ['newsletter@exemplo.com', false, false],
      ['newsletter@exemplo.com', true, false],
      ['ligar 11987654321', false, false],
      ['promo 11987654321', true, true],
      ['cpf 123.456.789-01', false, false],
      ['black-friday-2026', true, true],
    ];
    await caso(db, servico('mkt_worker'), async (s) => {
      for (const [texto, campanha, valido] of casos) {
        expect(
          await s.valor('select mkt.valid_crm_text($1, $2::boolean)', [texto, campanha]),
          `${texto} (campanha: ${campanha})`,
        ).toBe(valido);
      }
      expect(await s.valor(`select mkt.valid_crm_text('ligar 11987654321')`)).toBe(false);
    });
  });
});

describe('relógio: mkt.now() e mkt.today()', () => {
  it('com test.clock vazio, vale now()', async () => {
    await caso(db, usuario(USUARIO_A), async (s) => {
      expect(await s.valor('select mkt.now() = now()')).toBe(true);
      expect(await s.valor(`select mkt.today() = (now() at time zone 'America/Sao_Paulo')::date`)).toBe(true);
    });
  });

  it('com hora em test.clock, vale a maior, para quem lê pela API e para os serviços', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(
        `insert into test.clock (now_at) values ('2026-10-31 12:00:00+00'), ('2026-11-01 02:30:00+00')`,
      );
      for (const quem of [postgres, usuario(USUARIO_A), servico('mkt_worker'), servico('mkt_executor')]) {
        await s.como(quem);
        expect(await s.linhas('select mkt.now()::text as agora, mkt.today()::text as hoje')).toEqual([
          { agora: '2026-11-01 02:30:00+00', hoje: '2026-10-31' },
        ]);
      }
    });
  });

  it('"hoje" vira à meia-noite de São Paulo, 03:00 em UTC', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(`insert into test.clock (now_at) values ('2026-11-01 03:00:00+00')`);
      await s.como(usuario(USUARIO_A));
      expect(await s.valor('select mkt.today()::text')).toBe('2026-11-01');
    });
  });

  it('em produção, sem o esquema test, vale now() e não dá erro', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec('drop schema test cascade');
      await s.como(usuario(USUARIO_A));
      expect(await s.valor('select mkt.now() = now()')).toBe(true);
      await s.como(servico('mkt_executor'));
      expect(await s.valor('select mkt.now() = now()')).toBe(true);
    });
  });
});

describe('códigos e updated_at', () => {
  it('private.next_code faz PREFIXO-0001 sem truncar: 9999 → LEAD-9999 e 10000 → LEAD-10000', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(
        `create sequence test.codigo_seq; select setval('test.codigo_seq', 9998); create sequence test.nova_seq;`,
      );
      expect(await s.valor(`select private.next_code('LEAD', 'test.codigo_seq')`)).toBe('LEAD-9999');
      expect(await s.valor(`select private.next_code('LEAD', 'test.codigo_seq')`)).toBe('LEAD-10000');
      expect(await s.valor(`select private.next_code('ACT', 'test.nova_seq')`)).toBe('ACT-0001');
    });
  });

  it('as três sequências dos códigos existem, começam do 1 e nenhum papel além do dono mexe nelas', async () => {
    const sequencias = ['mkt.lead_code_seq', 'mkt.sales_rep_code_seq', 'mkt.traffic_action_code_seq'];
    await caso(db, postgres, async (s) => {
      for (const seq of sequencias) {
        expect(await s.linhas(`select last_value::int as ultimo, is_called from ${seq}`), seq).toEqual([
          { ultimo: 1, is_called: false },
        ]);
      }
      const usam = await s.linhas<{ papel: string; seq: string }>(
        `select r.papel, q.seq from unnest($1::text[]) as q(seq) cross join unnest($2::text[]) as r(papel)
          where has_sequence_privilege(r.papel, q.seq, 'usage, select, update')`,
        [sequencias, QUEM],
      );
      expect(usam).toEqual([]);
    });
  });

  it('private.set_updated_at grava a hora da transação em milissegundos, por cima do que o update mandou', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(`
        create table test.registros (id int primary key, nome text, updated_at timestamptz not null);
        create trigger registros_updated_at before update on test.registros
          for each row execute function private.set_updated_at();
        insert into test.registros values (1, 'a', '2026-01-01 10:00:00.123456+00');
        update test.registros set nome = 'b', updated_at = '2000-01-01 00:00:00+00' where id = 1;
      `);
      expect(
        await s.linhas(
          `select updated_at = date_trunc('milliseconds', now()) as agora,
                  (extract(microseconds from updated_at) % 1000)::int as micro
             from test.registros`,
        ),
      ).toEqual([{ agora: true, micro: 0 }]);
    });
  });
});

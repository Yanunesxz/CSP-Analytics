// Migrações 07 e 08: quem lê cada tabela (docs/dados/papeis-e-rls.md, "Matriz de acesso" e "Políticas"). O dono e o
// gestor de tráfego leem pela permissão (view_traffic; o limite de gasto, view_numbers; os conectores,
// view_connectors); sem perfil, com perfil inativo ou sem login, nada; o worker e o executor, cada um só as tabelas da
// lista dele; ninguém grava direto (RLS-04); a fila de avisos e as credenciais, ninguém. E o catálogo das duas
// migrações: políticas, privilégios, funções, gatilhos e índices. Dados inventados de fixtures/usuarios.sql,
// marketing.sql, trafego.sql e conectores.sql.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Quem,
  type Sessao,
  abrirBanco,
  anon,
  aplicarFixture,
  caso,
  postgres,
  servico,
  usuario,
} from './apoio/banco';
import { consultaDe } from './apoio/catalogo';
import type { Permissao } from './apoio/marketing';
import { EXECUTOR_LE, LEITURA, NINGUEM_LE, WORKER_LE } from './apoio/trafego';
import { DONO, EX_GESTOR, GESTOR, SEGUNDO_DONO, SEM_PERFIL } from './apoio/usuarios';

const TABELAS = Object.keys(LEITURA);
const TODAS = [...TABELAS, ...NINGUEM_LE];
const PERMISSOES: Permissao[] = ['view_numbers', 'view_traffic', 'view_connectors'];
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

let db: PGlite;
/** Quantas linhas cada tabela tem, contadas pelo dono do banco. */
let totais: Record<string, number>;

beforeAll(async () => {
  db = await abrirBanco();
  for (const fixture of ['usuarios', 'marketing', 'trafego', 'conectores']) await aplicarFixture(db, fixture);
  const consulta = consultaDe(db);
  totais = {};
  for (const tabela of TODAS) {
    totais[tabela] = (await consulta<{ n: number }>(`select count(*)::int as n from ${tabela}`))[0]?.n ?? -1;
  }
});

afterAll(async () => {
  await db.close();
});

async function contar(s: Sessao): Promise<Record<string, number>> {
  const r: Record<string, number> = {};
  for (const tabela of TABELAS) r[tabela] = await s.valor<number>(`select count(*)::int from ${tabela}`);
  return r;
}

const daApi = () => Object.fromEntries(TABELAS.map((t) => [t, totais[t]]));
const zerado = () => Object.fromEntries(TABELAS.map((t) => [t, 0]));

describe('quem lê as tabelas das migrações 07 e 08', () => {
  it('as fixtures têm linhas em todas as tabelas (senão "zero linhas" não provaria nada)', () => {
    for (const tabela of TODAS) expect(totais[tabela], tabela).toBeGreaterThan(0);
  });

  it('o dono e o gestor de tráfego leem tudo o que a API lê, com ou sem o segundo fator (ver não pede o TOTP)', async () => {
    for (const quem of [
      usuario(DONO, 'aal1'),
      usuario(DONO, 'aal2'),
      usuario(SEGUNDO_DONO, 'aal1'),
      usuario(GESTOR, 'aal1'),
      usuario(GESTOR, 'aal2'),
    ]) {
      await caso(db, quem, async (s) => {
        expect(await contar(s), JSON.stringify(quem)).toEqual(daApi());
      });
    }
  });

  it('RLS-20 e RLS-21: perfil inativo e login sem perfil não leem nada, nem com o segundo fator', async () => {
    for (const id of [EX_GESTOR, SEM_PERFIL]) {
      await caso(db, usuario(id, 'aal2'), async (s) => {
        expect(await contar(s), id).toEqual(zerado());
      });
    }
  });

  it('anon não alcança os esquemas', async () => {
    await caso(db, anon, async (s) => {
      for (const tabela of TODAS) {
        expect((await s.erro('42501', `select count(*) from ${tabela}`)).message, tabela).toContain(
          'permission denied',
        );
      }
    });
  });

  it('cada tabela pede a sua permissão: sem ela, só as tabelas dela somem para o gestor', async () => {
    for (const permissao of PERMISSOES) {
      await caso(db, postgres, async (s) => {
        await s.exec(
          `delete from mkt.role_permissions where role = 'traffic_manager' and action = '${permissao}'`,
        );
        await s.como(usuario(GESTOR, 'aal2'));
        expect(await contar(s), permissao).toEqual(
          Object.fromEntries(TABELAS.map((t) => [t, LEITURA[t] === permissao ? 0 : totais[t]])),
        );
      });
    }
  });

  it('o worker lê só as da lista dele (nunca paradas, execuções nem o diário); o executor, só as dele (RLS-34)', async () => {
    for (const [papel, lista] of [
      ['mkt_worker', WORKER_LE],
      ['mkt_executor', EXECUTOR_LE],
    ] as Array<['mkt_worker' | 'mkt_executor', readonly string[]]>) {
      await caso(db, servico(papel), async (s) => {
        for (const tabela of TODAS) {
          if (lista.includes(tabela)) {
            expect(await s.valor(`select count(*)::int from ${tabela}`), `${papel} ${tabela}`).toBe(
              totais[tabela],
            );
          } else {
            await s.erro('42501', `select count(*) from ${tabela}`);
          }
        }
      });
    }
  });

  it('RLS-23: os scripts e o n8n não leem nada (o n8n usa as funções da fila)', async () => {
    for (const papel of ['mkt_setup', 'n8n_notifier'] as const) {
      await caso(db, servico(papel), async (s) => {
        for (const tabela of TODAS) await s.erro('42501', `select count(*) from ${tabela}`);
      });
    }
  });

  it('RLS-04: ninguém grava direto, nem o dono com o segundo fator, nem os serviços', async () => {
    const quem: Quem[] = [
      anon,
      usuario(DONO, 'aal2'),
      usuario(GESTOR, 'aal2'),
      servico('mkt_worker'),
      servico('mkt_executor'),
      servico('mkt_setup'),
      servico('n8n_notifier'),
    ];
    for (const q of quem) {
      await caso(db, q, async (s) => {
        for (const tabela of TODAS) {
          await s.erro('42501', `insert into ${tabela} default values`);
          await s.erro('42501', `update ${tabela} set updated_at = updated_at`);
          await s.erro('42501', `delete from ${tabela}`);
          await s.erro('42501', `truncate ${tabela}`);
        }
      });
    }
  });
});

describe('o catálogo das migrações 07 e 08', () => {
  it('a RLS ligada em todas; políticas só de select: a de authenticated confere a permissão; worker e executor nas deles', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        await s.linhas(
          `select c.oid::regclass::text as tabela from pg_class c
            where c.oid::regclass::text = any($1) and not c.relrowsecurity`,
          [TODAS],
        ),
      ).toEqual([]);
      const politicas = await s.linhas<{
        tabela: string;
        politica: string;
        papeis: string[];
        cmd: string;
        usando: string;
        conferindo: string | null;
      }>(
        `select schemaname || '.' || tablename as tabela, policyname::text as politica, roles::text[] as papeis, cmd,
                qual as usando, with_check as conferindo
           from pg_policies where (schemaname || '.' || tablename) = any($1) order by 1, 2`,
        [TODAS],
      );
      const esperado = TABELAS.flatMap((tabela) => {
        const nome = tabela.slice('mkt.'.length);
        return [
          { tabela, politica: `${nome}_read`, papeis: ['authenticated'] },
          ...(EXECUTOR_LE.includes(tabela)
            ? [{ tabela, politica: `${nome}_executor_read`, papeis: ['mkt_executor'] }]
            : []),
          ...(WORKER_LE.includes(tabela)
            ? [{ tabela, politica: `${nome}_worker_read`, papeis: ['mkt_worker'] }]
            : []),
        ];
      }).sort((a, b) =>
        a.tabela === b.tabela ? (a.politica < b.politica ? -1 : 1) : a.tabela < b.tabela ? -1 : 1,
      );
      // A fila de avisos e as credenciais não têm política nenhuma.
      expect(politicas.map(({ tabela, politica, papeis }) => ({ tabela, politica, papeis }))).toEqual(
        esperado,
      );
      for (const p of politicas) {
        expect(p.cmd, p.politica).toBe('SELECT');
        expect(p.conferindo, p.politica).toBeNull();
        if (p.papeis[0] === 'authenticated') {
          expect(p.usando, p.politica).toMatch(
            new RegExp(
              `^\\( SELECT authz\\.can\\(\\(?'${LEITURA[p.tabela]}'(::text\\))?::mkt\\.app_action\\) AS can\\)$`,
            ),
          );
        } else {
          expect(p.usando, p.politica).toBe('true');
        }
      }
    });
  });

  it('os privilégios: só select, para authenticated nas que a API lê e para cada serviço nas dele; a fila e as credenciais, ninguém', async () => {
    await caso(db, postgres, async (s) => {
      const linhas = await s.linhas<{ tabela: string; papel: string; le: boolean; grava: boolean }>(
        `select t.tabela, r.papel, has_table_privilege(r.papel, t.tabela, 'select') as le,
                has_table_privilege(r.papel, t.tabela, 'insert, update, delete, truncate, references, trigger') as grava
           from unnest($1::text[]) as t(tabela) cross join unnest($2::text[]) as r(papel)`,
        [TODAS, QUEM],
      );
      expect(linhas).toHaveLength(TODAS.length * QUEM.length);
      for (const l of linhas) {
        const le =
          (l.papel === 'authenticated' && TABELAS.includes(l.tabela)) ||
          (l.papel === 'mkt_worker' && WORKER_LE.includes(l.tabela)) ||
          (l.papel === 'mkt_executor' && EXECUTOR_LE.includes(l.tabela));
        expect(l.le, `${l.papel} lê ${l.tabela}`).toBe(le);
        expect(l.grava, `${l.papel} grava em ${l.tabela}`).toBe(false);
      }
      // A sequência da ordem do diário é só do dono.
      expect(
        await s.linhas(
          `select r.papel from unnest($1::text[]) as r(papel)
            where has_sequence_privilege(r.papel, pg_get_serial_sequence('mkt.traffic_log', 'seq'), 'usage, select, update')`,
          [QUEM],
        ),
      ).toEqual([]);
    });
  });

  it('as conferências de jsonb: regras puras (immutable, sem security definer, search_path pg_catalog, pg_temp) para a tela, o worker e o executor', async () => {
    const FUNCOES = [
      'mkt.valid_action_params(mkt.action_kind,mkt.platform,jsonb)',
      'mkt.valid_claude_context(jsonb)',
      'mkt.valid_notice_payload(mkt.notice_kind,jsonb)',
    ];
    await caso(db, postgres, async (s) => {
      expect(
        await s.linhas(
          `select p.oid::regprocedure::text as funcao, p.provolatile, p.prosecdef, p.proconfig as config
             from pg_proc p where p.oid::regprocedure::text = any($1) order by 1`,
          [FUNCOES],
        ),
      ).toEqual(
        [...FUNCOES].sort().map((funcao) => ({
          funcao,
          provolatile: 'i',
          prosecdef: false,
          config: ['search_path=pg_catalog, pg_temp'],
        })),
      );
      const executam = await s.linhas<{ funcao: string; papel: string }>(
        `select f.funcao, r.papel from unnest($1::text[]) as f(funcao) cross join unnest($2::text[]) as r(papel)
          where has_function_privilege(r.papel, f.funcao::regprocedure, 'execute') order by 1, 2`,
        [FUNCOES, QUEM],
      );
      expect(executam).toEqual(
        [...FUNCOES]
          .sort()
          .flatMap((funcao) =>
            ['authenticated', 'mkt_executor', 'mkt_worker'].map((papel) => ({ funcao, papel })),
          ),
      );
    });
  });

  it('os gatilhos: security definer, search_path pg_catalog, pg_temp, ninguém executa; cada um ligado na tabela dele', async () => {
    const FUNCOES = [
      'private.traffic_actions_code()',
      'private.traffic_actions_transition()',
      'private.traffic_actions_log()',
      'private.platform_executions_guard()',
      'private.platform_executions_log()',
    ];
    await caso(db, postgres, async (s) => {
      expect(
        await s.linhas(
          `select p.oid::regprocedure::text as funcao, p.prosecdef, p.proconfig as config
             from pg_proc p where p.oid::regprocedure::text = any($1) order by 1`,
          [FUNCOES],
        ),
      ).toEqual(
        [...FUNCOES]
          .sort()
          .map((funcao) => ({ funcao, prosecdef: true, config: ['search_path=pg_catalog, pg_temp'] })),
      );
      expect(
        await s.linhas(
          `select f.funcao, r.papel from unnest($1::text[]) as f(funcao) cross join unnest($2::text[]) as r(papel)
            where has_function_privilege(r.papel, f.funcao::regprocedure, 'execute')`,
          [FUNCOES, QUEM],
        ),
      ).toEqual([]);
      const gatilhos = await s.linhas<{ tabela: string; gatilho: string; funcao: string; def: string }>(
        `select t.tgrelid::regclass::text as tabela, t.tgname::text as gatilho, t.tgfoid::regprocedure::text as funcao,
                pg_get_triggerdef(t.oid) as def
           from pg_trigger t
          where t.tgrelid::regclass::text = any($1) and not t.tgisinternal and t.tgenabled = 'O'
          order by 1, 2`,
        [TODAS],
      );
      const proprios = gatilhos.filter((g) => !g.gatilho.endsWith('_updated_at'));
      expect(proprios.map(({ tabela, gatilho, funcao }) => ({ tabela, gatilho, funcao }))).toEqual([
        {
          tabela: 'mkt.platform_executions',
          gatilho: 'platform_executions_guard',
          funcao: 'private.platform_executions_guard()',
        },
        {
          tabela: 'mkt.platform_executions',
          gatilho: 'platform_executions_log',
          funcao: 'private.platform_executions_log()',
        },
        {
          tabela: 'mkt.traffic_actions',
          gatilho: 'traffic_actions_code',
          funcao: 'private.traffic_actions_code()',
        },
        {
          tabela: 'mkt.traffic_actions',
          gatilho: 'traffic_actions_log',
          funcao: 'private.traffic_actions_log()',
        },
        {
          tabela: 'mkt.traffic_actions',
          gatilho: 'traffic_actions_transition',
          funcao: 'private.traffic_actions_transition()',
        },
        { tabela: 'mkt.traffic_log', gatilho: 'traffic_log_append_only', funcao: 'private.append_only()' },
        { tabela: 'mkt.traffic_log', gatilho: 'traffic_log_no_truncate', funcao: 'private.append_only()' },
      ]);
      const def = (nome: string) => proprios.find((g) => g.gatilho === nome)?.def ?? '';
      expect(def('traffic_actions_transition')).toContain('BEFORE INSERT OR UPDATE ON mkt.traffic_actions');
      expect(def('traffic_actions_code')).toContain('BEFORE INSERT OR UPDATE OF code ON mkt.traffic_actions');
      expect(def('traffic_actions_log')).toContain('AFTER INSERT OR UPDATE OF status ON mkt.traffic_actions');
      expect(def('platform_executions_guard')).toContain(
        'BEFORE INSERT OR UPDATE ON mkt.platform_executions',
      );
      expect(def('platform_executions_log')).toContain(
        'AFTER INSERT OR UPDATE OF status ON mkt.platform_executions',
      );
      expect(def('traffic_log_append_only')).toContain(
        `BEFORE DELETE OR UPDATE ON mkt.traffic_log FOR EACH ROW EXECUTE FUNCTION private.append_only('occurred_at', '5 years')`,
      );
      expect(def('traffic_log_no_truncate')).toContain('BEFORE TRUNCATE ON mkt.traffic_log');
      // updated_at por gatilho em toda tabela, também nas credenciais.
      for (const tabela of TODAS) {
        const nome = `${tabela.split('.')[1]}_updated_at`;
        expect(gatilhos.find((g) => g.tabela === tabela && g.gatilho === nome)?.funcao, tabela).toBe(
          'private.set_updated_at()',
        );
      }
    });
  });

  it('o updated_at em milissegundos, por cima do que o update mandou', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(`update mkt.connectors set updated_at = '2000-01-01' where code = 'ga4'`);
      expect(
        await s.valor(
          `select updated_at = date_trunc('milliseconds', now()) from mkt.connectors where code = 'ga4'`,
        ),
      ).toBe(true);
    });
  });

  it('os índices de tabelas.md', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        await s.linhas(
          `select indexname::text from pg_indexes
            where (schemaname || '.' || tablename) = any($1) and indexname not like '%\\_pkey'
              and indexname not like '%\\_key' order by 1`,
          [TODAS],
        ),
      ).toEqual(
        [
          'claude_runs_started',
          'notification_outbox_pending',
          'platform_executions_open',
          'sync_runs_connector_time',
          'sync_runs_one_request',
          'traffic_actions_campaign',
          'traffic_actions_created',
          'traffic_actions_status',
          'traffic_log_action',
          'traffic_log_brand_time',
          'traffic_log_time',
        ].map((indexname) => ({ indexname })),
      );
    });
  });
});

// Migrações 04 a 06: quem lê cada tabela (docs/dados/papeis-e-rls.md, "Matriz de acesso" e "Políticas"). O dono e o
// gestor de tráfego leem pela permissão (view_numbers, view_leads, view_traffic, view_connectors); sem perfil, com
// perfil inativo ou sem login, nada; o worker lê todas, o executor só marcas, contas, campanhas e gasto; ninguém grava
// direto (RLS-04). E a marca: obrigatória em toda tabela de fato, menos as da decisão 0014. Dados inventados de
// fixtures/usuarios.sql e fixtures/marketing.sql.
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
import { EXECUTOR_LE, LEITURA, MARCA_PODE_FALTAR, type Permissao } from './apoio/marketing';
import { DONO, EX_GESTOR, GESTOR, SEGUNDO_DONO, SEM_PERFIL } from './apoio/usuarios';

const TABELAS = Object.keys(LEITURA);
const PERMISSOES: Permissao[] = ['view_numbers', 'view_leads', 'view_traffic', 'view_connectors'];
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
  await aplicarFixture(db, 'usuarios');
  await aplicarFixture(db, 'marketing');
  const consulta = consultaDe(db);
  totais = {};
  for (const tabela of TABELAS) {
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

const zerado = () => Object.fromEntries(TABELAS.map((t) => [t, 0]));

describe('quem lê as tabelas das migrações 04 a 06', () => {
  it('a fixture tem linhas em todas as tabelas (senão "zero linhas" não provaria nada)', () => {
    expect(Object.keys(totais).sort()).toEqual([...TABELAS].sort());
    for (const tabela of TABELAS) expect(totais[tabela], tabela).toBeGreaterThan(0);
  });

  it('o dono e o gestor de tráfego leem tudo, com ou sem o segundo fator (ver não pede o TOTP)', async () => {
    for (const quem of [
      usuario(DONO, 'aal1'),
      usuario(DONO, 'aal2'),
      usuario(SEGUNDO_DONO, 'aal1'),
      usuario(GESTOR, 'aal1'),
      usuario(GESTOR, 'aal2'),
    ]) {
      await caso(db, quem, async (s) => {
        expect(await contar(s), JSON.stringify(quem)).toEqual(totais);
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

  it('anon não alcança o esquema mkt', async () => {
    await caso(db, anon, async (s) => {
      for (const tabela of TABELAS) {
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

  it('o worker lê todas; o executor só marcas, contas, campanhas e gasto (RLS-34: nada de leads); setup e n8n nada (RLS-23)', async () => {
    await caso(db, servico('mkt_worker'), async (s) => {
      expect(await contar(s)).toEqual(totais);
    });
    await caso(db, servico('mkt_executor'), async (s) => {
      for (const tabela of TABELAS) {
        if (EXECUTOR_LE.includes(tabela)) {
          expect(await s.valor(`select count(*)::int from ${tabela}`), tabela).toBe(totais[tabela]);
        } else {
          await s.erro('42501', `select count(*) from ${tabela}`);
        }
      }
    });
    for (const papel of ['mkt_setup', 'n8n_notifier'] as const) {
      await caso(db, servico(papel), async (s) => {
        for (const tabela of TABELAS) await s.erro('42501', `select count(*) from ${tabela}`);
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
        for (const tabela of TABELAS) {
          await s.erro('42501', `insert into ${tabela} default values`);
          await s.erro('42501', `update ${tabela} set updated_at = updated_at`);
          await s.erro('42501', `delete from ${tabela}`);
          await s.erro('42501', `truncate ${tabela}`);
        }
      });
    }
  });
});

describe('o catálogo das migrações 04 a 06', () => {
  it('as políticas: só select; a de authenticated confere a permissão da tabela; a do worker em todas; a do executor nas dele', async () => {
    await caso(db, postgres, async (s) => {
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
        [TABELAS],
      );
      const esperado = TABELAS.flatMap((tabela) => {
        const nome = tabela.slice('mkt.'.length);
        return [
          { tabela, politica: `${nome}_read`, papeis: ['authenticated'] },
          ...(EXECUTOR_LE.includes(tabela)
            ? [{ tabela, politica: `${nome}_executor_read`, papeis: ['mkt_executor'] }]
            : []),
          { tabela, politica: `${nome}_worker_read`, papeis: ['mkt_worker'] },
        ];
      }).sort((a, b) =>
        a.tabela === b.tabela ? (a.politica < b.politica ? -1 : 1) : a.tabela < b.tabela ? -1 : 1,
      );
      expect(politicas.map(({ tabela, politica, papeis }) => ({ tabela, politica, papeis }))).toEqual(
        esperado,
      );
      for (const p of politicas) {
        expect(p.cmd, p.politica).toBe('SELECT');
        expect(p.conferindo, p.politica).toBeNull();
        if (p.papeis[0] === 'authenticated') {
          // A constante do domain sai como ('view_numbers'::text)::mkt.app_action (ou sem o ::text).
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

  it('os privilégios: só select, e só para authenticated, o worker e, nas dele, o executor', async () => {
    await caso(db, postgres, async (s) => {
      const linhas = await s.linhas<{ tabela: string; papel: string; le: boolean; grava: boolean }>(
        `select t.tabela, r.papel, has_table_privilege(r.papel, t.tabela, 'select') as le,
                has_table_privilege(r.papel, t.tabela, 'insert, update, delete, truncate, references, trigger') as grava
           from unnest($1::text[]) as t(tabela) cross join unnest($2::text[]) as r(papel)`,
        [TABELAS, QUEM],
      );
      expect(linhas).toHaveLength(TABELAS.length * QUEM.length);
      for (const l of linhas) {
        const le =
          l.papel === 'authenticated' ||
          l.papel === 'mkt_worker' ||
          (l.papel === 'mkt_executor' && EXECUTOR_LE.includes(l.tabela));
        expect(l.le, `${l.papel} lê ${l.tabela}`).toBe(le);
        expect(l.grava, `${l.papel} grava em ${l.tabela}`).toBe(false);
      }
    });
  });

  it('a marca: obrigatória em toda tabela de fato, com chave para a marca (direto ou pela do pai); nula só na decisão 0014', async () => {
    await caso(db, postgres, async (s) => {
      const tabelas = await s.linhas<{ tabela: string; obrigatoria: boolean; com_chave: boolean }>(
        `select a.attrelid::regclass::text as tabela, a.attnotnull as obrigatoria,
                exists (select 1 from pg_constraint c
                         where c.conrelid = a.attrelid and c.contype = 'f' and a.attnum = any(c.conkey)) as com_chave
           from pg_attribute a
           join pg_class r on r.oid = a.attrelid
          where r.relnamespace = 'mkt'::regnamespace and r.relkind = 'r'
            and a.attname = 'brand_id' and not a.attisdropped
          order by 1`,
      );
      // Sem brand_id: a própria marca, as dimensões compartilhadas (decisão 0003) e o histórico de operador, que é da
      // marca da campanha.
      const semMarca = [
        'mkt.brands',
        'mkt.sales_reps',
        'mkt.crm_funnels',
        'mkt.crm_origin_map',
        'mkt.crm_customers',
        'mkt.campaign_managed_by_history',
      ];
      const daqui = tabelas.filter((t) => TABELAS.includes(t.tabela));
      expect(daqui.map((t) => t.tabela).sort()).toEqual(TABELAS.filter((t) => !semMarca.includes(t)).sort());
      for (const t of tabelas) {
        expect(t.obrigatoria, t.tabela).toBe(!MARCA_PODE_FALTAR.includes(t.tabela));
        expect(t.com_chave, t.tabela).toBe(true);
      }
    });
  });
});

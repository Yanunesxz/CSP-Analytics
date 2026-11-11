// Fechamento da camada 1 do teste de RLS (docs/dados/papeis-e-rls.md, "Casos"), sobre o que existe até a migração 11
// adiantada. Cada caso varre o catálogo (toda tabela, view e função dos sete esquemas), para o que a próxima migração
// criar entrar no caso sozinho; o teste da migração de cada função confere o detalhe dela. Aqui: RLS-01 a 05, 17 a 19,
// 20 e 21 (o que já existe), 22 a 24, 27 a 30 e 34. RLS-31 e RLS-32 são só da camada 2 (scripts/testar-rls.mjs); o que
// volta na fase 4 (as api.kpi_* e as views da migração 12, a fila do n8n da migração 13) está em it.todo. Dados
// inventados de fixtures/usuarios.sql, marketing.sql, trafego.sql e conectores.sql.
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
import { ESQUEMAS, violacoes } from './apoio/catalogo';
import { ANTIGO, FUNCOES_DE_API, ZERO } from './apoio/acoes';
import { abrirRodada, gravar } from './apoio/ingestao';
import { CAMPANHA_HUMANO_CS } from './apoio/marketing';
import { PAPEIS_DO_CATALOGO, UPSERTS_COM_RODADA, quemExecuta } from './apoio/permissoes';
import {
  CREDENCIAL_DE_ESCRITA,
  CREDENCIAL_DE_LEITURA,
  IDEIA_DO_CLAUDE,
  RODADA_DO_CLAUDE,
} from './apoio/trafego';
import { DONO, EX_GESTOR, GESTOR, SEM_PERFIL } from './apoio/usuarios';

let db: PGlite;

beforeAll(async () => {
  db = await abrirBanco();
  for (const f of ['usuarios', 'marketing', 'trafego', 'conectores']) await aplicarFixture(db, f);
});

afterAll(async () => {
  await db.close();
});

const DONO_2F = usuario(DONO, 'aal2');
const TOKEN_DO_DONO = { sub: DONO, role: 'authenticated', aal: 'aal2' };
const APENAS_ACRESCIMO = ['mkt.traffic_log', 'mkt.audit_log', 'mkt.campaign_managed_by_history'];

/** As relações (tabela e view) dos esquemas pedidos, como regclass em texto. */
async function relacoes(
  s: Sessao,
  esquemas: readonly string[],
  tipos = ['r', 'p', 'v', 'm', 'f'],
): Promise<string[]> {
  const linhas = await s.linhas<{ rel: string }>(
    `select c.oid::regclass::text as rel
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1) and c.relkind = any($2::"char"[]) order by 1`,
    [esquemas, tipos],
  );
  return linhas.map((l) => l.rel);
}

/** Quantas linhas quem está na sessão vê em cada tabela e view de mkt e de api que o papel dele pode ler. */
async function linhasVisiveis(s: Sessao): Promise<Record<string, number>> {
  const linhas = await s.linhas<{ rel: string; n: number }>(
    `select c.oid::regclass::text as rel,
            (xpath('/row/n/text()',
                   query_to_xml(format('select count(*) as n from %s', c.oid::regclass), false, true, '')))[1]::text::int as n
       from pg_class c
      where c.relnamespace in ('mkt'::regnamespace, 'api'::regnamespace) and c.relkind in ('r', 'p', 'v')
        and has_table_privilege(c.oid, 'select')
      order by 1`,
  );
  return Object.fromEntries(linhas.map((l) => [l.rel, l.n]));
}

/** Os comandos de escrita direta em cada tabela dos esquemas pedidos: inserir, alterar a 1ª coluna, apagar e esvaziar. */
async function escritasDiretas(s: Sessao, esquemas: readonly string[]): Promise<string[]> {
  const linhas = await s.linhas<{ sql: string }>(
    `select unnest(array[
              format('insert into %s default values', c.oid::regclass),
              format('update %s set %I = %I', c.oid::regclass, a.attname, a.attname),
              format('delete from %s', c.oid::regclass),
              format('truncate %s', c.oid::regclass)]) as sql
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attnum = 1
      where n.nspname = any($1) and c.relkind in ('r', 'p')
      order by c.oid::regclass::text`,
    [esquemas],
  );
  return linhas.map((l) => l.sql);
}

describe('anon, sem login (RLS-01 a 04)', () => {
  it('RLS-01 e RLS-02: nenhum dos sete esquemas aparece para anon; as views e as funções de api dão 42501', async () => {
    await caso(db, postgres, async (s) => {
      const usa = await s.linhas<{ esquema: string; usa: boolean }>(
        `select e as esquema, has_schema_privilege('anon', e, 'usage') as usa from unnest($1::text[]) e`,
        [ESQUEMAS],
      );
      expect(usa.filter((l) => l.usa)).toEqual([]);
      expect(usa).toHaveLength(7);
    });
    await caso(db, anon, async (s) => {
      for (const view of ['api.v_traffic_actions', 'api.v_traffic_log']) {
        expect((await s.erro('42501', `select * from ${view}`)).message, view).toContain('schema api');
      }
      for (const [nome, f] of Object.entries(FUNCOES_DE_API)) {
        expect((await s.erro('42501', f.chamada)).message, nome).toContain('schema api');
      }
    });
  });

  it('RLS-03: anon não lê a réplica do CRM, nem nenhuma tabela ou view dos sete esquemas', async () => {
    const todas = await caso(db, postgres, (s) => relacoes(s, ESQUEMAS));
    expect(todas).toContain('mkt.crm_leads');
    await caso(db, anon, async (s) => {
      expect((await s.erro('42501', 'select * from mkt.crm_leads')).message).toContain('schema mkt');
      for (const rel of todas) await s.erro('42501', `select 1 from ${rel} limit 1`);
    });
  });

  it('RLS-04: anon e quem está logado (o dono com o segundo fator, o gestor) não gravam direto em tabela de mkt nem de private', async () => {
    const comandos = await caso(db, postgres, (s) => escritasDiretas(s, ['mkt', 'private']));
    // 46 tabelas (45 de mkt e as credenciais) × 4 comandos.
    expect(comandos.length).toBeGreaterThanOrEqual(46 * 4);
    for (const quem of [anon, DONO_2F, usuario(GESTOR)]) {
      await caso(db, quem, async (s) => {
        for (const sql of comandos) await s.erro('42501', sql);
      });
    }
  });
});

describe('quem lê pela API (RLS-05, 20 e 21)', () => {
  it('RLS-05, o controle: o gestor lê as duas views de api e o estado das credenciais', async () => {
    const [acoes, diario, credenciais] = await caso(db, postgres, async (s) => [
      await s.valor<number>('select count(*)::int from mkt.traffic_actions'),
      await s.valor<number>('select count(*)::int from mkt.traffic_log'),
      await s.valor<number>('select count(*)::int from private.connector_credentials'),
    ]);
    expect(Math.min(acoes, diario, credenciais)).toBeGreaterThan(0);
    await caso(db, usuario(GESTOR), async (s) => {
      expect(await s.valor('select count(*)::int from api.v_traffic_actions')).toBe(acoes);
      expect(await s.valor('select count(*)::int from api.v_traffic_log')).toBe(diario);
      expect(await s.valor('select count(*)::int from api.credential_status()')).toBe(credenciais);
    });
  });

  it('RLS-20 e RLS-21: perfil inativo e login sem perfil não veem linha de tabela nem de view, nem com o segundo fator; o inativo vê só o próprio perfil', async () => {
    // O controle: o dono do banco vê linhas em quase todas, então o zero abaixo vem da RLS, não de tabela vazia.
    const doDono = await caso(db, postgres, linhasVisiveis);
    expect(Object.values(doDono).filter((n) => n > 0).length).toBeGreaterThanOrEqual(40);
    const visto = (contagem: Record<string, number>) =>
      Object.entries(contagem)
        .filter(([, n]) => n > 0)
        .map(([rel, n]) => `${rel}=${n}`);
    const doInativo = await caso(db, usuario(EX_GESTOR, 'aal2'), linhasVisiveis);
    expect(Object.keys(doInativo).length).toBeGreaterThanOrEqual(46);
    expect(visto(doInativo)).toEqual(['mkt.profiles=1']);
    const semPerfil = await caso(db, usuario(SEM_PERFIL, 'aal2'), linhasVisiveis);
    expect(Object.keys(semPerfil).length).toBeGreaterThanOrEqual(46);
    expect(visto(semPerfil)).toEqual([]);
  });

  it('RLS-20 e RLS-21: toda função de api dá PT403 para eles, menos my_profile e my_permissions', async () => {
    for (const quem of [usuario(EX_GESTOR, 'aal2'), usuario(SEM_PERFIL, 'aal2')]) {
      await caso(db, quem, async (s) => {
        for (const [nome, f] of Object.entries(FUNCOES_DE_API)) {
          if (nome === 'my_profile' || nome === 'my_permissions') continue;
          await s.erro('PT403', f.chamada).catch((e: Error) => {
            throw new Error(`${nome}: ${e.message}`);
          });
        }
      });
    }
  });

  it.todo(
    'RLS-01, 05, 20 e 21 (fase 4): as api.kpi_* da migração 12 para anon, o gestor, o perfil inativo e o login sem perfil',
  );
});

describe('o que só cresce e o que a tela não lê (RLS-17 a 19)', () => {
  it('RLS-17: o diário, a auditoria e o histórico do operador: o dono pela API não grava; nem o dono do banco altera, apaga ou esvazia', async () => {
    const comandos = (tabela: string) => [
      `update ${tabela} set id = id`,
      `delete from ${tabela}`,
      `truncate ${tabela}`,
    ];
    await caso(db, DONO_2F, async (s) => {
      for (const tabela of APENAS_ACRESCIMO) {
        await s.erro('42501', `insert into ${tabela} default values`);
        for (const sql of comandos(tabela)) await s.erro('42501', sql);
      }
    });
    await caso(db, postgres, async (s) => {
      for (const tabela of APENAS_ACRESCIMO) {
        const total = await s.valor<number>(`select count(*)::int from ${tabela}`);
        expect(total, tabela).toBeGreaterThan(0);
        for (const sql of comandos(tabela)) expect((await s.erro('PT403', sql)).message, sql).toBe('LOG-403');
        expect(await s.valor(`select count(*)::int from ${tabela}`)).toBe(total);
      }
    });
  });

  it('RLS-18: as credenciais e o cofre: nem o dono pela API, nem anon; o worker só pela função dele', async () => {
    await caso(db, DONO_2F, async (s) => {
      await s.erro('42501', 'select * from private.connector_credentials');
      await s.erro('42501', 'select private.read_credential($1)', [CREDENCIAL_DE_LEITURA]);
    });
    for (const quem of [anon, DONO_2F, usuario(GESTOR), servico('mkt_worker'), servico('n8n_notifier')]) {
      await caso(db, quem, async (s) => {
        await s.erro('42501', 'select * from vault.decrypted_secrets');
        await s.erro('42501', 'select * from vault.secrets');
      });
    }
    await caso(db, postgres, async (s) => {
      // O apontador da fixture não tem segredo no Vault: o dono do banco guarda um inventado só neste caso.
      await s.exec(`update private.connector_credentials set vault_secret_id = vault.create_secret('segredo-inventado-rls')
                     where id = '${CREDENCIAL_DE_LEITURA}'`);
      await s.como(servico('mkt_worker'));
      await s.erro('42501', 'select * from private.connector_credentials');
      // O controle: a função do worker devolve o segredo de leitura.
      expect(await s.valor('select private.read_credential($1)', [CREDENCIAL_DE_LEITURA])).toBe(
        'segredo-inventado-rls',
      );
    });
  });

  it('RLS-19: a fila de avisos: sem grant para a tela; e, mesmo com um grant por engano, a RLS não tem política para ela', async () => {
    await caso(db, DONO_2F, async (s) => {
      await s.erro('42501', 'select * from mkt.notification_outbox');
    });
    await caso(db, postgres, async (s) => {
      const total = await s.valor<number>('select count(*)::int from mkt.notification_outbox');
      expect(total).toBeGreaterThan(0);
      expect(
        await s.valor(
          `select count(*)::int from pg_policies
            where schemaname = 'mkt' and tablename = 'notification_outbox'
              and roles && array['public', 'authenticated', 'anon']::name[]`,
        ),
      ).toBe(0);
      // O grant por engano fica só neste caso, que é desfeito no fim.
      await s.exec('grant select on mkt.notification_outbox to authenticated');
      await s.como(DONO_2F);
      expect(await s.valor('select count(*)::int from mkt.notification_outbox')).toBe(0);
    });
  });
});

describe('os serviços (RLS-22, 23, 28, 30 e 34)', () => {
  it('RLS-22: o worker, mesmo com o token do dono, não aprova, não muda a ação direto nem o operador da campanha', async () => {
    await caso(db, servico('mkt_worker', TOKEN_DO_DONO), async (s) => {
      expect(
        (await s.erro('42501', `select api.approve_action($1, $2)`, [IDEIA_DO_CLAUDE, ANTIGO])).message,
      ).toContain('schema api');
      await s.erro('42501', `update mkt.traffic_actions set status = 'approved' where id = $1`, [
        IDEIA_DO_CLAUDE,
      ]);
      await s.erro('42501', `update mkt.campaigns set managed_by = 'claude' where id = $1`, [
        CAMPANHA_HUMANO_CS,
      ]);
      // Pela ingestão, o operador nem é campo do evento: a linha é recusada e a campanha não muda.
      const rodada = await abrirRodada(s, 'meta', 'ads_hourly');
      expect(
        await gravar(s, 'upsert_campaigns', rodada, [
          {
            key: { external_id: '120200000000000001' },
            values: { name: 'cs-prospeccao-lojistas', status: 'active', managed_by: 'claude' },
          },
        ]),
      ).toEqual([{ item: 1, code: 'UNKNOWN_FIELD', is_refused: true }]);
      expect(await s.valor('select managed_by from mkt.campaigns where id = $1', [CAMPANHA_HUMANO_CS])).toBe(
        'human',
      );
    });
  });

  it('RLS-23: o n8n e os scripts não leem nenhuma tabela ou view de mkt nem de api', async () => {
    const todas = await caso(db, postgres, (s) => relacoes(s, ['mkt', 'api']));
    // O mínimo que scripts/testar-rls-servicos.sql confere na conexão de cada serviço.
    expect(todas.filter((r) => r.startsWith('mkt.')).length).toBeGreaterThanOrEqual(45);
    for (const quem of [servico('n8n_notifier'), servico('mkt_setup')]) {
      await caso(db, quem, async (s) => {
        for (const rel of todas) await s.erro('42501', `select 1 from ${rel} limit 1`);
      });
    }
  });

  it('RLS-28: o gestor, o dono e o n8n não chamam as funções do segredo e da fila, nem leem o cofre', async () => {
    const chamadas: Array<[string, unknown[]]> = [
      ['select private.read_credential($1)', [CREDENCIAL_DE_LEITURA]],
      [`select private.rotate_credential($1, 'segredo-inventado', null)`, [CREDENCIAL_DE_LEITURA]],
      ['select private.queue_execution($1)', [ZERO]],
      ['select * from vault.decrypted_secrets', []],
    ];
    for (const quem of [usuario(GESTOR), DONO_2F, servico('n8n_notifier')]) {
      await caso(db, quem, async (s) => {
        for (const [sql, params] of chamadas) await s.erro('42501', sql, params);
      });
    }
  });

  it('RLS-30: o worker não lê pessoas, não aprova por nenhuma função dele, não apaga fora da réplica, não executa e não lê a credencial de escrita', async () => {
    // O que aprovar, executar ou apagar mudaria (a ideia nova do Claude não entra: é o que o worker pode fazer).
    const RETRATO = `
      select (select count(*) from mkt.traffic_actions where status not in ('idea', 'discarded'))::text || '/' ||
             (select count(approved_by) from mkt.traffic_actions)::text || '/' ||
             (select count(*) from mkt.platform_executions)::text || '/' || (select count(*) from mkt.profiles)::text || '/' ||
             (select count(*) from mkt.audit_log)::text || '/' || (select count(*) from mkt.crm_leads)::text || '/' ||
             (select max(updated_at)::text from mkt.traffic_actions where id = '${IDEIA_DO_CLAUDE}')`;
    await caso(db, postgres, async (s) => {
      const antes = await s.valor<string>(RETRATO);
      await s.como(servico('mkt_worker', TOKEN_DO_DONO));
      for (const tabela of [
        'profiles',
        'invitations',
        'notification_preferences',
        'saved_filters',
        'audit_log',
      ]) {
        await s.erro('42501', `select * from mkt.${tabela}`);
      }
      // Com o token do dono, a proposta do worker continua do Claude e ideia; nenhuma função dele aprova ou descarta.
      await s.linhas(
        `select * from ingest.record_claude_run($1, 'cs', 'running', 'modelo-de-teste', 'teste-2', 'Proponha ações.', '{"brand": "cs"}', now())`,
        ['00000000-0000-4000-8000-000000000601'],
      );
      const proposta = await s.valor<string>(
        `select ingest.add_claude_proposal('00000000-0000-4000-8000-000000000601', 1, 'cs', 'meta', $1, 'pause',
                                           'Pausar a prospecção', 'O custo por lead subiu na semana.',
                                           '{"status": "paused"}', 'low', 'low', 0)::text`,
        [CAMPANHA_HUMANO_CS],
      );
      expect(
        await s.linhas(
          `select status, proposed_by_kind, approved_by from mkt.traffic_actions where id = $1`,
          [proposta],
        ),
      ).toEqual([{ status: 'idea', proposed_by_kind: 'claude', approved_by: null }]);
      await s.erro('42501', `update mkt.traffic_actions set status = 'approved' where id = $1`, [
        IDEIA_DO_CLAUDE,
      ]);
      await s.erro('42501', `select ingest.set_action_progress($1, 'approved')`, [IDEIA_DO_CLAUDE]);
      await s.erro('42501', `select ingest.update_execution($1, 'confirmed')`, [ZERO]);
      await s.erro('42501', 'select * from ingest.next_execution()');
      const passada = await abrirRodada(s, 'csp360', 'crm_full_pass');
      await s.como(servico('mkt_worker', TOKEN_DO_DONO));
      for (const tabela of ['profiles', 'traffic_actions', 'audit_log', 'notification_outbox', 'campaigns']) {
        expect(
          (await s.erro('PT422', `select * from ingest.delete_missing($1, $2)`, [tabela, passada])).detail,
          tabela,
        ).toBe('table');
      }
      expect(
        (await s.erro('PT403', 'select private.read_credential($1)', [CREDENCIAL_DE_ESCRITA])).detail,
      ).toBe('purpose');
      await s.como(postgres);
      // Só a ideia do Claude entrou; nada foi aprovado, executado nem apagado.
      expect(await s.valor<string>(RETRATO)).toBe(antes);
    });
  });

  it('RLS-34: o executor não grava a ingestão, não propõe, não chama api, não lê segredo nenhum nem leads', async () => {
    await caso(db, servico('mkt_executor', TOKEN_DO_DONO), async (s) => {
      for (const funcao of UPSERTS_COM_RODADA) {
        await s.erro('42501', `select * from ingest.${funcao}(null, '[]')`);
      }
      await s.erro('42501', `select * from ingest.upsert_site_checks('[]')`);
      await s.erro(
        '42501',
        `select ingest.add_claude_proposal($1, 1, 'cs', 'meta', null, 'pause', 'Pausar a prospecção',
                                           'O custo por lead subiu na semana.', '{"status": "paused"}', 'low', 'low', 0)`,
        [RODADA_DO_CLAUDE],
      );
      await s.erro(
        '42501',
        `select * from ingest.record_claude_run($1, 'cs', 'running', 'm', 'v', 'p', '{}', now())`,
        [ZERO],
      );
      for (const f of Object.values(FUNCOES_DE_API)) await s.erro('42501', f.chamada);
      for (const credencial of [CREDENCIAL_DE_LEITURA, CREDENCIAL_DE_ESCRITA]) {
        await s.erro('42501', 'select private.read_credential($1)', [credencial]);
      }
      await s.erro('42501', 'select * from mkt.crm_leads');
    });
  });
});

describe('o catálogo (RLS-24, 27 e 29)', () => {
  it('RLS-24: toda view dos sete esquemas roda com os direitos de quem lê (security_invoker)', async () => {
    await caso(db, postgres, async (s) => {
      const views = await s.linhas<{ view: string; opcoes: string[] | null }>(
        `select c.oid::regclass::text as view, c.reloptions as opcoes
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = any($1) and c.relkind in ('v', 'm') order by 1`,
        [ESQUEMAS],
      );
      expect(views.map((v) => v.view)).toEqual([
        'api.v_traffic_actions',
        'api.v_traffic_log',
        'mkt.v_account_month',
      ]);
      for (const v of views) expect(v.opcoes ?? [], v.view).toContain('security_invoker=true');
    });
  });

  it.todo('RLS-24 (fase 4): as views de mkt e de api da migração 12 entram na lista acima');

  it('RLS-27: tabelas com RLS, toda função com search_path pg_catalog, pg_temp, sequências fechadas e nenhum serviço com bypassrls', async () => {
    await caso(db, postgres, async (s) => {
      expect(await violacoes(s.linhas)).toEqual([]);
    });
  });

  it('RLS-27: quem executa cada função dos sete esquemas é exatamente o da lista permitida', async () => {
    const permitida = quemExecuta();
    await caso(db, postgres, async (s) => {
      const catalogo = await s.linhas<{ funcao: string; papeis: string[] }>(
        `select p.oid::regprocedure::text as funcao,
                array(select r from unnest($2::text[]) with ordinality as x(r, i)
                       where has_function_privilege(r, p.oid, 'execute') order by i) as papeis
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = any($1)
          order by 1`,
        [ESQUEMAS, PAPEIS_DO_CATALOGO],
      );
      // As duas listas na mesma ordem (a do JavaScript, que não depende da collation do banco).
      const linha = (funcao: string, papeis: readonly string[]) =>
        `${funcao}: ${papeis.join(', ') || 'ninguém'}`;
      const doBanco = catalogo.map((l) => linha(l.funcao, l.papeis)).sort();
      const daLista = [...permitida.entries()].map(([funcao, papeis]) => linha(funcao, papeis)).sort();
      expect(doBanco).toEqual(daLista);
    });
  });

  it('RLS-29: ninguém grava pelas views de api, nem o dono com o segundo fator, nem os serviços', async () => {
    const views = await caso(db, postgres, async (s) => {
      const todas = await relacoes(s, ['api'], ['v', 'm']);
      for (const view of todas) {
        // 0 = nem insert, nem update, nem delete passam pela view (sem regra, sem gatilho, não atualizável).
        expect(await s.valor('select pg_relation_is_updatable($1::regclass, true)', [view]), view).toBe(0);
      }
      return todas;
    });
    expect(views.length).toBeGreaterThanOrEqual(2);
    const todos: Quem[] = [
      anon,
      DONO_2F,
      usuario(GESTOR),
      usuario(EX_GESTOR, 'aal2'),
      usuario(SEM_PERFIL, 'aal2'),
      servico('mkt_worker', TOKEN_DO_DONO),
      servico('mkt_executor'),
      servico('mkt_setup'),
      servico('n8n_notifier'),
    ];
    for (const quem of todos) {
      await caso(db, quem, async (s) => {
        for (const view of views) {
          // Sem permissão (42501) ou view que não grava (55000): as duas travas barram; vale a que vier primeiro.
          await s.erro(['42501', '55000'], `insert into ${view} (id) values (gen_random_uuid())`);
          await s.erro(['42501', '55000'], `update ${view} set id = id`);
          await s.erro(['42501', '55000'], `delete from ${view}`);
        }
      });
    }
  });
});

describe('a fila de avisos (fase 4)', () => {
  it.todo(
    'RLS-33: notify.claim_pending pula o aviso de quem perdeu o acesso ou o papel (vira skipped), com a migração 13',
  );
});

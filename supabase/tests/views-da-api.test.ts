// Migração 11, adiantada: as views da API do Tráfego (api.v_traffic_actions e api.v_traffic_log) e o alerta de cada ação
// (mkt.action_alert, metricas.md, seção 4.6). As views rodam com os direitos de quem lê (security_invoker), então a RLS
// das tabelas vale: o dono e o gestor leem; quem perdeu o acesso, sem perfil, anon e os serviços, não; nada grava por
// elas. Sem prompt nem contexto do Claude, e de cada pessoa só o nome. Dados inventados de fixtures/usuarios.sql,
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
import { mesDeTeste } from './apoio/ingestao';
import { ACAO_QUE_CRIOU, CAMPANHA_CLAUDE_CS, CAMPANHA_HUMANO_CS } from './apoio/marketing';
import {
  ACAO_APROVADA,
  ACAO_DESCARTADA,
  EXECUCAO_DA_ACAO,
  IDEIA_DO_CLAUDE,
  LIMITE_META_CS,
  PARADA,
  PENDENCIA,
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

const VIEWS = ['api.v_traffic_actions', 'api.v_traffic_log'];
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

const COLUNAS_DAS_ACOES = [
  'id',
  'code',
  'brand',
  'platform',
  'kind',
  'status',
  'title',
  'rationale',
  'params',
  'impact',
  'effort',
  'cost_cents',
  'ad_account_id',
  'account_name',
  'campaign_id',
  'campaign_name',
  'campaign_status',
  'campaign_operator',
  'campaign_daily_budget_cents',
  'proposed_by_kind',
  'proposed_by_name',
  'claude_run_id',
  'approved_at',
  'approved_by_name',
  'discarded_at',
  'discarded_by_name',
  'discard_reason',
  'discard_note',
  'done_via',
  'executed_at',
  'done_by_name',
  'result',
  'alert',
  'execution_id',
  'execution_operation',
  'execution_status',
  'execution_blocked_reason',
  'execution_error_code',
  'execution_http_status',
  'execution_attempts',
  'execution_updated_at',
  'created_at',
  'updated_at',
];
const COLUNAS_DO_DIARIO = [
  'id',
  'seq',
  'occurred_at',
  'event',
  'brand',
  'platform',
  'actor_kind',
  'actor_name',
  'traffic_action_id',
  'action_code',
  'campaign_id',
  'campaign_name',
  'traffic_stop_id',
  'spend_limit_id',
  'traffic_strategy_id',
  'platform_execution_id',
  'changes',
];

const alerta = async (s: Sessao, acao: string) =>
  s.valor<string | null>(`select alert from api.v_traffic_actions where id = $1`, [acao]);

describe('as views da API', () => {
  it('rodam com os direitos de quem lê (security_invoker) e com security_barrier; só authenticated lê, e só lê', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        await s.linhas(
          `select c.oid::regclass::text as view, c.reloptions as opcoes from pg_class c
            where c.relnamespace = 'api'::regnamespace and c.relkind = 'v' order by 1`,
        ),
      ).toEqual(VIEWS.map((view) => ({ view, opcoes: ['security_invoker=true', 'security_barrier=true'] })));
      const privilegios = await s.linhas<{ view: string; papel: string; le: boolean; grava: boolean }>(
        `select v.view, r.papel, has_table_privilege(r.papel, v.view, 'select') as le,
                has_table_privilege(r.papel, v.view, 'insert, update, delete, truncate, references, trigger') as grava
           from unnest($1::text[]) as v(view) cross join unnest($2::text[]) as r(papel)`,
        [VIEWS, QUEM],
      );
      for (const p of privilegios) {
        expect(p.le, `${p.papel} lê ${p.view}`).toBe(p.papel === 'authenticated');
        expect(p.grava, `${p.papel} grava em ${p.view}`).toBe(false);
      }
    });
  });

  it('as colunas: nenhuma traz o prompt, o contexto ou a resposta do Claude, nem o id de pessoa; de cada pessoa, só o nome', async () => {
    await caso(db, postgres, async (s) => {
      const colunas = async (view: string) =>
        (
          await s.linhas<{ attname: string }>(
            `select attname from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped order by attnum`,
            [view],
          )
        ).map((c) => c.attname);
      expect(await colunas('api.v_traffic_actions')).toEqual(COLUNAS_DAS_ACOES);
      expect(await colunas('api.v_traffic_log')).toEqual(COLUNAS_DO_DIARIO);
      for (const proibida of [
        'prompt',
        'context',
        'output',
        'proposed_by',
        'approved_by',
        'discarded_by',
        'done_by',
        'actor_id',
      ]) {
        expect(COLUNAS_DAS_ACOES).not.toContain(proibida);
        expect(COLUNAS_DO_DIARIO).not.toContain(proibida);
      }
    });
  });

  it('RLS-05: o gestor e o dono leem todas as ações e todo o diário, com o nome de quem fez', async () => {
    const [acoes, diario, codigo] = await caso(db, postgres, async (s) => [
      await s.valor<number>(`select count(*)::int from mkt.traffic_actions`),
      await s.valor<number>(`select count(*)::int from mkt.traffic_log`),
      await s.valor<string>(`select code from mkt.traffic_actions where id = $1`, [ACAO_APROVADA]),
    ]);
    expect(codigo).toMatch(/^ACT-[0-9]{4}$/);
    expect(acoes).toBeGreaterThan(0);
    for (const quem of [usuario(GESTOR), usuario(DONO), usuario(DONO, 'aal2')]) {
      await caso(db, quem, async (s) => {
        expect(await s.valor(`select count(*)::int from api.v_traffic_actions`)).toBe(acoes);
        expect(await s.valor(`select count(*)::int from api.v_traffic_log`)).toBe(diario);
        expect(
          await s.linhas(
            `select code, brand, status, proposed_by_name, approved_by_name, campaign_name, account_name,
                    execution_status, execution_blocked_reason
               from api.v_traffic_actions where id = $1`,
            [ACAO_APROVADA],
          ),
        ).toEqual([
          {
            code: codigo,
            brand: 'cs',
            status: 'approved',
            proposed_by_name: 'Dono de teste',
            approved_by_name: 'Dono de teste',
            campaign_name: 'cs-prospeccao-lojistas',
            account_name: 'Conta Meta de teste',
            execution_status: 'blocked',
            execution_blocked_reason: 'no_write_credential',
          },
        ]);
        expect(
          await s.linhas(
            `select discarded_by_name, discard_reason from api.v_traffic_actions where id = $1`,
            [ACAO_DESCARTADA],
          ),
        ).toEqual([{ discarded_by_name: 'Dono de teste', discard_reason: 'against_strategy' }]);
        expect(
          await s.linhas(
            `select actor_kind, actor_name from api.v_traffic_log where traffic_stop_id = $1 and event = 'stop_all'`,
            [PARADA],
          ),
        ).toEqual([{ actor_kind: 'user', actor_name: 'Dono de teste' }]);
      });
    }
  });

  it('RLS-20 e RLS-21: quem perdeu o acesso e quem não tem perfil leem zero linhas, mesmo com o segundo fator', async () => {
    for (const id of [EX_GESTOR, SEM_PERFIL]) {
      await caso(db, usuario(id, 'aal2'), async (s) => {
        for (const view of VIEWS)
          expect(await s.valor(`select count(*)::int from ${view}`), `${id} ${view}`).toBe(0);
      });
    }
  });

  it('RLS-01 e RLS-23: anon e os serviços não alcançam o esquema api', async () => {
    const quem: Quem[] = [
      anon,
      servico('mkt_worker'),
      servico('mkt_executor'),
      servico('mkt_setup'),
      servico('n8n_notifier'),
    ];
    for (const q of quem) {
      await caso(db, q, async (s) => {
        for (const view of VIEWS) {
          expect((await s.erro('42501', `select count(*) from ${view}`)).message).toContain('schema api');
        }
      });
    }
  });

  it('cada view pede a permissão das tabelas: sem view_traffic, nada; sem view_numbers, a ação vem sem a campanha e a conta', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(
        `delete from mkt.role_permissions where role = 'traffic_manager' and action = 'view_numbers'`,
      );
      await s.como(usuario(GESTOR));
      expect(
        await s.linhas(`select brand, campaign_name, account_name from api.v_traffic_actions where id = $1`, [
          ACAO_APROVADA,
        ]),
      ).toEqual([{ brand: null, campaign_name: null, account_name: null }]);
      await s.como(postgres);
      await s.exec(
        `delete from mkt.role_permissions where role = 'traffic_manager' and action = 'view_traffic'`,
      );
      await s.como(usuario(GESTOR));
      for (const view of VIEWS) expect(await s.valor(`select count(*)::int from ${view}`)).toBe(0);
    });
  });

  it('RLS-29: ninguém grava pelas views, nem o dono com o segundo fator: sem permissão e sem regra ou gatilho que grave', async () => {
    await caso(db, postgres, async (s) => {
      for (const view of VIEWS) {
        // 0 = nenhuma das operações (insert, update, delete) passa pela view.
        expect(await s.valor(`select pg_relation_is_updatable($1::regclass, true)`, [view]), view).toBe(0);
        expect(
          await s.valor(`select count(*)::int from pg_trigger where tgrelid = $1::regclass`, [view]),
          view,
        ).toBe(0);
        expect(
          await s.valor(
            `select count(*)::int from pg_rewrite where ev_class = $1::regclass and rulename <> '_RETURN'`,
            [view],
          ),
          view,
        ).toBe(0);
      }
    });
    for (const quem of [usuario(DONO, 'aal2'), usuario(GESTOR), usuario(SEM_PERFIL)]) {
      await caso(db, quem, async (s) => {
        for (const view of VIEWS) {
          // Sem permissão (42501) ou view que não grava (55000): as duas travas barram, e o teste aceita a que vier primeiro.
          await s.erro(['42501', '55000'], `insert into ${view} (id) values (gen_random_uuid())`);
          await s.erro(['42501', '55000'], `update ${view} set id = id`);
          await s.erro(['42501', '55000'], `delete from ${view}`);
        }
      });
    }
  });

  it('a última execução da ação vem junto, com o updated_at dela (o "Tentar de novo" manda de volta)', async () => {
    await caso(db, usuario(DONO, 'aal2'), async (s) => {
      const [linha] = await s.linhas<{ execution_id: string; execution_updated_at: Date }>(
        `select execution_id::text, execution_updated_at from api.v_traffic_actions where id = $1`,
        [ACAO_APROVADA],
      );
      expect(linha?.execution_id).toBe(EXECUCAO_DA_ACAO);
      const de_novo = await s.linhas(`select status from api.retry_execution($1, $2)`, [
        linha?.execution_id,
        linha?.execution_updated_at,
      ]);
      expect(de_novo).toEqual([{ status: 'queued' }]);
      expect(
        await s.valor(`select execution_status from api.v_traffic_actions where id = $1`, [ACAO_APROVADA]),
      ).toBe('queued');
    });
  });
});

describe('o alerta de cada ação (mkt.action_alert), na ordem de metricas.md 4.6', () => {
  it('feita, descartada, pendência sem conta e pausa de campanha ativa: nenhum; orçamento em campanha pausada: espera ela voltar', async () => {
    await caso(db, postgres, async (s) => {
      await mesDeTeste(s);
      await s.como(usuario(GESTOR));
      expect(await alerta(s, ACAO_QUE_CRIOU)).toBeNull();
      expect(await alerta(s, ACAO_DESCARTADA)).toBeNull();
      expect(await alerta(s, PENDENCIA)).toBeNull();
      expect(await alerta(s, ACAO_APROVADA)).toBeNull();
      expect(await alerta(s, IDEIA_DO_CLAUDE)).toBe('waits_campaign_active');
    });
  });

  it('campanha encerrada, pausa de campanha já pausada, aumento sem limite vigente e aumento que passa do limite', async () => {
    await caso(db, postgres, async (s) => {
      await mesDeTeste(s);
      await s.exec(`update mkt.campaigns set status = 'active' where id = '${CAMPANHA_CLAUDE_CS}'`);
      await s.como(usuario(GESTOR));
      // Ativa: R$ 165,00 a mais no resto do mês sobre a projeção de R$ 1.800,00, com limite de R$ 3.000,00.
      expect(await alerta(s, IDEIA_DO_CLAUDE)).toBeNull();
      await s.como(postgres);
      await s.exec(`update mkt.spend_limits set monthly_limit_cents = 190000 where id = '${LIMITE_META_CS}'`);
      await s.como(usuario(GESTOR));
      expect(await alerta(s, IDEIA_DO_CLAUDE)).toBe('exceeds_month_limit');
      await s.como(postgres);
      await s.exec(`update mkt.spend_limits set valid_from_on = '2026-11-21' where id = '${LIMITE_META_CS}'`);
      await s.como(usuario(GESTOR));
      expect(await alerta(s, IDEIA_DO_CLAUDE)).toBe('no_spend_limit');
      // Sem base para a conta, a fila avisa como se passasse (a trava da execução falha fechada).
      await s.como(postgres);
      await s.exec(`
        update mkt.spend_limits set valid_from_on = '2026-11-01', monthly_limit_cents = 300000 where id = '${LIMITE_META_CS}';
        update mkt.ad_accounts set first_read_at = null;
      `);
      await s.como(usuario(GESTOR));
      expect(await alerta(s, IDEIA_DO_CLAUDE)).toBe('exceeds_month_limit');
      await s.como(postgres);
      await s.exec(`
        update mkt.campaigns set status = 'paused' where id = '${CAMPANHA_HUMANO_CS}';
        update mkt.campaigns set status = 'ended' where id = '${CAMPANHA_CLAUDE_CS}';
      `);
      await s.como(usuario(GESTOR));
      expect(await alerta(s, ACAO_APROVADA)).toBe('already_paused');
      expect(await alerta(s, IDEIA_DO_CLAUDE)).toBe('campaign_ended');
    });
  });

  it('a plataforma recusou: a ação falhou, com o código da execução', async () => {
    await caso(db, postgres, async (s) => {
      await mesDeTeste(s);
      await s.exec(`update mkt.campaigns set status = 'active' where id = '${CAMPANHA_CLAUDE_CS}'`);
      await s.como(usuario(DONO, 'aal2'));
      await s.linhas(
        `select id from api.approve_action($1, (select updated_at from mkt.traffic_actions where id = $1))`,
        [IDEIA_DO_CLAUDE],
      );
      await s.como(servico('mkt_executor'));
      const execucao = await s.valor<string>(
        `select id::text from mkt.platform_executions where traffic_action_id = $1 and status = 'queued'`,
        [IDEIA_DO_CLAUDE],
      );
      await s.valor(`select ingest.update_execution($1, 'sent')::text`, [execucao]);
      await s.valor(`select ingest.update_execution($1, 'failed', 400, 'BUDGET_TOO_LOW')::text`, [execucao]);
      await s.como(usuario(GESTOR));
      expect(
        await s.linhas(
          `select status, alert, execution_status, execution_error_code from api.v_traffic_actions where id = $1`,
          [IDEIA_DO_CLAUDE],
        ),
      ).toEqual([
        {
          status: 'failed',
          alert: 'platform_refused',
          execution_status: 'failed',
          execution_error_code: 'BUDGET_TOO_LOW',
        },
      ]);
    });
  });
});

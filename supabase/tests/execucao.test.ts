// Migração 10, a conta do limite e o executor: as fórmulas adiantadas de metricas.md (origem do lead, ritmo, alerta,
// base de cada fonte, mkt.v_account_month e o gasto a mais de uma ação ou execução), a conferência da execução
// (mkt.execution_allowed, na ordem de integracoes.md, seção 14), o executor (next_execution, update_execution,
// set_action_progress) e o Claude (record_claude_run, add_claude_proposal). Dados inventados de fixtures/usuarios.sql,
// marketing.sql, trafego.sql e conectores.sql; o relógio fica em 20/11/2026, meio-dia em São Paulo.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Sessao, abrirBanco, aplicarFixture, caso, postgres, servico, usuario } from './apoio/banco';
import { ACT_META_CS, abrirRodada, gravar, mesDeTeste } from './apoio/ingestao';
import {
  ACAO_QUE_CRIOU,
  CAMPANHA_CLAUDE_CS,
  CAMPANHA_HUMANO_CS,
  CAMPANHA_HUMANO_PL,
  CONTA_GOOGLE_PL,
  CONTA_META_CS,
} from './apoio/marketing';
import {
  ACAO_APROVADA,
  ACAO_DESCARTADA,
  CAMPANHA_DA_PARADA,
  EXECUCAO_DA_ACAO,
  EXECUCAO_DA_PARADA,
  EXECUCAO_DO_TETO,
  FUNCAO_DE_TESTE,
  IDEIA_DO_CLAUDE,
  LIMITE_META_CS,
  PARADA,
  RODADA_DO_CLAUDE,
  pelaFuncao,
} from './apoio/trafego';
import { DONO, EX_GESTOR, GESTOR } from './apoio/usuarios';

let db: PGlite;

beforeAll(async () => {
  db = await abrirBanco();
  for (const f of ['usuarios', 'marketing', 'trafego', 'conectores']) await aplicarFixture(db, f);
});

afterAll(async () => {
  await db.close();
});

const CONTA_DO_MES = `select ad_account_id::text as conta, month_on::text as mes, days_elapsed, days_in_month, spent_cents,
                             spend_limit_id::text as limite_id, monthly_limit_cents, active_campaigns,
                             active_claude_campaigns, active_daily_budget_cents, projection_cents,
                             expected_today_cents, usage::text, situation, alert
                        from mkt.v_account_month order by ad_account_id`;

describe('as fórmulas de metricas.md adiantadas para a ingestão e a execução', () => {
  it('o host de um endereço, o assistente de IA e a família da fonte de UTM (a lista mora numa função só)', async () => {
    await caso(db, usuario(GESTOR), async (s) => {
      const hosts: Array<[string | null, string | null]> = [
        ['https://www.google.com/search?q=x', 'google.com'],
        ['HTTP://usuario:senha@M.Facebook.com:8080/caminho', 'facebook.com'],
        ['l.instagram.com', 'instagram.com'],
        ['lm.facebook.com', 'facebook.com'],
        ['chatgpt.com', 'chatgpt.com'],
        ['   ', null],
        [null, null],
      ];
      for (const [endereco, host] of hosts) {
        expect(await s.valor('select mkt.url_host($1)', [endereco]), String(endereco)).toBe(host);
      }
      expect(
        await s.linhas(`select mkt.host_matches('news.google.com.br', '{google.}') as sufixo,
                               mkt.host_matches('a.claude.ai', '{claude.ai}') as subdominio,
                               mkt.host_matches('notclaude.ai', '{claude.ai}') as outro`),
      ).toEqual([{ sufixo: true, subdominio: true, outro: false }]);
      const assistentes: Array<[string, string | null, string | null]> = [
        ['https://chat.openai.com/c/1', null, 'chatgpt'],
        ['perplexity.ai', null, 'perplexity'],
        ['claude', null, 'claude'],
        ['gemini.google.com', null, 'gemini'],
        ['copilot.microsoft.com', null, 'copilot'],
        ['novo-assistente.ai', 'AI Assistant', 'other'],
        ['google', 'Organic Search', null],
      ];
      for (const [fonte, canal, ia] of assistentes) {
        expect(await s.valor('select mkt.ai_source_of($1, $2)', [fonte, canal]), fonte).toBe(ia);
      }
      const familias: Array<[string, string | null]> = [
        ['chatgpt.com', 'ai_assistant'],
        ['perplexity.ai', 'ai_assistant'],
        [' Facebook ', 'meta'],
        ['tt', 'tiktok'],
        ['youtube', 'search'],
        ['whatsapp', 'sdr'],
        ['site', 'site'],
        ['(direct)', 'direct'],
        ['parceiro-x', null],
        ['', null],
      ];
      for (const [fonte, familia] of familias) {
        expect(await s.valor('select mkt.utm_source_family($1)', [fonte]), fonte).toBe(familia);
        expect(await s.valor('select mkt.is_known_origin_text($1)', [fonte]), fonte).toBe(familia !== null);
      }
    });
  });

  it('o ritmo e o alerta do limite: limite 0 sem gasto já "passou" e o alerta diz "acima"; divisão por zero é nula', async () => {
    await caso(db, servico('mkt_executor'), async (s) => {
      const ritmo = `select projection_cents, expected_today_cents, usage::text, situation from mkt.pace($1, $2, 20, 30)`;
      expect(await s.linhas(ritmo, [120000, 300000])).toEqual([
        {
          projection_cents: 180000,
          expected_today_cents: 200000,
          usage: '0.40000000000000000000',
          situation: 'on_track',
        },
      ]);
      expect((await s.linhas(ritmo, [120000, 130000]))[0]?.situation).toBe('will_exceed');
      expect((await s.linhas(ritmo, [130000, 130000]))[0]?.situation).toBe('over_limit');
      expect(await s.linhas(ritmo, [0, 0])).toEqual([
        { projection_cents: 0, expected_today_cents: 0, usage: null, situation: 'over_limit' },
      ]);
      expect((await s.linhas(ritmo, [null, 1000]))[0]).toEqual({
        projection_cents: null,
        expected_today_cents: 667,
        usage: null,
        situation: null,
      });
      expect(
        await s.linhas(`select mkt.limit_alert(0, 0) as zero, mkt.limit_alert(89, 100) as abaixo,
                               mkt.limit_alert(90, 100) as perto, mkt.limit_alert(100, 100) as acima,
                               mkt.limit_alert(1, null) as sem_limite, mkt.ratio(1, 0) as por_zero`),
      ).toEqual([
        {
          zero: 'over_limit',
          abaixo: null,
          perto: 'near_limit',
          acima: 'over_limit',
          sem_limite: null,
          por_zero: null,
        },
      ]);
    });
  });

  it('a base de cada fonte: o conector já trouxe dado e a conta da marca nele já foi lida', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        await s.linhas(`select mkt.source_covered('meta') as meta, mkt.source_covered('google_ads') as google,
                               mkt.ads_covered(null, null) as algum, mkt.ads_covered((select id from mkt.brands where code = 'plumene'), null) as plumene,
                               mkt.ads_covered(null, 'meta') as canal_meta`),
      ).toEqual([{ meta: true, google: false, algum: true, plumene: false, canal_meta: true }]);
      await s.exec(`update mkt.ad_accounts set first_read_at = null where id = '${CONTA_META_CS}'`);
      expect(await s.valor(`select mkt.ads_covered(null, 'meta')`)).toBe(false);
    });
  });
});

describe('a conta do mês: mkt.v_account_month', () => {
  it('uma linha por conta ativa: o gasto do mês até hoje (de qualquer campanha), o limite vigente, a projeção e a situação', async () => {
    await caso(db, postgres, async (s) => {
      await mesDeTeste(s);
      expect(await s.linhas(CONTA_DO_MES)).toEqual([
        {
          conta: CONTA_META_CS,
          mes: '2026-11-01',
          days_elapsed: 20,
          days_in_month: 30,
          spent_cents: 120000,
          limite_id: LIMITE_META_CS,
          monthly_limit_cents: 300000,
          active_campaigns: 1,
          active_claude_campaigns: 0,
          active_daily_budget_cents: 5000,
          projection_cents: 180000,
          expected_today_cents: 200000,
          usage: '0.40000000000000000000',
          situation: 'on_track',
          alert: null,
        },
        {
          conta: CONTA_GOOGLE_PL,
          mes: '2026-11-01',
          days_elapsed: 20,
          days_in_month: 30,
          spent_cents: null,
          limite_id: null,
          monthly_limit_cents: null,
          active_campaigns: null,
          active_claude_campaigns: null,
          active_daily_budget_cents: null,
          projection_cents: null,
          expected_today_cents: null,
          usage: null,
          situation: null,
          alert: null,
        },
      ]);
      // Com base no Google, o gasto da conta dele aparece (sem limite, sem situação).
      await s.exec(
        `update mkt.connectors set first_success_at = now(), last_success_at = now() where code = 'google_ads'`,
      );
      expect((await s.linhas(CONTA_DO_MES))[1]).toMatchObject({
        spent_cents: 5000,
        active_campaigns: 1,
        situation: null,
      });
    });
  });

  it('a régua: vai passar, perto, passou; o limite novo vale do dia dele em diante; conta desligada sai', async () => {
    await caso(db, postgres, async (s) => {
      await mesDeTeste(s, 130000);
      expect((await s.linhas(CONTA_DO_MES))[0]).toMatchObject({
        situation: 'will_exceed',
        alert: 'near_limit',
      });
      await s.exec(`update mkt.spend_limits set monthly_limit_cents = 120000 where id = '${LIMITE_META_CS}'`);
      expect((await s.linhas(CONTA_DO_MES))[0]).toMatchObject({
        situation: 'over_limit',
        alert: 'over_limit',
      });
      // O limite de amanhã ainda não vale; o de ontem, sim.
      await s.exec(`
        insert into mkt.spend_limits (ad_account_id, brand_id, platform, monthly_limit_cents, valid_from_on, set_by)
        select id, brand_id, platform, 500000, '2026-11-21', '${DONO}' from mkt.ad_accounts where id = '${CONTA_META_CS}';
      `);
      expect((await s.linhas(CONTA_DO_MES))[0]).toMatchObject({ monthly_limit_cents: 120000 });
      await s.exec(
        `update mkt.spend_limits set valid_from_on = '2026-11-19' where valid_from_on = '2026-11-21'`,
      );
      expect((await s.linhas(CONTA_DO_MES))[0]).toMatchObject({
        monthly_limit_cents: 500000,
        situation: 'on_track',
      });
      // Limite 0 sem gasto: "Passou do limite", e o alerta da mesma linha diz "Acima do limite" (metricas.md, 9).
      await s.exec(`delete from mkt.ad_campaign_daily; update mkt.spend_limits set monthly_limit_cents = 0`);
      expect((await s.linhas(CONTA_DO_MES))[0]).toMatchObject({
        spent_cents: 0,
        situation: 'over_limit',
        alert: 'over_limit',
      });
      await s.exec(`update mkt.ad_accounts set is_active = false where id = '${CONTA_GOOGLE_PL}'`);
      expect((await s.linhas(CONTA_DO_MES)).map((l) => l.conta)).toEqual([CONTA_META_CS]);
    });
  });

  it('quem lê: a tela com a permissão (security_invoker), o worker (o contexto do Claude); o executor e o n8n, não', async () => {
    for (const quem of [usuario(DONO), usuario(GESTOR), servico('mkt_worker')]) {
      await caso(db, postgres, async (s) => {
        await mesDeTeste(s);
        await s.como(quem);
        expect(await s.valor(`select count(*)::int from mkt.v_account_month`)).toBe(2);
      });
    }
    await caso(db, usuario(EX_GESTOR, 'aal2'), async (s) => {
      expect(await s.valor(`select count(*)::int from mkt.v_account_month`)).toBe(0);
    });
    for (const papel of ['mkt_executor', 'n8n_notifier', 'mkt_setup'] as const) {
      await caso(db, servico(papel), async (s) => {
        await s.erro('42501', `select count(*) from mkt.v_account_month`);
      });
    }
  });
});

describe('o gasto a mais de uma ação ou execução e o limite do mês', () => {
  it('orçamento: só o que passa do atual × os dias que faltam (11, contando hoje); criar: o orçamento novo; pausar: 0', async () => {
    await caso(db, postgres, async (s) => {
      await mesDeTeste(s);
      const conta = `select mkt.action_extra_spend_cents($1) as extra, mkt.action_exceeds_limit($1) as passa`;
      expect(await s.linhas(conta, [IDEIA_DO_CLAUDE])).toEqual([{ extra: 16500, passa: false }]);
      expect(await s.linhas(conta, [ACAO_QUE_CRIOU])).toEqual([{ extra: 33000, passa: false }]);
      expect(await s.linhas(conta, [ACAO_APROVADA])).toEqual([{ extra: 0, passa: false }]);
      // Lance sem custo estimado: passa quando o uso do mês passa de 90%.
      expect(await s.linhas(conta, [ACAO_DESCARTADA])).toEqual([{ extra: null, passa: false }]);
      await s.exec(`update mkt.spend_limits set monthly_limit_cents = 130000 where id = '${LIMITE_META_CS}'`);
      expect(await s.linhas(conta, [ACAO_DESCARTADA])).toEqual([{ extra: null, passa: true }]);
      // Projeção 180.000 + 16.500 acima do limite: passa.
      await s.exec(`update mkt.spend_limits set monthly_limit_cents = 190000 where id = '${LIMITE_META_CS}'`);
      expect(await s.linhas(conta, [IDEIA_DO_CLAUDE])).toEqual([{ extra: 16500, passa: true }]);
      // Orçamento atual relido maior que o pedido: reduzir não passa de nada.
      await s.exec(`update mkt.campaigns set daily_budget_cents = 9000 where id = '${CAMPANHA_CLAUDE_CS}'`);
      expect(await s.linhas(conta, [IDEIA_DO_CLAUDE])).toEqual([{ extra: 0, passa: false }]);
      // Sem o atual, vale o anterior dos parâmetros.
      await s.exec(`update mkt.campaigns set daily_budget_cents = null where id = '${CAMPANHA_CLAUDE_CS}'`);
      expect(await s.linhas(conta, [IDEIA_DO_CLAUDE])).toEqual([{ extra: 16500, passa: true }]);
      // Sem base para a conta: nulo (a trava conta como passando).
      await s.exec(`update mkt.ad_accounts set first_read_at = null where id = '${CONTA_META_CS}'`);
      expect(await s.linhas(conta, [IDEIA_DO_CLAUDE])).toEqual([{ extra: 16500, passa: null }]);
    });
  });

  it('a execução: a da ação conta como a ação; reativar (desfazer a parada) conta o orçamento diário × dias que faltam', async () => {
    await caso(db, postgres, async (s) => {
      await mesDeTeste(s);
      await s.exec(`
        alter table mkt.platform_executions disable trigger platform_executions_guard;
        insert into mkt.platform_executions (id, brand_id, platform, ad_account_id, campaign_id, traffic_stop_campaign_id,
                                             operation, request, idempotency_key)
        select '00000000-0000-4000-8000-000000000361', c.brand_id, c.platform, c.ad_account_id, c.id,
               '${CAMPANHA_DA_PARADA}', 'activate', '{"status": "ACTIVE"}', 'exec-teste-0361'
          from mkt.campaigns c where c.id = '${CAMPANHA_CLAUDE_CS}';
        alter table mkt.platform_executions enable trigger platform_executions_guard;
      `);
      expect(
        await s.linhas(
          `select mkt.execution_extra_spend_cents('00000000-0000-4000-8000-000000000361') as reativar,
                               mkt.execution_extra_spend_cents($1) as pausa,
                               mkt.execution_extra_spend_cents($2) as teto`,
          [EXECUCAO_DA_ACAO, EXECUCAO_DO_TETO],
        ),
      ).toEqual([{ reativar: 33000, pausa: 0, teto: 0 }]);
    });
  });
});

describe('pode executar? mkt.execution_allowed, na ordem de integracoes.md (seção 14)', () => {
  const pode = (s: Sessao, execucao: string) =>
    s.linhas<{ is_allowed: boolean; blocked_reason: string | null }>(
      `select is_allowed, blocked_reason from mkt.execution_allowed($1)`,
      [execucao],
    );
  const motivo = async (s: Sessao, execucao: string) => (await pode(s, execucao))[0]?.blocked_reason ?? null;

  it('pausar passa (nunca é barrado pelo limite); a aprovação que não confere, o conector desligado, sem credencial e a campanha encerrada barram', async () => {
    await caso(db, postgres, async (s) => {
      await mesDeTeste(s);
      expect(await pode(s, EXECUCAO_DA_ACAO)).toEqual([{ is_allowed: true, blocked_reason: null }]);
      // Mesmo com a parada aberta e passando do limite: pausar reduz o gasto.
      await s.exec(`update mkt.spend_limits set monthly_limit_cents = 0`);
      expect(await motivo(s, EXECUCAO_DA_ACAO)).toBeNull();

      await s.exec(`update mkt.campaigns set status = 'ended' where id = '${CAMPANHA_HUMANO_CS}'`);
      expect(await motivo(s, EXECUCAO_DA_ACAO)).toBe('campaign_ended');
      await s.exec(`update private.connector_credentials set status = 'invalid' where purpose = 'write'`);
      expect(await motivo(s, EXECUCAO_DA_ACAO)).toBe('no_write_credential');
      await s.exec(`update mkt.connectors set setup_state = 'disabled' where code = 'meta'`);
      expect(await motivo(s, EXECUCAO_DA_ACAO)).toBe('connector_disabled');
      // Quem aprovou não pode mais aprovar: a aprovação não confere, e é o primeiro motivo.
      await s.exec(`delete from mkt.role_permissions where role = 'owner' and action = 'approve_action'`);
      expect(await motivo(s, EXECUCAO_DA_ACAO)).toBe('approval_invalid');
    });
  });

  it('o pedido diferente do aprovado não confere (o executor nunca manda o que não foi aprovado)', async () => {
    await caso(db, postgres, async (s) => {
      await mesDeTeste(s);
      await s.exec(`
        alter table mkt.platform_executions disable trigger platform_executions_guard;
        update mkt.platform_executions set request = '{"status": "ACTIVE"}' where id = '${EXECUCAO_DA_ACAO}';
        alter table mkt.platform_executions enable trigger platform_executions_guard;
      `);
      expect(await motivo(s, EXECUCAO_DA_ACAO)).toBe('approval_invalid');
    });
  });

  it('aumentar o gasto: parada aberta, conta sem limite, teto da Meta faltando ou acima da sobra, e passar do limite barram', async () => {
    await caso(db, postgres, async (s) => {
      await mesDeTeste(s);
      await s.como(usuario(DONO, 'aal2'));
      await s.linhas(
        `select id from api.approve_action($1, (select updated_at from mkt.traffic_actions where id = $1))`,
        [IDEIA_DO_CLAUDE],
      );
      const orcamento = await s.valor<string>(
        `select id::text from mkt.platform_executions where traffic_action_id = $1`,
        [IDEIA_DO_CLAUDE],
      );
      await s.como(postgres);
      expect(await motivo(s, orcamento)).toBe('stopped');

      await s.exec(
        `update mkt.traffic_stops set undone_by = '${DONO}', undone_at = now() where id = '${PARADA}'`,
      );
      // O teto da conta na Meta (R$ 15.000, R$ 2.500 gastos) sobra mais que o limite do mês (R$ 1.800).
      expect(await motivo(s, orcamento)).toBe('no_spend_limit');
      await s.exec(`update mkt.ad_accounts set spend_cap_cents = null where id = '${CONTA_META_CS}'`);
      expect(await motivo(s, orcamento)).toBe('no_spend_limit');
      await s.exec(
        `update mkt.ad_accounts set spend_cap_cents = 200000, amount_spent_cents = 100000 where id = '${CONTA_META_CS}'`,
      );
      expect(await pode(s, orcamento)).toEqual([{ is_allowed: true, blocked_reason: null }]);

      // Limite de R$ 1.900: a sobra do mês é R$ 700; com o teto da conta sobrando R$ 500, quem barra é o limite.
      await s.exec(`
        update mkt.spend_limits set monthly_limit_cents = 190000 where id = '${LIMITE_META_CS}';
        update mkt.ad_accounts set spend_cap_cents = 150000 where id = '${CONTA_META_CS}';
      `);
      expect(await motivo(s, orcamento)).toBe('over_spend_limit');
      await s.exec(`update mkt.spend_limits set monthly_limit_cents = 300000, valid_from_on = '2026-11-25'`);
      expect(await motivo(s, orcamento)).toBe('no_spend_limit');
      // Sem base para a conta, a trava falha fechada.
      await s.exec(`
        update mkt.spend_limits set valid_from_on = '2026-11-01';
        update mkt.ad_accounts set first_read_at = null where id = '${CONTA_META_CS}';
      `);
      expect(await motivo(s, orcamento)).toBe('over_spend_limit');
    });
  });

  it('a parada: a pausa vale com a parada aberta; desfeita, não. O teto da conta: o limite vigente, nunca acima dele', async () => {
    await caso(db, postgres, async (s) => {
      await mesDeTeste(s, 1500000);
      expect(await pode(s, EXECUCAO_DA_PARADA)).toEqual([{ is_allowed: true, blocked_reason: null }]);
      expect(await pode(s, EXECUCAO_DO_TETO)).toEqual([{ is_allowed: true, blocked_reason: null }]);
      // O teto pedido (R$ 15.000) acima do limite: não confere.
      await s.exec(`update mkt.spend_limits set monthly_limit_cents = 300000 where id = '${LIMITE_META_CS}'`);
      expect(await motivo(s, EXECUCAO_DO_TETO)).toBe('approval_invalid');
      await s.exec(
        `update mkt.spend_limits set monthly_limit_cents = 1500000 where id = '${LIMITE_META_CS}'`,
      );
      // Um limite novo vigente: o teto do anterior não vale mais.
      await s.exec(`
        insert into mkt.spend_limits (ad_account_id, brand_id, platform, monthly_limit_cents, valid_from_on, set_by)
        select id, brand_id, platform, 1500000, '2026-11-10', '${DONO}' from mkt.ad_accounts where id = '${CONTA_META_CS}';
      `);
      expect(await motivo(s, EXECUCAO_DO_TETO)).toBe('approval_invalid');
      await s.exec(
        `update mkt.traffic_stops set undone_by = '${DONO}', undone_at = now() where id = '${PARADA}'`,
      );
      expect(await motivo(s, EXECUCAO_DA_PARADA)).toBe('approval_invalid');
    });
  });

  it('ninguém além das funções do dono chama a conferência (ela lê o estado das credenciais e os perfis)', async () => {
    for (const quem of [
      usuario(DONO, 'aal2'),
      servico('mkt_worker'),
      servico('mkt_executor'),
      servico('n8n_notifier'),
    ]) {
      await caso(db, quem, async (s) => {
        await s.erro('42501', `select * from mkt.execution_allowed($1)`, [EXECUCAO_DA_ACAO]);
      });
    }
  });
});

describe('o executor: next_execution, update_execution e set_action_progress', () => {
  /** O dono propõe e aprova uma pausa da campanha (a tela de canal); devolve a ação e a execução na fila. */
  async function pausaAprovada(s: Sessao, campanha: string): Promise<{ acao: string; execucao: string }> {
    await s.como(usuario(DONO, 'aal2'));
    const acao = await s.valor<string>(
      `select id::text from api.propose_action('cs', 'meta', $1, 'pause', 'Pausar a campanha de teste',
                'Pausa pedida no teste do executor.', '{"status": "paused"}', 'low', 'low', 0, true)`,
      [campanha],
    );
    const execucao = await s.valor<string>(
      `select id::text from mkt.platform_executions where traffic_action_id = $1`,
      [acao],
    );
    return { acao, execucao };
  }

  it('a próxima: as do "Parar tudo" na frente, a que não pode fica bloqueada com o motivo e a busca segue; sem nenhuma, nada', async () => {
    await caso(db, postgres, async (s) => {
      await mesDeTeste(s);
      const pausa = await pausaAprovada(s, CAMPANHA_HUMANO_CS);
      // Uma campanha nova do Claude, ativa, e o "Parar tudo" dela.
      await s.como(postgres);
      await s.exec(`
        insert into mkt.campaigns (id, ad_account_id, brand_id, platform, source, external_id, name, status,
                                   daily_budget_cents, managed_by, created_by_action_id)
        select '00000000-0000-4000-8000-000000000214', a.id, a.brand_id, a.platform, a.source, '120200000000000003',
               'cs-claude-ativa', 'active', 2000, 'claude', '${ACAO_QUE_CRIOU}'
          from mkt.ad_accounts a where a.id = '${CONTA_META_CS}';
      `);
      await s.como(usuario(DONO, 'aal2'));
      await s.valor(`select api.stop_all('cs', 1)::text`);
      // Depois da parada, o dono aprova um aumento de orçamento; ele fica na fila, o mais antigo de todos.
      await s.linhas(
        `select id from api.approve_action($1, (select updated_at from mkt.traffic_actions where id = $1))`,
        [IDEIA_DO_CLAUDE],
      );
      await s.como(postgres);
      await s.exec(`
        alter table mkt.platform_executions disable trigger platform_executions_guard;
        update mkt.platform_executions set queued_at = now() - interval '1 minute' where traffic_action_id = '${IDEIA_DO_CLAUDE}';
        alter table mkt.platform_executions enable trigger platform_executions_guard;
      `);
      await s.como(usuario(DONO, 'aal2'));
      const parada = await s.valor<string>(
        `select e.id::text from mkt.platform_executions e
          where e.traffic_stop_campaign_id is not null and e.status = 'queued' and e.campaign_id = '00000000-0000-4000-8000-000000000214'`,
      );

      await s.como(servico('mkt_executor'));
      expect(await s.linhas(`select id::text, status from ingest.next_execution()`)).toEqual([
        { id: parada, status: 'queued' },
      ]);
      await s.valor(`select ingest.update_execution($1, 'confirmed', 200)::text`, [parada]);
      // O aumento de orçamento (bloqueado pelo "Parar tudo") fica bloqueado, e a busca segue para a pausa.
      expect(await s.linhas(`select id::text from ingest.next_execution()`)).toEqual([
        { id: pausa.execucao },
      ]);
      expect(
        await s.linhas(
          `select status, blocked_reason from mkt.platform_executions where traffic_action_id = $1`,
          [IDEIA_DO_CLAUDE],
        ),
      ).toEqual([{ status: 'blocked', blocked_reason: 'stopped' }]);
      await s.valor(`select ingest.update_execution($1, 'confirmed')::text`, [pausa.execucao]);
      expect(await s.linhas(`select id from ingest.next_execution()`)).toEqual([]);
    });
  });

  it('uma por campanha: com uma execução enviada na campanha, a seguinte espera; a enviada sem resposta há 2 min volta primeiro', async () => {
    await caso(db, postgres, async (s) => {
      await mesDeTeste(s);
      const primeira = await pausaAprovada(s, CAMPANHA_HUMANO_CS);
      await s.como(servico('mkt_executor'));
      await s.valor(`select ingest.update_execution($1, 'sent')::text`, [primeira.execucao]);
      const segunda = await pausaAprovada(s, CAMPANHA_HUMANO_CS);
      await s.como(servico('mkt_executor'));
      expect(await s.linhas(`select id from ingest.next_execution()`)).toEqual([]);
      // O executor caiu no meio: a enviada há mais de 2 minutos é relida antes.
      await s.como(postgres);
      await s.exec(`
        alter table mkt.platform_executions disable trigger platform_executions_guard;
        update mkt.platform_executions set sent_at = now() - interval '3 minutes' where id = '${primeira.execucao}';
        alter table mkt.platform_executions enable trigger platform_executions_guard;
      `);
      await s.como(servico('mkt_executor'));
      expect(await s.linhas(`select id::text, status from ingest.next_execution()`)).toEqual([
        { id: primeira.execucao, status: 'sent' },
      ]);
      await s.valor(
        `select ingest.update_execution($1, 'confirmed', 200, null, null, '{"status": "PAUSED"}', null,
                                                    '{"status": "paused"}')::text`,
        [primeira.execucao],
      );
      expect(await s.linhas(`select id::text from ingest.next_execution()`)).toEqual([
        { id: segunda.execucao },
      ]);
    });
  });

  it('o andamento: enviada → a ação em execução; confirmada → feita pela plataforma e a campanha relida; até 5 tentativas', async () => {
    await caso(db, postgres, async (s) => {
      await mesDeTeste(s);
      const { acao, execucao } = await pausaAprovada(s, CAMPANHA_HUMANO_CS);
      await s.como(servico('mkt_executor'));
      expect(
        (await s.erro('PT422', `select ingest.update_execution($1, 'failed', 400, 'X')`, [execucao])).detail,
      ).toBe('status');
      expect(
        (await s.erro('PT422', `select ingest.update_execution($1, 'blocked')`, [execucao])).detail,
      ).toBe('blocked_reason');
      expect(
        (
          await s.erro(
            'PT422',
            `select ingest.update_execution($1, 'sent', null, null, null, null, null, '{}')`,
            [execucao],
          )
        ).detail,
      ).toBe('campaign');
      for (let i = 1; i <= 5; i += 1) {
        expect(await s.valor(`select (ingest.update_execution($1, 'sent')).attempts`, [execucao])).toBe(i);
      }
      expect((await s.erro('PT422', `select ingest.update_execution($1, 'sent')`, [execucao])).detail).toBe(
        'attempts',
      );
      expect(await s.valor(`select status from mkt.traffic_actions where id = $1`, [acao])).toBe('running');
      expect(
        (
          await s.erro(
            'PT422',
            `select ingest.update_execution($1, 'confirmed', null, null, null, null, null,
                                                               '{"status": "paused", "nome": "x"}')`,
            [execucao],
          )
        ).detail,
      ).toBe('campaign');
      await s.valor(
        `select ingest.update_execution($1, 'confirmed', 200, null, null, '{"status": "PAUSED"}', null,
                                                    '{"status": "paused"}')::text`,
        [execucao],
      );
      expect(
        await s.linhas(
          `select a.status, a.done_via, a.done_by, a.executed_at is not null as feita, c.status as campanha,
                  e.confirmed_at is not null as confirmada, e.response
             from mkt.traffic_actions a join mkt.campaigns c on c.id = a.campaign_id
             join mkt.platform_executions e on e.traffic_action_id = a.id where a.id = $1`,
          [acao],
        ),
      ).toEqual([
        {
          status: 'done',
          done_via: 'platform_api',
          done_by: null,
          feita: true,
          campanha: 'paused',
          confirmada: true,
          response: { status: 'PAUSED' },
        },
      ]);
      // Terminada, nada muda.
      expect((await s.erro('PT422', `select ingest.update_execution($1, 'sent')`, [execucao])).detail).toBe(
        'status',
      );
      // O diário: a ação e cada passagem da execução, pelo sistema.
      await s.como(postgres);
      expect(
        await s.linhas(
          `select event, actor_kind from mkt.traffic_log where traffic_action_id = $1 order by seq`,
          [acao],
        ),
      ).toEqual([
        { event: 'action_proposed', actor_kind: 'user' },
        { event: 'action_approved', actor_kind: 'user' },
        { event: 'execution_status_changed', actor_kind: 'user' },
        // Só a primeira das cinco tentativas muda o status (queued → sent); sent → sent não vai para o diário.
        { event: 'execution_status_changed', actor_kind: 'system' },
        { event: 'action_running', actor_kind: 'system' },
        { event: 'execution_status_changed', actor_kind: 'system' },
        { event: 'action_done', actor_kind: 'system' },
      ]);
    });
  });

  it('falhou: a ação volta para a fila com o código; a mensagem com cara de dado pessoal não é gravada', async () => {
    await caso(db, postgres, async (s) => {
      await mesDeTeste(s);
      const { execucao } = await pausaAprovada(s, CAMPANHA_HUMANO_CS);
      await s.como(servico('mkt_executor'));
      await s.valor(`select ingest.update_execution($1, 'sent')::text`, [execucao]);
      expect(
        (await s.erro('PT422', `select ingest.update_execution($1, 'failed', 400)`, [execucao])).detail,
      ).toBe('error_code');
      await s.valor(
        `select ingest.update_execution($1, 'failed', 400, 'INVALID_PARAMETER', 'Recusado: fale com fulano@exemplo.com')::text`,
        [execucao],
      );
      expect(
        await s.linhas(
          `select e.status, e.http_status, e.error_code, e.error_message, a.status as acao
             from mkt.platform_executions e join mkt.traffic_actions a on a.id = e.traffic_action_id where e.id = $1`,
          [execucao],
        ),
      ).toEqual([
        {
          status: 'failed',
          http_status: 400,
          error_code: 'INVALID_PARAMETER',
          error_message: null,
          acao: 'failed',
        },
      ]);
    });
  });

  it('criar campanha: confirmada, a campanha nasce do Claude, com a ação que a criou, na mesma transação', async () => {
    await caso(db, postgres, async (s) => {
      await mesDeTeste(s);
      await s.exec(
        `update mkt.traffic_stops set undone_by = '${DONO}', undone_at = now() where id = '${PARADA}'`,
      );
      await s.como(usuario(DONO, 'aal2'));
      const acao = await s.valor<string>(
        `select id::text from api.propose_action('cs', 'meta', null, 'create', 'Criar campanha de lançamento',
                  'Lançamento da coleção nova para lojistas.',
                  '{"objective": "OUTCOME_SALES", "daily_budget_cents": 3000, "name": "cs-lancamento", "special_ad_categories": []}',
                  'medium', 'low', 90000, true)`,
      );
      await s.como(servico('mkt_executor'));
      const execucao = await s.valor<string>(
        `select id::text from mkt.platform_executions where traffic_action_id = $1`,
        [acao],
      );
      expect(
        (
          await s.erro(
            'PT422',
            `select ingest.update_execution($1, 'confirmed', 200, null, null, null, null, '{"status": "paused"}')`,
            [execucao],
          )
        ).detail,
      ).toBe('campaign');
      await s.valor(
        `select ingest.update_execution($1, 'confirmed', 200, null, null, '{"id": "120200000000000301"}', null,
                                        '{"external_id": "120200000000000301", "status": "paused", "daily_budget_cents": 3000}')::text`,
        [execucao],
      );
      expect(
        await s.linhas(
          `select c.name, c.status, c.managed_by, c.created_by_action_id::text as acao, c.daily_budget_cents, c.source
             from mkt.campaigns c where c.external_id = '120200000000000301'`,
        ),
      ).toEqual([
        {
          name: expect.stringMatching(/^cs-lancamento-act-\d{4}$/),
          status: 'paused',
          managed_by: 'claude',
          acao,
          daily_budget_cents: 3000,
          source: 'meta_ads',
        },
      ]);
      expect(await s.valor(`select status from mkt.traffic_actions where id = $1`, [acao])).toBe('done');
    });
  });

  it('set_action_progress: aprovada → em execução → feita; o mesmo status não muda nada; fora do quadro, PT422', async () => {
    await caso(db, postgres, async (s) => {
      await mesDeTeste(s);
      const { acao } = await pausaAprovada(s, CAMPANHA_HUMANO_CS);
      await s.como(servico('mkt_executor'));
      expect(await s.valor(`select (ingest.set_action_progress($1, 'running')).status`, [acao])).toBe(
        'running',
      );
      expect(await s.valor(`select (ingest.set_action_progress($1, 'running')).status`, [acao])).toBe(
        'running',
      );
      expect(
        (await s.erro('PT422', `select ingest.set_action_progress($1, 'approved')`, [acao])).detail,
      ).toBe('status');
      expect(await s.valor(`select (ingest.set_action_progress($1, 'done')).done_via`, [acao])).toBe(
        'platform_api',
      );
      expect((await s.erro('PT422', `select ingest.set_action_progress($1, 'failed')`, [acao])).message).toBe(
        'TRF-422',
      );
      expect(
        (await s.erro('PT422', `select ingest.set_action_progress($1, 'running')`, [IDEIA_DO_CLAUDE]))
          .message,
      ).toBe('TRF-422');
      expect(
        (
          await s.erro(
            'PT404',
            `select ingest.set_action_progress('00000000-0000-0000-0000-000000000000', 'running')`,
          )
        ).message,
      ).toBe('TRF-404');
    });
  });

  it('só a conexão do executor: o dono do banco recebe TRF-403; o worker (mesmo com o token do dono), a tela e os outros, nem alcançam', async () => {
    await caso(db, postgres, async (s) => {
      expect((await s.erro('PT403', `select * from ingest.next_execution()`)).message).toBe('TRF-403');
      expect(
        (await s.erro('PT403', `select ingest.set_action_progress($1, 'running')`, [ACAO_APROVADA])).message,
      ).toBe('TRF-403');
    });
    const token = { sub: DONO, role: 'authenticated', aal: 'aal2' };
    for (const quem of [
      servico('mkt_worker', token),
      usuario(DONO, 'aal2'),
      servico('mkt_setup'),
      servico('n8n_notifier'),
    ]) {
      await caso(db, quem, async (s) => {
        await s.erro('42501', `select * from ingest.next_execution()`);
        await s.erro('42501', `select ingest.update_execution($1, 'sent')`, [EXECUCAO_DA_ACAO]);
        await s.erro('42501', `select ingest.set_action_progress($1, 'running')`, [ACAO_APROVADA]);
      });
    }
  });
});

describe('a campanha criada pela central que a leitura do worker importou antes da confirmação', () => {
  interface Troca {
    from_operator: string | null;
    to_operator: string;
    reason: string;
    actor_kind: string;
    changed_by: string | null;
  }
  const IMPORTADA: Troca = {
    from_operator: null,
    to_operator: 'human',
    reason: 'imported',
    actor_kind: 'system',
    changed_by: null,
  };
  const CRIADA_PELO_CLAUDE: Troca = {
    from_operator: 'human',
    to_operator: 'claude',
    reason: 'created_by_claude',
    actor_kind: 'claude',
    changed_by: null,
  };

  /** O dono propõe e aprova a criação de uma campanha na conta Meta da cs: a ação, o código e a execução na fila. */
  async function criacaoAprovada(s: Sessao): Promise<{ acao: string; codigo: string; execucao: string }> {
    await s.como(usuario(DONO, 'aal2'));
    const [criada] = await s.linhas<{ id: string; code: string }>(
      `select id::text, code from api.propose_action('cs', 'meta', null, 'create', 'Criar campanha de lançamento',
                'Lançamento da coleção nova para lojistas.',
                '{"objective": "OUTCOME_SALES", "daily_budget_cents": 3000, "name": "cs-lancamento", "special_ad_categories": []}',
                'medium', 'low', 90000, true)`,
    );
    if (!criada) throw new Error('a ação de criar não nasceu');
    const execucao = await s.valor<string>(
      `select id::text from mkt.platform_executions where traffic_action_id = $1 and status = 'queued'`,
      [criada.id],
    );
    return { acao: criada.id, codigo: criada.code.toLowerCase(), execucao };
  }

  /** A leitura de hora em hora da Meta importa campanhas pausadas da conta da cs; nenhuma recusada. */
  async function importar(s: Sessao, campanhas: Array<[string, string]>): Promise<void> {
    const rodada = await abrirRodada(s, 'meta', 'ads_hourly');
    const linhas = campanhas.map(([externo, nome]) => ({
      key: { external_id: externo },
      values: { account_external_id: ACT_META_CS, name: nome, status: 'paused' },
    }));
    expect(await gravar(s, 'upsert_campaigns', rodada, linhas)).toEqual([]);
  }

  /** O executor confirma a execução com a campanha relida (o id dela na plataforma). */
  async function confirmar(s: Sessao, execucao: string, externo: string): Promise<void> {
    await s.como(servico('mkt_executor'));
    await s.valor(
      `select ingest.update_execution($1, 'confirmed', 200, null, null, null, null, $2::jsonb)::text`,
      [execucao, JSON.stringify({ external_id: externo, status: 'paused' })],
    );
  }

  /** O operador, a ação que criou e o histórico de operador da campanha, pelo id na plataforma. */
  async function operador(
    s: Sessao,
    externo: string,
  ): Promise<{ managed_by: string; acao: string | null; historico: Troca[] }> {
    await s.como(postgres);
    const [c] = await s.linhas<{ id: string; managed_by: string; acao: string | null }>(
      `select id::text, managed_by, created_by_action_id::text as acao from mkt.campaigns where external_id = $1`,
      [externo],
    );
    if (!c) throw new Error(`campanha ${externo} não achada`);
    const historico = await s.linhas<Troca>(
      `select from_operator, to_operator, reason, actor_kind, changed_by::text from mkt.campaign_managed_by_history
        where campaign_id = $1 order by changed_at, from_operator nulls first`,
      [c.id],
    );
    return { managed_by: c.managed_by, acao: c.acao, historico };
  }

  it('a criação só confirma com a campanha relida: sem ela, PT422 e nada muda', async () => {
    await caso(db, postgres, async (s) => {
      const { execucao } = await criacaoAprovada(s);
      await s.como(servico('mkt_executor'));
      expect(
        (await s.erro('PT422', `select ingest.update_execution($1, 'confirmed', 200)`, [execucao])).detail,
      ).toBe('campaign');
      expect(
        await s.linhas(
          `select e.status, a.status as acao from mkt.platform_executions e
             join mkt.traffic_actions a on a.id = e.traffic_action_id where e.id = $1`,
          [execucao],
        ),
      ).toEqual([{ status: 'queued', acao: 'approved' }]);
    });
  });

  it('a execução ainda na fila (o executor mandou e caiu antes de gravar "enviada"): importada do humano, a confirmação a passa para o Claude, com a ação', async () => {
    await caso(db, postgres, async (s) => {
      const { acao, codigo, execucao } = await criacaoAprovada(s);
      await importar(s, [['120200000000000311', `cs-lancamento-${codigo}`]]);
      expect(await operador(s, '120200000000000311')).toEqual({
        managed_by: 'human',
        acao: null,
        historico: [IMPORTADA],
      });
      // De volta, o executor relê, acha a campanha pelo nome e confirma sem mandar de novo.
      await confirmar(s, execucao, '120200000000000311');
      expect(await operador(s, '120200000000000311')).toEqual({
        managed_by: 'claude',
        acao,
        historico: [IMPORTADA, CRIADA_PELO_CLAUDE],
      });
      expect(await s.valor(`select status from mkt.traffic_actions where id = $1`, [acao])).toBe('done');
      // Releituras seguintes não mudam o operador nem o histórico.
      await importar(s, [['120200000000000311', `cs-lancamento-${codigo}`]]);
      expect((await operador(s, '120200000000000311')).historico).toHaveLength(2);
    });
  });

  it('a ação que falhou e foi aprovada de novo (decisão 0038): importada do humano no meio, a nova confirmação a passa para o Claude', async () => {
    await caso(db, postgres, async (s) => {
      const { acao, codigo, execucao } = await criacaoAprovada(s);
      // A plataforma criou, a resposta não chegou e a nova tentativa foi recusada (4xx): a ação falhou.
      await s.como(servico('mkt_executor'));
      await s.valor(`select ingest.update_execution($1, 'sent')::text`, [execucao]);
      await s.valor(`select ingest.update_execution($1, 'failed', 400, 'DUPLICATE_NAME')::text`, [execucao]);
      await importar(s, [['120200000000000312', `cs-lancamento-${codigo}`]]);
      await s.como(usuario(DONO, 'aal2'));
      await s.linhas(
        `select id from api.approve_action($1, (select updated_at from mkt.traffic_actions where id = $1))`,
        [acao],
      );
      await s.como(postgres);
      const nova = await s.valor<string>(
        `select id::text from mkt.platform_executions where traffic_action_id = $1 and status = 'queued'`,
        [acao],
      );
      await confirmar(s, nova, '120200000000000312');
      expect(await operador(s, '120200000000000312')).toEqual({
        managed_by: 'claude',
        acao,
        historico: [IMPORTADA, CRIADA_PELO_CLAUDE],
      });
    });
  });

  it('não vira do Claude a campanha do humano com nome parecido, nem a que uma pessoa já passou de um operador para outro', async () => {
    await caso(db, postgres, async (s) => {
      const primeira = await criacaoAprovada(s);
      await importar(s, [
        ['120200000000000313', `cs-lancamento-${primeira.codigo}0`],
        ['120200000000000314', `cs-lancamento-${primeira.codigo}-copia`],
      ]);
      // A confirmação aponta, por engano, para a do humano: a ação fica feita, e a campanha continua dele.
      await confirmar(s, primeira.execucao, '120200000000000313');
      for (const externo of ['120200000000000313', '120200000000000314']) {
        expect(await operador(s, externo), externo).toEqual({
          managed_by: 'human',
          acao: null,
          historico: [IMPORTADA],
        });
      }

      // O nome certo, mas o dono passou a campanha para o Claude e de volta para o humano antes da confirmação: a
      // escolha dele fica.
      const segunda = await criacaoAprovada(s);
      await importar(s, [['120200000000000315', `cs-lancamento-${segunda.codigo}`]]);
      const id = await s.valor<string>(
        `select id::text from mkt.campaigns where external_id = '120200000000000315'`,
      );
      for (const [para, motivo] of [
        ['claude', 'handover_to_claude'],
        ['human', 'back_to_human'],
      ]) {
        await s.como(usuario(DONO, 'aal2'));
        await s.linhas(
          `select id from api.change_campaign_operator($1, $2, $3, null,
                                                       (select updated_at from mkt.campaigns where id = $1))`,
          [id, para, motivo],
        );
      }
      await confirmar(s, segunda.execucao, '120200000000000315');
      const depois = await operador(s, '120200000000000315');
      expect(depois.managed_by).toBe('human');
      expect(depois.acao).toBeNull();
      // As trocas são da mesma transação (o mesmo changed_at): confere sem depender da ordem.
      expect(depois.historico.map((h) => h.reason).sort()).toEqual([
        'back_to_human',
        'handover_to_claude',
        'imported',
      ]);
    });
  });

  it('não vira do Claude a campanha antiga do humano renomeada para o nome da criação: importada antes de a ação mandar criar, continua dele', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(FUNCAO_DE_TESTE);
      // A campanha do humano da fixture (ativa, com gasto) entrou aqui há 90 dias.
      await s.exec(
        `update mkt.campaigns set created_at = now() - interval '90 days' where id = '${CAMPANHA_HUMANO_CS}'`,
      );
      const { acao, codigo, execucao } = await criacaoAprovada(s);
      // Quem tem acesso à plataforma dá à campanha antiga o nome pedido; a leitura grava o nome novo.
      await importar(s, [['120200000000000001', `cs-lancamento-${codigo}`]]);
      // O executor acha a campanha pelo nome e confirma sem mandar: a ação fica feita, e a campanha continua do humano.
      await confirmar(s, execucao, '120200000000000001');
      expect(await operador(s, '120200000000000001')).toEqual({
        managed_by: 'human',
        acao: null,
        historico: [IMPORTADA],
      });
      // Nem o update direto do executor, na transação que confirmou, passa: o gatilho confere a mesma data.
      await s.como(servico('mkt_executor'));
      const [sql, params] = pelaFuncao(
        `update mkt.campaigns set managed_by = 'claude', created_by_action_id = '${acao}'
          where external_id = '120200000000000001'`,
      );
      expect((await s.erro('PT403', sql, params)).message).toBe('TRF-403');
    });
  });

  it('depois de a ação ter a campanha dela, a campanha nova com o código da ação no fim do nome nasce do humano (decisão 0008)', async () => {
    await caso(db, postgres, async (s) => {
      const { acao, codigo, execucao } = await criacaoAprovada(s);
      await s.como(servico('mkt_executor'));
      await s.valor(`select ingest.update_execution($1, 'sent')::text`, [execucao]);
      await confirmar(s, execucao, '120200000000000321');
      // Depois, a leitura relê a da central e acha duas novas, feitas na plataforma com o código no fim do nome.
      await importar(s, [
        ['120200000000000321', `cs-lancamento-${codigo}`],
        ['120200000000000322', `cs-promo-do-gestor-${codigo}`],
        ['120200000000000323', `CS-OUTRA-${codigo.toUpperCase()}`],
      ]);
      expect(await operador(s, '120200000000000321')).toEqual({
        managed_by: 'claude',
        acao,
        historico: [{ ...CRIADA_PELO_CLAUDE, from_operator: null }],
      });
      for (const externo of ['120200000000000322', '120200000000000323']) {
        expect(await operador(s, externo), externo).toEqual({
          managed_by: 'human',
          acao: null,
          historico: [IMPORTADA],
        });
      }
    });
  });

  it('a criação confirmada com o id de uma campanha de outra conta (até de outra marca): PT422, e nada muda', async () => {
    await caso(db, postgres, async (s) => {
      const { acao, codigo, execucao } = await criacaoAprovada(s);
      // Uma conta Meta da Plumene com uma campanha ativa do humano, com o código da ação no fim do nome.
      await s.como(postgres);
      await s.exec(`
        insert into mkt.ad_accounts (id, brand_id, platform, source, external_id, name)
        select '00000000-0000-4000-8000-0000000009a1', b.id, 'meta', 'meta_ads', 'act_900000000000077',
               'Conta Meta da Plumene'
          from mkt.brands b where b.code = 'plumene';
        insert into mkt.campaigns (ad_account_id, brand_id, platform, source, external_id, name, status,
                                   daily_budget_cents)
        select a.id, a.brand_id, a.platform, a.source, '120200000000077001', 'pl-lancamento-${codigo}', 'active', 8000
          from mkt.ad_accounts a where a.id = '00000000-0000-4000-8000-0000000009a1';
      `);
      await s.como(servico('mkt_executor'));
      await s.valor(`select ingest.update_execution($1, 'sent')::text`, [execucao]);
      const recusa = await s.erro(
        'PT422',
        `select ingest.update_execution($1, 'confirmed', 200, null, null, null, null, $2::jsonb)`,
        [
          execucao,
          JSON.stringify({ external_id: '120200000000077001', status: 'paused', daily_budget_cents: 3000 }),
        ],
      );
      expect([recusa.message, recusa.detail]).toEqual(['TRF-422', 'campaign']);
      await s.como(postgres);
      expect(
        await s.linhas(
          `select status, daily_budget_cents, managed_by, created_by_action_id from mkt.campaigns
            where external_id = '120200000000077001'`,
        ),
      ).toEqual([
        { status: 'active', daily_budget_cents: 8000, managed_by: 'human', created_by_action_id: null },
      ]);
      expect(
        await s.linhas(
          `select e.status, a.status as acao from mkt.platform_executions e
             join mkt.traffic_actions a on a.id = e.traffic_action_id where e.id = $1`,
          [execucao],
        ),
      ).toEqual([{ status: 'sent', acao: 'running' }]);
      expect(
        await s.valor(`select count(*)::int from mkt.campaigns where created_by_action_id = $1`, [acao]),
      ).toBe(0);
    });
  });

  it('o gatilho do operador: a exceção do executor é só essa (do humano para o Claude, com a ação create da mesma conta que a transação confirmou, sem mudar a conta nem o nome, o código no fim do nome e sem troca por pessoa)', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(FUNCAO_DE_TESTE);
      const { acao, codigo, execucao } = await criacaoAprovada(s);
      await importar(s, [
        ['120200000000000316', `cs-lancamento-${codigo}`],
        ['120200000000000317', `cs-lancamento-${codigo}0`],
        ['120200000000000319', `cs-lancamento-${codigo}`],
        ['120200000000000320', 'cs-campanha-do-humano'],
      ]);
      // Uma campanha do humano noutra conta (a Google da Plumene), com o código da ação no fim do nome.
      await s.como(postgres);
      await s.exec(`
        insert into mkt.campaigns (ad_account_id, brand_id, platform, source, external_id, name, status)
        select a.id, a.brand_id, a.platform, a.source, '7000000330', 'pl-busca-${codigo}', 'active'
          from mkt.ad_accounts a where a.id = '${CONTA_GOOGLE_PL}'
      `);
      // A 319, com o nome certo, o dono passou para o Claude e de volta para o humano.
      const trocada = await s.valor<string>(
        `select id::text from mkt.campaigns where external_id = '120200000000000319'`,
      );
      for (const [para, motivo] of [
        ['claude', 'handover_to_claude'],
        ['human', 'back_to_human'],
      ]) {
        await s.como(usuario(DONO, 'aal2'));
        await s.linhas(
          `select id from api.change_campaign_operator($1, $2, $3, null,
                                                       (select updated_at from mkt.campaigns where id = $1))`,
          [trocada, para, motivo],
        );
      }
      // Confirmada com outra campanha (a criada, que já nasce do Claude): as importadas continuam do humano.
      await confirmar(s, execucao, '120200000000000318');
      const passar = (externo: string, acaoQueCriou: string | null, para = 'claude') =>
        pelaFuncao(
          `update mkt.campaigns set managed_by = '${para}', created_by_action_id = ${
            acaoQueCriou ? `'${acaoQueCriou}'` : 'null'
          } where external_id = '${externo}'`,
        );
      const tentativas: Array<[string, [string, unknown[]]]> = [
        ['o worker', passar('120200000000000316', acao)],
        ['sem a ação', passar('120200000000000316', null)],
        ['com a ação da fixture, sem execução confirmada', passar('120200000000000316', ACAO_QUE_CRIOU)],
        ['o nome parecido', passar('120200000000000317', acao)],
        ['a que o dono já trocou de operador', passar('120200000000000319', acao)],
        ['a do Claude de volta para o humano', passar('120200000000000318', acao, 'human')],
        [
          'renomeada para o nome com o código no mesmo update',
          pelaFuncao(
            `update mkt.campaigns set name = 'cs-campanha-do-humano-${codigo}', managed_by = 'claude',
                    created_by_action_id = '${acao}' where external_id = '120200000000000320'`,
          ),
        ],
        ['a de outra conta, com o código no fim do nome', passar('7000000330', acao)],
        [
          'trazida de outra conta no mesmo update',
          pelaFuncao(
            `update mkt.campaigns
                set ad_account_id = '${CONTA_META_CS}', brand_id = (select id from mkt.brands where code = 'cs'),
                    platform = 'meta', source = 'meta_ads', managed_by = 'claude', created_by_action_id = '${acao}'
              where external_id = '7000000330'`,
          ),
        ],
      ];
      for (const [nome, [sql, params]] of tentativas) {
        await s.como(servico(nome === 'o worker' ? 'mkt_worker' : 'mkt_executor'));
        expect((await s.erro('PT403', sql, params)).message, nome).toBe('TRF-403');
      }
      await s.como(postgres);
      expect(
        await s.linhas(
          `select external_id, name, ad_account_id::text as conta, managed_by from mkt.campaigns
            where external_id in ('120200000000000320', '7000000330') order by 1`,
        ),
      ).toEqual([
        {
          external_id: '120200000000000320',
          name: 'cs-campanha-do-humano',
          conta: CONTA_META_CS,
          managed_by: 'human',
        },
        {
          external_id: '7000000330',
          name: `pl-busca-${codigo}`,
          conta: CONTA_GOOGLE_PL,
          managed_by: 'human',
        },
      ]);
      // A execução confirmada noutra transação (ontem) também não vale.
      await s.como(postgres);
      const quando = (instante: string) =>
        s.exec(`
          alter table mkt.platform_executions disable trigger platform_executions_guard;
          update mkt.platform_executions set confirmed_at = ${instante} where id = '${execucao}';
          alter table mkt.platform_executions enable trigger platform_executions_guard;
        `);
      await quando(`now() - interval '1 day'`);
      await s.como(servico('mkt_executor'));
      expect((await s.erro('PT403', ...passar('120200000000000316', acao))).message).toBe('TRF-403');
      await s.como(postgres);
      await quando('now()');
      expect((await operador(s, '120200000000000316')).managed_by).toBe('human');

      // Controle: com tudo certo, o executor passa a campanha, e o histórico diz que o Claude criou.
      await s.como(servico('mkt_executor'));
      await s.linhas(...passar('120200000000000316', acao));
      expect(await operador(s, '120200000000000316')).toEqual({
        managed_by: 'claude',
        acao,
        historico: [IMPORTADA, CRIADA_PELO_CLAUDE],
      });
    });
  });
});

describe('o Claude: record_claude_run e add_claude_proposal', () => {
  const RODADA = '00000000-0000-4000-8000-000000000501';
  const contexto = JSON.stringify({
    brand: 'cs',
    today_on: '2026-11-20',
    strategy: { body: 'Foco no Sul.' },
  });

  it('a rodada é gravada pelo id que o worker cria: repetir não duplica; terminada, não volta a rodar', async () => {
    await caso(db, servico('mkt_worker'), async (s) => {
      const gravar = (status: string, extra = '') =>
        s.linhas(
          `select status, error_code, proposals_refused, input_tokens, finished_at is not null as fim
             from ingest.record_claude_run($1, 'cs', $2, 'modelo-de-teste', 'teste-2', 'Proponha ações.', $3::jsonb,
                                           now()${extra})`,
          [RODADA, status, contexto],
        );
      expect(await gravar('running')).toEqual([
        { status: 'running', error_code: null, proposals_refused: 0, input_tokens: null, fim: false },
      ]);
      expect(await gravar('running')).toEqual([
        { status: 'running', error_code: null, proposals_refused: 0, input_tokens: null, fim: false },
      ]);
      expect(await gravar('succeeded', `, '{"proposals": 3}', 1200, 300, 1`)).toEqual([
        { status: 'succeeded', error_code: null, proposals_refused: 1, input_tokens: 1200, fim: true },
      ]);
      expect(
        (
          await s.erro(
            'PT422',
            `select ingest.record_claude_run($1, 'cs', 'running', 'm', 'v', 'p', '{}', now())`,
            [RODADA],
          )
        ).detail,
      ).toBe('status');
      expect(
        (
          await s.erro(
            'PT422',
            `select ingest.record_claude_run($1, 'plumene', 'succeeded', 'm', 'v', 'p', '{}', now())`,
            [RODADA],
          )
        ).detail,
      ).toBe('brand');
      await s.como(postgres);
      expect(await s.valor(`select count(*)::int from mkt.claude_runs where id = $1`, [RODADA])).toBe(1);
    });
  });

  it('o contexto recusado (chave fora da lista, dado pessoal) nunca é guardado: a rodada nasce falhada, CONTEXT_REFUSED', async () => {
    await caso(db, servico('mkt_worker'), async (s) => {
      for (const [id, ctx, prompt] of [
        [
          '00000000-0000-4000-8000-000000000502',
          { brand: 'cs', email: 'fulano@exemplo.com' },
          'Proponha ações.',
        ],
        [
          '00000000-0000-4000-8000-000000000503',
          { brand: 'cs', strategy: { body: 'Ligar para (11) 98765-4321' } },
          'Proponha ações.',
        ],
        ['00000000-0000-4000-8000-000000000504', { brand: 'cs' }, 'Pergunte a fulano@exemplo.com.'],
      ] as const) {
        expect(
          await s.linhas(
            `select status, error_code, context, prompt, output, finished_at is not null as fim
               from ingest.record_claude_run($1, 'cs', 'running', 'modelo-de-teste', 'teste-2', $2, $3::jsonb, now())`,
            [id, prompt, JSON.stringify(ctx)],
          ),
          id,
        ).toEqual([
          {
            status: 'failed',
            error_code: 'CONTEXT_REFUSED',
            context: {},
            prompt: prompt.includes('@') ? '' : prompt,
            output: null,
            fim: true,
          },
        ]);
      }
    });
  });

  it('cada proposta passa por private.validate_action e nasce ideia, do Claude; repetir devolve a mesma, sem gastar código', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(`select setval('mkt.traffic_action_code_seq', 5)`);
      await s.como(servico('mkt_worker', { sub: DONO, role: 'authenticated', aal: 'aal2' }));
      await s.linhas(
        `select * from ingest.record_claude_run($1, 'cs', 'running', 'modelo-de-teste', 'teste-2', 'Proponha ações.', $2::jsonb, now())`,
        [RODADA, contexto],
      );
      const propor = (item: number, campanha: string, porque: string, marca = 'cs', canal = 'meta') =>
        s.valor<string | null>(
          `select ingest.add_claude_proposal($1, $2, $3, $4, $5, 'pause', 'Pausar a prospecção', $6,
                                             '{"status": "paused"}', 'medium', 'low', 0)::text`,
          [RODADA, item, marca, canal, campanha, porque],
        );
      const primeira = await propor(1, CAMPANHA_HUMANO_CS, 'O custo por lead subiu 40% na semana.');
      expect(await propor(1, CAMPANHA_HUMANO_CS, 'O custo por lead subiu 40% na semana.')).toBe(primeira);
      expect(await propor(2, CAMPANHA_HUMANO_CS, 'Ligar para (11) 98765-4321 antes de pausar.')).toBeNull();
      expect(
        await propor(
          3,
          CAMPANHA_HUMANO_PL,
          'A busca de marca não converte há 2 semanas.',
          'plumene',
          'google',
        ),
      ).toBeNull();
      expect(
        await propor(4, '00000000-0000-0000-0000-000000000000', 'Campanha que não existe aqui.'),
      ).toBeNull();
      expect(
        (
          await s.erro(
            'PT422',
            `select ingest.add_claude_proposal($1, 0, 'cs', 'meta', null, 'pause', 't', 'r', '{}', 'low', 'low', 0)`,
            [RODADA],
          )
        ).detail,
      ).toBe('item');
      await s.como(postgres);
      expect(
        await s.linhas(
          `select code, status, proposed_by_kind, proposed_by, approved_by, claude_item from mkt.traffic_actions where claude_run_id = $1`,
          [RODADA],
        ),
      ).toEqual([
        {
          code: 'ACT-0006',
          status: 'idea',
          proposed_by_kind: 'claude',
          proposed_by: null,
          approved_by: null,
          claude_item: 1,
        },
      ]);
      expect(await s.valor(`select last_value::int from mkt.traffic_action_code_seq`)).toBe(6);
      expect(
        await s.linhas(`select event, actor_kind from mkt.traffic_log where traffic_action_id = $1`, [
          primeira,
        ]),
      ).toEqual([{ event: 'action_proposed', actor_kind: 'claude' }]);
    });
  });

  it('rodada falhada ou que não existe não recebe proposta; o executor, a tela e o n8n não chamam as funções do Claude', async () => {
    await caso(db, servico('mkt_worker'), async (s) => {
      await s.linhas(
        `select * from ingest.record_claude_run($1, 'cs', 'running', 'm', 'v', 'p', '{"email": "x"}', now())`,
        ['00000000-0000-4000-8000-000000000505'],
      );
      const proposta = (rodada: string) =>
        `select ingest.add_claude_proposal('${rodada}', 1, 'cs', 'meta', '${CAMPANHA_HUMANO_CS}', 'pause',
                                           'Pausar a prospecção', 'O custo por lead subiu na semana.',
                                           '{"status": "paused"}', 'low', 'low', 0)`;
      expect((await s.erro('PT422', proposta('00000000-0000-4000-8000-000000000505'))).detail).toBe('run');
      expect((await s.erro('PT404', proposta('00000000-0000-4000-8000-000000000599'))).detail).toBe('run');
    });
    for (const quem of [
      servico('mkt_executor'),
      usuario(DONO, 'aal2'),
      servico('n8n_notifier'),
      servico('mkt_setup'),
    ]) {
      await caso(db, quem, async (s) => {
        await s.erro(
          '42501',
          `select ingest.record_claude_run('${RODADA}', 'cs', 'running', 'm', 'v', 'p', '{}', now())`,
        );
        await s.erro(
          '42501',
          `select ingest.add_claude_proposal('${RODADA_DO_CLAUDE}', 9, 'cs', 'meta', null, 'pause', 't', 'r', '{}', 'low', 'low', 0)`,
        );
      });
    }
    await caso(db, postgres, async (s) => {
      expect(
        (
          await s.erro(
            'PT403',
            `select ingest.record_claude_run('${RODADA}', 'cs', 'running', 'm', 'v', 'p', '{}', now())`,
          )
        ).message,
      ).toBe('ING-403');
    });
  });
});

// Migração 07: a execução protegida (gatilho platform_executions_guard: quem cria, de que origem, o que nunca muda e
// as passagens de status), o diário da execução, o diário de tráfego só por acréscimo e as paradas
// (docs/dados/tabelas.md, seção 4, e papeis-e-rls.md, "Gatilhos que conferem quem pede"). test.rodar faz o papel das
// funções de ação (pela API) e de ingest (o executor). Dados inventados de fixtures/usuarios.sql, marketing.sql e
// trafego.sql.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Quem,
  type Sessao,
  abrirBanco,
  aplicarFixture,
  caso,
  postgres,
  servico,
  usuario,
} from './apoio/banco';
import {
  CAMPANHA_CLAUDE_CS,
  CAMPANHA_HUMANO_CS,
  CAMPANHA_HUMANO_PL,
  CONTA_GOOGLE_PL,
  CONTA_META_CS,
} from './apoio/marketing';
import {
  ACAO_APROVADA,
  CAMPANHA_DA_PARADA,
  EXECUCAO_DA_ACAO,
  EXECUCAO_DA_PARADA,
  EXECUCAO_DO_TETO,
  FUNCAO_DE_TESTE,
  IDEIA_DO_CLAUDE,
  LIMITE_META_CS,
  PARADA,
  pelaFuncao,
} from './apoio/trafego';
import { DONO, GESTOR } from './apoio/usuarios';

let db: PGlite;

beforeAll(async () => {
  db = await abrirBanco();
  await aplicarFixture(db, 'usuarios');
  await aplicarFixture(db, 'marketing');
  await aplicarFixture(db, 'trafego');
  await db.exec(FUNCAO_DE_TESTE);
});

afterAll(async () => {
  await db.close();
});

const DONO_2F = usuario(DONO, 'aal2');
const GESTOR_LOGADO = usuario(GESTOR, 'aal2');
const EXECUTOR = servico('mkt_executor');
const TOKEN_DO_DONO = { sub: DONO, role: 'authenticated', aal: 'aal2' };

/** Id da execução que os casos criam. */
const NOVA = '00000000-0000-4000-8000-000000000396';

async function pela(s: Sessao, quem: Quem, sql: string): Promise<void> {
  await s.como(quem);
  await s.linhas(...pelaFuncao(sql));
}

async function recusa(s: Sessao, codigo: string, quem: Quem, sql: string): Promise<string> {
  await s.como(quem);
  return (await s.erro(codigo, ...pelaFuncao(sql))).message;
}

interface Execucao {
  id?: string;
  acao?: string | null;
  parada?: string | null;
  limite?: string | null;
  operacao?: string;
  marca?: 'cs' | 'plumene';
  plataforma?: string;
  conta?: string;
  campanha?: string | null;
  /** Colunas a mais (ou trocadas), já em SQL: { attempts: '1' }. */
  mais?: Record<string, string>;
}

const texto = (v: string | null | undefined): string => (v == null ? 'null' : `'${v}'`);

/**
 * O insert de uma execução, como private.queue_execution, private.queue_stop_executions e api.set_spend_limit gravam;
 * sem nada, a pausa da ação aprovada da fixture (a campanha do humano na conta Meta da cs).
 */
function execucao(e: Execucao = {}): string {
  const id = e.id ?? NOVA;
  const origem = e.parada !== undefined || e.limite !== undefined;
  const colunas: Record<string, string> = {
    id: texto(id),
    brand_id: `(select id from mkt.brands where code = '${e.marca ?? 'cs'}')`,
    platform: texto(e.plataforma ?? 'meta'),
    ad_account_id: texto(e.conta ?? CONTA_META_CS),
    campaign_id: texto(e.campanha === undefined ? CAMPANHA_HUMANO_CS : e.campanha),
    traffic_action_id: texto(e.acao === undefined ? (origem ? null : ACAO_APROVADA) : e.acao),
    traffic_stop_campaign_id: texto(e.parada ?? null),
    spend_limit_id: texto(e.limite ?? null),
    operation: texto(e.operacao ?? 'pause'),
    request: `'{"status": "PAUSED"}'`,
    idempotency_key: texto(`exec-teste-${id}`),
    ...e.mais,
  };
  return `insert into mkt.platform_executions (${Object.keys(colunas).join(', ')})
          values (${Object.values(colunas).join(', ')})`;
}

const mudar = (id: string, set: string) => `update mkt.platform_executions set ${set} where id = '${id}'`;
const PARA: Record<string, string> = {
  queued: `status = 'queued', blocked_reason = null`,
  blocked: `status = 'blocked', blocked_reason = 'no_write_credential'`,
  sent: `status = 'sent', attempts = attempts + 1, sent_at = now()`,
  confirmed: `status = 'confirmed', confirmed_at = now(), blocked_reason = null`,
  failed: `status = 'failed', failed_at = now(), http_status = 400, error_code = 'INVALID_PARAMETER'`,
  cancelled: `status = 'cancelled', cancelled_at = now(), blocked_reason = null`,
};

async function statusDe(s: Sessao, id: string): Promise<string> {
  await s.como(postgres);
  return s.valor<string>('select status::text from mkt.platform_executions where id = $1', [id]);
}

/** Uma execução da ação aprovada no status pedido, pelo caminho de verdade: o dono cria pela API, o executor anda. */
async function execucaoEm(s: Sessao, status: string): Promise<void> {
  await pela(s, DONO_2F, execucao());
  if (status === 'blocked' || status === 'cancelled')
    await pela(s, EXECUTOR, mudar(NOVA, PARA.blocked ?? ''));
  if (status === 'cancelled') await pela(s, DONO_2F, mudar(NOVA, PARA.cancelled ?? ''));
  if (['sent', 'confirmed', 'failed'].includes(status)) await pela(s, EXECUTOR, mudar(NOVA, PARA.sent ?? ''));
  if (status === 'confirmed' || status === 'failed') await pela(s, EXECUTOR, mudar(NOVA, PARA[status] ?? ''));
  await s.como(postgres);
}

describe('quem cria a execução (gatilho platform_executions_guard)', () => {
  it('as funções de ação, pela API, com a permissão da origem: a ação aprovada, a parada e o limite', async () => {
    await caso(db, postgres, async (s) => {
      // A ação aprovada pede approve_action (com o segundo fator).
      await pela(s, DONO_2F, execucao());
      // A parada pede stop_all, que nunca pede o segundo fator (RLS-35, o controle).
      await pela(
        s,
        usuario(DONO, 'aal1'),
        execucao({
          id: '00000000-0000-4000-8000-000000000397',
          parada: CAMPANHA_DA_PARADA,
          campanha: CAMPANHA_CLAUDE_CS,
        }),
      );
      // O limite pede configure_traffic: o teto da conta na Meta.
      await pela(
        s,
        DONO_2F,
        execucao({
          id: '00000000-0000-4000-8000-000000000398',
          limite: LIMITE_META_CS,
          operacao: 'set_account_spend_cap',
          campanha: null,
        }),
      );
      await s.como(postgres);
      expect(
        await s.valor(
          `select count(*)::int from mkt.platform_executions where id in ($1, '00000000-0000-4000-8000-000000000397',
                                                                         '00000000-0000-4000-8000-000000000398')`,
          [NOVA],
        ),
      ).toBe(3);
    });
  });

  it('a fila do teto da conta do dia 1 (pg_cron, como o dono do banco) cria só set_account_spend_cap', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(execucao({ limite: LIMITE_META_CS, operacao: 'set_account_spend_cap', campanha: null }));
      expect(await statusDe(s, NOVA)).toBe('queued');
      expect((await s.erro('PT403', execucao({ id: '00000000-0000-4000-8000-000000000397' }))).message).toBe(
        'TRF-403',
      );
    });
  });

  it('nem o gestor, nem o dono sem o segundo fator, nem os serviços (mesmo com o token do dono): PT403', async () => {
    const tentativas: Array<[string, Quem, string]> = [
      ['o gestor, a ação aprovada', GESTOR_LOGADO, execucao()],
      ['o dono sem o segundo fator, a ação aprovada', usuario(DONO, 'aal1'), execucao()],
      [
        'o gestor, a parada',
        GESTOR_LOGADO,
        execucao({ parada: CAMPANHA_DA_PARADA, campanha: CAMPANHA_CLAUDE_CS }),
      ],
      [
        'o dono sem o segundo fator, o teto',
        usuario(DONO, 'aal1'),
        execucao({ limite: LIMITE_META_CS, operacao: 'set_account_spend_cap', campanha: null }),
      ],
      ['o worker', servico('mkt_worker', TOKEN_DO_DONO), execucao()],
      ['o executor', servico('mkt_executor', TOKEN_DO_DONO), execucao()],
      [
        'o executor, o teto',
        servico('mkt_executor', TOKEN_DO_DONO),
        execucao({ limite: LIMITE_META_CS, operacao: 'set_account_spend_cap', campanha: null }),
      ],
      ['o n8n', servico('n8n_notifier', TOKEN_DO_DONO), execucao()],
      ['os scripts', servico('mkt_setup', TOKEN_DO_DONO), execucao()],
    ];
    for (const [nome, quem, sql] of tentativas) {
      await caso(db, postgres, async (s) => {
        expect(await recusa(s, 'PT403', quem, sql), nome).toBe('TRF-403');
        await s.como(postgres);
        expect(
          await s.valor('select count(*)::int from mkt.platform_executions where id = $1', [NOVA]),
          nome,
        ).toBe(0);
      });
    }
  });

  it('RLS-04: direto na tabela, ninguém da API nem dos serviços grava (sem grant)', async () => {
    for (const quem of [DONO_2F, servico('mkt_executor'), servico('mkt_worker')]) {
      await caso(db, quem, async (s) => {
        await s.erro('42501', execucao());
        await s.erro('42501', mudar(EXECUCAO_DA_ACAO, PARA.queued ?? ''));
      });
    }
  });
});

describe('a execução nasce na fila e é da origem dela', () => {
  it('nasce queued, sem tentativa, resposta nem andamento', async () => {
    const andamento: Array<Record<string, string>> = [
      { status: `'blocked'`, blocked_reason: `'no_write_credential'` },
      { status: `'sent'` },
      { status: `'confirmed'` },
      { attempts: '1' },
      { sent_at: 'now()' },
      { http_status: '200' },
      { error_code: `'HTTP_500'` },
      { response: `'{}'` },
    ];
    for (const mais of andamento) {
      await caso(db, postgres, async (s) => {
        expect(await recusa(s, 'PT422', DONO_2F, execucao({ mais })), JSON.stringify(mais)).toBe('TRF-422');
      });
    }
  });

  it('da ação: ainda aprovada, a mesma marca, conta e campanha, e a operação do tipo (lance e criativo não executam)', async () => {
    const tentativas: Array<[string, string]> = [
      [
        'ação ainda em ideia',
        execucao({ acao: IDEIA_DO_CLAUDE, campanha: CAMPANHA_CLAUDE_CS, operacao: 'set_daily_budget' }),
      ],
      ['outra campanha da mesma conta', execucao({ campanha: CAMPANHA_CLAUDE_CS })],
      ['operação de outro tipo', execucao({ operacao: 'activate' })],
      ['orçamento numa pausa', execucao({ operacao: 'set_daily_budget' })],
      ['criar campanha com campanha', execucao({ operacao: 'create_campaign' })],
      ['pausa sem campanha', execucao({ campanha: null })],
      [
        'outra conta, de outra marca',
        execucao({
          marca: 'plumene',
          plataforma: 'google',
          conta: CONTA_GOOGLE_PL,
          campanha: CAMPANHA_HUMANO_PL,
        }),
      ],
    ];
    for (const [nome, sql] of tentativas) {
      await caso(db, postgres, async (s) => {
        expect(await recusa(s, 'PT422', DONO_2F, sql), nome).toBe('TRF-422');
      });
    }
    // Lance aprovado: a fila não cria execução (na v1, faça na plataforma e marque como feita).
    await caso(db, postgres, async (s) => {
      await pela(
        s,
        DONO_2F,
        `insert into mkt.traffic_actions (id, brand_id, platform, ad_account_id, campaign_id, kind, title, rationale,
                                          params, impact, effort, status, proposed_by_kind, proposed_by, approved_by,
                                          approved_at)
         values ('00000000-0000-4000-8000-000000000393', (select id from mkt.brands where code = 'cs'), 'meta',
                 '${CONTA_META_CS}', '${CAMPANHA_HUMANO_CS}', 'bid', 'Trocar o lance da campanha',
                 'O lance automático gastou demais na semana.', '{"bid_strategy": "COST_CAP"}', 'low', 'low',
                 'approved', 'human', auth.uid(), auth.uid(), now())`,
      );
      for (const operacao of ['pause', 'set_daily_budget', 'create_campaign', 'activate']) {
        expect(
          await recusa(
            s,
            'PT422',
            DONO_2F,
            execucao({
              acao: '00000000-0000-4000-8000-000000000393',
              operacao,
              campanha: operacao === 'create_campaign' ? null : CAMPANHA_HUMANO_CS,
            }),
          ),
          operacao,
        ).toBe('TRF-422');
      }
    });
  });

  it('da parada: pausar com a parada aberta, reativar com ela desfeita, a campanha dela', async () => {
    await caso(db, postgres, async (s) => {
      const daParada = (operacao: string, campanha = CAMPANHA_CLAUDE_CS) =>
        execucao({ parada: CAMPANHA_DA_PARADA, campanha, operacao });
      expect(await recusa(s, 'PT422', DONO_2F, daParada('activate'))).toBe('TRF-422');
      expect(await recusa(s, 'PT422', DONO_2F, daParada('pause', CAMPANHA_HUMANO_CS))).toBe('TRF-422');
      await s.como(postgres);
      await s.exec(
        `update mkt.traffic_stops set undone_by = '${DONO}', undone_at = now() where id = '${PARADA}'`,
      );
      expect(await recusa(s, 'PT422', DONO_2F, daParada('pause'))).toBe('TRF-422');
      await pela(s, DONO_2F, daParada('activate'));
      expect(await statusDe(s, NOVA)).toBe('queued');
    });
  });

  it('do limite: só o teto da conta, só na Meta, na conta do limite', async () => {
    await caso(db, postgres, async (s) => {
      const outroLimite = await s.valor<string>(
        `insert into mkt.spend_limits (ad_account_id, brand_id, platform, monthly_limit_cents, valid_from_on, set_by)
         values ($1, (select id from mkt.brands where code = 'plumene'), 'google', 900000, current_date, $2)
         returning id::text`,
        [CONTA_GOOGLE_PL, DONO],
      );
      expect(
        await recusa(
          s,
          'PT422',
          DONO_2F,
          execucao({
            limite: outroLimite,
            operacao: 'set_account_spend_cap',
            campanha: null,
            marca: 'plumene',
            plataforma: 'google',
            conta: CONTA_GOOGLE_PL,
          }),
        ),
      ).toBe('TRF-422');
      expect(
        await recusa(
          s,
          'PT422',
          DONO_2F,
          execucao({
            limite: LIMITE_META_CS,
            operacao: 'set_account_spend_cap',
            campanha: CAMPANHA_HUMANO_CS,
          }),
        ),
      ).toBe('TRF-422');
      // Origem de menos ou de mais, e o teto sem o limite: o check da tabela.
      await recusa(s, '23514', DONO_2F, execucao({ limite: LIMITE_META_CS, operacao: 'pause' }));
      await recusa(s, '23514', DONO_2F, execucao({ acao: null }));
      await recusa(
        s,
        '23514',
        DONO_2F,
        execucao({
          parada: CAMPANHA_DA_PARADA,
          limite: LIMITE_META_CS,
          operacao: 'set_account_spend_cap',
          campanha: null,
        }),
      );
    });
  });

  it('uma chave de idempotência por execução; bloqueada sempre com o motivo, e o motivo só na bloqueada', async () => {
    await caso(db, postgres, async (s) => {
      await pela(s, DONO_2F, execucao());
      await recusa(
        s,
        '23505',
        DONO_2F,
        execucao({
          id: '00000000-0000-4000-8000-000000000397',
          mais: { idempotency_key: `'exec-teste-${NOVA}'` },
        }),
      );
      await recusa(s, '23514', EXECUTOR, mudar(NOVA, `status = 'blocked'`));
      await recusa(s, '23514', EXECUTOR, mudar(NOVA, `status = 'sent', blocked_reason = 'stopped'`));
      // Sem passagem, a fila não muda: nem o motivo sozinho.
      expect(await recusa(s, 'PT422', EXECUTOR, mudar(NOVA, `blocked_reason = 'stopped'`))).toBe('TRF-422');
      await recusa(s, '23514', EXECUTOR, mudar(NOVA, `status = 'blocked', blocked_reason = 'sem_motivo'`));
      await recusa(s, '23514', EXECUTOR, mudar(NOVA, `status = 'sent', attempts = 6`));
      await recusa(s, '23514', EXECUTOR, mudar(NOVA, `status = 'sent', http_status = 99`));
      await recusa(
        s,
        '23514',
        EXECUTOR,
        mudar(NOVA, `status = 'sent', error_message = '${'x'.repeat(301)}'`),
      );
      await recusa(s, '23514', EXECUTOR, mudar(NOVA, `status = 'sent', error_code = 'erro com espaço'`));
    });
  });
});

describe('o que a execução manda nunca muda', () => {
  it('a cópia do pedido, a operação, a chave, a origem, a conta e a campanha: PT422, nem o executor', async () => {
    for (const mudanca of [
      `request = '{"status": "ACTIVE"}'`,
      `operation = 'activate'`,
      `idempotency_key = 'outra-chave'`,
      `traffic_action_id = '${IDEIA_DO_CLAUDE}'`,
      `campaign_id = '${CAMPANHA_CLAUDE_CS}'`,
      `ad_account_id = '${CONTA_GOOGLE_PL}'`,
    ]) {
      await caso(db, postgres, async (s) => {
        expect(await recusa(s, 'PT422', EXECUTOR, mudar(EXECUCAO_DA_ACAO, mudanca)), mudanca).toBe('TRF-422');
      });
    }
  });
});

describe('as passagens de status da execução e quem anda com ela', () => {
  /** Cada destino com quem pode pedi-lo (quando a passagem existe). */
  const QUEM_PEDE: Record<string, Quem> = {
    queued: DONO_2F,
    blocked: EXECUTOR,
    sent: EXECUTOR,
    confirmed: EXECUTOR,
    failed: EXECUTOR,
    cancelled: DONO_2F,
  };
  /** tabelas.md: queued → blocked | sent | confirmed | cancelled; blocked → queued | cancelled; sent → sent | confirmed | failed. */
  const PERMITIDAS: Record<string, string[]> = {
    queued: ['blocked', 'sent', 'confirmed', 'cancelled'],
    blocked: ['queued', 'cancelled'],
    sent: ['sent', 'confirmed', 'failed'],
    confirmed: [],
    failed: [],
    cancelled: [],
  };

  for (const de of Object.keys(PERMITIDAS)) {
    it(`de ${de}: só as passagens do quadro; o que terminou não muda mais`, async () => {
      for (const para of Object.keys(QUEM_PEDE)) {
        await caso(db, postgres, async (s) => {
          await execucaoEm(s, de);
          const nome = `${de} → ${para}`;
          const quem = QUEM_PEDE[para] ?? EXECUTOR;
          if (PERMITIDAS[de]?.includes(para)) {
            await pela(s, quem, mudar(NOVA, PARA[para] ?? ''));
            expect(await statusDe(s, NOVA), nome).toBe(para);
          } else {
            expect(await recusa(s, 'PT422', quem, mudar(NOVA, PARA[para] ?? '')), nome).toBe('TRF-422');
            expect(await statusDe(s, NOVA), nome).toBe(de);
          }
        });
      }
    });
  }

  it('o executor manda, relê, confirma e falha; a API não', async () => {
    for (const [de, para] of [
      ['queued', 'sent'],
      ['queued', 'confirmed'],
      ['sent', 'confirmed'],
      ['sent', 'failed'],
      ['sent', 'sent'],
    ]) {
      await caso(db, postgres, async (s) => {
        await execucaoEm(s, de ?? '');
        expect(
          await recusa(s, 'PT403', DONO_2F, mudar(NOVA, PARA[para ?? ''] ?? '')),
          `${de} → ${para}`,
        ).toBe('TRF-403');
      });
    }
  });

  it('bloquear: o executor ou, no Parar tudo, a API com stop_all; o gestor não', async () => {
    await caso(db, postgres, async (s) => {
      await execucaoEm(s, 'queued');
      expect(
        await recusa(
          s,
          'PT403',
          GESTOR_LOGADO,
          mudar(NOVA, `status = 'blocked', blocked_reason = 'stopped'`),
        ),
      ).toBe('TRF-403');
      await pela(s, usuario(DONO, 'aal1'), mudar(NOVA, `status = 'blocked', blocked_reason = 'stopped'`));
      expect(await statusDe(s, NOVA)).toBe('blocked');
    });
  });

  it('"Tentar de novo" (de volta para a fila): só a API com approve_action; cancelar: a API, com approve_action ou operate_traffic', async () => {
    await caso(db, postgres, async (s) => {
      await execucaoEm(s, 'blocked');
      expect(await recusa(s, 'PT403', EXECUTOR, mudar(NOVA, PARA.queued ?? ''))).toBe('TRF-403');
      expect(await recusa(s, 'PT403', GESTOR_LOGADO, mudar(NOVA, PARA.queued ?? ''))).toBe('TRF-403');
      expect(await recusa(s, 'PT403', usuario(DONO, 'aal1'), mudar(NOVA, PARA.queued ?? ''))).toBe('TRF-403');
      expect(await recusa(s, 'PT403', EXECUTOR, mudar(NOVA, PARA.cancelled ?? ''))).toBe('TRF-403');
      await pela(s, GESTOR_LOGADO, mudar(NOVA, PARA.cancelled ?? ''));
      expect(await statusDe(s, NOVA)).toBe('cancelled');
    });
  });

  it('o worker, o n8n, os scripts e o dono do banco não andam com a execução', async () => {
    for (const quem of [
      servico('mkt_worker', TOKEN_DO_DONO),
      servico('n8n_notifier', TOKEN_DO_DONO),
      servico('mkt_setup', TOKEN_DO_DONO),
    ]) {
      await caso(db, postgres, async (s) => {
        await execucaoEm(s, 'queued');
        expect(await recusa(s, 'PT403', quem, mudar(NOVA, PARA.sent ?? ''))).toBe('TRF-403');
      });
    }
    await caso(db, postgres, async (s) => {
      await execucaoEm(s, 'queued');
      expect((await s.erro('PT403', mudar(NOVA, PARA.sent ?? ''))).message).toBe('TRF-403');
    });
  });
});

describe('o diário da execução (gatilho platform_executions_log)', () => {
  interface Evento {
    actor_kind: string;
    actor_id: string | null;
    changes: unknown;
  }

  async function eventos(s: Sessao, id: string): Promise<Evento[]> {
    await s.como(postgres);
    return s.linhas<Evento>(
      `select actor_kind::text, actor_id::text, changes from mkt.traffic_log
        where platform_execution_id = $1 and event = 'execution_status_changed' order by seq`,
      [id],
    );
  }

  it('ao nascer e a cada mudança de status, com o motivo do bloqueio; pela API, a pessoa; o executor é o sistema', async () => {
    await caso(db, postgres, async (s) => {
      await pela(s, DONO_2F, execucao());
      await pela(s, EXECUTOR, mudar(NOVA, PARA.blocked ?? ''));
      await pela(s, DONO_2F, mudar(NOVA, PARA.queued ?? ''));
      await pela(s, EXECUTOR, mudar(NOVA, PARA.sent ?? ''));
      await pela(s, EXECUTOR, mudar(NOVA, `attempts = attempts + 1`));
      await pela(s, EXECUTOR, mudar(NOVA, PARA.confirmed ?? ''));
      expect(await eventos(s, NOVA)).toEqual([
        { actor_kind: 'user', actor_id: DONO, changes: { status: { before: null, after: 'queued' } } },
        {
          actor_kind: 'system',
          actor_id: null,
          changes: { status: { before: 'queued', after: 'blocked' }, blocked_reason: 'no_write_credential' },
        },
        { actor_kind: 'user', actor_id: DONO, changes: { status: { before: 'blocked', after: 'queued' } } },
        { actor_kind: 'system', actor_id: null, changes: { status: { before: 'queued', after: 'sent' } } },
        { actor_kind: 'system', actor_id: null, changes: { status: { before: 'sent', after: 'confirmed' } } },
      ]);
    });
  });

  it('a linha leva a ação, a campanha, a parada ou o limite de onde a execução veio', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        await s.linhas(
          `select platform_execution_id::text as execucao, traffic_action_id::text as acao, campaign_id::text as campanha,
                  traffic_stop_id::text as parada, spend_limit_id::text as limite, platform::text
             from mkt.traffic_log
            where event = 'execution_status_changed' and changes -> 'status' ->> 'before' is null
            order by platform_execution_id`,
        ),
      ).toEqual([
        {
          execucao: EXECUCAO_DA_ACAO,
          acao: ACAO_APROVADA,
          campanha: CAMPANHA_HUMANO_CS,
          parada: null,
          limite: null,
          platform: 'meta',
        },
        {
          execucao: EXECUCAO_DA_PARADA,
          acao: null,
          campanha: CAMPANHA_CLAUDE_CS,
          parada: PARADA,
          limite: null,
          platform: 'meta',
        },
        {
          execucao: EXECUCAO_DO_TETO,
          acao: null,
          campanha: null,
          parada: null,
          limite: LIMITE_META_CS,
          platform: 'meta',
        },
      ]);
    });
  });
});

describe('o diário de tráfego só por acréscimo', () => {
  it('ninguém altera, apaga ou esvazia o diário, nem o dono do banco (RLS-17)', async () => {
    await caso(db, postgres, async (s) => {
      const total = await s.valor<number>('select count(*)::int from mkt.traffic_log');
      expect(total).toBeGreaterThan(0);
      expect((await s.erro('PT403', `update mkt.traffic_log set changes = '{}'`)).message).toBe('LOG-403');
      await s.erro('PT403', `update mkt.traffic_log set occurred_at = now() - interval '6 years'`);
      await s.erro('PT403', 'delete from mkt.traffic_log');
      await s.erro('PT403', 'truncate mkt.traffic_log');
      expect(await s.valor('select count(*)::int from mkt.traffic_log')).toBe(total);
    });
    for (const quem of [DONO_2F, servico('mkt_worker'), servico('mkt_executor')]) {
      await caso(db, quem, async (s) => {
        await s.erro(
          '42501',
          `insert into mkt.traffic_log (event, actor_kind) values ('stop_all', 'system')`,
        );
        await s.erro('42501', `update mkt.traffic_log set changes = '{}'`);
        await s.erro('42501', 'delete from mkt.traffic_log');
      });
    }
  });

  it('a limpeza do prazo de guarda (5 anos) apaga só a linha vencida; com uma recente no meio, nada sai', async () => {
    await caso(db, postgres, async (s) => {
      const evento = (quando: string) =>
        `insert into mkt.traffic_log (occurred_at, event, actor_kind) values (${quando}, 'stop_undone', 'system')`;
      await s.exec(evento(`now() - interval '5 years 1 day'`));
      await s.exec(evento(`now() - interval '4 years 11 months'`));
      expect(
        await s.linhas(
          `delete from mkt.traffic_log where occurred_at < now() - interval '5 years' returning 1`,
        ),
      ).toHaveLength(1);
      await s.erro('PT403', `delete from mkt.traffic_log where occurred_at < now() - interval '4 years'`);
    });
  });

  it('quem fez: a pessoa leva o id; o Claude e o sistema, não; a ordem de gravação desempata a mesma hora', async () => {
    await caso(db, postgres, async (s) => {
      const linha = (ator: string, id: string | null) =>
        `insert into mkt.traffic_log (event, actor_kind, actor_id) values ('limit_changed', '${ator}', ${id ? `'${id}'` : 'null'})`;
      await s.erro('23514', linha('user', null));
      await s.erro('23514', linha('claude', DONO));
      await s.erro('23514', linha('system', DONO));
      await s.erro(
        '23514',
        `insert into mkt.traffic_log (event, actor_kind) values ('acao_qualquer', 'system')`,
      );
      await s.exec(linha('user', DONO));
      await s.exec(linha('system', null));
      const ultimas = await s.linhas<{ seq: number; occurred_at: string }>(
        `select seq, occurred_at::text from mkt.traffic_log order by seq desc limit 2`,
      );
      expect(ultimas[0]?.occurred_at).toBe(ultimas[1]?.occurred_at);
      expect((ultimas[0]?.seq ?? 0) > (ultimas[1]?.seq ?? 0)).toBe(true);
      await s.erro(
        '428C9',
        `insert into mkt.traffic_log (seq, event, actor_kind) values (1, 'stop_all', 'system')`,
      );
    });
  });
});

describe('paradas (traffic_stops e traffic_stop_campaigns)', () => {
  it('a parada das duas marcas tem marca nula; desfeita leva quem e quando, juntos', async () => {
    await caso(db, postgres, async (s) => {
      const parada = await s.valor<string>(
        `insert into mkt.traffic_stops (brand_id, requested_by) values (null, $1) returning id::text`,
        [DONO],
      );
      expect(await s.valor('select scope::text from mkt.traffic_stops where id = $1', [parada])).toBe(
        'claude_only',
      );
      await s.erro('23514', `update mkt.traffic_stops set undone_by = '${DONO}' where id = '${parada}'`);
      await s.erro('23514', `update mkt.traffic_stops set undone_at = now() where id = '${parada}'`);
      await s.erro(
        '23514',
        `insert into mkt.traffic_stops (brand_id, scope, requested_by) values (null, 'all_campaigns', '${DONO}')`,
      );
      await s.erro('23502', `insert into mkt.traffic_stops (brand_id) values (null)`);
      await s.exec(
        `update mkt.traffic_stops set undone_by = '${DONO}', undone_at = now() where id = '${parada}'`,
      );
    });
  });

  it('cada campanha uma vez por parada, com a marca dela e o status lido antes', async () => {
    await caso(db, postgres, async (s) => {
      const campanha = (c: { campanha?: string; marca?: string; antes?: string }) =>
        `insert into mkt.traffic_stop_campaigns (traffic_stop_id, campaign_id, brand_id, status_before)
         values ('${PARADA}', '${c.campanha ?? CAMPANHA_HUMANO_CS}', (select id from mkt.brands where code = '${c.marca ?? 'cs'}'),
                 '${c.antes ?? 'active'}')`;
      await s.erro('23503', campanha({ marca: 'plumene' }));
      await s.erro('23505', campanha({ campanha: CAMPANHA_CLAUDE_CS }));
      await s.erro('23514', campanha({ antes: 'rodando' }));
      await s.exec(campanha({}));
      await s.exec(campanha({ campanha: CAMPANHA_HUMANO_PL, marca: 'plumene' }));
    });
  });
});

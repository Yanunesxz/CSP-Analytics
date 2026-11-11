// Migração 09, tráfego: propor, aprovar, descartar e marcar como feita; "Tentar de novo" numa execução; estratégia;
// limite de gasto; "Parar tudo" e desfazer; operador da campanha (docs/dados/papeis-e-rls.md, "Funções de ação", e os
// casos RLS-06, 07, 11, 12, 15, 16 e 35). Cada caso entra pela API como a pessoa (o dono com e sem o segundo fator, o
// gestor) e confere o que a função grava e o que recusa. Dados inventados de fixtures/usuarios.sql, marketing.sql,
// trafego.sql e conectores.sql (a Meta com a linha de estado da credencial de escrita).
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type ErroDoBanco,
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
  ACAO_DESCARTADA,
  CREDENCIAL_DE_ESCRITA,
  ESTRATEGIA_CS,
  EXECUCAO_DA_ACAO,
  EXECUCAO_DA_PARADA,
  EXECUCAO_DO_TETO,
  FUNCAO_DE_TESTE,
  IDEIA_DO_CLAUDE,
  LIMITE_META_CS,
  PARADA,
  PENDENCIA,
  pelaFuncao,
} from './apoio/trafego';
import { DONO, GESTOR } from './apoio/usuarios';

let db: PGlite;

beforeAll(async () => {
  db = await abrirBanco();
  for (const f of ['usuarios', 'marketing', 'trafego', 'conectores']) await aplicarFixture(db, f);
  await db.exec(FUNCAO_DE_TESTE);
});

afterAll(async () => {
  await db.close();
});

const DONO_2F = usuario(DONO, 'aal2');
const DONO_1F = usuario(DONO, 'aal1');
const GESTOR_LOGADO = usuario(GESTOR, 'aal2');
const EXECUTOR = servico('mkt_executor');
/** Id que não existe. */
const NENHUMA = '00000000-0000-4000-8000-0000000003ff';

type Linha = Record<string, unknown>;

function primeira<T>(linhas: T[]): T {
  const [l] = linhas;
  if (l === undefined) throw new Error('A consulta não devolveu linha');
  return l;
}

async function chamar<T = Linha>(s: Sessao, quem: Quem, sql: string, params?: unknown[]): Promise<T[]> {
  await s.como(quem);
  return s.linhas<T>(sql, params);
}

async function recusa(
  s: Sessao,
  codigo: string,
  quem: Quem,
  sql: string,
  params?: unknown[],
): Promise<ErroDoBanco> {
  await s.como(quem);
  return s.erro(codigo, sql, params);
}

/** O updated_at de uma linha, como a tela leu (Date, em milissegundos). */
async function versao(s: Sessao, tabela: string, id: string): Promise<Date> {
  await s.como(postgres);
  return s.valor<Date>(`select updated_at from ${tabela} where id = $1`, [id]);
}

async function lerAcao(s: Sessao, id: string): Promise<Linha> {
  await s.como(postgres);
  return primeira(
    await s.linhas(
      `select status::text, updated_at, approved_by::text, discarded_by::text, discard_reason::text, discard_note,
              done_via::text, done_by::text, result, executed_at is not null as feita
         from mkt.traffic_actions where id = $1`,
      [id],
    ),
  );
}

async function lerExecucao(s: Sessao, id: string): Promise<Linha> {
  await s.como(postgres);
  return primeira(
    await s.linhas(
      `select status::text, blocked_reason::text, cancelled_at is not null as cancelada, operation::text, request
         from mkt.platform_executions where id = $1`,
      [id],
    ),
  );
}

/** O diário de uma ação, em ordem de gravação. */
async function diarioDaAcao(s: Sessao, id: string): Promise<Linha[]> {
  await s.como(postgres);
  return s.linhas(
    `select event::text, actor_kind::text, actor_id::text, changes
       from mkt.traffic_log where traffic_action_id = $1 order by seq`,
    [id],
  );
}

/** O executor anda com a execução e com a ação, como o ingest.* da migração 10. */
async function peloExecutor(s: Sessao, sql: string): Promise<void> {
  await s.como(EXECUTOR);
  await s.linhas(...pelaFuncao(sql));
  await s.como(postgres);
}

interface Proposta {
  marca?: string;
  plataforma?: string | null;
  campanha?: string | null;
  tipo?: string;
  titulo?: string;
  porque?: string;
  params?: Record<string, unknown>;
  custo?: number | null;
  aprovar?: boolean;
}

/** api.propose_action; sem nada, a pausa da campanha do humano na conta Meta da cs. */
function propor(p: Proposta = {}): [string, unknown[]] {
  return [
    'select * from api.propose_action($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
    [
      p.marca ?? 'cs',
      p.plataforma === undefined ? 'meta' : p.plataforma,
      p.campanha === undefined ? CAMPANHA_HUMANO_CS : p.campanha,
      p.tipo ?? 'pause',
      p.titulo ?? 'Pausar a prospecção de lojistas',
      p.porque ?? 'O custo por lead passou da meta do mês.',
      JSON.stringify(p.params ?? { status: 'paused' }),
      'medium',
      'low',
      p.custo ?? null,
      p.aprovar ?? false,
    ],
  ];
}

const CRIAR_NA_META = {
  objective: 'OUTCOME_SALES',
  daily_budget_cents: 3000,
  name: 'cs-remarketing-novo',
  special_ad_categories: [],
};

const contar = (s: Sessao, tabela: string) => s.valor<number>(`select count(*)::int from ${tabela}`);

describe('propor (api.propose_action)', () => {
  it('o gestor propõe em nome dele: a ideia leva a conta da campanha, e a proposta vai para o diário', async () => {
    await caso(db, postgres, async (s) => {
      const a = primeira(await chamar(s, GESTOR_LOGADO, ...propor()));
      expect(a).toMatchObject({
        status: 'idea',
        kind: 'pause',
        proposed_by_kind: 'human',
        proposed_by: GESTOR,
        ad_account_id: CONTA_META_CS,
        campaign_id: CAMPANHA_HUMANO_CS,
        approved_by: null,
      });
      expect(a.code).toMatch(/^ACT-\d{4,}$/);
      expect(await diarioDaAcao(s, String(a.id))).toEqual([
        { event: 'action_proposed', actor_kind: 'user', actor_id: GESTOR, changes: {} },
      ]);
      expect(
        await s.valor('select count(*)::int from mkt.platform_executions where traffic_action_id = $1', [
          a.id,
        ]),
      ).toBe(0);
    });
  });

  it('RLS-06 e RLS-35: aprovar junto pede approve_action com o segundo fator; sem ele, PT403 e nada é gravado', async () => {
    await caso(db, postgres, async (s) => {
      const antes = await contar(s, 'mkt.traffic_actions');
      for (const quem of [GESTOR_LOGADO, DONO_1F]) {
        expect((await recusa(s, 'PT403', quem, ...propor({ aprovar: true }))).message).toBe('TRF-403');
      }
      await s.como(postgres);
      expect(await contar(s, 'mkt.traffic_actions')).toBe(antes);
      // Sem aprovar junto, o dono sem o segundo fator propõe: operar não pede o TOTP.
      expect(primeira(await chamar(s, DONO_1F, ...propor()))).toMatchObject({
        status: 'idea',
        proposed_by: DONO,
      });
    });
  });

  it('o dono com o segundo fator propõe e aprova no mesmo passo: as duas linhas no diário e a execução na fila', async () => {
    await caso(db, postgres, async (s) => {
      const a = primeira(
        await chamar(
          s,
          DONO_2F,
          ...propor({
            tipo: 'budget',
            titulo: 'Ajustar o orçamento da prospecção',
            params: { daily_budget_cents: 7000, previous_daily_budget_cents: 5000 },
            aprovar: true,
          }),
        ),
      );
      expect(a).toMatchObject({ status: 'approved', proposed_by: DONO, approved_by: DONO });
      expect((await diarioDaAcao(s, String(a.id))).map((l) => [l.event, l.actor_id])).toEqual([
        ['action_proposed', DONO],
        ['action_approved', DONO],
        ['execution_status_changed', DONO],
      ]);
      expect(
        await s.linhas(
          `select operation::text, status::text, campaign_id::text, ad_account_id::text, request
             from mkt.platform_executions where traffic_action_id = $1`,
          [a.id],
        ),
      ).toEqual([
        {
          operation: 'set_daily_budget',
          status: 'queued',
          campaign_id: CAMPANHA_HUMANO_CS,
          ad_account_id: CONTA_META_CS,
          request: { daily_budget: 7000 },
        },
      ]);
    });
  });

  it('RLS-11: e-mail, telefone ou documento no porquê ou no título é recusado (PT422), e nada é gravado', async () => {
    const casos: Proposta[] = [
      { porque: 'Falar com fulano.de.tal@exemplo.invalid sobre a campanha.' },
      { porque: 'Ligar para (11) 98765-4321 antes de pausar a campanha.' },
      { porque: 'O lojista 123.456.789-09 reclamou do anúncio.' },
      { titulo: 'Pausar a pedido de 11987654321' },
    ];
    await caso(db, postgres, async (s) => {
      const antes = await contar(s, 'mkt.traffic_actions');
      for (const c of casos) {
        const e = await recusa(s, 'PT422', GESTOR_LOGADO, ...propor(c));
        expect([e.message, e.detail], JSON.stringify(c)).toEqual(['TRF-422', 'personal_data']);
      }
      await s.como(postgres);
      expect(await contar(s, 'mkt.traffic_actions')).toBe(antes);
    });
  });

  it('a conferência da ação (a mesma do Claude): marca, canal, campanha e conta que batem, e os parâmetros do tipo', async () => {
    const casos: Array<[string, string, Proposta]> = [
      ['PT404 campaign', 'campanha que não existe', { campanha: NENHUMA }],
      ['PT422 campaign', 'campanha da cs na Plumene', { marca: 'plumene' }],
      ['PT422 campaign', 'campanha da Meta no canal Google', { plataforma: 'google' }],
      ['PT422 campaign', 'pausar sem campanha', { campanha: null }],
      ['PT422 campaign', 'criar com campanha', { tipo: 'create', params: CRIAR_NA_META }],
      [
        'PT422 shared_budget',
        'orçamento em campanha com orçamento compartilhado',
        {
          marca: 'plumene',
          plataforma: 'google',
          campanha: CAMPANHA_HUMANO_PL,
          tipo: 'budget',
          params: { daily_budget_cents: 9000 },
        },
      ],
      [
        'PT422 account',
        'criar no TikTok, onde a cs não tem conta',
        {
          plataforma: 'tiktok',
          campanha: null,
          tipo: 'create',
          params: {
            objective: 'LEAD_GENERATION',
            daily_budget_cents: 5000,
            name: 'cs-tiktok',
            budget_mode: 'X',
          },
        },
      ],
      ['PT422 params', 'pausa com outro status', { params: { status: 'active' } }],
      ['PT422 params', 'orçamento negativo', { tipo: 'budget', params: { daily_budget_cents: -1 } }],
      ['PT422 platform', 'pausa sem canal', { plataforma: null, campanha: null }],
      ['PT422 text', 'título curto', { titulo: 'Oi' }],
      ['PT422 cost', 'custo negativo', { custo: -1 }],
    ];
    await caso(db, postgres, async (s) => {
      const antes = await contar(s, 'mkt.traffic_actions');
      for (const [esperado, nome, p] of casos) {
        const [codigo, detalhe] = esperado.split(' ');
        const e = await recusa(s, codigo ?? '', GESTOR_LOGADO, ...propor(p));
        expect([e.message, e.detail], nome).toEqual([`TRF-${codigo?.slice(2)}`, detalhe]);
      }
      await s.como(postgres);
      expect(await contar(s, 'mkt.traffic_actions')).toBe(antes);
    });
  });

  it('criar usa a única conta ativa da marca no canal; a pendência fica sem canal nem conta e não se aprova junto', async () => {
    await caso(db, postgres, async (s) => {
      const criar = primeira(
        await chamar(
          s,
          GESTOR_LOGADO,
          ...propor({ campanha: null, tipo: 'create', titulo: 'Criar o remarketing', params: CRIAR_NA_META }),
        ),
      );
      expect(criar).toMatchObject({ status: 'idea', ad_account_id: CONTA_META_CS, campaign_id: null });

      const pendencia: Proposta = {
        plataforma: null,
        campanha: null,
        tipo: 'pending_fix',
        titulo: 'Ligar o pixel no site',
        params: { area: 'pixel' },
      };
      expect(primeira(await chamar(s, GESTOR_LOGADO, ...propor(pendencia)))).toMatchObject({
        status: 'idea',
        platform: null,
        ad_account_id: null,
      });
      expect((await recusa(s, 'PT422', DONO_2F, ...propor({ ...pendencia, aprovar: true }))).message).toBe(
        'TRF-422',
      );

      // Com uma segunda conta ativa da marca no canal, a ação sem campanha não sabe qual: PT422.
      await s.como(postgres);
      await s.exec(`insert into mkt.ad_accounts (brand_id, platform, source, external_id, name)
                    select id, 'meta', 'meta_ads', 'act_920000000000001', 'Outra conta de teste'
                      from mkt.brands where code = 'cs'`);
      const e = await recusa(
        s,
        'PT422',
        GESTOR_LOGADO,
        ...propor({ campanha: null, tipo: 'create', titulo: 'Criar o remarketing', params: CRIAR_NA_META }),
      );
      expect(e.detail).toBe('account');
    });
  });
});

describe('aprovar (api.approve_action)', () => {
  it('RLS-15: com o updated_at antigo, PT409 e nada muda; com o lido, passado por Date, aprova e põe na fila', async () => {
    await caso(db, postgres, async (s) => {
      const lido = await versao(s, 'mkt.traffic_actions', IDEIA_DO_CLAUDE);
      const antigo = new Date(lido.getTime() - 1000);
      const e = await recusa(s, 'PT409', DONO_2F, 'select api.approve_action($1, $2)', [
        IDEIA_DO_CLAUDE,
        antigo,
      ]);
      expect(e.message).toBe('TRF-409');
      expect(await lerAcao(s, IDEIA_DO_CLAUDE)).toMatchObject({
        status: 'idea',
        approved_by: null,
        updated_at: lido,
      });

      const comoNaTela = new Date(lido.toISOString());
      const a = primeira(
        await chamar(s, DONO_2F, 'select * from api.approve_action($1, $2)', [IDEIA_DO_CLAUDE, comoNaTela]),
      );
      expect(a).toMatchObject({ status: 'approved', approved_by: DONO });
      expect(
        await s.linhas(
          `select operation::text, status::text, request from mkt.platform_executions where traffic_action_id = $1`,
          [IDEIA_DO_CLAUDE],
        ),
      ).toEqual([{ operation: 'set_daily_budget', status: 'queued', request: { daily_budget: 4500 } }]);
      expect((await diarioDaAcao(s, IDEIA_DO_CLAUDE)).map((l) => l.event)).toEqual([
        'action_proposed',
        'action_approved',
        'execution_status_changed',
      ]);
    });
  });

  it('RLS-16: pendência de medição não se aprova; a já aprovada ou descartada também não (PT422); a que não existe, PT404', async () => {
    await caso(db, postgres, async (s) => {
      for (const id of [PENDENCIA, ACAO_APROVADA, ACAO_DESCARTADA]) {
        const v = await versao(s, 'mkt.traffic_actions', id);
        const e = await recusa(s, 'PT422', DONO_2F, 'select api.approve_action($1, $2)', [id, v]);
        expect(e.message, id).toBe('TRF-422');
      }
      const e = await recusa(s, 'PT404', DONO_2F, 'select api.approve_action($1, $2)', [NENHUMA, new Date()]);
      expect(e.message).toBe('TRF-404');
      expect(await lerAcao(s, PENDENCIA)).toMatchObject({ status: 'idea' });
    });
  });

  it('RLS-06 e RLS-35: o gestor e o dono sem o segundo fator não aprovam (PT403), e nada muda', async () => {
    await caso(db, postgres, async (s) => {
      const v = await versao(s, 'mkt.traffic_actions', IDEIA_DO_CLAUDE);
      for (const quem of [GESTOR_LOGADO, DONO_1F]) {
        const e = await recusa(s, 'PT403', quem, 'select api.approve_action($1, $2)', [IDEIA_DO_CLAUDE, v]);
        expect(e.message).toBe('TRF-403');
      }
      expect(await lerAcao(s, IDEIA_DO_CLAUDE)).toMatchObject({ status: 'idea', updated_at: v });
    });
  });

  it('RLS-06 e RLS-07: a permissão vem na primeira linha: sem ela, PT403 mesmo com id que não existe ou versão antiga', async () => {
    const chamadas: Array<[string, unknown[]]> = [
      ['select api.approve_action($1, $2)', [NENHUMA, null]],
      ['select api.discard_action($1, $2, $3, $4)', [NENHUMA, 'other', 'Descarte de teste.', null]],
      ['select api.retry_execution($1, $2)', [NENHUMA, null]],
      ['select api.set_spend_limit($1, $2, $3)', [NENHUMA, 1000, null]],
      ['select api.undo_stop($1, $2)', [NENHUMA, null]],
      ['select api.stop_all($1, $2)', ['cs', 99]],
      [
        'select api.change_campaign_operator($1, $2, $3, $4, $5)',
        [NENHUMA, 'claude', 'correction', null, null],
      ],
    ];
    await caso(db, postgres, async (s) => {
      for (const [sql, args] of chamadas) {
        const e = await recusa(s, 'PT403', GESTOR_LOGADO, sql, args);
        expect(e.message, sql).toMatch(/^(TRF|STP)-403$/);
      }
      for (const [sql, args] of chamadas.slice(0, 4)) {
        await recusa(s, 'PT403', DONO_1F, sql, args);
      }
    });
  });

  it('lance e criativo não executam pela central: ficam aprovados, sem execução', async () => {
    await caso(db, postgres, async (s) => {
      const lance = primeira(
        await chamar(
          s,
          GESTOR_LOGADO,
          ...propor({ tipo: 'bid', titulo: 'Trocar o lance', params: { bid_strategy: 'COST_CAP' } }),
        ),
      );
      await chamar(s, DONO_2F, 'select api.approve_action($1, $2)', [lance.id, lance.updated_at]);
      expect(await lerAcao(s, String(lance.id))).toMatchObject({ status: 'approved', approved_by: DONO });
      expect(
        await s.valor('select count(*)::int from mkt.platform_executions where traffic_action_id = $1', [
          lance.id,
        ]),
      ).toBe(0);
    });
  });

  it('"Tentar de novo" no que falhou: o dono aprova de novo e uma execução nova vai para a fila', async () => {
    await caso(db, postgres, async (s) => {
      // A execução bloqueada volta para a fila, o executor manda, a plataforma recusa: a ação falha.
      const v = await versao(s, 'mkt.platform_executions', EXECUCAO_DA_ACAO);
      await chamar(s, DONO_2F, 'select api.retry_execution($1, $2)', [EXECUCAO_DA_ACAO, v]);
      await peloExecutor(
        s,
        `update mkt.platform_executions set status = 'sent', attempts = 1, sent_at = now() where id = '${EXECUCAO_DA_ACAO}'`,
      );
      await peloExecutor(
        s,
        `update mkt.traffic_actions set status = 'running' where id = '${ACAO_APROVADA}'`,
      );
      await peloExecutor(
        s,
        `update mkt.platform_executions set status = 'failed', failed_at = now(), http_status = 400,
                error_code = 'INVALID_PARAMETER' where id = '${EXECUCAO_DA_ACAO}'`,
      );
      await peloExecutor(s, `update mkt.traffic_actions set status = 'failed' where id = '${ACAO_APROVADA}'`);
      expect(await lerAcao(s, ACAO_APROVADA)).toMatchObject({ status: 'failed' });

      const lida = await versao(s, 'mkt.traffic_actions', ACAO_APROVADA);
      await chamar(s, DONO_2F, 'select api.approve_action($1, $2)', [ACAO_APROVADA, lida]);
      expect(await lerAcao(s, ACAO_APROVADA)).toMatchObject({ status: 'approved', approved_by: DONO });
      expect(
        await s.linhas(
          `select status::text, operation::text from mkt.platform_executions
            where traffic_action_id = $1 order by created_at, status`,
          [ACAO_APROVADA],
        ),
      ).toEqual([
        { status: 'failed', operation: 'pause' },
        { status: 'queued', operation: 'pause' },
      ]);
    });
  });
});

describe('descartar (api.discard_action)', () => {
  it('RLS-16: sem motivo, com texto curto ou com dado pessoal, PT422 e nada muda; com motivo e texto, descarta e cancela a execução que não saiu', async () => {
    await caso(db, postgres, async (s) => {
      const v = await versao(s, 'mkt.traffic_actions', ACAO_APROVADA);
      const descartar = 'select * from api.discard_action($1, $2, $3, $4)';
      const tentativas: Array<[string | null, string | null, string]> = [
        [null, 'O gestor já pausou na plataforma.', 'reason'],
        ['other', 'Curto', 'note'],
        ['other', null, 'note'],
        ['other', 'Combinado com (11) 98765-4321 por telefone.', 'note'],
      ];
      for (const [motivo, nota, detalhe] of tentativas) {
        const e = await recusa(s, 'PT422', DONO_2F, descartar, [ACAO_APROVADA, motivo, nota, v]);
        expect([e.message, e.detail]).toEqual(['TRF-422', detalhe]);
      }
      expect(await lerAcao(s, ACAO_APROVADA)).toMatchObject({ status: 'approved', updated_at: v });

      await chamar(s, DONO_2F, descartar, [
        ACAO_APROVADA,
        'not_worth_it',
        'O gestor já pausou na plataforma.',
        v,
      ]);
      expect(await lerAcao(s, ACAO_APROVADA)).toMatchObject({
        status: 'discarded',
        discarded_by: DONO,
        discard_reason: 'not_worth_it',
        discard_note: 'O gestor já pausou na plataforma.',
        approved_by: DONO,
      });
      expect(await lerExecucao(s, EXECUCAO_DA_ACAO)).toMatchObject({
        status: 'cancelled',
        blocked_reason: null,
        cancelada: true,
      });
      const diario = await diarioDaAcao(s, ACAO_APROVADA);
      expect(diario.slice(-2).map((l) => [l.event, l.actor_id, l.changes])).toEqual([
        [
          'action_discarded',
          DONO,
          { status: { before: 'approved', after: 'discarded' }, discard_reason: 'not_worth_it' },
        ],
        ['execution_status_changed', DONO, { status: { before: 'blocked', after: 'cancelled' } }],
      ]);
    });
  });

  it('RLS-06: o gestor não descarta (PT403); com o updated_at antigo, PT409', async () => {
    await caso(db, postgres, async (s) => {
      const v = await versao(s, 'mkt.traffic_actions', IDEIA_DO_CLAUDE);
      const args = [IDEIA_DO_CLAUDE, 'other', 'Descarte tentado pelo gestor.', v];
      const sql = 'select api.discard_action($1, $2, $3, $4)';
      expect((await recusa(s, 'PT403', GESTOR_LOGADO, sql, args)).message).toBe('TRF-403');
      expect((await recusa(s, 'PT403', DONO_1F, sql, args)).message).toBe('TRF-403');
      const antigo = new Date(v.getTime() - 1);
      expect((await recusa(s, 'PT409', DONO_2F, sql, [...args.slice(0, 3), antigo])).message).toBe('TRF-409');
      expect(await lerAcao(s, IDEIA_DO_CLAUDE)).toMatchObject({ status: 'idea' });
    });
  });

  it('com a execução já enviada à plataforma, nem descartar nem marcar como feita (PT422)', async () => {
    await caso(db, postgres, async (s) => {
      const v = await versao(s, 'mkt.platform_executions', EXECUCAO_DA_ACAO);
      await chamar(s, DONO_2F, 'select api.retry_execution($1, $2)', [EXECUCAO_DA_ACAO, v]);
      await peloExecutor(
        s,
        `update mkt.platform_executions set status = 'sent', attempts = 1, sent_at = now() where id = '${EXECUCAO_DA_ACAO}'`,
      );
      const a = await versao(s, 'mkt.traffic_actions', ACAO_APROVADA);
      const e = await recusa(s, 'PT422', DONO_2F, 'select api.discard_action($1, $2, $3, $4)', [
        ACAO_APROVADA,
        'other',
        'Descartada depois de enviada.',
        a,
      ]);
      expect(e.message).toBe('TRF-422');
      expect(
        (
          await recusa(s, 'PT422', GESTOR_LOGADO, 'select api.mark_action_done($1, $2, $3)', [
            ACAO_APROVADA,
            'Feita na plataforma.',
            a,
          ])
        ).message,
      ).toBe('TRF-422');
      expect(await lerExecucao(s, EXECUCAO_DA_ACAO)).toMatchObject({ status: 'sent' });
    });
  });
});

describe('marcar como feita (api.mark_action_done)', () => {
  it('RLS-12: a ideia que não é pendência dá PT422; controle: o gestor fecha a pendência, sem aprovador', async () => {
    await caso(db, postgres, async (s) => {
      const ideia = await versao(s, 'mkt.traffic_actions', IDEIA_DO_CLAUDE);
      const e = await recusa(s, 'PT422', GESTOR_LOGADO, 'select api.mark_action_done($1, $2, $3)', [
        IDEIA_DO_CLAUDE,
        'Feita fora da central.',
        ideia,
      ]);
      expect(e.message).toBe('TRF-422');
      expect(await lerAcao(s, IDEIA_DO_CLAUDE)).toMatchObject({ status: 'idea' });

      const p = await versao(s, 'mkt.traffic_actions', PENDENCIA);
      await chamar(s, GESTOR_LOGADO, 'select api.mark_action_done($1, $2, $3)', [
        PENDENCIA,
        'GA4 ligado no site da cs.',
        p,
      ]);
      expect(await lerAcao(s, PENDENCIA)).toMatchObject({
        status: 'done',
        done_via: 'manual',
        done_by: GESTOR,
        approved_by: null,
        result: 'GA4 ligado no site da cs.',
        feita: true,
      });
    });
  });

  it('a aprovada com a execução bloqueada: o gestor marca como feita, a execução é cancelada e o aprovador fica o mesmo', async () => {
    await caso(db, postgres, async (s) => {
      const v = await versao(s, 'mkt.traffic_actions', ACAO_APROVADA);
      await chamar(s, GESTOR_LOGADO, 'select api.mark_action_done($1, $2, $3)', [
        ACAO_APROVADA,
        'Pausada no gerenciador da Meta.',
        v,
      ]);
      expect(await lerAcao(s, ACAO_APROVADA)).toMatchObject({
        status: 'done',
        done_by: GESTOR,
        approved_by: DONO,
      });
      expect(await lerExecucao(s, EXECUCAO_DA_ACAO)).toMatchObject({ status: 'cancelled' });
      expect((await diarioDaAcao(s, ACAO_APROVADA)).slice(-2).map((l) => [l.event, l.actor_id])).toEqual([
        ['action_done', GESTOR],
        ['execution_status_changed', GESTOR],
      ]);
    });
  });

  it('resultado curto ou com dado pessoal: PT422 e nada muda; perfil inativo não marca (PT403)', async () => {
    await caso(db, postgres, async (s) => {
      const v = await versao(s, 'mkt.traffic_actions', PENDENCIA);
      for (const resultado of ['Ok', 'Feito, avisado em gestor@exemplo.invalid']) {
        const e = await recusa(s, 'PT422', GESTOR_LOGADO, 'select api.mark_action_done($1, $2, $3)', [
          PENDENCIA,
          resultado,
          v,
        ]);
        expect([e.message, e.detail]).toEqual(['TRF-422', 'result']);
      }
      expect(await lerAcao(s, PENDENCIA)).toMatchObject({ status: 'idea', updated_at: v });
    });
  });
});

describe('"Tentar de novo" numa execução (api.retry_execution)', () => {
  it('RLS-06 e RLS-35: o gestor e o dono sem o segundo fator não pedem (PT403); controle: o dono devolve a bloqueada para a fila', async () => {
    await caso(db, postgres, async (s) => {
      const v = await versao(s, 'mkt.platform_executions', EXECUCAO_DA_ACAO);
      for (const quem of [GESTOR_LOGADO, DONO_1F]) {
        const e = await recusa(s, 'PT403', quem, 'select api.retry_execution($1, $2)', [EXECUCAO_DA_ACAO, v]);
        expect(e.message).toBe('TRF-403');
      }
      expect(await lerExecucao(s, EXECUCAO_DA_ACAO)).toMatchObject({ status: 'blocked' });

      const e = primeira(
        await chamar(s, DONO_2F, 'select * from api.retry_execution($1, $2)', [EXECUCAO_DA_ACAO, v]),
      );
      expect(e).toMatchObject({ status: 'queued', blocked_reason: null });
      expect(
        await s.linhas(
          `select event::text, actor_id::text, traffic_action_id::text from mkt.traffic_log
            where platform_execution_id = $1 and seq > (select max(seq) - 2 from mkt.traffic_log) order by seq`,
          [EXECUCAO_DA_ACAO],
        ),
      ).toEqual([
        { event: 'execution_status_changed', actor_id: DONO, traffic_action_id: ACAO_APROVADA },
        { event: 'execution_retried', actor_id: DONO, traffic_action_id: ACAO_APROVADA },
      ]);
    });
  });

  it('só a bloqueada, com a origem ainda valendo: a confirmada não volta (PT422); o teto volta com o limite dele vigente', async () => {
    await caso(db, postgres, async (s) => {
      const confirmada = await versao(s, 'mkt.platform_executions', EXECUCAO_DA_PARADA);
      const e = await recusa(s, 'PT422', DONO_2F, 'select api.retry_execution($1, $2)', [
        EXECUCAO_DA_PARADA,
        confirmada,
      ]);
      expect(e.message).toBe('TRF-422');
      const teto = await versao(s, 'mkt.platform_executions', EXECUCAO_DO_TETO);
      await chamar(s, DONO_2F, 'select api.retry_execution($1, $2)', [EXECUCAO_DO_TETO, teto]);
      expect(await lerExecucao(s, EXECUCAO_DO_TETO)).toMatchObject({ status: 'queued' });
    });
  });

  it('o teto da conta com outro limite vigente não volta para a fila (PT422)', async () => {
    await caso(db, postgres, async (s) => {
      // Um limite novo no dia seguinte ao da gravação, e o relógio dos testes depois dele.
      await s.exec(`
        insert into mkt.spend_limits (ad_account_id, brand_id, platform, monthly_limit_cents, valid_from_on, set_by)
        select ad_account_id, brand_id, platform, 900000, valid_from_on + 1, set_by
          from mkt.spend_limits where id = '${LIMITE_META_CS}';
        insert into test.clock (now_at)
        select (valid_from_on + 2)::timestamp at time zone 'America/Sao_Paulo' + interval '12 hours'
          from mkt.spend_limits where id = '${LIMITE_META_CS}';`);
      const teto = await versao(s, 'mkt.platform_executions', EXECUCAO_DO_TETO);
      const e = await recusa(s, 'PT422', DONO_2F, 'select api.retry_execution($1, $2)', [
        EXECUCAO_DO_TETO,
        teto,
      ]);
      expect(e.message).toBe('TRF-422');
      expect(await lerExecucao(s, EXECUCAO_DO_TETO)).toMatchObject({ status: 'blocked' });
    });
  });

  it('a reativação de uma parada desfeita volta para a fila; com o updated_at antigo, PT409', async () => {
    await caso(db, postgres, async (s) => {
      const parada = await versao(s, 'mkt.traffic_stops', PARADA);
      await chamar(s, DONO_1F, 'select api.undo_stop($1, $2)', [PARADA, parada]);
      await s.como(postgres);
      const reativar = await s.valor<string>(
        `select e.id::text from mkt.platform_executions e
           join mkt.traffic_stop_campaigns sc on sc.id = e.traffic_stop_campaign_id
          where sc.traffic_stop_id = $1 and e.operation = 'activate'`,
        [PARADA],
      );
      await peloExecutor(
        s,
        `update mkt.platform_executions set status = 'blocked', blocked_reason = 'over_spend_limit' where id = '${reativar}'`,
      );
      const v = await versao(s, 'mkt.platform_executions', reativar);
      const antigo = new Date(v.getTime() - 1000);
      expect(
        (await recusa(s, 'PT409', DONO_2F, 'select api.retry_execution($1, $2)', [reativar, antigo])).message,
      ).toBe('TRF-409');
      await chamar(s, DONO_2F, 'select api.retry_execution($1, $2)', [reativar, v]);
      expect(await lerExecucao(s, reativar)).toMatchObject({ status: 'queued', operation: 'activate' });
    });
  });
});

describe('estratégia (api.save_strategy)', () => {
  const salvar = 'select * from api.save_strategy($1, $2, $3, $4, $5, $6, $7, $8)';

  it('o gestor salva a estratégia do mês: só o que mudou vai para o diário; com o updated_at antigo, PT409', async () => {
    await caso(db, postgres, async (s) => {
      const atual = primeira(
        await s.linhas<{ month_on: string; body: string; updated_at: Date }>(
          'select month_on::text, body, updated_at from mkt.traffic_strategies where id = $1',
          [ESTRATEGIA_CS],
        ),
      );
      const args = (verba: number, versaoLida: Date) => [
        'cs',
        atual.month_on,
        atual.body,
        verba,
        30000,
        4000,
        50,
        versaoLida,
      ];
      const nova = primeira(await chamar(s, GESTOR_LOGADO, salvar, args(2000000, atual.updated_at)));
      expect(nova).toMatchObject({ id: ESTRATEGIA_CS, budget_cents: 2000000, updated_by: GESTOR });
      expect(
        await s.linhas(
          `select actor_id::text, changes from mkt.traffic_log
            where traffic_strategy_id = $1 order by seq desc limit 1`,
          [ESTRATEGIA_CS],
        ),
      ).toEqual([{ actor_id: GESTOR, changes: { budget_cents: { before: 1500000, after: 2000000 } } }]);

      // A versão que a tela leu antes da gravação já não vale.
      expect((await recusa(s, 'PT409', DONO_1F, salvar, args(2500000, atual.updated_at))).message).toBe(
        'TRF-409',
      );
      // Nada mudou: nada é gravado.
      const logs = await contar(s, 'mkt.traffic_log');
      await chamar(s, DONO_1F, salvar, args(2000000, nova.updated_at as Date));
      await s.como(postgres);
      expect(await contar(s, 'mkt.traffic_log')).toBe(logs);
    });
  });

  it('mês sem estratégia: nasce a linha; texto com dado pessoal, mês fora do dia 1 e meta negativa dão PT422', async () => {
    await caso(db, postgres, async (s) => {
      const mes = await s.valor<string>(
        `select (month_on + interval '1 month')::date::text from mkt.traffic_strategies where id = $1`,
        [ESTRATEGIA_CS],
      );
      const nova = primeira(
        await chamar(s, GESTOR_LOGADO, salvar, [
          'plumene',
          mes,
          'Testar vídeo curto no TikTok.',
          800000,
          null,
          null,
          null,
          null,
        ]),
      );
      expect(nova).toMatchObject({
        budget_cents: 800000,
        updated_by: GESTOR,
        body: 'Testar vídeo curto no TikTok.',
      });
      expect(
        await s.valor(`select changes from mkt.traffic_log where traffic_strategy_id = $1`, [nova.id]),
      ).toEqual({
        body: { before: null, after: 'Testar vídeo curto no TikTok.' },
        budget_cents: { before: null, after: 800000 },
      });

      const tentativas: Array<[unknown[], string]> = [
        [
          ['cs', mes, 'Falar com a lojista no (11) 98765-4321.', null, null, null, null, null],
          'personal_data',
        ],
        [['cs', '2026-11-15', '', null, null, null, null, null], 'month'],
        [['cs', mes, '', -1, null, null, null, null], 'targets'],
        [['cs', mes, '', null, null, 0, null, null], 'targets'],
      ];
      for (const [args, detalhe] of tentativas) {
        const e = await recusa(s, 'PT422', GESTOR_LOGADO, salvar, args);
        expect([e.message, e.detail]).toEqual(['TRF-422', detalhe]);
      }
    });
  });
});

describe('limite de gasto (api.set_spend_limit)', () => {
  const mudar = 'select * from api.set_spend_limit($1, $2, $3)';

  /** Gasto conhecido na conta Meta da cs: 3.500,00 no mês e um dia do mês anterior, que não conta. */
  const GASTO_DO_MES = `
    delete from mkt.ad_campaign_daily where campaign_id in ('${CAMPANHA_HUMANO_CS}', '${CAMPANHA_CLAUDE_CS}');
    insert into mkt.ad_campaign_daily (campaign_id, brand_id, platform, metric_on, spend_cents, source, fetched_at)
    select c.id, c.brand_id, c.platform, d.dia, d.gasto, c.source, now()
      from mkt.campaigns c
      join (values ('${CAMPANHA_HUMANO_CS}'::uuid, mkt.today(), 300000),
                   ('${CAMPANHA_CLAUDE_CS}'::uuid, mkt.today(), 50000),
                   ('${CAMPANHA_HUMANO_CS}'::uuid, date_trunc('month', mkt.today()::timestamp)::date - 1, 999999))
           as d(campanha, dia, gasto) on d.campanha = c.id;`;

  it('RLS-07 e RLS-35: o gestor e o dono sem o segundo fator não mudam o limite (PT403)', async () => {
    await caso(db, postgres, async (s) => {
      const v = await versao(s, 'mkt.spend_limits', LIMITE_META_CS);
      for (const quem of [GESTOR_LOGADO, DONO_1F]) {
        expect((await recusa(s, 'PT403', quem, mudar, [CONTA_META_CS, 100000, v])).message).toBe('TRF-403');
      }
      await s.como(postgres);
      expect(await contar(s, 'mkt.spend_limits')).toBe(1);
    });
  });

  it('o dono muda o limite da conta Meta: vale de hoje, vai para o diário e regrava o teto da conta com a sobra do mês', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(GASTO_DO_MES);
      const v = await versao(s, 'mkt.spend_limits', LIMITE_META_CS);
      const novo = primeira(await chamar(s, DONO_2F, mudar, [CONTA_META_CS, 1000000, v]));
      expect(novo).toMatchObject({
        monthly_limit_cents: 1000000,
        set_by: DONO,
        ad_account_id: CONTA_META_CS,
      });
      await s.como(postgres);
      expect(
        await s.valor('select valid_from_on = mkt.today() from mkt.spend_limits where id = $1', [novo.id]),
      ).toBe(true);
      expect(
        await s.linhas(
          `select event::text, actor_id::text, changes from mkt.traffic_log
            where spend_limit_id = $1 and event = 'limit_changed' order by seq desc limit 1`,
          [novo.id],
        ),
      ).toEqual([
        {
          event: 'limit_changed',
          actor_id: DONO,
          changes: { monthly_limit_cents: { before: 1500000, after: 1000000 } },
        },
      ]);
      // A gravação antiga do teto, que não saiu, foi cancelada; a nova leva a sobra: 10.000,00 − 3.500,00.
      expect(await lerExecucao(s, EXECUCAO_DO_TETO)).toMatchObject({ status: 'cancelled' });
      expect(
        await s.linhas(
          `select status::text, spend_limit_id::text, request from mkt.platform_executions
            where operation = 'set_account_spend_cap' and status = 'queued'`,
        ),
      ).toEqual([
        {
          status: 'queued',
          spend_limit_id: novo.id,
          request: { spend_cap: 6500, spend_cap_action: 'reset' },
        },
      ]);
    });
  });

  it('a trava otimista é a da linha vigente; o mesmo limite não muda nada; no Google não há teto a gravar', async () => {
    await caso(db, postgres, async (s) => {
      const v = await versao(s, 'mkt.spend_limits', LIMITE_META_CS);
      for (const lido of [new Date(v.getTime() - 1000), null]) {
        expect((await recusa(s, 'PT409', DONO_2F, mudar, [CONTA_META_CS, 100000, lido])).message).toBe(
          'TRF-409',
        );
      }
      const logs = await contar(s, 'mkt.traffic_log');
      const mesmo = primeira(await chamar(s, DONO_2F, mudar, [CONTA_META_CS, 1500000, v]));
      expect(mesmo).toMatchObject({ id: LIMITE_META_CS, monthly_limit_cents: 1500000 });
      await s.como(postgres);
      expect(await contar(s, 'mkt.traffic_log')).toBe(logs);

      // A conta do Google ainda não tem limite: a tela manda nulo. Com outro valor, a tela leu outra coisa.
      expect((await recusa(s, 'PT409', DONO_2F, mudar, [CONTA_GOOGLE_PL, 500000, v])).message).toBe(
        'TRF-409',
      );
      const google = primeira(await chamar(s, DONO_2F, mudar, [CONTA_GOOGLE_PL, 500000, null]));
      expect(google).toMatchObject({ monthly_limit_cents: 500000, platform: 'google' });
      expect(
        await s.valor('select count(*)::int from mkt.platform_executions where spend_limit_id = $1', [
          google.id,
        ]),
      ).toBe(0);
    });
  });

  it('sem a credencial de escrita da Meta, o limite muda e nenhum teto é gravado', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(`delete from private.connector_credentials where id = '${CREDENCIAL_DE_ESCRITA}'`);
      const v = await versao(s, 'mkt.spend_limits', LIMITE_META_CS);
      await chamar(s, DONO_2F, mudar, [CONTA_META_CS, 1200000, v]);
      await s.como(postgres);
      expect(
        await s.valor(
          `select count(*)::int from mkt.platform_executions
            where operation = 'set_account_spend_cap' and status = 'queued'`,
        ),
      ).toBe(0);
    });
  });

  it('valor negativo ou conta desligada: PT422; conta que não existe: PT404', async () => {
    await caso(db, postgres, async (s) => {
      const v = await versao(s, 'mkt.spend_limits', LIMITE_META_CS);
      const e = await recusa(s, 'PT422', DONO_2F, mudar, [CONTA_META_CS, -1, v]);
      expect([e.message, e.detail]).toEqual(['TRF-422', 'limit']);
      await s.como(postgres);
      await s.exec(`update mkt.ad_accounts set is_active = false where id = '${CONTA_GOOGLE_PL}'`);
      expect((await recusa(s, 'PT422', DONO_2F, mudar, [CONTA_GOOGLE_PL, 1000, null])).detail).toBe(
        'account',
      );
      expect((await recusa(s, 'PT404', DONO_2F, mudar, [NENHUMA, 1000, null])).message).toBe('TRF-404');
    });
  });
});

describe('"Parar tudo" e desfazer (api.stop_all e api.undo_stop)', () => {
  const parar = 'select api.stop_all($1, $2) as id';

  /** A campanha passa para o Claude pela função de verdade (o dono, com o segundo fator). */
  async function paraOClaude(s: Sessao, campanha: string): Promise<void> {
    const v = await versao(s, 'mkt.campaigns', campanha);
    await chamar(s, DONO_2F, 'select api.change_campaign_operator($1, $2, $3, $4, $5)', [
      campanha,
      'claude',
      'handover_to_claude',
      null,
      v,
    ]);
  }

  it('RLS-07: o gestor não para nem desfaz (PT403)', async () => {
    await caso(db, postgres, async (s) => {
      await paraOClaude(s, CAMPANHA_HUMANO_PL);
      expect((await recusa(s, 'PT403', GESTOR_LOGADO, parar, ['plumene', 1])).message).toBe('STP-403');
      const v = await versao(s, 'mkt.traffic_stops', PARADA);
      expect(
        (await recusa(s, 'PT403', GESTOR_LOGADO, 'select api.undo_stop($1, $2)', [PARADA, v])).message,
      ).toBe('STP-403');
      await s.como(postgres);
      expect(await contar(s, 'mkt.traffic_stops')).toBe(1);
    });
  });

  it('RLS-35, o controle: o dono sem o segundo fator para tudo; a parada, a campanha, a pausa dela e o diário', async () => {
    await caso(db, postgres, async (s) => {
      await paraOClaude(s, CAMPANHA_HUMANO_PL);
      const parada = String((await chamar<{ id: string }>(s, DONO_1F, parar, ['plumene', 1]))[0]?.id);
      await s.como(postgres);
      expect(
        await s.linhas(
          `select b.code::text as marca, s.requested_by::text, s.undone_at, s.scope::text
             from mkt.traffic_stops s join mkt.brands b on b.id = s.brand_id where s.id = $1`,
          [parada],
        ),
      ).toEqual([{ marca: 'plumene', requested_by: DONO, undone_at: null, scope: 'claude_only' }]);
      expect(
        await s.linhas(
          `select sc.campaign_id::text, sc.status_before::text, e.operation::text, e.status::text, e.request,
                  e.idempotency_key = 'stop:' || sc.id || ':pause' as chave
             from mkt.traffic_stop_campaigns sc
             join mkt.platform_executions e on e.traffic_stop_campaign_id = sc.id
            where sc.traffic_stop_id = $1`,
          [parada],
        ),
      ).toEqual([
        {
          campaign_id: CAMPANHA_HUMANO_PL,
          status_before: 'active',
          operation: 'pause',
          status: 'queued',
          request: { status: 'PAUSED' },
          chave: true,
        },
      ]);
      expect(
        await s.linhas(
          `select actor_id::text from mkt.traffic_log where traffic_stop_id = $1 and event = 'stop_all'`,
          [parada],
        ),
      ).toEqual([{ actor_id: DONO }]);
      // O status da campanha só muda quando a plataforma confirmar a pausa.
      expect(
        await s.valor('select status::text from mkt.campaigns where id = $1', [CAMPANHA_HUMANO_PL]),
      ).toBe('active');
    });
  });

  it('a contagem é a que a tela mostrou (PT409); sem campanha para parar, PT422; a segunda parada não pega a da primeira', async () => {
    await caso(db, postgres, async (s) => {
      // A campanha do Claude da cs está pausada e na parada aberta: nada a parar na cs, mesmo ativa de novo.
      expect((await recusa(s, 'PT422', DONO_1F, parar, ['cs', 0])).message).toBe('STP-422');
      await s.como(postgres);
      await s.exec(`update mkt.campaigns set status = 'active' where id = '${CAMPANHA_CLAUDE_CS}'`);
      expect((await recusa(s, 'PT422', DONO_1F, parar, ['cs', 1])).message).toBe('STP-422');

      await paraOClaude(s, CAMPANHA_HUMANO_PL);
      expect((await recusa(s, 'PT409', DONO_1F, parar, ['plumene', 2])).message).toBe('STP-409');
      await chamar(s, DONO_1F, parar, [null, 1]);
      expect((await recusa(s, 'PT422', DONO_1F, parar, [null, 1])).message).toBe('STP-422');
      await s.como(postgres);
      expect(await contar(s, 'mkt.traffic_stops')).toBe(2);
    });
  });

  it('com a parada, o que pode aumentar o gasto sai da fila (bloqueado, "stopped"); pausar e reduzir continuam', async () => {
    await caso(db, postgres, async (s) => {
      // Na fila da cs: o aumento do orçamento do Claude (4.500 sobre 3.000), uma redução e uma pausa.
      const ideia = await versao(s, 'mkt.traffic_actions', IDEIA_DO_CLAUDE);
      await chamar(s, DONO_2F, 'select api.approve_action($1, $2)', [IDEIA_DO_CLAUDE, ideia]);
      const reduzir = primeira(
        await chamar(
          s,
          DONO_2F,
          ...propor({
            campanha: CAMPANHA_CLAUDE_CS,
            tipo: 'budget',
            titulo: 'Reduzir o remarketing',
            params: { daily_budget_cents: 2000 },
            aprovar: true,
          }),
        ),
      );
      const pausar = primeira(await chamar(s, DONO_2F, ...propor({ aprovar: true })));
      await s.como(postgres);
      const execucoes = await s.linhas<{ acao: string; id: string; aumenta: boolean }>(
        `select e.traffic_action_id::text as acao, e.id::text, mkt.execution_may_increase_spend(e.id) as aumenta
           from mkt.platform_executions e where e.traffic_action_id = any($1::uuid[]) order by 1`,
        [[IDEIA_DO_CLAUDE, reduzir.id, pausar.id]],
      );
      expect(Object.fromEntries(execucoes.map((e) => [e.acao, e.aumenta]))).toEqual({
        [IDEIA_DO_CLAUDE]: true,
        [String(reduzir.id)]: false,
        [String(pausar.id)]: false,
      });
      expect(await s.valor(`select mkt.execution_may_increase_spend('${EXECUCAO_DO_TETO}')`)).toBe(false);

      await paraOClaude(s, CAMPANHA_HUMANO_CS);
      await chamar(s, DONO_1F, parar, ['cs', 1]);
      await s.como(postgres);
      const depois = await s.linhas<{ acao: string; status: string; blocked_reason: string | null }>(
        `select traffic_action_id::text as acao, status::text, blocked_reason::text
           from mkt.platform_executions where traffic_action_id = any($1::uuid[])`,
        [[IDEIA_DO_CLAUDE, reduzir.id, pausar.id]],
      );
      expect(Object.fromEntries(depois.map((e) => [e.acao, [e.status, e.blocked_reason]]))).toEqual({
        [IDEIA_DO_CLAUDE]: ['blocked', 'stopped'],
        [String(reduzir.id)]: ['queued', null],
        [String(pausar.id)]: ['queued', null],
      });
    });
  });

  it('desfazer: reativa só a campanha que a última leitura mostra pausada; desfeita não se desfaz de novo', async () => {
    await caso(db, postgres, async (s) => {
      const v = await versao(s, 'mkt.traffic_stops', PARADA);
      expect(
        (
          await recusa(s, 'PT409', DONO_1F, 'select api.undo_stop($1, $2)', [
            PARADA,
            new Date(v.getTime() - 1),
          ])
        ).message,
      ).toBe('STP-409');
      const desfeita = primeira(await chamar(s, DONO_1F, 'select * from api.undo_stop($1, $2)', [PARADA, v]));
      expect(desfeita).toMatchObject({ id: PARADA, undone_by: DONO });
      await s.como(postgres);
      expect(
        await s.linhas(
          `select e.campaign_id::text, e.operation::text, e.status::text, e.request
             from mkt.platform_executions e
             join mkt.traffic_stop_campaigns sc on sc.id = e.traffic_stop_campaign_id
            where sc.traffic_stop_id = $1 and e.operation = 'activate'`,
          [PARADA],
        ),
      ).toEqual([
        {
          campaign_id: CAMPANHA_CLAUDE_CS,
          operation: 'activate',
          status: 'queued',
          request: { status: 'ACTIVE' },
        },
      ]);
      expect(
        await s.valor(
          `select count(*)::int from mkt.traffic_log where traffic_stop_id = $1 and event = 'stop_undone'`,
          [PARADA],
        ),
      ).toBe(1);
      expect(
        (await recusa(s, 'PT422', DONO_1F, 'select api.undo_stop($1, $2)', [PARADA, desfeita.updated_at]))
          .message,
      ).toBe('STP-422');
    });
  });

  it('desfazer antes de a pausa sair: a pausa é cancelada e a campanha, que não pausou, não é reativada', async () => {
    await caso(db, postgres, async (s) => {
      await paraOClaude(s, CAMPANHA_HUMANO_PL);
      const parada = String((await chamar<{ id: string }>(s, DONO_1F, parar, ['plumene', 1]))[0]?.id);
      const v = await versao(s, 'mkt.traffic_stops', parada);
      await chamar(s, DONO_1F, 'select api.undo_stop($1, $2)', [parada, v]);
      await s.como(postgres);
      expect(
        await s.linhas(
          `select e.operation::text, e.status::text from mkt.platform_executions e
             join mkt.traffic_stop_campaigns sc on sc.id = e.traffic_stop_campaign_id
            where sc.traffic_stop_id = $1`,
          [parada],
        ),
      ).toEqual([{ operation: 'pause', status: 'cancelled' }]);
    });
  });

  it('a campanha que está em outra parada aberta não é reativada', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(`
        insert into mkt.traffic_stops (id, brand_id, requested_by)
        select '00000000-0000-4000-8000-000000000391', brand_id, '${DONO}' from mkt.campaigns where id = '${CAMPANHA_CLAUDE_CS}';
        insert into mkt.traffic_stop_campaigns (traffic_stop_id, campaign_id, brand_id, status_before)
        select '00000000-0000-4000-8000-000000000391', id, brand_id, 'active' from mkt.campaigns
         where id = '${CAMPANHA_CLAUDE_CS}';`);
      const v = await versao(s, 'mkt.traffic_stops', PARADA);
      await chamar(s, DONO_1F, 'select api.undo_stop($1, $2)', [PARADA, v]);
      await s.como(postgres);
      expect(
        await s.valor(
          `select count(*)::int from mkt.platform_executions where operation = 'activate' and campaign_id = $1`,
          [CAMPANHA_CLAUDE_CS],
        ),
      ).toBe(0);
    });
  });
});

describe('operador da campanha (api.change_campaign_operator)', () => {
  const trocar = 'select * from api.change_campaign_operator($1, $2, $3, $4, $5)';

  it('RLS-07 e RLS-35: o gestor e o dono sem o segundo fator não trocam (PT403)', async () => {
    await caso(db, postgres, async (s) => {
      const v = await versao(s, 'mkt.campaigns', CAMPANHA_HUMANO_CS);
      for (const quem of [GESTOR_LOGADO, DONO_1F]) {
        const e = await recusa(s, 'PT403', quem, trocar, [
          CAMPANHA_HUMANO_CS,
          'claude',
          'handover_to_claude',
          null,
          v,
        ]);
        expect(e.message).toBe('TRF-403');
      }
      expect(
        await s.valor('select managed_by::text from mkt.campaigns where id = $1', [CAMPANHA_HUMANO_CS]),
      ).toBe('human');
    });
  });

  it('o dono passa a campanha para o Claude e de volta: o histórico guarda quem e por quê, e o diário o antes e o depois', async () => {
    await caso(db, postgres, async (s) => {
      const v = await versao(s, 'mkt.campaigns', CAMPANHA_HUMANO_CS);
      const c = primeira(
        await chamar(s, DONO_2F, trocar, [CAMPANHA_HUMANO_CS, 'claude', 'handover_to_claude', null, v]),
      );
      expect(c).toMatchObject({ managed_by: 'claude' });
      await chamar(s, DONO_2F, trocar, [
        CAMPANHA_HUMANO_CS,
        'human',
        'other',
        'O gestor vai testar criativos novos.',
        c.updated_at,
      ]);
      await s.como(postgres);
      expect(
        await s.linhas(
          `select from_operator::text, to_operator::text, reason::text, note, actor_kind::text, changed_by::text
             from mkt.campaign_managed_by_history where campaign_id = $1 and actor_kind = 'user'
            order by changed_at, to_operator`,
          [CAMPANHA_HUMANO_CS],
        ),
      ).toEqual([
        {
          from_operator: 'human',
          to_operator: 'claude',
          reason: 'handover_to_claude',
          note: null,
          actor_kind: 'user',
          changed_by: DONO,
        },
        {
          from_operator: 'claude',
          to_operator: 'human',
          reason: 'other',
          note: 'O gestor vai testar criativos novos.',
          actor_kind: 'user',
          changed_by: DONO,
        },
      ]);
      expect(
        await s.linhas(
          `select actor_id::text, changes from mkt.traffic_log
            where campaign_id = $1 and event = 'operator_changed' order by seq`,
          [CAMPANHA_HUMANO_CS],
        ),
      ).toEqual([
        {
          actor_id: DONO,
          changes: { managed_by: { before: 'human', after: 'claude' }, reason: 'handover_to_claude' },
        },
        { actor_id: DONO, changes: { managed_by: { before: 'claude', after: 'human' }, reason: 'other' } },
      ]);
      // A chave não fica ligada na transação depois da função.
      expect(await s.valor(`select current_setting('mkt.allow_operator_change', true)`)).toBe('off');
    });
  });

  it('o mesmo operador, motivo que não bate ou "outro" sem nota: PT422; com o updated_at antigo, PT409; nada muda', async () => {
    await caso(db, postgres, async (s) => {
      const v = await versao(s, 'mkt.campaigns', CAMPANHA_HUMANO_CS);
      const tentativas: Array<[unknown[], string]> = [
        [[CAMPANHA_HUMANO_CS, 'human', 'correction', null, v], 'operator'],
        [[CAMPANHA_HUMANO_CS, 'claude', 'back_to_human', null, v], 'reason'],
        [[CAMPANHA_HUMANO_CS, 'claude', 'imported', null, v], 'reason'],
        [[CAMPANHA_HUMANO_CS, 'claude', null, null, v], 'reason'],
        [[CAMPANHA_HUMANO_CS, 'claude', 'other', null, v], 'note'],
        [[CAMPANHA_HUMANO_CS, 'claude', 'other', 'Pedido de fulano@exemplo.invalid', v], 'note'],
      ];
      for (const [args, detalhe] of tentativas) {
        const e = await recusa(s, 'PT422', DONO_2F, trocar, args);
        expect([e.message, e.detail], detalhe).toEqual(['TRF-422', detalhe]);
      }
      const e = await recusa(s, 'PT409', DONO_2F, trocar, [
        CAMPANHA_HUMANO_CS,
        'claude',
        'correction',
        null,
        new Date(v.getTime() - 1000),
      ]);
      expect(e.message).toBe('TRF-409');
      expect(
        (await recusa(s, 'PT404', DONO_2F, trocar, [NENHUMA, 'claude', 'correction', null, v])).message,
      ).toBe('TRF-404');
      await s.como(postgres);
      expect(
        await s.valor('select managed_by::text from mkt.campaigns where id = $1', [CAMPANHA_HUMANO_CS]),
      ).toBe('human');
    });
  });
});

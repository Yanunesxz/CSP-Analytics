// Migração 08: os sete conectores com a frequência e a folga, um trabalho por agendamento, as rodadas, os arquivos CSV,
// as credenciais (só o apontador e o estado; a de escrita sem segredo) e a fila de avisos, com as chaves de cada aviso
// (mkt.valid_notice_payload); e que ninguém da API nem dos serviços lê as credenciais ou a fila (RLS-18 e RLS-19)
// (docs/dados/tabelas.md, seção 5, e integracoes.md, seções 2.1, 12 e 18). Dados inventados de fixtures/usuarios.sql
// e fixtures/conectores.sql.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Quem,
  abrirBanco,
  anon,
  aplicarFixture,
  caso,
  lerMigracoes,
  postgres,
  servico,
  usuario,
} from './apoio/banco';
import { codigosDoDomain, consultaDe } from './apoio/catalogo';
import { CONTA_META_CS } from './apoio/marketing';
import { CREDENCIAL_DE_ESCRITA, CREDENCIAL_DE_LEITURA, RODADA_DO_CSV, ARQUIVO_CSV } from './apoio/trafego';
import { DONO, EX_GESTOR, GESTOR, SEM_PERFIL } from './apoio/usuarios';

let db: PGlite;
let conectores: string[];

beforeAll(async () => {
  db = await abrirBanco();
  await aplicarFixture(db, 'usuarios');
  await aplicarFixture(db, 'conectores');
  conectores = await codigosDoDomain(consultaDe(db), 'connector_code');
});

afterAll(async () => {
  await db.close();
});

const UM_ID = '00000000-0000-4000-8000-0000000004b1';
const conector = (codigo: string) => `(select id from mkt.connectors where code = '${codigo}')`;

describe('os conectores e os trabalhos de cada um (configuração da migração)', () => {
  /** integracoes.md, seções 1 e 2.1: a frequência de cada conector e os trabalhos agendados. */
  const ESPERADO: Record<string, { minutos: number; trabalhos: string[] }> = {
    csp360: { minutos: 5, trabalhos: ['crm_full_pass', 'crm_incremental'] },
    meta: { minutos: 60, trabalhos: ['ads_activity', 'ads_backfill', 'ads_hourly'] },
    instagram: { minutos: 60, trabalhos: ['ig_daily', 'ig_hourly'] },
    tiktok: { minutos: 60, trabalhos: ['ads_backfill', 'ads_hourly'] },
    google_ads: { minutos: 60, trabalhos: ['ads_activity', 'ads_backfill', 'ads_hourly'] },
    ga4: { minutos: 1440, trabalhos: ['ga4_daily'] },
    search_console: { minutos: 1440, trabalhos: ['gsc_daily'] },
  };
  /** O que cada trabalho promete: o incremental do CRM a cada 5 min, os de hora em hora e os diários. */
  const FREQUENCIA: Record<string, number> = {
    crm_incremental: 5,
    crm_full_pass: 1440,
    ads_hourly: 60,
    ig_hourly: 60,
    ads_backfill: 1440,
    ads_activity: 1440,
    ig_daily: 1440,
    ga4_daily: 1440,
    gsc_daily: 1440,
  };
  const folga = (minutos: number) => Math.max(5, Math.ceil(minutos / 10));

  it('as sete integrações da lista, a ligar, com a frequência e a folga de 10% da frequência (no mínimo 5 min)', async () => {
    await caso(db, postgres, async (s) => {
      const linhas = await s.linhas<{
        code: string;
        setup_state: string;
        expected_every_minutes: number;
        late_tolerance_minutes: number;
        first_success_at: Date | null;
      }>(
        `select code::text, setup_state::text, expected_every_minutes, late_tolerance_minutes, first_success_at
           from mkt.connectors order by code`,
      );
      expect(linhas.map((l) => l.code)).toEqual([...conectores].sort());
      expect(Object.keys(ESPERADO).sort()).toEqual([...conectores].sort());
      for (const l of linhas) {
        const minutos = ESPERADO[l.code]?.minutos ?? -1;
        expect(l.expected_every_minutes, l.code).toBe(minutos);
        expect(l.late_tolerance_minutes, l.code).toBe(folga(minutos));
        // A fixture ligou só a Meta, como o worker faz na primeira rodada boa.
        expect(l.setup_state, l.code).toBe(l.code === 'meta' ? 'connected' : 'not_connected');
        expect(l.first_success_at === null, l.code).toBe(l.code !== 'meta');
      }
    });
  });

  it('um trabalho por agendamento de integracoes.md, seção 2.1, com a mesma regra de folga; o CSV não tem linha', async () => {
    await caso(db, postgres, async (s) => {
      const linhas = await s.linhas<{ conector: string; job: string; minutos: number; folga: number }>(
        `select c.code::text as conector, j.job::text, j.expected_every_minutes as minutos,
                j.late_tolerance_minutes as folga
           from mkt.connector_jobs j join mkt.connectors c on c.id = j.connector_id order by 1, 2`,
      );
      expect(linhas.map((l) => `${l.conector}:${l.job}`)).toEqual(
        Object.entries(ESPERADO)
          .flatMap(([codigo, e]) => e.trabalhos.map((t) => `${codigo}:${t}`))
          .sort(),
      );
      for (const l of linhas) {
        expect(l.minutos, `${l.conector}:${l.job}`).toBe(FREQUENCIA[l.job]);
        expect(l.folga, `${l.conector}:${l.job}`).toBe(folga(l.minutos));
      }
    });
  });

  it('rodar a migração de novo não duplica as linhas nem desfaz o que mudou (a Meta continua ligada)', async () => {
    const migracao = lerMigracoes().find((m) => m.nome.endsWith('_conectores.sql'));
    expect(migracao).toBeDefined();
    await caso(db, postgres, async (s) => {
      const antes = await s.linhas(
        `select c.code::text, c.setup_state::text, count(j.id)::int as trabalhos
           from mkt.connectors c left join mkt.connector_jobs j on j.connector_id = c.id group by 1, 2 order by 1`,
      );
      await s.exec(migracao?.sql ?? '');
      expect(
        await s.linhas(
          `select c.code::text, c.setup_state::text, count(j.id)::int as trabalhos
             from mkt.connectors c left join mkt.connector_jobs j on j.connector_id = c.id group by 1, 2 order by 1`,
        ),
      ).toEqual(antes);
    });
  });

  it('a primeira e a última rodada boa andam juntas; frequência positiva, folga não negativa; um por código e trabalho', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro('23514', `update mkt.connectors set first_success_at = now() where code = 'ga4'`);
      await s.erro('23514', `update mkt.connectors set last_success_at = null where code = 'meta'`);
      await s.erro('23514', `update mkt.connectors set expected_every_minutes = 0 where code = 'ga4'`);
      await s.erro('23514', `update mkt.connectors set late_tolerance_minutes = -1 where code = 'ga4'`);
      await s.erro('23514', `update mkt.connectors set setup_state = 'paused' where code = 'ga4'`);
      await s.erro(
        '23505',
        `insert into mkt.connectors (code, expected_every_minutes, late_tolerance_minutes) values ('meta', 60, 6)`,
      );
      await s.erro(
        '23514',
        `insert into mkt.connectors (code, expected_every_minutes, late_tolerance_minutes) values ('facebook', 60, 6)`,
      );
      await s.erro(
        '23505',
        `insert into mkt.connector_jobs (connector_id, job, expected_every_minutes, late_tolerance_minutes)
         values (${conector('meta')}, 'ads_hourly', 60, 6)`,
      );
      await s.erro(
        '23514',
        `insert into mkt.connector_jobs (connector_id, job, expected_every_minutes, late_tolerance_minutes)
         values (${conector('meta')}, 'sincronizar', 60, 6)`,
      );
      await s.exec(`update mkt.connectors set setup_state = 'disabled' where code = 'ga4'`);
      await s.exec(
        `update mkt.connectors set first_success_at = now(), last_success_at = now() where code = 'search_console'`,
      );
    });
  });
});

describe('sync_runs: cada rodada de cada conector', () => {
  const rodada = (r: {
    conector?: string;
    job?: string;
    gatilho?: string;
    status?: string;
    por?: string | null;
    erro?: string | null;
    mensagem?: string | null;
    gravadas?: number;
    descartadas?: number;
  }): [string, unknown[]] => [
    `insert into mkt.sync_runs (connector_id, job, run_trigger, status, requested_by, error_code, error_message,
                                rows_written, personal_data_dropped)
     values ((select id from mkt.connectors where code = $1), $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      r.conector ?? 'meta',
      r.job ?? 'ads_hourly',
      r.gatilho ?? 'schedule',
      r.status ?? 'running',
      r.por ?? null,
      r.erro ?? null,
      r.mensagem ?? null,
      r.gravadas ?? 0,
      r.descartadas ?? 0,
    ],
  ];

  it('"Tentar de novo" e o CSV dizem quem pediu; um pedido de "Tentar de novo" por conector de cada vez', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro('23514', ...rodada({ gatilho: 'manual_retry', status: 'requested' }));
      await s.erro('23514', ...rodada({ gatilho: 'csv_upload', job: 'csv_import', status: 'requested' }));
      // O GA4 já tem um pedido na fila (fixture): o segundo é recusado; o da Meta entra.
      await s.erro(
        '23505',
        ...rodada({
          conector: 'ga4',
          job: 'ga4_daily',
          gatilho: 'manual_retry',
          status: 'requested',
          por: DONO,
        }),
      );
      await s.exec(
        `insert into mkt.sync_runs (connector_id, job, run_trigger, status, requested_by)
         values (${conector('meta')}, 'ads_hourly', 'manual_retry', 'requested', '${DONO}')`,
      );
      // Pedido que já está rodando não segura o próximo; cada CSV tem a sua rodada.
      await s.exec(
        `insert into mkt.sync_runs (connector_id, job, run_trigger, status, requested_by)
         values (${conector('ga4')}, 'ga4_daily', 'manual_retry', 'running', '${DONO}')`,
      );
      for (let i = 0; i < 2; i++) {
        await s.exec(
          `insert into mkt.sync_runs (connector_id, job, run_trigger, status, requested_by)
           values (${conector('meta')}, 'csv_import', 'csv_upload', 'requested', '${DONO}')`,
        );
      }
      expect(
        await s.valor(
          `select count(*)::int from mkt.sync_runs
            where connector_id = ${conector('meta')} and run_trigger = 'csv_upload' and status = 'requested'`,
        ),
      ).toBe(3);
    });
  });

  it('código do erro sem texto livre, mensagem até 300 letras, contagens não negativas, listas fechadas', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro('23514', ...rodada({ status: 'failed', erro: 'erro de rede' }));
      await s.erro('23514', ...rodada({ status: 'failed', erro: 'HTTP_429', mensagem: 'x'.repeat(301) }));
      await s.erro('23514', ...rodada({ gravadas: -1 }));
      await s.erro('23514', ...rodada({ descartadas: -1 }));
      await s.erro('23514', ...rodada({ status: 'done' }));
      await s.erro('23514', ...rodada({ gatilho: 'cron' }));
      await s.erro('23514', ...rodada({ job: 'sincronizar' }));
      expect(
        await s.linhas(...rodada({ status: 'partial', erro: 'SPEND_MISMATCH', mensagem: 'x'.repeat(300) })),
      ).toHaveLength(0);
    });
    await caso(db, postgres, async (s) => {
      await s.erro(
        '23514',
        `update mkt.sync_runs set mass_delete_confirmed_by = '${DONO}' where job = 'ads_hourly'`,
      );
      await s.erro(
        '23514',
        `update mkt.sync_runs set mass_delete_confirmed_at = now() where job = 'ads_hourly'`,
      );
      await s.exec(
        `update mkt.sync_runs set mass_delete_confirmed_by = '${DONO}', mass_delete_confirmed_at = now()
          where job = 'ads_hourly'`,
      );
    });
  });
});

describe('csv_imports: os arquivos CSV de reserva', () => {
  const arquivo = (a: {
    nome?: string;
    tamanho?: number;
    por?: string | null;
    marca?: string | null;
    recusa?: string | null;
    linhas?: number | null;
  }): [string, unknown[]] => [
    `insert into mkt.csv_imports (connector_id, brand_id, file_name, size_bytes, content, uploaded_by, refusal_code,
                                  rows_imported)
     values ((select id from mkt.connectors where code = 'meta'), (select id from mkt.brands where code = $1), $2, $3,
             'campaign_id,day,spend', $4, $5, $6)`,
    [
      a.marca === undefined ? 'cs' : a.marca,
      a.nome ?? 'relatorio.csv',
      a.tamanho ?? 100,
      a.por === undefined ? DONO : a.por,
      a.recusa ?? null,
      a.linhas ?? null,
    ],
  ];

  it('nome de 1 a 200 letras, de 1 byte a 5 MB, quem enviou e a marca; código de recusa sem texto livre', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro('23514', ...arquivo({ nome: '' }));
      await s.erro('23514', ...arquivo({ nome: 'a'.repeat(201) }));
      await s.erro('23514', ...arquivo({ tamanho: 0 }));
      await s.erro('23514', ...arquivo({ tamanho: 5242881 }));
      await s.erro('23502', ...arquivo({ por: null }));
      await s.erro('23502', ...arquivo({ marca: null }));
      await s.erro('23514', ...arquivo({ recusa: 'tem dado pessoal' }));
      await s.erro('23514', ...arquivo({ linhas: -1 }));
      expect(
        await s.linhas(
          ...arquivo({ tamanho: 5242880, nome: 'a'.repeat(200), recusa: 'CSV_PERSONAL_DATA', linhas: 0 }),
        ),
      ).toHaveLength(0);
    });
  });

  it('quando a rodada sai (90 dias), o registro do arquivo fica, sem ela', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(`delete from mkt.sync_runs where id = '${RODADA_DO_CSV}'`);
      expect(
        await s.linhas('select file_name, sync_run_id from mkt.csv_imports where id = $1', [ARQUIVO_CSV]),
      ).toEqual([{ file_name: 'relatorio-campanhas-teste.csv', sync_run_id: null }]);
    });
  });
});

describe('private.connector_credentials: só o apontador para o Vault e o estado', () => {
  const credencial = (c: {
    conector: string;
    finalidade: string;
    conta?: string | null;
    segredo?: boolean;
    status?: string;
  }): [string, unknown[]] => [
    `insert into private.connector_credentials (connector_id, purpose, account_ref, vault_secret_id, status)
     values ((select id from mkt.connectors where code = $1), $2, $3, $4, $5)`,
    [c.conector, c.finalidade, c.conta ?? null, c.segredo ? UM_ID : null, c.status ?? 'valid'],
  ];

  it('a de leitura sempre aponta para o segredo; a de escrita nunca: é só a linha de estado (o segredo fica no executor)', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro('23514', ...credencial({ conector: 'search_console', finalidade: 'read' }));
      await s.erro('23514', ...credencial({ conector: 'tiktok', finalidade: 'write', segredo: true }));
    });
    await caso(db, postgres, async (s) => {
      await s.erro(
        '23514',
        `update private.connector_credentials set vault_secret_id = '${UM_ID}' where id = '${CREDENCIAL_DE_ESCRITA}'`,
      );
      await s.erro(
        '23514',
        `update private.connector_credentials set vault_secret_id = null where id = '${CREDENCIAL_DE_LEITURA}'`,
      );
      expect(
        await s.linhas(...credencial({ conector: 'search_console', finalidade: 'read', segredo: true })),
      ).toHaveLength(0);
      expect(await s.linhas(...credencial({ conector: 'tiktok', finalidade: 'write' }))).toHaveLength(0);
    });
  });

  it('uma por conector, finalidade e conta (sem conta conta como uma só); estado da lista', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro('23505', ...credencial({ conector: 'meta', finalidade: 'write' }));
      await s.erro(
        '23505',
        ...credencial({
          conector: 'instagram',
          finalidade: 'read',
          conta: '17840000000000001',
          segredo: true,
        }),
      );
      await s.erro(
        '23514',
        ...credencial({ conector: 'google_ads', finalidade: 'write', status: 'expired' }),
      );
      await s.erro('23514', ...credencial({ conector: 'google_ads', finalidade: 'admin' }));
      await s.exec(
        `insert into private.connector_credentials (connector_id, purpose, account_ref)
         values (${conector('meta')}, 'write', 'act_900000000000001')`,
      );
      await s.erro(
        '23505',
        `insert into private.connector_credentials (connector_id, purpose, account_ref)
         values (${conector('meta')}, 'write', 'act_900000000000001')`,
      );
      // A mesma conta, para ler: outra finalidade, outra linha.
      await s.exec(
        `insert into private.connector_credentials (connector_id, purpose, account_ref, vault_secret_id)
         values (${conector('meta')}, 'read', 'act_900000000000001', '${UM_ID}')`,
      );
    });
  });

  it('RLS-18: ninguém lê nem grava as credenciais, nem o dono pela API; os serviços também não (o worker lê por função)', async () => {
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
        await s.erro('42501', 'select count(*) from private.connector_credentials');
        await s.erro('42501', 'select vault_secret_id from private.connector_credentials');
        await s.erro('42501', `update private.connector_credentials set status = 'revoked'`);
        await s.erro('42501', `delete from private.connector_credentials`);
        await s.erro(
          '42501',
          `insert into private.connector_credentials (connector_id, purpose) values ('${UM_ID}', 'write')`,
        );
      });
    }
    await caso(db, postgres, async (s) => {
      expect(await s.valor('select count(*)::int from private.connector_credentials')).toBe(2);
      expect(
        await s.linhas(
          `select c.relrowsecurity, (select count(*)::int from pg_policies p
                                      where p.schemaname = 'private' and p.tablename = 'connector_credentials') as politicas
             from pg_class c where c.oid = 'private.connector_credentials'::regclass`,
        ),
      ).toEqual([{ relrowsecurity: true, politicas: 0 }]);
    });
  });
});

describe('notification_outbox: a fila de avisos', () => {
  const aviso = (a: {
    perfil?: string;
    aviso?: string;
    canal?: string;
    chave?: string;
    payload?: unknown;
    tentativas?: number;
    erro?: string | null;
    status?: string;
  }): [string, unknown[]] => [
    `insert into mkt.notification_outbox (profile_id, notice, channel, dedupe_key, payload, send_after_at, attempts,
                                          error_code, status)
     values ($1, $2, $3, $4, $5::jsonb, now(), $6, $7, $8)`,
    [
      a.perfil ?? DONO,
      a.aviso ?? 'connector_down',
      a.canal ?? 'whatsapp',
      a.chave ?? 'teste:connector_down:meta:1',
      JSON.stringify(
        a.payload ?? { title: 'Conector parado', link: '/conectores', connector: 'meta', status: 'down' },
      ),
      a.tentativas ?? 0,
      a.erro ?? null,
      a.status ?? 'pending',
    ],
  ];

  it('o payload passa por mkt.valid_notice_payload; um aviso por fato; até 5 tentativas; listas fechadas', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro(
        '23514',
        ...aviso({ payload: { title: 'Conector parado', link: '/conectores', email: 'pessoa@example.com' } }),
      );
      await s.erro('23514', ...aviso({ aviso: 'weekly_report' }));
      await s.erro('23505', ...aviso({ chave: 'teste:weekly_report:2026-10-26:email' }));
      await s.erro('23514', ...aviso({ tentativas: 6 }));
      await s.erro('23514', ...aviso({ erro: 'não entregou' }));
      await s.erro('23514', ...aviso({ status: 'enviado' }));
      await s.erro('23514', ...aviso({ canal: 'sms' }));
      await s.erro('23503', ...aviso({ perfil: SEM_PERFIL }));
      expect(
        await s.linhas(...aviso({ tentativas: 5, erro: 'WHATSAPP_131047', status: 'failed' })),
      ).toHaveLength(0);
    });
  });

  it('o aviso sai junto com o perfil (on delete cascade)', async () => {
    await caso(db, postgres, async (s) => {
      await s.linhas(...aviso({ perfil: EX_GESTOR, chave: 'teste:ex-gestor' }));
      expect(
        await s.valor(`select count(*)::int from mkt.notification_outbox where profile_id = $1`, [EX_GESTOR]),
      ).toBe(1);
      await s.exec(`delete from mkt.profiles where id = '${EX_GESTOR}'`);
      expect(
        await s.valor(`select count(*)::int from mkt.notification_outbox where profile_id = $1`, [EX_GESTOR]),
      ).toBe(0);
    });
  });

  it('RLS-19: ninguém lê nem grava a fila pela API, nem o dono com o segundo fator; nem os serviços direto', async () => {
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
        await s.erro('42501', 'select count(*) from mkt.notification_outbox');
        await s.erro('42501', `update mkt.notification_outbox set status = 'sent'`);
        await s.erro('42501', 'delete from mkt.notification_outbox');
        await s.erro('42501', ...aviso({}));
      });
    }
    await caso(db, postgres, async (s) => {
      expect(await s.valor('select count(*)::int from mkt.notification_outbox')).toBe(1);
      expect(
        await s.linhas(
          `select c.relrowsecurity, (select count(*)::int from pg_policies p
                                      where p.schemaname = 'mkt' and p.tablename = 'notification_outbox') as politicas
             from pg_class c where c.oid = 'mkt.notification_outbox'::regclass`,
        ),
      ).toEqual([{ relrowsecurity: true, politicas: 0 }]);
    });
  });
});

describe('mkt.valid_notice_payload: título, números, código e link; nunca dado de cliente nem de lead', () => {
  const PARADO = { title: 'Conector parado', link: '/conectores', connector: 'meta', status: 'down' };
  const PERTO = {
    title: 'Gasto perto do limite',
    link: '/trafego?marca=cs',
    brand: 'cs',
    platform: 'meta',
    ad_account_id: CONTA_META_CS,
    month_on: '2026-11-01',
    spend_cents: 1380000,
    limit_cents: 1500000,
    projected_cents: 1600000,
    usage_ratio: 0.92,
  };
  const PROPOSTA = {
    title: 'Proposta do Claude para aprovar',
    link: '/trafego?acao=ACT-0012',
    brand: 'cs',
    platform: 'meta',
    action_code: 'ACT-0012',
    kind: 'budget',
    cost_cents: 45000,
  };
  const SEMANA = {
    title: 'Relatório da semana',
    link: '/visao-geral',
    from_on: '2026-10-26',
    to_on: '2026-11-01',
    spend_cents: 310000,
    leads: 84,
    new_customers: 11,
    cost_per_new_customer_cents: null,
  };
  const CASOS: Array<[string, unknown, boolean]> = [
    ['connector_down', PARADO, true],
    [
      'connector_down',
      {
        ...PARADO,
        since_at: '2026-11-03T10:00:00Z',
        late_jobs: ['ads_hourly', 'ads_backfill'],
        failures: 3,
        error_code: 'HTTP_429',
      },
      true,
    ],
    ['connector_down', { ...PARADO, title: 'Tudo funcionando de novo', status: 'ok' }, true],
    ['connector_down', { ...PARADO, connector: undefined }, false],
    ['connector_down', { ...PARADO, connector: 'facebook' }, false],
    ['connector_down', { ...PARADO, status: 'caido' }, false],
    ['connector_down', { ...PARADO, late_jobs: ['sincronizar'] }, false],
    ['connector_down', { ...PARADO, late_jobs: 'ads_hourly' }, false],
    ['connector_down', { ...PARADO, failures: -1 }, false],
    ['connector_down', { ...PARADO, failures: 1.5 }, false],
    ['connector_down', { ...PARADO, error_code: 'erro de rede' }, false],
    ['connector_down', { ...PARADO, link: undefined }, false],
    ['connector_down', { ...PARADO, title: '   ' }, false],
    ['connector_down', { ...PARADO, link: 'https://example.com/conectores' }, false],
    ['connector_down', { ...PARADO, link: '//example.com/conectores' }, false],
    ['connector_down', { ...PARADO, link: '/conectores?para=pessoa@example.com' }, false],
    ['spend_near_limit', PERTO, true],
    ['spend_near_limit', { ...PERTO, ad_account_id: 'act_900000000000001' }, false],
    ['spend_near_limit', { ...PERTO, brand: 'outra' }, false],
    ['spend_near_limit', { ...PERTO, brand: null }, false],
    ['spend_near_limit', { ...PERTO, spend_cents: '1380000' }, false],
    ['spend_near_limit', { ...PERTO, usage_ratio: -0.1 }, false],
    [
      'cost_per_lead_high',
      {
        title: 'Custo por lead acima do limite',
        link: '/canais/meta',
        brand: 'cs',
        cost_per_lead_cents: 5200,
        target_cost_per_lead_cents: 4000,
      },
      true,
    ],
    [
      'cost_per_lead_high',
      {
        title: 'Custo por lead acima do limite',
        link: '/canais/meta',
        brand: 'cs',
        campaign_name: 'cs-lojistas',
      },
      false,
    ],
    ['proposal_to_approve', PROPOSTA, true],
    ['proposal_to_approve', { ...PROPOSTA, action_code: 'act-12' }, false],
    ['proposal_to_approve', { ...PROPOSTA, kind: 'mudar' }, false],
    ['proposal_to_approve', { ...PROPOSTA, rationale: 'O custo por lead está abaixo da meta.' }, false],
    ['proposal_to_approve', { ...PROPOSTA, title: 'Proposta do Claude: ligar para (11) 98765-4321' }, false],
    ['weekly_report', SEMANA, true],
    ['weekly_report', { ...SEMANA, brand: 'plumene' }, true],
    ['weekly_report', { ...SEMANA, to_on: null }, false],
    ['weekly_report', { ...SEMANA, from_on: '26/10/2026' }, false],
    ['weekly_report', { ...SEMANA, lead_name: 'Fulana' }, false],
    ['weekly_report', { ...SEMANA, customer_id: '00000000-0000-4000-8000-000000000261' }, false],
    ['weekly_report', { ...SEMANA, title: 'Resumo para pessoa@example.com' }, false],
    ['weekly_report', { ...SEMANA, title: 'Cliente 123.456.789-09 voltou a comprar' }, false],
    ['weekly_report', { ...SEMANA, connector: 'meta' }, false],
    [
      'credential_expiring',
      {
        title: 'Credencial vence logo',
        link: '/conectores',
        connector: 'instagram',
        purpose: 'read',
        status: 'expiring',
        expires_at: '2026-11-09T00:00:00+00:00',
      },
      true,
    ],
    [
      'credential_expiring',
      { title: 'Credencial vence logo', link: '/conectores', connector: 'instagram', purpose: 'admin' },
      false,
    ],
    [
      'credential_expiring',
      {
        title: 'Credencial vence logo',
        link: '/conectores',
        connector: 'instagram',
        purpose: 'read',
        token: 'abc',
      },
      false,
    ],
    [
      'stop_not_confirmed',
      {
        title: 'Parar tudo sem confirmação',
        link: '/trafego',
        brand: null,
        traffic_stop_id: UM_ID,
        campaigns_count: 3,
        requested_at: '2026-11-03T10:02:00.123+00:00',
      },
      true,
    ],
    [
      'stop_not_confirmed',
      { title: 'Parar tudo sem confirmação', link: '/trafego', traffic_stop_id: 'parada-1' },
      false,
    ],
    [
      'stop_not_confirmed',
      {
        title: 'Parar tudo sem confirmação',
        link: '/trafego',
        traffic_stop_id: UM_ID,
        requested_at: 'ontem',
      },
      false,
    ],
    [
      'mass_delete_blocked',
      {
        title: 'Exclusão em massa segurada',
        link: '/conectores',
        connector: 'csp360',
        sync_run_id: UM_ID,
        table_name: 'crm_customers',
        rows_to_delete: 1200,
        consecutive_runs: 3,
      },
      true,
    ],
    [
      'mass_delete_blocked',
      {
        title: 'Exclusão em massa segurada',
        link: '/conectores',
        connector: 'csp360',
        sync_run_id: UM_ID,
        table_name: 'mkt.crm_customers; drop',
      },
      false,
    ],
    ['weekly_report', [], false],
    ['weekly_report', 'Relatório', false],
  ];

  it('cada aviso aceita o título, o link e só as chaves do fato dele, com o tipo de cada uma', async () => {
    await caso(db, postgres, async (s) => {
      for (const [notice, payload, valido] of CASOS) {
        expect(
          await s.valor('select mkt.valid_notice_payload($1::mkt.notice_kind, $2::jsonb)', [
            notice,
            JSON.stringify(payload),
          ]),
          `${notice} ${JSON.stringify(payload)}`,
        ).toBe(valido);
      }
      expect(await s.valor(`select mkt.valid_notice_payload('weekly_report', null)`)).toBe(false);
      expect(await s.valor(`select mkt.valid_notice_payload(null, '{}')`)).toBe(false);
    });
  });
});

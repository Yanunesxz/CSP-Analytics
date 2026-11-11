// Migração 09, conectores: "Tentar de novo", ligar e desligar, confirmar a exclusão em massa e enviar o CSV de reserva
// (todos com retry_connector, que pede o segundo fator), e o estado das credenciais (view_connectors). Casos RLS-10,
// 26 e 35 (docs/dados/papeis-e-rls.md). Dados inventados de fixtures/usuarios.sql e conectores.sql.
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
  usuario,
} from './apoio/banco';
import {
  ARQUIVO_CSV,
  CREDENCIAL_DE_ESCRITA,
  CREDENCIAL_DE_LEITURA,
  PEDIDO_GA4,
  RODADA_META,
} from './apoio/trafego';
import { DONO, GESTOR } from './apoio/usuarios';

let db: PGlite;

beforeAll(async () => {
  db = await abrirBanco();
  await aplicarFixture(db, 'usuarios');
  await aplicarFixture(db, 'conectores');
});

afterAll(async () => {
  await db.close();
});

const DONO_2F = usuario(DONO, 'aal2');
const DONO_1F = usuario(DONO, 'aal1');
const GESTOR_LOGADO = usuario(GESTOR, 'aal2');

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

async function auditoria(s: Sessao, evento: string): Promise<Linha[]> {
  await s.como(postgres);
  return s.linhas(
    `select actor_id::text, target_table, target_id::text, changes from mkt.audit_log
      where event = $1 and occurred_at = now() order by created_at`,
    [evento],
  );
}

async function estado(s: Sessao, codigo: string): Promise<{ setup_state: string; updated_at: Date }> {
  await s.como(postgres);
  return primeira(
    await s.linhas<{ setup_state: string; updated_at: Date }>(
      'select setup_state::text, updated_at from mkt.connectors where code = $1',
      [codigo],
    ),
  );
}

const tentar = 'select * from api.retry_connector($1)';
const ligar = 'select * from api.set_connector_state($1, $2, $3)';

describe('"Tentar de novo" num conector (api.retry_connector)', () => {
  it('RLS-10 e RLS-35: o gestor e o dono sem o segundo fator não pedem (PT403), e nada é gravado', async () => {
    await caso(db, postgres, async (s) => {
      for (const quem of [GESTOR_LOGADO, DONO_1F]) {
        expect((await recusa(s, 'PT403', quem, tentar, ['meta'])).message).toBe('CON-403');
      }
      await s.como(postgres);
      expect(
        await s.valor(`select count(*)::int from mkt.sync_runs where run_trigger = 'manual_retry'`),
      ).toBe(1);
    });
  });

  it('o dono pede a rodada do trabalho principal, com quem pediu e a auditoria; pedir de novo devolve a mesma', async () => {
    await caso(db, postgres, async (s) => {
      const r = primeira(await chamar(s, DONO_2F, tentar, ['meta']));
      expect(r).toMatchObject({
        job: 'ads_hourly',
        run_trigger: 'manual_retry',
        status: 'requested',
        requested_by: DONO,
        brand_id: null,
      });
      // O arquivo CSV na fila da Meta é outra rodada: não conta como o pedido de "Tentar de novo".
      const de_novo = primeira(await chamar(s, DONO_2F, tentar, ['meta']));
      expect(de_novo.id).toBe(r.id);
      expect(await auditoria(s, 'connector_retry_requested')).toEqual([
        {
          actor_id: DONO,
          target_table: 'sync_runs',
          target_id: r.id,
          changes: { connector: 'meta', sync_run_id: r.id },
        },
      ]);
    });
  });

  it('o trabalho de cada conector; com rodada rodando, devolve a mesma; a ligar ou desligado, PT422', async () => {
    await caso(db, postgres, async (s) => {
      expect((await recusa(s, 'PT422', DONO_2F, tentar, ['instagram'])).message).toBe('CON-422');
      await s.como(postgres);
      await s.exec(`update mkt.connectors set setup_state = 'connected', first_success_at = now(),
                                              last_success_at = now()
                     where setup_state <> 'connected'`);
      const trabalhos: Record<string, string> = {};
      for (const codigo of ['csp360', 'instagram', 'tiktok', 'google_ads', 'search_console', 'ga4']) {
        const r = primeira(await chamar<{ job: string }>(s, DONO_2F, tentar, [codigo]));
        trabalhos[codigo] = r.job;
      }
      expect(trabalhos).toEqual({
        csp360: 'crm_incremental',
        instagram: 'ig_daily',
        tiktok: 'ads_hourly',
        google_ads: 'ads_hourly',
        search_console: 'gsc_daily',
        ga4: 'ga4_daily',
      });
      // O GA4 já tinha o pedido da fixture: devolve o mesmo.
      expect(primeira(await chamar(s, DONO_2F, tentar, ['ga4'])).id).toBe(PEDIDO_GA4);

      // Com a releitura da Meta rodando, o pedido é ela.
      await s.como(postgres);
      const rodando = await s.valor<string>(`
        insert into mkt.sync_runs (connector_id, job, run_trigger, status, started_at)
        select id, 'ads_backfill', 'schedule', 'running', now() from mkt.connectors where code = 'meta'
        returning id::text`);
      expect(primeira(await chamar(s, DONO_2F, tentar, ['meta'])).id).toBe(rodando);

      await s.como(postgres);
      await s.exec(`update mkt.connectors set setup_state = 'disabled' where code = 'tiktok'`);
      expect((await recusa(s, 'PT422', DONO_2F, tentar, ['tiktok'])).message).toBe('CON-422');
    });
  });
});

describe('ligar e desligar (api.set_connector_state)', () => {
  it('RLS-10: o gestor não desliga (PT403)', async () => {
    await caso(db, postgres, async (s) => {
      const meta = await estado(s, 'meta');
      expect(
        (await recusa(s, 'PT403', GESTOR_LOGADO, ligar, ['meta', 'disabled', meta.updated_at])).message,
      ).toBe('CON-403');
      expect(await estado(s, 'meta')).toMatchObject({ setup_state: 'connected' });
    });
  });

  it('o dono desliga e religa a Meta; a auditoria guarda o antes e o depois', async () => {
    await caso(db, postgres, async (s) => {
      const antes = await estado(s, 'meta');
      const desligado = primeira(await chamar(s, DONO_2F, ligar, ['meta', 'disabled', antes.updated_at]));
      expect(desligado).toMatchObject({ code: 'meta', setup_state: 'disabled' });
      await chamar(s, DONO_2F, ligar, ['meta', 'connected', desligado.updated_at]);
      expect(await estado(s, 'meta')).toMatchObject({ setup_state: 'connected' });
      expect((await auditoria(s, 'connector_state_changed')).map((l) => l.changes)).toEqual([
        { connector: 'meta', setup_state: { before: 'connected', after: 'disabled' } },
        { connector: 'meta', setup_state: { before: 'disabled', after: 'connected' } },
      ]);
    });
  });

  it('o que nunca deu certo não fica "Ligado": desligado, volta para "A ligar"; o mesmo estado, PT422; updated_at antigo, PT409', async () => {
    await caso(db, postgres, async (s) => {
      let ig = await estado(s, 'instagram');
      expect(
        (await recusa(s, 'PT422', DONO_2F, ligar, ['instagram', 'connected', ig.updated_at])).message,
      ).toBe('CON-422');
      expect(
        (await recusa(s, 'PT422', DONO_2F, ligar, ['instagram', 'not_connected', ig.updated_at])).message,
      ).toBe('CON-422');
      await chamar(s, DONO_2F, ligar, ['instagram', 'disabled', ig.updated_at]);
      ig = await estado(s, 'instagram');
      await chamar(s, DONO_2F, ligar, ['instagram', 'not_connected', ig.updated_at]);
      expect(await estado(s, 'instagram')).toMatchObject({ setup_state: 'not_connected' });

      // A Meta já deu certo: desligada, não volta para "A ligar".
      const meta = await estado(s, 'meta');
      const desligada = primeira(await chamar(s, DONO_2F, ligar, ['meta', 'disabled', meta.updated_at]));
      expect(
        (await recusa(s, 'PT422', DONO_2F, ligar, ['meta', 'not_connected', desligada.updated_at])).message,
      ).toBe('CON-422');
      expect(
        (
          await recusa(s, 'PT409', DONO_2F, ligar, [
            'meta',
            'connected',
            new Date((desligada.updated_at as Date).getTime() - 1000),
          ])
        ).message,
      ).toBe('CON-409');
    });
  });
});

describe('exclusão em massa (api.confirm_mass_delete)', () => {
  const confirmar = 'select * from api.confirm_mass_delete($1)';
  const SEGURADA = `
    insert into mkt.sync_runs (connector_id, job, run_trigger, status, started_at, finished_at, error_code)
    select id, 'crm_full_pass', 'schedule', 'partial', now() - interval '10 minutes', now(), 'MASS_DELETE_BLOCKED'
      from mkt.connectors where code = 'csp360'
    returning id::text`;

  it('RLS-10 e RLS-35: o gestor e o dono sem o segundo fator não confirmam (PT403)', async () => {
    await caso(db, postgres, async (s) => {
      const rodada = await s.valor<string>(SEGURADA);
      for (const quem of [GESTOR_LOGADO, DONO_1F]) {
        expect((await recusa(s, 'PT403', quem, confirmar, [rodada])).message).toBe('CON-403');
      }
      await s.como(postgres);
      expect(
        await s.valor('select mass_delete_confirmed_at from mkt.sync_runs where id = $1', [rodada]),
      ).toBe(null);
    });
  });

  it('o dono confirma a rodada que a trava de 20% segurou; de novo, nada muda; outra rodada, PT422', async () => {
    await caso(db, postgres, async (s) => {
      const rodada = await s.valor<string>(SEGURADA);
      const r = primeira(await chamar(s, DONO_2F, confirmar, [rodada]));
      expect(r).toMatchObject({ id: rodada, mass_delete_confirmed_by: DONO });
      expect(primeira(await chamar(s, DONO_2F, confirmar, [rodada]))).toMatchObject({
        mass_delete_confirmed_at: r.mass_delete_confirmed_at,
      });
      expect(await auditoria(s, 'mass_delete_confirmed')).toEqual([
        {
          actor_id: DONO,
          target_table: 'sync_runs',
          target_id: rodada,
          changes: { connector: 'csp360', sync_run_id: rodada },
        },
      ]);
      expect((await recusa(s, 'PT422', DONO_2F, confirmar, [RODADA_META])).message).toBe('CON-422');
      expect(
        (await recusa(s, 'PT404', DONO_2F, confirmar, ['00000000-0000-4000-8000-0000000004ff'])).message,
      ).toBe('CON-404');
    });
  });
});

describe('CSV de reserva (api.upload_csv)', () => {
  const enviar = 'select api.upload_csv($1, $2, $3, $4) as id';
  const RELATORIO =
    'Campaign ID,Campaign name,Day,Amount spent (BRL),Impressions\n120200000000000001,cs-prospecção,2026-11-02,48.70,1200\n';

  it('RLS-26: o gestor não envia (PT403), mas lê os arquivos (controle positivo)', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        (await recusa(s, 'PT403', GESTOR_LOGADO, enviar, ['meta', 'cs', 'relatorio.csv', RELATORIO])).message,
      ).toBe('CON-403');
      expect(
        (await recusa(s, 'PT403', DONO_1F, enviar, ['meta', 'cs', 'relatorio.csv', RELATORIO])).message,
      ).toBe('CON-403');
      await s.como(GESTOR_LOGADO);
      expect(await s.linhas('select id::text, file_name from mkt.csv_imports')).toEqual([
        { id: ARQUIVO_CSV, file_name: 'relatorio-campanhas-teste.csv' },
      ]);
    });
  });

  it('o dono envia: o arquivo com o tamanho em bytes e a rodada pedida dele, com a marca e quem pediu', async () => {
    await caso(db, postgres, async (s) => {
      const id = String(
        primeira(await chamar(s, DONO_2F, enviar, ['tiktok', 'plumene', 'tiktok-novembro.csv', RELATORIO]))
          .id,
      );
      await s.como(postgres);
      expect(
        await s.linhas(
          `select k.code::text as conector, b.code::text as marca, i.file_name, i.size_bytes, i.content = $2 as conteudo,
                  i.uploaded_by::text, r.job::text, r.run_trigger::text, r.status::text, r.requested_by::text,
                  r.brand_id = i.brand_id as mesma_marca
             from mkt.csv_imports i
             join mkt.connectors k on k.id = i.connector_id
             join mkt.brands b on b.id = i.brand_id
             join mkt.sync_runs r on r.id = i.sync_run_id
            where i.id = $1`,
          [id, RELATORIO],
        ),
      ).toEqual([
        {
          conector: 'tiktok',
          marca: 'plumene',
          file_name: 'tiktok-novembro.csv',
          size_bytes: Buffer.byteLength(RELATORIO, 'utf8'),
          conteudo: true,
          uploaded_by: DONO,
          job: 'csv_import',
          run_trigger: 'csv_upload',
          status: 'requested',
          requested_by: DONO,
          mesma_marca: true,
        },
      ]);
    });
  });

  it('coluna de pessoa, vazio, mais de 5 MB, conector que não é de anúncio e nome comprido: PT422, nada é gravado', async () => {
    await caso(db, postgres, async (s) => {
      const antes = await s.valor<number>('select count(*)::int from mkt.csv_imports');
      const tentativas: Array<[unknown[], string]> = [
        [['meta', 'cs', 'leads.csv', 'Campaign ID,Nome,E-mail\n1,a,b\n'], 'personal_data'],
        [['meta', 'cs', 'vazio.csv', ''], 'size'],
        [['ga4', 'cs', 'sessoes.csv', RELATORIO], 'connector'],
        [['meta', 'cs', `${'a'.repeat(197)}.csv`, RELATORIO], 'file_name'],
      ];
      for (const [args, detalhe] of tentativas) {
        const e = await recusa(s, 'PT422', DONO_2F, enviar, args);
        expect([e.message, e.detail], detalhe).toEqual(['CON-422', detalhe]);
      }
      const grande = await recusa(
        s,
        'PT422',
        DONO_2F,
        `select api.upload_csv('meta', 'cs', 'grande.csv', 'Campaign ID,Spend' || chr(10) || repeat('1', 5242880))`,
      );
      expect(grande.detail).toBe('size');
      await s.como(postgres);
      expect(await s.valor('select count(*)::int from mkt.csv_imports')).toBe(antes);
    });
  });
});

describe('estado das credenciais (api.credential_status)', () => {
  it('quem vê conectores lê conector, finalidade, conta, estado e validade; nunca o segredo nem o apontador', async () => {
    await caso(db, GESTOR_LOGADO, async (s) => {
      const linhas = await s.linhas('select * from api.credential_status()');
      expect(linhas.map((l) => Object.keys(l))).toEqual([
        ['connector', 'purpose', 'account_ref', 'status', 'expires_at', 'last_checked_at'],
        ['connector', 'purpose', 'account_ref', 'status', 'expires_at', 'last_checked_at'],
      ]);
      expect(linhas.map((l) => [l.connector, l.purpose, l.account_ref, l.status])).toEqual([
        ['instagram', 'read', '17840000000000001', 'valid'],
        ['meta', 'write', null, 'valid'],
      ]);
      expect(JSON.stringify(linhas)).not.toContain('4a1');
      expect(JSON.stringify(linhas)).not.toContain(CREDENCIAL_DE_LEITURA);
      expect(JSON.stringify(linhas)).not.toContain(CREDENCIAL_DE_ESCRITA);
    });
  });

  it('sem view_connectors, PT403', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(
        `delete from mkt.role_permissions where role = 'traffic_manager' and action = 'view_connectors'`,
      );
      expect((await recusa(s, 'PT403', GESTOR_LOGADO, 'select * from api.credential_status()')).message).toBe(
        'CON-403',
      );
    });
  });
});

// A ponte com a camada 2: os dois arquivos SQL que o CI roda no projeto de teste rodam aqui também, no PGlite, sobre as
// mesmas migrações, para a migração que quebrar um deles aparecer no pnpm verify e não só no CI. Na ordem do CI: o
// convite do primeiro dono pelo papel dos scripts (setup.create_first_owner_invitation), os dados inventados como
// postgres (scripts/testar-rls-dados.sql) e os casos na conexão de cada papel (scripts/testar-rls-servicos.sql). O psql
// daqui entende só o que os dois usam (apoio/psql.ts). A parte pela API (scripts/testar-rls.mjs) precisa do Supabase de
// verdade e fica na camada 2.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { abrirBanco } from './apoio/banco';
import { rodarScript } from './apoio/psql';

const DADOS = new URL('../../scripts/testar-rls-dados.sql', import.meta.url);
const SERVICOS = new URL('../../scripts/testar-rls-servicos.sql', import.meta.url);
const ETIQUETA = 'pglite';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Os casos que cada conexão roda (o relatório do script: um NOTICE por caso). */
const CASOS: Readonly<Record<string, readonly string[]>> = {
  postgres: ['RLS-24'],
  mkt_worker: ['RLS-18', 'RLS-22', 'RLS-30'],
  mkt_executor: ['RLS-34'],
  n8n_notifier: ['RLS-18', 'RLS-23', 'RLS-28'],
};

let db: PGlite;
let dados: Record<string, string>;

/** Roda o script dos serviços na conexão do papel (o session_user dele) e volta ao dono do banco. */
async function servicos(papel: string): Promise<string[]> {
  await db.exec(`set session authorization ${papel}`);
  try {
    const r = await rodarScript(db, SERVICOS, {
      papel,
      cred_leitura: dados.cred_leitura ?? '',
      cred_escrita: dados.cred_escrita ?? '',
      rodada_id: dados.rodada_id ?? '',
      motivo: '1',
    });
    return r.avisos;
  } finally {
    await db.exec('set session authorization postgres');
  }
}

beforeAll(async () => {
  // Como o projeto de teste depois das migrações: sem as fixtures.
  db = await abrirBanco();
  await db.exec('set session authorization mkt_setup');
  await db.query(`select setup.create_first_owner_invitation($1, 'Dono de teste')`, [
    `rls-dono-${ETIQUETA}@teste.invalid`,
  ]);
  await db.exec('set session authorization postgres');
  const r = await rodarScript(db, DADOS, { etiqueta: ETIQUETA });
  const [linha] = r.linhas;
  dados = (linha?.json_build_object ?? {}) as Record<string, string>;
});

afterAll(async () => {
  await db.close();
});

describe('scripts/testar-rls-dados.sql', () => {
  it('devolve só ids inventados, no formato que scripts/testar-rls.mjs lê (RLS_DADOS)', () => {
    expect(Object.keys(dados).sort()).toEqual(
      [
        'ad_account_id',
        'campaign_id',
        'campaign_updated_at',
        'cred_escrita',
        'cred_leitura',
        'rodada_id',
      ].sort(),
    );
    for (const campo of ['ad_account_id', 'campaign_id', 'cred_escrita', 'cred_leitura', 'rodada_id']) {
      expect(dados[campo], campo).toMatch(UUID);
    }
    expect(dados.campaign_updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('cria o que a API não cria: a conta (por setup), a campanha do humano, a passada em andamento e as credenciais', async () => {
    const [estado] = (
      await db.query<Record<string, unknown>>(
        `select (select b.code || '/' || a.platform || '/' || a.is_active from mkt.ad_accounts a
                   join mkt.brands b on b.id = a.brand_id where a.id = $1) as conta,
                (select c.managed_by || '/' || c.status || '/' ||
                        to_char(c.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                   from mkt.campaigns c where c.id = $2) as campanha,
                (select k.code || '/' || r.job || '/' || r.status from mkt.sync_runs r
                   join mkt.connectors k on k.id = r.connector_id where r.id = $3) as rodada,
                (select c.purpose || '/' || c.status || '/' || (c.vault_secret_id is not null)
                   from private.connector_credentials c where c.id = $4) as leitura,
                (select c.purpose || '/' || c.status || '/' || (c.vault_secret_id is not null)
                   from private.connector_credentials c where c.id = $5) as escrita,
                (select string_agg(i.role || '/' || (i.expires_at > now()), ',' order by i.email_normalized)
                   from mkt.invitations i) as convites`,
        [dados.ad_account_id, dados.campaign_id, dados.rodada_id, dados.cred_leitura, dados.cred_escrita],
      )
    ).rows;
    expect(estado).toEqual({
      conta: 'cs/meta/true',
      campanha: `human/active/${dados.campaign_updated_at}`,
      rodada: 'csp360/crm_full_pass/running',
      leitura: 'read/valid/true',
      escrita: 'write/valid/false',
      // O convite do primeiro dono (válido) e o vencido do RLS-32, os dois de dono.
      convites: 'owner/true,owner/false',
    });
  });
});

describe('scripts/testar-rls-servicos.sql, na conexão de cada papel', () => {
  for (const [papel, casos] of Object.entries(CASOS)) {
    it(`${papel}: ${casos.join(', ')} passam`, async () => {
      expect(await servicos(papel)).toEqual(casos.map((caso) => `${caso} ${papel} passou`));
    });
  }

  it('o script acusa a falha: com um grant a mais, o caso do papel falha e nada fica gravado', async () => {
    // A transação é a do teste: o script falha antes do rollback dele, e o psql daqui desfaz tudo, também o grant.
    const comGrant = async (grant: string, papel: string, caso: RegExp) => {
      await db.exec(`begin; ${grant}; set session authorization ${papel}`);
      await expect(
        rodarScript(db, SERVICOS, {
          papel,
          cred_leitura: dados.cred_leitura ?? '',
          cred_escrita: dados.cred_escrita ?? '',
          rodada_id: dados.rodada_id ?? '',
        }),
      ).rejects.toThrow(caso);
      await db.exec('set session authorization postgres');
    };
    await comGrant('grant select on mkt.crm_leads to mkt_executor', 'mkt_executor', /RLS-34/);
    await comGrant('grant execute on function ingest.next_execution() to mkt_worker', 'mkt_worker', /RLS-30/);
    await comGrant(
      'grant usage on schema mkt to n8n_notifier; grant select on mkt.brands to n8n_notifier',
      'n8n_notifier',
      /RLS-23/,
    );
    const { rows } = await db.query<{ executor: boolean; worker: boolean; n8n: boolean }>(
      `select has_table_privilege('mkt_executor', 'mkt.crm_leads', 'select') as executor,
              has_function_privilege('mkt_worker', 'ingest.next_execution()', 'execute') as worker,
              has_schema_privilege('n8n_notifier', 'mkt', 'usage') as n8n`,
    );
    expect(rows).toEqual([{ executor: false, worker: false, n8n: false }]);
  });
});

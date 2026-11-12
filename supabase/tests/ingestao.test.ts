// Migração 10, o worker: as rodadas (start_run, take_requested_run, finish_run), uma upsert por tabela de fora (o
// formato do evento, a limpeza do texto do CRM, o CRM como ele é nas decisões 0041 e 0042 — o funil de leads por regra,
// com o funil antigo marcado por setup.mark_lead_funnel, o negócio sem funil, o nulo no que não vem e a compra do ERP
// mais antiga —, a regra CSV × API, o operador da campanha), a releitura que troca o dia (replace_day) e a passada
// completa que apaga o que sumiu, com a trava de 20% (delete_missing). docs/dados/integracoes.md, seções 2, 3 e 12;
// tabelas.md, seções 2 e 3. Dados inventados de fixtures/usuarios.sql, marketing.sql, trafego.sql e conectores.sql.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { abrirBanco, aplicarFixture, caso, postgres, servico, usuario } from './apoio/banco';
import {
  ACT_META_CS,
  LOGIN_A,
  LOGIN_B,
  LOGIN_C,
  LOGIN_D,
  abrirRodada,
  contagens,
  gravar,
  rodadaDoCsv,
} from './apoio/ingestao';
import {
  CAMPANHA_CLAUDE_CS,
  CAMPANHA_HUMANO_CS,
  CLIENTE_A,
  CLIENTE_B,
  CONTA_META_CS,
  FUNIL_ANTIGO_DE_LEADS,
  FUNIL_DE_LEADS,
  GA4_CS,
  GSC_CS,
  LEAD_SDR,
  PERFIL_IG_CS,
  REP_DO_APP,
  REP_DO_CRM,
} from './apoio/marketing';
import { PEDIDO_GA4, RODADA_DO_CSV } from './apoio/trafego';
import { DONO } from './apoio/usuarios';

let db: PGlite;

beforeAll(async () => {
  db = await abrirBanco();
  for (const f of ['usuarios', 'marketing', 'trafego', 'conectores']) await aplicarFixture(db, f);
});

afterAll(async () => {
  await db.close();
});

const cliente = (externo: string, extra: Record<string, unknown> = {}) => ({
  kind: 'crm_customer',
  key: { external_id: externo },
  values: {
    code: `CLI-${externo}`,
    crm_status: 'prospect',
    source_created_at: '2026-10-01T10:00:00Z',
    ...extra,
  },
});

describe('as rodadas: start_run, take_requested_run e finish_run', () => {
  it('o worker abre a rodada de um trabalho do conector; trabalho de outro conector, CSV, pedido ou conector desligado, não', async () => {
    await caso(db, postgres, async (s) => {
      const id = await abrirRodada(s, 'meta', 'ads_hourly');
      expect(
        await s.linhas(
          `select status, run_trigger, job, started_at is not null as comecou, brand_id from mkt.sync_runs where id = $1`,
          [id],
        ),
      ).toEqual([
        { status: 'running', run_trigger: 'schedule', job: 'ads_hourly', comecou: true, brand_id: null },
      ]);
      expect((await s.erro('PT422', `select ingest.start_run('meta', 'crm_full_pass')`)).detail).toBe('job');
      expect((await s.erro('PT422', `select ingest.start_run('meta', 'csv_import')`)).detail).toBe('job');
      expect(
        (await s.erro('PT422', `select ingest.start_run('meta', 'ads_hourly', 'manual_retry')`)).detail,
      ).toBe('trigger');
      expect(
        (await s.erro('PT422', `select ingest.start_run('meta', 'ads_hourly', 'csv_upload')`)).detail,
      ).toBe('trigger');
      // A primeira carga tem gatilho próprio, com a marca.
      const carga = await s.valor<string>(
        `select ingest.start_run('meta', 'ads_backfill', 'backfill', 'cs')::text`,
      );
      expect(
        await s.valor(
          `select r.run_trigger || '/' || b.code from mkt.sync_runs r join mkt.brands b on b.id = r.brand_id where r.id = $1`,
          [carga],
        ),
      ).toBe('backfill/cs');

      await s.como(postgres);
      await s.exec(`update mkt.connectors set setup_state = 'disabled' where code = 'tiktok'`);
      await s.como(servico('mkt_worker'));
      expect((await s.erro('PT422', `select ingest.start_run('tiktok', 'ads_hourly')`)).detail).toBe(
        'disabled',
      );
    });
  });

  it('só a conexão do worker: o dono do banco recebe ING-403; a tela e os outros serviços nem alcançam a função', async () => {
    await caso(db, postgres, async (s) => {
      expect((await s.erro('PT403', `select ingest.start_run('meta', 'ads_hourly')`)).message).toBe(
        'ING-403',
      );
    });
    for (const quem of [
      usuario(DONO, 'aal2'),
      servico('mkt_executor'),
      servico('mkt_setup'),
      servico('n8n_notifier'),
    ]) {
      await caso(db, quem, async (s) => {
        await s.erro('42501', `select ingest.start_run('meta', 'ads_hourly')`);
        await s.erro('42501', `select * from ingest.take_requested_run(null)`);
      });
    }
  });

  it('take_requested_run pega o pedido mais antigo (do conector, se pedir) e o põe em andamento; o de conector desligado fica', async () => {
    await caso(db, servico('mkt_worker'), async (s) => {
      expect(await s.linhas(`select id::text, status, job from ingest.take_requested_run('ga4')`)).toEqual([
        { id: PEDIDO_GA4, status: 'running', job: 'ga4_daily' },
      ]);
      await s.como(postgres);
      await s.exec(`update mkt.connectors set setup_state = 'disabled' where code = 'meta'`);
      await s.como(servico('mkt_worker'));
      expect(await s.linhas(`select id from ingest.take_requested_run(null)`)).toEqual([]);
      await s.como(postgres);
      await s.exec(`update mkt.connectors set setup_state = 'connected' where code = 'meta'`);
      await s.como(servico('mkt_worker'));
      expect(await s.linhas(`select id::text, job from ingest.take_requested_run(null)`)).toEqual([
        { id: RODADA_DO_CSV, job: 'csv_import' },
      ]);
      expect(await s.linhas(`select id from ingest.take_requested_run(null)`)).toEqual([]);
    });
  });

  it('finish_run: a rodada boa grava a primeira e a última rodada boa do conector e do trabalho e liga o conector; a que falhou, não', async () => {
    await caso(db, postgres, async (s) => {
      const datas = `select k.setup_state, k.first_success_at is not null as base, k.last_success_at::text as ultima,
                            j.last_success_at::text as trabalho
                       from mkt.connectors k join mkt.connector_jobs j on j.connector_id = k.id and j.job = 'ga4_daily'
                      where k.code = 'ga4'`;
      expect(await s.linhas(datas)).toEqual([
        { setup_state: 'not_connected', base: false, ultima: null, trabalho: null },
      ]);

      const falhou = await abrirRodada(s, 'ga4', 'ga4_daily');
      expect((await s.erro('PT422', `select ingest.finish_run($1, 'failed')`, [falhou])).detail).toBe(
        'error_code',
      );
      expect((await s.erro('PT422', `select ingest.finish_run($1, 'partial')`, [falhou])).detail).toBe(
        'error_code',
      );
      expect((await s.erro('PT422', `select ingest.finish_run($1, 'running')`, [falhou])).detail).toBe(
        'status',
      );
      await s.valor(
        `select ingest.finish_run($1, 'failed', 'HTTP_403', 'A plataforma recusou a credencial.')::text`,
        [falhou],
      );
      expect(
        await s.linhas(
          `select status, error_code, error_message, finished_at is not null as fim from mkt.sync_runs where id = $1`,
          [falhou],
        ),
      ).toEqual([
        {
          status: 'failed',
          error_code: 'HTTP_403',
          error_message: 'A plataforma recusou a credencial.',
          fim: true,
        },
      ]);
      expect(await s.linhas(datas)).toEqual([
        { setup_state: 'not_connected', base: false, ultima: null, trabalho: null },
      ]);
      // Rodada fechada não fecha de novo.
      expect((await s.erro('PT422', `select ingest.finish_run($1, 'succeeded')`, [falhou])).detail).toBe(
        'run',
      );

      const boa = await abrirRodada(s, 'ga4', 'ga4_daily');
      await s.valor(
        `select ingest.finish_run($1, 'succeeded', 'IGNORADO', 'nada', '2026-11-03T12:00:00Z')::text`,
        [boa],
      );
      const fim = await s.valor<string>(`select finished_at::text from mkt.sync_runs where id = $1`, [boa]);
      expect(await s.linhas(datas)).toEqual([
        { setup_state: 'connected', base: true, ultima: fim, trabalho: fim },
      ]);
      expect(
        await s.linhas(
          `select error_code, error_message, watermark_to_at::text as ate from mkt.sync_runs where id = $1`,
          [boa],
        ),
      ).toEqual([{ error_code: null, error_message: null, ate: '2026-11-03 12:00:00+00' }]);
    });
  });

  it('finish_run: a mensagem com cara de dado pessoal não é gravada; o conector desligado continua desligado', async () => {
    await caso(db, postgres, async (s) => {
      const id = await abrirRodada(s, 'meta', 'ads_hourly');
      await s.valor(
        `select ingest.finish_run($1, 'partial', 'ROWS_REFUSED', 'linha recusada: falar com fulano@exemplo.com')::text`,
        [id],
      );
      expect(
        await s.linhas(`select status, error_code, error_message from mkt.sync_runs where id = $1`, [id]),
      ).toEqual([{ status: 'partial', error_code: 'ROWS_REFUSED', error_message: null }]);
      // A rodada partial conta como boa para as datas (integracoes.md, seção 2.3).
      expect(
        await s.valor(
          `select last_success_at = (select finished_at from mkt.sync_runs where id = $1) from mkt.connectors where code = 'meta'`,
          [id],
        ),
      ).toBe(true);
    });
  });

  it('o CSV dá base à fonte, mas não liga o conector; o arquivo lido sai da tabela e fica o registro', async () => {
    await caso(db, postgres, async (s) => {
      const rodada = await rodadaDoCsv(s, 'tiktok', 'cs');
      await s.valor(`select ingest.finish_run($1, 'succeeded')::text`, [rodada]);
      expect(
        await s.linhas(
          `select setup_state, first_success_at is not null as base from mkt.connectors where code = 'tiktok'`,
        ),
      ).toEqual([{ setup_state: 'not_connected', base: true }]);
      expect(
        await s.linhas(
          `select content is null as lido, rows_imported, rows_refused, refusal_code from mkt.csv_imports where sync_run_id = $1`,
          [rodada],
        ),
      ).toEqual([{ lido: true, rows_imported: 0, rows_refused: 0, refusal_code: null }]);

      const recusado = await rodadaDoCsv(s, 'tiktok', 'plumene');
      await s.valor(`select ingest.finish_run($1, 'failed', 'CSV_NO_CAMPAIGN_ID')::text`, [recusado]);
      expect(
        await s.linhas(
          `select content is null as lido, refusal_code from mkt.csv_imports where sync_run_id = $1`,
          [recusado],
        ),
      ).toEqual([{ lido: true, refusal_code: 'CSV_NO_CAMPAIGN_ID' }]);
    });
  });
});

describe('o lote e o evento de ingestão', () => {
  it('cada linha recusada volta com o código e a posição; o lote segue e a rodada conta gravadas e recusadas', async () => {
    await caso(db, postgres, async (s) => {
      const rodada = await abrirRodada(s, 'csp360', 'crm_incremental');
      expect(
        await gravar(s, 'upsert_brands', rodada, [
          { kind: 'brand', brand: 'cs', key: { external_id: 'marca-cs' }, values: { name: 'Corpo Sensual' } },
          { brand: 'xx', key: { external_id: 'marca-xx' } },
          5,
          { brand: 'plumene', key: { external_id: 'marca-pl' }, values: { nome: 'Plumene' } },
          { kind: 'campaign', brand: 'plumene', key: { external_id: 'marca-pl' } },
          { brand: 'plumene', key: {} },
          { brand: 'plumene', key: { external_id: 'marca-pl' }, email: 'x' },
        ]),
      ).toEqual([
        { item: 2, code: 'UNKNOWN_BRAND', is_refused: true },
        { item: 3, code: 'ROW', is_refused: true },
        { item: 4, code: 'UNKNOWN_FIELD', is_refused: true },
        { item: 5, code: 'ROW', is_refused: true },
        { item: 6, code: 'NOT_NULL', is_refused: true },
        { item: 7, code: 'UNKNOWN_FIELD', is_refused: true },
      ]);
      expect(await s.linhas(`select code, external_id, name from mkt.brands order by code`)).toEqual([
        { code: 'cs', external_id: 'marca-cs', name: 'Corpo Sensual' },
        { code: 'plumene', external_id: null, name: 'Plumene' },
      ]);
      expect(await contagens(s, rodada)).toEqual({
        rows_written: 1,
        rows_refused: 6,
        rows_deleted: 0,
        personal_data_dropped: 0,
      });
    });
  });

  it('a rodada precisa estar em andamento e ser do conector da tabela; o lote é uma lista de até 1.000', async () => {
    await caso(db, postgres, async (s) => {
      const meta = await abrirRodada(s, 'meta', 'ads_hourly');
      expect((await s.erro('PT422', `select * from ingest.upsert_brands($1, '[]')`, [meta])).detail).toBe(
        'connector',
      );
      const crm = await abrirRodada(s, 'csp360', 'crm_incremental');
      expect((await s.erro('PT422', `select * from ingest.upsert_brands($1, '{}')`, [crm])).detail).toBe(
        'rows',
      );
      const mil = JSON.stringify(Array.from({ length: 1001 }, () => ({})));
      expect(
        (await s.erro('PT422', `select * from ingest.upsert_brands($1, $2::jsonb)`, [crm, mil])).detail,
      ).toBe('rows');
      await s.valor(`select ingest.finish_run($1, 'succeeded')::text`, [crm]);
      expect((await s.erro('PT422', `select * from ingest.upsert_brands($1, '[]')`, [crm])).detail).toBe(
        'run',
      );
      expect(
        (
          await s.erro(
            'PT422',
            `select * from ingest.upsert_brands('00000000-0000-0000-0000-000000000000', '[]')`,
          )
        ).detail,
      ).toBe('run');
    });
  });
});

describe('a réplica do CRM', () => {
  const funil = (externo: string, nome: string, padrao: boolean) => ({
    key: { external_id: externo },
    values: { name: nome, is_default: padrao },
  });

  it('funis: o padrão do CRM é o de leads; o antigo dos leads do site, marcado pelo script, continua; o que deixa de ser o padrão deixa de ser de leads (decisão 0041)', async () => {
    await caso(db, postgres, async (s) => {
      const funis = () =>
        s.linhas(`select external_id, is_default, is_lead_funnel from mkt.crm_funnels order by 1`);
      const rodada = await abrirRodada(s, 'csp360', 'crm_full_pass');
      // A releitura: o padrão segue de leads; o antigo, marcado (fixture), continua; um funil novo que não é o padrão
      // nasce fora dos funis de leads.
      expect(
        await gravar(s, 'upsert_crm_funnels', rodada, [
          funil('funil-teste-0001', 'Funil de vendas', true),
          funil('funil-teste-0002', 'Funil antigo dos leads do site', false),
          funil('funil-teste-0004', 'Funil de pós-venda', false),
        ]),
      ).toEqual([]);
      expect(await funis()).toEqual([
        { external_id: 'funil-teste-0001', is_default: true, is_lead_funnel: true },
        { external_id: 'funil-teste-0002', is_default: false, is_lead_funnel: true },
        { external_id: 'funil-teste-0004', is_default: false, is_lead_funnel: false },
      ]);
      // O CRM troca o funil padrão: o novo é de leads, o que deixou de ser deixa de ser; o antigo marcado fica.
      expect(
        await gravar(s, 'upsert_crm_funnels', rodada, [
          funil('funil-teste-0001', 'Funil de vendas', false),
          funil('funil-teste-0003', 'Funil de vendas novo', true),
        ]),
      ).toEqual([]);
      expect(await funis()).toEqual([
        { external_id: 'funil-teste-0001', is_default: false, is_lead_funnel: false },
        { external_id: 'funil-teste-0002', is_default: false, is_lead_funnel: true },
        { external_id: 'funil-teste-0003', is_default: true, is_lead_funnel: true },
        { external_id: 'funil-teste-0004', is_default: false, is_lead_funnel: false },
      ]);
    });
  });

  it('funis: o nome com e-mail, telefone, documento ou @ vira o rótulo, nunca o texto, e a rodada conta (segunda barreira)', async () => {
    await caso(db, postgres, async (s) => {
      const rodada = await abrirRodada(s, 'csp360', 'crm_full_pass');
      expect(
        await gravar(s, 'upsert_crm_funnels', rodada, [
          funil('a1000000-0000-4000-8000-000000000001', 'Funil contato.teste@exemplo.com', false),
          funil('a2000000-0000-4000-8000-000000000002', 'Funil (11) 98765-4321', false),
          funil('a3000000-0000-4000-8000-000000000003', 'Funil CPF 123.456.789-09', false),
          funil('a4000000-0000-4000-8000-000000000004', 'Leads @equipe', false),
          funil('a5000000-0000-4000-8000-000000000005', 'Funil de pós-venda', false),
        ]),
      ).toEqual([]);
      expect(
        await s.linhas(
          `select name from mkt.crm_funnels where external_id like 'a_000000-%' order by external_id`,
        ),
      ).toEqual([
        { name: 'Funil a1000000' },
        { name: 'Funil a2000000' },
        { name: 'Funil a3000000' },
        { name: 'Funil a4000000' },
        { name: 'Funil de pós-venda' },
      ]);
      expect(await contagens(s, rodada)).toEqual({
        rows_written: 5,
        rows_refused: 0,
        rows_deleted: 0,
        personal_data_dropped: 4,
      });
    });
  });

  it('o funil antigo dos leads do site: setup.mark_lead_funnel marca o funil já lido, pelo id do CRM, e a releitura não desmarca; o não lido, o padrão e o dono do banco são recusados', async () => {
    await caso(db, postgres, async (s) => {
      const rodada = await abrirRodada(s, 'csp360', 'crm_full_pass');
      const leitura = [funil('funil-teste-0004', 'Outro funil antigo de leads', false)];
      await gravar(s, 'upsert_crm_funnels', rodada, leitura);
      await s.como(servico('mkt_setup'));
      const recusa = async (codigo: string, externo: unknown) => {
        const e = await s.erro(codigo, `select setup.mark_lead_funnel($1)`, [externo]);
        return [e.message, e.detail];
      };
      // O funil que a réplica ainda não leu: recusado com clareza (rodar depois da primeira passada completa).
      expect(await recusa('PT404', 'funil-nao-lido')).toEqual(['SET-404', 'funnel']);
      // O funil padrão já é de leads pela regra: marcar seria engano de id.
      expect(await recusa('PT422', 'funil-teste-0001')).toEqual(['SET-422', 'default_funnel']);
      expect(await recusa('PT422', 'funil 0004')).toEqual(['SET-422', 'external_id']);
      expect(await recusa('PT422', null)).toEqual(['SET-422', 'external_id']);
      // O id tem até 64 letras: o de 64 é procurado; o de 65 é recusado antes.
      expect(await recusa('PT404', 'f'.repeat(64))).toEqual(['SET-404', 'funnel']);
      expect(await recusa('PT422', 'f'.repeat(65))).toEqual(['SET-422', 'external_id']);

      const id = await s.valor<string>(`select setup.mark_lead_funnel('funil-teste-0004')::text`);
      // Rodar de novo devolve o mesmo funil; a releitura do funil não tira a marca.
      expect(await s.valor(`select setup.mark_lead_funnel('funil-teste-0004')::text`)).toBe(id);
      // Rodar de novo não regrava a linha: o funil da fixture, marcado antes deste caso, fica igual, também o
      // updated_at e a versão da linha (xmin). Na mesma transação o updated_at não andaria (o now() é o do começo dela).
      const linha = `select row_to_json(f)::text || ' ' || f.xmin::text from mkt.crm_funnels f where f.id = $1`;
      await s.como(postgres);
      const antes = await s.valor<string>(linha, [FUNIL_ANTIGO_DE_LEADS]);
      await s.como(servico('mkt_setup'));
      expect(await s.valor(`select setup.mark_lead_funnel('funil-teste-0002')::text`)).toBe(
        FUNIL_ANTIGO_DE_LEADS,
      );
      await s.como(postgres);
      expect(await s.valor<string>(linha, [FUNIL_ANTIGO_DE_LEADS])).toBe(antes);
      await s.como(servico('mkt_worker'));
      expect(await gravar(s, 'upsert_crm_funnels', rodada, leitura)).toEqual([]);
      await s.como(postgres);
      expect(
        await s.linhas(
          `select id::text, external_id, is_default, is_lead_funnel from mkt.crm_funnels where is_lead_funnel order by 2`,
        ),
      ).toEqual([
        { id: FUNIL_DE_LEADS, external_id: 'funil-teste-0001', is_default: true, is_lead_funnel: true },
        {
          id: FUNIL_ANTIGO_DE_LEADS,
          external_id: 'funil-teste-0002',
          is_default: false,
          is_lead_funnel: true,
        },
        { id, external_id: 'funil-teste-0004', is_default: false, is_lead_funnel: true },
      ]);
      // Só a conexão do script: o dono do banco, que executa a função, não marca.
      expect((await s.erro('PT403', `select setup.mark_lead_funnel('funil-teste-0004')`)).message).toBe(
        'SET-403',
      );
    });
  });

  it('representantes: o papel fora da lista entra nulo, sem recusar a linha (decisão 0041, item 8); a releitura não gasta código', async () => {
    await caso(db, postgres, async (s) => {
      // A sequência não volta com o rollback de outro caso: começa de onde a fixture deixou (REP-0002).
      await s.exec(`select setval('mkt.sales_rep_code_seq', 2)`);
      const rodada = await abrirRodada(s, 'csp360', 'crm_full_pass');
      const reps = [
        { key: { external_id: 'usr-teste-0001' }, values: { crm_role: 'supervisor', is_active: false } },
        { key: { external_id: 'usr-teste-0002' }, values: { crm_role: 'customer_service' } },
        { key: { external_id: 'usr-teste-0003' }, values: { crm_role: 'chefe' } },
        { key: { external_id: 'usr-teste-0004' }, values: { crm_role: 'relationship' } },
      ];
      expect(await gravar(s, 'upsert_sales_reps', rodada, reps)).toEqual([]);
      expect(await gravar(s, 'upsert_sales_reps', rodada, reps)).toEqual([]);
      expect(
        await s.linhas(`select code, external_id, crm_role, is_active from mkt.sales_reps order by code`),
      ).toEqual([
        { code: 'REP-0001', external_id: 'usr-teste-0001', crm_role: 'supervisor', is_active: false },
        { code: 'REP-0002', external_id: null, crm_role: null, is_active: true },
        { code: 'REP-0003', external_id: 'usr-teste-0002', crm_role: 'customer_service', is_active: true },
        { code: 'REP-0004', external_id: 'usr-teste-0003', crm_role: null, is_active: true },
        { code: 'REP-0005', external_id: 'usr-teste-0004', crm_role: null, is_active: true },
      ]);
      // Na releitura, o papel fora da lista (aqui, o do CRM sem a conversão do worker) troca o que havia por nulo.
      expect(
        await gravar(s, 'upsert_sales_reps', rodada, [
          { key: { external_id: 'usr-teste-0002' }, values: { crm_role: 'atendimento' } },
        ]),
      ).toEqual([]);
      expect(
        await s.valor(`select crm_role from mkt.sales_reps where external_id = 'usr-teste-0002'`),
      ).toBeNull();
      expect((await contagens(s, rodada)).rows_refused).toBe(0);
      await s.como(postgres);
      expect(await s.valor(`select last_value::int from mkt.sales_rep_code_seq`)).toBe(5);
    });
  });

  it('logins de app: do representante do CRM ou de um só de app; o login fora do formato é recusado sem gastar código', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(`select setval('mkt.sales_rep_code_seq', 2)`);
      const rodada = await abrirRodada(s, 'csp360', 'crm_full_pass');
      expect(
        await gravar(s, 'upsert_sales_rep_app_logins', rodada, [
          {
            brand: 'cs',
            key: { app_login_key: LOGIN_A },
            values: { sales_rep_external_id: 'usr-teste-0001' },
          },
          { brand: 'plumene', key: { app_login_key: LOGIN_B } },
          { brand: 'cs', key: { app_login_key: 'fulano@exemplo.com' } },
          {
            brand: 'cs',
            key: { app_login_key: LOGIN_C },
            values: { sales_rep_external_id: 'usr-nao-existe' },
          },
          { brand: 'plumene', key: { app_login_key: LOGIN_B } },
        ]),
      ).toEqual([
        { item: 3, code: 'CHECK', is_refused: true },
        { item: 4, code: 'UNKNOWN_SALES_REP', is_refused: true },
      ]);
      expect(
        await s.linhas(
          `select b.code as marca, r.code as rep, r.external_id
             from mkt.sales_rep_app_logins l join mkt.sales_reps r on r.id = l.sales_rep_id join mkt.brands b on b.id = l.brand_id
            where l.app_login_key in ($1, $2) order by 1`,
          [LOGIN_A, LOGIN_B],
        ),
      ).toEqual([
        { marca: 'cs', rep: 'REP-0001', external_id: 'usr-teste-0001' },
        { marca: 'plumene', rep: 'REP-0003', external_id: null },
      ]);
      await s.como(postgres);
      expect(await s.valor(`select last_value::int from mkt.sales_rep_code_seq`)).toBe(3);
    });
  });

  it('clientes: a UTM de primeiro contato com e-mail ou telefone vira nulo (o nome de campanha com número fica), e a rodada conta', async () => {
    await caso(db, postgres, async (s) => {
      const rodada = await abrirRodada(s, 'csp360', 'crm_incremental');
      expect(
        await gravar(s, 'upsert_crm_customers', rodada, [
          cliente('cli-teste-0101', {
            first_utm_source: ' newsletter@exemplo.com ',
            first_utm_medium: '11987654321',
            first_utm_campaign: 'promo 11987654321',
          }),
          cliente('cli-teste-0102', { first_utm_source: 'meta', first_utm_campaign: 'oferta@exemplo' }),
          cliente('cli-teste-0103', { first_utm_campaign: 'x'.repeat(200), crm_status: 'ativo' }),
          cliente('cli-teste-0104', { nome: 'Fulana' }),
        ]),
      ).toEqual([
        { item: 3, code: 'CHECK', is_refused: true },
        { item: 4, code: 'UNKNOWN_FIELD', is_refused: true },
      ]);
      expect(
        await s.linhas(
          `select external_id, first_utm_source, first_utm_medium, first_utm_campaign from mkt.crm_customers
            where external_id like 'cli-teste-01%' order by 1`,
        ),
      ).toEqual([
        {
          external_id: 'cli-teste-0101',
          first_utm_source: null,
          first_utm_medium: null,
          first_utm_campaign: 'promo 11987654321',
        },
        {
          external_id: 'cli-teste-0102',
          first_utm_source: 'meta',
          first_utm_medium: null,
          first_utm_campaign: null,
        },
      ]);
      expect(await contagens(s, rodada)).toEqual({
        rows_written: 2,
        rows_refused: 2,
        rows_deleted: 0,
        personal_data_dropped: 3,
      });
      // A UTM longa entra cortada em 150 letras.
      await gravar(s, 'upsert_crm_customers', rodada, [
        cliente('cli-teste-0103', { first_utm_campaign: 'x'.repeat(200) }),
      ]);
      expect(
        await s.valor(
          `select length(first_utm_campaign) from mkt.crm_customers where external_id = 'cli-teste-0103'`,
        ),
      ).toBe(150);
    });
  });

  it('situação, carteira e pedidos: cliente que não está na réplica é recusado; o vendedor sai do login de app', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(`select setval('mkt.sales_rep_code_seq', 2)`);
      const rodada = await abrirRodada(s, 'csp360', 'crm_incremental');
      expect(
        await gravar(s, 'upsert_crm_customer_brands', rodada, [
          {
            brand: 'plumene',
            key: { customer_external_id: 'cli-teste-0002' },
            values: { situation: 'lead' },
          },
          { brand: 'cs', key: { customer_external_id: 'cli-nao-existe' }, values: {} },
          { brand: 'cs', key: { customer_external_id: 'cli-teste-0002' }, values: { situation: 'perdido' } },
        ]),
      ).toEqual([
        { item: 2, code: 'UNKNOWN_CUSTOMER', is_refused: true },
        { item: 3, code: 'CHECK', is_refused: true },
      ]);
      expect(
        await gravar(s, 'upsert_crm_customer_reps', rodada, [
          { brand: 'plumene', key: { customer_external_id: 'cli-teste-0002', app_login_key: LOGIN_D } },
        ]),
      ).toEqual([]);
      expect(
        await gravar(s, 'upsert_crm_orders', rodada, [
          {
            brand: 'plumene',
            key: { external_id: 'ped-teste-0002' },
            values: {
              customer_external_id: 'cli-teste-0002',
              status: 'sent',
              is_invoiced: true,
              total_cents: 9900,
              sales_rep_app_login_key: LOGIN_D,
              source_created_at: '2026-11-04T10:00:00Z',
            },
          },
          {
            brand: 'cs',
            key: { external_id: 'ped-teste-0003' },
            values: { status: 'enviado', total_cents: 1, source_created_at: '2026-11-04T10:00:00Z' },
          },
          {
            brand: 'cs',
            key: { external_id: 'ped-teste-0004' },
            values: {
              status: 'quote',
              is_invoiced: true,
              total_cents: 1,
              source_created_at: '2026-11-04T10:00:00Z',
            },
          },
          {
            brand: 'cs',
            key: { external_id: 'ped-teste-0005' },
            values: {
              customer_external_id: 'cli-nao-existe',
              status: 'sent',
              total_cents: 1,
              source_created_at: '2026-11-04T10:00:00Z',
            },
          },
        ]),
      ).toEqual([
        { item: 2, code: 'CHECK', is_refused: true },
        { item: 3, code: 'CHECK', is_refused: true },
        { item: 4, code: 'UNKNOWN_CUSTOMER', is_refused: true },
      ]);
      // A carteira e o pedido apontam para o mesmo representante só de app, criado pelo login.
      expect(
        await s.linhas(
          `select r.code, r.external_id,
                  (select count(*)::int from mkt.crm_customer_reps cr where cr.sales_rep_id = r.id) as carteira,
                  (select count(*)::int from mkt.crm_orders o where o.sales_rep_id = r.id and o.is_invoiced) as pedidos
             from mkt.sales_reps r
             join mkt.sales_rep_app_logins l on l.sales_rep_id = r.id
            where l.app_login_key = $1`,
          [LOGIN_D],
        ),
      ).toEqual([{ code: 'REP-0003', external_id: null, carteira: 1, pedidos: 1 }]);
      expect(
        await gravar(s, 'upsert_crm_upstream_runs', rodada, [
          {
            brand: 'cs',
            key: { external_id: 'sinc-teste-0002' },
            values: { run_trigger: 'manual', started_at: '2026-11-04T10:00:00Z', is_ok: false },
          },
          {
            key: { external_id: 'sinc-teste-0003' },
            values: { run_trigger: 'webhook', started_at: '2026-11-04T10:00:00Z', is_ok: true },
          },
        ]),
      ).toEqual([{ item: 2, code: 'CHECK', is_refused: true }]);
    });
  });

  it('leads: entra o negócio de um funil de leads, o sem funil (no funil padrão, quando há um só) e o que já está aqui, em qualquer funil; o resto é ignorado (não é recusa)', async () => {
    await caso(db, postgres, async (s) => {
      const rodada = await abrirRodada(s, 'csp360', 'crm_incremental');
      await gravar(s, 'upsert_crm_funnels', rodada, [funil('funil-teste-0004', 'Vendas diretas', false)]);
      const negocio = (externo: string, funilDoCrm: string | null, codigo: string) => ({
        brand: 'cs',
        key: { kind: 'deal', external_id: externo },
        values: {
          code: codigo,
          ...(funilDoCrm === null ? {} : { funnel_external_id: funilDoCrm }),
          source_created_at: '2026-11-02T10:00:00Z',
        },
      });
      const negocios = () =>
        s.linhas(
          `select l.external_id, l.code, f.external_id as funil from mkt.crm_leads l
             left join mkt.crm_funnels f on f.id = l.crm_funnel_id where l.kind = 'deal' order by 1`,
        );
      expect(
        await gravar(s, 'upsert_crm_leads', rodada, [
          negocio('neg-teste-0101', 'funil-teste-0001', 'NEG-9101'),
          negocio('neg-teste-0102', 'funil-teste-0004', 'NEG-9102'),
          negocio('neg-teste-0001', 'funil-teste-0004', 'NEG-9001'),
          {
            key: { kind: 'deal', external_id: 'neg-teste-0103' },
            values: { funnel_external_id: 'funil-teste-0001', source_created_at: '2026-11-02T10:00:00Z' },
          },
          negocio('neg-teste-0104', null, 'NEG-9104'),
          negocio('neg-teste-0105', 'funil-nao-lido', 'NEG-9105'),
          // Um lead encerrado que ficou no funil antigo dos leads do site.
          negocio('neg-teste-0108', 'funil-teste-0002', 'NEG-9108'),
        ]),
      ).toEqual([
        { item: 2, code: 'NOT_LEAD_FUNNEL', is_refused: false },
        { item: 4, code: 'NOT_NULL', is_refused: true },
        { item: 6, code: 'NOT_LEAD_FUNNEL', is_refused: false },
      ]);
      expect(await negocios()).toEqual([
        // O que já estava aqui continua entrando, também num funil que não é de leads.
        { external_id: 'neg-teste-0001', code: 'NEG-9001', funil: 'funil-teste-0004' },
        // O da fixture, fora deste lote, fica como estava (o sem funil daqui é o neg-teste-0104; o da conversão do
        // SDR, o caso seguinte).
        { external_id: 'neg-teste-0002', code: 'NEG-9002', funil: 'funil-teste-0001' },
        { external_id: 'neg-teste-0101', code: 'NEG-9101', funil: 'funil-teste-0001' },
        { external_id: 'neg-teste-0104', code: 'NEG-9104', funil: 'funil-teste-0001' },
        { external_id: 'neg-teste-0108', code: 'NEG-9108', funil: 'funil-teste-0002' },
      ]);
      expect((await contagens(s, rodada)).rows_refused).toBe(1);

      // Dois funis padrão na réplica: não há como saber qual é o do negócio sem funil. Ele entra, sem funil.
      await gravar(s, 'upsert_crm_funnels', rodada, [funil('funil-teste-0003', 'Outro funil padrão', true)]);
      expect(
        await gravar(s, 'upsert_crm_leads', rodada, [
          negocio('neg-teste-0104', null, 'NEG-9104'),
          negocio('neg-teste-0106', null, 'NEG-9106'),
        ]),
      ).toEqual([]);
      // E sem nenhum funil padrão, também.
      await gravar(s, 'upsert_crm_funnels', rodada, [
        funil('funil-teste-0001', 'Funil de vendas', false),
        funil('funil-teste-0003', 'Outro funil padrão', false),
      ]);
      expect(
        await gravar(s, 'upsert_crm_leads', rodada, [negocio('neg-teste-0107', null, 'NEG-9107')]),
      ).toEqual([]);
      expect(
        await s.linhas(
          `select external_id, crm_funnel_id from mkt.crm_leads
            where external_id in ('neg-teste-0104', 'neg-teste-0106', 'neg-teste-0107') order by 1`,
        ),
      ).toEqual([
        { external_id: 'neg-teste-0104', crm_funnel_id: null },
        { external_id: 'neg-teste-0106', crm_funnel_id: null },
        { external_id: 'neg-teste-0107', crm_funnel_id: null },
      ]);
    });
  });

  it('o negócio da conversão do SDR: sem funil e sem marca, com a origem "SDR WhatsApp"; entra no funil padrão, com a origem sdr do de-para (decisão 0041, itens 1 e 3)', async () => {
    await caso(db, postgres, async (s) => {
      const rodada = await abrirRodada(s, 'csp360', 'crm_incremental');
      expect(
        await gravar(s, 'upsert_crm_leads', rodada, [
          {
            key: { kind: 'deal', external_id: 'neg-teste-0201' },
            values: {
              code: 'NEG-9201',
              customer_external_id: 'cli-teste-0002',
              origin: ' SDR WhatsApp ',
              source_created_at: '2026-11-04T00:00:00Z',
            },
          },
        ]),
      ).toEqual([]);
      expect(
        await s.linhas(
          `select l.brand_id, f.external_id as funil, l.crm_origin_raw, l.is_origin_unmapped, m.origin
             from mkt.crm_leads l
             left join mkt.crm_funnels f on f.id = l.crm_funnel_id
             left join mkt.crm_origin_map m on m.raw_value = l.crm_origin_raw
            where l.kind = 'deal' and l.external_id = 'neg-teste-0201'`,
        ),
      ).toEqual([
        {
          brand_id: null,
          funil: 'funil-teste-0001',
          crm_origin_raw: 'sdr whatsapp',
          is_origin_unmapped: false,
          origin: 'sdr',
        },
      ]);
    });
  });

  it('o negócio aberto à mão ("Carteira" ou "Prospecção ativa"): entra com a origem guardada, sem pendência de de-para, e o de-para diz que não é lead (decisão 0041, item 9)', async () => {
    await caso(db, postgres, async (s) => {
      const rodada = await abrirRodada(s, 'csp360', 'crm_incremental');
      const negocio = (externo: string, codigo: string, origem: string) => ({
        brand: 'cs',
        key: { kind: 'deal', external_id: externo },
        values: {
          code: codigo,
          funnel_external_id: 'funil-teste-0001',
          origin: origem,
          source_created_at: '2026-11-04T00:00:00Z',
        },
      });
      expect(
        await gravar(s, 'upsert_crm_leads', rodada, [
          negocio('neg-mao-0001', 'NEG-9301', 'Carteira'),
          negocio('neg-mao-0002', 'NEG-9302', 'Prospecção ativa'),
          negocio('neg-mao-0003', 'NEG-9303', ' PROSPECCAO ATIVA '),
          // As outras origens da tela do CRM continuam de lead.
          negocio('neg-mao-0004', 'NEG-9304', 'Feira'),
          negocio('neg-mao-0005', 'NEG-9305', 'Instagram'),
          {
            key: { kind: 'sdr', external_id: 'sdr-mao-0001' },
            values: { origin: 'Carteira', source_created_at: '2026-11-04T13:00:00Z' },
          },
        ]),
      ).toEqual([]);
      const linha = (
        kind: string,
        external_id: string,
        crm_origin_raw: string | null,
        is_origin_unmapped: boolean,
        is_lead: boolean | null,
      ) => ({
        kind,
        external_id,
        funil: kind === 'deal' ? 'funil-teste-0001' : null,
        crm_origin_raw,
        is_origin_unmapped,
        is_lead,
      });
      expect(
        await s.linhas(
          `select l.kind, l.external_id, f.external_id as funil, l.crm_origin_raw, l.is_origin_unmapped, m.is_lead
             from mkt.crm_leads l
             left join mkt.crm_funnels f on f.id = l.crm_funnel_id
             left join mkt.crm_origin_map m on m.raw_value = l.crm_origin_raw
            where l.external_id like '%-mao-%' order by 1, 2`,
        ),
      ).toEqual([
        linha('deal', 'neg-mao-0001', 'carteira', false, false),
        linha('deal', 'neg-mao-0002', 'prospecção ativa', false, false),
        linha('deal', 'neg-mao-0003', 'prospeccao ativa', false, false),
        linha('deal', 'neg-mao-0004', null, true, null),
        linha('deal', 'neg-mao-0005', 'instagram', false, null),
        linha('sdr', 'sdr-mao-0001', 'carteira', false, false),
      ]);
      // A regra da mkt.v_leads (fase 4; metricas.md, seção 3.4) deixa de fora só o negócio cuja origem o de-para marca
      // como não lead: o lead do SDR é sempre lead, e a origem sem de-para continua na pendência.
      expect(
        await s.linhas(
          `select l.external_id, l.is_origin_unmapped
             from mkt.crm_leads l
             left join mkt.crm_origin_map m on m.raw_value = lower(btrim(l.crm_origin_raw))
            where l.external_id like '%-mao-%' and (l.kind = 'sdr' or coalesce(m.is_lead, true))
            order by 1`,
        ),
      ).toEqual([
        { external_id: 'neg-mao-0004', is_origin_unmapped: true },
        { external_id: 'neg-mao-0005', is_origin_unmapped: false },
        { external_id: 'sdr-mao-0001', is_origin_unmapped: false },
      ]);
      // O CRM troca a origem ("Carteira" é o padrão do campo, e o Editar troca a de qualquer negócio): a releitura
      // segue o CRM, nos dois sentidos. O negócio que perde a origem de não lead volta a ser lead também quando a
      // origem nova fica fora do de-para ("Feira", que vira pendência) ou não vem.
      expect(
        await gravar(s, 'upsert_crm_leads', rodada, [
          negocio('neg-mao-0001', 'NEG-9301', 'Indicação'),
          negocio('neg-mao-0002', 'NEG-9302', 'Feira'),
          negocio('neg-mao-0003', 'NEG-9303', ''),
          negocio('neg-mao-0004', 'NEG-9304', 'Carteira'),
        ]),
      ).toEqual([]);
      const relida = (
        external_id: string,
        crm_origin_raw: string | null,
        is_origin_unmapped: boolean,
        is_lead: boolean | null,
      ) => ({ external_id, crm_origin_raw, is_origin_unmapped, is_lead });
      expect(
        await s.linhas(
          `select l.external_id, l.crm_origin_raw, l.is_origin_unmapped, m.is_lead
             from mkt.crm_leads l
             left join mkt.crm_origin_map m on m.raw_value = l.crm_origin_raw
            where l.external_id in ('neg-mao-0001', 'neg-mao-0002', 'neg-mao-0003', 'neg-mao-0004') order by 1`,
        ),
      ).toEqual([
        relida('neg-mao-0001', 'indicação', false, true),
        relida('neg-mao-0002', null, true, null),
        relida('neg-mao-0003', null, false, null),
        relida('neg-mao-0004', 'carteira', false, false),
      ]);
    });
  });

  it('leads: o responsável pelo código do representante; o negócio que vem sem ele fica sem, mesmo que antes tivesse (decisão 0041, item 6)', async () => {
    await caso(db, postgres, async (s) => {
      const rodada = await abrirRodada(s, 'csp360', 'crm_incremental');
      const negocio = (responsavel?: string) => ({
        brand: 'cs',
        key: { kind: 'deal', external_id: 'neg-teste-0001' },
        values: {
          code: 'NEG-9001',
          funnel_external_id: 'funil-teste-0001',
          source_created_at: '2026-10-22T10:00:00Z',
          ...(responsavel === undefined ? {} : { assigned_rep_external_id: responsavel }),
        },
      });
      const responsavel = () =>
        s.valor(`select assigned_rep_id::text from mkt.crm_leads where external_id = 'neg-teste-0001'`);
      expect(await gravar(s, 'upsert_crm_leads', rodada, [negocio('usr-teste-0001')])).toEqual([]);
      expect(await responsavel()).toBe(REP_DO_CRM);
      // Fora da view negocios_responsavel (nome repetido, desconhecido ou vazio no CRM): "Sem representante".
      expect(await gravar(s, 'upsert_crm_leads', rodada, [negocio()])).toEqual([]);
      expect(await responsavel()).toBeNull();
      // O id que ainda não está na réplica também fica nulo, sem recusar o lead.
      await gravar(s, 'upsert_crm_leads', rodada, [negocio('usr-teste-0001')]);
      expect(await gravar(s, 'upsert_crm_leads', rodada, [negocio('usr-nao-lido')])).toEqual([]);
      expect(await responsavel()).toBeNull();
    });
  });

  it('retrato do ERP por cliente e marca: o que o CRM não entrega fica nulo; o total negativo vira nulo; a compra mais antiga já vista só anda para trás (decisões 0041 e 0042)', async () => {
    await caso(db, postgres, async (s) => {
      const rodada = await abrirRodada(s, 'csp360', 'crm_incremental');
      const retrato = (valores: Record<string, unknown>) => ({
        brand: 'plumene',
        key: { customer_external_id: 'cli-teste-0002' },
        values: valores,
      });
      const ler = async (...retratos: Record<string, unknown>[]) => {
        expect(await gravar(s, 'upsert_crm_customer_brands', rodada, retratos.map(retrato))).toEqual([]);
        const [linha] = await s.linhas(
          `select situation, is_lost_manual, last_purchase_on, situation_computed_at,
                  erp_first_purchase_on::text as primeira, erp_last_purchase_on::text as ultima,
                  erp_earliest_purchase_on::text as mais_antiga, erp_total_purchased_cents as total
             from mkt.crm_customer_brands
            where customer_id = $1 and brand_id = (select id from mkt.brands where code = 'plumene')`,
          [CLIENTE_B],
        );
        return linha;
      };
      // A primeira leitura: só o retrato. Situação, perdido à mão, última compra da régua e hora do cálculo: nulos.
      expect(await ler({ erp_last_purchase_on: '2026-03-10', erp_total_purchased_cents: 150000 })).toEqual({
        situation: null,
        is_lost_manual: null,
        last_purchase_on: null,
        situation_computed_at: null,
        primeira: null,
        ultima: '2026-03-10',
        mais_antiga: '2026-03-10',
        total: 150000,
      });
      // O retrato trocado pela compra nova feita pelo app: a última compra anda para a frente; a mais antiga, não.
      expect(
        await ler({ erp_last_purchase_on: '2026-09-20', erp_total_purchased_cents: 210000 }),
      ).toMatchObject({
        ultima: '2026-09-20',
        mais_antiga: '2026-03-10',
      });
      // Uma última compra anterior à guardada: a mais antiga anda para trás.
      expect(await ler({ erp_last_purchase_on: '2026-02-01' })).toMatchObject({ mais_antiga: '2026-02-01' });
      // A primeira compra, quando o CRM a entregar, vale se for mais antiga; posterior, não.
      expect(
        await ler({ erp_first_purchase_on: '2025-06-01', erp_last_purchase_on: '2026-10-05' }),
      ).toMatchObject({ primeira: '2025-06-01', ultima: '2026-10-05', mais_antiga: '2025-06-01' });
      expect(await ler({ erp_first_purchase_on: '2025-12-01' })).toMatchObject({
        primeira: '2025-12-01',
        ultima: null,
        mais_antiga: '2025-06-01',
      });
      // Sem nenhuma data no retrato, fica a guardada.
      expect(await ler({})).toMatchObject({ primeira: null, ultima: null, mais_antiga: '2025-06-01' });
      // O perdido à mão só quando vier; o total negativo vira nulo, sem recusar a linha.
      expect(await ler({ is_lost_manual: true, erp_total_purchased_cents: -500 })).toMatchObject({
        is_lost_manual: true,
        total: null,
      });
      expect(await ler({})).toMatchObject({ is_lost_manual: null, total: null });
      // A data mais antiga é calculada aqui: o worker não manda.
      expect(
        await gravar(s, 'upsert_crm_customer_brands', rodada, [
          retrato({ erp_earliest_purchase_on: '2000-01-01' }),
        ]),
      ).toEqual([{ item: 1, code: 'UNKNOWN_FIELD', is_refused: true }]);
      expect(await contagens(s, rodada)).toMatchObject({ rows_written: 8, rows_refused: 1 });
    });
  });

  it('leads do SDR: o código LEAD- vem do gatilho e a releitura não gasta outro', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(`select setval('mkt.lead_code_seq', 1)`);
      const rodada = await abrirRodada(s, 'csp360', 'crm_incremental');
      const sdr = (externo: string) => ({
        key: { kind: 'sdr', external_id: externo },
        values: {
          customer_external_id: 'cli-teste-0002',
          code: 'NEG-1',
          source_created_at: '2026-11-03T10:00:00Z',
        },
      });
      for (let i = 0; i < 2; i += 1) {
        expect(
          await gravar(s, 'upsert_crm_leads', rodada, [sdr('sdr-teste-0001'), sdr('sdr-teste-0101')]),
        ).toEqual([]);
      }
      expect(
        await s.linhas(`select external_id, code, brand_id from mkt.crm_leads where kind = 'sdr' order by 1`),
      ).toEqual([
        { external_id: 'sdr-teste-0001', code: 'LEAD-0001', brand_id: null },
        { external_id: 'sdr-teste-0101', code: 'LEAD-0002', brand_id: null },
      ]);
      await s.como(postgres);
      expect(await s.valor(`select last_value::int from mkt.lead_code_seq`)).toBe(2);
      expect(await s.valor(`select customer_id::text from mkt.crm_leads where id = $1`, [LEAD_SDR])).toBe(
        CLIENTE_B,
      );
    });
  });

  it('leads: a origem do CRM só é guardada se está no de-para, se é fonte conhecida ou se é a UTM de primeiro contato do cliente', async () => {
    await caso(db, postgres, async (s) => {
      const rodada = await abrirRodada(s, 'csp360', 'crm_incremental');
      await gravar(s, 'upsert_crm_customers', rodada, [
        cliente('cli-teste-0201', { first_utm_source: 'parceiro-x' }),
        cliente('cli-teste-0202'),
      ]);
      const sdr = (externo: string, valores: Record<string, unknown>) => ({
        key: { kind: 'sdr', external_id: externo },
        values: { source_created_at: '2026-11-03T10:00:00Z', ...valores },
      });
      expect(
        await gravar(s, 'upsert_crm_leads', rodada, [
          sdr('sdr-o-1', { origin: ' Indicação ' }),
          sdr('sdr-o-2', { origin: 'Facebook' }),
          sdr('sdr-o-3', { origin: 'Parceiro-X', customer_external_id: 'cli-teste-0201' }),
          sdr('sdr-o-4', { origin: 'parceiro-x', customer_external_id: 'cli-teste-0202' }),
          sdr('sdr-o-5', { origin: 'Fulano indicou' }),
          sdr('sdr-o-6', { origin: '   ' }),
          sdr('sdr-o-7', { referrer_host: 'https://www.Google.com/search?q=lingerie' }),
          sdr('sdr-o-8', { referrer_host: 'fulano@exemplo.com' }),
          sdr('sdr-o-9', {
            utm_source: 'meta',
            utm_medium: 'contato@exemplo.com',
            utm_campaign: 'cs 120200000000000001',
          }),
        ]),
      ).toEqual([]);
      expect(
        await s.linhas(
          `select external_id, crm_origin_raw, is_origin_unmapped, referrer_host, utm_source, utm_medium, utm_campaign
             from mkt.crm_leads where external_id like 'sdr-o-%' order by 1`,
        ),
      ).toEqual([
        {
          external_id: 'sdr-o-1',
          crm_origin_raw: 'indicação',
          is_origin_unmapped: false,
          referrer_host: null,
          utm_source: null,
          utm_medium: null,
          utm_campaign: null,
        },
        {
          external_id: 'sdr-o-2',
          crm_origin_raw: 'facebook',
          is_origin_unmapped: false,
          referrer_host: null,
          utm_source: null,
          utm_medium: null,
          utm_campaign: null,
        },
        {
          external_id: 'sdr-o-3',
          crm_origin_raw: 'parceiro-x',
          is_origin_unmapped: false,
          referrer_host: null,
          utm_source: null,
          utm_medium: null,
          utm_campaign: null,
        },
        {
          external_id: 'sdr-o-4',
          crm_origin_raw: null,
          is_origin_unmapped: true,
          referrer_host: null,
          utm_source: null,
          utm_medium: null,
          utm_campaign: null,
        },
        {
          external_id: 'sdr-o-5',
          crm_origin_raw: null,
          is_origin_unmapped: true,
          referrer_host: null,
          utm_source: null,
          utm_medium: null,
          utm_campaign: null,
        },
        {
          external_id: 'sdr-o-6',
          crm_origin_raw: null,
          is_origin_unmapped: false,
          referrer_host: null,
          utm_source: null,
          utm_medium: null,
          utm_campaign: null,
        },
        {
          external_id: 'sdr-o-7',
          crm_origin_raw: null,
          is_origin_unmapped: false,
          referrer_host: 'google.com',
          utm_source: null,
          utm_medium: null,
          utm_campaign: null,
        },
        {
          external_id: 'sdr-o-8',
          crm_origin_raw: null,
          is_origin_unmapped: false,
          referrer_host: null,
          utm_source: null,
          utm_medium: null,
          utm_campaign: null,
        },
        {
          external_id: 'sdr-o-9',
          crm_origin_raw: null,
          is_origin_unmapped: false,
          referrer_host: null,
          utm_source: 'meta',
          utm_medium: null,
          utm_campaign: 'cs 120200000000000001',
        },
      ]);
      expect((await contagens(s, rodada)).personal_data_dropped).toBe(2);
    });
  });
});

describe('mídia paga', () => {
  it('contas: só a cadastrada (a de fora é ignorada); moeda que não é real é recusada; o teto 0 da Meta entra nulo; a leitura dá base', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(`update mkt.ad_accounts set first_read_at = null where id = '${CONTA_META_CS}'`);
      const rodada = await abrirRodada(s, 'meta', 'ads_backfill');
      expect(
        await gravar(s, 'upsert_ad_accounts', rodada, [
          {
            key: { external_id: ACT_META_CS },
            values: {
              name: 'Conta Meta renomeada',
              spend_cap_cents: 0,
              amount_spent_cents: 12000,
              time_zone: 'America/Sao_Paulo',
            },
          },
          { key: { external_id: 'act_fora_do_cadastro' }, values: { name: 'Conta que o token vê' } },
          { key: { external_id: ACT_META_CS }, values: { currency: 'USD' } },
        ]),
      ).toEqual([
        { item: 2, code: 'NOT_REGISTERED', is_refused: false },
        { item: 3, code: 'CURRENCY', is_refused: true },
      ]);
      expect(
        await s.linhas(
          `select name, currency, spend_cap_cents, amount_spent_cents, first_read_at is not null as lida,
                  last_seen_at is not null as vista from mkt.ad_accounts where id = $1`,
          [CONTA_META_CS],
        ),
      ).toEqual([
        {
          name: 'Conta Meta renomeada',
          currency: 'BRL',
          spend_cap_cents: null,
          amount_spent_cents: 12000,
          lida: true,
          vista: true,
        },
      ]);
      expect(await contagens(s, rodada)).toMatchObject({ rows_written: 1, rows_refused: 1 });
      // A conta de outra plataforma não é achada pela rodada da Meta: o Google não tem teto da conta.
      const google = await abrirRodada(s, 'google_ads', 'ads_hourly');
      expect(
        await gravar(s, 'upsert_ad_accounts', google, [
          { key: { external_id: '9000000002' }, values: { spend_cap_cents: 100 } },
        ]),
      ).toEqual([{ item: 1, code: 'CHECK', is_refused: true }]);
    });
  });

  it('campanhas: nova nasce do humano; a criada pela central é reconhecida pelo código da ação no nome; a releitura nunca muda o operador', async () => {
    await caso(db, postgres, async (s) => {
      // O dono aprova uma ação de criar campanha; o executor manda (a execução fica enviada).
      await s.como(usuario(DONO, 'aal2'));
      const acao = await s.linhas<{ id: string; code: string }>(
        `select id::text, code from api.propose_action('cs', 'meta', null, 'create', 'Criar campanha de lançamento',
                  'Lançamento da coleção nova para lojistas do Sul.',
                  '{"objective": "OUTCOME_SALES", "daily_budget_cents": 3000, "name": "cs-lancamento", "special_ad_categories": []}',
                  'medium', 'low', 90000, true)`,
      );
      const [criar] = acao;
      if (!criar) throw new Error('a ação não nasceu');
      await s.como(servico('mkt_executor'));
      await s.valor(
        `select ingest.update_execution(e.id, 'sent')::text from mkt.platform_executions e where e.traffic_action_id = $1`,
        [criar.id],
      );

      const rodada = await abrirRodada(s, 'meta', 'ads_hourly');
      const campanha = (externo: string, nome: string, extra: Record<string, unknown> = {}) => ({
        key: { external_id: externo },
        values: { account_external_id: ACT_META_CS, name: nome, status: 'paused', ...extra },
      });
      expect(
        await gravar(s, 'upsert_campaigns', rodada, [
          campanha('120200000000000101', `cs-lancamento-${criar.code.toLowerCase()}`),
          campanha('120200000000000102', 'cs-outra-act-0002'),
          campanha('120200000000000103', 'cs-nova', { daily_budget_cents: 4000 }),
          campanha('120200000000000002', 'cs-remarketing-act-0001', { status: 'active' }),
          campanha('120200000000000001', 'cs-prospeccao-lojistas', {
            status: 'paused',
            managed_by: 'claude',
          }),
          {
            key: { external_id: '120200000000000104' },
            values: { account_external_id: 'act_fora', name: 'x', status: 'active' },
          },
          {
            key: { external_id: '120200000000000105' },
            values: { account_external_id: ACT_META_CS, name: 'sem status' },
          },
        ]),
      ).toEqual([
        { item: 5, code: 'UNKNOWN_FIELD', is_refused: true },
        { item: 6, code: 'NOT_REGISTERED', is_refused: false },
        { item: 7, code: 'NOT_NULL', is_refused: true },
      ]);
      expect(
        await s.linhas(
          `select c.external_id, c.status, c.managed_by, c.created_by_action_id::text as acao, c.daily_budget_cents
             from mkt.campaigns c where c.ad_account_id = $1 order by 1`,
          [CONTA_META_CS],
        ),
      ).toEqual([
        {
          external_id: '120200000000000001',
          status: 'active',
          managed_by: 'human',
          acao: null,
          daily_budget_cents: 5000,
        },
        {
          external_id: '120200000000000002',
          status: 'active',
          managed_by: 'claude',
          acao: '00000000-0000-4000-8000-0000000002f1',
          daily_budget_cents: 3000,
        },
        {
          external_id: '120200000000000101',
          status: 'paused',
          managed_by: 'claude',
          acao: criar.id,
          daily_budget_cents: null,
        },
        {
          external_id: '120200000000000102',
          status: 'paused',
          managed_by: 'human',
          acao: null,
          daily_budget_cents: null,
        },
        {
          external_id: '120200000000000103',
          status: 'paused',
          managed_by: 'human',
          acao: null,
          daily_budget_cents: 4000,
        },
      ]);
      // O histórico de operador diz quem criou: o Claude, pela central; a importada, o sistema.
      expect(
        await s.linhas(
          `select c.external_id, h.reason, h.actor_kind from mkt.campaign_managed_by_history h
             join mkt.campaigns c on c.id = h.campaign_id where c.external_id in ('120200000000000101', '120200000000000103') order by 1`,
        ),
      ).toEqual([
        { external_id: '120200000000000101', reason: 'created_by_claude', actor_kind: 'claude' },
        { external_id: '120200000000000103', reason: 'imported', actor_kind: 'system' },
      ]);
    });
  });

  it('campanhas: a campanha não muda de conta (ACCOUNT); a conta inativa ou de outra marca não vale no CSV', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(`
        insert into mkt.ad_accounts (id, brand_id, platform, source, external_id, name)
        select '00000000-0000-4000-8000-000000000203', b.id, 'meta', 'meta_ads', 'act_900000000000003', 'Conta Meta da Plumene'
          from mkt.brands b where b.code = 'plumene';
      `);
      const rodada = await abrirRodada(s, 'meta', 'ads_hourly');
      expect(
        await gravar(s, 'upsert_campaigns', rodada, [
          {
            key: { external_id: '120200000000000001' },
            values: { account_external_id: 'act_900000000000003', name: 'x', status: 'active' },
          },
        ]),
      ).toEqual([{ item: 1, code: 'ACCOUNT', is_refused: true }]);

      // No CSV, sem a conta no arquivo: a única conta ativa da marca no canal.
      const csv = await rodadaDoCsv(s, 'meta', 'cs');
      expect(
        await gravar(s, 'upsert_campaigns', csv, [
          { key: { external_id: '120200000000000201' }, values: { name: 'cs-do-csv', status: 'active' } },
          {
            key: { external_id: '120200000000000202' },
            values: { account_external_id: 'act_900000000000003', name: 'pl', status: 'active' },
          },
        ]),
      ).toEqual([{ item: 2, code: 'BRAND_MISMATCH', is_refused: true }]);
      expect(
        await s.linhas(
          `select source, ad_account_id::text as conta from mkt.campaigns where external_id = '120200000000000201'`,
        ),
      ).toEqual([{ source: 'meta_ads', conta: CONTA_META_CS }]);
      // Duas contas ativas da marca no canal: o CSV não sabe qual.
      await s.como(postgres);
      await s.exec(
        `update mkt.ad_accounts set brand_id = (select id from mkt.brands where code = 'cs') where external_id = 'act_900000000000003'`,
      );
      await s.como(servico('mkt_worker'));
      expect(
        await gravar(s, 'upsert_campaigns', csv, [
          { key: { external_id: '120200000000000203' }, values: { name: 'cs-do-csv-2', status: 'active' } },
        ]),
      ).toEqual([{ item: 1, code: 'ACCOUNT', is_refused: true }]);
    });
  });

  it('gasto por dia: a API regrava a linha do CSV e o CSV nunca regrava a da API; a gravação dá base à conta', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(`update mkt.ad_accounts set first_read_at = null where id = '${CONTA_META_CS}'`);
      const dia = (campanha: string, metricOn: string, gasto: unknown) => ({
        key: { campaign_external_id: campanha, metric_on: metricOn },
        values: { spend_cents: gasto, impressions: 100, clicks: 3, conversions: 1.5 },
      });
      const api = await abrirRodada(s, 'meta', 'ads_hourly');
      expect(
        await gravar(s, 'upsert_ad_campaign_daily', api, [
          dia('120200000000000001', '2026-10-05', 1000),
          dia('120200000000000099', '2026-10-05', 1),
          dia('120200000000000001', '2026-10-07', 4.5),
          dia('120200000000000001', '2026-10-08', -1),
        ]),
      ).toEqual([
        { item: 2, code: 'UNKNOWN_CAMPAIGN', is_refused: true },
        { item: 3, code: 'FORMAT', is_refused: true },
        { item: 4, code: 'CHECK', is_refused: true },
      ]);
      expect(
        await s.valor(`select first_read_at is not null from mkt.ad_accounts where id = $1`, [CONTA_META_CS]),
      ).toBe(true);

      const csv = await rodadaDoCsv(s, 'meta', 'cs');
      expect(
        await gravar(s, 'upsert_ad_campaign_daily', csv, [
          dia('120200000000000001', '2026-10-05', 9999),
          dia('120200000000000001', '2026-10-06', 2000),
          dia('120200000000000001', '2026-10-06', 2100),
        ]),
      ).toEqual([{ item: 1, code: 'API_KEPT', is_refused: false }]);
      expect(await contagens(s, csv)).toMatchObject({ rows_written: 2, rows_refused: 0 });

      await s.como(servico('mkt_worker'));
      expect(
        await gravar(s, 'upsert_ad_campaign_daily', api, [dia('120200000000000001', '2026-10-06', 2500)]),
      ).toEqual([]);
      expect(
        await s.linhas(
          `select d.metric_on::text as dia, d.spend_cents, d.source, d.conversions::text from mkt.ad_campaign_daily d
            where d.campaign_id = $1 and d.metric_on between '2026-10-01' and '2026-10-31' order by 1`,
          [CAMPANHA_HUMANO_CS],
        ),
      ).toEqual([
        { dia: '2026-10-05', spend_cents: 1000, source: 'meta_ads', conversions: '1.50' },
        { dia: '2026-10-06', spend_cents: 2500, source: 'meta_ads', conversions: '1.50' },
      ]);
    });
  });

  it('alterações nas contas: só campanha, conjunto, anúncio e limite; evento de usuário é recusado; o TikTok não tem', async () => {
    await caso(db, postgres, async (s) => {
      const rodada = await abrirRodada(s, 'meta', 'ads_activity');
      const evento = (
        externo: string,
        tipo: string,
        detalhes: Record<string, unknown>,
        conta = ACT_META_CS,
      ) => ({
        key: { external_id: externo },
        values: {
          account_external_id: conta,
          campaign_external_id: '120200000000000001',
          occurred_at: '2026-11-05T10:00:00Z',
          change_kind: tipo,
          is_by_csp_mkt: false,
          details: detalhes,
        },
      });
      expect(
        await gravar(s, 'upsert_ad_activity_log', rodada, [
          evento('ev-1', 'update_campaign_budget', {
            object_type: 'campaign',
            object_id: '120200000000000001',
            field: 'daily_budget',
            old_value: 3000,
            new_value: 4000,
          }),
          evento('ev-2', 'add_user_to_account', {}),
          evento('ev-3', 'update_campaign_name', { object_type: 'campaign', object_name: 'Fulano' }),
          evento('ev-4', 'update_campaign_budget', {}, 'act_fora'),
        ]),
      ).toEqual([
        { item: 2, code: 'CHECK', is_refused: true },
        { item: 3, code: 'CHECK', is_refused: true },
        { item: 4, code: 'NOT_REGISTERED', is_refused: false },
      ]);
      expect(
        await s.valor(`select campaign_id::text from mkt.ad_activity_log where external_id = 'ev-1'`),
      ).toBe(CAMPANHA_HUMANO_CS);
      const tiktok = await abrirRodada(s, 'tiktok', 'ads_hourly');
      expect(
        (await s.erro('PT422', `select * from ingest.upsert_ad_activity_log($1, '[]')`, [tiktok])).detail,
      ).toBe('connector');
    });
  });
});

describe('Instagram, Search Console, GA4 e a checagem dos sites', () => {
  it('perfil e perfil por dia: só o cadastrado; só as métricas que vieram mudam (nulo continua nulo); a leitura dá base', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(`update mkt.ig_accounts set first_read_at = null where id = '${PERFIL_IG_CS}'`);
      const rodada = await abrirRodada(s, 'instagram', 'ig_hourly');
      expect(
        await gravar(s, 'upsert_ig_accounts', rodada, [
          { key: { external_id: '17840000000000001' }, values: { username: 'perfil.teste.cs2' } },
          { key: { external_id: '999' }, values: { username: 'outro' } },
          { key: { external_id: '17840000000000001' }, values: { username: 'tem espaço' } },
        ]),
      ).toEqual([
        { item: 2, code: 'NOT_REGISTERED', is_refused: false },
        { item: 3, code: 'FORMAT', is_refused: true },
      ]);
      const dia = (valores: Record<string, unknown>) => ({
        key: { account_external_id: '17840000000000001', metric_on: '2026-11-05' },
        values: valores,
      });
      await gravar(s, 'upsert_ig_account_daily', rodada, [dia({ followers_count: 15300 })]);
      await gravar(s, 'upsert_ig_account_daily', rodada, [dia({ reach: 3500, views: 9200 })]);
      await gravar(s, 'upsert_ig_account_daily', rodada, [dia({ followers_count: 15310, views: null })]);
      expect(
        await s.linhas(
          `select followers_count, reach, views, total_interactions from mkt.ig_account_daily where metric_on = '2026-11-05'`,
        ),
      ).toEqual([{ followers_count: 15310, reach: 3500, views: null, total_interactions: null }]);
      expect(
        await s.linhas(
          `select username, first_read_at is not null as lida from mkt.ig_accounts where id = $1`,
          [PERFIL_IG_CS],
        ),
      ).toEqual([{ username: 'perfil.teste.cs2', lida: true }]);
    });
  });

  it('posts: a legenda sem as menções e sem dado pessoal, até 120 letras; o link só do Instagram; o retrato de post que não existe é recusado', async () => {
    await caso(db, postgres, async (s) => {
      const rodada = await abrirRodada(s, 'instagram', 'ig_daily');
      const post = (externo: string, legenda: string, link: string) => ({
        key: { external_id: externo },
        values: {
          account_external_id: '17840000000000001',
          media_type: 'reel',
          published_at: '2026-11-04T10:00:00Z',
          caption_excerpt: legenda,
          permalink: link,
        },
      });
      expect(
        await gravar(s, 'upsert_ig_media', rodada, [
          post(
            '18000000000000101',
            'Coleção nova com @fulana.silva   e @loja.parceira',
            'https://www.instagram.com/reel/ABC123/',
          ),
          post('18000000000000102', 'Peça pelo (11) 98765-4321', 'https://exemplo.com/post'),
          post('18000000000000103', 'a'.repeat(300), 'javascript:alert(1)'),
        ]),
      ).toEqual([]);
      expect(
        await s.linhas(
          `select external_id, caption_excerpt, permalink from mkt.ig_media where external_id in ('18000000000000101', '18000000000000102', '18000000000000103') order by 1`,
        ),
      ).toEqual([
        {
          external_id: '18000000000000101',
          caption_excerpt: 'Coleção nova com e',
          permalink: 'https://www.instagram.com/reel/ABC123/',
        },
        { external_id: '18000000000000102', caption_excerpt: null, permalink: null },
        { external_id: '18000000000000103', caption_excerpt: 'a'.repeat(120), permalink: null },
      ]);
      expect((await contagens(s, rodada)).personal_data_dropped).toBe(1);
      expect(
        await gravar(s, 'upsert_ig_media_daily', rodada, [
          {
            key: { media_external_id: '18000000000000101', captured_on: '2026-11-05' },
            values: { reach: 10, likes: 2 },
          },
          { key: { media_external_id: '18000000000009999', captured_on: '2026-11-05' }, values: {} },
        ]),
      ).toEqual([{ item: 2, code: 'UNKNOWN_MEDIA', is_refused: true }]);
    });
  });

  it('Search Console e GA4: a consulta ou a origem com cara de dado pessoal não é gravada; gravar dá base à propriedade', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(
        `update mkt.web_properties set first_read_at = null where id in ('${GSC_CS}', '${GA4_CS}')`,
      );
      const sc = await abrirRodada(s, 'search_console', 'gsc_daily');
      const consulta = (texto: string) => ({
        key: { property_external_id: 'sc-domain:cs.example.com', metric_on: '2026-11-05', query: texto },
        values: { impressions: 5, clicks: 1, position: 2.5 },
      });
      expect(
        await gravar(s, 'upsert_seo_query_daily', sc, [
          consulta('lingerie'),
          consulta('maria@exemplo.com'),
          consulta('cpf 123.456.789-01'),
        ]),
      ).toEqual([
        { item: 2, code: 'PERSONAL_DATA_DROPPED', is_refused: false },
        { item: 3, code: 'PERSONAL_DATA_DROPPED', is_refused: false },
      ]);
      expect(
        await gravar(s, 'upsert_seo_daily', sc, [
          {
            key: { property_external_id: 'sc-domain:cs.example.com', metric_on: '2026-11-05' },
            values: { impressions: 10, clicks: 1, position: 3.2 },
          },
          {
            key: { property_external_id: 'sc-domain:outro.example.com', metric_on: '2026-11-05' },
            values: { impressions: 1, clicks: 0 },
          },
        ]),
      ).toEqual([{ item: 2, code: 'NOT_REGISTERED', is_refused: false }]);
      expect(await contagens(s, sc)).toMatchObject({
        rows_written: 2,
        rows_refused: 0,
        personal_data_dropped: 2,
      });

      const ga4 = await abrirRodada(s, 'ga4', 'ga4_daily');
      const sessao = (origem: string, meio: string) => ({
        key: {
          property_external_id: '900000001',
          metric_on: '2026-11-05',
          session_source: origem,
          session_medium: meio,
          channel_group_raw: 'Referral',
        },
        values: { sessions: 7, lead_events: 1 },
      });
      expect(
        await gravar(s, 'upsert_ga4_traffic_daily', ga4, [
          sessao('chatgpt.com', 'referral'),
          sessao('news@exemplo.com', 'email'),
        ]),
      ).toEqual([{ item: 2, code: 'PERSONAL_DATA_DROPPED', is_refused: false }]);
      expect(
        await s.linhas(
          `select id::text, first_read_at is not null as lida from mkt.web_properties where id in ($1, $2) order by 1`,
          [GA4_CS, GSC_CS],
        ),
      ).toEqual([
        { id: GA4_CS, lida: true },
        { id: GSC_CS, lida: true },
      ]);
    });
  });

  it('checagem dos sites: sem rodada; o detalhe com cara de dado pessoal vira nulo; o host é o da propriedade', async () => {
    await caso(db, servico('mkt_worker'), async (s) => {
      expect(
        await gravar(s, 'upsert_site_checks', null, [
          {
            key: {
              property_source: 'ga4',
              property_external_id: '900000001',
              item: 'llms_txt',
              checked_on: '2026-11-05',
            },
            values: { finding: 'missing', http_status: 404, detail: 'Não achou; avisar ti@exemplo.com' },
          },
          {
            key: {
              property_source: 'ga4',
              property_external_id: '900000001',
              item: 'json_ld',
              checked_on: '2026-11-05',
            },
            values: { finding: 'invalid', detail: 'JSON-LD sem @type' },
          },
          {
            key: {
              property_source: 'ga4',
              property_external_id: '000',
              item: 'robots_txt',
              checked_on: '2026-11-05',
            },
            values: { finding: 'found' },
          },
          {
            key: {
              property_source: 'ga4',
              property_external_id: '900000001',
              item: 'sitemap',
              checked_on: '2026-11-05',
            },
            values: { finding: 'found' },
          },
        ]),
      ).toEqual([
        { item: 3, code: 'NOT_REGISTERED', is_refused: false },
        { item: 4, code: 'CHECK', is_refused: true },
      ]);
      expect(
        await s.linhas(
          `select item, finding, detail, host from mkt.site_checks where checked_on = '2026-11-05' order by 1`,
        ),
      ).toEqual([
        { item: 'json_ld', finding: 'invalid', detail: null, host: 'cs.example.com' },
        { item: 'llms_txt', finding: 'missing', detail: null, host: 'cs.example.com' },
      ]);
    });
  });
});

describe('a releitura troca o dia inteiro: replace_day', () => {
  it('grava as linhas que vieram e apaga as do mesmo dia e da mesma conta que não vieram, também a do CSV; o resto fica', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(`
        insert into mkt.ad_campaign_daily (campaign_id, brand_id, platform, metric_on, spend_cents, source, fetched_at)
        select c.id, c.brand_id, c.platform, d.dia::date, 100, d.fonte, now()
          from mkt.campaigns c
          join (values ('${CAMPANHA_HUMANO_CS}', '2026-10-10', 'meta_ads'), ('${CAMPANHA_CLAUDE_CS}', '2026-10-10', 'csv'),
                       ('${CAMPANHA_HUMANO_CS}', '2026-10-11', 'meta_ads'),
                       ('00000000-0000-4000-8000-000000000213', '2026-10-10', 'google_ads')) as d(campanha, dia, fonte)
            on d.campanha::uuid = c.id;
      `);
      const rodada = await abrirRodada(s, 'meta', 'ads_backfill');
      expect(
        await s.linhas(
          `select item, code from ingest.replace_day($1, 'ad_campaign_daily', $2, '2026-10-10', $3::jsonb)`,
          [
            rodada,
            ACT_META_CS,
            JSON.stringify([
              {
                key: { campaign_external_id: '120200000000000001', metric_on: '2026-10-10' },
                values: { spend_cents: 700 },
              },
            ]),
          ],
        ),
      ).toEqual([]);
      expect(
        await s.linhas(
          `select c.external_id, d.metric_on::text as dia, d.spend_cents, d.source from mkt.ad_campaign_daily d
             join mkt.campaigns c on c.id = d.campaign_id where d.metric_on between '2026-10-10' and '2026-10-11' order by 1, 2`,
        ),
      ).toEqual([
        { external_id: '120200000000000001', dia: '2026-10-10', spend_cents: 700, source: 'meta_ads' },
        { external_id: '120200000000000001', dia: '2026-10-11', spend_cents: 100, source: 'meta_ads' },
        { external_id: '7000000001', dia: '2026-10-10', spend_cents: 100, source: 'google_ads' },
      ]);
      expect(await contagens(s, rodada)).toMatchObject({ rows_written: 1, rows_deleted: 1 });
    });
  });

  it('o lote é de um dia e de uma conta só (senão nada é gravado); a rodada do CSV nunca troca o dia', async () => {
    await caso(db, postgres, async (s) => {
      const rodada = await abrirRodada(s, 'meta', 'ads_backfill');
      const trocar = (escopo: string, linhas: unknown[], tabela = 'ad_campaign_daily') =>
        s.erro('PT422', `select * from ingest.replace_day($1, $2, $3, '2026-10-10', $4::jsonb)`, [
          rodada,
          tabela,
          escopo,
          JSON.stringify(linhas),
        ]);
      expect(
        (
          await trocar(ACT_META_CS, [
            { key: { campaign_external_id: '120200000000000001', metric_on: '2026-10-11' }, values: {} },
          ])
        ).detail,
      ).toBe('scope');
      await s.como(postgres);
      await s.exec(`
        insert into mkt.ad_accounts (brand_id, platform, source, external_id, name)
        select b.id, 'meta', 'meta_ads', 'act_900000000000003', 'Conta Meta da Plumene' from mkt.brands b where b.code = 'plumene';
      `);
      await s.como(servico('mkt_worker'));
      expect(
        (
          await trocar('act_900000000000003', [
            { key: { campaign_external_id: '120200000000000001', metric_on: '2026-10-10' }, values: {} },
          ])
        ).detail,
      ).toBe('scope');
      expect((await trocar(ACT_META_CS, [], 'ad_activity_log')).detail).toBe('table');
      expect(
        await s.valor(`select count(*)::int from mkt.ad_campaign_daily where metric_on = '2026-10-10'`),
      ).toBe(0);

      const csv = await rodadaDoCsv(s, 'meta', 'cs');
      expect(
        (
          await s.erro(
            'PT422',
            `select * from ingest.replace_day($1, 'ad_campaign_daily', $2, '2026-10-10', '[]')`,
            [csv, ACT_META_CS],
          )
        ).detail,
      ).toBe('csv');
    });
  });

  it('GA4 e as consultas do Search Console: por propriedade e dia', async () => {
    await caso(db, postgres, async (s) => {
      const ga4 = await abrirRodada(s, 'ga4', 'ga4_daily');
      const sessao = (origem: string, n: number) => ({
        key: {
          property_external_id: '900000001',
          metric_on: '2026-10-20',
          session_source: origem,
          session_medium: 'referral',
          channel_group_raw: 'Referral',
        },
        values: { sessions: n },
      });
      await gravar(s, 'upsert_ga4_traffic_daily', ga4, [
        sessao('a.example.com', 1),
        sessao('b.example.com', 2),
      ]);
      expect(
        await s.linhas(
          `select item, code from ingest.replace_day($1, 'ga4_traffic_daily', '900000001', '2026-10-20', $2::jsonb)`,
          [ga4, JSON.stringify([sessao('b.example.com', 5)])],
        ),
      ).toEqual([]);
      expect(
        await s.linhas(
          `select session_source, sessions from mkt.ga4_traffic_daily where metric_on = '2026-10-20' order by 1`,
        ),
      ).toEqual([{ session_source: 'b.example.com', sessions: 5 }]);

      const sc = await abrirRodada(s, 'search_console', 'gsc_daily');
      const consulta = (texto: string) => ({
        key: { property_external_id: 'sc-domain:cs.example.com', metric_on: '2026-10-20', query: texto },
        values: { impressions: 3, clicks: 1 },
      });
      await gravar(s, 'upsert_seo_query_daily', sc, [consulta('a'), consulta('b')]);
      await s.linhas(
        `select * from ingest.replace_day($1, 'seo_query_daily', 'sc-domain:cs.example.com', '2026-10-20', $2::jsonb)`,
        [sc, JSON.stringify([consulta('a')])],
      );
      expect(await s.linhas(`select query from mkt.seo_query_daily where metric_on = '2026-10-20'`)).toEqual([
        { query: 'a' },
      ]);
      expect(await contagens(s, sc)).toMatchObject({ rows_deleted: 1 });
    });
  });
});

describe('a passada completa apaga o que sumiu do CRM: delete_missing', () => {
  it('apaga o que a passada não viu, só nas tabelas da lista e só na passada completa em andamento, e conta na rodada', async () => {
    await caso(db, postgres, async (s) => {
      const rodada = await abrirRodada(s, 'csp360', 'crm_full_pass');
      await gravar(s, 'upsert_crm_customers', rodada, [
        cliente('cli-teste-0001', { crm_status: 'active' }),
        ...['3', '4', '5', '6'].map((n) => cliente(`cli-teste-000${n}`)),
      ]);
      expect(await s.linhas(`select * from ingest.delete_missing('crm_customers', $1)`, [rodada])).toEqual([
        { deleted: 1, code: null },
      ]);
      expect(await s.valor(`select count(*)::int from mkt.crm_customers where id = $1`, [CLIENTE_B])).toBe(0);
      // O lead do cliente que saiu fica, sem o cliente ("A cadastrar").
      expect(await s.valor(`select customer_id from mkt.crm_leads where id = $1`, [LEAD_SDR])).toBeNull();
      expect(await contagens(s, rodada)).toMatchObject({ rows_deleted: 1 });

      expect(
        (await s.erro('PT422', `select * from ingest.delete_missing('profiles', $1)`, [rodada])).detail,
      ).toBe('table');
      expect(
        (await s.erro('PT422', `select * from ingest.delete_missing('crm_upstream_runs', $1)`, [rodada]))
          .detail,
      ).toBe('table');
      const incremental = await abrirRodada(s, 'csp360', 'crm_incremental');
      expect(
        (await s.erro('PT422', `select * from ingest.delete_missing('crm_orders', $1)`, [incremental]))
          .detail,
      ).toBe('run');
    });
    await caso(db, servico('mkt_executor'), async (s) => {
      await s.erro(
        '42501',
        `select * from ingest.delete_missing('crm_orders', '00000000-0000-0000-0000-000000000000')`,
      );
    });
  });

  it('acima de 20% segura: nada sai e a rodada termina partial com MASS_DELETE_BLOCKED; o dono confirma e a passada seguinte apaga', async () => {
    await caso(db, postgres, async (s) => {
      const primeira = await abrirRodada(s, 'csp360', 'crm_full_pass');
      await gravar(s, 'upsert_crm_customers', primeira, [cliente('cli-teste-0001')]);
      expect(await s.linhas(`select * from ingest.delete_missing('crm_customers', $1)`, [primeira])).toEqual([
        { deleted: 0, code: 'MASS_DELETE_BLOCKED' },
      ]);
      expect(await s.valor(`select count(*)::int from mkt.crm_customers`)).toBe(2);
      await s.valor(`select ingest.finish_run($1, 'succeeded')::text`, [primeira]);
      expect(
        await s.linhas(`select status, error_code from mkt.sync_runs where id = $1`, [primeira]),
      ).toEqual([{ status: 'partial', error_code: 'MASS_DELETE_BLOCKED' }]);

      // A passada seguinte começa depois (no teste, a mesma transação: a primeira vai para ontem).
      await s.como(postgres);
      await s.exec(
        `update mkt.sync_runs set started_at = started_at - interval '1 day' where id = '${primeira}'`,
      );
      const sem = await abrirRodada(s, 'csp360', 'crm_full_pass');
      await gravar(s, 'upsert_crm_customers', sem, [cliente('cli-teste-0001')]);
      expect(await s.linhas(`select * from ingest.delete_missing('crm_customers', $1)`, [sem])).toEqual([
        { deleted: 0, code: 'MASS_DELETE_BLOCKED' },
      ]);
      await s.valor(`select ingest.finish_run($1, 'failed', 'HTTP_500')::text`, [sem]);
      expect(await s.linhas(`select status, error_code from mkt.sync_runs where id = $1`, [sem])).toEqual([
        { status: 'failed', error_code: 'HTTP_500' },
      ]);

      // O dono confirma a primeira, que passa a ser a última passada terminada antes da seguinte: ela apaga.
      await s.como(postgres);
      await s.exec(
        `update mkt.sync_runs set started_at = started_at - interval '2 days' where id = '${sem}'`,
      );
      await s.como(usuario(DONO, 'aal2'));
      await s.valor(`select api.confirm_mass_delete($1)::text`, [primeira]);
      const depois = await abrirRodada(s, 'csp360', 'crm_full_pass');
      await gravar(s, 'upsert_crm_customers', depois, [cliente('cli-teste-0001')]);
      expect(await s.linhas(`select * from ingest.delete_missing('crm_customers', $1)`, [depois])).toEqual([
        { deleted: 1, code: null },
      ]);
    });
  });

  it('login de app pelo updated_at; o representante só de app que a passada não viu também sai', async () => {
    await caso(db, postgres, async (s) => {
      const rodada = await abrirRodada(s, 'csp360', 'crm_full_pass');
      await gravar(
        s,
        'upsert_sales_reps',
        rodada,
        ['0001', '0011', '0012', '0013', '0014'].map((n) => ({
          key: { external_id: `usr-teste-${n}` },
          values: {},
        })),
      );
      await gravar(
        s,
        'upsert_sales_rep_app_logins',
        rodada,
        ['1', '2', '3', '4', '5'].map((n) => ({
          brand: 'cs',
          key: { app_login_key: n.repeat(64) },
          values: { sales_rep_external_id: 'usr-teste-0011' },
        })),
      );
      expect(
        await s.linhas(`select * from ingest.delete_missing('sales_rep_app_logins', $1)`, [rodada]),
      ).toEqual([{ deleted: 1, code: null }]);
      expect(await s.linhas(`select * from ingest.delete_missing('sales_reps', $1)`, [rodada])).toEqual([
        { deleted: 1, code: null },
      ]);
      expect(await s.valor(`select count(*)::int from mkt.sales_reps where id = $1`, [REP_DO_APP])).toBe(0);
      expect(await s.valor(`select count(*)::int from mkt.sales_reps where id = $1`, [REP_DO_CRM])).toBe(1);
    });
  });

  it('leads: o NEG- que o CRM reaproveita entra na leitura de 5 min com o código do negócio apagado, e a passada completa tira só o antigo (decisão 0041, item 2)', async () => {
    await caso(db, postgres, async (s) => {
      const negocio = (externo: string, codigo: string) => ({
        brand: 'cs',
        key: { kind: 'deal', external_id: externo },
        values: {
          code: codigo,
          funnel_external_id: 'funil-teste-0001',
          source_created_at: '2026-11-11T13:00:00Z',
        },
      });
      const comOCodigo = () =>
        s.linhas(`select external_id from mkt.crm_leads where code = 'NEG-9001' order by 1`);
      // O negócio da fixture (neg-teste-0001, NEG-9001) foi apagado no CRM, e o negócio novo ganhou o código dele.
      const incremental = await abrirRodada(s, 'csp360', 'crm_incremental');
      expect(
        await gravar(s, 'upsert_crm_leads', incremental, [negocio('neg-teste-0950', 'NEG-9001')]),
      ).toEqual([]);
      expect((await contagens(s, incremental)).rows_refused).toBe(0);
      expect(await comOCodigo()).toEqual([
        { external_id: 'neg-teste-0001' },
        { external_id: 'neg-teste-0950' },
      ]);
      // A passada completa não vê o antigo e o apaga; o novo fica.
      const passada = await abrirRodada(s, 'csp360', 'crm_full_pass');
      expect(
        await gravar(s, 'upsert_crm_leads', passada, [
          {
            key: { kind: 'deal', external_id: 'neg-teste-0002' },
            values: {
              code: 'NEG-9002',
              customer_external_id: 'cli-teste-0002',
              origin: 'SDR WhatsApp',
              source_created_at: '2026-11-09T10:00:00Z',
            },
          },
          {
            key: { kind: 'sdr', external_id: 'sdr-teste-0001' },
            values: { customer_external_id: 'cli-teste-0002', source_created_at: '2026-11-08T10:00:00Z' },
          },
          negocio('neg-teste-0950', 'NEG-9001'),
          negocio('neg-teste-0951', 'NEG-9951'),
          negocio('neg-teste-0952', 'NEG-9952'),
        ]),
      ).toEqual([]);
      expect(await s.linhas(`select * from ingest.delete_missing('crm_leads', $1)`, [passada])).toEqual([
        { deleted: 1, code: null },
      ]);
      expect(await comOCodigo()).toEqual([{ external_id: 'neg-teste-0950' }]);
    });
  });

  it('o par cliente × marca que a passada não viu perde só o retrato: a compra do ERP mais antiga fica, e o par que volta com a recompra pelo app continua antigo; ele sai com o cliente (decisões 0015 e 0042)', async () => {
    await caso(db, postgres, async (s) => {
      const par = (externo: string, valores: Record<string, unknown> = {}) => ({
        brand: 'cs',
        key: { customer_external_id: externo },
        values: valores,
      });
      const doClienteA = () =>
        s.linhas(
          `select cb.erp_earliest_purchase_on = current_date - 400 as mais_antiga_guardada,
                  cb.erp_last_purchase_on::text as ultima, cb.erp_total_purchased_cents as total
             from mkt.crm_customer_brands cb join mkt.brands b on b.id = cb.brand_id
            where cb.customer_id = $1 and b.code = 'cs'`,
          [CLIENTE_A],
        );
      const outros = ['0003', '0004', '0005', '0006'].map((n) => `cli-teste-${n}`);
      const passada = await abrirRodada(s, 'csp360', 'crm_full_pass');
      expect(
        await gravar(
          s,
          'upsert_crm_customers',
          passada,
          outros.map((c) => cliente(c)),
        ),
      ).toEqual([]);
      // A passada vê 4 dos 5 pares; o do cliente A (fixture: a compra mais antiga há 400 dias) não veio.
      expect(
        await gravar(
          s,
          'upsert_crm_customer_brands',
          passada,
          outros.map((c) => par(c, { erp_last_purchase_on: '2026-10-01' })),
        ),
      ).toEqual([]);
      expect(
        await s.linhas(`select * from ingest.delete_missing('crm_customer_brands', $1)`, [passada]),
      ).toEqual([{ deleted: 0, code: null }]);
      // O par fica, sem o retrato; a data mais antiga, que o CRM não tem mais, fica.
      expect(await doClienteA()).toEqual([{ mais_antiga_guardada: true, ultima: null, total: null }]);
      expect((await contagens(s, passada)).rows_deleted).toBe(0);

      // O par volta com a recompra pelo app: a última compra é a nova, e a mais antiga não anda para a frente.
      const recompra = await s.valor<string>(`select (current_date - 5)::text`);
      const incremental = await abrirRodada(s, 'csp360', 'crm_incremental');
      expect(
        await gravar(s, 'upsert_crm_customer_brands', incremental, [
          par('cli-teste-0001', { erp_last_purchase_on: recompra }),
        ]),
      ).toEqual([]);
      expect(await doClienteA()).toEqual([{ mais_antiga_guardada: true, ultima: recompra, total: null }]);
      // Pela regra do histórico (metricas.md, 3.5), ele continua antigo: a data é anterior ao 1º pedido enviado.
      expect(
        await s.valor(
          `select cb.erp_earliest_purchase_on < min(mkt.sp_day(o.source_created_at))
             from mkt.crm_customer_brands cb
             join mkt.crm_orders o on o.customer_id = cb.customer_id and o.brand_id = cb.brand_id and o.status = 'sent'
            where cb.customer_id = $1
            group by cb.erp_earliest_purchase_on`,
          [CLIENTE_A],
        ),
      ).toBe(true);

      // O par sai com o cliente: a passada que não vê o cliente A o apaga, e o par vai junto, data e tudo.
      const seguinte = await abrirRodada(s, 'csp360', 'crm_full_pass');
      expect(await gravar(s, 'upsert_crm_customers', seguinte, [cliente('cli-teste-0002')])).toEqual([]);
      expect(await s.linhas(`select * from ingest.delete_missing('crm_customers', $1)`, [seguinte])).toEqual([
        { deleted: 1, code: null },
      ]);
      expect(await doClienteA()).toEqual([]);
    });
  });

  it('na trava do par cliente × marca, conta só o que a chamada muda: o par já sem retrato não segura a passada; o par sem a data sai', async () => {
    await caso(db, postgres, async (s) => {
      // Dois pares que uma passada anterior já deixou sem retrato, só com a compra mais antiga, e um par sem data.
      await s.exec(`
        insert into mkt.crm_customer_brands (customer_id, brand_id, erp_earliest_purchase_on, last_seen_at)
        select '${CLIENTE_A}', b.id, '2024-01-10', now() - interval '1 day' from mkt.brands b where b.code = 'plumene';
        insert into mkt.crm_customer_brands (customer_id, brand_id, erp_earliest_purchase_on, last_seen_at)
        select '${CLIENTE_B}', b.id, '2024-02-01', now() - interval '1 day' from mkt.brands b where b.code = 'plumene';
        insert into mkt.crm_customer_brands (customer_id, brand_id, last_seen_at)
        select '${CLIENTE_B}', b.id, now() - interval '1 day' from mkt.brands b where b.code = 'cs';
      `);
      const outros = ['0003', '0004', '0005', '0006'].map((n) => `cli-teste-${n}`);
      const passada = await abrirRodada(s, 'csp360', 'crm_full_pass');
      expect(
        await gravar(
          s,
          'upsert_crm_customers',
          passada,
          outros.map((c) => cliente(c)),
        ),
      ).toEqual([]);
      expect(
        await gravar(
          s,
          'upsert_crm_customer_brands',
          passada,
          ['cli-teste-0001', ...outros].map((c) => ({
            brand: 'cs',
            key: { customer_external_id: c },
            values: { erp_last_purchase_on: '2026-10-01' },
          })),
        ),
      ).toEqual([]);
      // Não vistos: 3 de 8 pares. Só o sem data muda (sai); os dois já sem retrato ficam como estão.
      expect(
        await s.linhas(`select * from ingest.delete_missing('crm_customer_brands', $1)`, [passada]),
      ).toEqual([{ deleted: 1, code: null }]);
      expect(
        await s.linhas(
          `select c.external_id, b.code as marca, cb.erp_earliest_purchase_on::text as mais_antiga
             from mkt.crm_customer_brands cb
             join mkt.crm_customers c on c.id = cb.customer_id join mkt.brands b on b.id = cb.brand_id
            where cb.customer_id in ($1, $2) order by 1, 2`,
          [CLIENTE_A, CLIENTE_B],
        ),
      ).toEqual([
        { external_id: 'cli-teste-0001', marca: 'cs', mais_antiga: expect.any(String) },
        { external_id: 'cli-teste-0001', marca: 'plumene', mais_antiga: '2024-01-10' },
        { external_id: 'cli-teste-0002', marca: 'plumene', mais_antiga: '2024-02-01' },
      ]);
      expect((await contagens(s, passada)).rows_deleted).toBe(1);
    });
  });
});

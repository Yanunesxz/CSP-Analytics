/**
 * Ajudantes dos testes da migração 10 (ingest.*, setup.*): abrir a rodada como o worker, gravar um lote de eventos de
 * ingestão (docs/dados/integracoes.md, seção 2.2) e ler o que não foi gravado. Dados inventados.
 */
import type { Sessao } from './banco';
import { postgres, servico, usuario } from './banco';
import { CAMPANHA_CLAUDE_CS, CAMPANHA_HUMANO_CS, CAMPANHA_HUMANO_PL } from './marketing';
import { LIMITE_META_CS } from './trafego';
import { DONO } from './usuarios';

/** O que a upsert devolve: só as linhas que não gravou. */
export interface NaoGravada {
  item: number;
  code: string;
  is_refused: boolean;
}

/** Conta de anúncio Meta da cs na fixture de marketing (external_id). */
export const ACT_META_CS = 'act_900000000000001';

/** Os resumos HMAC inventados dos logins de app (64 letras hexadecimais). */
export const LOGIN_A = 'a'.repeat(64);
export const LOGIN_B = 'b'.repeat(64);
export const LOGIN_C = 'c'.repeat(64);
export const LOGIN_D = 'd'.repeat(64);

/** Abre uma rodada como o worker e devolve o id; a sessão continua como o worker. */
export async function abrirRodada(
  s: Sessao,
  conector: string,
  trabalho: string,
  gatilho = 'schedule',
): Promise<string> {
  await s.como(servico('mkt_worker'));
  return s.valor<string>('select ingest.start_run($1, $2, $3)::text', [conector, trabalho, gatilho]);
}

/** Grava um lote pela upsert da tabela (como quem a sessão for) e devolve as linhas que não gravou. */
export async function gravar(
  s: Sessao,
  funcao: string,
  rodada: string | null,
  linhas: unknown[],
): Promise<NaoGravada[]> {
  if (!/^upsert_[a-z0-9_]+$/.test(funcao)) throw new Error(`Função de ingestão inválida: ${funcao}`);
  if (funcao === 'upsert_site_checks') {
    return s.linhas<NaoGravada>(`select item, code, is_refused from ingest.upsert_site_checks($1::jsonb)`, [
      JSON.stringify(linhas),
    ]);
  }
  return s.linhas<NaoGravada>(`select item, code, is_refused from ingest.${funcao}($1::uuid, $2::jsonb)`, [
    rodada,
    JSON.stringify(linhas),
  ]);
}

/** As contagens da rodada. */
export async function contagens(
  s: Sessao,
  rodada: string,
): Promise<{
  rows_written: number;
  rows_refused: number;
  rows_deleted: number;
  personal_data_dropped: number;
}> {
  const [linha] = await s.linhas<{
    rows_written: number;
    rows_refused: number;
    rows_deleted: number;
    personal_data_dropped: number;
  }>(
    `select rows_written, rows_refused, rows_deleted, personal_data_dropped from mkt.sync_runs where id = $1`,
    [rodada],
  );
  if (!linha) throw new Error(`Rodada ${rodada} não achada`);
  return linha;
}

/**
 * O dono envia um CSV pela API (com o segundo fator) e o worker pega a rodada dele (as mais antigas do conector, que
 * a fila entrega antes, ficam em andamento); devolve o id da rodada. A sessão termina como o worker.
 */
export async function rodadaDoCsv(s: Sessao, conector: string, marca: string): Promise<string> {
  await s.como(usuario(DONO, 'aal2'));
  const arquivo = await s.valor<string>(
    `select api.upload_csv($1, $2, 'relatorio-teste.csv', e'campaign_id,spend\\n1,1\\n')::text`,
    [conector, marca],
  );
  const rodada = await s.valor<string>(`select sync_run_id::text from mkt.csv_imports where id = $1`, [
    arquivo,
  ]);
  await s.como(servico('mkt_worker'));
  for (let i = 0; i < 5; i += 1) {
    const [pega] = await s.linhas<{ id: string }>(`select id::text from ingest.take_requested_run($1)`, [
      conector,
    ]);
    if (pega?.id === rodada) return rodada;
  }
  throw new Error('A rodada do CSV não saiu da fila');
}

/**
 * O mês de teste, como o dono do banco: hoje é 20/11/2026 (20 de 30 dias; faltam 11, contando hoje); a conta Meta da
 * cs gastou R$ 1.200,00 em novembro (e R$ 999,99 em outubro, que não conta), com limite de R$ 3.000,00 desde o dia 1;
 * a conta Google da Plumene gastou R$ 50,00, mas o conector do Google ainda não tem base.
 */
export async function mesDeTeste(s: Sessao, limiteCents = 300000): Promise<void> {
  await s.como(postgres);
  await s.exec(`
    insert into test.clock (now_at) values ('2026-11-20 15:00:00+00');
    delete from mkt.ad_campaign_daily;
    update mkt.spend_limits set valid_from_on = '2026-11-01', monthly_limit_cents = ${limiteCents}
     where id = '${LIMITE_META_CS}';
    insert into mkt.ad_campaign_daily (campaign_id, brand_id, platform, metric_on, spend_cents, source, fetched_at)
    select c.id, c.brand_id, c.platform, d.dia::date, d.gasto, c.source, now()
      from mkt.campaigns c
      join (values ('${CAMPANHA_HUMANO_CS}', '2026-11-05', 100000), ('${CAMPANHA_HUMANO_CS}', '2026-10-31', 99999),
                   ('${CAMPANHA_CLAUDE_CS}', '2026-11-19', 20000), ('${CAMPANHA_HUMANO_PL}', '2026-11-10', 5000))
           as d(campanha, dia, gasto) on d.campanha::uuid = c.id;
  `);
}

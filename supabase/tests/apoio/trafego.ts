/**
 * O que os testes das migrações 07 e 08 esperam: os ids de tests/fixtures/trafego.sql e tests/fixtures/conectores.sql
 * (dados inventados), quem lê cada tabela, escrito à parte do banco de propósito (docs/dados/papeis-e-rls.md,
 * "Políticas" e "Privilégios por esquema"), e test.rodar, o stand-in das funções de ação e de ingest.
 */
import type { Permissao } from './marketing';

// ---------- fixtures/trafego.sql (migração 07) ----------

/** Rodada do Claude da cs, que deu certo. */
export const RODADA_DO_CLAUDE = '00000000-0000-4000-8000-000000000301';
/** Estratégia da cs no mês corrente, salva pelo dono. */
export const ESTRATEGIA_CS = '00000000-0000-4000-8000-000000000311';
/** Limite de gasto da conta Meta da cs, desde o dia 1 do mês. */
export const LIMITE_META_CS = '00000000-0000-4000-8000-000000000321';
/** Proposta do Claude (ideia): mais orçamento na campanha do Claude, item 1 da rodada. */
export const IDEIA_DO_CLAUDE = '00000000-0000-4000-8000-000000000331';
/** Pausa da campanha do humano, proposta e aprovada pelo dono no mesmo passo, com a execução bloqueada. */
export const ACAO_APROVADA = '00000000-0000-4000-8000-000000000332';
/** Pendência de medição (GA4) registrada pelo gestor, sem canal. */
export const PENDENCIA = '00000000-0000-4000-8000-000000000333';
/** Ajuste de lance do Claude (item 2 da rodada), descartado pelo dono. */
export const ACAO_DESCARTADA = '00000000-0000-4000-8000-000000000334';
/** "Parar tudo" da cs, pedido pelo dono, ainda aberto. */
export const PARADA = '00000000-0000-4000-8000-000000000341';
/** A campanha do Claude dentro da parada. */
export const CAMPANHA_DA_PARADA = '00000000-0000-4000-8000-000000000342';
/** A execução da pausa aprovada: bloqueada, sem credencial de escrita. */
export const EXECUCAO_DA_ACAO = '00000000-0000-4000-8000-000000000351';
/** A execução da pausa da parada: confirmada. */
export const EXECUCAO_DA_PARADA = '00000000-0000-4000-8000-000000000352';
/** O teto da conta Meta (set_account_spend_cap): bloqueado, sem credencial de escrita. */
export const EXECUCAO_DO_TETO = '00000000-0000-4000-8000-000000000353';

// ---------- fixtures/conectores.sql (migração 08) ----------

/** Rodada de hora em hora da Meta, que deu certo. */
export const RODADA_META = '00000000-0000-4000-8000-000000000401';
/** "Tentar de novo" do GA4, pedido pelo dono, ainda na fila. */
export const PEDIDO_GA4 = '00000000-0000-4000-8000-000000000402';
/** A rodada do arquivo CSV da Meta. */
export const RODADA_DO_CSV = '00000000-0000-4000-8000-000000000403';
/** Arquivo CSV da Meta, da cs, enviado pelo dono. */
export const ARQUIVO_CSV = '00000000-0000-4000-8000-000000000411';
/** Credencial de leitura do Instagram, com o segredo no Vault. */
export const CREDENCIAL_DE_LEITURA = '00000000-0000-4000-8000-000000000421';
/** Linha de estado da credencial de escrita da Meta, sem segredo. */
export const CREDENCIAL_DE_ESCRITA = '00000000-0000-4000-8000-000000000422';
/** Aviso do relatório da semana para o dono, por e-mail, na fila. */
export const AVISO = '00000000-0000-4000-8000-000000000431';

// ---------- Quem lê ----------

/** As tabelas das migrações 07 e 08 que a API lê, e a permissão de cada uma (tabelas.md, "Todas as tabelas"). */
export const LEITURA: Readonly<Record<string, Permissao>> = {
  'mkt.traffic_strategies': 'view_traffic',
  'mkt.spend_limits': 'view_numbers',
  'mkt.claude_runs': 'view_traffic',
  'mkt.traffic_actions': 'view_traffic',
  'mkt.traffic_stops': 'view_traffic',
  'mkt.traffic_stop_campaigns': 'view_traffic',
  'mkt.platform_executions': 'view_traffic',
  'mkt.traffic_log': 'view_traffic',
  'mkt.connectors': 'view_connectors',
  'mkt.connector_jobs': 'view_connectors',
  'mkt.sync_runs': 'view_connectors',
  'mkt.csv_imports': 'view_connectors',
};

/** O que o worker lê destas tabelas (papeis-e-rls.md: nunca as paradas, as execuções nem o diário). */
export const WORKER_LE: readonly string[] = [
  'mkt.traffic_strategies',
  'mkt.spend_limits',
  'mkt.claude_runs',
  'mkt.traffic_actions',
  'mkt.connectors',
  'mkt.connector_jobs',
  'mkt.sync_runs',
  'mkt.csv_imports',
];

/** O que o executor lê destas tabelas: limites, ações, paradas, execuções e conectores. */
export const EXECUTOR_LE: readonly string[] = [
  'mkt.spend_limits',
  'mkt.traffic_actions',
  'mkt.traffic_stops',
  'mkt.traffic_stop_campaigns',
  'mkt.platform_executions',
  'mkt.connectors',
];

/** Ninguém lê pela API nem pelos serviços: a fila de avisos (o n8n usa funções) e as credenciais. */
export const NINGUEM_LE: readonly string[] = ['mkt.notification_outbox', 'private.connector_credentials'];

// ---------- O stand-in das funções ----------

/**
 * test.rodar(sql): roda o comando dentro de uma função security definer do dono do banco, como as funções api.*
 * (migração 09) e ingest.* (migração 10). O session_user e o token continuam os de quem chamou: é o que os gatilhos
 * conferem. Fica no esquema test, que só existe no PGlite; o n8n e os scripts ganham o esquema só para tentar.
 */
export const FUNCAO_DE_TESTE = `
  create or replace function test.rodar(p_sql text) returns void
  language plpgsql security definer set search_path = '' as $$
  begin
    execute p_sql;
  end $$;
  revoke all on function test.rodar(text) from public;
  grant usage on schema test to n8n_notifier, mkt_setup;
  grant execute on function test.rodar(text) to authenticated, mkt_worker, mkt_executor, n8n_notifier, mkt_setup;
`;

/** O comando pelo stand-in, para s.linhas(...) ou s.erro(codigo, ...). */
export function pelaFuncao(sql: string): [string, unknown[]] {
  return ['select test.rodar($1)', [sql]];
}

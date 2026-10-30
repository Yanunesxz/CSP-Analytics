/**
 * Consulta da tela de canal pago (`/canais/:plataforma`: Meta Ads, TikTok Ads, Google Ads).
 *
 * Parte das consultas de `queries.ts` — `metricasPorCampanha`, `porOperador`, `acoes` e `conectores`,
 * as mesmas contas da Visão geral e do Tráfego com IA — e entrega pronto o que a tela desenha para
 * uma plataforma: KPIs com o período anterior, uma linha por campanha com as ações já decididas,
 * séries diárias por operador, Humano × Claude com o sentido de cada diferença, verba e teto de cada
 * conta (marca × plataforma), a fila de propostas do canal, o alcance do "parar tudo" e o conector.
 *
 * Pura, com teste em `canais.test.ts`; na fase 3 vira view SQL. Métrica sem base é `null`, nunca 0
 * nem NaN. O canal vem da rota, não do filtro: `filtros.canal` é sempre trocado pela plataforma.
 */

import type { ActionStatus, Brand, ConnectorId, Operator, Platform, TrafficAction } from '@csp-mkt/shared';
import type { Intervalo } from '../../lib/periodo';
import type { Filtros } from '../../lib/url-state';
import type { Dados } from '../dados';
import {
  acoes,
  conectores,
  contagem,
  filtrarMarca,
  metricasPorCampanha,
  porOperador,
  soma,
  type ConectorComAtraso,
  type LinhaCampanha,
  type LinhaOperador,
  type MetricasPorCampanha,
} from '../queries';

export const PLATAFORMAS: readonly Platform[] = ['meta', 'tiktok', 'google'];

/** Conector que traz os números de cada plataforma (cartão em Conectores). */
export const CONECTOR_DA_PLATAFORMA: Readonly<Record<Platform, ConnectorId>> = {
  meta: 'meta',
  tiktok: 'tiktok',
  google: 'google_ads',
};

/**
 * Para que lado a diferença Claude − humano é boa: custo menor, ROAS maior. Volume (investimento,
 * leads, clientes novos, campanhas, ações) depende da verba de cada um e fica neutro, sem cor.
 */
export type Sentido = 'maior' | 'menor' | 'neutro';

const SENTIDO: Readonly<Record<string, Sentido>> = {
  cpl: 'menor',
  cpa: 'menor',
  custoPorClienteNovo: 'menor',
  roas: 'maior',
};

export interface LinhaHumanoClaude extends LinhaOperador {
  sentido: Sentido;
}

/** Pausa ou orçamento novo já decidido para a campanha, esperando execução. */
export interface AcaoAberta {
  id: string;
  kind: 'pause' | 'budget';
  status: Extract<ActionStatus, 'approved' | 'running'>;
  /** Orçamento diário pedido, em centavos (só em `budget`). */
  dailyBudgetCents: number | null;
}

export interface CampanhaDoCanal extends LinhaCampanha {
  acoesAbertas: AcaoAberta[];
}

export interface SerieDoOperador {
  operador: Operator;
  pontos: Array<{ date: string; investimento: number; leads: number }>;
}

/** A conta de anúncios de uma marca nesta plataforma: verba e teto das campanhas ativas. */
export interface ContaDoCanal {
  marca: Brand;
  /** Soma do orçamento diário das campanhas ativas. */
  verbaDiaria: number | null;
  /** Soma do teto de gasto das campanhas ativas. */
  teto: number | null;
  /** Investimento das campanhas ativas no período. */
  investimento: number | null;
  /** Investimento ÷ teto. */
  uso: number | null;
  campanhasAtivas: number | null;
  ativasDoClaude: number | null;
}

export interface PainelDoCanal {
  plataforma: Platform;
  intervalo: Intervalo;
  /** Totais do canal com o período anterior (KPIs). */
  totais: MetricasPorCampanha['totais'];
  /** Uma linha por campanha, mais investimento primeiro. */
  campanhas: CampanhaDoCanal[];
  /** Investimento e leads por dia, um por operador que tem campanha no recorte. */
  series: SerieDoOperador[];
  /** Campanhas do canal (na marca) por operador, para os chips de filtro. */
  campanhasPorOperador: Record<Operator, number | null>;
  opcoesDeCampanha: Array<{ valor: string; rotulo: string }>;
  humanoXClaude: LinhaHumanoClaude[];
  contas: ContaDoCanal[];
  /** Propostas esperando aprovação neste canal, mais novas primeiro. */
  propostas: TrafficAction[];
  /** Campanhas ativas do Claude que o "parar tudo" pausa (na marca, em todos os canais). */
  pararTudo: { total: number | null; porCanal: Array<{ canal: Platform; total: number }> };
  conector: ConectorComAtraso | null;
}

/** Lê o orçamento diário pedido de uma ação `budget`; null quando não dá para ler. */
export function orcamentoPedido(paramsJson: string): number | null {
  try {
    const params = JSON.parse(paramsJson) as unknown;
    if (params && typeof params === 'object' && 'dailyBudgetCents' in params) {
      const valor = (params as { dailyBudgetCents: unknown }).dailyBudgetCents;
      return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
    }
    return null;
  } catch {
    return null;
  }
}

function acoesAbertasPorCampanha(dados: Dados): Map<string, AcaoAberta[]> {
  const porCampanha = new Map<string, AcaoAberta[]>();
  for (const a of dados.actions) {
    if (!a.campaignId) continue;
    if (a.kind !== 'pause' && a.kind !== 'budget') continue;
    if (a.status !== 'approved' && a.status !== 'running') continue;
    const lista = porCampanha.get(a.campaignId) ?? [];
    lista.push({
      id: a.id,
      kind: a.kind,
      status: a.status,
      dailyBudgetCents: a.kind === 'budget' ? orcamentoPedido(a.paramsJson) : null,
    });
    porCampanha.set(a.campaignId, lista);
  }
  return porCampanha;
}

export function painelDoCanal(
  plataforma: Platform,
  dados: Dados,
  filtros: Filtros,
  agora: Date = new Date(),
): PainelDoCanal {
  const f: Filtros = { ...filtros, canal: plataforma };
  const metricas = metricasPorCampanha(dados, f, agora);
  const trafego = acoes(dados, f, agora);
  const abertas = acoesAbertasPorCampanha(dados);

  // Campanhas do canal na marca, sem os filtros de operador e campanha (chips, opções, contas)
  const doCanal = filtrarMarca(dados.campaigns, filtros.marca).filter((c) => c.platform === plataforma);

  const operadores: Operator[] = filtros.operador === 'todos' ? ['human', 'claude'] : [filtros.operador];
  const series: SerieDoOperador[] =
    dados.metrics.length === 0
      ? []
      : operadores
          .filter((operador) => metricas.linhas.some((l) => l.campanha.managedBy === operador))
          .map((operador) => ({
            operador,
            pontos: metricasPorCampanha(dados, { ...f, operador }, agora).serie.map((p) => ({
              date: p.date,
              investimento: p.investimento,
              leads: p.leads,
            })),
          }));

  const contas: ContaDoCanal[] = trafego.tetos.map((t) => {
    const ativas = doCanal.filter((c) => c.brandId === t.marca && c.status === 'active');
    return {
      marca: t.marca,
      verbaDiaria: dados.campaigns.length === 0 ? null : (soma(ativas.map((c) => c.dailyBudgetCents)) ?? 0),
      teto: t.teto,
      investimento: t.investimento,
      uso: t.uso,
      campanhasAtivas: t.campanhasAtivas,
      ativasDoClaude: contagem(
        dados.campaigns,
        ativas.filter((c) => c.managedBy === 'claude'),
      ),
    };
  });

  // A mesma regra de `pararTudo` em data/actions.ts: ativas do Claude na marca, em todo canal
  const doClaudeAtivas = filtrarMarca(dados.campaigns, filtros.marca).filter(
    (c) => c.managedBy === 'claude' && c.status === 'active',
  );

  const conector =
    conectores(dados, agora).lista.find((c) => c.id === CONECTOR_DA_PLATAFORMA[plataforma]) ?? null;

  return {
    plataforma,
    intervalo: metricas.intervalo,
    totais: metricas.totais,
    campanhas: metricas.linhas.map((linha) => ({
      ...linha,
      acoesAbertas: abertas.get(linha.campanha.id) ?? [],
    })),
    series,
    campanhasPorOperador: {
      human: contagem(
        dados.campaigns,
        doCanal.filter((c) => c.managedBy === 'human'),
      ),
      claude: contagem(
        dados.campaigns,
        doCanal.filter((c) => c.managedBy === 'claude'),
      ),
    },
    opcoesDeCampanha: doCanal
      .map((c) => ({ valor: c.id, rotulo: c.name }))
      .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR')),
    humanoXClaude: porOperador(dados, f, agora).linhas.map((l) => ({
      ...l,
      sentido: SENTIDO[l.chave] ?? 'neutro',
    })),
    contas,
    propostas: trafego.filaDeAprovacao,
    pararTudo: {
      total: contagem(dados.campaigns, doClaudeAtivas),
      porCanal: PLATAFORMAS.map((canal) => ({
        canal,
        total: doClaudeAtivas.filter((c) => c.platform === canal).length,
      })),
    },
    conector,
  };
}

export type ConsultaDoCanal = (dados: Dados, filtros: Filtros, agora: Date) => PainelDoCanal;

/** Uma consulta estável por plataforma, para `useConsulta` não recalcular a cada render. */
export const CONSULTA_DO_CANAL: Readonly<Record<Platform, ConsultaDoCanal>> = {
  meta: (dados, filtros, agora) => painelDoCanal('meta', dados, filtros, agora),
  tiktok: (dados, filtros, agora) => painelDoCanal('tiktok', dados, filtros, agora),
  google: (dados, filtros, agora) => painelDoCanal('google', dados, filtros, agora),
};

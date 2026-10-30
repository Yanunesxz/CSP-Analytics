/**
 * Consulta da tela Conectores (`/conectores`). Parte de `conectores()` de `queries.ts` (minutos desde a
 * última sincronização, atraso e "atrasado") e entrega pronto o que a tela desenha: um cartão por
 * integração esperada, o estado efetivo de cada uma, a ordem (o que pede ação primeiro), o resumo por
 * estado e a situação geral para o aviso do topo.
 *
 * Pura, com teste em `conectores.test.ts`. Na fase 3 vira view sobre `connectors` + `sync_runs`
 * (e a última linha de `sincronizacoes` do CRM replicada pelo worker). Sem base, o valor é `null`
 * ("Sem dados" na tela), nunca 0.
 *
 * Os conectores não têm marca (decisão 0003): marca, período e os outros filtros não mudam esta consulta.
 */

import type { Connector, ConnectorId, ConnectorStatus } from '@csp-mkt/shared';
import { rotulo } from '@csp-mkt/shared';
import type { Filtros } from '../../lib/url-state';
import type { Dados } from '../dados';
import { conectores, type ConectorComAtraso } from '../queries';

/**
 * As integrações que o CSP-MKT espera, na ordem do menu (Clientes → Canais → SEO e GEO). É a ordem
 * dos cartões quando o estado empata. Uma integração que não veio no conjunto aparece com "Sem dados".
 */
export const ORDEM_DOS_CONECTORES: readonly ConnectorId[] = [
  'csp360',
  'meta',
  'tiktok',
  'google_ads',
  'instagram',
  'search_console',
  'ga4',
];

/** De quanto em quanto tempo o CSP 360 roda a sincronização com os apps (pg_cron do CRM). */
export const RODADA_APPS_CRM_A_CADA_MINUTOS = 10;

/**
 * `Connector` com a última rodada apps → CSP 360 (a última linha de `sincronizacoes` do CRM, que o
 * worker replica junto com o CSP 360). O campo ainda não existe em `@csp-mkt/shared` nem nos dados de
 * exemplo: enquanto não existir, a linha mostra "Sem dados". Quando a fundação acrescentar
 * `upstreamLastRunAt` em `Connector`, esta consulta já o lê.
 */
export interface ConectorComRodada extends Connector {
  upstreamLastRunAt?: string | null;
}

/** A rodada apps → CSP 360, que explica atraso de pedido (o pedido chega ao CSP-MKT só pelo CSP 360). */
export interface RodadaAppsCrm {
  /** Instante da última rodada; null enquanto o CSP 360 não manda o diário da sincronização. */
  ultimaEm: string | null;
  minutosDesde: number | null;
  esperadoACadaMinutos: number;
  /** Minutos além do esperado; 0 em dia; null sem rodada. */
  atrasoMinutos: number | null;
  atrasada: boolean;
}

export interface CartaoDeConector {
  id: ConnectorId;
  /** Nome em português, de `labels.ts`. */
  nome: string;
  /**
   * Estado efetivo: `late` também quando passou do esperado sem o worker marcar; `down` e
   * `simulated` como vieram. `null` quando a integração não veio no conjunto (Sem dados).
   */
  estado: ConnectorStatus | null;
  ultimaSincronizacao: string | null;
  minutosDesdeSync: number | null;
  esperadoACadaMinutos: number | null;
  /** Minutos além do esperado; 0 em dia; null sem sincronização. */
  atrasoMinutos: number | null;
  erros24h: number | null;
  linhasGravadas: number | null;
  /** Caído ou atrasado: o cartão pede "Tentar de novo". */
  temProblema: boolean;
  /** Só no cartão do CSP 360; null nos outros. */
  rodadaAppsCrm: RodadaAppsCrm | null;
}

/** Situação geral, para o aviso do topo: o pior estado entre os conectores que existem. */
export type Situacao = 'caido' | 'atrasado' | 'em-dia';

export interface PainelDeConectores {
  /** Um por integração esperada: caídos, atrasados, funcionando, simulados e, por último, sem dados. */
  cartoes: CartaoDeConector[];
  /** Caídos e atrasados, na ordem dos cartões. O primeiro leva a ação principal da tela. */
  comProblema: CartaoDeConector[];
  /** Simulados (a ligar), na ordem dos cartões. */
  aLigar: CartaoDeConector[];
  /** Quantos conectores em cada estado efetivo; null quando nenhum conector veio. */
  resumo: Record<ConnectorStatus, number | null>;
  /** null quando nenhum conector veio. */
  situacao: Situacao | null;
  /** Sincronização mais recente entre todos, para o "atualizado há X min" da barra do topo. */
  ultimaSincronizacao: string | null;
  /** O "agora" da conta, para os textos relativos ("há 12 min") baterem com os números. */
  agora: string;
}

const PESO: Record<ConnectorStatus, number> = { down: 0, late: 1, ok: 2, simulated: 3 };
const PESO_SEM_DADOS = 4;

function minutosEntre(desde: string, agora: Date): number {
  return Math.max(0, Math.round((agora.getTime() - new Date(desde).getTime()) / 60_000));
}

function estadoEfetivo(c: ConectorComAtraso): ConnectorStatus {
  if (c.status === 'down' || c.status === 'simulated') return c.status;
  return c.atrasado ? 'late' : 'ok';
}

export function rodadaAppsCrm(conector: ConectorComRodada | undefined, agora: Date): RodadaAppsCrm {
  const ultimaEm = conector?.upstreamLastRunAt ?? null;
  const minutosDesde = ultimaEm ? minutosEntre(ultimaEm, agora) : null;
  const atrasoMinutos =
    minutosDesde === null ? null : Math.max(0, minutosDesde - RODADA_APPS_CRM_A_CADA_MINUTOS);
  return {
    ultimaEm,
    minutosDesde,
    esperadoACadaMinutos: RODADA_APPS_CRM_A_CADA_MINUTOS,
    atrasoMinutos,
    atrasada: atrasoMinutos !== null && atrasoMinutos > 0,
  };
}

function cartaoDe(
  id: ConnectorId,
  conector: ConectorComAtraso | undefined,
  bruto: ConectorComRodada | undefined,
  agora: Date,
): CartaoDeConector {
  const rodada = id === 'csp360' ? rodadaAppsCrm(bruto, agora) : null;
  if (!conector) {
    return {
      id,
      nome: rotulo('connectorId', id),
      estado: null,
      ultimaSincronizacao: null,
      minutosDesdeSync: null,
      esperadoACadaMinutos: null,
      atrasoMinutos: null,
      erros24h: null,
      linhasGravadas: null,
      temProblema: false,
      rodadaAppsCrm: rodada,
    };
  }
  const estado = estadoEfetivo(conector);
  return {
    id,
    nome: rotulo('connectorId', id),
    estado,
    ultimaSincronizacao: conector.lastSyncAt,
    minutosDesdeSync: conector.minutosDesdeSync,
    esperadoACadaMinutos: conector.expectedEveryMinutes,
    atrasoMinutos: conector.atrasoMinutos,
    erros24h: conector.errors24h,
    linhasGravadas: conector.rowsWritten,
    temProblema: estado === 'down' || estado === 'late',
    rodadaAppsCrm: rodada,
  };
}

function peso(cartao: CartaoDeConector): number {
  return cartao.estado === null ? PESO_SEM_DADOS : PESO[cartao.estado];
}

function posicao(id: ConnectorId): number {
  const i = ORDEM_DOS_CONECTORES.indexOf(id);
  return i === -1 ? ORDEM_DOS_CONECTORES.length : i;
}

export function painelDeConectores(
  dados: Dados,
  _filtros: Filtros,
  agora: Date = new Date(),
): PainelDeConectores {
  const base = conectores(dados, agora);
  const porId = new Map<ConnectorId, ConectorComAtraso>();
  for (const c of base.lista) if (!porId.has(c.id)) porId.set(c.id, c);
  const brutos: readonly ConectorComRodada[] = dados.connectors;
  const brutoPorId = new Map<ConnectorId, ConectorComRodada>();
  for (const c of brutos) if (!brutoPorId.has(c.id)) brutoPorId.set(c.id, c);

  // As esperadas primeiro; uma integração fora da lista (vinda do banco) também ganha cartão.
  const ids = [
    ...ORDEM_DOS_CONECTORES,
    ...[...porId.keys()].filter((id) => !ORDEM_DOS_CONECTORES.includes(id)),
  ];

  const cartoes = ids
    .map((id) => cartaoDe(id, porId.get(id), brutoPorId.get(id), agora))
    .sort(
      (a, b) => peso(a) - peso(b) || posicao(a.id) - posicao(b.id) || a.nome.localeCompare(b.nome, 'pt-BR'),
    );

  const existentes = cartoes.filter((c) => c.estado !== null);
  const temBase = existentes.length > 0;
  const contar = (estado: ConnectorStatus) =>
    temBase ? existentes.filter((c) => c.estado === estado).length : null;

  const resumo: Record<ConnectorStatus, number | null> = {
    ok: contar('ok'),
    late: contar('late'),
    down: contar('down'),
    simulated: contar('simulated'),
  };

  let situacao: Situacao | null = null;
  if (temBase) {
    if (resumo.down) situacao = 'caido';
    else if (resumo.late) situacao = 'atrasado';
    else situacao = 'em-dia';
  }

  return {
    cartoes,
    comProblema: cartoes.filter((c) => c.temProblema),
    aLigar: cartoes.filter((c) => c.estado === 'simulated'),
    resumo,
    situacao,
    ultimaSincronizacao: base.ultimaSincronizacao,
    agora: agora.toISOString(),
  };
}

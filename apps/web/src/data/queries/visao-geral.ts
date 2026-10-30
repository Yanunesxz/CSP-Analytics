/**
 * Visão geral (rota `/`): numa consulta só, tudo o que a tela mostra.
 *
 * - Números do período (de `kpisVisaoGeral`) e o divisor do custo por cliente novo
 *   (clientes novos que vieram de campanha, de `custoPorClienteNovo`).
 * - Custo por cliente novo por marca e por canal (de `custoPorClienteNovo`): só as marcas do
 *   contexto e só os canais do filtro, para a tela não mostrar o que a pessoa tirou.
 * - Leads e clientes novos por dia, de todas as origens, como os KPIs.
 * - Na visão Gestor de tráfego: Humano × Claude (de `porOperador`), verba e limite de gasto por
 *   conta (de `acoes().tetos`) e quantas propostas esperam aprovação.
 *
 * A série por dia repete o recorte de leads e a regra de cliente novo de `queries.ts`
 * (`leadsFiltrados` e `clientesNovos`, que lá são privadas). O teste confere que a soma da série
 * bate com os KPIs; quando `queries.ts` exportar as duas, a cópia daqui sai.
 * Métrica sem base é `null` — nunca 0 nem NaN.
 */

import type { Brand, Lead, Platform } from '@csp-mkt/shared';
import { diaSp, diasEntre } from '../../lib/datas';
import type { Intervalo } from '../../lib/periodo';
import type { Filtros } from '../../lib/url-state';
import type { Dados } from '../dados';
import {
  acoes,
  // A série por dia usa a mesma regra de leads e de cliente novo dos indicadores (nenhuma regra em dois lugares)
  clientesNovos as clientesNovosNoPeriodo,
  custoPorClienteNovo,
  filtrarPeriodo,
  kpisVisaoGeral,
  leadsFiltrados as leadsDoRecorte,
  porOperador,
  soma,
  type KpisVisaoGeral,
  type LinhaCusto,
  type LinhaOperador,
} from '../queries';

/* ---------- Tipos de saída ---------- */

export type NumerosDaVisaoGeral = Pick<
  KpisVisaoGeral,
  | 'leads'
  | 'clientesNovos'
  | 'custoPorClienteNovo'
  | 'investimento'
  | 'pedidos'
  | 'valorPedidos'
  | 'faturados'
  | 'valorFaturado'
  | 'alcanceInstagram'
>;

export interface PontoDoDia {
  /** Dia `AAAA-MM-DD` de São Paulo. */
  date: string;
  /** Leads criados no dia; null sem base. */
  leads: number | null;
  /** Clientes novos no dia do 1º pedido enviado; null sem base. */
  clientesNovos: number | null;
}

/** Como ler a diferença Claude × Humano: custo cair é melhor, ROAS subir é melhor; volume não tem lado. */
export type Sentido = 'menor-melhor' | 'maior-melhor' | null;

export interface LinhaHumanoClaude extends LinhaOperador {
  sentido: Sentido;
  /** true: o Claude foi melhor; false: pior; null: a linha não tem lado ou falta base. */
  claudeMelhor: boolean | null;
}

/** Uma conta de anúncio = uma marca numa plataforma. */
export interface ContaDeAnuncio {
  marca: Brand;
  canal: Platform;
  /** Investimento do período nas campanhas ativas da conta. */
  investimento: number | null;
  /** Soma dos limites de gasto (`spendCapCents`) das campanhas ativas. */
  limite: number | null;
  /** investimento ÷ limite. */
  uso: number | null;
  /** Soma dos orçamentos diários das campanhas ativas. */
  verbaDiaria: number | null;
  campanhasAtivas: number | null;
  /** `perto`: uso a partir de `LIMITE_DE_ALERTA`; `acima`: uso de 100% ou mais; null: sem alerta. */
  alerta: AlertaDeLimite | null;
}

export type AlertaDeLimite = 'perto' | 'acima';

export interface GestorDaVisaoGeral {
  /** As linhas de `LINHAS_HUMANO_CLAUDE`, nesta ordem. */
  humanoClaude: LinhaHumanoClaude[];
  contas: ContaDeAnuncio[];
  /** Propostas esperando aprovação (sem as pendências de medição); null sem base. */
  propostasNaFila: number | null;
}

export interface VisaoGeral {
  intervalo: Intervalo;
  numeros: NumerosDaVisaoGeral;
  /** Clientes novos que vieram de campanha (pela UTM): o divisor do custo por cliente novo. */
  clientesNovosDeCampanha: number | null;
  /** Leads do período sem marca (SDR · WhatsApp), que entram nas duas marcas. */
  leadsSemMarca: number | null;
  /** Custo por cliente novo de cada marca do contexto (as duas em "As duas", uma com a marca escolhida). */
  porMarca: LinhaCusto[];
  /** Custo por cliente novo de cada canal do filtro (os três sem filtro de canal). */
  porCanal: LinhaCusto[];
  /** Leads e clientes novos por dia do período, de todas as origens. */
  porDia: PontoDoDia[];
  /** Só na visão Gestor de tráfego. */
  gestor: GestorDaVisaoGeral | null;
}

/* ---------- Regras desta tela ---------- */

/** A partir de quanto do limite de gasto a conta aparece como "perto do limite". */
export const LIMITE_DE_ALERTA = 0.9;

function alertaDeLimite(uso: number | null): AlertaDeLimite | null {
  if (uso === null) return null;
  if (uso >= 1) return 'acima';
  return uso >= LIMITE_DE_ALERTA ? 'perto' : null;
}

/** Linhas de Humano × Claude que a Visão geral mostra, nesta ordem (o resto fica em Tráfego com IA). */
export const LINHAS_HUMANO_CLAUDE = [
  'investimento',
  'parcelaDaVerba',
  'campanhasAtivas',
  'leads',
  'cpl',
  'clientesNovos',
  'custoPorClienteNovo',
  'roas',
] as const;

const SENTIDO: Readonly<Record<string, Sentido>> = {
  cpl: 'menor-melhor',
  cpa: 'menor-melhor',
  custoPorClienteNovo: 'menor-melhor',
  roas: 'maior-melhor',
};

/**
 * Em Humano × Claude, leads e custo por lead vêm das plataformas (o que cada uma conta), não do
 * CSP 360 como o indicador "Leads" da mesma tela: o rótulo diz de onde vem.
 */
const ROTULO: Readonly<Record<string, string>> = {
  leads: 'Leads (plataformas)',
  cpl: 'Custo por lead (plataformas)',
};

/* ---------- Leads e clientes novos: leadsFiltrados e clientesNovos vêm de queries.ts ---------- */

function contarPorDia(leads: readonly Lead[], instante: (lead: Lead) => string | null): Map<string, number> {
  const porDia = new Map<string, number>();
  for (const lead of leads) {
    const valor = instante(lead);
    if (!valor) continue;
    const dia = diaSp(valor);
    porDia.set(dia, (porDia.get(dia) ?? 0) + 1);
  }
  return porDia;
}

/* ---------- Gestor de tráfego ---------- */

function claudeMelhor(sentido: Sentido, diferenca: number | null): boolean | null {
  if (sentido === null || diferenca === null || diferenca === 0) return null;
  return sentido === 'menor-melhor' ? diferenca < 0 : diferenca > 0;
}

function gestorDaVisaoGeral(dados: Dados, filtros: Filtros, agora: Date): GestorDaVisaoGeral {
  const linhas = new Map(porOperador(dados, filtros, agora).linhas.map((l) => [l.chave, l]));
  const humanoClaude = LINHAS_HUMANO_CLAUDE.flatMap((chave): LinhaHumanoClaude[] => {
    const linha = linhas.get(chave);
    if (!linha) return [];
    const sentido = SENTIDO[chave] ?? null;
    return [
      {
        ...linha,
        rotulo: ROTULO[chave] ?? linha.rotulo,
        sentido,
        claudeMelhor: claudeMelhor(sentido, linha.diferenca),
      },
    ];
  });

  const trafego = acoes(dados, filtros, agora);
  const temCampanhas = dados.campaigns.length > 0;
  const contas = trafego.tetos.map((t): ContaDeAnuncio => {
    const ativas = dados.campaigns.filter(
      (c) => c.brandId === t.marca && c.platform === t.canal && c.status === 'active',
    );
    return {
      marca: t.marca,
      canal: t.canal,
      investimento: t.investimento,
      limite: t.teto,
      uso: t.uso,
      verbaDiaria: temCampanhas ? (soma(ativas.map((c) => c.dailyBudgetCents)) ?? 0) : null,
      campanhasAtivas: t.campanhasAtivas,
      alerta: alertaDeLimite(t.uso),
    };
  });

  return {
    humanoClaude,
    contas,
    propostasNaFila: dados.actions.length === 0 ? null : trafego.filaDeAprovacao.length,
  };
}

/* ---------- A consulta ---------- */

export function visaoGeral(dados: Dados, filtros: Filtros, agora: Date = new Date()): VisaoGeral {
  const k = kpisVisaoGeral(dados, filtros, agora);
  const intervalo = k.intervalo;
  const custo = custoPorClienteNovo(dados, filtros, agora);

  const temLeads = dados.leads.length > 0;
  const leads = leadsDoRecorte(dados, filtros);
  const doPeriodo = filtrarPeriodo(leads, 'createdAt', intervalo);
  const leadsPorDia = contarPorDia(doPeriodo, (l) => l.createdAt);
  const novosPorDia = contarPorDia(clientesNovosNoPeriodo(leads, intervalo), (l) => l.firstOrderAt);

  return {
    intervalo,
    numeros: {
      leads: k.leads,
      clientesNovos: k.clientesNovos,
      custoPorClienteNovo: k.custoPorClienteNovo,
      investimento: k.investimento,
      pedidos: k.pedidos,
      valorPedidos: k.valorPedidos,
      faturados: k.faturados,
      valorFaturado: k.valorFaturado,
      alcanceInstagram: k.alcanceInstagram,
    },
    clientesNovosDeCampanha: custo.total.clientesNovos.atual,
    leadsSemMarca: temLeads ? doPeriodo.filter((l) => l.brandId === null).length : null,
    porMarca: custo.porMarca,
    porCanal: custo.porCanal,
    porDia: diasEntre(intervalo.inicio, intervalo.fim).map((date) => ({
      date,
      leads: temLeads ? (leadsPorDia.get(date) ?? 0) : null,
      clientesNovos: temLeads ? (novosPorDia.get(date) ?? 0) : null,
    })),
    gestor: filtros.visao === 'gestor' ? gestorDaVisaoGeral(dados, filtros, agora) : null,
  };
}

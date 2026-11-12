/**
 * Consultas puras sobre `Dados` + `Filtros`: espelham as views e funções SQL da fase 3
 * (`kpi_*`). Toda função recebe o conjunto de dados, os filtros e, opcionalmente, "agora",
 * e devolve números prontos para a tela. Métrica sem base devolve `null` — nunca 0 nem NaN.
 *
 * Convenções:
 * - `Metrica` = valor do período, valor do período anterior e variação relativa (null sem base
 *   ou quando `filtros.comparar` é false).
 * - Contagem sobre tabela vazia = null ("Sem dados"); contagem sobre tabela com linhas = 0 ou mais.
 * - Marca: "todas" não filtra; marca escolhida inclui o dado sem marca (lead do SDR), que
 *   aparece nas duas e é sinalizado como "Sem marca" (decisão 0003).
 * - Cliente novo = lead que chegou ao 1º pedido enviado (`first_order` ou `invoiced`), contado
 *   uma vez por `crmCustomerId`, no dia do `firstOrderAt` (decisão 0012).
 * - Pedido conta só enviado (`sent`): orçamento e cancelado ficam fora. Faturado é o carimbo `isInvoiced`.
 * - Atribuição a canal e campanha pelo `utmCampaign` do lead (decisão 0009).
 */

import type {
  ActionStatus,
  Brand,
  Campaign,
  Connector,
  Customer,
  DailyMetric,
  GeoSource,
  IgMedia,
  Lead,
  LeadSource,
  LeadStage,
  Operator,
  Order,
  Platform,
  TrafficAction,
} from '@csp-mkt/shared';
import { rotulo } from '@csp-mkt/shared';
import { diaSp, diferencaEmDias, diasEntre, somarMeses } from '../lib/datas';
import { diferenca } from '../lib/format';
import { intervaloDoPeriodo, type Intervalo } from '../lib/periodo';
import type { Filtros } from '../lib/url-state';
import type { Dados } from './dados';

/* ---------- Tipos de saída ---------- */

export interface Metrica {
  atual: number | null;
  anterior: number | null;
  /** (atual − anterior) ÷ |anterior|; null sem base. */
  variacao: number | null;
}

export type Formato = 'dinheiro' | 'numero' | 'percentual' | 'decimal';

/* ---------- Utilidades ---------- */

export function metrica(atual: number | null, anterior: number | null, comparar = true): Metrica {
  if (!comparar) return { atual, anterior: null, variacao: null };
  return { atual, anterior, variacao: diferenca(atual, anterior) };
}

/** Divisão segura: null quando o divisor é 0 ou algum lado não existe. */
export function razao(numerador: number | null, denominador: number | null): number | null {
  if (numerador === null || denominador === null || denominador === 0) return null;
  return numerador / denominador;
}

/** Soma de uma lista; null quando a lista é vazia (sem base). */
export function soma(valores: Array<number | null>): number | null {
  if (valores.length === 0) return null;
  let total = 0;
  for (const v of valores) total += v ?? 0;
  return total;
}

/** Contagem sobre a tabela: null quando a tabela inteira está vazia. */
export function contagem(tabela: readonly unknown[], filtradas: readonly unknown[]): number | null {
  return tabela.length === 0 ? null : filtradas.length;
}

export interface Janela {
  inicio: string;
  fim: string;
}

/** Linhas cujo campo de data (dia ou instante ISO) cai no intervalo, inclusivo. */
export function filtrarPeriodo<T>(linhas: readonly T[], campo: keyof T, janela: Janela): T[] {
  return linhas.filter((linha) => {
    const valor = linha[campo];
    if (typeof valor !== 'string' || !valor) return false;
    const dia = diaSp(valor);
    return dia >= janela.inicio && dia <= janela.fim;
  });
}

function anterior(intervalo: Intervalo): Janela {
  return { inicio: intervalo.anteriorInicio, fim: intervalo.anteriorFim };
}

/** Marca: "todas" não filtra; marca escolhida inclui o dado sem marca (`brandId` null). */
export function filtrarMarca<T extends { brandId: Brand | null }>(
  linhas: readonly T[],
  marca: Filtros['marca'],
): T[] {
  if (marca === 'todas') return [...linhas];
  return linhas.filter((l) => l.brandId === marca || l.brandId === null);
}

function porId<T extends { id: string }>(lista: readonly T[]): Map<string, T> {
  return new Map(lista.map((item) => [item.id, item]));
}

/**
 * Só os pedidos enviados: orçamento e cancelado não entram em contagem nem em receita.
 * Exportada para o 1º pedido do Resumo simples seguir a mesma regra.
 */
export function enviados(pedidos: readonly Order[]): Order[] {
  return pedidos.filter((p) => p.status === 'sent');
}

/**
 * Campanhas que respeitam marca, canal, operador e campanha.
 * Exportada para as consultas de cada tela usarem o mesmo recorte (nenhuma regra em dois lugares).
 */
export function campanhasFiltradas(dados: Dados, filtros: Filtros): Campaign[] {
  return filtrarMarca(dados.campaigns, filtros.marca).filter(
    (c) =>
      (!filtros.canal || c.platform === filtros.canal) &&
      (filtros.operador === 'todos' || c.managedBy === filtros.operador) &&
      (!filtros.campanha || c.id === filtros.campanha || c.utmCampaign === filtros.campanha),
  );
}

function metricasDe(dados: Dados, campanhas: readonly Campaign[], janela: Janela): DailyMetric[] {
  const ids = new Set(campanhas.map((c) => c.id));
  return filtrarPeriodo(dados.metrics, 'date', janela).filter((m) => ids.has(m.campaignId));
}

const CANAIS_PAGOS: readonly LeadSource[] = ['meta', 'tiktok', 'google'];

/**
 * Leads que respeitam marca, canal, campanha, operador, origem e representante.
 * Exportada para as consultas de cada tela usarem a mesma regra (nenhuma regra em dois lugares).
 */
export function leadsFiltrados(dados: Dados, filtros: Filtros): Lead[] {
  const porUtm = new Map(dados.campaigns.map((c) => [c.utmCampaign, c]));
  return filtrarMarca(dados.leads, filtros.marca).filter((lead) => {
    const campanha = lead.utmCampaign ? porUtm.get(lead.utmCampaign) : undefined;
    if (filtros.origem && lead.source !== filtros.origem) return false;
    if (filtros.canal && lead.source !== filtros.canal) return false;
    if (filtros.operador !== 'todos' && campanha?.managedBy !== filtros.operador) return false;
    if (
      filtros.campanha &&
      !(campanha && (campanha.id === filtros.campanha || campanha.utmCampaign === filtros.campanha))
    )
      return false;
    if (filtros.representante && lead.repId !== filtros.representante) return false;
    return true;
  });
}

/** O lead chegou ao 1º pedido enviado (decisão 0012)? */
export function chegouAoPedido(lead: Lead): boolean {
  return (lead.stage === 'first_order' || lead.stage === 'invoiced') && lead.firstOrderAt !== null;
}

/** Clientes novos no período: leads com 1º pedido no intervalo, um por cliente. */
export function clientesNovos(leads: readonly Lead[], janela: Janela): Lead[] {
  const vistos = new Set<string>();
  return filtrarPeriodo(leads.filter(chegouAoPedido), 'firstOrderAt', janela).filter((lead) => {
    const chave = lead.crmCustomerId ?? lead.id;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

/** Leads atribuídos a uma destas campanhas, pela `utmCampaign` (decisão 0009). */
export function comCampanha(leads: readonly Lead[], campanhas: readonly Campaign[]): Lead[] {
  const utms = new Set(campanhas.map((c) => c.utmCampaign));
  return leads.filter((l) => l.utmCampaign !== null && utms.has(l.utmCampaign));
}

function somaCampo<T>(linhas: readonly T[], campo: keyof T): number | null {
  return soma(linhas.map((l) => (typeof l[campo] === 'number' ? (l[campo] as number) : null)));
}

/* ---------- Visão geral ---------- */

export interface KpisVisaoGeral {
  intervalo: Intervalo;
  leads: Metrica;
  clientesNovos: Metrica;
  custoPorClienteNovo: Metrica;
  custoPorLead: Metrica;
  investimento: Metrica;
  pedidos: Metrica;
  valorPedidos: Metrica;
  faturados: Metrica;
  /** Sempre null até o Control abrir o canal de faturamento. */
  valorFaturado: Metrica;
  alcanceInstagram: Metrica;
  porMarca: Array<{
    marca: Brand;
    investimento: Metrica;
    clientesNovos: Metrica;
    custoPorClienteNovo: Metrica;
  }>;
  porCanal: Array<{
    canal: Platform;
    investimento: Metrica;
    leads: Metrica;
    clientesNovos: Metrica;
    custoPorClienteNovo: Metrica;
  }>;
}

function custoNoPeriodo(dados: Dados, filtros: Filtros, janela: Janela) {
  const campanhas = campanhasFiltradas(dados, filtros);
  const leads = leadsFiltrados(dados, filtros);
  const metricas = metricasDe(dados, campanhas, janela);
  const investimento = dados.metrics.length === 0 ? null : (somaCampo(metricas, 'spendCents') ?? 0);
  const leadsNoPeriodo = filtrarPeriodo(leads, 'createdAt', janela);
  const leadsPagos = comCampanha(leadsNoPeriodo, campanhas);
  const novos = clientesNovos(leads, janela);
  const novosAtribuidos = comCampanha(novos, campanhas);
  return {
    investimento,
    leads: contagem(dados.leads, leadsNoPeriodo),
    leadsPagos: contagem(dados.leads, leadsPagos),
    clientesNovos: contagem(dados.leads, novos),
    clientesNovosAtribuidos: contagem(dados.leads, novosAtribuidos),
    custoPorClienteNovo: razao(investimento, contagem(dados.leads, novosAtribuidos)),
    custoPorLead: razao(investimento, contagem(dados.leads, leadsPagos)),
  };
}

export function kpisVisaoGeral(dados: Dados, filtros: Filtros, agora: Date = new Date()): KpisVisaoGeral {
  const intervalo = intervaloDoPeriodo(filtros.periodo, agora);
  const atual = custoNoPeriodo(dados, filtros, intervalo);
  const antes = custoNoPeriodo(dados, filtros, anterior(intervalo));
  const c = filtros.comparar;

  const pedidosDe = (janela: Janela) =>
    filtrarPeriodo(filtrarMarca(enviados(dados.orders), filtros.marca), 'createdAt', janela);
  const pedidosAtual = pedidosDe(intervalo);
  const pedidosAntes = pedidosDe(anterior(intervalo));
  const faturadosAtual = pedidosAtual.filter((o) => o.isInvoiced);
  const faturadosAntes = pedidosAntes.filter((o) => o.isInvoiced);

  const alcanceDe = (janela: Janela) =>
    dados.igDaily.length === 0
      ? null
      : (somaCampo(filtrarPeriodo(filtrarMarca(dados.igDaily, filtros.marca), 'date', janela), 'reach') ?? 0);

  const porMarca = (['cs', 'plumene'] as Brand[]).map((marca) => {
    const f = { ...filtros, marca };
    const a = custoNoPeriodo(dados, f, intervalo);
    const b = custoNoPeriodo(dados, f, anterior(intervalo));
    return {
      marca,
      investimento: metrica(a.investimento, b.investimento, c),
      clientesNovos: metrica(a.clientesNovos, b.clientesNovos, c),
      custoPorClienteNovo: metrica(a.custoPorClienteNovo, b.custoPorClienteNovo, c),
    };
  });

  const porCanal = (['meta', 'tiktok', 'google'] as Platform[]).map((canal) => {
    const f = { ...filtros, canal };
    const a = custoNoPeriodo(dados, f, intervalo);
    const b = custoNoPeriodo(dados, f, anterior(intervalo));
    return {
      canal,
      investimento: metrica(a.investimento, b.investimento, c),
      leads: metrica(a.leads, b.leads, c),
      clientesNovos: metrica(a.clientesNovosAtribuidos, b.clientesNovosAtribuidos, c),
      custoPorClienteNovo: metrica(a.custoPorClienteNovo, b.custoPorClienteNovo, c),
    };
  });

  return {
    intervalo,
    leads: metrica(atual.leads, antes.leads, c),
    clientesNovos: metrica(atual.clientesNovos, antes.clientesNovos, c),
    custoPorClienteNovo: metrica(atual.custoPorClienteNovo, antes.custoPorClienteNovo, c),
    custoPorLead: metrica(atual.custoPorLead, antes.custoPorLead, c),
    investimento: metrica(atual.investimento, antes.investimento, c),
    pedidos: metrica(contagem(dados.orders, pedidosAtual), contagem(dados.orders, pedidosAntes), c),
    valorPedidos: metrica(
      dados.orders.length === 0 ? null : (somaCampo(pedidosAtual, 'totalCents') ?? 0),
      dados.orders.length === 0 ? null : (somaCampo(pedidosAntes, 'totalCents') ?? 0),
      c,
    ),
    faturados: metrica(contagem(dados.orders, faturadosAtual), contagem(dados.orders, faturadosAntes), c),
    valorFaturado: metrica(
      faturadosAtual.length > 0 && faturadosAtual.every((o) => o.invoicedTotalCents !== null)
        ? somaCampo(faturadosAtual, 'invoicedTotalCents')
        : null,
      faturadosAntes.length > 0 && faturadosAntes.every((o) => o.invoicedTotalCents !== null)
        ? somaCampo(faturadosAntes, 'invoicedTotalCents')
        : null,
      c,
    ),
    alcanceInstagram: metrica(alcanceDe(intervalo), alcanceDe(anterior(intervalo)), c),
    porMarca,
    porCanal,
  };
}

/* ---------- Chegada de clientes ---------- */

export const ETAPAS: readonly LeadStage[] = ['lead', 'prospect', 'registered', 'first_order', 'invoiced'];

export interface Etapa {
  etapa: LeadStage;
  rotulo: string;
  /** Leads do período que chegaram pelo menos a esta etapa. */
  total: number | null;
  anterior: number | null;
  /** Em relação à etapa anterior; null na primeira ou sem base. */
  taxa: number | null;
}

export interface FunilChegada {
  intervalo: Intervalo;
  etapas: Etapa[];
  /** lead → 1º pedido, em relação ao total de leads do período. */
  taxaLeadParaCliente: Metrica;
  tempoMedioAtePedidoDias: number | null;
  porOrigem: Array<{
    origem: LeadSource;
    leads: number | null;
    clientesNovos: number | null;
    taxa: number | null;
  }>;
  porRepresentante: Array<{
    representante: string;
    leads: number | null;
    clientesNovos: number | null;
    taxa: number | null;
  }>;
  /** Coorte por mês de criação do lead (últimos 4 meses do intervalo para trás). */
  coorte: Array<{ mes: string; leads: number | null; clientesNovos: number | null; taxa: number | null }>;
}

function etapasDe(leads: readonly Lead[], tabela: readonly unknown[]): Array<number | null> {
  const iPedido = ETAPAS.indexOf('first_order');
  return ETAPAS.map((_etapa, i) =>
    contagem(
      tabela,
      // Do 1º pedido em diante vale a regra de cliente novo (etapa e carimbo do pedido), a mesma do resto da tela
      leads.filter((l) => ETAPAS.indexOf(l.stage) >= i && (i < iPedido || chegouAoPedido(l))),
    ),
  );
}

export function funilChegada(dados: Dados, filtros: Filtros, agora: Date = new Date()): FunilChegada {
  const intervalo = intervaloDoPeriodo(filtros.periodo, agora);
  const leads = leadsFiltrados(dados, filtros);
  const doPeriodo = filtrarPeriodo(leads, 'createdAt', intervalo);
  const doAnterior = filtrarPeriodo(leads, 'createdAt', anterior(intervalo));
  const totais = etapasDe(doPeriodo, dados.leads);
  const totaisAntes = etapasDe(doAnterior, dados.leads);

  const etapas: Etapa[] = ETAPAS.map((etapa, i) => ({
    etapa,
    rotulo: rotulo('leadStage', etapa),
    total: totais[i] ?? null,
    anterior: totaisAntes[i] ?? null,
    taxa: i === 0 ? null : razao(totais[i] ?? null, totais[i - 1] ?? null),
  }));

  const convertidos = doPeriodo.filter(chegouAoPedido);
  const tempos = convertidos.map((l) => diferencaEmDias(diaSp(l.createdAt), diaSp(l.firstOrderAt as string)));
  const tempoMedio = tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : null;

  const agrupar = <K extends string>(chaves: readonly K[], chaveDe: (l: Lead) => K | null) =>
    chaves.map((chave) => {
      const grupo = doPeriodo.filter((l) => chaveDe(l) === chave);
      const novos = grupo.filter(chegouAoPedido);
      return {
        chave,
        leads: contagem(dados.leads, grupo),
        clientesNovos: contagem(dados.leads, novos),
        taxa: razao(novos.length, grupo.length),
      };
    });

  const origens = [...new Set(doPeriodo.map((l) => l.source))];
  const representantes = [
    ...new Set(doPeriodo.map((l) => l.repId).filter((r): r is string => r !== null)),
  ].sort();

  // somarMeses parte do dia 1: no dia 31 (ou 29 e 30 de março) setUTCMonth transbordaria para o mês seguinte
  const meses: string[] = [];
  for (let i = 3; i >= 0; i -= 1) meses.push(somarMeses(intervalo.fim, -i).slice(0, 7));
  const coorte = meses.map((mes) => {
    const grupo = leads.filter((l) => diaSp(l.createdAt).startsWith(mes));
    const novos = grupo.filter(chegouAoPedido);
    return {
      mes,
      leads: contagem(dados.leads, grupo),
      clientesNovos: contagem(dados.leads, novos),
      taxa: razao(novos.length, grupo.length),
    };
  });

  return {
    intervalo,
    etapas,
    taxaLeadParaCliente: metrica(
      razao(convertidos.length, doPeriodo.length),
      razao(doAnterior.filter(chegouAoPedido).length, doAnterior.length),
      filtros.comparar,
    ),
    tempoMedioAtePedidoDias: tempoMedio,
    porOrigem: agrupar(origens, (l) => l.source).map(({ chave, ...r }) => ({ origem: chave, ...r })),
    porRepresentante: agrupar(representantes, (l) => l.repId).map(({ chave, ...r }) => ({
      representante: chave,
      ...r,
    })),
    coorte,
  };
}

/* ---------- Custo por cliente novo ---------- */

export interface LinhaCusto {
  marca: Brand | null;
  canal: Platform | null;
  investimento: Metrica;
  leads: Metrica;
  custoPorLead: Metrica;
  clientesNovos: Metrica;
  custo: Metrica;
}

export interface CustoPorClienteNovo {
  intervalo: Intervalo;
  /** Marca × canal. */
  linhas: LinhaCusto[];
  porMarca: LinhaCusto[];
  porCanal: LinhaCusto[];
  total: LinhaCusto;
}

export function custoPorClienteNovo(
  dados: Dados,
  filtros: Filtros,
  agora: Date = new Date(),
): CustoPorClienteNovo {
  const intervalo = intervaloDoPeriodo(filtros.periodo, agora);
  const c = filtros.comparar;
  const linha = (marca: Brand | null, canal: Platform | null): LinhaCusto => {
    const f: Filtros = { ...filtros, marca: marca ?? filtros.marca, canal: canal ?? filtros.canal };
    const a = custoNoPeriodo(dados, f, intervalo);
    const b = custoNoPeriodo(dados, f, anterior(intervalo));
    return {
      marca,
      canal,
      investimento: metrica(a.investimento, b.investimento, c),
      leads: metrica(a.leadsPagos, b.leadsPagos, c),
      custoPorLead: metrica(a.custoPorLead, b.custoPorLead, c),
      clientesNovos: metrica(a.clientesNovosAtribuidos, b.clientesNovosAtribuidos, c),
      custo: metrica(a.custoPorClienteNovo, b.custoPorClienteNovo, c),
    };
  };
  const marcas: Brand[] = filtros.marca === 'todas' ? ['cs', 'plumene'] : [filtros.marca];
  const canais: Platform[] = filtros.canal ? [filtros.canal] : ['meta', 'tiktok', 'google'];
  return {
    intervalo,
    linhas: marcas.flatMap((marca) => canais.map((canal) => linha(marca, canal))),
    porMarca: marcas.map((marca) => linha(marca, null)),
    porCanal: canais.map((canal) => linha(null, canal)),
    total: linha(null, null),
  };
}

/* ---------- Campanhas ---------- */

export interface LinhaCampanha {
  campanha: Campaign;
  investimento: Metrica;
  impressoes: Metrica;
  cliques: Metrica;
  ctr: Metrica;
  cpc: Metrica;
  leads: Metrica;
  cpl: Metrica;
  conversoes: Metrica;
  cpa: Metrica;
  /** Receita reportada ÷ investimento; null sem receita rastreada. */
  roas: Metrica;
  clientesNovos: Metrica;
  custoPorClienteNovo: Metrica;
  /** Investimento do período ÷ teto da campanha. */
  usoDoTeto: number | null;
}

export interface MetricasPorCampanha {
  intervalo: Intervalo;
  linhas: LinhaCampanha[];
  totais: Omit<LinhaCampanha, 'campanha' | 'usoDoTeto'>;
  serie: Array<{ date: string; investimento: number; leads: number; cliques: number }>;
}

function resumoDeMetricas(metricas: readonly DailyMetric[], temBase: boolean) {
  const investimento = temBase ? (somaCampo(metricas, 'spendCents') ?? 0) : null;
  const impressoes = temBase ? (somaCampo(metricas, 'impressions') ?? 0) : null;
  const cliques = temBase ? (somaCampo(metricas, 'clicks') ?? 0) : null;
  const leads = temBase ? (somaCampo(metricas, 'leads') ?? 0) : null;
  const conversoes = temBase ? (somaCampo(metricas, 'conversions') ?? 0) : null;
  const receita = temBase ? (somaCampo(metricas, 'revenueCents') ?? 0) : null;
  return {
    investimento,
    impressoes,
    cliques,
    leads,
    conversoes,
    ctr: razao(cliques, impressoes),
    cpc: razao(investimento, cliques),
    cpl: razao(investimento, leads),
    cpa: razao(investimento, conversoes),
    roas: receita !== null && receita > 0 ? razao(receita, investimento) : null,
  };
}

export function metricasPorCampanha(
  dados: Dados,
  filtros: Filtros,
  agora: Date = new Date(),
): MetricasPorCampanha {
  const intervalo = intervaloDoPeriodo(filtros.periodo, agora);
  const c = filtros.comparar;
  const campanhas = campanhasFiltradas(dados, filtros);
  const temBase = dados.metrics.length > 0;
  const leads = leadsFiltrados(dados, filtros);

  const linhaDe = (lista: readonly Campaign[]) => {
    const mAtual = metricasDe(dados, lista, intervalo);
    const mAntes = metricasDe(dados, lista, anterior(intervalo));
    const a = resumoDeMetricas(mAtual, temBase);
    const b = resumoDeMetricas(mAntes, temBase);
    const novosA = contagem(dados.leads, comCampanha(clientesNovos(leads, intervalo), lista));
    const novosB = contagem(dados.leads, comCampanha(clientesNovos(leads, anterior(intervalo)), lista));
    return {
      investimento: metrica(a.investimento, b.investimento, c),
      impressoes: metrica(a.impressoes, b.impressoes, c),
      cliques: metrica(a.cliques, b.cliques, c),
      ctr: metrica(a.ctr, b.ctr, c),
      cpc: metrica(a.cpc, b.cpc, c),
      leads: metrica(a.leads, b.leads, c),
      cpl: metrica(a.cpl, b.cpl, c),
      conversoes: metrica(a.conversoes, b.conversoes, c),
      cpa: metrica(a.cpa, b.cpa, c),
      roas: metrica(a.roas, b.roas, c),
      clientesNovos: metrica(novosA, novosB, c),
      custoPorClienteNovo: metrica(razao(a.investimento, novosA), razao(b.investimento, novosB), c),
      investimentoAtual: a.investimento,
    };
  };

  const linhas: LinhaCampanha[] = campanhas
    .map((campanha) => {
      const { investimentoAtual, ...resto } = linhaDe([campanha]);
      return { campanha, ...resto, usoDoTeto: razao(investimentoAtual, campanha.spendCapCents) };
    })
    .sort((x, y) => (y.investimento.atual ?? 0) - (x.investimento.atual ?? 0));

  const { investimentoAtual: _ignorado, ...totais } = linhaDe(campanhas);

  const porDia = new Map<string, { investimento: number; leads: number; cliques: number }>();
  for (const date of diasEntre(intervalo.inicio, intervalo.fim))
    porDia.set(date, { investimento: 0, leads: 0, cliques: 0 });
  for (const m of metricasDe(dados, campanhas, intervalo)) {
    const d = porDia.get(m.date);
    if (!d) continue;
    d.investimento += m.spendCents;
    d.leads += m.leads;
    d.cliques += m.clicks;
  }

  return {
    intervalo,
    linhas,
    totais,
    serie: [...porDia.entries()].map(([date, v]) => ({ date, ...v })),
  };
}

/* ---------- Humano × Claude ---------- */

export interface LinhaOperador {
  chave: string;
  rotulo: string;
  formato: Formato;
  humano: number | null;
  claude: number | null;
  /** (claude − humano) ÷ |humano|; null sem base. */
  diferenca: number | null;
  /** Para custo, menor é melhor: a tela inverte a cor do delta. */
  menorEhMelhor: boolean;
}

export interface PorOperador {
  intervalo: Intervalo;
  linhas: LinhaOperador[];
  porCanal: Array<{
    canal: Platform;
    humano: {
      investimento: number | null;
      leads: number | null;
      cpl: number | null;
      clientesNovos: number | null;
    };
    claude: {
      investimento: number | null;
      leads: number | null;
      cpl: number | null;
      clientesNovos: number | null;
    };
    diferencaCpl: number | null;
  }>;
}

export function porOperador(dados: Dados, filtros: Filtros, agora: Date = new Date()): PorOperador {
  const intervalo = intervaloDoPeriodo(filtros.periodo, agora);
  const temBase = dados.metrics.length > 0;
  const base = { ...filtros, operador: 'todos' as const };
  const todas = campanhasFiltradas(dados, base);
  const investimentoTotal = temBase
    ? (somaCampo(metricasDe(dados, todas, intervalo), 'spendCents') ?? 0)
    : null;

  const resumo = (operador: Operator, canal: Platform | null) => {
    const f: Filtros = { ...base, operador, canal: canal ?? base.canal };
    const campanhas = campanhasFiltradas(dados, f);
    const r = resumoDeMetricas(metricasDe(dados, campanhas, intervalo), temBase);
    const leads = leadsFiltrados(dados, f);
    const novos = contagem(dados.leads, comCampanha(clientesNovos(leads, intervalo), campanhas));
    const acoes = dados.actions.filter(
      (a) =>
        a.proposedBy === operador &&
        (f.marca === 'todas' || a.brandId === f.marca) &&
        (!f.canal || a.platform === f.canal),
    );
    const acoesDoPeriodo = filtrarPeriodo(acoes, 'createdAt', intervalo);
    return {
      ...r,
      parcelaDaVerba: razao(r.investimento, investimentoTotal),
      campanhasAtivas:
        dados.campaigns.length === 0 ? null : campanhas.filter((c) => c.status === 'active').length,
      clientesNovos: novos,
      custoPorClienteNovo: razao(r.investimento, novos),
      acoesPropostas: contagem(dados.actions, acoesDoPeriodo),
      acoesExecutadas: contagem(
        dados.actions,
        acoesDoPeriodo.filter((a) => a.status === 'done'),
      ),
    };
  };

  const h = resumo('human', null);
  const cl = resumo('claude', null);
  const linha = (
    chave: keyof typeof h,
    rotuloLinha: string,
    formato: Formato,
    menorEhMelhor = false,
  ): LinhaOperador => ({
    chave,
    rotulo: rotuloLinha,
    formato,
    humano: h[chave],
    claude: cl[chave],
    diferenca: diferenca(cl[chave], h[chave]),
    menorEhMelhor,
  });

  return {
    intervalo,
    linhas: [
      linha('investimento', 'Investimento', 'dinheiro'),
      linha('parcelaDaVerba', 'Parcela da verba', 'percentual'),
      linha('campanhasAtivas', 'Campanhas ativas', 'numero'),
      linha('leads', 'Leads', 'numero'),
      linha('cpl', 'Custo por lead', 'dinheiro', true),
      linha('conversoes', 'Conversões', 'numero'),
      linha('cpa', 'Custo por conversão', 'dinheiro', true),
      linha('roas', 'ROAS', 'decimal'),
      linha('clientesNovos', 'Clientes novos', 'numero'),
      linha('custoPorClienteNovo', 'Custo por cliente novo', 'dinheiro', true),
      linha('acoesPropostas', 'Ações propostas', 'numero'),
      linha('acoesExecutadas', 'Ações executadas', 'numero'),
    ],
    porCanal: (['meta', 'tiktok', 'google'] as Platform[])
      .filter((canal) => !filtros.canal || canal === filtros.canal)
      .map((canal) => {
        const a = resumo('human', canal);
        const b = resumo('claude', canal);
        const pegar = (r: typeof a) => ({
          investimento: r.investimento,
          leads: r.leads,
          cpl: r.cpl,
          clientesNovos: r.clientesNovos,
        });
        return { canal, humano: pegar(a), claude: pegar(b), diferencaCpl: diferenca(b.cpl, a.cpl) };
      }),
  };
}

/* ---------- Base de clientes ---------- */

export interface ClienteDaBase extends Customer {
  diasDesdeUltimaCompra: number | null;
  comprouNoPeriodo: boolean;
  reativado: boolean;
  receitaNoPeriodoCents: number;
}

export interface BaseDeClientes {
  intervalo: Intervalo;
  total: number | null;
  porSituacao: Array<{ situacao: Customer['situation']; total: number | null }>;
  ativos: number | null;
  inativosRecentes: number | null;
  inativosAntigos: number | null;
  perdidos: number | null;
  semSituacao: number | null;
  /** Clientes com 1º pedido antes do período. */
  antigos: number | null;
  recompraram: Metrica;
  taxaRecompra: Metrica;
  /** Antigos que voltaram a comprar depois de 90 dias ou mais sem pedido (na janela conhecida). */
  reativados: Metrica;
  receitaAntigos: Metrica;
  receitaNovos: Metrica;
  participacaoAntigos: Metrica;
  lista: ClienteDaBase[];
}

const DIAS_PARA_REATIVAR = 90;

export function baseDeClientes(dados: Dados, filtros: Filtros, agora: Date = new Date()): BaseDeClientes {
  const intervalo = intervaloDoPeriodo(filtros.periodo, agora);
  const hoje = diaSp(agora);
  const clientes = dados.customers.filter(
    (c) =>
      (filtros.marca === 'todas' || c.brands.includes(filtros.marca) || c.brands.length === 0) &&
      (!filtros.representante || c.repId === filtros.representante),
  );
  const pedidos = filtrarMarca(enviados(dados.orders), filtros.marca);
  const porCliente = new Map<string, typeof pedidos>();
  for (const p of pedidos) porCliente.set(p.customerId, [...(porCliente.get(p.customerId) ?? []), p]);
  // Dia do pedido mais antigo do conjunto (início da janela conhecida): calculado uma vez, fora do laço
  const primeiroPedidoConhecido = dados.orders.length
    ? diaSp(dados.orders.reduce((m, p) => (p.createdAt < m ? p.createdAt : m), dados.orders[0]!.createdAt))
    : null;

  const calcular = (janela: Janela) => {
    let recompraram = 0;
    let reativados = 0;
    let receitaAntigos = 0;
    let receitaNovos = 0;
    let antigos = 0;
    const lista: ClienteDaBase[] = [];
    for (const c of clientes) {
      const meus = (porCliente.get(c.id) ?? []).slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      const noPeriodo = filtrarPeriodo(meus, 'createdAt', janela);
      const antigo = c.firstOrderAt !== null && diaSp(c.firstOrderAt) < janela.inicio;
      const receita = noPeriodo.reduce((s, p) => s + p.totalCents, 0);
      const anteriores = meus.filter((p) => diaSp(p.createdAt) < janela.inicio);
      const ultimoAntes = anteriores.length ? diaSp(anteriores[anteriores.length - 1]!.createdAt) : null;
      let reativado = false;
      if (antigo && noPeriodo.length > 0) {
        recompraram += 1;
        const primeiroNoPeriodo = diaSp(noPeriodo[0]!.createdAt);
        const inicioConhecido = primeiroPedidoConhecido ?? janela.inicio;
        const gap = ultimoAntes
          ? diferencaEmDias(ultimoAntes, primeiroNoPeriodo)
          : diferencaEmDias(inicioConhecido, primeiroNoPeriodo);
        reativado = gap >= DIAS_PARA_REATIVAR;
        if (reativado) reativados += 1;
      }
      if (antigo) {
        antigos += 1;
        receitaAntigos += receita;
      } else {
        receitaNovos += receita;
      }
      lista.push({
        ...c,
        diasDesdeUltimaCompra: c.lastOrderAt ? diferencaEmDias(diaSp(c.lastOrderAt), hoje) : null,
        comprouNoPeriodo: noPeriodo.length > 0,
        reativado,
        receitaNoPeriodoCents: receita,
      });
    }
    const temBase = dados.customers.length > 0;
    return {
      antigos: temBase ? antigos : null,
      recompraram: temBase ? recompraram : null,
      taxaRecompra: razao(temBase ? recompraram : null, temBase ? antigos : null),
      reativados: temBase ? reativados : null,
      receitaAntigos: dados.orders.length ? receitaAntigos : null,
      receitaNovos: dados.orders.length ? receitaNovos : null,
      participacaoAntigos: razao(
        dados.orders.length ? receitaAntigos : null,
        dados.orders.length ? receitaAntigos + receitaNovos : null,
      ),
      lista,
    };
  };

  const a = calcular(intervalo);
  const b = calcular(anterior(intervalo));
  const c = filtros.comparar;
  const situacoes: Customer['situation'][] = [
    'active',
    'inactive_recent',
    'inactive_old',
    'lost',
    'lead',
    null,
  ];
  const contar = (s: Customer['situation']) =>
    contagem(
      dados.customers,
      clientes.filter((x) => x.situation === s),
    );

  return {
    intervalo,
    total: contagem(dados.customers, clientes),
    porSituacao: situacoes.map((situacao) => ({ situacao, total: contar(situacao) })),
    ativos: contar('active'),
    inativosRecentes: contar('inactive_recent'),
    inativosAntigos: contar('inactive_old'),
    perdidos: contar('lost'),
    semSituacao: contar(null),
    antigos: a.antigos,
    recompraram: metrica(a.recompraram, b.recompraram, c),
    taxaRecompra: metrica(a.taxaRecompra, b.taxaRecompra, c),
    reativados: metrica(a.reativados, b.reativados, c),
    receitaAntigos: metrica(a.receitaAntigos, b.receitaAntigos, c),
    receitaNovos: metrica(a.receitaNovos, b.receitaNovos, c),
    participacaoAntigos: metrica(a.participacaoAntigos, b.participacaoAntigos, c),
    lista: a.lista.sort((x, y) => (y.diasDesdeUltimaCompra ?? -1) - (x.diasDesdeUltimaCompra ?? -1)),
  };
}

/* ---------- Leads por origem ---------- */

export interface LeadDaLista {
  id: string;
  code: string;
  origem: LeadSource;
  marca: Brand | null;
  etapa: LeadStage;
  criadoEm: string;
  representante: string | null;
  /** Link para a ficha 360 no CSP 360 (sem dado pessoal aqui). */
  linkCrm: string | null;
}

export interface LeadsPorOrigem {
  intervalo: Intervalo;
  total: Metrica;
  semMarca: number | null;
  linhas: Array<{
    origem: LeadSource;
    leads: Metrica;
    clientesNovos: number | null;
    taxaConversao: number | null;
    custoPorLead: number | null;
  }>;
  porDia: Array<{ date: string; total: number; porOrigem: Partial<Record<LeadSource, number>> }>;
  lista: LeadDaLista[];
}

const URL_CRM = 'https://csp360.example/clientes';

export function leadsPorOrigem(dados: Dados, filtros: Filtros, agora: Date = new Date()): LeadsPorOrigem {
  const intervalo = intervaloDoPeriodo(filtros.periodo, agora);
  const leads = leadsFiltrados(dados, filtros);
  const doPeriodo = filtrarPeriodo(leads, 'createdAt', intervalo);
  const doAnterior = filtrarPeriodo(leads, 'createdAt', anterior(intervalo));
  const campanhas = campanhasFiltradas(dados, filtros);
  const investimentoPorCanal = new Map<Platform, number>();
  for (const m of metricasDe(dados, campanhas, intervalo)) {
    investimentoPorCanal.set(m.platform, (investimentoPorCanal.get(m.platform) ?? 0) + m.spendCents);
  }

  const origens = [...new Set([...doPeriodo, ...doAnterior].map((l) => l.source))];
  const linhas = origens
    .map((origem) => {
      const grupo = doPeriodo.filter((l) => l.source === origem);
      const grupoAntes = doAnterior.filter((l) => l.source === origem);
      const novos = grupo.filter(chegouAoPedido);
      const pago = CANAIS_PAGOS.includes(origem);
      return {
        origem,
        leads: metrica(contagem(dados.leads, grupo), contagem(dados.leads, grupoAntes), filtros.comparar),
        clientesNovos: contagem(dados.leads, novos),
        taxaConversao: razao(novos.length, grupo.length),
        custoPorLead: pago ? razao(investimentoPorCanal.get(origem as Platform) ?? null, grupo.length) : null,
      };
    })
    .sort((x, y) => (y.leads.atual ?? 0) - (x.leads.atual ?? 0));

  const porDia = diasEntre(intervalo.inicio, intervalo.fim).map((date) => {
    const doDia = doPeriodo.filter((l) => diaSp(l.createdAt) === date);
    const porOrigem: Partial<Record<LeadSource, number>> = {};
    for (const l of doDia) porOrigem[l.source] = (porOrigem[l.source] ?? 0) + 1;
    return { date, total: doDia.length, porOrigem };
  });

  return {
    intervalo,
    total: metrica(contagem(dados.leads, doPeriodo), contagem(dados.leads, doAnterior), filtros.comparar),
    semMarca: contagem(
      dados.leads,
      doPeriodo.filter((l) => l.brandId === null),
    ),
    linhas,
    porDia,
    lista: doPeriodo
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 200)
      .map((l) => ({
        id: l.id,
        code: l.code,
        origem: l.source,
        marca: l.brandId,
        etapa: l.stage,
        criadoEm: l.createdAt,
        representante: l.repId,
        linkCrm: l.crmCustomerId ? `${URL_CRM}/${l.crmCustomerId}` : null,
      })),
  };
}

/* ---------- Instagram ---------- */

export interface InstagramPorMarca {
  marca: Brand;
  seguidores: number | null;
  /** Seguidores ganhos no período (último dia − dia anterior ao início). */
  variacaoSeguidores: Metrica;
  alcance: Metrica;
  impressoes: Metrica;
  engajamento: Metrica;
  taxaEngajamento: Metrica;
  salvos: Metrica;
  posts: number | null;
}

export interface Instagram {
  intervalo: Intervalo;
  porMarca: InstagramPorMarca[];
  serie: Array<{
    date: string;
    porMarca: Partial<
      Record<Brand, { followers: number; reach: number; impressions: number; engagement: number }>
    >;
  }>;
  posts: IgMedia[];
}

export function instagram(dados: Dados, filtros: Filtros, agora: Date = new Date()): Instagram {
  const intervalo = intervaloDoPeriodo(filtros.periodo, agora);
  const c = filtros.comparar;
  const marcas: Brand[] = filtros.marca === 'todas' ? ['cs', 'plumene'] : [filtros.marca];
  const temBase = dados.igDaily.length > 0;

  const porMarca = marcas.map((marca): InstagramPorMarca => {
    const diario = dados.igDaily
      .filter((d) => d.brandId === marca)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const resumo = (janela: Janela) => {
      const linhas = filtrarPeriodo(diario, 'date', janela);
      const antesDaJanela = diario.filter((d) => d.date < janela.inicio);
      const ultimo = linhas[linhas.length - 1];
      const primeiroAntes = antesDaJanela[antesDaJanela.length - 1] ?? linhas[0];
      const alcance = temBase ? (somaCampo(linhas, 'reach') ?? 0) : null;
      const engajamento = temBase ? (somaCampo(linhas, 'engagement') ?? 0) : null;
      const posts = filtrarPeriodo(
        dados.igMedia.filter((p) => p.brandId === marca),
        'publishedAt',
        janela,
      );
      return {
        seguidores: ultimo ? ultimo.followers : null,
        variacao: ultimo && primeiroAntes ? ultimo.followers - primeiroAntes.followers : null,
        alcance,
        impressoes: temBase ? (somaCampo(linhas, 'impressions') ?? 0) : null,
        engajamento,
        taxa: razao(engajamento, alcance),
        salvos: dados.igMedia.length ? (somaCampo(posts, 'saves') ?? 0) : null,
        posts: contagem(dados.igMedia, posts),
      };
    };
    const a = resumo(intervalo);
    const b = resumo(anterior(intervalo));
    return {
      marca,
      seguidores: a.seguidores,
      variacaoSeguidores: metrica(a.variacao, b.variacao, c),
      alcance: metrica(a.alcance, b.alcance, c),
      impressoes: metrica(a.impressoes, b.impressoes, c),
      engajamento: metrica(a.engajamento, b.engajamento, c),
      taxaEngajamento: metrica(a.taxa, b.taxa, c),
      salvos: metrica(a.salvos, b.salvos, c),
      posts: a.posts,
    };
  });

  const serie = diasEntre(intervalo.inicio, intervalo.fim).map((date) => {
    const porMarcaDia: Instagram['serie'][number]['porMarca'] = {};
    for (const d of dados.igDaily) {
      if (d.date === date && marcas.includes(d.brandId)) {
        porMarcaDia[d.brandId] = {
          followers: d.followers,
          reach: d.reach,
          impressions: d.impressions,
          engagement: d.engagement,
        };
      }
    }
    return { date, porMarca: porMarcaDia };
  });

  return {
    intervalo,
    porMarca,
    serie,
    posts: filtrarPeriodo(
      dados.igMedia.filter((p) => marcas.includes(p.brandId)),
      'publishedAt',
      intervalo,
    ).sort((a, b) => b.reach - a.reach),
  };
}

/* ---------- SEO e GEO ---------- */

export interface SeoGeo {
  intervalo: Intervalo;
  seo: {
    impressoes: Metrica;
    cliques: Metrica;
    ctr: Metrica;
    posicaoMedia: Metrica;
    serie: Array<{ date: string; impressions: number; clicks: number; position: number | null }>;
  };
  geo: {
    sessoes: Metrica;
    leadsPorAssistente: Metrica;
    clientesNovosPorAssistente: number | null;
    porFonte: Array<{ fonte: GeoSource; sessoes: Metrica; leads: Metrica }>;
    serie: Array<{ date: string; porFonte: Partial<Record<GeoSource, number>> }>;
  };
}

export function seoGeo(dados: Dados, filtros: Filtros, agora: Date = new Date()): SeoGeo {
  const intervalo = intervaloDoPeriodo(filtros.periodo, agora);
  const c = filtros.comparar;
  const seoTodas = filtrarMarca(dados.seoDaily, filtros.marca);
  const geoTodas = filtrarMarca(dados.geoDaily, filtros.marca);
  const temSeo = dados.seoDaily.length > 0;
  const temGeo = dados.geoDaily.length > 0;

  const seoDe = (janela: Janela) => {
    const linhas = filtrarPeriodo(seoTodas, 'date', janela);
    const impressoes = temSeo ? (somaCampo(linhas, 'impressions') ?? 0) : null;
    const cliques = temSeo ? (somaCampo(linhas, 'clicks') ?? 0) : null;
    // Média ponderada pelas impressões; sem impressões no período não há posição ("Sem dados", nunca 0)
    const posicao = razao(
      linhas.length ? linhas.reduce((s, l) => s + l.position * l.impressions, 0) : null,
      impressoes,
    );
    return { impressoes, cliques, ctr: razao(cliques, impressoes), posicao };
  };
  const sa = seoDe(intervalo);
  const sb = seoDe(anterior(intervalo));

  const geoDe = (janela: Janela) => {
    const linhas = filtrarPeriodo(geoTodas, 'date', janela);
    return {
      sessoes: temGeo ? (somaCampo(linhas, 'sessions') ?? 0) : null,
      porFonte: (['chatgpt', 'perplexity', 'claude', 'gemini', 'copilot'] as GeoSource[]).map((fonte) => {
        const f = linhas.filter((l) => l.source === fonte);
        return {
          fonte,
          sessoes: temGeo ? (somaCampo(f, 'sessions') ?? 0) : null,
          leads: temGeo ? (somaCampo(f, 'leads') ?? 0) : null,
        };
      }),
    };
  };
  const ga = geoDe(intervalo);
  const gb = geoDe(anterior(intervalo));

  const leadsIa = leadsFiltrados(dados, { ...filtros, origem: 'ai_assistant' });
  const leadsIaAtual = filtrarPeriodo(leadsIa, 'createdAt', intervalo);
  const leadsIaAntes = filtrarPeriodo(leadsIa, 'createdAt', anterior(intervalo));

  const dias = diasEntre(intervalo.inicio, intervalo.fim);
  return {
    intervalo,
    seo: {
      impressoes: metrica(sa.impressoes, sb.impressoes, c),
      cliques: metrica(sa.cliques, sb.cliques, c),
      ctr: metrica(sa.ctr, sb.ctr, c),
      posicaoMedia: metrica(sa.posicao, sb.posicao, c),
      serie: dias.map((date) => {
        const doDia = seoTodas.filter((l) => l.date === date);
        const impressions = doDia.reduce((s, l) => s + l.impressions, 0);
        return {
          date,
          impressions,
          clicks: doDia.reduce((s, l) => s + l.clicks, 0),
          position: doDia.length ? doDia.reduce((s, l) => s + l.position, 0) / doDia.length : null,
        };
      }),
    },
    geo: {
      sessoes: metrica(ga.sessoes, gb.sessoes, c),
      leadsPorAssistente: metrica(
        contagem(dados.leads, leadsIaAtual),
        contagem(dados.leads, leadsIaAntes),
        c,
      ),
      clientesNovosPorAssistente: contagem(dados.leads, clientesNovos(leadsIa, intervalo)),
      porFonte: ga.porFonte.map((f, i) => ({
        fonte: f.fonte,
        sessoes: metrica(f.sessoes, gb.porFonte[i]?.sessoes ?? null, c),
        leads: metrica(f.leads, gb.porFonte[i]?.leads ?? null, c),
      })),
      serie: dias.map((date) => {
        const porFonte: Partial<Record<GeoSource, number>> = {};
        for (const l of geoTodas)
          if (l.date === date) porFonte[l.source] = (porFonte[l.source] ?? 0) + l.sessions;
        return { date, porFonte };
      }),
    },
  };
}

/* ---------- Tráfego com IA ---------- */

export interface Acoes {
  intervalo: Intervalo;
  /** Todas as ações que passam pelos filtros, mais novas primeiro. */
  lista: TrafficAction[];
  porStatus: Record<ActionStatus, number | null>;
  /** Propostas esperando decisão. */
  filaDeAprovacao: TrafficAction[];
  emExecucao: TrafficAction[];
  pendencias: TrafficAction[];
  resumo: {
    propostas: number | null;
    aprovadas: number | null;
    executadas: number | null;
    descartadas: number | null;
    tempoMedioAteAprovacaoHoras: number | null;
    custoEstimadoDaFilaCents: number | null;
  };
  /** Verba e teto por marca e canal, com o investimento do período. */
  tetos: Array<{
    marca: Brand;
    canal: Platform;
    investimento: number | null;
    teto: number | null;
    uso: number | null;
    campanhasAtivas: number | null;
  }>;
}

export function acoes(dados: Dados, filtros: Filtros, agora: Date = new Date()): Acoes {
  const intervalo = intervaloDoPeriodo(filtros.periodo, agora);
  const campanhas = porId(dados.campaigns);
  const lista = dados.actions
    .filter(
      (a) =>
        (filtros.marca === 'todas' || a.brandId === filtros.marca) &&
        (!filtros.canal || a.platform === filtros.canal) &&
        (filtros.operador === 'todos' || a.proposedBy === filtros.operador) &&
        (!filtros.campanha ||
          a.campaignId === filtros.campanha ||
          campanhas.get(a.campaignId ?? '')?.utmCampaign === filtros.campanha),
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const temBase = dados.actions.length > 0;
  const contar = (f: (a: TrafficAction) => boolean) => (temBase ? lista.filter(f).length : null);
  const statuses: ActionStatus[] = ['idea', 'failed', 'approved', 'running', 'done', 'discarded'];
  const aprovadas = lista.filter((a) => a.approvedAt !== null);
  const horas = aprovadas.map(
    (a) => (new Date(a.approvedAt as string).getTime() - new Date(a.createdAt).getTime()) / 3_600_000,
  );
  const fila = lista.filter((a) => a.status === 'idea' && a.kind !== 'pending_fix');

  const marcas: Brand[] = filtros.marca === 'todas' ? ['cs', 'plumene'] : [filtros.marca];
  const canais: Platform[] = filtros.canal ? [filtros.canal] : ['meta', 'tiktok', 'google'];
  const tetos = marcas.flatMap((marca) =>
    canais.map((canal) => {
      const ativas = dados.campaigns.filter(
        (c) => c.brandId === marca && c.platform === canal && c.status === 'active',
      );
      const investimento = dados.metrics.length
        ? (somaCampo(metricasDe(dados, ativas, intervalo), 'spendCents') ?? 0)
        : null;
      const teto = dados.campaigns.length ? (somaCampo(ativas, 'spendCapCents') ?? 0) : null;
      return {
        marca,
        canal,
        investimento,
        teto,
        uso: razao(investimento, teto),
        campanhasAtivas: contagem(dados.campaigns, ativas),
      };
    }),
  );

  return {
    intervalo,
    lista,
    porStatus: Object.fromEntries(statuses.map((s) => [s, contar((a) => a.status === s)])) as Record<
      ActionStatus,
      number | null
    >,
    filaDeAprovacao: fila,
    emExecucao: lista.filter((a) => a.status === 'running'),
    pendencias: lista.filter(
      (a) => a.kind === 'pending_fix' && a.status !== 'done' && a.status !== 'discarded',
    ),
    resumo: {
      propostas: contar(() => true),
      aprovadas: contar((a) => a.approvedAt !== null),
      executadas: contar((a) => a.status === 'done'),
      descartadas: contar((a) => a.status === 'discarded'),
      tempoMedioAteAprovacaoHoras: horas.length ? horas.reduce((x, y) => x + y, 0) / horas.length : null,
      custoEstimadoDaFilaCents: fila.length ? soma(fila.map((a) => a.costCents)) : null,
    },
    tetos,
  };
}

/* ---------- Conectores ---------- */

export interface ConectorComAtraso extends Connector {
  minutosDesdeSync: number | null;
  /** Minutos além do esperado; 0 quando está em dia; null sem sincronização. */
  atrasoMinutos: number | null;
  atrasado: boolean;
}

export interface Conectores {
  lista: ConectorComAtraso[];
  resumo: Record<Connector['status'], number | null>;
  /** Última sincronização entre todos, para o "atualizado há X min" da tela. */
  ultimaSincronizacao: string | null;
}

export function conectores(dados: Dados, agora: Date = new Date()): Conectores {
  const lista = dados.connectors.map((c): ConectorComAtraso => {
    const minutos = c.lastSyncAt
      ? Math.max(0, Math.round((agora.getTime() - new Date(c.lastSyncAt).getTime()) / 60_000))
      : null;
    const atraso = minutos === null ? null : Math.max(0, minutos - c.expectedEveryMinutes);
    return {
      ...c,
      minutosDesdeSync: minutos,
      atrasoMinutos: atraso,
      atrasado: c.status === 'late' || (atraso !== null && atraso > 0),
    };
  });
  const temBase = dados.connectors.length > 0;
  const contar = (s: Connector['status']) => (temBase ? lista.filter((c) => c.status === s).length : null);
  const datas = lista
    .map((c) => c.lastSyncAt)
    .filter((d): d is string => d !== null)
    .sort();
  return {
    lista,
    resumo: {
      ok: contar('ok'),
      late: contar('late'),
      down: contar('down'),
      not_connected: contar('not_connected'),
      disabled: contar('disabled'),
    },
    ultimaSincronizacao: datas[datas.length - 1] ?? null,
  };
}

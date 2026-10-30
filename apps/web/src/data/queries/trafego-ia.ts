/**
 * Tráfego com IA (rota /trafego): a fila de aprovação, a lista "O que podemos fazer", os limites de
 * gasto por conta, a estratégia por marca, o diário de ações e Humano × Claude.
 *
 * Pura, como as outras consultas: vira views e funções SQL na fase 3 (`kpi_trafego_*`) sobre
 * `traffic_actions`, `campaigns`, as métricas diárias, a estratégia (`traffic_strategies`) e o diário
 * (`traffic_log`). Reaproveita `acoes`, `porOperador` e `custoPorClienteNovo` de `queries.ts`, para a
 * fila e os números baterem com a Visão geral e as telas de canal.
 *
 * Convenções desta tela:
 * - A fila de aprovação é a de `acoes().filaDeAprovacao`: ideia que não é pendência de medição.
 * - Limite de gasto e verba são do **mês corrente até hoje**, qualquer que seja o período escolhido. O
 *   limite da conta (marca × canal) é a soma dos `spendCapCents` das campanhas ativas, como em
 *   `acoes().tetos`; o gasto da conta conta todas as campanhas dela.
 * - O que o conjunto de dados ainda não guarda (estratégia, mudança de limite, parar tudo, hora e autor
 *   do descarte) vem do `Registro` da tela. Registro de outro conjunto (depois do "Recomeçar" ou em
 *   `?estado=sem-dados`) é ignorado.
 * - Métrica sem base é null ("Sem dados"); contagem sobre tabela vazia é null; com linhas, 0 ou mais.
 */

import type {
  ActionStatus,
  Brand,
  CampaignStatus,
  Level,
  Operator,
  Platform,
  Profile,
  TrafficAction,
} from '@csp-mkt/shared';
import { rotulo, rotuloMarca } from '@csp-mkt/shared';
import { diaSp, diferencaEmDias, fimDoMes, inicioDoMes } from '../../lib/datas';
import { dinheiro, plural } from '../../lib/format';
import type { Intervalo } from '../../lib/periodo';
import type { Filtros, Marca } from '../../lib/url-state';
import type { Dados } from '../dados';
import {
  acoes,
  custoPorClienteNovo,
  filtrarPeriodo,
  metrica,
  porOperador,
  razao,
  type Janela,
  type Metrica,
  type PorOperador,
} from '../queries';

/* ---------- Listas e ordem ---------- */

export const MARCAS: readonly Brand[] = ['cs', 'plumene'];
export const CANAIS: readonly Platform[] = ['meta', 'tiktok', 'google'];
/** Ordem dos chips de status e da lista: o que pede ação primeiro. */
export const STATUS_DA_LISTA: readonly ActionStatus[] = ['idea', 'approved', 'running', 'done', 'discarded'];
export const NIVEIS: readonly Level[] = ['low', 'medium', 'high'];

/** Quantos registros o diário mostra de cada vez. */
export const LIMITE_DO_DIARIO = 20;
/** A lista "O que podemos fazer" mostra no máximo isto (o resto pede filtro). */
export const MAXIMO_DA_LISTA = 200;

const PESO: Record<Level, number> = { low: 1, medium: 2, high: 3 };
const ORDEM_DO_STATUS: Record<ActionStatus, number> = {
  idea: 0,
  approved: 1,
  running: 2,
  done: 3,
  discarded: 4,
};

function maisAntigaPrimeiro(a: TrafficAction, b: TrafficAction): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/** Fila de aprovação: maior impacto, depois menor esforço, depois a que espera há mais tempo. */
export function ordemDaFila(a: TrafficAction, b: TrafficAction): number {
  return PESO[b.impact] - PESO[a.impact] || PESO[a.effort] - PESO[b.effort] || maisAntigaPrimeiro(a, b);
}

/** Lista: por status (ideia, aprovada, em execução, feita, descartada), prioridade e a mais nova. */
export function ordemDaLista(a: TrafficAction, b: TrafficAction): number {
  return (
    ORDEM_DO_STATUS[a.status] - ORDEM_DO_STATUS[b.status] ||
    PESO[b.impact] - PESO[a.impact] ||
    PESO[a.effort] - PESO[b.effort] ||
    maisAntigaPrimeiro(b, a)
  );
}

/* ---------- Filtros só da lista (na URL da tela, fora de `Filtros`) ---------- */

export interface FiltrosDaLista {
  status: ActionStatus | null;
  impacto: Level | null;
  esforco: Level | null;
}

export const FILTROS_DA_LISTA_PADRAO: Readonly<FiltrosDaLista> = {
  status: null,
  impacto: null,
  esforco: null,
};

/* ---------- Registro da tela: o que o conjunto de dados ainda não guarda ---------- */

export interface EstrategiaDaMarca {
  /** Texto livre do humano; o Claude lê antes de propor (nunca com dado pessoal). */
  texto: string;
  verbaDoMesCents: number | null;
  metaCustoPorClienteNovoCents: number | null;
  metaCustoPorLeadCents: number | null;
  metaClientesNovos: number | null;
  atualizadaEm: string;
  /** `profiles.id` de quem salvou. */
  atualizadaPor: string;
}

interface RegistroBase {
  id: string;
  em: string;
  /** `profiles.id` de quem fez. */
  por: string;
}

export type RegistroDoDiario =
  | (RegistroBase & { tipo: 'estrategia'; marca: Brand })
  | (RegistroBase & {
      tipo: 'limite';
      marca: Brand;
      canal: Platform;
      deCents: number | null;
      paraCents: number;
    })
  | (RegistroBase & { tipo: 'parar_tudo'; marca: Marca; campanhas: string[] })
  | (RegistroBase & { tipo: 'reativar'; marca: Marca; campanhas: string[]; paradaId: string })
  | (RegistroBase & { tipo: 'descarte'; acaoId: string; motivo: string });

export interface Registro {
  /** `geradoEm` do conjunto de dados a que o registro pertence. */
  base: string | null;
  estrategias: Partial<Record<Brand, EstrategiaDaMarca>>;
  eventos: RegistroDoDiario[];
}

export const REGISTRO_VAZIO: Registro = { base: null, estrategias: {}, eventos: [] };

/** O registro vale só para o conjunto em que foi feito. */
export function registroDoConjunto(dados: Dados, registro: Registro): Registro {
  return registro.base === dados.geradoEm ? registro : REGISTRO_VAZIO;
}

/* ---------- Mês corrente e ritmo de gasto ---------- */

export interface MesCorrente {
  inicio: string;
  hoje: string;
  fim: string;
  /** Dias do mês até hoje, com hoje (1 no dia 1). */
  diasDecorridos: number;
  diasNoMes: number;
}

export function mesCorrente(agora: Date): MesCorrente {
  const hoje = diaSp(agora);
  const inicio = inicioDoMes(hoje);
  const fim = fimDoMes(hoje);
  return {
    inicio,
    hoje,
    fim,
    diasDecorridos: diferencaEmDias(inicio, hoje) + 1,
    diasNoMes: diferencaEmDias(inicio, fim) + 1,
  };
}

export type SituacaoDoGasto = 'acima' | 'vai_passar' | 'no_ritmo';

export interface RitmoDoGasto {
  /** gasto ÷ teto. */
  uso: number | null;
  /** Onde o gasto estaria hoje num ritmo uniforme até o teto no fim do mês. */
  esperadoHoje: number | null;
  /** Gasto no fim do mês se o ritmo de até hoje continuar. */
  projecao: number | null;
  situacao: SituacaoDoGasto | null;
}

/** Gasto do mês até hoje contra um teto do mês (limite da conta ou verba da marca). */
export function ritmoDoGasto(gasto: number | null, teto: number | null, mes: MesCorrente): RitmoDoGasto {
  const projecao = gasto === null ? null : Math.round((gasto / mes.diasDecorridos) * mes.diasNoMes);
  const esperadoHoje = teto === null ? null : Math.round((teto * mes.diasDecorridos) / mes.diasNoMes);
  const situacao: SituacaoDoGasto | null =
    gasto === null || teto === null
      ? null
      : gasto >= teto
        ? 'acima'
        : projecao !== null && projecao > teto
          ? 'vai_passar'
          : 'no_ritmo';
  return { uso: razao(gasto, teto), esperadoHoje, projecao, situacao };
}

/* ---------- Contas (marca × canal) ---------- */

export interface ContaDoTrafego extends RitmoDoGasto {
  marca: Brand;
  canal: Platform;
  /** Gasto de todas as campanhas da conta no mês, até hoje. */
  gastoNoMes: number | null;
  /** Soma dos limites das campanhas ativas; null sem campanha ativa. */
  limite: number | null;
  campanhasAtivas: number | null;
  ativasDoClaude: number | null;
  /** Soma dos orçamentos diários das campanhas ativas. */
  orcamentoDiario: number | null;
}

function contaDe(dados: Dados, marca: Brand, canal: Platform, mes: MesCorrente): ContaDoTrafego {
  const temCampanhas = dados.campaigns.length > 0;
  const ativas = dados.campaigns.filter(
    (c) => c.brandId === marca && c.platform === canal && c.status === 'active',
  );
  let gasto: number | null = null;
  if (dados.metrics.length > 0) {
    gasto = 0;
    for (const m of dados.metrics) {
      if (m.brandId === marca && m.platform === canal && m.date >= mes.inicio && m.date <= mes.hoje)
        gasto += m.spendCents;
    }
  }
  const limite = ativas.length ? ativas.reduce((total, c) => total + c.spendCapCents, 0) : null;
  return {
    marca,
    canal,
    gastoNoMes: gasto,
    limite,
    ...ritmoDoGasto(gasto, limite, mes),
    campanhasAtivas: temCampanhas ? ativas.length : null,
    ativasDoClaude: temCampanhas ? ativas.filter((c) => c.managedBy === 'claude').length : null,
    orcamentoDiario: temCampanhas ? ativas.reduce((total, c) => total + c.dailyBudgetCents, 0) : null,
  };
}

/** Contas da marca e do canal escolhidos ("As duas" = as duas marcas), no mês corrente. */
export function contasDoTrafego(dados: Dados, filtros: Filtros, agora: Date = new Date()): ContaDoTrafego[] {
  const mes = mesCorrente(agora);
  const marcas = filtros.marca === 'todas' ? MARCAS : [filtros.marca];
  const canais = filtros.canal ? [filtros.canal] : CANAIS;
  return marcas.flatMap((marca) => canais.map((canal) => contaDe(dados, marca, canal, mes)));
}

/* ---------- Itens da fila e da lista ---------- */

export interface ItemDeAcao extends TrafficAction {
  /** Campanha da ação; null quando não há (campanha nova, pendência de medição). */
  campanha: { nome: string; status: CampaignStatus } | null;
  /** O que impede ou pede cuidado ao executar; null quando nada. */
  alerta: string | null;
  /** Gasto do mês e limite da conta da ação (marca × canal); null sem canal. */
  conta: { gastoNoMes: number | null; limite: number | null } | null;
}

function alertaDe(
  acao: TrafficAction,
  campanha: ItemDeAcao['campanha'],
  conta: ItemDeAcao['conta'],
): string | null {
  if (acao.status === 'done' || acao.status === 'discarded') return null;
  if (campanha?.status === 'ended') return 'A campanha está encerrada: não há o que executar nela.';
  if (acao.kind === 'pause' && campanha?.status === 'paused') return 'A campanha já está pausada.';
  if (
    (acao.kind === 'budget' || acao.kind === 'bid' || acao.kind === 'creative') &&
    campanha?.status === 'paused'
  )
    return 'A campanha está pausada: a mudança só vale quando ela voltar.';
  if (
    acao.costCents !== null &&
    acao.costCents > 0 &&
    conta?.limite != null &&
    conta.gastoNoMes != null &&
    conta.gastoNoMes + acao.costCents > conta.limite
  )
    return `Com o custo estimado, a conta passa do limite do mês: já gastou ${dinheiro(conta.gastoNoMes)} de ${dinheiro(conta.limite)}.`;
  return null;
}

function itensDe(dados: Dados, contas: Map<string, ContaDoTrafego>) {
  const campanhas = new Map(dados.campaigns.map((c) => [c.id, c]));
  return (acao: TrafficAction): ItemDeAcao => {
    const c = acao.campaignId ? campanhas.get(acao.campaignId) : undefined;
    const campanha = c ? { nome: c.name, status: c.status } : null;
    const daConta = acao.platform ? contas.get(`${acao.brandId}:${acao.platform}`) : undefined;
    const conta = daConta ? { gastoNoMes: daConta.gastoNoMes, limite: daConta.limite } : null;
    return { ...acao, campanha, conta, alerta: alertaDe(acao, campanha, conta) };
  };
}

/* ---------- Estratégia por marca ---------- */

export type TomDaSituacao = 'success' | 'warning' | 'danger';

export interface LinhaDaMeta {
  chave: 'verba' | 'custoPorClienteNovo' | 'custoPorLead' | 'clientesNovos';
  rotulo: string;
  formato: 'dinheiro' | 'numero';
  /** null = "A definir" (o humano ainda não fixou). */
  meta: number | null;
  /** No mês até hoje; null = "Sem dados". */
  atual: number | null;
  situacao: { texto: string; tom: TomDaSituacao } | null;
}

export interface EstrategiaComNumeros {
  marca: Brand;
  estrategia: EstrategiaDaMarca | null;
  /** Nome de quem salvou por último. */
  atualizadaPor: string | null;
  investidoNoMes: number | null;
  /** Soma dos orçamentos diários das campanhas ativas da marca: ajuda a fixar a verba. */
  orcamentoDiarioAtivas: number | null;
  verba: RitmoDoGasto;
  metas: LinhaDaMeta[];
}

const SITUACAO_DA_VERBA: Record<SituacaoDoGasto, { texto: string; tom: TomDaSituacao }> = {
  acima: { texto: 'Passou da verba', tom: 'danger' },
  vai_passar: { texto: 'Vai passar da verba', tom: 'warning' },
  no_ritmo: { texto: 'Dentro da verba', tom: 'success' },
};

/** Custo: até a meta está dentro; acima dela pede atenção. */
export function situacaoDoCusto(meta: number | null, atual: number | null): LinhaDaMeta['situacao'] {
  if (meta === null || atual === null) return null;
  return atual <= meta
    ? { texto: 'Dentro da meta', tom: 'success' }
    : { texto: 'Acima da meta', tom: 'warning' };
}

/** Clientes novos: compara com a parte da meta que já deveria ter chegado até hoje. */
export function situacaoDosClientes(
  meta: number | null,
  atual: number | null,
  mes: MesCorrente,
): LinhaDaMeta['situacao'] {
  if (meta === null || atual === null || meta <= 0) return null;
  if (atual >= meta) return { texto: 'Meta batida', tom: 'success' };
  const ateHoje = (meta * mes.diasDecorridos) / mes.diasNoMes;
  return atual >= ateHoje
    ? { texto: 'No ritmo da meta', tom: 'success' }
    : { texto: 'Abaixo do ritmo', tom: 'warning' };
}

function nomeDoPerfil(perfis: readonly Profile[]) {
  const nomes = new Map(perfis.map((p) => [p.id, p.name]));
  return (id: string | null): string | null => (id ? (nomes.get(id) ?? 'Usuário sem cadastro') : null);
}

function estrategiasDe(
  dados: Dados,
  filtros: Filtros,
  agora: Date,
  mes: MesCorrente,
  reg: Registro,
): EstrategiaComNumeros[] {
  const nome = nomeDoPerfil(dados.profiles);
  // Números do mês corrente por marca, com a mesma conta da Visão geral (custo por cliente novo atribuído)
  const doMes = custoPorClienteNovo(
    dados,
    {
      ...filtros,
      periodo: 'este-mes',
      comparar: false,
      canal: null,
      campanha: null,
      operador: 'todos',
      origem: null,
      representante: null,
    },
    agora,
  );
  return doMes.porMarca.flatMap((linha) => {
    const marca = linha.marca;
    if (!marca) return [];
    const estrategia = reg.estrategias[marca] ?? null;
    const investido = linha.investimento.atual;
    const ativas = dados.campaigns.filter((c) => c.brandId === marca && c.status === 'active');
    const verba = ritmoDoGasto(investido, estrategia?.verbaDoMesCents ?? null, mes);
    const metas: LinhaDaMeta[] = [
      {
        chave: 'verba',
        rotulo: 'Verba do mês',
        formato: 'dinheiro',
        meta: estrategia?.verbaDoMesCents ?? null,
        atual: investido,
        situacao: verba.situacao ? SITUACAO_DA_VERBA[verba.situacao] : null,
      },
      {
        chave: 'custoPorClienteNovo',
        rotulo: 'Custo por cliente novo',
        formato: 'dinheiro',
        meta: estrategia?.metaCustoPorClienteNovoCents ?? null,
        atual: linha.custo.atual,
        situacao: situacaoDoCusto(estrategia?.metaCustoPorClienteNovoCents ?? null, linha.custo.atual),
      },
      {
        chave: 'custoPorLead',
        rotulo: 'Custo por lead',
        formato: 'dinheiro',
        meta: estrategia?.metaCustoPorLeadCents ?? null,
        atual: linha.custoPorLead.atual,
        situacao: situacaoDoCusto(estrategia?.metaCustoPorLeadCents ?? null, linha.custoPorLead.atual),
      },
      {
        chave: 'clientesNovos',
        rotulo: 'Clientes novos',
        formato: 'numero',
        meta: estrategia?.metaClientesNovos ?? null,
        atual: linha.clientesNovos.atual,
        situacao: situacaoDosClientes(estrategia?.metaClientesNovos ?? null, linha.clientesNovos.atual, mes),
      },
    ];
    return [
      {
        marca,
        estrategia,
        atualizadaPor: estrategia ? nome(estrategia.atualizadaPor) : null,
        investidoNoMes: investido,
        orcamentoDiarioAtivas:
          dados.campaigns.length === 0 ? null : ativas.reduce((t, c) => t + c.dailyBudgetCents, 0),
        verba,
        metas,
      },
    ];
  });
}

/* ---------- Diário de ações ---------- */

export type TipoDeEvento =
  | 'proposta'
  | 'aprovada'
  | 'em_execucao'
  | 'feita'
  | 'descartada'
  | 'parar_tudo'
  | 'reativar'
  | 'limite'
  | 'estrategia';

export interface EventoDoDiario {
  id: string;
  em: string;
  tipo: TipoDeEvento;
  /** Vai em negrito: "Proposta do Claude", "Aprovada", "Parou tudo do Claude"… */
  titulo: string;
  /** Nome de quem fez, quando se sabe ("por Dono (demonstração)"). */
  por: string | null;
  corpo: string | null;
  citacao: string | null;
  tom: 'success' | 'info' | 'warning' | 'danger' | null;
  operador: Operator | null;
  pendencia: boolean;
  marca: Brand | null;
  canal: Platform | null;
}

function ondeNaMarca(marca: Marca): string {
  return marca === 'todas' ? 'nas duas marcas' : `em ${rotuloMarca(marca)}`;
}

function montarDiario(
  dados: Dados,
  filtros: Filtros,
  intervalo: Intervalo,
  reg: Registro,
  acoesDaTela: readonly TrafficAction[],
): EventoDoDiario[] {
  const nome = nomeDoPerfil(dados.profiles);
  const descartes = new Map<string, Extract<RegistroDoDiario, { tipo: 'descarte' }>>();
  for (const e of reg.eventos) if (e.tipo === 'descarte') descartes.set(e.acaoId, e);
  const eventos: EventoDoDiario[] = [];

  for (const a of acoesDaTela) {
    const comum = {
      operador: a.proposedBy,
      pendencia: a.kind === 'pending_fix',
      marca: a.brandId,
      canal: a.platform,
    };
    eventos.push({
      ...comum,
      id: `${a.id}:proposta`,
      em: a.createdAt,
      tipo: 'proposta',
      titulo:
        a.kind === 'pending_fix'
          ? 'Pendência de medição registrada'
          : a.proposedBy === 'claude'
            ? 'Proposta do Claude'
            : 'Proposta do humano',
      por: null,
      corpo: a.title,
      citacao: a.rationale || null,
      tom: null,
    });
    if (a.approvedAt && a.status !== 'discarded')
      eventos.push({
        ...comum,
        id: `${a.id}:aprovada`,
        em: a.approvedAt,
        tipo: 'aprovada',
        titulo: 'Aprovada',
        por: nome(a.approvedBy),
        corpo: a.title,
        citacao: null,
        tom: 'info',
      });
    if (a.status === 'running' && a.executedAt)
      eventos.push({
        ...comum,
        id: `${a.id}:execucao`,
        em: a.executedAt,
        tipo: 'em_execucao',
        titulo: 'Em execução',
        por: null,
        corpo: a.title,
        citacao: null,
        tom: 'warning',
      });
    if (a.status === 'done' && a.executedAt)
      eventos.push({
        ...comum,
        id: `${a.id}:feita`,
        em: a.executedAt,
        tipo: 'feita',
        titulo: 'Feita',
        por: null,
        corpo: a.title,
        citacao: a.result,
        tom: 'success',
      });
    const descarte = descartes.get(a.id);
    // Descarte sem hora conhecida (dado antigo) não vira linha: o diário não inventa quando foi
    if (a.status === 'discarded' && descarte)
      eventos.push({
        ...comum,
        id: `${a.id}:descartada`,
        em: descarte.em,
        tipo: 'descartada',
        titulo: 'Descartada',
        por: nome(descarte.por),
        corpo: a.title,
        citacao: descarte.motivo,
        tom: 'danger',
      });
  }

  const porId = new Map(dados.campaigns.map((c) => [c.id, c]));
  const tocaCampanha = (ids: readonly string[]) =>
    !filtros.campanha ||
    ids.some((id) => id === filtros.campanha || porId.get(id)?.utmCampaign === filtros.campanha);
  const naMarca = (marca: Marca | Brand) =>
    filtros.marca === 'todas' || marca === 'todas' || marca === filtros.marca;

  for (const e of reg.eventos) {
    if (e.tipo === 'descarte') continue;
    if (e.tipo === 'parar_tudo' || e.tipo === 'reativar') {
      if (!naMarca(e.marca) || filtros.operador === 'human' || !tocaCampanha(e.campanhas)) continue;
      const parar = e.tipo === 'parar_tudo';
      eventos.push({
        id: e.id,
        em: e.em,
        tipo: e.tipo,
        titulo: parar ? 'Parou tudo do Claude' : 'Desfez a parada do Claude',
        por: nome(e.por),
        corpo: parar
          ? `${plural(e.campanhas.length, 'campanha pausada', 'campanhas pausadas')} ${ondeNaMarca(e.marca)}, em todos os canais.`
          : `${plural(e.campanhas.length, 'campanha reativada', 'campanhas reativadas')} ${ondeNaMarca(e.marca)}.`,
        citacao: null,
        tom: parar ? 'danger' : 'info',
        operador: 'claude',
        pendencia: false,
        marca: e.marca === 'todas' ? null : e.marca,
        canal: null,
      });
      continue;
    }
    if (filtros.campanha || !naMarca(e.marca)) continue;
    if (e.tipo === 'limite') {
      if (filtros.canal && e.canal !== filtros.canal) continue;
      eventos.push({
        id: e.id,
        em: e.em,
        tipo: 'limite',
        titulo: 'Limite de gasto mudou',
        por: nome(e.por),
        corpo: `${rotulo('platform', e.canal)} · ${rotulo('brand', e.marca)}: ${
          e.deCents === null ? 'sem limite' : dinheiro(e.deCents)
        } → ${dinheiro(e.paraCents)} no mês.`,
        citacao: null,
        tom: 'info',
        operador: null,
        pendencia: false,
        marca: e.marca,
        canal: e.canal,
      });
      continue;
    }
    eventos.push({
      id: e.id,
      em: e.em,
      tipo: 'estrategia',
      titulo: 'Estratégia atualizada',
      por: nome(e.por),
      corpo: rotulo('brand', e.marca),
      citacao: null,
      tom: null,
      operador: null,
      pendencia: false,
      marca: e.marca,
      canal: null,
    });
  }

  return eventos
    .filter((e) => {
      const dia = diaSp(e.em);
      return dia >= intervalo.inicio && dia <= intervalo.fim;
    })
    .sort((a, b) => (a.em < b.em ? 1 : a.em > b.em ? -1 : a.id < b.id ? 1 : -1));
}

/** Diário do período: ações da tela (com os filtros da barra) e o registro, do mais novo ao mais antigo. */
export function diarioDoTrafego(
  dados: Dados,
  filtros: Filtros,
  agora: Date = new Date(),
  registro: Registro = REGISTRO_VAZIO,
): EventoDoDiario[] {
  const reg = registroDoConjunto(dados, registro);
  const base = acoes(dados, filtros, agora);
  return montarDiario(dados, filtros, base.intervalo, reg, base.lista);
}

/* ---------- O painel inteiro da tela ---------- */

export interface ParadaDoClaude {
  id: string;
  em: string;
  por: string | null;
  marca: Marca;
  quantas: number;
  /** Das campanhas paradas, quantas continuam pausadas (dá para desfazer). */
  aindaPausadas: number;
}

export interface PainelDoTrafego {
  intervalo: Intervalo;
  mes: MesCorrente;
  resumo: {
    /** Propostas esperando decisão (a mesma conta da Visão geral). */
    naFila: number | null;
    custoDaFila: number | null;
    aprovadas: number | null;
    emExecucao: number | null;
    /** Feitas no período (pela data de execução), vs. o período anterior. */
    feitas: Metrica;
    /** Média de horas entre a proposta e a aprovação, das aprovadas no período. */
    horasAteAprovar: Metrica;
    pendencias: number | null;
  };
  fila: ItemDeAcao[];
  /** Pendências de medição em aberto (não entram na fila: se resolvem fora e se marcam como feitas). */
  pendencias: ItemDeAcao[];
  /** "O que podemos fazer" com os filtros da barra e da lista, na ordem da lista. */
  lista: ItemDeAcao[];
  /** Quantas a lista tem antes do corte de `MAXIMO_DA_LISTA`. */
  totalDaLista: number;
  /** Ações com os filtros da barra, sem os da lista; null sem base. */
  totalSemFiltrosDaLista: number | null;
  /** Contagem por status com os filtros da barra, de impacto e de esforço (para os chips). */
  porStatus: Record<ActionStatus, number | null>;
  contas: ContaDoTrafego[];
  claude: {
    /** Campanhas ativas do Claude na marca escolhida, em todos os canais. */
    ativas: number | null;
    porCanal: Array<{ canal: Platform; ativas: number }>;
    /** Última parada que ainda dá para desfazer; null quando não há. */
    parada: ParadaDoClaude | null;
  };
  estrategias: EstrategiaComNumeros[];
  operador: PorOperador;
  diario: { eventos: EventoDoDiario[]; total: number };
  /** Campanhas da marca escolhida, para o formulário de ideia. */
  campanhas: Array<{ id: string; nome: string; marca: Brand; canal: Platform; status: CampaignStatus }>;
}

export interface OpcoesDoPainel {
  lista?: FiltrosDaLista;
  registro?: Registro;
  /** Quantos registros do diário devolver (padrão `LIMITE_DO_DIARIO`). */
  limiteDoDiario?: number;
}

function mediaDeHoras(aprovadas: readonly TrafficAction[]): number | null {
  if (aprovadas.length === 0) return null;
  let total = 0;
  for (const a of aprovadas)
    total += (new Date(a.approvedAt as string).getTime() - new Date(a.createdAt).getTime()) / 3_600_000;
  return total / aprovadas.length;
}

export function painelDoTrafego(
  dados: Dados,
  filtros: Filtros,
  agora: Date = new Date(),
  opcoes: OpcoesDoPainel = {},
): PainelDoTrafego {
  const filtrosDaLista = opcoes.lista ?? FILTROS_DA_LISTA_PADRAO;
  const reg = registroDoConjunto(dados, opcoes.registro ?? REGISTRO_VAZIO);
  const mes = mesCorrente(agora);
  const base = acoes(dados, filtros, agora);
  const intervalo = base.intervalo;
  const temBase = dados.actions.length > 0;

  // Todas as contas, para o alerta de limite de qualquer ação; a tela mostra as da marca e do canal
  const todasAsContas = new Map<string, ContaDoTrafego>();
  for (const marca of MARCAS)
    for (const canal of CANAIS) todasAsContas.set(`${marca}:${canal}`, contaDe(dados, marca, canal, mes));
  const item = itensDe(dados, todasAsContas);

  const fila = base.filaDeAprovacao.map(item).sort(ordemDaFila);
  const pendencias = base.pendencias.map(item).sort(ordemDaFila);

  const porNivel = base.lista.filter(
    (a) =>
      (!filtrosDaLista.impacto || a.impact === filtrosDaLista.impacto) &&
      (!filtrosDaLista.esforco || a.effort === filtrosDaLista.esforco),
  );
  const porStatus = Object.fromEntries(
    STATUS_DA_LISTA.map((s) => [s, temBase ? porNivel.filter((a) => a.status === s).length : null]),
  ) as Record<ActionStatus, number | null>;
  const filtrada = porNivel
    .filter((a) => !filtrosDaLista.status || a.status === filtrosDaLista.status)
    .sort(ordemDaLista);

  const anterior: Janela = { inicio: intervalo.anteriorInicio, fim: intervalo.anteriorFim };
  const feitasEm = (janela: Janela) =>
    temBase
      ? filtrarPeriodo(
          base.lista.filter((a) => a.status === 'done'),
          'executedAt',
          janela,
        ).length
      : null;
  const horasEm = (janela: Janela) =>
    mediaDeHoras(
      filtrarPeriodo(
        base.lista.filter((a) => a.approvedAt !== null),
        'approvedAt',
        janela,
      ),
    );
  const contar = (status: ActionStatus) =>
    temBase ? base.lista.filter((a) => a.status === status).length : null;

  const marcasDaTela = filtros.marca === 'todas' ? MARCAS : [filtros.marca];
  const doClaude = dados.campaigns.filter(
    (c) => c.managedBy === 'claude' && c.status === 'active' && marcasDaTela.includes(c.brandId),
  );
  const parada = ultimaParada(dados, filtros, reg);
  const diario = montarDiario(dados, filtros, intervalo, reg, base.lista);
  const limiteDoDiario = Math.max(1, opcoes.limiteDoDiario ?? LIMITE_DO_DIARIO);

  return {
    intervalo,
    mes,
    resumo: {
      naFila: temBase ? fila.length : null,
      custoDaFila: base.resumo.custoEstimadoDaFilaCents,
      aprovadas: contar('approved'),
      emExecucao: contar('running'),
      feitas: metrica(feitasEm(intervalo), feitasEm(anterior), filtros.comparar),
      horasAteAprovar: metrica(horasEm(intervalo), horasEm(anterior), filtros.comparar),
      pendencias: temBase ? pendencias.length : null,
    },
    fila,
    pendencias,
    lista: filtrada.slice(0, MAXIMO_DA_LISTA).map(item),
    totalDaLista: filtrada.length,
    totalSemFiltrosDaLista: temBase ? base.lista.length : null,
    porStatus,
    contas: contasDoTrafego(dados, filtros, agora),
    claude: {
      ativas: dados.campaigns.length === 0 ? null : doClaude.length,
      porCanal: CANAIS.map((canal) => ({
        canal,
        ativas: doClaude.filter((c) => c.platform === canal).length,
      })),
      parada,
    },
    estrategias: estrategiasDe(dados, filtros, agora, mes, reg),
    operador: porOperador(dados, filtros, agora),
    diario: { eventos: diario.slice(0, limiteDoDiario), total: diario.length },
    campanhas: dados.campaigns
      .filter((c) => marcasDaTela.includes(c.brandId))
      .map((c) => ({ id: c.id, nome: c.name, marca: c.brandId, canal: c.platform, status: c.status })),
  };
}

/** A última parada da marca da tela que ainda não foi desfeita e tem campanha pausada. */
function ultimaParada(dados: Dados, filtros: Filtros, reg: Registro): ParadaDoClaude | null {
  const desfeitas = new Set(reg.eventos.flatMap((e) => (e.tipo === 'reativar' ? [e.paradaId] : [])));
  const paradas = reg.eventos
    .flatMap((e) => (e.tipo === 'parar_tudo' ? [e] : []))
    .filter((e) => filtros.marca === 'todas' || e.marca === 'todas' || e.marca === filtros.marca)
    .sort((a, b) => (a.em < b.em ? 1 : -1));
  const ultima = paradas[0];
  if (!ultima || desfeitas.has(ultima.id)) return null;
  const status = new Map(dados.campaigns.map((c) => [c.id, c.status]));
  const aindaPausadas = ultima.campanhas.filter((id) => status.get(id) === 'paused').length;
  if (aindaPausadas === 0) return null;
  const nome = nomeDoPerfil(dados.profiles);
  return {
    id: ultima.id,
    em: ultima.em,
    por: nome(ultima.por),
    marca: ultima.marca,
    quantas: ultima.campanhas.length,
    aindaPausadas,
  };
}

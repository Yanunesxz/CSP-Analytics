/**
 * Chegada de clientes (/chegada): junta as consultas da fundação numa resposta só para a tela.
 *
 * Nenhuma regra de negócio nova: "cliente novo", atribuição por UTM e marca vêm de `queries.ts`
 * (`kpisVisaoGeral`, `funilChegada`, `custoPorClienteNovo`, `porOperador`, `leadsPorOrigem`).
 * Aqui só se compõe:
 * - os KPIs com as mesmas definições da Visão geral (o número bate entre as telas);
 * - os filtros que valem para custo: o investimento é por campanha, então origem paga vira canal,
 *   e origem não paga ou representante deixam o custo "Não se aplica" (nunca um custo inflado);
 * - a matriz marca × canal do custo por cliente novo, com "As duas" e "Todos os canais";
 * - o funil com a taxa sobre o total e o período anterior de cada etapa;
 * - as quebras por origem, representante e marca (as duas últimas com o tempo médio até o 1º pedido).
 *
 * "Viraram cliente" = leads do período que já fizeram o 1º pedido enviado (base do funil), que é
 * diferente de "Clientes novos" do KPI (1º pedido enviado dentro do período, de qualquer lead).
 *
 * Pura, com teste em `chegada-de-clientes.test.ts`; é a referência da view SQL da fase 3.
 */

import type { Brand, LeadSource, LeadStage, Platform } from '@csp-mkt/shared';
import type { Intervalo } from '../../lib/periodo';
import type { Filtros } from '../../lib/url-state';
import type { Dados } from '../dados';
import {
  custoPorClienteNovo,
  filtrarMarca,
  funilChegada,
  kpisVisaoGeral,
  leadsPorOrigem,
  metrica,
  porOperador,
  razao,
  soma,
  type CustoPorClienteNovo,
  type LinhaCusto,
  type LinhaOperador,
  type Metrica,
} from '../queries';

/* ---------- Tipos de saída ---------- */

/** Por que o custo por cliente novo não se aplica com os filtros de agora. */
export type MotivoSemCusto = 'origem' | 'representante';

export interface EtapaDoFunil {
  etapa: LeadStage;
  rotulo: string;
  /** Leads do período que chegaram pelo menos a esta etapa (e o mesmo no período anterior). */
  total: Metrica;
  /** Em relação à etapa anterior; null na primeira etapa ou sem base. */
  daAnterior: number | null;
  /** Em relação aos leads do período (a primeira etapa). */
  doTotal: number | null;
}

/** Leads de um grupo no período e quantos já viraram cliente. */
export interface Conversao {
  leads: number | null;
  /** Leads do grupo que já fizeram o 1º pedido enviado. */
  viraramCliente: number | null;
  /** viraramCliente ÷ leads. */
  conversao: number | null;
  /** Dias, em média, do lead ao 1º pedido, entre os que já compraram. */
  diasAtePedido: number | null;
}

export interface LinhaDaMatriz {
  /** null = "As duas" (cada cliente contado uma vez). */
  marca: Brand | null;
  /** Uma célula por coluna de `MatrizDeCusto.canais`, na mesma ordem. */
  celulas: LinhaCusto[];
}

export interface MatrizDeCusto {
  /** Colunas: os canais e, quando há mais de um, null = "Todos os canais". */
  canais: Array<Platform | null>;
  /** Linhas: as marcas e, quando há mais de uma, null = "As duas". */
  linhas: LinhaDaMatriz[];
}

export interface OpcaoDaTela {
  valor: string;
  rotulo: string;
}

export interface ChegadaDeClientes {
  intervalo: Intervalo;
  /** Leads que chegaram no período (mesma conta da Visão geral). */
  leads: Metrica;
  /** 1º pedido enviado no período, um por cliente (mesma conta da Visão geral). */
  clientesNovos: Metrica;
  /** Leads do período que já viraram cliente ÷ leads do período. */
  conversao: Metrica;
  /** Investimento ÷ clientes novos atribuídos; tudo null quando `motivoSemCusto` existe. */
  custoPorClienteNovo: Metrica;
  motivoSemCusto: MotivoSemCusto | null;
  /** Marca × canal; null quando o custo não se aplica. */
  custo: MatrizDeCusto | null;
  funil: {
    etapas: EtapaDoFunil[];
    /** Do lead ao 1º pedido, em dias; é o único intervalo entre etapas que o CRM já data. */
    diasAtePedido: number | null;
    /** Leads sem marca (SDR · WhatsApp) que entram no funil. */
    semMarca: number | null;
  };
  /** Ordenado por leads, do maior para o menor. */
  porOrigem: Array<Omit<Conversao, 'diasAtePedido'> & { origem: LeadSource }>;
  /** Ordenado por quem mais virou cliente. */
  porRepresentante: Array<Conversao & { representante: string }>;
  /** Leads do período ainda sem representante. */
  semRepresentante: number | null;
  /** Só com "As duas": cada marca inclui os leads sem marca (decisão 0003). */
  porMarca: Array<Conversao & { marca: Brand }>;
  /** Mês de chegada do lead (`AAAA-MM`), do mais antigo ao mais novo. */
  coorte: Array<{ mes: string } & Omit<Conversao, 'diasAtePedido'>>;
  /** Humano × Claude nas contas de cliente novo; null quando o custo não se aplica. */
  operador: LinhaOperador[] | null;
  /** Opções dos filtros de campanha e representante, vindas dos dados. */
  opcoes: { campanhas: OpcaoDaTela[]; representantes: OpcaoDaTela[] };
}

/* ---------- Regras de composição ---------- */

const CANAIS_PAGOS: readonly Platform[] = ['meta', 'tiktok', 'google'];
const MARCAS: readonly Brand[] = ['cs', 'plumene'];

/** Ordem de desempate entre origens com o mesmo número de leads (a mesma de labels.ts). */
const ORDEM_DAS_ORIGENS: readonly LeadSource[] = [
  'meta',
  'tiktok',
  'google',
  'site',
  'organic',
  'ai_assistant',
  'sdr',
  'referral',
  'direct',
];

/** Linhas de Humano × Claude que falam de cliente novo, nesta ordem. */
const CHAVES_DO_OPERADOR = ['investimento', 'parcelaDaVerba', 'clientesNovos', 'custoPorClienteNovo'];

function ehCanalPago(origem: LeadSource): origem is Platform {
  return (CANAIS_PAGOS as readonly LeadSource[]).includes(origem);
}

/**
 * Filtros que valem para custo. O investimento é por campanha: origem paga (Meta, TikTok, Google)
 * vira canal; origem não paga e representante não dividem investimento, então o custo não se aplica.
 */
export function filtrosDeCusto(filtros: Filtros): { filtros: Filtros; motivo: MotivoSemCusto | null } {
  if (filtros.representante) return { filtros, motivo: 'representante' };
  if (!filtros.origem) return { filtros, motivo: null };
  if (!ehCanalPago(filtros.origem)) return { filtros, motivo: 'origem' };
  // Canal e origem pagos diferentes não têm lead em comum: mantém a origem para o custo ficar sem base.
  const conflito = filtros.canal !== null && filtros.canal !== filtros.origem;
  return {
    filtros: { ...filtros, canal: filtros.canal ?? filtros.origem, origem: conflito ? filtros.origem : null },
    motivo: null,
  };
}

/**
 * Matriz marca × canal a partir de `custoPorClienteNovo`. Com mais de uma marca entra a linha
 * "As duas" (null) e, com mais de um canal, a coluna "Todos os canais" (null); com uma marca ou um
 * canal só, a linha ou coluna de total seria repetida e fica de fora.
 */
export function matrizDeCusto(cu: CustoPorClienteNovo): MatrizDeCusto {
  const chave = (marca: Brand | null, canal: Platform | null) => `${marca ?? '*'}|${canal ?? '*'}`;
  const celulas = new Map<string, LinhaCusto>();
  for (const l of [...cu.linhas, ...cu.porMarca, ...cu.porCanal, cu.total]) {
    celulas.set(chave(l.marca, l.canal), l);
  }
  const marcas: Array<Brand | null> = cu.porMarca.map((l) => l.marca);
  const canais: Array<Platform | null> = cu.porCanal.map((l) => l.canal);
  if (marcas.length > 1) marcas.push(null);
  if (canais.length > 1) canais.push(null);
  return {
    canais,
    linhas: marcas.map((marca) => ({
      marca,
      celulas: canais.map((canal) => celulas.get(chave(marca, canal)) ?? cu.total),
    })),
  };
}

function ordemDaOrigem(origem: LeadSource): number {
  const i = ORDEM_DAS_ORIGENS.indexOf(origem);
  return i === -1 ? ORDEM_DAS_ORIGENS.length : i;
}

/* ---------- Consulta da tela ---------- */

export function chegadaDeClientes(
  dados: Dados,
  filtros: Filtros,
  agora: Date = new Date(),
): ChegadaDeClientes {
  const kpis = kpisVisaoGeral(dados, filtros, agora);
  const funil = funilChegada(dados, filtros, agora);
  const { filtros: deCusto, motivo } = filtrosDeCusto(filtros);
  const cu = motivo ? null : custoPorClienteNovo(dados, deCusto, agora);

  const leadsDoPeriodo = funil.etapas[0]?.total ?? null;

  const porOrigem = funil.porOrigem
    .map((o) => ({ origem: o.origem, leads: o.leads, viraramCliente: o.clientesNovos, conversao: o.taxa }))
    .sort((a, b) => (b.leads ?? 0) - (a.leads ?? 0) || ordemDaOrigem(a.origem) - ordemDaOrigem(b.origem));

  // O tempo até o 1º pedido de cada representante vem do mesmo funil, filtrado por ele.
  const porRepresentante = funil.porRepresentante
    .map((r) => ({
      representante: r.representante,
      leads: r.leads,
      viraramCliente: r.clientesNovos,
      conversao: r.taxa,
      diasAtePedido: funilChegada(dados, { ...filtros, representante: r.representante }, agora)
        .tempoMedioAtePedidoDias,
    }))
    .sort(
      (a, b) =>
        (b.viraramCliente ?? 0) - (a.viraramCliente ?? 0) ||
        (b.leads ?? 0) - (a.leads ?? 0) ||
        a.representante.localeCompare(b.representante, 'pt-BR', { numeric: true }),
    );
  const comRepresentante = soma(funil.porRepresentante.map((r) => r.leads)) ?? 0;

  const porMarca =
    filtros.marca === 'todas'
      ? MARCAS.map((marca) => {
          const daMarca = funilChegada(dados, { ...filtros, marca }, agora);
          const leads = daMarca.etapas[0]?.total ?? null;
          return {
            marca,
            leads,
            viraramCliente:
              leads === null ? null : (soma(daMarca.porOrigem.map((o) => o.clientesNovos)) ?? 0),
            conversao: daMarca.taxaLeadParaCliente.atual,
            diasAtePedido: daMarca.tempoMedioAtePedidoDias,
          };
        })
      : [];

  const linhasDoOperador = motivo ? null : porOperador(dados, deCusto, agora).linhas;
  const operador = linhasDoOperador
    ? CHAVES_DO_OPERADOR.map((chave) => linhasDoOperador.find((l) => l.chave === chave)).filter(
        (l): l is LinhaOperador => l !== undefined,
      )
    : null;

  const campanhas = filtrarMarca(dados.campaigns, filtros.marca)
    .filter((c) => !filtros.canal || c.platform === filtros.canal)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .map((c) => ({ valor: c.id, rotulo: c.name }));
  const representantes = [...new Set(dados.leads.map((l) => l.repId).filter((r): r is string => r !== null))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
    .map((r) => ({ valor: r, rotulo: r }));

  return {
    intervalo: funil.intervalo,
    leads: kpis.leads,
    clientesNovos: kpis.clientesNovos,
    conversao: funil.taxaLeadParaCliente,
    custoPorClienteNovo: cu ? cu.total.custo : metrica(null, null, filtros.comparar),
    motivoSemCusto: motivo,
    custo: cu ? matrizDeCusto(cu) : null,
    funil: {
      etapas: funil.etapas.map((e) => ({
        etapa: e.etapa,
        rotulo: e.rotulo,
        total: metrica(e.total, e.anterior, filtros.comparar),
        daAnterior: e.taxa,
        doTotal: razao(e.total, leadsDoPeriodo),
      })),
      diasAtePedido: funil.tempoMedioAtePedidoDias,
      semMarca: leadsPorOrigem(dados, filtros, agora).semMarca,
    },
    porOrigem,
    porRepresentante,
    semRepresentante: leadsDoPeriodo === null ? null : Math.max(0, leadsDoPeriodo - comRepresentante),
    porMarca,
    coorte: funil.coorte.map((c) => ({
      mes: c.mes,
      leads: c.leads,
      viraramCliente: c.clientesNovos,
      conversao: c.taxa,
    })),
    operador,
    opcoes: { campanhas, representantes },
  };
}

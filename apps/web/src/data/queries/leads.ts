/**
 * Painel de Leads (rota /leads): consulta pura, com teste em `leads.test.ts`.
 * Na fase 3 vira a view `kpi_leads`.
 *
 * Devolve, para os filtros da URL e um período:
 * - os indicadores: leads, lead → cliente novo (dos leads do período, quantos já fizeram o 1º pedido
 *   enviado), custo por lead (investimento ÷ leads de anúncio, a mesma conta da Visão geral) e os
 *   leads sem marca (SDR · WhatsApp), que aparecem nas duas marcas;
 * - as contagens por marca, por origem, por dia (série por marca) e por campanha (`utm_campaign`);
 * - Humano × Claude nos leads de campanha: a mesma linha lado a lado, com a diferença em %;
 * - as contagens dos filtros rápidos: por origem (ignora o próprio filtro de origem, senão os outros
 *   chips zeram ao escolher um) e por etapa (os chips da lista);
 * - a lista sem dado pessoal: código, origem, marca, campanha, data, etapa e o link para a ficha 360
 *   no CSP 360. Nome, telefone e e-mail nunca passam por aqui (decisão 0006).
 *
 * A etapa (`?etapa=`) filtra só a lista: os indicadores e os gráficos descrevem todos os leads do
 * período com os filtros da barra. Ela não existe em `Filtros` e chega por `opcoes.etapa`.
 *
 * Convenções de `queries.ts`: métrica sem base = null (nunca 0 nem NaN); contagem sobre tabela vazia =
 * null, sobre tabela com linhas = 0 ou mais; marca escolhida inclui o lead sem marca (SDR); um cliente
 * novo por `crmCustomerId` (decisão 0012); campanha pelo `utmCampaign` (decisão 0009); dinheiro em
 * centavos. O investimento vem de `metricasPorCampanha`, para a regra do gasto morar num lugar só.
 */

import type { Brand, Lead, LeadSource, LeadStage, Operator, Platform } from '@csp-mkt/shared';
import { opcoes, rotulo, rotuloMarca, SEM_MARCA } from '@csp-mkt/shared';
import { diaSp, diasEntre } from '../../lib/datas';
import { diferenca } from '../../lib/format';
import { intervaloDoPeriodo, type Intervalo } from '../../lib/periodo';
import type { Filtros } from '../../lib/url-state';
import type { Dados } from '../dados';
import {
  ETAPAS,
  // A mesma regra de leads e de cliente novo da fundação (nenhuma regra em dois lugares)
  chegouAoPedido as virouCliente,
  contagem,
  filtrarMarca,
  filtrarPeriodo,
  leadsFiltrados as leadsQueRespeitam,
  metrica,
  metricasPorCampanha,
  razao,
  soma,
  type Formato,
  type Janela,
  type LinhaCampanha,
  type LinhaOperador,
  type Metrica,
} from '../queries';

/* ---------- Tipos de saída ---------- */

/** Marca do lead como chave de série: as duas marcas e o lead sem marca (SDR). */
export type ChaveMarca = Brand | 'sem-marca';

export interface OpcoesDoPainelDeLeads {
  /** Chip de etapa da lista; null = todas. */
  etapa?: LeadStage | null;
}

/** Por que o custo por lead não se aplica aos filtros de agora. */
export type CustoNaoSeAplica = 'origem' | 'representante';

/** Um grupo de leads do período: quantos, quantos já viraram cliente e a taxa. */
export interface GrupoDeLeads {
  leads: Metrica;
  /** Leads do grupo que já fizeram o 1º pedido enviado, um por cliente. */
  viraramCliente: number | null;
  /** viraramCliente ÷ leads do grupo; null sem leads. */
  taxaConversao: number | null;
}

export interface LeadsPorMarca extends GrupoDeLeads {
  marca: Brand | null;
  chave: ChaveMarca;
  rotulo: string;
}

export interface LeadsPorOrigem extends GrupoDeLeads {
  origem: LeadSource;
  rotulo: string;
}

export interface LeadsPorDia {
  date: string;
  total: number | null;
  porMarca: Record<ChaveMarca, number | null>;
}

export interface LeadsPorCampanha extends GrupoDeLeads {
  utmCampaign: string;
  /** Id da campanha cadastrada; null quando a UTM não casa com campanha alguma. */
  campanhaId: string | null;
  /** Nome da campanha; quando a UTM não casa, a própria UTM. */
  nome: string;
  canal: Platform | null;
  marca: Brand | null;
  /** null quando a UTM não casa com campanha (sem dono conhecido). */
  operador: Operator | null;
  investimento: Metrica;
  custoPorLead: Metrica;
}

export interface LeadsPorEtapa {
  etapa: LeadStage;
  rotulo: string;
  leads: number | null;
}

export interface ChipDeOrigem {
  origem: LeadSource;
  rotulo: string;
  leads: number | null;
}

/** Linha da lista: só o combinado na decisão 0006, nada de nome, telefone ou e-mail. */
export interface LeadDoPainel {
  id: string;
  code: string;
  origem: LeadSource;
  marca: Brand | null;
  /** Nome da campanha (ou a UTM, quando não casa); null sem UTM. */
  campanha: string | null;
  utmCampaign: string | null;
  etapa: LeadStage;
  criadoEm: string;
  /** Ficha 360 no CSP 360; null enquanto o lead não tem cadastro de cliente. */
  linkCrm: string | null;
}

export interface OpcaoDoPainel {
  valor: string;
  rotulo: string;
}

export interface PainelDeLeads {
  intervalo: Intervalo;
  /** Etapa que filtra a lista; null = todas. */
  etapa: LeadStage | null;
  total: Metrica;
  /** Leads do período que já fizeram o 1º pedido enviado, um por cliente. */
  viraramCliente: Metrica;
  taxaConversao: Metrica;
  /** Investimento ÷ leads de anúncio; null quando não se aplica ou sem base. */
  custoPorLead: Metrica;
  /** Preenchido quando o custo por lead não se aplica aos filtros (origem sem mídia, representante). */
  custoNaoSeAplica: CustoNaoSeAplica | null;
  /** Leads sem marca (SDR · WhatsApp), que aparecem nas duas marcas. */
  semMarca: Metrica;
  /** As duas marcas (ou a escolhida) e o lead sem marca. */
  porMarca: LeadsPorMarca[];
  /** Origens com lead no período ou no anterior, maior primeiro. */
  porOrigem: LeadsPorOrigem[];
  porDia: LeadsPorDia[];
  /** Por `utm_campaign`, maior primeiro. */
  porCampanha: LeadsPorCampanha[];
  /** Humano × Claude nos leads de campanha (ignora o filtro de operador: a comparação é ele). */
  porOperador: LinhaOperador[];
  /** Filtros rápidos de origem: só as que têm lead, maior primeiro; ignora o filtro de origem. */
  chipsDeOrigem: ChipDeOrigem[];
  /** Chips de etapa da lista, na ordem do funil. */
  porEtapa: LeadsPorEtapa[];
  /** Mais novos primeiro, no máximo `LIMITE_DA_LISTA`. */
  lista: LeadDoPainel[];
  /** Quantos leads a lista teria sem o limite. */
  totalDaLista: number | null;
  /** Opções de campanha e representante para o painel "Filtros", na marca escolhida. */
  opcoesDeFiltro: { campanhas: OpcaoDoPainel[]; representantes: OpcaoDoPainel[] };
}

/* ---------- Constantes ---------- */

/** CSP 360 (endereço de exemplo, o mesmo de `queries.ts`, até o CRM informar o real). */
export const URL_CSP360 = 'https://csp360.example';
/** Ficha 360: `${URL_CRM_FICHA}/<clientes.id>`. */
export const URL_CRM_FICHA = `${URL_CSP360}/clientes`;
/** Funil de leads no CSP 360, onde a equipe trabalha cada lead. */
export const URL_CRM_LEADS = `${URL_CSP360}/funis/leads`;

export const LIMITE_DA_LISTA = 200;

const CANAIS_PAGOS: readonly LeadSource[] = ['meta', 'tiktok', 'google'];

/* ---------- Utilidades ---------- */

/** `?etapa=` da URL; valor desconhecido vira null (todas). */
export function etapaDaUrl(valor: string | null | undefined): LeadStage | null {
  return valor && (ETAPAS as readonly string[]).includes(valor) ? (valor as LeadStage) : null;
}

/** "Corpo Sensual", "Plumene" ou "Sem marca · WhatsApp" (lead do SDR). */
export function rotuloDaMarcaDoLead(marca: Brand | null): string {
  return marca ? rotuloMarca(marca) : `${SEM_MARCA} · WhatsApp`;
}

export function chaveDaMarca(marca: Brand | null): ChaveMarca {
  return marca ?? 'sem-marca';
}

function ehCanalPago(origem: LeadSource | null): origem is Platform {
  return origem !== null && CANAIS_PAGOS.includes(origem);
}

/** Leads que já fizeram o 1º pedido enviado, um por `crmCustomerId` (decisão 0012). */
function viraramCliente(leads: readonly Lead[]): Lead[] {
  const vistos = new Set<string>();
  return leads.filter(virouCliente).filter((lead) => {
    const chave = lead.crmCustomerId ?? lead.id;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

function porLeads<T extends { leads: Metrica }>(a: T, b: T): number {
  return (b.leads.atual ?? -1) - (a.leads.atual ?? -1);
}

function maisNovoPrimeiro(a: Lead, b: Lead): number {
  return Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.code.localeCompare(a.code, 'pt-BR');
}

/* ---------- A consulta ---------- */

export function painelDeLeads(
  dados: Dados,
  filtros: Filtros,
  agora: Date = new Date(),
  opcoesDoPainel: OpcoesDoPainelDeLeads = {},
): PainelDeLeads {
  const etapa = opcoesDoPainel.etapa ?? null;
  const comparar = filtros.comparar;
  const intervalo = intervaloDoPeriodo(filtros.periodo, agora);
  const anterior: Janela = { inicio: intervalo.anteriorInicio, fim: intervalo.anteriorFim };
  const contar = (lista: readonly Lead[]): number | null => contagem(dados.leads, lista);
  const porUtm = new Map(dados.campaigns.map((c) => [c.utmCampaign, c]));
  const naJanela = (lista: readonly Lead[]) => ({
    atual: filtrarPeriodo(lista, 'createdAt', intervalo),
    antes: filtrarPeriodo(lista, 'createdAt', anterior),
  });

  const grupo = (atual: readonly Lead[], antes: readonly Lead[]): GrupoDeLeads => {
    const viraram = viraramCliente(atual);
    return {
      leads: metrica(contar(atual), contar(antes), comparar),
      viraramCliente: contar(viraram),
      taxaConversao: razao(viraram.length, atual.length),
    };
  };

  /* Leads do período com os filtros da barra (a etapa filtra só a lista) */
  const { atual: doPeriodo, antes: doAnterior } = naJanela(leadsQueRespeitam(dados, filtros));
  const viraramAgora = viraramCliente(doPeriodo);
  const viraramAntes = viraramCliente(doAnterior);

  /* Investimento por campanha, pela regra de `metricasPorCampanha`. Sem o filtro de operador, para
     o Humano × Claude; origem de anúncio vira canal, para o gasto ser só daquele canal. O custo não
     se aplica a origem sem mídia (site, orgânico, IA, SDR…) nem a um representante só. */
  const custoNaoSeAplica: CustoNaoSeAplica | null = filtros.representante
    ? 'representante'
    : filtros.origem && !ehCanalPago(filtros.origem)
      ? 'origem'
      : null;
  const filtrosDeCusto: Filtros = {
    ...filtros,
    operador: 'todos',
    canal: filtros.canal ?? (ehCanalPago(filtros.origem) ? filtros.origem : null),
  };
  const campanhasComGasto: LinhaCampanha[] =
    custoNaoSeAplica === null ? metricasPorCampanha(dados, filtrosDeCusto, agora).linhas : [];
  const temGasto = custoNaoSeAplica === null && dados.metrics.length > 0;
  const investimentoPorCampanha = new Map(campanhasComGasto.map((l) => [l.campanha.id, l.investimento]));
  const campanhasDe = (operador: Filtros['operador']) =>
    campanhasComGasto.filter((l) => operador === 'todos' || l.campanha.managedBy === operador);
  const investimentoDe = (linhas: readonly LinhaCampanha[], quando: 'atual' | 'anterior') =>
    temGasto ? (soma(linhas.map((l) => l.investimento[quando])) ?? 0) : null;
  const deAnuncio = (leads: readonly Lead[], linhas: readonly LinhaCampanha[]) => {
    const utms = new Set(linhas.map((l) => l.campanha.utmCampaign));
    return leads.filter((l) => l.utmCampaign !== null && utms.has(l.utmCampaign));
  };
  const campanhasDoFiltro = campanhasDe(filtros.operador);
  const custoPorLead = metrica(
    temGasto
      ? razao(investimentoDe(campanhasDoFiltro, 'atual'), contar(deAnuncio(doPeriodo, campanhasDoFiltro)))
      : null,
    temGasto
      ? razao(investimentoDe(campanhasDoFiltro, 'anterior'), contar(deAnuncio(doAnterior, campanhasDoFiltro)))
      : null,
    comparar,
  );

  /* Por marca: as duas (ou a escolhida) e o lead sem marca, que aparece nas duas */
  const marcas: Array<Brand | null> =
    filtros.marca === 'todas' ? ['cs', 'plumene', null] : [filtros.marca, null];
  const porMarca: LeadsPorMarca[] = marcas.map((marca) => ({
    marca,
    chave: chaveDaMarca(marca),
    rotulo: rotuloDaMarcaDoLead(marca),
    ...grupo(
      doPeriodo.filter((l) => l.brandId === marca),
      doAnterior.filter((l) => l.brandId === marca),
    ),
  }));

  /* Por origem: só as que têm lead no período ou no anterior; maior primeiro, empate na ordem declarada */
  const origensPresentes = new Set([...doPeriodo, ...doAnterior].map((l) => l.source));
  const porOrigem: LeadsPorOrigem[] = opcoes('leadSource')
    .filter((o) => origensPresentes.has(o.codigo))
    .map((o) => ({
      origem: o.codigo,
      rotulo: o.rotulo,
      ...grupo(
        doPeriodo.filter((l) => l.source === o.codigo),
        doAnterior.filter((l) => l.source === o.codigo),
      ),
    }))
    .sort(porLeads);

  /* Por dia, com a série de cada marca */
  const porData = new Map<string, Lead[]>();
  for (const lead of doPeriodo) {
    const dia = diaSp(lead.createdAt);
    const doDia = porData.get(dia);
    if (doDia) doDia.push(lead);
    else porData.set(dia, [lead]);
  }
  const porDia: LeadsPorDia[] = diasEntre(intervalo.inicio, intervalo.fim).map((date) => {
    const doDia = porData.get(date) ?? [];
    return {
      date,
      total: contar(doDia),
      porMarca: {
        cs: contar(doDia.filter((l) => l.brandId === 'cs')),
        plumene: contar(doDia.filter((l) => l.brandId === 'plumene')),
        'sem-marca': contar(doDia.filter((l) => l.brandId === null)),
      },
    };
  });

  /* Por campanha (utm_campaign), casando com `campaigns` pelo nome da UTM */
  const utms = new Set([...doPeriodo, ...doAnterior].flatMap((l) => (l.utmCampaign ? [l.utmCampaign] : [])));
  const porCampanha: LeadsPorCampanha[] = [...utms]
    .map((utm) => {
      const campanha = porUtm.get(utm);
      const atual = doPeriodo.filter((l) => l.utmCampaign === utm);
      const antes = doAnterior.filter((l) => l.utmCampaign === utm);
      const exemplo = atual[0] ?? antes[0];
      const doGrupo = grupo(atual, antes);
      const investimento =
        (campanha ? investimentoPorCampanha.get(campanha.id) : undefined) ?? metrica(null, null, comparar);
      return {
        utmCampaign: utm,
        campanhaId: campanha?.id ?? null,
        nome: campanha?.name ?? utm,
        canal: campanha?.platform ?? (exemplo && ehCanalPago(exemplo.source) ? exemplo.source : null),
        marca: campanha?.brandId ?? exemplo?.brandId ?? null,
        operador: campanha?.managedBy ?? null,
        ...doGrupo,
        investimento,
        custoPorLead: metrica(
          razao(investimento.atual, doGrupo.leads.atual),
          razao(investimento.anterior, doGrupo.leads.anterior),
          comparar,
        ),
      };
    })
    .sort((a, b) => porLeads(a, b) || a.nome.localeCompare(b.nome, 'pt-BR'));

  /* Humano × Claude: leads de campanha de cada operador (quem opera a campanha, decisão 0008) */
  const { atual: semFiltroDeOperador } = naJanela(
    leadsQueRespeitam(dados, { ...filtros, operador: 'todos' }),
  );
  const operadorDe = (lead: Lead): Operator | null =>
    lead.utmCampaign ? (porUtm.get(lead.utmCampaign)?.managedBy ?? null) : null;
  const resumoDoOperador = (operador: Operator) => {
    const leads = semFiltroDeOperador.filter((l) => operadorDe(l) === operador);
    const viraram = viraramCliente(leads);
    const quantos = contar(leads);
    const investimento = investimentoDe(campanhasDe(operador), 'atual');
    return {
      leads: quantos,
      viraramCliente: contar(viraram),
      taxaConversao: razao(viraram.length, leads.length),
      investimento,
      custoPorLead: razao(investimento, quantos),
    };
  };
  const humano = resumoDoOperador('human');
  const claude = resumoDoOperador('claude');
  const linha = (
    chave: keyof typeof humano,
    rotuloDaLinha: string,
    formato: Formato,
    menorEhMelhor = false,
  ): LinhaOperador => ({
    chave,
    rotulo: rotuloDaLinha,
    formato,
    humano: humano[chave],
    claude: claude[chave],
    diferenca: diferenca(claude[chave], humano[chave]),
    menorEhMelhor,
  });
  const porOperador: LinhaOperador[] = [
    linha('leads', 'Leads de campanha', 'numero'),
    linha('viraramCliente', 'Viraram cliente', 'numero'),
    linha('taxaConversao', 'Lead → cliente novo', 'percentual'),
    linha('investimento', 'Investimento', 'dinheiro'),
    linha('custoPorLead', 'Custo por lead', 'dinheiro', true),
  ];

  /* Filtros rápidos de origem: ignoram o filtro de origem, senão os outros chips zeram */
  const { atual: semFiltroDeOrigem } = naJanela(leadsQueRespeitam(dados, { ...filtros, origem: null }));
  const chipsDeOrigem: ChipDeOrigem[] = opcoes('leadSource')
    .map((o) => ({
      origem: o.codigo,
      rotulo: o.rotulo,
      leads: contar(semFiltroDeOrigem.filter((l) => l.source === o.codigo)),
    }))
    .filter((c) => c.leads !== null && c.leads > 0)
    .sort((a, b) => (b.leads ?? 0) - (a.leads ?? 0));

  /* Chips de etapa: contagem de cada etapa entre os leads do período */
  const porEtapa: LeadsPorEtapa[] = ETAPAS.map((e) => ({
    etapa: e,
    rotulo: rotulo('leadStage', e),
    leads: contar(doPeriodo.filter((l) => l.stage === e)),
  }));

  /* Lista: a etapa filtra; mais novos primeiro, sem dado pessoal, no máximo LIMITE_DA_LISTA */
  const daLista = etapa ? doPeriodo.filter((l) => l.stage === etapa) : doPeriodo;
  const lista: LeadDoPainel[] = daLista
    .slice()
    .sort(maisNovoPrimeiro)
    .slice(0, LIMITE_DA_LISTA)
    .map((l) => ({
      id: l.id,
      code: l.code,
      origem: l.source,
      marca: l.brandId,
      campanha: l.utmCampaign ? (porUtm.get(l.utmCampaign)?.name ?? l.utmCampaign) : null,
      utmCampaign: l.utmCampaign,
      etapa: l.stage,
      criadoEm: l.createdAt,
      linkCrm: l.crmCustomerId ? `${URL_CRM_FICHA}/${encodeURIComponent(l.crmCustomerId)}` : null,
    }));

  /* Opções do painel "Filtros", na marca escolhida */
  const campanhas: OpcaoDoPainel[] = filtrarMarca(dados.campaigns, filtros.marca)
    .map((c) => ({ valor: c.id, rotulo: c.name }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  const representantes: OpcaoDoPainel[] = [
    ...new Set(filtrarMarca(dados.leads, filtros.marca).flatMap((l) => (l.repId ? [l.repId] : []))),
  ]
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
    .map((rep) => ({ valor: rep, rotulo: rep }));

  return {
    intervalo,
    etapa,
    total: metrica(contar(doPeriodo), contar(doAnterior), comparar),
    viraramCliente: metrica(contar(viraramAgora), contar(viraramAntes), comparar),
    taxaConversao: metrica(
      razao(viraramAgora.length, doPeriodo.length),
      razao(viraramAntes.length, doAnterior.length),
      comparar,
    ),
    custoPorLead,
    custoNaoSeAplica,
    semMarca: metrica(
      contar(doPeriodo.filter((l) => l.brandId === null)),
      contar(doAnterior.filter((l) => l.brandId === null)),
      comparar,
    ),
    porMarca,
    porOrigem,
    porDia,
    porCampanha,
    porOperador,
    chipsDeOrigem,
    porEtapa,
    lista,
    totalDaLista: contar(daLista),
    opcoesDeFiltro: { campanhas, representantes },
  };
}

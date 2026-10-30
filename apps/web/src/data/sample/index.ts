/**
 * Dados de exemplo do modo demonstração: inventados, determinísticos (PRNG com semente) e
 * relativos a hoje. Duas marcas, campanhas por plataforma com gestão mista Humano × Claude,
 * leads sem dado pessoal (só código), clientes, pedidos, Instagram, SEO, GEO, ações de tráfego
 * e conectores. Nenhum nome de pessoa, telefone, documento ou cliente real.
 */

import type {
  ActionKind,
  ActionStatus,
  Brand,
  Campaign,
  CampaignStatus,
  Connector,
  Customer,
  CustomerSituation,
  DailyMetric,
  GeoDaily,
  GeoSource,
  IgDaily,
  IgMedia,
  IgMediaType,
  Lead,
  LeadSource,
  LeadStage,
  Level,
  Operator,
  Order,
  Platform,
  SeoDaily,
  TrafficAction,
} from '@csp-mkt/shared';
import { codigo } from '@csp-mkt/shared';
import { PERFIL_DEMONSTRACAO } from '../../lib/auth';
import { diaSp, instanteDe, somarDias } from '../../lib/datas';
import type { Dados } from '../dados';
import { criarPrng, type Prng } from './prng';

export interface OpcoesDeExemplo {
  semente?: number;
  agora?: Date;
  /** Quantos dias para trás, contando hoje. */
  dias?: number;
}

export const SEMENTE_PADRAO = 20261030;

const MARCAS: readonly Brand[] = ['cs', 'plumene'];
const PLATAFORMAS: readonly Platform[] = ['meta', 'tiktok', 'google'];
const REPRESENTANTES = ['REP-01', 'REP-02', 'REP-03', 'REP-04', 'REP-05', 'REP-06', 'REP-07', 'REP-08'];

const TEMAS = [
  'Pijamas de inverno',
  'Coleção verão',
  'Lojistas novos',
  'Atacado 12 peças',
  'Catálogo digital',
  'Fábrica de pijamas',
  'Remarketing lojistas',
  'Lançamento mensal',
  'Varejo multimarcas',
  'Pedido mínimo',
  'Linha infantil',
  'Linha plus size',
];
const OBJETIVOS = ['Leads', 'Conversão', 'Alcance', 'Catálogo'];

const HOSTS_BUSCA = ['www.google.com', 'www.google.com.br', 'www.bing.com', 'duckduckgo.com'];
const HOSTS_IA = ['chatgpt.com', 'perplexity.ai', 'claude.ai', 'gemini.google.com', 'copilot.microsoft.com'];
const HOSTS_REFERRAL = ['blog.exemplo.com.br', 'guia-de-lojistas.exemplo', 'feira-moda.exemplo'];

const LEGENDAS = [
  'Pijama de inverno em 12 cores',
  'Bastidores da fábrica',
  'Coleção nova no catálogo',
  'Como montar a vitrine de pijamas',
  'Pedido mínimo para lojistas',
  'Tecido flanelado: por que vende mais no frio',
  'Linha infantil chegando',
  'Combinação mãe e filha',
  'Kit atacado 12 peças',
  'Tour pelo showroom',
  'Camisola de alcinha para o verão',
  'Perguntas de lojistas respondidas',
  'Tabela de medidas',
  'Plus size com o mesmo caimento',
  'Como pedir pelo catálogo digital',
];

const slug = (texto: string): string =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const CPM_CENTS: Record<Platform, number> = { meta: 1800, tiktok: 900, google: 3500 };
const CTR: Record<Platform, number> = { meta: 0.012, tiktok: 0.008, google: 0.035 };
const CPL_CENTS: Record<Platform, number> = { meta: 2400, tiktok: 3200, google: 2800 };
/** O Claude sai um pouco diferente do humano, para cima ou para baixo conforme a plataforma. */
const AJUSTE_CLAUDE: Record<Platform, number> = { meta: 0.86, tiktok: 1.08, google: 0.92 };
const ORCAMENTO_CENTS: Record<Platform, [number, number]> = {
  meta: [8000, 40000],
  tiktok: [5000, 20000],
  google: [6000, 30000],
};

interface Contexto {
  rng: Prng;
  hoje: string;
  dias: string[];
  primeiroDia: string;
}

function gerarCampanhas(ctx: Contexto): Campaign[] {
  const { rng } = ctx;
  const campanhas: Campaign[] = [];
  let n = 0;
  for (const [indice, platform] of PLATAFORMAS.entries()) {
    const quantidade = rng.inteiro(6, 8);
    for (let i = 0; i < quantidade; i += 1) {
      n += 1;
      const brandId = MARCAS[i % 2]!;
      // Tema único dentro da plataforma (até 8 campanhas, 12 temas): utm_campaign nunca repete
      const tema = TEMAS[(i + indice * 4) % TEMAS.length]!;
      const objetivo = rng.escolher(OBJETIVOS);
      const managedBy: Operator = rng.chance(0.45) ? 'claude' : 'human';
      const status = rng.ponderado<CampaignStatus>([
        ['active', 70],
        ['paused', 20],
        ['ended', 10],
      ]);
      const [min, max] = ORCAMENTO_CENTS[platform];
      const dailyBudgetCents = Math.round(rng.entre(min, max) / 100) * 100;
      campanhas.push({
        id: `cmp-${platform}-${String(n).padStart(2, '0')}`,
        externalId: `${platform}:${1000 + n * 37}`,
        platform,
        brandId,
        name: `${brandId === 'cs' ? 'CS' : 'PL'} · ${tema} · ${objetivo}`,
        utmCampaign: `${brandId}-${platform}-${slug(tema)}-${slug(objetivo)}`,
        managedBy,
        status,
        dailyBudgetCents,
        spendCapCents: dailyBudgetCents * 45,
      });
    }
  }
  return campanhas;
}

/** Em que dias cada campanha gastou: encerrada e pausada param antes de hoje. */
function janelaDaCampanha(ctx: Contexto, campanha: Campaign): { inicio: string; fim: string } {
  const { rng, hoje, primeiroDia } = ctx;
  const inicio = rng.chance(0.3) ? somarDias(primeiroDia, rng.inteiro(5, 60)) : primeiroDia;
  if (campanha.status === 'ended') return { inicio, fim: somarDias(hoje, -rng.inteiro(25, 80)) };
  if (campanha.status === 'paused') return { inicio, fim: somarDias(hoje, -rng.inteiro(3, 40)) };
  return { inicio, fim: hoje };
}

function gerarMetricas(ctx: Contexto, campanhas: Campaign[]): DailyMetric[] {
  const { rng, dias } = ctx;
  const metricas: DailyMetric[] = [];
  for (const campanha of campanhas) {
    const janela = janelaDaCampanha(ctx, campanha);
    const rastreiaReceita = rng.chance(0.4);
    const ajuste = campanha.managedBy === 'claude' ? AJUSTE_CLAUDE[campanha.platform] : 1;
    for (const date of dias) {
      if (date < janela.inicio || date > janela.fim) continue;
      const fimDeSemana = [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());
      const spendCents = Math.round(
        campanha.dailyBudgetCents * rng.entre(0.72, 1.04) * (fimDeSemana ? 0.8 : 1),
      );
      const impressions = Math.round((spendCents / CPM_CENTS[campanha.platform]) * 1000 * rng.ruido(0.25));
      const clicks = Math.round(impressions * CTR[campanha.platform] * rng.ruido(0.3));
      const leads = Math.max(
        0,
        Math.round((spendCents / (CPL_CENTS[campanha.platform] * ajuste)) * rng.ruido(0.45)),
      );
      const conversions = Math.round(leads * rng.entre(0.06, 0.18));
      const revenueCents = rastreiaReceita ? conversions * Math.round(rng.entre(90000, 320000)) : 0;
      metricas.push({
        date,
        brandId: campanha.brandId,
        platform: campanha.platform,
        campaignId: campanha.id,
        spendCents,
        impressions,
        clicks,
        leads,
        conversions,
        revenueCents,
      });
    }
  }
  return metricas;
}

interface Carteira {
  leads: Lead[];
  clientes: Customer[];
  pedidos: Order[];
}

function gerarLeadsClientesPedidos(ctx: Contexto, campanhas: Campaign[], metricas: DailyMetric[]): Carteira {
  const { rng, dias, hoje, primeiroDia } = ctx;
  const diasComGasto = new Map<string, Set<string>>();
  for (const m of metricas) {
    const conjunto = diasComGasto.get(m.campaignId) ?? new Set<string>();
    conjunto.add(m.date);
    diasComGasto.set(m.campaignId, conjunto);
  }

  const totalLeads = rng.inteiro(380, 520);
  const leads: Lead[] = [];
  const clientes: Customer[] = [];
  const pedidos: Order[] = [];
  let numeroCliente = 0;
  let numeroPedido = 0;

  const novoCliente = (brand: Brand | null, firstOrderAt: string, repId: string | null): Customer => {
    numeroCliente += 1;
    const cliente: Customer = {
      id: `cli-${String(numeroCliente).padStart(4, '0')}`,
      code: codigo('CLI', numeroCliente),
      brands: brand ? [brand] : [rng.escolher(MARCAS)],
      situation: rng.chance(0.05) ? null : 'active',
      firstOrderAt,
      lastOrderAt: firstOrderAt,
      ordersCount: 1,
      revenueCents: 0,
      repId,
    };
    clientes.push(cliente);
    return cliente;
  };

  const novoPedido = (cliente: Customer, brandId: Brand, createdAt: string): Order => {
    numeroPedido += 1;
    const pedido: Order = {
      id: `ped-${String(numeroPedido).padStart(5, '0')}`,
      brandId,
      customerId: cliente.id,
      status: rng.chance(0.25) ? 'invoiced' : 'sent',
      totalCents: Math.round(rng.entre(80000, 600000) / 100) * 100,
      invoicedTotalCents: null, // "Sem dados" até o Control abrir o canal (decisão 0004)
      createdAt,
    };
    pedidos.push(pedido);
    cliente.revenueCents += pedido.totalCents;
    if (!cliente.brands.includes(brandId)) cliente.brands.push(brandId);
    if (!cliente.lastOrderAt || createdAt > cliente.lastOrderAt) cliente.lastOrderAt = createdAt;
    return pedido;
  };

  for (let i = 1; i <= totalLeads; i += 1) {
    const source = rng.ponderado<LeadSource>([
      ['meta', 30],
      ['google', 18],
      ['tiktok', 10],
      ['site', 8],
      ['organic', 12],
      ['ai_assistant', 6],
      ['sdr', 10],
      ['referral', 3],
      ['direct', 3],
    ]);
    const dia = rng.escolher(dias);
    const createdAt = instanteDe(dia, rng.inteiro(8, 20), rng.inteiro(0, 59));

    let brandId: Brand | null = rng.escolher(MARCAS);
    let utmCampaign: string | null = null;
    let referrerHost: string | null = null;

    if (source === 'meta' || source === 'google' || source === 'tiktok') {
      const ativas = campanhas.filter((c) => c.platform === source && diasComGasto.get(c.id)?.has(dia));
      const candidatas = ativas.length ? ativas : campanhas.filter((c) => c.platform === source);
      const campanha = rng.escolher(candidatas);
      brandId = campanha.brandId;
      utmCampaign = campanha.utmCampaign;
    } else if (source === 'organic') {
      referrerHost = rng.escolher(HOSTS_BUSCA);
    } else if (source === 'ai_assistant') {
      referrerHost = rng.escolher(HOSTS_IA);
    } else if (source === 'referral') {
      referrerHost = rng.escolher(HOSTS_REFERRAL);
    } else if (source === 'site') {
      referrerHost = brandId === 'cs' ? 'www.corposensual.com.br' : 'www.plumene.com.br';
    } else if (source === 'sdr') {
      brandId = null; // lead do SDR não tem marca (Parte 3 do prompt)
    }

    let stage = rng.ponderado<LeadStage>([
      ['lead', 35],
      ['prospect', 25],
      ['registered', 15],
      ['first_order', 18],
      ['invoiced', 7],
    ]);
    const repId = rng.chance(0.75) ? rng.escolher(REPRESENTANTES) : null;

    let firstOrderAt: string | null = null;
    let crmCustomerId: string | null = null;

    if (stage === 'first_order' || stage === 'invoiced') {
      const diaPedido = somarDias(dia, rng.inteiro(2, 35));
      if (diaPedido > hoje) {
        stage = 'registered';
      } else {
        firstOrderAt = instanteDe(diaPedido, rng.inteiro(9, 18), rng.inteiro(0, 59));
      }
    }

    if (stage === 'registered' || stage === 'first_order' || stage === 'invoiced') {
      const cliente = novoCliente(brandId, firstOrderAt ?? '', repId);
      if (!firstOrderAt) {
        cliente.firstOrderAt = null;
        cliente.lastOrderAt = null;
        cliente.ordersCount = 0;
        cliente.situation = 'lead';
      } else {
        const marcaDoPedido = brandId ?? rng.escolher(MARCAS);
        const pedido = novoPedido(cliente, marcaDoPedido, firstOrderAt);
        if (stage === 'invoiced') pedido.status = 'invoiced';
        // Recompra do cliente novo
        if (rng.chance(0.3)) {
          const outro = somarDias(diaSp(firstOrderAt), rng.inteiro(10, 40));
          if (outro <= hoje) {
            novoPedido(cliente, marcaDoPedido, instanteDe(outro, rng.inteiro(9, 18)));
            cliente.ordersCount += 1;
          }
        }
      }
      crmCustomerId = cliente.id;
    }

    leads.push({
      id: `lead-${String(i).padStart(4, '0')}`,
      code: codigo('LEAD', i),
      brandId,
      source,
      utmCampaign,
      referrerHost,
      stage,
      createdAt,
      firstOrderAt,
      repId,
      crmCustomerId,
    });
  }

  // Base antiga: clientes que já compravam antes da janela, até fechar 400
  const faltam = Math.max(0, 400 - clientes.length);
  for (let i = 0; i < faltam; i += 1) {
    const situation = rng.ponderado<CustomerSituation | null>([
      ['active', 50],
      ['inactive_recent', 18],
      ['inactive_old', 17],
      ['lost', 10],
      [null, 5],
    ]);
    const primeiroPedidoDia = somarDias(primeiroDia, -rng.inteiro(1, 480));
    const brands: Brand[] = rng.chance(0.25) ? ['cs', 'plumene'] : [rng.escolher(MARCAS)];
    numeroCliente += 1;
    const cliente: Customer = {
      id: `cli-${String(numeroCliente).padStart(4, '0')}`,
      code: codigo('CLI', numeroCliente),
      brands,
      situation,
      firstOrderAt: instanteDe(primeiroPedidoDia, 10),
      lastOrderAt: null,
      ordersCount: rng.inteiro(1, 30),
      revenueCents: 0,
      repId: rng.chance(0.85) ? rng.escolher(REPRESENTANTES) : null,
    };
    cliente.revenueCents = cliente.ordersCount * Math.round(rng.entre(90000, 400000) / 100) * 100;

    let ultimoDia: string;
    if (situation === 'active' || situation === null) ultimoDia = somarDias(hoje, -rng.inteiro(0, 85));
    else if (situation === 'inactive_recent') ultimoDia = somarDias(hoje, -rng.inteiro(91, 180));
    else if (situation === 'inactive_old') ultimoDia = somarDias(hoje, -rng.inteiro(181, 365));
    else ultimoDia = somarDias(hoje, -rng.inteiro(366, 700));
    if (ultimoDia < primeiroPedidoDia) ultimoDia = primeiroPedidoDia;
    cliente.lastOrderAt = instanteDe(ultimoDia, 11);

    // Pedidos dentro da janela: ativos compram de novo; alguns inativos voltam (reativados)
    if (situation === 'active' || situation === null) {
      const quantidade = rng.inteiro(1, 3);
      for (let p = 0; p < quantidade; p += 1) {
        const dia = somarDias(hoje, -rng.inteiro(0, 115));
        novoPedido(cliente, rng.escolher(brands), instanteDe(dia, rng.inteiro(9, 18)));
      }
    } else if ((situation === 'inactive_recent' || situation === 'inactive_old') && rng.chance(0.22)) {
      const dia = somarDias(hoje, -rng.inteiro(0, 25));
      novoPedido(cliente, rng.escolher(brands), instanteDe(dia, rng.inteiro(9, 18)));
      cliente.situation = 'active';
      cliente.ordersCount += 1;
    }
    clientes.push(cliente);
  }

  return { leads, clientes, pedidos };
}

function gerarInstagram(ctx: Contexto): { diario: IgDaily[]; posts: IgMedia[] } {
  const { rng, dias } = ctx;
  const diario: IgDaily[] = [];
  const posts: IgMedia[] = [];
  const seguidoresIniciais: Record<Brand, number> = { cs: 12400, plumene: 3900 };
  const alcanceBase: Record<Brand, [number, number]> = { cs: [900, 6000], plumene: [300, 2200] };

  for (const brandId of MARCAS) {
    let followers = seguidoresIniciais[brandId];
    for (const date of dias) {
      followers += rng.inteiro(-3, brandId === 'cs' ? 28 : 14);
      const [min, max] = alcanceBase[brandId];
      const reach = rng.inteiro(min, max);
      diario.push({
        date,
        brandId,
        followers,
        reach,
        impressions: Math.round(reach * rng.entre(1.3, 1.9)),
        engagement: Math.round(reach * rng.entre(0.03, 0.09)),
      });
    }
    for (let i = 0; i < 30; i += 1) {
      const dia = rng.escolher(dias);
      const type = rng.ponderado<IgMediaType>([
        ['image', 35],
        ['carousel', 30],
        ['reel', 30],
        ['video', 5],
      ]);
      const [min, max] = alcanceBase[brandId];
      const reach = rng.inteiro(min, max * (type === 'reel' ? 2.5 : 1.2));
      posts.push({
        id: `ig-${brandId}-${String(i + 1).padStart(2, '0')}`,
        brandId,
        publishedAt: instanteDe(dia, rng.inteiro(9, 20), rng.inteiro(0, 59)),
        type,
        caption: LEGENDAS[(i * 7 + (brandId === 'cs' ? 0 : 3)) % LEGENDAS.length]!,
        reach,
        likes: Math.round(reach * rng.entre(0.04, 0.11)),
        comments: rng.inteiro(0, 45),
        saves: rng.inteiro(0, Math.round(reach * 0.03)),
      });
    }
  }
  return { diario, posts };
}

function gerarSeoGeo(ctx: Contexto): { seo: SeoDaily[]; geo: GeoDaily[] } {
  const { rng, dias } = ctx;
  const seo: SeoDaily[] = [];
  const geo: GeoDaily[] = [];
  const impressoesBase: Record<Brand, [number, number]> = { cs: [1500, 3500], plumene: [600, 1800] };
  const sessoesBase: Record<GeoSource, [number, number]> = {
    chatgpt: [3, 25],
    perplexity: [0, 8],
    claude: [0, 5],
    gemini: [1, 10],
    copilot: [0, 4],
  };

  for (const brandId of MARCAS) {
    let posicao = rng.entre(12, 20);
    for (const date of dias) {
      const [min, max] = impressoesBase[brandId];
      const impressions = rng.inteiro(min, max);
      posicao = Math.min(30, Math.max(4, posicao + rng.entre(-0.4, 0.35)));
      seo.push({
        date,
        brandId,
        impressions,
        clicks: Math.round(impressions * rng.entre(0.02, 0.045)),
        position: Math.round(posicao * 10) / 10,
      });
      for (const source of Object.keys(sessoesBase) as GeoSource[]) {
        const [a, b] = sessoesBase[source];
        const sessions = rng.inteiro(a, b);
        geo.push({ date, brandId, source, sessions, leads: sessions > 0 && rng.chance(0.06) ? 1 : 0 });
      }
    }
  }
  return { seo, geo };
}

/** Uma etapa nunca vem antes da anterior: sorteada antes, fica 1 h depois dela. */
function depoisDe(instante: string, anterior: string): string {
  return instante > anterior ? instante : new Date(Date.parse(anterior) + 3_600_000).toISOString();
}

function gerarAcoes(ctx: Contexto, campanhas: Campaign[]): TrafficAction[] {
  const { rng, hoje } = ctx;
  const acoes: TrafficAction[] = [];
  const modelos: Array<{
    kind: ActionKind;
    titulo: (c: Campaign | null) => string;
    motivo: (c: Campaign | null) => string;
    params: (c: Campaign | null) => Record<string, unknown>;
    custo: (c: Campaign | null) => number | null;
  }> = [
    {
      kind: 'budget',
      titulo: (c) => `Subir 20% o orçamento de ${c?.name ?? 'campanha'}`,
      motivo: () =>
        `CPL ${rng.inteiro(12, 30)}% abaixo da média do canal nos últimos 14 dias, com teto da conta folgado.`,
      params: (c) => ({ dailyBudgetCents: Math.round((c?.dailyBudgetCents ?? 10000) * 1.2) }),
      custo: (c) => Math.round((c?.dailyBudgetCents ?? 10000) * 0.2 * 30),
    },
    {
      kind: 'pause',
      titulo: (c) => `Pausar ${c?.name ?? 'campanha'}`,
      motivo: () =>
        `CPL ${rng.inteiro(35, 80)}% acima da meta por ${rng.inteiro(5, 12)} dias seguidos e sem cliente novo atribuído.`,
      params: () => ({ status: 'paused' }),
      custo: () => 0,
    },
    {
      kind: 'creative',
      titulo: (c) => `Trocar o criativo principal de ${c?.name ?? 'campanha'}`,
      motivo: () => `CTR caiu ${rng.inteiro(20, 45)}% em duas semanas: sinal de desgaste do anúncio.`,
      params: () => ({ creative: 'novo-video-15s' }),
      custo: () => 0,
    },
    {
      kind: 'create',
      titulo: (c) =>
        `Criar campanha de remarketing para ${c?.brandId === 'plumene' ? 'Plumene' : 'Corpo Sensual'}`,
      motivo: () => `${rng.inteiro(200, 900)} visitantes do catálogo sem pedido nos últimos 30 dias.`,
      params: () => ({ objective: 'conversions', dailyBudgetCents: 9000 }),
      custo: () => 9000 * 30,
    },
    {
      kind: 'bid',
      titulo: (c) => `Ajustar lance em ${c?.name ?? 'campanha'}`,
      motivo: () => `Parcela de impressões perdida por lance em ${rng.inteiro(20, 50)}% das buscas.`,
      params: () => ({ bidStrategy: 'target_cpa', targetCpaCents: 2600 }),
      custo: () => null,
    },
  ];

  const statuses: ActionStatus[] = [
    'idea',
    'idea',
    'idea',
    'idea',
    'idea',
    'approved',
    'approved',
    'running',
    'done',
    'done',
    'done',
    'discarded',
  ];
  const total = rng.inteiro(16, 22);

  for (let i = 0; i < total; i += 1) {
    const proposedBy: Operator = i % 2 === 0 ? 'claude' : 'human';
    const modelo = rng.escolher(modelos);
    const campanha = rng.escolher(campanhas);
    const status = statuses[i % statuses.length]!;
    const criadoDia = somarDias(hoje, -rng.inteiro(0, 45));
    const createdAt = instanteDe(criadoDia, rng.inteiro(8, 19), rng.inteiro(0, 59));
    const aprovado = status !== 'idea' && status !== 'discarded';
    const approvedAt = aprovado
      ? depoisDe(instanteDe(somarDias(criadoDia, rng.inteiro(0, 3)), rng.inteiro(9, 18)), createdAt)
      : null;
    const executado = status === 'done' || status === 'running';
    const executedAt =
      executado && approvedAt
        ? depoisDe(
            instanteDe(somarDias(diaSp(approvedAt), rng.inteiro(0, 2)), rng.inteiro(9, 18)),
            approvedAt,
          )
        : null;
    acoes.push({
      id: `act-${String(i + 1).padStart(3, '0')}`,
      proposedBy,
      brandId: campanha.brandId,
      platform: campanha.platform,
      campaignId: modelo.kind === 'create' ? null : campanha.id,
      title: modelo.titulo(campanha),
      rationale: modelo.motivo(campanha),
      kind: modelo.kind,
      paramsJson: JSON.stringify(modelo.params(campanha)),
      status,
      impact: rng.escolher<Level>(['low', 'medium', 'high']),
      effort: rng.escolher<Level>(['low', 'medium', 'high']),
      costCents: modelo.custo(campanha),
      createdAt,
      approvedBy: aprovado ? PERFIL_DEMONSTRACAO.id : null,
      approvedAt,
      executedAt,
      result:
        status === 'done'
          ? `Feita. CPL ${rng.inteiro(4, 22)}% ${rng.chance(0.7) ? 'menor' : 'maior'} nos 7 dias seguintes.`
          : status === 'discarded'
            ? 'Descartada: o gestor preferiu esperar o fim do mês.'
            : null,
    });
  }

  // Pendências que travam medição, uma por marca (lista "O que podemos fazer")
  for (const brandId of MARCAS) {
    acoes.push({
      id: `act-fix-${brandId}`,
      proposedBy: 'human',
      brandId,
      platform: null,
      campaignId: null,
      title: 'GA4 sem ID no site',
      rationale: 'Sem o ID do GA4 na Vercel do site, sessões e canal "AI Assistant" não medem nada.',
      kind: 'pending_fix',
      paramsJson: JSON.stringify({ env: 'NEXT_PUBLIC_GA_ID' }),
      status: 'idea',
      impact: 'high',
      effort: 'low',
      costCents: 0,
      createdAt: instanteDe(somarDias(hoje, -12), 10),
      approvedBy: null,
      approvedAt: null,
      executedAt: null,
      result: null,
    });
  }

  return acoes.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function gerarConectores(agora: Date): Connector[] {
  const ha = (minutos: number): string => new Date(agora.getTime() - minutos * 60_000).toISOString();
  return [
    {
      id: 'meta',
      name: 'Meta Ads',
      status: 'ok',
      lastSyncAt: ha(12),
      expectedEveryMinutes: 60,
      errors24h: 0,
      rowsWritten: 1840,
    },
    {
      id: 'instagram',
      name: 'Instagram',
      status: 'ok',
      lastSyncAt: ha(25),
      expectedEveryMinutes: 60,
      errors24h: 0,
      rowsWritten: 62,
    },
    {
      id: 'tiktok',
      name: 'TikTok Ads',
      status: 'late',
      lastSyncAt: ha(190),
      expectedEveryMinutes: 60,
      errors24h: 3,
      rowsWritten: 410,
    },
    {
      id: 'google_ads',
      name: 'Google Ads',
      status: 'ok',
      lastSyncAt: ha(40),
      expectedEveryMinutes: 60,
      errors24h: 0,
      rowsWritten: 1210,
    },
    {
      id: 'ga4',
      name: 'GA4',
      status: 'simulated',
      lastSyncAt: null,
      expectedEveryMinutes: 1440,
      errors24h: 0,
      rowsWritten: 0,
    },
    {
      id: 'search_console',
      name: 'Search Console',
      status: 'ok',
      lastSyncAt: ha(6 * 60),
      expectedEveryMinutes: 1440,
      errors24h: 0,
      rowsWritten: 96,
    },
    {
      id: 'csp360',
      name: 'CSP 360',
      status: 'ok',
      lastSyncAt: ha(3),
      expectedEveryMinutes: 5,
      errors24h: 0,
      rowsWritten: 5320,
    },
  ];
}

/**
 * Nada de exemplo fica depois de agora. Os geradores sorteiam horas de 8 a 20 h e somam dias,
 * então parte do que cai hoje (ou depois) estaria no futuro. O que é de hoje é comprimido para
 * entre 0 h e agora, sem mudar a ordem; o que caiu num dia depois de hoje vira agora.
 */
function semFuturo(agora: Date, hoje: string): (instante: string) => string {
  const DIA_MS = 86_400_000;
  const inicio = Date.parse(instanteDe(hoje, 0));
  const fator = (agora.getTime() - inicio) / DIA_MS;
  return (instante) => {
    const t = Date.parse(instante);
    if (t < inicio) return instante;
    if (t >= inicio + DIA_MS) return agora.toISOString();
    return new Date(inicio + Math.round((t - inicio) * fator)).toISOString();
  };
}

export function gerarDadosDeExemplo(opcoes: OpcoesDeExemplo = {}): Dados {
  const { semente = SEMENTE_PADRAO, agora = new Date(), dias: quantidade = 120 } = opcoes;
  const rng = criarPrng(semente);
  const hoje = diaSp(agora);
  const primeiroDia = somarDias(hoje, -(quantidade - 1));
  const dias: string[] = [];
  for (let i = quantidade - 1; i >= 0; i -= 1) dias.push(somarDias(hoje, -i));
  const ctx: Contexto = { rng, hoje, dias, primeiroDia };

  const campaigns = gerarCampanhas(ctx);
  const metrics = gerarMetricas(ctx, campaigns);
  const carteira = gerarLeadsClientesPedidos(ctx, campaigns, metrics);
  const instagram = gerarInstagram(ctx);
  const seoGeo = gerarSeoGeo(ctx);
  const actions = gerarAcoes(ctx, campaigns);

  const ate = semFuturo(agora, hoje);
  const talvez = (instante: string | null): string | null => (instante ? ate(instante) : instante);
  for (const lead of carteira.leads) {
    lead.createdAt = ate(lead.createdAt);
    lead.firstOrderAt = talvez(lead.firstOrderAt);
  }
  for (const cliente of carteira.clientes) {
    cliente.firstOrderAt = talvez(cliente.firstOrderAt);
    cliente.lastOrderAt = talvez(cliente.lastOrderAt);
  }
  for (const pedido of carteira.pedidos) pedido.createdAt = ate(pedido.createdAt);
  for (const post of instagram.posts) post.publishedAt = ate(post.publishedAt);
  for (const acao of actions) {
    acao.createdAt = ate(acao.createdAt);
    acao.approvedAt = talvez(acao.approvedAt);
    acao.executedAt = talvez(acao.executedAt);
  }

  return {
    campaigns,
    metrics,
    leads: carteira.leads,
    customers: carteira.clientes,
    orders: carteira.pedidos,
    igDaily: instagram.diario,
    igMedia: instagram.posts,
    seoDaily: seoGeo.seo,
    geoDaily: seoGeo.geo,
    actions,
    connectors: gerarConectores(agora),
    profiles: [PERFIL_DEMONSTRACAO],
    geradoEm: agora.toISOString(),
  };
}

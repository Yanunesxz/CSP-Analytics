/**
 * Painel da tela SEO e GEO (`/seo-geo`): consulta pura, com teste em `seo-geo.test.ts`.
 * Na fase 3 vira as views `kpi_seo` e `kpi_geo` e a leitura da checagem diária dos sites.
 *
 * Quatro blocos, um por fonte (cada um com a sincronização da sua fonte):
 * - Busca orgânica (Search Console, relatório "Web"): impressões, cliques, CTR e posição média vêm de
 *   `seoGeo()` de `queries.ts` (a mesma conta das outras telas); cliques e posição por dia, por marca;
 *   e as consultas que mais trazem cliques.
 * - Assistentes de IA (GA4): sessões por assistente (`geoDaily`), sessões de IA por dia e as sessões de
 *   todos os canais do site, para a parcela que veio de IA.
 * - Leads e clientes novos (CSP 360): os leads cuja origem é busca orgânica ou assistente de IA, por
 *   buscador e por assistente, pelo endereço de onde a pessoa veio (`referrerHost`). Sem dado pessoal.
 * - Checagem dos sites: robots.txt, llms.txt e JSON-LD de cada site.
 *
 * O que `Dados` ainda não tem — as consultas do Search Console, as sessões por canal do GA4 e a checagem
 * dos sites — chega por `ComplementosSeoGeo`. No modo demonstração com dados de exemplo, `painelSeoGeo`
 * gera os complementos a partir do próprio conjunto (`complementosDeExemplo`, determinístico); fora dele
 * vêm vazios e a tela mostra "Sem dados", para nunca pôr número inventado ao lado de número real. Quando
 * `Dados` e o gerador de `sample/` ganharem esses campos, os complementos saem daqui.
 *
 * Convenções de `queries.ts`: métrica sem base = null (nunca 0 nem NaN); contagem sobre tabela vazia =
 * null, sobre tabela com linhas = 0 ou mais; marca escolhida inclui o dado sem marca; cliente novo = 1º
 * pedido enviado no período, um por `crmCustomerId` (decisão 0012). Os filtros de lead da URL (origem,
 * canal, campanha, operador, representante) valem só para os leads; Search Console e GA4 respondem a
 * marca e período.
 */

import type { Brand, ConnectorStatus, GeoSource, Lead } from '@csp-mkt/shared';
import { rotulo } from '@csp-mkt/shared';
import { diaSp, diasEntre, instanteDe, somarDias } from '../../lib/datas';
import type { Intervalo } from '../../lib/periodo';
import type { Filtros } from '../../lib/url-state';
import type { Dados } from '../dados';
import {
  acoes,
  // Leads e cliente novo com a mesma regra da fundação (nenhuma regra em dois lugares)
  clientesNovos,
  conectores,
  contagem,
  filtrarMarca,
  filtrarPeriodo,
  leadsFiltrados as leadsQueRespeitam,
  metrica,
  razao,
  seoGeo,
  type Janela,
  type Metrica,
} from '../queries';
import { store } from '../store';

/* ---------- Complementos: o que `Dados` ainda não tem ---------- */

/** Canal do GA4 no grupo de canais do CSP-MKT. "Assistente de IA" é o grupo próprio (AI Assistant). */
export type Ga4Channel =
  | 'organic_search'
  | 'ai_assistant'
  | 'direct'
  | 'paid_search'
  | 'paid_social'
  | 'organic_social'
  | 'referral';

/** Uma consulta num dia, como o Search Console devolve no relatório "Web" (dimensão `query`). */
export interface SeoQueryDaily {
  date: string;
  brandId: Brand;
  query: string;
  impressions: number;
  clicks: number;
  position: number;
}

/** Sessões de um canal do GA4 num dia. */
export interface Ga4ChannelDaily {
  date: string;
  brandId: Brand;
  channel: Ga4Channel;
  sessions: number;
}

export type SiteCheckItem = 'robots_txt' | 'llms_txt' | 'json_ld';
export type SiteCheckStatus = 'ok' | 'warning';

/** Resultado da checagem diária de um item do site. */
export interface SiteCheck {
  brandId: Brand;
  host: string;
  item: SiteCheckItem;
  status: SiteCheckStatus;
  /** O que foi encontrado e, quando pede atenção, o que fazer. */
  detail: string;
  checkedAt: string;
}

export interface ComplementosSeoGeo {
  consultas: SeoQueryDaily[];
  canais: Ga4ChannelDaily[];
  checagens: SiteCheck[];
}

export const COMPLEMENTOS_VAZIOS: Readonly<ComplementosSeoGeo> = Object.freeze({
  consultas: [],
  canais: [],
  checagens: [],
});

/* ---------- Rótulos das listas desta tela (vão para labels.ts quando a lista entrar no shared) ---------- */

export const ROTULO_CANAL_GA4: Readonly<Record<Ga4Channel, string>> = {
  organic_search: 'Busca orgânica',
  ai_assistant: 'Assistente de IA',
  direct: 'Direto',
  paid_search: 'Busca paga',
  paid_social: 'Social pago',
  organic_social: 'Social orgânico',
  referral: 'Indicação',
};

export const ITENS_DA_CHECAGEM: readonly SiteCheckItem[] = ['robots_txt', 'llms_txt', 'json_ld'];

export const ROTULO_ITEM_DA_CHECAGEM: Readonly<Record<SiteCheckItem, string>> = {
  robots_txt: 'robots.txt',
  llms_txt: 'llms.txt',
  json_ld: 'JSON-LD',
};

export const ESTADO_DA_CHECAGEM: Readonly<
  Record<SiteCheckStatus, { rotulo: string; tom: 'success' | 'warning' }>
> = {
  ok: { rotulo: 'Em ordem', tom: 'success' },
  warning: { rotulo: 'Atenção', tom: 'warning' },
};

/** Quantas consultas a tabela mostra. */
export const LIMITE_DE_CONSULTAS = 10;

/* ---------- Origem pelo endereço (referrer) ---------- */

function normalizarHost(valor: string | null | undefined): string {
  let h = (valor ?? '').trim().toLowerCase();
  if (h.includes('://')) {
    try {
      h = new URL(h).hostname;
    } catch {
      /* fica como veio */
    }
  }
  return h.replace(/^(www|m)\./, '');
}

function ehDominio(host: string, dominio: string): boolean {
  return host === dominio || host.endsWith(`.${dominio}`);
}

/**
 * Qual assistente de IA trouxe o lead, pelo host do `referrer`; null quando não é um dos cinco.
 * Os hosts são os de `ehAssistenteDeIa` (packages/shared/rules.ts).
 */
export function assistenteDoHost(host: string | null | undefined): GeoSource | null {
  const h = normalizarHost(host);
  if (!h) return null;
  if (ehDominio(h, 'chatgpt.com') || ehDominio(h, 'chat.openai.com')) return 'chatgpt';
  if (ehDominio(h, 'perplexity.ai')) return 'perplexity';
  if (ehDominio(h, 'claude.ai')) return 'claude';
  if (ehDominio(h, 'gemini.google.com')) return 'gemini';
  if (ehDominio(h, 'copilot.microsoft.com')) return 'copilot';
  return null;
}

export interface Buscador {
  chave: string;
  rotulo: string;
}

/** Buscador de um lead de busca orgânica, pelo host do `referrer`. */
export function buscadorDoHost(host: string | null | undefined): Buscador {
  const h = normalizarHost(host);
  if (!h) return { chave: 'sem-endereco', rotulo: 'Sem endereço de origem' };
  if (/(^|\.)google\./.test(h)) return { chave: 'google', rotulo: 'Google' };
  if (ehDominio(h, 'bing.com')) return { chave: 'bing', rotulo: 'Bing' };
  if (ehDominio(h, 'duckduckgo.com')) return { chave: 'duckduckgo', rotulo: 'DuckDuckGo' };
  if (/(^|\.)yahoo\./.test(h)) return { chave: 'yahoo', rotulo: 'Yahoo' };
  if (/(^|\.)ecosia\./.test(h)) return { chave: 'ecosia', rotulo: 'Ecosia' };
  return { chave: 'outro', rotulo: 'Outro buscador' };
}

/* ---------- Tipos de saída ---------- */

/** Um ponto da série diária: dia `AAAA-MM-DD` e o número do dia (null quando não chegou). */
export interface PontoDiario {
  x: string;
  y: number | null;
}

export interface SerieDaMarca {
  marca: Brand;
  pontos: PontoDiario[];
}

export type IdDaFonte = 'search_console' | 'ga4' | 'csp360';

/** O cartão do conector de cada fonte, para o selo da seção e o aviso de atraso. */
export interface FonteDoPainel {
  id: IdDaFonte;
  status: ConnectorStatus;
  lastSyncAt: string | null;
  atrasado: boolean;
}

export interface LinhaConsulta {
  chave: string;
  consulta: string;
  marca: Brand;
  impressoes: number;
  cliques: number;
  ctr: number | null;
  /** Posição média ponderada pelas impressões. */
  posicao: number | null;
}

export interface LinhaAssistente {
  fonte: GeoSource;
  sessoes: Metrica;
  /** Parte das sessões de IA do período que veio deste assistente. */
  parcela: number | null;
}

export interface LinhaCanal {
  canal: Ga4Channel;
  sessoes: number;
  /** Parte das sessões do site no período. */
  parcela: number | null;
}

export type OrigemSeoGeo = Extract<Lead['source'], 'organic' | 'ai_assistant'>;

export interface LinhaFonteDeLead {
  chave: string;
  origem: OrigemSeoGeo;
  /** Buscador (Google, Bing…) ou assistente (ChatGPT…), já em português. */
  fonte: string;
  /** Na origem assistente de IA, qual é (para a cor da série); null nos buscadores. */
  assistente: GeoSource | null;
  leads: Metrica;
  clientesNovos: Metrica;
}

export interface ItemDoSite {
  item: SiteCheckItem;
  status: SiteCheckStatus;
  detalhe: string;
}

export interface SiteDoPainel {
  marca: Brand;
  host: string;
  itens: ItemDoSite[];
  conferidoEm: string | null;
  emAtencao: number;
}

/** Pendência aberta que trava a medição (ex.: "GA4 sem ID no site"), da lista de Tráfego com IA. */
export interface PendenciaDeMedicao {
  id: string;
  titulo: string;
  marca: Brand;
}

export interface PainelSeoGeo {
  intervalo: Intervalo;
  /** A sincronização mais antiga entre as fontes da tela, para o "atualizado há X min". */
  atualizadoEm: string | null;
  /** null quando o cartão do conector não existe no conjunto. */
  fontes: Record<IdDaFonte, FonteDoPainel | null>;
  seo: {
    impressoes: Metrica;
    cliques: Metrica;
    ctr: Metrica;
    posicaoMedia: Metrica;
    cliquesPorDia: SerieDaMarca[];
    posicaoPorDia: SerieDaMarca[];
    /** As consultas com mais cliques no período (até `LIMITE_DE_CONSULTAS`). */
    consultas: LinhaConsulta[];
    /** Cliques das consultas listadas ÷ cliques do período (o Search Console esconde as raras). */
    participacaoDasConsultas: number | null;
    /** Alguma consulta chegou do Search Console? Separa "Sem dados" de "nada no período". */
    temConsultas: boolean;
  };
  geo: {
    sessoes: Metrica;
    /** Sessões de IA ÷ sessões de todos os canais do GA4. */
    parcelaDasSessoes: Metrica;
    porAssistente: LinhaAssistente[];
    /** Canais com sessão no período, do maior para o menor. */
    porCanal: LinhaCanal[];
    sessoesPorDia: SerieDaMarca[];
    temCanais: boolean;
  };
  leads: {
    buscaOrganica: Metrica;
    clientesNovosDaBusca: Metrica;
    assistentesDeIa: Metrica;
    clientesNovosDeIa: Metrica;
    /** Busca orgânica primeiro, depois assistentes de IA; em cada uma, do maior para o menor. */
    porFonte: LinhaFonteDeLead[];
  };
  sites: SiteDoPainel[];
  pendencias: PendenciaDeMedicao[];
}

/* ---------- Utilidades ---------- */

function agrupar<T>(linhas: readonly T[], chave: (linha: T) => string): Map<string, T[]> {
  const grupos = new Map<string, T[]>();
  for (const linha of linhas) {
    const k = chave(linha);
    const grupo = grupos.get(k);
    if (grupo) grupo.push(linha);
    else grupos.set(k, [linha]);
  }
  return grupos;
}

function somar<T>(linhas: readonly T[], valor: (linha: T) => number): number {
  let total = 0;
  for (const linha of linhas) total += valor(linha);
  return total;
}

/** Posição média ponderada pelas impressões (como o Search Console); sem impressões, a média simples. */
function posicaoMedia(linhas: ReadonlyArray<{ position: number; impressions: number }>): number | null {
  if (linhas.length === 0) return null;
  const impressoes = somar(linhas, (l) => l.impressions);
  if (impressoes > 0) return somar(linhas, (l) => l.position * l.impressions) / impressoes;
  return somar(linhas, (l) => l.position) / linhas.length;
}

function instanteEmMs(valor: string): number {
  const ms = new Date(valor).getTime();
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/* ---------- Consulta ---------- */

/**
 * O painel inteiro, com os complementos recebidos. Pura: é o que os testes exercitam.
 * A tela usa `painelSeoGeo`, que escolhe os complementos.
 */
export function montarPainelSeoGeo(
  dados: Dados,
  filtros: Filtros,
  agora: Date = new Date(),
  complementos: Readonly<ComplementosSeoGeo> = COMPLEMENTOS_VAZIOS,
): PainelSeoGeo {
  const base = seoGeo(dados, filtros, agora);
  const { intervalo } = base;
  const antes: Janela = { inicio: intervalo.anteriorInicio, fim: intervalo.anteriorFim };
  const c = filtros.comparar;
  const marcas: Brand[] = filtros.marca === 'todas' ? ['cs', 'plumene'] : [filtros.marca];
  const dias = diasEntre(intervalo.inicio, intervalo.fim);

  /* Busca orgânica por dia e marca */
  const seoDoDia = agrupar(filtrarMarca(dados.seoDaily, filtros.marca), (l) => `${l.brandId}|${l.date}`);
  const cliquesPorDia = marcas.map((marca) => ({
    marca,
    pontos: dias.map((x) => {
      const linhas = seoDoDia.get(`${marca}|${x}`);
      return { x, y: linhas ? somar(linhas, (l) => l.clicks) : null };
    }),
  }));
  const posicaoPorDia = marcas.map((marca) => ({
    marca,
    pontos: dias.map((x) => ({ x, y: posicaoMedia(seoDoDia.get(`${marca}|${x}`) ?? []) })),
  }));

  /* Consultas que mais trazem */
  const consultasDoPeriodo = filtrarPeriodo(
    filtrarMarca(complementos.consultas, filtros.marca),
    'date',
    intervalo,
  );
  const consultas = [...agrupar(consultasDoPeriodo, (q) => `${q.brandId}|${q.query}`).entries()]
    .map(([chave, linhas]): LinhaConsulta => {
      const impressoes = somar(linhas, (l) => l.impressions);
      const cliques = somar(linhas, (l) => l.clicks);
      return {
        chave,
        consulta: linhas[0]!.query,
        marca: linhas[0]!.brandId,
        impressoes,
        cliques,
        ctr: razao(cliques, impressoes),
        posicao: posicaoMedia(linhas),
      };
    })
    .sort(
      (a, b) =>
        b.cliques - a.cliques || b.impressoes - a.impressoes || a.consulta.localeCompare(b.consulta, 'pt-BR'),
    )
    .slice(0, LIMITE_DE_CONSULTAS);
  const participacaoDasConsultas = consultas.length
    ? razao(
        somar(consultas, (q) => q.cliques),
        base.seo.cliques.atual,
      )
    : null;

  /* Assistentes de IA: sessões por assistente e por dia */
  const totalDeIa = base.geo.sessoes.atual;
  const porAssistente = base.geo.porFonte
    .map((f): LinhaAssistente => ({
      fonte: f.fonte,
      sessoes: f.sessoes,
      parcela: razao(f.sessoes.atual, totalDeIa),
    }))
    .sort((a, b) => (b.sessoes.atual ?? -1) - (a.sessoes.atual ?? -1));
  const geoDoDia = agrupar(filtrarMarca(dados.geoDaily, filtros.marca), (l) => `${l.brandId}|${l.date}`);
  const sessoesPorDia = marcas.map((marca) => ({
    marca,
    pontos: dias.map((x) => {
      const linhas = geoDoDia.get(`${marca}|${x}`);
      return { x, y: linhas ? somar(linhas, (l) => l.sessions) : null };
    }),
  }));

  /* Sessões por canal do GA4 e a parcela de IA */
  const temCanais = complementos.canais.length > 0;
  const canaisDaMarca = filtrarMarca(complementos.canais, filtros.marca);
  const sessoesDosCanais = (janela: Janela) => {
    const porCanal = new Map<Ga4Channel, number>();
    for (const l of filtrarPeriodo(canaisDaMarca, 'date', janela)) {
      porCanal.set(l.channel, (porCanal.get(l.channel) ?? 0) + l.sessions);
    }
    return {
      porCanal,
      total: temCanais ? somar([...porCanal.values()], (v) => v) : null,
      ia: temCanais ? (porCanal.get('ai_assistant') ?? 0) : null,
    };
  };
  const canaisAgora = sessoesDosCanais(intervalo);
  const canaisAntes = sessoesDosCanais(antes);
  const porCanal = [...canaisAgora.porCanal.entries()]
    .filter(([, sessoes]) => sessoes > 0)
    .map(([canal, sessoes]): LinhaCanal => ({ canal, sessoes, parcela: razao(sessoes, canaisAgora.total) }))
    .sort((a, b) => b.sessoes - a.sessoes);

  /* Leads e clientes novos da busca orgânica e de IA (CSP 360, pelo referrer) */
  const leads = leadsQueRespeitam(dados, filtros);
  const organicos = leads.filter((l) => l.source === 'organic');
  const deIa = leads.filter((l) => l.source === 'ai_assistant');
  const contarLeads = (lista: readonly Lead[], janela: Janela) =>
    contagem(dados.leads, filtrarPeriodo(lista, 'createdAt', janela));
  const contarNovos = (lista: readonly Lead[], janela: Janela) =>
    contagem(dados.leads, clientesNovos(lista, janela));
  const metricaDeLeads = (lista: readonly Lead[]) =>
    metrica(contarLeads(lista, intervalo), contarLeads(lista, antes), c);
  const metricaDeNovos = (lista: readonly Lead[]) =>
    metrica(contarNovos(lista, intervalo), contarNovos(lista, antes), c);

  const linhaDeFonte = (
    origem: OrigemSeoGeo,
    chave: string,
    fonte: string,
    assistente: GeoSource | null,
    lista: readonly Lead[],
  ): LinhaFonteDeLead => ({
    chave: `${origem}:${chave}`,
    origem,
    fonte,
    assistente,
    leads: metricaDeLeads(lista),
    clientesNovos: metricaDeNovos(lista),
  });
  const temMovimento = (l: LinhaFonteDeLead) =>
    (l.leads.atual ?? 0) > 0 || (l.leads.anterior ?? 0) > 0 || (l.clientesNovos.atual ?? 0) > 0;
  const doMaiorParaOMenor = (a: LinhaFonteDeLead, b: LinhaFonteDeLead) =>
    (b.leads.atual ?? 0) - (a.leads.atual ?? 0) ||
    (b.clientesNovos.atual ?? 0) - (a.clientesNovos.atual ?? 0) ||
    a.fonte.localeCompare(b.fonte, 'pt-BR');

  const porBuscador = [...agrupar(organicos, (l) => buscadorDoHost(l.referrerHost).chave).entries()]
    .map(([chave, lista]) =>
      linhaDeFonte('organic', chave, buscadorDoHost(lista[0]!.referrerHost).rotulo, null, lista),
    )
    .filter(temMovimento)
    .sort(doMaiorParaOMenor);
  const chaveDoAssistente = (l: Lead): string =>
    assistenteDoHost(l.referrerHost) ?? (normalizarHost(l.referrerHost) ? 'outro' : 'sem-endereco');
  const rotuloDoAssistente = (chave: string): string =>
    chave === 'outro'
      ? 'Outro assistente'
      : chave === 'sem-endereco'
        ? 'Sem endereço de origem'
        : rotulo('geoSource', chave);
  const porAssistenteDeLead = [...agrupar(deIa, chaveDoAssistente).entries()]
    .map(([chave, lista]) =>
      linhaDeFonte(
        'ai_assistant',
        chave,
        rotuloDoAssistente(chave),
        chave === 'outro' || chave === 'sem-endereco' ? null : (chave as GeoSource),
        lista,
      ),
    )
    .filter(temMovimento)
    .sort(doMaiorParaOMenor);

  /* Checagem dos sites: o resultado mais recente de cada item */
  const checagens = filtrarMarca(complementos.checagens, filtros.marca);
  const sites = marcas.flatMap((marca): SiteDoPainel[] => {
    const doSite = checagens
      .filter((x) => x.brandId === marca)
      .sort((a, b) => instanteEmMs(b.checkedAt) - instanteEmMs(a.checkedAt));
    const maisRecente = doSite[0];
    if (!maisRecente) return [];
    const itens = ITENS_DA_CHECAGEM.flatMap((item): ItemDoSite[] => {
      const ultima = doSite.find((x) => x.item === item);
      return ultima ? [{ item, status: ultima.status, detalhe: ultima.detail }] : [];
    });
    return [
      {
        marca,
        host: maisRecente.host,
        itens,
        conferidoEm: maisRecente.checkedAt,
        emAtencao: itens.filter((i) => i.status === 'warning').length,
      },
    ];
  });

  /* Pendências que travam a medição (as mesmas de Tráfego com IA, pela marca escolhida) */
  const pendencias = acoes(
    dados,
    { ...filtros, canal: null, campanha: null, operador: 'todos' },
    agora,
  ).pendencias.map((a): PendenciaDeMedicao => ({ id: a.id, titulo: a.title, marca: a.brandId }));

  /* Fontes e o "atualizado há X min" (a mais antiga entre as que sincronizaram) */
  const cartoes = conectores(dados, agora).lista;
  const fonte = (id: IdDaFonte): FonteDoPainel | null => {
    const cartao = cartoes.find((x) => x.id === id);
    return cartao
      ? { id, status: cartao.status, lastSyncAt: cartao.lastSyncAt, atrasado: cartao.atrasado }
      : null;
  };
  const fontes: Record<IdDaFonte, FonteDoPainel | null> = {
    search_console: fonte('search_console'),
    ga4: fonte('ga4'),
    csp360: fonte('csp360'),
  };
  const sincronizacoes = Object.values(fontes)
    .map((f) => f?.lastSyncAt ?? null)
    .filter((d): d is string => d !== null && Number.isFinite(instanteEmMs(d)))
    .sort((a, b) => instanteEmMs(a) - instanteEmMs(b));

  return {
    intervalo,
    atualizadoEm: sincronizacoes[0] ?? dados.geradoEm,
    fontes,
    seo: {
      impressoes: base.seo.impressoes,
      cliques: base.seo.cliques,
      ctr: base.seo.ctr,
      posicaoMedia: base.seo.posicaoMedia,
      cliquesPorDia,
      posicaoPorDia,
      consultas,
      participacaoDasConsultas,
      temConsultas: complementos.consultas.length > 0,
    },
    geo: {
      sessoes: base.geo.sessoes,
      parcelaDasSessoes: metrica(
        razao(canaisAgora.ia, canaisAgora.total),
        razao(canaisAntes.ia, canaisAntes.total),
        c,
      ),
      porAssistente,
      porCanal,
      sessoesPorDia,
      temCanais,
    },
    leads: {
      buscaOrganica: metricaDeLeads(organicos),
      clientesNovosDaBusca: metricaDeNovos(organicos),
      assistentesDeIa: metricaDeLeads(deIa),
      clientesNovosDeIa: metricaDeNovos(deIa),
      porFonte: [...porBuscador, ...porAssistenteDeLead],
    },
    sites,
    pendencias,
  };
}

/**
 * A consulta da tela: `useConsulta(painelSeoGeo)`. No modo demonstração com dados de exemplo, os
 * complementos vêm de `complementosDeExemplo`; fora dele, vazios ("Sem dados").
 */
export function painelSeoGeo(dados: Dados, filtros: Filtros, agora: Date = new Date()): PainelSeoGeo {
  const complementos = store.comDadosDeExemplo ? complementosDeExemplo(dados) : COMPLEMENTOS_VAZIOS;
  return montarPainelSeoGeo(dados, filtros, agora, complementos);
}

/* ---------- Complementos de exemplo (só no modo demonstração com dados de exemplo) ---------- */

/**
 * Consultas de exemplo por marca: [consulta, parte das impressões, parte dos cliques, posição de base].
 * As partes somam menos de 90%: o Search Console esconde as consultas raras. Termos genéricos de busca e
 * o nome das marcas; nada de pessoa ou cliente.
 */
const CONSULTAS_DE_EXEMPLO: Readonly<
  Record<Brand, ReadonlyArray<readonly [string, number, number, number]>>
> = {
  cs: [
    ['corpo sensual', 0.06, 0.3, 1.3],
    ['corpo sensual pijamas', 0.03, 0.12, 1.6],
    ['pijama feminino atacado', 0.16, 0.11, 8.9],
    ['fábrica de pijamas', 0.13, 0.08, 10.8],
    ['camisola atacado', 0.11, 0.06, 12.4],
    ['pijama para revenda', 0.09, 0.05, 11.1],
    ['baby doll atacado', 0.08, 0.04, 13.7],
    ['fornecedor de pijamas', 0.07, 0.035, 14.2],
    ['moda noite atacado', 0.06, 0.025, 16.9],
    ['pijama de inverno feminino', 0.07, 0.02, 21.3],
  ],
  plumene: [
    ['plumene', 0.07, 0.32, 1.2],
    ['plumene pijamas', 0.03, 0.1, 1.5],
    ['pijama atacado', 0.17, 0.1, 14.6],
    ['pijama de algodão atacado', 0.12, 0.08, 10.9],
    ['fornecedor de pijamas', 0.1, 0.06, 13.8],
    ['pijama masculino atacado', 0.09, 0.05, 12.2],
    ['pijama para revenda', 0.08, 0.045, 11.6],
    ['camisola de algodão', 0.07, 0.03, 17.1],
    ['robe feminino atacado', 0.06, 0.025, 15.4],
    ['pijama família', 0.06, 0.02, 19.8],
  ],
};

const ROBOTS_LIBERADO = 'Libera todos os robôs, inclusive os de IA (GPTBot, ClaudeBot e PerplexityBot).';

/** Estados de exemplo da checagem: ok e atenção, para a tela mostrar os dois. */
const CHECAGENS_DE_EXEMPLO: ReadonlyArray<Omit<SiteCheck, 'checkedAt'>> = [
  {
    brandId: 'cs',
    host: 'www.corposensual.com.br',
    item: 'robots_txt',
    status: 'ok',
    detail: ROBOTS_LIBERADO,
  },
  {
    brandId: 'cs',
    host: 'www.corposensual.com.br',
    item: 'llms_txt',
    status: 'warning',
    detail: 'Não encontrado em /llms.txt. Publique um resumo do site para os assistentes de IA.',
  },
  {
    brandId: 'cs',
    host: 'www.corposensual.com.br',
    item: 'json_ld',
    status: 'warning',
    detail: 'Nenhum JSON-LD na página inicial. Descreva a empresa e os produtos com dados estruturados.',
  },
  {
    brandId: 'plumene',
    host: 'www.plumene.com.br',
    item: 'robots_txt',
    status: 'ok',
    detail: ROBOTS_LIBERADO,
  },
  {
    brandId: 'plumene',
    host: 'www.plumene.com.br',
    item: 'llms_txt',
    status: 'ok',
    detail: 'Publicado em /llms.txt.',
  },
  {
    brandId: 'plumene',
    host: 'www.plumene.com.br',
    item: 'json_ld',
    status: 'ok',
    detail: 'JSON-LD em todas as páginas conferidas.',
  },
];

/** Número em [0, 1) tirado da chave: o mesmo dia e a mesma consulta dão sempre o mesmo valor. */
function sorteio(chave: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < chave.length; i += 1) {
    h ^= chave.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Ruído multiplicativo em torno de 1 (±amplitude), fixo para a chave. */
function ruido(chave: string, amplitude: number): number {
  return 1 + (sorteio(chave) * 2 - 1) * amplitude;
}

/** Posição de base média das consultas que não são da marca, ponderada pelas impressões. */
function posicaoDeBase(lista: ReadonlyArray<readonly [string, number, number, number]>): number {
  const genericas = lista.filter(([, , , posicao]) => posicao >= 3);
  const peso = somar(genericas, ([, imp]) => imp);
  return peso > 0 ? somar(genericas, ([, imp, , posicao]) => imp * posicao) / peso : 1;
}

/** A checagem roda às 6h; antes disso no dia, vale a do dia anterior. */
function horaDaChecagem(geradoEm: string): string {
  const hoje = diaSp(geradoEm);
  const seisHoras = instanteDe(hoje, 6);
  return instanteEmMs(seisHoras) <= instanteEmMs(geradoEm) ? seisHoras : instanteDe(somarDias(hoje, -1), 6);
}

function gerarComplementos(dados: Dados): ComplementosSeoGeo {
  const consultas: SeoQueryDaily[] = [];
  const base: Record<Brand, number> = {
    cs: posicaoDeBase(CONSULTAS_DE_EXEMPLO.cs),
    plumene: posicaoDeBase(CONSULTAS_DE_EXEMPLO.plumene),
  };
  for (const dia of dados.seoDaily) {
    const fator = dia.position > 0 ? dia.position / base[dia.brandId] : 1;
    for (const [query, parteImpressoes, parteCliques, posicao] of CONSULTAS_DE_EXEMPLO[dia.brandId]) {
      const chave = `${dia.date}|${dia.brandId}|${query}`;
      // Arredonda para baixo: a soma das consultas nunca passa do total do dia.
      const impressions = Math.floor(dia.impressions * parteImpressoes * ruido(`${chave}|i`, 0.15));
      if (impressions <= 0) continue;
      const clicks = Math.min(impressions, Math.floor(dia.clicks * parteCliques * ruido(`${chave}|c`, 0.15)));
      const escala = posicao >= 3 ? fator : 1;
      const position = Math.max(1, Math.round(posicao * escala * ruido(`${chave}|p`, 0.08) * 10) / 10);
      consultas.push({ date: dia.date, brandId: dia.brandId, query, impressions, clicks, position });
    }
  }

  const iaDoDia = new Map<string, number>();
  for (const g of dados.geoDaily) {
    const k = `${g.brandId}|${g.date}`;
    iaDoDia.set(k, (iaDoDia.get(k) ?? 0) + g.sessions);
  }
  const pagoDoDia = new Map<string, { busca: number; social: number }>();
  for (const m of dados.metrics) {
    const k = `${m.brandId}|${m.date}`;
    const atual = pagoDoDia.get(k) ?? { busca: 0, social: 0 };
    if (m.platform === 'google') atual.busca += m.clicks;
    else atual.social += m.clicks;
    pagoDoDia.set(k, atual);
  }

  const canais: Ga4ChannelDaily[] = [];
  for (const dia of dados.seoDaily) {
    const k = `${dia.brandId}|${dia.date}`;
    const chave = `${dia.date}|${dia.brandId}`;
    const pago = pagoDoDia.get(k) ?? { busca: 0, social: 0 };
    const sessoes = (channel: Ga4Channel, valor: number) =>
      canais.push({
        date: dia.date,
        brandId: dia.brandId,
        channel,
        sessions: Math.max(0, Math.round(valor)),
      });
    sessoes('organic_search', dia.clicks * 1.12 * ruido(`${chave}|organic_search`, 0.1));
    sessoes('direct', dia.clicks * 0.6 * ruido(`${chave}|direct`, 0.25));
    sessoes('organic_social', dia.clicks * 0.2 * ruido(`${chave}|organic_social`, 0.3));
    sessoes('referral', dia.clicks * 0.08 * ruido(`${chave}|referral`, 0.3));
    sessoes('paid_search', pago.busca * 0.85 * ruido(`${chave}|paid_search`, 0.08));
    sessoes('paid_social', pago.social * 0.7 * ruido(`${chave}|paid_social`, 0.1));
    if (dados.geoDaily.length > 0) sessoes('ai_assistant', iaDoDia.get(k) ?? 0);
  }

  const checkedAt = dados.geradoEm ? horaDaChecagem(dados.geradoEm) : null;
  const checagens: SiteCheck[] = checkedAt ? CHECAGENS_DE_EXEMPLO.map((ch) => ({ ...ch, checkedAt })) : [];

  return { consultas, canais, checagens };
}

const cacheDeExemplo = new WeakMap<Dados, ComplementosSeoGeo>();

/**
 * Complementos de exemplo tirados do próprio conjunto, determinísticos: as consultas repartem as
 * impressões e os cliques de cada dia do Search Console (somando menos que o total); os canais do GA4 saem
 * dos cliques orgânicos e pagos do dia, e o canal "Assistente de IA" é a soma exata de `geoDaily`; a
 * checagem dos sites mostra um item em ordem e outro pedindo atenção. Conjunto vazio, complementos vazios.
 */
export function complementosDeExemplo(dados: Dados): ComplementosSeoGeo {
  const guardado = cacheDeExemplo.get(dados);
  if (guardado) return guardado;
  const gerado = gerarComplementos(dados);
  cacheDeExemplo.set(dados, gerado);
  return gerado;
}

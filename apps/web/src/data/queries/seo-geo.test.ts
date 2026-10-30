import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Connector, GeoDaily, Lead, SeoDaily, TrafficAction } from '@csp-mkt/shared';
import { FILTROS_PADRAO, type Filtros } from '../../lib/url-state';
import { DADOS_VAZIOS, type Dados } from '../dados';
import { gerarDadosDeExemplo } from '../sample';
import {
  assistenteDoHost,
  buscadorDoHost,
  complementosDeExemplo,
  montarPainelSeoGeo,
  painelSeoGeo,
  type ComplementosSeoGeo,
  type Ga4ChannelDaily,
  type SeoQueryDaily,
  type SiteCheck,
} from './seo-geo';

const agora = new Date('2026-10-30T15:00:00-03:00');
const f = (parcial: Partial<Filtros> = {}): Filtros => ({ ...FILTROS_PADRAO, periodo: '7d', ...parcial });
const iso = (dia: string, hora = 10) => `${dia}T${String(hora).padStart(2, '0')}:00:00-03:00`;

// Período "7d" em 30/10/2026 = 24/10 a 30/10; o anterior = 17/10 a 23/10.

const seo = (
  date: string,
  brandId: SeoDaily['brandId'],
  impressions: number,
  clicks: number,
  position: number,
) => ({ date, brandId, impressions, clicks, position }) satisfies SeoDaily;

const geo = (date: string, brandId: GeoDaily['brandId'], source: GeoDaily['source'], sessions: number) =>
  ({ date, brandId, source, sessions, leads: 0 }) satisfies GeoDaily;

const lead = (p: Partial<Lead> & Pick<Lead, 'id' | 'source' | 'createdAt'>): Lead => ({
  code: p.id.toUpperCase(),
  brandId: 'cs',
  utmCampaign: null,
  referrerHost: null,
  stage: 'lead',
  firstOrderAt: null,
  repId: null,
  crmCustomerId: null,
  ...p,
});

const acao = (p: Partial<TrafficAction> & Pick<TrafficAction, 'id' | 'brandId' | 'kind' | 'status'>) =>
  ({
    proposedBy: 'human',
    platform: null,
    campaignId: null,
    title: 'GA4 sem ID no site',
    rationale: 'Sem o ID, nada mede.',
    paramsJson: '{}',
    impact: 'high',
    effort: 'low',
    costCents: 0,
    createdAt: iso('2026-10-18'),
    approvedBy: null,
    approvedAt: null,
    executedAt: null,
    result: null,
    ...p,
  }) satisfies TrafficAction;

const conector = (p: Partial<Connector> & Pick<Connector, 'id' | 'status'>): Connector => ({
  name: p.id,
  lastSyncAt: null,
  expectedEveryMinutes: 1440,
  errors24h: 0,
  rowsWritten: 0,
  ...p,
});

const dados: Dados = {
  ...DADOS_VAZIOS,
  seoDaily: [
    seo('2026-10-24', 'cs', 1000, 30, 10),
    seo('2026-10-25', 'cs', 3000, 60, 14),
    seo('2026-10-24', 'plumene', 500, 10, 20),
    seo('2026-10-20', 'cs', 2000, 40, 12),
  ],
  geoDaily: [
    geo('2026-10-24', 'cs', 'chatgpt', 10),
    geo('2026-10-24', 'cs', 'claude', 2),
    geo('2026-10-26', 'plumene', 'chatgpt', 4),
    geo('2026-10-26', 'plumene', 'perplexity', 3),
    geo('2026-10-18', 'cs', 'chatgpt', 5),
  ],
  leads: [
    lead({ id: 'l1', source: 'organic', referrerHost: 'www.google.com.br', createdAt: iso('2026-10-25') }),
    lead({
      id: 'l2',
      source: 'organic',
      brandId: 'plumene',
      referrerHost: 'www.bing.com',
      createdAt: iso('2026-10-26'),
      stage: 'first_order',
      firstOrderAt: iso('2026-10-28'),
      crmCustomerId: 'c2',
    }),
    lead({
      id: 'l3',
      source: 'ai_assistant',
      referrerHost: 'chatgpt.com',
      createdAt: iso('2026-10-24'),
      stage: 'first_order',
      firstOrderAt: iso('2026-10-27'),
      crmCustomerId: 'c3',
    }),
    lead({
      id: 'l4',
      source: 'ai_assistant',
      referrerHost: 'perplexity.ai',
      createdAt: iso('2026-10-19'),
      stage: 'invoiced',
      firstOrderAt: iso('2026-10-26'),
      crmCustomerId: 'c4',
      repId: 'rep-1',
    }),
    lead({
      id: 'l5',
      source: 'ai_assistant',
      brandId: 'plumene',
      referrerHost: 'chatgpt.com',
      createdAt: iso('2026-10-27'),
    }),
    lead({ id: 'l6', source: 'meta', utmCampaign: 'meta-cs-1', createdAt: iso('2026-10-25') }),
    lead({ id: 'l7', source: 'ai_assistant', referrerHost: null, createdAt: iso('2026-10-28') }),
    lead({ id: 'l8', source: 'organic', referrerHost: 'www.google.com', createdAt: iso('2026-10-18') }),
  ],
  actions: [
    acao({ id: 'fix-cs', brandId: 'cs', kind: 'pending_fix', status: 'idea' }),
    acao({ id: 'fix-pl', brandId: 'plumene', kind: 'pending_fix', status: 'approved' }),
    acao({ id: 'fix-feita', brandId: 'cs', kind: 'pending_fix', status: 'done' }),
    acao({
      id: 'pausa',
      brandId: 'cs',
      kind: 'pause',
      status: 'idea',
      proposedBy: 'claude',
      title: 'Pausar',
    }),
  ],
  connectors: [
    conector({ id: 'search_console', status: 'ok', lastSyncAt: '2026-10-30T09:00:00-03:00' }),
    conector({ id: 'ga4', status: 'simulated' }),
    conector({
      id: 'csp360',
      status: 'ok',
      lastSyncAt: '2026-10-30T14:57:00-03:00',
      expectedEveryMinutes: 5,
    }),
  ],
  geradoEm: '2026-10-30T15:00:00-03:00',
};

const consulta = (
  date: string,
  brandId: SeoQueryDaily['brandId'],
  query: string,
  i: number,
  c: number,
  p: number,
) => ({ date, brandId, query, impressions: i, clicks: c, position: p }) satisfies SeoQueryDaily;

const canal = (
  date: string,
  brandId: Ga4ChannelDaily['brandId'],
  channel: Ga4ChannelDaily['channel'],
  s: number,
) => ({ date, brandId, channel, sessions: s }) satisfies Ga4ChannelDaily;

const checagem = (p: Pick<SiteCheck, 'brandId' | 'item' | 'status'> & Partial<SiteCheck>): SiteCheck => ({
  host: p.brandId === 'cs' ? 'www.corposensual.com.br' : 'www.plumene.com.br',
  detail: 'Detalhe de exemplo.',
  checkedAt: '2026-10-30T06:00:00-03:00',
  ...p,
});

const complementos: ComplementosSeoGeo = {
  consultas: [
    consulta('2026-10-24', 'cs', 'pijama atacado', 300, 9, 8),
    consulta('2026-10-25', 'cs', 'pijama atacado', 500, 11, 10),
    consulta('2026-10-24', 'cs', 'corpo sensual', 50, 20, 1),
    consulta('2026-10-24', 'plumene', 'plumene', 40, 6, 1.2),
    consulta('2026-10-20', 'cs', 'pijama atacado', 999, 99, 3),
  ],
  canais: [
    canal('2026-10-24', 'cs', 'organic_search', 40),
    canal('2026-10-24', 'cs', 'ai_assistant', 12),
    canal('2026-10-24', 'cs', 'direct', 20),
    canal('2026-10-24', 'cs', 'paid_social', 28),
    canal('2026-10-26', 'plumene', 'organic_search', 10),
    canal('2026-10-26', 'plumene', 'ai_assistant', 7),
    canal('2026-10-26', 'plumene', 'direct', 3),
    canal('2026-10-24', 'plumene', 'referral', 0),
    canal('2026-10-19', 'cs', 'organic_search', 30),
    canal('2026-10-19', 'cs', 'ai_assistant', 5),
    canal('2026-10-19', 'cs', 'direct', 15),
  ],
  checagens: [
    checagem({ brandId: 'plumene', item: 'json_ld', status: 'ok' }),
    checagem({ brandId: 'cs', item: 'robots_txt', status: 'ok' }),
    checagem({ brandId: 'cs', item: 'llms_txt', status: 'warning', checkedAt: '2026-10-29T06:00:00-03:00' }),
    checagem({ brandId: 'cs', item: 'llms_txt', status: 'ok', checkedAt: '2026-10-28T06:00:00-03:00' }),
    checagem({ brandId: 'cs', item: 'json_ld', status: 'warning' }),
    checagem({ brandId: 'plumene', item: 'robots_txt', status: 'ok' }),
  ],
};

/** Algum número do painel é NaN ou infinito? (métrica sem base é null, nunca NaN). */
function temNumeroInvalido(valor: unknown): boolean {
  if (typeof valor === 'number') return !Number.isFinite(valor);
  if (Array.isArray(valor)) return valor.some(temNumeroInvalido);
  if (valor && typeof valor === 'object') return Object.values(valor).some(temNumeroInvalido);
  return false;
}

describe('assistenteDoHost e buscadorDoHost', () => {
  it('reconhece os cinco assistentes de IA pelo host, com ou sem www e protocolo', () => {
    expect(assistenteDoHost('chatgpt.com')).toBe('chatgpt');
    expect(assistenteDoHost('https://chat.openai.com/c/abc')).toBe('chatgpt');
    expect(assistenteDoHost('www.perplexity.ai')).toBe('perplexity');
    expect(assistenteDoHost('claude.ai')).toBe('claude');
    expect(assistenteDoHost('gemini.google.com')).toBe('gemini');
    expect(assistenteDoHost('copilot.microsoft.com')).toBe('copilot');
    expect(assistenteDoHost('www.google.com')).toBeNull();
    expect(assistenteDoHost(null)).toBeNull();
  });

  it('dá nome ao buscador e separa lead sem endereço de origem', () => {
    expect(buscadorDoHost('www.google.com.br')).toEqual({ chave: 'google', rotulo: 'Google' });
    expect(buscadorDoHost('www.bing.com').rotulo).toBe('Bing');
    expect(buscadorDoHost('duckduckgo.com').rotulo).toBe('DuckDuckGo');
    expect(buscadorDoHost('br.search.yahoo.com').rotulo).toBe('Yahoo');
    expect(buscadorDoHost('busca.exemplo').rotulo).toBe('Outro buscador');
    expect(buscadorDoHost('').chave).toBe('sem-endereco');
  });
});

describe('montarPainelSeoGeo — busca orgânica', () => {
  it('reaproveita os indicadores de seoGeo e compara com o período anterior', () => {
    const p = montarPainelSeoGeo(dados, f(), agora, complementos);
    expect(p.intervalo).toMatchObject({ inicio: '2026-10-24', fim: '2026-10-30' });
    expect(p.seo.impressoes).toEqual({ atual: 4500, anterior: 2000, variacao: 1.25 });
    expect(p.seo.cliques).toEqual({ atual: 100, anterior: 40, variacao: 1.5 });
    expect(p.seo.ctr.atual).toBeCloseTo(100 / 4500, 6);
    // Posição ponderada pelas impressões: (10×1000 + 14×3000 + 20×500) ÷ 4500
    expect(p.seo.posicaoMedia.atual).toBeCloseTo(62000 / 4500, 6);
  });

  it('desenha cliques e posição por dia, uma série por marca, com null onde não chegou número', () => {
    const p = montarPainelSeoGeo(dados, f(), agora, complementos);
    expect(p.seo.cliquesPorDia.map((s) => s.marca)).toEqual(['cs', 'plumene']);
    const cs = p.seo.cliquesPorDia[0]!;
    expect(cs.pontos).toHaveLength(7);
    expect(cs.pontos.slice(0, 3)).toEqual([
      { x: '2026-10-24', y: 30 },
      { x: '2026-10-25', y: 60 },
      { x: '2026-10-26', y: null },
    ]);
    expect(p.seo.posicaoPorDia[1]!.pontos[0]).toEqual({ x: '2026-10-24', y: 20 });

    const soCs = montarPainelSeoGeo(dados, f({ marca: 'cs' }), agora, complementos);
    expect(soCs.seo.cliquesPorDia.map((s) => s.marca)).toEqual(['cs']);
    expect(soCs.seo.cliques.atual).toBe(90);
  });

  it('lista as consultas do período por cliques, com CTR, posição ponderada e a parte dos cliques', () => {
    const p = montarPainelSeoGeo(dados, f(), agora, complementos);
    expect(p.seo.temConsultas).toBe(true);
    expect(p.seo.consultas.map((q) => q.consulta)).toEqual(['pijama atacado', 'corpo sensual', 'plumene']);
    const primeira = p.seo.consultas[0]!;
    expect(primeira).toMatchObject({ marca: 'cs', impressoes: 800, cliques: 20 });
    expect(primeira.ctr).toBeCloseTo(0.025, 6);
    expect(primeira.posicao).toBeCloseTo((8 * 300 + 10 * 500) / 800, 6);
    expect(p.seo.participacaoDasConsultas).toBeCloseTo(46 / 100, 6);

    const soPlumene = montarPainelSeoGeo(dados, f({ marca: 'plumene' }), agora, complementos);
    expect(soPlumene.seo.consultas.map((q) => q.consulta)).toEqual(['plumene']);
  });
});

describe('montarPainelSeoGeo — assistentes de IA', () => {
  it('soma as sessões por assistente, do maior para o menor, com a parte de cada um', () => {
    const p = montarPainelSeoGeo(dados, f(), agora, complementos);
    expect(p.geo.sessoes).toMatchObject({ atual: 19, anterior: 5 });
    expect(p.geo.porAssistente.map((a) => [a.fonte, a.sessoes.atual])).toEqual([
      ['chatgpt', 14],
      ['perplexity', 3],
      ['claude', 2],
      ['gemini', 0],
      ['copilot', 0],
    ]);
    expect(p.geo.porAssistente[0]!.parcela).toBeCloseTo(14 / 19, 6);
    expect(p.geo.sessoesPorDia[0]!.pontos[0]).toEqual({ x: '2026-10-24', y: 12 });
    expect(p.geo.sessoesPorDia[1]!.pontos[2]).toEqual({ x: '2026-10-26', y: 7 });
  });

  it('calcula a parcela de IA nas sessões do GA4 e lista só os canais com sessão', () => {
    const p = montarPainelSeoGeo(dados, f(), agora, complementos);
    expect(p.geo.parcelaDasSessoes.atual).toBeCloseTo(19 / 120, 6);
    expect(p.geo.parcelaDasSessoes.anterior).toBeCloseTo(5 / 50, 6);
    expect(p.geo.parcelaDasSessoes.variacao).toBeCloseTo((19 / 120 - 0.1) / 0.1, 6);
    expect(p.geo.porCanal.map((c) => [c.canal, c.sessoes])).toEqual([
      ['organic_search', 50],
      ['paid_social', 28],
      ['direct', 23],
      ['ai_assistant', 19],
    ]);
    expect(p.geo.porCanal[0]!.parcela).toBeCloseTo(50 / 120, 6);
  });
});

describe('montarPainelSeoGeo — leads e clientes novos', () => {
  it('conta leads e clientes novos da busca orgânica e de IA (cliente novo pelo 1º pedido no período)', () => {
    const p = montarPainelSeoGeo(dados, f(), agora, complementos);
    expect(p.leads.buscaOrganica).toEqual({ atual: 2, anterior: 1, variacao: 1 });
    expect(p.leads.clientesNovosDaBusca).toMatchObject({ atual: 1, anterior: 0 });
    expect(p.leads.assistentesDeIa).toMatchObject({ atual: 3, anterior: 1 });
    // l3 (pedido em 27/10) e l4 (lead do período anterior, pedido em 26/10)
    expect(p.leads.clientesNovosDeIa).toMatchObject({ atual: 2, anterior: 0 });
  });

  it('abre por buscador e por assistente, busca orgânica primeiro, sem dado pessoal', () => {
    const p = montarPainelSeoGeo(dados, f(), agora, complementos);
    expect(p.leads.porFonte.map((l) => [l.origem, l.fonte, l.leads.atual, l.clientesNovos.atual])).toEqual([
      ['organic', 'Bing', 1, 1],
      ['organic', 'Google', 1, 0],
      ['ai_assistant', 'ChatGPT', 2, 1],
      ['ai_assistant', 'Sem endereço de origem', 1, 0],
      ['ai_assistant', 'Perplexity', 0, 1],
    ]);
    expect(p.leads.porFonte.find((l) => l.fonte === 'ChatGPT')!.assistente).toBe('chatgpt');
    expect(p.leads.porFonte.find((l) => l.fonte === 'Google')!.assistente).toBeNull();
    expect(JSON.stringify(p.leads)).not.toMatch(/LEAD|c2|c3|rep-1/);
  });

  it('respeita a marca e os filtros de lead da URL só nos leads', () => {
    const soPlumene = montarPainelSeoGeo(dados, f({ marca: 'plumene' }), agora, complementos);
    expect(soPlumene.leads.buscaOrganica.atual).toBe(1);
    expect(soPlumene.leads.assistentesDeIa.atual).toBe(1);

    const soOrganico = montarPainelSeoGeo(dados, f({ origem: 'organic' }), agora, complementos);
    expect(soOrganico.leads.buscaOrganica.atual).toBe(2);
    expect(soOrganico.leads.assistentesDeIa.atual).toBe(0);
    expect(soOrganico.geo.sessoes.atual).toBe(19);

    const doRepresentante = montarPainelSeoGeo(dados, f({ representante: 'rep-1' }), agora, complementos);
    expect(doRepresentante.leads.clientesNovosDeIa.atual).toBe(1);
  });

  it('sem comparação, o anterior e a variação somem', () => {
    const p = montarPainelSeoGeo(dados, f({ comparar: false }), agora, complementos);
    expect(p.leads.buscaOrganica).toEqual({ atual: 2, anterior: null, variacao: null });
    expect(p.seo.cliques).toEqual({ atual: 100, anterior: null, variacao: null });
    expect(p.geo.parcelaDasSessoes.anterior).toBeNull();
  });
});

describe('montarPainelSeoGeo — sites, pendências e fontes', () => {
  it('mostra o resultado mais recente de cada item, na ordem robots.txt, llms.txt, JSON-LD', () => {
    const p = montarPainelSeoGeo(dados, f(), agora, complementos);
    expect(p.sites.map((s) => s.marca)).toEqual(['cs', 'plumene']);
    const cs = p.sites[0]!;
    expect(cs.host).toBe('www.corposensual.com.br');
    expect(cs.itens.map((i) => [i.item, i.status])).toEqual([
      ['robots_txt', 'ok'],
      ['llms_txt', 'warning'],
      ['json_ld', 'warning'],
    ]);
    expect(cs.emAtencao).toBe(2);
    expect(cs.conferidoEm).toBe('2026-10-30T06:00:00-03:00');

    const soPlumene = montarPainelSeoGeo(dados, f({ marca: 'plumene' }), agora, complementos);
    expect(soPlumene.sites.map((s) => s.marca)).toEqual(['plumene']);
    expect(soPlumene.sites[0]!.itens.map((i) => i.item)).toEqual(['robots_txt', 'json_ld']);
  });

  it('traz as pendências de medição abertas da marca escolhida', () => {
    const p = montarPainelSeoGeo(dados, f(), agora, complementos);
    expect(p.pendencias.map((x) => x.id).sort()).toEqual(['fix-cs', 'fix-pl']);
    const soCs = montarPainelSeoGeo(dados, f({ marca: 'cs', operador: 'claude' }), agora, complementos);
    expect(soCs.pendencias).toEqual([{ id: 'fix-cs', titulo: 'GA4 sem ID no site', marca: 'cs' }]);
  });

  it('dá o selo de cada fonte e o "atualizado há" pela sincronização mais antiga', () => {
    const p = montarPainelSeoGeo(dados, f(), agora, complementos);
    expect(p.fontes.search_console).toMatchObject({ status: 'ok', atrasado: false });
    expect(p.fontes.ga4).toMatchObject({ status: 'simulated', lastSyncAt: null });
    expect(p.atualizadoEm).toBe('2026-10-30T09:00:00-03:00');

    const semCartoes = montarPainelSeoGeo({ ...dados, connectors: [] }, f(), agora, complementos);
    expect(semCartoes.fontes).toEqual({ search_console: null, ga4: null, csp360: null });
    expect(semCartoes.atualizadoEm).toBe(dados.geradoEm);
  });
});

describe('montarPainelSeoGeo — sem base', () => {
  it('sobre o conjunto vazio, tudo é null ou lista vazia: "Sem dados", nunca 0 nem NaN', () => {
    const p = montarPainelSeoGeo({ ...DADOS_VAZIOS }, f(), agora);
    expect(p.seo.impressoes.atual).toBeNull();
    expect(p.seo.posicaoMedia.atual).toBeNull();
    expect(p.geo.sessoes.atual).toBeNull();
    expect(p.geo.parcelaDasSessoes.atual).toBeNull();
    expect(p.leads.buscaOrganica.atual).toBeNull();
    expect(p.leads.clientesNovosDeIa.atual).toBeNull();
    expect(p.seo.consultas).toEqual([]);
    expect(p.seo.temConsultas).toBe(false);
    expect(p.geo.porCanal).toEqual([]);
    expect(p.geo.temCanais).toBe(false);
    expect(p.leads.porFonte).toEqual([]);
    expect(p.sites).toEqual([]);
    expect(p.pendencias).toEqual([]);
    expect(p.seo.cliquesPorDia.every((s) => s.pontos.every((pt) => pt.y === null))).toBe(true);
    expect(temNumeroInvalido(p)).toBe(false);
  });

  it('sem complementos, as consultas, os canais e os sites ficam vazios e o resto continua', () => {
    const p = montarPainelSeoGeo(dados, f(), agora);
    expect(p.seo.cliques.atual).toBe(100);
    expect(p.seo.consultas).toEqual([]);
    expect(p.seo.participacaoDasConsultas).toBeNull();
    expect(p.geo.parcelaDasSessoes.atual).toBeNull();
    expect(p.sites).toEqual([]);
  });
});

describe('complementosDeExemplo', () => {
  const exemplo = gerarDadosDeExemplo({ agora });

  it('é determinístico e vazio para o conjunto vazio', () => {
    const a = complementosDeExemplo(exemplo);
    expect(complementosDeExemplo(exemplo)).toBe(a);
    expect(complementosDeExemplo(gerarDadosDeExemplo({ agora }))).toEqual(a);
    expect(complementosDeExemplo({ ...DADOS_VAZIOS })).toEqual({ consultas: [], canais: [], checagens: [] });
  });

  it('as consultas de cada dia somam menos que o total do Search Console', () => {
    const { consultas } = complementosDeExemplo(exemplo);
    expect(consultas.length).toBeGreaterThan(0);
    for (const dia of exemplo.seoDaily) {
      const doDia = consultas.filter((q) => q.date === dia.date && q.brandId === dia.brandId);
      expect(doDia.reduce((s, q) => s + q.impressions, 0)).toBeLessThanOrEqual(dia.impressions);
      expect(doDia.reduce((s, q) => s + q.clicks, 0)).toBeLessThanOrEqual(dia.clicks);
      for (const q of doDia) {
        expect(q.clicks).toBeLessThanOrEqual(q.impressions);
        expect(q.position).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('o canal Assistente de IA do GA4 é a soma exata das sessões de IA do dia', () => {
    const { canais } = complementosDeExemplo(exemplo);
    for (const dia of exemplo.seoDaily.slice(0, 20)) {
      const ia = canais.find(
        (c) => c.date === dia.date && c.brandId === dia.brandId && c.channel === 'ai_assistant',
      );
      const soma = exemplo.geoDaily
        .filter((g) => g.date === dia.date && g.brandId === dia.brandId)
        .reduce((s, g) => s + g.sessions, 0);
      expect(ia?.sessions).toBe(soma);
    }
  });

  it('a checagem tem os três itens dos dois sites, conferidos antes de o conjunto ser gerado', () => {
    const { checagens } = complementosDeExemplo(exemplo);
    expect(checagens).toHaveLength(6);
    expect(checagens.some((c) => c.status === 'warning')).toBe(true);
    expect(checagens.some((c) => c.status === 'ok')).toBe(true);
    for (const c of checagens) {
      expect(new Date(c.checkedAt).getTime()).toBeLessThanOrEqual(new Date(exemplo.geradoEm!).getTime());
    }
  });

  it('com os dados de exemplo, o painel tem números em todos os blocos e nenhum NaN', () => {
    const p = montarPainelSeoGeo(exemplo, f({ periodo: 'este-mes' }), agora, complementosDeExemplo(exemplo));
    expect(p.seo.cliques.atual).toBeGreaterThan(0);
    expect(p.seo.consultas).toHaveLength(10);
    expect(p.geo.sessoes.atual).toBeGreaterThan(0);
    expect(p.geo.parcelaDasSessoes.atual).toBeGreaterThan(0);
    expect(p.geo.parcelaDasSessoes.atual).toBeLessThan(1);
    expect(p.geo.porCanal.some((c) => c.canal === 'ai_assistant')).toBe(true);
    expect(p.leads.porFonte.length).toBeGreaterThan(0);
    expect(p.sites).toHaveLength(2);
    expect(p.pendencias.length).toBeGreaterThan(0);
    expect(temNumeroInvalido(p)).toBe(false);
  });
});

describe('painelSeoGeo', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fora do modo com dados de exemplo, não inventa consulta, canal nem checagem', () => {
    vi.stubEnv('VITE_SAMPLE_DATA', 'false');
    const p = painelSeoGeo(gerarDadosDeExemplo({ agora }), f(), agora);
    expect(p.seo.cliques.atual).not.toBeNull();
    expect(p.seo.consultas).toEqual([]);
    expect(p.geo.porCanal).toEqual([]);
    expect(p.sites).toEqual([]);
  });

  it('no modo demonstração com dados de exemplo, usa os complementos de exemplo', () => {
    vi.stubEnv('VITE_SAMPLE_DATA', 'true');
    const p = painelSeoGeo(gerarDadosDeExemplo({ agora }), f(), agora);
    expect(p.seo.consultas.length).toBeGreaterThan(0);
    expect(p.geo.porCanal.length).toBeGreaterThan(0);
    expect(p.sites).toHaveLength(2);
  });
});

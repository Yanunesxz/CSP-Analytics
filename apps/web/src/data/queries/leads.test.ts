import { describe, expect, it } from 'vitest';
import type { Campaign, DailyMetric, Lead } from '@csp-mkt/shared';
import { FILTROS_PADRAO, type Filtros } from '../../lib/url-state';
import { DADOS_VAZIOS, type Dados } from '../dados';
import { custoPorClienteNovo, kpisVisaoGeral } from '../queries';
import { gerarDadosDeExemplo } from '../sample';
import { etapaDaUrl, LIMITE_DA_LISTA, painelDeLeads, rotuloDaMarcaDoLead, URL_CRM_FICHA } from './leads';

const agora = new Date('2026-10-30T15:00:00-03:00');
const f = (parcial: Partial<Filtros> = {}): Filtros => ({ ...FILTROS_PADRAO, ...parcial });
const iso = (dia: string, hora = 10) => `${dia}T${String(hora).padStart(2, '0')}:00:00-03:00`;

const campanha = (
  p: Partial<Campaign> & Pick<Campaign, 'id' | 'platform' | 'brandId' | 'managedBy' | 'utmCampaign'>,
): Campaign => ({
  externalId: `${p.platform}:${p.id}`,
  name: `Campanha ${p.id}`,
  status: 'active',
  dailyBudgetCents: 10000,
  spendCapCents: 450000,
  ...p,
});

const lead = (p: Partial<Lead> & Pick<Lead, 'id' | 'brandId' | 'source' | 'stage' | 'createdAt'>): Lead => ({
  code: p.id.toUpperCase(),
  utmCampaign: null,
  referrerHost: null,
  firstOrderAt: null,
  repId: null,
  crmCustomerId: null,
  ...p,
});

const gasto = (campaignId: string, date: string, spendCents: number): DailyMetric => {
  const c = campaigns.find((x) => x.id === campaignId)!;
  return {
    date,
    brandId: c.brandId,
    platform: c.platform,
    campaignId,
    spendCents,
    impressions: 1000,
    clicks: 10,
    leads: 1,
    conversions: 0,
    revenueCents: 0,
  };
};

const campaigns = [
  campanha({ id: 'c1', platform: 'meta', brandId: 'cs', managedBy: 'human', utmCampaign: 'cs-a' }),
  campanha({ id: 'c2', platform: 'meta', brandId: 'cs', managedBy: 'claude', utmCampaign: 'cs-b' }),
  campanha({ id: 'c3', platform: 'google', brandId: 'plumene', managedBy: 'human', utmCampaign: 'pl-c' }),
];

const metrics: DailyMetric[] = [
  // Outubro: c1 R$ 300, c2 R$ 150, c3 R$ 50
  gasto('c1', '2026-10-05', 10000),
  gasto('c1', '2026-10-20', 20000),
  gasto('c2', '2026-10-07', 15000),
  gasto('c3', '2026-10-10', 5000),
  // Setembro: c1 R$ 80
  gasto('c1', '2026-09-20', 8000),
];

const leads: Lead[] = [
  // Este mês (outubro de 2026)
  lead({
    id: 'l1',
    brandId: 'cs',
    source: 'meta',
    utmCampaign: 'cs-a',
    stage: 'first_order',
    createdAt: iso('2026-10-05'),
    firstOrderAt: iso('2026-10-12'),
    crmCustomerId: 'cli-1',
    repId: 'REP-01',
  }),
  lead({
    id: 'l2',
    brandId: 'cs',
    source: 'meta',
    utmCampaign: 'cs-b',
    stage: 'lead',
    createdAt: iso('2026-10-07'),
  }),
  lead({
    id: 'l3',
    brandId: 'plumene',
    source: 'google',
    utmCampaign: 'pl-c',
    stage: 'prospect',
    createdAt: iso('2026-10-10'),
    repId: 'REP-02',
  }),
  lead({
    id: 'l4',
    brandId: null,
    source: 'sdr',
    stage: 'registered',
    createdAt: iso('2026-10-11'),
    crmCustomerId: 'cli-2',
  }),
  lead({
    id: 'l5',
    brandId: 'plumene',
    source: 'organic',
    referrerHost: 'www.google.com',
    stage: 'invoiced',
    createdAt: iso('2026-10-15'),
    firstOrderAt: iso('2026-10-20'),
    crmCustomerId: 'cli-3',
  }),
  lead({
    id: 'l6',
    brandId: 'cs',
    source: 'ai_assistant',
    referrerHost: 'chatgpt.com',
    stage: 'lead',
    createdAt: iso('2026-10-16'),
  }),
  lead({
    id: 'l9',
    brandId: 'cs',
    source: 'meta',
    utmCampaign: 'utm-sem-campanha',
    stage: 'lead',
    createdAt: iso('2026-10-18'),
  }),
  // Mês anterior (setembro)
  lead({
    id: 'l7',
    brandId: 'cs',
    source: 'meta',
    utmCampaign: 'cs-a',
    stage: 'lead',
    createdAt: iso('2026-09-20'),
  }),
  lead({ id: 'l8', brandId: 'plumene', source: 'site', stage: 'prospect', createdAt: iso('2026-09-25') }),
  // Agosto: fora de "este mês" e do mês anterior a ele; é o anterior de "mês passado"
  lead({ id: 'l10', brandId: 'cs', source: 'direct', stage: 'lead', createdAt: iso('2026-08-01') }),
];

const dados: Dados = { ...DADOS_VAZIOS, campaigns, metrics, leads, geradoEm: agora.toISOString() };

describe('painelDeLeads: indicadores do período', () => {
  const p = painelDeLeads(dados, f(), agora);

  it('conta os leads do período e compara com o anterior', () => {
    expect(p.intervalo).toMatchObject({ inicio: '2026-10-01', fim: '2026-10-30' });
    expect(p.total).toEqual({ atual: 7, anterior: 2, variacao: 2.5 });
  });

  it('lead → cliente novo: dos leads do período, quantos já fizeram o 1º pedido, um por cliente', () => {
    expect(p.viraramCliente).toMatchObject({ atual: 2, anterior: 0 });
    expect(p.viraramCliente.variacao).toBeNull();
    expect(p.taxaConversao.atual).toBeCloseTo(2 / 7);
    expect(p.taxaConversao.anterior).toBe(0);
  });

  it('lead sem marca (SDR) em separado, como "Sem marca · WhatsApp"', () => {
    expect(p.semMarca).toEqual({ atual: 1, anterior: 0, variacao: null });
    expect(rotuloDaMarcaDoLead(null)).toBe('Sem marca · WhatsApp');
    expect(rotuloDaMarcaDoLead('cs')).toBe('Corpo Sensual');
  });

  it('custo por lead = investimento ÷ leads de anúncio (UTM que casa com campanha)', () => {
    // Outubro: R$ 500 ÷ 3 leads (l1, l2, l3; l9 tem UTM sem campanha). Setembro: R$ 80 ÷ 1 (l7)
    expect(p.custoNaoSeAplica).toBeNull();
    expect(p.custoPorLead.atual).toBeCloseTo(50000 / 3);
    expect(p.custoPorLead.anterior).toBe(8000);
  });

  it('o custo por lead é o mesmo da Visão geral e da Chegada de clientes', () => {
    for (const filtros of [
      f(),
      f({ marca: 'cs' }),
      f({ canal: 'meta' }),
      f({ operador: 'claude' }),
      f({ periodo: '90d' }),
    ]) {
      const daqui = painelDeLeads(dados, filtros, agora).custoPorLead;
      expect(daqui).toEqual(kpisVisaoGeral(dados, filtros, agora).custoPorLead);
      expect(daqui).toEqual(custoPorClienteNovo(dados, filtros, agora).total.custoPorLead);
    }
  });

  it('sem comparar, anterior e variação vêm null', () => {
    const sem = painelDeLeads(dados, f({ comparar: false }), agora);
    expect(sem.total).toEqual({ atual: 7, anterior: null, variacao: null });
    expect(sem.porMarca[0]!.leads.anterior).toBeNull();
    expect(sem.custoPorLead.anterior).toBeNull();
    expect(sem.porCampanha[0]!.custoPorLead.anterior).toBeNull();
  });
});

describe('painelDeLeads: contagens', () => {
  const p = painelDeLeads(dados, f(), agora);

  it('por marca: as duas e "Sem marca · WhatsApp", com quantos viraram cliente e a taxa', () => {
    expect(p.porMarca.map((m) => m.rotulo)).toEqual(['Corpo Sensual', 'Plumene', 'Sem marca · WhatsApp']);
    expect(p.porMarca[0]).toMatchObject({ chave: 'cs', viraramCliente: 1 });
    expect(p.porMarca[0]!.leads).toEqual({ atual: 4, anterior: 1, variacao: 3 });
    expect(p.porMarca[0]!.taxaConversao).toBe(0.25);
    expect(p.porMarca[1]!.leads).toMatchObject({ atual: 2, anterior: 1 });
    expect(p.porMarca[2]).toMatchObject({
      chave: 'sem-marca',
      marca: null,
      viraramCliente: 0,
      taxaConversao: 0,
    });
    expect(p.porMarca[2]!.leads.atual).toBe(1);
  });

  it('por origem: só as presentes, maior primeiro, empates na ordem declarada', () => {
    expect(p.porOrigem.map((o) => [o.origem, o.leads.atual])).toEqual([
      ['meta', 3],
      ['google', 1],
      ['organic', 1],
      ['ai_assistant', 1],
      ['sdr', 1],
      ['site', 0],
    ]);
    expect(p.porOrigem[0]).toMatchObject({ rotulo: 'Meta Ads', viraramCliente: 1 });
    expect(p.porOrigem[0]!.leads.anterior).toBe(1);
    expect(p.porOrigem.find((o) => o.origem === 'organic')!.taxaConversao).toBe(1);
  });

  it('por dia: um ponto por dia do período, com a série de cada marca', () => {
    expect(p.porDia).toHaveLength(30);
    expect(p.porDia[0]!.date).toBe('2026-10-01');
    const dia5 = p.porDia.find((d) => d.date === '2026-10-05')!;
    expect(dia5).toEqual({ date: '2026-10-05', total: 1, porMarca: { cs: 1, plumene: 0, 'sem-marca': 0 } });
    expect(p.porDia.find((d) => d.date === '2026-10-11')!.porMarca['sem-marca']).toBe(1);
    expect(p.porDia.reduce((soma, d) => soma + (d.total ?? 0), 0)).toBe(7);
  });

  it('por campanha: casa a UTM com a campanha; UTM sem campanha fica com a própria UTM', () => {
    expect(p.porCampanha.map((c) => c.nome)).toEqual([
      'Campanha c1',
      'Campanha c2',
      'Campanha c3',
      'utm-sem-campanha',
    ]);
    expect(p.porCampanha[0]).toMatchObject({
      utmCampaign: 'cs-a',
      campanhaId: 'c1',
      canal: 'meta',
      marca: 'cs',
      operador: 'human',
      viraramCliente: 1,
      taxaConversao: 1,
    });
    expect(p.porCampanha[0]!.leads).toEqual({ atual: 1, anterior: 1, variacao: 0 });
    expect(p.porCampanha[1]!.operador).toBe('claude');
    expect(p.porCampanha[3]).toMatchObject({ campanhaId: null, canal: 'meta', marca: 'cs', operador: null });
  });

  it('por campanha: investimento e custo por lead de cada uma; sem campanha, sem custo', () => {
    const [c1, c2, c3, semCampanha] = p.porCampanha;
    expect(c1!.investimento).toMatchObject({ atual: 30000, anterior: 8000 });
    expect(c1!.custoPorLead).toEqual({ atual: 30000, anterior: 8000, variacao: 2.75 });
    expect(c2!.custoPorLead.atual).toBe(15000);
    expect(c2!.custoPorLead.anterior).toBeNull(); // sem lead no mês anterior
    expect(c3!.custoPorLead.atual).toBe(5000);
    expect(semCampanha!.investimento).toEqual({ atual: null, anterior: null, variacao: null });
    expect(semCampanha!.custoPorLead.atual).toBeNull();
  });

  it('Humano × Claude: a mesma linha lado a lado, com a diferença do Claude em relação ao humano', () => {
    const linha = (chave: string) => p.porOperador.find((l) => l.chave === chave)!;
    expect(p.porOperador.map((l) => l.rotulo)).toEqual([
      'Leads de campanha',
      'Viraram cliente',
      'Lead → cliente novo',
      'Investimento',
      'Custo por lead',
    ]);
    expect(linha('leads')).toMatchObject({ humano: 2, claude: 1, diferenca: -0.5, formato: 'numero' });
    expect(linha('viraramCliente')).toMatchObject({ humano: 1, claude: 0, diferenca: -1 });
    expect(linha('taxaConversao')).toMatchObject({ humano: 0.5, claude: 0, formato: 'percentual' });
    expect(linha('investimento')).toMatchObject({ humano: 35000, claude: 15000, formato: 'dinheiro' });
    expect(linha('custoPorLead')).toMatchObject({ humano: 17500, claude: 15000, menorEhMelhor: true });
    expect(linha('custoPorLead').diferenca).toBeCloseTo(-2500 / 17500);
  });

  it('Humano × Claude ignora o filtro de operador: a comparação é ele', () => {
    const soClaude = painelDeLeads(dados, f({ operador: 'claude' }), agora);
    expect(soClaude.total.atual).toBe(1);
    expect(soClaude.porOperador.find((l) => l.chave === 'leads')).toMatchObject({ humano: 2, claude: 1 });
  });

  it('chips de origem: só as que têm lead, maior primeiro, ignorando o filtro de origem', () => {
    expect(p.chipsDeOrigem.map((c) => [c.origem, c.leads])).toEqual([
      ['meta', 3],
      ['google', 1],
      ['organic', 1],
      ['ai_assistant', 1],
      ['sdr', 1],
    ]);
    const comOrigem = painelDeLeads(dados, f({ origem: 'google' }), agora);
    expect(comOrigem.chipsDeOrigem).toEqual(p.chipsDeOrigem);
  });

  it('chips de etapa: contagem de cada etapa, na ordem do funil', () => {
    expect(p.porEtapa.map((e) => [e.etapa, e.leads])).toEqual([
      ['lead', 3],
      ['prospect', 1],
      ['registered', 1],
      ['first_order', 1],
      ['invoiced', 1],
    ]);
    expect(p.porEtapa.map((e) => e.rotulo)).toEqual([
      'Lead',
      'Prospecto',
      'Cadastro',
      '1º pedido enviado',
      'Faturado',
    ]);
  });
});

describe('painelDeLeads: lista sem dado pessoal', () => {
  const p = painelDeLeads(dados, f(), agora);

  it('mais novos primeiro, com código, origem, marca, campanha, data, etapa e link da ficha 360', () => {
    expect(p.lista.map((l) => l.code)).toEqual(['L9', 'L6', 'L5', 'L4', 'L3', 'L2', 'L1']);
    expect(p.totalDaLista).toBe(7);
    const l1 = p.lista.find((l) => l.id === 'l1')!;
    expect(l1).toEqual({
      id: 'l1',
      code: 'L1',
      origem: 'meta',
      marca: 'cs',
      campanha: 'Campanha c1',
      utmCampaign: 'cs-a',
      etapa: 'first_order',
      criadoEm: iso('2026-10-05'),
      linkCrm: `${URL_CRM_FICHA}/cli-1`,
    });
    expect(p.lista.find((l) => l.id === 'l2')!.linkCrm).toBeNull();
    expect(p.lista.find((l) => l.id === 'l9')!.campanha).toBe('utm-sem-campanha');
    expect(p.lista.find((l) => l.id === 'l4')!.campanha).toBeNull();
  });

  it('só os campos combinados: nada de nome, telefone, e-mail, referrer ou representante', () => {
    const campos = Object.keys(p.lista[0]!).sort();
    expect(campos).toEqual(
      ['campanha', 'code', 'criadoEm', 'etapa', 'id', 'linkCrm', 'marca', 'origem', 'utmCampaign'].sort(),
    );
    expect(JSON.stringify(p.lista)).not.toMatch(/nome|telefone|email|e-mail|referrer|REP-|@/i);
  });

  it('a etapa filtra só a lista; indicadores, gráficos e chips continuam com todos os leads', () => {
    const comEtapa = painelDeLeads(dados, f(), agora, { etapa: 'lead' });
    expect(comEtapa.etapa).toBe('lead');
    expect(comEtapa.lista.map((l) => l.id)).toEqual(['l9', 'l6', 'l2']);
    expect(comEtapa.totalDaLista).toBe(3);
    expect(comEtapa.total).toEqual(p.total);
    expect(comEtapa.porOrigem).toEqual(p.porOrigem);
    expect(comEtapa.porEtapa).toEqual(p.porEtapa);
    expect(painelDeLeads(dados, f(), agora, { etapa: 'invoiced' }).lista.map((l) => l.id)).toEqual(['l5']);
  });

  it('corta em 200 e diz quantos seriam', () => {
    const amostra = gerarDadosDeExemplo({ agora });
    const grande = painelDeLeads(amostra, f({ periodo: '90d' }), agora);
    expect(grande.totalDaLista).toBeGreaterThan(LIMITE_DA_LISTA);
    expect(grande.lista).toHaveLength(LIMITE_DA_LISTA);
    const datas = grande.lista.map((l) => Date.parse(l.criadoEm));
    expect(datas).toEqual([...datas].sort((a, b) => b - a));
  });

  it('lê a etapa da URL e ignora valor desconhecido', () => {
    expect(etapaDaUrl('prospect')).toBe('prospect');
    expect(etapaDaUrl('first_order')).toBe('first_order');
    expect(etapaDaUrl('cliente')).toBeNull();
    expect(etapaDaUrl('')).toBeNull();
    expect(etapaDaUrl(null)).toBeNull();
  });
});

describe('painelDeLeads: filtros', () => {
  it('origem filtra tudo, menos os chips de origem', () => {
    const p = painelDeLeads(dados, f({ origem: 'meta' }), agora);
    expect(p.total.atual).toBe(3);
    expect(p.porOrigem.map((o) => o.origem)).toEqual(['meta']);
    expect(p.chipsDeOrigem.find((c) => c.origem === 'google')!.leads).toBe(1);
    expect(p.porEtapa.map((e) => e.leads)).toEqual([2, 0, 0, 1, 0]);
    expect(p.lista.map((l) => l.id)).toEqual(['l9', 'l2', 'l1']);
  });

  it('origem de anúncio: o custo por lead usa só o investimento daquele canal', () => {
    // Meta: c1 + c2 = R$ 450 ÷ 2 leads de anúncio (l1, l2); sem isso seria R$ 500 ÷ 2
    const p = painelDeLeads(dados, f({ origem: 'meta' }), agora);
    expect(p.custoPorLead.atual).toBe(22500);
    expect(painelDeLeads(dados, f({ origem: 'google' }), agora).custoPorLead.atual).toBe(5000);
  });

  it('origem sem mídia ou um representante: o custo por lead não se aplica', () => {
    const organico = painelDeLeads(dados, f({ origem: 'organic' }), agora);
    expect(organico.custoNaoSeAplica).toBe('origem');
    expect(organico.custoPorLead).toEqual({ atual: null, anterior: null, variacao: null });
    expect(organico.porOperador.find((l) => l.chave === 'custoPorLead')!.humano).toBeNull();
    const representante = painelDeLeads(dados, f({ representante: 'REP-01' }), agora);
    expect(representante.custoNaoSeAplica).toBe('representante');
    expect(representante.custoPorLead.atual).toBeNull();
    expect(representante.porCampanha.every((c) => c.custoPorLead.atual === null)).toBe(true);
  });

  it('marca escolhida inclui o lead sem marca e só as opções dela', () => {
    const p = painelDeLeads(dados, f({ marca: 'cs' }), agora);
    expect(p.total.atual).toBe(5);
    expect(p.porMarca.map((m) => m.chave)).toEqual(['cs', 'sem-marca']);
    expect(p.semMarca.atual).toBe(1);
    expect(p.opcoesDeFiltro.campanhas.map((c) => c.valor)).toEqual(['c1', 'c2']);
    expect(painelDeLeads(dados, f(), agora).opcoesDeFiltro.representantes).toEqual([
      { valor: 'REP-01', rotulo: 'REP-01' },
      { valor: 'REP-02', rotulo: 'REP-02' },
    ]);
  });

  it('canal, operador, campanha e representante', () => {
    expect(painelDeLeads(dados, f({ canal: 'google' }), agora).total.atual).toBe(1);
    expect(painelDeLeads(dados, f({ operador: 'claude' }), agora).lista.map((l) => l.id)).toEqual(['l2']);
    expect(painelDeLeads(dados, f({ campanha: 'c1' }), agora).total).toMatchObject({ atual: 1, anterior: 1 });
    expect(painelDeLeads(dados, f({ campanha: 'pl-c' }), agora).lista.map((l) => l.id)).toEqual(['l3']);
    expect(painelDeLeads(dados, f({ representante: 'REP-02' }), agora).total.atual).toBe(1);
  });

  it('período: mês passado compara setembro com agosto', () => {
    const p = painelDeLeads(dados, f({ periodo: 'mes-passado' }), agora);
    expect(p.intervalo).toMatchObject({ inicio: '2026-09-01', fim: '2026-09-30' });
    // Agosto tem o l10 (direto): ele é o "anterior" de mês passado
    expect(p.total).toEqual({ atual: 2, anterior: 1, variacao: 1 });
    expect(p.lista.map((l) => l.id)).toEqual(['l8', 'l7']);
    expect(p.porOrigem.map((o) => o.origem)).toEqual(['meta', 'site', 'direct']);
  });
});

describe('painelDeLeads: sem base e com os dados de exemplo', () => {
  it('sem leads, tudo é "Sem dados" (null), nunca 0', () => {
    const p = painelDeLeads({ ...DADOS_VAZIOS }, f(), agora);
    expect(p.total).toEqual({ atual: null, anterior: null, variacao: null });
    expect(p.viraramCliente.atual).toBeNull();
    expect(p.taxaConversao.atual).toBeNull();
    expect(p.custoPorLead.atual).toBeNull();
    expect(p.semMarca.atual).toBeNull();
    expect(p.porEtapa.every((e) => e.leads === null)).toBe(true);
    expect(p.chipsDeOrigem).toEqual([]);
    expect(p.porMarca.every((m) => m.leads.atual === null && m.viraramCliente === null)).toBe(true);
    expect(p.porOrigem).toEqual([]);
    expect(p.porDia.every((d) => d.total === null && d.porMarca.cs === null)).toBe(true);
    expect(p.porCampanha).toEqual([]);
    expect(p.porOperador.every((l) => l.humano === null && l.claude === null && l.diferenca === null)).toBe(
      true,
    );
    expect(p.lista).toEqual([]);
    expect(p.totalDaLista).toBeNull();
    expect(p.opcoesDeFiltro).toEqual({ campanhas: [], representantes: [] });
  });

  it('com leads mas sem investimento lido, o custo por lead é "Sem dados"', () => {
    const p = painelDeLeads({ ...dados, metrics: [] }, f(), agora);
    expect(p.total.atual).toBe(7);
    expect(p.custoNaoSeAplica).toBeNull();
    expect(p.custoPorLead.atual).toBeNull();
    expect(p.porCampanha[0]!.investimento.atual).toBeNull();
    expect(p.porOperador.find((l) => l.chave === 'investimento')!.humano).toBeNull();
  });

  it('com leads mas nenhum no período, a contagem é 0 (não "Sem dados")', () => {
    const p = painelDeLeads(dados, f({ periodo: '7d' }), agora, { etapa: 'invoiced' });
    expect(p.total.atual).toBe(0);
    expect(p.totalDaLista).toBe(0);
    expect(p.porDia.every((d) => d.total === 0)).toBe(true);
    expect(p.taxaConversao.atual).toBeNull();
    expect(p.custoPorLead.atual).toBeNull();
  });

  it('dados de exemplo: números fechados, sem NaN', () => {
    const amostra = gerarDadosDeExemplo({ agora });
    const p = painelDeLeads(amostra, f({ periodo: '30d' }), agora);
    const total = p.total.atual!;
    expect(total).toBeGreaterThan(0);
    expect(p.porMarca.reduce((s, m) => s + (m.leads.atual ?? 0), 0)).toBe(total);
    expect(p.porOrigem.reduce((s, o) => s + (o.leads.atual ?? 0), 0)).toBe(total);
    expect(p.porDia.reduce((s, d) => s + (d.total ?? 0), 0)).toBe(total);
    expect(p.porEtapa.reduce((s, e) => s + (e.leads ?? 0), 0)).toBe(total);
    expect(p.chipsDeOrigem.reduce((s, c) => s + (c.leads ?? 0), 0)).toBe(total);
    expect(p.porCampanha.every((c) => c.operador !== null)).toBe(true);
    expect(p.custoPorLead.atual).toBeGreaterThan(0);
    expect(p.custoPorLead).toEqual(kpisVisaoGeral(amostra, f({ periodo: '30d' }), agora).custoPorLead);
    expect(JSON.stringify(p)).not.toMatch(/NaN|Infinity/);
    expect(p.lista.every((l) => /^LEAD-\d{4}$/.test(l.code))).toBe(true);
  });
});

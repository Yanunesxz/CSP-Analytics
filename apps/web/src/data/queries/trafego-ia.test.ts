import { describe, expect, it } from 'vitest';
import type { Campaign, DailyMetric, Lead, TrafficAction } from '@csp-mkt/shared';
import { dinheiro } from '../../lib/format';
import { FILTROS_PADRAO, type Filtros } from '../../lib/url-state';
import { DADOS_VAZIOS, type Dados } from '../dados';
import { acoes } from '../queries';
import { gerarDadosDeExemplo } from '../sample';
import {
  REGISTRO_VAZIO,
  contasDoTrafego,
  diarioDoTrafego,
  mesCorrente,
  ordemDaFila,
  painelDoTrafego,
  registroDoConjunto,
  ritmoDoGasto,
  situacaoDoCusto,
  situacaoDosClientes,
  type Registro,
} from './trafego-ia';

const agora = new Date('2026-10-30T15:00:00-03:00');
const f = (parcial: Partial<Filtros> = {}): Filtros => ({ ...FILTROS_PADRAO, ...parcial });
const iso = (dia: string, hora = 10) => `${dia}T${String(hora).padStart(2, '0')}:00:00-03:00`;
const GERADO_EM = '2026-10-30T18:00:00.000Z';

const campanha = (
  p: Partial<Campaign> & Pick<Campaign, 'id' | 'platform' | 'brandId' | 'managedBy' | 'utmCampaign'>,
): Campaign => ({
  externalId: `${p.platform}:${p.id}`,
  name: `Campanha ${p.id}`,
  status: 'active',
  dailyBudgetCents: 10000,
  spendCapCents: 300000,
  ...p,
});

const campanhas: Campaign[] = [
  campanha({ id: 'm1', platform: 'meta', brandId: 'cs', managedBy: 'human', utmCampaign: 'cs-meta-a' }),
  campanha({
    id: 'm2',
    platform: 'meta',
    brandId: 'cs',
    managedBy: 'claude',
    utmCampaign: 'cs-meta-b',
    dailyBudgetCents: 20000,
    spendCapCents: 600000,
  }),
  campanha({
    id: 'm3',
    platform: 'meta',
    brandId: 'plumene',
    managedBy: 'claude',
    utmCampaign: 'pl-meta-c',
    status: 'paused',
    spendCapCents: 150000,
  }),
  campanha({
    id: 't1',
    platform: 'tiktok',
    brandId: 'cs',
    managedBy: 'claude',
    utmCampaign: 'cs-tt-a',
    spendCapCents: 100000,
  }),
  campanha({
    id: 'g1',
    platform: 'google',
    brandId: 'plumene',
    managedBy: 'claude',
    utmCampaign: 'pl-g-a',
    spendCapCents: 450000,
  }),
  campanha({
    id: 'g2',
    platform: 'google',
    brandId: 'cs',
    managedBy: 'human',
    utmCampaign: 'cs-g-b',
    status: 'ended',
  }),
];

const gasto = (campaignId: string, date: string, spendCents: number): DailyMetric => {
  const c = campanhas.find((x) => x.id === campaignId)!;
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

const metricas: DailyMetric[] = [
  gasto('m1', '2026-10-05', 100000),
  gasto('m1', '2026-09-20', 50000), // mês passado: fora do gasto do mês
  gasto('m2', '2026-10-10', 200000),
  gasto('m3', '2026-10-02', 30000),
  gasto('t1', '2026-10-15', 97000),
  gasto('g1', '2026-10-20', 500000),
];

const lead = (p: Partial<Lead> & Pick<Lead, 'id' | 'brandId' | 'source' | 'stage' | 'createdAt'>): Lead => ({
  code: p.id.toUpperCase(),
  utmCampaign: null,
  referrerHost: null,
  firstOrderAt: null,
  repId: null,
  crmCustomerId: null,
  ...p,
});

const leads: Lead[] = [
  lead({
    id: 'l1',
    brandId: 'cs',
    source: 'meta',
    utmCampaign: 'cs-meta-a',
    stage: 'first_order',
    createdAt: iso('2026-10-03'),
    firstOrderAt: iso('2026-10-10'),
    crmCustomerId: 'c1',
  }),
  lead({
    id: 'l2',
    brandId: 'cs',
    source: 'meta',
    utmCampaign: 'cs-meta-b',
    stage: 'lead',
    createdAt: iso('2026-10-04'),
  }),
  lead({
    id: 'l3',
    brandId: 'cs',
    source: 'tiktok',
    utmCampaign: 'cs-tt-a',
    stage: 'first_order',
    createdAt: iso('2026-10-12'),
    firstOrderAt: iso('2026-10-20'),
    crmCustomerId: 'c2',
  }),
  lead({
    id: 'l4',
    brandId: 'plumene',
    source: 'google',
    utmCampaign: 'pl-g-a',
    stage: 'lead',
    createdAt: iso('2026-10-05'),
  }),
];

const acao = (p: Partial<TrafficAction> & Pick<TrafficAction, 'id' | 'kind' | 'status'>): TrafficAction => ({
  proposedBy: 'claude',
  brandId: 'cs',
  platform: 'meta',
  campaignId: null,
  title: `Ação ${p.id}`,
  rationale: `Motivo de ${p.id}`,
  paramsJson: '{}',
  impact: 'medium',
  effort: 'medium',
  costCents: null,
  createdAt: iso('2026-10-01'),
  approvedBy: null,
  approvedAt: null,
  executedAt: null,
  result: null,
  ...p,
});

const listaDeAcoes: TrafficAction[] = [
  acao({
    id: 'a1',
    kind: 'budget',
    status: 'idea',
    campaignId: 'm2',
    impact: 'high',
    effort: 'low',
    costCents: 30000,
    createdAt: iso('2026-10-20'),
  }),
  acao({
    id: 'a2',
    kind: 'pause',
    status: 'idea',
    proposedBy: 'human',
    campaignId: 'm1',
    impact: 'medium',
    effort: 'low',
    costCents: 0,
    createdAt: iso('2026-10-18'),
  }),
  acao({
    id: 'a3',
    kind: 'budget',
    status: 'idea',
    brandId: 'plumene',
    platform: 'google',
    campaignId: 'g1',
    impact: 'high',
    effort: 'medium',
    costCents: 10000,
    createdAt: iso('2026-10-25'),
  }),
  acao({
    id: 'a4',
    kind: 'creative',
    status: 'idea',
    platform: 'google',
    campaignId: 'g2',
    impact: 'low',
    effort: 'low',
    costCents: 0,
    createdAt: iso('2026-10-01'),
  }),
  acao({
    id: 'a5',
    kind: 'budget',
    status: 'approved',
    campaignId: 'm1',
    costCents: 5000,
    createdAt: iso('2026-10-02'),
    approvedAt: iso('2026-10-03'),
    approvedBy: 'p1',
  }),
  acao({
    id: 'a6',
    kind: 'bid',
    status: 'running',
    proposedBy: 'human',
    brandId: 'plumene',
    campaignId: 'm3',
    impact: 'low',
    effort: 'high',
    createdAt: iso('2026-10-05'),
    approvedAt: iso('2026-10-05', 16),
    approvedBy: 'p1',
    executedAt: iso('2026-10-06'),
  }),
  acao({
    id: 'a7',
    kind: 'creative',
    status: 'done',
    platform: 'tiktok',
    campaignId: 't1',
    effort: 'low',
    costCents: 0,
    createdAt: iso('2026-10-07'),
    approvedAt: iso('2026-10-07', 12),
    approvedBy: 'p1',
    executedAt: iso('2026-10-08'),
    result: 'Feita. CTR subiu.',
  }),
  acao({
    id: 'a8',
    kind: 'create',
    status: 'done',
    createdAt: iso('2026-09-10'),
    approvedAt: iso('2026-09-11'),
    approvedBy: 'p1',
    executedAt: iso('2026-09-12'),
    result: 'Feita.',
  }),
  acao({
    id: 'a9',
    kind: 'pause',
    status: 'discarded',
    proposedBy: 'human',
    campaignId: 'm1',
    impact: 'low',
    createdAt: iso('2026-10-09'),
    result: 'Esperar o fim do mês.',
  }),
  acao({
    id: 'fix-cs',
    kind: 'pending_fix',
    status: 'idea',
    proposedBy: 'human',
    platform: null,
    impact: 'high',
    effort: 'low',
    costCents: 0,
    createdAt: iso('2026-10-18'),
  }),
];

const base: Dados = {
  ...DADOS_VAZIOS,
  campaigns: campanhas,
  metrics: metricas,
  leads,
  actions: listaDeAcoes,
  profiles: [{ id: 'p1', name: 'Pessoa de teste', email: 'teste@example.com', role: 'owner' }],
  geradoEm: GERADO_EM,
};

const registro = (parcial: Partial<Registro> = {}): Registro => ({
  base: GERADO_EM,
  estrategias: {},
  eventos: [],
  ...parcial,
});

const ids = (lista: Array<{ id: string }>) => lista.map((a) => a.id);

describe('mês corrente e ritmo de gasto', () => {
  it('conta os dias do mês de São Paulo', () => {
    expect(mesCorrente(agora)).toEqual({
      inicio: '2026-10-01',
      hoje: '2026-10-30',
      fim: '2026-10-31',
      diasDecorridos: 30,
      diasNoMes: 31,
    });
    // 01h de 1º/11 em UTC ainda é 31/10 em São Paulo
    expect(mesCorrente(new Date('2026-11-01T01:00:00Z')).hoje).toBe('2026-10-31');
  });

  it('acima, vai passar e no ritmo; sem base é null', () => {
    const mes = mesCorrente(agora);
    expect(ritmoDoGasto(100000, 100000, mes).situacao).toBe('acima');
    const vai = ritmoDoGasto(97000, 100000, mes);
    expect(vai.situacao).toBe('vai_passar');
    expect(vai.projecao).toBe(100233);
    expect(vai.esperadoHoje).toBe(96774);
    expect(ritmoDoGasto(30000, 100000, mes).situacao).toBe('no_ritmo');
    expect(ritmoDoGasto(null, 100000, mes)).toEqual({
      uso: null,
      esperadoHoje: 96774,
      projecao: null,
      situacao: null,
    });
    expect(ritmoDoGasto(5000, null, mes).situacao).toBeNull();
  });
});

describe('contas: gasto do mês contra o limite das campanhas ativas', () => {
  it('soma o gasto de todas as campanhas da conta no mês e o limite só das ativas', () => {
    const contas = contasDoTrafego(base, f(), agora);
    expect(contas).toHaveLength(6);
    const de = (marca: string, canal: string) => contas.find((c) => c.marca === marca && c.canal === canal)!;
    expect(de('cs', 'meta')).toMatchObject({
      gastoNoMes: 300000,
      limite: 900000,
      situacao: 'no_ritmo',
      campanhasAtivas: 2,
      ativasDoClaude: 1,
      orcamentoDiario: 30000,
    });
    expect(de('cs', 'tiktok').situacao).toBe('vai_passar');
    expect(de('plumene', 'google')).toMatchObject({ gastoNoMes: 500000, limite: 450000, situacao: 'acima' });
    // Pausada gasta e conta no gasto, mas não tem limite ativo
    expect(de('plumene', 'meta')).toMatchObject({ gastoNoMes: 30000, limite: null, situacao: null });
    expect(de('cs', 'google')).toMatchObject({ gastoNoMes: 0, limite: null, campanhasAtivas: 0 });
  });

  it('o período escolhido não muda o gasto do mês', () => {
    const noMes = contasDoTrafego(base, f({ periodo: '90d' }), agora);
    expect(noMes.find((c) => c.marca === 'cs' && c.canal === 'meta')?.gastoNoMes).toBe(300000);
  });

  it('respeita marca e canal', () => {
    const contas = contasDoTrafego(base, f({ marca: 'cs', canal: 'tiktok' }), agora);
    expect(contas.map((c) => `${c.marca}:${c.canal}`)).toEqual(['cs:tiktok']);
  });

  it('sem dados: tudo null, nunca 0', () => {
    const [conta] = contasDoTrafego({ ...DADOS_VAZIOS }, f({ marca: 'cs', canal: 'meta' }), agora);
    expect(conta).toMatchObject({ gastoNoMes: null, limite: null, campanhasAtivas: null, situacao: null });
  });
});

describe('fila de aprovação', () => {
  const p = painelDoTrafego(base, f(), agora);

  it('é a mesma fila de acoes() (a da Visão geral), em ordem de impacto, esforço e espera', () => {
    expect(new Set(ids(p.fila))).toEqual(new Set(ids(acoes(base, f(), agora).filaDeAprovacao)));
    expect(ids(p.fila)).toEqual(['a1', 'a3', 'a2', 'a4']);
    expect(p.resumo.naFila).toBe(4);
    expect(p.resumo.custoDaFila).toBe(40000);
  });

  it('a ordem desempata pela mais antiga', () => {
    const velha = acao({
      id: 'v',
      kind: 'bid',
      status: 'idea',
      impact: 'high',
      effort: 'low',
      createdAt: iso('2026-10-01'),
    });
    const nova = acao({
      id: 'n',
      kind: 'bid',
      status: 'idea',
      impact: 'high',
      effort: 'low',
      createdAt: iso('2026-10-20'),
    });
    expect([nova, velha].sort(ordemDaFila).map((a) => a.id)).toEqual(['v', 'n']);
  });

  it('traz os fatos e o alerta de cada proposta', () => {
    const porId = new Map(p.fila.map((i) => [i.id, i]));
    expect(porId.get('a1')).toMatchObject({
      campanha: { nome: 'Campanha m2', status: 'active' },
      conta: { gastoNoMes: 300000, limite: 900000 },
      alerta: null,
    });
    expect(porId.get('a3')?.alerta).toContain('passa do limite do mês');
    expect(porId.get('a4')?.alerta).toBe('A campanha está encerrada: não há o que executar nela.');
    const a6 = p.lista.find((i) => i.id === 'a6');
    expect(a6?.alerta).toBe('A campanha está pausada: a mudança só vale quando ela voltar.');
  });

  it('pendência de medição não entra na fila, mas aparece nas pendências', () => {
    expect(ids(p.fila)).not.toContain('fix-cs');
    expect(ids(p.pendencias)).toEqual(['fix-cs']);
    expect(p.resumo.pendencias).toBe(1);
  });

  it('marca e operador da barra filtram a fila', () => {
    expect(ids(painelDoTrafego(base, f({ marca: 'plumene' }), agora).fila)).toEqual(['a3']);
    expect(ids(painelDoTrafego(base, f({ operador: 'human' }), agora).fila)).toEqual(['a2']);
  });
});

describe('o que podemos fazer', () => {
  it('lista tudo na ordem: status, impacto, esforço e a mais nova', () => {
    const p = painelDoTrafego(base, f(), agora);
    expect(ids(p.lista)).toEqual(['a1', 'fix-cs', 'a3', 'a2', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9']);
    expect(p.porStatus).toEqual({ idea: 5, approved: 1, running: 1, done: 2, discarded: 1 });
    expect(p.totalDaLista).toBe(10);
    expect(p.totalSemFiltrosDaLista).toBe(10);
  });

  it('status, impacto e esforço filtram; os chips contam sem o status', () => {
    const p = painelDoTrafego(base, f(), agora, {
      lista: { status: 'idea', impacto: 'high', esforco: null },
    });
    expect(ids(p.lista)).toEqual(['a1', 'fix-cs', 'a3']);
    expect(p.porStatus).toEqual({ idea: 3, approved: 0, running: 0, done: 0, discarded: 0 });
    expect(p.totalSemFiltrosDaLista).toBe(10);

    const baixo = painelDoTrafego(base, f(), agora, {
      lista: { status: null, impacto: null, esforco: 'low' },
    });
    expect(baixo.lista.every((a) => a.effort === 'low')).toBe(true);
  });

  it('sem nenhuma ação: contagens null ("Sem dados")', () => {
    const p = painelDoTrafego({ ...base, actions: [] }, f(), agora);
    expect(p.porStatus.idea).toBeNull();
    expect(p.totalSemFiltrosDaLista).toBeNull();
    expect(p.resumo.naFila).toBeNull();
    expect(p.lista).toEqual([]);
  });
});

describe('resumo do período', () => {
  it('feitas pela data de execução e horas até aprovar, contra o período anterior', () => {
    const p = painelDoTrafego(base, f(), agora);
    expect(p.resumo.feitas).toEqual({ atual: 1, anterior: 1, variacao: 0 });
    expect(p.resumo.horasAteAprovar.atual).toBeCloseTo(32 / 3, 5);
    expect(p.resumo.horasAteAprovar.anterior).toBe(24);
    expect(p.resumo.aprovadas).toBe(1);
    expect(p.resumo.emExecucao).toBe(1);
  });

  it('sem comparar, não traz o anterior', () => {
    const p = painelDoTrafego(base, f({ comparar: false }), agora);
    expect(p.resumo.feitas).toEqual({ atual: 1, anterior: null, variacao: null });
  });
});

describe('o Claude agora e a última parada', () => {
  it('conta as campanhas ativas do Claude na marca, em todos os canais', () => {
    expect(painelDoTrafego(base, f(), agora).claude.ativas).toBe(3);
    const cs = painelDoTrafego(base, f({ marca: 'cs', canal: 'meta' }), agora).claude;
    expect(cs.ativas).toBe(2);
    expect(cs.porCanal).toEqual([
      { canal: 'meta', ativas: 1 },
      { canal: 'tiktok', ativas: 1 },
      { canal: 'google', ativas: 0 },
    ]);
    expect(painelDoTrafego({ ...DADOS_VAZIOS }, f(), agora).claude.ativas).toBeNull();
  });

  const parada = registro({
    eventos: [
      {
        tipo: 'parar_tudo',
        id: 'parar-1',
        em: iso('2026-10-29', 11),
        por: 'p1',
        marca: 'cs',
        campanhas: ['m2', 't1'],
      },
    ],
  });
  const comPausa: Dados = {
    ...base,
    campaigns: campanhas.map((c) => (c.id === 'm2' ? { ...c, status: 'paused' } : c)),
  };

  it('mostra a parada enquanto alguma campanha dela continua pausada', () => {
    expect(painelDoTrafego(comPausa, f(), agora, { registro: parada }).claude.parada).toEqual({
      id: 'parar-1',
      em: iso('2026-10-29', 11),
      por: 'Pessoa de teste',
      marca: 'cs',
      quantas: 2,
      aindaPausadas: 1,
    });
    // Todas voltaram: nada para desfazer
    expect(painelDoTrafego(base, f(), agora, { registro: parada }).claude.parada).toBeNull();
    // Outra marca na tela
    expect(
      painelDoTrafego(comPausa, f({ marca: 'plumene' }), agora, { registro: parada }).claude.parada,
    ).toBeNull();
  });

  it('some depois de desfeita', () => {
    const desfeita = registro({
      eventos: [
        ...parada.eventos,
        {
          tipo: 'reativar',
          id: 'reat-1',
          em: iso('2026-10-29', 12),
          por: 'p1',
          marca: 'cs',
          campanhas: ['m2'],
          paradaId: 'parar-1',
        },
      ],
    });
    expect(painelDoTrafego(comPausa, f(), agora, { registro: desfeita }).claude.parada).toBeNull();
  });
});

describe('estratégia por marca', () => {
  it('sem estratégia: metas "A definir" (null) e os números do mês', () => {
    const [cs] = painelDoTrafego(base, f({ marca: 'cs' }), agora).estrategias;
    expect(cs?.estrategia).toBeNull();
    expect(cs?.investidoNoMes).toBe(397000);
    expect(cs?.orcamentoDiarioAtivas).toBe(40000);
    expect(cs?.metas.map((m) => [m.chave, m.meta, m.situacao])).toEqual([
      ['verba', null, null],
      ['custoPorClienteNovo', null, null],
      ['custoPorLead', null, null],
      ['clientesNovos', null, null],
    ]);
    expect(cs?.metas.find((m) => m.chave === 'clientesNovos')?.atual).toBe(2);
    expect(cs?.metas.find((m) => m.chave === 'custoPorClienteNovo')?.atual).toBe(198500);
  });

  it('com estratégia: verba no ritmo, custo dentro ou acima da meta, clientes no ritmo', () => {
    const reg = registro({
      estrategias: {
        cs: {
          texto: 'Foco em lojistas novos.',
          verbaDoMesCents: 1000000,
          metaCustoPorClienteNovoCents: 200000,
          metaCustoPorLeadCents: 100000,
          metaClientesNovos: 3,
          atualizadaEm: iso('2026-10-27', 9),
          atualizadaPor: 'p1',
        },
      },
    });
    const [cs] = painelDoTrafego(base, f({ marca: 'cs' }), agora, { registro: reg }).estrategias;
    expect(cs?.atualizadaPor).toBe('Pessoa de teste');
    const situacao = Object.fromEntries(cs!.metas.map((m) => [m.chave, m.situacao?.texto ?? null]));
    expect(situacao).toEqual({
      verba: 'Dentro da verba',
      custoPorClienteNovo: 'Dentro da meta',
      custoPorLead: 'Acima da meta',
      clientesNovos: 'Abaixo do ritmo',
    });
    expect(cs?.verba.projecao).toBe(410233);
  });

  it('situações das metas', () => {
    const mes = mesCorrente(agora);
    expect(situacaoDoCusto(100, 100)?.tom).toBe('success');
    expect(situacaoDoCusto(100, 101)?.tom).toBe('warning');
    expect(situacaoDoCusto(null, 101)).toBeNull();
    expect(situacaoDosClientes(10, 10, mes)?.texto).toBe('Meta batida');
    expect(situacaoDosClientes(31, 30, mes)?.texto).toBe('No ritmo da meta');
    expect(situacaoDosClientes(31, 29, mes)?.texto).toBe('Abaixo do ritmo');
    expect(situacaoDosClientes(10, null, mes)).toBeNull();
  });

  it('registro de outro conjunto (Recomeçar, sem dados) é ignorado', () => {
    const outro = registro({ base: 'outro-conjunto' });
    expect(registroDoConjunto(base, outro)).toBe(REGISTRO_VAZIO);
    expect(registroDoConjunto(base, registro())).not.toBe(REGISTRO_VAZIO);
    const comEstrategia = registro({
      estrategias: {
        cs: {
          texto: 'x',
          verbaDoMesCents: 1,
          metaCustoPorClienteNovoCents: null,
          metaCustoPorLeadCents: null,
          metaClientesNovos: null,
          atualizadaEm: iso('2026-10-27'),
          atualizadaPor: 'p1',
        },
      },
    });
    const semDados = painelDoTrafego({ ...DADOS_VAZIOS }, f({ marca: 'cs' }), agora, {
      registro: comEstrategia,
    });
    expect(semDados.estrategias[0]?.estrategia).toBeNull();
  });
});

describe('diário de ações', () => {
  it('monta proposta, aprovação, execução e feita do período, do mais novo ao mais antigo', () => {
    const eventos = diarioDoTrafego(base, f(), agora);
    expect(eventos).toHaveLength(14);
    expect(eventos[0]).toMatchObject({ id: 'a3:proposta', titulo: 'Proposta do Claude', corpo: 'Ação a3' });
    expect(eventos.map((e) => e.em)).toEqual([...eventos.map((e) => e.em)].sort().reverse());
    const a7 = eventos.filter((e) => e.id.startsWith('a7:')).map((e) => e.tipo);
    expect(a7).toEqual(['feita', 'aprovada', 'proposta']);
    expect(eventos.find((e) => e.id === 'a5:aprovada')?.por).toBe('Pessoa de teste');
    expect(eventos.find((e) => e.id === 'a6:execucao')?.titulo).toBe('Em execução');
    expect(eventos.find((e) => e.id === 'fix-cs:proposta')?.titulo).toBe('Pendência de medição registrada');
    // Setembro (a8) fica fora de "Este mês"; descarte sem hora conhecida não vira linha
    expect(eventos.some((e) => e.id.startsWith('a8:'))).toBe(false);
    expect(eventos.some((e) => e.tipo === 'descartada')).toBe(false);
  });

  const reg = registro({
    eventos: [
      {
        tipo: 'descarte',
        id: 'desc-1',
        em: iso('2026-10-28', 12),
        por: 'p1',
        acaoId: 'a9',
        motivo: 'Esperar o fim do mês.',
      },
      {
        tipo: 'limite',
        id: 'lim-1',
        em: iso('2026-10-29', 10),
        por: 'p1',
        marca: 'cs',
        canal: 'meta',
        deCents: 900000,
        paraCents: 800000,
      },
      {
        tipo: 'parar_tudo',
        id: 'parar-1',
        em: iso('2026-10-29', 11),
        por: 'p1',
        marca: 'todas',
        campanhas: ['m2', 't1'],
      },
      { tipo: 'estrategia', id: 'est-1', em: iso('2026-10-27', 9), por: 'p1', marca: 'cs' },
    ],
  });

  it('junta o registro da tela: descarte com hora, limite, parar tudo e estratégia', () => {
    const eventos = diarioDoTrafego(base, f(), agora, reg);
    expect(eventos).toHaveLength(18);
    expect(eventos.slice(0, 4).map((e) => e.tipo)).toEqual([
      'parar_tudo',
      'limite',
      'descartada',
      'estrategia',
    ]);
    expect(eventos[0]).toMatchObject({
      titulo: 'Parou tudo do Claude',
      por: 'Pessoa de teste',
      tom: 'danger',
      corpo: '2 campanhas pausadas nas duas marcas, em todos os canais.',
    });
    expect(eventos[1]?.corpo).toBe(
      `Meta Ads · Corpo Sensual: ${dinheiro(900000)} → ${dinheiro(800000)} no mês.`,
    );
    expect(eventos[2]).toMatchObject({ titulo: 'Descartada', citacao: 'Esperar o fim do mês.' });
  });

  it('filtros da barra valem para o registro também', () => {
    const tiktok = diarioDoTrafego(base, f({ canal: 'tiktok' }), agora, reg);
    expect(tiktok.map((e) => e.tipo).sort()).toEqual(
      ['aprovada', 'estrategia', 'feita', 'parar_tudo', 'proposta'].sort(),
    );
    const humano = diarioDoTrafego(base, f({ operador: 'human' }), agora, reg);
    expect(humano.some((e) => e.tipo === 'parar_tudo')).toBe(false);
    const plumene = diarioDoTrafego(base, f({ marca: 'plumene' }), agora, reg);
    expect(plumene.some((e) => e.tipo === 'limite' || e.tipo === 'estrategia')).toBe(false);
    expect(plumene.some((e) => e.tipo === 'parar_tudo')).toBe(true);
  });

  it('o painel devolve 20 de cada vez e o total', () => {
    const p = painelDoTrafego(base, f({ periodo: '90d' }), agora, { registro: reg, limiteDoDiario: 5 });
    expect(p.diario.eventos).toHaveLength(5);
    expect(p.diario.total).toBe(21); // 14 de outubro + 3 de setembro (a8) + 4 do registro
  });
});

describe('sem dados e dados de exemplo', () => {
  it('sem dados: métricas null, listas vazias, nada de NaN', () => {
    const p = painelDoTrafego({ ...DADOS_VAZIOS }, f(), agora);
    expect(p.resumo).toMatchObject({ naFila: null, aprovadas: null, pendencias: null });
    expect(p.resumo.feitas.atual).toBeNull();
    expect(p.resumo.horasAteAprovar.atual).toBeNull();
    expect(p.fila).toEqual([]);
    expect(p.diario).toEqual({ eventos: [], total: 0 });
    expect(p.operador.linhas.every((l) => l.humano === null && l.claude === null)).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/NaN|Infinity/);
  });

  it('dados de exemplo: fila igual à da Visão geral, chips somam a lista, nada de NaN', () => {
    const dados = gerarDadosDeExemplo({ agora });
    for (const marca of ['todas', 'cs', 'plumene'] as const) {
      const filtros = f({ marca });
      const p = painelDoTrafego(dados, filtros, agora);
      expect(p.fila.length).toBe(acoes(dados, filtros, agora).filaDeAprovacao.length);
      const soma = Object.values(p.porStatus).reduce<number>((t, n) => t + (n ?? 0), 0);
      expect(soma).toBe(p.totalSemFiltrosDaLista);
      expect(p.pendencias.length).toBeGreaterThan(0);
      expect(JSON.stringify(p)).not.toMatch(/NaN|Infinity/);
    }
  });
});

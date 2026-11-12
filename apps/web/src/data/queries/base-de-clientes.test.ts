import { describe, expect, it } from 'vitest';
import type { Connector, Customer, Order } from '@csp-mkt/shared';
import { FILTROS_PADRAO, type Filtros } from '../../lib/url-state';
import { DADOS_VAZIOS, type Dados } from '../dados';
import { gerarDadosDeExemplo } from '../sample';
import {
  ehDaBase,
  filtrarRecorte,
  linkDaFicha360,
  linkDaListaNoCsp360,
  painelDaBase,
  recortarLista,
  type PainelDaBase,
} from './base-de-clientes';

const agora = new Date('2026-10-30T15:00:00-03:00');
const f = (parcial: Partial<Filtros> = {}): Filtros => ({ ...FILTROS_PADRAO, ...parcial });
const iso = (dia: string, hora = 10) => `${dia}T${String(hora).padStart(2, '0')}:00:00-03:00`;

const cliente = (p: Partial<Customer> & Pick<Customer, 'id'>): Customer => ({
  code: p.id.toUpperCase(),
  brands: ['cs'],
  situation: 'active',
  firstOrderAt: null,
  lastOrderAt: null,
  ordersCount: 0,
  revenueCents: 0,
  repId: null,
  ...p,
});

let numeroPedido = 0;
const pedido = (customerId: string, brandId: Order['brandId'], dia: string, totalCents: number): Order => {
  numeroPedido += 1;
  return {
    id: `ped-${numeroPedido}`,
    brandId,
    customerId,
    status: 'sent',
    isInvoiced: false,
    totalCents,
    invoicedTotalCents: null,
    createdAt: iso(dia),
  };
};

const csp360: Connector = {
  id: 'csp360',
  name: 'CSP 360',
  status: 'late',
  lastSyncAt: '2026-10-30T13:10:00-03:00',
  expectedEveryMinutes: 5,
  errors24h: 1,
  rowsWritten: 10,
};

// "Este mês" em 30/10/2026 = 01/10 a 30/10; o anterior = 01/09 a 30/09.
// O pedido mais antigo do conjunto é de 20/06 (janela conhecida).
const dados: Dados = {
  ...DADOS_VAZIOS,
  customers: [
    // Antigo que recompra em outubro (comprou em 25/09: não é reativado)
    cliente({
      id: 'a1',
      firstOrderAt: iso('2026-03-01'),
      lastOrderAt: iso('2026-10-20'),
      ordersCount: 9,
      repId: 'REP-01',
    }),
    // Antigo que volta em 22/10 depois de 113 dias sem pedido: reativado
    cliente({
      id: 'r1',
      brands: ['plumene'],
      firstOrderAt: iso('2025-01-01'),
      lastOrderAt: iso('2026-10-22'),
      ordersCount: 4,
      repId: 'REP-02',
    }),
    cliente({
      id: 'i1',
      situation: 'inactive_recent',
      firstOrderAt: iso('2025-06-01'),
      lastOrderAt: iso('2026-06-15'),
      ordersCount: 3,
      repId: 'REP-01',
    }),
    cliente({
      id: 'i2',
      brands: ['cs', 'plumene'],
      situation: 'inactive_old',
      firstOrderAt: iso('2024-05-01'),
      lastOrderAt: iso('2026-02-01'),
      ordersCount: 5,
    }),
    cliente({
      id: 'p1',
      situation: 'lost',
      firstOrderAt: iso('2024-01-01'),
      lastOrderAt: iso('2025-02-01'),
      ordersCount: 2,
      repId: 'REP-02',
    }),
    // Novo de outubro
    cliente({
      id: 'n1',
      firstOrderAt: iso('2026-10-08'),
      lastOrderAt: iso('2026-10-08'),
      ordersCount: 1,
      repId: 'REP-01',
    }),
    // Novo de setembro: em outubro já é antigo
    cliente({
      id: 'n2',
      brands: ['plumene'],
      firstOrderAt: iso('2026-09-20'),
      lastOrderAt: iso('2026-09-20'),
      ordersCount: 1,
    }),
    // Sem situação no CSP 360, compra das duas marcas
    cliente({
      id: 's1',
      brands: ['cs', 'plumene'],
      situation: null,
      firstOrderAt: iso('2026-02-10'),
      lastOrderAt: iso('2026-10-15'),
      ordersCount: 6,
      repId: 'REP-03',
    }),
    // Ainda é lead: fica fora da base
    cliente({ id: 'l1', situation: 'lead', repId: 'REP-01' }),
    // Sem pedido e sem situação: fica fora da base
    cliente({ id: 'x1', brands: [], situation: null }),
  ],
  orders: [
    pedido('a1', 'cs', '2026-08-10', 30000),
    pedido('a1', 'cs', '2026-09-25', 40000),
    pedido('a1', 'cs', '2026-10-20', 50000),
    pedido('r1', 'plumene', '2026-07-01', 60000),
    pedido('r1', 'plumene', '2026-10-22', 80000),
    pedido('n1', 'cs', '2026-10-08', 100000),
    pedido('n2', 'plumene', '2026-09-20', 150000),
    pedido('s1', 'cs', '2026-06-20', 10000),
    pedido('s1', 'plumene', '2026-09-10', 25000),
    pedido('s1', 'plumene', '2026-10-05', 20000),
    pedido('s1', 'cs', '2026-10-15', 30000),
  ],
  connectors: [csp360],
  geradoEm: agora.toISOString(),
};

const linha = <T extends { marca?: unknown; representante?: unknown }>(
  linhas: T[],
  chave: 'marca' | 'representante',
  valor: unknown,
) => linhas.find((l) => l[chave] === valor);

describe('links para o CSP 360', () => {
  it('ficha 360 só com o id do cliente', () => {
    expect(linkDaFicha360('cli-0001')).toBe('https://csp360.example/clientes/cli-0001');
    expect(linkDaFicha360('a/b c')).toBe('https://csp360.example/clientes/a%2Fb%20c');
  });

  it('lista com marca, representante e recorte da tela', () => {
    expect(linkDaListaNoCsp360({ marca: 'todas', representante: null }, null)).toBe(
      'https://csp360.example/clientes',
    );
    expect(linkDaListaNoCsp360({ marca: 'cs', representante: 'REP-01' }, 'inativos')).toBe(
      'https://csp360.example/clientes?marca=cs&representante=REP-01&recorte=inativos',
    );
  });
});

describe('quem é da base', () => {
  it('tem pedido ou situação de cliente; lead e cadastro sem pedido ficam fora', () => {
    const porId = new Map(dados.customers.map((c) => [c.id, c]));
    expect(ehDaBase(porId.get('a1')!)).toBe(true);
    expect(ehDaBase(porId.get('s1')!)).toBe(true);
    expect(ehDaBase(porId.get('l1')!)).toBe(false);
    expect(ehDaBase(porId.get('x1')!)).toBe(false);
    expect(ehDaBase(cliente({ id: 'z', situation: 'lost' }))).toBe(true);
  });
});

describe('painelDaBase', () => {
  const p = painelDaBase(dados, f(), agora);

  it('hoje, pela situação do CSP 360: só clientes com pedido', () => {
    expect(p.situacaoConhecida).toBe(true);
    expect(p.total).toBe(8);
    expect(p.ativos).toBe(4);
    expect(p.inativosRecentes).toBe(1);
    expect(p.inativosAntigos).toBe(1);
    expect(p.inativos).toBe(2);
    expect(p.perdidos).toBe(1);
    expect(p.semSituacao).toBe(1);
    expect((p.ativos ?? 0) + (p.inativos ?? 0) + (p.perdidos ?? 0) + (p.semSituacao ?? 0)).toBe(p.total);
  });

  it('no período: recompra, reativados e receita de antigos × novos, com o período anterior', () => {
    expect(p.antigos).toBe(7);
    expect(p.recompraram).toEqual({ atual: 3, anterior: 2, variacao: 0.5 });
    expect(p.taxaRecompra.atual).toBeCloseTo(3 / 7);
    expect(p.taxaRecompra.anterior).toBeCloseTo(1 / 3);
    // Reativado: r1 (113 dias sem pedido). Anterior 0 → sem variação (nunca divide por zero)
    expect(p.reativados).toEqual({ atual: 1, anterior: 0, variacao: null });
    expect(p.receitaAntigos.atual).toBe(180000);
    expect(p.receitaAntigos.anterior).toBe(65000);
    expect(p.receitaNovos.atual).toBe(100000);
    expect(p.receitaNovos.anterior).toBe(150000);
    expect(p.participacaoAntigos.atual).toBeCloseTo(180000 / 280000);
    expect(p.participacaoNovos).toBeCloseTo(100000 / 280000);
  });

  it('tempo desde a última compra, por faixa', () => {
    expect(p.faixasDeUltimaCompra.map((x) => [x.faixa, x.total])).toEqual([
      ['ate-30', 4],
      ['31-90', 1],
      ['91-180', 1],
      ['181-365', 1],
      ['mais-de-365', 1],
    ]);
  });

  it('por marca: cada marca com a própria régua; "As duas" conta cada cliente uma vez', () => {
    expect(p.porMarca.map((l) => l.marca)).toEqual(['cs', 'plumene', 'todas']);
    expect(linha(p.porMarca, 'marca', 'cs')).toEqual({
      marca: 'cs',
      clientes: 6,
      ativos: 2,
      inativos: 2,
      perdidos: 1,
      recompraram: 2,
      taxaRecompra: 0.4,
      // s1 não comprava Corpo Sensual desde 20/06: reativado na marca, não no grupo
      reativados: 1,
    });
    expect(linha(p.porMarca, 'marca', 'plumene')).toEqual({
      marca: 'plumene',
      clientes: 4,
      ativos: 2,
      inativos: 1,
      perdidos: 0,
      recompraram: 2,
      taxaRecompra: 0.5,
      reativados: 1,
    });
    expect(linha(p.porMarca, 'marca', 'todas')).toMatchObject({ clientes: 8, reativados: 1 });
  });

  it('por representante: carteira de cada um, "sem representante" por último', () => {
    expect(p.porRepresentante.map((l) => l.representante)).toEqual(['REP-01', 'REP-02', 'REP-03', null]);
    expect(linha(p.porRepresentante, 'representante', 'REP-01')).toEqual({
      representante: 'REP-01',
      clientes: 3,
      ativos: 2,
      inativos: 1,
      perdidos: 0,
      recompraram: 1,
      taxaRecompra: 0.5,
      reativados: 0,
    });
    expect(linha(p.porRepresentante, 'representante', 'REP-02')).toMatchObject({
      reativados: 1,
      perdidos: 1,
    });
    expect(linha(p.porRepresentante, 'representante', null)).toMatchObject({
      clientes: 2,
      recompraram: 0,
      reativados: 0,
    });
    // As carteiras dividem a base: somadas, dão o total do grupo
    const soma = (campo: 'clientes' | 'recompraram' | 'reativados') =>
      p.porRepresentante.reduce((s, l) => s + (l[campo] ?? 0), 0);
    expect(soma('clientes')).toBe(p.total);
    expect(soma('recompraram')).toBe(p.recompraram.atual);
    expect(soma('reativados')).toBe(p.reativados.atual);
    expect(p.representantes).toEqual([
      { valor: 'REP-01', rotulo: 'REP-01' },
      { valor: 'REP-02', rotulo: 'REP-02' },
      { valor: 'REP-03', rotulo: 'REP-03' },
    ]);
  });

  it('lista: há mais tempo sem comprar primeiro, com o link da ficha 360 e sem dado pessoal', () => {
    expect(p.lista.map((c) => c.id)).toEqual(['p1', 'i2', 'i1', 'n2', 'n1', 's1', 'a1', 'r1']);
    expect(p.lista.find((c) => c.id === 'r1')).toMatchObject({
      reativado: true,
      comprouNoPeriodo: true,
      diasDesdeUltimaCompra: 8,
      receitaNoPeriodoCents: 80000,
      linkCrm: 'https://csp360.example/clientes/r1',
    });
    expect(JSON.stringify(p.lista)).not.toMatch(/nome|name|telefone|phone|e-?mail|cnpj|cpf|document/i);
    expect(p.recortes).toEqual({ ativos: 4, inativos: 2, perdidos: 1, reativados: 1, 'sem-situacao': 1 });
  });

  it('conector do CSP 360, para avisar atraso', () => {
    expect(p.conector).toEqual({ status: 'late', lastSyncAt: '2026-10-30T13:10:00-03:00' });
    expect(painelDaBase({ ...dados, connectors: [] }, f(), agora).conector).toBeNull();
  });
});

describe('painelDaBase com filtros', () => {
  it('marca: só quem compra dela, e a tabela por marca fica com uma linha', () => {
    const p = painelDaBase(dados, f({ marca: 'cs' }), agora);
    expect(p.total).toBe(6);
    expect(p.semSituacao).toBe(1);
    expect(p.recompraram.atual).toBe(2);
    expect(p.reativados.atual).toBe(1);
    expect(p.receitaAntigos.atual).toBe(80000);
    expect(p.receitaNovos.atual).toBe(100000);
    expect(p.porMarca.map((l) => l.marca)).toEqual(['cs']);
    expect(p.lista.every((c) => c.brands.includes('cs'))).toBe(true);
  });

  it('representante: só a carteira dele', () => {
    const p = painelDaBase(dados, f({ representante: 'REP-02' }), agora);
    expect(p.total).toBe(2);
    expect(p.lista.map((c) => c.id)).toEqual(['p1', 'r1']);
    expect(p.porRepresentante.map((l) => l.representante)).toEqual(['REP-02']);
  });

  it('sem comparar: o período anterior não entra', () => {
    const p = painelDaBase(dados, f({ comparar: false }), agora);
    expect(p.recompraram).toEqual({ atual: 3, anterior: null, variacao: null });
    expect(p.taxaRecompra.variacao).toBeNull();
  });
});

describe('painelDaBase sem a situação do CSP 360 e sem dados', () => {
  it('sem situação: ativos, inativos e perdidos ficam null ("Sem dados"), o resto continua', () => {
    const semSituacao: Dados = {
      ...dados,
      customers: dados.customers.map((c) => ({ ...c, situation: null })),
    };
    const p = painelDaBase(semSituacao, f(), agora);
    expect(p.situacaoConhecida).toBe(false);
    expect(p.total).toBe(8);
    expect([p.ativos, p.inativos, p.inativosRecentes, p.inativosAntigos, p.perdidos]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(p.semSituacao).toBe(8);
    expect(p.recortes).toEqual({
      ativos: null,
      inativos: null,
      perdidos: null,
      reativados: 1,
      'sem-situacao': 8,
    });
    expect(p.reativados.atual).toBe(1);
    expect(linha(p.porMarca, 'marca', 'cs')).toMatchObject({ clientes: 6, ativos: null, perdidos: null });
  });

  it('sem dados: tudo null ou vazio, nunca 0', () => {
    const p: PainelDaBase = painelDaBase({ ...DADOS_VAZIOS }, f(), agora);
    expect(p.total).toBeNull();
    expect(p.ativos).toBeNull();
    expect(p.semSituacao).toBeNull();
    expect(p.antigos).toBeNull();
    expect(p.recompraram.atual).toBeNull();
    expect(p.reativados.atual).toBeNull();
    expect(p.receitaAntigos.atual).toBeNull();
    expect(p.participacaoAntigos.atual).toBeNull();
    expect(p.participacaoNovos).toBeNull();
    expect(p.faixasDeUltimaCompra.every((x) => x.total === null)).toBe(true);
    expect(p.porMarca).toEqual([]);
    expect(p.porRepresentante).toEqual([]);
    expect(p.representantes).toEqual([]);
    expect(Object.values(p.recortes).every((v) => v === null)).toBe(true);
    expect(p.lista).toEqual([]);
    expect(p.conector).toBeNull();
  });

  it('clientes sem nenhum pedido no conjunto: receita null, contagens 0 ou mais', () => {
    const p = painelDaBase({ ...dados, orders: [] }, f(), agora);
    expect(p.receitaAntigos.atual).toBeNull();
    expect(p.receitaNovos.atual).toBeNull();
    expect(p.participacaoNovos).toBeNull();
    expect(p.recompraram.atual).toBe(0);
    expect(linha(p.porMarca, 'marca', 'todas')).toMatchObject({ clientes: 8, recompraram: 0, reativados: 0 });
  });
});

describe('recortes da lista', () => {
  const { lista } = painelDaBase(dados, f(), agora);

  it('cada filtro rápido mostra o seu grupo, na ordem da lista', () => {
    expect(filtrarRecorte(lista, 'inativos').map((c) => c.id)).toEqual(['i2', 'i1']);
    expect(filtrarRecorte(lista, 'perdidos').map((c) => c.id)).toEqual(['p1']);
    expect(filtrarRecorte(lista, 'reativados').map((c) => c.id)).toEqual(['r1']);
    expect(filtrarRecorte(lista, 'sem-situacao').map((c) => c.id)).toEqual(['s1']);
    expect(filtrarRecorte(lista, 'ativos').map((c) => c.id)).toEqual(['n2', 'n1', 'a1', 'r1']);
    const todos = filtrarRecorte(lista, null);
    expect(todos).toEqual(lista);
    expect(todos).not.toBe(lista);
  });

  it('corta no limite e diz quantos o grupo tem', () => {
    expect(recortarLista(lista, null, 3)).toMatchObject({ total: 8, cortada: true });
    expect(recortarLista(lista, null, 3).linhas.map((c) => c.id)).toEqual(['p1', 'i2', 'i1']);
    expect(recortarLista(lista, 'inativos')).toMatchObject({ total: 2, cortada: false });
  });
});

describe('com os dados de exemplo', () => {
  const exemplo = gerarDadosDeExemplo({ agora });

  it('os números fecham e nada vira NaN', () => {
    for (const filtros of [
      f(),
      f({ marca: 'plumene', periodo: '90d' }),
      f({ periodo: '7d', comparar: false }),
    ]) {
      const p = painelDaBase(exemplo, filtros, agora);
      const texto = JSON.stringify(p);
      expect(texto).not.toContain('NaN');
      expect(texto).not.toContain('Infinity');
      expect(p.total).toBeGreaterThan(0);
      expect((p.ativos ?? 0) + (p.inativos ?? 0) + (p.perdidos ?? 0) + (p.semSituacao ?? 0)).toBe(p.total);
      expect(p.lista).toHaveLength(p.total ?? -1);
      const somaDasCarteiras = (campo: 'clientes' | 'recompraram' | 'reativados') =>
        p.porRepresentante.reduce((s, l) => s + (l[campo] ?? 0), 0);
      expect(somaDasCarteiras('clientes')).toBe(p.total);
      expect(somaDasCarteiras('recompraram')).toBe(p.recompraram.atual);
      expect(somaDasCarteiras('reativados')).toBe(p.reativados.atual);
      expect(p.recortes.reativados).toBe(p.reativados.atual);
      const faixas = p.faixasDeUltimaCompra.reduce((s, x) => s + (x.total ?? 0), 0);
      expect(faixas).toBeGreaterThan(0);
      expect(faixas).toBeLessThanOrEqual(p.total ?? 0);
    }
  });

  it('em "As duas", a linha de cada marca soma mais que o total (quem compra das duas conta nas duas)', () => {
    const p = painelDaBase(exemplo, f(), agora);
    const [cs, plumene, todas] = p.porMarca;
    expect(todas).toMatchObject({ marca: 'todas', clientes: p.total });
    expect((cs?.clientes ?? 0) + (plumene?.clientes ?? 0)).toBeGreaterThan(p.total ?? 0);
    expect(p.reativados.atual).toBeGreaterThan(0);
  });

  it('a lista leva só código, marcas, situação, datas e números do CSP 360', () => {
    const p = painelDaBase(exemplo, f(), agora);
    const permitidas = new Set([
      'id',
      'code',
      'brands',
      'situation',
      'firstOrderAt',
      'lastOrderAt',
      'ordersCount',
      'revenueCents',
      'repId',
      'diasDesdeUltimaCompra',
      'comprouNoPeriodo',
      'reativado',
      'receitaNoPeriodoCents',
      'linkCrm',
    ]);
    for (const c of p.lista) for (const chave of Object.keys(c)) expect(permitidas.has(chave)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import type { Campaign } from '@csp-mkt/shared';
import { dinheiro } from '../../lib/format';
import {
  claudeMelhor,
  escalarLimites,
  lerInteiro,
  lerReais,
  nomeDoMes,
  temDadoPessoal,
  validarEstrategia,
  validarIdeia,
  validarTexto,
  valorParaCampo,
  type CamposDaIdeia,
} from './regras';

describe('lerReais: aceita o jeito que a pessoa digita (lei de Postel)', () => {
  it.each([
    ['1.234,56', 123456],
    ['1234,56', 123456],
    ['1234.56', 123456],
    ['1.234', 123400],
    ['1.234.567', 123456700],
    ['1,5', 150],
    ['12.5', 1250],
    ['R$ 1.234', 123400],
    ['  15000 ', 1500000],
    ['0', 0],
    [',50', 50],
  ])('%s → %i centavos', (texto, cents) => {
    expect(lerReais(texto)).toBe(cents);
  });

  it('lê o que o próprio sistema escreve (R$ com espaço que não quebra)', () => {
    expect(lerReais(dinheiro(1234500))).toBe(1234500);
    expect(lerReais(dinheiro(1234567))).toBe(1234567);
  });

  it.each(['', '   ', 'abc', '12,345', '1,2,3', '-10', 'R$'])('"%s" é inválido', (texto) => {
    expect(lerReais(texto)).toBeNull();
  });

  it('valorParaCampo devolve o texto do campo e volta igual', () => {
    expect(valorParaCampo(123400)).toBe('1.234');
    expect(valorParaCampo(123456)).toBe('1.234,56');
    expect(valorParaCampo(null)).toBe('');
    expect(lerReais(valorParaCampo(98765432))).toBe(98765432);
  });

  it('lerInteiro aceita texto em volta', () => {
    expect(lerInteiro('20 clientes')).toBe(20);
    expect(lerInteiro('1.200')).toBe(1200);
    expect(lerInteiro('nenhum')).toBeNull();
  });
});

describe('dado pessoal no texto que vai para o Claude', () => {
  it.each([
    'fale com a compradora em loja@exemplo.com.br',
    'ligar para (11) 98765-4321',
    'telefone 11987654321',
    'cliente 123.456.789-01',
    'CNPJ 12.345.678/0001-90',
  ])('barra "%s"', (texto) => {
    expect(temDadoPessoal(texto)).toBe(true);
  });

  it.each([
    'Foco em lojistas novos no Meta; verba de R$ 15.000 no mês.',
    'Repostar o reel do @plumene.oficial com o melhor CTR de outubro.',
    'Testar 3 criativos por 7 dias e pausar quem passar de R$ 40 por lead.',
  ])('deixa passar "%s"', (texto) => {
    expect(temDadoPessoal(texto)).toBe(false);
  });
});

describe('validação dos formulários', () => {
  const vazia = {
    texto: '',
    verba: '',
    metaCustoPorClienteNovo: '',
    metaCustoPorLead: '',
    metaClientesNovos: '',
  };

  it('estratégia: tudo opcional, mas o que vem precisa fazer sentido', () => {
    expect(validarEstrategia(vazia)).toEqual({});
    expect(validarEstrategia({ ...vazia, verba: '15.000', metaClientesNovos: '20' })).toEqual({});
    const erros = validarEstrategia({
      texto: 'ligar para (11) 98765-4321',
      verba: 'muito',
      metaCustoPorClienteNovo: '0',
      metaCustoPorLead: '30',
      metaClientesNovos: 'zero',
    });
    expect(Object.keys(erros).sort()).toEqual([
      'metaClientesNovos',
      'metaCustoPorClienteNovo',
      'texto',
      'verba',
    ]);
    expect(erros.metaCustoPorClienteNovo).toBe('A meta precisa ser maior que zero.');
  });

  const ideia: CamposDaIdeia = {
    titulo: 'Testar vídeo curto',
    motivo: 'O vídeo de 15 s teve o dobro de cliques.',
    marca: 'plumene',
    canal: 'tiktok',
    tipo: 'creative',
    campanha: '',
    impacto: 'medium',
    esforco: 'low',
    custo: '',
  };

  it('ideia: título, motivo, marca e tipo; custo zero vale', () => {
    expect(validarIdeia(ideia)).toEqual({});
    expect(validarIdeia({ ...ideia, custo: '0' })).toEqual({});
    expect(validarIdeia({ ...ideia, custo: '2.700,00' })).toEqual({});
    expect(
      Object.keys(
        validarIdeia({ ...ideia, titulo: 'oi', motivo: 'curto', marca: '', tipo: '', custo: 'x' }),
      ).sort(),
    ).toEqual(['custo', 'marca', 'motivo', 'tipo', 'titulo']);
    expect(validarIdeia({ ...ideia, motivo: 'mandar para fulano@exemplo.com hoje' }).motivo).toContain(
      'vai para o Claude',
    );
  });

  it('texto com mínimo de letras', () => {
    expect(validarTexto('  curto ', 10)).toBe('Escreva pelo menos 10 letras.');
    expect(validarTexto('o limite já está no fim', 10)).toBeUndefined();
  });
});

describe('Humano × Claude: melhor ou pior', () => {
  it('custo menor é melhor; volume e verba não se julgam', () => {
    expect(claudeMelhor({ chave: 'cpl', diferenca: -0.1, menorEhMelhor: true })).toBe(true);
    expect(claudeMelhor({ chave: 'cpl', diferenca: 0.1, menorEhMelhor: true })).toBe(false);
    expect(claudeMelhor({ chave: 'leads', diferenca: 0.2, menorEhMelhor: false })).toBe(true);
    expect(claudeMelhor({ chave: 'investimento', diferenca: 0.5, menorEhMelhor: false })).toBeNull();
    expect(claudeMelhor({ chave: 'acoesPropostas', diferenca: -0.5, menorEhMelhor: false })).toBeNull();
    expect(claudeMelhor({ chave: 'roas', diferenca: null, menorEhMelhor: false })).toBeNull();
  });
});

describe('escalarLimites: o limite da conta repartido entre as campanhas ativas', () => {
  const c = (id: string, spendCapCents: number, p: Partial<Campaign> = {}): Campaign => ({
    id,
    externalId: id,
    platform: 'meta',
    brandId: 'cs',
    name: id,
    utmCampaign: id,
    managedBy: 'human',
    status: 'active',
    dailyBudgetCents: 1000,
    spendCapCents,
    ...p,
  });
  const lista = [
    c('a', 100000),
    c('b', 200000),
    c('c', 333333),
    c('pausada', 50000, { status: 'paused' }),
    c('outra-marca', 70000, { brandId: 'plumene' }),
    c('outro-canal', 80000, { platform: 'google' }),
  ];

  it('mantém a proporção e a soma bate ao centavo; o resto não muda', () => {
    const novo = escalarLimites(lista, 'cs', 'meta', 1000000);
    const caps = Object.fromEntries(novo.map((x) => [x.id, x.spendCapCents]));
    expect(caps.a! + caps.b! + caps.c!).toBe(1000000);
    expect(caps.b! / caps.a!).toBeCloseTo(2, 3);
    expect(caps).toMatchObject({ pausada: 50000, 'outra-marca': 70000, 'outro-canal': 80000 });
  });

  it('limites zerados: reparte igual', () => {
    const novo = escalarLimites([c('x', 0), c('y', 0)], 'cs', 'meta', 1001);
    expect(novo.map((x) => x.spendCapCents)).toEqual([501, 500]);
  });

  it('sem campanha ativa na conta, nada muda', () => {
    expect(escalarLimites(lista, 'plumene', 'tiktok', 5000)).toEqual(lista);
  });
});

describe('nome do mês', () => {
  it('em português, no fuso de São Paulo', () => {
    expect(nomeDoMes('2026-10-01')).toBe('outubro');
    expect(nomeDoMes('2026-03-01')).toBe('março');
  });
});

import { describe, expect, it } from 'vitest';
import type { LinhaHumanoClaude } from '../../data/queries/canais';
import {
  avaliarDiferenca,
  custoDoAjuste,
  duracao,
  fraseDaComparacao,
  fraseDoAjuste,
  lerReais,
  mudancaGrande,
  textoDaAcaoAberta,
  validarOrcamento,
  valorParaCampo,
} from './formatos';

const NBSP = String.fromCharCode(160);

describe('lerReais', () => {
  it('aceita vírgula ou ponto e grava em centavos', () => {
    expect(lerReais('150')).toBe(15000);
    expect(lerReais('150,5')).toBe(15050);
    expect(lerReais('150,00')).toBe(15000);
    expect(lerReais('150.50')).toBe(15050);
    expect(lerReais('1.500')).toBe(150000);
    expect(lerReais('1.500,75')).toBe(150075);
    expect(lerReais('1,500.75')).toBe(150075);
    expect(lerReais('1500.00')).toBe(150000);
    expect(lerReais('12.345.678')).toBe(1234567800);
    expect(lerReais('1,5')).toBe(150);
    expect(lerReais(',29')).toBe(29);
  });

  it('ignora R$ e espaços, inclusive o espaço que não quebra', () => {
    expect(lerReais('R$ 240')).toBe(24000);
    expect(lerReais(` R$${NBSP}1.200,00 `)).toBe(120000);
  });

  it('devolve null quando não é número; negativo passa para a validação recusar', () => {
    expect(lerReais('')).toBeNull();
    expect(lerReais('abc')).toBeNull();
    expect(lerReais('150 reais')).toBeNull();
    expect(lerReais('1..5')).toBeNull();
    expect(lerReais(',')).toBeNull();
    expect(lerReais('-10')).toBe(-1000);
  });

  it('volta para o campo no formato que a pessoa lê', () => {
    expect(valorParaCampo(120000)).toBe('1.200,00');
    expect(lerReais(valorParaCampo(98765))).toBe(98765);
  });
});

describe('orçamento', () => {
  it('valida o novo orçamento diário', () => {
    expect(validarOrcamento(null, 10000)).toBe('Informe um valor em reais, como 150 ou 150,00.');
    expect(validarOrcamento(0, 10000)).toBe('Use um valor maior que zero.');
    expect(validarOrcamento(-500, 10000)).toBe('Use um valor maior que zero.');
    expect(validarOrcamento(10000, 10000)).toBe('O valor é igual ao de hoje.');
    expect(validarOrcamento(12000, 10000)).toBeNull();
  });

  it('custo estimado só do aumento, em 30 dias', () => {
    expect(custoDoAjuste(12000, 15000)).toBe(90000);
    expect(custoDoAjuste(12000, 9000)).toBe(0);
  });

  it('frase do ajuste diz quanto muda por dia e em 30 dias', () => {
    expect(fraseDoAjuste(12000, 15000)).toBe(
      `Sobe 25,0%: R$${NBSP}30 a mais por dia, cerca de R$${NBSP}900 em 30 dias.`,
    );
    expect(fraseDoAjuste(12000, 9600)).toBe(
      `Desce 20,0%: R$${NBSP}24 a menos por dia, cerca de R$${NBSP}720 em 30 dias.`,
    );
    expect(fraseDoAjuste(12000, 12000)).toBe('Fica igual ao de hoje.');
  });

  it('mudança acima de 50% pede conferência', () => {
    expect(mudancaGrande(10000, 15000)).toBe(false);
    expect(mudancaGrande(10000, 15100)).toBe(true);
    expect(mudancaGrande(10000, 4000)).toBe(true);
  });
});

const linha = (p: Partial<LinhaHumanoClaude> & Pick<LinhaHumanoClaude, 'chave'>): LinhaHumanoClaude => ({
  rotulo: p.chave,
  formato: 'dinheiro',
  humano: 100,
  claude: 86,
  diferenca: -0.14,
  menorEhMelhor: true,
  sentido: 'menor',
  ...p,
});

describe('Humano × Claude', () => {
  it('avalia a diferença pelo sentido da métrica', () => {
    expect(avaliarDiferenca(-0.14, 'menor')).toBe('melhor');
    expect(avaliarDiferenca(0.08, 'menor')).toBe('pior');
    expect(avaliarDiferenca(0.2, 'maior')).toBe('melhor');
    expect(avaliarDiferenca(-0.2, 'maior')).toBe('pior');
    expect(avaliarDiferenca(0.5, 'neutro')).toBeNull();
    expect(avaliarDiferenca(0, 'menor')).toBeNull();
    expect(avaliarDiferenca(null, 'menor')).toBeNull();
  });

  it('frase pelo custo por cliente novo e, sem ele, pelo custo por lead', () => {
    expect(
      fraseDaComparacao([
        linha({ chave: 'cpl', rotulo: 'Custo por lead', diferenca: -0.14 }),
        linha({ chave: 'custoPorClienteNovo', rotulo: 'Custo por cliente novo', diferenca: 0.1 }),
      ]),
    ).toBe('No período, o custo por cliente novo do Claude está 10,0% acima do humano.');
    expect(
      fraseDaComparacao([
        linha({ chave: 'cpl', rotulo: 'Custo por lead', diferenca: -0.14 }),
        linha({ chave: 'custoPorClienteNovo', rotulo: 'Custo por cliente novo', diferenca: null }),
      ]),
    ).toBe('No período, o custo por lead do Claude está 14,0% abaixo do humano.');
    expect(fraseDaComparacao([linha({ chave: 'cpl', diferenca: null })])).toBeNull();
  });
});

describe('textos de apoio', () => {
  it('ação já decidida para a campanha', () => {
    expect(textoDaAcaoAberta({ id: 'a', kind: 'pause', status: 'approved', dailyBudgetCents: null })).toBe(
      'Pausa aprovada',
    );
    expect(textoDaAcaoAberta({ id: 'a', kind: 'pause', status: 'running', dailyBudgetCents: null })).toBe(
      'Pausa em execução',
    );
    expect(textoDaAcaoAberta({ id: 'a', kind: 'budget', status: 'approved', dailyBudgetCents: 24000 })).toBe(
      `Orçamento aprovado: R$${NBSP}240 por dia`,
    );
    expect(textoDaAcaoAberta({ id: 'a', kind: 'budget', status: 'running', dailyBudgetCents: null })).toBe(
      'Orçamento em execução',
    );
  });

  it('duração em minutos, horas e dias', () => {
    expect(duracao(0)).toBe('menos de 1 min');
    expect(duracao(5)).toBe('5 min');
    expect(duracao(60)).toBe('1 h');
    expect(duracao(200)).toBe('3 h');
    expect(duracao(1440)).toBe('1 dia');
    expect(duracao(4000)).toBe('2 dias');
  });
});

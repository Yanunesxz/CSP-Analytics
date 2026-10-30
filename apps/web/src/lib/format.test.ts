import { describe, expect, it } from 'vitest';
import {
  atualizadoHa,
  data,
  dataHora,
  diaMes,
  diferenca,
  dinheiro,
  dinheiroAbreviado,
  mesAno,
  numero,
  numeroAbreviado,
  percentual,
  plural,
  variacao,
} from './format';

const nbsp = String.fromCharCode(160);

describe('dinheiro', () => {
  it('sem casas quando o valor é inteiro em reais', () => {
    expect(dinheiro(123400)).toBe(`R$${nbsp}1.234`);
    expect(dinheiro(0)).toBe(`R$${nbsp}0`);
  });
  it('com duas casas quando tem centavos', () => {
    expect(dinheiro(123456)).toBe(`R$${nbsp}1.234,56`);
    expect(dinheiro(5)).toBe(`R$${nbsp}0,05`);
  });
  it('sem base vira traço, nunca 0 nem NaN', () => {
    expect(dinheiro(null)).toBe('—');
    expect(dinheiro(undefined)).toBe('—');
    expect(dinheiro(Number.NaN)).toBe('—');
  });
  it('abreviado', () => {
    expect(dinheiroAbreviado(8_240_000)).toBe(`R$${nbsp}82,4 mil`);
    expect(dinheiroAbreviado(120_000_000)).toBe(`R$${nbsp}1,2 mi`);
    expect(dinheiroAbreviado(95_000)).toBe(`R$${nbsp}950`);
    expect(dinheiroAbreviado(null)).toBe('—');
  });
});

describe('números e percentuais', () => {
  it('numero com separador de milhar e casas opcionais', () => {
    expect(numero(1234)).toBe('1.234');
    expect(numero(12.345, 1)).toBe('12,3');
    expect(numero(null)).toBe('—');
  });
  it('numeroAbreviado', () => {
    expect(numeroAbreviado(950)).toBe('950');
    expect(numeroAbreviado(82_400)).toBe('82,4 mil');
    expect(numeroAbreviado(1_000)).toBe('1 mil');
    expect(numeroAbreviado(1_200_000)).toBe('1,2 mi');
    expect(numeroAbreviado(250_000)).toBe('250 mil');
    expect(numeroAbreviado(-3_500)).toBe('-3,5 mil');
  });
  it('percentual de fração e variação com sinal', () => {
    expect(percentual(0.124)).toBe('12,4%');
    expect(percentual(1)).toBe('100,0%');
    expect(percentual(0.12345, 2)).toBe('12,35%');
    expect(variacao(0.124)).toBe('+12,4%');
    expect(variacao(-0.032)).toBe('-3,2%');
    expect(variacao(0)).toBe('0,0%');
    expect(variacao(null)).toBe('—');
  });
  it('diferenca devolve null sem base', () => {
    expect(diferenca(120, 100)).toBeCloseTo(0.2);
    expect(diferenca(80, 100)).toBeCloseTo(-0.2);
    expect(diferenca(10, 0)).toBeNull();
    expect(diferenca(null, 10)).toBeNull();
  });
});

describe('datas em America/Sao_Paulo', () => {
  it('data e hora', () => {
    expect(data('2026-10-30T02:30:00Z')).toBe('29/10/2026');
    expect(dataHora('2026-10-30T02:30:00Z')).toBe('29/10/2026 23:30');
    expect(data('2026-10-30')).toBe('30/10/2026');
    expect(diaMes('2026-10-05')).toBe('05/10');
    expect(mesAno('2026-10-05')).toBe('out/2026');
    expect(data(null)).toBe('—');
    expect(data('não é data')).toBe('—');
  });
  it('atualizado há', () => {
    const agora = new Date('2026-10-30T15:00:00-03:00');
    expect(atualizadoHa('2026-10-30T14:58:00-03:00', agora)).toBe('atualizado há 2 min');
    expect(atualizadoHa('2026-10-30T14:59:50-03:00', agora)).toBe('atualizado agora');
    expect(atualizadoHa('2026-10-30T11:00:00-03:00', agora)).toBe('atualizado há 4 h');
    expect(atualizadoHa('2026-10-27T15:00:00-03:00', agora)).toBe('atualizado há 3 dias');
    expect(atualizadoHa('2026-10-29T14:00:00-03:00', agora)).toBe('atualizado há 1 dia');
    expect(atualizadoHa(null, agora)).toBe('sem atualização');
  });
  it('plural', () => {
    expect(plural(1, 'lead', 'leads')).toBe('1 lead');
    expect(plural(1200, 'lead', 'leads')).toBe('1.200 leads');
  });
});

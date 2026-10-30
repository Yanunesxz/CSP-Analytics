import { describe, expect, it } from 'vitest';
import { textoDaQuantidade } from './textos';

describe('textoDaQuantidade', () => {
  it('null é "Sem dados", nunca 0', () => {
    expect(textoDaQuantidade(null)).toBe('Sem dados');
  });

  it('0 é "Ninguém ainda"; 1 e mais no singular e no plural', () => {
    expect(textoDaQuantidade(0)).toBe('Ninguém ainda');
    expect(textoDaQuantidade(1)).toBe('1 pessoa');
    expect(textoDaQuantidade(2)).toBe('2 pessoas');
    expect(textoDaQuantidade(1234)).toBe('1.234 pessoas');
  });
});

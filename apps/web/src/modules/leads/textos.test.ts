import { describe, expect, it } from 'vitest';
import { corDaMarcaDoLead, detalheDeConversao, notaDeConversao, resumoDaLista } from './textos';

describe('textos da tela de Leads', () => {
  it('cor da marca vem do token de série; sem marca fica no cinza do SDR', () => {
    expect(corDaMarcaDoLead('cs')).toMatch(/^var\(--color-series-\d\)$/);
    expect(corDaMarcaDoLead('plumene')).toMatch(/^var\(--color-series-\d\)$/);
    expect(corDaMarcaDoLead(null)).toBe('var(--color-text-muted)');
  });

  it('detalhe de conversão no singular e no plural, sem inventar número', () => {
    expect(detalheDeConversao({ viraramCliente: 3, taxaConversao: 0.25 })).toBe('3 viraram cliente · 25,0%');
    expect(detalheDeConversao({ viraramCliente: 1, taxaConversao: 1 })).toBe('1 virou cliente · 100,0%');
    expect(detalheDeConversao({ viraramCliente: 0, taxaConversao: null })).toBe('0 viraram cliente');
    expect(detalheDeConversao({ viraramCliente: null, taxaConversao: null })).toBe('—');
  });

  it('nota da conversão concorda com o número e some sem lead no período', () => {
    expect(notaDeConversao(2, 7)).toBe('2 de 7 leads viraram cliente');
    expect(notaDeConversao(1, 7)).toBe('1 de 7 leads virou cliente');
    expect(notaDeConversao(0, 1)).toBe('0 de 1 lead viraram cliente');
    expect(notaDeConversao(0, 0)).toBeUndefined();
    expect(notaDeConversao(null, null)).toBeUndefined();
  });

  it('resumo da lista diz quando cortou e some sem leads', () => {
    expect(resumoDaLista(200, 340)).toBe(
      'Mostrando os 200 mais recentes de 340 leads. Use os filtros para achar um lead.',
    );
    expect(resumoDaLista(52, 52)).toBe('52 leads, os mais recentes primeiro.');
    expect(resumoDaLista(1, 1)).toBe('1 lead.');
    expect(resumoDaLista(200, 1234)).toBe(
      'Mostrando os 200 mais recentes de 1.234 leads. Use os filtros para achar um lead.',
    );
    expect(resumoDaLista(0, 0)).toBeNull();
    expect(resumoDaLista(0, null)).toBeNull();
  });
});

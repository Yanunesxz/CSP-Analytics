import { describe, expect, it } from 'vitest';
import { marcaPadrao, MARCAS_DO_PADRAO, rotuloDoModo } from './textos';

describe('rotuloDoModo', () => {
  it('fala como a faixa do topo', () => {
    expect(rotuloDoModo('demonstracao', true)).toBe('Demonstração · dados de exemplo');
    expect(rotuloDoModo('demonstracao', false)).toBe('Demonstração · sem dados de exemplo');
    expect(rotuloDoModo('supabase', false)).toBe('Dados reais');
    expect(rotuloDoModo('supabase', true)).toBe('Dados reais');
  });
});

describe('marcaPadrao', () => {
  it('vale a marca guardada no navegador', () => {
    expect(marcaPadrao('plumene', 'todas')).toBe('plumene');
    expect(marcaPadrao('todas', 'cs')).toBe('todas');
  });

  it('sem nada guardado, vale a marca de agora', () => {
    expect(marcaPadrao(null, 'cs')).toBe('cs');
    expect(marcaPadrao(undefined, 'todas')).toBe('todas');
  });

  it('as três opções, na ordem do menu', () => {
    expect(MARCAS_DO_PADRAO).toEqual(['cs', 'plumene', 'todas']);
  });
});

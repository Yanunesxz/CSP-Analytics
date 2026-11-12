import { describe, expect, it } from 'vitest';
import { LISTAS, cor, opcoes, rotulo, rotuloMarca, tom } from './labels';

describe('labels', () => {
  it('toda lista tem rótulo em português e cor de token para cada código', () => {
    for (const [lista, tabela] of Object.entries(LISTAS)) {
      for (const [codigo, entrada] of Object.entries(tabela)) {
        expect(entrada.rotulo, `${lista}.${codigo}`).not.toBe('');
        expect(entrada.rotulo, `${lista}.${codigo}`).not.toBe(codigo);
        expect(entrada.cor, `${lista}.${codigo}`).toMatch(/^var\(--color-[a-z0-9-]+\)$/);
      }
    }
  });

  it('marca, canal e operador usam só --color-series-N', () => {
    // "Outro assistente" fica neutro, como as origens sem série própria do leadSource (decisão 0007).
    for (const lista of ['brand', 'platform', 'operator', 'geoSource'] as const) {
      for (const o of opcoes(lista).filter((o) => !(lista === 'geoSource' && o.codigo === 'other'))) {
        expect(o.cor).toMatch(/^var\(--color-series-[1-6]\)$/);
        expect(o.tom).toBeUndefined();
      }
    }
    expect(cor('geoSource', 'other')).toBe('var(--color-text-muted)');
    expect(tom('geoSource', 'other')).toBeUndefined();
  });

  it('status nunca usa cor de série', () => {
    for (const lista of ['campaignStatus', 'actionStatus', 'connectorStatus', 'leadStage'] as const) {
      for (const o of opcoes(lista)) {
        expect(o.cor).not.toContain('series');
        expect(o.tom).toBeDefined();
      }
    }
  });

  it('rotulo, cor e tom', () => {
    expect(rotulo('brand', 'cs')).toBe('Corpo Sensual');
    expect(rotulo('operator', 'claude')).toBe('Claude');
    expect(cor('platform', 'meta')).toBe('var(--color-series-4)');
    expect(tom('connectorStatus', 'late')).toBe('warning');
    expect(tom('connectorStatus', 'not_connected')).toBe('muted');
    expect(rotulo('connectorStatus', 'not_connected')).toBe('A ligar');
    expect(tom('brand', 'cs')).toBeUndefined();
  });

  it('as listas que mudaram com o banco (listas.md): pedido sem "faturado", ação com "falhou", conector "a ligar"', () => {
    expect(opcoes('orderStatus').map((o) => o.codigo)).toEqual(['quote', 'sent', 'cancelled']);
    expect(opcoes('geoSource').map((o) => o.codigo)).toContain('other');
    expect(opcoes('connectorStatus').map((o) => o.codigo)).toEqual([
      'ok',
      'late',
      'down',
      'not_connected',
      'disabled',
    ]);
    expect(tom('actionStatus', 'failed')).toBe('danger');
  });

  it('a ordem que a conta usa: a ação que pede decisão primeiro; a melhor situação primeiro e lead por último', () => {
    expect(opcoes('actionStatus').map((o) => o.codigo)).toEqual([
      'idea',
      'failed',
      'approved',
      'running',
      'done',
      'discarded',
    ]);
    expect(opcoes('customerSituation').map((o) => o.codigo)).toEqual([
      'active',
      'inactive_recent',
      'inactive_old',
      'lost',
      'lead',
    ]);
  });

  it('código desconhecido volta como veio, com cor neutra', () => {
    expect(rotulo('leadSource', 'whatever')).toBe('whatever');
    expect(cor('leadSource', 'whatever')).toBe('var(--color-text-muted)');
    expect(tom('leadSource', 'whatever')).toBeUndefined();
  });

  it('opcoes mantém a ordem declarada', () => {
    expect(opcoes('leadStage').map((o) => o.codigo)).toEqual([
      'lead',
      'prospect',
      'registered',
      'first_order',
      'invoiced',
    ]);
  });

  it('rotuloMarca trata "todas" e vazio como "As duas"', () => {
    expect(rotuloMarca('todas')).toBe('As duas');
    expect(rotuloMarca(null)).toBe('As duas');
    expect(rotuloMarca('plumene')).toBe('Plumene');
  });
});

import { describe, expect, it } from 'vitest';
import type { FonteDoPainel } from '../../data/queries/seo-geo';
import {
  frescorDaFonte,
  parcelaDe,
  resumoDasConsultas,
  textoDaConferencia,
  textoDaUltimaSincronizacao,
} from './textos';

const agora = new Date('2026-10-30T15:00:00-03:00');
const fonte = (p: Partial<FonteDoPainel>): FonteDoPainel => ({
  id: 'search_console',
  status: 'ok',
  lastSyncAt: '2026-10-30T09:00:00-03:00',
  atrasado: false,
  ...p,
});

describe('textos da tela SEO e GEO', () => {
  it('frescorDaFonte diz há quanto tempo sincronizou e cala no a ligar, no desligado ou sem cartão', () => {
    expect(frescorDaFonte(fonte({}), agora)).toBe('atualizado há 6 h');
    expect(frescorDaFonte(fonte({ status: 'late', lastSyncAt: '2026-10-28T15:00:00-03:00' }), agora)).toBe(
      'atualizado há 2 dias',
    );
    expect(frescorDaFonte(fonte({ status: 'not_connected', lastSyncAt: null }), agora)).toBeNull();
    expect(frescorDaFonte(fonte({ status: 'disabled' }), agora)).toBeNull();
    expect(frescorDaFonte(null, agora)).toBeNull();
  });

  it('textoDaUltimaSincronizacao mostra a data ou diz que nunca sincronizou', () => {
    expect(textoDaUltimaSincronizacao('2026-10-30T09:00:00-03:00')).toBe(
      'A última sincronização foi em 30/10/2026 09:00.',
    );
    expect(textoDaUltimaSincronizacao(null)).toBe('O conector ainda não sincronizou.');
  });

  it('resumoDasConsultas junta a quantidade e a parte dos cliques', () => {
    expect(resumoDasConsultas(10, 0.6416)).toBe('10 consultas · 64% dos cliques do período');
    expect(resumoDasConsultas(1, null)).toBe('1 consulta');
    expect(resumoDasConsultas(0, 0.5)).toBeNull();
  });

  it('parcelaDe formata a parte e some sem base', () => {
    expect(parcelaDe(0.124, 'das sessões')).toBe('12,4% das sessões');
    expect(parcelaDe(null, 'das sessões')).toBeUndefined();
    expect(parcelaDe(Number.NaN, 'das sessões')).toBeUndefined();
  });

  it('textoDaConferencia diz quando conferiu e quantos itens pedem atenção', () => {
    expect(textoDaConferencia({ conferidoEm: '2026-10-30T06:00:00-03:00', emAtencao: 2 })).toBe(
      'Conferido em 30/10/2026 06:00 · 2 itens pedem atenção',
    );
    expect(textoDaConferencia({ conferidoEm: '2026-10-30T06:00:00-03:00', emAtencao: 1 })).toBe(
      'Conferido em 30/10/2026 06:00 · 1 item pede atenção',
    );
    expect(textoDaConferencia({ conferidoEm: null, emAtencao: 0 })).toBe(
      'Ainda não conferido · Tudo em ordem',
    );
  });
});

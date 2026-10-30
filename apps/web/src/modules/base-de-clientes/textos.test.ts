import { describe, expect, it } from 'vitest';
import { dinheiro, numero } from '../../lib/format';
import { escreverRecorte, lerRecorte } from './recorte';
import {
  detalheParticipacao,
  notaDaBase,
  notaDoAnterior,
  notaInativos,
  notaSemSituacao,
  rotuloDasMarcas,
  rotuloRepresentante,
  tempoDesde,
  textoDoPeriodo,
  textoListaCortada,
} from './textos';

describe('textos da Base de clientes', () => {
  it('nota de "Clientes na base"', () => {
    expect(notaDaBase(null, null)).toBeUndefined();
    expect(notaDaBase(305, 24)).toBe('24 sem situação no CSP 360');
    expect(notaDaBase(1234, 0)).toBe('Com pedido em alguma marca');
  });

  it('nota de situação: só quando há clientes e o CSP 360 não manda a situação', () => {
    expect(notaSemSituacao(false, 10)).toBe('O CSP 360 ainda não envia a situação');
    expect(notaSemSituacao(true, 10)).toBeUndefined();
    expect(notaSemSituacao(false, null)).toBeUndefined();
  });

  it('inativos recentes e antigos', () => {
    expect(notaInativos(24, 28)).toBe('24 recentes · 28 antigos');
    expect(notaInativos(1, 1)).toBe('1 recente · 1 antigo');
    expect(notaInativos(null, 3)).toBeUndefined();
  });

  it('número do período anterior quando não há variação (anterior 0)', () => {
    expect(notaDoAnterior({ atual: 19, anterior: 0, variacao: null }, numero)).toBe('0 no período anterior');
    expect(notaDoAnterior({ atual: 50000, anterior: 0, variacao: null }, dinheiro)).toMatch(
      /^R\$\s0 no período anterior$/,
    );
    expect(notaDoAnterior({ atual: 3, anterior: 2, variacao: 0.5 }, numero)).toBeUndefined();
    expect(notaDoAnterior({ atual: null, anterior: 0, variacao: null }, numero)).toBeUndefined();
    expect(notaDoAnterior({ atual: 3, anterior: null, variacao: null }, numero)).toBeUndefined();
  });

  it('período, tempo sem comprar e marcas', () => {
    expect(textoDoPeriodo('2026-10-01', '2026-10-30')).toBe('01/10/2026 a 30/10/2026');
    expect(tempoDesde(0)).toBe('hoje');
    expect(tempoDesde(1)).toBe('há 1 dia');
    expect(tempoDesde(1140)).toBe('há 1.140 dias');
    expect(tempoDesde(null)).toBeNull();
    expect(rotuloDasMarcas(['cs'])).toBe('Corpo Sensual');
    expect(rotuloDasMarcas(['plumene'])).toBe('Plumene');
    expect(rotuloDasMarcas(['cs', 'plumene'])).toBe('As duas');
    expect(rotuloDasMarcas([])).toBe('Sem marca');
    expect(rotuloRepresentante('REP-01')).toBe('REP-01');
    expect(rotuloRepresentante(null)).toBe('Sem representante');
  });

  it('participação e lista cortada', () => {
    expect(detalheParticipacao(0.68)).toBe('68,0% da receita');
    expect(detalheParticipacao(null)).toBeUndefined();
    expect(textoListaCortada(200, 1305)).toBe(
      'Mostrando 200 de 1.305 clientes, os que estão há mais tempo sem comprar. Escolha um filtro rápido ou um representante para ver os outros.',
    );
  });
});

describe('filtro rápido na URL', () => {
  it('lê só recortes válidos', () => {
    expect(lerRecorte('inativos')).toBe('inativos');
    expect(lerRecorte('sem-situacao')).toBe('sem-situacao');
    expect(lerRecorte('todos')).toBeNull();
    expect(lerRecorte('<script>')).toBeNull();
    expect(lerRecorte(null)).toBeNull();
  });

  it('grava sem mexer nos outros filtros e limpa com null', () => {
    const params = new URLSearchParams('marca=cs&periodo=7d');
    const com = escreverRecorte(params, 'reativados');
    expect(com.toString()).toBe('marca=cs&periodo=7d&recorte=reativados');
    expect(params.toString()).toBe('marca=cs&periodo=7d');
    expect(escreverRecorte(com, null).toString()).toBe('marca=cs&periodo=7d');
  });
});

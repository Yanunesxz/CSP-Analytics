import { describe, expect, it } from 'vitest';
import { FILTROS_PADRAO, apenasGlobais, escreverFiltros, lerFiltros } from './url-state';

describe('lerFiltros', () => {
  it('sem nada na URL vale o padrão', () => {
    expect(lerFiltros(new URLSearchParams())).toEqual(FILTROS_PADRAO);
  });

  it('a URL vence a memória; sem URL vale a memória; sem memória vale o padrão', () => {
    const memoria = { marca: 'cs' as const, visao: 'gestor' as const };
    expect(lerFiltros(new URLSearchParams('marca=plumene'), memoria).marca).toBe('plumene');
    expect(lerFiltros(new URLSearchParams(), memoria)).toMatchObject({ marca: 'cs', visao: 'gestor' });
    expect(lerFiltros(new URLSearchParams(), {})).toMatchObject({ marca: 'todas', visao: 'visualizador' });
  });

  it('valor inválido cai para o padrão', () => {
    const f = lerFiltros(
      new URLSearchParams('marca=outra&periodo=ontem&canal=radio&estado=quebrado&operador=robo'),
    );
    expect(f).toMatchObject({
      marca: 'todas',
      periodo: 'este-mes',
      canal: null,
      estado: null,
      operador: 'todos',
    });
  });

  it('lê todos os filtros', () => {
    const f = lerFiltros(
      new URLSearchParams(
        'marca=cs&visao=gestor&periodo=7d&comparar=false&canal=meta&campanha=cmp-1&operador=claude&origem=organic&representante=REP-02&estado=sem-dados',
      ),
    );
    expect(f).toEqual({
      marca: 'cs',
      visao: 'gestor',
      periodo: '7d',
      comparar: false,
      canal: 'meta',
      campanha: 'cmp-1',
      operador: 'claude',
      origem: 'organic',
      representante: 'REP-02',
      estado: 'sem-dados',
    });
  });
});

describe('escreverFiltros', () => {
  it('grava valores e tira o que é padrão ou nulo', () => {
    const p = escreverFiltros(new URLSearchParams('canal=meta&origem=site'), {
      canal: null,
      periodo: 'este-mes',
      operador: 'claude',
    });
    expect(p.get('canal')).toBeNull();
    expect(p.get('periodo')).toBeNull();
    expect(p.get('operador')).toBe('claude');
    expect(p.get('origem')).toBe('site');
  });

  it('marca e visão ficam sempre explícitas, mesmo no valor padrão', () => {
    const p = escreverFiltros(new URLSearchParams(), { marca: 'todas', visao: 'visualizador' });
    expect(p.get('marca')).toBe('todas');
    expect(p.get('visao')).toBe('visualizador');
  });

  it('comparar só aparece quando é false', () => {
    expect(escreverFiltros(new URLSearchParams(), { comparar: false }).get('comparar')).toBe('false');
    expect(
      escreverFiltros(new URLSearchParams('comparar=false'), { comparar: true }).get('comparar'),
    ).toBeNull();
  });

  it('não altera os parâmetros originais', () => {
    const original = new URLSearchParams('canal=meta');
    escreverFiltros(original, { canal: null });
    expect(original.get('canal')).toBe('meta');
  });
});

describe('apenasGlobais', () => {
  it('mantém só marca, visão, período, comparar e estado', () => {
    const p = apenasGlobais(
      new URLSearchParams('marca=cs&canal=meta&periodo=7d&estado=vazio&campanha=x&comparar=false'),
    );
    expect([...p.keys()].sort()).toEqual(['comparar', 'estado', 'marca', 'periodo']);
  });
});

import { describe, expect, it } from 'vitest';
import { lerFiltros } from '../../lib/url-state';
import { aplicarConjunto, conjuntoDe, escreverParametros, lerParametros, quantosFiltros } from './url';

const p = (texto: string) => new URLSearchParams(texto);

describe('chaves da tela na URL', () => {
  it('lê com padrão para o que falta ou não vale', () => {
    expect(lerParametros(p(''))).toEqual({
      aba: 'fila',
      lista: { status: null, impacto: null, esforco: null },
      proposta: null,
      diario: 20,
    });
    expect(
      lerParametros(p('aba=diario&status=done&impacto=high&esforco=low&proposta=act-003&diario=60')),
    ).toEqual({
      aba: 'diario',
      lista: { status: 'done', impacto: 'high', esforco: 'low' },
      proposta: 'act-003',
      diario: 60,
    });
    expect(lerParametros(p('aba=xis&status=talvez&impacto=enorme&diario=-5')).aba).toBe('fila');
    expect(lerParametros(p('status=talvez&impacto=enorme')).lista).toEqual({
      status: null,
      impacto: null,
      esforco: null,
    });
    expect(lerParametros(p('diario=99999')).diario).toBe(1000);
  });

  it('escreve sem mexer nas outras chaves; padrão e null saem da URL', () => {
    const antes = p('marca=cs&visao=gestor&canal=meta&aba=limites');
    const depois = escreverParametros(antes, { aba: 'fila', status: 'idea', diario: 20, proposta: null });
    expect(depois.toString()).toBe('marca=cs&visao=gestor&canal=meta&status=idea');
    expect(antes.toString()).toBe('marca=cs&visao=gestor&canal=meta&aba=limites');
    expect(escreverParametros(p(''), { diario: 40 }).toString()).toBe('diario=40');
  });
});

describe('Meus filtros da lista', () => {
  it('guarda barra e lista juntas e aplica numa gravação só', () => {
    const atual = p('marca=cs&visao=gestor&periodo=7d&canal=meta&operador=claude&status=idea&impacto=high');
    const filtros = lerFiltros(atual);
    const conjunto = conjuntoDe('Ideias do Claude no Meta', filtros, lerParametros(atual).lista);
    expect(conjunto.filtros).toEqual({
      canal: 'meta',
      campanha: null,
      operador: 'claude',
      status: 'idea',
      impacto: 'high',
      esforco: null,
    });
    expect(quantosFiltros(conjunto)).toBe(4);

    // Em outra tela de filtros, aplicar troca barra e lista e volta para a aba da fila
    const outra = p('marca=cs&visao=gestor&periodo=7d&canal=google&esforco=low&aba=diario&campanha=x');
    const aplicada = aplicarConjunto(outra, conjunto);
    expect(lerFiltros(aplicada)).toMatchObject({
      marca: 'cs',
      periodo: '7d',
      canal: 'meta',
      campanha: null,
      operador: 'claude',
    });
    expect(lerParametros(aplicada)).toMatchObject({
      aba: 'fila',
      lista: { status: 'idea', impacto: 'high', esforco: null },
    });
  });

  it('conjunto vazio limpa barra e lista', () => {
    const limpo = aplicarConjunto(p('canal=meta&operador=human&status=done&esforco=low&marca=plumene'), {
      nome: '',
      filtros: { canal: null, campanha: null, operador: 'todos', status: null, impacto: null, esforco: null },
    });
    expect(limpo.toString()).toBe('marca=plumene');
  });
});

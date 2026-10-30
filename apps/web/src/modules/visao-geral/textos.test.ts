import { describe, expect, it } from 'vitest';
import type { ContaDeAnuncio } from '../../data/queries/visao-geral';
import {
  detalheDoCusto,
  gastoDaConta,
  limiteDaConta,
  notaDoFaturado,
  notasDosNumeros,
  periodoAnterior,
  seloDoLimite,
  temFiltroDeMidia,
  variacaoNeutra,
  verbaDaConta,
} from './textos';

const NBSP = String.fromCharCode(160);
const semFiltro = { marca: 'todas', canal: null, operador: 'todos', campanha: null } as const;

describe('periodoAnterior', () => {
  it('tira o "vs." e começa com maiúscula', () => {
    expect(periodoAnterior({ rotuloAnterior: 'vs. mês anterior' })).toBe('Mês anterior');
    expect(periodoAnterior({ rotuloAnterior: 'vs. 7 dias anteriores' })).toBe('7 dias anteriores');
  });
});

describe('notasDosNumeros', () => {
  it('explica o divisor do custo e diz que clientes novos conta todas as origens', () => {
    expect(notasDosNumeros({ clientesNovosDeCampanha: 15, leadsSemMarca: 0 }, semFiltro)).toEqual([
      'Custo por cliente novo divide o investimento pelos 15 clientes novos que vieram de campanha (pela UTM).',
      'Clientes novos conta todas as origens.',
    ]);
  });

  it('concorda o singular e avisa quando nenhum cliente novo veio de campanha', () => {
    expect(notasDosNumeros({ clientesNovosDeCampanha: 1, leadsSemMarca: null }, semFiltro)[0]).toBe(
      'Custo por cliente novo divide o investimento pelo 1 cliente novo que veio de campanha (pela UTM).',
    );
    expect(notasDosNumeros({ clientesNovosDeCampanha: 0, leadsSemMarca: null }, semFiltro)[0]).toContain(
      'fica sem dados',
    );
    expect(notasDosNumeros({ clientesNovosDeCampanha: null, leadsSemMarca: null }, semFiltro)[0]).toBe(
      'Custo por cliente novo divide o investimento pelos clientes novos que vieram de campanha (pela UTM).',
    );
  });

  it('sinaliza os leads sem marca, nas duas marcas ou na marca escolhida', () => {
    expect(notasDosNumeros({ clientesNovosDeCampanha: 3, leadsSemMarca: 13 }, semFiltro)).toContain(
      '13 leads sem marca (SDR · WhatsApp) entram no total.',
    );
    expect(
      notasDosNumeros({ clientesNovosDeCampanha: 3, leadsSemMarca: 1 }, { ...semFiltro, marca: 'cs' }),
    ).toContain('1 lead sem marca (SDR · WhatsApp) aparece aqui e na outra marca.');
  });

  it('com filtro de canal ou operador, avisa o que não segue o filtro e não fala em todas as origens', () => {
    const notas = notasDosNumeros(
      { clientesNovosDeCampanha: 3, leadsSemMarca: 0 },
      { ...semFiltro, marca: 'plumene', operador: 'claude' },
    );
    expect(notas).not.toContain('Clientes novos conta todas as origens.');
    expect(notas[notas.length - 1]).toBe(
      'Pedidos, valor faturado e alcance no Instagram não separam canal, operador nem campanha: valem para a marca toda.',
    );
  });
});

describe('temFiltroDeMidia', () => {
  it('liga com canal, operador ou campanha', () => {
    expect(temFiltroDeMidia({ canal: null, operador: 'todos', campanha: null })).toBe(false);
    expect(temFiltroDeMidia({ canal: 'meta', operador: 'todos', campanha: null })).toBe(true);
    expect(temFiltroDeMidia({ canal: null, operador: 'human', campanha: null })).toBe(true);
    expect(temFiltroDeMidia({ canal: null, operador: 'todos', campanha: 'cs-a' })).toBe(true);
  });
});

describe('notas dos indicadores', () => {
  it('valor faturado sem dados explica de onde o valor vem', () => {
    expect(notaDoFaturado(30)).toBe('30 pedidos faturados. O valor chega com o Control.');
    expect(notaDoFaturado(1)).toBe('1 pedido faturado. O valor chega com o Control.');
    expect(notaDoFaturado(null)).toBe('O valor chega quando o Control abrir o faturamento.');
  });

  it('variação neutra só com base', () => {
    expect(variacaoNeutra({ atual: 100, anterior: 80, variacao: 0.25 }, 'vs. mês anterior')).toBe(
      '+25,0% vs. mês anterior',
    );
    expect(
      variacaoNeutra({ atual: 100, anterior: null, variacao: null }, 'vs. mês anterior'),
    ).toBeUndefined();
    expect(variacaoNeutra({ atual: null, anterior: 80, variacao: null }, 'vs. mês anterior')).toBeUndefined();
  });
});

describe('detalheDoCusto', () => {
  const intervalo = { rotuloAnterior: 'vs. mês anterior' };
  it('mostra o período anterior com a variação, ou "sem dados"', () => {
    expect(detalheDoCusto({ atual: 44820, anterior: 35856, variacao: 0.25 }, intervalo, true)).toBe(
      `Mês anterior: R$${NBSP}358,56 (+25,0%)`,
    );
    expect(detalheDoCusto({ atual: null, anterior: 35800, variacao: null }, intervalo, true)).toBe(
      `Mês anterior: R$${NBSP}358`,
    );
    expect(detalheDoCusto({ atual: 100, anterior: null, variacao: null }, intervalo, true)).toBe(
      'Mês anterior: sem dados',
    );
    expect(detalheDoCusto({ atual: 100, anterior: null, variacao: null }, intervalo, false)).toBeUndefined();
  });
});

describe('verba e limite por conta', () => {
  const conta = (p: Partial<ContaDeAnuncio>): ContaDeAnuncio => ({
    marca: 'cs',
    canal: 'meta',
    investimento: 1703966,
    limite: 3037500,
    uso: 0.56,
    verbaDiaria: 67500,
    campanhasAtivas: 3,
    alerta: null,
    ...p,
  });

  it('selo de perto e de acima do limite', () => {
    expect(seloDoLimite(null)).toBeNull();
    expect(seloDoLimite('perto')).toEqual({ tom: 'warning', texto: 'Perto do limite' });
    expect(seloDoLimite('acima')).toEqual({ tom: 'danger', texto: 'Acima do limite' });
  });

  it('gasto, limite e verba em texto', () => {
    expect(gastoDaConta(conta({}))).toBe(`R$${NBSP}17.039,66`);
    expect(limiteDaConta(conta({}))).toBe(`de R$${NBSP}30.375`);
    expect(verbaDaConta(conta({}))).toBe(`Verba diária R$${NBSP}675 · 3 campanhas ativas`);
  });

  it('sem campanha ativa e sem dados', () => {
    expect(limiteDaConta(conta({ limite: 0, uso: null, campanhasAtivas: 0 }))).toBe('Sem campanha ativa');
    expect(verbaDaConta(conta({ verbaDiaria: 0, campanhasAtivas: 1 }))).toBe(
      `Verba diária R$${NBSP}0 · 1 campanha ativa`,
    );
    const vazia = conta({
      investimento: null,
      limite: null,
      uso: null,
      verbaDiaria: null,
      campanhasAtivas: null,
    });
    expect(gastoDaConta(vazia)).toBe('—');
    expect(limiteDaConta(vazia)).toBe('—');
    expect(verbaDaConta(vazia)).toBeNull();
  });
});

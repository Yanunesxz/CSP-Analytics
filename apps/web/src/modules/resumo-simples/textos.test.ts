import { describe, expect, it } from 'vitest';
import type { NumerosDoResumo } from '../../data/queries/resumo-simples';
import {
  CAMPANHAS_NO_TOPO,
  LIMITE_DE_CAMPANHAS,
  PALAVRAS,
  campanhasAVista,
  custoDaLinha,
  detalheDoGasto,
  diferencaEmPalavras,
  fraseDeTodosOsCaminhos,
  frasesDoResumo,
  linkDoResumo,
  marcaDoResumo,
  notaDasCampanhas,
  numerosDoResumo,
  ondeDaCampanha,
  partes,
  periodoDeComparacao,
  periodoDoResumo,
  porReal,
  reais,
  verOutrasCampanhas,
} from './textos';

const NBSP = String.fromCharCode(160);
/** "R$ 1.234" como o Intl escreve, com o espaço que não quebra. */
const rs = (texto: string) => `R$${NBSP}${texto}`;

const numeros = (p: Partial<NumerosDoResumo> = {}): NumerosDoResumo => ({
  investimento: 1845031,
  interessados: 312,
  clientesNovos: 41,
  custoPorClienteNovo: 45001,
  valorDosPrimeirosPedidos: 5904099,
  retornoPorReal: 3.2,
  ...p,
});

const semBase: NumerosDoResumo = {
  investimento: null,
  interessados: null,
  clientesNovos: null,
  custoPorClienteNovo: null,
  valorDosPrimeirosPedidos: null,
  retornoPorReal: null,
};

describe('formatos', () => {
  it('reais arredonda para o real inteiro e nunca mostra centavo', () => {
    expect(reais(2703831)).toBe(rs('27.038'));
    expect(reais(2703850)).toBe(rs('27.039'));
    expect(reais(0)).toBe(rs('0'));
    expect(reais(null)).toBe('—');
  });

  it('porReal mostra quanto voltou para cada R$ 1, com centavos quando tem', () => {
    expect(porReal(3.2)).toBe(rs('3,20'));
    expect(porReal(2)).toBe(rs('2'));
    expect(porReal(0.524)).toBe(rs('0,52'));
    expect(porReal(0)).toBe(rs('0'));
    expect(porReal(null)).toBe('—');
  });

  it('período e marca por extenso', () => {
    expect(periodoDoResumo({ rotulo: 'Este mês', inicio: '2026-11-01', fim: '2026-11-12' })).toBe(
      'Este mês · 01/11/2026 a 12/11/2026',
    );
    expect(periodoDoResumo({ rotulo: 'Este mês', inicio: '2026-11-01', fim: '2026-11-01' })).toBe(
      'Este mês · 01/11/2026',
    );
    expect(periodoDeComparacao({ rotuloAnterior: 'vs. 1º a 12 de outubro' })).toBe('1º a 12 de outubro');
    expect(periodoDeComparacao({ rotuloAnterior: 'vs. mês anterior' })).toBe('mês anterior');
    expect(marcaDoResumo('todas')).toBe('As duas marcas');
    expect(marcaDoResumo('plumene')).toBe('Plumene');
  });
});

describe('frasesDoResumo', () => {
  it('conta a história na ordem do dinheiro: gastou, trouxe, custou, voltou', () => {
    expect(frasesDoResumo({ total: numeros() }, { marca: 'todas' })).toEqual([
      `Você gastou **${rs('18.450')}** em anúncios nas duas marcas.`,
      'Esses anúncios trouxeram **312 pessoas interessadas** e **41 clientes novos**.',
      `Cada cliente novo custou, em média, **${rs('450')}**.`,
      `Para cada R$ 1 gasto, voltaram **${rs('3,20')}** no primeiro pedido desses clientes (${rs('59.041')} no total).`,
    ]);
  });

  it('diz a marca escolhida e concorda o singular', () => {
    const frases = frasesDoResumo({ total: numeros({ interessados: 1, clientesNovos: 1 }) }, { marca: 'cs' });
    expect(frases[0]).toContain('em anúncios na marca Corpo Sensual.');
    expect(frases[1]).toBe('Esses anúncios trouxeram **1 pessoa interessada** e **1 cliente novo**.');
  });

  it('gastou e ainda não trouxe cliente: diz isso e não inventa custo nem retorno', () => {
    const frases = frasesDoResumo(
      {
        total: numeros({
          clientesNovos: 0,
          custoPorClienteNovo: null,
          valorDosPrimeirosPedidos: 0,
          retornoPorReal: 0,
        }),
      },
      { marca: 'todas' },
    );
    expect(frases).toHaveLength(2);
    expect(frases[1]).toBe(
      'Esses anúncios trouxeram **312 pessoas interessadas**, e ainda nenhum cliente novo (ninguém fez o primeiro pedido).',
    );
  });

  it('cliente novo de quem chegou antes do período, e período sem nada', () => {
    expect(frasesDoResumo({ total: numeros({ interessados: 0 }) }, { marca: 'todas' })[1]).toBe(
      'Esses anúncios trouxeram **41 clientes novos**, de pessoas que chegaram antes deste período.',
    );
    expect(
      frasesDoResumo(
        {
          total: numeros({ interessados: 0, clientesNovos: 0, custoPorClienteNovo: null, retornoPorReal: 0 }),
        },
        { marca: 'todas' },
      )[1],
    ).toBe('Esses anúncios ainda não trouxeram nenhuma pessoa interessada nem cliente novo.');
  });

  it('sem gasto e sem base têm frase própria, nunca R$ 0 inventado', () => {
    expect(frasesDoResumo({ total: numeros({ investimento: 0 }) }, { marca: 'plumene' })).toEqual([
      'Você não gastou com anúncios na marca Plumene neste período.',
    ]);
    expect(frasesDoResumo({ total: semBase }, { marca: 'todas' })).toEqual([
      'Os números de anúncio deste período ainda não chegaram.',
    ]);
    expect(frasesDoResumo({ total: { ...semBase, investimento: 100000 } }, { marca: 'todas' })[1]).toContain(
      'Ainda não dá para dizer o que esse gasto trouxe',
    );
  });

  it('sem o valor dos pedidos, a frase do retorno não aparece', () => {
    const frases = frasesDoResumo(
      { total: numeros({ valorDosPrimeirosPedidos: null, retornoPorReal: null }) },
      { marca: 'todas' },
    );
    expect(frases).toHaveLength(3);
    expect(frases.join(' ')).not.toContain('voltaram');
  });
});

describe('fraseDeTodosOsCaminhos', () => {
  it('conta também quem não veio de anúncio', () => {
    expect(fraseDeTodosOsCaminhos({ todasAsOrigens: { interessados: 70, clientesNovos: 11 } })).toBe(
      'Contando todos os caminhos (anúncio, indicação, busca, WhatsApp e os outros), chegaram 70 pessoas interessadas e 11 clientes novos no período.',
    );
    expect(
      fraseDeTodosOsCaminhos({ todasAsOrigens: { interessados: null, clientesNovos: null } }),
    ).toBeNull();
  });
});

describe('partes', () => {
  it('separa os trechos de destaque', () => {
    expect(partes('Você gastou **R$ 10** em anúncios.')).toEqual([
      { texto: 'Você gastou ', forte: false },
      { texto: 'R$ 10', forte: true },
      { texto: ' em anúncios.', forte: false },
    ]);
    expect(partes('Sem destaque.')).toEqual([{ texto: 'Sem destaque.', forte: false }]);
    expect(partes('**Só destaque**')).toEqual([{ texto: 'Só destaque', forte: true }]);
  });
});

describe('diferencaEmPalavras', () => {
  const inteiro = (v: number) => String(v);

  it('diz quanto mudou e para que lado', () => {
    expect(diferencaEmPalavras(125000, 100000, reais, 'neutro')).toEqual({
      texto: `${rs('250')} a mais`,
      tom: null,
    });
    expect(diferencaEmPalavras(4, 9, inteiro, 'maior-melhor')).toEqual({ texto: '5 a menos', tom: 'ruim' });
    expect(diferencaEmPalavras(9, 4, inteiro, 'maior-melhor')).toEqual({ texto: '5 a mais', tom: 'bom' });
  });

  it('custo: cair é bom, subir é ruim', () => {
    expect(diferencaEmPalavras(40000, 50000, reais, 'menor-melhor')?.tom).toBe('bom');
    expect(diferencaEmPalavras(50000, 40000, reais, 'menor-melhor')?.tom).toBe('ruim');
  });

  it('igual e sem base', () => {
    expect(diferencaEmPalavras(7, 7, inteiro, 'maior-melhor')).toEqual({ texto: 'Igual', tom: null });
    expect(diferencaEmPalavras(7, null, inteiro, 'maior-melhor')).toBeNull();
    expect(diferencaEmPalavras(null, 7, inteiro, 'maior-melhor')).toBeNull();
  });
});

describe('numerosDoResumo', () => {
  it('os quatro números, na ordem do dinheiro, com a diferença em palavras', () => {
    const lista = numerosDoResumo({
      total: numeros(),
      anterior: numeros({
        investimento: 1720000,
        clientesNovos: 36,
        custoPorClienteNovo: 47778,
        retornoPorReal: 3.45,
      }),
    });
    expect(lista.map((n) => [n.titulo, n.valor, n.diferenca?.texto, n.diferenca?.tom])).toEqual([
      ['Você gastou', rs('18.450'), `${rs('1.250')} a mais`, null],
      ['Clientes novos', '41', '5 a mais', 'bom'],
      ['Cada cliente novo custou', rs('450'), `${rs('28')} a menos`, 'bom'],
      ['Voltou para cada R$ 1', rs('3,20'), `${rs('0,25')} a menos`, 'ruim'],
    ]);
    expect(lista[3]!.explicacao).toBe(
      `O primeiro pedido desses clientes somou ${rs('59.041')}. Quanto maior, melhor.`,
    );
  });

  it('a diferença fecha com os dois números que a tela mostra, já arredondados', () => {
    // R$ 100,49 e R$ 99,51 aparecem como R$ 100: a diferença é "Igual", não "R$ 1 a mais"
    const [gasto] = numerosDoResumo({
      total: numeros({ investimento: 10049 }),
      anterior: numeros({ investimento: 9951 }),
    });
    expect(gasto!.valor).toBe(rs('100'));
    expect(gasto!.diferenca).toEqual({ texto: 'Igual', tom: null });
  });

  it('sem comparação não há diferença; sem base o valor é null ("Sem dados" na tela)', () => {
    const semComparar = numerosDoResumo({ total: numeros(), anterior: null });
    expect(semComparar.every((n) => n.diferenca === null)).toBe(true);
    const vazio = numerosDoResumo({ total: semBase, anterior: null });
    expect(vazio.map((n) => n.valor)).toEqual([null, null, null, null]);
  });

  it('gastou e não trouxe cliente: o cartão do custo explica por que está sem dados', () => {
    const lista = numerosDoResumo({
      total: numeros({
        clientesNovos: 0,
        custoPorClienteNovo: null,
        valorDosPrimeirosPedidos: 0,
        retornoPorReal: 0,
      }),
      anterior: null,
    });
    expect(lista[2]!.valor).toBeNull();
    expect(lista[2]!.explicacao).toContain('Nenhum cliente novo veio de anúncio no período');
    expect(lista[3]!.valor).toBe(rs('0'));
  });
});

describe('tabelas', () => {
  it('custo da linha: valor, "Sem cliente novo" quando gastou e não trouxe, ou traço', () => {
    expect(custoDaLinha({ investimento: 100000, clientesNovos: 2, custoPorClienteNovo: 50000 })).toBe(
      rs('500'),
    );
    expect(custoDaLinha({ investimento: 100000, clientesNovos: 0, custoPorClienteNovo: null })).toBe(
      'Sem cliente novo',
    );
    expect(custoDaLinha({ investimento: 0, clientesNovos: 0, custoPorClienteNovo: null })).toBe('—');
    expect(custoDaLinha({ investimento: null, clientesNovos: null, custoPorClienteNovo: null })).toBe('—');
  });

  it('detalhe do gasto: a parte do total e os clientes novos', () => {
    expect(detalheDoGasto({ parcelaDoGasto: 0.428, clientesNovos: 2 })).toBe(
      '43% do gasto · 2 clientes novos',
    );
    expect(detalheDoGasto({ clientesNovos: 1 })).toBe('1 cliente novo');
    expect(detalheDoGasto({ parcelaDoGasto: null, clientesNovos: null })).toBe('—');
  });

  it('campanhas: todas até o limite; acima dele, as que mais gastaram e o resto recolhido', () => {
    expect(campanhasAVista(0)).toBe(0);
    expect(campanhasAVista(LIMITE_DE_CAMPANHAS)).toBe(LIMITE_DE_CAMPANHAS);
    expect(campanhasAVista(LIMITE_DE_CAMPANHAS + 1)).toBe(CAMPANHAS_NO_TOPO);
    expect(verOutrasCampanhas(1)).toBe('Ver a outra campanha');
    expect(verOutrasCampanhas(10)).toBe('Ver as outras 10 campanhas');
  });

  it('nota das campanhas diz quantas ficaram de fora', () => {
    expect(notaDasCampanhas({ campanhasSemMovimento: 0 })).not.toContain('de fora');
    expect(notaDasCampanhas({ campanhasSemMovimento: null })).not.toContain('de fora');
    expect(notaDasCampanhas({ campanhasSemMovimento: 1 })).toContain('1 campanha ficou de fora');
    expect(notaDasCampanhas({ campanhasSemMovimento: 5 })).toContain('5 campanhas ficaram de fora');
  });

  it('onde a campanha roda', () => {
    expect(ondeDaCampanha('meta', 'cs')).toBe('Meta Ads · Corpo Sensual');
  });
});

describe('glossário', () => {
  it('explica as palavras que a tela usa, sem sigla solta', () => {
    const termos = PALAVRAS.map((p) => p.termo);
    expect(termos).toContain('Pessoa interessada (lead)');
    expect(termos).toContain('Quanto voltou (ROAS)');
    expect(new Set(termos).size).toBe(termos.length);
    for (const p of PALAVRAS) expect(p.explicacao.endsWith('.')).toBe(true);
  });
});

describe('linkDoResumo', () => {
  it('leva a marca sempre e o período quando não é o padrão', () => {
    expect(
      linkDoResumo('https://exemplo.test', { marca: 'todas', periodo: 'este-mes', comparar: true }),
    ).toBe('https://exemplo.test/resumo?marca=todas');
    expect(
      linkDoResumo('https://exemplo.test/', { marca: 'cs', periodo: 'mes-passado', comparar: false }),
    ).toBe('https://exemplo.test/resumo?marca=cs&periodo=mes-passado&comparar=false');
  });
});

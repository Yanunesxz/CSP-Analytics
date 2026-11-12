/**
 * Textos do Resumo simples: as frases de abertura, os quatro números, as células
 * das tabelas, o glossário e o link para enviar. Puros, com teste; a tela só desenha.
 *
 * A tela é para quem não trabalha com marketing: nada de sigla sem explicação, e todo número vem
 * com a frase que diz o que ele é. Trecho entre `**` é destaque (a tela desenha em negrito).
 */

import { rotulo, type Brand, type Platform } from '@csp-mkt/shared';
import type { NumerosDoResumo, ResumoSimples } from '../../data/queries/resumo-simples';
import { VAZIO, data, dinheiro, numero, percentual, plural } from '../../lib/format';
import type { Intervalo } from '../../lib/periodo';
import { escreverFiltros, type Filtros } from '../../lib/url-state';

/* ---------- Formatos ---------- */

/**
 * Dinheiro em reais inteiros: `2703831` → "R$ 27.038". Nesta tela o centavo só atrapalha a leitura;
 * ele continua nas outras telas. Só "voltou para cada R$ 1" mostra centavos (`porReal`).
 */
export function reais(cents: number | null): string {
  return cents === null ? VAZIO : dinheiro(Math.round(cents / 100) * 100);
}

/** Quanto voltou para cada R$ 1: `3.2` → "R$ 3,20"; `2` → "R$ 2". */
export function porReal(razao: number | null): string {
  return razao === null ? VAZIO : dinheiro(Math.round(razao * 100));
}

/** "Este mês · 01/10/2026 a 30/10/2026". */
export function periodoDoResumo(intervalo: Pick<Intervalo, 'rotulo' | 'inicio' | 'fim'>): string {
  const dias =
    intervalo.inicio === intervalo.fim
      ? data(intervalo.inicio)
      : `${data(intervalo.inicio)} a ${data(intervalo.fim)}`;
  return `${intervalo.rotulo} · ${dias}`;
}

/** "vs. 1º a 3 de outubro" → "1º a 3 de outubro"; "vs. mês anterior" → "mês anterior". */
export function periodoDeComparacao(intervalo: Pick<Intervalo, 'rotuloAnterior'>): string {
  return intervalo.rotuloAnterior.replace(/^vs\.\s*/, '');
}

/** A marca do recorte, por extenso: "As duas marcas", "Corpo Sensual". */
export function marcaDoResumo(marca: Filtros['marca']): string {
  return marca === 'todas' ? 'As duas marcas' : rotulo('brand', marca);
}

function ondeDaMarca(marca: Filtros['marca']): string {
  return marca === 'todas' ? 'nas duas marcas' : `na marca ${rotulo('brand', marca)}`;
}

/* ---------- Em poucas palavras ---------- */

/** O resumo em frases, na ordem em que o dinheiro anda: gastou, trouxe, custou, voltou. */
export function frasesDoResumo(r: Pick<ResumoSimples, 'total'>, filtros: Pick<Filtros, 'marca'>): string[] {
  const t = r.total;
  if (t.investimento === null) return ['Os números de anúncio deste período ainda não chegaram.'];
  if (t.investimento === 0)
    return [`Você não gastou com anúncios ${ondeDaMarca(filtros.marca)} neste período.`];

  const frases = [`Você gastou **${reais(t.investimento)}** em anúncios ${ondeDaMarca(filtros.marca)}.`];

  if (t.interessados === null || t.clientesNovos === null) {
    frases.push('Ainda não dá para dizer o que esse gasto trouxe: os contatos e os pedidos não chegaram.');
    return frases;
  }

  const interessados = `**${plural(t.interessados, 'pessoa interessada', 'pessoas interessadas')}**`;
  const clientes = `**${plural(t.clientesNovos, 'cliente novo', 'clientes novos')}**`;
  if (t.interessados === 0 && t.clientesNovos === 0) {
    frases.push('Esses anúncios ainda não trouxeram nenhuma pessoa interessada nem cliente novo.');
  } else if (t.clientesNovos === 0) {
    frases.push(
      `Esses anúncios trouxeram ${interessados}, e ainda nenhum cliente novo (ninguém fez o primeiro pedido).`,
    );
  } else if (t.interessados === 0) {
    // Cliente novo conta no dia do pedido: pode ter deixado o contato antes do período
    frases.push(`Esses anúncios trouxeram ${clientes}, de pessoas que chegaram antes deste período.`);
  } else {
    frases.push(`Esses anúncios trouxeram ${interessados} e ${clientes}.`);
  }

  if (t.custoPorClienteNovo !== null)
    frases.push(`Cada cliente novo custou, em média, **${reais(t.custoPorClienteNovo)}**.`);

  if (t.retornoPorReal !== null && t.clientesNovos > 0)
    frases.push(
      `Para cada R$ 1 gasto, voltaram **${porReal(t.retornoPorReal)}** no primeiro pedido desses clientes (${reais(t.valorDosPrimeirosPedidos)} no total).`,
    );

  return frases;
}

/** Leads e clientes novos contando também quem não veio de anúncio; null sem base. */
export function fraseDeTodosOsCaminhos(r: Pick<ResumoSimples, 'todasAsOrigens'>): string | null {
  const { interessados, clientesNovos } = r.todasAsOrigens;
  if (interessados === null || clientesNovos === null) return null;
  return `Contando todos os caminhos (anúncio, indicação, busca, WhatsApp e os outros), chegaram ${plural(interessados, 'pessoa interessada', 'pessoas interessadas')} e ${plural(clientesNovos, 'cliente novo', 'clientes novos')} no período.`;
}

/** Quebra o texto nos trechos de destaque: `"a **b** c"` → a, b (forte), c. */
export function partes(texto: string): Array<{ texto: string; forte: boolean }> {
  return texto
    .split('**')
    .map((trecho, i) => ({ texto: trecho, forte: i % 2 === 1 }))
    .filter((p) => p.texto !== '');
}

/* ---------- Os quatro números ---------- */

export type Sentido = 'maior-melhor' | 'menor-melhor' | 'neutro';

export interface Diferenca {
  texto: string;
  /** `bom` e `ruim` ganham a cor de status; `null` fica neutro. */
  tom: 'bom' | 'ruim' | null;
}

/**
 * A diferença para o período de comparação, em palavras: "R$ 1.250 a mais", "5 a menos", "Igual".
 * Gasto e volume não têm lado; custo cair e retorno subir é bom.
 */
export function diferencaEmPalavras(
  atual: number | null,
  anterior: number | null,
  formato: (valor: number) => string,
  sentido: Sentido,
): Diferenca | null {
  if (atual === null || anterior === null) return null;
  const delta = atual - anterior;
  if (delta === 0) return { texto: 'Igual', tom: null };
  const subiu = delta > 0;
  const bom = sentido === 'neutro' ? null : (sentido === 'maior-melhor') === subiu;
  return {
    texto: `${formato(Math.abs(delta))} ${subiu ? 'a mais' : 'a menos'}`,
    tom: bom === null ? null : bom ? 'bom' : 'ruim',
  };
}

export interface NumeroDoResumo {
  chave: 'investimento' | 'clientesNovos' | 'custoPorClienteNovo' | 'retornoPorReal';
  /** O que o número é, do jeito que a pessoa perguntaria. */
  titulo: string;
  /** O número pronto; null vira "Sem dados". */
  valor: string | null;
  explicacao: string;
  diferenca: Diferenca | null;
}

/** Arredonda como a tela mostra, para a diferença fechar com os dois números que a pessoa vê. */
const emReais = (cents: number | null) => (cents === null ? null : Math.round(cents / 100) * 100);
const emCentavos = (razao: number | null) => (razao === null ? null : Math.round(razao * 100) / 100);

/** Os quatro números, na ordem em que o dinheiro anda: gastou, trouxe, custou, voltou. */
export function numerosDoResumo(r: Pick<ResumoSimples, 'total' | 'anterior'>): NumeroDoResumo[] {
  const t = r.total;
  const a = r.anterior;
  const ou = (valor: number | null, formato: (v: number) => string) =>
    valor === null ? null : formato(valor);
  const inteiro = (v: number) => numero(v);
  const semCliente = (t.investimento ?? 0) > 0 && t.clientesNovos === 0;

  return [
    {
      chave: 'investimento',
      titulo: 'Você gastou',
      valor: ou(t.investimento, reais),
      explicacao: 'Pago às plataformas para mostrar os anúncios.',
      diferenca: diferencaEmPalavras(
        emReais(t.investimento),
        emReais(a?.investimento ?? null),
        reais,
        'neutro',
      ),
    },
    {
      chave: 'clientesNovos',
      titulo: 'Clientes novos',
      valor: ou(t.clientesNovos, inteiro),
      explicacao: 'Chegaram por um anúncio e fizeram o primeiro pedido.',
      diferenca: diferencaEmPalavras(t.clientesNovos, a?.clientesNovos ?? null, inteiro, 'maior-melhor'),
    },
    {
      chave: 'custoPorClienteNovo',
      titulo: 'Cada cliente novo custou',
      valor: ou(t.custoPorClienteNovo, reais),
      explicacao: semCliente
        ? 'Nenhum cliente novo veio de anúncio no período: não há custo por cliente para mostrar.'
        : 'O gasto dividido pelos clientes novos. Quanto menor, melhor.',
      diferenca: diferencaEmPalavras(
        emReais(t.custoPorClienteNovo),
        emReais(a?.custoPorClienteNovo ?? null),
        reais,
        'menor-melhor',
      ),
    },
    {
      chave: 'retornoPorReal',
      titulo: 'Voltou para cada R$ 1',
      valor: ou(t.retornoPorReal, porReal),
      explicacao:
        t.valorDosPrimeirosPedidos === null
          ? 'O primeiro pedido desses clientes dividido pelo gasto. Quanto maior, melhor.'
          : `O primeiro pedido desses clientes somou ${reais(t.valorDosPrimeirosPedidos)}. Quanto maior, melhor.`,
      diferenca: diferencaEmPalavras(
        emCentavos(t.retornoPorReal),
        emCentavos(a?.retornoPorReal ?? null),
        porReal,
        'maior-melhor',
      ),
    },
  ];
}

/* ---------- Tabelas ---------- */

/** Custo por cliente novo na linha: quando gastou e não trouxe cliente, a célula diz isso. */
export function custoDaLinha(
  l: Pick<NumerosDoResumo, 'investimento' | 'clientesNovos' | 'custoPorClienteNovo'>,
): string {
  if (l.custoPorClienteNovo !== null) return reais(l.custoPorClienteNovo);
  if ((l.investimento ?? 0) > 0 && l.clientesNovos === 0) return 'Sem cliente novo';
  return VAZIO;
}

/** Onde os anúncios de cada plataforma aparecem, para quem não conhece o nome dela. */
export const ONDE_APARECE: Readonly<Record<Platform, string>> = {
  meta: 'Facebook e Instagram',
  tiktok: 'TikTok',
  google: 'Busca do Google e YouTube',
};

/** Explica os nomes das plataformas embaixo do gráfico. */
export const EXPLICACAO_DOS_CANAIS =
  'Meta Ads são os anúncios do Facebook e do Instagram; Google Ads, os da busca do Google e do YouTube; TikTok Ads, os do TikTok.';

/** Detalhe de cada barra do gasto, no "Ver como tabela". */
export function detalheDoGasto(
  l: Pick<NumerosDoResumo, 'clientesNovos'> & { parcelaDoGasto?: number | null },
): string {
  const itens: string[] = [];
  if (l.parcelaDoGasto !== null && l.parcelaDoGasto !== undefined)
    itens.push(`${percentual(l.parcelaDoGasto, 0)} do gasto`);
  if (l.clientesNovos !== null) itens.push(plural(l.clientesNovos, 'cliente novo', 'clientes novos'));
  return itens.length > 0 ? itens.join(' · ') : VAZIO;
}

/** Nota embaixo da lista de campanhas: quais aparecem e quantas ficaram de fora. */
export function notaDasCampanhas(r: Pick<ResumoSimples, 'campanhasSemMovimento'>): string {
  const base =
    'Aparecem as campanhas com gasto, pessoa interessada ou cliente novo no período, da que mais gastou para a que menos gastou.';
  if (!r.campanhasSemMovimento) return base;
  return `${base} ${
    r.campanhasSemMovimento === 1
      ? '1 campanha ficou de fora por não ter nada no período.'
      : `${numero(r.campanhasSemMovimento)} campanhas ficaram de fora por não terem nada no período.`
  }`;
}

/** Até quantas campanhas a lista mostra de uma vez; com mais do que isso, as menores ficam recolhidas. */
export const LIMITE_DE_CAMPANHAS = 10;
/** Quantas ficam à vista quando a lista passa do limite. */
export const CAMPANHAS_NO_TOPO = 8;

/** Quantas campanhas ficam à vista: todas até o limite; acima dele, só as que mais gastaram. */
export function campanhasAVista(total: number): number {
  return total <= LIMITE_DE_CAMPANHAS ? total : CAMPANHAS_NO_TOPO;
}

/** Texto do recolhido com as campanhas menores. */
export function verOutrasCampanhas(quantas: number): string {
  return quantas === 1 ? 'Ver a outra campanha' : `Ver as outras ${numero(quantas)} campanhas`;
}

/** "Meta Ads · Corpo Sensual", embaixo do nome da campanha. */
export function ondeDaCampanha(canal: Platform, marca: Brand): string {
  return `${rotulo('platform', canal)} · ${rotulo('brand', marca)}`;
}

/* ---------- Glossário ---------- */

export const PALAVRAS: ReadonlyArray<{ termo: string; explicacao: string }> = [
  {
    termo: 'Gasto (investimento)',
    explicacao:
      'O dinheiro pago às plataformas de anúncio no período. Não entra agência, produção de foto e vídeo nem comissão.',
  },
  {
    termo: 'Canal',
    explicacao:
      'Onde o anúncio aparece: Meta Ads (Facebook e Instagram), Google Ads (busca do Google e YouTube) e TikTok Ads.',
  },
  {
    termo: 'Campanha',
    explicacao: 'Um grupo de anúncios com o mesmo objetivo e a mesma verba, dentro de um canal.',
  },
  {
    termo: 'Pessoa interessada (lead)',
    explicacao: 'Quem chegou por um anúncio e deixou o contato. Ainda não comprou.',
  },
  {
    termo: 'Cliente novo',
    explicacao:
      'Quem fez o primeiro pedido. Conta no dia do pedido, mesmo que a pessoa tenha deixado o contato num mês anterior.',
  },
  {
    termo: 'Custo de cada cliente novo',
    explicacao: 'O gasto do período dividido pelos clientes novos que vieram de anúncio no mesmo período.',
  },
  {
    termo: 'Quanto voltou (ROAS)',
    explicacao:
      'O valor do primeiro pedido desses clientes novos dividido pelo gasto. Só entra o primeiro pedido, pelo valor do pedido enviado: o que o cliente comprar depois não entra.',
  },
  {
    termo: 'Veio de anúncio',
    explicacao:
      'O sistema sabe que a pessoa veio de um anúncio pelo link em que ela clicou. Quem chega por indicação, busca ou WhatsApp não entra nas contas de anúncio.',
  },
];

/* ---------- Link para enviar ---------- */

/**
 * O endereço desta tela com a marca e o período à vista, para quem recebe abrir no mesmo recorte.
 * A visão e o `?estado=` da demonstração não vão: são de quem está olhando.
 */
export function linkDoResumo(
  origem: string,
  filtros: Pick<Filtros, 'marca' | 'periodo' | 'comparar'>,
): string {
  const busca = escreverFiltros(new URLSearchParams(), {
    marca: filtros.marca,
    periodo: filtros.periodo,
    comparar: filtros.comparar,
  }).toString();
  return `${origem.replace(/\/$/, '')}/resumo?${busca}`;
}

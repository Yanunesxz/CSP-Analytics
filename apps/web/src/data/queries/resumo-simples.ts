/**
 * Resumo simples (rota `/resumo`): quanto foi gasto em anúncio, onde, e o que voltou, numa consulta só,
 * para quem não trabalha com marketing ler sem ajuda.
 *
 * Os mesmos números da tarefa T1, com outro nome na tela:
 * - gasto, pessoas interessadas (leads do CSP 360 atribuídos a campanha, decisão 0027), clientes novos
 *   atribuídos e custo por cliente novo vêm de `custoPorClienteNovo` (total, por canal e por marca) e de
 *   `metricasPorCampanha` (campanha por campanha): nenhuma conta nova;
 * - o que voltou segue a decisão 0028: valor do 1º pedido dos clientes novos atribuídos às campanhas
 *   do recorte ÷ gasto dessas campanhas. Sem gasto: null. Com gasto e nenhum cliente novo: 0.
 *
 * No protótipo, o 1º pedido é o pedido mais antigo do cliente no conjunto de dados; no banco (fase 4)
 * o número sai de `mkt.acquisition`. Métrica sem base é `null` — nunca 0 nem NaN.
 */

import type { Brand, Campaign, Lead, Platform } from '@csp-mkt/shared';
import type { Intervalo } from '../../lib/periodo';
import type { Filtros } from '../../lib/url-state';
import type { Dados } from '../dados';
import {
  campanhasFiltradas,
  clientesNovos,
  comCampanha,
  contagem,
  custoPorClienteNovo,
  filtrarPeriodo,
  leadsFiltrados,
  metricasPorCampanha,
  razao,
  type Janela,
  type LinhaCusto,
} from '../queries';

/* ---------- Tipos de saída ---------- */

/** Os seis números de um recorte (o total, um canal, uma marca ou uma campanha). */
export interface NumerosDoResumo {
  /** O que foi pago às plataformas no período, em centavos. */
  investimento: number | null;
  /** Leads do CSP 360 que vieram de campanha (pela UTM), criados no período. */
  interessados: number | null;
  /** Clientes novos que vieram de campanha, pelo dia do 1º pedido enviado. */
  clientesNovos: number | null;
  /** investimento ÷ clientesNovos. */
  custoPorClienteNovo: number | null;
  /** Soma do 1º pedido desses clientes novos, em centavos (decisão 0028). */
  valorDosPrimeirosPedidos: number | null;
  /** valorDosPrimeirosPedidos ÷ investimento: quanto voltou para cada R$ 1. */
  retornoPorReal: number | null;
}

export interface LinhaDoCanal extends NumerosDoResumo {
  canal: Platform;
  /** Parte do gasto total que foi para este canal (0 a 1). */
  parcelaDoGasto: number | null;
}

export interface LinhaDaMarca extends NumerosDoResumo {
  marca: Brand;
}

export interface LinhaDaCampanha extends NumerosDoResumo {
  campanha: Campaign;
}

export interface ResumoSimples {
  intervalo: Intervalo;
  total: NumerosDoResumo;
  /** O mesmo recorte no período anterior; null com "Comparar com o anterior" desligado. */
  anterior: NumerosDoResumo | null;
  /** Leads e clientes novos de todos os caminhos (com e sem anúncio), como na Visão geral. */
  todasAsOrigens: { interessados: number | null; clientesNovos: number | null };
  /** Os canais do filtro (os três sem filtro de canal). */
  porCanal: LinhaDoCanal[];
  /** As marcas do contexto (as duas em "As duas", uma com a marca escolhida). */
  porMarca: LinhaDaMarca[];
  /** Campanhas com gasto, pessoa interessada ou cliente novo no período, da que mais gastou para a que menos. */
  campanhas: LinhaDaCampanha[];
  /** Campanhas do recorte sem nada no período, que ficam fora da lista; null sem base. */
  campanhasSemMovimento: number | null;
}

/* ---------- O que voltou (decisão 0028) ---------- */

/** Valor do pedido mais antigo de cada cliente. */
function primeiroPedidoPorCliente(dados: Dados): Map<string, number> {
  const primeiro = new Map<string, { em: number; valor: number }>();
  for (const pedido of dados.orders) {
    const em = Date.parse(pedido.createdAt);
    const atual = primeiro.get(pedido.customerId);
    if (!atual || em < atual.em) primeiro.set(pedido.customerId, { em, valor: pedido.totalCents });
  }
  return new Map([...primeiro].map(([cliente, pedido]) => [cliente, pedido.valor]));
}

/**
 * Soma do 1º pedido destes clientes novos. Sem pedidos na base, ou com um cliente novo sem pedido
 * encontrado, não dá para afirmar o valor: null.
 */
function valorDosPedidos(
  novos: readonly Lead[],
  primeiroPedido: ReadonlyMap<string, number>,
  temBase: boolean,
): number | null {
  if (!temBase) return null;
  let total = 0;
  for (const lead of novos) {
    const valor = lead.crmCustomerId ? primeiroPedido.get(lead.crmCustomerId) : undefined;
    if (valor === undefined) return null;
    total += valor;
  }
  return total;
}

function numeros(
  linha: {
    investimento: number | null;
    interessados: number | null;
    clientesNovos: number | null;
    custoPorClienteNovo: number | null;
  },
  valor: number | null,
): NumerosDoResumo {
  return { ...linha, valorDosPrimeirosPedidos: valor, retornoPorReal: razao(valor, linha.investimento) };
}

/* ---------- A consulta ---------- */

export function resumoSimples(dados: Dados, filtros: Filtros, agora: Date = new Date()): ResumoSimples {
  const custo = custoPorClienteNovo(dados, filtros, agora);
  const intervalo = custo.intervalo;
  const anterior: Janela = { inicio: intervalo.anteriorInicio, fim: intervalo.anteriorFim };
  const temBase = dados.leads.length > 0 && dados.orders.length > 0;
  const primeiroPedido = primeiroPedidoPorCliente(dados);

  /** Os clientes novos atribuídos de um recorte: os mesmos que dividem o custo por cliente novo. */
  const valorDe = (f: Filtros, janela: Janela): number | null =>
    valorDosPedidos(
      comCampanha(clientesNovos(leadsFiltrados(dados, f), janela), campanhasFiltradas(dados, f)),
      primeiroPedido,
      temBase,
    );

  const filtrosDa = (linha: LinhaCusto): Filtros => ({
    ...filtros,
    marca: linha.marca ?? filtros.marca,
    canal: linha.canal ?? filtros.canal,
  });

  const doPeriodo = (linha: LinhaCusto): NumerosDoResumo =>
    numeros(
      {
        investimento: linha.investimento.atual,
        interessados: linha.leads.atual,
        clientesNovos: linha.clientesNovos.atual,
        custoPorClienteNovo: linha.custo.atual,
      },
      valorDe(filtrosDa(linha), intervalo),
    );

  const total = doPeriodo(custo.total);

  // Campanha por campanha: gasto, clientes novos e custo vêm de metricasPorCampanha; pessoas
  // interessadas e o valor dos pedidos usam a mesma atribuição por UTM (comCampanha)
  const leads = leadsFiltrados(dados, filtros);
  const leadsDoPeriodo = filtrarPeriodo(leads, 'createdAt', intervalo);
  const novosDoPeriodo = clientesNovos(leads, intervalo);
  const todas = metricasPorCampanha(dados, filtros, agora).linhas.map((linha): LinhaDaCampanha => {
    const so = [linha.campanha];
    return {
      campanha: linha.campanha,
      ...numeros(
        {
          investimento: linha.investimento.atual,
          interessados: contagem(dados.leads, comCampanha(leadsDoPeriodo, so)),
          clientesNovos: linha.clientesNovos.atual,
          custoPorClienteNovo: linha.custoPorClienteNovo.atual,
        },
        valorDosPedidos(comCampanha(novosDoPeriodo, so), primeiroPedido, temBase),
      ),
    };
  });
  const campanhas = todas.filter(
    (c) => (c.investimento ?? 0) > 0 || (c.interessados ?? 0) > 0 || (c.clientesNovos ?? 0) > 0,
  );

  return {
    intervalo,
    total,
    anterior: filtros.comparar
      ? numeros(
          {
            investimento: custo.total.investimento.anterior,
            interessados: custo.total.leads.anterior,
            clientesNovos: custo.total.clientesNovos.anterior,
            custoPorClienteNovo: custo.total.custo.anterior,
          },
          valorDe(filtros, anterior),
        )
      : null,
    todasAsOrigens: {
      interessados: contagem(dados.leads, leadsDoPeriodo),
      clientesNovos: contagem(dados.leads, novosDoPeriodo),
    },
    porCanal: custo.porCanal.flatMap((linha): LinhaDoCanal[] =>
      linha.canal
        ? [
            {
              canal: linha.canal,
              ...doPeriodo(linha),
              parcelaDoGasto: razao(linha.investimento.atual, total.investimento),
            },
          ]
        : [],
    ),
    porMarca: custo.porMarca.flatMap((linha): LinhaDaMarca[] =>
      linha.marca ? [{ marca: linha.marca, ...doPeriodo(linha) }] : [],
    ),
    campanhas,
    campanhasSemMovimento: dados.campaigns.length === 0 ? null : todas.length - campanhas.length,
  };
}

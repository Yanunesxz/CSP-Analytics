/**
 * Consulta da tela Base de clientes (`/base`). Parte de `baseDeClientes()` de `queries.ts` (a régua de
 * antigo, recompra e reativado mora lá, num lugar só) e entrega pronto o que a tela desenha: a base de
 * hoje pela situação do CSP 360, os números do período, o tempo desde a última compra, as linhas por
 * marca e por representante, a lista com o link da ficha 360 e o estado do conector do CSP 360.
 *
 * - Cliente da base = quem já tem pedido (decisão 0012). Quem está como "lead" no CSP 360, ou não tem
 *   pedido nem situação, ainda é lead e fica em Leads e em Chegada de clientes.
 * - A situação (ativo, inativo recente, inativo antigo, perdido) vem do CSP 360. Se o CSP 360 não manda
 *   a situação de ninguém, ativos, inativos e perdidos ficam `null` ("Sem dados"): o CSP-MKT não
 *   recalcula a régua (decisão 0006).
 * - Linha por marca = a mesma conta com a marca escolhida (quem compra das duas aparece nas duas);
 *   "As duas" conta cada cliente uma vez (decisão 0003).
 * - Nada de nome, telefone, e-mail ou documento: só código, marcas, situação, datas e o id para o link.
 *
 * Pura, com teste em `base-de-clientes.test.ts`; na fase 3 vira view SQL sobre a réplica do CSP 360.
 */

import type { ConnectorStatus, Customer } from '@csp-mkt/shared';
import type { Intervalo } from '../../lib/periodo';
import type { Filtros, Marca } from '../../lib/url-state';
import type { Dados } from '../dados';
import {
  baseDeClientes,
  contagem,
  razao,
  type BaseDeClientes,
  type ClienteDaBase,
  type Metrica,
} from '../queries';

/* ---------- Links para o CSP 360 ---------- */

/** Endereço de exemplo do CSP 360 (o mesmo do link de leads); o real entra na fase 3. */
export const URL_CSP360 = 'https://csp360.example';

/** Ficha 360 de um cliente no CSP 360. Só o id vai no link; nome e contato ficam lá. */
export function linkDaFicha360(customerId: string): string {
  return `${URL_CSP360}/clientes/${encodeURIComponent(customerId)}`;
}

/** A mesma lista no CSP 360: marca, representante e recorte da tela (parâmetros de exemplo). */
export function linkDaListaNoCsp360(
  filtros: Pick<Filtros, 'marca' | 'representante'>,
  recorte: Recorte | null,
): string {
  const params = new URLSearchParams();
  if (filtros.marca !== 'todas') params.set('marca', filtros.marca);
  if (filtros.representante) params.set('representante', filtros.representante);
  if (recorte) params.set('recorte', recorte);
  const texto = params.toString();
  return `${URL_CSP360}/clientes${texto ? `?${texto}` : ''}`;
}

/* ---------- Recortes da lista (filtros rápidos) ---------- */

export type Recorte = 'ativos' | 'inativos' | 'perdidos' | 'reativados' | 'sem-situacao';

export const RECORTES: ReadonlyArray<{ codigo: Recorte; rotulo: string; precisaDeSituacao: boolean }> = [
  { codigo: 'ativos', rotulo: 'Ativos', precisaDeSituacao: true },
  { codigo: 'inativos', rotulo: 'Inativos', precisaDeSituacao: true },
  { codigo: 'perdidos', rotulo: 'Perdidos', precisaDeSituacao: true },
  { codigo: 'reativados', rotulo: 'Reativados', precisaDeSituacao: false },
  { codigo: 'sem-situacao', rotulo: 'Sem situação', precisaDeSituacao: false },
];

function ehInativo(cliente: Pick<Customer, 'situation'>): boolean {
  return cliente.situation === 'inactive_recent' || cliente.situation === 'inactive_old';
}

const TESTE_DO_RECORTE: Record<Recorte, (cliente: ClienteDaBase) => boolean> = {
  ativos: (c) => c.situation === 'active',
  inativos: ehInativo,
  perdidos: (c) => c.situation === 'lost',
  reativados: (c) => c.reativado,
  'sem-situacao': (c) => c.situation === null,
};

/** Clientes do recorte; sem recorte, todos. */
export function filtrarRecorte<T extends ClienteDaBase>(lista: readonly T[], recorte: Recorte | null): T[] {
  return recorte ? lista.filter(TESTE_DO_RECORTE[recorte]) : [...lista];
}

/** A tela mostra no máximo isto (como a lista de leads); o resto pede um recorte ou um filtro. */
export const LIMITE_DA_LISTA = 200;

export interface ListaRecortada<T> {
  linhas: T[];
  /** Quantos clientes o recorte tem, mesmo acima do limite. */
  total: number;
  /** `true` quando a lista foi cortada no limite. */
  cortada: boolean;
}

/** Recorte + limite, na ordem em que a lista veio (há mais tempo sem comprar primeiro). */
export function recortarLista<T extends ClienteDaBase>(
  lista: readonly T[],
  recorte: Recorte | null,
  limite = LIMITE_DA_LISTA,
): ListaRecortada<T> {
  const filtrada = filtrarRecorte(lista, recorte);
  return { linhas: filtrada.slice(0, limite), total: filtrada.length, cortada: filtrada.length > limite };
}

/* ---------- Tipos de saída ---------- */

export type FaixaDeDias = 'ate-30' | '31-90' | '91-180' | '181-365' | 'mais-de-365';

export interface FaixaDeUltimaCompra {
  faixa: FaixaDeDias;
  rotulo: string;
  /** Clientes da base nesta faixa; null sem base. */
  total: number | null;
}

/** Uma linha das tabelas por marca e por representante. */
export interface LinhaDaBase {
  clientes: number | null;
  ativos: number | null;
  inativos: number | null;
  perdidos: number | null;
  /** Antigos que fizeram pedido no período. */
  recompraram: number | null;
  taxaRecompra: number | null;
  reativados: number | null;
}

export interface LinhaPorMarca extends LinhaDaBase {
  /** `todas` = "As duas", cada cliente uma vez. */
  marca: Marca;
}

export interface LinhaPorRepresentante extends LinhaDaBase {
  /** Código do representante no CSP 360; `null` = cliente sem representante. */
  representante: string | null;
}

export interface ClienteDaTela extends ClienteDaBase {
  /** Ficha 360 no CSP 360. */
  linkCrm: string;
}

/** O cartão do CSP 360 em Conectores: a base inteira depende dele. */
export interface ConectorCsp360 {
  status: ConnectorStatus;
  lastSyncAt: string | null;
}

export interface PainelDaBase {
  intervalo: Intervalo;
  /** O CSP 360 mandou a situação de algum cliente? Sem isso, ativos, inativos e perdidos ficam null. */
  situacaoConhecida: boolean;
  /* Hoje, pela situação do CSP 360 (não muda com o período) */
  total: number | null;
  ativos: number | null;
  inativosRecentes: number | null;
  inativosAntigos: number | null;
  inativos: number | null;
  perdidos: number | null;
  semSituacao: number | null;
  /* No período (de `baseDeClientes`, com o período anterior) */
  /** Clientes com pedido antes do período, em qualquer marca. */
  antigos: number | null;
  recompraram: Metrica;
  taxaRecompra: Metrica;
  reativados: Metrica;
  receitaAntigos: Metrica;
  receitaNovos: Metrica;
  participacaoAntigos: Metrica;
  /** Receita de novos ÷ receita do período. */
  participacaoNovos: number | null;
  faixasDeUltimaCompra: FaixaDeUltimaCompra[];
  /** Em "As duas": Corpo Sensual, Plumene e "As duas"; com marca, só ela. Vazio sem clientes. */
  porMarca: LinhaPorMarca[];
  /** Carteira de cada representante, maior primeiro; "sem representante" por último. */
  porRepresentante: LinhaPorRepresentante[];
  /** Opções do filtro de representante (código, nunca nome). */
  representantes: Array<{ valor: string; rotulo: string }>;
  /** Quantos clientes cada filtro rápido da lista mostra. */
  recortes: Record<Recorte, number | null>;
  /** A base inteira, há mais tempo sem comprar primeiro; a tela recorta com `recortarLista`. */
  lista: ClienteDaTela[];
  /** null quando o conector do CSP 360 não existe no conjunto. */
  conector: ConectorCsp360 | null;
}

/* ---------- Regras ---------- */

/** Já é cliente: tem pedido, ou o CSP 360 diz uma situação que não é "lead". */
export function ehDaBase(cliente: Customer): boolean {
  if (cliente.situation === 'lead') return false;
  return cliente.firstOrderAt !== null || cliente.situation !== null;
}

export const FAIXAS: ReadonlyArray<{ faixa: FaixaDeDias; rotulo: string; de: number; ate: number }> = [
  { faixa: 'ate-30', rotulo: 'Até 30 dias', de: 0, ate: 30 },
  { faixa: '31-90', rotulo: '31 a 90 dias', de: 31, ate: 90 },
  { faixa: '91-180', rotulo: '91 a 180 dias', de: 91, ate: 180 },
  { faixa: '181-365', rotulo: '181 a 365 dias', de: 181, ate: 365 },
  { faixa: 'mais-de-365', rotulo: 'Mais de 1 ano', de: 366, ate: Number.POSITIVE_INFINITY },
];

function somaOuNull(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}

/** Linha de tabela a partir de um resultado de `baseDeClientes` (marca ou carteira). */
function linhaDe(resultado: BaseDeClientes, situacaoConhecida: boolean): LinhaDaBase {
  const base = resultado.lista.filter(ehDaBase);
  const temBase = resultado.total !== null;
  const contar = (teste: (c: ClienteDaBase) => boolean) => (temBase ? base.filter(teste).length : null);
  const daSituacao = (teste: (c: ClienteDaBase) => boolean) => (situacaoConhecida ? contar(teste) : null);
  return {
    clientes: contar(() => true),
    ativos: daSituacao(TESTE_DO_RECORTE.ativos),
    inativos: daSituacao(TESTE_DO_RECORTE.inativos),
    perdidos: daSituacao(TESTE_DO_RECORTE.perdidos),
    recompraram: resultado.recompraram.atual,
    taxaRecompra: resultado.taxaRecompra.atual,
    reativados: resultado.reativados.atual,
  };
}

function compararCodigo(a: string, b: string): number {
  return a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });
}

export function painelDaBase(dados: Dados, filtros: Filtros, agora: Date = new Date()): PainelDaBase {
  const principal = baseDeClientes(dados, filtros, agora);
  const base = principal.lista.filter(ehDaBase);
  const situacaoConhecida = dados.customers.some((c) => c.situation !== null);

  const contar = (teste: (c: ClienteDaBase) => boolean) => contagem(dados.customers, base.filter(teste));
  const daSituacao = (teste: (c: ClienteDaBase) => boolean) => (situacaoConhecida ? contar(teste) : null);

  const ativos = daSituacao(TESTE_DO_RECORTE.ativos);
  const inativosRecentes = daSituacao((c) => c.situation === 'inactive_recent');
  const inativosAntigos = daSituacao((c) => c.situation === 'inactive_old');
  const inativos = daSituacao(TESTE_DO_RECORTE.inativos);
  const perdidos = daSituacao(TESTE_DO_RECORTE.perdidos);
  const semSituacao = contar(TESTE_DO_RECORTE['sem-situacao']);

  const faixasDeUltimaCompra = FAIXAS.map(({ faixa, rotulo, de, ate }) => ({
    faixa,
    rotulo,
    total: contar(
      (c) =>
        c.diasDesdeUltimaCompra !== null && c.diasDesdeUltimaCompra >= de && c.diasDesdeUltimaCompra <= ate,
    ),
  }));

  // Por marca: a mesma conta com cada marca (a régua de recompra e reativado é por marca)
  const marcas: Marca[] = filtros.marca === 'todas' ? ['cs', 'plumene', 'todas'] : [filtros.marca];
  const porMarca: LinhaPorMarca[] =
    dados.customers.length === 0
      ? []
      : marcas.map((marca) => ({
          marca,
          ...linhaDe(
            marca === filtros.marca ? principal : baseDeClientes(dados, { ...filtros, marca }, agora),
            situacaoConhecida,
          ),
        }));

  // Por representante: a carteira de cada um, com a mesma conta restrita aos clientes dele
  const carteiras = [...new Set(base.map((c) => c.repId))];
  const porRepresentante: LinhaPorRepresentante[] = carteiras
    .map((representante) => ({
      representante,
      ...linhaDe(
        baseDeClientes(
          { ...dados, customers: dados.customers.filter((c) => c.repId === representante) },
          filtros,
          agora,
        ),
        situacaoConhecida,
      ),
    }))
    .sort(
      (x, y) =>
        Number(x.representante === null) - Number(y.representante === null) ||
        (y.clientes ?? 0) - (x.clientes ?? 0) ||
        compararCodigo(x.representante ?? '', y.representante ?? ''),
    );

  const representantes = [...new Set(dados.customers.map((c) => c.repId))]
    .filter((id): id is string => id !== null)
    .sort(compararCodigo)
    .map((id) => ({ valor: id, rotulo: id }));

  const receitaDoPeriodo = somaOuNull(principal.receitaAntigos.atual, principal.receitaNovos.atual);
  const csp360 = dados.connectors.find((c) => c.id === 'csp360');

  return {
    intervalo: principal.intervalo,
    situacaoConhecida,
    total: contar(() => true),
    ativos,
    inativosRecentes,
    inativosAntigos,
    inativos,
    perdidos,
    semSituacao,
    antigos: principal.antigos,
    recompraram: principal.recompraram,
    taxaRecompra: principal.taxaRecompra,
    reativados: principal.reativados,
    receitaAntigos: principal.receitaAntigos,
    receitaNovos: principal.receitaNovos,
    participacaoAntigos: principal.participacaoAntigos,
    participacaoNovos: razao(principal.receitaNovos.atual, receitaDoPeriodo),
    faixasDeUltimaCompra,
    porMarca,
    porRepresentante,
    representantes,
    recortes: {
      ativos,
      inativos,
      perdidos,
      reativados: contar(TESTE_DO_RECORTE.reativados),
      'sem-situacao': semSituacao,
    },
    lista: base.map((c) => ({ ...c, linkCrm: linkDaFicha360(c.id) })),
    conector: csp360 ? { status: csp360.status, lastSyncAt: csp360.lastSyncAt } : null,
  };
}

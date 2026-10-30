/**
 * Indicador (.yn-card.yn-kpi): rótulo, valor tabular, delta vs. período anterior e link para a
 * tela que trabalha o número. Valor null = "Sem dados" (.yn-kpi__value--empty), nunca 0 ou NaN.
 */

import { Link } from 'react-router-dom';
import { dinheiro, dinheiroAbreviado, numero, numeroAbreviado, percentual, variacao } from '../../lib/format';
import { useFiltros, type Filtros } from '../../lib/url-state';
import type { Formato, Metrica } from '../../data/queries';

export type FormatoKpi = Formato | 'abreviado' | 'dinheiroAbreviado';

export interface KpiProps {
  /** Rótulo em maiúsculas pequenas (.yn-eyebrow). */
  rotulo: string;
  /** Número cru; null mostra "Sem dados". Ignorado quando `metrica` é dada. */
  valor?: number | null;
  /** Atalho: pega `atual` e `variacao` de uma Metrica das queries. */
  metrica?: Metrica;
  formato?: FormatoKpi;
  /** Casas decimais para `numero`/`decimal`. */
  casas?: number;
  /** Variação relativa (fração). Ignorada quando `metrica` é dada. */
  delta?: number | null;
  /** Texto depois do delta: "vs. mês anterior". */
  deltaTexto?: string;
  /** Custo: cair é bom, então a cor do delta inverte. */
  menorEhMelhor?: boolean;
  /** Linha pequena abaixo do valor (ex.: "Precisa de 10 encerradas no mês"). */
  nota?: string;
  /** Rota da tela que trabalha o número; recebe os filtros globais da URL. */
  para?: string;
  /** Filtros extras para o link (ex.: { canal: 'meta' }). */
  paraFiltros?: Partial<Filtros>;
  /** Texto para "Sem dados" quando quer explicar por quê. */
  semDadosTexto?: string;
}

export function formatarValor(
  valor: number | null | undefined,
  formato: FormatoKpi = 'numero',
  casas = 0,
): string {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return '—';
  switch (formato) {
    case 'dinheiro':
      return dinheiro(valor);
    case 'dinheiroAbreviado':
      return dinheiroAbreviado(valor);
    case 'percentual':
      return percentual(valor, casas || 1);
    case 'decimal':
      return numero(valor, casas || 2);
    case 'abreviado':
      return numeroAbreviado(valor);
    default:
      return numero(valor, casas);
  }
}

export function Kpi({
  rotulo,
  valor,
  metrica,
  formato = 'numero',
  casas = 0,
  delta,
  deltaTexto,
  menorEhMelhor = false,
  nota,
  para,
  paraFiltros,
  semDadosTexto,
}: KpiProps) {
  const { linkCom } = useFiltros();
  const v = metrica ? metrica.atual : (valor ?? null);
  const d = metrica ? metrica.variacao : (delta ?? null);
  const semDados = v === null || v === undefined || Number.isNaN(v);
  const sobe = d !== null && d > 0;
  const desce = d !== null && d < 0;
  const bom = (sobe && !menorEhMelhor) || (desce && menorEhMelhor);
  const ruim = (sobe && menorEhMelhor) || (desce && !menorEhMelhor);
  const classeDelta = `yn-kpi__delta${bom ? ' yn-kpi__delta--up' : ''}${ruim ? ' yn-kpi__delta--down' : ''}`;

  const corpo = (
    <>
      <p className="yn-eyebrow">{rotulo}</p>
      {semDados ? (
        <p className="yn-kpi__value yn-kpi__value--empty">{semDadosTexto ?? 'Sem dados'}</p>
      ) : (
        <p className="yn-kpi__value">{formatarValor(v, formato, casas)}</p>
      )}
      {!semDados && d !== null ? (
        <span className={classeDelta}>
          {variacao(d)}
          {deltaTexto ? ` ${deltaTexto}` : ''}
        </span>
      ) : nota ? (
        <span className="yn-kpi__delta">{nota}</span>
      ) : semDados ? (
        <span className="yn-kpi__delta">
          {deltaTexto ? `Sem base ${deltaTexto}` : 'Sem base para calcular'}
        </span>
      ) : null}
    </>
  );

  if (para) {
    return (
      <Link
        className="yn-card yn-kpi no-underline hover:border-line-strong"
        to={linkCom(para, paraFiltros)}
        title={`Ver ${rotulo.toLowerCase()}`}
      >
        {corpo}
      </Link>
    );
  }
  return <div className="yn-card yn-kpi">{corpo}</div>;
}

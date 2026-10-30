/**
 * Ranking (.yn-ranking): posição pela ordem da lista; `atual` marca "você" (aria-current).
 */

import { PontoDeSerie } from './ChipSerie';

export interface ItemRanking {
  id: string;
  rotulo: string;
  /** Valor já formatado. */
  valor: string;
  /** Iniciais para o avatar; sem elas, usa o ponto da cor da série (ou nada). */
  iniciais?: string;
  cor?: string;
  atual?: boolean;
}

export interface RankingProps {
  itens: ItemRanking[];
  rotulo?: string;
}

export function Ranking({ itens, rotulo }: RankingProps) {
  return (
    <ol className="yn-ranking" aria-label={rotulo}>
      {itens.map((item) => (
        <li key={item.id} aria-current={item.atual ? 'true' : undefined}>
          {item.iniciais ? (
            <span className="yn-avatar">{item.iniciais}</span>
          ) : item.cor ? (
            <PontoDeSerie cor={item.cor} />
          ) : null}
          <span className="yn-ranking__name" title={item.rotulo}>
            {item.rotulo}
          </span>
          <span className="yn-ranking__value">{item.valor}</span>
        </li>
      ))}
    </ol>
  );
}

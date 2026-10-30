/**
 * Chip com a cor da série e o rótulo (decisão 0007): marca, canal ou operador em legenda e filtro.
 * A cor nunca vem sozinha: sempre com o rótulo ao lado.
 */

import { cor as corDe, rotulo as rotuloDe, type Codigo, type Lista } from '@csp-mkt/shared';

export interface ChipSerieProps<L extends Lista = Lista> {
  /** Com `lista` + `codigo` (brand, platform, operator…), rótulo e cor vêm de labels.ts. */
  lista?: L;
  codigo?: Codigo<L> | string;
  rotulo?: string;
  /** Token CSS, ex.: "var(--color-series-2)". */
  cor?: string;
  /** Chip de filtro: liga/desliga com aria-pressed. */
  pressionado?: boolean;
  aoClicar?: () => void;
  contagem?: number | null;
}

export function PontoDeSerie({ cor }: { cor: string }) {
  return (
    <span
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ background: cor }}
      aria-hidden="true"
    />
  );
}

export function ChipSerie<L extends Lista>(props: ChipSerieProps<L>) {
  const { lista, codigo } = props;
  const daLista = lista && codigo !== undefined;
  const rotulo = props.rotulo ?? (daLista ? rotuloDe(lista, codigo) : '');
  const cor = props.cor ?? (daLista ? corDe(lista, codigo) : 'var(--color-text-muted)');
  const conteudo = (
    <>
      <PontoDeSerie cor={cor} />
      {rotulo}
      {props.contagem !== undefined && props.contagem !== null ? (
        <span className="yn-count">{props.contagem}</span>
      ) : null}
    </>
  );
  if (props.aoClicar) {
    return (
      <button
        className="yn-chip"
        type="button"
        aria-pressed={props.pressionado ?? false}
        onClick={props.aoClicar}
      >
        {conteudo}
      </button>
    );
  }
  return <span className="yn-chip">{conteudo}</span>;
}

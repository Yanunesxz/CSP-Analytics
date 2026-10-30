/**
 * Etiqueta de status (.yn-badge[data-tone]). Com `lista` + `codigo`, rótulo e tom vêm de
 * packages/shared (labels.ts); cores de série nunca entram aqui.
 */

import type { ReactNode } from 'react';
import { rotulo as rotuloDe, tom as tomDe, type Codigo, type Lista, type Tom } from '@csp-mkt/shared';

export interface BadgeProps<L extends Lista = Lista> {
  /** Com `lista` + `codigo`, rótulo e tom vêm de labels.ts. */
  lista?: L;
  codigo?: Codigo<L> | string;
  tom?: Tom;
  children?: ReactNode;
}

export function Badge<L extends Lista>(props: BadgeProps<L>) {
  const { lista, codigo } = props;
  if (lista && codigo !== undefined) {
    const tom = props.tom ?? tomDe(lista, codigo) ?? 'muted';
    return (
      <span className="yn-badge" data-tone={tom === 'muted' ? undefined : tom}>
        {rotuloDe(lista, codigo)}
      </span>
    );
  }
  return (
    <span className="yn-badge" data-tone={props.tom && props.tom !== 'muted' ? props.tom : undefined}>
      {props.children}
    </span>
  );
}

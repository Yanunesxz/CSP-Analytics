/**
 * Ajuste de layout local: a ficha de fatos curtos (impacto, esforço, custo…) cabe em duas colunas no
 * celular. O `.yn-dl` do padrão pede 160px por coluna e, dentro de um card de 375px, fica com uma só,
 * o que deixa cada proposta muito comprida. Só a largura mínima muda; cor e texto seguem o padrão.
 */

import type { CSSProperties } from 'react';

export const FATOS_COMPACTOS: CSSProperties = {
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 128px), 1fr))',
};

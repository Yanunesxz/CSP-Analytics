/**
 * Séries por marca dos gráficos de linha desta tela: rótulo e cor da marca (decisão 0007), uma linha
 * por marca em "As duas" e uma só com a marca escolhida no menu.
 */

import { cor, rotulo } from '@csp-mkt/shared';
import type { SerieLinha } from '../../components/ui';
import type { SerieDaMarca } from '../../data/queries/seo-geo';

export function seriesPorMarca(series: readonly SerieDaMarca[], prefixo: string): SerieLinha[] {
  return series.map((s) => ({
    id: `${prefixo}-${s.marca}`,
    rotulo: rotulo('brand', s.marca),
    cor: cor('brand', s.marca),
    pontos: s.pontos,
  }));
}

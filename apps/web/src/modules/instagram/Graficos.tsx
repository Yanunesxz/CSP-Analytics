/**
 * Seguidores por dia e alcance por dia, uma linha por perfil (cor da marca, decisão 0007),
 * lado a lado. "Ver como tabela" e os estados "Sem dados" e erro vêm do GraficoLinha.
 */

import { useMemo } from 'react';
import { cor, rotulo } from '@csp-mkt/shared';
import { GraficoLinha, type SerieLinha } from '../../components/ui';
import type { PerfilInstagram } from '../../data/queries/instagram';

export interface GraficosProps {
  perfis: PerfilInstagram[];
  estado: 'ok' | 'sem-dados';
}

export function Graficos({ perfis, estado }: GraficosProps) {
  const seguidores = useMemo<SerieLinha[]>(
    () =>
      perfis.map((p) => ({
        id: `seguidores-${p.marca}`,
        rotulo: rotulo('brand', p.marca),
        cor: cor('brand', p.marca),
        pontos: p.seguidoresPorDia,
      })),
    [perfis],
  );

  const alcance = useMemo<SerieLinha[]>(
    () =>
      perfis.map((p) => ({
        id: `alcance-${p.marca}`,
        rotulo: rotulo('brand', p.marca),
        cor: cor('brand', p.marca),
        pontos: p.alcancePorDia,
      })),
    [perfis],
  );

  const estadoGrafico = estado === 'sem-dados' ? 'semDados' : 'ok';

  return (
    <div className="mkt-grid-2">
      <GraficoLinha
        titulo="Seguidores por dia"
        descricao="Total de seguidores no fim de cada dia."
        series={seguidores}
        estado={estadoGrafico}
      />
      <GraficoLinha
        titulo="Alcance por dia"
        descricao="Contas alcançadas em cada dia."
        series={alcance}
        estado={estadoGrafico}
      />
    </div>
  );
}

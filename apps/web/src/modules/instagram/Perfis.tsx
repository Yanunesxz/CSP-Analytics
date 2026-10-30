/**
 * Um bloco por perfil (marca): seguidores e saldo no período, alcance, impressões, engajamento,
 * taxa de engajamento e salvos. Em "As duas" os dois blocos ficam lado a lado (.mkt-grid-2) e
 * empilham quando o espaço aperta.
 */

import { useId } from 'react';
import { cor, rotulo } from '@csp-mkt/shared';
import { Kpi, PontoDeSerie } from '../../components/ui';
import type { PerfilInstagram } from '../../data/queries/instagram';
import { notaSeguidores, textoPosts } from './textos';

export interface PerfisProps {
  perfis: PerfilInstagram[];
  /** "vs. mês anterior"; undefined quando a comparação está desligada. */
  deltaTexto?: string;
}

export function Perfis({ perfis, deltaTexto }: PerfisProps) {
  return (
    <div className="mkt-grid-2">
      {perfis.map((perfil) => (
        <Perfil key={perfil.marca} perfil={perfil} deltaTexto={deltaTexto} />
      ))}
    </div>
  );
}

function Perfil({ perfil, deltaTexto }: { perfil: PerfilInstagram; deltaTexto?: string }) {
  const idTitulo = useId();
  const posts = textoPosts(perfil.posts);

  return (
    <section className="mkt-stack min-w-0" aria-labelledby={idTitulo}>
      <div className="mkt-chart__head">
        <h2 id={idTitulo} className="flex items-center gap-2">
          <PontoDeSerie cor={cor('brand', perfil.marca)} />
          {rotulo('brand', perfil.marca)}
        </h2>
        {posts ? <p className="yn-muted text-sm">{posts}</p> : null}
      </div>
      <div className="mkt-grid-kpis">
        <Kpi
          rotulo="Seguidores"
          valor={perfil.seguidores}
          nota={notaSeguidores(perfil.variacaoSeguidores.atual)}
        />
        <Kpi rotulo="Alcance" metrica={perfil.alcance} deltaTexto={deltaTexto} />
        <Kpi rotulo="Impressões" metrica={perfil.impressoes} deltaTexto={deltaTexto} />
        <Kpi rotulo="Engajamento" metrica={perfil.engajamento} deltaTexto={deltaTexto} />
        <Kpi
          rotulo="Taxa de engajamento"
          metrica={perfil.taxaEngajamento}
          formato="percentual"
          casas={1}
          deltaTexto={deltaTexto}
        />
        <Kpi rotulo="Salvos" metrica={perfil.salvos} deltaTexto={deltaTexto} />
      </div>
    </section>
  );
}

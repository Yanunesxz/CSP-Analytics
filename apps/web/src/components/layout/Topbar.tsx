/**
 * Barra do topo (.yn-topbar): botão do menu no celular, eyebrow + h1 da página, ação principal,
 * .yn-segmented "Visão" (Visualizador · Gestor de tráfego, ligado a ?visao=) e botão lua/sol. A "Visão" só muda as
 * telas de números: some para quem não vê números (o leitor do resumo, decisão 0043).
 */

import { Eye, Menu, Moon, SlidersHorizontal, Sun } from 'lucide-react';
import { pode } from '@csp-mkt/shared';
import { useSessao } from '../../lib/auth';
import { atualizadoHa } from '../../lib/format';
import { alternarTema } from '../../lib/tema';
import { useFiltros, type Visao } from '../../lib/url-state';
import { usePagina } from './pagina';

export interface TopbarProps {
  navAberta: boolean;
  aoAbrirMenu: () => void;
}

const VISOES: Array<{ codigo: Visao; rotulo: string; icone: typeof Eye }> = [
  { codigo: 'visualizador', rotulo: 'Visualizador', icone: Eye },
  { codigo: 'gestor', rotulo: 'Gestor de tráfego', icone: SlidersHorizontal },
];

export function Topbar({ navAberta, aoAbrirMenu }: TopbarProps) {
  const { pagina } = usePagina();
  const { filtros, definir } = useFiltros();
  const { perfil } = useSessao();

  return (
    <header className="yn-topbar">
      <button
        className="yn-btn yn-btn--ghost yn-btn--icon yn-nav-toggle"
        type="button"
        aria-label="Abrir menu"
        aria-controls="menu"
        aria-expanded={navAberta}
        onClick={aoAbrirMenu}
      >
        <Menu strokeWidth={1.75} aria-hidden="true" />
      </button>
      <div>
        {pagina.grupo ? <p className="yn-eyebrow">{pagina.grupo}</p> : null}
        <h1>{pagina.titulo}</h1>
        {pagina.atualizadoEm !== undefined ? (
          <p className="yn-muted text-xs">{atualizadoHa(pagina.atualizadoEm)}</p>
        ) : null}
      </div>
      {pagina.acao}
      {pode(perfil?.role, 'ver_numeros') ? (
        <div className="yn-segmented" role="group" aria-label="Visão">
          {VISOES.map((v) => (
            <button
              key={v.codigo}
              type="button"
              aria-pressed={filtros.visao === v.codigo}
              onClick={() => definir({ visao: v.codigo })}
            >
              <v.icone strokeWidth={1.75} aria-hidden="true" />
              {v.rotulo}
            </button>
          ))}
        </div>
      ) : null}
      <button
        className="yn-btn yn-btn--ghost yn-btn--icon mkt-topbar__tema"
        type="button"
        data-alternar-tema
        aria-label="Alternar tema claro e escuro"
        onClick={alternarTema}
      >
        <Moon strokeWidth={1.75} aria-hidden="true" className="yn-only-light" />
        <Sun strokeWidth={1.75} aria-hidden="true" className="yn-only-dark" />
      </button>
    </header>
  );
}

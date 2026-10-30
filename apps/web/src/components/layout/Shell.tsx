/**
 * Casca (.yn-shell) do padrão, modelo gaveta: menu lateral, scrim, coluna principal com faixas
 * (modo demonstração, versão nova), barra do topo e .yn-content com a rota.
 * O script da casca vira estado: navAberta (data-nav="open") e menuRecolhido (data-sidebar="collapsed",
 * guardado em localStorage "menu-recolhido").
 */

import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { store } from '../../data/store';
import { useSessao } from '../../lib/auth';
import { recarregar, useVersaoNova } from '../../lib/versao';
import { Esqueleto } from '../ui/Esqueleto';
import { ToastProvider, useToast } from '../ui/ToastRegion';
import { Vazio } from '../ui/Vazio';
import { PaginaProvider } from './pagina';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

function lerRecolhido(): boolean {
  try {
    return Boolean(localStorage.getItem('menu-recolhido'));
  } catch {
    return false;
  }
}

function FaixaDemonstracao() {
  const { avisar } = useToast();
  if (!store.demonstracao) return null;
  return (
    <div className="yn-banner" role="status">
      <p>
        {store.comDadosDeExemplo
          ? 'Modo demonstração · dados de exemplo'
          : 'Modo demonstração · sem dados de exemplo'}
      </p>
      {store.comDadosDeExemplo ? (
        <button
          className="yn-btn yn-btn--sm yn-btn--secondary"
          type="button"
          onClick={() => {
            store.recomecar();
            avisar('Dados de exemplo restaurados.');
          }}
        >
          Recomeçar
        </button>
      ) : null}
    </div>
  );
}

function FaixaVersaoNova() {
  const nova = useVersaoNova();
  if (!nova) return null;
  return (
    <div className="yn-banner" data-tone="info" role="status">
      <RefreshCw strokeWidth={1.75} aria-hidden="true" />
      <p>Versão nova disponível. Atualize para continuar com a versão mais recente.</p>
      <button className="yn-btn yn-btn--sm yn-btn--secondary" type="button" onClick={recarregar}>
        Atualizar
      </button>
    </div>
  );
}

function Casca() {
  const { perfil, carregando, modo } = useSessao();
  const location = useLocation();
  const [navAberta, setNavAberta] = useState(false);
  const [menuRecolhido, setMenuRecolhido] = useState(lerRecolhido);

  const definirGaveta = useCallback((aberta: boolean) => {
    setNavAberta(aberta);
    if (aberta) {
      window.setTimeout(() => document.querySelector<HTMLAnchorElement>('.yn-nav a')?.focus(), 0);
    } else {
      document.querySelector<HTMLButtonElement>('.yn-nav-toggle')?.focus();
    }
  }, []);

  const definirRecolhido = useCallback((sim: boolean) => {
    setMenuRecolhido(sim);
    try {
      localStorage.setItem('menu-recolhido', sim ? '1' : '');
    } catch {
      /* sem localStorage: vale só nesta aba */
    }
  }, []);

  // Fecha a gaveta ao trocar de tela
  useEffect(() => {
    setNavAberta(false);
  }, [location.pathname]);

  // Esc fecha a gaveta
  useEffect(() => {
    if (!navAberta) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') definirGaveta(false);
    };
    addEventListener('keydown', aoTeclar);
    return () => removeEventListener('keydown', aoTeclar);
  }, [navAberta, definirGaveta]);

  let conteudo: ReactNode;
  if (carregando) conteudo = <Esqueleto variante="tela" />;
  else if (!perfil && modo === 'supabase')
    conteudo = (
      <Vazio
        titulo="Entre para continuar"
        texto="O login com Supabase Auth entra na fase 3. Até lá, abra sem as variáveis do Supabase para usar o modo demonstração."
      />
    );
  else conteudo = <Outlet />;

  return (
    <div
      className="yn-shell"
      data-nav={navAberta ? 'open' : undefined}
      data-sidebar={menuRecolhido ? 'collapsed' : undefined}
    >
      <Sidebar
        recolhido={menuRecolhido}
        aoRecolher={() => definirRecolhido(!menuRecolhido)}
        aoNavegar={() => setNavAberta(false)}
      />
      <div className="yn-scrim" aria-hidden="true" onClick={() => definirGaveta(false)} />
      <div className="yn-main">
        <FaixaDemonstracao />
        <FaixaVersaoNova />
        <Topbar navAberta={navAberta} aoAbrirMenu={() => definirGaveta(!navAberta)} />
        <main className="yn-content">{conteudo}</main>
      </div>
    </div>
  );
}

export function Shell() {
  return (
    <ToastProvider>
      <PaginaProvider>
        <Casca />
      </PaginaProvider>
    </ToastProvider>
  );
}

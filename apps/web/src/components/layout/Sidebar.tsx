/**
 * Menu lateral (.yn-sidebar): nome do cliente (CSP MKT, decisão 0039), seletor de marca
 * (.yn-context ligado a ?marca=), navegação em grupos com aria-current="page" e title em cada link,
 * usuário no fim com Perfil (Configurações → Sua conta) · Tema · Sair. Item com `acao` só aparece
 * quando o papel permite; a rota exige a mesma ação (ROTAS_PROTEGIDAS em @csp-mkt/shared, conferido
 * em rotas.test.ts).
 */

import {
  Camera,
  Check,
  ChevronsUpDown,
  EllipsisVertical,
  Inbox,
  LayoutGrid,
  LogOut,
  Megaphone,
  Moon,
  PanelLeft,
  Plug,
  Search,
  Settings,
  Sparkles,
  Stethoscope,
  Sun,
  User,
  UserCheck,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { pode, rotulo, rotuloMarca, type Acao } from '@csp-mkt/shared';
import { iniciais, useSessao } from '../../lib/auth';
import { alternarTema } from '../../lib/tema';
import { useFiltros, type Marca } from '../../lib/url-state';
import { useToast } from '../ui/ToastRegion';

interface Item {
  para: string;
  rotulo: string;
  icone: LucideIcon;
  /** Só aparece quando o papel pode. */
  acao?: Acao;
  fim?: boolean;
}

interface Grupo {
  rotulo: string | null;
  itens: Item[];
}

export const GRUPOS_DO_MENU: Grupo[] = [
  { rotulo: null, itens: [{ para: '/', rotulo: 'Visão geral', icone: LayoutGrid, fim: true }] },
  {
    rotulo: 'Clientes',
    itens: [
      { para: '/chegada', rotulo: 'Chegada de clientes', icone: Users },
      { para: '/base', rotulo: 'Base de clientes', icone: UserCheck },
      { para: '/leads', rotulo: 'Leads', icone: Inbox, acao: 'ver_leads' },
    ],
  },
  {
    rotulo: 'Canais',
    itens: [
      { para: '/canais/meta', rotulo: 'Meta Ads', icone: Megaphone },
      { para: '/canais/tiktok', rotulo: 'TikTok Ads', icone: Megaphone },
      { para: '/canais/google', rotulo: 'Google Ads', icone: Megaphone },
      { para: '/instagram', rotulo: 'Instagram', icone: Camera },
      { para: '/seo-geo', rotulo: 'SEO e GEO', icone: Search },
    ],
  },
  {
    rotulo: 'Tráfego',
    itens: [{ para: '/trafego', rotulo: 'Tráfego com IA', icone: Sparkles, acao: 'ver_trafego_ia' }],
  },
  {
    rotulo: 'Sistema',
    itens: [
      { para: '/conectores', rotulo: 'Conectores', icone: Plug, acao: 'ver_conectores' },
      { para: '/usuarios', rotulo: 'Usuários', icone: UsersRound, acao: 'gerir_usuarios' },
      { para: '/diagnostico', rotulo: 'Diagnóstico', icone: Stethoscope, acao: 'ver_diagnostico' },
      { para: '/configuracoes', rotulo: 'Configurações', icone: Settings },
    ],
  },
];

/** Grupo (eyebrow) de uma rota, para o PageHeader e o título. */
export function grupoDaRota(pathname: string): string {
  for (const grupo of GRUPOS_DO_MENU) {
    for (const item of grupo.itens) {
      if (item.fim ? pathname === item.para : pathname.startsWith(item.para)) return grupo.rotulo ?? 'Início';
    }
  }
  return '';
}

const MARCAS: Array<{ codigo: Marca; marca: string }> = [
  { codigo: 'cs', marca: 'CS' },
  { codigo: 'plumene', marca: 'PL' },
  { codigo: 'todas', marca: '2' },
];

export interface SidebarProps {
  recolhido: boolean;
  aoRecolher: () => void;
  aoNavegar: () => void;
  /** Escolher a marca fecha a gaveta no celular, como escolher um item do menu. */
  aoEscolherMarca: () => void;
}

export function Sidebar({ recolhido, aoRecolher, aoNavegar, aoEscolherMarca }: SidebarProps) {
  const { perfil, modo, sair } = useSessao();
  const { filtros, definir, searchGlobal } = useFiltros();
  const { avisar } = useToast();
  const [contextoAberto, setContextoAberto] = useState(false);
  const menuUsuario = useRef<HTMLDetailsElement>(null);

  const escolherMarca = (marca: Marca) => {
    definir({ marca });
    setContextoAberto(false);
    aoEscolherMarca();
  };

  const aoSair = async () => {
    menuUsuario.current?.removeAttribute('open');
    if (modo === 'demonstracao') {
      avisar('Modo demonstração: não há login para sair.');
      return;
    }
    await sair();
  };

  const marcaAtual = MARCAS.find((m) => m.codigo === filtros.marca) ?? MARCAS[2]!;

  return (
    <aside className="yn-sidebar" id="menu" aria-label="Menu">
      <div className="yn-sidebar__head">
        {/* Sistema de cliente: o nome do grupo, sem a assinatura Yan Nunes (decisão 0039) */}
        <div className="yn-sidebar__brand" title="CSP MKT">
          <span>CSP</span>
          <span className="yn-sidebar__product">MKT</span>
        </div>
        <button
          className="yn-btn yn-btn--ghost yn-btn--sm yn-btn--icon yn-sidebar__toggle"
          type="button"
          aria-label={recolhido ? 'Abrir menu' : 'Recolher menu'}
          aria-expanded={!recolhido}
          onClick={aoRecolher}
        >
          <PanelLeft strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <details
        className="yn-menu yn-menu--block"
        open={contextoAberto}
        onToggle={(e) => setContextoAberto((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="yn-context" aria-label={`Marca: ${rotuloMarca(filtros.marca)}`}>
          <span className="yn-context__mark">{marcaAtual.marca}</span>
          <span className="yn-context__text">
            <span className="yn-context__label">Marca</span>
            <span className="yn-context__name">{rotuloMarca(filtros.marca)}</span>
          </span>
          <ChevronsUpDown strokeWidth={1.75} aria-hidden="true" />
        </summary>
        <div className="yn-menu__list" role="group" aria-label="Escolher marca">
          {MARCAS.map((m) => (
            <button
              key={m.codigo}
              type="button"
              aria-pressed={filtros.marca === m.codigo}
              onClick={() => escolherMarca(m.codigo)}
            >
              {filtros.marca === m.codigo ? (
                <Check strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <span className="inline-block size-4" aria-hidden="true" />
              )}
              {rotuloMarca(m.codigo)}
            </button>
          ))}
        </div>
      </details>

      <nav className="yn-nav" aria-label="Menu principal">
        {GRUPOS_DO_MENU.map((grupo) => {
          const itens = grupo.itens.filter((item) => !item.acao || pode(perfil?.role, item.acao));
          if (itens.length === 0) return null;
          return (
            <div key={grupo.rotulo ?? 'inicio'} className="contents">
              {grupo.rotulo ? <p className="yn-nav__label">{grupo.rotulo}</p> : null}
              {itens.map((item) => (
                <NavLink
                  key={item.para}
                  to={{ pathname: item.para, search: searchGlobal }}
                  end={item.fim}
                  title={item.rotulo}
                  onClick={aoNavegar}
                >
                  <item.icone strokeWidth={1.75} aria-hidden="true" />
                  {item.rotulo}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      {perfil ? (
        <div className="yn-sidebar__user">
          <span className="yn-avatar" aria-hidden="true">
            {iniciais(perfil.name)}
          </span>
          <span className="yn-sidebar__user-text">
            <span className="yn-sidebar__user-name">{perfil.name}</span>
            <span className="yn-sidebar__user-role">{rotulo('role', perfil.role)}</span>
          </span>
          <details className="yn-menu" ref={menuUsuario}>
            <summary className="yn-btn yn-btn--ghost yn-btn--sm yn-btn--icon" aria-label="Opções da conta">
              <EllipsisVertical strokeWidth={1.75} aria-hidden="true" />
            </summary>
            <div className="yn-menu__list yn-menu__list--up">
              {/* "Sua conta" em Configurações vale para todo papel; /usuarios exige gerir_usuarios */}
              <Link
                to={{ pathname: '/configuracoes', search: searchGlobal, hash: '#conta' }}
                onClick={() => {
                  menuUsuario.current?.removeAttribute('open');
                  aoNavegar();
                }}
              >
                <User strokeWidth={1.75} aria-hidden="true" />
                Perfil
              </Link>
              <button type="button" onClick={alternarTema}>
                <Moon strokeWidth={1.75} aria-hidden="true" className="yn-only-light" />
                <Sun strokeWidth={1.75} aria-hidden="true" className="yn-only-dark" />
                Tema
              </button>
              <button type="button" onClick={() => void aoSair()}>
                <LogOut strokeWidth={1.75} aria-hidden="true" />
                Sair
              </button>
            </div>
          </details>
        </div>
      ) : null}
    </aside>
  );
}

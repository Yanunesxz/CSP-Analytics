/**
 * Título da página: cada tela chama <PageHeader> uma vez; a barra do topo desenha o único h1
 * (regra 9 da seção 7) e o `document.title` fica "Título · CSP-MKT".
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface Pagina {
  /** Grupo do menu, no .yn-eyebrow: "Início", "Clientes", "Canais", "Tráfego", "Sistema". */
  grupo: string;
  titulo: string;
  /** A ação principal da tela (um botão só), desenhada na barra do topo. */
  acao?: ReactNode;
  /** Instante da última sincronização, para o "atualizado há X min". */
  atualizadoEm?: string | null;
}

interface ContextoPagina {
  pagina: Pagina;
  definir: (pagina: Pagina) => void;
}

const PAGINA_PADRAO: Pagina = { grupo: '', titulo: 'CSP-MKT' };
const Contexto = createContext<ContextoPagina | null>(null);

export function PaginaProvider({ children }: { children: ReactNode }) {
  const [pagina, definir] = useState<Pagina>(PAGINA_PADRAO);
  const valor = useMemo(() => ({ pagina, definir }), [pagina]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function usePagina(): ContextoPagina {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('usePagina precisa do <PaginaProvider> (a casca já o fornece).');
  return ctx;
}

export type PageHeaderProps = Pagina;

/** Um por tela. Não desenha nada aqui: o h1 fica na barra do topo. */
export function PageHeader({ grupo, titulo, acao, atualizadoEm }: PageHeaderProps) {
  const { definir } = usePagina();
  useEffect(() => {
    definir({ grupo, titulo, acao, atualizadoEm });
    document.title = `${titulo} · CSP-MKT`;
    return () => {
      definir(PAGINA_PADRAO);
      document.title = 'CSP-MKT';
    };
  }, [definir, grupo, titulo, acao, atualizadoEm]);
  return null;
}

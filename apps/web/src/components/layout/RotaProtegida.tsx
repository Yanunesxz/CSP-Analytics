/**
 * Rota protegida por papel (decisão 0011): a mesma regra de packages/shared que esconde o item
 * do menu. A tela esconder não é segurança: a RLS da fase 3 confere o papel de novo no banco.
 * Na entrada ("/"), quem não abre a Visão geral vai para a primeira tela que o papel abre (o leitor do resumo cai no
 * Resumo simples, decisão 0043), com a marca e o período da URL.
 */

import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { pode, type Acao } from '@csp-mkt/shared';
import { useSessao } from '../../lib/auth';
import { Esqueleto } from '../ui/Esqueleto';
import { Vazio } from '../ui/Vazio';
import { primeiraTelaDoPapel } from './Sidebar';

export function RotaProtegida({ acao, children }: { acao: Acao; children: ReactNode }) {
  const { perfil, carregando } = useSessao();
  const { pathname, search } = useLocation();
  if (carregando) return <Esqueleto variante="tela" />;
  if (!pode(perfil?.role, acao)) {
    const inicio = pathname === '/' ? primeiraTelaDoPapel(perfil?.role) : null;
    if (inicio && inicio !== '/') return <Navigate to={{ pathname: inicio, search }} replace />;
    return (
      <Vazio
        icone={Lock}
        titulo="Você não tem acesso a esta tela"
        texto="Peça ao dono do sistema para liberar o seu papel em Usuários."
      />
    );
  }
  return <>{children}</>;
}

/**
 * Rota protegida por papel (decisão 0011): a mesma regra de packages/shared que esconde o item
 * do menu. A tela esconder não é segurança: a RLS da fase 3 confere o papel de novo no banco.
 */

import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { pode, type Acao } from '@csp-mkt/shared';
import { useSessao } from '../../lib/auth';
import { Esqueleto } from '../ui/Esqueleto';
import { Vazio } from '../ui/Vazio';

export function RotaProtegida({ acao, children }: { acao: Acao; children: ReactNode }) {
  const { perfil, carregando } = useSessao();
  if (carregando) return <Esqueleto variante="tela" />;
  if (!pode(perfil?.role, acao)) {
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

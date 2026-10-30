/**
 * O que a pessoa logada pode fazer nesta tela (a Visão muda o que aparece; o papel, o que dá para fazer).
 * A mesma regra de `packages/shared` que a RLS da fase 3 confere no banco.
 *
 * - Aprovar, descartar e mudar limite de gasto: `aprovar_acao` (só o dono). O limite é a trava de gasto:
 *   quem opera não sobe o próprio teto.
 * - Registrar ideia, marcar como feita e escrever a estratégia: `operar_trafego_ia` (dono e gestor).
 * - Parar tudo do Claude: `parar_tudo` (só o dono).
 */

import { pode } from '@csp-mkt/shared';
import { useSessao } from '../../lib/auth';

export interface PermissoesDoTrafego {
  /** `profiles.id` de quem está usando, para o diário ("por quem"). */
  perfilId: string;
  podeAprovar: boolean;
  podeOperar: boolean;
  podeParar: boolean;
  podeMudarLimite: boolean;
}

export function usePermissoesDoTrafego(): PermissoesDoTrafego {
  const { perfil } = useSessao();
  const role = perfil?.role;
  return {
    perfilId: perfil?.id ?? '',
    podeAprovar: pode(role, 'aprovar_acao'),
    podeOperar: pode(role, 'operar_trafego_ia'),
    podeParar: pode(role, 'parar_tudo'),
    podeMudarLimite: pode(role, 'aprovar_acao'),
  };
}

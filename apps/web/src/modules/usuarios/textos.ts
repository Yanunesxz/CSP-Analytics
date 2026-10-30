/**
 * Textos da tela Usuários que dependem de número: puros, com teste em `textos.test.ts`.
 */

import { plural } from '../../lib/format';

/** Quantas pessoas têm o papel. null = "Sem dados" (cadastro de acessos vazio), nunca 0. */
export function textoDaQuantidade(quantidade: number | null): string {
  if (quantidade === null) return 'Sem dados';
  if (quantidade === 0) return 'Ninguém ainda';
  return plural(quantidade, 'pessoa', 'pessoas');
}

/**
 * Textos da tela Instagram que dependem de um número já calculado pela consulta.
 * Só formatação: nenhuma conta aqui (a conta vive em data/queries/instagram.ts).
 */

import { numero, plural } from '../../lib/format';

/** Linha de baixo do KPI "Seguidores": "+312 no período", "-25 no período" ou "Sem variação no período". */
export function notaSeguidores(saldo: number | null | undefined): string | undefined {
  if (saldo === null || saldo === undefined || !Number.isFinite(saldo)) return undefined;
  if (saldo === 0) return 'Sem variação no período';
  return `${saldo > 0 ? '+' : '-'}${numero(Math.abs(saldo))} no período`;
}

/** Linha do perfil: "8 posts publicados no período"; null quando não há base de posts. */
export function textoPosts(quantidade: number | null | undefined): string | null {
  if (quantidade === null || quantidade === undefined || !Number.isFinite(quantidade)) return null;
  if (quantidade === 0) return 'Nenhum post publicado no período';
  return `${plural(quantidade, 'post publicado', 'posts publicados')} no período`;
}

/** Detalhe do engajamento de um post, para a dica da célula. */
export function detalheEngajamento(curtidas: number, comentarios: number, salvos: number): string {
  return `${plural(curtidas, 'curtida', 'curtidas')}, ${plural(comentarios, 'comentário', 'comentários')} e ${plural(salvos, 'salvo', 'salvos')}`;
}

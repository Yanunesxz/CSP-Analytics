import { describe, expect, it } from 'vitest';
import { detalheEngajamento, notaSeguidores, textoPosts } from './textos';

describe('textos da tela Instagram', () => {
  it('saldo de seguidores com sinal, sem inventar número', () => {
    expect(notaSeguidores(312)).toBe('+312 no período');
    expect(notaSeguidores(1234)).toBe('+1.234 no período');
    expect(notaSeguidores(-25)).toBe('-25 no período');
    expect(notaSeguidores(0)).toBe('Sem variação no período');
    expect(notaSeguidores(null)).toBeUndefined();
    expect(notaSeguidores(Number.NaN)).toBeUndefined();
  });

  it('posts publicados no período', () => {
    expect(textoPosts(8)).toBe('8 posts publicados no período');
    expect(textoPosts(1)).toBe('1 post publicado no período');
    expect(textoPosts(0)).toBe('Nenhum post publicado no período');
    expect(textoPosts(null)).toBeNull();
  });

  it('detalhe do engajamento de um post', () => {
    expect(detalheEngajamento(380, 20, 1)).toBe('380 curtidas, 20 comentários e 1 salvo');
    expect(detalheEngajamento(1, 1, 0)).toBe('1 curtida, 1 comentário e 0 salvos');
  });
});

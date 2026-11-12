/**
 * O menu, as rotas do App e a lista do Diagnóstico seguem a mesma lista (ROTAS), e o item que some do
 * menu pede a mesma ação que a rota (ROTAS_PROTEGIDAS, decisão 0011).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROTAS_PROTEGIDAS } from '@csp-mkt/shared';
import { GRUPOS_DO_MENU } from './components/layout/Sidebar';
import { ROTAS } from './rotas';

const itensDoMenu = GRUPOS_DO_MENU.flatMap((g) => g.itens);

/** `path="..."` de cada <Route> do App.tsx, com `:parametro` virando um segmento qualquer. */
function rotasDoApp(): RegExp[] {
  const fonte = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
  return [...fonte.matchAll(/path="([^"]+)"/g)]
    .map((m) => m[1]!)
    .filter((p) => p !== '*')
    .map((p) => new RegExp(`^${p.replace(/:[^/]+/g, '[^/]+')}$`));
}

describe('rotas do sistema', () => {
  it('o menu tem exatamente as rotas de ROTAS, na mesma ordem', () => {
    expect(itensDoMenu.map((i) => i.para)).toEqual([...ROTAS]);
  });

  it('toda rota do menu existe no App.tsx', () => {
    const padroes = rotasDoApp();
    const semRota = ROTAS.filter((rota) => !padroes.some((p) => p.test(rota)));
    expect(semRota).toEqual([]);
  });

  it('o item do menu e a rota pedem a mesma ação do papel', () => {
    for (const item of itensDoMenu) {
      const base = `/${item.para.split('/')[1] ?? ''}`;
      expect(ROTAS_PROTEGIDAS[base], item.para).toBe(item.acao);
    }
    // A chave é a rota do App (/canais vale para /canais/meta, /canais/tiktok e /canais/google)
    const doMenu = new Set(itensDoMenu.map((i) => `/${i.para.split('/')[1] ?? ''}`));
    expect(Object.keys(ROTAS_PROTEGIDAS).filter((rota) => !doMenu.has(rota))).toEqual([]);
  });
});

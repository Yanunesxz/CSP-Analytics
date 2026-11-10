/**
 * Fumaça da tela Configurações, sem navegador: desenha a tela no servidor (react-dom/server) no modo
 * demonstração e confere que o usuário da demonstração não tem e-mail inventado: "Avisos" e "Sua conta"
 * mostram "A cadastrar" (seção 9 do padrão: nunca inventar dado).
 */

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { PaginaProvider } from '../../components/layout/pagina';
import { ToastProvider } from '../../components/ui';
import Configuracoes from './index';

function desenhar(): string {
  return renderToString(
    createElement(
      MemoryRouter,
      { initialEntries: ['/configuracoes'] },
      createElement(ToastProvider, null, createElement(PaginaProvider, null, createElement(Configuracoes))),
    ),
  );
}

describe('tela Configurações no modo demonstração', () => {
  const html = desenhar();

  it('o e-mail do usuário da demonstração aparece como "A cadastrar", em Avisos e em Sua conta', () => {
    const emails = [...html.matchAll(/<dt>E-mail<\/dt>(<dd[^>]*>[^<]*<\/dd>)/g)].map((m) => m[1]);
    expect(emails).toEqual([
      '<dd class="yn-muted">A cadastrar</dd>',
      '<dd class="yn-muted">A cadastrar</dd>',
    ]);
    expect(html).not.toContain('@example.com');
  });
});

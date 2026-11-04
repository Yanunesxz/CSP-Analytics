/**
 * Fumaça da casca, sem navegador: desenha o Shell no servidor (react-dom/server) e confere o que a
 * decisão 0039 pede de sistema de cliente: "CSP MKT" no menu e o crédito "Criado por Yan Nunes" no
 * fim da coluna principal.
 */

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Shell } from './Shell';

function desenhar(): string {
  const html = renderToString(
    createElement(
      MemoryRouter,
      { initialEntries: ['/'] },
      createElement(
        Routes,
        null,
        createElement(
          Route,
          { element: createElement(Shell) },
          createElement(Route, { path: '/', element: createElement('p', null, 'Tela de teste') }),
        ),
      ),
    ),
  );
  // O React separa textos vizinhos com <!-- -->; para comparar o texto, sai.
  return html.replace(/<!-- -->/g, '');
}

describe('Casca', () => {
  const html = desenhar();

  it('mostra "CSP MKT" no menu, sem a assinatura Yan Nunes', () => {
    const marca = html.match(/<div class="yn-sidebar__brand" title="CSP MKT">(.*?)<\/div>/)?.[1];
    expect(marca).toBe('<span>CSP</span><span class="yn-sidebar__product">MKT</span>');
  });

  it('leva o crédito "Criado por Yan Nunes" no fim da coluna principal, logo depois do conteúdo', () => {
    // O rodapé vem logo depois do <main> e fecha o .yn-main e o .yn-shell, com ou sem login na tela.
    expect(html).toMatch(
      /<\/main><footer class="yn-credit">Criado por <a href="https:\/\/github\.com\/Yanunesxz" rel="noopener" target="_blank">Yan Nunes<\/a><\/footer><\/div><\/div>/,
    );
  });
});

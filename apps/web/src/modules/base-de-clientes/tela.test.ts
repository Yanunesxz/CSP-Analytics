/**
 * Fumaça da Base de clientes, sem navegador: desenha a tela no servidor (react-dom/server) e confere o
 * caminho da tarefa T5 (cada contagem de clientes abre a lista já filtrada, com o representante) e os
 * estados em que o indicador não vira link (sem base para filtrar).
 */

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaginaProvider } from '../../components/layout/pagina';
import { DADOS_VAZIOS } from '../../data/dados';
import { gerarDadosDeExemplo } from '../../data/sample';
import { store } from '../../data/store';
import BaseDeClientes from './index';
import { linkDaLista } from './recorte';

function desenhar(caminho: string): string {
  return renderToString(
    createElement(
      MemoryRouter,
      { initialEntries: [caminho] },
      createElement(PaginaProvider, null, createElement(BaseDeClientes)),
    ),
  );
}

/** O href do indicador com este título ("Ver inativos"). */
function hrefDe(html: string, titulo: string): string | null {
  const tag = html.match(new RegExp(`<a[^>]*title="${titulo}"[^>]*>`))?.[0];
  return tag?.match(/href="([^"]*)"/)?.[1]?.replace(/&amp;/g, '&') ?? null;
}

describe('linkDaLista', () => {
  it('leva o filtro rápido na URL e a âncora da lista', () => {
    expect(linkDaLista('inativos')).toBe('/base?recorte=inativos#lista-de-clientes');
    expect(linkDaLista(null)).toBe('/base#lista-de-clientes');
  });
});

describe('Base de clientes com os dados de exemplo', () => {
  beforeAll(() => store.alterar(() => gerarDadosDeExemplo()));
  afterAll(() => store.alterar(() => ({ ...DADOS_VAZIOS })));

  it('T5: Inativos, Perdidos e Reativados abrem a lista já filtrada, com marca e representante', () => {
    const html = desenhar('/base?marca=cs&representante=REP-03');
    expect(hrefDe(html, 'Ver inativos')).toBe(
      '/base?marca=cs&representante=REP-03&recorte=inativos#lista-de-clientes',
    );
    expect(hrefDe(html, 'Ver perdidos')).toBe(
      '/base?marca=cs&representante=REP-03&recorte=perdidos#lista-de-clientes',
    );
    expect(hrefDe(html, 'Ver reativados')).toBe(
      '/base?marca=cs&representante=REP-03&recorte=reativados#lista-de-clientes',
    );
    expect(hrefDe(html, 'Ver clientes na base')).toBe(
      '/base?marca=cs&representante=REP-03#lista-de-clientes',
    );
    expect(html).toContain('id="lista-de-clientes"');
  });

  it('o filtro rápido da URL marca o chip da lista', () => {
    const html = desenhar('/base?recorte=inativos#lista-de-clientes');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Inativos/);
  });

  it('sem dados, os indicadores não viram link: não há lista para filtrar', () => {
    const html = desenhar('/base?estado=sem-dados');
    expect(hrefDe(html, 'Ver inativos')).toBeNull();
    expect(hrefDe(html, 'Ver reativados')).toBeNull();
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
  });
});

/**
 * Fumaça da Visão geral, sem navegador: desenha a tela no servidor (react-dom/server) e confere o caminho
 * da tarefa T1 (o indicador de custo abre a Chegada de clientes já no custo por marca e canal), a ordem
 * dos blocos nas duas visões e que, sem comparação, nenhum texto fala do período anterior.
 */

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaginaProvider } from '../../components/layout/pagina';
import { DADOS_VAZIOS } from '../../data/dados';
import { gerarDadosDeExemplo } from '../../data/sample';
import { store } from '../../data/store';
import VisaoGeral from './index';

function desenhar(caminho: string): string {
  return renderToString(
    createElement(
      MemoryRouter,
      { initialEntries: [caminho] },
      createElement(PaginaProvider, null, createElement(VisaoGeral)),
    ),
  );
}

/** O href do link que tem este título (o `title` do indicador ou do nome na tabela). */
function hrefDe(html: string, titulo: string): string | null {
  const tag = html.match(new RegExp(`<a[^>]*title="${titulo}"[^>]*>`))?.[0];
  return tag?.match(/href="([^"]*)"/)?.[1]?.replace(/&amp;/g, '&') ?? null;
}

/** O href do link com este texto. */
function hrefDoTexto(html: string, texto: string): string | null {
  return html.match(new RegExp(`<a[^>]*href="([^"]*)"[^>]*>${texto}`))?.[1]?.replace(/&amp;/g, '&') ?? null;
}

describe('Visão geral com os dados de exemplo', () => {
  beforeAll(() => store.alterar(() => gerarDadosDeExemplo()));
  afterAll(() => store.alterar(() => ({ ...DADOS_VAZIOS })));

  it('T1: o indicador de custo abre a Chegada de clientes no custo por marca e canal, com a marca', () => {
    const html = desenhar('/?marca=cs&periodo=30d');
    expect(hrefDe(html, 'Ver custo por cliente novo')).toBe(
      '/chegada?marca=cs&periodo=30d#custo-por-cliente-novo',
    );
  });

  it('T1: a marca da tabela "Por marca" abre o custo dela por canal', () => {
    const html = desenhar('/');
    expect(hrefDe(html, 'Ver o custo de Plumene por canal')).toBe(
      '/chegada?marca=plumene#custo-por-cliente-novo',
    );
  });

  it('o custo por marca e por canal vem logo depois dos números, antes dos blocos do gestor', () => {
    const html = desenhar('/?visao=gestor');
    const custo = html.indexOf('id="visao-geral-custo"');
    expect(custo).toBeGreaterThan(html.indexOf('id="visao-geral-numeros"'));
    expect(custo).toBeLessThan(html.indexOf('id="visao-geral-operador"'));
    expect(custo).toBeLessThan(html.indexOf('id="visao-geral-verba"'));
    // O próximo passo de "Perto do limite": onde o limite muda
    expect(hrefDoTexto(html, 'Ver limites em Tráfego com IA')).toBe('/trafego?visao=gestor&aba=limites');
  });

  it('com a comparação desligada, nenhum texto fala do período anterior', () => {
    const html = desenhar('/?comparar=false');
    expect(html).toContain('Custo por cliente novo');
    expect(html).not.toContain('mês anterior');
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
  });
});

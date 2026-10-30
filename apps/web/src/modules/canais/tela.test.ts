/**
 * Fumaça da tela de canal, sem navegador: desenha a tela no servidor (react-dom/server) e confere para
 * onde os indicadores levam (o custo por cliente novo abre a Chegada de clientes já no custo por marca e
 * canal, filtrada no canal) e que, sem comparação, nenhum texto fala do período anterior.
 */

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaginaProvider } from '../../components/layout/pagina';
import { ToastProvider } from '../../components/ui';
import { DADOS_VAZIOS } from '../../data/dados';
import { gerarDadosDeExemplo } from '../../data/sample';
import { store } from '../../data/store';
import { TelaDoCanal } from './TelaDoCanal';

function desenhar(caminho: string): string {
  return renderToString(
    createElement(
      MemoryRouter,
      { initialEntries: [caminho] },
      createElement(
        PaginaProvider,
        null,
        createElement(ToastProvider, null, createElement(TelaDoCanal, { plataforma: 'meta' })),
      ),
    ),
  );
}

/** O href do indicador com este título ("Ver custo por cliente novo"). */
function hrefDe(html: string, titulo: string): string | null {
  const tag = html.match(new RegExp(`<a[^>]*title="${titulo}"[^>]*>`))?.[0];
  return tag?.match(/href="([^"]*)"/)?.[1]?.replace(/&amp;/g, '&') ?? null;
}

describe('tela de canal com os dados de exemplo', () => {
  beforeAll(() => store.alterar(() => gerarDadosDeExemplo()));
  afterAll(() => store.alterar(() => ({ ...DADOS_VAZIOS })));

  it('os indicadores levam à tela que trabalha o número, já no canal', () => {
    const html = desenhar('/canais/meta?marca=plumene');
    expect(hrefDe(html, 'Ver custo por cliente novo')).toBe(
      '/chegada?marca=plumene&canal=meta#custo-por-cliente-novo',
    );
    expect(hrefDe(html, 'Ver clientes novos')).toBe('/chegada?marca=plumene&canal=meta');
    expect(hrefDe(html, 'Ver leads')).toBe('/leads?marca=plumene&origem=meta');
  });

  it('com a comparação desligada, os indicadores não falam do período anterior', () => {
    const html = desenhar('/canais/meta?comparar=false');
    expect(html).toContain('Custo por lead (CPL)');
    expect(html).not.toContain('mês anterior');
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
  });
});

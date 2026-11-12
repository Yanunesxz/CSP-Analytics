/**
 * Fumaça do Resumo simples, sem navegador: desenha a tela no servidor (react-dom/server) e confere a ordem
 * dos blocos, que os números são os mesmos da tarefa T1, os destinos dos links e os estados.
 */

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaginaProvider } from '../../components/layout/pagina';
import { ToastProvider } from '../../components/ui';
import { DADOS_VAZIOS } from '../../data/dados';
import { custoPorClienteNovo } from '../../data/queries';
import { gerarDadosDeExemplo } from '../../data/sample';
import { store } from '../../data/store';
import { lerFiltros } from '../../lib/url-state';
import ResumoSimples from './index';
import { reais } from './textos';

function desenhar(caminho: string): string {
  return renderToString(
    createElement(
      MemoryRouter,
      { initialEntries: [caminho] },
      createElement(ToastProvider, null, createElement(PaginaProvider, null, createElement(ResumoSimples))),
    ),
  );
}

/** O href do link que tem este título. */
function hrefDe(html: string, titulo: string): string | null {
  const tag = html.match(new RegExp(`<a[^>]*title="${titulo}"[^>]*>`))?.[0];
  return tag?.match(/href="([^"]*)"/)?.[1]?.replace(/&amp;/g, '&') ?? null;
}

describe('Resumo simples com os dados de exemplo', () => {
  beforeAll(() => store.alterar(() => gerarDadosDeExemplo()));
  afterAll(() => store.alterar(() => ({ ...DADOS_VAZIOS })));

  it('os blocos vêm na ordem: frases, números, onde foi gasto, canais, campanhas e palavras', () => {
    const html = desenhar('/resumo?marca=todas');
    const ordem = [
      'id="resumo-frases"',
      'id="resumo-numeros"',
      'Onde o dinheiro foi gasto',
      'id="resumo-canais"',
      'id="resumo-campanhas"',
      'id="resumo-palavras"',
    ].map((trecho) => html.indexOf(trecho));
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('o gasto e o custo por cliente novo são os da tarefa T1, em reais inteiros', () => {
    const html = desenhar('/resumo?marca=cs&periodo=30d');
    const filtros = lerFiltros(new URLSearchParams('marca=cs&periodo=30d'));
    const t1 = custoPorClienteNovo(store.getSnapshot(), filtros).total;
    expect(html).toContain(`<strong class="font-bold">${reais(t1.investimento.atual)}</strong>`);
    expect(html).toContain(reais(t1.custo.atual));
    expect(html).toContain('em anúncios na marca Corpo Sensual.');
  });

  it('a marca leva ao resumo só dela, o canal à tela do canal e a campanha à tela do canal já nela', () => {
    const html = desenhar('/resumo?marca=todas&periodo=30d');
    expect(hrefDe(html, 'Ver o resumo só de Plumene')).toBe('/resumo?marca=plumene&periodo=30d');
    expect(hrefDe(html, 'Ver Meta Ads')).toBe('/canais/meta?marca=todas&periodo=30d');
    expect(hrefDe(html, 'Ver a campanha em Google Ads')).toMatch(
      /^\/canais\/google\?marca=todas&periodo=30d&campanha=cmp-google-\d+$/,
    );
  });

  it('com uma marca só, some o que teria uma linha: o gráfico e a tabela por marca', () => {
    const html = desenhar('/resumo?marca=plumene');
    expect(html).toContain('Onde o dinheiro foi gasto');
    expect(html).not.toContain('Quanto foi para cada marca');
    expect(html).not.toContain('O que cada marca trouxe');
  });

  it('com a comparação desligada, nenhum texto fala do período de comparação', () => {
    const html = desenhar('/resumo?marca=todas&comparar=false');
    expect(html).toContain('Em poucas palavras');
    expect(html).not.toContain('período de comparação');
    expect(html).not.toMatch(/a mais<|a menos</);
  });

  it('com muitas campanhas, as menores ficam em "Ver as outras campanhas"', () => {
    const html = desenhar('/resumo?marca=todas&periodo=90d');
    expect(html).toMatch(/Ver as outras \d+ campanhas/);
  });
});

describe('Resumo simples nos estados', () => {
  beforeAll(() => store.alterar(() => gerarDadosDeExemplo()));
  afterAll(() => store.alterar(() => ({ ...DADOS_VAZIOS })));

  it('sem dados: os quatro números dizem "Sem dados" e nada vira zero', () => {
    const html = desenhar('/resumo?estado=sem-dados');
    expect(html).toContain('Os números de anúncio deste período ainda não chegaram.');
    expect(html.match(/yn-kpi__value--empty/g)).toHaveLength(4);
    expect(html).toContain('As campanhas aparecem quando os conectores trouxerem os números.');
    expect(html).not.toMatch(/R\$\s?0|NaN/);
    // Sem número para comparar, a nota da comparação não aparece
    expect(html).not.toContain('período de comparação');
  });

  it('vazio, erro e carregando têm tela própria', () => {
    expect(desenhar('/resumo?estado=vazio')).toContain('Nenhum número ainda');
    expect(desenhar('/resumo?estado=erro')).toContain('Não deu para carregar');
    expect(desenhar('/resumo?estado=carregando')).not.toContain('Em poucas palavras');
  });
});

describe('Resumo simples sem nenhum dado no sistema', () => {
  it('abre no estado vazio, com o próximo passo', () => {
    store.alterar(() => ({ ...DADOS_VAZIOS }));
    const html = desenhar('/resumo');
    expect(html).toContain('Nenhum número ainda');
    expect(html).toContain('Ver conectores');
  });
});

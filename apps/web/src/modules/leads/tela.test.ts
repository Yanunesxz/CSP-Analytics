/**
 * Fumaça da tela de Leads, sem navegador: desenha a tela no servidor (react-dom/server) em cada estado
 * de `?estado=`, nas duas visões e com a etapa, e confere o que aparece (e o que nunca aparece).
 */

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaginaProvider } from '../../components/layout/pagina';
import { DADOS_VAZIOS } from '../../data/dados';
import { gerarDadosDeExemplo } from '../../data/sample';
import { store } from '../../data/store';
import Leads from './index';

function desenhar(caminho: string): string {
  return renderToString(
    createElement(
      MemoryRouter,
      { initialEntries: [caminho] },
      createElement(PaginaProvider, null, createElement(Leads)),
    ),
  );
}

const quantas = (html: string, trecho: string) => html.split(trecho).length - 1;

describe('tela de Leads com os dados de exemplo', () => {
  beforeAll(() => store.alterar(() => gerarDadosDeExemplo()));
  afterAll(() => store.alterar(() => ({ ...DADOS_VAZIOS })));

  it('visão Visualizador: indicadores, gráficos com "Ver como tabela", campanhas e lista', () => {
    const html = desenhar('/leads');
    for (const trecho of [
      'Lead → cliente novo',
      'Custo por lead',
      'Sem marca · WhatsApp',
      'Leads por dia',
      'Leads por origem',
      'Leads por marca',
      'Leads por campanha',
      'Lista de leads',
      'Abrir ficha',
      'Comparar com o anterior',
    ])
      expect(html).toContain(trecho);
    expect(quantas(html, 'Ver como tabela')).toBe(3);
    expect(html).toMatch(/LEAD-\d{4}/);
    expect(html).not.toContain('Humano × Claude');
    expect(html).not.toContain('<h1');
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('visão Gestor de tráfego: acrescenta Humano × Claude, operador e investimento', () => {
    const html = desenhar('/leads?visao=gestor');
    expect(html).toContain('Humano × Claude');
    expect(html).toContain('Operador');
    expect(html).toContain('Investimento');
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('etapa na URL filtra a lista e marca o chip', () => {
    const html = desenhar('/leads?etapa=prospect');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Prospecto/);
    expect(html).toContain('Ver todas as etapas');
    expect(html).not.toContain('data-tone="success">Faturado</span>');
    expect(html).not.toContain('<span class="yn-badge">Lead</span>');
  });

  it('"Lead → cliente novo" abre a Chegada de clientes com o mesmo recorte; sem comparação, nada de "mês anterior"', () => {
    const html = desenhar('/leads?periodo=7d&origem=google&comparar=false');
    const tag = html.match(/<a[^>]*title="Ver lead → cliente novo"[^>]*>/)?.[0] ?? '';
    expect(tag.match(/href="([^"]*)"/)?.[1]?.replace(/&amp;/g, '&')).toBe(
      '/chegada?periodo=7d&comparar=false&origem=google',
    );
    expect(html).not.toContain('mês anterior');
  });

  it('a lista nunca mostra nome, telefone, e-mail ou documento', () => {
    const html = desenhar('/leads?periodo=90d');
    expect(html).not.toMatch(
      /@|\(\d{2}\)\s?\d{4,5}-\d{4}|\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/,
    );
  });

  it('carregando, erro, vazio e sem dados', () => {
    expect(desenhar('/leads?estado=carregando')).toContain('aria-busy="true"');

    const erro = desenhar('/leads?estado=erro');
    expect(erro).toContain('Não deu para carregar');
    expect(erro).toContain('Tentar de novo');
    expect(erro).toContain('DEMO-500');

    const vazio = desenhar('/leads?estado=vazio');
    expect(vazio).toContain('Nenhum lead ainda');
    expect(vazio).toContain('Ver conectores');

    const semDados = desenhar('/leads?estado=sem-dados');
    expect(quantas(semDados, 'yn-kpi__value--empty')).toBe(4);
    expect(semDados).toContain('Sem dados');
    expect(semDados).not.toMatch(/NaN|undefined|Infinity/);
  });
});

describe('tela de Leads sem dados de exemplo', () => {
  it('abre vazia, com o próximo passo', () => {
    const html = desenhar('/leads');
    expect(html).toContain('Nenhum lead ainda');
    expect(html).toContain('Ver conectores');
  });
});

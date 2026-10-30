/**
 * Fumaça da tela Conectores, sem navegador: desenha a tela no servidor (react-dom/server) em cada estado de
 * `?estado=`, nas duas visões, com marca, com um conector caído e depois de "Tentar de novo", e confere o
 * que aparece (e o que nunca aparece).
 */

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaginaProvider } from '../../components/layout/pagina';
import { ToastProvider } from '../../components/ui';
import { tentarConectorDeNovo } from '../../data/actions';
import { DADOS_VAZIOS } from '../../data/dados';
import { gerarDadosDeExemplo } from '../../data/sample';
import { store } from '../../data/store';
import Conectores from './index';

function desenhar(caminho: string): string {
  return renderToString(
    createElement(
      MemoryRouter,
      { initialEntries: [caminho] },
      createElement(ToastProvider, null, createElement(PaginaProvider, null, createElement(Conectores))),
    ),
  );
}

const quantas = (html: string, trecho: string) => html.split(trecho).length - 1;
const NOMES = ['CSP 360', 'Meta Ads', 'TikTok Ads', 'Google Ads', 'Instagram', 'Search Console', 'GA4'];

describe('tela Conectores com os dados de exemplo', () => {
  beforeAll(() => store.alterar(() => gerarDadosDeExemplo()));
  afterAll(() => store.alterar(() => ({ ...DADOS_VAZIOS })));

  it('um cartão por integração, com o atrasado primeiro e o único botão principal nele', () => {
    const html = desenhar('/conectores');

    for (const nome of NOMES) expect(html).toContain(`>${nome}</h2>`);
    expect(quantas(html, '<h2')).toBe(NOMES.length);
    expect(html).not.toContain('<h1');
    expect(html.indexOf('>TikTok Ads</h2>')).toBeLessThan(html.indexOf('>CSP 360</h2>'));
    expect(html.indexOf('>GA4</h2>')).toBeGreaterThan(html.indexOf('>Search Console</h2>'));

    expect(html).toContain('TikTok Ads está atrasado');
    expect(html).toContain('data-tone="warning">Atrasado</span>');
    expect(quantas(html, 'data-tone="success">Funcionando</span>')).toBe(5);
    expect(html).toContain('<span class="yn-badge">Simulado · a ligar</span>');
    expect(quantas(html, 'yn-btn--primary')).toBe(1);
    expect(quantas(html, 'Tentar de novo<')).toBe(1);
    expect(html).toContain('<span class="yn-sr-only"> <!-- -->TikTok Ads</span>');
    expect(html).toContain('2 h 10 min');
    expect(html).toContain('atualizado há 3 h');
    expect(html).toContain('atualizado há 3 min');

    expect(html).toContain('O que falta para ligar');
    expect(html).toContain('<code>NEXT_PUBLIC_GA_ID</code>');
    expect(html).toContain('Ver pendências em Tráfego com IA');

    expect(html).toContain('Caminho dos pedidos');
    expect(html).toContain('ERP Control → apps de Representantes → CSP 360 → CSP-MKT');
    expect(html).toContain('Não existe conexão direta com os apps de Representantes nem com o ERP Control');
    expect(html).toContain('Última rodada apps → CSP 360');

    expect(html).not.toContain('Conectores não têm operador nem verba');
    expect(html).not.toContain('Cada conector traz as duas marcas');
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('visão Gestor de tráfego: os mesmos cartões e o aviso de onde ficam operador e verba', () => {
    const html = desenhar('/conectores?visao=gestor');
    expect(html).toContain('Conectores não têm operador nem verba');
    expect(html).toContain('Ver Tráfego com IA');
    expect(quantas(html, '<h2')).toBe(NOMES.length);
    expect(quantas(html, 'yn-btn--primary')).toBe(1);
  });

  it('com uma marca escolhida, avisa que os conectores trazem as duas', () => {
    const html = desenhar('/conectores?marca=plumene');
    expect(html).toContain('Cada conector traz as duas marcas');
    expect(quantas(html, '<h2')).toBe(NOMES.length);
  });

  it('carregando, erro, vazio e sem dados', () => {
    expect(desenhar('/conectores?estado=carregando')).toContain('aria-busy="true"');

    const erro = desenhar('/conectores?estado=erro');
    expect(erro).toContain('data-state="error"');
    expect(erro).toContain('Não deu para carregar os conectores');
    expect(erro).toContain('Tentar de novo');
    expect(erro).toContain('DEMO-500');
    expect(erro).not.toContain('veja os conectores');

    const vazio = desenhar('/conectores?estado=vazio');
    expect(vazio).toContain('Nenhum conector ainda');
    expect(vazio).not.toContain('Ver conectores');

    const semDados = desenhar('/conectores?estado=sem-dados');
    expect(quantas(semDados, '<h2')).toBe(NOMES.length);
    expect(quantas(semDados, '<span class="yn-badge">Sem dados</span>')).toBe(NOMES.length);
    expect(semDados).not.toContain('Tentar de novo');
    expect(semDados).not.toContain('yn-btn--primary');
    expect(semDados).not.toContain('Tudo funcionando');
    expect(semDados).not.toContain('Funcionando</span>');
    expect(semDados).not.toMatch(/>0</);
    expect(semDados).not.toMatch(/NaN|undefined|Infinity/);
  });
});

describe('tela Conectores com um conector caído', () => {
  beforeAll(() =>
    store.alterar(() => {
      const dados = gerarDadosDeExemplo();
      return {
        ...dados,
        connectors: dados.connectors.map((c) =>
          c.id === 'google_ads' ? { ...c, status: 'down' as const, errors24h: 12 } : c,
        ),
      };
    }),
  );
  afterAll(() => store.alterar(() => ({ ...DADOS_VAZIOS })));

  it('caído vem primeiro, em vermelho, com o botão principal; o atrasado fica secundário', () => {
    const html = desenhar('/conectores');
    expect(html).toContain('Google Ads parou de sincronizar');
    expect(html).toContain('TikTok Ads está atrasado.');
    expect(html).toContain('data-tone="danger">Caído</span>');
    expect(html.indexOf('>Google Ads</h2>')).toBeLessThan(html.indexOf('>TikTok Ads</h2>'));
    expect(quantas(html, 'yn-btn--primary')).toBe(1);
    expect(quantas(html, 'yn-btn yn-btn--secondary')).toBe(1);
    expect(html.indexOf('yn-btn--primary')).toBeLessThan(html.indexOf('>TikTok Ads</h2>'));
  });
});

describe('tela Conectores depois de "Tentar de novo"', () => {
  beforeAll(() => {
    store.alterar(() => gerarDadosDeExemplo());
    tentarConectorDeNovo('tiktok');
  });
  afterAll(() => store.alterar(() => ({ ...DADOS_VAZIOS })));

  it('tudo funcionando: sem botão, GA4 lembrado como a ligar', () => {
    const html = desenhar('/conectores');
    expect(html).toContain('Tudo funcionando');
    expect(html).toContain('Os conectores ligados estão em dia. GA4 ainda está a ligar.');
    expect(html).not.toContain('Tentar de novo');
    expect(html).not.toContain('yn-btn--primary');
    expect(quantas(html, 'data-tone="success">Funcionando</span>')).toBe(6);
  });
});

describe('tela Conectores sem dados de exemplo', () => {
  it('abre vazia, com o próximo passo', () => {
    store.alterar(() => ({ ...DADOS_VAZIOS }));
    const html = desenhar('/conectores');
    expect(html).toContain('Nenhum conector ainda');
    expect(html).toContain('Os cartões aparecem quando a primeira integração sincronizar.');
    // Nada de jargão técnico na tela do dono (seção 8 do padrão)
    expect(html).not.toContain('VITE_');
  });
});

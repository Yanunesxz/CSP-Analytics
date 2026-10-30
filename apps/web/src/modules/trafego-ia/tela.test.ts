/**
 * Fumaça da tela Tráfego com IA, sem navegador: desenha a tela no servidor (react-dom/server) nas duas
 * visões, em cada aba e em cada estado de `?estado=`, e confere o que aparece e o que nunca aparece.
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
import TrafegoIa from './index';

function desenhar(caminho: string): string {
  return renderToString(
    createElement(
      MemoryRouter,
      { initialEntries: [caminho] },
      createElement(PaginaProvider, null, createElement(ToastProvider, null, createElement(TrafegoIa))),
    ),
  );
}

const quantas = (html: string, trecho: string) => html.split(trecho).length - 1;
const SEM_LIXO = /NaN|undefined|Infinity|\[object Object\]/;

describe('Tráfego com IA com os dados de exemplo', () => {
  beforeAll(() => store.alterar(() => gerarDadosDeExemplo()));
  afterAll(() => store.alterar(() => ({ ...DADOS_VAZIOS })));

  it('visão Visualizador: só o aviso e o botão para trocar a visão', () => {
    const html = desenhar('/trafego');
    expect(html).toContain('Esta tela é da visão Gestor de tráfego');
    expect(html).toContain('Ver como gestor de tráfego');
    expect(html).not.toContain('Fila de aprovação');
    expect(html).not.toContain('Parar tudo do Claude');
  });

  it('visão Gestor, aba Fila e ações: Claude agora, indicadores, fila e lista', () => {
    const html = desenhar('/trafego?visao=gestor');
    for (const trecho of [
      'O Claude agora',
      'Parar tudo do Claude',
      'role="tablist"',
      'Esperando sua decisão',
      'Feitas no período',
      'Fila de aprovação',
      'yn-decision',
      'Descartar',
      'Aprovar',
      'O que podemos fazer',
      'Registrar ideia',
      'Filtrar a lista',
      'Em execução',
      'GA4 sem ID no site',
      'Comparar com o anterior',
    ])
      expect(html).toContain(trecho);
    // Um botão principal por tela (o Aprovar da fila) e nenhum h1 (fica na barra do topo)
    expect(quantas(html, 'yn-btn--primary')).toBe(1);
    expect(html).not.toContain('<h1');
    expect(html).not.toMatch(SEM_LIXO);
  });

  it('T4: a fila de aprovação abre a aba, antes das pendências, dos indicadores e da lista', () => {
    const html = desenhar('/trafego?visao=gestor');
    const fila = html.indexOf('id="trafego-fila"');
    expect(fila).toBeGreaterThan(html.indexOf('role="tablist"'));
    expect(fila).toBeLessThan(html.search(/pendências? travam? a medição/));
    expect(fila).toBeLessThan(html.indexOf('Esperando sua decisão'));
    expect(fila).toBeLessThan(html.indexOf('O que podemos fazer'));
  });

  it('com a comparação desligada, os indicadores não falam do período anterior', () => {
    const html = desenhar('/trafego?visao=gestor&comparar=false');
    expect(html).toContain('Feitas no período');
    expect(html).not.toContain('mês anterior');
  });

  it('a proposta da URL abre na fila', () => {
    const dados = store.getSnapshot();
    const ideia = dados.actions.find((a) => a.status === 'idea' && a.kind !== 'pending_fix');
    expect(ideia).toBeDefined();
    const html = desenhar(`/trafego?visao=gestor&proposta=${ideia!.id}`);
    const cartao = html.slice(html.indexOf('yn-decision'), html.indexOf('O que podemos fazer'));
    expect(cartao).toContain(ideia!.title.replace(/&/g, '&amp;'));
  });

  it('status na URL filtra a lista e marca o chip', () => {
    const html = desenhar('/trafego?visao=gestor&status=done');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Feita/);
    expect(html).toContain('Limpar filtros da lista');
  });

  it('as outras abas', () => {
    const estrategia = desenhar('/trafego?visao=gestor&aba=estrategia');
    expect(estrategia).toContain('Estratégia por marca');
    expect(estrategia).toContain('Escrever estratégia');
    expect(estrategia).toContain('Meta a definir');
    expect(estrategia).not.toContain('Fila de aprovação');

    const limites = desenhar('/trafego?visao=gestor&aba=limites');
    expect(limites).toContain('Limites de gasto por conta');
    expect(limites).toContain('Mudar limite');
    expect(limites).toContain('role="meter"');

    const operadores = desenhar('/trafego?visao=gestor&aba=operadores');
    expect(operadores).toContain('Humano × Claude');
    expect(operadores).toContain('Custo por lead por canal');
    expect(operadores).toContain('Ver como tabela');

    const diario = desenhar('/trafego?visao=gestor&aba=diario&periodo=90d');
    expect(diario).toContain('Diário de ações');
    expect(diario).toContain('yn-timeline__item');
    expect(diario).toContain('Mostrar mais');

    for (const html of [estrategia, limites, operadores, diario]) expect(html).not.toMatch(SEM_LIXO);
  });

  it('nunca mostra e-mail, telefone ou documento', () => {
    for (const aba of ['fila', 'estrategia', 'limites', 'operadores', 'diario'])
      expect(desenhar(`/trafego?visao=gestor&periodo=90d&aba=${aba}`)).not.toMatch(
        /[\w.+-]+@[\w-]+\.[\w.]+|\(\d{2}\)\s?\d{4,5}-\d{4}|\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/,
      );
  });

  it('carregando, erro, vazio e sem dados', () => {
    expect(desenhar('/trafego?visao=gestor&estado=carregando')).toContain('aria-busy="true"');

    const erro = desenhar('/trafego?visao=gestor&estado=erro');
    expect(erro).toContain('Não deu para carregar');
    expect(erro).toContain('Tentar de novo');
    expect(erro).toContain('DEMO-500');

    const vazio = desenhar('/trafego?visao=gestor&estado=vazio');
    expect(vazio).toContain('Nada para operar ainda');
    expect(vazio).toContain('Ver conectores');

    const semDados = desenhar('/trafego?visao=gestor&estado=sem-dados');
    expect(quantas(semDados, 'yn-kpi__value--empty')).toBe(4);
    expect(semDados).toContain('Sem dados das campanhas do Claude.');
    expect(semDados).toContain('A fila aparece quando');
    expect(semDados).not.toMatch(SEM_LIXO);
    for (const aba of ['estrategia', 'limites', 'operadores', 'diario'])
      expect(desenhar(`/trafego?visao=gestor&estado=sem-dados&aba=${aba}`)).not.toMatch(SEM_LIXO);
  });
});

describe('Tráfego com IA sem dados de exemplo', () => {
  it('abre vazia, com o próximo passo', () => {
    const html = desenhar('/trafego?visao=gestor');
    expect(html).toContain('Nada para operar ainda');
    expect(html).toContain('Ver conectores');
  });
});

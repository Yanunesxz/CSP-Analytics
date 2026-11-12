/**
 * O app instalável: a regra do que oferecer em cada aparelho e o manifesto que o navegador confere antes de
 * oferecer "Instalar app" (o tamanho declarado de cada ícone tem de ser o tamanho real do arquivo).
 */

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROTAS } from '../rotas';
import { estadoPara, type Aparelho } from './app-instalavel';

const publico = (caminho: string) => new URL(`../../public${caminho}`, import.meta.url);

const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_COMO_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

const aparelho = (a: Partial<Aparelho>): Aparelho => ({
  rodandoComoApp: false,
  temConvite: false,
  userAgent: CHROME_ANDROID,
  maxTouchPoints: 5,
  ...a,
});

/** Largura e altura de um PNG, lidas do cabeçalho (IHDR). */
function tamanhoDoPng(arquivo: URL): string {
  const bytes = readFileSync(arquivo);
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

describe('o que oferecer em cada aparelho', () => {
  it('aberto pelo ícone: já instalado, mesmo com convite', () => {
    expect(estadoPara(aparelho({ rodandoComoApp: true, temConvite: true }))).toBe('instalado');
  });

  it('com o convite do navegador: um toque instala', () => {
    expect(estadoPara(aparelho({ temConvite: true }))).toBe('pronto');
  });

  it('iPhone e iPad (que se apresenta como Mac, mas tem toque): só pelo Compartilhar do Safari', () => {
    expect(estadoPara(aparelho({ userAgent: IPHONE }))).toBe('manual-apple');
    expect(estadoPara(aparelho({ userAgent: IPAD_COMO_MAC, maxTouchPoints: 5 }))).toBe('manual-apple');
  });

  it('Mac de verdade e navegador sem convite: o caminho pelo menu', () => {
    expect(estadoPara(aparelho({ userAgent: IPAD_COMO_MAC, maxTouchPoints: 0 }))).toBe('manual');
    expect(estadoPara(aparelho({}))).toBe('manual');
  });
});

describe('manifesto do app', () => {
  const manifesto = JSON.parse(readFileSync(publico('/manifest.webmanifest'), 'utf8')) as {
    name: string;
    short_name: string;
    start_url: string;
    scope: string;
    display: string;
    lang: string;
    icons: { src: string; sizes: string; type: string; purpose: string }[];
    shortcuts: { url: string }[];
  };

  it('tem o que o navegador pede para oferecer a instalação', () => {
    expect(manifesto.name).toBe('CSP MKT');
    expect(manifesto.short_name.length).toBeLessThanOrEqual(12);
    expect(manifesto.display).toBe('standalone');
    expect(manifesto.lang).toBe('pt-BR');
    expect(manifesto.scope).toBe('/');
  });

  it('abre no Resumo simples, e o atalho leva à Visão geral: as duas são telas do sistema', () => {
    expect(manifesto.start_url).toBe('/resumo');
    for (const url of [manifesto.start_url, ...manifesto.shortcuts.map((s) => s.url)]) {
      expect(ROTAS).toContain(url);
    }
  });

  it('cada ícone existe e tem o tamanho que o manifesto declara', () => {
    const tamanhos = manifesto.icons.map((icone) => {
      expect(icone.type).toBe('image/png');
      expect(tamanhoDoPng(publico(icone.src))).toBe(icone.sizes);
      return `${icone.sizes} ${icone.purpose}`;
    });
    expect(tamanhos).toEqual(expect.arrayContaining(['192x192 any', '512x512 any', '512x512 maskable']));
  });

  it('o index.html aponta para o manifesto e para o ícone do iPhone, que existe com 180px', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icones/apple-touch-icon.png" />');
    expect(tamanhoDoPng(publico('/icones/apple-touch-icon.png'))).toBe('180x180');
    expect(tamanhoDoPng(publico('/icones/favicon-32.png'))).toBe('32x32');
  });

  it('o service worker existe e só atende a abertura de página, sem guardar nada', () => {
    expect(existsSync(publico('/sw.js'))).toBe(true);
    const sw = readFileSync(publico('/sw.js'), 'utf8');
    expect(sw).toContain("evento.request.mode !== 'navigate'");
    expect(sw).not.toMatch(/caches\.|cache\.put|CacheStorage/);
  });
});

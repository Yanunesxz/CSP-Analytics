/**
 * O CSP MKT como app no aparelho, como o app dos representantes: o navegador oferece "Instalar app" e o
 * sistema ganha um ícone na tela, que abre no Resumo simples (`start_url` de `public/manifest.webmanifest`).
 *
 * - `registrarServiceWorker`: liga o `public/sw.js`, que só existe para o navegador aceitar a instalação e
 *   mostrar uma página de "Sem internet". Só na build: no `pnpm dev` a porta 5173 é de vários projetos, e o
 *   service worker ficaria preso nela.
 * - `observarInstalacao`: o convite do navegador (`beforeinstallprompt`) chega uma vez, muitas vezes antes de
 *   o React montar. Por isso a escuta começa no `main.tsx` e o convite fica guardado aqui.
 */

import { useSyncExternalStore } from 'react';

interface EventoDeInstalacao extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * - `instalado`: aberto pelo ícone, como app; não há o que oferecer neste aparelho.
 * - `pronto`: o navegador liberou o convite; um toque instala (Chrome, Edge, Samsung Internet).
 * - `manual-apple`: iPhone e iPad. Nenhum navegador do iOS tem o convite: só o Compartilhar do Safari.
 * - `manual`: o navegador não ofereceu o convite (Firefox, ou o Chrome que já instalou o app neste perfil).
 *   O caminho pelo menu do navegador continua valendo.
 */
export type EstadoDaInstalacao = 'instalado' | 'pronto' | 'manual-apple' | 'manual';

export interface Aparelho {
  rodandoComoApp: boolean;
  temConvite: boolean;
  userAgent: string;
  maxTouchPoints: number;
}

/** iPhone e iPad. O iPad atual se apresenta como "Macintosh": o toque é o que separa do Mac. */
function ehApple(userAgent: string, maxTouchPoints: number): boolean {
  if (/iphone|ipod|ipad/i.test(userAgent)) return true;
  return /macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

/** Regra pura, com teste: o que oferecer neste aparelho. */
export function estadoPara(a: Aparelho): EstadoDaInstalacao {
  if (a.rodandoComoApp) return 'instalado';
  if (a.temConvite) return 'pronto';
  if (ehApple(a.userAgent, a.maxTouchPoints)) return 'manual-apple';
  return 'manual';
}

let convite: EventoDeInstalacao | null = null;
let instalouAgora = false;
const ouvintes = new Set<() => void>();

function avisar(): void {
  ouvintes.forEach((o) => o());
}

function rodandoComoApp(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari do iOS não tem display-mode: usa uma marca própria
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function estadoAgora(): EstadoDaInstalacao {
  if (typeof window === 'undefined') return 'manual';
  return estadoPara({
    rodandoComoApp: instalouAgora || rodandoComoApp(),
    temConvite: convite !== null,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  });
}

/** Chamado uma vez, no `main.tsx`, antes de o React montar. */
export function observarInstalacao(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (evento) => {
    // Sem isso o Chrome mostra a barra dele por cima da tela; o convite fica no cartão do Resumo simples
    evento.preventDefault();
    convite = evento as EventoDeInstalacao;
    avisar();
  });
  window.addEventListener('appinstalled', () => {
    convite = null;
    instalouAgora = true;
    avisar();
  });
}

/** Chamado uma vez, no `main.tsx`. Falhar aqui só tira a instalação: o sistema segue igual. */
export function registrarServiceWorker(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

/**
 * Abre o convite do navegador e diz se a pessoa aceitou. O convite vale uma vez: depois de usado, sai
 * daqui, aceito ou não (guardá-lo faria o segundo toque não abrir nada).
 */
export async function pedirInstalacao(): Promise<boolean> {
  const evento = convite;
  if (!evento) return false;
  convite = null;
  avisar();
  try {
    await evento.prompt();
    const { outcome } = await evento.userChoice;
    return outcome === 'accepted';
  } catch {
    return false;
  }
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/** Desenhado no servidor (testes): `manual`, o caso que só ensina o caminho. */
export function useInstalacao(): EstadoDaInstalacao {
  return useSyncExternalStore(assinar, estadoAgora, () => 'manual');
}

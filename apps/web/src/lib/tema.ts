/**
 * Tema claro e escuro, exatamente como o script da casca do padrão (seção 5):
 * `data-theme` no `<html>`, escolha guardada em localStorage "tema".
 * O script de uma linha do `index.html` aplica a escolha antes de a tela aparecer.
 */

import { useSyncExternalStore } from 'react';

/** "" = igual ao aparelho. */
export type Tema = '' | 'light' | 'dark';

const EVENTO = 'csp-mkt:tema';

function raiz(): HTMLElement {
  return document.documentElement;
}

/** O tema que está valendo agora é escuro? */
export function temaEscuroAgora(): boolean {
  const forcado = raiz().dataset.theme;
  return forcado ? forcado === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Aplica e guarda: "light", "dark" ou "" (igual ao aparelho). */
export function definirTema(valor: Tema): void {
  if (valor) raiz().dataset.theme = valor;
  else delete raiz().dataset.theme;
  try {
    if (valor) localStorage.setItem('tema', valor);
    else localStorage.removeItem('tema');
  } catch {
    /* navegador sem localStorage: o tema vale só nesta aba */
  }
  window.dispatchEvent(new Event(EVENTO));
}

/** A preferência guardada ("" quando segue o aparelho). */
export function preferenciaTema(): Tema {
  try {
    const t = localStorage.getItem('tema');
    return t === 'light' || t === 'dark' ? t : '';
  } catch {
    return '';
  }
}

/** Botão lua/sol: alterna entre claro e escuro a partir do que está valendo. */
export function alternarTema(): void {
  definirTema(temaEscuroAgora() ? 'light' : 'dark');
}

function assinar(avisar: () => void): () => void {
  window.addEventListener(EVENTO, avisar);
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', avisar);
  return () => {
    window.removeEventListener(EVENTO, avisar);
    mq.removeEventListener('change', avisar);
  };
}

/** Preferência guardada, reativa (para o `.yn-segmented` Aparelho · Claro · Escuro). */
export function useTema(): { preferencia: Tema; escuro: boolean; definir: (valor: Tema) => void } {
  const preferencia = useSyncExternalStore(assinar, preferenciaTema, () => '' as Tema);
  const escuro = useSyncExternalStore(assinar, temaEscuroAgora, () => false);
  return { preferencia, escuro, definir: definirTema };
}

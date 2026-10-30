/**
 * Aviso de versão nova (seção 10 do padrão): lê `/version.json`, gerado na build pelo plugin
 * em `vite.config.ts`, e compara o `builtAt` com o desta build. Quando muda, a casca mostra
 * a faixa "Versão nova disponível" com o botão "Atualizar".
 */

import { useSyncExternalStore } from 'react';

const INTERVALO_MS = 5 * 60_000;

interface Versao {
  version: string;
  builtAt: string;
}

export const VERSAO_ATUAL: Versao = { version: __APP_VERSION__, builtAt: __APP_BUILT_AT__ };

let nova = false;
let temporizador: number | null = null;
const ouvintes = new Set<() => void>();

async function conferir(): Promise<void> {
  try {
    const resposta = await fetch('/version.json', { cache: 'no-store' });
    if (!resposta.ok) return;
    const remota = (await resposta.json()) as Partial<Versao>;
    const mudou = typeof remota.builtAt === 'string' && remota.builtAt !== VERSAO_ATUAL.builtAt;
    if (mudou !== nova) {
      nova = mudou;
      ouvintes.forEach((o) => o());
    }
  } catch {
    /* sem rede ou arquivo ausente: nada a avisar */
  }
}

function aoVoltar(): void {
  if (document.visibilityState === 'visible') void conferir();
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  if (ouvintes.size === 1) {
    void conferir();
    temporizador = window.setInterval(() => void conferir(), INTERVALO_MS);
    document.addEventListener('visibilitychange', aoVoltar);
  }
  return () => {
    ouvintes.delete(ouvinte);
    if (ouvintes.size === 0) {
      if (temporizador !== null) window.clearInterval(temporizador);
      temporizador = null;
      document.removeEventListener('visibilitychange', aoVoltar);
    }
  };
}

export function recarregar(): void {
  window.location.reload();
}

/** `true` quando o servidor tem uma build mais nova que a aberta. */
export function useVersaoNova(): boolean {
  return useSyncExternalStore(
    assinar,
    () => nova,
    () => false,
  );
}

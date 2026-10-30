/**
 * Sessão e papel.
 *
 * Modo demonstração (sem `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`): entra direto como o
 * dono de exemplo, sem login. Modo Supabase: a estrutura está aqui; o cliente `@supabase/supabase-js`
 * e a tela de login entram na fase 3/4, e `profiles.role` passa a vir do banco (decisão 0011).
 */

import { useSyncExternalStore } from 'react';
import type { Profile } from '@csp-mkt/shared';

export type ModoDeAcesso = 'demonstracao' | 'supabase';

/** Perfil usado no modo demonstração. Não é pessoa real. */
export const PERFIL_DEMONSTRACAO: Profile = {
  id: 'demo-owner',
  name: 'Dono (demonstração)',
  email: 'dono@example.com',
  role: 'owner',
};

export function temSupabase(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

export function modoDeAcesso(): ModoDeAcesso {
  return temSupabase() ? 'supabase' : 'demonstracao';
}

export interface Sessao {
  modo: ModoDeAcesso;
  /** `null` = ninguém logado (só no modo Supabase, até a tela de login existir). */
  perfil: Profile | null;
  carregando: boolean;
  sair: () => Promise<void>;
}

interface Estado {
  perfil: Profile | null;
  carregando: boolean;
}

let estado: Estado =
  modoDeAcesso() === 'demonstracao'
    ? { perfil: PERFIL_DEMONSTRACAO, carregando: false }
    : { perfil: null, carregando: true };

const ouvintes = new Set<() => void>();

function mudar(proximo: Estado): void {
  estado = proximo;
  ouvintes.forEach((o) => o());
}

/**
 * Fase 3/4: aqui entra `supabase.auth.getSession()` + `onAuthStateChange`, lendo `profiles`
 * (id, name, email, role) do projeto do CSP-MKT. Até lá, no modo Supabase ninguém entra.
 */
async function carregarSessaoSupabase(): Promise<void> {
  mudar({ perfil: null, carregando: false });
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  if (ouvintes.size === 1 && modoDeAcesso() === 'supabase' && estado.carregando)
    void carregarSessaoSupabase();
  return () => {
    ouvintes.delete(ouvinte);
  };
}

async function sair(): Promise<void> {
  if (modoDeAcesso() === 'demonstracao') return; // não há login para sair
  // Fase 3/4: supabase.auth.signOut()
  mudar({ perfil: null, carregando: false });
}

export function useSessao(): Sessao {
  const atual = useSyncExternalStore(
    assinar,
    () => estado,
    () => estado,
  );
  return { modo: modoDeAcesso(), perfil: atual.perfil, carregando: atual.carregando, sair };
}

/** Iniciais para o `.yn-avatar`: "Dono (demonstração)" → "DD". */
export function iniciais(nome: string): string {
  const partes = nome
    .replace(/\(.*?\)/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const primeira = partes[0]?.[0] ?? '';
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : (partes[0]?.[1] ?? '');
  return (primeira + ultima).toUpperCase();
}

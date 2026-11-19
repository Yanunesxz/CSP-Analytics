/**
 * O cliente do Supabase, só no modo Supabase (com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`). A chave é a pública
 * (anon): quem protege os dados é a RLS e a conferência de papel das funções `api.*` (decisões 0011 e 0034). A tela só
 * fala com o esquema `api` e nunca lê tabela direto.
 */

import { createClient } from '@supabase/supabase-js';

/** Com as duas variáveis, o sistema fala com o Supabase; sem elas, é o modo demonstração. */
export function temSupabase(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

function criar(url: string, chave: string) {
  return createClient(url, chave, {
    db: { schema: 'api' },
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}

export type ClienteSupabase = ReturnType<typeof criar>;

let cliente: ClienteSupabase | null = null;

/** O cliente único da aba; `null` no modo demonstração. */
export function supabase(): ClienteSupabase | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const chave = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !chave) return null;
  cliente ??= criar(url, chave);
  return cliente;
}

/** Erro de uma chamada `api.*`: o código curto do banco (KPI-403, KPI-400…) ou o da rede, sem a mensagem técnica. */
export function codigoDoErro(erro: { message?: string; code?: string } | null | undefined): string {
  const mensagem = erro?.message ?? '';
  const curto = /^[A-Z]{2,5}-\d{3}$/.test(mensagem) ? mensagem : null;
  return curto ?? (erro?.code ? `API-${erro.code}` : 'API-500');
}

/**
 * Sessão e papel.
 *
 * Modo demonstração (sem `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`): entra direto como o
 * dono de exemplo, sem login. Modo Supabase: login com e-mail e senha pelo Supabase Auth (a senha
 * nasce no convite) e o papel lido do banco a cada sessão, por `api.my_profile()` (decisão 0011).
 * O papel daqui só decide o que a tela mostra: quem barra é a RLS e as funções `api.*`.
 */

import { useSyncExternalStore } from 'react';
import type { Profile, Role } from '@csp-mkt/shared';
import { supabase, temSupabase } from './supabase';

export { temSupabase };

export type ModoDeAcesso = 'demonstracao' | 'supabase';

/** Perfil usado no modo demonstração. Não é pessoa real e não tem e-mail: a tela mostra "A cadastrar". */
export const PERFIL_DEMONSTRACAO: Profile = {
  id: 'demo-owner',
  name: 'Dono (demonstração)',
  email: '',
  role: 'owner',
};

export function modoDeAcesso(): ModoDeAcesso {
  return temSupabase() ? 'supabase' : 'demonstracao';
}

export interface Sessao {
  modo: ModoDeAcesso;
  /** `null` = ninguém logado, ou logado sem acesso (só no modo Supabase). */
  perfil: Profile | null;
  carregando: boolean;
  /** Logado, mas sem perfil ativo: não foi convidado ou perdeu o acesso. */
  semAcesso: boolean;
  /** Código curto quando não deu para ler o perfil (rede, banco); a tela mostra "Tentar de novo". */
  erro: string | null;
  entrar: (email: string, senha: string) => Promise<string | null>;
  sair: () => Promise<void>;
  tentarDeNovo: () => void;
}

interface Estado {
  perfil: Profile | null;
  carregando: boolean;
  semAcesso: boolean;
  erro: string | null;
}

let estado: Estado =
  modoDeAcesso() === 'demonstracao'
    ? { perfil: PERFIL_DEMONSTRACAO, carregando: false, semAcesso: false, erro: null }
    : { perfil: null, carregando: true, semAcesso: false, erro: null };

const ouvintes = new Set<() => void>();

function mudar(proximo: Estado): void {
  estado = proximo;
  ouvintes.forEach((o) => o());
}

/** A linha de `api.my_profile()`. */
export interface LinhaDoPerfil {
  id: string;
  email: string | null;
  display_name: string;
  role: Role;
  is_active: boolean;
}

/** O perfil que a tela usa; `null` sem linha ou com o perfil inativo. Pura, com teste. */
export function perfilDaLinha(linha: LinhaDoPerfil | null | undefined): Profile | null {
  if (!linha || !linha.is_active) return null;
  return { id: linha.id, name: linha.display_name, email: linha.email ?? '', role: linha.role };
}

/** A mensagem do login que não deu certo, sem dizer se o e-mail existe. Pura, com teste. */
export function mensagemDoLogin(
  erro: { status?: number; code?: string; message?: string } | null,
): string | null {
  if (!erro) return null;
  if (erro.code === 'invalid_credentials' || erro.status === 400)
    return 'E-mail ou senha não conferem. Confira e tente de novo.';
  if (erro.status === 429) return 'Muitas tentativas. Espere um minuto e tente de novo.';
  return 'Não deu para entrar agora. Confira a internet e tente de novo.';
}

let ouvindoAuth = false;

async function lerPerfil(): Promise<void> {
  const cliente = supabase();
  if (!cliente) return;
  const { data: sessao } = await cliente.auth.getSession();
  if (!sessao.session) {
    mudar({ perfil: null, carregando: false, semAcesso: false, erro: null });
    return;
  }
  const { data, error } = await cliente.rpc('my_profile');
  if (error) {
    mudar({ perfil: null, carregando: false, semAcesso: false, erro: 'PERFIL-503' });
    return;
  }
  const linha = (Array.isArray(data) ? data[0] : data) as LinhaDoPerfil | undefined;
  const perfil = perfilDaLinha(linha);
  mudar({ perfil, carregando: false, semAcesso: perfil === null, erro: null });
}

async function carregarSessaoSupabase(): Promise<void> {
  const cliente = supabase();
  if (!cliente) return;
  if (!ouvindoAuth) {
    ouvindoAuth = true;
    // Entrar, sair ou o token renovado em outra aba: o papel é lido de novo do banco.
    cliente.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT' || evento === 'USER_UPDATED')
        window.setTimeout(() => void lerPerfil(), 0);
    });
  }
  await lerPerfil();
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  if (ouvintes.size === 1 && modoDeAcesso() === 'supabase' && estado.carregando)
    void carregarSessaoSupabase();
  return () => {
    ouvintes.delete(ouvinte);
  };
}

async function entrar(email: string, senha: string): Promise<string | null> {
  const cliente = supabase();
  if (!cliente) return null; // demonstração: já entrou
  const { error } = await cliente.auth.signInWithPassword({ email: email.trim(), password: senha });
  if (error) return mensagemDoLogin(error);
  await lerPerfil();
  return null;
}

async function sair(): Promise<void> {
  const cliente = supabase();
  if (!cliente) return; // não há login para sair
  await cliente.auth.signOut();
  mudar({ perfil: null, carregando: false, semAcesso: false, erro: null });
}

function tentarDeNovo(): void {
  mudar({ ...estado, carregando: true, erro: null });
  void lerPerfil();
}

export function useSessao(): Sessao {
  const atual = useSyncExternalStore(
    assinar,
    () => estado,
    () => estado,
  );
  return {
    modo: modoDeAcesso(),
    perfil: atual.perfil,
    carregando: atual.carregando,
    semAcesso: atual.semAcesso,
    erro: atual.erro,
    entrar,
    sair,
    tentarDeNovo,
  };
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

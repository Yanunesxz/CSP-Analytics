/**
 * Convite por e-mail (decisão 0011): validação pura, com teste em `convite.test.ts`, e o envio.
 *
 * - Postel: aceita maiúsculas e espaços em volta; grava o e-mail em minúsculas, sem espaço.
 * - Modo demonstração: o envio é simulado (nenhum e-mail sai do sistema) e a pessoa não entra na lista.
 * - Modo Supabase: o convite vai por uma Edge Function que confere a sessão e o papel do dono no banco
 *   (fase 3/4). Até ela existir, o envio devolve erro com código, sem perder o que foi digitado.
 *
 * Fica no módulo porque o agente deste módulo não mexe em `data/actions.ts` (anotado como pendência).
 */

import type { Role } from '@csp-mkt/shared';
import { modoDeAcesso, type ModoDeAcesso } from '../../lib/auth';

export interface Convite {
  email: string;
  papel: Role;
}

/**
 * Ordem das opções na janela: o gestor de tráfego primeiro, porque é quem falta entrar na v1; depois quem só lê o
 * resumo (decisão 0043) e o dono.
 */
export const PAPEIS_DO_CONVITE: readonly Role[] = ['traffic_manager', 'summary_viewer', 'owner'];
export const PAPEL_PADRAO_DO_CONVITE: Role = 'traffic_manager';

/** Tempo da resposta simulada na demonstração: dá para ver o botão travado enquanto envia. */
const ESPERA_DA_DEMONSTRACAO_MS = 400;

const FORMATO_DE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizarEmail(texto: string): string {
  return texto.trim().toLowerCase();
}

export type ValidacaoDoConvite = { ok: true; convite: Convite } | { ok: false; erro: string };

/** Confere o e-mail antes de enviar. O erro diz o formato certo; quem chama não apaga o que foi digitado. */
export function validarConvite(
  email: string,
  papel: Role,
  emailsComAcesso: readonly string[],
): ValidacaoDoConvite {
  const normalizado = normalizarEmail(email);
  if (!normalizado) return { ok: false, erro: 'Informe o e-mail da pessoa.' };
  if (!FORMATO_DE_EMAIL.test(normalizado)) {
    return { ok: false, erro: 'Informe um e-mail válido, como nome@empresa.com.br.' };
  }
  if (emailsComAcesso.some((e) => normalizarEmail(e) === normalizado)) {
    return { ok: false, erro: 'Este e-mail já tem acesso ao sistema.' };
  }
  return { ok: true, convite: { email: normalizado, papel } };
}

export type ResultadoDoEnvio = { ok: true; email: string } | { ok: false; codigo: string; mensagem: string };

export interface OpcoesDoEnvio {
  /** Padrão: o modo desta sessão (`modoDeAcesso()`). */
  modo?: ModoDeAcesso;
  esperarMs?: number;
}

export async function enviarConvite(convite: Convite, opcoes: OpcoesDoEnvio = {}): Promise<ResultadoDoEnvio> {
  const modo = opcoes.modo ?? modoDeAcesso();
  if (modo === 'supabase') {
    return {
      ok: false,
      codigo: 'USR-501',
      mensagem: 'O envio de convites por e-mail ainda não está ligado.',
    };
  }
  const espera = opcoes.esperarMs ?? ESPERA_DA_DEMONSTRACAO_MS;
  await new Promise<void>((resolver) => setTimeout(resolver, espera));
  return { ok: true, email: convite.email };
}

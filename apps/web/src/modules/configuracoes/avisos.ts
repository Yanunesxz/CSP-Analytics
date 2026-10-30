/**
 * Avisos que a pessoa recebe fora do sistema (seção 8 do padrão: "cada pessoa escolhe o que recebe e
 * por qual canal, em Configurações → Avisos"). Na tela tudo aparece sempre (contador no menu, faixa no
 * topo); aqui se liga o e-mail e o WhatsApp de cada aviso.
 *
 * - Urgente sai a qualquer hora; o resto sai em horário comercial de São Paulo, e o que pode se repetir
 *   no mesmo dia (proposta do Claude) vira um resumo. WhatsApp ligado de saída só no que é urgente.
 * - Só aparece o aviso que o papel pode ver (`pode(role, aviso.acao)`).
 * - Na demonstração a escolha fica neste navegador (localStorage "avisos") e nada é enviado. Na fase 3 ela
 *   vai para o perfil, e o n8n lê de lá para mandar (decisão 0001: avisos só pelo n8n).
 *
 * As funções puras têm teste em `avisos.test.ts`; `useAvisos` e `definirAviso` só leem e gravam.
 */

import { useSyncExternalStore } from 'react';
import { pode, type Acao, type Role } from '@csp-mkt/shared';

export type CanalDeAviso = 'email' | 'whatsapp';

export const CANAIS_DE_AVISO: ReadonlyArray<{ canal: CanalDeAviso; rotulo: string }> = [
  { canal: 'email', rotulo: 'E-mail' },
  { canal: 'whatsapp', rotulo: 'WhatsApp' },
];

export type IdDoAviso =
  | 'conector_parado'
  | 'gasto_perto_do_teto'
  | 'custo_por_lead_alto'
  | 'proposta_para_aprovar'
  | 'relatorio_da_semana';

export type CanaisLigados = Readonly<Record<CanalDeAviso, boolean>>;

export interface Aviso {
  id: IdDoAviso;
  titulo: string;
  /** Quando o aviso sai. */
  descricao: string;
  urgente: boolean;
  /** Vários no mesmo dia viram um resumo (só no que não é urgente e pode se repetir). */
  agrupa: boolean;
  /** Só recebe quem pode ver o que o aviso aponta. */
  acao: Acao;
  padrao: CanaisLigados;
}

/** Na ordem da tela: o que pede ação agora primeiro, o resumo da semana por último. */
export const AVISOS: readonly Aviso[] = [
  {
    id: 'conector_parado',
    titulo: 'Conector parado',
    descricao: 'Quando uma integração cai ou atrasa além do esperado.',
    urgente: true,
    agrupa: false,
    acao: 'ver_conectores',
    padrao: { email: true, whatsapp: true },
  },
  {
    id: 'gasto_perto_do_teto',
    titulo: 'Gasto perto do teto',
    descricao: 'Quando o gasto de uma conta de anúncio chega perto do teto definido.',
    urgente: true,
    agrupa: false,
    acao: 'ver_trafego_ia',
    padrao: { email: true, whatsapp: true },
  },
  {
    id: 'custo_por_lead_alto',
    titulo: 'Custo por lead acima do limite',
    descricao: 'Quando o custo por lead de uma campanha passa do limite combinado.',
    urgente: true,
    agrupa: false,
    acao: 'ver_numeros',
    padrao: { email: true, whatsapp: true },
  },
  {
    id: 'proposta_para_aprovar',
    titulo: 'Proposta do Claude para aprovar',
    descricao: 'Quando o Claude coloca uma ação nova na fila de aprovação.',
    urgente: false,
    agrupa: true,
    acao: 'aprovar_acao',
    padrao: { email: true, whatsapp: false },
  },
  {
    id: 'relatorio_da_semana',
    titulo: 'Relatório da semana',
    descricao: 'Uma vez por semana, o resumo dos números com o link para a Visão geral.',
    urgente: false,
    agrupa: false,
    acao: 'ver_numeros',
    padrao: { email: true, whatsapp: false },
  },
];

export type PreferenciasDeAviso = Readonly<Record<IdDoAviso, CanaisLigados>>;

export function preferenciasPadrao(): PreferenciasDeAviso {
  const resultado = {} as Record<IdDoAviso, CanaisLigados>;
  for (const aviso of AVISOS) resultado[aviso.id] = { ...aviso.padrao };
  return resultado;
}

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/**
 * Lê o que foi guardado. Aceita texto vazio, JSON quebrado, aviso desconhecido e valor que não é
 * sim/não: o que não der para ler vale o padrão.
 */
export function lerPreferencias(texto: string | null | undefined): PreferenciasDeAviso {
  const padrao = preferenciasPadrao();
  if (!texto) return padrao;
  let guardado: unknown;
  try {
    guardado = JSON.parse(texto);
  } catch {
    return padrao;
  }
  if (!ehObjeto(guardado)) return padrao;
  const resultado = {} as Record<IdDoAviso, CanaisLigados>;
  for (const aviso of AVISOS) {
    const salvo = guardado[aviso.id];
    const canais: Record<CanalDeAviso, boolean> = { ...padrao[aviso.id] };
    if (ehObjeto(salvo)) {
      for (const { canal } of CANAIS_DE_AVISO) {
        const valor = salvo[canal];
        if (typeof valor === 'boolean') canais[canal] = valor;
      }
    }
    resultado[aviso.id] = canais;
  }
  return resultado;
}

/** Liga ou desliga um canal de um aviso, sem mudar o objeto recebido. */
export function comPreferencia(
  atuais: PreferenciasDeAviso,
  id: IdDoAviso,
  canal: CanalDeAviso,
  ligado: boolean,
): PreferenciasDeAviso {
  return { ...atuais, [id]: { ...atuais[id], [canal]: ligado } };
}

/** Os avisos que o papel recebe. Sem papel, nenhum. */
export function avisosDoPapel(role: Role | null | undefined): Aviso[] {
  return AVISOS.filter((aviso) => pode(role, aviso.acao));
}

/** Quando o aviso chega, para a linha abaixo do título. */
export function textoDoHorario(aviso: Aviso): string {
  if (aviso.urgente) return 'Urgente: sai a qualquer hora.';
  if (aviso.agrupa) return 'Sai em horário comercial; vários no mesmo dia viram um resumo.';
  return 'Sai em horário comercial.';
}

/* ---------- Leitura e gravação (navegador) ---------- */

export const CHAVE_DOS_AVISOS = 'avisos';
const EVENTO = 'csp-mkt:avisos';
const PADRAO = preferenciasPadrao();

/** Navegador que não guarda (aba anônima, cota cheia): a escolha vale só nesta aba. */
let semArmazenamento = false;
let emMemoria: string | null = null;
let cache: { texto: string | null; preferencias: PreferenciasDeAviso } | null = null;

function lerTexto(): string | null {
  if (semArmazenamento) return emMemoria;
  try {
    return localStorage.getItem(CHAVE_DOS_AVISOS);
  } catch {
    semArmazenamento = true;
    return emMemoria;
  }
}

function gravarTexto(texto: string): void {
  emMemoria = texto;
  if (semArmazenamento) return;
  try {
    localStorage.setItem(CHAVE_DOS_AVISOS, texto);
  } catch {
    semArmazenamento = true;
  }
}

/** Mesmo objeto enquanto o texto guardado não muda (exigência do useSyncExternalStore). */
function instantaneo(): PreferenciasDeAviso {
  const texto = lerTexto();
  if (!cache || cache.texto !== texto) cache = { texto, preferencias: lerPreferencias(texto) };
  return cache.preferencias;
}

function assinar(avisar: () => void): () => void {
  window.addEventListener(EVENTO, avisar);
  window.addEventListener('storage', avisar); // outra aba mudou
  return () => {
    window.removeEventListener(EVENTO, avisar);
    window.removeEventListener('storage', avisar);
  };
}

/** Grava a escolha de um canal de um aviso e avisa quem está ouvindo. */
export function definirAviso(id: IdDoAviso, canal: CanalDeAviso, ligado: boolean): void {
  gravarTexto(JSON.stringify(comPreferencia(instantaneo(), id, canal, ligado)));
  window.dispatchEvent(new Event(EVENTO));
}

/** As escolhas de aviso, reativas. */
export function useAvisos(): PreferenciasDeAviso {
  return useSyncExternalStore(assinar, instantaneo, () => PADRAO);
}

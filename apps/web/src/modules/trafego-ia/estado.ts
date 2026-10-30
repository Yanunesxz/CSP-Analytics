/**
 * O que Tráfego com IA grava e o conjunto de dados (`Dados`) ainda não guarda: a estratégia por marca e
 * o diário do que não deixa rastro numa ação (mudança de limite, parar tudo, desfazer a parada, hora e
 * autor do descarte). Camada tela → actions → store (seção 10 do padrão), local a este módulo até a
 * fundação ganhar estes campos (fase 3: `traffic_strategies` e `traffic_log`, com RLS por papel).
 *
 * O registro pertence ao conjunto em que foi feito (`geradoEm`): o "Recomeçar" da faixa de demonstração
 * gera outro conjunto e o registro antigo deixa de valer, como o resto da demonstração.
 *
 * Aprovar, marcar como feita e registrar ideia usam direto `data/actions.ts`: a própria ação guarda
 * quem e quando, e o diário lê dela.
 */

import { useSyncExternalStore } from 'react';
import type { Brand, Platform } from '@csp-mkt/shared';
import { descartarAcao, pararTudo } from '../../data/actions';
import {
  REGISTRO_VAZIO,
  type EstrategiaDaMarca,
  type Registro,
  type RegistroDoDiario,
} from '../../data/queries/trafego-ia';
import { store } from '../../data/store';
import type { Marca } from '../../lib/url-state';
import { escalarLimites } from './regras';

let registro: Registro = REGISTRO_VAZIO;
const ouvintes = new Set<() => void>();
let sequencia = 0;

function ler(): Registro {
  return registro;
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/** O registro da tela (a consulta ignora o de outro conjunto). */
export function useRegistroDoTrafego(): Registro {
  return useSyncExternalStore(assinar, ler, ler);
}

function alterar(mudar: (atual: Registro) => Registro): void {
  const base = store.getSnapshot().geradoEm;
  const atual = registro.base === base ? registro : { ...REGISTRO_VAZIO, base };
  registro = mudar(atual);
  ouvintes.forEach((o) => o());
}

function novoId(prefixo: string, agora: Date): string {
  sequencia += 1;
  return `${prefixo}-${agora.getTime().toString(36)}-${sequencia}`;
}

function anotar(evento: RegistroDoDiario): void {
  alterar((atual) => ({ ...atual, eventos: [...atual.eventos, evento] }));
}

/** O registro de agora, fora do React (testes e ações). */
export function lerRegistroDoTrafego(): Registro {
  return registro;
}

/** Para os testes: volta ao registro vazio. */
export function zerarRegistro(): void {
  registro = REGISTRO_VAZIO;
  ouvintes.forEach((o) => o());
}

/* ---------- Estratégia ---------- */

export type NovaEstrategia = Omit<EstrategiaDaMarca, 'atualizadaEm' | 'atualizadaPor'>;

export function salvarEstrategia(
  marca: Brand,
  estrategia: NovaEstrategia,
  por: string,
  agora: Date = new Date(),
): void {
  const em = agora.toISOString();
  alterar((atual) => ({
    ...atual,
    estrategias: { ...atual.estrategias, [marca]: { ...estrategia, atualizadaEm: em, atualizadaPor: por } },
    eventos: [...atual.eventos, { tipo: 'estrategia', id: novoId('est', agora), em, por, marca }],
  }));
}

/* ---------- Limite de gasto da conta ---------- */

/**
 * Muda o limite do mês da conta (marca × canal): o limite de cada campanha ativa muda na mesma
 * proporção, para a soma dar o novo valor (e a Visão geral e as telas de canal mostrarem o mesmo).
 * Devolve o limite anterior; null quando a conta não tem campanha ativa (nada muda).
 */
export function definirLimiteDaConta(
  marca: Brand,
  canal: Platform,
  novoCents: number,
  por: string,
  agora: Date = new Date(),
): { deCents: number } | null {
  const ativas = store
    .getSnapshot()
    .campaigns.filter((c) => c.brandId === marca && c.platform === canal && c.status === 'active');
  if (ativas.length === 0) return null;
  const deCents = ativas.reduce((total, c) => total + c.spendCapCents, 0);
  store.alterar((dados) => ({
    ...dados,
    campaigns: escalarLimites(dados.campaigns, marca, canal, novoCents),
  }));
  anotar({
    tipo: 'limite',
    id: novoId('lim', agora),
    em: agora.toISOString(),
    por,
    marca,
    canal,
    deCents,
    paraCents: Math.round(novoCents),
  });
  return { deCents };
}

/* ---------- Parar tudo e desfazer ---------- */

/** Campanhas ativas do Claude na marca (as que "Parar tudo" pausa). */
export function campanhasQueParam(marca: Marca): string[] {
  return store
    .getSnapshot()
    .campaigns.filter(
      (c) => c.managedBy === 'claude' && c.status === 'active' && (marca === 'todas' || c.brandId === marca),
    )
    .map((c) => c.id);
}

/** Pausa toda campanha ativa do Claude na marca (em todos os canais) e anota no diário. */
export function pararTudoDoClaude(marca: Marca, por: string, agora: Date = new Date()): number {
  const campanhas = campanhasQueParam(marca);
  const quantas = pararTudo(marca);
  if (quantas > 0)
    anotar({
      tipo: 'parar_tudo',
      id: novoId('parar', agora),
      em: agora.toISOString(),
      por,
      marca,
      campanhas,
    });
  return quantas;
}

/** Desfaz uma parada: reativa as campanhas dela que continuam pausadas. Devolve quantas voltaram. */
export function desfazerParada(paradaId: string, por: string, agora: Date = new Date()): number {
  const parada = registro.eventos.find(
    (e): e is Extract<RegistroDoDiario, { tipo: 'parar_tudo' }> =>
      e.tipo === 'parar_tudo' && e.id === paradaId,
  );
  if (!parada || registro.base !== store.getSnapshot().geradoEm) return 0;
  const alvo = new Set(parada.campanhas);
  const voltam = store
    .getSnapshot()
    .campaigns.filter((c) => alvo.has(c.id) && c.status === 'paused')
    .map((c) => c.id);
  if (voltam.length === 0) return 0;
  const ids = new Set(voltam);
  store.alterar((dados) => ({
    ...dados,
    campaigns: dados.campaigns.map((c) => (ids.has(c.id) ? { ...c, status: 'active' } : c)),
  }));
  anotar({
    tipo: 'reativar',
    id: novoId('reat', agora),
    em: agora.toISOString(),
    por,
    marca: parada.marca,
    campanhas: voltam,
    paradaId,
  });
  return voltam.length;
}

/* ---------- Descartar com motivo ---------- */

/** Descarta a proposta (o motivo fica na ação) e anota quem e quando no diário. */
export function descartarProposta(id: string, motivo: string, por: string, agora: Date = new Date()): void {
  descartarAcao(id, motivo);
  anotar({ tipo: 'descarte', id: novoId('desc', agora), em: agora.toISOString(), por, acaoId: id, motivo });
}

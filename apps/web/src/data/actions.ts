/**
 * Ações da camada tela → actions → store (seção 10 do padrão).
 * No modo demonstração alteram o store em memória; na fase 3 cada uma vira chamada ao banco
 * (Edge Function ou RPC que confere o papel) e o worker executa o que foi aprovado.
 */

import type { Connector, TrafficAction } from '@csp-mkt/shared';
import { store } from './store';

function alterarAcao(id: string, mudar: (acao: TrafficAction) => TrafficAction): void {
  store.alterar((dados) => ({
    ...dados,
    actions: dados.actions.map((a) => (a.id === id ? mudar(a) : a)),
  }));
}

/** Aprova uma proposta (status `approved`, quem e quando). */
export function aprovarAcao(id: string, aprovadoPor: string, agora: Date = new Date()): void {
  alterarAcao(id, (a) => ({
    ...a,
    status: 'approved',
    approvedBy: aprovadoPor,
    approvedAt: agora.toISOString(),
  }));
}

/** Descarta uma proposta com motivo (fica na trilha como `result`). */
export function descartarAcao(id: string, motivo: string): void {
  alterarAcao(id, (a) => ({ ...a, status: 'discarded', result: motivo }));
}

/** "Marcar como feita": enquanto não há credencial de escrita, o humano executa fora e registra aqui. */
export function marcarAcaoComoFeita(
  id: string,
  por: string,
  resultado: string,
  agora: Date = new Date(),
): void {
  alterarAcao(id, (a) => ({
    ...a,
    status: 'done',
    approvedBy: a.approvedBy ?? por,
    approvedAt: a.approvedAt ?? agora.toISOString(),
    executedAt: agora.toISOString(),
    result: resultado,
  }));
}

/** Sequência desta aba: duas propostas no mesmo milissegundo não dividem o id. */
let sequencia = 0;

/** Ideia nova do gestor na lista "O que podemos fazer". */
export function proporAcao(
  acao: Omit<
    TrafficAction,
    'id' | 'createdAt' | 'status' | 'approvedBy' | 'approvedAt' | 'executedAt' | 'result'
  >,
  agora: Date = new Date(),
): string {
  sequencia += 1;
  const id = `act-${agora.getTime().toString(36)}-${sequencia.toString(36)}`;
  store.alterar((dados) => ({
    ...dados,
    actions: [
      {
        ...acao,
        id,
        createdAt: agora.toISOString(),
        status: 'idea',
        approvedBy: null,
        approvedAt: null,
        executedAt: null,
        result: null,
      },
      ...dados.actions,
    ],
  }));
  return id;
}

/** Botão de parar tudo: pausa toda campanha ativa gerida pelo Claude (de uma marca ou de todas). */
export function pararTudo(marca: 'cs' | 'plumene' | 'todas' = 'todas'): number {
  let pausadas = 0;
  store.alterar((dados) => ({
    ...dados,
    campaigns: dados.campaigns.map((c) => {
      if (c.managedBy === 'claude' && c.status === 'active' && (marca === 'todas' || c.brandId === marca)) {
        pausadas += 1;
        return { ...c, status: 'paused' };
      }
      return c;
    }),
  }));
  return pausadas;
}

/**
 * "Tentar de novo" num conector: na demonstração, simula uma sincronização bem-sucedida. Só no conector
 * ligado: o que está a ligar ou desligado fica como está.
 */
export function tentarConectorDeNovo(id: Connector['id'], agora: Date = new Date()): void {
  store.alterar((dados) => ({
    ...dados,
    connectors: dados.connectors.map((c) =>
      c.id === id && c.status !== 'not_connected' && c.status !== 'disabled'
        ? { ...c, status: 'ok', lastSyncAt: agora.toISOString(), errors24h: 0 }
        : c,
    ),
  }));
}

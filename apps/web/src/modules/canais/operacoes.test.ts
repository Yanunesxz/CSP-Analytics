import { beforeEach, describe, expect, it } from 'vitest';
import type { Campaign } from '@csp-mkt/shared';
import { pararTudo } from '../../data/actions';
import { DADOS_VAZIOS } from '../../data/dados';
import { painelDoCanal } from '../../data/queries/canais';
import { gerarDadosDeExemplo } from '../../data/sample';
import { store } from '../../data/store';
import { FILTROS_PADRAO } from '../../lib/url-state';
import { montarAjuste, montarPausa, registrarAcao } from './operacoes';

const NBSP = String.fromCharCode(160);
const agora = new Date('2026-10-30T15:00:00-03:00');

const campanha: Campaign = {
  id: 'cmp-meta-01',
  externalId: 'meta:1037',
  platform: 'meta',
  brandId: 'cs',
  name: 'CS · Pijamas de inverno · Leads',
  utmCampaign: 'cs-meta-pijamas-de-inverno-leads',
  managedBy: 'claude',
  status: 'active',
  dailyBudgetCents: 12000,
  spendCapCents: 540000,
};

beforeEach(() => {
  store.alterar(() => ({ ...DADOS_VAZIOS }));
});

describe('montadores', () => {
  it('pausa proposta pelo humano, sem custo, com o motivo ou um texto que diz que não houve motivo', () => {
    expect(montarPausa(campanha, '  CPL acima da meta há 7 dias. ')).toEqual({
      proposedBy: 'human',
      brandId: 'cs',
      platform: 'meta',
      campaignId: 'cmp-meta-01',
      title: 'Pausar CS · Pijamas de inverno · Leads',
      rationale: 'CPL acima da meta há 7 dias.',
      kind: 'pause',
      paramsJson: '{"status":"paused"}',
      impact: 'medium',
      effort: 'low',
      costCents: 0,
    });
    expect(montarPausa(campanha, '   ').rationale).toBe('Pausa pedida na tela do canal, sem motivo escrito.');
  });

  it('ajuste de orçamento guarda o valor novo e o anterior; custo só do aumento em 30 dias', () => {
    const a = montarAjuste(campanha, 15000, '');
    expect(a.kind).toBe('budget');
    expect(a.title).toBe(`Mudar o orçamento diário de CS · Pijamas de inverno · Leads para R$${NBSP}150`);
    expect(JSON.parse(a.paramsJson)).toEqual({ dailyBudgetCents: 15000, previousDailyBudgetCents: 12000 });
    expect(a.costCents).toBe(90000);
    expect(montarAjuste(campanha, 9000, 'Teto apertado.').costCents).toBe(0);
  });
});

describe('registrarAcao', () => {
  it('com quem aprova, a ação entra no store já aprovada (nada é executado)', () => {
    const { id, aprovada } = registrarAcao(montarPausa(campanha, ''), 'demo-owner', agora);
    expect(aprovada).toBe(true);
    const gravada = store.getSnapshot().actions.find((a) => a.id === id);
    expect(gravada).toMatchObject({
      status: 'approved',
      approvedBy: 'demo-owner',
      approvedAt: agora.toISOString(),
      executedAt: null,
      kind: 'pause',
    });
  });

  it('sem quem aprova, fica como proposta na fila', () => {
    const { id, aprovada } = registrarAcao(montarAjuste(campanha, 15000, ''), null, agora);
    expect(aprovada).toBe(false);
    expect(store.getSnapshot().actions.find((a) => a.id === id)).toMatchObject({
      status: 'idea',
      approvedBy: null,
    });
  });

  it('a pausa aprovada aparece como ação aberta da campanha na consulta do canal', () => {
    store.alterar(() => ({ ...DADOS_VAZIOS, campaigns: [campanha] }));
    registrarAcao(montarPausa(campanha, ''), 'demo-owner', agora);
    const p = painelDoCanal('meta', store.getSnapshot(), { ...FILTROS_PADRAO }, agora);
    expect(p.campanhas[0]!.acoesAbertas.map((a) => a.kind)).toEqual(['pause']);
  });
});

describe('parar tudo', () => {
  it('a contagem da tela é o que a ação pausa', () => {
    store.alterar(() => gerarDadosDeExemplo({ agora }));
    for (const marca of ['cs', 'plumene'] as const) {
      const previsto = painelDoCanal('google', store.getSnapshot(), { ...FILTROS_PADRAO, marca }, agora)
        .pararTudo.total;
      expect(previsto).toBeGreaterThan(0);
      expect(pararTudo(marca)).toBe(previsto);
    }
    expect(painelDoCanal('meta', store.getSnapshot(), { ...FILTROS_PADRAO }, agora).pararTudo.total).toBe(0);
  });
});

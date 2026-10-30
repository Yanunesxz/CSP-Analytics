/**
 * As ações da tela contra o store de verdade: estratégia, limite da conta, parar tudo e desfazer,
 * descartar com motivo. Confere o que muda no store, o que fica no registro e o que a consulta mostra.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Campaign, TrafficAction } from '@csp-mkt/shared';
import { aprovarAcao } from '../../data/actions';
import { DADOS_VAZIOS, type Dados } from '../../data/dados';
import { painelDoTrafego } from '../../data/queries/trafego-ia';
import { store } from '../../data/store';
import { FILTROS_PADRAO, type Filtros } from '../../lib/url-state';
import {
  campanhasQueParam,
  definirLimiteDaConta,
  descartarProposta,
  desfazerParada,
  lerRegistroDoTrafego,
  pararTudoDoClaude,
  salvarEstrategia,
  zerarRegistro,
} from './estado';

const agora = new Date('2026-10-30T15:00:00-03:00');
const f = (parcial: Partial<Filtros> = {}): Filtros => ({ ...FILTROS_PADRAO, ...parcial });

const campanha = (id: string, p: Partial<Campaign>): Campaign => ({
  id,
  externalId: id,
  platform: 'meta',
  brandId: 'cs',
  name: `Campanha ${id}`,
  utmCampaign: id,
  managedBy: 'claude',
  status: 'active',
  dailyBudgetCents: 10000,
  spendCapCents: 300000,
  ...p,
});

const proposta: TrafficAction = {
  id: 'a1',
  proposedBy: 'claude',
  brandId: 'cs',
  platform: 'meta',
  campaignId: 'm1',
  title: 'Subir o orçamento',
  rationale: 'CPL abaixo da média.',
  kind: 'budget',
  paramsJson: '{}',
  status: 'idea',
  impact: 'high',
  effort: 'low',
  costCents: 1000,
  createdAt: '2026-10-29T13:00:00.000Z',
  approvedBy: null,
  approvedAt: null,
  executedAt: null,
  result: null,
};

const inicial = (): Dados => ({
  ...DADOS_VAZIOS,
  campaigns: [
    campanha('m1', { managedBy: 'human', spendCapCents: 100000 }),
    campanha('m2', { spendCapCents: 300000 }),
    campanha('t1', { platform: 'tiktok' }),
    campanha('p1', { brandId: 'plumene' }),
    campanha('pausada', { status: 'paused' }),
  ],
  actions: [proposta],
  profiles: [{ id: 'quem', name: 'Pessoa de teste', email: 'teste@example.com', role: 'owner' }],
  geradoEm: '2026-10-30T18:00:00.000Z',
});

const painel = (filtros: Filtros = f()) =>
  painelDoTrafego(store.getSnapshot(), filtros, agora, { registro: lerRegistroDoTrafego() });

beforeEach(() => {
  store.alterar(() => inicial());
  zerarRegistro();
});

afterAll(() => {
  store.alterar(() => ({ ...DADOS_VAZIOS }));
  zerarRegistro();
});

describe('estratégia', () => {
  it('salva por marca, anota no diário e a consulta mostra', () => {
    salvarEstrategia(
      'cs',
      {
        texto: 'Foco em lojistas novos.',
        verbaDoMesCents: 1500000,
        metaCustoPorClienteNovoCents: null,
        metaCustoPorLeadCents: 4000,
        metaClientesNovos: 20,
      },
      'quem',
      agora,
    );
    const reg = lerRegistroDoTrafego();
    expect(reg.base).toBe('2026-10-30T18:00:00.000Z');
    expect(reg.estrategias.cs).toMatchObject({ texto: 'Foco em lojistas novos.', atualizadaPor: 'quem' });
    const [cs] = painel(f({ marca: 'cs' })).estrategias;
    expect(cs?.estrategia?.verbaDoMesCents).toBe(1500000);
    expect(cs?.atualizadaPor).toBe('Pessoa de teste');
    expect(painel(f({ periodo: '7d' })).diario.eventos.map((e) => e.tipo)).toContain('estrategia');
  });

  it('o Recomeçar (outro conjunto) deixa o registro para trás', () => {
    salvarEstrategia(
      'cs',
      {
        texto: 'x',
        verbaDoMesCents: null,
        metaCustoPorClienteNovoCents: null,
        metaCustoPorLeadCents: null,
        metaClientesNovos: null,
      },
      'quem',
      agora,
    );
    store.alterar((d) => ({ ...d, geradoEm: '2026-10-30T19:00:00.000Z' }));
    expect(painel(f({ marca: 'cs' })).estrategias[0]?.estrategia).toBeNull();
    // A próxima gravação começa um registro novo, do conjunto novo
    salvarEstrategia(
      'plumene',
      {
        texto: 'y',
        verbaDoMesCents: null,
        metaCustoPorClienteNovoCents: null,
        metaCustoPorLeadCents: null,
        metaClientesNovos: null,
      },
      'quem',
      agora,
    );
    expect(Object.keys(lerRegistroDoTrafego().estrategias)).toEqual(['plumene']);
  });
});

describe('limite da conta', () => {
  it('reparte o novo limite entre as ativas da conta e anota de quanto para quanto', () => {
    expect(definirLimiteDaConta('cs', 'meta', 800000, 'quem', agora)).toEqual({ deCents: 400000 });
    const caps = Object.fromEntries(store.getSnapshot().campaigns.map((c) => [c.id, c.spendCapCents]));
    expect(caps).toEqual({ m1: 200000, m2: 600000, t1: 300000, p1: 300000, pausada: 300000 });
    expect(painel(f({ marca: 'cs', canal: 'meta' })).contas[0]?.limite).toBe(800000);
    const evento = lerRegistroDoTrafego().eventos[0];
    expect(evento).toMatchObject({
      tipo: 'limite',
      marca: 'cs',
      canal: 'meta',
      deCents: 400000,
      paraCents: 800000,
    });
  });

  it('conta sem campanha ativa não muda nada', () => {
    const antes = store.getSnapshot();
    expect(definirLimiteDaConta('plumene', 'google', 500000, 'quem', agora)).toBeNull();
    expect(store.getSnapshot()).toBe(antes);
    expect(lerRegistroDoTrafego().eventos).toEqual([]);
  });
});

describe('parar tudo do Claude e desfazer', () => {
  it('pausa só as ativas do Claude na marca, anota e deixa desfazer', () => {
    expect(campanhasQueParam('cs')).toEqual(['m2', 't1']);
    expect(pararTudoDoClaude('cs', 'quem', agora)).toBe(2);
    const status = () => Object.fromEntries(store.getSnapshot().campaigns.map((c) => [c.id, c.status]));
    expect(status()).toEqual({ m1: 'active', m2: 'paused', t1: 'paused', p1: 'active', pausada: 'paused' });

    const parada = painel().claude.parada;
    expect(parada).toMatchObject({ quantas: 2, aindaPausadas: 2, por: 'Pessoa de teste', marca: 'cs' });
    expect(painel().claude.ativas).toBe(1); // a da Plumene

    expect(desfazerParada(parada!.id, 'quem', agora)).toBe(2);
    expect(status()).toMatchObject({ m2: 'active', t1: 'active', pausada: 'paused' });
    expect(painel().claude.parada).toBeNull();
    const tipos = lerRegistroDoTrafego().eventos.map((e) => e.tipo);
    expect(tipos).toEqual(['parar_tudo', 'reativar']);
    // Desfazer de novo não faz nada
    expect(desfazerParada(parada!.id, 'quem', agora)).toBe(0);
  });

  it('sem campanha ativa do Claude, não anota nada', () => {
    pararTudoDoClaude('todas', 'quem', agora);
    zerarRegistro();
    expect(pararTudoDoClaude('todas', 'quem', agora)).toBe(0);
    expect(lerRegistroDoTrafego().eventos).toEqual([]);
  });
});

describe('aprovar e descartar', () => {
  it('aprovar só muda o status e grava quem e quando; o diário lê da ação', () => {
    aprovarAcao('a1', 'quem', agora);
    const a1 = store.getSnapshot().actions[0];
    expect(a1).toMatchObject({ status: 'approved', approvedBy: 'quem', executedAt: null });
    const p = painel();
    expect(p.fila).toEqual([]);
    expect(p.diario.eventos[0]).toMatchObject({ tipo: 'aprovada', por: 'Pessoa de teste' });
  });

  it('descartar guarda o motivo na ação e a hora e o autor no registro', () => {
    descartarProposta('a1', 'O limite da conta já está no fim.', 'quem', agora);
    expect(store.getSnapshot().actions[0]).toMatchObject({
      status: 'discarded',
      result: 'O limite da conta já está no fim.',
    });
    expect(painel().diario.eventos[0]).toMatchObject({
      tipo: 'descartada',
      por: 'Pessoa de teste',
      citacao: 'O limite da conta já está no fim.',
    });
  });
});

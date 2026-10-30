import { describe, expect, it } from 'vitest';
import type { Connector, IgDaily, IgMedia } from '@csp-mkt/shared';
import { FILTROS_PADRAO, type Filtros } from '../../lib/url-state';
import { DADOS_VAZIOS, type Dados } from '../dados';
import { gerarDadosDeExemplo } from '../sample';
import { painelInstagram } from './instagram';

const agora = new Date('2026-10-30T15:00:00-03:00');
const f = (parcial: Partial<Filtros> = {}): Filtros => ({ ...FILTROS_PADRAO, ...parcial });

const dia = (p: Pick<IgDaily, 'date' | 'brandId' | 'followers' | 'reach'>): IgDaily => ({
  impressions: p.reach * 2,
  engagement: Math.round(p.reach / 10),
  ...p,
});

const post = (
  p: Pick<IgMedia, 'id' | 'brandId' | 'publishedAt' | 'reach' | 'likes' | 'comments' | 'saves'>,
): IgMedia => ({ type: 'reel', caption: 'Legenda de exemplo', ...p });

const conectorInstagram: Connector = {
  id: 'instagram',
  name: 'Instagram',
  status: 'late',
  lastSyncAt: '2026-10-30T11:50:00-03:00',
  expectedEveryMinutes: 60,
  errors24h: 2,
  rowsWritten: 10,
};

// Período "7d" em 30/10/2026 = 24/10 a 30/10; o anterior = 17/10 a 23/10.
const dados: Dados = {
  ...DADOS_VAZIOS,
  igDaily: [
    dia({ date: '2026-10-23', brandId: 'cs', followers: 100, reach: 10 }),
    dia({ date: '2026-10-24', brandId: 'cs', followers: 102, reach: 20 }),
    dia({ date: '2026-10-30', brandId: 'cs', followers: 110, reach: 30 }),
    dia({ date: '2026-10-29', brandId: 'plumene', followers: 50, reach: 5 }),
  ],
  igMedia: [
    post({
      id: 'p1',
      brandId: 'cs',
      publishedAt: '2026-10-25T10:00:00-03:00',
      reach: 200,
      likes: 10,
      comments: 5,
      saves: 5,
    }),
    post({
      id: 'p2',
      brandId: 'cs',
      publishedAt: '2026-10-20T10:00:00-03:00',
      reach: 900,
      likes: 90,
      comments: 9,
      saves: 9,
    }),
    post({
      id: 'p3',
      brandId: 'plumene',
      publishedAt: '2026-10-28T18:30:00-03:00',
      reach: 0,
      likes: 0,
      comments: 0,
      saves: 0,
    }),
  ],
  connectors: [conectorInstagram],
  geradoEm: '2026-10-30T15:00:00-03:00',
};

describe('painelInstagram', () => {
  it('em "As duas" traz os dois perfis, com a série diária de seguidores e de alcance', () => {
    const p = painelInstagram(dados, f({ periodo: '7d' }), agora);
    expect(p.intervalo).toMatchObject({ inicio: '2026-10-24', fim: '2026-10-30' });
    expect(p.perfis.map((x) => x.marca)).toEqual(['cs', 'plumene']);

    const cs = p.perfis[0]!;
    expect(cs.seguidoresPorDia).toHaveLength(7);
    expect(cs.seguidoresPorDia[0]).toEqual({ x: '2026-10-24', y: 102 });
    expect(cs.seguidoresPorDia[1]).toEqual({ x: '2026-10-25', y: null });
    expect(cs.seguidoresPorDia[6]).toEqual({ x: '2026-10-30', y: 110 });
    expect(cs.alcancePorDia[6]).toEqual({ x: '2026-10-30', y: 30 });
    expect(cs.seguidores).toBe(110);
    expect(cs.variacaoSeguidores.atual).toBe(10);
    expect(cs.alcance.atual).toBe(50);

    const plumene = p.perfis[1]!;
    expect(plumene.seguidoresPorDia.filter((d) => d.y !== null)).toEqual([{ x: '2026-10-29', y: 50 }]);
  });

  it('posts do período com engajamento = curtidas + comentários + salvos, do maior alcance para o menor', () => {
    const p = painelInstagram(dados, f({ periodo: '7d' }), agora);
    expect(p.posts.map((x) => x.id)).toEqual(['p1', 'p3']);
    expect(p.posts[0]).toMatchObject({ engajamento: 20, taxaEngajamento: 0.1 });
    // Post sem alcance não tem taxa (nunca NaN nem Infinity)
    expect(p.posts[1]).toMatchObject({ engajamento: 0, taxaEngajamento: null });
  });

  it('com uma marca escolhida, só o perfil e os posts dela', () => {
    const p = painelInstagram(dados, f({ periodo: '7d', marca: 'plumene' }), agora);
    expect(p.perfis.map((x) => x.marca)).toEqual(['plumene']);
    expect(p.posts.map((x) => x.id)).toEqual(['p3']);
  });

  it('traz o estado do conector do Instagram para o aviso de atraso', () => {
    const p = painelInstagram(dados, f(), agora);
    expect(p.temDados).toBe(true);
    expect(p.conector).toEqual({ status: 'late', lastSyncAt: '2026-10-30T11:50:00-03:00' });
  });

  it('sem nenhum número do Instagram: tudo null, séries sem valor e nada de NaN', () => {
    const p = painelInstagram({ ...DADOS_VAZIOS }, f(), agora);
    expect(p.temDados).toBe(false);
    expect(p.conector).toBeNull();
    expect(p.posts).toEqual([]);
    expect(p.perfis).toHaveLength(2);
    for (const perfil of p.perfis) {
      expect(perfil.seguidores).toBeNull();
      expect(perfil.alcance.atual).toBeNull();
      expect(perfil.salvos.atual).toBeNull();
      expect(perfil.posts).toBeNull();
      expect(perfil.seguidoresPorDia.every((d) => d.y === null)).toBe(true);
      expect(perfil.alcancePorDia.every((d) => d.y === null)).toBe(true);
    }
    expect(JSON.stringify(p)).not.toMatch(/NaN|Infinity/);
  });

  it('outras telas com dados e o Instagram sem nada: temDados false', () => {
    const p = painelInstagram({ ...DADOS_VAZIOS, connectors: [conectorInstagram] }, f(), agora);
    expect(p.temDados).toBe(false);
    expect(p.conector?.status).toBe('late');
  });

  it('com os dados de exemplo: os dois perfis têm números, taxas entre 0 e 1 e nada de NaN', () => {
    const exemplo = gerarDadosDeExemplo({ agora });
    const p = painelInstagram(exemplo, f(), agora);
    expect(p.temDados).toBe(true);
    expect(p.conector?.status).toBe('ok');
    for (const perfil of p.perfis) {
      expect(perfil.seguidores).toBeGreaterThan(0);
      expect(perfil.seguidoresPorDia.some((d) => d.y !== null)).toBe(true);
      expect(perfil.alcance.atual).toBeGreaterThan(0);
    }
    expect(p.posts.length).toBeGreaterThan(0);
    for (const x of p.posts) {
      expect(x.taxaEngajamento).not.toBeNull();
      expect(x.taxaEngajamento!).toBeGreaterThanOrEqual(0);
      expect(x.taxaEngajamento!).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < p.posts.length; i += 1) {
      expect(p.posts[i - 1]!.reach).toBeGreaterThanOrEqual(p.posts[i]!.reach);
    }
    expect(JSON.stringify(painelInstagram(exemplo, f({ periodo: '90d' }), agora))).not.toMatch(
      /NaN|Infinity/,
    );
  });
});

/**
 * Consulta da tela Instagram (`/instagram`). Parte de `instagram()` de `queries.ts` (a mesma conta
 * da Visão geral) e entrega pronto o que a tela desenha: a série diária de seguidores e de alcance
 * de cada perfil, o engajamento e a taxa de cada post e o estado do conector do Instagram.
 * Pura, com teste em `instagram.test.ts`; na fase 3 vira view SQL sobre `ig_account_daily` e
 * `ig_media`. Métrica sem base é `null`, nunca 0 nem NaN.
 */

import type { ConnectorStatus, IgMedia } from '@csp-mkt/shared';
import type { Intervalo } from '../../lib/periodo';
import type { Filtros } from '../../lib/url-state';
import type { Dados } from '../dados';
import { instagram, razao, type InstagramPorMarca } from '../queries';

/** Um ponto da série diária: dia `AAAA-MM-DD` e o número do dia (null quando não chegou). */
export interface PontoDiario {
  x: string;
  y: number | null;
}

/** Um perfil (uma marca): os números de `instagram()` + as séries diárias do período. */
export interface PerfilInstagram extends InstagramPorMarca {
  /** Seguidores no fim de cada dia do período. */
  seguidoresPorDia: PontoDiario[];
  /** Contas alcançadas em cada dia do período. */
  alcancePorDia: PontoDiario[];
}

/** Post publicado no período, com o engajamento já somado. */
export interface PostInstagram extends IgMedia {
  /** Curtidas + comentários + salvos do post. */
  engajamento: number;
  /** Engajamento ÷ alcance do post; null sem alcance. */
  taxaEngajamento: number | null;
}

/** O cartão do Instagram em Conectores, para avisar atraso e dizer quando sincronizou. */
export interface ConectorInstagram {
  status: ConnectorStatus;
  lastSyncAt: string | null;
}

export interface PainelInstagram {
  intervalo: Intervalo;
  /** Um por marca: as duas em "As duas", só a escolhida quando há marca. */
  perfis: PerfilInstagram[];
  /** Posts do período, do maior para o menor alcance. */
  posts: PostInstagram[];
  /** Algum número do Instagram chegou (diário ou de post)? */
  temDados: boolean;
  /** null quando o conector do Instagram não existe no conjunto. */
  conector: ConectorInstagram | null;
}

export function painelInstagram(dados: Dados, filtros: Filtros, agora: Date = new Date()): PainelInstagram {
  const base = instagram(dados, filtros, agora);

  const perfis = base.porMarca.map((perfil): PerfilInstagram => ({
    ...perfil,
    seguidoresPorDia: base.serie.map((dia) => ({
      x: dia.date,
      y: dia.porMarca[perfil.marca]?.followers ?? null,
    })),
    alcancePorDia: base.serie.map((dia) => ({
      x: dia.date,
      y: dia.porMarca[perfil.marca]?.reach ?? null,
    })),
  }));

  const posts = base.posts.map((post): PostInstagram => {
    const engajamento = post.likes + post.comments + post.saves;
    return { ...post, engajamento, taxaEngajamento: razao(engajamento, post.reach) };
  });

  const cartao = dados.connectors.find((c) => c.id === 'instagram');

  return {
    intervalo: base.intervalo,
    perfis,
    posts,
    temDados: dados.igDaily.length > 0 || dados.igMedia.length > 0,
    conector: cartao ? { status: cartao.status, lastSyncAt: cartao.lastSyncAt } : null,
  };
}

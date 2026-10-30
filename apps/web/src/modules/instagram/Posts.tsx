/**
 * Posts do período em tabela (vira cards no celular): miniatura sem imagem real (só o formato,
 * com aspect-ratio), legenda, tipo, data, alcance, engajamento com a taxa e salvos.
 * Abre do maior para o menor alcance; o título da coluna reordena por engajamento ou salvos.
 */

import {
  Camera,
  Clapperboard,
  GalleryHorizontalEnd,
  Image as IconeImagem,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { useId, useMemo } from 'react';
import { cor, rotulo, type IgMediaType } from '@csp-mkt/shared';
import { PontoDeSerie, Tabela, Vazio, type Coluna } from '../../components/ui';
import type { PostInstagram } from '../../data/queries/instagram';
import { dataHora, numero, percentual, plural } from '../../lib/format';
import { detalheEngajamento } from './textos';

const ICONE_DO_TIPO: Record<IgMediaType, LucideIcon> = {
  image: IconeImagem,
  carousel: GalleryHorizontalEnd,
  reel: Clapperboard,
  video: Video,
};

export interface PostsProps {
  posts: PostInstagram[];
  /** Em "As duas", cada post diz de qual perfil é. */
  mostrarMarca: boolean;
  estado: 'ok' | 'sem-dados';
}

function CelulaPost({ post, mostrarMarca }: { post: PostInstagram; mostrarMarca: boolean }) {
  const Icone = ICONE_DO_TIPO[post.type] ?? Camera;
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span
        className="grid w-9 shrink-0 place-items-center rounded-sm border border-line bg-panel text-decor"
        style={{ aspectRatio: '3 / 4' }}
        aria-hidden="true"
      >
        <Icone strokeWidth={1.75} />
      </span>
      <span className="grid min-w-0">
        <span className="max-w-60 truncate" title={post.caption}>
          {post.caption}
        </span>
        {mostrarMarca ? (
          <span className="yn-hint inline-flex items-center gap-1">
            <PontoDeSerie cor={cor('brand', post.brandId)} />
            {rotulo('brand', post.brandId)}
          </span>
        ) : null}
      </span>
    </span>
  );
}

export function Posts({ posts, mostrarMarca, estado }: PostsProps) {
  const idTitulo = useId();

  const colunas = useMemo<Coluna<PostInstagram>[]>(
    () => [
      {
        chave: 'post',
        titulo: 'Post',
        render: (p) => <CelulaPost post={p} mostrarMarca={mostrarMarca} />,
      },
      {
        chave: 'tipo',
        titulo: 'Tipo',
        valor: (p) => rotulo('igMediaType', p.type),
        render: (p) => <span className="yn-chip">{rotulo('igMediaType', p.type)}</span>,
      },
      {
        chave: 'data',
        titulo: 'Data',
        valor: (p) => p.publishedAt,
        render: (p) => dataHora(p.publishedAt),
      },
      {
        chave: 'alcance',
        titulo: 'Alcance',
        numerica: true,
        valor: (p) => p.reach,
        render: (p) => numero(p.reach),
      },
      {
        chave: 'engajamento',
        titulo: 'Engajamento',
        numerica: true,
        valor: (p) => p.engajamento,
        render: (p) => (
          <span
            className="inline-grid justify-items-end"
            title={detalheEngajamento(p.likes, p.comments, p.saves)}
          >
            <span>{numero(p.engajamento)}</span>
            {p.taxaEngajamento !== null ? (
              <span className="yn-hint">{percentual(p.taxaEngajamento)} do alcance</span>
            ) : null}
          </span>
        ),
      },
      {
        chave: 'salvos',
        titulo: 'Salvos',
        numerica: true,
        valor: (p) => p.saves,
        render: (p) => numero(p.saves),
      },
    ],
    [mostrarMarca],
  );

  const vazio =
    estado === 'sem-dados' ? (
      <div className="yn-card">
        <Vazio icone={Camera} titulo="Sem dados" texto="Nenhum post chegou do Instagram para este período." />
      </div>
    ) : (
      <div className="yn-card">
        <Vazio
          icone={Camera}
          titulo="Nenhum post no período"
          texto="Escolha um período maior em Período para ver os posts."
        />
      </div>
    );

  return (
    <section className="mkt-stack min-w-0" aria-labelledby={idTitulo}>
      <div className="mkt-chart__head">
        <div>
          <h2 id={idTitulo}>Posts do período</h2>
          <p className="yn-muted text-sm">Do maior para o menor alcance.</p>
        </div>
        {posts.length > 0 ? (
          <p className="yn-muted text-sm">{plural(posts.length, 'post', 'posts')}</p>
        ) : null}
      </div>
      <Tabela
        colunas={colunas}
        linhas={posts}
        chaveDaLinha={(p) => p.id}
        empilhar
        ordenacaoInicial={{ chave: 'alcance', direcao: 'desc' }}
        legenda="Posts do período, com alcance, engajamento e salvos"
        vazio={vazio}
      />
    </section>
  );
}

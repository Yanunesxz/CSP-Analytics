/**
 * Papéis e o que cada um pode fazer: um cartão por papel (Dono, Gestor de tráfego), lado a lado no
 * computador e um embaixo do outro quando aperta. As listas "Pode" e "Não pode" saem de
 * `quadroDePermissoes()`, que lê `permissoes()` de packages/shared: a mesma regra do menu, da rota
 * protegida e da RLS (decisão 0011). A tela não guarda uma segunda lista.
 */

import { Check, Minus, type LucideIcon } from 'lucide-react';
import { useId } from 'react';
import type { Role } from '@csp-mkt/shared';
import type { PapelNoQuadro, PermissaoNoQuadro } from '../../data/queries/sistema';
import { textoDaQuantidade } from './textos';

export interface PapeisEPermissoesProps {
  quadro: readonly PapelNoQuadro[];
  /** Pessoas por papel; sem ele (carregando, erro, vazio), a contagem não aparece. */
  porPapel?: Record<Role, number | null>;
}

export function PapeisEPermissoes({ quadro, porPapel }: PapeisEPermissoesProps) {
  const idTitulo = useId();
  return (
    <section className="mkt-stack min-w-0" aria-labelledby={idTitulo}>
      <div>
        <h2 id={idTitulo}>Papéis</h2>
        <p className="yn-muted text-sm">
          O papel decide o que cada pessoa pode ver e fazer. A Visão no topo (Visualizador ou Gestor de
          tráfego) só muda o que a tela mostra, não o que a pessoa pode.
        </p>
      </div>
      <div className="mkt-grid-2">
        {quadro.map((p) => (
          <CartaoDoPapel key={p.papel} papel={p} quantidade={porPapel ? porPapel[p.papel] : undefined} />
        ))}
      </div>
    </section>
  );
}

function CartaoDoPapel({ papel, quantidade }: { papel: PapelNoQuadro; quantidade?: number | null }) {
  const idTitulo = useId();
  return (
    <article className="yn-card mkt-stack min-w-0" aria-labelledby={idTitulo}>
      <div className="grid gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 id={idTitulo}>{papel.rotulo}</h3>
          {quantidade !== undefined ? (
            <span className="yn-muted text-sm tabular-nums">{textoDaQuantidade(quantidade)}</span>
          ) : null}
        </div>
        <p className="yn-muted text-sm">{papel.resumo}</p>
      </div>
      <ListaDePermissoes titulo="Pode" itens={papel.pode} icone={Check} />
      {papel.naoPode.length > 0 ? (
        <ListaDePermissoes titulo="Não pode" itens={papel.naoPode} icone={Minus} apagada />
      ) : null}
    </article>
  );
}

function ListaDePermissoes({
  titulo,
  itens,
  icone: Icone,
  apagada = false,
}: {
  titulo: string;
  itens: PermissaoNoQuadro[];
  icone: LucideIcon;
  /** "Não pode": texto secundário. */
  apagada?: boolean;
}) {
  const idTitulo = useId();
  return (
    <div className="grid gap-2">
      <h4 className="yn-eyebrow" id={idTitulo}>
        {titulo}
      </h4>
      <ul className={`grid gap-2 text-sm${apagada ? ' yn-muted' : ''}`} aria-labelledby={idTitulo}>
        {itens.map((item) => (
          <li key={item.acao} className="flex items-start gap-2">
            <Icone strokeWidth={1.75} aria-hidden="true" className="mt-0.5" />
            <span className="min-w-0">
              {item.rotulo}
              {item.nota ? <span className="yn-hint block">{item.nota}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

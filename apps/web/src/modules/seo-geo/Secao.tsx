/**
 * Uma seção da tela por fonte de dados: rótulo (h2 no estilo .yn-eyebrow, para os títulos dos cartões
 * de dentro ficarem em destaque), o que ela mostra e o selo da fonte no canto
 * ("Search Console · atualizado há 6 h"; o estado vira .yn-badge quando não está funcionando).
 * Uma linha separa as seções (lei da proximidade: grupos a 24px ou mais).
 */

import { useId, type ReactNode } from 'react';
import { Badge } from '../../components/ui';
import type { FonteDoPainel } from '../../data/queries/seo-geo';
import { frescorDaFonte } from './textos';

export interface SecaoProps {
  titulo: string;
  descricao: string;
  /** Nome e cartão do conector da fonte; sem `fonte`, o canto fica vazio. */
  fonte?: { nome: string; cartao: FonteDoPainel | null };
  children: ReactNode;
}

export function Secao({ titulo, descricao, fonte, children }: SecaoProps) {
  const id = useId();
  return (
    <section className="mkt-stack min-w-0 border-t border-line pt-6" aria-labelledby={id}>
      <div className="mkt-chart__head">
        <div className="grid min-w-0 gap-1">
          <h2 id={id} className="yn-eyebrow">
            {titulo}
          </h2>
          <p className="yn-muted text-sm">{descricao}</p>
        </div>
        {fonte ? <SeloDaFonte nome={fonte.nome} cartao={fonte.cartao} /> : null}
      </div>
      {children}
    </section>
  );
}

function SeloDaFonte({ nome, cartao }: { nome: string; cartao: FonteDoPainel | null }) {
  const frescor = frescorDaFonte(cartao);
  return (
    <p className="yn-muted flex flex-wrap items-center gap-2 text-sm">
      <span>{nome}</span>
      {cartao && cartao.status !== 'ok' ? <Badge lista="connectorStatus" codigo={cartao.status} /> : null}
      {frescor ? <span>· {frescor}</span> : null}
    </p>
  );
}

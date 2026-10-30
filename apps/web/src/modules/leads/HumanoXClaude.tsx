/**
 * Humano × Claude nos leads de campanha (só na visão Gestor de tráfego): a mesma linha de números
 * lado a lado, com a diferença do Claude em relação ao humano (decisão 0008). A cor da diferença
 * diz se é melhor ou pior; investimento não é bom nem ruim, então fica sem cor.
 */

import { useId } from 'react';
import { ChipSerie, Tabela, formatarValor, type Coluna } from '../../components/ui';
import type { LinhaOperador } from '../../data/queries';
import { variacao } from '../../lib/format';

/** Linhas cuja diferença não é melhor nem pior. */
const NEUTRAS = new Set(['investimento']);

function Diferenca({ linha }: { linha: LinhaOperador }) {
  const d = linha.diferenca;
  if (d === null) return <span className="yn-muted">—</span>;
  const neutra = NEUTRAS.has(linha.chave) || d === 0;
  const melhor = linha.menorEhMelhor ? d < 0 : d > 0;
  const classe = neutra ? undefined : melhor ? 'text-tone-success' : 'text-tone-danger';
  return <span className={classe}>{variacao(d)}</span>;
}

const COLUNAS: Coluna<LinhaOperador>[] = [
  { chave: 'metrica', titulo: 'Número', render: (l) => l.rotulo },
  { chave: 'humano', titulo: 'Humano', numerica: true, render: (l) => formatarValor(l.humano, l.formato) },
  { chave: 'claude', titulo: 'Claude', numerica: true, render: (l) => formatarValor(l.claude, l.formato) },
  { chave: 'diferenca', titulo: 'Diferença', numerica: true, render: (l) => <Diferenca linha={l} /> },
];

export function HumanoXClaude({ linhas }: { linhas: LinhaOperador[] }) {
  const idTitulo = useId();
  return (
    <section className="mkt-stack min-w-0" aria-labelledby={idTitulo}>
      <div className="mkt-chart__head">
        <div>
          <h2 id={idTitulo}>Humano × Claude</h2>
          <p className="yn-muted text-sm">
            Leads das campanhas de cada operador no período. A diferença é do Claude em relação ao humano.
          </p>
        </div>
        <div className="mkt-chart__legend" role="group" aria-label="Legenda">
          <ChipSerie lista="operator" codigo="human" />
          <ChipSerie lista="operator" codigo="claude" />
        </div>
      </div>
      <Tabela
        colunas={COLUNAS}
        linhas={linhas}
        chaveDaLinha={(l) => l.chave}
        empilhar
        legenda="Humano × Claude"
      />
    </section>
  );
}

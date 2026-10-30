/**
 * Visão Gestor de tráfego: a mesma linha de métricas para o Humano e para o Claude, lado a lado,
 * com a diferença em % (decisão 0008). Em custo e ROAS a diferença diz se o Claude foi melhor
 * ou pior em texto, e a cor só reforça.
 */

import { Tabela, formatarValor, type Coluna } from '../../components/ui';
import type { LinhaHumanoClaude } from '../../data/queries/visao-geral';
import { variacao } from '../../lib/format';

function Diferenca({ linha }: { linha: LinhaHumanoClaude }) {
  if (linha.diferenca === null) return <>—</>;
  const texto = variacao(linha.diferenca);
  if (linha.claudeMelhor === null) return <span className="yn-kpi__delta">{texto}</span>;
  return (
    <span className={`yn-kpi__delta ${linha.claudeMelhor ? 'yn-kpi__delta--up' : 'yn-kpi__delta--down'}`}>
      {texto} · {linha.claudeMelhor ? 'melhor' : 'pior'}
    </span>
  );
}

const COLUNAS: Coluna<LinhaHumanoClaude>[] = [
  { chave: 'metrica', titulo: 'Métrica', render: (l) => l.rotulo },
  {
    chave: 'humano',
    titulo: 'Humano',
    numerica: true,
    ordenavel: false,
    render: (l) => formatarValor(l.humano, l.formato),
  },
  {
    chave: 'claude',
    titulo: 'Claude',
    numerica: true,
    ordenavel: false,
    render: (l) => formatarValor(l.claude, l.formato),
  },
  {
    chave: 'diferenca',
    titulo: 'Claude vs. Humano',
    numerica: true,
    ordenavel: false,
    render: (l) => <Diferenca linha={l} />,
  },
];

export function HumanoXClaude({ linhas }: { linhas: LinhaHumanoClaude[] }) {
  return (
    <section className="mkt-stack" aria-labelledby="visao-geral-operador">
      <div className="grid gap-1">
        <h2 id="visao-geral-operador">Humano × Claude</h2>
        <p className="yn-muted text-sm">
          Cada campanha tem um dono. A última coluna mostra quanto o Claude ficou acima ou abaixo do Humano no
          período.
        </p>
      </div>
      <div className="yn-container">
        <Tabela
          colunas={COLUNAS}
          linhas={linhas}
          chaveDaLinha={(l) => l.chave}
          empilhar
          legenda="Humano × Claude no período"
        />
      </div>
    </section>
  );
}

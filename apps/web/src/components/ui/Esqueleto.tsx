/**
 * Carregando (.yn-skeleton): linhas de texto, grade de KPIs, gráfico ou tela inteira.
 */

export interface EsqueletoProps {
  variante?: 'texto' | 'kpis' | 'grafico' | 'tabela' | 'tela';
  /** Linhas (texto/tabela) ou cards (kpis). */
  quantidade?: number;
}

function Linhas({ quantidade }: { quantidade: number }) {
  return (
    <div className="mkt-stack" style={{ gap: 'var(--space-3)' }}>
      {Array.from({ length: quantidade }, (_, i) => (
        <div key={i} className="yn-skeleton" style={{ width: `${100 - (i % 3) * 18}%` }} />
      ))}
    </div>
  );
}

function Kpis({ quantidade }: { quantidade: number }) {
  return (
    <div className="mkt-grid-kpis">
      {Array.from({ length: quantidade }, (_, i) => (
        <div key={i} className="yn-card yn-kpi">
          <div className="yn-skeleton" style={{ width: '50%' }} />
          <div className="yn-skeleton" style={{ width: '70%', height: 'var(--space-6)' }} />
          <div className="yn-skeleton" style={{ width: '40%' }} />
        </div>
      ))}
    </div>
  );
}

function Grafico() {
  return (
    <div className="yn-card mkt-chart">
      <div className="yn-skeleton" style={{ width: '30%' }} />
      <div className="yn-skeleton" style={{ height: '160px' }} />
      <div className="yn-skeleton" style={{ width: '20%' }} />
    </div>
  );
}

export function Esqueleto({ variante = 'texto', quantidade }: EsqueletoProps) {
  const conteudo =
    variante === 'kpis' ? (
      <Kpis quantidade={quantidade ?? 4} />
    ) : variante === 'grafico' ? (
      <Grafico />
    ) : variante === 'tabela' ? (
      <div className="yn-card">
        <Linhas quantidade={quantidade ?? 6} />
      </div>
    ) : variante === 'tela' ? (
      <>
        <Kpis quantidade={quantidade ?? 4} />
        <div className="mkt-grid-2">
          <Grafico />
          <Grafico />
        </div>
      </>
    ) : (
      <Linhas quantidade={quantidade ?? 3} />
    );
  return (
    <div className="mkt-stack" aria-busy="true" aria-label="Carregando" role="status">
      {conteudo}
    </div>
  );
}

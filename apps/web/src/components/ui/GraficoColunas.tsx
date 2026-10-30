/**
 * Colunas em pé (.yn-columns): valor por dia, semana ou mês. Sempre com "Ver como tabela".
 */

import { ChartNoAxesColumn } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { numero } from '../../lib/format';
import { AsTable } from './AsTable';
import { Esqueleto } from './Esqueleto';
import type { EstadoGrafico } from './GraficoLinha';
import { Vazio } from './Vazio';

export interface Coluna {
  rotulo: string;
  valor: number | null;
  cor?: string;
  tom?: 'success' | 'warning' | 'danger' | 'muted';
}

export interface GraficoColunasProps {
  titulo: string;
  descricao?: string;
  colunas: Coluna[];
  formato?: (valor: number) => string;
  maximo?: number;
  /** Altura das colunas em px (`--chart-height`). */
  altura?: number;
  estado?: EstadoGrafico;
  aoTentarDeNovo?: () => void;
  codigoErro?: string | null;
  rotuloValor?: string;
}

export function GraficoColunas({
  titulo,
  descricao,
  colunas,
  formato = (v) => numero(v),
  maximo,
  altura,
  estado = 'ok',
  aoTentarDeNovo,
  codigoErro,
  rotuloValor = 'Valor',
}: GraficoColunasProps) {
  const idTitulo = useId();
  const valores = colunas.map((c) => c.valor).filter((v): v is number => v !== null && Number.isFinite(v));
  const teto = maximo ?? (valores.length ? Math.max(...valores) : 0);
  const semDados = estado === 'semDados' || valores.length === 0;

  let corpo: ReactNode;
  if (estado === 'carregando') corpo = <Esqueleto variante="grafico" />;
  else if (estado === 'erro')
    corpo = (
      <Vazio
        erro
        titulo="Não deu para carregar o gráfico"
        texto="Tente de novo em alguns segundos."
        codigo={codigoErro}
        aoTentarDeNovo={aoTentarDeNovo}
      />
    );
  else if (semDados)
    corpo = (
      <Vazio
        icone={ChartNoAxesColumn}
        titulo="Sem dados"
        texto="Nenhum número no período para este gráfico."
      />
    );
  else
    corpo = (
      <>
        <div
          className="yn-columns"
          style={altura ? { ['--chart-height' as string]: `${altura}px` } : undefined}
        >
          {colunas.map((c, i) => (
            <div
              key={`${c.rotulo}-${i}`}
              className="yn-columns__col"
              data-tone={c.tom}
              style={{ ['--value' as string]: c.valor === null || teto === 0 ? 0 : (c.valor / teto) * 100 }}
              title={`${c.rotulo}: ${c.valor === null ? 'Sem dados' : formato(c.valor)}`}
            >
              <span className="yn-columns__bar" style={c.cor ? { background: c.cor } : undefined} />
              <span>{c.rotulo}</span>
            </div>
          ))}
        </div>
        <AsTable
          legenda={titulo}
          colunas={['Item', rotuloValor]}
          linhas={colunas.map((c) => [c.rotulo, c.valor === null ? '—' : formato(c.valor)])}
        />
      </>
    );

  return (
    <section className="yn-card mkt-chart" aria-labelledby={idTitulo}>
      <div className="mkt-chart__head">
        <div>
          <h2 id={idTitulo}>{titulo}</h2>
          {descricao ? <p className="yn-muted text-sm">{descricao}</p> : null}
        </div>
      </div>
      {corpo}
    </section>
  );
}

/**
 * Gráfico de linha em SVG próprio (decisão 0002): 1 a 6 séries com --color-series-N, eixo x por
 * data, eixo y, legenda com rótulo, ponto com <title>, área opcional, estados "Sem dados" e erro,
 * e SEMPRE "Ver como tabela" com os mesmos números. Responsivo pelo espaço (viewBox segue a largura).
 */

import { ChartLine } from 'lucide-react';
import { useId, useMemo, useRef, type ReactNode } from 'react';
import { data, diaMes, numero, numeroAbreviado } from '../../lib/format';
import { AsTable } from './AsTable';
import { ChipSerie } from './ChipSerie';
import { Esqueleto } from './Esqueleto';
import { Vazio } from './Vazio';
import { useLargura } from './useLargura';

export interface PontoLinha {
  /** Dia `AAAA-MM-DD`. */
  x: string;
  y: number | null;
}

export interface SerieLinha {
  id: string;
  rotulo: string;
  /** Token: "var(--color-series-N)" (use `cor(lista, codigo)` de @csp-mkt/shared). */
  cor: string;
  pontos: PontoLinha[];
}

export type EstadoGrafico = 'ok' | 'semDados' | 'erro' | 'carregando';

export interface GraficoLinhaProps {
  titulo: string;
  descricao?: string;
  series: SerieLinha[];
  /** Formato dos valores na tabela e no <title> dos pontos. */
  formato?: (valor: number) => string;
  /** Formato do eixo y (padrão: número abreviado). */
  formatoEixo?: (valor: number) => string;
  area?: boolean;
  /** Altura do desenho em px. */
  altura?: number;
  estado?: EstadoGrafico;
  aoTentarDeNovo?: () => void;
  codigoErro?: string | null;
}

const MARGEM = { topo: 12, direita: 12, baixo: 28, esquerda: 48 };

/** Passo "redondo" para o eixo y (1, 2, 5 × 10^n). */
function passoRedondo(maximo: number, divisoes: number): number {
  const bruto = maximo / divisoes;
  const potencia = 10 ** Math.floor(Math.log10(bruto || 1));
  const normalizado = bruto / potencia;
  const fator = normalizado <= 1 ? 1 : normalizado <= 2 ? 2 : normalizado <= 5 ? 5 : 10;
  return fator * potencia;
}

export function GraficoLinha({
  titulo,
  descricao,
  series,
  formato = (v) => numero(v),
  formatoEixo = (v) => numeroAbreviado(v),
  area = false,
  altura = 240,
  estado = 'ok',
  aoTentarDeNovo,
  codigoErro,
}: GraficoLinhaProps) {
  const ref = useRef<HTMLDivElement>(null);
  const largura = useLargura(ref);
  const idTitulo = useId();

  const modelo = useMemo(() => {
    const xs = [...new Set(series.flatMap((s) => s.pontos.map((p) => p.x)))].sort();
    const valores = series
      .flatMap((s) => s.pontos.map((p) => p.y))
      .filter((v): v is number => v !== null && Number.isFinite(v));
    if (xs.length === 0 || valores.length === 0) return null;
    const maximoBruto = Math.max(...valores, 0);
    const passo = passoRedondo(maximoBruto || 1, 4);
    const maximo = Math.max(passo, Math.ceil(maximoBruto / passo) * passo);
    const larguraUtil = Math.max(1, largura - MARGEM.esquerda - MARGEM.direita);
    const alturaUtil = Math.max(1, altura - MARGEM.topo - MARGEM.baixo);
    const xDe = (i: number) =>
      MARGEM.esquerda + (xs.length === 1 ? larguraUtil / 2 : (i / (xs.length - 1)) * larguraUtil);
    const yDe = (v: number) => MARGEM.topo + alturaUtil - (v / maximo) * alturaUtil;
    const indice = new Map(xs.map((x, i) => [x, i]));
    const linhas = series.map((s) => {
      const porX = new Map(s.pontos.map((p) => [p.x, p.y]));
      const segmentos: string[] = [];
      let atual: string[] = [];
      const areaPontos: Array<[number, number]> = [];
      for (const x of xs) {
        const y = porX.get(x);
        if (y === null || y === undefined) {
          if (atual.length) segmentos.push(atual.join(' '));
          atual = [];
          continue;
        }
        const px = xDe(indice.get(x) ?? 0);
        const py = yDe(y);
        atual.push(`${atual.length ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`);
        areaPontos.push([px, py]);
      }
      if (atual.length) segmentos.push(atual.join(' '));
      const base = yDe(0);
      const areaPath =
        areaPontos.length > 1
          ? `M${areaPontos[0]![0].toFixed(1)},${base.toFixed(1)} ` +
            areaPontos.map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`).join(' ') +
            ` L${areaPontos[areaPontos.length - 1]![0].toFixed(1)},${base.toFixed(1)} Z`
          : '';
      return { serie: s, caminho: segmentos.join(' '), areaPath, porX };
    });
    const divisoes = Math.round(maximo / passo);
    const gradeY = Array.from({ length: divisoes + 1 }, (_, i) => i * passo);
    const quantidadeTicks = Math.min(xs.length, Math.max(2, Math.floor(larguraUtil / 90)));
    const ticksX = Array.from({ length: quantidadeTicks }, (_, i) =>
      Math.round((i / Math.max(1, quantidadeTicks - 1)) * (xs.length - 1)),
    );
    return { xs, maximo, xDe, yDe, linhas, gradeY, ticksX: [...new Set(ticksX)] };
  }, [series, largura, altura]);

  const cabecalho = (
    <div className="mkt-chart__head">
      <div>
        <h2 id={idTitulo}>{titulo}</h2>
        {descricao ? <p className="yn-muted text-sm">{descricao}</p> : null}
      </div>
      {series.length > 0 ? (
        <div className="mkt-chart__legend" aria-label="Legenda">
          {series.map((s) => (
            <ChipSerie key={s.id} rotulo={s.rotulo} cor={s.cor} />
          ))}
        </div>
      ) : null}
    </div>
  );

  let corpo: ReactNode;
  if (estado === 'carregando') {
    corpo = <Esqueleto variante="grafico" />;
  } else if (estado === 'erro') {
    corpo = (
      <Vazio
        erro
        titulo="Não deu para carregar o gráfico"
        texto="Tente de novo em alguns segundos."
        codigo={codigoErro}
        aoTentarDeNovo={aoTentarDeNovo}
      />
    );
  } else if (estado === 'semDados' || !modelo) {
    corpo = (
      <Vazio icone={ChartLine} titulo="Sem dados" texto="Nenhum número no período para este gráfico." />
    );
  } else {
    corpo = (
      <>
        <svg
          viewBox={`0 0 ${largura} ${altura}`}
          width="100%"
          height={altura}
          role="img"
          aria-labelledby={idTitulo}
          style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)' }}
        >
          {modelo.gradeY.map((v) => (
            <g key={v}>
              <line
                x1={MARGEM.esquerda}
                x2={largura - MARGEM.direita}
                y1={modelo.yDe(v)}
                y2={modelo.yDe(v)}
                style={{ stroke: 'var(--color-border)' }}
              />
              <text
                x={MARGEM.esquerda - 8}
                y={modelo.yDe(v) + 4}
                textAnchor="end"
                style={{ fill: 'var(--color-text-muted)' }}
              >
                {formatoEixo(v)}
              </text>
            </g>
          ))}
          {modelo.ticksX.map((i) => (
            <text
              key={i}
              x={modelo.xDe(i)}
              y={altura - 8}
              textAnchor="middle"
              style={{ fill: 'var(--color-text-muted)' }}
            >
              {diaMes(modelo.xs[i] ?? '')}
            </text>
          ))}
          {modelo.linhas.map(({ serie, caminho, areaPath }) => (
            <g key={serie.id}>
              {area && areaPath ? <path d={areaPath} style={{ fill: serie.cor, fillOpacity: 0.12 }} /> : null}
              <path
                d={caminho}
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                style={{ stroke: serie.cor }}
              />
            </g>
          ))}
          {modelo.linhas.map(({ serie, porX }) =>
            modelo.xs.map((x, i) => {
              const y = porX.get(x);
              if (y === null || y === undefined) return null;
              return (
                <circle
                  key={`${serie.id}-${x}`}
                  cx={modelo.xDe(i)}
                  cy={modelo.yDe(y)}
                  r={3}
                  style={{ fill: serie.cor }}
                >
                  <title>{`${serie.rotulo} · ${data(x)} · ${formato(y)}`}</title>
                </circle>
              );
            }),
          )}
        </svg>
        <AsTable
          legenda={titulo}
          colunas={['Data', ...series.map((s) => s.rotulo)]}
          linhas={modelo.xs.map((x) => [
            data(x),
            ...modelo.linhas.map(({ porX }) => {
              const y = porX.get(x);
              return y === null || y === undefined ? '—' : formato(y);
            }),
          ])}
        />
      </>
    );
  }

  return (
    <section className="yn-card mkt-chart" aria-labelledby={idTitulo}>
      {cabecalho}
      <div ref={ref} className="min-w-0">
        {corpo}
      </div>
    </section>
  );
}

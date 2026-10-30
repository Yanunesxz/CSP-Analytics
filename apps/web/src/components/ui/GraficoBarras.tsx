/**
 * Barras deitadas (.yn-bars): ranking e comparação por categoria. Cor por tom de status
 * (data-tone) ou por série (token), sempre com "Ver como tabela".
 */

import { ChartNoAxesColumn } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { numero } from '../../lib/format';
import { AsTable } from './AsTable';
import { Esqueleto } from './Esqueleto';
import type { EstadoGrafico } from './GraficoLinha';
import { Vazio } from './Vazio';

export interface ItemBarra {
  rotulo: string;
  valor: number | null;
  /** Token de série, ex.: cor('platform', 'meta'). */
  cor?: string;
  tom?: 'success' | 'warning' | 'danger' | 'muted';
  /** Texto extra ao lado do valor na tabela (ex.: "12 leads"). */
  detalhe?: string;
}

export interface GraficoBarrasProps {
  titulo: string;
  descricao?: string;
  itens: ItemBarra[];
  formato?: (valor: number) => string;
  /** Valor que vale 100%; padrão: o maior item. */
  maximo?: number;
  estado?: EstadoGrafico;
  aoTentarDeNovo?: () => void;
  codigoErro?: string | null;
  /** Rótulo da coluna de valor na tabela. */
  rotuloValor?: string;
}

export function GraficoBarras({
  titulo,
  descricao,
  itens,
  formato = (v) => numero(v),
  maximo,
  estado = 'ok',
  aoTentarDeNovo,
  codigoErro,
  rotuloValor = 'Valor',
}: GraficoBarrasProps) {
  const idTitulo = useId();
  const valores = itens.map((i) => i.valor).filter((v): v is number => v !== null && Number.isFinite(v));
  const teto = maximo ?? (valores.length ? Math.max(...valores) : 0);
  const semDados = estado === 'semDados' || valores.length === 0;

  let corpo: ReactNode;
  if (estado === 'carregando') corpo = <Esqueleto variante="texto" quantidade={5} />;
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
        <ul className="yn-bars">
          {itens.map((item, i) => (
            <li
              key={`${item.rotulo}-${i}`}
              className="yn-bars__row"
              data-tone={item.tom}
              style={{
                ['--value' as string]: item.valor === null || teto === 0 ? 0 : (item.valor / teto) * 100,
              }}
            >
              <span className="yn-bars__label" title={item.rotulo}>
                {item.rotulo}
              </span>
              <span className="yn-bars__track">
                <span className="yn-bars__fill" style={item.cor ? { background: item.cor } : undefined} />
              </span>
              <span className="yn-bars__value">{item.valor === null ? '—' : formato(item.valor)}</span>
            </li>
          ))}
        </ul>
        <AsTable
          legenda={titulo}
          colunas={itens.some((i) => i.detalhe) ? ['Item', rotuloValor, 'Detalhe'] : ['Item', rotuloValor]}
          linhas={itens.map((i) =>
            itens.some((x) => x.detalhe)
              ? [i.rotulo, i.valor === null ? '—' : formato(i.valor), i.detalhe ?? '—']
              : [i.rotulo, i.valor === null ? '—' : formato(i.valor)],
          )}
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

/**
 * "Ver como tabela": obrigatório em todo gráfico (decisão 0002).
 * <details class="yn-as-table"> com os mesmos números do gráfico numa .yn-table.
 */

import type { ReactNode } from 'react';

export interface AsTableProps {
  /** Cabeçalhos das colunas; a primeira é o rótulo da linha. */
  colunas: string[];
  /** Cada linha: primeira célula é texto, as demais são números já formatados (ou "—"). */
  linhas: Array<Array<ReactNode>>;
  legenda?: string;
  /** Índices das colunas que são texto, não número (ex.: "Detalhe"): alinham à esquerda e quebram linha. */
  texto?: number[];
}

export function AsTable({ colunas, linhas, legenda, texto = [] }: AsTableProps) {
  const ehNumero = (coluna: number) => coluna > 0 && !texto.includes(coluna);
  return (
    <details className="yn-as-table">
      <summary>Ver como tabela</summary>
      <div className="yn-table-wrap">
        <table className="yn-table">
          {legenda ? <caption className="yn-sr-only">{legenda}</caption> : null}
          <thead>
            <tr>
              {colunas.map((c, i) => (
                <th key={c} className={ehNumero(i) ? 'yn-num' : undefined} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha, i) => (
              <tr key={i}>
                {linha.map((celula, j) => (
                  <td key={j} className={ehNumero(j) ? 'yn-num' : undefined}>
                    {celula}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

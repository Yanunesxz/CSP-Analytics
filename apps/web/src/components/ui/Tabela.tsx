/**
 * Tabela (.yn-table-wrap > .yn-table) com ordenação simples, números à direita (.yn-num) e,
 * com `empilhar`, cards no celular (.yn-table--stack + data-label).
 */

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

export interface Coluna<T> {
  chave: string;
  titulo: string;
  /** Alinha à direita com números tabulares. */
  numerica?: boolean;
  /** Valor cru, usado para ordenar e, sem `render`, para mostrar. */
  valor?: (linha: T) => string | number | null | undefined;
  /** Como desenhar a célula (badge, link, chip). */
  render?: (linha: T) => ReactNode;
  /** Padrão: ordenável quando há `valor`. */
  ordenavel?: boolean;
}

export interface Ordenacao {
  chave: string;
  direcao: 'asc' | 'desc';
}

export interface TabelaProps<T> {
  colunas: Coluna<T>[];
  linhas: T[];
  chaveDaLinha: (linha: T) => string;
  /** Vira cards abaixo de 640px de área. */
  empilhar?: boolean;
  ordenacaoInicial?: Ordenacao;
  /** Legenda para leitor de tela. */
  legenda?: string;
  /** O que mostrar sem linhas (um <Vazio>). */
  vazio?: ReactNode;
  /** Destaque da linha (aria-selected). */
  selecionada?: (linha: T) => boolean;
}

function comparar(a: string | number | null | undefined, b: string | number | null | undefined): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' });
}

export function Tabela<T>({
  colunas,
  linhas,
  chaveDaLinha,
  empilhar = false,
  ordenacaoInicial,
  legenda,
  vazio,
  selecionada,
}: TabelaProps<T>) {
  const [ordenacao, setOrdenacao] = useState<Ordenacao | null>(ordenacaoInicial ?? null);

  const ordenadas = useMemo(() => {
    if (!ordenacao) return linhas;
    const coluna = colunas.find((c) => c.chave === ordenacao.chave);
    if (!coluna?.valor) return linhas;
    const valor = coluna.valor;
    const sinal = ordenacao.direcao === 'asc' ? 1 : -1;
    return [...linhas].sort((a, b) => comparar(valor(a), valor(b)) * sinal);
  }, [linhas, colunas, ordenacao]);

  const alternar = (coluna: Coluna<T>) => {
    setOrdenacao((atual) => {
      if (atual?.chave !== coluna.chave)
        return { chave: coluna.chave, direcao: coluna.numerica ? 'desc' : 'asc' };
      return { chave: coluna.chave, direcao: atual.direcao === 'asc' ? 'desc' : 'asc' };
    });
  };

  if (linhas.length === 0 && vazio) return <>{vazio}</>;

  return (
    <div className="yn-table-wrap">
      <table className={`yn-table${empilhar ? ' yn-table--stack' : ''}`}>
        {legenda ? <caption className="yn-sr-only">{legenda}</caption> : null}
        <thead>
          <tr>
            {colunas.map((coluna) => {
              const ordenavel = coluna.ordenavel ?? Boolean(coluna.valor);
              const ativa = ordenacao?.chave === coluna.chave;
              const Seta = !ativa ? ArrowUpDown : ordenacao?.direcao === 'asc' ? ArrowUp : ArrowDown;
              return (
                <th
                  key={coluna.chave}
                  scope="col"
                  className={coluna.numerica ? 'yn-num' : undefined}
                  aria-sort={ativa ? (ordenacao?.direcao === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {ordenavel ? (
                    <button
                      type="button"
                      className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0"
                      style={{
                        font: 'inherit',
                        letterSpacing: 'inherit',
                        textTransform: 'inherit',
                        color: 'inherit',
                      }}
                      onClick={() => alternar(coluna)}
                      title={`Ordenar por ${coluna.titulo}`}
                    >
                      {coluna.titulo}
                      <Seta strokeWidth={1.75} aria-hidden="true" className="size-3.5" />
                    </button>
                  ) : (
                    coluna.titulo
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((linha) => (
            <tr key={chaveDaLinha(linha)} aria-selected={selecionada?.(linha) || undefined}>
              {colunas.map((coluna) => {
                const bruto = coluna.valor?.(linha);
                const conteudo = coluna.render
                  ? coluna.render(linha)
                  : bruto === null || bruto === undefined
                    ? '—'
                    : String(bruto);
                return (
                  <td
                    key={coluna.chave}
                    className={coluna.numerica ? 'yn-num' : undefined}
                    data-label={empilhar ? coluna.titulo : undefined}
                  >
                    {conteudo}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

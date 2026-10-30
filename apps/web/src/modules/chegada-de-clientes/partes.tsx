/**
 * Peças pequenas da tela Chegada de clientes: bloco com título, variação colorida e dias.
 * Só apresentação; todo número vem pronto de `data/queries/chegada-de-clientes.ts`.
 */

import { useId, type ReactNode } from 'react';
import { numero, variacao } from '../../lib/format';

/** Dias inteiros: "1 dia", "13 dias"; sem base, "—". */
export function dias(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return '—';
  const n = Math.round(valor);
  return n === 1 ? '1 dia' : `${numero(n)} dias`;
}

export interface DeltaProps {
  /** Variação relativa (fração); null não desenha nada. */
  valor: number | null;
  /** Custo: cair é bom. */
  menorEhMelhor?: boolean;
  /** Sem cor (ex.: investimento, que não é bom nem ruim por si). */
  neutro?: boolean;
  /** Texto depois do número: "vs. mês anterior". */
  texto?: string;
}

/** Variação com sinal e a cor do padrão (.yn-kpi__delta): verde quando melhora, vermelho quando piora. */
export function Delta({ valor, menorEhMelhor = false, neutro = false, texto }: DeltaProps) {
  if (valor === null || !Number.isFinite(valor)) return null;
  const melhora = (valor > 0 && !menorEhMelhor) || (valor < 0 && menorEhMelhor);
  const piora = (valor > 0 && menorEhMelhor) || (valor < 0 && !menorEhMelhor);
  const tom = neutro ? '' : melhora ? ' yn-kpi__delta--up' : piora ? ' yn-kpi__delta--down' : '';
  return (
    <span className={`yn-kpi__delta${tom}`}>
      {variacao(valor)}
      {texto ? ` ${texto}` : ''}
    </span>
  );
}

export interface BlocoProps {
  titulo: string;
  descricao?: ReactNode;
  /** Âncora do bloco (ex.: "custo-por-cliente-novo" para /chegada#custo-por-cliente-novo). */
  id?: string;
  children: ReactNode;
}

/**
 * Card de um assunto da tela: h2, descrição curta e o conteúdo, com o mesmo cabeçalho dos gráficos.
 * Não usa `.mkt-chart`: a regra `.mkt-chart svg` estica qualquer ícone de dentro (ordenação, vazio).
 * A coluna é `minmax(0, 1fr)` (grid-cols-1): uma tabela larga rola dentro do card, nunca a página.
 */
export function Bloco({ titulo, descricao, id, children }: BlocoProps) {
  const gerado = useId();
  const idTitulo = id ? `${id}-titulo` : gerado;
  return (
    <section
      id={id}
      className="yn-card grid min-w-0 grid-cols-1 content-start gap-3"
      aria-labelledby={idTitulo}
    >
      <div className="mkt-chart__head">
        <div>
          <h2 id={idTitulo}>{titulo}</h2>
          {descricao ? <p className="yn-muted text-sm">{descricao}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

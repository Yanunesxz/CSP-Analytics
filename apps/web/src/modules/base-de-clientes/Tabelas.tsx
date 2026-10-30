/**
 * A base por marca (só em "As duas") e por representante: clientes, situação pela régua do CSP 360,
 * recompra e reativados do período. Viram cards no celular (.yn-table--stack).
 * Receita por representante fica para o módulo de desempenho de representantes (fora da v1); a
 * receita do período, de antigos × novos, está no gráfico.
 */

import { Users } from 'lucide-react';
import { useId } from 'react';
import { cor, rotuloMarca } from '@csp-mkt/shared';
import { PontoDeSerie, Tabela, Vazio, type Coluna } from '../../components/ui';
import type { LinhaDaBase, LinhaPorMarca, LinhaPorRepresentante } from '../../data/queries/base-de-clientes';
import { numero, percentual } from '../../lib/format';
import { rotuloRepresentante } from './textos';

function colunasDosNumeros<T extends LinhaDaBase>(): Coluna<T>[] {
  const colunaDeNumero = (chave: keyof LinhaDaBase & string, titulo: string): Coluna<T> => ({
    chave,
    titulo,
    numerica: true,
    valor: (l) => l[chave],
    render: (l) => numero(l[chave]),
  });
  return [
    colunaDeNumero('clientes', 'Clientes'),
    colunaDeNumero('ativos', 'Ativos'),
    colunaDeNumero('inativos', 'Inativos'),
    colunaDeNumero('perdidos', 'Perdidos'),
    {
      chave: 'recompraram',
      titulo: 'Recompra',
      numerica: true,
      valor: (l) => l.recompraram,
      // Um span só: no celular a célula vira flex (rótulo à esquerda, valor à direita)
      render: (l) => (
        <span>
          {numero(l.recompraram)}
          {l.taxaRecompra !== null ? (
            <span className="yn-muted" title="Taxa de recompra">
              {` · ${percentual(l.taxaRecompra)}`}
            </span>
          ) : null}
        </span>
      ),
    },
    colunaDeNumero('reativados', 'Reativados'),
  ];
}

function SemLinhas({ semDados }: { semDados: boolean }) {
  return semDados ? (
    <Vazio icone={Users} titulo="Sem dados" texto="Nenhum cliente chegou do CSP 360 ainda." />
  ) : (
    <Vazio
      icone={Users}
      titulo="Nenhum cliente com esses filtros"
      texto="Limpe os filtros para ver a base inteira."
    />
  );
}

const colunasPorMarca: Coluna<LinhaPorMarca>[] = [
  {
    chave: 'marca',
    titulo: 'Marca',
    valor: (l) => rotuloMarca(l.marca),
    render: (l) => (
      <span className="inline-flex items-center gap-2">
        {l.marca !== 'todas' ? <PontoDeSerie cor={cor('brand', l.marca)} /> : null}
        {rotuloMarca(l.marca)}
      </span>
    ),
    ordenavel: false,
  },
  ...colunasDosNumeros<LinhaPorMarca>(),
];

const colunasPorRepresentante: Coluna<LinhaPorRepresentante>[] = [
  {
    chave: 'representante',
    titulo: 'Representante',
    valor: (l) => rotuloRepresentante(l.representante),
    ordenavel: false,
  },
  ...colunasDosNumeros<LinhaPorRepresentante>(),
];

export function PorMarca({ linhas, semDados }: { linhas: LinhaPorMarca[]; semDados: boolean }) {
  const id = useId();
  return (
    <section className="mkt-stack" aria-labelledby={id}>
      <div className="mkt-chart__head">
        <h2 id={id}>Por marca</h2>
        <p className="yn-muted text-sm">
          Quem compra das duas marcas aparece nas duas linhas. “As duas” conta cada cliente uma vez.
        </p>
      </div>
      <Tabela
        colunas={colunasPorMarca}
        linhas={linhas}
        chaveDaLinha={(l) => l.marca}
        empilhar
        legenda="Clientes da base por marca"
        vazio={<SemLinhas semDados={semDados} />}
      />
    </section>
  );
}

export function PorRepresentante({
  linhas,
  semDados,
}: {
  linhas: LinhaPorRepresentante[];
  semDados: boolean;
}) {
  const id = useId();
  return (
    <section className="mkt-stack" aria-labelledby={id}>
      <div className="mkt-chart__head">
        <h2 id={id}>Por representante</h2>
        <p className="yn-muted text-sm">
          Carteira de cada representante, pelo código do CSP 360. Em Recompra, a taxa vem ao lado.
        </p>
      </div>
      <Tabela
        colunas={colunasPorRepresentante}
        linhas={linhas}
        chaveDaLinha={(l) => l.representante ?? 'sem-representante'}
        empilhar
        legenda="Clientes da base por representante"
        vazio={<SemLinhas semDados={semDados} />}
      />
    </section>
  );
}

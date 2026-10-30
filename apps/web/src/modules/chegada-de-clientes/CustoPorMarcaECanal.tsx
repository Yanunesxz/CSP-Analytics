/**
 * Custo por cliente novo por marca e canal (tarefa principal da fase 2): matriz marca × canal com a
 * variação vs. o período anterior em cada célula, e o detalhe (investimento ÷ clientes novos) para
 * conferir a conta. Com filtro de representante ou de origem não paga, explica por que não há custo.
 */

import { CircleDollarSign, FunnelX } from 'lucide-react';
import { rotulo, rotuloMarca } from '@csp-mkt/shared';
import { ChipSerie, Tabela, Vazio, type Coluna } from '../../components/ui';
import type { LinhaCusto, Metrica } from '../../data/queries';
import type { LinhaDaMatriz, MatrizDeCusto, MotivoSemCusto } from '../../data/queries/chegada-de-clientes';
import { dinheiro, numero } from '../../lib/format';
import { ANCORA_DO_CUSTO } from '../../rotas';
import { Bloco, Delta } from './partes';

/**
 * Âncora para abrir a tela direto neste bloco: /chegada#custo-por-cliente-novo. A Visão geral e as
 * telas de canal levam o indicador "Custo por cliente novo" para cá (tarefa T1).
 */
export const ID_CUSTO = ANCORA_DO_CUSTO;

const SEM_CUSTO: Record<MotivoSemCusto, { titulo: string; texto: string; botao: string }> = {
  representante: {
    titulo: 'O custo não se divide por representante',
    texto:
      'O investimento é por campanha. Tire o filtro de representante para ver o custo por marca e canal.',
    botao: 'Tirar filtro de representante',
  },
  origem: {
    titulo: 'Esta origem não tem investimento',
    texto:
      'Só Meta Ads, TikTok Ads e Google Ads têm custo. Tire o filtro de origem para ver o custo por marca e canal.',
    botao: 'Tirar filtro de origem',
  },
};

function nomeDoCanal(canal: LinhaCusto['canal']): string {
  return canal ? rotulo('platform', canal) : 'Todos os canais';
}

function CelulaDeCusto({ metrica }: { metrica: Metrica | undefined }) {
  if (!metrica || metrica.atual === null) return <span className="yn-muted">—</span>;
  return (
    <span className="inline-grid justify-items-end">
      <span className="font-semibold">{dinheiro(metrica.atual)}</span>
      <Delta valor={metrica.variacao} menorEhMelhor />
    </span>
  );
}

function NomeDaMarca({ marca }: { marca: LinhaDaMatriz['marca'] }) {
  return marca ? (
    <ChipSerie lista="brand" codigo={marca} />
  ) : (
    <span className="font-semibold">{rotuloMarca('todas')}</span>
  );
}

interface Detalhe {
  chave: string;
  marca: LinhaDaMatriz['marca'];
  linha: LinhaCusto;
}

export interface CustoPorMarcaECanalProps {
  custo: MatrizDeCusto | null;
  motivo: MotivoSemCusto | null;
  /** "vs. mês anterior"; null quando a comparação está desligada. */
  rotuloAnterior: string | null;
  /** Estado "sem dados" da tela: nenhum número para mostrar. */
  semDados: boolean;
  aoTirarFiltro: (motivo: MotivoSemCusto) => void;
}

export function CustoPorMarcaECanal({
  custo,
  motivo,
  rotuloAnterior,
  semDados,
  aoTirarFiltro,
}: CustoPorMarcaECanalProps) {
  const descricao = `Investimento ÷ clientes novos atribuídos pela UTM da campanha.${
    rotuloAnterior ? ` Abaixo de cada valor, a variação ${rotuloAnterior}.` : ''
  }`;

  if (semDados) {
    return (
      <Bloco id={ID_CUSTO} titulo="Custo por cliente novo por marca e canal" descricao={descricao}>
        <Vazio
          icone={CircleDollarSign}
          titulo="Sem dados"
          texto="Nenhum investimento nem cliente novo no período."
        />
      </Bloco>
    );
  }

  if (motivo || !custo) {
    const texto = SEM_CUSTO[motivo ?? 'origem'];
    return (
      <Bloco id={ID_CUSTO} titulo="Custo por cliente novo por marca e canal" descricao={descricao}>
        <Vazio
          icone={FunnelX}
          titulo={texto.titulo}
          texto={texto.texto}
          acao={
            motivo ? (
              <button
                className="yn-btn yn-btn--secondary"
                type="button"
                onClick={() => aoTirarFiltro(motivo)}
              >
                {texto.botao}
              </button>
            ) : null
          }
        />
      </Bloco>
    );
  }

  const colunas: Coluna<LinhaDaMatriz>[] = [
    {
      chave: 'marca',
      titulo: 'Marca',
      ordenavel: false,
      render: (l) => <NomeDaMarca marca={l.marca} />,
    },
    ...custo.canais.map((canal, i): Coluna<LinhaDaMatriz> => ({
      chave: canal ?? 'todos',
      titulo: nomeDoCanal(canal),
      numerica: true,
      ordenavel: false,
      render: (l) => <CelulaDeCusto metrica={l.celulas[i]?.custo} />,
    })),
  ];

  const detalhes: Detalhe[] = custo.linhas.flatMap((l) =>
    l.celulas.map((linha, i) => ({
      chave: `${l.marca ?? 'duas'}-${custo.canais[i] ?? 'todos'}`,
      marca: l.marca,
      linha,
    })),
  );

  const colunasDoDetalhe: Coluna<Detalhe>[] = [
    { chave: 'marca', titulo: 'Marca', ordenavel: false, render: (d) => rotuloMarca(d.marca) },
    { chave: 'canal', titulo: 'Canal', ordenavel: false, render: (d) => nomeDoCanal(d.linha.canal) },
    {
      chave: 'investimento',
      titulo: 'Investimento',
      numerica: true,
      ordenavel: false,
      render: (d) => dinheiro(d.linha.investimento.atual),
    },
    {
      chave: 'clientes',
      titulo: 'Clientes atribuídos',
      numerica: true,
      ordenavel: false,
      render: (d) => numero(d.linha.clientesNovos.atual),
    },
    {
      chave: 'custo',
      titulo: 'Custo',
      numerica: true,
      ordenavel: false,
      render: (d) => dinheiro(d.linha.custo.atual),
    },
    ...(rotuloAnterior
      ? [
          {
            chave: 'anterior',
            titulo: 'Custo anterior',
            numerica: true,
            ordenavel: false,
            render: (d: Detalhe) => dinheiro(d.linha.custo.anterior),
          },
        ]
      : []),
  ];

  return (
    <Bloco id={ID_CUSTO} titulo="Custo por cliente novo por marca e canal" descricao={descricao}>
      <Tabela
        empilhar
        legenda="Custo por cliente novo por marca e canal"
        colunas={colunas}
        linhas={custo.linhas}
        chaveDaLinha={(l) => l.marca ?? 'duas'}
      />
      <p className="yn-muted text-sm">
        O traço (—) quer dizer que o canal não teve investimento ou cliente novo atribuído no período.
        {custo.linhas.length > 1 ? ' "As duas" conta cada cliente uma vez.' : ''}
      </p>
      <details className="yn-as-table">
        <summary>Ver investimento e clientes atribuídos</summary>
        <Tabela
          empilhar
          legenda="Investimento, clientes novos atribuídos e custo por cliente novo"
          colunas={colunasDoDetalhe}
          linhas={detalhes}
          chaveDaLinha={(d) => d.chave}
        />
      </details>
    </Bloco>
  );
}

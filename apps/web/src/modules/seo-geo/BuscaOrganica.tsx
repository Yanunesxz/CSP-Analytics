/**
 * Seção "Busca orgânica · SEO" (Search Console, relatório "Web"): impressões, cliques, CTR e posição
 * média comparados com o período anterior; cliques e posição por dia, uma linha por marca; e as
 * consultas que mais trazem cliques, em tabela que vira cards no celular.
 */

import { SearchX } from 'lucide-react';
import { useId, useMemo } from 'react';
import { rotulo } from '@csp-mkt/shared';
import {
  ChipSerie,
  GraficoLinha,
  Kpi,
  Tabela,
  Vazio,
  type Coluna,
  type EstadoGrafico,
} from '../../components/ui';
import type { LinhaConsulta, PainelSeoGeo } from '../../data/queries/seo-geo';
import { numero, percentual } from '../../lib/format';
import { AvisoDoConector } from './Avisos';
import { Secao } from './Secao';
import { seriesPorMarca } from './series';
import { resumoDasConsultas } from './textos';

export interface BuscaOrganicaProps {
  painel: PainelSeoGeo;
  semDados: boolean;
  /** "vs. mês anterior"; undefined com a comparação desligada. */
  deltaTexto?: string;
  /** Em "As duas", a tabela de consultas diz de qual marca é cada uma. */
  mostrarMarca: boolean;
}

const formatoPosicao = (v: number) => numero(v, 1);

export function BuscaOrganica({ painel, semDados, deltaTexto, mostrarMarca }: BuscaOrganicaProps) {
  const { seo, fontes } = painel;
  const estado: EstadoGrafico = semDados ? 'semDados' : 'ok';
  const cliques = useMemo(() => seriesPorMarca(seo.cliquesPorDia, 'cliques'), [seo.cliquesPorDia]);
  const posicao = useMemo(() => seriesPorMarca(seo.posicaoPorDia, 'posicao'), [seo.posicaoPorDia]);

  return (
    <Secao
      titulo="Busca orgânica · SEO"
      descricao="Como os sites aparecem e recebem cliques na busca do Google."
      fonte={{ nome: 'Search Console', cartao: fontes.search_console }}
    >
      <AvisoDoConector nome="Search Console" cartao={fontes.search_console} />
      <div className="mkt-grid-kpis" role="group" aria-label="Indicadores da busca orgânica">
        <Kpi rotulo="Impressões" metrica={seo.impressoes} deltaTexto={deltaTexto} />
        <Kpi rotulo="Cliques" metrica={seo.cliques} deltaTexto={deltaTexto} />
        <Kpi
          rotulo="CTR"
          metrica={seo.ctr}
          formato="percentual"
          casas={1}
          deltaTexto={deltaTexto}
          nota="Cliques ÷ impressões"
        />
        <Kpi
          rotulo="Posição média"
          metrica={seo.posicaoMedia}
          formato="decimal"
          casas={1}
          menorEhMelhor
          deltaTexto={deltaTexto}
          nota="Quanto menor, melhor"
        />
      </div>
      <div className="mkt-grid-2">
        <GraficoLinha
          titulo="Cliques por dia"
          descricao="Cliques na busca do Google, por marca."
          series={cliques}
          estado={estado}
        />
        <GraficoLinha
          titulo="Posição média por dia"
          descricao="Posição nos resultados do Google, por marca. Quanto menor, melhor."
          series={posicao}
          formato={formatoPosicao}
          estado={estado}
        />
      </div>
      <Consultas painel={painel} semDados={semDados} mostrarMarca={mostrarMarca} />
    </Secao>
  );
}

function Consultas({ painel, semDados, mostrarMarca }: Omit<BuscaOrganicaProps, 'deltaTexto'>) {
  const idTitulo = useId();
  const { consultas, participacaoDasConsultas, temConsultas } = painel.seo;
  const resumo = resumoDasConsultas(consultas.length, participacaoDasConsultas);

  const colunas = useMemo<Coluna<LinhaConsulta>[]>(() => {
    const marca: Coluna<LinhaConsulta>[] = mostrarMarca
      ? [
          {
            chave: 'marca',
            titulo: 'Marca',
            valor: (q) => rotulo('brand', q.marca),
            render: (q) => <ChipSerie lista="brand" codigo={q.marca} />,
          },
        ]
      : [];
    return [
      {
        chave: 'consulta',
        titulo: 'Consulta',
        valor: (q) => q.consulta,
        render: (q) => (
          <span className="block max-w-80 truncate" title={q.consulta}>
            {q.consulta}
          </span>
        ),
      },
      ...marca,
      {
        chave: 'impressoes',
        titulo: 'Impressões',
        numerica: true,
        valor: (q) => q.impressoes,
        render: (q) => numero(q.impressoes),
      },
      {
        chave: 'cliques',
        titulo: 'Cliques',
        numerica: true,
        valor: (q) => q.cliques,
        render: (q) => numero(q.cliques),
      },
      { chave: 'ctr', titulo: 'CTR', numerica: true, valor: (q) => q.ctr, render: (q) => percentual(q.ctr) },
      {
        chave: 'posicao',
        titulo: 'Posição',
        numerica: true,
        valor: (q) => q.posicao,
        render: (q) => numero(q.posicao, 1),
      },
    ];
  }, [mostrarMarca]);

  const vazio = (
    <div className="yn-card">
      {semDados || !temConsultas ? (
        <Vazio
          icone={SearchX}
          titulo="Sem dados"
          texto="As consultas chegam do Search Console uma vez por dia."
        />
      ) : (
        <Vazio
          icone={SearchX}
          titulo="Nenhuma consulta no período"
          texto="Escolha um período maior em Período para ver as consultas."
        />
      )}
    </div>
  );

  return (
    <section className="mkt-stack min-w-0" aria-labelledby={idTitulo}>
      <div className="mkt-chart__head">
        <div>
          <h2 id={idTitulo}>Consultas que mais trazem</h2>
          <p className="yn-muted text-sm">
            As buscas com mais cliques no período. O Search Console esconde as consultas raras, então a soma
            fica abaixo do total.
          </p>
        </div>
        {resumo ? <p className="yn-muted text-sm">{resumo}</p> : null}
      </div>
      <Tabela
        colunas={colunas}
        linhas={consultas}
        chaveDaLinha={(q) => q.chave}
        empilhar
        legenda="Consultas da busca orgânica com mais cliques no período"
        vazio={vazio}
      />
    </section>
  );
}

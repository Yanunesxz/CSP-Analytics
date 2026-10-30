/**
 * Os dois gráficos da Visão geral, sempre com "Ver como tabela" e com "Sem dados" próprio:
 * custo por cliente novo por canal (barras, cor de cada canal) e leads × clientes novos por dia
 * (linhas em tons neutros: cor de série só identifica marca, canal e operador — decisão 0007).
 */

import { cor, rotulo } from '@csp-mkt/shared';
import { GraficoBarras, GraficoLinha, type ItemBarra, type SerieLinha } from '../../components/ui';
import type { VisaoGeral } from '../../data/queries/visao-geral';
import { dinheiro, numero } from '../../lib/format';
import type { Filtros } from '../../lib/url-state';
import { detalheDoCusto, temFiltroDeMidia } from './textos';

export interface GraficosProps {
  v: VisaoGeral;
  filtros: Filtros;
  semDados: boolean;
}

export function Graficos({ v, filtros, semDados }: GraficosProps) {
  const estado = semDados ? 'semDados' : 'ok';
  const comparar = filtros.comparar;

  const barras: ItemBarra[] = v.porCanal.flatMap((l) =>
    l.canal
      ? [
          {
            rotulo: rotulo('platform', l.canal),
            valor: l.custo.atual,
            cor: cor('platform', l.canal),
            detalhe: detalheDoCusto(l.custo, v.intervalo, comparar),
          },
        ]
      : [],
  );

  const series: SerieLinha[] = [
    {
      id: 'leads',
      rotulo: 'Leads',
      cor: 'var(--color-silver)',
      pontos: v.porDia.map((p) => ({ x: p.date, y: p.leads })),
    },
    {
      id: 'clientes-novos',
      rotulo: 'Clientes novos',
      cor: 'var(--color-text)',
      pontos: v.porDia.map((p) => ({ x: p.date, y: p.clientesNovos })),
    },
  ];

  return (
    <div className="mkt-grid-2">
      {barras.length > 1 ? (
        <GraficoBarras
          titulo="Custo por cliente novo por canal"
          descricao="Investimento do canal ÷ clientes novos que vieram das campanhas dele."
          itens={barras}
          formato={dinheiro}
          rotuloValor="Custo por cliente novo"
          estado={estado}
        />
      ) : null}
      <GraficoLinha
        titulo="Leads e clientes novos por dia"
        descricao={`${
          temFiltroDeMidia(filtros) ? 'Só o que passa pelos filtros.' : 'Todas as origens.'
        } O cliente novo conta no dia do 1º pedido enviado.`}
        series={series}
        formato={(valor) => numero(valor)}
        estado={estado}
      />
    </div>
  );
}

/**
 * Tempo desde a última compra (colunas por faixa de dias) e receita do período de antigos × novos
 * (barras). Cor neutra nos dois: não são marca, canal nem operador, e a faixa de dias não vira
 * situação (a régua é do CSP 360). "Ver como tabela" e os estados vêm dos componentes.
 */

import { GraficoBarras, GraficoColunas } from '../../components/ui';
import type { PainelDaBase } from '../../data/queries/base-de-clientes';
import { dinheiro, numero } from '../../lib/format';
import { detalheParticipacao } from './textos';

export interface GraficosProps {
  painel: PainelDaBase;
  estado: 'ok' | 'sem-dados';
}

export function Graficos({ painel, estado }: GraficosProps) {
  const estadoGrafico = estado === 'sem-dados' ? 'semDados' : 'ok';

  return (
    <div className="mkt-grid-2">
      <GraficoColunas
        titulo="Tempo desde a última compra"
        descricao="Clientes da base por dias sem comprar, contados até hoje."
        colunas={painel.faixasDeUltimaCompra.map((f) => ({ rotulo: f.rotulo, valor: f.total }))}
        formato={(v) => numero(v)}
        rotuloValor="Clientes"
        estado={estadoGrafico}
      />
      <GraficoBarras
        titulo="Receita do período: antigos × novos"
        descricao="Pedidos enviados no período. Antigo já tinha pedido antes, em qualquer marca."
        itens={[
          {
            rotulo: 'Clientes antigos',
            valor: painel.receitaAntigos.atual,
            detalhe: detalheParticipacao(painel.participacaoAntigos.atual),
          },
          {
            rotulo: 'Clientes novos',
            valor: painel.receitaNovos.atual,
            detalhe: detalheParticipacao(painel.participacaoNovos),
          },
        ]}
        formato={(v) => dinheiro(v)}
        rotuloValor="Receita"
        estado={estadoGrafico}
      />
    </div>
  );
}

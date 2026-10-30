/**
 * Os dois grupos de indicadores: a base de hoje pela situação do CSP 360 (não muda com o período)
 * e o que aconteceu no período (recompra, reativados e receita de antigos), com o anterior.
 * Mais "Como contamos", fechado, com a definição de cada número.
 */

import { useId } from 'react';
import { Kpi } from '../../components/ui';
import type { PainelDaBase } from '../../data/queries/base-de-clientes';
import { dinheiro, numero, percentual } from '../../lib/format';
import { useFiltros } from '../../lib/url-state';
import { linkDaLista } from './recorte';
import { notaDaBase, notaDoAnterior, notaInativos, notaSemSituacao, textoDoPeriodo } from './textos';

export interface IndicadoresProps {
  painel: PainelDaBase;
  /** "vs. mês anterior"; undefined quando a comparação está desligada. */
  deltaTexto?: string;
}

export function Indicadores({ painel, deltaTexto }: IndicadoresProps) {
  const idHoje = useId();
  const idPeriodo = useId();
  const { filtros } = useFiltros();
  const semSituacao = notaSemSituacao(painel.situacaoConhecida, painel.total);
  const emPercentual = (v: number) => percentual(v);

  // Cada contagem de clientes leva à lista já filtrada (o mesmo filtro rápido), mantendo o representante.
  // Sem base, ou sem a situação do CSP 360, não há lista para filtrar: o indicador não vira link.
  const comBase = painel.total !== null;
  const comSituacao = comBase && painel.situacaoConhecida;
  const paraFiltros = { representante: filtros.representante };

  return (
    <>
      <section className="mkt-stack" aria-labelledby={idHoje}>
        <div className="mkt-chart__head">
          <h2 id={idHoje}>Hoje, pela situação do CSP 360</h2>
          <p className="yn-muted text-sm">Não muda com o período.</p>
        </div>
        <div className="mkt-grid-kpis">
          <Kpi
            rotulo="Clientes na base"
            valor={painel.total}
            nota={notaDaBase(painel.total, painel.semSituacao)}
            para={comBase ? linkDaLista(null) : undefined}
            paraFiltros={paraFiltros}
          />
          <Kpi
            rotulo="Ativos"
            valor={painel.ativos}
            nota={semSituacao}
            para={comSituacao ? linkDaLista('ativos') : undefined}
            paraFiltros={paraFiltros}
          />
          <Kpi
            rotulo="Inativos"
            valor={painel.inativos}
            nota={semSituacao ?? notaInativos(painel.inativosRecentes, painel.inativosAntigos)}
            para={comSituacao ? linkDaLista('inativos') : undefined}
            paraFiltros={paraFiltros}
          />
          <Kpi
            rotulo="Perdidos"
            valor={painel.perdidos}
            nota={semSituacao}
            para={comSituacao ? linkDaLista('perdidos') : undefined}
            paraFiltros={paraFiltros}
          />
        </div>
      </section>

      <section className="mkt-stack" aria-labelledby={idPeriodo}>
        <div className="mkt-chart__head">
          <h2 id={idPeriodo}>No período</h2>
          <p className="yn-muted text-sm">{textoDoPeriodo(painel.intervalo.inicio, painel.intervalo.fim)}</p>
        </div>
        <div className="mkt-grid-kpis">
          <Kpi
            rotulo="Taxa de recompra"
            metrica={painel.taxaRecompra}
            formato="percentual"
            deltaTexto={deltaTexto}
            nota={notaDoAnterior(painel.taxaRecompra, emPercentual)}
          />
          <Kpi
            rotulo="Reativados"
            metrica={painel.reativados}
            deltaTexto={deltaTexto}
            nota={notaDoAnterior(painel.reativados, numero)}
            para={comBase ? linkDaLista('reativados') : undefined}
            paraFiltros={paraFiltros}
          />
          <Kpi
            rotulo="Receita de antigos"
            metrica={painel.receitaAntigos}
            formato="dinheiro"
            deltaTexto={deltaTexto}
            nota={notaDoAnterior(painel.receitaAntigos, dinheiro)}
          />
          <Kpi
            rotulo="Antigos na receita"
            metrica={painel.participacaoAntigos}
            formato="percentual"
            deltaTexto={deltaTexto}
            nota={notaDoAnterior(painel.participacaoAntigos, emPercentual)}
          />
        </div>
      </section>

      <details className="yn-accordion">
        <summary>Como contamos</summary>
        <ul className="grid list-disc gap-1 pl-5">
          <li>
            <strong>Cliente da base:</strong> quem já tem pedido enviado em alguma marca. Quem ainda não
            comprou é lead e fica em Leads.
          </li>
          <li>
            <strong>Situação:</strong> vem do CSP 360, pela régua de cada marca. O CSP-MKT não recalcula.
          </li>
          <li>
            <strong>Antigo:</strong> já tinha pedido antes do início do período, em qualquer marca. Novo: o 1º
            pedido foi no período.
          </li>
          <li>
            <strong>Taxa de recompra:</strong> antigos que fizeram pedido no período ÷ todos os antigos.
          </li>
          <li>
            <strong>Reativado:</strong> antigo que voltou a comprar no período depois de 90 dias ou mais sem
            pedido. Com uma marca escolhida, contam só os pedidos dela.
          </li>
          <li>
            <strong>Receita:</strong> soma dos pedidos enviados no período. O valor faturado chega quando o
            Control abrir o canal de faturamento.
          </li>
        </ul>
      </details>
    </>
  );
}

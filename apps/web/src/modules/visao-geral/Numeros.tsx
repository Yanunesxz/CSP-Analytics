/**
 * Os oito indicadores do período, cada um levando à tela que trabalha o número, e as notas que
 * explicam o custo por cliente novo e o que os filtros não alcançam.
 */

import { Kpi } from '../../components/ui';
import type { VisaoGeral } from '../../data/queries/visao-geral';
import type { Filtros } from '../../lib/url-state';
import { ANCORA_DO_CUSTO } from '../../rotas';
import { notaDoFaturado, notasDosNumeros, variacaoNeutra } from './textos';

export interface NumerosProps {
  v: VisaoGeral;
  filtros: Filtros;
}

export function Numeros({ v, filtros }: NumerosProps) {
  const n = v.numeros;
  // Com "Comparar com o anterior" desligado, nenhum texto fala do período anterior
  const deltaTexto = filtros.comparar ? v.intervalo.rotuloAnterior : undefined;
  // Leva junto o recorte de mídia para as telas que filtram por ele
  const daTela: Partial<Filtros> = {
    canal: filtros.canal,
    operador: filtros.operador,
    campanha: filtros.campanha,
  };
  const notas = notasDosNumeros(v, filtros);

  return (
    <section className="mkt-stack" aria-labelledby="visao-geral-numeros">
      <h2 id="visao-geral-numeros" className="yn-sr-only">
        Números do período
      </h2>
      <div className="mkt-grid-kpis">
        {/* T1: abre Chegada de clientes já no custo por marca e canal (1 toque) */}
        <Kpi
          rotulo="Custo por cliente novo"
          metrica={n.custoPorClienteNovo}
          formato="dinheiro"
          menorEhMelhor
          deltaTexto={deltaTexto}
          para={`/chegada#${ANCORA_DO_CUSTO}`}
          paraFiltros={daTela}
        />
        <Kpi
          rotulo="Clientes novos"
          metrica={n.clientesNovos}
          deltaTexto={deltaTexto}
          para="/chegada"
          paraFiltros={daTela}
        />
        <Kpi rotulo="Leads" metrica={n.leads} deltaTexto={deltaTexto} para="/leads" paraFiltros={daTela} />
        <Kpi
          rotulo="Investimento"
          valor={n.investimento.atual}
          formato="dinheiro"
          nota={deltaTexto ? variacaoNeutra(n.investimento, deltaTexto) : undefined}
          deltaTexto={deltaTexto}
          // Sem canal, o investimento se abre no custo por marca e canal ("Ver investimento e clientes atribuídos")
          para={filtros.canal ? `/canais/${filtros.canal}` : `/chegada#${ANCORA_DO_CUSTO}`}
          paraFiltros={filtros.canal ? { operador: filtros.operador } : daTela}
        />
        <Kpi rotulo="Pedidos enviados" metrica={n.pedidos} deltaTexto={deltaTexto} para="/base" />
        <Kpi
          rotulo="Valor dos pedidos"
          metrica={n.valorPedidos}
          formato="dinheiro"
          deltaTexto={deltaTexto}
          para="/base"
        />
        <Kpi
          rotulo="Valor faturado"
          metrica={n.valorFaturado}
          formato="dinheiro"
          nota={n.valorFaturado.atual === null ? notaDoFaturado(n.faturados.atual) : undefined}
          deltaTexto={deltaTexto}
          para="/chegada"
        />
        <Kpi
          rotulo="Alcance no Instagram"
          metrica={n.alcanceInstagram}
          formato="abreviado"
          deltaTexto={deltaTexto}
          para="/instagram"
        />
      </div>
      <p className="yn-muted text-sm">{notas.join(' ')}</p>
    </section>
  );
}

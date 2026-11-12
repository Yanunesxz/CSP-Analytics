/**
 * Para onde o dinheiro foi: barras do gasto por canal (na cor de cada canal) e, em "As duas", por
 * marca, lado a lado no computador. Cada gráfico tem "Ver como tabela", com a parte do gasto e os clientes novos de cada um.
 */

import { cor, rotulo } from '@csp-mkt/shared';
import { GraficoBarras } from '../../components/ui';
import type { ResumoSimples } from '../../data/queries/resumo-simples';
import { EXPLICACAO_DOS_CANAIS, detalheDoGasto, reais } from './textos';

export interface OndeFoiGastoProps {
  r: ResumoSimples;
  semDados: boolean;
}

export function OndeFoiGasto({ r, semDados }: OndeFoiGastoProps) {
  // Com o canal ou a marca já escolhidos, o gráfico teria uma barra só: os quatro números bastam
  const mostrarCanais = r.porCanal.length > 1;
  const mostrarMarcas = r.porMarca.length > 1;
  if (!mostrarCanais && !mostrarMarcas) return null;
  const estado = semDados ? 'semDados' : 'ok';

  return (
    <div className="mkt-grid-2">
      {mostrarCanais ? (
        <GraficoBarras
          titulo="Onde o dinheiro foi gasto"
          descricao={EXPLICACAO_DOS_CANAIS}
          itens={r.porCanal.map((l) => ({
            rotulo: rotulo('platform', l.canal),
            valor: l.investimento,
            cor: cor('platform', l.canal),
            detalhe: detalheDoGasto(l),
          }))}
          formato={reais}
          rotuloValor="Gasto"
          estado={estado}
        />
      ) : null}
      {mostrarMarcas ? (
        <GraficoBarras
          titulo="Quanto foi para cada marca"
          itens={r.porMarca.map((l) => ({
            rotulo: rotulo('brand', l.marca),
            valor: l.investimento,
            cor: cor('brand', l.marca),
            detalhe: detalheDoGasto(l),
          }))}
          formato={reais}
          rotuloValor="Gasto"
          estado={estado}
        />
      ) : null}
    </div>
  );
}

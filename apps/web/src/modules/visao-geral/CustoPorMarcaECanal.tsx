/**
 * Custo por cliente novo por marca e por canal, com a variação contra o período anterior embaixo
 * de cada custo: a resposta da tarefa T1 sem sair da Visão geral. A marca leva ao custo daquela
 * marca por canal, na Chegada de clientes; o canal leva à tela do canal.
 */

import { Link } from 'react-router-dom';
import { cor, rotulo } from '@csp-mkt/shared';
import { PontoDeSerie, Tabela, type Coluna } from '../../components/ui';
import type { LinhaCusto, Metrica } from '../../data/queries';
import { dinheiro, numero, variacao } from '../../lib/format';
import type { Intervalo } from '../../lib/periodo';
import { useFiltros, type Filtros } from '../../lib/url-state';
import { ANCORA_DO_CUSTO } from '../../rotas';

/** Custo com a variação embaixo; cair é bom (verde), subir é ruim (vermelho). */
function CustoComVariacao({ m }: { m: Metrica }) {
  const d = m.variacao;
  const tom = d === null || d === 0 ? '' : d < 0 ? ' yn-kpi__delta--up' : ' yn-kpi__delta--down';
  return (
    <span className="inline-grid justify-items-end gap-1">
      <span>{dinheiro(m.atual)}</span>
      {m.atual !== null && d !== null ? <span className={`yn-kpi__delta${tom}`}>{variacao(d)}</span> : null}
    </span>
  );
}

const NUMEROS: Coluna<LinhaCusto>[] = [
  {
    chave: 'investimento',
    titulo: 'Investimento',
    numerica: true,
    ordenavel: false,
    render: (l) => dinheiro(l.investimento.atual),
  },
  { chave: 'leads', titulo: 'Leads', numerica: true, ordenavel: false, render: (l) => numero(l.leads.atual) },
  {
    chave: 'clientes-novos',
    titulo: 'Clientes novos',
    numerica: true,
    ordenavel: false,
    render: (l) => numero(l.clientesNovos.atual),
  },
  {
    chave: 'custo',
    titulo: 'Custo por cliente novo',
    numerica: true,
    ordenavel: false,
    render: (l) => <CustoComVariacao m={l.custo} />,
  },
];

export interface CustoPorMarcaECanalProps {
  porMarca: LinhaCusto[];
  porCanal: LinhaCusto[];
  intervalo: Intervalo;
  filtros: Filtros;
}

export function CustoPorMarcaECanal({ porMarca, porCanal, intervalo, filtros }: CustoPorMarcaECanalProps) {
  const { linkCom } = useFiltros();
  // Com a marca e o canal já escolhidos, cada tabela teria uma linha só: os indicadores bastam
  const mostrarMarcas = porMarca.length > 1;
  const mostrarCanais = porCanal.length > 1;
  if (!mostrarMarcas && !mostrarCanais) return null;

  const colunaMarca: Coluna<LinhaCusto> = {
    chave: 'marca',
    titulo: 'Marca',
    render: (l) =>
      l.marca ? (
        <Link
          className="inline-flex items-center gap-2"
          // Abre o custo daquela marca já por canal (a matriz da Chegada de clientes)
          to={linkCom(`/chegada#${ANCORA_DO_CUSTO}`, {
            marca: l.marca,
            canal: filtros.canal,
            operador: filtros.operador,
            campanha: filtros.campanha,
          })}
          title={`Ver o custo de ${rotulo('brand', l.marca)} por canal`}
        >
          <PontoDeSerie cor={cor('brand', l.marca)} />
          {rotulo('brand', l.marca)}
        </Link>
      ) : (
        '—'
      ),
  };

  const colunaCanal: Coluna<LinhaCusto> = {
    chave: 'canal',
    titulo: 'Canal',
    render: (l) =>
      l.canal ? (
        <Link
          className="inline-flex items-center gap-2"
          to={linkCom(`/canais/${l.canal}`, { operador: filtros.operador })}
          title={`Ver ${rotulo('platform', l.canal)}`}
        >
          <PontoDeSerie cor={cor('platform', l.canal)} />
          {rotulo('platform', l.canal)}
        </Link>
      ) : (
        '—'
      ),
  };

  return (
    <section className="mkt-stack" aria-labelledby="visao-geral-custo">
      <div className="grid gap-1">
        <h2 id="visao-geral-custo">Custo por cliente novo</h2>
        <p className="yn-muted text-sm">
          Leads e clientes novos que vieram de campanha (pela UTM).
          {filtros.comparar ? ` Embaixo de cada custo, a variação ${intervalo.rotuloAnterior}.` : ''}
        </p>
      </div>

      {mostrarMarcas ? (
        <div className="grid gap-2">
          <h3>Por marca</h3>
          <div className="yn-container">
            <Tabela
              colunas={[colunaMarca, ...NUMEROS]}
              linhas={porMarca}
              chaveDaLinha={(l) => l.marca ?? 'todas'}
              empilhar
              legenda="Custo por cliente novo por marca"
            />
          </div>
        </div>
      ) : null}

      {mostrarCanais ? (
        <div className="grid gap-2">
          <h3>Por canal</h3>
          <div className="yn-container">
            <Tabela
              colunas={[colunaCanal, ...NUMEROS]}
              linhas={porCanal}
              chaveDaLinha={(l) => l.canal ?? 'todos'}
              empilhar
              legenda="Custo por cliente novo por canal"
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

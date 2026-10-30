/**
 * Funil dos leads do período: lead → prospecto → cadastro → 1º pedido enviado → faturado.
 * Cada etapa com o total, a barra proporcional ao total de leads e quanto passou da etapa
 * anterior; ao lado, o tempo médio entre etapas que o CRM já data. Sempre com "Ver como tabela".
 *
 * Usa as peças de barra do padrão (.yn-bars__track/.yn-bars__fill) em duas linhas — nome e
 * número em cima, barra embaixo — para o nome da etapa não ser cortado em 375px.
 */

import { ChartNoAxesColumn, Inbox } from 'lucide-react';
import { useId } from 'react';
import { AsTable, Vazio } from '../../components/ui';
import type { ChegadaDeClientes } from '../../data/queries/chegada-de-clientes';
import { numero, percentual } from '../../lib/format';
import { Bloco, dias } from './partes';

export interface FunilProps {
  funil: ChegadaDeClientes['funil'];
  /** Estado "sem dados" da tela (`?estado=sem-dados` ou nada sincronizado). */
  semDados: boolean;
  /** Mostra a coluna do período anterior na tabela. */
  comparar: boolean;
  /** Há filtro de tela ligado: o vazio oferece limpar. */
  temFiltros: boolean;
  aoLimparFiltros: () => void;
}

const DESCRICAO =
  'Dos leads que chegaram no período, quantos já passaram por cada etapa. Cliente novo = 1º pedido enviado.';

export function Funil({ funil, semDados, comparar, temFiltros, aoLimparFiltros }: FunilProps) {
  const idLegenda = useId();
  const leads = funil.etapas[0]?.total.atual ?? null;

  if (semDados || leads === null) {
    return (
      <Bloco titulo="Funil dos leads do período" descricao={DESCRICAO}>
        <Vazio
          icone={ChartNoAxesColumn}
          titulo="Sem dados"
          texto="Nenhum lead no período para montar o funil."
        />
      </Bloco>
    );
  }

  if (leads === 0) {
    return (
      <Bloco titulo="Funil dos leads do período" descricao={DESCRICAO}>
        <Vazio
          icone={Inbox}
          titulo="Nenhum lead neste período"
          texto={temFiltros ? 'Tire um filtro ou troque o período.' : 'Troque o período para ver o funil.'}
          acao={
            temFiltros ? (
              <button className="yn-btn yn-btn--secondary" type="button" onClick={aoLimparFiltros}>
                Limpar filtros
              </button>
            ) : null
          }
        />
      </Bloco>
    );
  }

  return (
    <Bloco titulo="Funil dos leads do período" descricao={DESCRICAO}>
      <div className="mkt-grid-2">
        <div className="grid gap-2">
          <ol className="grid gap-3" aria-label="Etapas do funil" aria-describedby={idLegenda}>
            {funil.etapas.map((e) => (
              <li
                key={e.etapa}
                className="grid gap-1"
                style={{ ['--value' as string]: e.doTotal === null ? 0 : e.doTotal * 100 }}
              >
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">{e.rotulo}</span>
                  <span className="yn-num font-semibold">
                    {numero(e.total.atual)}
                    {e.daAnterior !== null ? (
                      <span className="yn-muted font-normal"> · {percentual(e.daAnterior, 0)}</span>
                    ) : null}
                  </span>
                </div>
                <span className="yn-bars__track" aria-hidden="true">
                  <span className="yn-bars__fill" />
                </span>
              </li>
            ))}
          </ol>
          <p id={idLegenda} className="yn-muted text-sm">
            A porcentagem é quanto passou da etapa anterior.
          </p>
        </div>

        <div className="grid content-start gap-3">
          <dl className="yn-dl">
            <div>
              <dt>Do lead ao 1º pedido</dt>
              <dd>{funil.diasAtePedido === null ? 'Sem dados' : `${dias(funil.diasAtePedido)} em média`}</dd>
            </div>
            <div>
              <dt>Entre as outras etapas</dt>
              <dd>Sem dados</dd>
            </div>
            {funil.semMarca ? (
              <div>
                <dt>Leads sem marca (SDR · WhatsApp)</dt>
                <dd>{numero(funil.semMarca)}</dd>
              </div>
            ) : null}
          </dl>
          <p className="yn-muted text-sm">
            O CRM ainda não manda a data de cada etapa, só a do lead e a do 1º pedido. Faturado hoje é marcado
            à mão no CRM.
          </p>
        </div>
      </div>

      <AsTable
        legenda="Funil dos leads do período"
        colunas={[
          'Etapa',
          'Leads',
          'Da etapa anterior',
          'Do total',
          ...(comparar ? ['Período anterior'] : []),
        ]}
        linhas={funil.etapas.map((e) => [
          e.rotulo,
          numero(e.total.atual),
          percentual(e.daAnterior),
          percentual(e.doTotal),
          ...(comparar ? [numero(e.total.anterior)] : []),
        ])}
      />
    </Bloco>
  );
}

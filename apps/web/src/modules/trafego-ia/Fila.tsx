/**
 * Fila de aprovação (.yn-decision): uma proposta por vez, com os fatos que a justificam, "Descartar"
 * (pede motivo) e "Aprovar" (o único botão principal da tela, com confirmação que mostra o nome e o
 * custo estimado). A proposta aberta fica na URL (`?proposta=`), para "Decidir" na lista trazer
 * a dela para cá e o link compartilhado abrir na mesma.
 *
 * Aprovar só muda o status para "Aprovada" e grava quem e quando (o diário lê da ação). Nada executa.
 */

import { Check, ChevronLeft, ChevronRight, CircleCheck, Filter, TriangleAlert } from 'lucide-react';
import { forwardRef, useId, useState, type ReactNode } from 'react';
import { rotulo } from '@csp-mkt/shared';
import { ChipSerie, Vazio, useToast } from '../../components/ui';
import { aprovarAcao } from '../../data/actions';
import type { ItemDeAcao } from '../../data/queries/trafego-ia';
import { dataHora, dinheiro } from '../../lib/format';
import { descartarProposta } from './estado';
import { FATOS_COMPACTOS } from './estilos';
import { JanelaAprovar, JanelaDescartar, NAO_EXECUTA } from './janelas';
import { usePermissoesDoTrafego } from './permissoes';

export interface FilaProps {
  fila: ItemDeAcao[];
  /** Id da proposta aberta (da URL); a primeira da fila quando não está nela. */
  selecionada: string | null;
  aoSelecionar: (id: string | null) => void;
  semDados: boolean;
  /** Há filtro de canal, campanha ou operador na barra. */
  filtrada: boolean;
  aoLimparFiltros: () => void;
}

export const FilaDeAprovacao = forwardRef<HTMLElement, FilaProps>(function FilaDeAprovacao(
  { fila, selecionada, aoSelecionar, semDados, filtrada, aoLimparFiltros },
  ref,
) {
  const { perfilId, podeAprovar } = usePermissoesDoTrafego();
  const { avisar } = useToast();
  const idTitulo = useId();
  const [janela, setJanela] = useState<'aprovar' | 'descartar' | null>(null);

  const indice = Math.max(
    0,
    fila.findIndex((i) => i.id === selecionada),
  );
  const item = fila[indice] ?? null;
  const vizinha = (): string | null => fila[indice + 1]?.id ?? fila[indice - 1]?.id ?? null;

  let corpo: ReactNode;
  if (!item) {
    corpo = semDados ? (
      <Vazio
        titulo="Sem dados"
        texto="A fila aparece quando as propostas do Claude e as ideias do gestor chegarem."
      />
    ) : filtrada ? (
      <Vazio
        icone={Filter}
        titulo="Nenhuma proposta com estes filtros"
        texto="Pode haver propostas em outro canal, campanha ou operador."
        acao={
          <button className="yn-btn yn-btn--secondary" type="button" onClick={aoLimparFiltros}>
            Limpar filtros
          </button>
        }
      />
    ) : (
      <Vazio
        icone={CircleCheck}
        titulo="Nenhuma proposta esperando você"
        texto="As novas propostas do Claude e as ideias do gestor aparecem aqui. O que já foi decidido está no Diário."
      />
    );
  } else {
    const conta = item.conta;
    corpo = (
      <article className="yn-decision" aria-labelledby={idTitulo}>
        <div className="yn-decision__head">
          <div className="grid min-w-0 gap-1">
            <p className="yn-eyebrow">
              {rotulo('actionKind', item.kind)} · {rotulo('brand', item.brandId)}
              {item.platform ? ` · ${rotulo('platform', item.platform)}` : ''}
            </p>
            <p className="yn-decision__title" id={idTitulo} style={{ overflowWrap: 'anywhere' }}>
              {item.title}
            </p>
          </div>
          <ChipSerie lista="operator" codigo={item.proposedBy} />
        </div>

        <p className="m-0 text-sm">{item.rationale}</p>

        <dl className="yn-dl" style={FATOS_COMPACTOS}>
          <div>
            <dt>Custo estimado</dt>
            <dd>{item.costCents === null ? '' : dinheiro(item.costCents)}</dd>
          </div>
          <div>
            <dt>Impacto</dt>
            <dd>{rotulo('level', item.impact)}</dd>
          </div>
          <div>
            <dt>Esforço</dt>
            <dd>{rotulo('level', item.effort)}</dd>
          </div>
          <div>
            <dt>Campanha</dt>
            <dd>{item.campanha?.nome ?? (item.kind === 'create' ? 'Campanha nova' : '')}</dd>
          </div>
          <div>
            <dt>Gasto da conta no mês</dt>
            <dd>
              {conta && conta.gastoNoMes !== null
                ? conta.limite !== null
                  ? `${dinheiro(conta.gastoNoMes)} de ${dinheiro(conta.limite)}`
                  : dinheiro(conta.gastoNoMes)
                : ''}
            </dd>
          </div>
          <div>
            <dt>Proposta em</dt>
            <dd>{dataHora(item.createdAt)}</dd>
          </div>
        </dl>

        {item.alerta ? (
          <div className="yn-alert" data-tone="warning">
            <TriangleAlert strokeWidth={1.75} aria-hidden="true" />
            <div>{item.alerta}</div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1" role="group" aria-label="Andar pela fila">
            <button
              className="yn-btn yn-btn--ghost yn-btn--sm yn-btn--icon"
              type="button"
              aria-label="Proposta anterior"
              disabled={indice === 0}
              onClick={() => aoSelecionar(fila[indice - 1]?.id ?? null)}
            >
              <ChevronLeft strokeWidth={1.75} aria-hidden="true" />
            </button>
            <span className="yn-muted text-sm tabular-nums" aria-live="polite">
              {indice + 1} de {fila.length}
            </span>
            <button
              className="yn-btn yn-btn--ghost yn-btn--sm yn-btn--icon"
              type="button"
              aria-label="Próxima proposta"
              disabled={indice >= fila.length - 1}
              onClick={() => aoSelecionar(fila[indice + 1]?.id ?? null)}
            >
              <ChevronRight strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          {podeAprovar ? (
            <div className="yn-decision__actions">
              <button
                className="yn-btn yn-btn--secondary"
                type="button"
                aria-haspopup="dialog"
                onClick={() => setJanela('descartar')}
              >
                Descartar
              </button>
              <button
                className="yn-btn yn-btn--primary"
                type="button"
                aria-haspopup="dialog"
                onClick={() => setJanela('aprovar')}
              >
                <Check strokeWidth={1.75} aria-hidden="true" />
                Aprovar
              </button>
            </div>
          ) : (
            <p className="yn-muted m-0 text-sm">
              Só o dono aprova ou descarta. A proposta espera por ele aqui.
            </p>
          )}
        </div>
        <p className="yn-hint m-0">{NAO_EXECUTA}</p>
      </article>
    );
  }

  return (
    <section ref={ref} className="mkt-stack" aria-labelledby="trafego-fila" tabIndex={-1}>
      <div className="grid gap-1">
        <h2 id="trafego-fila">Fila de aprovação</h2>
        <p className="yn-muted m-0 text-sm">
          Uma proposta por vez: primeiro a de maior impacto e menor esforço.
        </p>
      </div>
      {corpo}
      {item && janela === 'aprovar' ? (
        <JanelaAprovar
          item={item}
          aoFechar={() => setJanela(null)}
          aoConfirmar={() => {
            const proxima = vizinha();
            aprovarAcao(item.id, perfilId);
            setJanela(null);
            aoSelecionar(proxima);
            avisar(`Proposta aprovada: ${item.title}.`);
          }}
        />
      ) : null}
      {item && janela === 'descartar' ? (
        <JanelaDescartar
          item={item}
          aoFechar={() => setJanela(null)}
          aoConfirmar={(motivo) => {
            const proxima = vizinha();
            descartarProposta(item.id, motivo, perfilId);
            setJanela(null);
            aoSelecionar(proxima);
            avisar(`Proposta descartada: ${item.title}.`);
          }}
        />
      ) : null}
    </section>
  );
});

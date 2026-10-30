/**
 * Diário de ações (.yn-timeline): quem propôs, aprovou, executou, descartou, parou ou mudou o quê, do
 * mais novo para o mais antigo, no período escolhido e com os filtros da barra. Mostra 20 de cada vez;
 * "Mostrar mais" guarda quantos na URL (`?diario=`).
 */

import {
  Bot,
  Check,
  CircleCheck,
  CircleX,
  Gauge,
  Lightbulb,
  NotebookPen,
  OctagonX,
  Play,
  RotateCcw,
  ScrollText,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Vazio } from '../../components/ui';
import { LIMITE_DO_DIARIO, type EventoDoDiario, type PainelDoTrafego } from '../../data/queries/trafego-ia';
import { dataHora, plural } from '../../lib/format';

function iconeDe(evento: EventoDoDiario): LucideIcon {
  switch (evento.tipo) {
    case 'proposta':
      return evento.pendencia ? Wrench : evento.operador === 'claude' ? Bot : Lightbulb;
    case 'aprovada':
      return Check;
    case 'em_execucao':
      return Play;
    case 'feita':
      return CircleCheck;
    case 'descartada':
      return CircleX;
    case 'parar_tudo':
      return OctagonX;
    case 'reativar':
      return RotateCcw;
    case 'limite':
      return Gauge;
    default:
      return NotebookPen;
  }
}

export function Diario({
  diario,
  rotuloDoPeriodo,
  semDados,
  aoMostrarMais,
}: {
  diario: PainelDoTrafego['diario'];
  rotuloDoPeriodo: string;
  semDados: boolean;
  aoMostrarMais: () => void;
}) {
  const faltam = diario.total - diario.eventos.length;
  return (
    <section className="mkt-stack" aria-labelledby="trafego-diario">
      <div className="grid gap-1">
        <h2 id="trafego-diario">Diário de ações</h2>
        <p className="yn-muted m-0 text-sm">
          {`Tudo o que foi proposto, aprovado, feito, descartado ou parado, com quem e quando. Período: ${rotuloDoPeriodo.toLowerCase()}.`}
        </p>
      </div>
      {diario.eventos.length === 0 ? (
        semDados ? (
          <Vazio titulo="Sem dados" texto="O diário aparece quando as propostas e as ideias chegarem." />
        ) : (
          <Vazio
            icone={ScrollText}
            titulo="Nada no diário neste período"
            texto="Escolha um período maior no topo da tela ou limpe os filtros."
          />
        )
      ) : (
        <div className="yn-card grid gap-4">
          <ol className="yn-timeline">
            {diario.eventos.map((e) => {
              const Icone = iconeDe(e);
              return (
                <li key={e.id} className="yn-timeline__item" data-tone={e.tom ?? undefined}>
                  <span className="yn-timeline__icon">
                    <Icone strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="yn-timeline__head">
                      <strong>{e.titulo}</strong>
                      {e.por ? <span>por {e.por}</span> : null}
                      <time className="yn-timeline__time" dateTime={e.em}>
                        {dataHora(e.em)}
                      </time>
                    </p>
                    {e.corpo ? (
                      <p className="yn-timeline__body" style={{ overflowWrap: 'anywhere' }}>
                        {e.corpo}
                      </p>
                    ) : null}
                    {e.citacao ? <p className="yn-timeline__quote">{e.citacao}</p> : null}
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="yn-muted m-0 text-sm" aria-live="polite">
              Mostrando {diario.eventos.length} de {plural(diario.total, 'registro', 'registros')}.
            </p>
            {faltam > 0 ? (
              <button className="yn-btn yn-btn--secondary" type="button" onClick={aoMostrarMais}>
                Mostrar mais {Math.min(faltam, LIMITE_DO_DIARIO)}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

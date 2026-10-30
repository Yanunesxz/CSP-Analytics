/**
 * Indicadores da aba "Fila e ações" e o aviso das pendências que travam a medição (essas não entram na
 * fila: se resolvem fora do CSP-MKT e se marcam como feitas aqui).
 */

import { Wrench } from 'lucide-react';
import { useState } from 'react';
import { rotulo } from '@csp-mkt/shared';
import { Kpi, useToast } from '../../components/ui';
import { marcarAcaoComoFeita } from '../../data/actions';
import type { ItemDeAcao, PainelDoTrafego } from '../../data/queries/trafego-ia';
import { dinheiro } from '../../lib/format';
import { useFiltros } from '../../lib/url-state';
import { JanelaFeita } from './janelas';
import { usePermissoesDoTrafego } from './permissoes';

export function Resumo({ painel }: { painel: PainelDoTrafego }) {
  const { filtros } = useFiltros();
  const r = painel.resumo;
  // Com "Comparar com o anterior" desligado, nenhum texto fala do período anterior
  const anterior = filtros.comparar ? painel.intervalo.rotuloAnterior : undefined;
  const notaDaFila =
    r.naFila === null
      ? undefined
      : r.naFila === 0
        ? 'Nada esperando você'
        : r.custoDaFila === null
          ? 'Sem custo estimado'
          : `${dinheiro(r.custoDaFila)} de custo estimado`;
  return (
    <div className="mkt-grid-kpis">
      <Kpi rotulo="Esperando sua decisão" valor={r.naFila} nota={notaDaFila} />
      <Kpi
        rotulo="Aprovadas, a executar"
        valor={r.aprovadas}
        nota={r.aprovadas === null ? undefined : 'Esperam a credencial de escrita ou o "Marcar como feita"'}
      />
      <Kpi rotulo="Feitas no período" metrica={r.feitas} deltaTexto={anterior} />
      <Kpi
        rotulo="Horas até aprovar, em média"
        metrica={r.horasAteAprovar}
        menorEhMelhor
        deltaTexto={anterior}
      />
    </div>
  );
}

export function Pendencias({ pendencias }: { pendencias: ItemDeAcao[] }) {
  const { perfilId, podeOperar } = usePermissoesDoTrafego();
  const { avisar } = useToast();
  const [marcando, setMarcando] = useState<ItemDeAcao | null>(null);
  if (pendencias.length === 0) return null;
  return (
    <div className="yn-alert" data-tone="warning" role="status">
      <Wrench strokeWidth={1.75} aria-hidden="true" />
      <div className="grid flex-1 gap-2">
        <strong className="yn-alert__title">
          {pendencias.length === 1
            ? '1 pendência trava a medição'
            : `${pendencias.length} pendências travam a medição`}
        </strong>
        <p className="m-0">
          Resolva antes de confiar nos números de site e de GEO. Elas não entram na fila de aprovação.
        </p>
        <ul className="m-0 grid list-none gap-2 p-0">
          {pendencias.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-semibold">{p.title}</span> · {rotulo('brand', p.brandId)}
              </span>
              {podeOperar ? (
                <button
                  className="yn-btn yn-btn--secondary yn-btn--sm"
                  type="button"
                  aria-label={`Marcar como feita: ${p.title}, ${rotulo('brand', p.brandId)}`}
                  onClick={() => setMarcando(p)}
                >
                  Marcar como feita
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      {marcando ? (
        <JanelaFeita
          item={marcando}
          aoFechar={() => setMarcando(null)}
          aoConfirmar={(resultado) => {
            marcarAcaoComoFeita(marcando.id, perfilId, resultado);
            setMarcando(null);
            avisar('Pendência marcada como feita.');
          }}
        />
      ) : null}
    </div>
  );
}

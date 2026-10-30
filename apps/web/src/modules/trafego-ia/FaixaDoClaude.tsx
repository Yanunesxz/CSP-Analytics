/**
 * O Claude agora: quantas campanhas ele opera na marca escolhida e o botão "Parar tudo do Claude"
 * (confirmação dupla), sempre à vista acima das abas e longe do "Aprovar" (lei de Fitts: o perigoso
 * fica longe da ação principal). Depois de parar, mostra quem parou, quando e "Desfazer".
 */

import { Bot, OctagonX, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { rotulo, rotuloMarca } from '@csp-mkt/shared';
import { useToast } from '../../components/ui';
import type { PainelDoTrafego } from '../../data/queries/trafego-ia';
import { dataHora, plural } from '../../lib/format';
import type { Marca } from '../../lib/url-state';
import { desfazerParada, pararTudoDoClaude } from './estado';
import { JanelaPararTudo } from './janelas';
import { usePermissoesDoTrafego } from './permissoes';

function onde(marca: Marca): string {
  return marca === 'todas' ? 'nas duas marcas' : `em ${rotuloMarca(marca)}`;
}

export function FaixaDoClaude({ claude, marca }: { claude: PainelDoTrafego['claude']; marca: Marca }) {
  const { perfilId, podeParar } = usePermissoesDoTrafego();
  const { avisar } = useToast();
  const [confirmando, setConfirmando] = useState(false);
  const ativas = claude.ativas;
  const porCanal = claude.porCanal.filter((c) => c.ativas > 0);
  const parada = claude.parada;

  return (
    <section className="yn-card grid gap-4" aria-labelledby="trafego-claude">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="grid min-w-0 gap-1">
          <h2 id="trafego-claude" className="flex items-center gap-2">
            <Bot strokeWidth={1.75} aria-hidden="true" />O Claude agora
          </h2>
          <p className="text-sm">
            {ativas === null
              ? 'Sem dados das campanhas do Claude.'
              : ativas === 0
                ? `Nenhuma campanha ativa do Claude ${onde(marca)}.`
                : `Opera ${plural(ativas, 'campanha ativa', 'campanhas ativas')} ${onde(marca)}: ${porCanal
                    .map((c) => `${rotulo('platform', c.canal)} ${c.ativas}`)
                    .join(' · ')}.`}
          </p>
          <p className="yn-muted text-sm">
            Ele propõe; nada roda sem aprovação. A execução nas plataformas liga quando houver credencial de
            escrita.
          </p>
        </div>
        {podeParar ? (
          <button
            className="yn-btn yn-btn--danger"
            type="button"
            disabled={!ativas}
            onClick={() => setConfirmando(true)}
            aria-haspopup="dialog"
          >
            <OctagonX strokeWidth={1.75} aria-hidden="true" />
            Parar tudo do Claude
          </button>
        ) : null}
      </div>

      {parada ? (
        <div className="yn-alert" data-tone="warning" role="status">
          <OctagonX strokeWidth={1.75} aria-hidden="true" />
          <div className="grid flex-1 gap-2">
            <p className="m-0">
              <strong className="yn-alert__title">Claude parado {onde(parada.marca)}</strong>
              {dataHora(parada.em)}
              {parada.por ? `, por ${parada.por}` : ''}:{' '}
              {plural(parada.aindaPausadas, 'campanha continua pausada', 'campanhas continuam pausadas')}.
            </p>
            {podeParar ? (
              <div className="mkt-actions">
                <button
                  className="yn-btn yn-btn--secondary yn-btn--sm"
                  type="button"
                  onClick={() => {
                    const voltaram = desfazerParada(parada.id, perfilId);
                    avisar(
                      voltaram
                        ? `${plural(voltaram, 'campanha do Claude reativada', 'campanhas do Claude reativadas')}.`
                        : 'Nada para desfazer: as campanhas já voltaram.',
                    );
                  }}
                >
                  <Undo2 strokeWidth={1.75} aria-hidden="true" />
                  Desfazer a parada
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {confirmando ? (
        <JanelaPararTudo
          marca={marca}
          claude={claude}
          aoFechar={() => setConfirmando(false)}
          aoConfirmar={() => {
            const quantas = pararTudoDoClaude(marca, perfilId);
            setConfirmando(false);
            avisar(
              quantas
                ? `${plural(quantas, 'campanha do Claude pausada', 'campanhas do Claude pausadas')}.`
                : 'Nenhuma campanha ativa do Claude para parar.',
            );
          }}
        />
      ) : null}
    </section>
  );
}

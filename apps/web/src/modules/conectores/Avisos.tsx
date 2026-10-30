/**
 * Avisos da tela Conectores (.yn-alert), no topo do conteúdo: a situação geral (caído, atrasado ou tudo
 * funcionando, com o que afeta e o que fazer) e, só quando acontecem, a visão Gestor de tráfego (conector
 * não tem operador nem verba) e a marca escolhida no menu (conector não tem marca).
 */

import { CircleCheck, CloudOff, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { PainelDeConectores } from '../../data/queries/conectores';
import { useFiltros } from '../../lib/url-state';
import { AVISO_DO_GESTOR, avisoGeral, NOTA_DA_MARCA, type AvisoGeral } from './textos';

/** Id do aviso da situação geral: o foco vai para ele depois de "Tentar de novo" (o cartão muda de lugar). */
export const ID_DA_SITUACAO = 'conectores-situacao';

const ICONE: Record<AvisoGeral['tom'], LucideIcon> = {
  success: CircleCheck,
  info: Info,
  warning: TriangleAlert,
  danger: CloudOff,
};

export interface AvisosProps {
  painel: PainelDeConectores;
  podeTentar: boolean;
  verTrafego: boolean;
  /** Quando o último "Tentar de novo" deu certo, para "Tudo funcionando de novo desde HH:MM". */
  recuperadoEm: string | null;
}

export function Avisos({ painel, podeTentar, verTrafego, recuperadoEm }: AvisosProps) {
  const { filtros, linkCom } = useFiltros();
  const geral = avisoGeral(painel, { podeTentar, recuperadoEm });
  const gestor = filtros.visao === 'gestor';
  const comMarca = filtros.marca !== 'todas';

  if (!geral && !gestor && !comMarca) return null;
  const IconeGeral = geral ? ICONE[geral.tom] : null;

  return (
    <div className="mkt-stack" style={{ gap: 'var(--space-3)' }}>
      {geral && IconeGeral ? (
        <div
          id={ID_DA_SITUACAO}
          tabIndex={-1}
          className="yn-alert"
          data-tone={geral.tom}
          role={geral.tom === 'warning' || geral.tom === 'danger' ? 'status' : undefined}
        >
          <IconeGeral strokeWidth={1.75} aria-hidden="true" />
          <div>
            <strong className="yn-alert__title">{geral.titulo}</strong>
            {geral.texto}
          </div>
        </div>
      ) : null}

      {gestor ? (
        <div className="yn-alert" data-tone="info">
          <Info strokeWidth={1.75} aria-hidden="true" />
          <div>
            <strong className="yn-alert__title">{AVISO_DO_GESTOR.titulo}</strong>
            {AVISO_DO_GESTOR.texto}
            {verTrafego ? (
              <>
                {' '}
                <Link className="underline" to={linkCom('/trafego')}>
                  {AVISO_DO_GESTOR.link}
                </Link>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {comMarca ? <p className="yn-muted text-sm">{NOTA_DA_MARCA}</p> : null}
    </div>
  );
}

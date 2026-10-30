/**
 * Estado vazio (.yn-empty) e falha ao carregar (data-state="error" + "Tentar de novo").
 * Falha ≠ vazio ≠ sem dados (regra 8 da seção 7).
 */

import { CloudOff, Inbox, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface VazioProps {
  titulo: string;
  /** Explica o próximo passo. */
  texto?: string;
  icone?: LucideIcon;
  /** Vira falha ao carregar: ícone de nuvem, role="alert" e botão "Tentar de novo". */
  erro?: boolean;
  /** Código curto para o suporte (ex.: "DEMO-500"). */
  codigo?: string | null;
  aoTentarDeNovo?: () => void;
  /** Ação do estado vazio (ex.: link "Ir para Conectores"). */
  acao?: ReactNode;
}

export function Vazio({ titulo, texto, icone, erro = false, codigo, aoTentarDeNovo, acao }: VazioProps) {
  const Icone = icone ?? (erro ? CloudOff : Inbox);
  return (
    <div className="yn-empty" data-state={erro ? 'error' : undefined} role={erro ? 'alert' : undefined}>
      <span className="yn-empty__icon">
        <Icone strokeWidth={1.75} aria-hidden="true" />
      </span>
      <p className="yn-empty__title">{titulo}</p>
      {texto ? <p>{texto}</p> : null}
      {erro && aoTentarDeNovo ? (
        <button className="yn-btn yn-btn--secondary" type="button" onClick={aoTentarDeNovo}>
          Tentar de novo
        </button>
      ) : null}
      {acao}
      {codigo ? <span className="yn-empty__code">Código {codigo}</span> : null}
    </div>
  );
}

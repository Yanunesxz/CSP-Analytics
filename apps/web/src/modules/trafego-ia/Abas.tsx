/**
 * Abas da tela (.yn-tabs), com a aba atual na URL (`?aba=`). Teclado como o padrão ARIA de abas:
 * setas esquerda e direita, Home e End mudam de aba; Tab entra no painel.
 */

import { useRef, type KeyboardEvent } from 'react';
import { ABAS, type Aba } from './url';

export function idDaAba(aba: Aba): string {
  return `trafego-aba-${aba}`;
}

export function idDoPainel(aba: Aba): string {
  return `trafego-painel-${aba}`;
}

export function Abas({
  atual,
  contagens,
  aoMudar,
}: {
  atual: Aba;
  /** Número ao lado do nome da aba (ex.: propostas na fila); null não mostra. */
  contagens?: Partial<Record<Aba, number | null>>;
  aoMudar: (aba: Aba) => void;
}) {
  const refs = useRef<Partial<Record<Aba, HTMLButtonElement | null>>>({});

  const ir = (aba: Aba) => {
    aoMudar(aba);
    refs.current[aba]?.focus();
  };

  const aoTeclar = (evento: KeyboardEvent<HTMLDivElement>) => {
    const i = ABAS.findIndex((a) => a.codigo === atual);
    let alvo: Aba | undefined;
    if (evento.key === 'ArrowRight') alvo = ABAS[(i + 1) % ABAS.length]?.codigo;
    else if (evento.key === 'ArrowLeft') alvo = ABAS[(i - 1 + ABAS.length) % ABAS.length]?.codigo;
    else if (evento.key === 'Home') alvo = ABAS[0]?.codigo;
    else if (evento.key === 'End') alvo = ABAS[ABAS.length - 1]?.codigo;
    if (!alvo) return;
    evento.preventDefault();
    ir(alvo);
  };

  return (
    <div
      className="yn-tabs"
      role="tablist"
      aria-label="Partes de Tráfego com IA"
      onKeyDown={aoTeclar}
      // .yn-tabs rola de lado (overflow-x: auto) e a margem de -1px da aba sobra 1px em pé: sem isto,
      // aparece uma barra de rolagem vertical na fila de abas (pendência anotada para o padrão)
      style={{ overflowY: 'hidden' }}
    >
      {ABAS.map((a) => {
        const selecionada = a.codigo === atual;
        const n = contagens?.[a.codigo];
        return (
          <button
            key={a.codigo}
            ref={(el) => {
              refs.current[a.codigo] = el;
            }}
            id={idDaAba(a.codigo)}
            className="yn-tab"
            type="button"
            role="tab"
            aria-selected={selecionada}
            aria-controls={idDoPainel(a.codigo)}
            tabIndex={selecionada ? 0 : -1}
            onClick={() => aoMudar(a.codigo)}
          >
            {a.rotulo}
            {n !== null && n !== undefined && n > 0 ? (
              <>
                {' '}
                <span className="yn-count" aria-hidden="true">
                  {n}
                </span>
                <span className="yn-sr-only">({n})</span>
              </>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

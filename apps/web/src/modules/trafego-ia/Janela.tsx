/**
 * Janela (.yn-modal) ou painel lateral (.yn-drawer) aberto com showModal(), pela regra 11 da seção 7:
 * Esc fecha; clicar fora não fecha (a janela tem ação); pergunta antes de descartar o que foi digitado;
 * foco no primeiro campo ([data-foco-inicial]) ou em "Cancelar"; quem chama trava o botão enquanto grava.
 *
 * Fica no módulo enquanto `components/ui` não tem uma janela comum (a tela de canal tem uma igual):
 * anotado como pendência da fundação.
 */

import { TriangleAlert, X } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

export interface JanelaProps {
  titulo: string;
  aoFechar: () => void;
  aoEnviar: () => void;
  /** Há algo digitado: antes de fechar, pergunta se pode descartar. */
  sujo?: boolean;
  /** Botão de confirmar (type="submit"). "Cancelar" vem sozinho. */
  confirmar: ReactNode;
  /** `drawer` para formulário com mais campos (painel lateral). */
  variante?: 'modal' | 'drawer';
  children: ReactNode;
}

export function Janela({
  titulo,
  aoFechar,
  aoEnviar,
  sujo = false,
  confirmar,
  variante = 'modal',
  children,
}: JanelaProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();
  const [perguntando, setPerguntando] = useState(false);

  // Abre ao montar e fecha ao desmontar (antes de sair do DOM, para o foco voltar a quem abriu)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.open) el.showModal();
    const primeiro =
      el.querySelector<HTMLElement>('[data-foco-inicial]') ??
      el.querySelector<HTMLElement>('[data-cancelar]');
    primeiro?.focus();
    return () => {
      if (el.open) el.close();
    };
  }, []);

  const pedirFechar = () => {
    if (sujo) setPerguntando(true);
    else aoFechar();
  };

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    aoEnviar();
    // Não deu para gravar: o foco vai para o primeiro campo com erro (a janela continua aberta)
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
  };

  return (
    <dialog
      ref={ref}
      className={variante === 'drawer' ? 'yn-drawer' : 'yn-modal'}
      style={variante === 'drawer' ? { overflowY: 'auto' } : undefined}
      aria-labelledby={idTitulo}
      onCancel={(evento) => {
        evento.preventDefault();
        pedirFechar();
      }}
      onClose={() => {
        // Só quando o navegador fechou sozinho. Ignora o "close" atrasado de uma janela que já reabriu
        // (o StrictMode do dev monta, desmonta e monta de novo).
        if (!ref.current?.open) aoFechar();
      }}
    >
      <form className="grid gap-4" noValidate onSubmit={enviar}>
        <div className="yn-dialog__header" style={{ marginBottom: 0 }}>
          <h2 id={idTitulo}>{titulo}</h2>
          <button
            className="yn-btn yn-btn--ghost yn-btn--icon"
            type="button"
            aria-label="Fechar"
            onClick={pedirFechar}
          >
            <X strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        {children}

        {perguntando ? (
          <div className="yn-alert" data-tone="warning" role="alert">
            <TriangleAlert strokeWidth={1.75} aria-hidden="true" />
            <div className="grid gap-2">
              <strong className="yn-alert__title">Descartar o que você digitou?</strong>
              <div className="mkt-actions">
                <button
                  className="yn-btn yn-btn--secondary yn-btn--sm"
                  type="button"
                  autoFocus
                  onClick={() => setPerguntando(false)}
                >
                  Continuar editando
                </button>
                <button className="yn-btn yn-btn--danger yn-btn--sm" type="button" onClick={aoFechar}>
                  Descartar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="yn-dialog__footer" style={{ marginTop: 0 }}>
          <button className="yn-btn yn-btn--secondary" type="button" data-cancelar onClick={pedirFechar}>
            Cancelar
          </button>
          {confirmar}
        </div>
      </form>
    </dialog>
  );
}

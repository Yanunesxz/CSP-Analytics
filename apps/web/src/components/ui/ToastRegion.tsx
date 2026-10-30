/**
 * Aviso rápido (.yn-toast-region aria-live): resultado do que a pessoa acabou de fazer.
 * `const { avisar } = useToast(); avisar('Proposta aprovada.');`
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

interface Toast {
  id: number;
  texto: string;
  tom?: 'success' | 'danger';
}

interface ContextoToast {
  avisar: (texto: string, opcoes?: { tom?: Toast['tom']; duracaoMs?: number }) => void;
}

const Contexto = createContext<ContextoToast | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const proximoId = useRef(1);

  const avisar = useCallback<ContextoToast['avisar']>((texto, opcoes) => {
    const id = proximoId.current++;
    setToasts((lista) => [...lista, { id, texto, tom: opcoes?.tom }]);
    window.setTimeout(
      () => setToasts((lista) => lista.filter((t) => t.id !== id)),
      opcoes?.duracaoMs ?? 4000,
    );
  }, []);

  const valor = useMemo(() => ({ avisar }), [avisar]);

  return (
    <Contexto.Provider value={valor}>
      {children}
      <ToastRegion toasts={toasts} />
    </Contexto.Provider>
  );
}

export function ToastRegion({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="yn-toast-region" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="yn-toast" data-tone={t.tom}>
          {t.texto}
        </div>
      ))}
    </div>
  );
}

export function useToast(): ContextoToast {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('useToast precisa do <ToastProvider> (a casca já o fornece).');
  return ctx;
}

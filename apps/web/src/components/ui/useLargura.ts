import { useLayoutEffect, useState, type RefObject } from 'react';

/** Largura em px de um elemento, acompanhando o redimensionamento (gráfico responsivo pelo espaço). */
export function useLargura(ref: RefObject<HTMLElement | null>, inicial = 640): number {
  const [largura, setLargura] = useState(inicial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setLargura(Math.max(160, Math.round(el.getBoundingClientRect().width)));
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, [ref]);
  return largura;
}

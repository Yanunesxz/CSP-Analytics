/**
 * Aba Diagnóstico (seção 11 do padrão): carrega ui/diagnostico.js do jsDelivr e monta o .yn-audit
 * com o perfil deste sistema (interno, não vende, não rastreia, dado pessoal mínimo) em todas as rotas.
 * Rota protegida: só o dono (ROTAS_PROTEGIDAS em @csp-mkt/shared).
 */

import { useEffect, useRef, useState } from 'react';
import { ROTAS } from '../../rotas';
import { PageHeader } from '../../components/layout/pagina';
import { Esqueleto } from '../../components/ui/Esqueleto';
import { Vazio } from '../../components/ui/Vazio';

const SCRIPT = 'https://cdn.jsdelivr.net/gh/Yanunesxz/SystemDesing@v0.4.0/ui/diagnostico.js';

/** Páginas testadas: todas as rotas, menos esta (abrir o diagnóstico dentro do diagnóstico). */
const PAGINAS = ROTAS.filter((r) => r !== '/diagnostico');

function carregarScript(): Promise<void> {
  if (window.YNDiagnostico) return Promise.resolve();
  return new Promise((resolver, rejeitar) => {
    const existente = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
    if (existente) {
      existente.addEventListener('load', () => resolver());
      existente.addEventListener('error', () => rejeitar(new Error('script')));
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.addEventListener('load', () => resolver());
    script.addEventListener('error', () => rejeitar(new Error('script')));
    document.head.appendChild(script);
  });
}

export default function Diagnostico() {
  const alvo = useRef<HTMLElement>(null);
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setEstado('carregando');
    carregarScript()
      .then(() => {
        if (cancelado || !alvo.current || !window.YNDiagnostico) return;
        alvo.current.className = '';
        window.YNDiagnostico.montar(alvo.current, {
          perfil: { publico: false, vende: false, rastreamento: false, dadosPessoais: true },
          paginas: [...PAGINAS],
          larguras: [375, 1280, 1920],
          esperar: 1500,
        });
        setEstado('ok');
      })
      .catch(() => {
        if (!cancelado) setEstado('erro');
      });
    return () => {
      cancelado = true;
    };
  }, [tentativa]);

  return (
    <>
      <PageHeader grupo="Sistema" titulo="Diagnóstico" />
      {estado === 'carregando' ? <Esqueleto variante="tabela" quantidade={8} /> : null}
      {estado === 'erro' ? (
        <Vazio
          erro
          titulo="Não deu para carregar o diagnóstico"
          texto="O script do padrão não chegou do jsDelivr. Confira a internet e tente de novo."
          codigo="DIAG-CDN"
          aoTentarDeNovo={() => setTentativa((t) => t + 1)}
        />
      ) : null}
      <section id="diagnostico" aria-label="Diagnóstico" ref={alvo} />
    </>
  );
}

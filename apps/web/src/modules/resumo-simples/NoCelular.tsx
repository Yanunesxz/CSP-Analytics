/**
 * Cartão "Deixe o resumo na tela do celular": o convite para instalar o CSP MKT como app, como no app dos
 * representantes. Onde o navegador permite, um botão instala; no iPhone e nos outros, o texto ensina o
 * caminho pelo menu. Aberto pelo ícone (já instalado), o cartão some.
 */

import { Smartphone } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../../components/ui';
import { pedirInstalacao, useInstalacao } from '../../lib/app-instalavel';
import { textoDaInstalacao } from './textos';

export function NoCelular() {
  const estado = useInstalacao();
  const { avisar } = useToast();
  const [pedindo, setPedindo] = useState(false);
  const conteudo = textoDaInstalacao(estado);
  if (!conteudo) return null;

  async function instalar() {
    setPedindo(true);
    const aceitou = await pedirInstalacao();
    setPedindo(false);
    if (aceitou) avisar('App instalado. O ícone do CSP MKT já está na tela.');
  }

  return (
    <section className="yn-card" aria-labelledby="resumo-no-celular">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span className="yn-empty__icon m-0 shrink-0" aria-hidden="true">
          <Smartphone strokeWidth={1.75} />
        </span>
        <div className="grid min-w-0 flex-[1_1_240px] gap-1">
          <h2 id="resumo-no-celular">Deixe o resumo na tela do celular</h2>
          <p className="yn-muted m-0 text-sm">{conteudo.texto}</p>
        </div>
        {conteudo.botao ? (
          <button
            className="yn-btn yn-btn--secondary"
            type="button"
            onClick={instalar}
            disabled={pedindo}
            aria-busy={pedindo || undefined}
          >
            {conteudo.botao}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** O que cada palavra da tela quer dizer, para quem não trabalha com marketing. */

import { PALAVRAS } from './textos';

export function Palavras() {
  return (
    <section className="yn-card mkt-stack" aria-labelledby="resumo-palavras">
      <h2 id="resumo-palavras">O que cada palavra quer dizer</h2>
      <dl className="mkt-grid-2">
        {PALAVRAS.map((palavra) => (
          <div key={palavra.termo} className="grid content-start gap-1">
            <dt className="text-sm font-semibold">{palavra.termo}</dt>
            <dd className="yn-muted text-sm">{palavra.explicacao}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

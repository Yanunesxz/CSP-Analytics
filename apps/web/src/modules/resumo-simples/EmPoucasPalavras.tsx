/**
 * O resumo em três ou quatro frases, na ordem em que o dinheiro anda (gastou, trouxe, custou, voltou),
 * com os números em negrito. É o que a pessoa lê primeiro: se parar aqui, já sabe o principal.
 */

import type { ResumoSimples } from '../../data/queries/resumo-simples';
import type { Filtros } from '../../lib/url-state';
import { fraseDeTodosOsCaminhos, frasesDoResumo, marcaDoResumo, partes, periodoDoResumo } from './textos';

/** Desenha em negrito os trechos marcados com `**` nos textos. */
function Destaque({ texto }: { texto: string }) {
  return (
    <>
      {partes(texto).map((parte, i) =>
        parte.forte ? (
          <strong key={i} className="font-bold">
            {parte.texto}
          </strong>
        ) : (
          <span key={i}>{parte.texto}</span>
        ),
      )}
    </>
  );
}

export interface EmPoucasPalavrasProps {
  r: ResumoSimples;
  filtros: Filtros;
}

export function EmPoucasPalavras({ r, filtros }: EmPoucasPalavrasProps) {
  const frases = frasesDoResumo(r, filtros);
  const todosOsCaminhos = fraseDeTodosOsCaminhos(r);

  return (
    <section className="yn-card mkt-stack" aria-labelledby="resumo-frases">
      <div className="grid gap-1">
        <p className="yn-eyebrow">
          {periodoDoResumo(r.intervalo)} · {marcaDoResumo(filtros.marca)}
        </p>
        <h2 id="resumo-frases">Em poucas palavras</h2>
      </div>
      <div className="grid gap-2 text-lg">
        {frases.map((frase) => (
          <p key={frase}>
            <Destaque texto={frase} />
          </p>
        ))}
      </div>
      {todosOsCaminhos ? <p className="yn-muted text-sm">{todosOsCaminhos}</p> : null}
    </section>
  );
}

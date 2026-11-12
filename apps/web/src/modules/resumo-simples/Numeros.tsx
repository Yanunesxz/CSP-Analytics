/**
 * Os quatro números do resumo, na ordem em que o dinheiro anda: quanto gastou, quantos clientes novos
 * vieram, quanto custou cada um e quanto voltou. Cada cartão (.yn-card.yn-kpi) traz o número, a
 * diferença para o período de comparação em palavras e uma frase que diz o que o número é.
 *
 * Não usa o `Kpi` comum porque ele mostra a variação em % e não tem lugar para a frase.
 */

import type { ResumoSimples } from '../../data/queries/resumo-simples';
import { numerosDoResumo, periodoDeComparacao, type Diferenca } from './textos';

function classeDaDiferenca(d: Diferenca): string {
  if (d.tom === 'bom') return 'yn-kpi__delta yn-kpi__delta--up';
  if (d.tom === 'ruim') return 'yn-kpi__delta yn-kpi__delta--down';
  return 'yn-kpi__delta';
}

export function Numeros({ r }: { r: ResumoSimples }) {
  const numeros = numerosDoResumo(r);

  return (
    <section className="mkt-stack" aria-labelledby="resumo-numeros">
      <h2 id="resumo-numeros" className="yn-sr-only">
        Os quatro números do período
      </h2>
      <div className="mkt-grid-kpis">
        {numeros.map((n) => (
          <div key={n.chave} className="yn-card yn-kpi">
            <p className="yn-eyebrow">{n.titulo}</p>
            {n.valor === null ? (
              <p className="yn-kpi__value yn-kpi__value--empty">Sem dados</p>
            ) : (
              <p className="yn-kpi__value">{n.valor}</p>
            )}
            {n.diferenca ? <span className={classeDaDiferenca(n.diferenca)}>{n.diferenca.texto}</span> : null}
            <p className="yn-muted text-sm">{n.explicacao}</p>
          </div>
        ))}
      </div>
      {numeros.some((n) => n.diferenca) ? (
        <p className="yn-muted text-sm">
          {`Embaixo de cada número, a diferença para o período de comparação (${periodoDeComparacao(r.intervalo)}).`}
        </p>
      ) : null}
    </section>
  );
}

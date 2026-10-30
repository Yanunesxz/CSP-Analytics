/**
 * Régua de meta (.yn-meter): quanto fez, onde deveria estar e quanto falta.
 * Ex.: investimento do mês contra o teto da conta (decisão 0005).
 */

import { percentual } from '../../lib/format';

export interface MeterProps {
  rotulo: string;
  /** Feito; null = "Sem dados". */
  valor: number | null;
  /** O que vale 100%. */
  maximo: number | null;
  /** Onde deveria estar hoje, na mesma unidade de `valor`. */
  esperado?: number | null;
  formato?: (valor: number) => string;
  /** Textos nas pontas da legenda; padrão: valor feito e máximo. */
  legenda?: { esquerda?: string; direita?: string };
  /** Força o estado; sem ele, vem de `esperado` (behind/ahead) ou de bater o máximo (done). */
  estado?: 'behind' | 'ahead' | 'done';
}

export function Meter({
  rotulo,
  valor,
  maximo,
  esperado,
  formato = (v) => String(v),
  legenda,
  estado,
}: MeterProps) {
  const semBase = valor === null || maximo === null || maximo <= 0;
  const fracao = semBase ? 0 : valor / maximo;
  const fracaoEsperada = !semBase && esperado !== null && esperado !== undefined ? esperado / maximo : null;
  const estadoFinal =
    estado ??
    (semBase
      ? undefined
      : fracao >= 1
        ? 'done'
        : fracaoEsperada === null
          ? undefined
          : fracao < fracaoEsperada
            ? 'behind'
            : 'ahead');

  return (
    <div
      className="yn-meter"
      data-state={estadoFinal}
      style={{
        ['--value' as string]: Math.min(100, fracao * 100),
        ['--expected' as string]: fracaoEsperada === null ? 0 : Math.min(100, fracaoEsperada * 100),
      }}
    >
      <div className="yn-meter__head">
        <p>{rotulo}</p>
        <p className="yn-meter__value">{semBase ? 'Sem dados' : percentual(fracao, 0)}</p>
      </div>
      <div
        className="yn-meter__track"
        role="meter"
        aria-label={rotulo}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={semBase ? undefined : Math.round(fracao * 100)}
      >
        <span className="yn-meter__fill" />
        {fracaoEsperada !== null ? <span className="yn-meter__mark" title="Esperado hoje" /> : null}
      </div>
      <div className="yn-meter__legend">
        <span>{legenda?.esquerda ?? (valor === null ? 'Sem dados' : formato(valor))}</span>
        <span>{legenda?.direita ?? (maximo === null ? 'Sem teto' : `de ${formato(maximo)}`)}</span>
      </div>
    </div>
  );
}

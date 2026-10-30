/**
 * Gerador de números pseudoaleatórios com semente (mulberry32): mesma semente, mesmos dados.
 * Só para o modo demonstração.
 */

export interface Prng {
  /** Número em [0, 1). */
  proximo: () => number;
  /** Número real em [min, max). */
  entre: (min: number, max: number) => number;
  /** Inteiro em [min, max], inclusivo. */
  inteiro: (min: number, max: number) => number;
  /** `true` com probabilidade `p`. */
  chance: (p: number) => boolean;
  /** Um item da lista. */
  escolher: <T>(lista: readonly T[]) => T;
  /** Um item pela lista de pesos `[item, peso]`. */
  ponderado: <T>(opcoes: ReadonlyArray<readonly [T, number]>) => T;
  /** Ruído multiplicativo em torno de 1 (±amplitude). */
  ruido: (amplitude: number) => number;
}

export function criarPrng(semente: number): Prng {
  let estado = semente >>> 0;

  const proximo = (): number => {
    estado = (estado + 0x6d2b79f5) | 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const entre = (min: number, max: number): number => min + proximo() * (max - min);
  const inteiro = (min: number, max: number): number => Math.floor(entre(min, max + 1));

  return {
    proximo,
    entre,
    inteiro,
    chance: (p) => proximo() < p,
    escolher: (lista) => {
      if (lista.length === 0) throw new Error('Lista vazia');
      return lista[inteiro(0, lista.length - 1)] as (typeof lista)[number];
    },
    ponderado: (opcoes) => {
      const total = opcoes.reduce((soma, [, peso]) => soma + peso, 0);
      let alvo = proximo() * total;
      for (const [item, peso] of opcoes) {
        alvo -= peso;
        if (alvo <= 0) return item;
      }
      return opcoes[opcoes.length - 1]![0];
    },
    ruido: (amplitude) => 1 + entre(-amplitude, amplitude),
  };
}

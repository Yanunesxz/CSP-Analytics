/**
 * Período dos filtros → intervalo de dias de São Paulo, com o período anterior para comparar.
 * Pura; é a referência da função SQL que fará o mesmo na fase 3.
 */

import { diaSp, diferencaEmDias, fimDoMes, inicioDoMes, somarDias, somarMeses } from './datas';

export type Periodo = 'este-mes' | 'mes-passado' | '7d' | '30d' | '90d';

export const PERIODOS: ReadonlyArray<{ codigo: Periodo; rotulo: string }> = [
  { codigo: 'este-mes', rotulo: 'Este mês' },
  { codigo: 'mes-passado', rotulo: 'Mês passado' },
  { codigo: '7d', rotulo: 'Últimos 7 dias' },
  { codigo: '30d', rotulo: 'Últimos 30 dias' },
  { codigo: '90d', rotulo: 'Últimos 90 dias' },
];

export interface Intervalo {
  inicio: string;
  fim: string;
  anteriorInicio: string;
  anteriorFim: string;
  /** Quantos dias o período tem (inclusivo). */
  dias: number;
  rotulo: string;
  /** Como chamar o período anterior no delta: "vs. mês anterior", "vs. 7 dias anteriores". */
  rotuloAnterior: string;
}

export function rotuloPeriodo(periodo: Periodo): string {
  return PERIODOS.find((p) => p.codigo === periodo)?.rotulo ?? periodo;
}

export function intervaloDoPeriodo(periodo: Periodo, agora: Date | string = new Date()): Intervalo {
  const hoje = diaSp(agora);

  if (periodo === 'este-mes') {
    const inicio = inicioDoMes(hoje);
    const mesAnterior = somarMeses(hoje, -1);
    return {
      inicio,
      fim: hoje,
      anteriorInicio: inicioDoMes(mesAnterior),
      anteriorFim: fimDoMes(mesAnterior),
      dias: diferencaEmDias(inicio, hoje) + 1,
      rotulo: 'Este mês',
      rotuloAnterior: 'vs. mês anterior',
    };
  }

  if (periodo === 'mes-passado') {
    const mesPassado = somarMeses(hoje, -1);
    const retrasado = somarMeses(hoje, -2);
    const inicio = inicioDoMes(mesPassado);
    const fim = fimDoMes(mesPassado);
    return {
      inicio,
      fim,
      anteriorInicio: inicioDoMes(retrasado),
      anteriorFim: fimDoMes(retrasado),
      dias: diferencaEmDias(inicio, fim) + 1,
      rotulo: 'Mês passado',
      rotuloAnterior: 'vs. mês anterior',
    };
  }

  const dias = periodo === '7d' ? 7 : periodo === '30d' ? 30 : 90;
  const inicio = somarDias(hoje, -(dias - 1));
  return {
    inicio,
    fim: hoje,
    anteriorInicio: somarDias(inicio, -dias),
    anteriorFim: somarDias(inicio, -1),
    dias,
    rotulo: rotuloPeriodo(periodo),
    rotuloAnterior: `vs. ${dias} dias anteriores`,
  };
}

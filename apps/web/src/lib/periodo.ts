/**
 * Período dos filtros → intervalo de dias de São Paulo, com o período anterior para comparar.
 * Pura; é a referência da função SQL que fará o mesmo na fase 3.
 */

import { diaSp, diferencaEmDias, fimDoMes, inicioDoMes, partesDoDia, somarDias, somarMeses } from './datas';

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** "vs. 1º a 3 de outubro"; só o dia 1: "vs. 1º de outubro" (decisão 0026). */
function rotuloDosMesmosDias(fim: string): string {
  const { mes, dia } = partesDoDia(fim);
  const nome = MESES[mes - 1] ?? '';
  return dia === 1 ? `vs. 1º de ${nome}` : `vs. 1º a ${dia} de ${nome}`;
}

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
    const anteriorInicio = inicioDoMes(mesAnterior);
    // Os mesmos dias do mês anterior: do dia 1 ao mesmo dia, ou até o último dia dele se for mais curto (decisão
    // 0026). Comparar só os dias completos de cada fonte vem com o banco, na fase 4.
    const mesmoDia = somarDias(anteriorInicio, diferencaEmDias(inicio, hoje));
    const fimDoAnterior = fimDoMes(mesAnterior);
    const anteriorFim = mesmoDia < fimDoAnterior ? mesmoDia : fimDoAnterior;
    return {
      inicio,
      fim: hoje,
      anteriorInicio,
      anteriorFim,
      dias: diferencaEmDias(inicio, hoje) + 1,
      rotulo: 'Este mês',
      rotuloAnterior: rotuloDosMesmosDias(anteriorFim),
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

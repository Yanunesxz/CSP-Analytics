/**
 * Datas no fuso de São Paulo, num módulo só (seção 9 do padrão).
 *
 * "Dia" é sempre a string `AAAA-MM-DD` do calendário de São Paulo; "instante" é ISO 8601.
 * São Paulo não tem horário de verão desde 2019: UTC−3 o ano inteiro.
 */

export const FUSO = 'America/Sao_Paulo';
const DESLOCAMENTO_HORAS = 3;

const formatoDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Dia de São Paulo (`AAAA-MM-DD`) de um instante. Aceita ISO ou `Date`. */
export function diaSp(instante: Date | string): string {
  if (typeof instante === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(instante)) return instante;
  const d = typeof instante === 'string' ? new Date(instante) : instante;
  return formatoDia.format(d);
}

export function partesDoDia(dia: string): { ano: number; mes: number; dia: number } {
  const [a, m, d] = dia.split('-').map(Number);
  return { ano: a ?? 1970, mes: m ?? 1, dia: d ?? 1 };
}

/** Meio-dia UTC do dia: evita qualquer pulo de calendário ao somar dias. */
function ancora(dia: string): Date {
  const p = partesDoDia(dia);
  return new Date(Date.UTC(p.ano, p.mes - 1, p.dia, 12));
}

function diaDeUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function somarDias(dia: string, quantidade: number): string {
  const d = ancora(dia);
  d.setUTCDate(d.getUTCDate() + quantidade);
  return diaDeUtc(d);
}

export function somarMeses(dia: string, quantidade: number): string {
  const p = partesDoDia(dia);
  return diaDeUtc(new Date(Date.UTC(p.ano, p.mes - 1 + quantidade, 1, 12)));
}

export function inicioDoMes(dia: string): string {
  return `${dia.slice(0, 7)}-01`;
}

export function fimDoMes(dia: string): string {
  const p = partesDoDia(dia);
  return diaDeUtc(new Date(Date.UTC(p.ano, p.mes, 0, 12)));
}

/** Dias inclusivos entre `inicio` e `fim`, em ordem. */
export function diasEntre(inicio: string, fim: string): string[] {
  const dias: string[] = [];
  let atual = inicio;
  while (atual <= fim) {
    dias.push(atual);
    atual = somarDias(atual, 1);
  }
  return dias;
}

/** `fim − inicio` em dias (0 quando é o mesmo dia). */
export function diferencaEmDias(inicio: string, fim: string): number {
  return Math.round((ancora(fim).getTime() - ancora(inicio).getTime()) / 86_400_000);
}

/** Instante ISO de um horário local de São Paulo naquele dia. */
export function instanteDe(dia: string, hora = 12, minuto = 0, segundo = 0): string {
  const p = partesDoDia(dia);
  return new Date(
    Date.UTC(p.ano, p.mes - 1, p.dia, hora + DESLOCAMENTO_HORAS, minuto, segundo),
  ).toISOString();
}

export function estaEntre(dia: string, inicio: string, fim: string): boolean {
  return dia >= inicio && dia <= fim;
}

/**
 * Formatação para a tela (seção 9 do padrão): dinheiro de centavos, percentual, número
 * abreviado, data e hora em America/Sao_Paulo e "atualizado há X min".
 *
 * Valor `null`/`undefined`/`NaN` vira "—" (o traço do `.yn-dl`). O "Sem dados" de indicador
 * fica no componente `Kpi`, que recebe o número cru e decide.
 */

import { FUSO } from './datas';

export const VAZIO = '—';

/** Espaço que não quebra, entre R$ e o número (o mesmo que o Intl usa). */
const NBSP = String.fromCharCode(160);

function semBase(valor: number | null | undefined): valor is null | undefined {
  return valor === null || valor === undefined || Number.isNaN(valor) || !Number.isFinite(valor);
}

const inteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const comCasas = (casas: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

const moedaInteira = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const moedaComCentavos = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `R$ 1.234` quando é valor inteiro em reais; `R$ 1.234,56` quando tem centavos. */
export function dinheiro(cents: number | null | undefined): string {
  if (semBase(cents)) return VAZIO;
  const arredondado = Math.round(cents);
  const reais = arredondado / 100;
  return arredondado % 100 === 0 ? moedaInteira.format(reais) : moedaComCentavos.format(reais);
}

/** `R$ 82,4 mil`, `R$ 1,2 mi`; abaixo de mil reais, igual a `dinheiro`. */
export function dinheiroAbreviado(cents: number | null | undefined): string {
  if (semBase(cents)) return VAZIO;
  const reais = cents / 100;
  if (Math.abs(reais) < 1000) return dinheiro(cents);
  return `R$${NBSP}${numeroAbreviado(reais)}`;
}

/** `1.234` (ou com casas fixas: `numero(12.345, 1)` → `12,3`). */
export function numero(valor: number | null | undefined, casas = 0): string {
  if (semBase(valor)) return VAZIO;
  return casas > 0 ? comCasas(casas).format(valor) : inteiro.format(valor);
}

/** `950`, `82,4 mil`, `1,2 mi`, `3,1 bi`. */
export function numeroAbreviado(valor: number | null | undefined): string {
  if (semBase(valor)) return VAZIO;
  const abs = Math.abs(valor);
  const sinal = valor < 0 ? '-' : '';
  const escala = (base: number, sufixo: string) => {
    const n = abs / base;
    const texto = n >= 100 ? inteiro.format(n) : comCasas(1).format(n).replace(/,0$/, '');
    return `${sinal}${texto} ${sufixo}`;
  };
  if (abs >= 1_000_000_000) return escala(1_000_000_000, 'bi');
  if (abs >= 1_000_000) return escala(1_000_000, 'mi');
  if (abs >= 1000) return escala(1000, 'mil');
  return `${sinal}${inteiro.format(abs)}`;
}

/** Fração → percentual: `percentual(0.124)` → `12,4%`. */
export function percentual(fracao: number | null | undefined, casas = 1): string {
  if (semBase(fracao)) return VAZIO;
  return `${comCasas(casas).format(fracao * 100)}%`;
}

/** Variação com sinal: `+12,4%`, `-3,2%`, `0,0%`. */
export function variacao(fracao: number | null | undefined, casas = 1): string {
  if (semBase(fracao)) return VAZIO;
  const texto = percentual(Math.abs(fracao), casas);
  if (fracao > 0) return `+${texto}`;
  if (fracao < 0) return `-${texto}`;
  return texto;
}

/** Diferença relativa entre dois valores; `null` sem base (anterior 0 ou ausente). */
export function diferenca(
  atual: number | null | undefined,
  anterior: number | null | undefined,
): number | null {
  if (semBase(atual) || semBase(anterior) || anterior === 0) return null;
  return (atual - anterior) / Math.abs(anterior);
}

const fmtData = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const fmtDataHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const fmtHora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
const fmtDiaMes = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' });
const fmtDiaMesCurto = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: 'numeric', month: 'short' });
const fmtMesAno = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, month: 'short', year: 'numeric' });

function paraDate(valor: Date | string | null | undefined): Date | null {
  if (!valor) return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  // Só data (AAAA-MM-DD): lê como meio-dia de São Paulo, para o dia não mudar
  const d = /^\d{4}-\d{2}-\d{2}$/.test(valor) ? new Date(`${valor}T12:00:00-03:00`) : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `30/10/2026` */
export function data(valor: Date | string | null | undefined): string {
  const d = paraDate(valor);
  return d ? fmtData.format(d) : VAZIO;
}

/** `30/10/2026 14:30` */
export function dataHora(valor: Date | string | null | undefined): string {
  const d = paraDate(valor);
  return d ? fmtDataHora.format(d).replace(',', '') : VAZIO;
}

/** `14:30` */
export function hora(valor: Date | string | null | undefined): string {
  const d = paraDate(valor);
  return d ? fmtHora.format(d) : VAZIO;
}

/** `30/10` — eixo de gráfico e tabela compacta. */
export function diaMes(valor: Date | string | null | undefined): string {
  const d = paraDate(valor);
  return d ? fmtDiaMes.format(d) : VAZIO;
}

/** `30 out` */
export function diaMesCurto(valor: Date | string | null | undefined): string {
  const d = paraDate(valor);
  return d ? fmtDiaMesCurto.format(d).replace(/ de /, ' ').replace('.', '') : VAZIO;
}

/** `out/2026` — coorte por mês. */
export function mesAno(valor: Date | string | null | undefined): string {
  const d = paraDate(valor);
  return d
    ? fmtMesAno
        .format(d)
        .replace(/\. de /, '/')
        .replace(/ de /, '/')
        .replace('.', '')
    : VAZIO;
}

/**
 * "atualizado há 2 min", "atualizado há 3 h", "atualizado há 2 dias", "atualizado agora".
 * Sem data: "sem atualização".
 */
export function atualizadoHa(valor: Date | string | null | undefined, agora: Date = new Date()): string {
  const d = paraDate(valor);
  if (!d) return 'sem atualização';
  const minutos = Math.max(0, Math.round((agora.getTime() - d.getTime()) / 60_000));
  if (minutos < 1) return 'atualizado agora';
  if (minutos < 60) return `atualizado há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `atualizado há ${horas} h`;
  const dias = Math.floor(horas / 24);
  return `atualizado há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

/** `plural(3, 'lead', 'leads')` → `3 leads`. */
export function plural(quantidade: number | null | undefined, singular: string, pluralForma: string): string {
  if (semBase(quantidade)) return VAZIO;
  return `${numero(quantidade)} ${quantidade === 1 ? singular : pluralForma}`;
}

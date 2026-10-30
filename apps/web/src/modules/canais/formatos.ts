/**
 * Textos e conversões da tela de canal: valor em reais digitado (com vírgula ou ponto), frases do
 * ajuste de orçamento e da comparação Humano × Claude, rótulo das ações já decididas e tempo desde
 * a sincronização. Puras, com teste em `formatos.test.ts`.
 *
 * Nenhum KPI nasce aqui: só a forma de dizer o que a consulta já entregou e o que a pessoa digitou.
 */

import { dinheiro, numero, percentual } from '../../lib/format';
import type { AcaoAberta, LinhaHumanoClaude, Sentido } from '../../data/queries/canais';

/** Dias usados para estimar o custo de um ajuste de orçamento (a mesma conta das propostas do Claude). */
export const DIAS_DO_AJUSTE = 30;

/** Mudança de orçamento acima disso pede conferência (aviso, não bloqueia). */
export const MUDANCA_GRANDE = 0.5;

function centavos(normalizado: string): number | null {
  if (!/^-?\d*(\.\d*)?$/.test(normalizado) || !/\d/.test(normalizado)) return null;
  const negativo = normalizado.startsWith('-');
  const [inteira = '', fracao = ''] = normalizado.replace('-', '').split('.');
  const reais = Number(inteira || '0');
  const resto = Math.round(Number(`0.${fracao || '0'}`) * 100);
  if (!Number.isFinite(reais) || !Number.isFinite(resto)) return null;
  const total = reais * 100 + resto;
  return negativo ? -total : total;
}

/**
 * Valor em reais digitado → centavos (lei de Postel: aceita qualquer formato e grava padronizado).
 * Aceita "150", "150,5", "150,00", "1.500", "1.500,00", "1500.00", "1,500.00" e "R$ 1.500".
 * Com vírgula e ponto, o último é o decimal; só com ponto, grupos de 3 dígitos são milhar.
 * Devolve null quando não é um número.
 */
export function lerReais(texto: string): number | null {
  const limpo = texto.replace(/R\$/gi, '').replace(/\s/g, '');
  if (!limpo || !/^-?[\d.,]+$/.test(limpo)) return null;
  const virgula = limpo.lastIndexOf(',');
  const ponto = limpo.lastIndexOf('.');

  if (virgula >= 0 && ponto >= 0) {
    return virgula > ponto
      ? centavos(limpo.replace(/\./g, '').replace(',', '.'))
      : centavos(limpo.replace(/,/g, ''));
  }

  const separador = virgula >= 0 ? ',' : ponto >= 0 ? '.' : null;
  if (!separador) return centavos(limpo);

  const partes = limpo.replace('-', '').split(separador);
  const [primeira = ''] = partes;
  const milhar =
    partes.length > 1 &&
    partes.slice(1).every((p) => p.length === 3) &&
    (separador === '.' || partes.length > 2) &&
    (partes.length > 2 || primeira.length <= 3);
  const sinal = limpo.startsWith('-') ? '-' : '';
  if (milhar) return centavos(sinal + partes.join(''));
  if (partes.length === 2) return centavos(`${sinal}${primeira}.${partes[1]}`);
  return null;
}

/** Centavos → texto para o campo, no formato que a pessoa lê: `1.200,00`. */
export function valorParaCampo(cents: number): string {
  return numero(cents / 100, 2);
}

/** Erro do campo "Novo orçamento diário", ou null quando o valor serve. */
export function validarOrcamento(novoCents: number | null, atualCents: number): string | null {
  if (novoCents === null) return 'Informe um valor em reais, como 150 ou 150,00.';
  if (novoCents <= 0) return 'Use um valor maior que zero.';
  if (novoCents === atualCents) return 'O valor é igual ao de hoje.';
  return null;
}

/** Custo estimado de um ajuste: só aumento custa; 30 dias, a mesma conta das propostas. */
export function custoDoAjuste(atualCents: number, novoCents: number): number {
  return Math.max(0, (novoCents - atualCents) * DIAS_DO_AJUSTE);
}

/** "Sobe 25,0%: R$ 30 a mais por dia, cerca de R$ 900 em 30 dias." */
export function fraseDoAjuste(atualCents: number, novoCents: number): string {
  const porDia = novoCents - atualCents;
  if (porDia === 0) return 'Fica igual ao de hoje.';
  const relativo = atualCents > 0 ? ` ${percentual(Math.abs(porDia) / atualCents)}` : '';
  const verbo = porDia > 0 ? 'Sobe' : 'Desce';
  const lado = porDia > 0 ? 'a mais' : 'a menos';
  return `${verbo}${relativo}: ${dinheiro(Math.abs(porDia))} ${lado} por dia, cerca de ${dinheiro(
    Math.abs(porDia) * DIAS_DO_AJUSTE,
  )} em ${DIAS_DO_AJUSTE} dias.`;
}

/** A mudança passa de 50% do orçamento de hoje (pede conferência). */
export function mudancaGrande(atualCents: number, novoCents: number): boolean {
  if (atualCents <= 0) return true;
  return Math.abs(novoCents - atualCents) / atualCents > MUDANCA_GRANDE;
}

/** Se a diferença Claude − humano é boa ou ruim para o Claude; null quando não tem lado. */
export function avaliarDiferenca(diferenca: number | null, sentido: Sentido): 'melhor' | 'pior' | null {
  if (diferenca === null || diferenca === 0 || sentido === 'neutro') return null;
  return (sentido === 'maior') === diferenca > 0 ? 'melhor' : 'pior';
}

/**
 * Frase do bloco Humano × Claude, pelo número de sucesso (custo por cliente novo) ou, sem ele,
 * pelo custo por lead: "No período, o custo por lead do Claude está 14,0% abaixo do humano."
 */
export function fraseDaComparacao(linhas: readonly LinhaHumanoClaude[]): string | null {
  const linha =
    linhas.find((l) => l.chave === 'custoPorClienteNovo' && l.diferenca !== null) ??
    linhas.find((l) => l.chave === 'cpl' && l.diferenca !== null);
  if (!linha || linha.diferenca === null) return null;
  const metrica = linha.rotulo.toLowerCase();
  if (linha.diferenca === 0) return `No período, o ${metrica} do Claude é igual ao do humano.`;
  const lado = linha.diferenca < 0 ? 'abaixo' : 'acima';
  return `No período, o ${metrica} do Claude está ${percentual(Math.abs(linha.diferenca))} ${lado} do humano.`;
}

/** Rótulo da ação já decidida para uma campanha: "Pausa aprovada", "Orçamento aprovado: R$ 240 por dia". */
export function textoDaAcaoAberta(acao: AcaoAberta): string {
  const emExecucao = acao.status === 'running';
  if (acao.kind === 'pause') return emExecucao ? 'Pausa em execução' : 'Pausa aprovada';
  const situacao = emExecucao ? 'Orçamento em execução' : 'Orçamento aprovado';
  return acao.dailyBudgetCents === null
    ? situacao
    : `${situacao}: ${dinheiro(acao.dailyBudgetCents)} por dia`;
}

/** Minutos → "5 min", "3 h", "1 dia", "2 dias" (atraso de conector e intervalo esperado). */
export function duracao(minutos: number): string {
  if (minutos < 1) return 'menos de 1 min';
  if (minutos < 60) return `${Math.round(minutos)} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas} h`;
  const dias = Math.floor(horas / 24);
  return `${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

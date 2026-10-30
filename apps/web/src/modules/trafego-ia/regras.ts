/**
 * Regras puras da tela Tráfego com IA (com teste em `regras.test.ts`): ler o que a pessoa digita
 * (lei de Postel: aceita "1.234,56", "1234.56", "R$ 1.234"), validar os formulários e repartir o
 * limite da conta entre as campanhas ativas.
 */

import type { ActionKind, Brand, Campaign, Level, Platform } from '@csp-mkt/shared';
import { FUSO } from '../../lib/datas';

const fmtMes = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, month: 'long' });

/** Nome do mês de um dia `AAAA-MM-DD` ("outubro"), para "Gasto de outubro até hoje". */
export function nomeDoMes(dia: string): string {
  return fmtMes.format(new Date(`${dia}T12:00:00-03:00`));
}

/* ---------- Dinheiro e número digitados ---------- */

/**
 * Texto em reais → centavos. Aceita "R$ 1.234,56", "1234,56", "1234.56", "1.234" (mil), "1,5".
 * Com vírgula e ponto, o último é o decimal; só ponto com 3 dígitos depois é milhar. Vazio ou inválido → null.
 */
export function lerReais(texto: string): number | null {
  // \s também pega o espaço que não quebra do "R$ 1.234" que o Intl escreve
  const limpo = texto.replace(/[R$\s]/gi, '').trim();
  if (!limpo || !/^[\d.,]+$/.test(limpo)) return null;
  const ultimaVirgula = limpo.lastIndexOf(',');
  const ultimoPonto = limpo.lastIndexOf('.');
  let inteiro: string;
  let decimal = '';
  if (ultimaVirgula >= 0 && ultimoPonto >= 0) {
    const separador = Math.max(ultimaVirgula, ultimoPonto);
    inteiro = limpo.slice(0, separador);
    decimal = limpo.slice(separador + 1);
  } else if (ultimaVirgula >= 0) {
    // Só vírgula: é o decimal, então só pode haver uma
    if (limpo.indexOf(',') !== ultimaVirgula) return null;
    inteiro = limpo.slice(0, ultimaVirgula);
    decimal = limpo.slice(ultimaVirgula + 1);
  } else if (ultimoPonto >= 0) {
    const depois = limpo.slice(ultimoPonto + 1);
    if (depois.length === 3) inteiro = limpo;
    else {
      inteiro = limpo.slice(0, ultimoPonto);
      decimal = depois;
    }
  } else {
    inteiro = limpo;
  }
  inteiro = inteiro.replace(/[.,]/g, '');
  if (decimal.length > 2 || /[.,]/.test(decimal)) return null;
  if (!inteiro && !decimal) return null;
  const reais = Number(inteiro || '0');
  const centavos = Number((decimal + '00').slice(0, 2));
  if (!Number.isFinite(reais) || !Number.isFinite(centavos)) return null;
  return reais * 100 + centavos;
}

/** Centavos → texto para o campo ("1.234" ou "1.234,56"); null → "". */
export function valorParaCampo(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '';
  const temCentavos = Math.round(cents) % 100 !== 0;
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: temCentavos ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(Math.round(cents) / 100);
}

/** Número inteiro digitado ("20", "20 clientes", "1.200") → inteiro; vazio ou sem dígito → null. */
export function lerInteiro(texto: string): number | null {
  const digitos = texto.replace(/\D/g, '');
  return digitos ? Number(digitos) : null;
}

/* ---------- Formulários ---------- */

export interface CamposDaEstrategia {
  texto: string;
  verba: string;
  metaCustoPorClienteNovo: string;
  metaCustoPorLead: string;
  metaClientesNovos: string;
}

export type ErrosDe<T> = Partial<Record<keyof T, string>>;

const DADO_PESSOAL: readonly RegExp[] = [
  /[\w.+-]+@[\w-]+\.[\w.]+/, // e-mail (o @ de um perfil do Instagram passa)
  /\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/, // telefone com DDD
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/, // CPF
  /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/, // CNPJ
];

/** O texto vai para o Claude: nunca com e-mail, telefone, CPF ou CNPJ (decisão 0006). */
export function temDadoPessoal(texto: string): boolean {
  return DADO_PESSOAL.some((padrao) => padrao.test(texto));
}

function dinheiroOpcional(valor: string, rotulo: string): string | undefined {
  if (!valor.trim()) return undefined;
  const cents = lerReais(valor);
  if (cents === null) return `Escreva ${rotulo} em reais, como 1.500 ou 1.500,50.`;
  if (cents <= 0) return `${rotulo[0]?.toUpperCase()}${rotulo.slice(1)} precisa ser maior que zero.`;
  return undefined;
}

export function validarEstrategia(campos: CamposDaEstrategia): ErrosDe<CamposDaEstrategia> {
  const erros: ErrosDe<CamposDaEstrategia> = {};
  if (temDadoPessoal(campos.texto))
    erros.texto = 'Tire e-mail, telefone ou documento: este texto vai para o Claude.';
  const verba = dinheiroOpcional(campos.verba, 'a verba');
  if (verba) erros.verba = verba;
  const cpc = dinheiroOpcional(campos.metaCustoPorClienteNovo, 'a meta');
  if (cpc) erros.metaCustoPorClienteNovo = cpc;
  const cpl = dinheiroOpcional(campos.metaCustoPorLead, 'a meta');
  if (cpl) erros.metaCustoPorLead = cpl;
  if (campos.metaClientesNovos.trim()) {
    const n = lerInteiro(campos.metaClientesNovos);
    if (n === null || n <= 0) erros.metaClientesNovos = 'Escreva quantos clientes novos, como 20.';
  }
  return erros;
}

export interface CamposDaIdeia {
  titulo: string;
  motivo: string;
  marca: Brand | '';
  canal: Platform | '';
  tipo: ActionKind | '';
  campanha: string;
  impacto: Level;
  esforco: Level;
  custo: string;
}

export function validarIdeia(campos: CamposDaIdeia): ErrosDe<CamposDaIdeia> {
  const erros: ErrosDe<CamposDaIdeia> = {};
  if (campos.titulo.trim().length < 5) erros.titulo = 'Escreva o que fazer, com pelo menos 5 letras.';
  if (campos.motivo.trim().length < 10)
    erros.motivo = 'Escreva por que vale a pena, com pelo menos 10 letras.';
  else if (temDadoPessoal(campos.motivo) || temDadoPessoal(campos.titulo))
    erros.motivo = 'Tire e-mail, telefone ou documento: este texto vai para o Claude.';
  if (!campos.marca) erros.marca = 'Escolha a marca.';
  if (!campos.tipo) erros.tipo = 'Escolha o tipo de ação.';
  // Custo zero vale ("sem custo extra"); vazio é "sem estimativa"
  if (campos.custo.trim() && lerReais(campos.custo) === null)
    erros.custo = 'Escreva o custo em reais, como 1.500 ou 1.500,50.';
  return erros;
}

/** Motivo do descarte e resultado de "Marcar como feita": texto livre com um mínimo. */
export function validarTexto(texto: string, minimo: number): string | undefined {
  return texto.trim().length >= minimo ? undefined : `Escreva pelo menos ${minimo} letras.`;
}

/* ---------- Humano × Claude ---------- */

/** Métricas que não ficam melhores nem piores por subir: volume e verba. */
const NEUTRAS = new Set([
  'investimento',
  'parcelaDaVerba',
  'campanhasAtivas',
  'acoesPropostas',
  'acoesExecutadas',
]);

/** O Claude foi melhor (true), pior (false) ou a métrica não se julga (null)? */
export function claudeMelhor(linha: {
  chave: string;
  diferenca: number | null;
  menorEhMelhor: boolean;
}): boolean | null {
  if (linha.diferenca === null || linha.diferenca === 0 || NEUTRAS.has(linha.chave)) return null;
  return linha.menorEhMelhor ? linha.diferenca < 0 : linha.diferenca > 0;
}

/* ---------- Limite da conta ---------- */

/**
 * Novo limite da conta (marca × canal) repartido entre as campanhas ativas dela, na proporção dos
 * limites de hoje (ou em partes iguais, se todos forem zero). A soma bate com o novo limite ao centavo.
 * Sem campanha ativa na conta, nada muda.
 */
export function escalarLimites(
  campanhas: readonly Campaign[],
  marca: Brand,
  canal: Platform,
  novoCents: number,
): Campaign[] {
  const ativas = campanhas.filter(
    (c) => c.brandId === marca && c.platform === canal && c.status === 'active',
  );
  if (ativas.length === 0 || !Number.isFinite(novoCents) || novoCents < 0) return [...campanhas];
  const atual = ativas.reduce((total, c) => total + c.spendCapCents, 0);
  const novos = new Map<string, number>();
  let restante = Math.round(novoCents);
  ativas.forEach((c, i) => {
    const ultimo = i === ativas.length - 1;
    const parte = ultimo
      ? restante
      : Math.round(atual > 0 ? (novoCents * c.spendCapCents) / atual : novoCents / ativas.length);
    const valor = Math.max(0, Math.min(parte, restante));
    novos.set(c.id, valor);
    restante -= valor;
  });
  return campanhas.map((c) => {
    const valor = novos.get(c.id);
    return valor === undefined ? c : { ...c, spendCapCents: valor };
  });
}

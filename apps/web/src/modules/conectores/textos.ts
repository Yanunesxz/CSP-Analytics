/**
 * Textos da tela Conectores: formatação de um número já calculado pela consulta e o conteúdo fixo de
 * cada cartão (o que a integração traz, o que falta para ligar). Nenhuma conta aqui: a conta vive em
 * data/queries/conectores.ts.
 */

import type { ConnectorId, ConnectorStatus, Tom } from '@csp-mkt/shared';
import { rotulo, tom as tomDaLista } from '@csp-mkt/shared';
import type { CartaoDeConector, PainelDeConectores, RodadaAppsCrm } from '../../data/queries/conectores';
import { diaSp, somarDias } from '../../lib/datas';
import { dataHora, hora, numero, VAZIO } from '../../lib/format';

export const SEM_DADOS = 'Sem dados';

/** O que cada integração traz, numa frase. Conteúdo fixo do desenho, não é dado. */
export const O_QUE_TRAZ: Record<ConnectorId, string> = {
  csp360: 'Leads, clientes e pedidos das duas marcas, sem nome nem contato.',
  meta: 'Investimento, impressões, cliques e leads das campanhas da Meta.',
  tiktok: 'Investimento, impressões, cliques e leads das campanhas do TikTok.',
  google_ads: 'Investimento, impressões, cliques e conversões das campanhas do Google.',
  instagram: 'Seguidores, alcance e posts dos dois perfis.',
  search_console: 'Impressões, cliques e posição dos sites na busca do Google.',
  ga4: 'Visitas aos sites e as que chegam de assistentes de IA.',
};

/**
 * O que falta para ligar um conector simulado, um passo por item. Trecho entre crases é nome de
 * configuração e aparece em `<code>`. Só o GA4 tem a lista definida hoje (Parte 4 do prompt).
 */
export const O_QUE_FALTA: Partial<Record<ConnectorId, readonly string[]>> = {
  ga4: [
    'Preencher `NEXT_PUBLIC_GA_ID` na Vercel dos dois sites. Hoje está vazio e os sites não medem visitas.',
    'Criar o grupo de canais “AI Assistant” em cada propriedade do GA4.',
    'Dar ao CSP-MKT acesso de leitura às duas propriedades do GA4.',
  ],
};

export const TELA_VAZIA = {
  titulo: 'Nenhum conector ainda',
  texto: 'Os cartões aparecem quando a primeira integração sincronizar.',
};

export const TELA_COM_ERRO = {
  titulo: 'Não deu para carregar os conectores',
  texto: 'Tente de novo em alguns segundos.',
};

/** Na visão Gestor de tráfego: o que a visão muda aqui (nada) e onde ficam os números do operador. */
export const AVISO_DO_GESTOR = {
  titulo: 'Conectores não têm operador nem verba',
  texto: 'Humano × Claude e o limite de gasto ficam nos canais e em Tráfego com IA.',
  link: 'Ver Tráfego com IA',
};

/** Com uma marca escolhida no menu: os conectores não têm marca (decisão 0003). */
export const NOTA_DA_MARCA =
  'Cada conector traz as duas marcas: a marca escolhida no menu não muda esta tela.';

/** O fluxo fixo de dados (decisão 0004), no cartão do CSP 360. */
export const CAMINHO_DOS_PEDIDOS = 'ERP Control → apps de Representantes → CSP 360 → CSP-MKT';

export const SEM_CONEXAO_DIRETA =
  'Não existe conexão direta com os apps de Representantes nem com o ERP Control: pedidos e clientes chegam só pelo CSP 360.';

const O_QUE_FALTA_PADRAO: readonly string[] = [
  'Ligar a integração com a plataforma e dar ao CSP-MKT acesso de leitura.',
];

export function oQueFalta(id: ConnectorId): readonly string[] {
  return O_QUE_FALTA[id] ?? O_QUE_FALTA_PADRAO;
}

/** Quebra um texto em trechos comuns e trechos de código (entre crases). */
export function trechos(texto: string): Array<{ texto: string; codigo: boolean }> {
  return texto
    .split('`')
    .map((parte, i) => ({ texto: parte, codigo: i % 2 === 1 }))
    .filter((t) => t.texto !== '');
}

function semNumero(valor: number | null | undefined): valor is null | undefined {
  return valor === null || valor === undefined || !Number.isFinite(valor);
}

/** `45 min`, `2 h`, `2 h 10 min`, `1 dia`, `2 dias e 4 h`. */
export function duracao(minutos: number | null | undefined): string {
  if (semNumero(minutos)) return VAZIO;
  const total = Math.max(0, Math.round(minutos));
  if (total < 60) return `${total} min`;
  if (total < 1440) {
    const horas = Math.floor(total / 60);
    const resto = total % 60;
    return resto ? `${horas} h ${resto} min` : `${horas} h`;
  }
  const dias = Math.floor(total / 1440);
  const horas = Math.floor((total % 1440) / 60);
  const texto = `${dias} ${dias === 1 ? 'dia' : 'dias'}`;
  return horas ? `${texto} e ${horas} h` : texto;
}

/** De quanto em quanto tempo sincroniza: `a cada 5 min`, `de hora em hora`, `uma vez por dia`. */
export function frequencia(minutos: number | null | undefined): string | null {
  if (semNumero(minutos) || minutos <= 0) return null;
  if (minutos === 60) return 'de hora em hora';
  if (minutos === 1440) return 'uma vez por dia';
  return `a cada ${duracao(minutos)}`;
}

/** A frase do cartão: o que traz e de quanto em quanto tempo sincroniza (quando se sabe). */
export function descricao(cartao: Pick<CartaoDeConector, 'id' | 'esperadoACadaMinutos'>): string {
  const vezes = frequencia(cartao.esperadoACadaMinutos);
  return [O_QUE_TRAZ[cartao.id], vezes ? `Sincroniza ${vezes}.` : null].filter(Boolean).join(' ');
}

/** `hoje, 14:18`, `ontem, 22:10` ou `28/10/2026 09:00`, no fuso de São Paulo. */
export function quando(iso: string | null | undefined, agora: Date): string {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return VAZIO;
  const dia = diaSp(iso);
  const hoje = diaSp(agora);
  if (dia === hoje) return `hoje, ${hora(iso)}`;
  if (dia === somarDias(hoje, -1)) return `ontem, ${hora(iso)}`;
  return dataHora(iso);
}

type CampoDoCartao = Pick<CartaoDeConector, 'estado' | 'ultimaSincronizacao' | 'atrasoMinutos'>;

export function textoUltimaSincronizacao(cartao: CampoDoCartao, agora: Date): string {
  if (cartao.estado === null) return SEM_DADOS;
  if (!cartao.ultimaSincronizacao) return 'Nunca sincronizou';
  return quando(cartao.ultimaSincronizacao, agora);
}

/** `Em dia`, `2 h 10 min` (além do esperado), `—` (nunca sincronizou) ou `Sem dados`. */
export function textoAtraso(cartao: CampoDoCartao): string {
  if (cartao.estado === null) return SEM_DADOS;
  if (!cartao.ultimaSincronizacao || semNumero(cartao.atrasoMinutos)) return VAZIO;
  return cartao.atrasoMinutos > 0 ? duracao(cartao.atrasoMinutos) : 'Em dia';
}

/** Cor do texto do atraso: só quando pede atenção (atrasado em amarelo, caído em vermelho). */
export function tomDoAtraso(cartao: CampoDoCartao): 'warning' | 'danger' | undefined {
  if (semNumero(cartao.atrasoMinutos) || cartao.atrasoMinutos <= 0) return undefined;
  if (cartao.estado === 'down') return 'danger';
  if (cartao.estado === 'late') return 'warning';
  return undefined;
}

/** Contagem do cartão (erros, linhas): `Sem dados` quando o conector não veio, nunca 0 inventado. */
export function textoContagem(estado: ConnectorStatus | null, valor: number | null): string {
  if (estado === null || semNumero(valor)) return SEM_DADOS;
  return numero(valor);
}

/** A linha de baixo da rodada apps → CSP 360: por que não tem número, o que o atraso afeta ou o ritmo. */
export function notaDaRodada(
  rodada: Pick<RodadaAppsCrm, 'ultimaEm' | 'atrasada' | 'esperadoACadaMinutos'>,
): string {
  if (!rodada.ultimaEm) return 'Aparece quando o CSP 360 mandar o diário da sincronização com os apps.';
  if (rodada.atrasada) return 'Pedidos novos podem demorar a aparecer aqui.';
  const vezes = frequencia(rodada.esperadoACadaMinutos);
  return vezes ? `O CSP 360 busca os pedidos nos apps ${vezes}.` : 'O CSP 360 busca os pedidos nos apps.';
}

/** Rótulo da etiqueta: o de `labels.ts`; o simulado ganha "· a ligar"; sem conector, "Sem dados". */
export function rotuloDoEstado(estado: ConnectorStatus | null): string {
  if (estado === null) return SEM_DADOS;
  const texto = rotulo('connectorStatus', estado);
  return estado === 'simulated' ? `${texto} · a ligar` : texto;
}

/** Tom da etiqueta: funcionando verde, atrasado amarelo, caído vermelho; simulado e sem dados neutros. */
export function tomDoEstado(estado: ConnectorStatus | null): Tom {
  if (estado === null || estado === 'simulated') return 'muted';
  return tomDaLista('connectorStatus', estado) ?? 'muted';
}

/** `A`, `A e B`, `A, B e C`. */
export function juntar(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? '';
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

export interface AvisoGeral {
  tom: 'success' | 'info' | 'warning' | 'danger';
  titulo: string;
  texto: string;
}

/**
 * O aviso do topo: o pior estado, o que ele afeta e o que fazer. Caído vence atrasado; em dia confirma
 * (e, depois de um "Tentar de novo" que resolveu tudo, diz desde quando). Null sem conectores.
 */
export function avisoGeral(
  painel: Pick<PainelDeConectores, 'cartoes' | 'situacao' | 'aLigar' | 'resumo'>,
  opcoes: { podeTentar: boolean; recuperadoEm: string | null },
): AvisoGeral | null {
  const nomes = (estado: ConnectorStatus) =>
    painel.cartoes.filter((c) => c.estado === estado).map((c) => c.nome);
  const caidos = nomes('down');
  const atrasados = nomes('late');
  const proximoPasso = (quantos: number) => {
    if (!opcoes.podeTentar) return 'Avise o dono para tentar de novo.';
    return quantos === 1 ? 'Tente de novo no cartão.' : 'Tente de novo em cada cartão.';
  };

  if (painel.situacao === 'caido') {
    const titulo =
      caidos.length === 1
        ? `${juntar(caidos)} parou de sincronizar`
        : `${caidos.length} conectores pararam de sincronizar`;
    const tambem = atrasados.length
      ? ` ${juntar(atrasados)} ${atrasados.length === 1 ? 'está atrasado' : 'estão atrasados'}.`
      : '';
    return {
      tom: 'danger',
      titulo,
      texto: `Os números de ${juntar(caidos)} ficam parados na última sincronização.${tambem} ${proximoPasso(caidos.length + atrasados.length)}`,
    };
  }

  if (painel.situacao === 'atrasado') {
    const titulo =
      atrasados.length === 1
        ? `${juntar(atrasados)} está atrasado`
        : `${atrasados.length} conectores estão atrasados`;
    return {
      tom: 'warning',
      titulo,
      texto: `Os números de ${juntar(atrasados)} podem estar desatualizados. ${proximoPasso(atrasados.length)}`,
    };
  }

  if (painel.situacao === 'em-dia') {
    const aLigar = painel.aLigar.map((c) => c.nome);
    const falta = aLigar.length
      ? `${juntar(aLigar)} ${aLigar.length === 1 ? 'ainda está a ligar' : 'ainda estão a ligar'}.`
      : '';
    if (!painel.resumo.ok) {
      return { tom: 'info', titulo: 'Nenhum conector ligado ainda', texto: falta };
    }
    return {
      tom: 'success',
      titulo: opcoes.recuperadoEm
        ? `Tudo funcionando de novo desde ${hora(opcoes.recuperadoEm)}`
        : 'Tudo funcionando',
      texto: ['Os conectores ligados estão em dia.', falta].filter(Boolean).join(' '),
    };
  }

  return null;
}

/** Aviso rápido depois de "Tentar de novo" dar certo. */
export function sincronizado(nome: string): string {
  return `${nome} sincronizado.`;
}

/**
 * Textos da Visão geral que dependem dos números: notas embaixo dos indicadores, legendas da verba
 * por conta e o detalhe do gráfico de custo. Puros, com teste; a tela só desenha.
 */

import type { Metrica } from '../../data/queries';
import type { AlertaDeLimite, ContaDeAnuncio, VisaoGeral } from '../../data/queries/visao-geral';
import { VAZIO, dinheiro, plural, variacao } from '../../lib/format';
import type { Intervalo } from '../../lib/periodo';
import type { Filtros } from '../../lib/url-state';

type FiltrosDaNota = Pick<Filtros, 'marca' | 'canal' | 'operador' | 'campanha'>;

/** "vs. mês anterior" → "Mês anterior"; "vs. 7 dias anteriores" → "7 dias anteriores". */
export function periodoAnterior(intervalo: Pick<Intervalo, 'rotuloAnterior'>): string {
  const texto = intervalo.rotuloAnterior.replace(/^vs\.\s*/, '');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Canal, operador ou campanha filtrados: pedidos, faturado e alcance não seguem esses filtros. */
export function temFiltroDeMidia(filtros: Omit<FiltrosDaNota, 'marca'>): boolean {
  return filtros.canal !== null || filtros.operador !== 'todos' || filtros.campanha !== null;
}

function notaDoCusto(deCampanha: number | null): string {
  if (deCampanha === null)
    return 'Custo por cliente novo divide o investimento pelos clientes novos que vieram de campanha (pela UTM).';
  if (deCampanha === 0)
    return 'Nenhum cliente novo veio de campanha (pela UTM) no período: o custo por cliente novo fica sem dados.';
  if (deCampanha === 1)
    return 'Custo por cliente novo divide o investimento pelo 1 cliente novo que veio de campanha (pela UTM).';
  return `Custo por cliente novo divide o investimento pelos ${plural(deCampanha, 'cliente novo', 'clientes novos')} que vieram de campanha (pela UTM).`;
}

/** Notas embaixo dos indicadores: como o custo é calculado e o que os filtros não alcançam. */
export function notasDosNumeros(
  v: Pick<VisaoGeral, 'clientesNovosDeCampanha' | 'leadsSemMarca'>,
  filtros: FiltrosDaNota,
): string[] {
  const midia = temFiltroDeMidia(filtros);
  const notas = [notaDoCusto(v.clientesNovosDeCampanha)];
  if (!midia) notas.push('Clientes novos conta todas as origens.');
  if (v.leadsSemMarca) {
    const quantos = plural(v.leadsSemMarca, 'lead sem marca', 'leads sem marca');
    notas.push(
      filtros.marca === 'todas'
        ? `${quantos} (SDR · WhatsApp) ${v.leadsSemMarca === 1 ? 'entra' : 'entram'} no total.`
        : `${quantos} (SDR · WhatsApp) ${v.leadsSemMarca === 1 ? 'aparece' : 'aparecem'} aqui e na outra marca.`,
    );
  }
  if (midia)
    notas.push(
      `Pedidos, valor faturado e alcance no Instagram não separam canal, operador nem campanha: valem para ${
        filtros.marca === 'todas' ? 'as duas marcas' : 'a marca toda'
      }.`,
    );
  return notas;
}

/** Nota do indicador "Valor faturado", que fica sem dados até o Control abrir o faturamento. */
export function notaDoFaturado(faturados: number | null): string {
  if (faturados === null) return 'O valor chega quando o Control abrir o faturamento.';
  return `${plural(faturados, 'pedido faturado', 'pedidos faturados')}. O valor chega com o Control.`;
}

/** Variação sem cor (para investimento, que subir não é bom nem ruim). */
export function variacaoNeutra(m: Metrica, deltaTexto: string): string | undefined {
  if (m.atual === null || m.variacao === null) return undefined;
  return `${variacao(m.variacao)} ${deltaTexto}`;
}

/** Detalhe de cada barra do custo por canal, na tabela do gráfico. */
export function detalheDoCusto(
  m: Metrica,
  intervalo: Pick<Intervalo, 'rotuloAnterior'>,
  comparar: boolean,
): string | undefined {
  if (!comparar) return undefined;
  const antes = periodoAnterior(intervalo);
  if (m.anterior === null) return `${antes}: sem dados`;
  if (m.variacao === null) return `${antes}: ${dinheiro(m.anterior)}`;
  return `${antes}: ${dinheiro(m.anterior)} (${variacao(m.variacao)})`;
}

/* ---------- Verba e limite por conta ---------- */

/** Selo da conta perto ou acima do limite de gasto: o texto diz o estado, a cor só reforça. */
export function seloDoLimite(
  alerta: AlertaDeLimite | null,
): { tom: 'warning' | 'danger'; texto: string } | null {
  if (alerta === 'acima') return { tom: 'danger', texto: 'Acima do limite' };
  if (alerta === 'perto') return { tom: 'warning', texto: 'Perto do limite' };
  return null;
}

/** Legenda da régua: a régua já diz "Sem dados" no topo, então aqui o vazio é o traço. */
export function gastoDaConta(c: ContaDeAnuncio): string {
  return dinheiro(c.investimento);
}

export function limiteDaConta(c: ContaDeAnuncio): string {
  if (c.limite === null) return VAZIO;
  if (c.limite === 0) return 'Sem campanha ativa';
  return `de ${dinheiro(c.limite)}`;
}

export function verbaDaConta(c: ContaDeAnuncio): string | null {
  if (c.verbaDiaria === null) return null;
  return `Verba diária ${dinheiro(c.verbaDiaria)} · ${plural(c.campanhasAtivas, 'campanha ativa', 'campanhas ativas')}`;
}

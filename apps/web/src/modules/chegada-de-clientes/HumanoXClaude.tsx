/**
 * Visão "Gestor de tráfego": a mesma linha para o humano e para o Claude, lado a lado, com a
 * diferença em % (decisão 0008), só nas contas de cliente novo desta tela.
 */

import { Bot } from 'lucide-react';
import { Tabela, Vazio, formatarValor, type Coluna } from '../../components/ui';
import type { LinhaOperador } from '../../data/queries';
import { Bloco, Delta } from './partes';

/** Investimento e parcela da verba não são bons nem ruins por si: a diferença fica sem cor. */
const NEUTRAS = new Set(['investimento', 'parcelaDaVerba']);

const colunas: Coluna<LinhaOperador>[] = [
  { chave: 'metrica', titulo: 'Métrica', ordenavel: false, render: (l) => l.rotulo },
  {
    chave: 'humano',
    titulo: 'Humano',
    numerica: true,
    ordenavel: false,
    render: (l) => formatarValor(l.humano, l.formato),
  },
  {
    chave: 'claude',
    titulo: 'Claude',
    numerica: true,
    ordenavel: false,
    render: (l) => formatarValor(l.claude, l.formato),
  },
  {
    chave: 'diferenca',
    titulo: 'Diferença',
    numerica: true,
    ordenavel: false,
    render: (l) =>
      l.diferenca === null ? (
        '—'
      ) : (
        <Delta valor={l.diferenca} menorEhMelhor={l.menorEhMelhor} neutro={NEUTRAS.has(l.chave)} />
      ),
  },
];

export function HumanoXClaude({ linhas, semDados }: { linhas: LinhaOperador[]; semDados: boolean }) {
  return (
    <Bloco
      titulo="Humano × Claude"
      descricao="Campanhas de cada operador no período. Diferença = quanto o Claude está acima ou abaixo do humano."
    >
      {semDados ? (
        <Vazio icone={Bot} titulo="Sem dados" texto="Nenhuma campanha com números no período." />
      ) : (
        <Tabela
          empilhar
          legenda="Clientes novos e custo por cliente novo, humano e Claude"
          colunas={colunas}
          linhas={linhas}
          chaveDaLinha={(l) => l.chave}
        />
      )}
    </Bloco>
  );
}

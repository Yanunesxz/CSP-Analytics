/**
 * Números do humano e do Claude lado a lado (decisão 0008): a mesma linha de métricas para os dois, com a
 * diferença do Claude em relação ao humano, e o custo por lead de cada um em cada canal. Ignora o filtro de
 * operador, porque a comparação é ele. "Melhor" e "pior" vêm em texto; a cor só reforça.
 */

import { cor, rotulo } from '@csp-mkt/shared';
import { GraficoBarras, Tabela, formatarValor, type Coluna, type ItemBarra } from '../../components/ui';
import type { LinhaOperador, PorOperador } from '../../data/queries';
import { dinheiro, variacao } from '../../lib/format';
import { claudeMelhor } from './regras';

function Diferenca({ linha }: { linha: LinhaOperador }) {
  if (linha.diferenca === null) return <>—</>;
  const melhor = claudeMelhor(linha);
  if (melhor === null) return <span className="yn-kpi__delta">{variacao(linha.diferenca)}</span>;
  return (
    <span className={`yn-kpi__delta ${melhor ? 'yn-kpi__delta--up' : 'yn-kpi__delta--down'}`}>
      {variacao(linha.diferenca)} · {melhor ? 'melhor' : 'pior'}
    </span>
  );
}

const COLUNAS: Coluna<LinhaOperador>[] = [
  { chave: 'metrica', titulo: 'Métrica', render: (l) => l.rotulo },
  {
    chave: 'humano',
    titulo: 'Humano',
    numerica: true,
    render: (l) => formatarValor(l.humano, l.formato),
  },
  {
    chave: 'claude',
    titulo: 'Claude',
    numerica: true,
    render: (l) => formatarValor(l.claude, l.formato),
  },
  {
    chave: 'diferenca',
    titulo: 'Claude vs. humano',
    numerica: true,
    render: (l) => <Diferenca linha={l} />,
  },
];

export function HumanoXClaude({ operador, semDados }: { operador: PorOperador; semDados: boolean }) {
  const itens: ItemBarra[] = operador.porCanal.flatMap((c) => [
    {
      rotulo: `${rotulo('platform', c.canal)} · Humano`,
      valor: c.humano.cpl,
      cor: cor('operator', 'human'),
      detalhe: `${formatarValor(c.humano.leads)} leads · ${formatarValor(c.humano.clientesNovos)} clientes novos`,
    },
    {
      rotulo: `${rotulo('platform', c.canal)} · Claude`,
      valor: c.claude.cpl,
      cor: cor('operator', 'claude'),
      detalhe:
        c.diferencaCpl === null
          ? `${formatarValor(c.claude.leads)} leads · ${formatarValor(c.claude.clientesNovos)} clientes novos`
          : `${formatarValor(c.claude.leads)} leads · ${formatarValor(c.claude.clientesNovos)} clientes novos · ${variacao(c.diferencaCpl)} vs. humano`,
    },
  ]);

  return (
    <section className="mkt-stack" aria-labelledby="trafego-operador">
      <div className="grid gap-1">
        <h2 id="trafego-operador">Humano × Claude</h2>
        <p className="yn-muted m-0 text-sm">
          Cada campanha tem um dono. A mesma linha de números para os dois no período, e quanto o Claude ficou
          acima ou abaixo do humano. Em custo, cair é melhor.
        </p>
      </div>
      <div className="yn-container">
        <Tabela
          colunas={COLUNAS}
          linhas={operador.linhas}
          chaveDaLinha={(l) => l.chave}
          empilhar
          legenda="Humano × Claude no período"
        />
      </div>
      <GraficoBarras
        titulo="Custo por lead por canal"
        descricao="Investimento ÷ leads das campanhas de cada operador, no período. Barra menor é melhor."
        itens={itens}
        formato={(v) => dinheiro(v)}
        rotuloValor="Custo por lead"
        estado={semDados ? 'semDados' : 'ok'}
      />
    </section>
  );
}

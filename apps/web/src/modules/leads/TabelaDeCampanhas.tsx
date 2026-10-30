/**
 * Leads por campanha (`utm_campaign`): a campanha (com canal, marca e UTM embaixo), quantos leads (com a
 * variação vs. o período anterior embaixo), quantos viraram cliente (com a taxa embaixo) e o custo por lead.
 * Na visão Gestor de tráfego, também o operador (Humano × Claude) e o investimento. Texto longo quebra linha
 * para a tabela caber em 1280px; abaixo de 640px de área vira cards (.yn-table--stack).
 */

import { ChartNoAxesColumn, Megaphone } from 'lucide-react';
import { useId, useMemo } from 'react';
import { cor, rotulo } from '@csp-mkt/shared';
import { ChipSerie, PontoDeSerie, Tabela, Vazio, type Coluna } from '../../components/ui';
import type { LeadsPorCampanha } from '../../data/queries/leads';
import { dinheiro, numero, percentual, variacao } from '../../lib/format';

export interface TabelaDeCampanhasProps {
  linhas: LeadsPorCampanha[];
  gestor: boolean;
  comparar: boolean;
  semDados: boolean;
}

/** Número com uma linha pequena embaixo (variação ou taxa). */
function ComDetalhe({ valor, detalhe, dica }: { valor: string; detalhe?: string; dica?: string }) {
  return (
    <span className="inline-grid justify-items-end">
      <span>{valor}</span>
      {detalhe ? (
        <span className="yn-muted text-xs" title={dica}>
          {detalhe}
        </span>
      ) : null}
    </span>
  );
}

export function TabelaDeCampanhas({ linhas, gestor, comparar, semDados }: TabelaDeCampanhasProps) {
  const idTitulo = useId();

  const colunas = useMemo(() => {
    const todas: Array<Coluna<LeadsPorCampanha> | false> = [
      {
        // Canal e marca vão na segunda linha da campanha: a tabela cabe em 1280px nas duas visões.
        chave: 'campanha',
        titulo: 'Campanha',
        valor: (l) => l.nome,
        render: (l) => (
          <span className="inline-grid gap-1 whitespace-normal">
            <span>{l.nome}</span>
            <span className="yn-muted inline-flex flex-wrap items-center gap-x-2 text-xs">
              {l.canal ? <PontoDeSerie cor={cor('platform', l.canal)} /> : null}
              {[l.canal ? rotulo('platform', l.canal) : null, l.marca ? rotulo('brand', l.marca) : null]
                .filter(Boolean)
                .join(' · ') || '—'}
            </span>
            <span className="yn-muted text-xs">
              {l.campanhaId ? l.utmCampaign : 'Sem campanha cadastrada'}
            </span>
          </span>
        ),
      },
      gestor && {
        chave: 'operador',
        titulo: 'Operador',
        valor: (l) => (l.operador ? rotulo('operator', l.operador) : null),
        render: (l) => (l.operador ? <ChipSerie lista="operator" codigo={l.operador} /> : '—'),
      },
      {
        chave: 'leads',
        titulo: 'Leads',
        numerica: true,
        valor: (l) => l.leads.atual,
        render: (l) => (
          <ComDetalhe
            valor={numero(l.leads.atual)}
            detalhe={comparar ? variacao(l.leads.variacao) : undefined}
            dica="Variação vs. o período anterior"
          />
        ),
      },
      {
        chave: 'viraram',
        titulo: 'Viraram cliente',
        numerica: true,
        valor: (l) => l.viraramCliente,
        render: (l) => (
          <ComDetalhe
            valor={numero(l.viraramCliente)}
            detalhe={l.taxaConversao === null ? undefined : `${percentual(l.taxaConversao)} dos leads`}
          />
        ),
      },
      gestor && {
        chave: 'investimento',
        titulo: 'Investimento',
        numerica: true,
        valor: (l) => l.investimento.atual,
        render: (l) => dinheiro(l.investimento.atual),
      },
      {
        chave: 'custo',
        titulo: 'Custo por lead',
        numerica: true,
        valor: (l) => l.custoPorLead.atual,
        render: (l) => dinheiro(l.custoPorLead.atual),
      },
    ];
    return todas.filter((c): c is Coluna<LeadsPorCampanha> => c !== false);
  }, [gestor, comparar]);

  const vazio = semDados ? (
    <div className="yn-card">
      <Vazio
        icone={ChartNoAxesColumn}
        titulo="Sem dados"
        texto="Nenhum lead de campanha para contar no período."
      />
    </div>
  ) : (
    <div className="yn-card">
      <Vazio
        icone={Megaphone}
        titulo="Nenhum lead de campanha no período"
        texto="Leads com utm_campaign aparecem aqui. Mude o período ou os filtros."
      />
    </div>
  );

  return (
    <section className="mkt-stack min-w-0" aria-labelledby={idTitulo}>
      <div className="mkt-chart__head">
        <div>
          <h2 id={idTitulo}>Leads por campanha</h2>
          <p className="yn-muted text-sm">
            Pela utm_campaign de cada lead{comparar ? ', com a variação vs. o período anterior' : ''}. UTM que
            não casa com campanha cadastrada aparece com o próprio nome.
          </p>
        </div>
      </div>
      <Tabela
        colunas={colunas}
        linhas={linhas}
        chaveDaLinha={(l) => l.utmCampaign}
        empilhar
        ordenacaoInicial={{ chave: 'leads', direcao: 'desc' }}
        legenda="Leads por campanha"
        vazio={vazio}
      />
    </section>
  );
}

/**
 * Seção "Leads e clientes novos" (CSP 360): os leads que chegaram pela busca orgânica ou por um
 * assistente de IA, pelo endereço de onde a pessoa veio, e quantos viraram cliente novo (1º pedido
 * enviado no período, decisão 0012). Só contagens: nome e telefone ficam na ficha 360, no CSP 360.
 * Cada indicador leva à tela que trabalha o número, já filtrada pela origem.
 */

import { ListX } from 'lucide-react';
import { useId, useMemo } from 'react';
import { rotulo } from '@csp-mkt/shared';
import { ChipSerie, Kpi, Tabela, Vazio, type Coluna } from '../../components/ui';
import type { LinhaFonteDeLead, PainelSeoGeo } from '../../data/queries/seo-geo';
import { numero } from '../../lib/format';
import { AvisoDoConector } from './Avisos';
import { Secao } from './Secao';

export interface LeadsDaBuscaEDeIaProps {
  painel: PainelSeoGeo;
  semDados: boolean;
  deltaTexto?: string;
}

const COLUNAS: Coluna<LinhaFonteDeLead>[] = [
  { chave: 'fonte', titulo: 'Fonte', valor: (l) => l.fonte },
  {
    chave: 'origem',
    titulo: 'Origem',
    valor: (l) => rotulo('leadSource', l.origem),
    render: (l) => <ChipSerie lista="leadSource" codigo={l.origem} />,
  },
  {
    chave: 'leads',
    titulo: 'Leads',
    numerica: true,
    valor: (l) => l.leads.atual,
    render: (l) => numero(l.leads.atual),
  },
  {
    chave: 'clientes',
    titulo: 'Clientes novos',
    numerica: true,
    valor: (l) => l.clientesNovos.atual,
    render: (l) => numero(l.clientesNovos.atual),
  },
];

export function LeadsDaBuscaEDeIa({ painel, semDados, deltaTexto }: LeadsDaBuscaEDeIaProps) {
  const { leads, fontes } = painel;

  return (
    <Secao
      titulo="Leads e clientes novos"
      descricao="Leads do CSP 360 que chegaram pela busca orgânica ou por um assistente de IA, pelo endereço de onde a pessoa veio."
      fonte={{ nome: 'CSP 360', cartao: fontes.csp360 }}
    >
      <AvisoDoConector nome="CSP 360" cartao={fontes.csp360} />
      <div className="mkt-grid-kpis" role="group" aria-label="Leads e clientes novos da busca e de IA">
        <Kpi
          rotulo="Leads da busca orgânica"
          metrica={leads.buscaOrganica}
          deltaTexto={deltaTexto}
          para="/leads"
          paraFiltros={{ origem: 'organic' }}
        />
        <Kpi
          rotulo="Clientes novos da busca"
          metrica={leads.clientesNovosDaBusca}
          deltaTexto={deltaTexto}
          para="/chegada"
          paraFiltros={{ origem: 'organic' }}
        />
        <Kpi
          rotulo="Leads de assistentes de IA"
          metrica={leads.assistentesDeIa}
          deltaTexto={deltaTexto}
          para="/leads"
          paraFiltros={{ origem: 'ai_assistant' }}
        />
        <Kpi
          rotulo="Clientes novos de IA"
          metrica={leads.clientesNovosDeIa}
          deltaTexto={deltaTexto}
          para="/chegada"
          paraFiltros={{ origem: 'ai_assistant' }}
        />
      </div>
      <PorFonte linhas={leads.porFonte} semDados={semDados} />
    </Secao>
  );
}

function PorFonte({ linhas, semDados }: { linhas: LinhaFonteDeLead[]; semDados: boolean }) {
  const idTitulo = useId();
  const vazio = useMemo(
    () => (
      <div className="yn-card">
        {semDados ? (
          <Vazio icone={ListX} titulo="Sem dados" texto="Os leads chegam do CSP 360 a cada 5 minutos." />
        ) : (
          <Vazio
            icone={ListX}
            titulo="Nenhum lead da busca ou de IA no período"
            texto="Escolha um período maior em Período para ver de onde vieram."
          />
        )}
      </div>
    ),
    [semDados],
  );

  return (
    <section className="mkt-stack min-w-0" aria-labelledby={idTitulo}>
      <div className="mkt-chart__head">
        <div>
          <h2 id={idTitulo}>Leads por fonte</h2>
          <p className="yn-muted text-sm">
            O buscador ou o assistente de onde a pessoa veio. Cliente novo conta no dia do 1º pedido enviado.
          </p>
        </div>
      </div>
      <Tabela
        colunas={COLUNAS}
        linhas={linhas}
        chaveDaLinha={(l) => l.chave}
        empilhar
        legenda="Leads e clientes novos por buscador e por assistente de IA"
        vazio={vazio}
      />
    </section>
  );
}

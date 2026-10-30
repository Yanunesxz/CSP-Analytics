/**
 * Seção "Assistentes de IA · GEO" (GA4): o aviso fixo de que a medição é parcial; sessões vindas de IA
 * e a parcela delas nas sessões do site; sessões por assistente (cor de cada um), sessões por canal do
 * GA4 (Busca orgânica e Assistente de IA em cor de série, o resto em cinza: só o que importa aqui se
 * destaca) e sessões de IA por dia, uma linha por marca.
 */

import { useMemo } from 'react';
import { cor, rotulo } from '@csp-mkt/shared';
import { GraficoBarras, GraficoLinha, Kpi, type EstadoGrafico, type ItemBarra } from '../../components/ui';
import { ROTULO_CANAL_GA4, type Ga4Channel, type PainelSeoGeo } from '../../data/queries/seo-geo';
import { AvisoDoConector, AvisoGeoParcial } from './Avisos';
import { Secao } from './Secao';
import { seriesPorMarca } from './series';
import { parcelaDe } from './textos';

export interface AssistentesDeIaProps {
  painel: PainelSeoGeo;
  semDados: boolean;
  deltaTexto?: string;
}

function corDoCanal(canal: Ga4Channel): string {
  if (canal === 'ai_assistant') return cor('leadSource', 'ai_assistant');
  if (canal === 'organic_search') return cor('leadSource', 'organic');
  return 'var(--color-text-muted)';
}

export function AssistentesDeIa({ painel, semDados, deltaTexto }: AssistentesDeIaProps) {
  const { geo, fontes } = painel;
  const estado: EstadoGrafico = semDados ? 'semDados' : 'ok';

  const porAssistente = useMemo<ItemBarra[]>(
    () =>
      geo.porAssistente.map((a) => ({
        rotulo: rotulo('geoSource', a.fonte),
        valor: a.sessoes.atual,
        cor: cor('geoSource', a.fonte),
        detalhe: parcelaDe(a.parcela, 'das sessões de IA'),
      })),
    [geo.porAssistente],
  );

  const porCanal = useMemo<ItemBarra[]>(
    () =>
      geo.porCanal.map((c) => ({
        rotulo: ROTULO_CANAL_GA4[c.canal],
        valor: c.sessoes,
        cor: corDoCanal(c.canal),
        detalhe: parcelaDe(c.parcela, 'das sessões'),
      })),
    [geo.porCanal],
  );

  const porDia = useMemo(() => seriesPorMarca(geo.sessoesPorDia, 'sessoes-ia'), [geo.sessoesPorDia]);

  return (
    <Secao
      titulo="Assistentes de IA · GEO"
      descricao="Visitas ao site vindas de ChatGPT, Perplexity, Claude, Gemini e Copilot."
      fonte={{ nome: 'GA4', cartao: fontes.ga4 }}
    >
      <AvisoGeoParcial />
      <AvisoDoConector nome="GA4" cartao={fontes.ga4} />
      <div className="mkt-grid-kpis" role="group" aria-label="Indicadores de assistentes de IA">
        <Kpi rotulo="Sessões de IA" metrica={geo.sessoes} deltaTexto={deltaTexto} />
        <Kpi
          rotulo="Parcela de IA nas sessões"
          metrica={geo.parcelaDasSessoes}
          formato="percentual"
          casas={1}
          deltaTexto={deltaTexto}
          nota="Das sessões do site no GA4"
        />
      </div>
      <div className="mkt-grid-2">
        <GraficoBarras
          titulo="Sessões por assistente"
          descricao="Visitas ao site que cada assistente de IA trouxe."
          itens={porAssistente}
          rotuloValor="Sessões"
          estado={estado}
        />
        <GraficoBarras
          titulo="Sessões por canal"
          descricao="De onde vieram as visitas ao site. Assistente de IA junta os cinco assistentes."
          itens={porCanal}
          rotuloValor="Sessões"
          estado={estado}
        />
      </div>
      <GraficoLinha
        titulo="Sessões de IA por dia"
        descricao="Visitas vindas de assistentes de IA, por marca."
        series={porDia}
        estado={estado}
      />
    </Secao>
  );
}

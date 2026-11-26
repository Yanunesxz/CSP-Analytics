/**
 * Visão geral no modo Supabase enquanto nenhum conector de mídia nem o CSP 360 trazem dado: em vez da tela vazia,
 * mostra o que já chega (o site, pelo GA4, lido de `api.kpi_seo_geo`) e o que ainda falta ligar, em palavras do
 * negócio. Some sozinho quando a Visão geral tiver números (a função de tela dela, na fase 4).
 * A tela só desenha: nenhuma soma aqui (decisão 0034); o total de visitas é o `geo.sessions` da função.
 */

import { CircleDashed, Globe } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { ApiKpiSeoGeo } from '@csp-mkt/shared';
import { GraficoBarras, Kpi, Tela, type ItemBarra } from '../../components/ui';
import { useConsultaDaApi } from '../../data/api';
import { ROTULO_CANAL_GA4, type PainelSeoGeo } from '../../data/queries/seo-geo';
import { painelSeoGeoDaApi } from '../../data/queries/seo-geo-api';
import { useFiltros } from '../../lib/url-state';
import { AvisoDoConector } from '../seo-geo/Avisos';
import { Secao } from '../seo-geo/Secao';
import { parcelaDe } from '../seo-geo/textos';
import { AINDA_NAO_CHEGA } from './textos';

const ultimaLeitura = (r: ApiKpiSeoGeo) => r.sources.ga4.last_success_at;

export function JaChega() {
  const { resultado: r, recarregar } = useConsultaDaApi('kpi_seo_geo', painelSeoGeoDaApi, ultimaLeitura);
  const { linkCom } = useFiltros();

  return (
    <>
      <div className="yn-alert" data-tone="info" role="status">
        <CircleDashed strokeWidth={1.75} aria-hidden="true" />
        <div>
          <strong className="yn-alert__title">Por enquanto, só o site chega</strong>
          Custo por cliente novo, gasto e leads aparecem aqui quando os anúncios e o CSP 360 forem ligados.
          Abaixo, o que já dá para ver e o que falta.
        </div>
      </div>
      <Tela
        resultado={r}
        esqueleto="grafico"
        aoTentarDeNovo={r.filtros.estado ? undefined : recarregar}
        vazio={{
          icone: Globe,
          titulo: 'Nenhuma visita ao site ainda',
          texto: 'O GA4 lê o site uma vez por dia. As visitas aparecem depois da primeira leitura.',
          acao: null,
        }}
      >
        {(painel, estado) => (
          <Site
            painel={painel}
            semDados={estado === 'sem-dados'}
            deltaTexto={r.filtros.comparar ? painel.intervalo.rotuloAnterior : undefined}
          />
        )}
      </Tela>
      <Secao
        titulo="Ainda não chega"
        descricao="O que falta ligar para a Visão geral mostrar o custo de cada cliente novo."
      >
        <ul className="mkt-stack" aria-label="Fontes que ainda não chegam">
          {AINDA_NAO_CHEGA.map((f) => (
            <li key={f.nome} className="grid gap-1">
              <span className="text-sm font-semibold">{f.nome}</span>
              <span className="yn-muted text-sm">{f.traz}</span>
            </li>
          ))}
        </ul>
        <p>
          <Link className="yn-btn yn-btn--secondary" to={linkCom('/conectores')}>
            Ver conectores
          </Link>
        </p>
      </Secao>
    </>
  );
}

function Site({
  painel,
  semDados,
  deltaTexto,
}: {
  painel: PainelSeoGeo;
  semDados: boolean;
  deltaTexto?: string;
}) {
  const { geo, fontes } = painel;
  const { linkCom } = useFiltros();
  const porCanal = useMemo<ItemBarra[]>(
    () =>
      geo.porCanal.map((c) => ({
        rotulo: ROTULO_CANAL_GA4[c.canal],
        valor: c.sessoes,
        cor: 'var(--color-text)',
        detalhe: parcelaDe(c.parcela, 'das visitas'),
      })),
    [geo.porCanal],
  );

  return (
    <Secao
      titulo="Site · o que já chega"
      descricao="Visitas ao site da Corpo Sensual, pelo GA4. A Plumene entra quando o site dela for ligado."
      fonte={{ nome: 'GA4', cartao: fontes.ga4 }}
    >
      <AvisoDoConector nome="GA4" cartao={fontes.ga4} />
      <div className="mkt-grid-kpis" role="group" aria-label="Indicadores do site">
        <Kpi
          rotulo="Visitas ao site"
          metrica={geo.sessoesDoSite}
          deltaTexto={deltaTexto}
          nota="Sessões no GA4"
        />
        <Kpi
          rotulo="Visitas vindas de IA"
          metrica={geo.sessoes}
          deltaTexto={deltaTexto}
          nota="ChatGPT, Perplexity, Claude, Gemini e Copilot"
        />
      </div>
      <GraficoBarras
        titulo="Visitas ao site por canal"
        descricao="De onde veio quem entrou no site: busca, redes sociais, direto, anúncios ou assistente de IA."
        itens={porCanal}
        rotuloValor="Sessões"
        estado={semDados ? 'semDados' : 'ok'}
      />
      <p className="text-sm">
        <Link to={linkCom('/seo-geo')}>Ver SEO e GEO</Link>
      </p>
    </Secao>
  );
}

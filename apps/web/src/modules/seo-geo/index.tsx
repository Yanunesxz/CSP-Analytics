/**
 * SEO e GEO (/seo-geo), só leitura na v1. Uma seção por fonte, cada uma com o selo da sua sincronização:
 * - Busca orgânica · SEO (Search Console): impressões, cliques, CTR, posição média e as consultas que
 *   mais trazem;
 * - Assistentes de IA · GEO (GA4): sessões de IA por assistente, a parcela delas nas sessões do site e
 *   as sessões por canal, com o aviso fixo de que a medição de GEO é parcial;
 * - Leads e clientes novos (CSP 360): os que chegaram pela busca orgânica ou por IA, pelo endereço de
 *   origem, por buscador e por assistente;
 * - Checagem dos sites: robots.txt, llms.txt e JSON-LD de cada site.
 *
 * Toda conta vem do banco (`api.kpi_seo_geo`, modo Supabase) ou de `painelSeoGeo` (data/queries/seo-geo.ts, modo
 * demonstração); a tela só desenha. Marca no menu, período
 * na barra de filtros, visão no topo; tudo na URL. `?estado=` é honrado por useConsulta + Tela.
 * Ação principal: abrir o Search Console, onde se lê uma vez por mês o relatório de IA generativa.
 * Visão Gestor de tráfego: acrescenta as pendências que travam a medição (SEO e GEO não têm operador).
 */

import { ExternalLink, Search } from 'lucide-react';
import { PageHeader } from '../../components/layout/pagina';
import { BarraDeFiltros, Tela } from '../../components/ui';
import type { ApiKpiSeoGeo } from '@csp-mkt/shared';
import { useConsultaDaApi, type ConsultaDaApi } from '../../data/api';
import { painelSeoGeo, type PainelSeoGeo } from '../../data/queries/seo-geo';
import { painelSeoGeoDaApi } from '../../data/queries/seo-geo-api';
import { useConsulta } from '../../data/store';
import { modoDeAcesso } from '../../lib/auth';
import type { Filtros } from '../../lib/url-state';
import { AssistentesDeIa } from './AssistentesDeIa';
import { AvisoDoGestor } from './Avisos';
import { BuscaOrganica } from './BuscaOrganica';
import { ChecagemDosSites } from './ChecagemDosSites';
import { LeadsDaBuscaEDeIa } from './LeadsDaBuscaEDeIa';
import { URL_SEARCH_CONSOLE } from './textos';

/** A única ação principal da tela, na barra do topo. */
const ACAO = (
  <a
    className="yn-btn yn-btn--primary"
    href={URL_SEARCH_CONSOLE}
    target="_blank"
    rel="noopener noreferrer"
    title="Abre o Search Console em outra aba"
  >
    <ExternalLink strokeWidth={1.75} aria-hidden="true" />
    Abrir o Search Console
    <span className="yn-sr-only"> (abre em outra aba)</span>
  </a>
);

const VAZIO = {
  icone: Search,
  titulo: 'Nenhum número de SEO e GEO ainda',
  texto: 'Os números chegam do Search Console e do GA4 uma vez por dia, depois que os conectores ligarem.',
};

const ultimaLeitura = (r: ApiKpiSeoGeo) => r.sources.ga4.last_success_at;

/** Modo Supabase: o painel vem de api.kpi_seo_geo. */
function useDoBanco(): ConsultaDaApi<PainelSeoGeo> {
  return useConsultaDaApi('kpi_seo_geo', painelSeoGeoDaApi, ultimaLeitura);
}

/** Modo demonstração: a consulta pura sobre o store. */
function useDaDemonstracao(): ConsultaDaApi<PainelSeoGeo> {
  return { resultado: useConsulta(painelSeoGeo), recarregar: () => undefined };
}

// O modo não muda com a página aberta: a escolha é feita uma vez, fora do componente.
const usePainel = modoDeAcesso() === 'supabase' ? useDoBanco : useDaDemonstracao;

export default function SeoGeo() {
  const { resultado: r, recarregar } = usePainel();
  const doBanco = modoDeAcesso() === 'supabase';

  return (
    <>
      <PageHeader
        grupo="Canais"
        titulo="SEO e GEO"
        acao={ACAO}
        atualizadoEm={r.dados?.atualizadoEm ?? r.atualizadoEm}
      />
      {/* SEO e GEO se filtram por marca (menu) e período: canal, campanha e operador não existem aqui. */}
      <BarraDeFiltros campos={[]} />
      <Tela
        resultado={r}
        vazio={VAZIO}
        aoTentarDeNovo={doBanco && !r.filtros.estado ? recarregar : undefined}
      >
        {(painel, estado) => <Painel painel={painel} semDados={estado === 'sem-dados'} filtros={r.filtros} />}
      </Tela>
    </>
  );
}

interface PainelProps {
  painel: PainelSeoGeo;
  semDados: boolean;
  filtros: Filtros;
}

function Painel({ painel, semDados, filtros }: PainelProps) {
  const deltaTexto = filtros.comparar ? painel.intervalo.rotuloAnterior : undefined;

  return (
    <>
      {filtros.visao === 'gestor' ? <AvisoDoGestor pendencias={painel.pendencias} /> : null}
      <BuscaOrganica
        painel={painel}
        semDados={semDados}
        deltaTexto={deltaTexto}
        mostrarMarca={filtros.marca === 'todas'}
      />
      <AssistentesDeIa painel={painel} semDados={semDados} deltaTexto={deltaTexto} />
      <LeadsDaBuscaEDeIa painel={painel} semDados={semDados} deltaTexto={deltaTexto} />
      <ChecagemDosSites painel={painel} />
    </>
  );
}

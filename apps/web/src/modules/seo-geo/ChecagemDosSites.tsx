/**
 * Seção "Checagem dos sites": a lista de verificação de cada site (robots.txt, llms.txt e JSON-LD),
 * um cartão por marca, cada item com o estado em texto (.yn-badge "Em ordem" ou "Atenção") e o que foi
 * encontrado; quando pede atenção, o detalhe já diz o que fazer.
 */

import { ListChecks } from 'lucide-react';
import { useId } from 'react';
import { cor, rotulo } from '@csp-mkt/shared';
import { Badge, PontoDeSerie, Vazio } from '../../components/ui';
import {
  ESTADO_DA_CHECAGEM,
  ROTULO_ITEM_DA_CHECAGEM,
  type PainelSeoGeo,
  type SiteDoPainel,
} from '../../data/queries/seo-geo';
import { Secao } from './Secao';
import { textoDaConferencia } from './textos';

export function ChecagemDosSites({ painel }: { painel: PainelSeoGeo }) {
  return (
    <Secao
      titulo="Checagem dos sites"
      descricao="O que buscadores e assistentes de IA encontram em cada site: o robots.txt diz quem pode ler, o llms.txt resume o site para a IA e o JSON-LD descreve a empresa e os produtos."
    >
      {painel.sites.length === 0 ? (
        <div className="yn-card">
          <Vazio
            icone={ListChecks}
            titulo="Sem dados"
            texto="A checagem roda uma vez por dia e confere o robots.txt, o llms.txt e o JSON-LD de cada site."
          />
        </div>
      ) : (
        <div className="mkt-grid-2">
          {painel.sites.map((site) => (
            <CartaoDoSite key={site.marca} site={site} />
          ))}
        </div>
      )}
    </Secao>
  );
}

function CartaoDoSite({ site }: { site: SiteDoPainel }) {
  const idTitulo = useId();
  return (
    <section className="yn-card mkt-stack min-w-0" aria-labelledby={idTitulo}>
      <div className="mkt-chart__head">
        <h3 id={idTitulo} className="flex items-center gap-2">
          <PontoDeSerie cor={cor('brand', site.marca)} />
          {rotulo('brand', site.marca)}
        </h3>
        <p className="yn-muted text-sm wrap-anywhere">{site.host}</p>
      </div>
      <dl className="yn-dl yn-dl--rows">
        {site.itens.map((i) => {
          const estado = ESTADO_DA_CHECAGEM[i.status];
          return (
            <div key={i.item}>
              <dt className="min-w-0">
                <span className="block font-medium text-ink">{ROTULO_ITEM_DA_CHECAGEM[i.item]}</span>
                <span className="yn-hint block">{i.detalhe}</span>
              </dt>
              <dd>
                <Badge tom={estado.tom}>{estado.rotulo}</Badge>
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="yn-hint">{textoDaConferencia(site)}</p>
    </section>
  );
}

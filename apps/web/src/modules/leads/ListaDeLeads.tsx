/**
 * Lista de leads sem dado pessoal (decisão 0006): código, origem, marca, campanha, data, etapa e o
 * link para a ficha 360 no CSP 360. Nome, telefone e e-mail ficam só no CSP 360.
 *
 * Os chips de etapa filtram só a lista e vivem na URL (`?etapa=`); os filtros da barra valem para a
 * tela toda. Vira cards abaixo de 640px de área (.yn-table--stack).
 */

import { ExternalLink, ListX, SearchX } from 'lucide-react';
import { useId } from 'react';
import { cor, rotulo, type LeadStage } from '@csp-mkt/shared';
import { Badge, PontoDeSerie, Tabela, Vazio, type Coluna } from '../../components/ui';
import { ETAPAS } from '../../data/queries';
import { rotuloDaMarcaDoLead, type LeadDoPainel, type PainelDeLeads } from '../../data/queries/leads';
import { dataHora, numero } from '../../lib/format';
import { resumoDaLista } from './textos';

const COLUNAS: Coluna<LeadDoPainel>[] = [
  { chave: 'codigo', titulo: 'Código', valor: (l) => l.code },
  {
    chave: 'origem',
    titulo: 'Origem',
    valor: (l) => rotulo('leadSource', l.origem),
    render: (l) => (
      <span className="inline-flex items-center gap-2 whitespace-normal">
        <PontoDeSerie cor={cor('leadSource', l.origem)} />
        {rotulo('leadSource', l.origem)}
      </span>
    ),
  },
  // Marca, campanha e data quebram linha (a .yn-table não quebra), para a lista caber em 1280px.
  {
    chave: 'marca',
    titulo: 'Marca',
    valor: (l) => rotuloDaMarcaDoLead(l.marca),
    render: (l) => <span className="whitespace-normal">{rotuloDaMarcaDoLead(l.marca)}</span>,
  },
  {
    chave: 'campanha',
    titulo: 'Campanha',
    valor: (l) => l.campanha,
    render: (l) => <span className="whitespace-normal">{l.campanha ?? '—'}</span>,
  },
  {
    chave: 'data',
    titulo: 'Chegou em',
    valor: (l) => Date.parse(l.criadoEm),
    render: (l) => <span className="whitespace-normal tabular-nums">{dataHora(l.criadoEm)}</span>,
  },
  {
    chave: 'etapa',
    titulo: 'Etapa',
    valor: (l) => ETAPAS.indexOf(l.etapa),
    render: (l) => <Badge lista="leadStage" codigo={l.etapa} />,
  },
  {
    chave: 'ficha',
    titulo: 'Ficha 360',
    render: (l) =>
      l.linkCrm ? (
        <a
          className="yn-btn yn-btn--ghost yn-btn--sm"
          href={l.linkCrm}
          target="_blank"
          rel="noopener noreferrer"
          // O nome acessível começa com o texto visível ("Abrir ficha"), para quem comanda por voz
          aria-label={`Abrir ficha 360 de ${l.code} no CSP 360 (abre em outra aba)`}
        >
          <ExternalLink strokeWidth={1.75} aria-hidden="true" />
          Abrir ficha
        </a>
      ) : (
        <span className="yn-muted">A cadastrar</span>
      ),
  },
];

export interface ListaDeLeadsProps {
  painel: PainelDeLeads;
  semDados: boolean;
  aoMudarEtapa: (etapa: LeadStage | null) => void;
  /** Limpa os filtros da barra e a etapa, de uma vez. */
  aoLimpar: () => void;
}

export function ListaDeLeads({ painel, semDados, aoMudarEtapa, aoLimpar }: ListaDeLeadsProps) {
  const idTitulo = useId();
  const { etapa, lista, totalDaLista, porEtapa } = painel;
  const resumo = resumoDaLista(lista.length, totalDaLista);

  const vazio =
    semDados || totalDaLista === null ? (
      <div className="yn-card">
        <Vazio
          icone={ListX}
          titulo="Sem dados"
          texto="A lista aparece quando os leads chegarem do CSP 360."
        />
      </div>
    ) : (
      <div className="yn-card">
        <Vazio
          icone={SearchX}
          titulo="Nenhum lead com estes filtros"
          texto="Mude o período, escolha outra etapa ou limpe os filtros."
          acao={
            <button className="yn-btn yn-btn--secondary" type="button" onClick={aoLimpar}>
              Limpar filtros
            </button>
          }
        />
      </div>
    );

  return (
    // min-w-0 na seção e na fila: os chips não quebram linha no celular (rolam de lado) e, sem ele,
    // alargariam a grade da página em 375px.
    <section className="mkt-stack min-w-0" aria-labelledby={idTitulo}>
      <div className="mkt-chart__head">
        <div>
          <h2 id={idTitulo}>Lista de leads</h2>
          <p className="yn-muted text-sm">
            Só código, origem, marca, campanha, data e etapa. Nome e telefone ficam na ficha 360, no CSP 360.
          </p>
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="yn-chips" role="group" aria-label="Filtrar a lista por etapa">
          {porEtapa.map((e) => {
            const ligado = etapa === e.etapa;
            return (
              <button
                key={e.etapa}
                className="yn-chip"
                type="button"
                aria-pressed={ligado}
                onClick={() => aoMudarEtapa(ligado ? null : e.etapa)}
              >
                {e.rotulo}
                {e.leads !== null ? <span className="yn-count">{numero(e.leads)}</span> : null}
              </button>
            );
          })}
        </div>
        {etapa ? (
          <button
            className="yn-btn yn-btn--ghost yn-btn--sm"
            type="button"
            onClick={() => aoMudarEtapa(null)}
          >
            Ver todas as etapas
          </button>
        ) : null}
      </div>

      <p className="yn-muted text-sm" aria-live="polite">
        {resumo}
      </p>

      <Tabela
        colunas={COLUNAS}
        linhas={lista}
        chaveDaLinha={(l) => l.id}
        empilhar
        ordenacaoInicial={{ chave: 'data', direcao: 'desc' }}
        legenda="Lista de leads"
        vazio={vazio}
      />
    </section>
  );
}

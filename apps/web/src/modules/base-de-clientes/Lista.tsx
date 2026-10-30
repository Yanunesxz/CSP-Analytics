/**
 * Lista de clientes da base: filtros rápidos (Todos, Ativos, Inativos, Perdidos, Reativados, Sem situação)
 * na URL (`?recorte=`), há mais tempo sem comprar primeiro, e o link "Abrir no CSP 360" em cada linha.
 * Só código, marcas, situação e datas: nome, contato e representante ficam na ficha 360 do CSP 360
 * (a carteira de cada representante está na tabela "Por representante" e no filtro).
 */

import { ExternalLink, Users } from 'lucide-react';
import { useId, useMemo } from 'react';
import { cor, type CustomerSituation } from '@csp-mkt/shared';
import { Badge, PontoDeSerie, Tabela, Vazio, type Coluna } from '../../components/ui';
import {
  RECORTES,
  recortarLista,
  type ClienteDaTela,
  type PainelDaBase,
} from '../../data/queries/base-de-clientes';
import { data, numero, VAZIO } from '../../lib/format';
import { ANCORA_DA_LISTA_DA_BASE } from '../../rotas';
import { useRecorte } from './recorte';
import { rotuloDasMarcas, tempoDesde, textoListaCortada } from './textos';

/** Ordem de "Situação" ao ordenar: o que pede ação primeiro. */
const ORDEM_DA_SITUACAO: Record<CustomerSituation, number> = {
  lost: 0,
  inactive_old: 1,
  inactive_recent: 2,
  active: 3,
  lead: 4,
};

const colunas: Coluna<ClienteDaTela>[] = [
  { chave: 'cliente', titulo: 'Cliente', valor: (c) => c.code },
  {
    chave: 'marcas',
    titulo: 'Marcas',
    valor: (c) => rotuloDasMarcas(c.brands),
    render: (c) => (
      <span className="inline-flex items-center gap-2">
        {c.brands.map((marca) => (
          <PontoDeSerie key={marca} cor={cor('brand', marca)} />
        ))}
        {rotuloDasMarcas(c.brands)}
      </span>
    ),
  },
  {
    chave: 'situacao',
    titulo: 'Situação',
    valor: (c) => (c.situation ? ORDEM_DA_SITUACAO[c.situation] : 5),
    render: (c) => (c.situation ? <Badge lista="customerSituation" codigo={c.situation} /> : VAZIO),
  },
  {
    chave: 'ultimaCompra',
    titulo: 'Última compra',
    valor: (c) => c.lastOrderAt,
    // Um span só: no celular a célula vira flex (rótulo à esquerda, valor à direita)
    render: (c) => {
      const tempo = tempoDesde(c.diasDesdeUltimaCompra);
      return (
        <span>
          {data(c.lastOrderAt)}
          {tempo ? <span className="yn-muted">{` · ${tempo}`}</span> : null}
        </span>
      );
    },
  },
  {
    chave: 'noPeriodo',
    titulo: 'No período',
    valor: (c) => (c.reativado ? 0 : c.comprouNoPeriodo ? 1 : 2),
    render: (c) =>
      c.reativado ? (
        <Badge tom="success">Reativado</Badge>
      ) : c.comprouNoPeriodo ? (
        <Badge>Comprou</Badge>
      ) : (
        VAZIO
      ),
  },
  {
    chave: 'ficha',
    titulo: 'Ficha 360',
    ordenavel: false,
    // aria-label (e não .yn-sr-only): o texto oculto escaparia da rolagem da tabela e alargaria a página
    render: (c) => (
      <a
        className="yn-btn yn-btn--ghost yn-btn--sm"
        href={c.linkCrm}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Abrir no CSP 360 (${c.code}, abre em outra aba)`}
      >
        <ExternalLink strokeWidth={1.75} aria-hidden="true" />
        Abrir no CSP 360
      </a>
    ),
  },
];

export function Lista({ painel }: { painel: PainelDaBase }) {
  const id = useId();
  const { recorte, definirRecorte } = useRecorte();
  const { linhas, total, cortada } = useMemo(
    () => recortarLista(painel.lista, recorte),
    [painel.lista, recorte],
  );

  // Sem a situação do CSP 360, os filtros de situação não têm o que mostrar; "Sem situação" só aparece se houver
  const chips = RECORTES.filter(
    (r) =>
      r.codigo === recorte ||
      (r.precisaDeSituacao
        ? painel.situacaoConhecida
        : r.codigo !== 'sem-situacao' || (painel.recortes['sem-situacao'] ?? 0) > 0),
  );

  const vazio =
    painel.total === null ? (
      <Vazio
        icone={Users}
        titulo="Sem dados"
        texto="A lista aparece quando os clientes chegarem do CSP 360."
      />
    ) : recorte ? (
      <Vazio
        icone={Users}
        titulo="Nenhum cliente neste grupo"
        texto="Escolha outro filtro rápido ou veja a base inteira."
        acao={
          <button className="yn-btn yn-btn--secondary" type="button" onClick={() => definirRecorte(null)}>
            Ver todos
          </button>
        }
      />
    ) : (
      <Vazio
        icone={Users}
        titulo="Nenhum cliente com esses filtros"
        texto="Limpe os filtros para ver a base inteira."
      />
    );

  return (
    // A âncora (#lista-de-clientes) é o destino dos indicadores da tela: "Inativos" abre a lista já filtrada
    <section id={ANCORA_DA_LISTA_DA_BASE} className="mkt-stack" aria-labelledby={id}>
      <div className="mkt-chart__head">
        <h2 id={id}>Clientes</h2>
        <p className="yn-muted text-sm">
          Só código, marca, situação e datas. Nome e contato ficam na ficha do CSP 360.
        </p>
      </div>

      {/* Sem base (nenhum cliente chegou), os filtros rápidos não têm o que filtrar */}
      {painel.total !== null ? (
        <div className="yn-chips" role="group" aria-label="Filtrar a lista">
          <button
            className="yn-chip"
            type="button"
            aria-pressed={recorte === null}
            onClick={() => definirRecorte(null)}
          >
            Todos
            <span className="yn-count">{numero(painel.total)}</span>
          </button>
          {chips.map((r) => {
            const ligado = recorte === r.codigo;
            const quantos = painel.recortes[r.codigo];
            return (
              <button
                key={r.codigo}
                className="yn-chip"
                type="button"
                aria-pressed={ligado}
                onClick={() => definirRecorte(ligado ? null : r.codigo)}
              >
                {r.rotulo}
                {quantos !== null ? <span className="yn-count">{numero(quantos)}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <Tabela
        colunas={colunas}
        linhas={linhas}
        chaveDaLinha={(c) => c.id}
        empilhar
        ordenacaoInicial={{ chave: 'ultimaCompra', direcao: 'asc' }}
        legenda="Clientes da base"
        vazio={vazio}
      />
      {cortada ? <p className="yn-muted text-sm">{textoListaCortada(linhas.length, total)}</p> : null}
    </section>
  );
}

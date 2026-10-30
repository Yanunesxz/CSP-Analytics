/**
 * "O que podemos fazer": todas as ações (propostas do Claude, ideias do gestor e pendências que travam a
 * medição), com custo estimado, impacto, esforço, quem propôs e status. Filtra pela barra (canal,
 * campanha, operador; a marca vem do menu) e, só aqui, por status (chips), impacto e esforço (painel
 * "Filtrar a lista"), com "Meus filtros da lista" salvos por nome. Tudo na URL.
 *
 * Cada linha traz o próximo passo dela: "Decidir" leva a proposta para a fila; "Marcar como feita" fecha
 * uma aprovada, em execução ou pendência (enquanto não há credencial de escrita, decisão 0005).
 */

import { Bookmark, Filter, Plus, SlidersHorizontal, Trash2, TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { opcoes, rotulo, type Level } from '@csp-mkt/shared';
import { Badge, ChipSerie, Vazio, useToast } from '../../components/ui';
import { marcarAcaoComoFeita, proporAcao } from '../../data/actions';
import {
  MAXIMO_DA_LISTA,
  STATUS_DA_LISTA,
  type FiltrosDaLista,
  type ItemDeAcao,
  type PainelDoTrafego,
} from '../../data/queries/trafego-ia';
import { data, dinheiro, plural } from '../../lib/format';
import { useFiltros } from '../../lib/url-state';
import { JanelaFeita, JanelaIdeia, type NovaIdeia } from './janelas';
import { FATOS_COMPACTOS } from './estilos';
import { usePermissoesDoTrafego } from './permissoes';
import {
  conjuntoDe,
  gravarConjuntos,
  lerConjuntos,
  quantosFiltros,
  type ConjuntoSalvo,
  type UsoDaTela,
} from './url';

const PODE_MARCAR_FEITA = new Set(['approved', 'running']);

function podeMarcarComoFeita(item: ItemDeAcao): boolean {
  return (
    PODE_MARCAR_FEITA.has(item.status) ||
    (item.kind === 'pending_fix' && item.status !== 'done' && item.status !== 'discarded')
  );
}

/* ---------- Uma linha da lista ---------- */

function Linha({
  item,
  aoDecidir,
  aoMarcarFeita,
}: {
  item: ItemDeAcao;
  aoDecidir: (id: string) => void;
  aoMarcarFeita: (item: ItemDeAcao) => void;
}) {
  const { podeAprovar, podeOperar } = usePermissoesDoTrafego();
  const naFila = item.status === 'idea' && item.kind !== 'pending_fix';
  let botao: ReactNode = null;
  if (naFila)
    botao = (
      <button
        className="yn-btn yn-btn--secondary yn-btn--sm"
        type="button"
        aria-label={`${podeAprovar ? 'Decidir' : 'Ver na fila'}: ${item.title}`}
        onClick={() => aoDecidir(item.id)}
      >
        {podeAprovar ? 'Decidir' : 'Ver na fila'}
      </button>
    );
  else if (podeOperar && podeMarcarComoFeita(item))
    botao = (
      <button
        className="yn-btn yn-btn--secondary yn-btn--sm"
        type="button"
        aria-label={`Marcar como feita: ${item.title}`}
        aria-haspopup="dialog"
        onClick={() => aoMarcarFeita(item)}
      >
        Marcar como feita
      </button>
    );

  return (
    <li className="grid gap-3 border-t border-line p-4 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid min-w-0 flex-1 gap-1">
          <p className="m-0 font-semibold" style={{ overflowWrap: 'anywhere' }}>
            {item.title}
          </p>
          <p className="yn-muted m-0 text-xs">
            {rotulo('actionKind', item.kind)} · {rotulo('brand', item.brandId)}
            {item.platform ? ` · ${rotulo('platform', item.platform)}` : ''}
            {item.campanha ? ` · ${item.campanha.nome}` : ''} · {data(item.createdAt)}
          </p>
        </div>
        <Badge lista="actionStatus" codigo={item.status} />
      </div>
      {item.rationale ? (
        <p className="yn-muted m-0 line-clamp-2 text-sm" title={item.rationale}>
          {item.rationale}
        </p>
      ) : null}
      <dl className="yn-dl" style={FATOS_COMPACTOS}>
        <div>
          <dt>Proposta por</dt>
          <dd>
            <ChipSerie lista="operator" codigo={item.proposedBy} />
          </dd>
        </div>
        <div>
          <dt>Impacto</dt>
          <dd>{rotulo('level', item.impact)}</dd>
        </div>
        <div>
          <dt>Esforço</dt>
          <dd>{rotulo('level', item.effort)}</dd>
        </div>
        <div>
          <dt>Custo estimado</dt>
          <dd>{item.costCents === null ? '' : dinheiro(item.costCents)}</dd>
        </div>
      </dl>
      {item.alerta ? (
        <p className="m-0 flex items-start gap-2 text-sm text-tone-warning">
          <TriangleAlert strokeWidth={1.75} aria-hidden="true" className="mt-0.5" />
          {item.alerta}
        </p>
      ) : null}
      {item.result ? <p className="yn-muted m-0 text-sm">{item.result}</p> : null}
      {botao ? <div className="flex justify-end">{botao}</div> : null}
    </li>
  );
}

/* ---------- Painel "Filtrar a lista" ---------- */

function Niveis({
  rotulo: rotuloDoGrupo,
  valor,
  aoMudar,
}: {
  rotulo: string;
  valor: Level | null;
  aoMudar: (nivel: Level | null) => void;
}) {
  const id = useId();
  return (
    <div className="yn-field">
      <span className="yn-label" id={id}>
        {rotuloDoGrupo}
      </span>
      <div className="yn-segmented" role="group" aria-labelledby={id}>
        <button type="button" aria-pressed={valor === null} onClick={() => aoMudar(null)}>
          Todos
        </button>
        {opcoes('level').map((o) => (
          <button
            key={o.codigo}
            type="button"
            aria-pressed={valor === o.codigo}
            onClick={() => aoMudar(o.codigo)}
          >
            {o.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}

function PainelDeFiltros({
  aberto,
  aoFechar,
  tela,
}: {
  aberto: boolean;
  aoFechar: () => void;
  tela: UsoDaTela;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();
  const { filtros } = useFiltros();
  const [conjuntos, setConjuntos] = useState<ConjuntoSalvo[]>(() => lerConjuntos());
  const [nome, setNome] = useState('');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (aberto && !el.open) el.showModal();
    if (!aberto && el.open) el.close();
  }, [aberto]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Painel de leitura: clicar fora fecha (regra 11); Esc fecha pelo navegador
    const aoClicarFora = (e: MouseEvent) => {
      if (e.target === el) aoFechar();
    };
    el.addEventListener('click', aoClicarFora);
    return () => el.removeEventListener('click', aoClicarFora);
  }, [aoFechar]);

  const salvar = () => {
    const limpo = nome.trim();
    if (!limpo) return;
    const lista = [...conjuntos.filter((c) => c.nome !== limpo), conjuntoDe(limpo, filtros, tela.lista)];
    setConjuntos(lista);
    gravarConjuntos(lista);
    setNome('');
  };

  const excluir = (alvo: string) => {
    const lista = conjuntos.filter((c) => c.nome !== alvo);
    setConjuntos(lista);
    gravarConjuntos(lista);
  };

  return (
    <dialog
      className="yn-drawer"
      ref={ref}
      aria-labelledby={idTitulo}
      onClose={aoFechar}
      style={{ overflowY: 'auto' }}
    >
      <div className="yn-dialog__header">
        <h2 id={idTitulo}>Filtrar a lista</h2>
        <button
          className="yn-btn yn-btn--ghost yn-btn--icon"
          type="button"
          aria-label="Fechar filtros da lista"
          onClick={aoFechar}
        >
          <X strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <div className="mkt-stack">
        <p className="yn-muted m-0 text-sm">
          Status fica nos chips acima da lista; canal, campanha e operador, no botão Filtros do topo da tela.
        </p>
        <Niveis
          rotulo="Impacto"
          valor={tela.lista.impacto}
          aoMudar={(impacto) => tela.definir({ impacto })}
        />
        <Niveis
          rotulo="Esforço"
          valor={tela.lista.esforco}
          aoMudar={(esforco) => tela.definir({ esforco })}
        />

        <section
          className="mkt-stack"
          aria-labelledby={`${idTitulo}-salvos`}
          style={{ gap: 'var(--space-2)' }}
        >
          <h3 id={`${idTitulo}-salvos`}>Meus filtros da lista</h3>
          {conjuntos.length === 0 ? (
            <p className="yn-muted m-0 text-sm">
              Nenhum conjunto salvo. Dê um nome aos filtros de agora (canal, operador, status, impacto e
              esforço) para voltar a eles depois.
            </p>
          ) : null}
          {conjuntos.map((c) => (
            <div key={c.nome} className="mkt-actions items-center">
              <button
                className="yn-btn yn-btn--secondary yn-btn--sm"
                type="button"
                onClick={() => {
                  tela.aplicar(c);
                  aoFechar();
                }}
              >
                <Bookmark strokeWidth={1.75} aria-hidden="true" />
                {c.nome}
                <span className="yn-count" aria-hidden="true">
                  {quantosFiltros(c)}
                </span>
                <span className="yn-sr-only">, {plural(quantosFiltros(c), 'filtro', 'filtros')}</span>
              </button>
              <button
                className="yn-btn yn-btn--ghost yn-btn--sm yn-btn--icon"
                type="button"
                aria-label={`Excluir o conjunto ${c.nome}`}
                onClick={() => excluir(c.nome)}
              >
                <Trash2 strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          ))}
          <div className="yn-field">
            <label className="yn-label" htmlFor={`${idTitulo}-nome`}>
              Salvar os filtros de agora como
            </label>
            <div className="mkt-actions">
              <input
                id={`${idTitulo}-nome`}
                className="yn-input"
                style={{ flex: 1 }}
                value={nome}
                placeholder="Ex.: Ideias do Claude no Meta"
                onChange={(e) => setNome(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    salvar();
                  }
                }}
              />
              <button
                className="yn-btn yn-btn--secondary"
                type="button"
                onClick={salvar}
                disabled={!nome.trim()}
              >
                Salvar
              </button>
            </div>
          </div>
        </section>
      </div>
      <div className="yn-dialog__footer">
        <button
          className="yn-btn yn-btn--ghost"
          type="button"
          onClick={() => tela.definir({ status: null, impacto: null, esforco: null })}
        >
          Limpar filtros da lista
        </button>
        <button className="yn-btn yn-btn--secondary" type="button" onClick={aoFechar}>
          Fechar
        </button>
      </div>
    </dialog>
  );
}

/* ---------- A lista ---------- */

export interface ListaProps {
  painel: PainelDoTrafego;
  semDados: boolean;
  tela: UsoDaTela;
  aoDecidir: (id: string) => void;
  /** Limpa barra (canal, campanha, operador) e lista de uma vez. */
  aoLimparTudo: () => void;
}

export function OQuePodemosFazer({ painel, semDados, tela, aoDecidir, aoLimparTudo }: ListaProps) {
  const { perfilId, podeOperar } = usePermissoesDoTrafego();
  const { filtros, ativos } = useFiltros();
  const { avisar } = useToast();
  const [painelAberto, setPainelAberto] = useState(false);
  const [marcando, setMarcando] = useState<ItemDeAcao | null>(null);
  const [registrando, setRegistrando] = useState(false);
  const fecharPainel = useCallback(() => setPainelAberto(false), []);

  const l: FiltrosDaLista = tela.lista;
  const ativosDaLista = [l.impacto ? 'impacto' : null, l.esforco ? 'esforco' : null].filter(Boolean).length;
  const algumFiltro = Boolean(l.status || l.impacto || l.esforco) || ativos.length > 0;

  let conteudo: ReactNode;
  if (painel.lista.length === 0) {
    conteudo = semDados ? (
      <Vazio
        titulo="Sem dados"
        texto="A lista aparece quando as propostas do Claude e as ideias do gestor chegarem."
      />
    ) : algumFiltro ? (
      <Vazio
        icone={Filter}
        titulo="Nenhuma ação com estes filtros"
        texto="Escolha outro status ou limpe os filtros da lista e da barra."
        acao={
          <button className="yn-btn yn-btn--secondary" type="button" onClick={aoLimparTudo}>
            Limpar filtros
          </button>
        }
      />
    ) : (
      <Vazio
        titulo="Nada na lista ainda"
        texto="Registre a primeira ideia: ela entra na fila de aprovação."
      />
    );
  } else {
    // padding: 0 em linha: o .yn-card (CSS do padrão, fora das camadas do Tailwind) venceria um p-0
    conteudo = (
      <ul className="yn-card m-0 list-none" style={{ padding: 0 }} aria-labelledby="trafego-lista">
        {painel.lista.map((item) => (
          <Linha key={item.id} item={item} aoDecidir={aoDecidir} aoMarcarFeita={setMarcando} />
        ))}
      </ul>
    );
  }

  const resumo =
    painel.totalSemFiltrosDaLista === null
      ? null
      : painel.totalDaLista > MAXIMO_DA_LISTA
        ? `Mostrando ${MAXIMO_DA_LISTA} de ${painel.totalDaLista} ações. Use os filtros para achar uma.`
        : algumFiltro
          ? `${plural(painel.totalDaLista, 'ação', 'ações')} com estes filtros, de ${painel.totalSemFiltrosDaLista}.`
          : `${plural(painel.totalDaLista, 'ação', 'ações')}: primeiro o que pede decisão, depois o que está em andamento.`;

  return (
    <section className="mkt-stack min-w-0" aria-labelledby="trafego-lista">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <h2 id="trafego-lista">O que podemos fazer</h2>
          <p className="yn-muted m-0 text-sm">
            Propostas do Claude, ideias do gestor e pendências que travam a medição, com custo, impacto e
            esforço.
          </p>
        </div>
        {podeOperar ? (
          <button
            className="yn-btn yn-btn--secondary"
            type="button"
            aria-haspopup="dialog"
            onClick={() => setRegistrando(true)}
          >
            <Plus strokeWidth={1.75} aria-hidden="true" />
            Registrar ideia
          </button>
        ) : null}
      </div>

      <div className="mkt-filters min-w-0">
        <div className="yn-chips" role="group" aria-label="Filtrar a lista por status">
          {STATUS_DA_LISTA.map((s) => {
            const ligado = l.status === s;
            const n = painel.porStatus[s];
            return (
              <button
                key={s}
                className="yn-chip"
                type="button"
                aria-pressed={ligado}
                onClick={() => tela.definir({ status: ligado ? null : s })}
              >
                {rotulo('actionStatus', s)}
                {n !== null ? <span className="yn-count">{n}</span> : null}
              </button>
            );
          })}
        </div>
        <button
          className="yn-btn yn-btn--secondary"
          type="button"
          aria-haspopup="dialog"
          onClick={() => setPainelAberto(true)}
        >
          <SlidersHorizontal strokeWidth={1.75} aria-hidden="true" />
          Filtrar a lista
          {ativosDaLista ? <span className="yn-count">{ativosDaLista}</span> : null}
        </button>
        {l.impacto ? (
          <span className="yn-chip">
            Impacto: {rotulo('level', l.impacto)}
            <button
              type="button"
              aria-label="Remover filtro Impacto"
              onClick={() => tela.definir({ impacto: null })}
            >
              <X strokeWidth={1.75} aria-hidden="true" />
            </button>
          </span>
        ) : null}
        {l.esforco ? (
          <span className="yn-chip">
            Esforço: {rotulo('level', l.esforco)}
            <button
              type="button"
              aria-label="Remover filtro Esforço"
              onClick={() => tela.definir({ esforco: null })}
            >
              <X strokeWidth={1.75} aria-hidden="true" />
            </button>
          </span>
        ) : null}
        {l.status || l.impacto || l.esforco ? (
          <button
            className="yn-btn yn-btn--ghost yn-btn--sm"
            type="button"
            onClick={() => tela.definir({ status: null, impacto: null, esforco: null })}
          >
            Limpar filtros da lista
          </button>
        ) : null}
      </div>

      {resumo ? (
        <p className="yn-muted m-0 text-sm" aria-live="polite">
          {resumo}
        </p>
      ) : null}

      {conteudo}

      <PainelDeFiltros aberto={painelAberto} aoFechar={fecharPainel} tela={tela} />

      {marcando ? (
        <JanelaFeita
          item={marcando}
          aoFechar={() => setMarcando(null)}
          aoConfirmar={(resultado) => {
            marcarAcaoComoFeita(marcando.id, perfilId, resultado);
            setMarcando(null);
            avisar('Ação marcada como feita.');
          }}
        />
      ) : null}

      {registrando ? (
        <JanelaIdeia
          marcaInicial={filtros.marca === 'todas' ? null : filtros.marca}
          canalInicial={filtros.canal}
          campanhas={painel.campanhas}
          aoFechar={() => setRegistrando(false)}
          aoConfirmar={(ideia: NovaIdeia) => {
            proporAcao({
              proposedBy: 'human',
              brandId: ideia.marca,
              platform: ideia.canal,
              campaignId: ideia.campanha,
              title: ideia.titulo,
              rationale: ideia.motivo,
              kind: ideia.tipo,
              paramsJson: JSON.stringify({ origem: 'ideia registrada na central' }),
              impact: ideia.impacto,
              effort: ideia.esforco,
              costCents: ideia.custoCents,
            });
            setRegistrando(false);
            avisar(
              ideia.tipo === 'pending_fix'
                ? 'Pendência registrada.'
                : 'Ideia registrada. Ela está na fila de aprovação.',
            );
          }}
        />
      ) : null}
    </section>
  );
}

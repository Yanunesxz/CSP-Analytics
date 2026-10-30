/**
 * Barra de filtros de toda tela de números (componente, nunca rota):
 * período (padrão "Este mês", comparando com o anterior), até 5 filtros rápidos em .yn-chips,
 * botão "Filtros" que abre <dialog class="yn-drawer"> com os demais, chip de cada filtro ativo com
 * "Remover filtro X", "Limpar filtros" e "Meus filtros" salvos por nome em localStorage.
 * Tudo vive na URL (useFiltros); a barra só lê e grava.
 */

import { Bookmark, Filter, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { opcoes as opcoesDe, rotulo as rotuloDe, cor as corDe } from '@csp-mkt/shared';
import { PERIODOS } from '../../lib/periodo';
import {
  CHAVES_DE_TELA,
  FILTROS_PADRAO,
  useFiltros,
  type ChaveFiltro,
  type Filtros,
} from '../../lib/url-state';
import { PontoDeSerie } from './ChipSerie';

export type CampoFiltro = 'canal' | 'campanha' | 'operador' | 'origem' | 'representante';

export interface FiltroRapido {
  chave: CampoFiltro;
  valor: string;
  rotulo: string;
  contagem?: number | null;
  /** Token de série para o ponto colorido (canal, operador). */
  cor?: string;
}

export interface OpcaoDeFiltro {
  valor: string;
  rotulo: string;
}

export interface BarraDeFiltrosProps {
  /** Até 5; o que passar disso fica só no painel. */
  rapidos?: FiltroRapido[];
  /** Quais campos aparecem no painel "Filtros". */
  campos?: CampoFiltro[];
  /** Opções de campanha e representante vêm dos dados da tela. */
  opcoes?: { campanhas?: OpcaoDeFiltro[]; representantes?: OpcaoDeFiltro[] };
  semPeriodo?: boolean;
  semComparacao?: boolean;
}

interface FiltroSalvo {
  nome: string;
  filtros: Partial<Filtros>;
}

const CHAVE_SALVOS = 'meus-filtros';
const ROTULO_CAMPO: Record<CampoFiltro, string> = {
  canal: 'Canal',
  campanha: 'Campanha',
  operador: 'Operador',
  origem: 'Origem',
  representante: 'Representante',
};

function lerSalvos(): FiltroSalvo[] {
  try {
    const bruto = localStorage.getItem(CHAVE_SALVOS);
    const lista = bruto ? (JSON.parse(bruto) as unknown) : [];
    return Array.isArray(lista) ? (lista as FiltroSalvo[]).filter((f) => typeof f?.nome === 'string') : [];
  } catch {
    return [];
  }
}

function gravarSalvos(lista: FiltroSalvo[]): void {
  try {
    localStorage.setItem(CHAVE_SALVOS, JSON.stringify(lista));
  } catch {
    /* sem localStorage: os conjuntos valem só nesta aba */
  }
}

export function BarraDeFiltros({
  rapidos = [],
  campos = ['canal', 'operador', 'origem'],
  opcoes,
  semPeriodo = false,
  semComparacao = false,
}: BarraDeFiltrosProps) {
  const { filtros, definir, limpar, ativos } = useFiltros();
  const dialogo = useRef<HTMLDialogElement>(null);
  const idPeriodo = useId();
  const idTitulo = useId();
  const [salvos, setSalvos] = useState<FiltroSalvo[]>(() => lerSalvos());
  const [nomeNovo, setNomeNovo] = useState('');

  const abrir = useCallback(() => {
    if (dialogo.current && !dialogo.current.open) dialogo.current.showModal();
  }, []);
  const fechar = useCallback(() => dialogo.current?.close(), []);

  useEffect(() => {
    const el = dialogo.current;
    if (!el) return;
    const aoClicarFora = (e: MouseEvent) => {
      if (e.target === el) el.close();
    };
    el.addEventListener('click', aoClicarFora);
    return () => el.removeEventListener('click', aoClicarFora);
  }, []);

  const rotuloDoValor = (chave: ChaveFiltro, valor: string): string => {
    if (chave === 'canal') return rotuloDe('platform', valor);
    if (chave === 'operador') return rotuloDe('operator', valor);
    if (chave === 'origem') return rotuloDe('leadSource', valor);
    if (chave === 'campanha') return opcoes?.campanhas?.find((o) => o.valor === valor)?.rotulo ?? valor;
    if (chave === 'representante')
      return opcoes?.representantes?.find((o) => o.valor === valor)?.rotulo ?? valor;
    return valor;
  };

  const salvarAtual = () => {
    const nome = nomeNovo.trim();
    if (!nome) return;
    const conjunto: Partial<Filtros> = { periodo: filtros.periodo, comparar: filtros.comparar };
    for (const chave of CHAVES_DE_TELA) (conjunto as Record<string, unknown>)[chave] = filtros[chave];
    const lista = [...salvos.filter((s) => s.nome !== nome), { nome, filtros: conjunto }];
    setSalvos(lista);
    gravarSalvos(lista);
    setNomeNovo('');
  };

  const aplicarSalvo = (salvo: FiltroSalvo) => {
    definir({ ...salvo.filtros });
    fechar();
  };

  const excluirSalvo = (nome: string) => {
    const lista = salvos.filter((s) => s.nome !== nome);
    setSalvos(lista);
    gravarSalvos(lista);
  };

  const selecionar = (chave: CampoFiltro, valor: string) =>
    definir({ [chave]: valor || null } as Partial<Filtros>);

  return (
    <>
      <div className="mkt-filters" role="group" aria-label="Filtros">
        {!semPeriodo ? (
          <div className="mkt-filters__period">
            <label className="yn-sr-only" htmlFor={idPeriodo}>
              Período
            </label>
            <select
              id={idPeriodo}
              className="yn-input"
              value={filtros.periodo}
              onChange={(e) => definir({ periodo: e.target.value as Filtros['periodo'] })}
            >
              {PERIODOS.map((p) => (
                <option key={p.codigo} value={p.codigo}>
                  {p.rotulo}
                </option>
              ))}
            </select>
            {!semComparacao ? (
              <label className="yn-check">
                <input
                  type="checkbox"
                  role="switch"
                  className="yn-switch"
                  checked={filtros.comparar}
                  onChange={(e) => definir({ comparar: e.target.checked })}
                />
                Comparar com o anterior
              </label>
            ) : null}
          </div>
        ) : null}

        {rapidos.length > 0 ? (
          <div className="yn-chips" role="group" aria-label="Filtros rápidos">
            {rapidos.slice(0, 5).map((r) => {
              const ligado = filtros[r.chave] === r.valor;
              return (
                <button
                  key={`${r.chave}-${r.valor}`}
                  className="yn-chip"
                  type="button"
                  aria-pressed={ligado}
                  onClick={() => selecionar(r.chave, ligado ? '' : r.valor)}
                >
                  {r.cor ? <PontoDeSerie cor={r.cor} /> : null}
                  {r.rotulo}
                  {r.contagem !== undefined && r.contagem !== null ? (
                    <span className="yn-count">{r.contagem}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}

        <button className="yn-btn yn-btn--secondary" type="button" onClick={abrir} aria-haspopup="dialog">
          <Filter strokeWidth={1.75} aria-hidden="true" />
          Filtros
          {ativos.length ? <span className="yn-count">{ativos.length}</span> : null}
        </button>

        {ativos.map((chave) => {
          const valor = String(filtros[chave]);
          const rotuloCampo = ROTULO_CAMPO[chave as CampoFiltro] ?? chave;
          return (
            <span key={chave} className="yn-chip">
              {rotuloCampo}: {rotuloDoValor(chave, valor)}
              <button
                type="button"
                aria-label={`Remover filtro ${rotuloCampo}`}
                onClick={() => limpar([chave])}
              >
                <X strokeWidth={1.75} aria-hidden="true" />
              </button>
            </span>
          );
        })}

        {ativos.length ? (
          <button className="yn-btn yn-btn--ghost yn-btn--sm" type="button" onClick={() => limpar()}>
            Limpar filtros
          </button>
        ) : null}
      </div>

      <dialog className="yn-drawer" ref={dialogo} aria-labelledby={idTitulo}>
        <div className="yn-dialog__header">
          <h2 id={idTitulo}>Filtros</h2>
          <button
            className="yn-btn yn-btn--ghost yn-btn--icon"
            type="button"
            aria-label="Fechar filtros"
            onClick={fechar}
          >
            <X strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="mkt-stack">
          {campos.includes('canal') ? (
            <CampoSelect
              rotulo="Canal"
              valor={filtros.canal ?? ''}
              opcoes={opcoesDe('platform').map((o) => ({ valor: o.codigo, rotulo: o.rotulo }))}
              aoMudar={(v) => selecionar('canal', v)}
            />
          ) : null}
          {campos.includes('campanha') ? (
            <CampoSelect
              rotulo="Campanha"
              valor={filtros.campanha ?? ''}
              opcoes={opcoes?.campanhas ?? []}
              aoMudar={(v) => selecionar('campanha', v)}
            />
          ) : null}
          {campos.includes('operador') ? (
            <div className="yn-field">
              <span className="yn-label" id={`${idTitulo}-operador`}>
                Operador
              </span>
              <div className="yn-segmented" role="group" aria-labelledby={`${idTitulo}-operador`}>
                {(['todos', 'human', 'claude'] as const).map((op) => (
                  <button
                    key={op}
                    type="button"
                    aria-pressed={filtros.operador === op}
                    onClick={() => definir({ operador: op })}
                  >
                    {op === 'todos' ? 'Todos' : <PontoDeSerie cor={corDe('operator', op)} />}
                    {op === 'todos' ? null : rotuloDe('operator', op)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {campos.includes('origem') ? (
            <CampoSelect
              rotulo="Origem"
              valor={filtros.origem ?? ''}
              opcoes={opcoesDe('leadSource').map((o) => ({ valor: o.codigo, rotulo: o.rotulo }))}
              aoMudar={(v) => selecionar('origem', v)}
            />
          ) : null}
          {campos.includes('representante') ? (
            <CampoSelect
              rotulo="Representante"
              valor={filtros.representante ?? ''}
              opcoes={opcoes?.representantes ?? []}
              aoMudar={(v) => selecionar('representante', v)}
            />
          ) : null}

          <section
            className="mkt-stack"
            aria-labelledby={`${idTitulo}-salvos`}
            style={{ gap: 'var(--space-2)' }}
          >
            <h3 id={`${idTitulo}-salvos`}>Meus filtros</h3>
            {salvos.length === 0 ? (
              <p className="yn-muted text-sm">
                Nenhum conjunto salvo. Dê um nome aos filtros de agora para voltar a eles depois.
              </p>
            ) : null}
            {salvos.map((s) => (
              <div key={s.nome} className="mkt-actions" style={{ alignItems: 'center' }}>
                <button
                  className="yn-btn yn-btn--secondary yn-btn--sm"
                  type="button"
                  onClick={() => aplicarSalvo(s)}
                >
                  <Bookmark strokeWidth={1.75} aria-hidden="true" />
                  {s.nome}
                </button>
                <button
                  className="yn-btn yn-btn--ghost yn-btn--sm yn-btn--icon"
                  type="button"
                  aria-label={`Excluir filtro salvo ${s.nome}`}
                  onClick={() => excluirSalvo(s.nome)}
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
                  value={nomeNovo}
                  placeholder="Ex.: Meta do Claude"
                  onChange={(e) => setNomeNovo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      salvarAtual();
                    }
                  }}
                />
                <button
                  className="yn-btn yn-btn--secondary"
                  type="button"
                  onClick={salvarAtual}
                  disabled={!nomeNovo.trim()}
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
            onClick={() => {
              limpar();
              definir({ periodo: FILTROS_PADRAO.periodo, comparar: FILTROS_PADRAO.comparar });
            }}
          >
            Limpar filtros
          </button>
          <button className="yn-btn yn-btn--secondary" type="button" onClick={fechar}>
            Fechar
          </button>
        </div>
      </dialog>
    </>
  );
}

function CampoSelect({
  rotulo,
  valor,
  opcoes,
  aoMudar,
}: {
  rotulo: string;
  valor: string;
  opcoes: OpcaoDeFiltro[];
  aoMudar: (valor: string) => void;
}) {
  const id = useId();
  return (
    <div className="yn-field">
      <label className="yn-label" htmlFor={id}>
        {rotulo}
      </label>
      <select id={id} className="yn-input" value={valor} onChange={(e) => aoMudar(e.target.value)}>
        <option value="">Todos</option>
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
    </div>
  );
}

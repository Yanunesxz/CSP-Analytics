/**
 * Tabela por campanha do canal. A primeira coluna é a campanha inteira: nome, marca, operador
 * (Humano · Claude) e status em chips e, na visão Gestor de tráfego com papel que opera, Pausar e
 * Ajustar orçamento dentro do próprio item (lei da proximidade). Os números vêm em conjuntos, como no
 * gerenciador de anúncios — Resultado, Anúncios e (só na visão Gestor) Verba e teto —, para caber na
 * tela sem rolar de lado. O conjunto fica na URL (`?colunas=`); no celular cada campanha vira um card.
 */

import { Megaphone, Pause, SearchX, Wallet } from 'lucide-react';
import { useCallback, useId, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { rotulo, rotuloMarca, tom } from '@csp-mkt/shared';
import { Badge, ChipSerie, Tabela, Vazio, type Coluna } from '../../components/ui';
import type { CampanhaDoCanal, PainelDoCanal } from '../../data/queries/canais';
import { dinheiro, numero, percentual, plural } from '../../lib/format';
import { useFiltros } from '../../lib/url-state';
import { textoDaAcaoAberta } from './formatos';

type Conjunto = 'resultado' | 'anuncios' | 'verba';

const CONJUNTOS: ReadonlyArray<{ codigo: Conjunto; rotulo: string; soGestor?: boolean }> = [
  { codigo: 'resultado', rotulo: 'Resultado' },
  { codigo: 'anuncios', rotulo: 'Anúncios' },
  { codigo: 'verba', rotulo: 'Verba e teto', soGestor: true },
];

/** Conjunto de colunas na URL (aba da tabela, lei 13): `?colunas=anuncios|verba`; sem ele, Resultado. */
function useConjunto(gestor: boolean): [Conjunto, (conjunto: Conjunto) => void] {
  const [params, setParams] = useSearchParams();
  const bruto = params.get('colunas');
  const conjunto: Conjunto = bruto === 'anuncios' || (bruto === 'verba' && gestor) ? bruto : 'resultado';
  const definir = useCallback(
    (proximo: Conjunto) =>
      setParams(
        (atuais) => {
          const novos = new URLSearchParams(atuais);
          if (proximo === 'resultado') novos.delete('colunas');
          else novos.set('colunas', proximo);
          return novos;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [conjunto, definir];
}

type Formatar = (valor: number | null) => string;

function numerica(
  chave: string,
  titulo: string,
  pegar: (linha: CampanhaDoCanal) => number | null,
  formatar: Formatar,
): Coluna<CampanhaDoCanal> {
  return { chave, titulo, numerica: true, valor: pegar, render: (linha) => formatar(pegar(linha)) };
}

const emNumero: Formatar = (v) => numero(v);
const emDinheiro: Formatar = (v) => dinheiro(v);

/**
 * Custo com a base embaixo, em texto menor: "R$ 5.147,23" e "6 clientes novos". Custo sem a base
 * não se lê; juntos, a tabela cabe sem rolar de lado. Ordena pelo custo.
 */
function custoComBase(
  chave: string,
  titulo: string,
  pegar: (linha: CampanhaDoCanal) => number | null,
  base: (linha: CampanhaDoCanal) => number | null,
  singular: string,
  pluralForma: string,
): Coluna<CampanhaDoCanal> {
  return {
    chave,
    titulo,
    numerica: true,
    valor: pegar,
    render: (linha) => (
      <span className="inline-grid justify-items-end">
        <span>{dinheiro(pegar(linha))}</span>
        <span className="yn-muted text-xs">{plural(base(linha), singular, pluralForma)}</span>
      </span>
    ),
  };
}

/** Siglas na tabela (as do próprio pedido: CPL, CTR, CPC, CPA, ROAS); o nome inteiro fica nos KPIs. */
const COLUNAS: Record<Conjunto, Coluna<CampanhaDoCanal>[]> = {
  resultado: [
    numerica('investimento', 'Investimento', (l) => l.investimento.atual, emDinheiro),
    numerica('leads', 'Leads', (l) => l.leads.atual, emNumero),
    numerica('cpl', 'CPL', (l) => l.cpl.atual, emDinheiro),
    custoComBase(
      'custoPorClienteNovo',
      'Custo por cliente novo',
      (l) => l.custoPorClienteNovo.atual,
      (l) => l.clientesNovos.atual,
      'cliente novo',
      'clientes novos',
    ),
  ],
  anuncios: [
    numerica('impressoes', 'Impressões', (l) => l.impressoes.atual, emNumero),
    numerica('cliques', 'Cliques', (l) => l.cliques.atual, emNumero),
    numerica(
      'ctr',
      'CTR',
      (l) => l.ctr.atual,
      (v) => percentual(v, 2),
    ),
    numerica('cpc', 'CPC', (l) => l.cpc.atual, emDinheiro),
    custoComBase(
      'cpa',
      'CPA',
      (l) => l.cpa.atual,
      (l) => l.conversoes.atual,
      'conversão',
      'conversões',
    ),
    numerica(
      'roas',
      'ROAS',
      (l) => l.roas.atual,
      (v) => numero(v, 2),
    ),
  ],
  verba: [
    numerica('verbaDiaria', 'Verba diária', (l) => l.campanha.dailyBudgetCents, emDinheiro),
    numerica('teto', 'Teto de gasto', (l) => l.campanha.spendCapCents, emDinheiro),
    numerica('investimento', 'Investido', (l) => l.investimento.atual, emDinheiro),
    {
      chave: 'usoDoTeto',
      titulo: 'Uso do teto',
      numerica: true,
      valor: (l) => l.usoDoTeto,
      render: (l) =>
        l.usoDoTeto !== null && l.usoDoTeto >= 0.9 ? (
          <span className="font-semibold text-tone-warning">{percentual(l.usoDoTeto, 0)}</span>
        ) : (
          percentual(l.usoDoTeto, 0)
        ),
    },
  ],
};

interface CelulaProps {
  linha: CampanhaDoCanal;
  comMarca: boolean;
  gestor: boolean;
  comAcoes: boolean;
  aoPausar: (linha: CampanhaDoCanal) => void;
  aoAjustar: (linha: CampanhaDoCanal) => void;
}

/** Nome, chips (marca, operador, status, ação já decidida) e, no Gestor, as ações da campanha. */
function CelulaDaCampanha({ linha, comMarca, gestor, comAcoes, aoPausar, aoAjustar }: CelulaProps) {
  const c = linha.campanha;
  const ativa = c.status === 'active';
  const travada = linha.acoesAbertas.length > 0;
  const dica = travada
    ? 'Já há uma ação aprovada para esta campanha. Acompanhe em Tráfego com IA.'
    : undefined;
  return (
    <div className="grid min-w-40 gap-2 whitespace-normal">
      <span>{c.name}</span>
      <span className="flex flex-wrap items-center gap-1">
        {comMarca ? <ChipSerie lista="brand" codigo={c.brandId} /> : null}
        <ChipSerie lista="operator" codigo={c.managedBy} />
        <Badge lista="campaignStatus" codigo={c.status} />
        {gestor
          ? linha.acoesAbertas.map((a) => (
              <Badge key={a.id} tom={tom('actionStatus', a.status)}>
                {textoDaAcaoAberta(a)}
              </Badge>
            ))
          : null}
      </span>
      {comAcoes && ativa ? (
        <span className="flex flex-wrap gap-2">
          <button
            className="yn-btn yn-btn--secondary yn-btn--sm"
            type="button"
            disabled={travada}
            title={dica}
            aria-label={`Pausar ${c.name}`}
            onClick={() => aoPausar(linha)}
          >
            <Pause strokeWidth={1.75} aria-hidden="true" />
            Pausar
          </button>
          <button
            className="yn-btn yn-btn--secondary yn-btn--sm"
            type="button"
            disabled={travada}
            title={dica}
            aria-label={`Ajustar orçamento de ${c.name}`}
            onClick={() => aoAjustar(linha)}
          >
            <Wallet strokeWidth={1.75} aria-hidden="true" />
            Ajustar orçamento
          </button>
        </span>
      ) : null}
    </div>
  );
}

export interface TabelaDeCampanhasProps {
  painel: PainelDoCanal;
  estado: 'ok' | 'sem-dados';
  gestor: boolean;
  /** Mostra Pausar e Ajustar orçamento (visão Gestor de tráfego e papel que opera). */
  comAcoes: boolean;
  /** O papel vê Conectores (`ver_conectores`): o vazio leva até lá. */
  verConectores: boolean;
  aoPausar: (linha: CampanhaDoCanal) => void;
  aoAjustar: (linha: CampanhaDoCanal) => void;
}

export function TabelaDeCampanhas({
  painel,
  estado,
  gestor,
  comAcoes,
  verConectores,
  aoPausar,
  aoAjustar,
}: TabelaDeCampanhasProps) {
  const { filtros, ativos, limpar, linkCom } = useFiltros();
  const [conjunto, definirConjunto] = useConjunto(gestor);
  const idTitulo = useId();
  const nome = rotulo('platform', painel.plataforma);
  const comMarca = filtros.marca === 'todas';

  const colunas = useMemo<Coluna<CampanhaDoCanal>[]>(
    () => [
      {
        chave: 'campanha',
        titulo: 'Campanha',
        valor: (l) => l.campanha.name,
        render: (l) => (
          <CelulaDaCampanha
            linha={l}
            comMarca={comMarca}
            gestor={gestor}
            comAcoes={comAcoes}
            aoPausar={aoPausar}
            aoAjustar={aoAjustar}
          />
        ),
      },
      ...COLUNAS[conjunto],
    ],
    [comMarca, gestor, comAcoes, conjunto, aoPausar, aoAjustar],
  );

  const vazio =
    estado === 'sem-dados' ? (
      <div className="yn-card">
        <Vazio icone={Megaphone} titulo="Sem dados" texto="Nenhum número de campanha no período." />
      </div>
    ) : ativos.length > 0 ? (
      <div className="yn-card">
        <Vazio
          icone={SearchX}
          titulo="Nenhuma campanha com esses filtros"
          texto="Limpe os filtros para ver todas as campanhas do canal."
          acao={
            <button className="yn-btn yn-btn--secondary" type="button" onClick={() => limpar()}>
              Limpar filtros
            </button>
          }
        />
      </div>
    ) : (
      <div className="yn-card">
        <Vazio
          icone={Megaphone}
          titulo={`Nenhuma campanha de ${nome}${comMarca ? '' : ` em ${rotuloMarca(filtros.marca)}`}`}
          texto="Quando o conector trouxer campanhas, elas aparecem aqui."
          acao={
            verConectores ? (
              <Link className="yn-btn yn-btn--secondary" to={linkCom('/conectores')}>
                Ver conectores
              </Link>
            ) : undefined
          }
        />
      </div>
    );

  return (
    <section className="grid gap-4" aria-labelledby={idTitulo}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={idTitulo}>Campanhas</h2>
          <p className="yn-muted text-sm">
            {estado === 'sem-dados' ? 'Sem dados' : plural(painel.campanhas.length, 'campanha', 'campanhas')}{' '}
            · {painel.intervalo.rotulo}
          </p>
        </div>
        <div className="yn-segmented" role="group" aria-label="Colunas da tabela">
          {CONJUNTOS.filter((c) => gestor || !c.soGestor).map((c) => (
            <button
              key={c.codigo}
              type="button"
              aria-pressed={conjunto === c.codigo}
              onClick={() => definirConjunto(c.codigo)}
            >
              {c.rotulo}
            </button>
          ))}
        </div>
      </div>
      <Tabela
        colunas={colunas}
        linhas={painel.campanhas}
        chaveDaLinha={(l) => l.campanha.id}
        empilhar
        ordenacaoInicial={{ chave: 'investimento', direcao: 'desc' }}
        legenda={`Campanhas de ${nome}`}
        vazio={vazio}
      />
    </section>
  );
}

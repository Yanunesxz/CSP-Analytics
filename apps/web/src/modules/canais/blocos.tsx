/**
 * Blocos de leitura da tela de canal, iguais nas duas visões: aviso do conector, KPIs com o período
 * anterior e os gráficos de investimento e leads por dia, por operador.
 */

import { ClockAlert, Unplug } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { cor, rotulo } from '@csp-mkt/shared';
import { GraficoLinha, Kpi, type SerieLinha } from '../../components/ui';
import type { ConectorComAtraso } from '../../data/queries';
import type { PainelDoCanal } from '../../data/queries/canais';
import { dataHora, dinheiro, numeroAbreviado } from '../../lib/format';
import { useFiltros } from '../../lib/url-state';
import { ANCORA_DO_CUSTO } from '../../rotas';
import { duracao } from './formatos';

type EstadoDaTela = 'ok' | 'sem-dados';

/* ---------- Aviso do conector da plataforma ---------- */

export function AvisoDoConector({
  conector,
  nome,
  verConectores,
}: {
  conector: ConectorComAtraso | null;
  nome: string;
  /** O papel vê Conectores (`ver_conectores`): mostra o link. */
  verConectores: boolean;
}) {
  const { linkCom } = useFiltros();
  if (!conector) return null;
  const caido = conector.status === 'down';
  if (!caido && !conector.atrasado) return null;

  const texto = caido
    ? conector.lastSyncAt
      ? `Sem sincronizar desde ${dataHora(conector.lastSyncAt)}. Os números desta tela param aí.`
      : 'Ainda não sincronizou. Os números desta tela não chegaram.'
    : `A última sincronização foi há ${duracao(conector.minutosDesdeSync ?? 0)}; o esperado é a cada ${duracao(
        conector.expectedEveryMinutes,
      )}. Os números podem estar defasados.`;

  return (
    <div className="yn-alert" data-tone={caido ? 'danger' : 'warning'} role="status">
      {caido ? (
        <Unplug strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <ClockAlert strokeWidth={1.75} aria-hidden="true" />
      )}
      <div>
        <strong className="yn-alert__title">
          {caido ? `Conector de ${nome} caído` : `Conector de ${nome} atrasado`}
        </strong>
        {texto}
        {verConectores ? (
          <>
            {' '}
            <Link to={linkCom('/conectores')} className="font-medium">
              Ver conectores
            </Link>
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- KPIs ---------- */

export function KpisDoCanal({
  painel,
  estado,
  nome,
}: {
  painel: PainelDoCanal;
  estado: EstadoDaTela;
  nome: string;
}) {
  const { filtros } = useFiltros();
  const t = painel.totais;
  // Com "Comparar com o anterior" desligado, nenhum texto fala do período anterior
  const delta = filtros.comparar ? painel.intervalo.rotuloAnterior : undefined;
  const canal = { canal: painel.plataforma };
  return (
    <div className="grid gap-3">
      <div className="mkt-grid-kpis">
        <Kpi rotulo="Investimento" metrica={t.investimento} formato="dinheiro" deltaTexto={delta} />
        <Kpi
          rotulo="Leads"
          metrica={t.leads}
          deltaTexto={delta}
          para="/leads"
          paraFiltros={{ origem: painel.plataforma }}
        />
        <Kpi
          rotulo="Custo por lead (CPL)"
          metrica={t.cpl}
          formato="dinheiro"
          menorEhMelhor
          deltaTexto={delta}
        />
        <Kpi
          rotulo="Custo por cliente novo"
          metrica={t.custoPorClienteNovo}
          formato="dinheiro"
          menorEhMelhor
          deltaTexto={delta}
          para={`/chegada#${ANCORA_DO_CUSTO}`}
          paraFiltros={canal}
        />
        <Kpi
          rotulo="Clientes novos"
          metrica={t.clientesNovos}
          deltaTexto={delta}
          para="/chegada"
          paraFiltros={canal}
        />
        <Kpi
          rotulo="ROAS"
          metrica={t.roas}
          formato="decimal"
          casas={2}
          deltaTexto={delta}
          nota={estado === 'ok' && t.roas.atual === null ? 'Sem receita atribuída às campanhas' : undefined}
        />
        <Kpi rotulo="Conversões" metrica={t.conversoes} deltaTexto={delta} />
        <Kpi
          rotulo="Custo por conversão (CPA)"
          metrica={t.cpa}
          formato="dinheiro"
          menorEhMelhor
          deltaTexto={delta}
        />
        <Kpi rotulo="Impressões" metrica={t.impressoes} formato="abreviado" deltaTexto={delta} />
        <Kpi rotulo="Cliques" metrica={t.cliques} deltaTexto={delta} />
        <Kpi
          rotulo="Taxa de cliques (CTR)"
          metrica={t.ctr}
          formato="percentual"
          casas={2}
          deltaTexto={delta}
        />
        <Kpi
          rotulo="Custo por clique (CPC)"
          metrica={t.cpc}
          formato="dinheiro"
          menorEhMelhor
          deltaTexto={delta}
        />
      </div>
      <p className="yn-muted text-sm">
        Leads, conversões e receita são os que o {nome} informa. Clientes novos vêm do CSP 360, pela UTM da
        campanha.
      </p>
    </div>
  );
}

/* ---------- Gráficos ---------- */

export function GraficosDoCanal({ painel, estado }: { painel: PainelDoCanal; estado: EstadoDaTela }) {
  const series = useMemo(() => {
    const montar = (campo: 'investimento' | 'leads'): SerieLinha[] =>
      painel.series.map((s) => ({
        id: s.operador,
        rotulo: rotulo('operator', s.operador),
        cor: cor('operator', s.operador),
        pontos: s.pontos.map((p) => ({ x: p.date, y: p[campo] })),
      }));
    return { investimento: montar('investimento'), leads: montar('leads') };
  }, [painel.series]);

  const estadoDoGrafico = estado === 'sem-dados' ? 'semDados' : 'ok';
  const periodo = painel.intervalo.rotulo;

  return (
    <div className="mkt-grid-2">
      <GraficoLinha
        titulo="Investimento por dia"
        descricao={`Em reais, por operador · ${periodo}`}
        series={series.investimento}
        formato={(v) => dinheiro(v)}
        formatoEixo={(v) => numeroAbreviado(v / 100)}
        estado={estadoDoGrafico}
      />
      <GraficoLinha
        titulo="Leads por dia"
        descricao={`Informados pela plataforma, por operador · ${periodo}`}
        series={series.leads}
        estado={estadoDoGrafico}
      />
    </div>
  );
}

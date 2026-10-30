/**
 * Chegada de clientes (/chegada): como os leads viram cliente novo e quanto isso custa.
 *
 * - KPIs do período com as mesmas contas da Visão geral;
 * - custo por cliente novo por marca e canal, comparado ao período anterior (tarefa principal T1);
 * - na visão Gestor de tráfego, Humano × Claude nas contas de cliente novo;
 * - funil lead → prospecto → cadastro → 1º pedido enviado → faturado (decisão 0012);
 * - quebras por origem (UTM e, sem UTM, referrer), marca, mês de chegada (coorte) e representante.
 *
 * Toda conta vem de `data/queries/chegada-de-clientes.ts`; filtros e estado de demonstração, da URL.
 */

import { Inbox } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cor, rotulo, type LeadSource } from '@csp-mkt/shared';
import { PageHeader } from '../../components/layout/pagina';
import {
  BarraDeFiltros,
  GraficoBarras,
  Kpi,
  Tela,
  type CampoFiltro,
  type FiltroRapido,
} from '../../components/ui';
import {
  chegadaDeClientes,
  type ChegadaDeClientes as Chegada,
  type MotivoSemCusto,
} from '../../data/queries/chegada-de-clientes';
import { useConsulta } from '../../data/store';
import { numero, percentual, plural } from '../../lib/format';
import { useFiltros } from '../../lib/url-state';
import { Coorte } from './Coorte';
import { CustoPorMarcaECanal, ID_CUSTO } from './CustoPorMarcaECanal';
import { Funil } from './Funil';
import { HumanoXClaude } from './HumanoXClaude';
import { PorMarca } from './PorMarca';
import { PorRepresentante } from './PorRepresentante';

/** Origens que mais pesam na chegada: viram chips rápidos; as outras ficam no painel "Filtros". */
const ORIGENS_RAPIDAS: readonly LeadSource[] = ['meta', 'google', 'tiktok', 'organic', 'ai_assistant'];

const RAPIDOS: FiltroRapido[] = ORIGENS_RAPIDAS.map((origem) => ({
  chave: 'origem',
  valor: origem,
  rotulo: rotulo('leadSource', origem),
  cor: cor('leadSource', origem),
}));

const CAMPOS: CampoFiltro[] = ['origem', 'canal', 'campanha', 'operador', 'representante'];

const NOTA_SEM_CUSTO: Record<MotivoSemCusto, string> = {
  representante: 'O investimento é por campanha, não por representante.',
  origem: 'Só canal pago tem investimento.',
};

export default function ChegadaDeClientes() {
  const r = useConsulta(chegadaDeClientes);
  const { filtros, ativos, limpar, linkCom } = useFiltros();
  const { hash } = useLocation();

  // "Ver leads" leva os filtros desta tela para a lista de leads.
  const paraLeads = linkCom('/leads', {
    origem: filtros.origem,
    canal: filtros.canal,
    campanha: filtros.campanha,
    operador: filtros.operador,
    representante: filtros.representante,
  });
  const acao = useMemo(
    () => (
      <Link className="yn-btn yn-btn--primary" to={paraLeads}>
        <Inbox strokeWidth={1.75} aria-hidden="true" />
        Ver leads
      </Link>
    ),
    [paraLeads],
  );

  // /chegada#custo-por-cliente-novo abre direto no custo por marca e canal (tarefa T1).
  const pronta = r.estado === 'ok' || r.estado === 'sem-dados';
  useEffect(() => {
    if (pronta && hash === `#${ID_CUSTO}`)
      document.getElementById(ID_CUSTO)?.scrollIntoView({ block: 'start' });
  }, [pronta, hash]);

  return (
    <>
      <PageHeader grupo="Clientes" titulo="Chegada de clientes" acao={acao} atualizadoEm={r.atualizadoEm} />
      {/* min-w-0: a linha de chips não pode alargar a grade do .yn-content no celular */}
      <div className="min-w-0">
        <BarraDeFiltros rapidos={RAPIDOS} campos={CAMPOS} opcoes={r.dados?.opcoes} />
      </div>
      <Tela
        resultado={r}
        vazio={{
          titulo: 'Nenhum lead ainda',
          texto: 'Os leads chegam do CSP 360 pelo conector. Veja se ele está ligado em Conectores.',
        }}
      >
        {(c, estado) => (
          <Conteudo
            c={c}
            semDados={estado === 'sem-dados'}
            gestor={filtros.visao === 'gestor'}
            comparar={filtros.comparar}
            temFiltros={ativos.length > 0}
            aoLimparFiltros={() => limpar()}
            aoTirarFiltro={(motivo) => limpar([motivo])}
          />
        )}
      </Tela>
    </>
  );
}

interface ConteudoProps {
  c: Chegada;
  semDados: boolean;
  gestor: boolean;
  comparar: boolean;
  temFiltros: boolean;
  aoLimparFiltros: () => void;
  aoTirarFiltro: (motivo: MotivoSemCusto) => void;
}

function Conteudo({
  c,
  semDados,
  gestor,
  comparar,
  temFiltros,
  aoLimparFiltros,
  aoTirarFiltro,
}: ConteudoProps) {
  const anterior = comparar ? c.intervalo.rotuloAnterior : undefined;
  const estadoDoGrafico = semDados ? 'semDados' : 'ok';

  return (
    <>
      <div className="mkt-grid-kpis">
        <Kpi rotulo="Leads" metrica={c.leads} deltaTexto={anterior} />
        <Kpi rotulo="Clientes novos" metrica={c.clientesNovos} deltaTexto={anterior} />
        <Kpi
          rotulo="Leads que viraram cliente"
          metrica={c.conversao}
          formato="percentual"
          deltaTexto={anterior}
        />
        {c.motivoSemCusto ? (
          <Kpi
            rotulo="Custo por cliente novo"
            valor={null}
            semDadosTexto="Não se aplica"
            nota={NOTA_SEM_CUSTO[c.motivoSemCusto]}
          />
        ) : (
          <Kpi
            rotulo="Custo por cliente novo"
            metrica={c.custoPorClienteNovo}
            formato="dinheiro"
            menorEhMelhor
            deltaTexto={anterior}
          />
        )}
      </div>

      <CustoPorMarcaECanal
        custo={c.custo}
        motivo={c.motivoSemCusto}
        rotuloAnterior={anterior ?? null}
        semDados={semDados}
        aoTirarFiltro={aoTirarFiltro}
      />

      {gestor && c.operador ? <HumanoXClaude linhas={c.operador} semDados={semDados} /> : null}

      <Funil
        funil={c.funil}
        semDados={semDados}
        comparar={comparar}
        temFiltros={temFiltros}
        aoLimparFiltros={aoLimparFiltros}
      />

      {/* grid-cols-1 nos gráficos: a tabela de "Ver como tabela" rola dentro do card no celular */}
      <div className="mkt-grid-2 [&_.mkt-chart]:grid-cols-1">
        <GraficoBarras
          titulo="Leads por origem"
          descricao="Pela UTM do anúncio; sem UTM, pelo site de onde o lead veio (busca orgânica, assistente de IA)."
          itens={c.porOrigem.map((o) => ({
            rotulo: rotulo('leadSource', o.origem),
            valor: o.leads,
            cor: cor('leadSource', o.origem),
            detalhe: plural(o.viraramCliente, 'virou cliente', 'viraram cliente'),
          }))}
          rotuloValor="Leads"
          estado={estadoDoGrafico}
        />
        <GraficoBarras
          titulo="Conversão em cliente por origem"
          descricao="Quantos leads de cada origem já fizeram o 1º pedido enviado."
          itens={c.porOrigem.map((o) => ({
            rotulo: rotulo('leadSource', o.origem),
            valor: o.conversao,
            cor: cor('leadSource', o.origem),
            detalhe: `${numero(o.viraramCliente)} de ${plural(o.leads, 'lead', 'leads')}`,
          }))}
          formato={(v) => percentual(v)}
          rotuloValor="Conversão"
          estado={estadoDoGrafico}
        />
      </div>

      {c.porMarca.length > 0 ? (
        <PorMarca linhas={c.porMarca} semMarca={c.funil.semMarca} semDados={semDados} />
      ) : null}

      <Coorte meses={c.coorte} semDados={semDados} />

      <PorRepresentante
        linhas={c.porRepresentante}
        semRepresentante={c.semRepresentante}
        semDados={semDados}
      />
    </>
  );
}

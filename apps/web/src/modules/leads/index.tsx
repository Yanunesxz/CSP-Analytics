/**
 * Leads (rota /leads): de onde chegam os leads, por marca, origem, dia e campanha, e a lista sem dado
 * pessoal com o link para a ficha 360 no CSP 360. Os números vêm prontos de `painelDeLeads`
 * (src/data/queries/leads.ts); a tela só desenha.
 *
 * - Os filtros da barra (período, origem, canal, campanha, operador, representante) valem para a tela
 *   toda; os chips de etapa (`?etapa=`) filtram só a lista. Tudo na URL.
 * - Visão Gestor de tráfego: acrescenta Humano × Claude e as colunas Operador e Investimento por campanha.
 * - Ação principal: abrir o funil de leads no CSP 360, onde a equipe trabalha cada lead (a v1 só lê).
 */

import { ExternalLink, UsersRound } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cor, type LeadStage } from '@csp-mkt/shared';
import { PageHeader } from '../../components/layout/pagina';
import {
  BarraDeFiltros,
  GraficoBarras,
  GraficoLinha,
  Kpi,
  Tela,
  type CampoFiltro,
  type EstadoGrafico,
  type FiltroRapido,
  type ItemBarra,
  type SerieLinha,
} from '../../components/ui';
import type { Dados } from '../../data/dados';
import { etapaDaUrl, painelDeLeads, URL_CRM_LEADS, type PainelDeLeads } from '../../data/queries/leads';
import { useConsulta } from '../../data/store';
import { CHAVES_DE_TELA, escreverFiltros, useFiltros, type Filtros } from '../../lib/url-state';
import { HumanoXClaude } from './HumanoXClaude';
import { ListaDeLeads } from './ListaDeLeads';
import { TabelaDeCampanhas } from './TabelaDeCampanhas';
import { corDaMarcaDoLead, detalheDeConversao, NOTA_SEM_CUSTO, notaDeConversao } from './textos';

const CAMPOS: CampoFiltro[] = ['canal', 'campanha', 'origem', 'representante'];
const CAMPOS_DO_GESTOR: CampoFiltro[] = ['canal', 'campanha', 'operador', 'origem', 'representante'];

const VAZIO = {
  icone: UsersRound,
  titulo: 'Nenhum lead ainda',
  texto: 'Os leads chegam do CSP 360 a cada 5 minutos. Veja em Conectores se o CSP 360 está funcionando.',
};

/** `?etapa=` da lista: lê, troca e limpa junto com os filtros da barra, numa gravação só na URL. */
function useEtapaDaLista() {
  const [params, setParams] = useSearchParams();
  const etapa = etapaDaUrl(params.get('etapa'));

  const definir = useCallback(
    (proxima: LeadStage | null) =>
      setParams(
        (atuais) => {
          const proximos = new URLSearchParams(atuais);
          if (proxima) proximos.set('etapa', proxima);
          else proximos.delete('etapa');
          return proximos;
        },
        { replace: true },
      ),
    [setParams],
  );

  const limparTudo = useCallback(
    () =>
      setParams(
        (atuais) => {
          const semFiltros = Object.fromEntries(
            CHAVES_DE_TELA.map((chave) => [chave, null]),
          ) as Partial<Filtros>;
          const proximos = escreverFiltros(atuais, semFiltros);
          proximos.delete('etapa');
          return proximos;
        },
        { replace: true },
      ),
    [setParams],
  );

  return { etapa, definir, limparTudo };
}

export default function Leads() {
  const { etapa, definir: definirEtapa, limparTudo } = useEtapaDaLista();
  const consulta = useCallback(
    (dados: Dados, filtros: Filtros, agora: Date) => painelDeLeads(dados, filtros, agora, { etapa }),
    [etapa],
  );
  const r = useConsulta(consulta);
  const gestor = r.filtros.visao === 'gestor';

  const acao = useMemo(
    () => (
      <a
        className="yn-btn yn-btn--primary"
        href={URL_CRM_LEADS}
        target="_blank"
        rel="noopener noreferrer"
        title="Abre o funil de leads do CSP 360 em outra aba"
      >
        <ExternalLink strokeWidth={1.75} aria-hidden="true" />
        Abrir funil no CSP 360
      </a>
    ),
    [],
  );

  const rapidos = useMemo<FiltroRapido[]>(
    () =>
      (r.dados?.chipsDeOrigem ?? []).map((c) => ({
        chave: 'origem',
        valor: c.origem,
        rotulo: c.rotulo,
        contagem: c.leads,
        cor: cor('leadSource', c.origem),
      })),
    [r.dados],
  );

  return (
    <>
      <PageHeader grupo="Clientes" titulo="Leads" acao={acao} atualizadoEm={r.atualizadoEm} />
      {/* min-w-0: sem ele, a fila de chips (que não quebra no celular) alarga a grade do .yn-content
          e a página rola de lado em 375px. Correção de raiz pendente na fundação (.mkt-filters). */}
      <div className="min-w-0">
        <BarraDeFiltros
          rapidos={rapidos}
          campos={gestor ? CAMPOS_DO_GESTOR : CAMPOS}
          opcoes={r.dados?.opcoesDeFiltro}
        />
      </div>
      <Tela resultado={r} vazio={VAZIO}>
        {(painel, estado) => (
          <Painel
            painel={painel}
            semDados={estado === 'sem-dados'}
            gestor={gestor}
            comparar={r.filtros.comparar}
            aoMudarEtapa={definirEtapa}
            aoLimpar={limparTudo}
          />
        )}
      </Tela>
    </>
  );
}

interface PainelProps {
  painel: PainelDeLeads;
  semDados: boolean;
  gestor: boolean;
  comparar: boolean;
  aoMudarEtapa: (etapa: LeadStage | null) => void;
  aoLimpar: () => void;
}

function Painel({ painel: p, semDados, gestor, comparar, aoMudarEtapa, aoLimpar }: PainelProps) {
  const { filtros } = useFiltros();
  const estadoDosGraficos: EstadoGrafico = semDados ? 'semDados' : 'ok';
  // A Chegada de clientes filtra pelos mesmos campos: o link leva o recorte junto (como o "Ver leads" de lá)
  const recorte: Partial<Filtros> = {
    origem: filtros.origem,
    canal: filtros.canal,
    campanha: filtros.campanha,
    operador: filtros.operador,
    representante: filtros.representante,
  };
  // Com "Comparar com o anterior" desligado, nenhum texto fala do período anterior
  const deltaTexto = comparar ? p.intervalo.rotuloAnterior : undefined;

  // Sem dados, o gráfico mostra só o aviso, sem legenda.
  const series: SerieLinha[] = semDados
    ? []
    : p.porMarca.map((m) => ({
        id: m.chave,
        rotulo: m.rotulo,
        cor: corDaMarcaDoLead(m.marca),
        pontos: p.porDia.map((d) => ({ x: d.date, y: d.porMarca[m.chave] })),
      }));

  const porOrigem: ItemBarra[] = p.porOrigem.map((o) => ({
    rotulo: o.rotulo,
    valor: o.leads.atual,
    cor: cor('leadSource', o.origem),
    detalhe: detalheDeConversao(o),
  }));

  const porMarca: ItemBarra[] = p.porMarca.map((m) => ({
    rotulo: m.rotulo,
    valor: m.leads.atual,
    cor: corDaMarcaDoLead(m.marca),
    detalhe: detalheDeConversao(m),
  }));

  return (
    <>
      <div className="mkt-grid-kpis" role="group" aria-label="Indicadores de leads">
        <Kpi rotulo="Leads" metrica={p.total} deltaTexto={deltaTexto} />
        {/* Sem delta de propósito: os leads do período ainda estão comprando, e os do período anterior
            tiveram mais tempo; a comparação acusaria uma queda que não existe (docs/telas/leads.md). */}
        <Kpi
          rotulo="Lead → cliente novo"
          valor={p.taxaConversao.atual}
          formato="percentual"
          nota={notaDeConversao(p.viraramCliente.atual, p.total.atual)}
          para="/chegada"
          paraFiltros={recorte}
        />
        <Kpi
          rotulo="Custo por lead"
          metrica={p.custoPorLead}
          formato="dinheiro"
          menorEhMelhor
          deltaTexto={deltaTexto}
          semDadosTexto={p.custoNaoSeAplica ? 'Não se aplica' : undefined}
          nota={p.custoNaoSeAplica ? NOTA_SEM_CUSTO[p.custoNaoSeAplica] : undefined}
        />
        <Kpi
          rotulo="Sem marca · WhatsApp"
          metrica={p.semMarca}
          deltaTexto={deltaTexto}
          nota="Leads do SDR, contados nas duas marcas"
        />
      </div>

      <GraficoLinha
        titulo="Leads por dia"
        descricao="Por marca. O lead do SDR chega sem marca e aparece como Sem marca · WhatsApp."
        series={series}
        estado={estadoDosGraficos}
      />

      <div className="mkt-grid-2">
        <GraficoBarras
          titulo="Leads por origem"
          descricao="Anúncio pela UTM; site, busca orgânica e assistente de IA pelo endereço de onde a pessoa veio."
          itens={porOrigem}
          rotuloValor="Leads"
          estado={estadoDosGraficos}
        />
        <GraficoBarras
          titulo="Leads por marca"
          descricao="Quantos leads chegaram para cada marca e quantos já viraram cliente."
          itens={porMarca}
          rotuloValor="Leads"
          estado={estadoDosGraficos}
        />
      </div>

      <TabelaDeCampanhas linhas={p.porCampanha} gestor={gestor} comparar={comparar} semDados={semDados} />

      {gestor ? <HumanoXClaude linhas={p.porOperador} /> : null}

      <ListaDeLeads painel={p} semDados={semDados} aoMudarEtapa={aoMudarEtapa} aoLimpar={aoLimpar} />
    </>
  );
}

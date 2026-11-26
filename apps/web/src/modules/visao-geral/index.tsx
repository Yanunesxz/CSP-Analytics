/**
 * Visão geral (rota /, tarefa T1): quanto custou cada cliente novo, por marca e por canal, neste
 * mês comparado ao anterior — sem tocar em nada. Indicadores do período levando à tela que
 * trabalha cada número, custo por marca e por canal, e os gráficos de custo por canal e de
 * leads × clientes novos por dia.
 *
 * Visão Gestor de tráfego (?visao=gestor): acrescenta, depois do custo por marca e por canal,
 * Humano × Claude, verba e limite de gasto por conta e o botão principal "Abrir Tráfego com IA"
 * (só para quem pode ver Tráfego com IA).
 * A Visão muda o que a tela mostra; o papel decide o que a pessoa pode fazer.
 */

import { Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { opcoes, pode, type ApiKpiOverview } from '@csp-mkt/shared';
import { PageHeader } from '../../components/layout/pagina';
import { BarraDeFiltros, Tela, type FiltroRapido } from '../../components/ui';
import { useConsultaDaApi, type ConsultaDaApi } from '../../data/api';
import { visaoGeral, type VisaoGeral as Painel } from '../../data/queries/visao-geral';
import { visaoGeralDaApi } from '../../data/queries/visao-geral-api';
import { useConsulta } from '../../data/store';
import { modoDeAcesso, useSessao } from '../../lib/auth';
import { plural } from '../../lib/format';
import { useFiltros } from '../../lib/url-state';
import { CustoPorMarcaECanal } from './CustoPorMarcaECanal';
import { Graficos } from './Graficos';
import { HumanoXClaude } from './HumanoXClaude';
import { JaChega } from './JaChega';
import { Numeros } from './Numeros';
import { VerbaELimite } from './VerbaELimite';

const RAPIDOS_DE_CANAL: FiltroRapido[] = opcoes('platform').map((o) => ({
  chave: 'canal',
  valor: o.codigo,
  rotulo: o.rotulo,
  cor: o.cor,
}));

const RAPIDOS_DE_OPERADOR: FiltroRapido[] = opcoes('operator').map((o) => ({
  chave: 'operador',
  valor: o.codigo,
  rotulo: o.rotulo,
  cor: o.cor,
}));

const RAPIDOS_DO_GESTOR = [...RAPIDOS_DE_CANAL, ...RAPIDOS_DE_OPERADOR];

/** Modo Supabase: o painel vem de api.kpi_overview (por enquanto, só a mídia). */
function useDoBanco(): ConsultaDaApi<Painel> {
  return useConsultaDaApi('kpi_overview', visaoGeralDaApi, (r: ApiKpiOverview) => r.updated_at);
}

/** Modo demonstração: a consulta pura sobre o store. */
function useDaDemonstracao(): ConsultaDaApi<Painel> {
  return { resultado: useConsulta(visaoGeral), recarregar: () => undefined };
}

// O modo não muda com a página aberta: a escolha é feita uma vez, fora do componente.
const DO_BANCO = modoDeAcesso() === 'supabase';
const usePainel = DO_BANCO ? useDoBanco : useDaDemonstracao;

export default function VisaoGeral() {
  const { resultado, recarregar } = usePainel();
  const { filtros, linkCom } = useFiltros();
  const { perfil } = useSessao();
  const gestor = filtros.visao === 'gestor';

  const paraTrafego =
    gestor && pode(perfil?.role, 'ver_trafego_ia')
      ? linkCom('/trafego', { canal: filtros.canal, operador: filtros.operador })
      : null;
  const naFila = resultado.dados?.gestor?.propostasNaFila ?? null;
  // No banco, enquanto nada de mídia nem do CSP 360 chega, a tela mostra o que já chega (o site) e o que falta.
  const soOSite = DO_BANCO && resultado.estado === 'vazio' && !filtros.estado;

  const acao = useMemo(
    () =>
      paraTrafego ? (
        <Link className="yn-btn yn-btn--primary" to={paraTrafego}>
          <Sparkles strokeWidth={1.75} aria-hidden="true" />
          Abrir Tráfego com IA
          {naFila ? (
            <>
              <span className="yn-count" aria-hidden="true">
                {naFila}
              </span>
              <span className="yn-sr-only">
                , {plural(naFila, 'proposta esperando aprovação', 'propostas esperando aprovação')}
              </span>
            </>
          ) : null}
        </Link>
      ) : undefined,
    [paraTrafego, naFila],
  );

  return (
    <>
      <PageHeader grupo="Início" titulo="Visão geral" acao={acao} atualizadoEm={resultado.atualizadoEm} />
      <BarraDeFiltros
        rapidos={gestor ? RAPIDOS_DO_GESTOR : RAPIDOS_DE_CANAL}
        campos={['canal', 'operador']}
      />
      {soOSite ? (
        <JaChega comMidia={false} />
      ) : (
        <Tela
          resultado={resultado}
          aoTentarDeNovo={DO_BANCO && !filtros.estado ? recarregar : undefined}
          vazio={{
            titulo: 'Nenhum número ainda',
            texto:
              'Os números aparecem quando os conectores trazem os primeiros dados. Veja o que falta ligar em Conectores.',
          }}
        >
          {(v, estado) => (
            <>
              <Numeros v={v} filtros={resultado.filtros} />
              {/* T1 (custo por marca e por canal) logo depois dos números, nas duas visões */}
              <CustoPorMarcaECanal
                porMarca={v.porMarca}
                porCanal={v.porCanal}
                intervalo={v.intervalo}
                filtros={resultado.filtros}
              />
              {v.gestor ? (
                <>
                  <HumanoXClaude linhas={v.gestor.humanoClaude} />
                  <VerbaELimite contas={v.gestor.contas} />
                </>
              ) : null}
              <Graficos v={v} filtros={resultado.filtros} semDados={estado === 'sem-dados'} />
              {DO_BANCO ? <JaChega comMidia /> : null}
            </>
          )}
        </Tela>
      )}
    </>
  );
}

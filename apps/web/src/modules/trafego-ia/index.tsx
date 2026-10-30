/**
 * Tráfego com IA (rota /trafego, tarefa T4 "aprovar uma proposta do Claude"). Só abre para quem tem
 * `ver_trafego_ia` (a rota e o menu conferem). É tela da visão Gestor de tráfego: no Visualizador mostra
 * o aviso e o botão para trocar a visão (a Visão muda o que aparece; o papel, o que dá para fazer).
 *
 * Na visão Gestor: a barra de filtros; "O Claude agora" com "Parar tudo do Claude" (sempre à vista); e as
 * abas (na URL): Fila e ações (fila de aprovação, pendências, indicadores e "O que podemos fazer"),
 * Estratégia, Limites de gasto, Humano × Claude e Diário. Os números vêm de `painelDoTrafego`
 * (`data/queries/trafego-ia.ts`), puros e com teste; nada é somado aqui. Nenhuma plataforma é chamada:
 * o operador Claude é simulado (decisão 0005).
 */

import { SlidersHorizontal } from 'lucide-react';
import { useCallback, useMemo, useRef } from 'react';
import { opcoes } from '@csp-mkt/shared';
import { PageHeader } from '../../components/layout/pagina';
import { BarraDeFiltros, Tela, Vazio, type FiltroRapido } from '../../components/ui';
import type { Dados } from '../../data/dados';
import { LIMITE_DO_DIARIO, painelDoTrafego } from '../../data/queries/trafego-ia';
import { useConsulta, useDados } from '../../data/store';
import { rotuloPeriodo } from '../../lib/periodo';
import { useFiltros, type Filtros } from '../../lib/url-state';
import { Abas, idDaAba, idDoPainel } from './Abas';
import { Diario } from './Diario';
import { Estrategias } from './Estrategia';
import { FaixaDoClaude } from './FaixaDoClaude';
import { FilaDeAprovacao } from './Fila';
import { HumanoXClaude } from './HumanoXClaude';
import { Limites } from './Limites';
import { OQuePodemosFazer } from './Lista';
import { Pendencias, Resumo } from './Resumo';
import { useRegistroDoTrafego } from './estado';
import { useParametrosDaTela } from './url';

/** Operador primeiro (é a tela dele), depois os canais: os 5 chips rápidos da barra. */
const RAPIDOS: FiltroRapido[] = [
  ...opcoes('operator').map((o) => ({
    chave: 'operador' as const,
    valor: o.codigo,
    rotulo: o.rotulo,
    cor: o.cor,
  })),
  ...opcoes('platform').map((o) => ({
    chave: 'canal' as const,
    valor: o.codigo,
    rotulo: o.rotulo,
    cor: o.cor,
  })),
];

const SEM_FILTROS = {
  nome: '',
  filtros: { canal: null, campanha: null, operador: 'todos', status: null, impacto: null, esforco: null },
} as const;

function AvisoDeVisao({ aoTrocar }: { aoTrocar: () => void }) {
  return (
    <Vazio
      icone={SlidersHorizontal}
      titulo="Esta tela é da visão Gestor de tráfego"
      texto="No Visualizador você vê só números. Troque a visão para decidir as propostas do Claude, acompanhar os limites de gasto e ver o diário de ações."
      acao={
        <button className="yn-btn yn-btn--primary" type="button" onClick={aoTrocar}>
          <SlidersHorizontal strokeWidth={1.75} aria-hidden="true" />
          Ver como gestor de tráfego
        </button>
      }
    />
  );
}

export default function TrafegoIa() {
  const { filtros, definir, limpar } = useFiltros();
  const tela = useParametrosDaTela();
  const registro = useRegistroDoTrafego();
  const { lista, diario } = tela;
  const consulta = useCallback(
    (d: Dados, f: Filtros, agora: Date) =>
      painelDoTrafego(d, f, agora, { lista, registro, limiteDoDiario: diario }),
    [lista, registro, diario],
  );
  const r = useConsulta(consulta);
  const { campaigns } = useDados();
  const refFila = useRef<HTMLElement>(null);
  const gestor = filtros.visao === 'gestor';

  const campanhas = useMemo(
    () =>
      campaigns
        .filter(
          (c) =>
            (filtros.marca === 'todas' || c.brandId === filtros.marca) &&
            (!filtros.canal || c.platform === filtros.canal),
        )
        .map((c) => ({ valor: c.id, rotulo: c.name })),
    [campaigns, filtros.marca, filtros.canal],
  );

  const cabecalho = <PageHeader grupo="Tráfego" titulo="Tráfego com IA" atualizadoEm={r.atualizadoEm} />;

  if (!gestor)
    return (
      <>
        {cabecalho}
        <AvisoDeVisao aoTrocar={() => definir({ visao: 'gestor' })} />
      </>
    );

  const decidir = (id: string) => {
    tela.definir({ proposta: id, aba: 'fila' });
    const fila = refFila.current;
    if (fila) {
      fila.scrollIntoView({ behavior: 'smooth', block: 'start' });
      fila.focus({ preventScroll: true });
    }
  };

  return (
    <>
      {cabecalho}
      {/* min-w-0: a fila de chips que não quebra no celular não pode alargar a grade da página */}
      <div className="min-w-0">
        <BarraDeFiltros rapidos={RAPIDOS} campos={['canal', 'campanha', 'operador']} opcoes={{ campanhas }} />
      </div>
      <Tela
        resultado={r}
        vazio={{
          titulo: 'Nada para operar ainda',
          texto:
            'As campanhas, as propostas do Claude e os limites de gasto aparecem quando os conectores trouxerem as contas de anúncio. Veja o que falta ligar em Conectores.',
        }}
      >
        {(p, estado) => {
          const semDados = estado === 'sem-dados';
          return (
            <>
              <FaixaDoClaude claude={p.claude} marca={filtros.marca} />
              <div className="grid min-w-0 gap-6">
                <Abas
                  atual={tela.aba}
                  contagens={{ fila: p.resumo.naFila }}
                  aoMudar={(aba) => tela.definir({ aba })}
                />
                <div
                  className="grid min-w-0 gap-6"
                  role="tabpanel"
                  id={idDoPainel(tela.aba)}
                  aria-labelledby={idDaAba(tela.aba)}
                >
                  {tela.aba === 'fila' ? (
                    <>
                      {/* O que pede decisão primeiro (lei 9; tarefa T4): a fila, depois as pendências,
                          os indicadores e a lista. No celular o Aprovar fica na primeira tela. */}
                      <FilaDeAprovacao
                        ref={refFila}
                        fila={p.fila}
                        selecionada={tela.proposta}
                        aoSelecionar={(id) => tela.definir({ proposta: id })}
                        semDados={semDados}
                        filtrada={Boolean(filtros.canal || filtros.campanha || filtros.operador !== 'todos')}
                        aoLimparFiltros={() => limpar(['canal', 'campanha', 'operador'])}
                      />
                      <Pendencias pendencias={p.pendencias} />
                      <Resumo painel={p} />
                      <OQuePodemosFazer
                        painel={p}
                        semDados={semDados}
                        tela={tela}
                        aoDecidir={decidir}
                        aoLimparTudo={() => tela.aplicar(SEM_FILTROS)}
                      />
                    </>
                  ) : null}
                  {tela.aba === 'estrategia' ? <Estrategias painel={p} /> : null}
                  {tela.aba === 'limites' ? <Limites painel={p} /> : null}
                  {tela.aba === 'operadores' ? (
                    <HumanoXClaude operador={p.operador} semDados={semDados} />
                  ) : null}
                  {tela.aba === 'diario' ? (
                    <Diario
                      diario={p.diario}
                      rotuloDoPeriodo={rotuloPeriodo(filtros.periodo)}
                      semDados={semDados}
                      aoMostrarMais={() => tela.definir({ diario: diario + LIMITE_DO_DIARIO })}
                    />
                  ) : null}
                </div>
              </div>
            </>
          );
        }}
      </Tela>
    </>
  );
}

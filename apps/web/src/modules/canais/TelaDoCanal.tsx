/**
 * Tela de um canal pago (Meta Ads, TikTok Ads ou Google Ads).
 *
 * Visualizador: KPIs com o período anterior, investimento e leads por dia por operador e a tabela
 * por campanha com operador e status. Gestor de tráfego: a proposta do topo da fila do canal antes de
 * tudo (o que pede ação), Humano × Claude lado a lado com a diferença em %, verba e teto de cada conta
 * com o botão de parar tudo, e Pausar · Ajustar orçamento em cada campanha ativa. Nenhum botão executa
 * nada na plataforma: tudo vira ação de tráfego na trilha, aprovada ou proposta (decisão 0005).
 */

import { Megaphone } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { cor, pode, rotulo, type Platform, type TrafficAction } from '@csp-mkt/shared';
import { PageHeader } from '../../components/layout/pagina';
import { BarraDeFiltros, Tela, useToast, type FiltroRapido } from '../../components/ui';
import { aprovarAcao, descartarAcao, pararTudo } from '../../data/actions';
import { CONSULTA_DO_CANAL, type CampanhaDoCanal } from '../../data/queries/canais';
import { useConsulta } from '../../data/store';
import { useSessao } from '../../lib/auth';
import { plural } from '../../lib/format';
import { useFiltros } from '../../lib/url-state';
import { AvisoDoConector, GraficosDoCanal, KpisDoCanal } from './blocos';
import { ModalAprovar, ModalDescartar, ModalOrcamento, ModalPararTudo, ModalPausar } from './modais';
import { HumanoXClaude, Propostas, VerbaETeto } from './operacao';
import { montarAjuste, montarPausa, registrarAcao } from './operacoes';
import { TabelaDeCampanhas } from './TabelaDeCampanhas';

type JanelaAberta =
  | { tipo: 'aprovar'; acao: TrafficAction }
  | { tipo: 'descartar'; acao: TrafficAction }
  | { tipo: 'pausar'; linha: CampanhaDoCanal }
  | { tipo: 'orcamento'; linha: CampanhaDoCanal }
  | { tipo: 'parar' };

export function TelaDoCanal({ plataforma }: { plataforma: Platform }) {
  const r = useConsulta(CONSULTA_DO_CANAL[plataforma]);
  const { filtros, limpar, linkCom } = useFiltros();
  const { perfil } = useSessao();
  const { avisar } = useToast();
  const [janela, setJanela] = useState<JanelaAberta | null>(null);

  const nome = rotulo('platform', plataforma);
  const gestor = filtros.visao === 'gestor';
  const papel = perfil?.role ?? null;
  const podeAprovar = pode(papel, 'aprovar_acao');
  const podeOperar = podeAprovar || pode(papel, 'operar_trafego_ia');
  const podeParar = pode(papel, 'parar_tudo');
  const verConectores = pode(papel, 'ver_conectores');
  const aprovador = podeAprovar && perfil ? perfil.id : null;

  // O canal vem da rota: um ?canal= que chegou por link é redundante aqui e sai da URL.
  useEffect(() => {
    if (filtros.canal !== null) limpar(['canal']);
  }, [filtros.canal, limpar]);

  const painel = r.dados;
  const fechar = useCallback(() => setJanela(null), []);
  const abrirPausa = useCallback((linha: CampanhaDoCanal) => setJanela({ tipo: 'pausar', linha }), []);
  const abrirOrcamento = useCallback((linha: CampanhaDoCanal) => setJanela({ tipo: 'orcamento', linha }), []);

  const nomeDaCampanha = (id: string | null): string | null =>
    (id && painel?.opcoesDeCampanha.find((o) => o.valor === id)?.rotulo) || null;

  const rapidos: FiltroRapido[] = (['human', 'claude'] as const).map((operador) => ({
    chave: 'operador',
    valor: operador,
    rotulo: rotulo('operator', operador),
    cor: cor('operator', operador),
    contagem: painel?.campanhasPorOperador[operador] ?? undefined,
  }));

  /* ---------- Ações (tela → actions → store) e o aviso de cada uma ---------- */

  const confirmarPausa = (linha: CampanhaDoCanal, motivo: string) => {
    const { aprovada } = registrarAcao(montarPausa(linha.campanha, motivo), aprovador);
    setJanela(null);
    avisar(
      aprovada
        ? 'Pausa aprovada. Acompanhe a execução em Tráfego com IA.'
        : 'Pausa proposta. O dono aprova em Tráfego com IA.',
      { tom: 'success' },
    );
  };

  const confirmarOrcamento = (linha: CampanhaDoCanal, novoCents: number, motivo: string) => {
    const { aprovada } = registrarAcao(montarAjuste(linha.campanha, novoCents, motivo), aprovador);
    setJanela(null);
    avisar(
      aprovada
        ? 'Orçamento aprovado. Acompanhe a execução em Tráfego com IA.'
        : 'Orçamento proposto. O dono aprova em Tráfego com IA.',
      { tom: 'success' },
    );
  };

  const confirmarAprovacao = (acao: TrafficAction) => {
    if (!aprovador) return;
    aprovarAcao(acao.id, aprovador);
    setJanela(null);
    avisar('Proposta aprovada.', { tom: 'success' });
  };

  const confirmarDescarte = (acao: TrafficAction, motivo: string) => {
    descartarAcao(acao.id, motivo);
    setJanela(null);
    avisar('Proposta descartada.');
  };

  const confirmarParada = () => {
    const pausadas = pararTudo(filtros.marca);
    setJanela(null);
    avisar(
      pausadas === 0
        ? 'Nenhuma campanha do Claude estava ativa.'
        : `${plural(pausadas, 'campanha do Claude pausada', 'campanhas do Claude pausadas')}.`,
      { tom: 'success' },
    );
  };

  return (
    <>
      <PageHeader
        grupo="Canais"
        titulo={nome}
        atualizadoEm={painel?.conector?.lastSyncAt ?? r.atualizadoEm}
      />
      <BarraDeFiltros
        rapidos={rapidos}
        campos={['campanha', 'operador']}
        opcoes={{ campanhas: painel?.opcoesDeCampanha ?? [] }}
      />
      <Tela
        resultado={r}
        vazio={{
          icone: Megaphone,
          titulo: `Nenhum número de ${nome} ainda`,
          texto: `Ligue o conector de ${nome} para as campanhas chegarem aqui.`,
        }}
      >
        {(p, estado) => (
          <>
            {estado === 'ok' ? (
              <AvisoDoConector conector={p.conector} nome={nome} verConectores={verConectores} />
            ) : null}
            {/* O que pede ação vem no topo (lei 9): no Gestor, a proposta antes dos números */}
            {gestor ? (
              <Propostas
                propostas={p.propostas}
                estado={estado}
                nome={nome}
                nomeDaCampanha={nomeDaCampanha}
                podeAprovar={podeAprovar}
                linkTrafego={
                  pode(papel, 'ver_trafego_ia') ? linkCom('/trafego', { canal: plataforma }) : null
                }
                aoAprovar={(acao) => setJanela({ tipo: 'aprovar', acao })}
                aoDescartar={(acao) => setJanela({ tipo: 'descartar', acao })}
              />
            ) : null}
            <KpisDoCanal painel={p} estado={estado} nome={nome} />
            {gestor ? <HumanoXClaude linhas={p.humanoXClaude} nome={nome} /> : null}
            {gestor ? (
              <VerbaETeto
                contas={p.contas}
                nome={nome}
                marca={filtros.marca}
                pararTudo={p.pararTudo}
                podeParar={podeParar && estado === 'ok'}
                aoParar={() => setJanela({ tipo: 'parar' })}
              />
            ) : null}
            <GraficosDoCanal painel={p} estado={estado} />
            <TabelaDeCampanhas
              painel={p}
              estado={estado}
              gestor={gestor}
              comAcoes={gestor && podeOperar && estado === 'ok'}
              verConectores={verConectores}
              aoPausar={abrirPausa}
              aoAjustar={abrirOrcamento}
            />
          </>
        )}
      </Tela>

      {janela?.tipo === 'aprovar' ? (
        <ModalAprovar
          acao={janela.acao}
          nomeDaCampanha={nomeDaCampanha(janela.acao.campaignId)}
          aoFechar={fechar}
          aoConfirmar={() => confirmarAprovacao(janela.acao)}
        />
      ) : null}
      {janela?.tipo === 'descartar' ? (
        <ModalDescartar
          acao={janela.acao}
          aoFechar={fechar}
          aoConfirmar={(motivo) => confirmarDescarte(janela.acao, motivo)}
        />
      ) : null}
      {janela?.tipo === 'pausar' ? (
        <ModalPausar
          linha={janela.linha}
          aprova={aprovador !== null}
          aoFechar={fechar}
          aoConfirmar={(motivo) => confirmarPausa(janela.linha, motivo)}
        />
      ) : null}
      {janela?.tipo === 'orcamento' ? (
        <ModalOrcamento
          linha={janela.linha}
          aprova={aprovador !== null}
          aoFechar={fechar}
          aoConfirmar={(novo, motivo) => confirmarOrcamento(janela.linha, novo, motivo)}
        />
      ) : null}
      {janela?.tipo === 'parar' && painel ? (
        <ModalPararTudo
          marca={filtros.marca}
          alcance={painel.pararTudo}
          aoFechar={fechar}
          aoConfirmar={confirmarParada}
        />
      ) : null}
    </>
  );
}

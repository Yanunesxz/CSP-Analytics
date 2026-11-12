/**
 * As três tabelas do resumo, com as mesmas cinco colunas de número: o que cada canal trouxe, o que
 * cada marca trouxe (só em "As duas") e campanha por campanha. No celular viram cartões; o nome da
 * campanha quebra linha, para um nome comprido não empurrar a tabela para fora da tela. Com muitas
 * campanhas, aparecem as que mais gastaram e as outras ficam em "Ver as outras campanhas".
 * O canal leva à tela do canal; a marca, ao resumo só dela; a campanha, à tela do canal já nela.
 */

import { ChartNoAxesColumn } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cor, rotulo } from '@csp-mkt/shared';
import { PontoDeSerie, Tabela, Vazio, type Coluna } from '../../components/ui';
import type {
  LinhaDaCampanha,
  LinhaDaMarca,
  LinhaDoCanal,
  NumerosDoResumo,
  ResumoSimples,
} from '../../data/queries/resumo-simples';
import { numero } from '../../lib/format';
import { useFiltros } from '../../lib/url-state';
import {
  ONDE_APARECE,
  campanhasAVista,
  custoDaLinha,
  notaDasCampanhas,
  ondeDaCampanha,
  porReal,
  reais,
  verOutrasCampanhas,
} from './textos';

/**
 * As cinco colunas de número, iguais nas três tabelas. Nenhuma ordena: a ordem já é a da tela (campanhas
 * da que mais gastou para a que menos gastou), e sem as setas a tabela cabe em 1280px.
 */
function numeros<T extends NumerosDoResumo>(): Coluna<T>[] {
  return [
    { chave: 'gastou', titulo: 'Gastou', numerica: true, render: (l) => reais(l.investimento) },
    { chave: 'interessados', titulo: 'Interessados', numerica: true, render: (l) => numero(l.interessados) },
    {
      chave: 'clientes-novos',
      titulo: 'Clientes novos',
      numerica: true,
      render: (l) => numero(l.clientesNovos),
    },
    { chave: 'custo', titulo: 'Custo por cliente', numerica: true, render: (l) => custoDaLinha(l) },
    { chave: 'voltou', titulo: 'Voltou por R$ 1', numerica: true, render: (l) => porReal(l.retornoPorReal) },
  ];
}

/* ---------- O que cada canal e cada marca trouxe ---------- */

export function PorCanalEMarca({ r }: { r: ResumoSimples }) {
  const { linkCom } = useFiltros();
  const mostrarMarcas = r.porMarca.length > 1;

  const colunaCanal: Coluna<LinhaDoCanal> = {
    chave: 'canal',
    titulo: 'Canal',
    render: (l) => (
      <span className="inline-grid gap-1">
        <Link
          className="inline-flex items-center gap-2"
          to={linkCom(`/canais/${l.canal}`)}
          title={`Ver ${rotulo('platform', l.canal)}`}
        >
          <PontoDeSerie cor={cor('platform', l.canal)} />
          {rotulo('platform', l.canal)}
        </Link>
        <span className="yn-muted text-xs font-normal">{ONDE_APARECE[l.canal]}</span>
      </span>
    ),
  };

  const colunaMarca: Coluna<LinhaDaMarca> = {
    chave: 'marca',
    titulo: 'Marca',
    render: (l) => (
      <Link
        className="inline-flex items-center gap-2"
        to={linkCom('/resumo', { marca: l.marca })}
        title={`Ver o resumo só de ${rotulo('brand', l.marca)}`}
      >
        <PontoDeSerie cor={cor('brand', l.marca)} />
        {rotulo('brand', l.marca)}
      </Link>
    ),
  };

  return (
    <section className="mkt-stack" aria-labelledby="resumo-canais">
      <div className="grid gap-1">
        <h2 id="resumo-canais">O que cada canal trouxe</h2>
        <p className="yn-muted text-sm">
          Interessados e clientes novos são só os que vieram de anúncio. Custo por cliente é o gasto dividido
          pelos clientes novos; voltou por R$ 1 é o primeiro pedido deles dividido pelo gasto.
        </p>
      </div>
      <div className="yn-container">
        <Tabela
          colunas={[colunaCanal, ...numeros<LinhaDoCanal>()]}
          linhas={r.porCanal}
          chaveDaLinha={(l) => l.canal}
          empilhar
          legenda="O que cada canal trouxe"
        />
      </div>
      {mostrarMarcas ? (
        <div className="grid gap-2">
          <h3>Por marca</h3>
          <div className="yn-container">
            <Tabela
              colunas={[colunaMarca, ...numeros<LinhaDaMarca>()]}
              linhas={r.porMarca}
              chaveDaLinha={(l) => l.marca}
              empilhar
              legenda="O que cada marca trouxe"
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

/* ---------- Campanha por campanha ---------- */

export function Campanhas({ r, semDados }: { r: ResumoSimples; semDados: boolean }) {
  const { linkCom } = useFiltros();

  const colunaCampanha: Coluna<LinhaDaCampanha> = {
    chave: 'campanha',
    titulo: 'Campanha',
    render: (l) => (
      <span className="inline-grid gap-1">
        <Link
          className="whitespace-normal [overflow-wrap:anywhere]"
          to={linkCom(`/canais/${l.campanha.platform}`, { campanha: l.campanha.id })}
          title={`Ver a campanha em ${rotulo('platform', l.campanha.platform)}`}
        >
          {l.campanha.name}
        </Link>
        <span className="yn-muted inline-flex items-center gap-2 text-xs font-normal">
          <PontoDeSerie cor={cor('platform', l.campanha.platform)} />
          {ondeDaCampanha(l.campanha.platform, l.campanha.brandId)}
        </span>
      </span>
    ),
  };

  const colunas = [colunaCampanha, ...numeros<LinhaDaCampanha>()];
  const quantas = campanhasAVista(r.campanhas.length);
  const aVista = r.campanhas.slice(0, quantas);
  const outras = r.campanhas.slice(quantas);

  return (
    <section className="mkt-stack" aria-labelledby="resumo-campanhas">
      <div className="grid gap-1">
        <h2 id="resumo-campanhas">Campanha por campanha</h2>
        <p className="yn-muted text-sm">{notaDasCampanhas(r)}</p>
      </div>
      <div className="yn-container">
        <Tabela
          colunas={colunas}
          linhas={aVista}
          chaveDaLinha={(l) => l.campanha.id}
          empilhar
          legenda="Gasto e resultado de cada campanha"
          vazio={
            <div className="yn-card">
              {semDados ? (
                <Vazio
                  icone={ChartNoAxesColumn}
                  titulo="Sem dados"
                  texto="As campanhas aparecem quando os conectores trouxerem os números."
                />
              ) : (
                <Vazio
                  titulo="Nenhuma campanha com gasto no período"
                  texto="Troque o período, em cima, ou a marca, no menu, para ver outras campanhas."
                />
              )}
            </div>
          }
        />
      </div>
      {outras.length > 0 ? (
        // Mesmo recurso do "Ver como tabela": as campanhas menores ficam a um toque, sem alongar a tela
        <details className="yn-as-table">
          <summary>{verOutrasCampanhas(outras.length)}</summary>
          <div className="yn-container">
            <Tabela
              colunas={colunas}
              linhas={outras}
              chaveDaLinha={(l) => l.campanha.id}
              empilhar
              legenda="As outras campanhas, com menos gasto"
            />
          </div>
        </details>
      ) : null}
    </section>
  );
}

/**
 * Base de clientes (/base): os clientes que já compraram, por marca e por representante. Hoje, pela
 * situação do CSP 360: ativos, inativos (recente e antigo) e perdidos ("Sem dados" se o CSP 360 não
 * mandar a situação). No período: recompra, reativados e receita de antigos × novos. Tempo desde a
 * última compra, tabelas por marca e por representante e a lista com "Abrir no CSP 360" por cliente,
 * sem nome nem contato.
 *
 * Toda conta vem de `painelDaBase` (data/queries/base-de-clientes.ts). A marca vem do menu, o período
 * e o representante da barra de filtros, o filtro rápido da lista de `?recorte=`; tudo na URL.
 * `?estado=` é honrado por useConsulta + Tela. A ação principal abre a mesma lista no CSP 360, onde o
 * cliente é trabalhado (o CSP-MKT só lê).
 */

import { ExternalLink, Users } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { PageHeader } from '../../components/layout/pagina';
import { BarraDeFiltros, Tela } from '../../components/ui';
import { linkDaListaNoCsp360, painelDaBase, type PainelDaBase } from '../../data/queries/base-de-clientes';
import { useConsulta } from '../../data/store';
import { useFiltros } from '../../lib/url-state';
import { ANCORA_DA_LISTA_DA_BASE } from '../../rotas';
import { Avisos } from './Avisos';
import { Graficos } from './Graficos';
import { Indicadores } from './Indicadores';
import { Lista } from './Lista';
import { useRecorte } from './recorte';
import { PorMarca, PorRepresentante } from './Tabelas';

export default function BaseDeClientes() {
  const r = useConsulta(painelDaBase);
  const { filtros } = useFiltros();
  const { recorte } = useRecorte();
  const { hash, key } = useLocation();

  // /base?recorte=inativos#lista-de-clientes (indicador tocado) rola até a lista já filtrada. A chave da
  // navegação entra para rolar de novo quando outro indicador desta tela é tocado (a âncora é a mesma).
  const pronta = r.estado === 'ok' || r.estado === 'sem-dados';
  useEffect(() => {
    if (pronta && hash === `#${ANCORA_DA_LISTA_DA_BASE}`)
      document.getElementById(ANCORA_DA_LISTA_DA_BASE)?.scrollIntoView({ block: 'start' });
  }, [pronta, hash, key]);

  const href = linkDaListaNoCsp360(filtros, recorte);
  const acao = useMemo(
    () => (
      <a
        className="yn-btn yn-btn--primary"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Abrir lista no CSP 360 (abre em outra aba)"
      >
        <ExternalLink strokeWidth={1.75} aria-hidden="true" />
        Abrir lista no CSP 360
      </a>
    ),
    [href],
  );

  return (
    <>
      <PageHeader
        grupo="Clientes"
        titulo="Base de clientes"
        acao={acao}
        atualizadoEm={r.dados?.conector?.lastSyncAt ?? r.atualizadoEm}
      />
      {/* A base não tem canal, campanha, operador nem origem: filtra por marca (menu), período e representante. */}
      <BarraDeFiltros campos={['representante']} opcoes={{ representantes: r.dados?.representantes ?? [] }} />
      <Tela
        resultado={r}
        esqueleto="tela"
        vazio={{
          icone: Users,
          titulo: 'Nenhum cliente ainda',
          texto: 'Os clientes chegam do CSP 360. Ligue o conector do CSP 360 para ver a base aqui.',
        }}
      >
        {(painel, estado) => <Conteudo painel={painel} estado={estado} />}
      </Tela>
    </>
  );
}

function Conteudo({ painel, estado }: { painel: PainelDaBase; estado: 'ok' | 'sem-dados' }) {
  const { filtros } = useFiltros();
  const deltaTexto = filtros.comparar ? painel.intervalo.rotuloAnterior : undefined;
  const semDados = painel.total === null;

  return (
    <>
      <Avisos painel={painel} />
      <Indicadores painel={painel} deltaTexto={deltaTexto} />
      <Graficos painel={painel} estado={estado} />
      {filtros.marca === 'todas' ? <PorMarca linhas={painel.porMarca} semDados={semDados} /> : null}
      <PorRepresentante linhas={painel.porRepresentante} semDados={semDados} />
      <Lista painel={painel} />
    </>
  );
}

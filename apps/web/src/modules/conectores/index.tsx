/**
 * Conectores (/conectores, grupo Sistema): um cartão por integração (CSP 360, Meta Ads, TikTok Ads, Google
 * Ads, Instagram, Search Console e GA4) com o estado, a última sincronização e o "atualizado há X min", o
 * atraso em relação ao esperado, os erros e as linhas gravadas em 24 h. O que pede ação vem primeiro
 * (caído, atrasado); a ligar, desligado e sem dados vêm por último. Toda conta vem de `painelDeConectores`
 * (data/queries/conectores.ts); a tela só desenha.
 *
 * - Ação principal: "Tentar de novo" no primeiro cartão caído ou atrasado (os outros "Tentar de novo" são
 *   secundários). Só aparece para quem tem `tentar_conector_de_novo` (o dono). Na demonstração simula uma
 *   sincronização no store (actions.tentarConectorDeNovo) depois de uma espera curta, como o worker faria.
 * - Conectores não têm marca nem período (decisão 0003): sem barra de filtros; a marca do menu não muda a tela.
 * - A Visão não muda os cartões: na visão Gestor de tráfego aparece só o aviso de onde ficam operador e verba.
 * - `?estado=` honrado: carregando (esqueleto), erro (Tentar de novo + código), vazio (próximo passo) e
 *   sem-dados (os cartões com "Sem dados").
 */

import { Plug } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { pode, type ConnectorId } from '@csp-mkt/shared';
import { PageHeader } from '../../components/layout/pagina';
import { Esqueleto, useToast, Vazio } from '../../components/ui';
import { tentarConectorDeNovo } from '../../data/actions';
import {
  painelDeConectores,
  type CartaoDeConector,
  type PainelDeConectores,
} from '../../data/queries/conectores';
import { useConsulta, type Resultado } from '../../data/store';
import { useSessao } from '../../lib/auth';
import { useFiltros } from '../../lib/url-state';
import { Avisos, ID_DA_SITUACAO } from './Avisos';
import { Cartao } from './Cartao';
import { sincronizado, TELA_COM_ERRO, TELA_VAZIA } from './textos';

/** Na demonstração, "Tentar de novo" espera um pouco antes de sincronizar, como a chamada ao worker. */
const ESPERA_DA_DEMONSTRACAO_MS = 800;

/** Grade dos cartões: sem corte fixo (regra 2 do responsivo), um por linha no celular. */
const GRADE_DOS_CARTOES = { gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))' };

export default function Conectores() {
  const r = useConsulta(painelDeConectores);
  return (
    <>
      <PageHeader
        grupo="Sistema"
        titulo="Conectores"
        atualizadoEm={r.dados ? r.dados.ultimaSincronizacao : r.atualizadoEm}
      />
      <Conteudo resultado={r} />
    </>
  );
}

function Conteudo({ resultado: r }: { resultado: Resultado<PainelDeConectores> }) {
  const { limpar } = useFiltros();

  if (r.estado === 'carregando') return <Esqueleto variante="kpis" quantidade={6} />;
  if (r.estado === 'erro') {
    return (
      <Vazio
        erro
        titulo={TELA_COM_ERRO.titulo}
        texto={TELA_COM_ERRO.texto}
        codigo={r.codigo}
        aoTentarDeNovo={() => limpar(['estado'])}
      />
    );
  }
  if (r.estado === 'vazio' || !r.dados) {
    return <Vazio icone={Plug} titulo={TELA_VAZIA.titulo} texto={TELA_VAZIA.texto} />;
  }
  return <Painel painel={r.dados} />;
}

function Painel({ painel }: { painel: PainelDeConectores }) {
  const { perfil } = useSessao();
  const { avisar } = useToast();
  const podeTentar = pode(perfil?.role, 'tentar_conector_de_novo');
  const verTrafego = pode(perfil?.role, 'ver_trafego_ia');
  const agora = useMemo(() => new Date(painel.agora), [painel.agora]);

  const [tentando, setTentando] = useState<ReadonlySet<ConnectorId>>(() => new Set());
  const [recuperadoEm, setRecuperadoEm] = useState<string | null>(null);
  const [focar, setFocar] = useState(false);

  // Depois de "Tentar de novo" o cartão muda de lugar (o que pede ação vem primeiro) e o botão some: o foco
  // vai para o aviso do topo, que diz como ficou ("Tudo funcionando de novo desde…" ou o próximo problema).
  // Logo abaixo dele está o próximo "Tentar de novo", se houver.
  useEffect(() => {
    if (!focar) return;
    document.getElementById(ID_DA_SITUACAO)?.focus();
    setFocar(false);
  }, [focar]);

  const tentarDeNovo = useCallback(
    (cartao: CartaoDeConector) => {
      setTentando((atual) => new Set(atual).add(cartao.id));
      window.setTimeout(() => {
        tentarConectorDeNovo(cartao.id);
        setTentando((atual) => {
          const proximo = new Set(atual);
          proximo.delete(cartao.id);
          return proximo;
        });
        setRecuperadoEm(new Date().toISOString());
        setFocar(true);
        avisar(sincronizado(cartao.nome));
      }, ESPERA_DA_DEMONSTRACAO_MS);
    },
    [avisar],
  );

  // Um botão principal por tela: o "Tentar de novo" do primeiro cartão caído ou atrasado.
  const principal = podeTentar ? painel.comProblema[0]?.id : undefined;

  return (
    <div className="grid min-w-0 gap-6">
      <Avisos painel={painel} podeTentar={podeTentar} verTrafego={verTrafego} recuperadoEm={recuperadoEm} />
      <ul role="list" aria-label="Conectores" className="grid gap-4" style={GRADE_DOS_CARTOES}>
        {painel.cartoes.map((cartao) => (
          <Cartao
            key={cartao.id}
            cartao={cartao}
            agora={agora}
            podeTentar={podeTentar}
            verTrafego={verTrafego}
            principal={cartao.id === principal}
            tentando={tentando.has(cartao.id)}
            aoTentarDeNovo={tentarDeNovo}
          />
        ))}
      </ul>
    </div>
  );
}

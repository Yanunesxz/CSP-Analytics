/**
 * Usuários (rota /usuarios; só quem pode `gerir_usuarios`, hoje o dono). Quem tem acesso, o que cada
 * papel pode fazer e o convite por e-mail (decisão 0011). Na v1 só o dono entra; o papel Gestor de
 * tráfego já está pronto para quando ele chegar.
 *
 * Ação principal: "Convidar" (abre a janela de convite). A marca e a Visão não mudam esta tela: perfil
 * não tem marca (decisão 0003) e a Visão não é permissão. Estados pela URL (`?estado=`): carregando,
 * erro e vazio valem para a lista; os papéis vêm da regra de packages/shared e aparecem sempre.
 */

import { Info, UserPlus, UsersRound } from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { pode } from '@csp-mkt/shared';
import { PageHeader } from '../../components/layout/pagina';
import { Esqueleto, useToast, Vazio } from '../../components/ui';
import { quadroDePermissoes, usuarios } from '../../data/queries/sistema';
import { useConsulta } from '../../data/store';
import { useSessao } from '../../lib/auth';
import { useFiltros } from '../../lib/url-state';
import { JanelaDeConvite } from './JanelaDeConvite';
import { ListaDeUsuarios } from './ListaDeUsuarios';
import { PapeisEPermissoes } from './PapeisEPermissoes';

/** Não depende dos dados: sai da regra de packages/shared. */
const QUADRO = quadroDePermissoes();

export default function Usuarios() {
  const r = useConsulta(usuarios);
  const { perfil } = useSessao();
  const { limpar } = useFiltros();
  const { avisar } = useToast();
  const [convidando, setConvidando] = useState(false);
  const idLista = useId();
  const podeConvidar = pode(perfil?.role, 'gerir_usuarios');

  // Memorizado: o PageHeader só atualiza a barra do topo quando o botão muda de verdade.
  const acao = useMemo(
    () =>
      podeConvidar ? (
        <button className="yn-btn yn-btn--primary" type="button" onClick={() => setConvidando(true)}>
          <UserPlus strokeWidth={1.75} aria-hidden="true" />
          Convidar
        </button>
      ) : undefined,
    [podeConvidar],
  );

  const comBase = r.estado === 'ok' || r.estado === 'sem-dados';
  const emailsComAcesso = useMemo(() => r.dados?.lista.map((p) => p.email) ?? [], [r.dados]);

  let lista: ReactNode;
  if (r.estado === 'carregando') {
    lista = <Esqueleto variante="tabela" quantidade={3} />;
  } else if (r.estado === 'erro') {
    lista = (
      <div className="yn-card">
        <Vazio
          erro
          titulo="Não deu para carregar os usuários"
          texto="Tente de novo em alguns segundos."
          codigo={r.codigo}
          aoTentarDeNovo={() => limpar(['estado'])}
        />
      </div>
    );
  } else if (r.estado === 'vazio' || r.dados === null) {
    lista = (
      <div className="yn-card">
        <Vazio
          icone={UsersRound}
          titulo="Nenhum usuário cadastrado"
          texto="Convide quem vai usar o sistema em Convidar, no topo da tela."
        />
      </div>
    );
  } else {
    lista = (
      <ListaDeUsuarios
        usuarios={r.dados}
        idDoPerfil={perfil?.id ?? null}
        semDados={r.estado === 'sem-dados'}
      />
    );
  }

  return (
    <>
      <PageHeader grupo="Sistema" titulo="Usuários" acao={acao} atualizadoEm={r.atualizadoEm} />

      <div className="yn-alert" data-tone="info" role="note">
        <Info strokeWidth={1.75} aria-hidden="true" />
        <div>
          <strong className="yn-alert__title">Na primeira versão, só o dono entra</strong>O papel Gestor de
          tráfego já está pronto: quando o gestor chegar, é só usar Convidar.
        </div>
      </div>

      <section className="mkt-stack min-w-0" aria-labelledby={idLista}>
        <div>
          <h2 id={idLista}>Quem tem acesso</h2>
          <p className="yn-muted text-sm">Cada pessoa entra com o próprio e-mail e um papel.</p>
        </div>
        {lista}
      </section>

      <PapeisEPermissoes quadro={QUADRO} porPapel={comBase ? r.dados?.porPapel : undefined} />

      {convidando ? (
        <JanelaDeConvite
          emailsComAcesso={emailsComAcesso}
          aoFechar={() => setConvidando(false)}
          aoEnviar={(email) => {
            setConvidando(false);
            avisar(`Convite enviado para ${email}.`);
          }}
        />
      ) : null}
    </>
  );
}

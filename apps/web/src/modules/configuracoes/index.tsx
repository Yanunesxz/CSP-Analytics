/**
 * Configurações (rota /configuracoes, todos os papéis). Tela de formulário: `.yn-content--narrow` e
 * seções `.yn-form-section` (título à esquerda, controles à direita; empilham abaixo de 720px de área).
 * Cada escolha vale na hora, sem botão Salvar, e por isso a tela não tem botão principal:
 * - Tema: Aparelho · Claro · Escuro (lib/tema.ts; localStorage "tema"; nunca na URL);
 * - Marca padrão: a marca que abre quando o link não diz qual (a mesma memória do menu);
 * - Avisos: e-mail e WhatsApp por aviso (SecaoDeAvisos.tsx);
 * - Sua conta: nome, e-mail e papel de quem está usando;
 * - Versão do sistema: a build aberta e se já há uma mais nova (/version.json, lido por lib/versao.ts).
 * Nada aqui depende dos dados de marketing: sem dados de exemplo, a tela abre igual. A Visão não muda
 * esta tela.
 */

import { Monitor, Moon, RefreshCw, Sun, UsersRound } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { pode, rotulo, rotuloMarca } from '@csp-mkt/shared';
import { PageHeader } from '../../components/layout/pagina';
import { RESUMO_DO_PAPEL } from '../../data/queries/sistema';
import { store } from '../../data/store';
import { useSessao } from '../../lib/auth';
import { dataHora } from '../../lib/format';
import { useTema, type Tema } from '../../lib/tema';
import { lerMemoria, useFiltros } from '../../lib/url-state';
import { recarregar, useVersaoNova, VERSAO_ATUAL } from '../../lib/versao';
import { SecaoDeAvisos } from './SecaoDeAvisos';
import { Secao } from './Secao';
import { marcaPadrao, MARCAS_DO_PADRAO, rotuloDoModo } from './textos';

const TEMAS: Array<{ valor: Tema; rotulo: string; icone: typeof Monitor }> = [
  { valor: '', rotulo: 'Aparelho', icone: Monitor },
  { valor: 'light', rotulo: 'Claro', icone: Sun },
  { valor: 'dark', rotulo: 'Escuro', icone: Moon },
];

export default function Configuracoes() {
  const { hash } = useLocation();
  // "Perfil" no menu do usuário abre /configuracoes#conta: a tela já vem na seção pedida
  useEffect(() => {
    if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' });
  }, [hash]);

  return (
    <>
      <PageHeader grupo="Sistema" titulo="Configurações" />
      <div className="yn-content--narrow">
        <TemaDoSistema />
        <MarcaPadrao />
        <SecaoDeAvisos />
        <SuaConta />
        <VersaoDoSistema />
      </div>
    </>
  );
}

function TemaDoSistema() {
  const { preferencia, definir } = useTema();
  return (
    <Secao id="tema" titulo="Tema" descricao="Claro, escuro ou igual ao aparelho.">
      <div className="yn-segmented" role="group" aria-label="Tema">
        {TEMAS.map((t) => (
          <button
            key={t.valor}
            type="button"
            aria-pressed={preferencia === t.valor}
            onClick={() => definir(t.valor)}
          >
            <t.icone strokeWidth={1.75} aria-hidden="true" />
            {t.rotulo}
          </button>
        ))}
      </div>
      <p className="yn-hint">
        Aparelho segue o claro ou o escuro do computador ou do celular. A escolha fica guardada neste
        navegador.
      </p>
    </Secao>
  );
}

function MarcaPadrao() {
  const { filtros, definir } = useFiltros();
  // Lida a cada render: o menu grava a mesma memória e muda a URL, o que redesenha esta seção.
  const padrao = marcaPadrao(lerMemoria().marca, filtros.marca);
  return (
    <Secao id="marca" titulo="Marca padrão" descricao="A marca que aparece quando você abre o sistema.">
      <div className="yn-segmented" role="group" aria-label="Marca padrão">
        {MARCAS_DO_PADRAO.map((marca) => (
          <button
            key={marca}
            type="button"
            aria-pressed={padrao === marca}
            onClick={() => definir({ marca })}
          >
            {rotuloMarca(marca)}
          </button>
        ))}
      </div>
      <p className="yn-hint">
        Vale quando o link não diz a marca. Trocar a marca no menu também muda esta escolha.
      </p>
    </Secao>
  );
}

function SuaConta() {
  const { perfil, modo } = useSessao();
  const { searchGlobal } = useFiltros();
  if (!perfil) return null; // sem login a casca nem abre as telas
  return (
    <Secao id="conta" titulo="Sua conta" descricao="Com que nome, e-mail e papel você entra.">
      <dl className="yn-dl">
        <div>
          <dt>Nome</dt>
          <dd>{perfil.name}</dd>
        </div>
        <div>
          <dt>E-mail</dt>
          {perfil.email ? <dd>{perfil.email}</dd> : <dd className="yn-muted">A cadastrar</dd>}
        </div>
        <div>
          <dt>Papel</dt>
          <dd>{rotulo('role', perfil.role)}</dd>
        </div>
      </dl>
      <p className="yn-hint">
        {RESUMO_DO_PAPEL[perfil.role]}
        {modo === 'demonstracao' ? ' Na demonstração, você entra como o dono de exemplo, sem senha.' : ''}
      </p>
      {pode(perfil.role, 'gerir_usuarios') ? (
        <Link
          className="yn-btn yn-btn--secondary justify-self-start"
          to={{ pathname: '/usuarios', search: searchGlobal }}
        >
          <UsersRound strokeWidth={1.75} aria-hidden="true" />
          Ver usuários e papéis
        </Link>
      ) : null}
    </Secao>
  );
}

function VersaoDoSistema() {
  const nova = useVersaoNova();
  const { modo } = useSessao();
  return (
    <Secao id="versao" titulo="Versão do sistema" descricao="A versão aberta neste navegador.">
      <dl className="yn-dl">
        <div>
          <dt>Versão</dt>
          <dd>{VERSAO_ATUAL.version}</dd>
        </div>
        <div>
          <dt>Publicada em</dt>
          <dd>{dataHora(VERSAO_ATUAL.builtAt)}</dd>
        </div>
        <div>
          <dt>Modo</dt>
          <dd>{rotuloDoModo(modo, store.comDadosDeExemplo)}</dd>
        </div>
      </dl>
      {nova ? (
        <div className="yn-alert" data-tone="info" role="status">
          <RefreshCw strokeWidth={1.75} aria-hidden="true" />
          <div className="grid gap-2">
            <div>
              <strong className="yn-alert__title">Versão nova disponível</strong>
              Atualize para abrir a versão mais recente.
            </div>
            <button
              className="yn-btn yn-btn--secondary yn-btn--sm justify-self-start"
              type="button"
              onClick={recarregar}
            >
              Atualizar
            </button>
          </div>
        </div>
      ) : (
        <p className="yn-hint">
          Você está na versão mais recente. O sistema confere sozinho de tempos em tempos e avisa no topo da
          tela.
        </p>
      )}
    </Secao>
  );
}

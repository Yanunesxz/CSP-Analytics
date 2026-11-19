/**
 * Login do modo Supabase: e-mail e senha (a senha nasce no convite, decisão 0011). Sem cadastro aberto e sem dizer se
 * o e-mail existe. Também as duas saídas de quem entrou e não pode usar: sem perfil ativo, e perfil que não deu para
 * ler (rede ou banco), com "Tentar de novo".
 */

import { LogIn, LogOut, UserX } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useSessao } from '../../lib/auth';
import { Vazio } from '../ui/Vazio';

export function Entrar() {
  const { entrar } = useSessao();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function aoEnviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setErro(null);
    const falha = await entrar(email, senha);
    setEnviando(false);
    if (falha) setErro(falha);
  }

  return (
    <section className="yn-card mkt-entrar" aria-labelledby="entrar-titulo">
      <h2 id="entrar-titulo">Entrar no CSP MKT</h2>
      <p className="yn-muted">Use o e-mail do convite e a senha que você criou.</p>
      <form className="mkt-entrar__form" onSubmit={(e) => void aoEnviar(e)} noValidate>
        <div className="yn-field">
          <label className="yn-label" htmlFor="entrar-email">
            E-mail
          </label>
          <input
            className="yn-input"
            id="entrar-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? 'entrar-erro' : undefined}
          />
        </div>
        <div className="yn-field">
          <label className="yn-label" htmlFor="entrar-senha">
            Senha
          </label>
          <input
            className="yn-input"
            id="entrar-senha"
            type="password"
            autoComplete="current-password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? 'entrar-erro' : undefined}
          />
        </div>
        {erro ? (
          <span className="yn-error" id="entrar-erro" role="alert">
            {erro}
          </span>
        ) : null}
        <button
          className="yn-btn yn-btn--primary"
          type="submit"
          aria-busy={enviando || undefined}
          disabled={enviando || !email.trim() || !senha}
        >
          {enviando ? null : <LogIn size={16} strokeWidth={1.75} aria-hidden="true" />}
          {enviando ? 'Entrando' : 'Entrar'}
        </button>
      </form>
    </section>
  );
}

export function SemAcesso() {
  const { sair } = useSessao();
  return (
    <Vazio
      icone={UserX}
      titulo="Seu login não tem acesso ao CSP MKT"
      texto="Peça ao dono do sistema um convite. Se você já tinha acesso, ele pode ter sido tirado."
      acao={
        <button className="yn-btn yn-btn--secondary" type="button" onClick={() => void sair()}>
          <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
          Sair
        </button>
      }
    />
  );
}

export function PerfilComFalha({ codigo }: { codigo: string }) {
  const { tentarDeNovo } = useSessao();
  return (
    <Vazio
      erro
      titulo="Não deu para carregar o seu acesso"
      texto="Confira a internet e tente de novo."
      codigo={codigo}
      aoTentarDeNovo={tentarDeNovo}
    />
  );
}

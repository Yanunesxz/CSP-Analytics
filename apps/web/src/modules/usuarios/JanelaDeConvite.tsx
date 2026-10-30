/**
 * Janela "Convidar pessoa" (.yn-modal aberta com showModal()), regra 11 da seção 7 do padrão:
 * Esc fecha; clicar fora não fecha (a janela tem ação); pergunta antes de descartar o e-mail digitado;
 * foco no campo de e-mail ao abrir e de volta no botão "Convidar" ao fechar; "Enviar convite" trava
 * enquanto envia (aria-busy, contra clique duplo). O erro aparece no próprio campo, sem apagar o que foi
 * digitado; a falha do envio aparece na janela, com código, e ela continua aberta.
 */

import { CircleAlert, TriangleAlert, X } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { rotulo, type Role } from '@csp-mkt/shared';
import { RESUMO_DO_PAPEL } from '../../data/queries/sistema';
import { useSessao } from '../../lib/auth';
import { enviarConvite, PAPEIS_DO_CONVITE, PAPEL_PADRAO_DO_CONVITE, validarConvite } from './convite';

export interface JanelaDeConviteProps {
  /** E-mails que já têm acesso, para avisar antes de enviar. */
  emailsComAcesso: readonly string[];
  aoFechar: () => void;
  /** Convite enviado: a tela fecha a janela e avisa com o e-mail. */
  aoEnviar: (email: string) => void;
}

interface Falha {
  codigo: string;
  mensagem: string;
}

export function JanelaDeConvite({ emailsComAcesso, aoFechar, aoEnviar }: JanelaDeConviteProps) {
  const { modo } = useSessao();
  const janela = useRef<HTMLDialogElement>(null);
  const campoEmail = useRef<HTMLInputElement>(null);
  const id = useId();
  const [email, setEmail] = useState('');
  const [papel, setPapel] = useState<Role>(PAPEL_PADRAO_DO_CONVITE);
  const [erro, setErro] = useState<string | null>(null);
  const [falha, setFalha] = useState<Falha | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [perguntando, setPerguntando] = useState(false);
  const sujo = email.trim() !== '';

  const idTitulo = `${id}-titulo`;
  const idEmail = `${id}-email`;
  const idErro = `${id}-erro`;

  // Abre ao montar e fecha ao desmontar (antes de sair do DOM, para o foco voltar a quem abriu).
  useLayoutEffect(() => {
    const el = janela.current;
    if (!el) return;
    if (!el.open) el.showModal();
    campoEmail.current?.focus();
    return () => {
      if (el.open) el.close();
    };
  }, []);

  const pedirFechar = () => {
    if (enviando) return;
    if (sujo) setPerguntando(true);
    else aoFechar();
  };

  const continuarEditando = () => {
    setPerguntando(false);
    campoEmail.current?.focus();
  };

  const enviar = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    if (enviando) return;
    setFalha(null);
    setPerguntando(false);
    const validacao = validarConvite(email, papel, emailsComAcesso);
    if (!validacao.ok) {
      setErro(validacao.erro);
      campoEmail.current?.focus();
      return;
    }
    setErro(null);
    setEnviando(true);
    const resultado = await enviarConvite(validacao.convite);
    setEnviando(false);
    if (resultado.ok) aoEnviar(resultado.email);
    else setFalha({ codigo: resultado.codigo, mensagem: resultado.mensagem });
  };

  return (
    <dialog
      ref={janela}
      className="yn-modal"
      // O reset do Tailwind (preflight) zera a margem do <dialog>; o .yn-modal do padrão conta com a
      // margem automática do navegador para ficar no meio da tela (pendência da fundação: index.css).
      style={{ margin: 'auto' }}
      aria-labelledby={idTitulo}
      onCancel={(evento) => {
        evento.preventDefault();
        pedirFechar();
      }}
      onClose={() => {
        // Só quando o navegador fechou sozinho (Esc repetido). Ignora o "close" atrasado de uma janela
        // que já reabriu (o StrictMode do dev monta, desmonta e monta de novo).
        if (!janela.current?.open) aoFechar();
      }}
    >
      <form className="grid gap-4" noValidate onSubmit={(evento) => void enviar(evento)}>
        <div className="yn-dialog__header" style={{ marginBottom: 0 }}>
          <div className="grid gap-1">
            <h2 id={idTitulo}>Convidar pessoa</h2>
            <p className="yn-muted text-sm">
              A pessoa recebe um e-mail com o link para entrar e criar a senha.
            </p>
          </div>
          <button
            className="yn-btn yn-btn--ghost yn-btn--icon"
            type="button"
            aria-label="Fechar"
            disabled={enviando}
            onClick={pedirFechar}
          >
            <X strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="yn-field">
          <label className="yn-label" htmlFor={idEmail}>
            E-mail
          </label>
          <input
            ref={campoEmail}
            id={idEmail}
            className="yn-input"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="nome@empresa.com.br"
            required
            value={email}
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? idErro : undefined}
            onChange={(evento) => {
              setEmail(evento.currentTarget.value);
              if (erro) setErro(null);
            }}
          />
          {erro ? (
            <span className="yn-error" id={idErro}>
              <CircleAlert strokeWidth={1.75} aria-hidden="true" />
              {erro}
            </span>
          ) : null}
        </div>

        <fieldset className="yn-fieldset" disabled={enviando}>
          <legend>Papel</legend>
          {PAPEIS_DO_CONVITE.map((p) => (
            <div key={p} className="grid gap-1">
              <label className="yn-check">
                <input
                  type="radio"
                  name={`${id}-papel`}
                  value={p}
                  checked={papel === p}
                  aria-describedby={`${id}-papel-${p}`}
                  onChange={() => setPapel(p)}
                />
                {rotulo('role', p)}
              </label>
              <p className="yn-hint" id={`${id}-papel-${p}`} style={{ paddingInlineStart: 'var(--space-6)' }}>
                {RESUMO_DO_PAPEL[p]}
              </p>
            </div>
          ))}
        </fieldset>

        {modo === 'demonstracao' ? (
          <p className="yn-hint">
            Na demonstração, o convite não sai do sistema e a pessoa não entra na lista.
          </p>
        ) : null}

        {falha ? (
          <div className="yn-alert" data-tone="danger" role="alert">
            <CircleAlert strokeWidth={1.75} aria-hidden="true" />
            <div className="grid gap-1">
              <strong className="yn-alert__title">Não deu para enviar o convite</strong>
              <span>{falha.mensagem} O que você digitou continua aqui.</span>
              <span className="yn-empty__code">Código {falha.codigo}</span>
            </div>
          </div>
        ) : null}

        {perguntando ? (
          <div className="yn-alert" data-tone="warning" role="alert">
            <TriangleAlert strokeWidth={1.75} aria-hidden="true" />
            <div className="grid gap-2">
              <strong className="yn-alert__title">Descartar o convite para {email.trim()}?</strong>
              <div className="mkt-actions">
                <button
                  className="yn-btn yn-btn--secondary yn-btn--sm"
                  type="button"
                  autoFocus
                  onClick={continuarEditando}
                >
                  Continuar editando
                </button>
                <button className="yn-btn yn-btn--danger yn-btn--sm" type="button" onClick={aoFechar}>
                  Descartar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="yn-dialog__footer" style={{ marginTop: 0 }}>
          <button
            className="yn-btn yn-btn--secondary"
            type="button"
            disabled={enviando}
            onClick={pedirFechar}
          >
            Cancelar
          </button>
          <button
            className="yn-btn yn-btn--primary"
            type="submit"
            aria-busy={enviando || undefined}
            disabled={enviando}
          >
            {enviando ? 'Enviando' : 'Enviar convite'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

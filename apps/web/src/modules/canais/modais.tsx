/**
 * As janelas de confirmação da tela de canal (visão Gestor de tráfego). Nenhuma executa nada na
 * plataforma: aprovar, pausar e ajustar orçamento gravam uma ação de tráfego na trilha; só "parar
 * tudo" pausa na hora as campanhas do Claude no CSP-MKT (decisão 0005).
 */

import { Check, CircleAlert, OctagonX, Pause, Wallet } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { rotulo, rotuloMarca, type Platform, type TrafficAction } from '@csp-mkt/shared';
import type { CampanhaDoCanal } from '../../data/queries/canais';
import { dinheiro, numero, plural } from '../../lib/format';
import type { Marca } from '../../lib/url-state';
import { fraseDoAjuste, lerReais, mudancaGrande, validarOrcamento, valorParaCampo } from './formatos';
import { Modal } from './Modal';

const NAO_EXECUTA =
  'Aprovar não executa nada agora: a ação entra na fila de execução de Tráfego com IA e só roda quando houver credencial de escrita.';
const VIRA_PROPOSTA = 'Vira proposta: o dono aprova em Tráfego com IA.';

/* ---------- Aprovar e descartar proposta ---------- */

export function ModalAprovar({
  acao,
  nomeDaCampanha,
  aoFechar,
  aoConfirmar,
}: {
  acao: TrafficAction;
  nomeDaCampanha: string | null;
  aoFechar: () => void;
  aoConfirmar: () => void;
}) {
  const [gravando, setGravando] = useState(false);
  return (
    <Modal
      titulo="Aprovar a proposta?"
      aoFechar={aoFechar}
      aoEnviar={() => {
        if (gravando) return;
        setGravando(true);
        aoConfirmar();
      }}
      confirmar={
        <button
          className="yn-btn yn-btn--primary"
          type="submit"
          disabled={gravando}
          aria-busy={gravando || undefined}
        >
          <Check strokeWidth={1.75} aria-hidden="true" />
          Aprovar proposta
        </button>
      }
    >
      <p className="font-semibold">{acao.title}</p>
      <dl className="yn-dl yn-dl--rows">
        <div>
          <dt>Quem propôs</dt>
          <dd>{rotulo('operator', acao.proposedBy)}</dd>
        </div>
        <div>
          <dt>Campanha</dt>
          <dd>{nomeDaCampanha ?? (acao.kind === 'create' ? 'Campanha nova' : '')}</dd>
        </div>
        <div>
          <dt>Custo estimado</dt>
          <dd>{acao.costCents === null ? '' : dinheiro(acao.costCents)}</dd>
        </div>
      </dl>
      <p className="yn-muted text-sm">{NAO_EXECUTA}</p>
    </Modal>
  );
}

export function ModalDescartar({
  acao,
  aoFechar,
  aoConfirmar,
}: {
  acao: TrafficAction;
  aoFechar: () => void;
  aoConfirmar: (motivo: string) => void;
}) {
  const id = useId();
  const [motivo, setMotivo] = useState('');
  const [gravando, setGravando] = useState(false);
  const valido = motivo.trim().length >= 10;
  return (
    <Modal
      titulo="Descartar a proposta?"
      aoFechar={aoFechar}
      sujo={motivo.trim().length > 0}
      aoEnviar={() => {
        if (!valido || gravando) return;
        setGravando(true);
        aoConfirmar(motivo.trim());
      }}
      confirmar={
        <button className="yn-btn yn-btn--danger" type="submit" disabled={!valido || gravando}>
          Descartar proposta
        </button>
      }
    >
      <p className="font-semibold">{acao.title}</p>
      <div className="yn-field">
        <label className="yn-label" htmlFor={id}>
          Motivo (fica no diário de ações)
        </label>
        <textarea
          id={id}
          className="yn-input"
          data-foco-inicial
          required
          minLength={10}
          value={motivo}
          placeholder="Ex.: o teto da conta já está no limite este mês."
          aria-describedby={`${id}-dica`}
          onChange={(e) => setMotivo(e.target.value)}
        />
        <span className="yn-hint" id={`${id}-dica`}>
          Pelo menos 10 letras.
        </span>
      </div>
    </Modal>
  );
}

/* ---------- Pausar campanha ---------- */

export function ModalPausar({
  linha,
  aprova,
  aoFechar,
  aoConfirmar,
}: {
  linha: CampanhaDoCanal;
  /** Quem confirma pode aprovar (dono); senão a pausa vira proposta. */
  aprova: boolean;
  aoFechar: () => void;
  aoConfirmar: (motivo: string) => void;
}) {
  const id = useId();
  const [motivo, setMotivo] = useState('');
  const [gravando, setGravando] = useState(false);
  const c = linha.campanha;
  return (
    <Modal
      titulo={`Pausar ${c.name}?`}
      aoFechar={aoFechar}
      sujo={motivo.trim().length > 0}
      aoEnviar={() => {
        if (gravando) return;
        setGravando(true);
        aoConfirmar(motivo);
      }}
      confirmar={
        <button
          className="yn-btn yn-btn--primary"
          type="submit"
          disabled={gravando}
          aria-busy={gravando || undefined}
        >
          <Pause strokeWidth={1.75} aria-hidden="true" />
          {aprova ? 'Aprovar pausa' : 'Propor pausa'}
        </button>
      }
    >
      <dl className="yn-dl yn-dl--rows">
        <div>
          <dt>Operador</dt>
          <dd>{rotulo('operator', c.managedBy)}</dd>
        </div>
        <div>
          <dt>Marca</dt>
          <dd>{rotulo('brand', c.brandId)}</dd>
        </div>
        <div>
          <dt>Investido no período</dt>
          <dd>{dinheiro(linha.investimento.atual)}</dd>
        </div>
        <div>
          <dt>Custo por lead</dt>
          <dd>{dinheiro(linha.cpl.atual)}</dd>
        </div>
        <div>
          <dt>Clientes novos</dt>
          <dd>{numero(linha.clientesNovos.atual)}</dd>
        </div>
      </dl>
      <div className="yn-field">
        <label className="yn-label" htmlFor={id}>
          Motivo (opcional)
        </label>
        <textarea
          id={id}
          className="yn-input"
          data-foco-inicial
          value={motivo}
          placeholder="Ex.: custo por lead acima da meta há 7 dias."
          aria-describedby={`${id}-dica`}
          onChange={(e) => setMotivo(e.target.value)}
        />
        <span className="yn-hint" id={`${id}-dica`}>
          Fica no diário de ações de Tráfego com IA.
        </span>
      </div>
      <p className="yn-muted text-sm">{aprova ? NAO_EXECUTA : VIRA_PROPOSTA}</p>
    </Modal>
  );
}

/* ---------- Ajustar orçamento ---------- */

export function ModalOrcamento({
  linha,
  aprova,
  aoFechar,
  aoConfirmar,
}: {
  linha: CampanhaDoCanal;
  aprova: boolean;
  aoFechar: () => void;
  aoConfirmar: (novoCents: number, motivo: string) => void;
}) {
  const id = useId();
  const c = linha.campanha;
  const atual = c.dailyBudgetCents;
  const inicial = valorParaCampo(atual);
  const [texto, setTexto] = useState(inicial);
  const [motivo, setMotivo] = useState('');
  const [tentou, setTentou] = useState(false);
  const [gravando, setGravando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  const novo = lerReais(texto);
  const erro = validarOrcamento(novo, atual);
  const mostrarErro = tentou && erro !== null;
  const grande = novo !== null && erro === null && mudancaGrande(atual, novo);

  return (
    <Modal
      titulo={`Ajustar o orçamento de ${c.name}`}
      aoFechar={aoFechar}
      sujo={texto !== inicial || motivo.trim().length > 0}
      aoEnviar={() => {
        setTentou(true);
        if (erro !== null || novo === null || gravando) {
          campo.current?.focus();
          return;
        }
        setGravando(true);
        aoConfirmar(novo, motivo);
      }}
      confirmar={
        <button
          className="yn-btn yn-btn--primary"
          type="submit"
          disabled={gravando}
          aria-busy={gravando || undefined}
        >
          <Wallet strokeWidth={1.75} aria-hidden="true" />
          {aprova ? 'Aprovar orçamento' : 'Propor orçamento'}
        </button>
      }
    >
      <div className="yn-field">
        <label className="yn-label" htmlFor={`${id}-valor`}>
          Novo orçamento diário (R$)
        </label>
        <input
          ref={campo}
          id={`${id}-valor`}
          className="yn-input"
          data-foco-inicial
          inputMode="decimal"
          autoComplete="off"
          value={texto}
          aria-invalid={mostrarErro || undefined}
          aria-describedby={mostrarErro ? `${id}-erro` : `${id}-dica`}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={() => setTentou(true)}
        />
        {mostrarErro ? (
          <span className="yn-error" id={`${id}-erro`}>
            <CircleAlert strokeWidth={1.75} aria-hidden="true" />
            {erro}
          </span>
        ) : (
          <span className="yn-hint" id={`${id}-dica`}>
            Hoje: {dinheiro(atual)} por dia. Aceita 150, 150,00 ou 1.500,00.
          </span>
        )}
      </div>
      {novo !== null && erro === null ? (
        <p className="text-sm">
          {fraseDoAjuste(atual, novo)}
          {grande ? <span className="text-tone-warning"> Mudança grande: confira o valor.</span> : null}
        </p>
      ) : null}
      <div className="yn-field">
        <label className="yn-label" htmlFor={`${id}-motivo`}>
          Motivo (opcional)
        </label>
        <textarea
          id={`${id}-motivo`}
          className="yn-input"
          value={motivo}
          placeholder="Ex.: custo por lead 20% abaixo da média do canal."
          onChange={(e) => setMotivo(e.target.value)}
        />
      </div>
      <p className="yn-muted text-sm">{aprova ? NAO_EXECUTA : VIRA_PROPOSTA}</p>
    </Modal>
  );
}

/* ---------- Parar tudo do Claude (confirmação dupla) ---------- */

export function ModalPararTudo({
  marca,
  alcance,
  aoFechar,
  aoConfirmar,
}: {
  marca: Marca;
  alcance: { total: number | null; porCanal: Array<{ canal: Platform; total: number }> };
  aoFechar: () => void;
  aoConfirmar: () => void;
}) {
  const id = useId();
  const [etapa, setEtapa] = useState<1 | 2>(1);
  const [entendi, setEntendi] = useState(false);
  const [gravando, setGravando] = useState(false);
  const total = alcance.total ?? 0;
  const onde = marca === 'todas' ? 'nas duas marcas' : `em ${rotuloMarca(marca)}`;
  const quantas = plural(total, 'campanha', 'campanhas');

  if (etapa === 1) {
    return (
      <Modal
        titulo="Parar tudo do Claude?"
        aoFechar={aoFechar}
        aoEnviar={() => setEtapa(2)}
        confirmar={
          <button className="yn-btn yn-btn--danger" type="submit" disabled={total === 0}>
            Continuar
          </button>
        }
      >
        <p>
          Pausa na hora {total === 1 ? 'a campanha ativa' : `as ${total} campanhas ativas`} do Claude {onde},
          em todos os canais. As campanhas do humano continuam.
        </p>
        <dl className="yn-dl yn-dl--rows">
          {alcance.porCanal.map((c) => (
            <div key={c.canal}>
              <dt>{rotulo('platform', c.canal)}</dt>
              <dd>{plural(c.total, 'campanha ativa', 'campanhas ativas')}</dd>
            </div>
          ))}
        </dl>
      </Modal>
    );
  }

  return (
    <Modal
      titulo={`Confirme: parar ${quantas} do Claude`}
      aoFechar={aoFechar}
      aoEnviar={() => {
        if (!entendi || gravando) return;
        setGravando(true);
        aoConfirmar();
      }}
      confirmar={
        <button
          className="yn-btn yn-btn--danger"
          type="submit"
          disabled={!entendi || gravando}
          aria-busy={gravando || undefined}
        >
          <OctagonX strokeWidth={1.75} aria-hidden="true" />
          Parar {quantas}
        </button>
      }
    >
      <label className="yn-check" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          autoFocus
          checked={entendi}
          onChange={(e) => setEntendi(e.target.checked)}
        />
        Entendo que elas param de veicular agora e só voltam quando alguém reativar.
      </label>
    </Modal>
  );
}

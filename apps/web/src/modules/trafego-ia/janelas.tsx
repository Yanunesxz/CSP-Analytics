/**
 * As janelas da tela Tráfego com IA. Nenhuma chama plataforma: aprovar, descartar, marcar como feita e
 * registrar ideia gravam na trilha de ações; mudar limite e parar tudo mudam as campanhas no CSP-MKT
 * (o worker leva para a plataforma quando houver credencial de escrita, decisão 0005).
 */

import { Check, CircleCheck, NotebookPen, OctagonX, Plus, TriangleAlert, Wallet } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  opcoes,
  rotulo,
  rotuloMarca,
  type ActionKind,
  type Brand,
  type Level,
  type Platform,
} from '@csp-mkt/shared';
import type {
  ContaDoTrafego,
  EstrategiaComNumeros,
  ItemDeAcao,
  PainelDoTrafego,
} from '../../data/queries/trafego-ia';
import { dinheiro, plural } from '../../lib/format';
import type { Marca } from '../../lib/url-state';
import { Janela } from './Janela';
import {
  lerInteiro,
  lerReais,
  validarEstrategia,
  validarIdeia,
  validarTexto,
  valorParaCampo,
  type CamposDaEstrategia,
  type CamposDaIdeia,
} from './regras';

export const NAO_EXECUTA =
  'Aprovar não executa nada agora: a ação espera a execução, que liga quando houver credencial de escrita na plataforma. Feita fora daqui, use "Marcar como feita".';

/* ---------- Peças de formulário ---------- */

function Campo({
  id,
  rotulo: rotuloDoCampo,
  dica,
  erro,
  children,
}: {
  id: string;
  rotulo: string;
  dica?: string;
  erro?: string;
  children: ReactNode;
}) {
  return (
    <div className="yn-field">
      <label className="yn-label" htmlFor={id}>
        {rotuloDoCampo}
      </label>
      {children}
      {dica ? (
        <span className="yn-hint" id={`${id}-dica`}>
          {dica}
        </span>
      ) : null}
      {erro ? (
        <span className="yn-error" id={`${id}-erro`}>
          {erro}
        </span>
      ) : null}
    </div>
  );
}

/** aria-describedby e aria-invalid de um campo com dica e erro. */
function descrito(id: string, dica: boolean, erro: string | undefined) {
  const ids = [dica ? `${id}-dica` : null, erro ? `${id}-erro` : null].filter(Boolean).join(' ');
  return { 'aria-describedby': ids || undefined, 'aria-invalid': erro ? true : undefined };
}

function Niveis({
  rotulo: rotuloDoGrupo,
  valor,
  aoMudar,
}: {
  rotulo: string;
  valor: Level;
  aoMudar: (nivel: Level) => void;
}) {
  const id = useId();
  return (
    <div className="yn-field">
      <span className="yn-label" id={id}>
        {rotuloDoGrupo}
      </span>
      <div className="yn-segmented" role="group" aria-labelledby={id}>
        {opcoes('level').map((o) => (
          <button
            key={o.codigo}
            type="button"
            aria-pressed={valor === o.codigo}
            onClick={() => aoMudar(o.codigo)}
          >
            {o.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}

function FatosDaAcao({ item }: { item: ItemDeAcao }) {
  return (
    <dl className="yn-dl yn-dl--rows">
      <div>
        <dt>Quem propôs</dt>
        <dd>{rotulo('operator', item.proposedBy)}</dd>
      </div>
      <div>
        <dt>Marca e canal</dt>
        <dd>
          {rotulo('brand', item.brandId)}
          {item.platform ? ` · ${rotulo('platform', item.platform)}` : ''}
        </dd>
      </div>
      <div>
        <dt>Campanha</dt>
        <dd>{item.campanha?.nome ?? (item.kind === 'create' ? 'Campanha nova' : '')}</dd>
      </div>
      <div>
        <dt>Custo estimado</dt>
        <dd>{item.costCents === null ? '' : dinheiro(item.costCents)}</dd>
      </div>
    </dl>
  );
}

function AlertaDaAcao({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return (
    <div className="yn-alert" data-tone="warning">
      <TriangleAlert strokeWidth={1.75} aria-hidden="true" />
      <div>{texto}</div>
    </div>
  );
}

/* ---------- Aprovar e descartar ---------- */

export function JanelaAprovar({
  item,
  aoFechar,
  aoConfirmar,
}: {
  item: ItemDeAcao;
  aoFechar: () => void;
  aoConfirmar: () => void;
}) {
  const [gravando, setGravando] = useState(false);
  return (
    <Janela
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
      <p className="font-semibold">{item.title}</p>
      <FatosDaAcao item={item} />
      <AlertaDaAcao texto={item.alerta} />
      <p className="yn-muted text-sm">{NAO_EXECUTA}</p>
    </Janela>
  );
}

export function JanelaDescartar({
  item,
  aoFechar,
  aoConfirmar,
}: {
  item: ItemDeAcao;
  aoFechar: () => void;
  aoConfirmar: (motivo: string) => void;
}) {
  const id = useId();
  const [motivo, setMotivo] = useState('');
  const [tentou, setTentou] = useState(false);
  const [gravando, setGravando] = useState(false);
  const erro = tentou ? validarTexto(motivo, 10) : undefined;
  return (
    <Janela
      titulo="Descartar a proposta?"
      aoFechar={aoFechar}
      sujo={motivo.trim().length > 0}
      aoEnviar={() => {
        setTentou(true);
        if (validarTexto(motivo, 10) || gravando) return;
        setGravando(true);
        aoConfirmar(motivo.trim());
      }}
      confirmar={
        <button
          className="yn-btn yn-btn--danger"
          type="submit"
          disabled={gravando}
          aria-busy={gravando || undefined}
        >
          Descartar proposta
        </button>
      }
    >
      <p className="font-semibold">{item.title}</p>
      <Campo id={id} rotulo="Motivo (fica no diário de ações)" dica="Pelo menos 10 letras." erro={erro}>
        <textarea
          id={id}
          className="yn-input"
          data-foco-inicial
          required
          minLength={10}
          value={motivo}
          placeholder="Ex.: o limite da conta já está no fim este mês."
          {...descrito(id, true, erro)}
          onChange={(e) => setMotivo(e.target.value)}
        />
      </Campo>
    </Janela>
  );
}

/* ---------- Marcar como feita ---------- */

export function JanelaFeita({
  item,
  aoFechar,
  aoConfirmar,
}: {
  item: ItemDeAcao;
  aoFechar: () => void;
  aoConfirmar: (resultado: string) => void;
}) {
  const id = useId();
  const [resultado, setResultado] = useState('');
  const [tentou, setTentou] = useState(false);
  const [gravando, setGravando] = useState(false);
  const erro = tentou ? validarTexto(resultado, 5) : undefined;
  return (
    <Janela
      titulo="Marcar como feita?"
      aoFechar={aoFechar}
      sujo={resultado.trim().length > 0}
      aoEnviar={() => {
        setTentou(true);
        if (validarTexto(resultado, 5) || gravando) return;
        setGravando(true);
        aoConfirmar(resultado.trim());
      }}
      confirmar={
        <button
          className="yn-btn yn-btn--primary"
          type="submit"
          disabled={gravando}
          aria-busy={gravando || undefined}
        >
          <CircleCheck strokeWidth={1.75} aria-hidden="true" />
          Marcar como feita
        </button>
      }
    >
      <p className="font-semibold">{item.title}</p>
      <Campo
        id={id}
        rotulo="O que foi feito (fica no diário de ações)"
        dica="Onde e como, para quem ler depois. Pelo menos 5 letras."
        erro={erro}
      >
        <textarea
          id={id}
          className="yn-input"
          data-foco-inicial
          required
          value={resultado}
          placeholder={
            item.kind === 'pending_fix'
              ? 'Ex.: ID do GA4 preenchido na Vercel do site e publicado.'
              : 'Ex.: orçamento ajustado no gerenciador de anúncios.'
          }
          {...descrito(id, true, erro)}
          onChange={(e) => setResultado(e.target.value)}
        />
      </Campo>
    </Janela>
  );
}

/* ---------- Parar tudo (confirmação dupla) ---------- */

export function JanelaPararTudo({
  marca,
  claude,
  aoFechar,
  aoConfirmar,
}: {
  marca: Marca;
  claude: PainelDoTrafego['claude'];
  aoFechar: () => void;
  aoConfirmar: () => void;
}) {
  const id = useId();
  const [etapa, setEtapa] = useState<1 | 2>(1);
  const [entendi, setEntendi] = useState(false);
  const [gravando, setGravando] = useState(false);
  const caixa = useRef<HTMLInputElement>(null);
  const total = claude.ativas ?? 0;
  const onde = marca === 'todas' ? 'nas duas marcas' : `em ${rotuloMarca(marca)}`;

  // A janela é a mesma nas duas etapas: na segunda, o foco vai para a confirmação
  useEffect(() => {
    if (etapa === 2) caixa.current?.focus();
  }, [etapa]);
  const quantas = plural(total, 'campanha', 'campanhas');

  if (etapa === 1) {
    return (
      <Janela
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
          Pausa agora {total === 1 ? 'a campanha ativa' : `as ${total} campanhas ativas`} do Claude {onde}, em
          todos os canais. As campanhas do humano continuam.
        </p>
        <dl className="yn-dl yn-dl--rows">
          {claude.porCanal.map((c) => (
            <div key={c.canal}>
              <dt>{rotulo('platform', c.canal)}</dt>
              <dd>{plural(c.ativas, 'campanha ativa', 'campanhas ativas')}</dd>
            </div>
          ))}
        </dl>
      </Janela>
    );
  }

  return (
    <Janela
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
          ref={caixa}
          type="checkbox"
          checked={entendi}
          onChange={(e) => setEntendi(e.target.checked)}
        />
        Entendo que elas param de veicular agora e só voltam quando alguém reativar.
      </label>
      <p className="yn-muted text-sm">
        Fica no diário de ações, com quem parou e quando. Dá para desfazer logo depois.
      </p>
    </Janela>
  );
}

/* ---------- Limite de gasto da conta ---------- */

export function JanelaLimite({
  conta,
  nomeDoMes,
  aoFechar,
  aoConfirmar,
}: {
  conta: ContaDoTrafego;
  nomeDoMes: string;
  aoFechar: () => void;
  aoConfirmar: (novoCents: number) => void;
}) {
  const id = useId();
  const inicial = valorParaCampo(conta.limite);
  const [texto, setTexto] = useState(inicial);
  const [tentou, setTentou] = useState(false);
  const [gravando, setGravando] = useState(false);
  const novo = lerReais(texto);
  const invalido = novo === null || novo <= 0;
  const erro =
    tentou && invalido ? 'Escreva o limite em reais, maior que zero, como 15.000 ou 15.000,50.' : undefined;
  const abaixoDoGasto = !invalido && conta.gastoNoMes !== null && novo < conta.gastoNoMes;
  const nomeDaConta = `${rotulo('platform', conta.canal)} · ${rotulo('brand', conta.marca)}`;

  return (
    <Janela
      titulo={`Limite de ${nomeDaConta}`}
      aoFechar={aoFechar}
      sujo={texto !== inicial}
      aoEnviar={() => {
        setTentou(true);
        if (invalido || gravando) return;
        setGravando(true);
        aoConfirmar(novo);
      }}
      confirmar={
        <button
          className="yn-btn yn-btn--primary"
          type="submit"
          disabled={gravando}
          aria-busy={gravando || undefined}
        >
          <Wallet strokeWidth={1.75} aria-hidden="true" />
          Salvar limite
        </button>
      }
    >
      <dl className="yn-dl yn-dl--rows">
        <div>
          <dt>Limite de hoje</dt>
          <dd>{dinheiro(conta.limite)}</dd>
        </div>
        <div>
          <dt>Gasto em {nomeDoMes} até hoje</dt>
          <dd>{dinheiro(conta.gastoNoMes)}</dd>
        </div>
        <div>
          <dt>Campanhas ativas</dt>
          <dd>{conta.campanhasAtivas ?? ''}</dd>
        </div>
      </dl>
      <Campo
        id={id}
        rotulo="Novo limite do mês (R$)"
        dica="O limite da conta é a soma dos limites das campanhas ativas: cada uma muda na mesma proporção."
        erro={erro}
      >
        <input
          id={id}
          className="yn-input"
          inputMode="decimal"
          autoComplete="off"
          data-foco-inicial
          value={texto}
          {...descrito(id, true, erro)}
          onChange={(e) => setTexto(e.target.value)}
        />
      </Campo>
      {abaixoDoGasto ? (
        <div className="yn-alert" data-tone="warning" role="status">
          <TriangleAlert strokeWidth={1.75} aria-hidden="true" />
          <div>
            Fica abaixo do que a conta já gastou no mês ({dinheiro(conta.gastoNoMes)}): as campanhas param
            assim que a plataforma aplicar o limite.
          </div>
        </div>
      ) : null}
    </Janela>
  );
}

/* ---------- Estratégia da marca ---------- */

export function JanelaEstrategia({
  dados,
  aoFechar,
  aoConfirmar,
}: {
  dados: EstrategiaComNumeros;
  aoFechar: () => void;
  aoConfirmar: (campos: {
    texto: string;
    verbaDoMesCents: number | null;
    metaCustoPorClienteNovoCents: number | null;
    metaCustoPorLeadCents: number | null;
    metaClientesNovos: number | null;
  }) => void;
}) {
  const id = useId();
  const e = dados.estrategia;
  const inicial: CamposDaEstrategia = {
    texto: e?.texto ?? '',
    verba: valorParaCampo(e?.verbaDoMesCents),
    metaCustoPorClienteNovo: valorParaCampo(e?.metaCustoPorClienteNovoCents),
    metaCustoPorLead: valorParaCampo(e?.metaCustoPorLeadCents),
    metaClientesNovos: e?.metaClientesNovos ? String(e.metaClientesNovos) : '',
  };
  const [campos, setCampos] = useState<CamposDaEstrategia>(inicial);
  const [tentou, setTentou] = useState(false);
  const [gravando, setGravando] = useState(false);
  const erros = tentou ? validarEstrategia(campos) : {};
  const sujo = (Object.keys(inicial) as Array<keyof CamposDaEstrategia>).some(
    (k) => campos[k] !== inicial[k],
  );
  const mudar = (chave: keyof CamposDaEstrategia) => (evento: { target: { value: string } }) =>
    setCampos((atual) => ({ ...atual, [chave]: evento.target.value }));
  const diario = dados.orcamentoDiarioAtivas;
  const dicaDaVerba =
    diario === null
      ? 'Quanto a marca pode investir no mês, somando os canais.'
      : `As campanhas ativas somam ${dinheiro(diario)} por dia (${dinheiro(diario * 30)} em 30 dias).`;

  return (
    <Janela
      titulo={`Estratégia de ${rotulo('brand', dados.marca)}`}
      variante="drawer"
      aoFechar={aoFechar}
      sujo={sujo}
      aoEnviar={() => {
        setTentou(true);
        if (Object.keys(validarEstrategia(campos)).length > 0 || gravando) return;
        setGravando(true);
        aoConfirmar({
          texto: campos.texto.trim(),
          verbaDoMesCents: lerReais(campos.verba),
          metaCustoPorClienteNovoCents: lerReais(campos.metaCustoPorClienteNovo),
          metaCustoPorLeadCents: lerReais(campos.metaCustoPorLead),
          metaClientesNovos: lerInteiro(campos.metaClientesNovos),
        });
      }}
      confirmar={
        <button
          className="yn-btn yn-btn--primary"
          type="submit"
          disabled={gravando}
          aria-busy={gravando || undefined}
        >
          <NotebookPen strokeWidth={1.75} aria-hidden="true" />
          Salvar estratégia
        </button>
      }
    >
      <Campo
        id={`${id}-texto`}
        rotulo="Estratégia do mês"
        dica="Foco, canais, o que testar e o que evitar. O Claude lê antes de propor: não escreva nome, telefone ou documento de cliente."
        erro={erros.texto}
      >
        <textarea
          id={`${id}-texto`}
          className="yn-input"
          data-foco-inicial
          rows={6}
          value={campos.texto}
          placeholder="Ex.: foco em lojistas novos de pijama no Meta; TikTok só com vídeo curto; nada de campanha nova sem criativo aprovado."
          {...descrito(`${id}-texto`, true, erros.texto)}
          onChange={mudar('texto')}
        />
      </Campo>
      <Campo id={`${id}-verba`} rotulo="Verba do mês (R$)" dica={dicaDaVerba} erro={erros.verba}>
        <input
          id={`${id}-verba`}
          className="yn-input"
          inputMode="decimal"
          autoComplete="off"
          value={campos.verba}
          placeholder="A definir"
          {...descrito(`${id}-verba`, true, erros.verba)}
          onChange={mudar('verba')}
        />
      </Campo>
      <Campo
        id={`${id}-cpc`}
        rotulo="Meta de custo por cliente novo (R$)"
        dica="Deixe em branco até ter 4 semanas medidas."
        erro={erros.metaCustoPorClienteNovo}
      >
        <input
          id={`${id}-cpc`}
          className="yn-input"
          inputMode="decimal"
          autoComplete="off"
          value={campos.metaCustoPorClienteNovo}
          placeholder="A definir"
          {...descrito(`${id}-cpc`, true, erros.metaCustoPorClienteNovo)}
          onChange={mudar('metaCustoPorClienteNovo')}
        />
      </Campo>
      <Campo id={`${id}-cpl`} rotulo="Meta de custo por lead (R$)" erro={erros.metaCustoPorLead}>
        <input
          id={`${id}-cpl`}
          className="yn-input"
          inputMode="decimal"
          autoComplete="off"
          value={campos.metaCustoPorLead}
          placeholder="A definir"
          {...descrito(`${id}-cpl`, false, erros.metaCustoPorLead)}
          onChange={mudar('metaCustoPorLead')}
        />
      </Campo>
      <Campo id={`${id}-novos`} rotulo="Meta de clientes novos no mês" erro={erros.metaClientesNovos}>
        <input
          id={`${id}-novos`}
          className="yn-input"
          inputMode="numeric"
          autoComplete="off"
          value={campos.metaClientesNovos}
          placeholder="A definir"
          {...descrito(`${id}-novos`, false, erros.metaClientesNovos)}
          onChange={mudar('metaClientesNovos')}
        />
      </Campo>
    </Janela>
  );
}

/* ---------- Registrar ideia ---------- */

export interface NovaIdeia {
  titulo: string;
  motivo: string;
  marca: Brand;
  canal: Platform | null;
  tipo: ActionKind;
  campanha: string | null;
  impacto: Level;
  esforco: Level;
  custoCents: number | null;
}

export function JanelaIdeia({
  marcaInicial,
  canalInicial,
  campanhas,
  aoFechar,
  aoConfirmar,
}: {
  marcaInicial: Brand | null;
  canalInicial: Platform | null;
  campanhas: PainelDoTrafego['campanhas'];
  aoFechar: () => void;
  aoConfirmar: (ideia: NovaIdeia) => void;
}) {
  const id = useId();
  const inicial: CamposDaIdeia = {
    titulo: '',
    motivo: '',
    marca: marcaInicial ?? '',
    canal: canalInicial ?? '',
    tipo: '',
    campanha: '',
    impacto: 'medium',
    esforco: 'medium',
    custo: '',
  };
  const [campos, setCampos] = useState<CamposDaIdeia>(inicial);
  const [tentou, setTentou] = useState(false);
  const [gravando, setGravando] = useState(false);
  const erros = tentou ? validarIdeia(campos) : {};
  const sujo = campos.titulo.trim() !== '' || campos.motivo.trim() !== '' || campos.custo.trim() !== '';
  const definir = (parcial: Partial<CamposDaIdeia>) => setCampos((atual) => ({ ...atual, ...parcial }));
  const daConta = campanhas.filter(
    (c) =>
      c.status !== 'ended' &&
      (!campos.marca || c.marca === campos.marca) &&
      (!campos.canal || c.canal === campos.canal),
  );

  return (
    <Janela
      titulo="Registrar ideia"
      variante="drawer"
      aoFechar={aoFechar}
      sujo={sujo}
      aoEnviar={() => {
        setTentou(true);
        if (Object.keys(validarIdeia(campos)).length > 0 || gravando || !campos.marca || !campos.tipo) return;
        setGravando(true);
        aoConfirmar({
          titulo: campos.titulo.trim(),
          motivo: campos.motivo.trim(),
          marca: campos.marca,
          canal: campos.canal || null,
          tipo: campos.tipo,
          campanha: campos.campanha || null,
          impacto: campos.impacto,
          esforco: campos.esforco,
          custoCents: campos.custo.trim() ? lerReais(campos.custo) : null,
        });
      }}
      confirmar={
        <button
          className="yn-btn yn-btn--primary"
          type="submit"
          disabled={gravando}
          aria-busy={gravando || undefined}
        >
          <Plus strokeWidth={1.75} aria-hidden="true" />
          Registrar ideia
        </button>
      }
    >
      <p className="yn-muted text-sm">
        A ideia entra em "O que podemos fazer" e na fila de aprovação. Pendência de medição não entra na fila:
        resolva e marque como feita.
      </p>
      <Campo id={`${id}-titulo`} rotulo="O que fazer" erro={erros.titulo}>
        <input
          id={`${id}-titulo`}
          className="yn-input"
          data-foco-inicial
          autoComplete="off"
          value={campos.titulo}
          placeholder="Ex.: testar vídeo curto no TikTok da Plumene"
          {...descrito(`${id}-titulo`, false, erros.titulo)}
          onChange={(e) => definir({ titulo: e.target.value })}
        />
      </Campo>
      <Campo
        id={`${id}-motivo`}
        rotulo="Por quê"
        dica="Os números que justificam. Sem nome, telefone ou documento de cliente."
        erro={erros.motivo}
      >
        <textarea
          id={`${id}-motivo`}
          className="yn-input"
          value={campos.motivo}
          placeholder="Ex.: o vídeo de 15 s teve o dobro de cliques no Meta em outubro."
          {...descrito(`${id}-motivo`, true, erros.motivo)}
          onChange={(e) => definir({ motivo: e.target.value })}
        />
      </Campo>
      <Campo id={`${id}-marca`} rotulo="Marca" erro={erros.marca}>
        <select
          id={`${id}-marca`}
          className="yn-input"
          value={campos.marca}
          {...descrito(`${id}-marca`, false, erros.marca)}
          onChange={(e) => definir({ marca: e.target.value as CamposDaIdeia['marca'], campanha: '' })}
        >
          <option value="">Escolha a marca</option>
          {opcoes('brand').map((o) => (
            <option key={o.codigo} value={o.codigo}>
              {o.rotulo}
            </option>
          ))}
        </select>
      </Campo>
      <Campo id={`${id}-canal`} rotulo="Canal">
        <select
          id={`${id}-canal`}
          className="yn-input"
          value={campos.canal}
          onChange={(e) => definir({ canal: e.target.value as CamposDaIdeia['canal'], campanha: '' })}
        >
          <option value="">Nenhum (site, medição)</option>
          {opcoes('platform').map((o) => (
            <option key={o.codigo} value={o.codigo}>
              {o.rotulo}
            </option>
          ))}
        </select>
      </Campo>
      <Campo id={`${id}-tipo`} rotulo="Tipo de ação" erro={erros.tipo}>
        <select
          id={`${id}-tipo`}
          className="yn-input"
          value={campos.tipo}
          {...descrito(`${id}-tipo`, false, erros.tipo)}
          onChange={(e) => definir({ tipo: e.target.value as CamposDaIdeia['tipo'] })}
        >
          <option value="">Escolha o tipo</option>
          {opcoes('actionKind').map((o) => (
            <option key={o.codigo} value={o.codigo}>
              {o.rotulo}
            </option>
          ))}
        </select>
      </Campo>
      <Campo id={`${id}-campanha`} rotulo="Campanha (opcional)">
        <select
          id={`${id}-campanha`}
          className="yn-input"
          value={campos.campanha}
          onChange={(e) => definir({ campanha: e.target.value })}
        >
          <option value="">Nenhuma ou campanha nova</option>
          {daConta.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </Campo>
      <Niveis rotulo="Impacto" valor={campos.impacto} aoMudar={(impacto) => definir({ impacto })} />
      <Niveis rotulo="Esforço" valor={campos.esforco} aoMudar={(esforco) => definir({ esforco })} />
      <Campo
        id={`${id}-custo`}
        rotulo="Custo estimado (R$, opcional)"
        dica="Quanto a mais sai da verba em 30 dias. Em branco: sem estimativa."
        erro={erros.custo}
      >
        <input
          id={`${id}-custo`}
          className="yn-input"
          inputMode="decimal"
          autoComplete="off"
          value={campos.custo}
          {...descrito(`${id}-custo`, true, erros.custo)}
          onChange={(e) => definir({ custo: e.target.value })}
        />
      </Campo>
    </Janela>
  );
}

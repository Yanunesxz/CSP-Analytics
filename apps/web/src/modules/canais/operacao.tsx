/**
 * Blocos da visão Gestor de tráfego: a proposta no topo da fila do canal (.yn-decision), Humano ×
 * Claude lado a lado com a diferença em %, e verba e teto de cada conta com o botão de parar tudo.
 * A Visão só muda o que aparece; quem pode aprovar ou parar vem do papel (decisão 0011).
 */

import { Check, OctagonX } from 'lucide-react';
import { useId } from 'react';
import { Link } from 'react-router-dom';
import { rotulo, rotuloMarca, type TrafficAction } from '@csp-mkt/shared';
import { ChipSerie, Meter, Tabela, formatarValor, type Coluna } from '../../components/ui';
import type { ContaDoCanal, LinhaHumanoClaude, PainelDoCanal } from '../../data/queries/canais';
import { dataHora, dinheiro, numero, variacao } from '../../lib/format';
import type { Marca } from '../../lib/url-state';
import { avaliarDiferenca, fraseDaComparacao } from './formatos';

type EstadoDaTela = 'ok' | 'sem-dados';

/* ---------- Propostas do canal ---------- */

export function Propostas({
  propostas,
  estado,
  nome,
  nomeDaCampanha,
  podeAprovar,
  linkTrafego,
  aoAprovar,
  aoDescartar,
}: {
  propostas: TrafficAction[];
  estado: EstadoDaTela;
  nome: string;
  nomeDaCampanha: (id: string | null) => string | null;
  podeAprovar: boolean;
  /** Link para Tráfego com IA já filtrado no canal; null quando o papel não vê o módulo. */
  linkTrafego: string | null;
  aoAprovar: (acao: TrafficAction) => void;
  aoDescartar: (acao: TrafficAction) => void;
}) {
  const id = useId();
  const primeira = propostas[0];

  return (
    <section className="grid gap-4" aria-labelledby={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id}>Propostas para {nome}</h2>
        {linkTrafego && propostas.length > 0 ? (
          <Link to={linkTrafego} className="text-sm font-medium">
            {propostas.length > 1 ? `Ver as ${propostas.length} em Tráfego com IA` : 'Abrir Tráfego com IA'}
          </Link>
        ) : null}
      </div>

      {estado === 'sem-dados' ? (
        <p className="yn-muted text-sm">Sem dados de propostas no período.</p>
      ) : !primeira ? (
        <p className="yn-muted text-sm">Nenhuma proposta esperando aprovação neste canal.</p>
      ) : (
        <div className="yn-decision">
          <div className="yn-decision__head">
            <div>
              <p className="yn-eyebrow">{rotulo('actionKind', primeira.kind)}</p>
              <p className="yn-decision__title">{primeira.title}</p>
            </div>
            <span className="yn-muted text-sm">1 de {propostas.length}</span>
          </div>
          <p className="text-sm">{primeira.rationale}</p>
          <dl className="yn-dl">
            <div>
              <dt>Quem propôs</dt>
              <dd>
                <ChipSerie lista="operator" codigo={primeira.proposedBy} />
              </dd>
            </div>
            <div>
              <dt>Marca</dt>
              <dd>{rotulo('brand', primeira.brandId)}</dd>
            </div>
            <div>
              <dt>Campanha</dt>
              <dd>
                {nomeDaCampanha(primeira.campaignId) ?? (primeira.kind === 'create' ? 'Campanha nova' : '')}
              </dd>
            </div>
            <div>
              <dt>Custo estimado</dt>
              <dd>{primeira.costCents === null ? '' : dinheiro(primeira.costCents)}</dd>
            </div>
            <div>
              <dt>Impacto · esforço</dt>
              <dd>
                {rotulo('level', primeira.impact)} · {rotulo('level', primeira.effort)}
              </dd>
            </div>
            <div>
              <dt>Proposta em</dt>
              <dd>{dataHora(primeira.createdAt)}</dd>
            </div>
          </dl>
          {podeAprovar ? (
            <div className="yn-decision__actions">
              <button
                className="yn-btn yn-btn--secondary"
                type="button"
                onClick={() => aoDescartar(primeira)}
              >
                Descartar
              </button>
              <button className="yn-btn yn-btn--primary" type="button" onClick={() => aoAprovar(primeira)}>
                <Check strokeWidth={1.75} aria-hidden="true" />
                Aprovar
              </button>
            </div>
          ) : (
            <p className="yn-muted text-sm">Só o dono aprova propostas.</p>
          )}
        </div>
      )}
    </section>
  );
}

/* ---------- Humano × Claude ---------- */

function Diferenca({ linha }: { linha: LinhaHumanoClaude }) {
  if (linha.diferenca === null) return <>—</>;
  const avaliacao = avaliarDiferenca(linha.diferenca, linha.sentido);
  return (
    <span
      className={
        avaliacao === 'melhor' ? 'text-tone-success' : avaliacao === 'pior' ? 'text-tone-danger' : undefined
      }
    >
      {variacao(linha.diferenca)}
      {avaliacao ? (
        <span className="yn-sr-only">{avaliacao === 'melhor' ? ' (Claude melhor)' : ' (Claude pior)'}</span>
      ) : null}
    </span>
  );
}

const COLUNAS_HUMANO_X_CLAUDE: Coluna<LinhaHumanoClaude>[] = [
  { chave: 'metrica', titulo: 'Métrica', render: (l) => l.rotulo },
  {
    chave: 'humano',
    titulo: 'Humano',
    numerica: true,
    render: (l) => formatarValor(l.humano, l.formato),
  },
  {
    chave: 'claude',
    titulo: 'Claude',
    numerica: true,
    render: (l) => formatarValor(l.claude, l.formato),
  },
  { chave: 'diferenca', titulo: 'Diferença', numerica: true, render: (l) => <Diferenca linha={l} /> },
];

export function HumanoXClaude({ linhas, nome }: { linhas: LinhaHumanoClaude[]; nome: string }) {
  const id = useId();
  const frase = fraseDaComparacao(linhas);
  return (
    <section className="grid content-start gap-4" aria-labelledby={id}>
      <div>
        <h2 id={id}>Humano × Claude</h2>
        <p className="yn-muted text-sm">
          {frase ?? `A mesma linha de números para os dois em ${nome}, no período.`} Diferença = Claude em
          relação ao humano.
        </p>
      </div>
      <Tabela
        colunas={COLUNAS_HUMANO_X_CLAUDE}
        linhas={linhas}
        chaveDaLinha={(l) => l.chave}
        empilhar
        legenda={`Humano × Claude em ${nome}`}
      />
    </section>
  );
}

/* ---------- Verba e teto da conta + parar tudo ---------- */

function Conta({ conta }: { conta: ContaDoCanal }) {
  const marca = rotulo('brand', conta.marca);
  if (conta.campanhasAtivas === 0) {
    return (
      <div className="grid gap-1">
        <p className="text-sm font-semibold">{marca}</p>
        <p className="yn-muted text-sm">Nenhuma campanha ativa nesta conta.</p>
      </div>
    );
  }
  const perto = conta.uso !== null && conta.uso >= 0.9;
  return (
    <div className="grid gap-3">
      <Meter
        rotulo={marca}
        valor={conta.investimento}
        maximo={conta.teto !== null && conta.teto > 0 ? conta.teto : null}
        formato={(v) => dinheiro(v)}
        estado={perto ? 'behind' : undefined}
        legenda={{
          esquerda: conta.investimento === null ? 'Sem dados' : `${dinheiro(conta.investimento)} no período`,
          direita: conta.teto ? `teto de ${dinheiro(conta.teto)}` : 'Sem teto',
        }}
      />
      {perto ? (
        <p className="text-sm text-tone-warning">
          Perto do teto: a plataforma para as campanhas quando ele acaba.
        </p>
      ) : null}
      <dl className="yn-dl">
        <div>
          <dt>Verba diária</dt>
          <dd>{dinheiro(conta.verbaDiaria)}</dd>
        </div>
        <div>
          <dt>Teto de gasto</dt>
          <dd>{dinheiro(conta.teto)}</dd>
        </div>
        <div>
          <dt>Campanhas ativas</dt>
          <dd>
            {conta.campanhasAtivas === null
              ? ''
              : `${numero(conta.campanhasAtivas)} (${numero(conta.ativasDoClaude)} do Claude)`}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function VerbaETeto({
  contas,
  nome,
  marca,
  pararTudo,
  podeParar,
  aoParar,
}: {
  contas: ContaDoCanal[];
  nome: string;
  marca: Marca;
  pararTudo: PainelDoCanal['pararTudo'];
  podeParar: boolean;
  aoParar: () => void;
}) {
  const id = useId();
  const ativasDoClaude = pararTudo.total ?? 0;
  return (
    <section className="grid content-start gap-4" aria-labelledby={id}>
      <div>
        <h2 id={id}>Verba e teto da conta</h2>
        <p className="yn-muted text-sm">
          Campanhas ativas de {nome}. O uso do teto conta o que elas investiram no período.
        </p>
      </div>
      <div className="yn-card grid gap-5">
        <div className="mkt-grid-2">
          {contas.map((conta) => (
            <Conta key={conta.marca} conta={conta} />
          ))}
        </div>
        {podeParar ? (
          <div className="grid gap-3 border-t border-line pt-4">
            <p className="text-sm">
              Parar tudo pausa na hora as campanhas ativas do Claude em todos os canais
              {marca === 'todas' ? ', nas duas marcas' : ` de ${rotuloMarca(marca)}`}. As do humano continuam.
            </p>
            <div>
              <button
                className="yn-btn yn-btn--danger"
                type="button"
                disabled={ativasDoClaude === 0}
                onClick={aoParar}
              >
                <OctagonX strokeWidth={1.75} aria-hidden="true" />
                Parar tudo do Claude
              </button>
            </div>
            {ativasDoClaude === 0 ? (
              <p className="yn-muted text-sm">Nenhuma campanha do Claude ativa agora.</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

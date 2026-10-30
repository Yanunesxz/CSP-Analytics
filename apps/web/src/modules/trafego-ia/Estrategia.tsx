/**
 * Estratégia do humano por marca: o texto do mês (que o Claude lê antes de propor), a verba e as metas,
 * com o que já aconteceu no mês até hoje ao lado. Meta sem valor é "A definir" (nunca inventada); a meta
 * de custo por cliente novo só se fixa depois de 4 semanas medidas.
 */

import { NotebookPen, Pencil } from 'lucide-react';
import { useId, useState } from 'react';
import { cor, rotulo } from '@csp-mkt/shared';
import { Badge, Meter, PontoDeSerie, useToast } from '../../components/ui';
import type { EstrategiaComNumeros, LinhaDaMeta, PainelDoTrafego } from '../../data/queries/trafego-ia';
import { dataHora, dinheiro, numero } from '../../lib/format';
import { salvarEstrategia } from './estado';
import { JanelaEstrategia } from './janelas';
import { usePermissoesDoTrafego } from './permissoes';
import { nomeDoMes } from './regras';

function formatar(linha: LinhaDaMeta, valor: number): string {
  return linha.formato === 'dinheiro' ? dinheiro(valor) : numero(valor);
}

/** "Meta R$ 180" (+ "· dentro da meta" quando vai bem; quando pede atenção, o selo diz). */
function textoDaMeta(linha: LinhaDaMeta): string {
  if (linha.meta === null) return 'Meta a definir';
  const meta = `Meta ${formatar(linha, linha.meta)}`;
  return linha.situacao?.tom === 'success' ? `${meta} · ${linha.situacao.texto.toLowerCase()}` : meta;
}

function Metas({ metas }: { metas: LinhaDaMeta[] }) {
  return (
    <dl className="yn-dl">
      {metas.map((m) => (
        <div key={m.chave}>
          <dt>{m.rotulo} no mês</dt>
          <dd className="grid justify-items-start gap-1">
            <span className={m.atual === null ? 'yn-muted' : 'font-semibold'}>
              {m.atual === null ? 'Sem dados' : formatar(m, m.atual)}
            </span>
            <span className="yn-muted text-xs">{textoDaMeta(m)}</span>
            {m.situacao && m.situacao.tom !== 'success' ? (
              <Badge tom={m.situacao.tom}>{m.situacao.texto}</Badge>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Cartao({
  dados,
  mes,
  podeEditar,
  aoEditar,
}: {
  dados: EstrategiaComNumeros;
  mes: string;
  podeEditar: boolean;
  aoEditar: () => void;
}) {
  const id = useId();
  const e = dados.estrategia;
  const verba = dados.metas.find((m) => m.chave === 'verba');
  const outras = dados.metas.filter((m) => m.chave !== 'verba');
  const problema = verba?.situacao && verba.situacao.tom !== 'success' ? verba.situacao : null;

  return (
    <article className="yn-card grid content-start gap-4" aria-labelledby={id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <h3 id={id} className="flex items-center gap-2">
            <PontoDeSerie cor={cor('brand', dados.marca)} />
            {rotulo('brand', dados.marca)}
          </h3>
          <p className="yn-muted m-0 text-xs">
            {e
              ? `Atualizada em ${dataHora(e.atualizadaEm)}${dados.atualizadaPor ? ` por ${dados.atualizadaPor}` : ''}`
              : 'Ainda não escrita'}
          </p>
        </div>
        {podeEditar ? (
          <button
            className="yn-btn yn-btn--secondary yn-btn--sm"
            type="button"
            aria-haspopup="dialog"
            onClick={aoEditar}
          >
            {e ? (
              <Pencil strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <NotebookPen strokeWidth={1.75} aria-hidden="true" />
            )}
            {e ? 'Editar estratégia' : 'Escrever estratégia'}
          </button>
        ) : null}
      </div>

      {e?.texto ? (
        <p className="m-0 whitespace-pre-line text-sm" style={{ overflowWrap: 'anywhere' }}>
          {e.texto}
        </p>
      ) : (
        <p className="yn-muted m-0 text-sm">
          Nenhuma estratégia escrita para esta marca. Escreva o foco do mês: o Claude lê antes de propor.
        </p>
      )}

      {verba && verba.meta !== null ? (
        <div className="grid gap-2">
          <Meter
            rotulo={`Verba de ${mes}`}
            valor={verba.atual}
            maximo={verba.meta}
            formato={(v) => dinheiro(v)}
            // Sem "esperado": para gasto, ficar abaixo do ritmo é bom, e a régua pintaria de atenção.
            // A régua não tem tom de perigo: acima ou perto da verba ela fica em atenção e o selo diz qual.
            estado={problema ? 'behind' : undefined}
            legenda={{
              esquerda: verba.atual === null ? 'Sem dados' : `${dinheiro(verba.atual)} investidos`,
              direita: `de ${dinheiro(verba.meta)}`,
            }}
          />
          <p className="yn-muted m-0 text-sm">
            {dados.verba.projecao === null
              ? 'Sem gasto no mês para projetar.'
              : `No ritmo de hoje, ${mes} fecha em ${dinheiro(dados.verba.projecao)}.`}{' '}
            {problema ? <Badge tom={problema.tom}>{problema.texto}</Badge> : null}
          </p>
        </div>
      ) : (
        <p className="yn-muted m-0 text-sm">
          Verba de {mes} a definir.
          {dados.orcamentoDiarioAtivas !== null
            ? ` As campanhas ativas somam ${dinheiro(dados.orcamentoDiarioAtivas)} por dia; investido até hoje: ${dinheiro(dados.investidoNoMes)}.`
            : ''}
        </p>
      )}

      <Metas metas={outras} />
    </article>
  );
}

export function Estrategias({ painel }: { painel: PainelDoTrafego }) {
  const { perfilId, podeOperar } = usePermissoesDoTrafego();
  const { avisar } = useToast();
  const [editando, setEditando] = useState<EstrategiaComNumeros | null>(null);
  const mes = nomeDoMes(painel.mes.inicio);

  return (
    <section className="mkt-stack" aria-labelledby="trafego-estrategia">
      <div className="grid gap-1">
        <h2 id="trafego-estrategia">Estratégia por marca</h2>
        <p className="yn-muted m-0 text-sm">
          O que o humano decidiu para o mês: o foco, a verba e as metas. O Claude lê antes de propor. Os
          números são de {mes} até hoje, qualquer que seja o período escolhido.
        </p>
      </div>
      {painel.estrategias.map((e) => (
        <Cartao key={e.marca} dados={e} mes={mes} podeEditar={podeOperar} aoEditar={() => setEditando(e)} />
      ))}
      {editando ? (
        <JanelaEstrategia
          dados={editando}
          aoFechar={() => setEditando(null)}
          aoConfirmar={(campos) => {
            salvarEstrategia(editando.marca, campos, perfilId);
            setEditando(null);
            avisar(`Estratégia de ${rotulo('brand', editando.marca)} salva.`);
          }}
        />
      ) : null}
    </section>
  );
}

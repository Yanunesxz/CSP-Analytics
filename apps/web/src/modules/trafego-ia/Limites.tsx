/**
 * Limites de gasto por conta (marca × canal), no mês corrente: o gasto até hoje contra o limite, com a
 * marca do "esperado hoje" e a projeção do mês. "Mudar limite" (só o dono) reparte o novo valor entre as
 * campanhas ativas da conta, na mesma proporção, e anota no diário (decisão 0005: teto por conta).
 */

import { Wallet } from 'lucide-react';
import { useState } from 'react';
import { rotulo } from '@csp-mkt/shared';
import { Badge, Meter, useToast } from '../../components/ui';
import type { ContaDoTrafego, PainelDoTrafego } from '../../data/queries/trafego-ia';
import { dinheiro, plural } from '../../lib/format';
import { definirLimiteDaConta } from './estado';
import { JanelaLimite } from './janelas';
import { usePermissoesDoTrafego } from './permissoes';
import { nomeDoMes } from './regras';

const SELO: Record<'acima' | 'vai_passar', { texto: string; tom: 'danger' | 'warning' }> = {
  acima: { texto: 'Passou do limite', tom: 'danger' },
  vai_passar: { texto: 'Vai passar do limite', tom: 'warning' },
};

function Conta({
  conta,
  mes,
  podeMudar,
  aoMudar,
}: {
  conta: ContaDoTrafego;
  mes: string;
  podeMudar: boolean;
  aoMudar: () => void;
}) {
  const selo = conta.situacao && conta.situacao !== 'no_ritmo' ? SELO[conta.situacao] : null;
  const nome = rotulo('platform', conta.canal);
  return (
    <li className="yn-card grid content-start gap-3">
      <Meter
        rotulo={nome}
        valor={conta.gastoNoMes}
        maximo={conta.limite}
        formato={(v) => dinheiro(v)}
        // Sem "esperado": para gasto, ficar abaixo do ritmo é bom, e a régua pintaria de atenção.
        // A régua não tem tom de perigo: acima ou perto do limite ela fica em atenção e o selo diz qual.
        estado={selo ? 'behind' : undefined}
        legenda={{
          esquerda: conta.gastoNoMes === null ? 'Sem dados' : `${dinheiro(conta.gastoNoMes)} gastos`,
          direita: conta.limite === null ? 'Sem campanha ativa' : `de ${dinheiro(conta.limite)}`,
        }}
      />
      <p className="yn-muted m-0 text-sm">
        {conta.limite === null
          ? 'Sem campanha ativa nesta conta: não há limite para acompanhar.'
          : conta.projecao === null
            ? 'Sem gasto no mês para projetar.'
            : `No ritmo de hoje, ${mes} fecha em ${dinheiro(conta.projecao)}.`}
      </p>
      {conta.campanhasAtivas !== null && conta.campanhasAtivas > 0 ? (
        <p className="yn-muted m-0 text-sm">
          {plural(conta.campanhasAtivas, 'campanha ativa', 'campanhas ativas')}
          {conta.ativasDoClaude ? `, ${conta.ativasDoClaude} do Claude` : ''}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {selo ? <Badge tom={selo.tom}>{selo.texto}</Badge> : <span />}
        {podeMudar && conta.limite !== null ? (
          <button
            className="yn-btn yn-btn--secondary yn-btn--sm"
            type="button"
            aria-haspopup="dialog"
            aria-label={`Mudar limite de ${nome} · ${rotulo('brand', conta.marca)}`}
            onClick={aoMudar}
          >
            <Wallet strokeWidth={1.75} aria-hidden="true" />
            Mudar limite
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function Limites({ painel }: { painel: PainelDoTrafego }) {
  const { perfilId, podeMudarLimite } = usePermissoesDoTrafego();
  const { avisar } = useToast();
  const [mudando, setMudando] = useState<ContaDoTrafego | null>(null);
  const mes = nomeDoMes(painel.mes.inicio);
  const marcas = [...new Set(painel.contas.map((c) => c.marca))];

  return (
    <section className="mkt-stack" aria-labelledby="trafego-limites">
      <div className="grid gap-1">
        <h2 id="trafego-limites">Limites de gasto por conta</h2>
        <p className="yn-muted m-0 text-sm">
          Gasto de {mes} até hoje (dia {painel.mes.diasDecorridos} de {painel.mes.diasNoMes}) contra o limite
          de cada conta, e onde o mês fecha se o ritmo continuar.
          {podeMudarLimite ? '' : ' Quem muda o limite é o dono.'}
        </p>
      </div>
      {marcas.map((marca) => (
        <div key={marca} className="grid gap-2">
          <h3 id={`trafego-limites-${marca}`}>{rotulo('brand', marca)}</h3>
          <ul className="mkt-grid-kpis m-0 list-none p-0" aria-labelledby={`trafego-limites-${marca}`}>
            {painel.contas
              .filter((c) => c.marca === marca)
              .map((c) => (
                <Conta
                  key={`${c.marca}-${c.canal}`}
                  conta={c}
                  mes={mes}
                  podeMudar={podeMudarLimite}
                  aoMudar={() => setMudando(c)}
                />
              ))}
          </ul>
        </div>
      ))}
      {mudando ? (
        <JanelaLimite
          conta={mudando}
          nomeDoMes={mes}
          aoFechar={() => setMudando(null)}
          aoConfirmar={(novoCents) => {
            const feito = definirLimiteDaConta(mudando.marca, mudando.canal, novoCents, perfilId);
            setMudando(null);
            avisar(
              feito
                ? `Limite de ${rotulo('platform', mudando.canal)} · ${rotulo('brand', mudando.marca)} salvo.`
                : 'A conta não tem campanha ativa: o limite não mudou.',
            );
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * Visão Gestor de tráfego: verba e limite de gasto de cada conta de anúncio (marca × plataforma),
 * com o investimento do período contra a soma dos limites das campanhas ativas (decisão 0005).
 * Uma linha por marca, um cartão por plataforma. "Perto do limite" e "Acima do limite" vêm em
 * texto; a cor só reforça.
 */

import { Link } from 'react-router-dom';
import { pode, rotulo } from '@csp-mkt/shared';
import { Badge, Meter } from '../../components/ui';
import type { ContaDeAnuncio } from '../../data/queries/visao-geral';
import { useSessao } from '../../lib/auth';
import { useFiltros } from '../../lib/url-state';
import { gastoDaConta, limiteDaConta, seloDoLimite, verbaDaConta } from './textos';

function Conta({ conta }: { conta: ContaDeAnuncio }) {
  const verba = verbaDaConta(conta);
  const selo = seloDoLimite(conta.alerta);
  return (
    <li className="yn-card grid content-start gap-3">
      <Meter
        rotulo={rotulo('platform', conta.canal)}
        valor={conta.investimento}
        maximo={conta.limite}
        // A régua não tem tom de perigo: perto ou acima do limite ela fica em atenção, e o selo diz qual
        estado={selo ? 'behind' : undefined}
        legenda={{ esquerda: gastoDaConta(conta), direita: limiteDaConta(conta) }}
      />
      {verba ? <p className="yn-muted text-sm">{verba}</p> : null}
      {selo ? (
        <span className="justify-self-start">
          <Badge tom={selo.tom}>{selo.texto}</Badge>
        </span>
      ) : null}
    </li>
  );
}

export function VerbaELimite({ contas }: { contas: ContaDeAnuncio[] }) {
  const { perfil } = useSessao();
  const { linkCom } = useFiltros();
  if (contas.length === 0) return null;
  const marcas = [...new Set(contas.map((c) => c.marca))];
  return (
    <section className="mkt-stack" aria-labelledby="visao-geral-verba">
      <div className="grid gap-1">
        <h2 id="visao-geral-verba">Verba e limite de gasto por conta</h2>
        <p className="yn-muted text-sm">
          Investimento do período nas campanhas ativas de cada conta, contra a soma dos limites de gasto
          delas.
          {/* O próximo passo de "Perto do limite" e "Acima do limite": onde o limite muda */}
          {pode(perfil?.role, 'ver_trafego_ia') ? (
            <>
              {' '}
              <Link className="font-medium" to={linkCom('/trafego?aba=limites')}>
                Ver limites em Tráfego com IA
              </Link>
            </>
          ) : null}
        </p>
      </div>
      {marcas.map((marca) => (
        <div key={marca} className="grid gap-2">
          <h3 id={`visao-geral-verba-${marca}`}>{rotulo('brand', marca)}</h3>
          <ul className="mkt-grid-kpis" role="list" aria-labelledby={`visao-geral-verba-${marca}`}>
            {contas
              .filter((c) => c.marca === marca)
              .map((c) => (
                <Conta key={`${c.marca}-${c.canal}`} conta={c} />
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

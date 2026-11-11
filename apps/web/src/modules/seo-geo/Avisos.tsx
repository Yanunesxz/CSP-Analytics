/**
 * Avisos da tela SEO e GEO (.yn-alert), cada um perto do que explica:
 * - o aviso fixo de que a medição de GEO é parcial (sempre, no topo da seção de assistentes de IA);
 * - o conector da seção caído ou atrasado (Search Console, GA4, CSP 360). Conector a ligar ou desligado não
 *   vira aviso: o selo ("A ligar", "Desligado") no canto da seção já diz, e a faixa do modo demonstração também;
 * - na visão Gestor de tráfego, as pendências que travam a medição e por que aqui não há Humano × Claude.
 */

import { CloudOff, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { pode, rotulo } from '@csp-mkt/shared';
import type { FonteDoPainel, PendenciaDeMedicao } from '../../data/queries/seo-geo';
import { useSessao } from '../../lib/auth';
import { useFiltros } from '../../lib/url-state';
import { textoDaUltimaSincronizacao } from './textos';

interface AvisoProps {
  tom: 'info' | 'warning' | 'danger';
  icone: LucideIcon;
  titulo: string;
  children: ReactNode;
}

function Aviso({ tom, icone: Icone, titulo, children }: AvisoProps) {
  return (
    <div className="yn-alert" data-tone={tom} role={tom === 'info' ? undefined : 'status'}>
      <Icone strokeWidth={1.75} aria-hidden="true" />
      <div>
        <strong className="yn-alert__title">{titulo}</strong>
        {children}
      </div>
    </div>
  );
}

/** Fixo: o que a seção de GEO mede e o que fica de fora. */
export function AvisoGeoParcial() {
  return (
    <Aviso tom="info" icone={Info} titulo="A medição de GEO é parcial">
      Entram aqui só as visitas e os leads que chegaram clicando num assistente de IA: quando a IA cita a
      marca e a pessoa não clica, nada aparece. As impressões em AI Overviews e no AI Mode só existem no
      relatório &ldquo;Generative AI performance&rdquo; do Search Console, sem API. Confira uma vez por mês em
      Abrir o Search Console.
    </Aviso>
  );
}

export interface AvisoDoConectorProps {
  /** "Search Console", "GA4", "CSP 360". */
  nome: string;
  cartao: FonteDoPainel | null;
}

/** O conector da seção caído ou atrasado. Funcionando, a ligar, desligado ou sem cartão, não aparece. */
export function AvisoDoConector({ nome, cartao }: AvisoDoConectorProps) {
  const { linkCom } = useFiltros();
  const { perfil } = useSessao();
  if (!cartao || (cartao.status !== 'down' && cartao.status !== 'late')) return null;

  const link = pode(perfil?.role, 'ver_conectores') ? (
    <>
      {' '}
      <Link to={linkCom('/conectores')}>Ver conectores</Link>
    </>
  ) : null;
  const ultima = textoDaUltimaSincronizacao(cartao.lastSyncAt);

  if (cartao.status === 'down') {
    return (
      <Aviso tom="danger" icone={CloudOff} titulo={`O ${nome} parou de sincronizar`}>
        {cartao.lastSyncAt ? `${ultima} Os números desta seção são dessa sincronização.` : ultima}
        {link}
      </Aviso>
    );
  }
  return (
    <Aviso tom="warning" icone={TriangleAlert} titulo={`O ${nome} está atrasado`}>
      {ultima} Os números desta seção podem estar desatualizados.
      {link}
    </Aviso>
  );
}

/** Visão Gestor de tráfego: o que trava a medição e onde ficam operador e verba. */
export function AvisoDoGestor({ pendencias }: { pendencias: PendenciaDeMedicao[] }) {
  const { linkCom } = useFiltros();
  const { perfil } = useSessao();

  if (pendencias.length === 0) {
    return (
      <Aviso tom="info" icone={Info} titulo="SEO e GEO não têm operador nem verba">
        Humano × Claude e o limite de gasto ficam nos anúncios.{' '}
        <Link to={linkCom('/canais/google')}>Ver Google Ads</Link>
      </Aviso>
    );
  }

  return (
    <Aviso tom="warning" icone={TriangleAlert} titulo="Pendências que travam a medição">
      <ul className="mt-1 list-disc pl-5">
        {pendencias.map((p) => (
          <li key={p.id}>
            {p.titulo} · {rotulo('brand', p.marca)}
          </li>
        ))}
      </ul>
      <p className="mt-1">
        Busca orgânica e assistentes de IA não têm operador nem verba: Humano × Claude e o limite de gasto
        ficam nos anúncios.
        {pode(perfil?.role, 'ver_trafego_ia') ? (
          <>
            {' '}
            <Link to={linkCom('/trafego')}>Ver em Tráfego com IA</Link>
          </>
        ) : null}
      </p>
    </Aviso>
  );
}

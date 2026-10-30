/**
 * Avisos da tela Instagram (.yn-alert), no topo do conteúdo e só quando acontecem:
 * conector atrasado ou caído, nenhum número do Instagram ainda e, na visão Gestor de tráfego,
 * onde ficam o Humano × Claude e a verba (o Instagram orgânico não tem operador).
 */

import { CloudOff, Info, Plug, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { pode } from '@csp-mkt/shared';
import type { PainelInstagram } from '../../data/queries/instagram';
import { useSessao } from '../../lib/auth';
import { dataHora } from '../../lib/format';
import { useFiltros } from '../../lib/url-state';

interface Aviso {
  chave: string;
  tom: 'info' | 'warning' | 'danger';
  icone: LucideIcon;
  titulo: string;
  texto: ReactNode;
}

export function Avisos({ painel }: { painel: PainelInstagram }) {
  const { filtros, linkCom } = useFiltros();
  const { perfil } = useSessao();
  const verConectores = pode(perfil?.role, 'ver_conectores');

  const linkConectores = verConectores ? (
    <>
      {' '}
      <Link to={linkCom('/conectores')}>Ver conectores</Link>
    </>
  ) : null;

  const ultima = painel.conector?.lastSyncAt
    ? `A última sincronização foi em ${dataHora(painel.conector.lastSyncAt)}.`
    : 'O conector ainda não sincronizou.';

  const avisos: Aviso[] = [];

  if (painel.conector?.status === 'down') {
    avisos.push({
      chave: 'caido',
      tom: 'danger',
      icone: CloudOff,
      titulo: 'O Instagram parou de sincronizar',
      texto: (
        <>
          {painel.conector.lastSyncAt ? `${ultima} Os números abaixo são dessa sincronização.` : ultima}
          {linkConectores}
        </>
      ),
    });
  } else if (painel.conector?.status === 'late') {
    avisos.push({
      chave: 'atrasado',
      tom: 'warning',
      icone: TriangleAlert,
      titulo: 'O Instagram está atrasado',
      texto: (
        <>
          {ultima} Os números podem estar desatualizados.
          {linkConectores}
        </>
      ),
    });
  } else if (!painel.temDados) {
    avisos.push({
      chave: 'sem-numeros',
      tom: 'info',
      icone: Plug,
      titulo: 'O Instagram ainda não mandou números',
      texto: (
        <>
          Os números dos perfis aparecem aqui depois que o conector do Instagram sincronizar.
          {linkConectores}
        </>
      ),
    });
  }

  if (filtros.visao === 'gestor') {
    avisos.push({
      chave: 'gestor',
      tom: 'info',
      icone: Info,
      titulo: 'Post orgânico não tem operador nem verba',
      texto: (
        <>
          Humano × Claude e o limite de gasto ficam nos anúncios. Os anúncios no Instagram são da Meta.{' '}
          <Link to={linkCom('/canais/meta')}>Ver Meta Ads</Link>
        </>
      ),
    });
  }

  if (avisos.length === 0) return null;

  return (
    <div className="mkt-stack" style={{ gap: 'var(--space-3)' }}>
      {avisos.map(({ chave, tom, icone: Icone, titulo, texto }) => (
        <div key={chave} className="yn-alert" data-tone={tom} role={tom === 'info' ? undefined : 'status'}>
          <Icone strokeWidth={1.75} aria-hidden="true" />
          <div>
            <strong className="yn-alert__title">{titulo}</strong>
            {texto}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Avisos da Base de clientes (.yn-alert), no topo do conteúdo e só quando acontecem: réplica do
 * CSP 360 atrasada ou parada (a base inteira vem dela), CSP 360 sem a situação dos clientes e, na
 * visão Gestor de tráfego, onde ficam o Humano × Claude e a verba (a base não tem operador).
 */

import { CloudOff, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { pode } from '@csp-mkt/shared';
import type { PainelDaBase } from '../../data/queries/base-de-clientes';
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

export function Avisos({ painel }: { painel: PainelDaBase }) {
  const { filtros, linkCom } = useFiltros();
  const { perfil } = useSessao();

  const linkConectores = pode(perfil?.role, 'ver_conectores') ? (
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
      titulo: 'O CSP 360 parou de sincronizar',
      texto: (
        <>
          {ultima} Os clientes e pedidos abaixo são dessa sincronização.
          {linkConectores}
        </>
      ),
    });
  } else if (painel.conector?.status === 'late') {
    avisos.push({
      chave: 'atrasado',
      tom: 'warning',
      icone: TriangleAlert,
      titulo: 'O CSP 360 está atrasado',
      texto: (
        <>
          {ultima} Os pedidos mais novos podem não aparecer aqui.
          {linkConectores}
        </>
      ),
    });
  }

  if (painel.total !== null && !painel.situacaoConhecida) {
    avisos.push({
      chave: 'sem-situacao',
      tom: 'info',
      icone: Info,
      titulo: 'O CSP 360 ainda não envia a situação dos clientes',
      texto:
        'Ativos, inativos e perdidos aparecem quando o CSP 360 mandar a régua de cada marca. A última compra de cada cliente já está na lista.',
    });
  }

  if (filtros.visao === 'gestor') {
    avisos.push({
      chave: 'gestor',
      tom: 'info',
      icone: Info,
      titulo: 'A base não tem operador nem verba',
      texto: (
        <>
          Humano × Claude e o custo por cliente novo ficam em Chegada de clientes e nos canais.{' '}
          <Link to={linkCom('/chegada')}>Ver chegada de clientes</Link>
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

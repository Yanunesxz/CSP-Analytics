/**
 * Uma rota para os três canais pagos: /canais/meta, /canais/tiktok, /canais/google.
 * A plataforma vem de `useParams()`; endereço com outra plataforma mostra "Esse canal não existe".
 * `key` recomeça a tela (janelas abertas) ao trocar de canal pelo menu.
 */

import { Link, useParams } from 'react-router-dom';
import { rotulo } from '@csp-mkt/shared';
import { PageHeader } from '../../components/layout/pagina';
import { Vazio } from '../../components/ui';
import { PLATAFORMAS } from '../../data/queries/canais';
import { useFiltros } from '../../lib/url-state';
import { TelaDoCanal } from './TelaDoCanal';

function CanalNaoEncontrado() {
  const { linkCom } = useFiltros();
  return (
    <>
      <PageHeader grupo="Canais" titulo="Canal não encontrado" />
      <Vazio
        titulo="Esse canal não existe"
        texto="O endereço pode ter mudado. Escolha um dos canais pagos."
        acao={
          <div className="mkt-actions justify-center">
            {PLATAFORMAS.map((p) => (
              <Link key={p} className="yn-btn yn-btn--secondary" to={linkCom(`/canais/${p}`)}>
                Ver {rotulo('platform', p)}
              </Link>
            ))}
          </div>
        }
      />
    </>
  );
}

export default function Canais() {
  const { plataforma } = useParams();
  const canal = PLATAFORMAS.find((p) => p === plataforma);
  if (!canal) return <CanalNaoEncontrado />;
  return <TelaDoCanal key={canal} plataforma={canal} />;
}

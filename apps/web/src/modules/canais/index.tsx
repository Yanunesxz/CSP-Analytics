import { useParams } from 'react-router-dom';
import { rotulo, type Platform } from '@csp-mkt/shared';
import { PageHeader } from '../../components/layout/pagina';
import { EmConstrucao } from '../../components/ui/EmConstrucao';
import { Vazio } from '../../components/ui/Vazio';

const PLATAFORMAS: readonly Platform[] = ['meta', 'tiktok', 'google'];

/** Uma rota para os três canais pagos: /canais/meta, /canais/tiktok, /canais/google. */
export default function Canais() {
  const { plataforma } = useParams();
  const canal = PLATAFORMAS.find((p) => p === plataforma);
  if (!canal) {
    return (
      <>
        <PageHeader grupo="Canais" titulo="Canal não encontrado" />
        <Vazio titulo="Esse canal não existe" texto="Escolha Meta Ads, TikTok Ads ou Google Ads no menu." />
      </>
    );
  }
  return (
    <>
      <PageHeader grupo="Canais" titulo={rotulo('platform', canal)} />
      <EmConstrucao oQueVaiTer="Investimento, impressões, cliques, CTR, CPC, CPL, leads, conversões e ROAS por campanha, separados por operador Humano × Claude." />
    </>
  );
}

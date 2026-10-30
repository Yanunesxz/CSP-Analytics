import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/layout/pagina';
import { Vazio } from '../../components/ui/Vazio';
import { useFiltros } from '../../lib/url-state';

export default function NaoEncontrada() {
  const { linkCom } = useFiltros();
  return (
    <>
      <PageHeader grupo="" titulo="Página não encontrada" />
      <Vazio
        titulo="Essa página não existe"
        texto="O endereço pode ter mudado. Volte para a Visão geral."
        acao={
          <Link className="yn-btn yn-btn--secondary" to={linkCom('/')}>
            Ir para a Visão geral
          </Link>
        }
      />
    </>
  );
}

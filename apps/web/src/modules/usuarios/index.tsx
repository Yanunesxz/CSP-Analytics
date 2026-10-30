import { PageHeader } from '../../components/layout/pagina';
import { EmConstrucao } from '../../components/ui/EmConstrucao';

export default function Usuarios() {
  return (
    <>
      <PageHeader grupo="Sistema" titulo="Usuários" />
      <EmConstrucao oQueVaiTer="Papéis e permissões (dono, gestor de tráfego), convite por e-mail; na v1 só o dono cadastrado." />
    </>
  );
}

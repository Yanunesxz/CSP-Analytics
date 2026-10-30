import { PageHeader } from '../../components/layout/pagina';
import { EmConstrucao } from '../../components/ui/EmConstrucao';

export default function BaseDeClientes() {
  return (
    <>
      <PageHeader grupo="Clientes" titulo="Base de clientes" />
      <EmConstrucao oQueVaiTer="Ativos, inativos e perdidos pela régua do CRM, recompra, reativados e receita de antigos × novos, com link para a ficha 360." />
    </>
  );
}

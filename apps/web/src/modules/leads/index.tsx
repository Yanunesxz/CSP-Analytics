import { PageHeader } from '../../components/layout/pagina';
import { EmConstrucao } from '../../components/ui/EmConstrucao';

export default function Leads() {
  return (
    <>
      <PageHeader grupo="Clientes" titulo="Leads" />
      <EmConstrucao oQueVaiTer="Leads por marca e origem (anúncio, site, busca orgânica, assistentes de IA, SDR), sem dado pessoal: só código, origem, marca, data e o link para a ficha 360." />
    </>
  );
}

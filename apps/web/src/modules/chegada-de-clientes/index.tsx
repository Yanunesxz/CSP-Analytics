import { PageHeader } from '../../components/layout/pagina';
import { EmConstrucao } from '../../components/ui/EmConstrucao';

export default function ChegadaDeClientes() {
  return (
    <>
      <PageHeader grupo="Clientes" titulo="Chegada de clientes" />
      <EmConstrucao oQueVaiTer="Funil lead → prospecto → cadastro → 1º pedido enviado → faturado, por marca, origem, período e representante; coorte por mês." />
    </>
  );
}

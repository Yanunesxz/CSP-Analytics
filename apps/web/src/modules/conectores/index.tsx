import { PageHeader } from '../../components/layout/pagina';
import { EmConstrucao } from '../../components/ui/EmConstrucao';

export default function Conectores() {
  return (
    <>
      <PageHeader grupo="Sistema" titulo="Conectores" />
      <EmConstrucao oQueVaiTer="Um cartão por integração: estado, última sincronização, atraso, erros nas últimas 24 h, linhas gravadas e “Tentar de novo”." />
    </>
  );
}

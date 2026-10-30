import { PageHeader } from '../../components/layout/pagina';
import { EmConstrucao } from '../../components/ui/EmConstrucao';

export default function VisaoGeral() {
  return (
    <>
      <PageHeader grupo="Início" titulo="Visão geral" />
      <EmConstrucao oQueVaiTer="KPIs por marca e por canal: leads, clientes novos, custo por cliente novo, investimento, pedidos e alcance. Cada número leva à tela que o trabalha." />
    </>
  );
}

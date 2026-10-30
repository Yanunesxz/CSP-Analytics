/**
 * Instagram (/instagram), só leitura na v1: por perfil (Corpo Sensual, Plumene; "As duas" mostra
 * os dois lado a lado) seguidores e saldo no período, alcance, impressões, engajamento e salvos;
 * seguidores e alcance por dia; e os posts do período por alcance e engajamento.
 *
 * Toda conta vem de `painelInstagram` (data/queries/instagram.ts). A marca vem do menu, o período
 * da barra de filtros, a visão do topo; tudo na URL. `?estado=` é honrado por useConsulta + Tela.
 */

import { Camera } from 'lucide-react';
import { PageHeader } from '../../components/layout/pagina';
import { BarraDeFiltros, Tela } from '../../components/ui';
import { painelInstagram, type PainelInstagram } from '../../data/queries/instagram';
import { useConsulta } from '../../data/store';
import { useFiltros } from '../../lib/url-state';
import { Avisos } from './Avisos';
import { Graficos } from './Graficos';
import { Perfis } from './Perfis';
import { Posts } from './Posts';

export default function Instagram() {
  const r = useConsulta(painelInstagram);

  return (
    <>
      <PageHeader
        grupo="Canais"
        titulo="Instagram"
        atualizadoEm={r.dados?.conector?.lastSyncAt ?? r.atualizadoEm}
      />
      {/* O Instagram só se filtra por marca (menu) e período: não há canal, campanha nem operador. */}
      <BarraDeFiltros campos={[]} />
      <Tela
        resultado={r}
        esqueleto="tela"
        vazio={{
          icone: Camera,
          titulo: 'Nenhum número do Instagram ainda',
          texto: 'Os números dos perfis aparecem aqui depois que o conector do Instagram sincronizar.',
        }}
      >
        {(painel, estado) => <Conteudo painel={painel} estado={estado} />}
      </Tela>
    </>
  );
}

function Conteudo({ painel, estado }: { painel: PainelInstagram; estado: 'ok' | 'sem-dados' }) {
  const { filtros } = useFiltros();
  const deltaTexto = filtros.comparar ? painel.intervalo.rotuloAnterior : undefined;

  return (
    <>
      <Avisos painel={painel} />
      <Perfis perfis={painel.perfis} deltaTexto={deltaTexto} />
      <Graficos perfis={painel.perfis} estado={estado} />
      <Posts posts={painel.posts} mostrarMarca={filtros.marca === 'todas'} estado={estado} />
    </>
  );
}

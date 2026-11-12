/**
 * Resumo simples (rota /resumo): uma tela para mandar a quem não trabalha com marketing. Diz, em
 * frases e em quatro números, quanto foi gasto em anúncio, o que esse gasto trouxe (pessoas
 * interessadas e clientes novos), quanto custou cada cliente novo e quanto voltou; depois, para onde
 * o dinheiro foi (canal, marca e campanha por campanha) e o que cada palavra quer dizer.
 *
 * Os números são os mesmos da Visão geral e da Chegada de clientes (tarefa T1), com outro nome.
 * A tela só lê: a única ação é copiar o link, com a marca e o período, para enviar.
 */

import { Copy } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { PageHeader } from '../../components/layout/pagina';
import { BarraDeFiltros, Tela, useToast } from '../../components/ui';
import { resumoSimples } from '../../data/queries/resumo-simples';
import { useConsulta } from '../../data/store';
import { EmPoucasPalavras } from './EmPoucasPalavras';
import { Numeros } from './Numeros';
import { OndeFoiGasto } from './OndeFoiGasto';
import { Palavras } from './Palavras';
import { Campanhas, PorCanalEMarca } from './Tabelas';
import { linkDoResumo } from './textos';

export default function ResumoSimples() {
  const resultado = useConsulta(resumoSimples);
  const { avisar } = useToast();
  const { marca, periodo, comparar } = resultado.filtros;

  const copiarLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(linkDoResumo(window.location.origin, { marca, periodo, comparar }));
      avisar('Link copiado. Cole na conversa para enviar.');
    } catch {
      avisar('Não deu para copiar: copie o endereço da barra do navegador.', { tom: 'danger' });
    }
  }, [marca, periodo, comparar, avisar]);

  const acao = useMemo(
    () => (
      <button className="yn-btn yn-btn--secondary" type="button" onClick={copiarLink}>
        <Copy strokeWidth={1.75} aria-hidden="true" />
        Copiar link
      </button>
    ),
    [copiarLink],
  );

  return (
    <>
      <PageHeader grupo="Início" titulo="Resumo simples" acao={acao} atualizadoEm={resultado.atualizadoEm} />
      <BarraDeFiltros campos={[]} />
      <Tela
        resultado={resultado}
        vazio={{
          titulo: 'Nenhum número ainda',
          texto:
            'O resumo aparece quando os conectores trazem os primeiros dados. Veja o que falta ligar em Conectores.',
        }}
      >
        {(r, estado) => (
          <>
            <EmPoucasPalavras r={r} filtros={resultado.filtros} />
            <Numeros r={r} />
            <OndeFoiGasto r={r} semDados={estado === 'sem-dados'} />
            <PorCanalEMarca r={r} />
            <Campanhas r={r} semDados={estado === 'sem-dados'} />
            <Palavras />
          </>
        )}
      </Tela>
    </>
  );
}

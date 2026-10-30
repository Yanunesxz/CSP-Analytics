/**
 * Marcador de módulo ainda não desenhado (fase 2). O agente do módulo substitui por telas reais.
 */

import { Construction } from 'lucide-react';
import { Vazio } from './Vazio';

export function EmConstrucao({ oQueVaiTer }: { oQueVaiTer?: string }) {
  return (
    <Vazio
      icone={Construction}
      titulo="Em construção"
      texto={oQueVaiTer ?? 'Esta tela chega na próxima entrega da fase 2.'}
    />
  );
}

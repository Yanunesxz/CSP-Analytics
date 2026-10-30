/**
 * Quebra por marca (só com "As duas" no menu): leads do período, quantos viraram cliente,
 * conversão e tempo até o 1º pedido em cada marca. O lead sem marca (SDR) entra nas duas
 * (decisão 0003), então a soma das marcas pode passar do total.
 */

import { Tags } from 'lucide-react';
import { cor, rotulo } from '@csp-mkt/shared';
import { PontoDeSerie, Vazio } from '../../components/ui';
import type { ChegadaDeClientes } from '../../data/queries/chegada-de-clientes';
import { numero, percentual } from '../../lib/format';
import { Bloco, dias } from './partes';

export interface PorMarcaProps {
  linhas: ChegadaDeClientes['porMarca'];
  semMarca: number | null;
  /** Estado "sem dados" da tela. */
  semDados: boolean;
}

export function PorMarca({ linhas, semMarca, semDados }: PorMarcaProps) {
  if (semDados) {
    return (
      <Bloco titulo="Por marca" descricao="Leads do período e quantos já viraram cliente em cada marca.">
        <Vazio icone={Tags} titulo="Sem dados" texto="Nenhum lead no período." />
      </Bloco>
    );
  }
  return (
    <Bloco titulo="Por marca" descricao="Leads do período e quantos já viraram cliente em cada marca.">
      <div className="mkt-grid-2">
        {linhas.map((m) => (
          <div key={m.marca} className="grid content-start gap-3">
            <h3 className="flex items-center gap-2">
              <PontoDeSerie cor={cor('brand', m.marca)} />
              {rotulo('brand', m.marca)}
            </h3>
            <dl className="yn-dl">
              <div>
                <dt>Leads</dt>
                <dd>{numero(m.leads)}</dd>
              </div>
              <div>
                <dt>Viraram cliente</dt>
                <dd>{numero(m.viraramCliente)}</dd>
              </div>
              <div>
                <dt>Conversão</dt>
                <dd>{percentual(m.conversao)}</dd>
              </div>
              <div>
                <dt>Do lead ao 1º pedido</dt>
                <dd>{dias(m.diasAtePedido)}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
      {semMarca ? (
        <p className="yn-muted text-sm">
          {semMarca === 1
            ? 'O lead sem marca (SDR · WhatsApp) entra nas duas marcas.'
            : `Os ${numero(semMarca)} leads sem marca (SDR · WhatsApp) entram nas duas marcas.`}
        </p>
      ) : null}
    </Bloco>
  );
}

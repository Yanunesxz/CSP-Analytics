/**
 * Representante como dimensão (não é módulo na v1): leads que cada um recebeu no período, quantos
 * viraram cliente, conversão e tempo até o 1º pedido. Ordena por quem mais converteu.
 */

import { UserX, Users } from 'lucide-react';
import { Tabela, Vazio, type Coluna } from '../../components/ui';
import type { ChegadaDeClientes } from '../../data/queries/chegada-de-clientes';
import { numero, percentual } from '../../lib/format';
import { Bloco, dias } from './partes';

type Linha = ChegadaDeClientes['porRepresentante'][number];

const colunas: Coluna<Linha>[] = [
  { chave: 'representante', titulo: 'Representante', valor: (r) => r.representante },
  { chave: 'leads', titulo: 'Leads', numerica: true, valor: (r) => r.leads, render: (r) => numero(r.leads) },
  {
    chave: 'viraram',
    titulo: 'Viraram cliente',
    numerica: true,
    valor: (r) => r.viraramCliente,
    render: (r) => numero(r.viraramCliente),
  },
  {
    chave: 'conversao',
    titulo: 'Conversão',
    numerica: true,
    valor: (r) => r.conversao,
    render: (r) => percentual(r.conversao),
  },
  {
    chave: 'dias',
    titulo: 'Até o 1º pedido',
    numerica: true,
    valor: (r) => r.diasAtePedido,
    render: (r) => dias(r.diasAtePedido),
  },
];

export interface PorRepresentanteProps {
  linhas: Linha[];
  semRepresentante: number | null;
  semDados: boolean;
}

export function PorRepresentante({ linhas, semRepresentante, semDados }: PorRepresentanteProps) {
  return (
    <Bloco
      titulo="Por representante"
      descricao="Leads que cada representante recebeu no período, quantos já viraram cliente e em quantos dias, em média."
    >
      {semDados ? (
        <Vazio icone={Users} titulo="Sem dados" texto="Nenhum lead no período." />
      ) : (
        <Tabela
          empilhar
          legenda="Conversão de leads por representante"
          colunas={colunas}
          linhas={linhas}
          chaveDaLinha={(r) => r.representante}
          ordenacaoInicial={{ chave: 'viraram', direcao: 'desc' }}
          vazio={
            <Vazio
              icone={UserX}
              titulo="Nenhum lead com representante"
              texto="Os leads deste período ainda não foram passados para um representante."
            />
          }
        />
      )}
      {!semDados && semRepresentante ? (
        <p className="yn-muted text-sm">
          {semRepresentante === 1
            ? '1 lead do período ainda está sem representante.'
            : `${numero(semRepresentante)} leads do período ainda estão sem representante.`}
        </p>
      ) : null}
    </Bloco>
  );
}

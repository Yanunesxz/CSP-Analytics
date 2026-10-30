/**
 * Coorte por mês de chegada: leads de cada mês e quantos já viraram cliente até hoje.
 * Os meses mais novos ainda estão convertendo; a tabela não se ordena para manter a linha do tempo.
 */

import { CalendarRange } from 'lucide-react';
import { Tabela, Vazio, type Coluna } from '../../components/ui';
import type { ChegadaDeClientes } from '../../data/queries/chegada-de-clientes';
import { mesAno, numero, percentual } from '../../lib/format';
import { Bloco } from './partes';

type Mes = ChegadaDeClientes['coorte'][number];

const colunas: Coluna<Mes>[] = [
  { chave: 'mes', titulo: 'Mês de chegada', ordenavel: false, render: (m) => mesAno(`${m.mes}-01`) },
  { chave: 'leads', titulo: 'Leads', numerica: true, ordenavel: false, render: (m) => numero(m.leads) },
  {
    chave: 'viraram',
    titulo: 'Viraram cliente',
    numerica: true,
    ordenavel: false,
    render: (m) => numero(m.viraramCliente),
  },
  {
    chave: 'conversao',
    titulo: 'Conversão',
    numerica: true,
    ordenavel: false,
    render: (m) => percentual(m.conversao),
  },
];

export function Coorte({ meses, semDados }: { meses: Mes[]; semDados: boolean }) {
  const semBase = semDados || meses.every((m) => m.leads === null);
  return (
    <Bloco
      titulo="Coorte por mês de chegada"
      descricao="Leads de cada mês e quantos já viraram cliente até hoje. Os meses mais novos ainda estão convertendo."
    >
      {semBase ? (
        <Vazio icone={CalendarRange} titulo="Sem dados" texto="Nenhum lead nos últimos meses." />
      ) : (
        <Tabela
          empilhar
          legenda="Coorte de leads por mês de chegada"
          colunas={colunas}
          linhas={meses}
          chaveDaLinha={(m) => m.mes}
        />
      )}
    </Bloco>
  );
}

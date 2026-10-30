/**
 * Quem tem acesso ao sistema: pessoa, e-mail e papel, com "Você" na linha de quem está usando.
 * Vira cards abaixo de 640px de área (.yn-table--stack; o título do card é a pessoa).
 * Sem ações na linha na v1: só o dono existe, e ninguém muda o próprio papel (seção 10 do padrão).
 */

import { UsersRound } from 'lucide-react';
import { useMemo } from 'react';
import { rotulo, type Profile } from '@csp-mkt/shared';
import { Badge, Tabela, Vazio, type Coluna } from '../../components/ui';
import type { Usuarios } from '../../data/queries/sistema';
import { iniciais } from '../../lib/auth';

export interface ListaDeUsuariosProps {
  usuarios: Usuarios;
  /** Quem está usando o sistema agora, para marcar "Você". */
  idDoPerfil: string | null;
  /** `?estado=sem-dados`: a lista não tem base. */
  semDados: boolean;
}

export function ListaDeUsuarios({ usuarios, idDoPerfil, semDados }: ListaDeUsuariosProps) {
  const colunas = useMemo<Coluna<Profile>[]>(
    () => [
      {
        chave: 'pessoa',
        titulo: 'Pessoa',
        render: (p) => (
          <span className="inline-flex min-w-0 flex-wrap items-center gap-3">
            <span className="yn-avatar" aria-hidden="true">
              {iniciais(p.name)}
            </span>
            <span className="whitespace-normal">{p.name}</span>
            {p.id === idDoPerfil ? <Badge>Você</Badge> : null}
          </span>
        ),
      },
      {
        chave: 'email',
        titulo: 'E-mail',
        render: (p) => <span className="whitespace-normal wrap-anywhere">{p.email}</span>,
      },
      { chave: 'papel', titulo: 'Papel', render: (p) => rotulo('role', p.role) },
    ],
    [idDoPerfil],
  );

  return (
    <Tabela
      colunas={colunas}
      linhas={usuarios.lista}
      chaveDaLinha={(p) => p.id}
      empilhar
      legenda="Pessoas com acesso ao sistema"
      vazio={
        <div className="yn-card">
          {semDados ? (
            <Vazio
              icone={UsersRound}
              titulo="Sem dados"
              texto="A lista aparece quando o cadastro de acessos estiver disponível."
            />
          ) : (
            <Vazio
              icone={UsersRound}
              titulo="Nenhum usuário cadastrado"
              texto="Convide quem vai usar o sistema em Convidar, no topo da tela."
            />
          )}
        </div>
      }
    />
  );
}

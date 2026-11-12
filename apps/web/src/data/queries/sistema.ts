/**
 * Sistema (rotas /usuarios e /configuracoes): consultas puras, com teste em `sistema.test.ts`.
 *
 * - `usuarios(dados)`: quem tem acesso, com o dono primeiro, e quantas pessoas há em cada papel. Na fase 3
 *   vira a leitura de `profiles` (a RLS deixa só o dono listar todos; cada pessoa lê o próprio perfil).
 * - `quadroDePermissoes()`: o que cada papel pode e não pode fazer, tirado de `permissoes()` de
 *   `@csp-mkt/shared` — a mesma regra que esconde o item do menu, protege a rota e, na fase 3, a RLS.
 *   A tela nunca mantém uma segunda lista de permissões (decisão 0011).
 *
 * Convenções de `queries.ts`: contagem sobre tabela vazia = null ("Sem dados"); sobre tabela com linhas,
 * 0 ou mais.
 *
 * `ROTULO_DA_ACAO` e `RESUMO_DO_PAPEL` são texto de tela de listas fechadas de `packages/shared`: moram
 * aqui porque o agente deste módulo não mexe em `labels.ts`. Quando a fundação puder, vão para lá como
 * a lista `acao` (anotado como pendência).
 */

import { opcoes, permissoes, rotulo, type Acao, type Profile, type Role } from '@csp-mkt/shared';
import type { Dados } from '../dados';
import { contagem } from '../queries';

/* ---------- Papéis e permissões ---------- */

/** Papéis na ordem de `labels.ts` (dono primeiro). */
export const PAPEIS: readonly Role[] = opcoes('role').map((o) => o.codigo);

/**
 * O que cada ação permite, em português, na ordem em que aparece na tela. `Record<Acao, …>` obriga a
 * rotular toda ação nova de `rules.ts` (o TypeScript reclama se faltar uma).
 */
export const ROTULO_DA_ACAO: Readonly<Record<Acao, string>> = {
  ver_numeros: 'Ver os números de marketing',
  ver_resumo: 'Ver o Resumo simples',
  ver_leads: 'Ver a lista de leads, sem dado pessoal',
  ver_lead_dado_pessoal: 'Ver nome, telefone e e-mail de lead',
  ver_trafego_ia: 'Abrir o Tráfego com IA',
  operar_trafego_ia: 'Operar o Tráfego com IA',
  aprovar_acao: 'Aprovar ações do Claude',
  parar_tudo: 'Parar todas as campanhas do Claude',
  ver_conectores: 'Ver os conectores',
  tentar_conector_de_novo: 'Tentar um conector de novo',
  gerir_usuarios: 'Convidar pessoas e definir papéis',
  ver_diagnostico: 'Abrir o Diagnóstico',
  editar_configuracoes: 'Mudar tema, marca padrão e avisos',
};

/** Todas as ações, na ordem da tela. */
export const ACOES: readonly Acao[] = Object.keys(ROTULO_DA_ACAO) as Acao[];

/** Por que uma ação não é de ninguém. */
const NOTA_DA_ACAO: Partial<Record<Acao, string>> = {
  ver_lead_dado_pessoal: 'Ninguém vê aqui: a ficha do lead fica no CSP 360.',
};

/** Uma frase por papel, para o cartão do papel, o convite e "Sua conta". */
export const RESUMO_DO_PAPEL: Readonly<Record<Role, string>> = {
  owner: 'Vê e faz tudo: aprova as ações do Claude e cuida dos acessos.',
  traffic_manager: 'Vê os números e opera o Tráfego com IA.',
  summary_viewer: 'Vê só o Resumo simples: quanto foi gasto, onde e quantos clientes novos vieram.',
};

export interface PermissaoNoQuadro {
  acao: Acao;
  rotulo: string;
  /** Explica por que ninguém tem a permissão. */
  nota?: string;
}

export interface PapelNoQuadro {
  papel: Role;
  /** "Dono", "Gestor de tráfego" (de `labels.ts`). */
  rotulo: string;
  resumo: string;
  pode: PermissaoNoQuadro[];
  naoPode: PermissaoNoQuadro[];
}

function permissaoNoQuadro(acao: Acao): PermissaoNoQuadro {
  return { acao, rotulo: ROTULO_DA_ACAO[acao], nota: NOTA_DA_ACAO[acao] };
}

/** O que cada papel pode e não pode fazer, direto de `permissoes()`. */
export function quadroDePermissoes(): PapelNoQuadro[] {
  return PAPEIS.map((papel) => {
    const permitidas = permissoes(papel);
    return {
      papel,
      rotulo: rotulo('role', papel),
      resumo: RESUMO_DO_PAPEL[papel],
      pode: ACOES.filter((acao) => permitidas.includes(acao)).map(permissaoNoQuadro),
      naoPode: ACOES.filter((acao) => !permitidas.includes(acao)).map(permissaoNoQuadro),
    };
  });
}

/* ---------- Usuários ---------- */

export interface Usuarios {
  /** Dono primeiro; dentro do mesmo papel, por nome. */
  lista: Profile[];
  /** Pessoas com acesso; null quando o cadastro de acessos está vazio (sem base). */
  total: number | null;
  /** Pessoas por papel; null quando o cadastro está vazio. */
  porPapel: Record<Role, number | null>;
}

function ordemDoPapel(papel: Role): number {
  const indice = PAPEIS.indexOf(papel);
  return indice === -1 ? PAPEIS.length : indice;
}

/**
 * Quem tem acesso ao sistema. Não depende de marca nem de período: perfil não tem marca (decisão 0003).
 * Assinatura compatível com `useConsulta` (filtros e agora não são usados).
 */
export function usuarios(dados: Dados): Usuarios {
  const perfis = dados.profiles;
  const lista = [...perfis].sort(
    (a, b) => ordemDoPapel(a.role) - ordemDoPapel(b.role) || a.name.localeCompare(b.name, 'pt-BR'),
  );
  const porPapel = {} as Record<Role, number | null>;
  for (const papel of PAPEIS) {
    porPapel[papel] = contagem(
      perfis,
      perfis.filter((p) => p.role === papel),
    );
  }
  return { lista, total: contagem(perfis, perfis), porPapel };
}

// O caminho de busca das funções (RLS-27; docs/dados/papeis-e-rls.md, "Funções de ação"; achado alto da revisão de
// 10/11/2026). Com search_path vazio, o Postgres procura primeiro no esquema temporário da sessão os nomes de tipo e
// de tabela sem esquema: um serviço com conexão própria criava no pg_temp um domain uuid ou text com um check que
// chama uma função dele, e a função security definer que usa o tipo rodava o check como o dono das funções. Com
// search_path = pg_catalog, pg_temp, o catálogo vem antes e o pg_temp por último. Aqui, como cada serviço: a
// armadilha da prova armada (o controle mostra que ela dispara na sessão do serviço), as funções security definer
// que o papel executa chamadas com dados de verdade e, uma a uma, com nulos; e o check nunca roda como outro papel.
// Dados inventados de fixtures/usuarios.sql, marketing.sql, trafego.sql e conectores.sql.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type PapelDeServico,
  type Sessao,
  abrirBanco,
  aplicarFixture,
  caso,
  erroDoBanco,
  postgres,
  servico,
} from './apoio/banco';
import { ESQUEMAS } from './apoio/catalogo';
import { FUNIL_ANTIGO_DE_LEADS } from './apoio/marketing';
import { ACAO_APROVADA } from './apoio/trafego';

let db: PGlite;

beforeAll(async () => {
  db = await abrirBanco();
  for (const f of ['usuarios', 'marketing', 'trafego', 'conectores']) await aplicarFixture(db, f);
});

afterAll(async () => {
  await db.close();
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Os tipos do catálogo que o corpo das funções usa sem esquema (os outros são qualificados ou palavras do SQL). */
const TIPOS = ['date', 'jsonb', 'regproc', 'text', 'timestamptz', 'uuid'] as const;

/**
 * A armadilha da prova: um domain no pg_temp com o nome de cada tipo e um check que anota quem rodou. A sequência
 * conta o check rodado como outro papel e não volta no rollback do savepoint de uma chamada recusada. Tudo com
 * pg_catalog na frente: depois dos domain, "text" sem esquema, na sessão do serviço, já é o do pg_temp.
 */
const ARMADILHA = `
  create table pg_temp.disparos (tipo pg_catalog.text, quem pg_catalog.text, sessao pg_catalog.text);
  create sequence pg_temp.como_outro;
  create function pg_temp.anotar(p_tipo pg_catalog.text) returns pg_catalog.bool
  language plpgsql as $f$
  begin
    if current_user <> session_user then
      perform pg_catalog.nextval('pg_temp.como_outro'::pg_catalog.regclass);
    end if;
    insert into pg_temp.disparos values (p_tipo, current_user, session_user);
    return true;
  end $f$;
  ${TIPOS.map((t) => `create domain pg_temp.${t} as pg_catalog.${t} check (pg_temp.anotar('${t}'));`).join('\n  ')}
`;

/** Quantas vezes o check rodou como outro papel, e como quem (o que ficou anotado fora de um savepoint desfeito). */
async function comoOutroPapel(s: Sessao): Promise<{ vezes: number; quem: string[] }> {
  const vezes = await s.valor<number | null>(
    `select pg_catalog.pg_sequence_last_value('pg_temp.como_outro'::pg_catalog.regclass)`,
  );
  const quem = await s.linhas<{ q: string }>(
    `select distinct d.tipo || ' como ' || d.quem as q from pg_temp.disparos d where d.quem <> d.sessao order by 1`,
  );
  return { vezes: vezes ?? 0, quem: quem.map((l) => l.q) };
}

/** Chama num savepoint: a recusa da função (nulos, estado) é esperada e não importa aqui; erro de fora do banco segue. */
async function chamarSemParar(s: Sessao, sql: string): Promise<void> {
  await s.exec('savepoint chamada');
  try {
    await s.linhas(sql);
    await s.exec('release savepoint chamada');
  } catch (e) {
    erroDoBanco(e);
    await s.exec('rollback to savepoint chamada; release savepoint chamada');
  }
}

/** As funções security definer dos sete esquemas que o papel executa, cada uma com nulos do tipo de cada argumento. */
async function definerDoPapel(papel: PapelDeServico): Promise<{ funcao: string; chamada: string }[]> {
  return caso(db, postgres, (s) =>
    s.linhas<{ funcao: string; chamada: string }>(
      `select p.oid::regprocedure::text as funcao,
              format('select %I.%I(%s)', n.nspname, p.proname, coalesce((
                select string_agg(format('null::%s', case when t.typcategory = 'A' and t.typelem <> 0
                                                          then format('%I.%I[]', en.nspname, e.typname)
                                                          else format('%I.%I', tn.nspname, t.typname) end),
                                  ', ' order by a.i)
                  from unnest(p.proargtypes::oid[]) with ordinality as a(tipo, i)
                  join pg_type t on t.oid = a.tipo
                  join pg_namespace tn on tn.oid = t.typnamespace
                  left join pg_type e on e.oid = t.typelem
                  left join pg_namespace en on en.oid = e.typnamespace), '')) as chamada
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = any($1) and p.prosecdef and p.prokind = 'f'
          and has_function_privilege($2, p.oid, 'execute')
        order by 1`,
      [ESQUEMAS, papel],
    ),
  );
}

type PapelComDefiner = Exclude<PapelDeServico, 'n8n_notifier'>;

/** O caminho de verdade de cada papel (a prova da revisão): grava, e os gatilhos das tabelas rodam junto. */
const CHAMADAS: Record<PapelComDefiner, { funcoes: string[]; chamar: (s: Sessao) => Promise<void> }> = {
  mkt_worker: {
    funcoes: ['ingest.start_run', 'ingest.finish_run'],
    async chamar(s) {
      const rodada = await s.valor<string>(`select ingest.start_run('meta', 'ads_hourly')`);
      expect(rodada).toMatch(UUID);
      expect(await s.valor(`select (ingest.finish_run($1, 'succeeded')).status`, [rodada])).toBe('succeeded');
    },
  },
  mkt_executor: {
    funcoes: ['ingest.set_action_progress'],
    async chamar(s) {
      expect(
        await s.valor(`select (ingest.set_action_progress($1, 'running')).status`, [ACAO_APROVADA]),
      ).toBe('running');
    },
  },
  mkt_setup: {
    funcoes: ['setup.register_ad_account', 'setup.register_credential', 'setup.mark_lead_funnel'],
    async chamar(s) {
      expect(
        await s.valor(`select setup.register_ad_account('cs', 'meta', 'act_123', 'Conta inventada')`),
      ).toMatch(UUID);
      expect(
        await s.valor(
          `select setup.register_credential('search_console', 'read', 'conta-inventada', 'segredo-inventado', null)`,
        ),
      ).toMatch(UUID);
      // O funil antigo dos leads do site da fixture, já marcado: a função lê, trava e confere o funil.
      expect(await s.valor(`select setup.mark_lead_funnel('funil-teste-0002')::text`)).toBe(
        FUNIL_ANTIGO_DE_LEADS,
      );
    },
  },
};

describe('um tipo do catálogo trocado no pg_temp de um serviço', () => {
  it('os papéis de serviço que executam função security definer são os de baixo (o n8n_notifier entra com notify.*)', async () => {
    const papeis = await caso(db, postgres, (s) =>
      s.linhas<{ papel: string }>(
        `select r as papel
           from unnest($2::text[]) as r
          where exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = any($1) and p.prosecdef and has_function_privilege(r, p.oid, 'execute'))
          order by 1`,
        [ESQUEMAS, ['mkt_worker', 'mkt_executor', 'mkt_setup', 'n8n_notifier']],
      ),
    );
    expect(papeis.map((l) => l.papel)).toEqual(Object.keys(CHAMADAS).sort());
  });

  it.each(Object.keys(CHAMADAS) as PapelComDefiner[])(
    '%s: o check do domain nunca roda como o dono das funções',
    async (papel) => {
      const funcoes = await definerDoPapel(papel);
      const nomes = funcoes.map((f) => f.funcao.slice(0, f.funcao.indexOf('(')));
      expect(nomes).toEqual(expect.arrayContaining(CHAMADAS[papel].funcoes));

      await caso(db, servico(papel), async (s) => {
        await s.exec(ARMADILHA);
        // Controle: na sessão do serviço, o nome sem esquema cai no pg_temp e o check roda, como o próprio serviço.
        await s.linhas(`select ${TIPOS.map((t) => `null::${t}`).join(', ')}`);
        const naSessao = await s.linhas<{ tipo: string }>(
          `select distinct d.tipo from pg_temp.disparos d where d.quem = d.sessao order by 1`,
        );
        expect(naSessao.map((l) => l.tipo)).toEqual([...TIPOS]);

        await CHAMADAS[papel].chamar(s);
        for (const f of funcoes) await chamarSemParar(s, f.chamada);

        expect(await comoOutroPapel(s)).toEqual({ vezes: 0, quem: [] });
      });
    },
  );
});

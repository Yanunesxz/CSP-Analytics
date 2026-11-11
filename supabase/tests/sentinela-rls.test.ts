// Caso-sentinela da decisão 0018: o PGlite aplica a RLS depois de "set role"? E o ajudante entra como a API?
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { abrirBanco, anon, caso, postgres, servico, usuario } from './apoio/banco';

const USUARIO_A = '00000000-0000-4000-8000-00000000000a';
const USUARIO_B = '00000000-0000-4000-8000-00000000000b';

let db: PGlite;

beforeAll(async () => {
  db = await abrirBanco();
});

afterAll(async () => {
  await db.close();
});

// Uma tabela de teste com dono por linha: lê só o próprio; grava só com o próprio id.
const NOTAS = `
  create schema sentinela;
  grant usage on schema sentinela to anon, authenticated;
  create table sentinela.notas (id int primary key, dono uuid not null);
  alter table sentinela.notas enable row level security;
  grant select, insert on sentinela.notas to anon, authenticated;
  create policy notas_ler on sentinela.notas for select to authenticated using (dono = (select auth.uid()));
  create policy notas_gravar on sentinela.notas for insert to authenticated with check (dono = (select auth.uid()));
  insert into sentinela.notas values (1, '${USUARIO_A}'), (2, '${USUARIO_B}'), (3, '${USUARIO_A}');
`;

describe('caso-sentinela: o PGlite aplica a RLS depois de set role', () => {
  it('a política filtra a leitura de cada usuário; anon, sem política, não vê nada; o dono vê tudo', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(NOTAS);

      await s.como(usuario(USUARIO_A));
      expect(await s.linhas('select id from sentinela.notas order by id')).toEqual([{ id: 1 }, { id: 3 }]);
      await s.como(usuario(USUARIO_B));
      expect(await s.linhas('select id from sentinela.notas order by id')).toEqual([{ id: 2 }]);
      await s.como(anon);
      expect(await s.linhas('select id from sentinela.notas')).toEqual([]);
      await s.como(postgres);
      expect(await s.valor('select count(*)::int from sentinela.notas')).toBe(3);

      // Controle: com a RLS desligada, a mesma leitura devolve tudo. Quem filtrou foi a RLS, não o grant.
      await s.exec('alter table sentinela.notas disable row level security');
      await s.como(usuario(USUARIO_A));
      expect(await s.valor('select count(*)::int from sentinela.notas')).toBe(3);
    });
  });

  it('a política também barra a escrita: linha de outro dono e anon sem política são recusados', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(NOTAS);

      await s.como(usuario(USUARIO_A));
      await s.exec(`insert into sentinela.notas values (4, '${USUARIO_A}')`);
      const outro = await s.erro('42501', 'insert into sentinela.notas values ($1, $2)', [5, USUARIO_B]);
      expect(outro.message).toContain('row-level security');
      await s.como(anon);
      await s.erro('42501', 'insert into sentinela.notas values ($1, $2)', [6, USUARIO_A]);

      await s.como(postgres);
      expect(await s.linhas('select id from sentinela.notas order by id')).toEqual([
        { id: 1 },
        { id: 2 },
        { id: 3 },
        { id: 4 },
      ]);
    });
  });
});

describe('o ajudante entra como a API e como cada serviço', () => {
  it('usuário logado: session_user authenticator, papel authenticated e o token em auth.uid() e auth.jwt()', async () => {
    await caso(db, usuario(USUARIO_A, 'aal2'), async (s) => {
      expect(
        await s.linhas(
          `select session_user::text as sessao, current_user::text as papel, auth.uid()::text as uid,
                  auth.jwt() ->> 'aal' as aal, auth.role() as funcao`,
        ),
      ).toEqual([
        {
          sessao: 'authenticator',
          papel: 'authenticated',
          uid: USUARIO_A,
          aal: 'aal2',
          funcao: 'authenticated',
        },
      ]);
    });
  });

  it('anon: session_user authenticator, papel anon e nenhum usuário', async () => {
    await caso(db, anon, async (s) => {
      expect(
        await s.linhas(`select session_user::text as sessao, current_user::text as papel, auth.uid() as uid`),
      ).toEqual([{ sessao: 'authenticator', papel: 'anon', uid: null }]);
    });
  });

  it('serviço: a própria sessão; com um token, auth.uid() acredita na função definer, e só o session_user separa', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(`
        create schema sentinela;
        grant usage on schema sentinela to mkt_worker;
        create function sentinela.quem() returns table (sessao text, uid text)
        language sql security definer set search_path = pg_catalog, pg_temp
        as $$ select session_user::text, auth.uid()::text $$;
        grant execute on function sentinela.quem() to mkt_worker;
      `);
      await s.como(servico('mkt_worker'));
      expect(await s.valor('select current_user::text')).toBe('mkt_worker');
      expect(await s.linhas('select * from sentinela.quem()')).toEqual([{ sessao: 'mkt_worker', uid: null }]);

      // Qualquer sessão direta define o token: por isso os gatilhos de aprovação, papel e operador conferem o
      // session_user (papeis-e-rls.md, "Gatilhos que conferem quem pede").
      await s.como(servico('mkt_worker', { sub: USUARIO_A, role: 'authenticated', aal: 'aal2' }));
      expect(await s.linhas('select * from sentinela.quem()')).toEqual([
        { sessao: 'mkt_worker', uid: USUARIO_A },
      ]);

      // Como no Supabase, o serviço não tem o esquema auth: chama auth.uid() só dentro de função definer.
      await s.erro('42501', 'select auth.uid()');
    });
  });

  it('o caso desfaz tudo no fim: o que gravou e a identidade', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec('create table public.rascunho (id int)');
      await s.como(usuario(USUARIO_A));
    });
    const { rows } = await db.query<{ tabela: string | null; sessao: string; papel: string }>(
      `select to_regclass('public.rascunho')::text as tabela, session_user::text as sessao, current_user::text as papel`,
    );
    expect(rows).toEqual([{ tabela: null, sessao: 'postgres', papel: 'postgres' }]);
  });

  it('s.erro confere o código, devolve a mensagem e o caso segue como estava', async () => {
    await caso(db, anon, async (s) => {
      const negado = await s.erro('42501', 'select * from auth.users');
      expect(negado.message).toContain('permission denied');
      const proprio = await s.erro(
        'PT403',
        `do $$ begin raise sqlstate 'PT403' using message = 'TRF-403'; end $$`,
      );
      expect(proprio.message).toBe('TRF-403');
      expect(await s.valor('select current_user::text')).toBe('anon');

      await expect(s.erro('42501', 'select 1')).rejects.toThrow('mas o comando passou');
      await expect(s.erro('PT403', 'select 1 / 0')).rejects.toThrow('veio 22012');
      expect(await s.valor('select 2')).toBe(2);
    });
  });
});

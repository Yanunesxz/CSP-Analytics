// O arquivo de apoio imita o Supabase como as migrações esperam: cofre fechado, cron com as regras do pg_cron e o
// relógio dos testes só para quem roda as contas.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Quem, abrirBanco, anon, caso, lerApoio, postgres, servico, usuario } from './apoio/banco';

const USUARIO_A = '00000000-0000-4000-8000-00000000000a';

let db: PGlite;

beforeAll(async () => {
  db = await abrirBanco();
});

afterAll(async () => {
  await db.close();
});

describe('guarda', () => {
  it('fora do PGlite (o "supabase test db" num banco de verdade), o arquivo para antes de criar qualquer coisa', async () => {
    await caso(db, postgres, async (s) => {
      // Um version() de Postgres comum, achado antes do pg_catalog só nesta transação.
      await s.exec(`
        create function public.version() returns text language sql
          as $$ select 'PostgreSQL 17.6 on x86_64-pc-linux-gnu' $$;
        set local search_path = public, pg_catalog;
      `);
      const erro = await s.erro('P0001', lerApoio().antes);
      expect(erro.message).toContain('só para o PGlite');
    });
  });
});

describe('vault (esboço do Supabase Vault)', () => {
  it('guarda o segredo fora do texto puro e só a view decifrada o devolve; trocar muda o valor', async () => {
    await caso(db, postgres, async (s) => {
      const id = await s.valor<string>(
        `select vault.create_secret('segredo-de-teste', 'teste_cofre', 'inventado')`,
      );
      expect(await s.valor('select secret from vault.secrets where id = $1', [id])).not.toBe(
        'segredo-de-teste',
      );
      expect(await s.valor('select decrypted_secret from vault.decrypted_secrets where id = $1', [id])).toBe(
        'segredo-de-teste',
      );
      await s.exec(`select vault.update_secret('${id}', 'outro-segredo')`);
      expect(await s.valor('select decrypted_secret from vault.decrypted_secrets where id = $1', [id])).toBe(
        'outro-segredo',
      );
      await s.erro('23505', `select vault.create_secret('x', 'teste_cofre')`);
    });
  });

  it('ninguém além do dono lê o cofre: anon, logado e os serviços são negados', async () => {
    const outros: Quem[] = [
      anon,
      usuario(USUARIO_A, 'aal2'),
      servico('mkt_worker'),
      servico('mkt_executor'),
      servico('mkt_setup'),
      servico('n8n_notifier'),
    ];
    for (const quem of outros) {
      await caso(db, quem, async (s) => {
        await s.erro('42501', 'select decrypted_secret from vault.decrypted_secrets');
        await s.erro('42501', `select vault.create_secret('x')`);
      });
    }
  });
});

describe('cron (esboço do pg_cron)', () => {
  it('o mesmo nome troca o trabalho; tirar trabalho que não existe é erro, como no pg_cron', async () => {
    await caso(db, postgres, async (s) => {
      const id = await s.valor(`select cron.schedule('limpeza-de-teste', '0 3 * * *', 'select 1')`);
      expect(await s.valor(`select cron.schedule('limpeza-de-teste', '5 3 * * *', 'select 2')`)).toBe(id);
      expect(
        await s.linhas(`select schedule, command from cron.job where jobname = 'limpeza-de-teste'`),
      ).toEqual([{ schedule: '5 3 * * *', command: 'select 2' }]);
      expect(await s.valor(`select cron.unschedule('limpeza-de-teste')`)).toBe(true);
      await s.erro('P0001', `select cron.unschedule('limpeza-de-teste')`);
    });
  });

  it('a API não agenda nada', async () => {
    for (const quem of [anon, usuario(USUARIO_A, 'aal2')]) {
      await caso(db, quem, async (s) => {
        await s.erro('42501', `select cron.schedule('x', '* * * * *', 'select 1')`);
      });
    }
  });
});

describe('test.clock (o relógio dos testes)', () => {
  it('quem roda as contas lê o relógio; anon e os outros serviços não', async () => {
    for (const quem of [usuario(USUARIO_A), servico('mkt_worker'), servico('mkt_executor')]) {
      await caso(db, quem, async (s) => {
        expect(await s.valor('select count(*)::int from test.clock')).toBe(0);
      });
    }
    for (const quem of [anon, servico('mkt_setup'), servico('n8n_notifier')]) {
      await caso(db, quem, async (s) => {
        await s.erro('42501', 'select count(*) from test.clock');
      });
    }
  });
});

describe('auth', () => {
  it('auth.users fica fechada para a API', async () => {
    for (const quem of [anon, usuario(USUARIO_A, 'aal2')]) {
      await caso(db, quem, async (s) => {
        await s.erro('42501', 'select email from auth.users');
      });
    }
  });
});

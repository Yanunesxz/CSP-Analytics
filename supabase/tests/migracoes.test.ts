// Regras de toda migração (docs/dados/plano.md, "Ordem das migrações"): nome com versão única, cabeçalho do padrão,
// RLS ligada na mesma migração que cria a tabela, nenhuma função aberta a PUBLIC ou anon, e rodar de novo sem erro.
import { describe, expect, it } from 'vitest';
import {
  abrirBanco,
  aplicarMigracoes,
  caso,
  completarApoio,
  lerMigracoes,
  novoBanco,
  postgres,
} from './apoio/banco';
import { consultaDe, retrato, violacoes } from './apoio/catalogo';

const migracoes = lerMigracoes();

describe('arquivos de migração', () => {
  it('nome AAAAMMDDHHMMSS_o_que_faz.sql, com versão única, a partir da 01', () => {
    expect(migracoes[0]?.nome).toBe('20261103160000_esquemas_e_papeis.sql');
    for (const m of migracoes) {
      expect(m.nome).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    }
    const versoes = migracoes.map((m) => m.versao);
    expect(new Set(versoes).size).toBe(versoes.length);
  });

  it('cada uma começa com o cabeçalho do padrão: o que faz, risco, como reverter e uma consulta para conferir', () => {
    for (const m of migracoes) {
      const linhas = m.sql.split('\n');
      const fim = linhas.findIndex((l) => !l.startsWith('--'));
      const cabecalho = linhas.slice(0, fim < 0 ? linhas.length : fim).join('\n');
      for (const parte of ['O que faz:', 'Risco:', 'Como reverter', 'Conferir']) {
        expect(cabecalho, `${m.nome}: ${parte}`).toContain(parte);
      }
    }
  });

  it('nenhuma traz senha, chave ou token no texto', () => {
    for (const m of migracoes) {
      expect(m.sql, m.nome).not.toMatch(
        /\b(password|senha)\s*('|=)|\bsk-ant-|\beyJ[a-zA-Z0-9_-]{10,}|\bEAA[a-zA-Z0-9]{20,}/i,
      );
    }
  });
});

describe('aplicar as migrações', () => {
  it('cada uma deixa o banco nas regras e, aplicadas de novo, nenhuma falha nem muda o catálogo', async () => {
    const db = await novoBanco();
    try {
      const consulta = consultaDe(db);
      for (const m of migracoes) {
        await aplicarMigracoes(db, [m]);
        expect(await violacoes(consulta), m.nome).toEqual([]);
      }
      await completarApoio(db);
      const primeira = await retrato(consulta);

      await aplicarMigracoes(db);
      await completarApoio(db);
      expect(await violacoes(consulta)).toEqual([]);
      expect(await retrato(consulta)).toEqual(primeira);
    } finally {
      await db.close();
    }
  }, 180_000);

  it('as regras acusam cada coisa que uma migração não pode deixar', async () => {
    const db = await abrirBanco();
    try {
      await caso(db, postgres, async (s) => {
        expect(await violacoes(s.linhas)).toEqual([]);
        await s.exec(`
          create table mkt.sem_rls (id int);
          grant select on mkt.sem_rls to anon;
          grant insert on mkt.sem_rls to authenticated;
          create sequence mkt.seq_aberta;
          grant usage on sequence mkt.seq_aberta to authenticated;
          create function private.sem_caminho() returns int language sql security definer as 'select 1';
          create function api.aberta() returns int language sql as 'select 1';
          grant execute on function api.aberta() to public;
          create function api.do_anon() returns int language sql as 'select 1';
          grant execute on function api.do_anon() to anon;
          alter role n8n_notifier bypassrls;
        `);
        expect(await violacoes(s.linhas)).toEqual([
          'anon lê: mkt.sem_rls',
          'executável por PUBLIC: api.aberta()',
          'executável por anon: api.aberta()',
          'executável por anon: api.do_anon()',
          'grava pela API (authenticated): mkt.sem_rls',
          'papel de serviço com atributo proibido: n8n_notifier',
          'security definer sem search_path vazio: private.sem_caminho()',
          'sequência aberta (authenticated): mkt.seq_aberta',
          'tabela sem RLS: mkt.sem_rls',
        ]);
      });
    } finally {
      await db.close();
    }
  });

  it('o retrato percebe a mudança que rodar de novo não pode fazer', async () => {
    const db = await abrirBanco();
    try {
      await caso(db, postgres, async (s) => {
        const antes = await retrato(s.linhas);
        await s.exec(`grant execute on function mkt.utm_key(text) to mkt_setup`);
        expect(await retrato(s.linhas)).not.toEqual(antes);
      });
    } finally {
      await db.close();
    }
  });
});

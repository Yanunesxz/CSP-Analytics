// Regras de toda migração (docs/dados/plano.md, "Ordem das migrações"): nome com versão única, cabeçalho do padrão,
// RLS ligada na mesma migração que cria a tabela, toda função com search_path = pg_catalog, pg_temp, nenhuma função
// aberta a PUBLIC ou anon, rodar de novo sem erro, e o "Como reverter" de cada uma, da última até a 01.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type Migracao,
  abrirBanco,
  aplicarMigracoes,
  caso,
  completarApoio,
  erroDoBanco,
  lerMigracoes,
  novoBanco,
  postgres,
} from './apoio/banco';
import {
  ARQUIVO_DA_CONFERENCIA,
  type Consulta,
  ESQUEMAS,
  consultaDe,
  retrato,
  violacoes,
} from './apoio/catalogo';

const migracoes = lerMigracoes();

/**
 * Os comandos do "Como reverter" do cabeçalho de uma migração. Um comando começa na linha que abre com drop, alter,
 * select, revoke ou grant e vai até o ";" fora de aspas; a linha de texto fora de um comando (a explicação da 09) fica
 * de fora, e o "-- …" no fim da linha é comentário.
 */
function comandosDeReverter(m: Migracao): string[] {
  const cabecalho = m.sql.split('\n');
  const fim = cabecalho.findIndex((l) => !l.startsWith('--'));
  const linhas = cabecalho.slice(0, fim < 0 ? cabecalho.length : fim);
  const inicio = linhas.findIndex((l) => l.includes('Como reverter'));
  const conferir = linhas.findIndex((l, i) => i > inicio && /^--\s*Conferir/.test(l));
  const comandos: string[] = [];
  let atual = '';
  for (const bruta of linhas.slice(inicio + 1, conferir < 0 ? linhas.length : conferir)) {
    const linha = bruta.replace(/^--\s?/, '');
    if (!atual && !/^\s*(drop|alter|select|revoke|grant)\b/i.test(linha)) continue;
    let aspas = false;
    for (let i = 0; i < linha.length; i += 1) {
      const c = linha.charAt(i);
      if (!aspas && c === '-' && linha.charAt(i + 1) === '-') break;
      if (c === "'") aspas = !aspas;
      if (!aspas && c === ';') {
        if (atual.trim()) comandos.push(atual.trim());
        atual = '';
        continue;
      }
      if (atual || c.trim()) atual += c;
    }
    if (atual) atual += '\n';
  }
  if (atual.trim()) comandos.push(atual.trim());
  return comandos;
}

/**
 * O que um comando do "Como reverter" roda: o "select format(…)" devolve os comandos ("e rodar o que sair"), e o
 * "<cada domain desta migração>" vira um drop domain por domain que a migração criou.
 */
async function expandir(consulta: Consulta, comando: string, domains: string[]): Promise<string[]> {
  if (comando.includes('<cada domain desta migração>')) return domains.map((d) => `drop domain ${d}`);
  if (/^select\s+format\(/i.test(comando)) {
    return (await consulta<{ format: string }>(comando)).map((l) => l.format);
  }
  return [comando];
}

/** Os domains que aparecem no retrato depois da migração e não estavam no de antes dela. */
function domainsNovos(antes: Record<string, unknown>, depois: Record<string, unknown>): string[] {
  const nomes = (foto: Record<string, unknown>) =>
    (foto.tipos as Array<{ tipo: string; typtype: string }>)
      .filter((t) => t.typtype === 'd')
      .map((t) => t.tipo);
  const velhos = new Set(nomes(antes));
  return nomes(depois).filter((d) => !velhos.has(d));
}

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

  it('o "Como reverter" de cada uma, depois da 01, vale só depois de reverter as seguintes', () => {
    for (const m of migracoes.slice(1)) {
      const linha = m.sql.split('\n').find((l) => l.includes('Como reverter')) ?? '';
      expect(linha, m.nome).toMatch(
        /Como reverter \(só no projeto de teste, antes de produção, e depois de reverter (as migrações seguintes|a migração \d{2})\b/,
      );
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

  it('o "Como reverter" de cada uma, da última até a 01, roda sem erro e volta o catálogo ao de antes dela', async () => {
    // Sem a segunda parte do arquivo de apoio: o relógio dos testes dá privilégio aos papéis da 01 e barraria o drop
    // role, e não é das migrações.
    const db = await novoBanco();
    try {
      const consulta = consultaDe(db);
      const fotos = [await retrato(consulta)];
      for (const m of migracoes) {
        await aplicarMigracoes(db, [m]);
        fotos.push(await retrato(consulta));
      }
      for (let n = migracoes.length; n >= 1; n -= 1) {
        const m = migracoes[n - 1];
        const antes = fotos[n - 1];
        const depois = fotos[n];
        if (!m || !antes || !depois) throw new Error(`migração ${n} sem retrato`);
        const comandos = comandosDeReverter(m);
        expect(comandos.length, m.nome).toBeGreaterThan(0);
        for (const comando of comandos) {
          for (const sql of await expandir(consulta, comando, domainsNovos(antes, depois))) {
            try {
              await db.exec(sql);
            } catch (e) {
              const erro = erroDoBanco(e);
              throw new Error(`${m.nome}, "Como reverter": ${erro.code} ${erro.message} em: ${sql}`, {
                cause: e,
              });
            }
          }
        }
        expect(await retrato(consulta), m.nome).toEqual(antes);
      }
    } finally {
      await db.close();
    }
  }, 180_000);

  it('com as seguintes ainda aplicadas, o "Como reverter" da 03 para no primeiro comando, sem apagar nada delas', async () => {
    const m03 = migracoes.find((m) => m.nome.endsWith('_usuarios.sql'));
    if (!m03) throw new Error('migração 03 não achada');
    const db = await abrirBanco();
    try {
      await caso(db, postgres, async (s) => {
        const antes = await retrato(s.linhas);
        // Como o psql com ON_ERROR_STOP e sem transação: cada comando vale sozinho, e o primeiro erro para.
        let parou: { comando: number; code: string } | null = null;
        const comandos = comandosDeReverter(m03);
        for (const [i, comando] of comandos.entries()) {
          await s.exec('savepoint reverter');
          try {
            await s.exec(comando);
            await s.exec('release savepoint reverter');
          } catch (e) {
            await s.exec('rollback to savepoint reverter; release savepoint reverter');
            parou = { comando: i, code: erroDoBanco(e).code };
            break;
          }
        }
        expect(parou).toEqual({ comando: 0, code: '2BP01' });
        expect(comandos[0]).toMatch(/^drop table [^;]*mkt\.profiles$/);
        expect(await retrato(s.linhas)).toEqual(antes);
      });
    } finally {
      await db.close();
    }
  });

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
          -- O caminho vazio de antes (definer e invoker), o pg_temp na frente e o pg_catalog sozinho: sem o pg_temp
          -- explícito no fim, o esquema temporário vem primeiro.
          create function private.caminho_vazio() returns int language sql security definer
            set search_path = '' as 'select 1';
          create function mkt.formula_de_caminho_vazio() returns int language sql set search_path = '' as 'select 1';
          create function private.caminho_invertido() returns int language sql
            set search_path = pg_temp, pg_catalog as 'select 1';
          create function mkt.so_catalogo() returns int language sql set search_path = pg_catalog as 'select 1';
          create function api.aberta() returns int language sql set search_path = pg_catalog, pg_temp as 'select 1';
          grant execute on function api.aberta() to public;
          create function api.do_anon() returns int language sql set search_path = pg_catalog, pg_temp as 'select 1';
          grant execute on function api.do_anon() to anon;
          alter role n8n_notifier bypassrls;
          -- O privilégio de uma coluna só também conta (e não a primeira coluna).
          grant select (id) on mkt.crm_origin_map to anon;
          grant update (raw_value) on mkt.crm_origin_map to authenticated;
        `);
        expect(await violacoes(s.linhas)).toEqual([
          'anon lê: mkt.crm_origin_map',
          'anon lê: mkt.sem_rls',
          'executável por PUBLIC: api.aberta()',
          'executável por anon: api.aberta()',
          'executável por anon: api.do_anon()',
          'função sem search_path=pg_catalog, pg_temp: mkt.formula_de_caminho_vazio()',
          'função sem search_path=pg_catalog, pg_temp: mkt.so_catalogo()',
          'função sem search_path=pg_catalog, pg_temp: private.caminho_invertido()',
          'função sem search_path=pg_catalog, pg_temp: private.caminho_vazio()',
          'função sem search_path=pg_catalog, pg_temp: private.sem_caminho()',
          'grava pela API (authenticated): mkt.crm_origin_map',
          'grava pela API (authenticated): mkt.sem_rls',
          'papel de serviço com atributo proibido: n8n_notifier',
          'sequência aberta (authenticated): mkt.seq_aberta',
          'tabela sem RLS: mkt.sem_rls',
        ]);
      });
    } finally {
      await db.close();
    }
  });

  // A conferência roda também no SQL Editor de produção, onde as migrações podem ter entrado por outro caminho
  // (ESTADO.md, 12/11/2026): o dono de cada objeto e o que falta contam lá.
  it('as regras acusam esquema ou papel de serviço que falta e dono que não é o postgres', async () => {
    const db = await abrirBanco();
    try {
      await caso(db, postgres, async (s) => {
        await s.exec(`
          create role zz_outro_dono;
          alter schema notify owner to zz_outro_dono;
          alter table mkt.crm_origin_map owner to zz_outro_dono;
          alter view mkt.v_account_month owner to zz_outro_dono;
          alter function private.set_updated_at() owner to zz_outro_dono;
          drop schema setup cascade;
          drop owned by n8n_notifier;
          drop role n8n_notifier;
        `);
        expect(await violacoes(s.linhas)).toEqual([
          'dono zz_outro_dono no esquema notify',
          'dono zz_outro_dono: mkt.crm_origin_map',
          'dono zz_outro_dono: mkt.v_account_month',
          'dono zz_outro_dono: private.set_updated_at()',
          'esquema que falta: setup',
          'papel de serviço que falta: n8n_notifier',
        ]);
      });
    } finally {
      await db.close();
    }
  });

  it('a conferência do catálogo olha os mesmos sete esquemas dos testes', () => {
    const sql = readFileSync(ARQUIVO_DA_CONFERENCIA, 'utf8');
    const lista = /select unnest\(array\[([^\]]+)\]\)/.exec(sql)?.[1] ?? '';
    expect(lista.split(',').map((e) => e.trim().replace(/'/g, ''))).toEqual([...ESQUEMAS]);
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

// Migração 10, as credenciais e os scripts de configuração (decisão 0017; docs/dados/papeis-e-rls.md e plano.md,
// "Seed"): o segredo de leitura sai do Vault só para a conexão do worker (private.read_credential), que também o troca
// (private.rotate_credential) e diz o estado (ingest.set_credential_status); a credencial de escrita é só a linha de
// estado, sem segredo. As funções setup.* cadastram conta, perfil, propriedade e credencial com a marca, e o convite do
// primeiro dono (a que marca o funil antigo dos leads do site, setup.mark_lead_funnel, está em ingestao.test.ts, com a
// leitura dos funis). Segredos e e-mails inventados; nenhum aparece em mensagem de erro.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Sessao,
  abrirBanco,
  anon,
  aplicarFixture,
  caso,
  postgres,
  servico,
  usuario,
} from './apoio/banco';
import { CREDENCIAL_DE_ESCRITA, CREDENCIAL_DE_LEITURA } from './apoio/trafego';
import { DONO, GESTOR } from './apoio/usuarios';

let db: PGlite;

beforeAll(async () => {
  db = await abrirBanco();
  for (const f of ['usuarios', 'marketing', 'trafego', 'conectores']) await aplicarFixture(db, f);
});

afterAll(async () => {
  await db.close();
});

/** Uma credencial de leitura do Search Console com um segredo inventado no Vault (o dono do banco grava). */
const CREDENCIAL = '00000000-0000-4000-8000-0000000004b1';
async function credencialDeLeitura(s: Sessao, estado = 'valid'): Promise<void> {
  await s.como(postgres);
  await s.exec(`
    insert into private.connector_credentials (id, connector_id, purpose, account_ref, vault_secret_id, status)
    select '${CREDENCIAL}', k.id, 'read', 'conta-de-teste', vault.create_secret('segredo-inventado-1'), '${estado}'
      from mkt.connectors k where k.code = 'search_console';
  `);
}

const auditoria = (s: Sessao) =>
  s.linhas(
    `select actor_kind, actor_id, target_id::text as alvo, changes from mkt.audit_log
      where event = 'credential_status_changed' order by occurred_at`,
  );

describe('o segredo de leitura: private.read_credential e private.rotate_credential', () => {
  it('o worker lê o segredo da credencial de leitura; nunca o da de escrita, nem o de credencial revogada', async () => {
    await caso(db, postgres, async (s) => {
      await credencialDeLeitura(s);
      await s.como(servico('mkt_worker'));
      expect(await s.valor(`select private.read_credential($1)`, [CREDENCIAL])).toBe('segredo-inventado-1');
      const escrita = await s.erro('PT403', `select private.read_credential($1)`, [CREDENCIAL_DE_ESCRITA]);
      expect([escrita.message, escrita.detail]).toEqual(['CON-403', 'purpose']);
      expect(
        (await s.erro('PT404', `select private.read_credential('00000000-0000-0000-0000-000000000000')`))
          .message,
      ).toBe('CON-404');
      // O apontador da fixture não tem segredo no Vault.
      expect(
        (await s.erro('PT404', `select private.read_credential($1)`, [CREDENCIAL_DE_LEITURA])).detail,
      ).toBe('secret');
      await s.como(postgres);
      await s.exec(`update private.connector_credentials set status = 'revoked' where id = '${CREDENCIAL}'`);
      await s.como(servico('mkt_worker'));
      expect((await s.erro('PT422', `select private.read_credential($1)`, [CREDENCIAL])).detail).toBe(
        'revoked',
      );
    });
  });

  it('só a conexão do worker: o dono do banco recebe CON-403; a tela, o executor, o n8n e os scripts nem alcançam', async () => {
    await caso(db, postgres, async (s) => {
      await credencialDeLeitura(s);
      expect((await s.erro('PT403', `select private.read_credential($1)`, [CREDENCIAL])).message).toBe(
        'CON-403',
      );
      expect(
        (await s.erro('PT403', `select private.rotate_credential($1, 'x', null)`, [CREDENCIAL])).message,
      ).toBe('CON-403');
    });
    for (const quem of [
      usuario(DONO, 'aal2'),
      servico('mkt_executor'),
      servico('n8n_notifier'),
      servico('mkt_setup'),
      anon,
    ]) {
      await caso(db, quem, async (s) => {
        await s.erro('42501', `select private.read_credential('${CREDENCIAL_DE_LEITURA}')`);
        await s.erro('42501', `select private.rotate_credential('${CREDENCIAL_DE_LEITURA}', 'x', null)`);
      });
    }
  });

  it('o worker troca o segredo que renovou: a credencial volta a valer, e a mudança de estado vai para a auditoria', async () => {
    await caso(db, postgres, async (s) => {
      await credencialDeLeitura(s, 'expiring');
      await s.como(servico('mkt_worker'));
      await s.valor(
        `select private.rotate_credential($1, 'segredo-inventado-2', now() + interval '60 days')::text`,
        [CREDENCIAL],
      );
      expect(await s.valor(`select private.read_credential($1)`, [CREDENCIAL])).toBe('segredo-inventado-2');
      expect(
        (await s.erro('PT422', `select private.rotate_credential($1, '', null)`, [CREDENCIAL])).detail,
      ).toBe('secret');
      expect(
        (
          await s.erro('PT422', `select private.rotate_credential($1, 'x', now() - interval '1 day')`, [
            CREDENCIAL,
          ])
        ).detail,
      ).toBe('expires_at');
      expect(
        (await s.erro('PT403', `select private.rotate_credential($1, 'x', null)`, [CREDENCIAL_DE_ESCRITA]))
          .detail,
      ).toBe('purpose');
      await s.como(postgres);
      expect(
        await s.linhas(
          `select status, expires_at > now() as vale, last_rotated_at is not null as trocada from private.connector_credentials where id = $1`,
          [CREDENCIAL],
        ),
      ).toEqual([{ status: 'valid', vale: true, trocada: true }]);
      // O Vault guarda o segredo cifrado (no esboço, em base64): o texto não aparece em vault.secrets.
      expect(
        await s.valor(`select count(*)::int from vault.secrets where secret like '%segredo-inventado%'`),
      ).toBe(0);
      expect(await auditoria(s)).toEqual([
        {
          actor_kind: 'system',
          actor_id: null,
          alvo: CREDENCIAL,
          changes: {
            connector: 'search_console',
            purpose: 'read',
            status: { before: 'expiring', after: 'valid' },
          },
        },
      ]);
    });
  });

  it('o estado que o worker conferiu (vence logo, recusada): a hora da conferência e a auditoria só quando muda', async () => {
    await caso(db, postgres, async (s) => {
      await credencialDeLeitura(s);
      await s.como(servico('mkt_worker'));
      await s.valor(`select ingest.set_credential_status($1, 'valid')::text`, [CREDENCIAL]);
      await s.valor(`select ingest.set_credential_status($1, 'invalid')::text`, [CREDENCIAL]);
      expect(
        (await s.erro('PT403', `select ingest.set_credential_status($1, 'invalid')`, [CREDENCIAL_DE_ESCRITA]))
          .detail,
      ).toBe('purpose');
      await s.como(postgres);
      expect(
        await s.linhas(
          `select status, last_checked_at is not null as conferida from private.connector_credentials where id = $1`,
          [CREDENCIAL],
        ),
      ).toEqual([{ status: 'invalid', conferida: true }]);
      expect((await auditoria(s)).map((l) => (l.changes as { status: unknown }).status)).toEqual([
        { before: 'valid', after: 'invalid' },
      ]);
      // A tela vê só o estado.
      await s.como(usuario(GESTOR));
      const estados = await s.linhas<Record<string, unknown>>(`select * from api.credential_status()`);
      expect(estados.find((l) => l.account_ref === 'conta-de-teste')).toEqual({
        connector: 'search_console',
        purpose: 'read',
        account_ref: 'conta-de-teste',
        status: 'invalid',
        expires_at: null,
        last_checked_at: expect.any(Date),
      });
      expect(JSON.stringify(estados)).not.toContain('segredo');
    });
  });
});

describe('os scripts de configuração: setup.*', () => {
  it('conta de anúncio com a marca: rodar de novo atualiza e religa; a conta não troca de marca; id e nome conferidos', async () => {
    await caso(db, servico('mkt_setup'), async (s) => {
      const registrar = (marca: string, id: string, nome: string) =>
        s.valor<string>(`select setup.register_ad_account($1, 'tiktok', $2, $3)::text`, [marca, id, nome]);
      const conta = await registrar('cs', '7100000000000000001', 'Conta TikTok de teste');
      await s.como(postgres);
      await s.exec(`update mkt.ad_accounts set is_active = false where id = '${conta}'`);
      await s.como(servico('mkt_setup'));
      expect(await registrar('cs', '7100000000000000001', '  Conta TikTok renomeada ')).toBe(conta);
      await s.como(postgres);
      expect(
        await s.linhas(
          `select b.code as marca, a.platform, a.source, a.name, a.is_active, a.currency from mkt.ad_accounts a
                          join mkt.brands b on b.id = a.brand_id where a.id = $1`,
          [conta],
        ),
      ).toEqual([
        {
          marca: 'cs',
          platform: 'tiktok',
          source: 'tiktok_ads',
          name: 'Conta TikTok renomeada',
          is_active: true,
          currency: 'BRL',
        },
      ]);
      await s.como(servico('mkt_setup'));
      const erro = (sql: string, params: unknown[]) => s.erro('PT422', sql, params);
      expect(
        (
          await erro(`select setup.register_ad_account('plumene', 'tiktok', $1, 'x')`, [
            '7100000000000000001',
          ])
        ).detail,
      ).toBe('brand');
      expect((await erro(`select setup.register_ad_account('cs', 'meta', $1, 'x')`, ['act 1'])).detail).toBe(
        'external_id',
      );
      expect(
        (
          await erro(`select setup.register_ad_account('cs', 'meta', 'act_1', $1)`, [
            'Conta de fulano@exemplo.com',
          ])
        ).detail,
      ).toBe('name');
      expect((await erro(`select setup.register_ad_account('cs', null, 'act_1', 'x')`, [])).detail).toBe(
        'platform',
      );
    });
  });

  it('perfil do Instagram e propriedade do site: o @ e o domínio normalizados; a de outra marca não muda', async () => {
    await caso(db, servico('mkt_setup'), async (s) => {
      const perfil = await s.valor<string>(
        `select setup.register_ig_account('plumene', '17840000000000002', '@perfil.plumene')::text`,
      );
      const ga4 = await s.valor<string>(
        `select setup.register_web_property('plumene', 'ga4_property', '900000002', 'https://www.Plumene.Example.com/loja')::text`,
      );
      const gsc = await s.valor<string>(
        `select setup.register_web_property('plumene', 'gsc_site', 'sc-domain:plumene.example.com', 'plumene.example.com')::text`,
      );
      await s.como(postgres);
      expect(await s.linhas(`select username from mkt.ig_accounts where id = $1`, [perfil])).toEqual([
        { username: 'perfil.plumene' },
      ]);
      expect(
        await s.linhas(
          `select kind, source, host from mkt.web_properties where id in ($1, $2) order by kind`,
          [ga4, gsc],
        ),
      ).toEqual([
        { kind: 'ga4_property', source: 'ga4', host: 'plumene.example.com' },
        { kind: 'gsc_site', source: 'search_console', host: 'plumene.example.com' },
      ]);
      await s.como(servico('mkt_setup'));
      expect(
        (await s.erro('PT422', `select setup.register_ig_account('cs', '17840000000000002', 'outro')`))
          .detail,
      ).toBe('brand');
      expect((await s.erro('PT422', `select setup.register_ig_account('cs', 'abc', 'perfil')`)).detail).toBe(
        'external_id',
      );
      expect(
        (await s.erro('PT422', `select setup.register_ig_account('cs', '1', 'tem espaço')`)).detail,
      ).toBe('username');
      expect(
        (await s.erro('PT422', `select setup.register_web_property('cs', 'gsc_site', 'x', 'sem-ponto')`))
          .detail,
      ).toBe('host');
      expect(
        (
          await s.erro(
            'PT422',
            `select setup.register_web_property('cs', 'gsc_site', 'x', 'fulano@exemplo.com')`,
          )
        ).detail,
      ).toBe('host');
    });
  });

  it('credencial de leitura: o segredo vai para o Vault (o worker lê); registrar de novo troca o segredo e volta a valer', async () => {
    await caso(db, servico('mkt_setup'), async (s) => {
      const id = await s.valor<string>(
        `select setup.register_credential('instagram', 'read', '17840000000000002', $1, now() + interval '60 days')::text`,
        ['token-inventado-1'],
      );
      await s.como(servico('mkt_worker'));
      expect(await s.valor(`select private.read_credential($1)`, [id])).toBe('token-inventado-1');
      await s.valor(`select ingest.set_credential_status($1, 'invalid')::text`, [id]);
      await s.como(servico('mkt_setup'));
      expect(
        await s.valor(
          `select setup.register_credential('instagram', 'read', '17840000000000002', $1, null)::text`,
          ['token-inventado-2'],
        ),
      ).toBe(id);
      await s.como(servico('mkt_worker'));
      expect(await s.valor(`select private.read_credential($1)`, [id])).toBe('token-inventado-2');
      await s.como(postgres);
      expect(
        await s.linhas(
          `select status, vault_secret_id is not null as segredo from private.connector_credentials where id = $1`,
          [id],
        ),
      ).toEqual([{ status: 'valid', segredo: true }]);
      expect((await auditoria(s)).map((l) => (l.changes as { status: unknown }).status)).toEqual([
        { before: 'valid', after: 'invalid' },
        { before: 'invalid', after: 'valid' },
      ]);
    });
  });

  it('credencial de escrita: só a linha de estado, sem segredo (mandar segredo é recusado, e ele não aparece no erro)', async () => {
    await caso(db, servico('mkt_setup'), async (s) => {
      const id = await s.valor<string>(
        `select setup.register_credential('tiktok', 'write', null, null, null)::text`,
      );
      const erro = await s.erro(
        'PT422',
        `select setup.register_credential('tiktok', 'write', 'conta-x', $1, null)`,
        ['segredo-de-escrita-inventado'],
      );
      expect(erro.detail).toBe('secret');
      expect(JSON.stringify(erro)).not.toContain('segredo-de-escrita-inventado');
      expect(
        (await s.erro('PT422', `select setup.register_credential('tiktok', 'read', null, '', null)`)).detail,
      ).toBe('secret');
      expect(
        (await s.erro('PT422', `select setup.register_credential('tiktok', 'read', null, null, null)`))
          .detail,
      ).toBe('secret');
      expect(
        (
          await s.erro(
            'PT422',
            `select setup.register_credential('tiktok', 'read', 'conta x', 'segredo', null)`,
          )
        ).detail,
      ).toBe('account_ref');
      await s.como(postgres);
      expect(
        await s.linhas(
          `select purpose, status, vault_secret_id from private.connector_credentials where id = $1`,
          [id],
        ),
      ).toEqual([{ purpose: 'write', status: 'valid', vault_secret_id: null }]);
    });
  });

  it('só os scripts: a tela, o worker, o executor e o n8n não cadastram nada', async () => {
    for (const quem of [
      usuario(DONO, 'aal2'),
      servico('mkt_worker'),
      servico('mkt_executor'),
      servico('n8n_notifier'),
      anon,
    ]) {
      await caso(db, quem, async (s) => {
        // Com o esquema setup aberto só neste caso (o rollback desfaz), quem barra é o grant de cada função, não a
        // falta de USAGE no esquema: a linha falha se uma função abrir para outro papel.
        await s.como(postgres);
        await s.exec(
          'grant usage on schema setup to anon, authenticated, mkt_worker, mkt_executor, n8n_notifier',
        );
        await s.como(quem);
        const chamadas: Array<[string, string]> = [
          ['register_ad_account', `select setup.register_ad_account('cs', 'meta', 'act_2', 'x')`],
          ['register_ig_account', `select setup.register_ig_account('cs', '1', 'x')`],
          [
            'register_web_property',
            `select setup.register_web_property('cs', 'ga4_property', '1', 'exemplo.com')`,
          ],
          ['register_credential', `select setup.register_credential('meta', 'write', null, null, null)`],
          [
            'create_first_owner_invitation',
            `select setup.create_first_owner_invitation('a@exemplo.com', 'Pessoa')`,
          ],
          ['mark_lead_funnel', `select setup.mark_lead_funnel('funil-teste-0001')`],
        ];
        for (const [funcao, sql] of chamadas) {
          expect((await s.erro('42501', sql)).message, sql).toBe(`permission denied for function ${funcao}`);
        }
      });
    }
  });

  it('o convite do primeiro dono: com um dono ativo, recusado; o e-mail e o nome conferidos', async () => {
    await caso(db, servico('mkt_setup'), async (s) => {
      expect(
        (await s.erro('PT422', `select setup.create_first_owner_invitation('novo@exemplo.com', 'Novo dono')`))
          .detail,
      ).toBe('owner_exists');
    });
  });
});

describe('o convite do primeiro dono, num banco sem ninguém', () => {
  let vazio: PGlite;

  beforeAll(async () => {
    vazio = await abrirBanco();
  });

  afterAll(async () => {
    await vazio.close();
  });

  it('cria o convite (dono, sem quem convidou, 7 dias) e a auditoria; rodar de novo devolve o mesmo; o login aceito vira o dono', async () => {
    await caso(vazio, servico('mkt_setup'), async (s) => {
      const convidar = () =>
        s.valor<string>(
          `select setup.create_first_owner_invitation(' Dono.Teste@Exemplo.com ', 'Dono de teste')::text`,
        );
      const convite = await convidar();
      expect(await convidar()).toBe(convite);
      expect(
        (await s.erro('PT422', `select setup.create_first_owner_invitation('sem-arroba', 'Dono')`)).detail,
      ).toBe('email');
      expect(
        (await s.erro('PT422', `select setup.create_first_owner_invitation('a@exemplo.com', 'D')`)).detail,
      ).toBe('display_name');
      await s.como(postgres);
      expect(
        await s.linhas(
          `select email_normalized, display_name, role, invited_by, expires_at - created_at = interval '7 days' as sete_dias
             from mkt.invitations where id = $1`,
          [convite],
        ),
      ).toEqual([
        {
          email_normalized: 'dono.teste@exemplo.com',
          display_name: 'Dono de teste',
          role: 'owner',
          invited_by: null,
          sete_dias: true,
        },
      ]);
      expect(await s.linhas(`select actor_kind, actor_id, event, changes from mkt.audit_log`)).toEqual([
        {
          actor_kind: 'system',
          actor_id: null,
          event: 'first_owner_created',
          changes: { invitation_id: convite, role: 'owner' },
        },
      ]);
      // O Auth cria o login com invited_at (o link do convite): o gatilho cria o perfil de dono.
      await s.exec(`insert into auth.users (id, email, invited_at)
                    values ('00000000-0000-4000-8000-0000000000a1', 'dono.teste@exemplo.com', now())`);
      expect(await s.linhas(`select role, is_active from mkt.profiles`)).toEqual([
        { role: 'owner', is_active: true },
      ]);
      await s.como(servico('mkt_setup'));
      expect(
        (await s.erro('PT422', `select setup.create_first_owner_invitation('outro@exemplo.com', 'Outro')`))
          .detail,
      ).toBe('owner_exists');
    });
  });

  it('o convite vencido é revogado antes (com a auditoria); um convite aberto de outro papel para o e-mail barra', async () => {
    await caso(vazio, postgres, async (s) => {
      await s.exec(`
        insert into mkt.invitations (email_normalized, display_name, role, invited_by, expires_at, created_at)
        values ('vencido@exemplo.com', 'Convite vencido', 'owner', null, now() - interval '1 day', now() - interval '8 days'),
               ('gestor@exemplo.com', 'Convite de gestor', 'traffic_manager', null, now() + interval '1 day', now());
      `);
      await s.como(servico('mkt_setup'));
      const novo = await s.valor<string>(
        `select setup.create_first_owner_invitation('vencido@exemplo.com', 'Dono novo')::text`,
      );
      expect(
        (await s.erro('PT422', `select setup.create_first_owner_invitation('gestor@exemplo.com', 'Dono')`))
          .detail,
      ).toBe('open_invitation');
      await s.como(postgres);
      expect(
        await s.linhas(
          `select display_name, revoked_at is not null as revogado from mkt.invitations where email_normalized = 'vencido@exemplo.com' order by created_at`,
        ),
      ).toEqual([
        { display_name: 'Convite vencido', revogado: true },
        { display_name: 'Dono novo', revogado: false },
      ]);
      expect(await s.linhas(`select event from mkt.audit_log order by occurred_at, event`)).toEqual([
        { event: 'first_owner_created' },
        { event: 'invite_revoked' },
      ]);
      expect(novo).toMatch(/^[0-9a-f-]{36}$/);
    });
  });
});

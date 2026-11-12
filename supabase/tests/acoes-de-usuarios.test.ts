// Migração 09, usuários e configurações: convidar e revogar convite, mudar papel e tirar acesso (uma chamada por vez,
// com o segundo fator), tema, avisos e "Meus filtros" da própria pessoa, e as leituras com regra própria (my_profile,
// my_permissions, list_role_permissions, check_text, list_users). Casos RLS-08, 09, 13, 14 e 35
// (docs/dados/papeis-e-rls.md). Dados inventados de fixtures/usuarios.sql e conectores.sql (o aviso na fila).
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type ErroDoBanco,
  type Quem,
  type Sessao,
  abrirBanco,
  aplicarFixture,
  caso,
  postgres,
  usuario,
} from './apoio/banco';
import { AVISO } from './apoio/trafego';
import { DONO, EX_GESTOR, GESTOR, PODE, SEGUNDO_DONO, SEGUNDO_FATOR } from './apoio/usuarios';

let db: PGlite;

beforeAll(async () => {
  db = await abrirBanco();
  await aplicarFixture(db, 'usuarios');
  await aplicarFixture(db, 'conectores');
});

afterAll(async () => {
  await db.close();
});

const DONO_2F = usuario(DONO, 'aal2');
const DONO_1F = usuario(DONO, 'aal1');
const GESTOR_LOGADO = usuario(GESTOR, 'aal2');
const NINGUEM = '00000000-0000-4000-8000-0000000001ff';

type Linha = Record<string, unknown>;

function primeira<T>(linhas: T[]): T {
  const [l] = linhas;
  if (l === undefined) throw new Error('A consulta não devolveu linha');
  return l;
}

async function chamar<T = Linha>(s: Sessao, quem: Quem, sql: string, params?: unknown[]): Promise<T[]> {
  await s.como(quem);
  return s.linhas<T>(sql, params);
}

async function recusa(
  s: Sessao,
  codigo: string,
  quem: Quem,
  sql: string,
  params?: unknown[],
): Promise<ErroDoBanco> {
  await s.como(quem);
  return s.erro(codigo, sql, params);
}

async function versao(s: Sessao, tabela: string, id: string): Promise<Date> {
  await s.como(postgres);
  return s.valor<Date>(`select updated_at from ${tabela} where id = $1`, [id]);
}

async function perfil(s: Sessao, id: string): Promise<Linha> {
  await s.como(postgres);
  return primeira(
    await s.linhas(
      `select role::text, is_active, whatsapp_digits, deactivation_reason::text, deactivated_by::text, updated_at
         from mkt.profiles where id = $1`,
      [id],
    ),
  );
}

async function auditoria(s: Sessao, evento: string): Promise<Linha[]> {
  await s.como(postgres);
  return s.linhas(
    `select actor_id::text, target_table, target_id::text, changes from mkt.audit_log
      where event = $1 and occurred_at = now() order by created_at`,
    [evento],
  );
}

/** Um aviso na fila para a pessoa (o relatório da semana, que todo papel recebe, ou a proposta para aprovar). */
async function avisoNaFila(
  s: Sessao,
  pessoa: string,
  aviso: 'weekly_report' | 'proposal_to_approve',
): Promise<string> {
  await s.como(postgres);
  const payload =
    aviso === 'weekly_report'
      ? { title: 'Relatório da semana', link: '/visao-geral', from_on: '2026-10-26', to_on: '2026-11-01' }
      : { title: 'Proposta para aprovar', link: '/trafego', brand: 'cs', action_code: 'ACT-0099' };
  return s.valor<string>(
    `insert into mkt.notification_outbox (profile_id, notice, channel, dedupe_key, payload, send_after_at)
     values ($1, $2, 'email', gen_random_uuid()::text, $3, now()) returning id::text`,
    [pessoa, aviso, JSON.stringify(payload)],
  );
}

const convidar = 'select * from api.invite_user($1, $2, $3)';
const preferenciasDoGestor = `select api.save_profile_preferences('dark', null, 'viewer', null)`;

describe('convidar (api.invite_user) e revogar o convite', () => {
  it('RLS-08 e RLS-35: o gestor e o dono sem o segundo fator não convidam (PT403), e nada é gravado', async () => {
    await caso(db, postgres, async (s) => {
      for (const quem of [GESTOR_LOGADO, DONO_1F]) {
        const e = await recusa(s, 'PT403', quem, convidar, [
          'intruso@example.com',
          'Convite do intruso',
          'owner',
        ]);
        expect(e.message).toBe('USR-403');
      }
      await s.como(postgres);
      expect(
        await s.valor(
          `select count(*)::int from mkt.invitations where email_normalized = 'intruso@example.com'`,
        ),
      ).toBe(0);
    });
  });

  it('o dono convida: e-mail em minúsculas, 7 dias, a auditoria só com o id e o papel; o login do convite ganha o perfil', async () => {
    await caso(db, postgres, async (s) => {
      const c = primeira(
        await chamar<{ id: string; email: string }>(s, DONO_2F, convidar, [
          '  Nova.Gestora@Example.COM ',
          '  Gestora nova ',
          'traffic_manager',
        ]),
      );
      expect(c.email).toBe('nova.gestora@example.com');
      await s.como(postgres);
      expect(
        await s.linhas(
          `select email_normalized, display_name, role::text, invited_by::text,
                  expires_at = now() + interval '7 days' as sete_dias
             from mkt.invitations where id = $1`,
          [c.id],
        ),
      ).toEqual([
        {
          email_normalized: 'nova.gestora@example.com',
          display_name: 'Gestora nova',
          role: 'traffic_manager',
          invited_by: DONO,
          sete_dias: true,
        },
      ]);
      expect(await auditoria(s, 'invite_sent')).toEqual([
        {
          actor_id: DONO,
          target_table: 'invitations',
          target_id: c.id,
          changes: { invitation_id: c.id, role: 'traffic_manager' },
        },
      ]);
      // A Edge Function pede o convite ao Auth; o login nasce e o gatilho cria o perfil com o papel do convite.
      await s.exec(`insert into auth.users (id, email, invited_at)
                    values ('00000000-0000-4000-8000-0000000000a9', 'nova.gestora@example.com', now())`);
      expect(
        await s.linhas(
          `select display_name, role::text, invited_by::text from mkt.profiles
            where id = '00000000-0000-4000-8000-0000000000a9'`,
        ),
      ).toEqual([{ display_name: 'Gestora nova', role: 'traffic_manager', invited_by: DONO }]);
    });
  });

  it('e-mail inválido, nome curto, quem já tem perfil e convite aberto: PT422; o convite vencido é revogado e nasce outro', async () => {
    await caso(db, postgres, async (s) => {
      const tentativas: Array<[unknown[], string]> = [
        [['sem-arroba.example.com', 'Pessoa', 'traffic_manager'], 'email'],
        [['com espaco@example.com', 'Pessoa', 'traffic_manager'], 'email'],
        [['pessoa@example.com', ' P ', 'traffic_manager'], 'display_name'],
        [['pessoa@example.com', 'Pessoa', null], 'role'],
        [['Gestor.Teste@example.com', 'Gestor de novo', 'owner'], 'has_profile'],
      ];
      for (const [args, detalhe] of tentativas) {
        const e = await recusa(s, 'PT422', DONO_2F, convidar, args);
        expect([e.message, e.detail], detalhe).toEqual(['USR-422', detalhe]);
      }
      await chamar(s, DONO_2F, convidar, ['aberto@example.com', 'Convite aberto', 'traffic_manager']);
      expect(
        (await recusa(s, 'PT422', DONO_2F, convidar, ['aberto@example.com', 'De novo', 'traffic_manager']))
          .detail,
      ).toBe('open_invitation');

      // O vencido ainda conta como aberto (um convite aberto por e-mail): é revogado, com a auditoria, e nasce outro.
      await s.como(postgres);
      const vencido = await s.valor<string>(
        `insert into mkt.invitations (email_normalized, display_name, role, invited_by, expires_at)
         values ('vencido@example.com', 'Convite vencido', 'traffic_manager', $1, now() - interval '1 day')
         returning id::text`,
        [DONO],
      );
      const novo = primeira(
        await chamar<{ id: string }>(s, DONO_2F, convidar, ['vencido@example.com', 'Convite novo', 'owner']),
      );
      await s.como(postgres);
      expect(
        await s.linhas(
          `select id::text, revoked_at is not null as revogado, revoked_by::text from mkt.invitations
            where email_normalized = 'vencido@example.com' order by revoked_at nulls last`,
        ),
      ).toEqual([
        { id: vencido, revogado: true, revoked_by: DONO },
        { id: novo.id, revogado: false, revoked_by: null },
      ]);
      expect((await auditoria(s, 'invite_revoked')).map((l) => l.changes)).toEqual([
        { invitation_id: vencido },
      ]);
    });
  });

  it('revogar: o dono revoga o convite aberto; de novo, PT422; o gestor não revoga (PT403)', async () => {
    await caso(db, postgres, async (s) => {
      const c = primeira(
        await chamar<{ id: string }>(s, DONO_2F, convidar, [
          'revogar@example.com',
          'Convite a revogar',
          'owner',
        ]),
      );
      expect(
        (await recusa(s, 'PT403', GESTOR_LOGADO, 'select api.revoke_invitation($1)', [c.id])).message,
      ).toBe('USR-403');
      const r = primeira(await chamar(s, DONO_2F, 'select * from api.revoke_invitation($1)', [c.id]));
      expect(r).toMatchObject({ id: c.id, revoked_by: DONO });
      expect((await recusa(s, 'PT422', DONO_2F, 'select api.revoke_invitation($1)', [c.id])).message).toBe(
        'USR-422',
      );
      expect((await recusa(s, 'PT404', DONO_2F, 'select api.revoke_invitation($1)', [NINGUEM])).message).toBe(
        'USR-404',
      );
      expect((await auditoria(s, 'invite_revoked')).map((l) => l.changes)).toEqual([{ invitation_id: c.id }]);
    });
  });
});

const mudarPapel = 'select * from api.change_role($1, $2, $3)';
const tirarAcesso = 'select * from api.revoke_access($1, $2, $3, $4)';

describe('papel (api.change_role)', () => {
  it('RLS-08: o gestor não muda o próprio papel nem o do dono (PT403); o papel continua', async () => {
    await caso(db, postgres, async (s) => {
      for (const [alvo, papel] of [
        [GESTOR, 'owner'],
        [DONO, 'traffic_manager'],
      ] as const) {
        const v = await versao(s, 'mkt.profiles', alvo);
        expect((await recusa(s, 'PT403', GESTOR_LOGADO, mudarPapel, [alvo, papel, v])).message).toBe(
          'USR-403',
        );
      }
      expect(await perfil(s, GESTOR)).toMatchObject({ role: 'traffic_manager' });
      expect(await perfil(s, DONO)).toMatchObject({ role: 'owner' });
    });
  });

  it('RLS-14: o dono não muda o próprio papel; o último dono ativo não perde o papel (PT422)', async () => {
    await caso(db, postgres, async (s) => {
      const v = await versao(s, 'mkt.profiles', DONO);
      expect((await recusa(s, 'PT422', DONO_2F, mudarPapel, [DONO, 'traffic_manager', v])).message).toBe(
        'USR-422',
      );

      // Um papel que gere usuários sem ser dono: o único jeito de alguém mexer no último dono.
      await s.como(postgres);
      await s.exec(
        `insert into mkt.role_permissions (role, action) values ('traffic_manager', 'manage_users')`,
      );
      const segundo = await versao(s, 'mkt.profiles', SEGUNDO_DONO);
      await chamar(s, GESTOR_LOGADO, mudarPapel, [SEGUNDO_DONO, 'traffic_manager', segundo]);
      const dono = await versao(s, 'mkt.profiles', DONO);
      expect(
        (await recusa(s, 'PT422', GESTOR_LOGADO, mudarPapel, [DONO, 'traffic_manager', dono])).message,
      ).toBe('USR-422');
      expect(await perfil(s, DONO)).toMatchObject({ role: 'owner', is_active: true });
    });
  });

  it('o dono muda o papel de outra pessoa: a auditoria guarda o antes e o depois; os avisos que o papel novo não recebe saem da fila', async () => {
    await caso(db, postgres, async (s) => {
      const semanal = await avisoNaFila(s, SEGUNDO_DONO, 'weekly_report');
      const proposta = await avisoNaFila(s, SEGUNDO_DONO, 'proposal_to_approve');
      const v = await versao(s, 'mkt.profiles', SEGUNDO_DONO);
      const p = primeira(await chamar(s, DONO_2F, mudarPapel, [SEGUNDO_DONO, 'traffic_manager', v]));
      expect(p).toMatchObject({ id: SEGUNDO_DONO, role: 'traffic_manager', is_active: true });
      expect(await auditoria(s, 'role_changed')).toEqual([
        {
          actor_id: DONO,
          target_table: 'profiles',
          target_id: SEGUNDO_DONO,
          changes: { role: { before: 'owner', after: 'traffic_manager' } },
        },
      ]);
      expect(
        await s.linhas(
          `select id::text, status::text from mkt.notification_outbox where id = any($1::uuid[]) order by notice`,
          [[semanal, proposta]],
        ),
      ).toEqual([
        { id: proposta, status: 'skipped' },
        { id: semanal, status: 'pending' },
      ]);
      // Vale na próxima chamada: quem virou gestor não convida mais.
      expect(
        (
          await recusa(s, 'PT403', usuario(SEGUNDO_DONO, 'aal2'), convidar, [
            'x@example.com',
            'Pessoa',
            'owner',
          ])
        ).message,
      ).toBe('USR-403');
    });
  });

  it('com o updated_at antigo, PT409; perfil inativo ou que não existe, PT422 e PT404; o mesmo papel não muda nada', async () => {
    await caso(db, postgres, async (s) => {
      const v = await versao(s, 'mkt.profiles', GESTOR);
      expect(
        (await recusa(s, 'PT409', DONO_2F, mudarPapel, [GESTOR, 'owner', new Date(v.getTime() - 1000)]))
          .message,
      ).toBe('USR-409');
      const inativo = await versao(s, 'mkt.profiles', EX_GESTOR);
      expect((await recusa(s, 'PT422', DONO_2F, mudarPapel, [EX_GESTOR, 'owner', inativo])).message).toBe(
        'USR-422',
      );
      expect((await recusa(s, 'PT404', DONO_2F, mudarPapel, [NINGUEM, 'owner', v])).message).toBe('USR-404');
      const mesmo = primeira(await chamar(s, DONO_2F, mudarPapel, [GESTOR, 'traffic_manager', v]));
      expect(mesmo).toMatchObject({ role: 'traffic_manager', updated_at: v });
      expect(await auditoria(s, 'role_changed')).toEqual([]);
    });
  });
});

describe('acesso (api.revoke_access)', () => {
  it('RLS-08 e RLS-14: o gestor não tira o acesso do dono (PT403); o dono não tira o próprio (PT422)', async () => {
    await caso(db, postgres, async (s) => {
      const dono = await versao(s, 'mkt.profiles', DONO);
      expect(
        (await recusa(s, 'PT403', GESTOR_LOGADO, tirarAcesso, [DONO, 'security', null, dono])).message,
      ).toBe('USR-403');
      expect((await recusa(s, 'PT403', DONO_1F, tirarAcesso, [GESTOR, 'security', null, dono])).message).toBe(
        'USR-403',
      );
      expect((await recusa(s, 'PT422', DONO_2F, tirarAcesso, [DONO, 'security', null, dono])).message).toBe(
        'USR-422',
      );
      expect(await perfil(s, DONO)).toMatchObject({ role: 'owner', is_active: true });
    });
  });

  it('o dono tira o acesso do gestor: perfil inativo, sem WhatsApp, preferências e filtros; avisos fora da fila; a RLS nega na hora', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(`update mkt.profiles set whatsapp_digits = '5511900000001' where id = '${GESTOR}'`);
      await chamar(s, GESTOR_LOGADO, `select api.save_filter('bar', 'Meu filtro', '{"platform": "meta"}')`);
      await chamar(
        s,
        GESTOR_LOGADO,
        `select api.save_notification_preference('weekly_report', false, false)`,
      );
      const aviso = await avisoNaFila(s, GESTOR, 'weekly_report');
      const v = await versao(s, 'mkt.profiles', GESTOR);

      const r = await chamar(s, DONO_2F, tirarAcesso, [GESTOR, 'left_company', null, v]);
      expect(r).toEqual([{ id: GESTOR, email: 'gestor.teste@example.com' }]);
      expect(await perfil(s, GESTOR)).toMatchObject({
        is_active: false,
        whatsapp_digits: null,
        deactivation_reason: 'left_company',
        deactivated_by: DONO,
      });
      expect(
        await s.linhas(
          `select (select count(*)::int from mkt.saved_filters where profile_id = $1) as filtros,
                  (select count(*)::int from mkt.notification_preferences where profile_id = $1) as avisos,
                  (select status::text from mkt.notification_outbox where id = $2) as fila`,
          [GESTOR, aviso],
        ),
      ).toEqual([{ filtros: 0, avisos: 0, fila: 'skipped' }]);
      expect((await auditoria(s, 'access_revoked')).map((l) => [l.target_id, l.changes])).toEqual([
        [GESTOR, { reason: 'left_company' }],
      ]);
      // Na próxima chamada: o gestor não lê nem opera; o perfil dele continua visível só para ele.
      await s.como(GESTOR_LOGADO);
      expect(await s.valor(`select authz.can('view_numbers')`)).toBe(false);
      expect(await s.linhas('select is_active from api.my_profile()')).toEqual([{ is_active: false }]);
    });
  });

  it('"outro" sem nota ou com dado pessoal, sem motivo: PT422; perfil já inativo: PT422; nada muda', async () => {
    await caso(db, postgres, async (s) => {
      const v = await versao(s, 'mkt.profiles', GESTOR);
      const tentativas: Array<[unknown[], string | undefined]> = [
        [[GESTOR, 'other', null, v], 'note'],
        [[GESTOR, 'other', 'Curta', v], 'note'],
        [[GESTOR, 'other', 'Falar com ele no (11) 98765-4321', v], 'note'],
        [[GESTOR, null, null, v], 'reason'],
      ];
      for (const [args, detalhe] of tentativas) {
        const e = await recusa(s, 'PT422', DONO_2F, tirarAcesso, args);
        expect([e.message, e.detail]).toEqual(['USR-422', detalhe]);
      }
      const inativo = await versao(s, 'mkt.profiles', EX_GESTOR);
      expect(
        (await recusa(s, 'PT422', DONO_2F, tirarAcesso, [EX_GESTOR, 'security', null, inativo])).message,
      ).toBe('USR-422');
      expect(await perfil(s, GESTOR)).toMatchObject({ is_active: true, updated_at: v });
    });
  });
});

describe('configurações da própria pessoa', () => {
  const preferencias = 'select * from api.save_profile_preferences($1, $2, $3, $4)';

  it('tema, marca, visão e WhatsApp: só o próprio perfil; o WhatsApp com máscara e sem o 55 vira 55 + DDD + número', async () => {
    await caso(db, postgres, async (s) => {
      const p = primeira(
        await chamar(s, GESTOR_LOGADO, preferencias, ['dark', 'plumene', 'manager', '(11) 98765-4321']),
      );
      expect(p).toMatchObject({
        id: GESTOR,
        theme_preference: 'dark',
        default_brand: 'plumene',
        default_view: 'manager',
        whatsapp_digits: '5511987654321',
      });
      expect(
        primeira(
          await chamar(s, GESTOR_LOGADO, preferencias, ['device', null, 'viewer', '+55 11 3333-4444']),
        ),
      ).toMatchObject({ default_brand: null, whatsapp_digits: '551133334444' });
      expect(
        primeira(await chamar(s, GESTOR_LOGADO, preferencias, ['light', null, 'viewer', ''])),
      ).toMatchObject({
        whatsapp_digits: null,
      });
      for (const [args, detalhe] of [
        [['light', null, 'viewer', '1234'], 'whatsapp'],
        [[null, null, 'viewer', null], 'preferences'],
      ] as const) {
        const e = await recusa(s, 'PT422', GESTOR_LOGADO, preferencias, [...args]);
        expect([e.message, e.detail]).toEqual(['CFG-422', detalhe]);
      }
      // O perfil do dono não mudou.
      await s.como(postgres);
      expect(await s.valor(`select theme_preference::text from mkt.profiles where id = $1`, [DONO])).toBe(
        'device',
      );
    });
  });

  it('avisos: só os que o papel recebe; RLS-13: o gestor vê o padrão dele, não a escolha do dono', async () => {
    await caso(db, postgres, async (s) => {
      const salvar = 'select * from api.save_notification_preference($1, $2, $3)';
      await chamar(s, DONO_2F, salvar, ['weekly_report', false, true]);
      const e = await recusa(s, 'PT422', GESTOR_LOGADO, salvar, ['proposal_to_approve', true, false]);
      expect([e.message, e.detail]).toEqual(['CFG-422', 'notice']);

      const doGestor = await chamar(s, GESTOR_LOGADO, 'select * from api.my_notification_preferences()');
      expect(doGestor).toEqual([
        {
          notice: 'connector_down',
          is_email_enabled: true,
          is_whatsapp_enabled: true,
          is_urgent: true,
          is_default: true,
        },
        {
          notice: 'spend_near_limit',
          is_email_enabled: true,
          is_whatsapp_enabled: true,
          is_urgent: true,
          is_default: true,
        },
        {
          notice: 'cost_per_lead_high',
          is_email_enabled: true,
          is_whatsapp_enabled: true,
          is_urgent: true,
          is_default: true,
        },
        {
          notice: 'weekly_report',
          is_email_enabled: true,
          is_whatsapp_enabled: false,
          is_urgent: false,
          is_default: true,
        },
      ]);
      // O dono vê os oito avisos (sem o segundo fator também: receber não pede o TOTP), com a escolha dele.
      const doDono = await chamar<{ notice: string; is_email_enabled: boolean; is_default: boolean }>(
        s,
        DONO_1F,
        'select * from api.my_notification_preferences()',
      );
      expect(doDono.map((l) => l.notice)).toHaveLength(8);
      expect(doDono.find((l) => l.notice === 'weekly_report')).toMatchObject({
        is_email_enabled: false,
        is_default: false,
      });
      // Gravar de novo troca a mesma linha.
      await chamar(s, DONO_2F, salvar, ['weekly_report', true, true]);
      await s.como(postgres);
      expect(
        await s.linhas(
          `select is_email_enabled, is_whatsapp_enabled from mkt.notification_preferences
            where profile_id = $1 and notice = 'weekly_report'`,
          [DONO],
        ),
      ).toEqual([{ is_email_enabled: true, is_whatsapp_enabled: true }]);
    });
  });

  it('"Meus filtros": salvar de novo com o mesmo nome fica com o mesmo id; chave que não é da barra, PT422', async () => {
    await caso(db, postgres, async (s) => {
      const salvar = 'select * from api.save_filter($1, $2, $3)';
      const primeiro = primeira(
        await chamar(s, DONO_2F, salvar, ['bar', 'Filtro do dono', '{"platform": "meta"}']),
      );
      const segundo = primeira(
        await chamar(s, DONO_1F, salvar, [
          'bar',
          ' Filtro do dono ',
          '{"platform": "google", "compare": true}',
        ]),
      );
      expect(segundo).toMatchObject({
        id: primeiro.id,
        name: 'Filtro do dono',
        filters: { platform: 'google', compare: true },
      });
      for (const [args, detalhe] of [
        [['bar', 'Com marca', '{"brand": "cs"}'], 'filters'],
        [['traffic_list', 'Período', '{"period": "this_month"}'], 'filters'],
        [['bar', '   ', '{}'], 'name'],
      ] as const) {
        const e = await recusa(s, 'PT422', DONO_2F, salvar, [...args]);
        expect([e.message, e.detail]).toEqual(['CFG-422', detalhe]);
      }
    });
  });

  it('RLS-13: o gestor não lê nem apaga os filtros e os avisos do dono (zero linhas, PT404); o dono apaga o dele', async () => {
    await caso(db, postgres, async (s) => {
      const filtro = await s.valor<string>(
        `select id::text from mkt.saved_filters where profile_id = $1 and name = 'Meta do mês'`,
        [DONO],
      );
      await s.como(GESTOR_LOGADO);
      expect(await s.linhas('select * from mkt.saved_filters where profile_id = $1', [DONO])).toEqual([]);
      expect(
        await s.linhas('select * from mkt.notification_preferences where profile_id = $1', [DONO]),
      ).toEqual([]);
      expect((await s.erro('PT404', 'select api.delete_saved_filter($1)', [filtro])).message).toBe('CFG-404');
      await s.como(postgres);
      expect(await s.valor('select count(*)::int from mkt.saved_filters where id = $1', [filtro])).toBe(1);

      await chamar(s, DONO_1F, 'select api.delete_saved_filter($1)', [filtro]);
      await s.como(postgres);
      expect(await s.valor('select count(*)::int from mkt.saved_filters where id = $1', [filtro])).toBe(0);
    });
  });
});

describe('leituras com regra própria', () => {
  it('my_profile: o próprio perfil, com o e-mail do login e o updated_at da trava otimista', async () => {
    await caso(db, GESTOR_LOGADO, async (s) => {
      const p = primeira(await s.linhas('select * from api.my_profile()'));
      expect(p).toMatchObject({
        id: GESTOR,
        email: 'gestor.teste@example.com',
        display_name: 'Gestor de teste',
        role: 'traffic_manager',
        is_active: true,
      });
      expect(p.updated_at).toBeInstanceOf(Date);
    });
  });

  it('my_permissions: as ações do papel, quais pedem o segundo fator e quais valem com a sessão de agora', async () => {
    const pode = async (quem: Quem) =>
      caso(db, quem, async (s) =>
        s.linhas<{ action: string; requires_second_factor: boolean; is_allowed: boolean }>(
          'select * from api.my_permissions()',
        ),
      );
    const dono2f = await pode(DONO_2F);
    expect(dono2f.map((l) => l.action)).toEqual(PODE.owner);
    expect(dono2f.every((l) => l.is_allowed)).toBe(true);
    for (const l of dono2f) expect(l.requires_second_factor, l.action).toBe(SEGUNDO_FATOR.includes(l.action));

    const dono1f = await pode(DONO_1F);
    expect(dono1f.filter((l) => !l.is_allowed).map((l) => l.action)).toEqual(
      PODE.owner.filter((a) => SEGUNDO_FATOR.includes(a)),
    );
    expect((await pode(GESTOR_LOGADO)).map((l) => l.action)).toEqual(PODE.traffic_manager);
  });

  it('list_role_permissions: os dois papéis, para quem tem perfil ativo (também o gestor e sem o segundo fator)', async () => {
    for (const quem of [GESTOR_LOGADO, DONO_1F]) {
      await caso(db, quem, async (s) => {
        const quadro = await s.linhas<{ role: string; action: string; requires_second_factor: boolean }>(
          'select * from api.list_role_permissions()',
        );
        expect(quadro.filter((l) => l.role === 'owner').map((l) => l.action)).toEqual(PODE.owner);
        expect(quadro.filter((l) => l.role === 'traffic_manager').map((l) => l.action)).toEqual(
          PODE.traffic_manager,
        );
        expect(quadro.findIndex((l) => l.role === 'traffic_manager')).toBe(PODE.owner.length);
        for (const l of quadro) {
          expect(l.requires_second_factor, l.action).toBe(SEGUNDO_FATOR.includes(l.action));
        }
      });
    }
  });

  it('check_text: a mesma regra do banco, para quem tem perfil ativo', async () => {
    await caso(db, GESTOR_LOGADO, async (s) => {
      expect(
        await s.linhas(`
          select api.check_text('Foco em lojistas do Sul.') as limpo,
                 api.check_text('Falar com pessoa@exemplo.invalid') as email,
                 api.check_text('Ligar no (11) 98765-4321') as telefone,
                 api.check_text('campanha 120200000000000000 da conta act_900000000000001') as ids,
                 api.check_text(null) as nulo`),
      ).toEqual([{ limpo: false, email: true, telefone: true, ids: false, nulo: false }]);
    });
  });

  it('list_users: só o dono com o segundo fator (RLS-08, RLS-09 e RLS-35); o dono primeiro, depois o nome', async () => {
    await caso(db, postgres, async (s) => {
      for (const quem of [GESTOR_LOGADO, DONO_1F]) {
        expect((await recusa(s, 'PT403', quem, 'select * from api.list_users()')).message).toBe('USR-403');
      }
      const usuarios = await chamar<{ id: string; email: string; role: string; is_active: boolean }>(
        s,
        DONO_2F,
        'select id::text, email, role::text, is_active from api.list_users()',
      );
      expect(usuarios).toEqual([
        { id: DONO, email: 'dono.teste@example.com', role: 'owner', is_active: true },
        { id: SEGUNDO_DONO, email: 'segundo.dono@example.com', role: 'owner', is_active: true },
        { id: EX_GESTOR, email: `removido+${EX_GESTOR}@invalid`, role: 'traffic_manager', is_active: false },
        { id: GESTOR, email: 'gestor.teste@example.com', role: 'traffic_manager', is_active: true },
      ]);
    });
  });

  it('RLS-09: o gestor não lê convites, auditoria nem o perfil dos outros (zero linhas)', async () => {
    await caso(db, GESTOR_LOGADO, async (s) => {
      expect(await s.linhas('select id from mkt.invitations')).toEqual([]);
      expect(await s.linhas('select id from mkt.audit_log')).toEqual([]);
      expect(await s.linhas('select id::text from mkt.profiles')).toEqual([{ id: GESTOR }]);
    });
  });

  it('o aviso na fila do dono continua lá: as funções de configuração só mexem na própria pessoa', async () => {
    await caso(db, postgres, async (s) => {
      await chamar(s, GESTOR_LOGADO, preferenciasDoGestor);
      await s.como(postgres);
      expect(await s.valor('select status::text from mkt.notification_outbox where id = $1', [AVISO])).toBe(
        'pending',
      );
    });
  });
});

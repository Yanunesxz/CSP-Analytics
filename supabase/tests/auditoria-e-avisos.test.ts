// Migração 03: a auditoria só por acréscimo e as chaves de cada evento; "Meus filtros" com as chaves de cada barra; e
// o padrão de cada aviso (docs/dados/tabelas.md, seção 5, e a decisão 0019). Usuários de fixtures/usuarios.sql.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { abrirBanco, aplicarFixture, caso, postgres, servico, usuario } from './apoio/banco';
import { codigosDoDomain, consultaDe } from './apoio/catalogo';
import { DONO, GESTOR } from './apoio/usuarios';

const UM_ID = '00000000-0000-4000-8000-0000000001e1';

let db: PGlite;
let avisos: string[];

beforeAll(async () => {
  db = await abrirBanco();
  await aplicarFixture(db, 'usuarios');
  avisos = await codigosDoDomain(consultaDe(db), 'notice_kind');
});

afterAll(async () => {
  await db.close();
});

const auditar = (changes: string, quando = 'now()') =>
  `insert into mkt.audit_log (occurred_at, actor_kind, event, target_table, changes)
   values (${quando}, 'system', 'credential_status_changed', 'connector_credentials', '${changes}')`;

describe('audit_log: só por acréscimo', () => {
  it('ninguém altera, apaga ou esvazia a auditoria, nem o dono do banco', async () => {
    await caso(db, postgres, async (s) => {
      expect((await s.erro('PT403', `update mkt.audit_log set target_table = 'outra_tabela'`)).message).toBe(
        'LOG-403',
      );
      await s.erro('PT403', `update mkt.audit_log set changes = '{}'`);
      await s.erro('PT403', 'delete from mkt.audit_log');
      await s.erro('PT403', 'truncate mkt.audit_log');
      expect(await s.valor('select count(*)::int from mkt.audit_log')).toBe(1);
    });
  });

  it('a limpeza do prazo de guarda (2 anos) apaga só a linha vencida; com uma recente no meio, nada sai', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(auditar('{}', `now() - interval '2 years 1 day'`));
      await s.exec(auditar('{}', `now() - interval '1 year 11 months'`));
      expect(
        await s.linhas(
          `delete from mkt.audit_log where occurred_at < now() - interval '2 years' returning 1`,
        ),
      ).toHaveLength(1);
      await s.erro('PT403', `delete from mkt.audit_log where occurred_at < now() - interval '1 year'`);
      expect(await s.valor('select count(*)::int from mkt.audit_log')).toBe(2);
    });
  });

  it('RLS-17: pela API ninguém grava a auditoria, nem o dono com o segundo fator; o worker também não lê', async () => {
    await caso(db, usuario(DONO, 'aal2'), async (s) => {
      expect(await s.valor('select count(*)::int from mkt.audit_log')).toBe(1);
      await s.erro('42501', auditar('{}'));
      await s.erro('42501', `update mkt.audit_log set changes = '{}'`);
      await s.erro('42501', 'delete from mkt.audit_log');
    });
    await caso(db, servico('mkt_worker'), async (s) => {
      await s.erro('42501', 'select count(*) from mkt.audit_log');
      await s.erro('42501', auditar('{}'));
    });
  });

  it('quem fez: a pessoa leva o id; o Claude e o sistema, não; a tabela-alvo é um nome do banco', async () => {
    await caso(db, postgres, async (s) => {
      const linha = (ator: string, id: string | null, alvo = 'invitations') =>
        `insert into mkt.audit_log (actor_kind, actor_id, event, target_table)
         values ('${ator}', ${id ? `'${id}'` : 'null'}, 'invite_revoked', '${alvo}')`;
      await s.exec(linha('user', DONO));
      await s.exec(linha('system', null));
      await s.erro('23514', linha('user', null));
      await s.erro('23514', linha('claude', DONO));
      await s.erro('23514', linha('system', null, 'Invitations'));
      await s.erro('23514', linha('system', null, 'x'));
      await s.erro('23514', linha('robot', null));
    });
  });
});

describe('mkt.valid_audit_changes: só as chaves previstas de cada evento, nunca e-mail', () => {
  const CASOS: Array<[string, unknown, boolean]> = [
    ['invite_sent', { invitation_id: UM_ID, role: 'traffic_manager' }, true],
    ['invite_sent', {}, true],
    ['invite_sent', { email: 'pessoa@example.com' }, false],
    ['invite_sent', { invitation_id: 'pessoa@example.com' }, false],
    ['invite_sent', { display_name: 'Pessoa' }, false],
    ['invite_sent', { role: 'admin' }, false],
    ['invite_sent', { invitation_id: 123 }, false],
    ['invite_sent', [UM_ID], false],
    ['invite_sent', null, false],
    ['first_owner_created', { invitation_id: UM_ID, role: 'owner' }, true],
    ['invite_revoked', { invitation_id: UM_ID }, true],
    ['invite_revoked', { role: 'owner' }, false],
    ['role_changed', { role: { before: 'traffic_manager', after: 'owner' } }, true],
    ['role_changed', { role: 'owner' }, false],
    ['role_changed', { role: { before: 'traffic_manager' } }, false],
    ['role_changed', { role: { before: 'gerente', after: 'owner' } }, false],
    [
      'role_changed',
      { role: { before: 'traffic_manager', after: 'owner', by: 'pessoa@example.com' } },
      false,
    ],
    ['access_revoked', { reason: 'left_company' }, true],
    ['access_revoked', { reason: 'demitido' }, false],
    ['access_revoked', { reason: 'other', note: 'Saiu da empresa em outubro' }, false],
    [
      'connector_state_changed',
      { connector: 'meta', setup_state: { before: 'connected', after: 'disabled' } },
      true,
    ],
    ['connector_state_changed', { connector: 'facebook' }, false],
    ['connector_retry_requested', { connector: 'ga4', sync_run_id: UM_ID }, true],
    ['mass_delete_confirmed', { connector: 'csp360', sync_run_id: UM_ID }, true],
    ['mass_delete_confirmed', { connector: 'csp360', sync_run_id: 'ontem' }, false],
    [
      'credential_status_changed',
      { connector: 'meta', purpose: 'read', status: { before: 'valid', after: 'expiring' } },
      true,
    ],
    ['credential_status_changed', { purpose: 'admin' }, false],
    ['credential_status_changed', { status: { before: 'valid', after: 'expiring' }, token: 'abc' }, false],
  ];

  it('cada evento aceita só as chaves dele, com valores das listas', async () => {
    await caso(db, usuario(DONO), async (s) => {
      for (const [evento, changes, valido] of CASOS) {
        expect(
          await s.valor('select mkt.valid_audit_changes($1::mkt.audit_event, $2::jsonb)', [
            evento,
            changes === null ? null : JSON.stringify(changes),
          ]),
          `${evento} ${JSON.stringify(changes)}`,
        ).toBe(valido);
      }
    });
  });

  it('a tabela recusa a linha com chave fora do evento', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro(
        '23514',
        `insert into mkt.audit_log (actor_kind, actor_id, event, target_table, changes)
         values ('user', '${DONO}', 'invite_sent', 'invitations', '{"email": "pessoa@example.com"}')`,
      );
      await s.exec(auditar('{"connector": "meta", "status": {"before": "valid", "after": "invalid"}}'));
    });
  });
});

describe('Meus filtros: saved_filters e mkt.valid_saved_filters', () => {
  const CASOS: Array<[string, unknown, boolean]> = [
    [
      'bar',
      {
        period: 'this_month',
        compare: true,
        platform: 'meta',
        campaign: 'cs-black-friday',
        operator: 'claude',
        origin: 'ai_assistant',
        sales_rep: 'REP-0001',
      },
      true,
    ],
    ['bar', {}, true],
    ['bar', { platform: null, origin: null, compare: false }, true],
    ['bar', { campaign: '120200000000000000', sales_rep: 'REP-10000' }, true],
    ['bar', { period: 'este-mes' }, false],
    ['bar', { compare: 'true' }, false],
    ['bar', { platform: 'facebook' }, false],
    ['bar', { operator: 'todos' }, false],
    ['bar', { origin: 'instagram' }, false],
    ['bar', { status: 'idea' }, false],
    ['bar', { brand: 'cs' }, false],
    ['bar', { sales_rep: 'Representante 1' }, false],
    ['bar', { campaign: 'cliente@example.com' }, false],
    ['bar', { campaign: '' }, false],
    ['bar', { campaign: 'x'.repeat(151) }, false],
    ['bar', { platform: 1 }, false],
    [
      'traffic_list',
      {
        platform: 'google',
        campaign: '120200000000000000',
        operator: 'human',
        status: 'failed',
        impact: 'high',
        effort: 'low',
      },
      true,
    ],
    ['traffic_list', { period: 'this_month' }, false],
    ['traffic_list', { origin: 'site' }, false],
    ['traffic_list', { status: 'simulated' }, false],
    ['traffic_list', { impact: 'huge' }, false],
    ['traffic_list', ['meta'], false],
    ['traffic_list', 'meta', false],
  ];

  it('cada barra guarda só as chaves dela, com os códigos do banco', async () => {
    await caso(db, usuario(DONO), async (s) => {
      for (const [escopo, filtros, valido] of CASOS) {
        expect(
          await s.valor('select mkt.valid_saved_filters($1::mkt.saved_filter_scope, $2::jsonb)', [
            escopo,
            JSON.stringify(filtros),
          ]),
          `${escopo} ${JSON.stringify(filtros)}`,
        ).toBe(valido);
      }
    });
  });

  it('nome de 1 a 40 letras, um por nome em cada barra da pessoa, filtros conferidos', async () => {
    await caso(db, postgres, async (s) => {
      const salvar = (escopo: string, nome: string, filtros: string, pessoa = DONO) =>
        `insert into mkt.saved_filters (profile_id, scope, name, filters)
         values ('${pessoa}', '${escopo}', '${nome}', '${filtros}')`;
      await s.exec(salvar('bar', 'Meta do mês', '{}', GESTOR));
      await s.exec(salvar('traffic_list', 'Meta do mês', '{}'));
      await s.erro('23505', salvar('bar', 'Meta do mês', '{}'));
      await s.erro('23514', salvar('bar', ' ', '{}'));
      await s.erro('23514', salvar('bar', 'x'.repeat(41), '{}'));
      await s.erro('23514', salvar('bar', 'Novo', '{"platform": "facebook"}'));
      await s.erro('23514', salvar('painel', 'Novo', '{}'));
    });
  });
});

describe('avisos: mkt.notice_default e notification_preferences', () => {
  /** Quem recebe cada aviso e se é urgente (decisão 0019; avisos.ts do protótipo e listas.md). */
  const PADRAO: Record<string, [string, boolean]> = {
    connector_down: ['view_connectors', true],
    spend_near_limit: ['view_traffic', true],
    cost_per_lead_high: ['view_numbers', true],
    proposal_to_approve: ['approve_action', false],
    weekly_report: ['view_numbers', false],
    credential_expiring: ['retry_connector', true],
    stop_not_confirmed: ['stop_all', true],
    mass_delete_blocked: ['retry_connector', true],
  };

  it('cada aviso da lista tem a permissão que aponta; e-mail em tudo e WhatsApp só no urgente', async () => {
    expect([...avisos].sort()).toEqual(Object.keys(PADRAO).sort());
    await caso(db, usuario(DONO), async (s) => {
      const linhas = await s.linhas<{
        aviso: string;
        required_action: string;
        is_urgent: boolean;
        is_email_enabled: boolean;
        is_whatsapp_enabled: boolean;
      }>(
        `select a.aviso, d.required_action::text, d.is_urgent, d.is_email_enabled, d.is_whatsapp_enabled
           from unnest($1::text[]) as a(aviso), mkt.notice_default(a.aviso::mkt.notice_kind) d`,
        [avisos],
      );
      expect(linhas).toHaveLength(avisos.length);
      for (const l of linhas) {
        const [acao, urgente] = PADRAO[l.aviso] ?? ['', false];
        expect(l, l.aviso).toEqual({
          aviso: l.aviso,
          required_action: acao,
          is_urgent: urgente,
          is_email_enabled: true,
          is_whatsapp_enabled: urgente,
        });
      }
    });
  });

  it('o gestor só recebe o que o papel dele pode ver: nada de aprovar, de credencial, de exclusão em massa nem de parada', async () => {
    await caso(db, postgres, async (s) => {
      const linhas = await s.linhas<{ role: string; avisos: string[] }>(
        `select rp.role::text, array_agg(a.aviso order by a.aviso) as avisos
           from unnest($1::text[]) as a(aviso)
           join mkt.role_permissions rp on rp.action = (mkt.notice_default(a.aviso::mkt.notice_kind)).required_action
          group by rp.role order by 1`,
        [avisos],
      );
      expect(linhas).toEqual([
        { role: 'owner', avisos: [...avisos].sort() },
        {
          role: 'traffic_manager',
          avisos: ['connector_down', 'cost_per_lead_high', 'spend_near_limit', 'weekly_report'],
        },
      ]);
    });
  });

  it('uma escolha por aviso e pessoa, só com avisos da lista', async () => {
    await caso(db, postgres, async (s) => {
      const escolher = (aviso: string) =>
        `insert into mkt.notification_preferences (profile_id, notice, is_email_enabled, is_whatsapp_enabled)
         values ('${DONO}', '${aviso}', true, false)`;
      await s.exec(escolher('connector_down'));
      await s.erro('23505', escolher('weekly_report'));
      await s.erro('23514', escolher('conector_parado'));
    });
  });
});

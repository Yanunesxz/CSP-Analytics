// Migração 03: perfil só com convite, papel e acesso protegidos, authz.can com e sem o segundo fator, perfil
// inativo e quem lê cada tabela de pessoas (docs/dados/tabelas.md, "profiles", e papeis-e-rls.md). Os usuários são
// os inventados de fixtures/usuarios.sql.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Quem,
  type Sessao,
  abrirBanco,
  anon,
  aplicarFixture,
  caso,
  postgres,
  servico,
  usuario,
} from './apoio/banco';
import { codigosDoDomain, consultaDe } from './apoio/catalogo';
import {
  DONO,
  EX_GESTOR,
  GESTOR,
  type Papel,
  PODE,
  SEGUNDO_DONO,
  SEGUNDO_FATOR,
  SEM_PERFIL,
} from './apoio/usuarios';

const TABELAS_DE_PESSOAS = [
  'mkt.profiles',
  'mkt.invitations',
  'mkt.notification_preferences',
  'mkt.saved_filters',
  'mkt.audit_log',
];

let db: PGlite;
let acoes: string[];

beforeAll(async () => {
  db = await abrirBanco();
  await aplicarFixture(db, 'usuarios');
  acoes = await codigosDoDomain(consultaDe(db), 'app_action');
});

afterAll(async () => {
  await db.close();
});

/** Um convite aberto, gravado como o dono do banco (api.invite_user grava assim, na migração 09). */
async function convidar(
  s: Sessao,
  c: { email: string; nome?: string; papel?: Papel; por?: string | null; vence?: string },
): Promise<string> {
  return s.valor<string>(
    `insert into mkt.invitations (email_normalized, display_name, role, invited_by, expires_at)
     values ($1, $2, $3, $4, now() + $5::interval) returning id::text`,
    [c.email, c.nome ?? 'Pessoa convidada', c.papel ?? 'traffic_manager', c.por ?? null, c.vence ?? '7 days'],
  );
}

/** Um login novo, como o Supabase Auth grava (invited_at preenchido quando veio de convite). */
async function novoLogin(
  s: Sessao,
  l: { id: string; email: string; convidado?: boolean; metadados?: Record<string, unknown> },
): Promise<void> {
  await s.linhas(
    `insert into auth.users (id, email, invited_at, raw_user_meta_data, raw_app_meta_data)
     values ($1, $2, case when $3::boolean then now() end, $4::jsonb, $4::jsonb)`,
    [l.id, l.email, l.convidado ?? true, JSON.stringify(l.metadados ?? {})],
  );
}

async function temPerfil(s: Sessao, id: string): Promise<boolean> {
  return s.valor<boolean>('select exists (select 1 from mkt.profiles where id = $1)', [id]);
}

describe('perfil só com convite válido (gatilho em auth.users)', () => {
  it('o primeiro dono e os convidados da fixture nasceram pelo convite, que ficou aceito', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        await s.linhas(
          `select p.id::text, p.display_name, p.role::text, p.is_active, p.invited_by::text,
                  i.accepted_profile_id::text = p.id::text as aceito
             from mkt.profiles p left join mkt.invitations i on i.accepted_profile_id = p.id
            where p.id = any($1::uuid[]) order by p.id`,
          [[DONO, SEGUNDO_DONO, GESTOR]],
        ),
      ).toEqual([
        {
          id: DONO,
          display_name: 'Dono de teste',
          role: 'owner',
          is_active: true,
          invited_by: null,
          aceito: true,
        },
        {
          id: SEGUNDO_DONO,
          display_name: 'Segundo dono',
          role: 'owner',
          is_active: true,
          invited_by: DONO,
          aceito: true,
        },
        {
          id: GESTOR,
          display_name: 'Gestor de teste',
          role: 'traffic_manager',
          is_active: true,
          invited_by: DONO,
          aceito: true,
        },
      ]);
      expect(await temPerfil(s, SEM_PERFIL)).toBe(false);
    });
  });

  it('o nome e o papel vêm só do convite, nunca dos metadados do login; o e-mail casa sem diferença de caixa', async () => {
    const id = '00000000-0000-4000-8000-000000000a01';
    await caso(db, postgres, async (s) => {
      const convite = await convidar(s, { email: 'nova.pessoa@example.com', nome: 'Pessoa nova', por: DONO });
      await novoLogin(s, {
        id,
        email: 'Nova.Pessoa@Example.COM',
        metadados: { role: 'owner', display_name: 'Outro nome', full_name: 'Outro nome' },
      });
      expect(
        await s.linhas(
          'select display_name, role::text, is_active, invited_by::text from mkt.profiles where id = $1',
          [id],
        ),
      ).toEqual([
        { display_name: 'Pessoa nova', role: 'traffic_manager', is_active: true, invited_by: DONO },
      ]);
      expect(
        await s.linhas(
          `select accepted_at is not null as aceito, accepted_profile_id::text as perfil from mkt.invitations where id = $1`,
          [convite],
        ),
      ).toEqual([{ aceito: true, perfil: id }]);
    });
  });

  it('sem convite válido nada nasce: sem convite, cadastro aberto, vencido, revogado ou já aceito', async () => {
    await caso(db, postgres, async (s) => {
      // Login convidado no Auth sem convite no CSP-MKT.
      await novoLogin(s, {
        id: '00000000-0000-4000-8000-000000000b01',
        email: 'ninguem.convidou@example.com',
      });
      // Cadastro aberto (sem invited_at), mesmo com convite aberto para o e-mail: o convite continua aberto.
      const aberto = await convidar(s, { email: 'cadastro.aberto@example.com', por: DONO });
      await novoLogin(s, {
        id: '00000000-0000-4000-8000-000000000b02',
        email: 'cadastro.aberto@example.com',
        convidado: false,
      });
      // Convite vencido.
      await convidar(s, { email: 'convite.vencido@example.com', por: DONO, vence: '-1 minute' });
      await novoLogin(s, {
        id: '00000000-0000-4000-8000-000000000b03',
        email: 'convite.vencido@example.com',
      });
      // Convite revogado.
      const revogado = await convidar(s, { email: 'convite.revogado@example.com', por: DONO });
      await s.exec(
        `update mkt.invitations set revoked_at = now(), revoked_by = '${DONO}' where id = '${revogado}'`,
      );
      await novoLogin(s, {
        id: '00000000-0000-4000-8000-000000000b04',
        email: 'convite.revogado@example.com',
      });
      // Convite já aceito: um segundo login com o mesmo e-mail não ganha perfil.
      await novoLogin(s, { id: '00000000-0000-4000-8000-000000000b05', email: 'gestor.teste@example.com' });

      for (const n of ['01', '02', '03', '04', '05']) {
        expect(await temPerfil(s, `00000000-0000-4000-8000-000000000b${n}`), n).toBe(false);
      }
      expect(await s.valor('select accepted_at is null from mkt.invitations where id = $1', [aberto])).toBe(
        true,
      );
    });
  });

  it('o Auth grava invited_at num update logo depois de criar o login: o perfil nasce aí, uma vez só', async () => {
    const id = '00000000-0000-4000-8000-000000000a02';
    await caso(db, postgres, async (s) => {
      const convite = await convidar(s, {
        email: 'convite.em.dois.passos@example.com',
        nome: 'Dois passos',
        por: DONO,
      });
      await novoLogin(s, { id, email: 'convite.em.dois.passos@example.com', convidado: false });
      expect(await temPerfil(s, id)).toBe(false);
      await s.exec(`update auth.users set invited_at = now() where id = '${id}'`);
      expect(await s.linhas('select display_name, role::text from mkt.profiles where id = $1', [id])).toEqual(
        [{ display_name: 'Dois passos', role: 'traffic_manager' }],
      );
      // Convite reenviado ao mesmo login: nada muda, e o convite continua aceito por ele.
      await s.exec(`update auth.users set invited_at = now() + interval '1 minute' where id = '${id}'`);
      expect(await s.valor('select count(*)::int from mkt.profiles where id = $1', [id])).toBe(1);
      expect(
        await s.valor('select accepted_profile_id::text from mkt.invitations where id = $1', [convite]),
      ).toBe(id);
      // Quem já tem perfil não troca de papel por um convite novo reenviado pelo Auth: papel só por api.change_role.
      const outro = await convidar(s, { email: 'gestor.teste@example.com', papel: 'owner', por: DONO });
      await s.exec(`update auth.users set invited_at = now() where id = '${GESTOR}'`);
      expect(await s.valor('select role::text from mkt.profiles where id = $1', [GESTOR])).toBe(
        'traffic_manager',
      );
      expect(await s.valor('select accepted_at is null from mkt.invitations where id = $1', [outro])).toBe(
        true,
      );
      // Outro campo do login muda sem tocar em perfil nenhum.
      await s.exec(`update auth.users set last_sign_in_at = now() where id = '${SEM_PERFIL}'`);
      expect(await temPerfil(s, SEM_PERFIL)).toBe(false);
    });
  });

  it('convite de quem não pode mais convidar não vale: perfil inativo ou papel sem manage_users', async () => {
    await caso(db, postgres, async (s) => {
      await convidar(s, { email: 'convite.do.ex@example.com', por: EX_GESTOR });
      await novoLogin(s, { id: '00000000-0000-4000-8000-000000000c01', email: 'convite.do.ex@example.com' });
      await convidar(s, { email: 'convite.do.gestor@example.com', por: GESTOR });
      await novoLogin(s, {
        id: '00000000-0000-4000-8000-000000000c02',
        email: 'convite.do.gestor@example.com',
      });
      // Controle: o mesmo caminho com quem gere usuários e está ativo.
      await convidar(s, { email: 'convite.do.dono@example.com', por: SEGUNDO_DONO });
      await novoLogin(s, {
        id: '00000000-0000-4000-8000-000000000c03',
        email: 'convite.do.dono@example.com',
      });

      expect(await temPerfil(s, '00000000-0000-4000-8000-000000000c01')).toBe(false);
      expect(await temPerfil(s, '00000000-0000-4000-8000-000000000c02')).toBe(false);
      expect(await temPerfil(s, '00000000-0000-4000-8000-000000000c03')).toBe(true);
    });
  });

  it('convite sem quem convidou só vale para o primeiro dono: papel de dono e nenhum dono ativo', async () => {
    await caso(db, postgres, async (s) => {
      // Com dono ativo, o convite sem quem convidou não vale.
      await convidar(s, { email: 'outro.primeiro@example.com', papel: 'owner', por: null });
      await novoLogin(s, { id: '00000000-0000-4000-8000-000000000d01', email: 'outro.primeiro@example.com' });
      expect(await temPerfil(s, '00000000-0000-4000-8000-000000000d01')).toBe(false);

      // Sem nenhum dono ativo (o gatilho de papel protegido desligado só para montar o cenário).
      await s.exec(`
        alter table mkt.profiles disable trigger profiles_guard;
        update mkt.profiles set is_active = false, deactivated_at = now(), deactivation_reason = 'security'
         where role = 'owner';
        alter table mkt.profiles enable trigger profiles_guard;
      `);
      await convidar(s, { email: 'gestor.sem.dono@example.com', papel: 'traffic_manager', por: null });
      await novoLogin(s, {
        id: '00000000-0000-4000-8000-000000000d02',
        email: 'gestor.sem.dono@example.com',
      });
      expect(await temPerfil(s, '00000000-0000-4000-8000-000000000d02')).toBe(false);

      await convidar(s, { email: 'novo.dono@example.com', nome: 'Novo dono', papel: 'owner', por: null });
      await novoLogin(s, { id: '00000000-0000-4000-8000-000000000d03', email: 'novo.dono@example.com' });
      expect(
        await s.linhas('select role::text, invited_by from mkt.profiles where id = $1', [
          '00000000-0000-4000-8000-000000000d03',
        ]),
      ).toEqual([{ role: 'owner', invited_by: null }]);
    });
  });

  it('um convite aberto por e-mail, e-mail normalizado, nome de 2 a 80 letras; aceito tem perfil e não é revogado', async () => {
    await caso(db, postgres, async (s) => {
      const primeiro = await convidar(s, { email: 'repetido@example.com', por: DONO });
      await s.erro(
        '23505',
        `insert into mkt.invitations (email_normalized, display_name, role, invited_by, expires_at)
         values ('repetido@example.com', 'De novo', 'owner', '${DONO}', now() + interval '7 days')`,
      );
      await s.exec(
        `update mkt.invitations set revoked_at = now(), revoked_by = '${DONO}' where id = '${primeiro}'`,
      );
      await convidar(s, { email: 'repetido@example.com', por: DONO });

      const insere = (email: string, nome: string) =>
        `insert into mkt.invitations (email_normalized, display_name, role, invited_by, expires_at)
         values ('${email}', '${nome}', 'owner', '${DONO}', now() + interval '7 days')`;
      await s.erro('23514', insere('Maiuscula@example.com', 'Pessoa'));
      await s.erro('23514', insere(' espaco@example.com', 'Pessoa'));
      await s.erro('23514', insere('sem-arroba.example.com', 'Pessoa'));
      await s.erro('23514', insere('nome.curto@example.com', 'A'));
      await s.erro('23514', insere('nome.longo@example.com', 'x'.repeat(81)));
      await s.erro('23514', `update mkt.invitations set accepted_at = now() where id = '${primeiro}'`);
      await s.erro(
        '23514',
        `update mkt.invitations set accepted_at = now(), accepted_profile_id = '${GESTOR}' where id = '${primeiro}'`,
      );
    });
  });
});

/** Stand-ins de api.change_role e api.revoke_access (migração 09): ligam a chave da transação e gravam. */
const FUNCOES_DE_TESTE = `
  create function test.mudar_papel(p_id uuid, p_role mkt.role, p_chave boolean default true) returns void
  language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
  begin
    if p_chave then
      perform set_config('mkt.allow_role_change', 'on', true);
    end if;
    update mkt.profiles set role = p_role where id = p_id;
    perform set_config('mkt.allow_role_change', 'off', true);
  end $$;
  create function test.tirar_acesso(p_id uuid) returns void
  language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
  begin
    perform set_config('mkt.allow_role_change', 'on', true);
    update mkt.profiles
       set is_active = false, deactivated_at = now(), deactivated_by = auth.uid(), deactivation_reason = 'left_company'
     where id = p_id;
    perform set_config('mkt.allow_role_change', 'off', true);
  end $$;
  create function test.devolver_acesso(p_id uuid) returns void
  language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
  begin
    perform set_config('mkt.allow_role_change', 'on', true);
    update mkt.profiles
       set is_active = true, deactivated_at = null, deactivated_by = null, deactivation_reason = null
     where id = p_id;
    perform set_config('mkt.allow_role_change', 'off', true);
  end $$;
  grant execute on function test.mudar_papel(uuid, mkt.role, boolean), test.tirar_acesso(uuid),
    test.devolver_acesso(uuid) to authenticated, mkt_worker;
`;

async function papelEAcesso(
  s: Sessao,
  id: string,
): Promise<{ role: string; is_active: boolean } | undefined> {
  await s.como(postgres);
  return (
    await s.linhas<{ role: string; is_active: boolean }>(
      'select role::text, is_active from mkt.profiles where id = $1',
      [id],
    )
  )[0];
}

describe('papel e acesso protegidos (gatilho profiles_guard)', () => {
  it('o dono, pela API, com o segundo fator e a chave, muda o papel de outra pessoa e tira o acesso', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(FUNCOES_DE_TESTE);
      const antes = await s.valor<string>('select updated_at::text from mkt.profiles where id = $1', [
        GESTOR,
      ]);
      await s.como(usuario(DONO, 'aal2'));
      await s.exec(`select test.mudar_papel('${GESTOR}', 'owner')`);
      expect(await papelEAcesso(s, GESTOR)).toEqual({ role: 'owner', is_active: true });
      expect(
        await s.valor<string>('select updated_at::text from mkt.profiles where id = $1', [GESTOR]),
      ).not.toBe(antes);

      await s.como(usuario(DONO, 'aal2'));
      await s.exec(`select test.tirar_acesso('${GESTOR}')`);
      expect(await papelEAcesso(s, GESTOR)).toEqual({ role: 'owner', is_active: false });

      // Vale na próxima chamada, sem esperar o login vencer.
      await s.como(usuario(GESTOR, 'aal2'));
      expect(await s.valor(`select authz.can('view_numbers')`)).toBe(false);
    });
  });

  it('sem a chave, sem o segundo fator, sem manage_users ou fora da API: PT403, e nada muda', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(FUNCOES_DE_TESTE);
      const tentativas: Array<[Quem, string]> = [
        [usuario(DONO, 'aal2'), `select test.mudar_papel('${GESTOR}', 'owner', false)`],
        [usuario(DONO, 'aal1'), `select test.mudar_papel('${GESTOR}', 'owner')`],
        [usuario(GESTOR, 'aal2'), `select test.mudar_papel('${SEGUNDO_DONO}', 'traffic_manager')`],
        [usuario(EX_GESTOR, 'aal2'), `select test.tirar_acesso('${GESTOR}')`],
        // O worker com o token do dono: só o session_user separa a API de uma sessão direta.
        [
          servico('mkt_worker', { sub: DONO, role: 'authenticated', aal: 'aal2' }),
          `select test.mudar_papel('${GESTOR}', 'owner')`,
        ],
      ];
      for (const [quem, sql] of tentativas) {
        await s.como(quem);
        expect((await s.erro('PT403', sql)).message).toBe('USR-403');
      }

      // Nem o dono do banco, com a chave e o token do dono.
      await s.como(postgres);
      await s.exec(`
        select set_config('mkt.allow_role_change', 'on', true);
        select set_config('request.jwt.claims', '{"sub": "${DONO}", "role": "authenticated", "aal": "aal2"}', true);
      `);
      await s.erro('PT403', `update mkt.profiles set role = 'owner' where id = '${GESTOR}'`);
      await s.erro(
        'PT403',
        `update mkt.profiles set is_active = false, deactivated_at = now(), deactivation_reason = 'security'
          where id = '${GESTOR}'`,
      );
      expect(await papelEAcesso(s, GESTOR)).toEqual({ role: 'traffic_manager', is_active: true });
    });
  });

  it('ninguém muda o próprio papel nem tira o próprio acesso', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(FUNCOES_DE_TESTE);
      await s.como(usuario(DONO, 'aal2'));
      expect((await s.erro('PT422', `select test.mudar_papel('${DONO}', 'traffic_manager')`)).message).toBe(
        'USR-422',
      );
      await s.erro('PT422', `select test.tirar_acesso('${DONO}')`);
      expect(await papelEAcesso(s, DONO)).toEqual({ role: 'owner', is_active: true });
    });
  });

  it('o último dono ativo não perde o papel nem o acesso (com outro dono ativo, pode)', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(FUNCOES_DE_TESTE);
      // Um papel que não é dono e gere usuários: o único jeito de alguém além do próprio mexer no último dono.
      await s.exec(
        `insert into mkt.role_permissions (role, action) values ('traffic_manager', 'manage_users')`,
      );
      await s.como(usuario(GESTOR, 'aal2'));
      await s.exec(`select test.mudar_papel('${SEGUNDO_DONO}', 'traffic_manager')`);
      await s.erro('PT422', `select test.mudar_papel('${DONO}', 'traffic_manager')`);
      await s.erro('PT422', `select test.tirar_acesso('${DONO}')`);
      expect(await papelEAcesso(s, DONO)).toEqual({ role: 'owner', is_active: true });
      expect(await papelEAcesso(s, SEGUNDO_DONO)).toEqual({ role: 'traffic_manager', is_active: true });
    });
  });

  it('acesso tirado não volta: para devolver, convide de novo', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(FUNCOES_DE_TESTE);
      await s.como(usuario(DONO, 'aal2'));
      await s.erro('PT422', `select test.devolver_acesso('${EX_GESTOR}')`);
      expect(await papelEAcesso(s, EX_GESTOR)).toEqual({ role: 'traffic_manager', is_active: false });
    });
  });

  it('o resto do perfil (tema, marca e visão padrão, WhatsApp) muda sem a chave, pelas funções do banco', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(`
        update mkt.profiles
           set theme_preference = 'dark', default_brand = 'plumene', default_view = 'manager',
               whatsapp_digits = '5511900000000'
         where id = '${GESTOR}'`);
      expect(
        await s.linhas(
          `select theme_preference::text, default_brand::text, default_view::text, whatsapp_digits
             from mkt.profiles where id = $1`,
          [GESTOR],
        ),
      ).toEqual([
        {
          theme_preference: 'dark',
          default_brand: 'plumene',
          default_view: 'manager',
          whatsapp_digits: '5511900000000',
        },
      ]);
      await s.erro('23514', `update mkt.profiles set whatsapp_digits = '11900000000' where id = '${GESTOR}'`);
      await s.erro('23514', `update mkt.profiles set theme_preference = 'auto' where id = '${GESTOR}'`);
    });
  });

  it('as conferências do perfil: acesso tirado tem quando e motivo; "outro" pede nota sem dado pessoal', async () => {
    await caso(db, postgres, async (s) => {
      const perfil = (id: string, campos: string) =>
        `insert into mkt.profiles (id, display_name, role, is_active, deactivated_at, deactivation_reason,
                                   deactivation_note)
         values ('${id}', 'Pessoa de teste', 'traffic_manager', ${campos})`;
      const ids = ['01', '02', '03', '04', '05'].map((n) => `00000000-0000-4000-8000-000000000e${n}`);
      for (const id of ids) await s.exec(`insert into auth.users (id, email) values ('${id}', null)`);

      await s.erro('23514', perfil(ids[0] ?? '', `false, null, 'security', null`));
      await s.erro('23514', perfil(ids[1] ?? '', `false, now(), null, null`));
      await s.erro('23514', perfil(ids[2] ?? '', `false, now(), 'other', null`));
      await s.erro(
        '23514',
        perfil(ids[3] ?? '', `false, now(), 'other', 'Falar com ela em pessoa@example.com'`),
      );
      await s.exec(perfil(ids[4] ?? '', `false, now(), 'other', 'Mudou de área e não usa mais o sistema'`));
      await s.erro(
        '23514',
        `insert into mkt.profiles (id, display_name, role) values ('${ids[0]}', 'X', 'traffic_manager')`,
      );
      await s.erro(
        '23514',
        `insert into mkt.profiles (id, display_name, role) values ('${ids[0]}', 'Pessoa', 'admin')`,
      );
    });
  });
});

describe('authz.can: o perfil ativo, o papel em role_permissions e o segundo fator', () => {
  const pode = (papel: Papel, aal: 'aal1' | 'aal2' | null, acao: string) =>
    PODE[papel].includes(acao) && (aal === 'aal2' || !SEGUNDO_FATOR.includes(acao));

  async function oQuePode(s: Sessao): Promise<Record<string, boolean>> {
    const linhas = await s.linhas<{ acao: string; pode: boolean }>(
      `select a.acao, authz.can(a.acao::mkt.app_action) as pode from unnest($1::text[]) as a(acao)`,
      [acoes],
    );
    return Object.fromEntries(linhas.map((l) => [l.acao, l.pode]));
  }

  it('cada papel, com e sem o segundo fator, pode exatamente o quadro de listas.md', async () => {
    expect(acoes).toHaveLength(13);
    const casos: Array<[string, Papel, 'aal1' | 'aal2']> = [
      [DONO, 'owner', 'aal1'],
      [DONO, 'owner', 'aal2'],
      [GESTOR, 'traffic_manager', 'aal1'],
      [GESTOR, 'traffic_manager', 'aal2'],
    ];
    for (const [id, papel, aal] of casos) {
      await caso(db, usuario(id, aal), async (s) => {
        expect(await oQuePode(s), `${papel} ${aal}`).toEqual(
          Object.fromEntries(acoes.map((a) => [a, pode(papel, aal, a)])),
        );
      });
    }
  });

  it('sem o segundo fator o dono vê, opera e para tudo, mas não aprova, não configura e não gere', async () => {
    await caso(db, usuario(DONO, 'aal1'), async (s) => {
      const p = await oQuePode(s);
      expect(Object.keys(p).filter((a) => p[a])).toEqual(
        PODE.owner
          .filter((a) => !SEGUNDO_FATOR.includes(a))
          .sort((x, y) => acoes.indexOf(x) - acoes.indexOf(y)),
      );
      expect(p.stop_all).toBe(true);
      // Token sem a marca do segundo fator: vale como aal1.
      await s.exec(
        `select set_config('request.jwt.claims', '{"sub": "${DONO}", "role": "authenticated"}', true)`,
      );
      expect(await s.valor(`select authz.can('approve_action')`)).toBe(false);
      expect(await s.valor(`select authz.can('view_numbers')`)).toBe(true);
    });
  });

  it('o papel vem do perfil, nunca do token', async () => {
    await caso(db, usuario(GESTOR, 'aal2'), async (s) => {
      await s.exec(
        `select set_config('request.jwt.claims', '${JSON.stringify({
          sub: GESTOR,
          role: 'authenticated',
          aal: 'aal2',
          user_role: 'owner',
          app_metadata: { role: 'owner' },
        })}', true)`,
      );
      expect(await s.valor(`select authz.can('approve_action')`)).toBe(false);
      expect(await s.valor(`select authz.can('manage_users')`)).toBe(false);
    });
  });

  it('perfil inativo e login sem perfil não podem nada, nem com o segundo fator', async () => {
    for (const id of [EX_GESTOR, SEM_PERFIL]) {
      await caso(db, usuario(id, 'aal2'), async (s) => {
        expect(Object.values(await oQuePode(s)).some(Boolean), id).toBe(false);
        expect(await s.valor('select authz.is_active_user()'), id).toBe(false);
      });
    }
    await caso(db, usuario(GESTOR), async (s) => {
      expect(await s.valor('select authz.is_active_user()')).toBe(true);
    });
  });

  it('o segundo fator: aprovar, limite e operador, usuários e conector; parar tudo nunca', async () => {
    await caso(db, usuario(DONO), async (s) => {
      const linhas = await s.linhas<{ acao: string }>(
        `select a.acao from unnest($1::text[]) as a(acao)
          where authz.requires_second_factor(a.acao::mkt.app_action) order by 1`,
        [acoes],
      );
      expect(linhas.map((l) => l.acao)).toEqual([...SEGUNDO_FATOR].sort());
    });
  });

  it('authz.display_name: só o nome, para quem tem view_traffic; o inativo continua com o nome', async () => {
    await caso(db, usuario(GESTOR), async (s) => {
      // O gestor não lê o perfil do dono, mas o diário mostra "Aprovada por {nome}".
      expect(await s.valor('select count(*)::int from mkt.profiles where id = $1', [DONO])).toBe(0);
      expect(await s.valor('select authz.display_name($1)', [DONO])).toBe('Dono de teste');
      expect(await s.valor('select authz.display_name($1)', [EX_GESTOR])).toBe('Ex-gestor de teste');
      expect(await s.valor('select authz.display_name($1)', [SEM_PERFIL])).toBeNull();
    });
    for (const id of [EX_GESTOR, SEM_PERFIL]) {
      await caso(db, usuario(id, 'aal2'), async (s) => {
        expect(await s.valor('select authz.display_name($1)', [DONO]), id).toBeNull();
      });
    }
    await caso(db, postgres, async (s) => {
      await s.exec(
        `delete from mkt.role_permissions where role = 'traffic_manager' and action = 'view_traffic'`,
      );
      await s.como(usuario(GESTOR));
      expect(await s.valor('select authz.display_name($1)', [DONO])).toBeNull();
    });
  });

  it('anon e os serviços não chamam authz', async () => {
    const chamadas = [
      `select authz.can('view_numbers')`,
      'select authz.is_active_user()',
      `select authz.requires_second_factor('stop_all')`,
      `select authz.display_name('${DONO}')`,
    ];
    for (const quem of [anon, servico('mkt_worker'), servico('mkt_executor'), servico('n8n_notifier')]) {
      await caso(db, quem, async (s) => {
        for (const sql of chamadas) await s.erro('42501', sql);
      });
    }
  });
});

describe('quem lê as tabelas de pessoas', () => {
  const contar = `select (select count(*)::int from mkt.profiles) as perfis,
                         (select count(*)::int from mkt.invitations) as convites,
                         (select count(*)::int from mkt.audit_log) as auditoria,
                         (select count(*)::int from mkt.saved_filters) as filtros,
                         (select count(*)::int from mkt.notification_preferences) as avisos`;

  it('o dono com o segundo fator lê todos os perfis, convites e a auditoria; filtros e avisos, só os dele', async () => {
    await caso(db, usuario(DONO, 'aal2'), async (s) => {
      expect(await s.linhas(contar)).toEqual([
        { perfis: 4, convites: 3, auditoria: 1, filtros: 2, avisos: 1 },
      ]);
    });
  });

  it('sem o segundo fator o dono lê só o próprio perfil e nada de convites ou auditoria', async () => {
    await caso(db, usuario(DONO, 'aal1'), async (s) => {
      expect(await s.linhas(contar)).toEqual([
        { perfis: 1, convites: 0, auditoria: 0, filtros: 2, avisos: 1 },
      ]);
    });
  });

  it('RLS-09 e RLS-13: o gestor lê só o próprio perfil; não vê nem apaga os filtros e avisos do dono', async () => {
    await caso(db, usuario(GESTOR, 'aal2'), async (s) => {
      expect(await s.linhas(contar)).toEqual([
        { perfis: 1, convites: 0, auditoria: 0, filtros: 0, avisos: 0 },
      ]);
      expect(await s.valor('select id::text from mkt.profiles')).toBe(GESTOR);
      await s.erro('42501', `delete from mkt.saved_filters where profile_id = '${DONO}'`);
      await s.erro('42501', `delete from mkt.notification_preferences where profile_id = '${DONO}'`);
      await s.como(postgres);
      expect(await s.valor(`select count(*)::int from mkt.saved_filters where profile_id = '${DONO}'`)).toBe(
        2,
      );
    });
  });

  it('perfil inativo vê só o próprio perfil (a tela diz "Seu acesso foi tirado"); filtros e avisos que sobraram, não', async () => {
    await caso(db, usuario(EX_GESTOR, 'aal2'), async (s) => {
      expect(await s.linhas(contar)).toEqual([
        { perfis: 1, convites: 0, auditoria: 0, filtros: 0, avisos: 0 },
      ]);
      expect(await s.valor('select is_active from mkt.profiles')).toBe(false);
    });
    await caso(db, usuario(SEM_PERFIL, 'aal2'), async (s) => {
      expect(await s.linhas(contar)).toEqual([
        { perfis: 0, convites: 0, auditoria: 0, filtros: 0, avisos: 0 },
      ]);
    });
  });

  it('RLS-04: ninguém grava direto pela API, nem o dono com o segundo fator', async () => {
    await caso(db, usuario(DONO, 'aal2'), async (s) => {
      for (const tabela of TABELAS_DE_PESSOAS) {
        await s.erro('42501', `update ${tabela} set updated_at = now()`);
        await s.erro('42501', `delete from ${tabela}`);
      }
      await s.erro(
        '42501',
        `insert into mkt.profiles (id, display_name, role) values ('${SEM_PERFIL}', 'Eu', 'owner')`,
      );
      await s.erro(
        '42501',
        `insert into mkt.invitations (email_normalized, display_name, role, expires_at)
         values ('eu@example.com', 'Eu', 'owner', now() + interval '1 day')`,
      );
      await s.erro(
        '42501',
        `insert into mkt.saved_filters (profile_id, scope, name, filters) values ('${DONO}', 'bar', 'X', '{}')`,
      );
    });
  });

  it('RLS-30: os papéis de serviço não leem pessoas; anon também não', async () => {
    const quem: Quem[] = [
      anon,
      servico('mkt_worker'),
      servico('mkt_executor'),
      servico('mkt_setup'),
      servico('n8n_notifier'),
    ];
    for (const q of quem) {
      await caso(db, q, async (s) => {
        for (const tabela of TABELAS_DE_PESSOAS) await s.erro('42501', `select count(*) from ${tabela}`);
      });
    }
  });
});

describe('privilégios e forma das funções da migração 03', () => {
  const QUEM = [
    'public',
    'anon',
    'authenticated',
    'service_role',
    'authenticator',
    'mkt_worker',
    'mkt_executor',
    'mkt_setup',
    'n8n_notifier',
  ];
  const FORMULAS = ['authenticated', 'mkt_worker', 'mkt_executor'];
  const FUNCOES: Record<string, { quem: string[]; definer: boolean; volatilidade: string }> = {
    'authz.can(mkt.app_action)': { quem: ['authenticated'], definer: true, volatilidade: 's' },
    'authz.requires_second_factor(mkt.app_action)': {
      quem: ['authenticated'],
      definer: false,
      volatilidade: 'i',
    },
    'authz.is_active_user()': { quem: ['authenticated'], definer: true, volatilidade: 's' },
    'authz.display_name(uuid)': { quem: ['authenticated'], definer: true, volatilidade: 's' },
    'mkt.valid_saved_filters(mkt.saved_filter_scope,jsonb)': {
      quem: FORMULAS,
      definer: false,
      volatilidade: 'i',
    },
    'mkt.valid_audit_changes(mkt.audit_event,jsonb)': { quem: FORMULAS, definer: false, volatilidade: 'i' },
    'mkt.notice_default(mkt.notice_kind)': { quem: FORMULAS, definer: false, volatilidade: 'i' },
    'private.handle_new_user()': { quem: [], definer: true, volatilidade: 'v' },
    'private.profiles_guard()': { quem: [], definer: true, volatilidade: 'v' },
    'private.append_only()': { quem: [], definer: false, volatilidade: 'v' },
  };

  it('existem com search_path pg_catalog, pg_temp, definer só onde lê perfis, e a volatilidade certa', async () => {
    await caso(db, postgres, async (s) => {
      const linhas = await s.linhas<{
        funcao: string;
        prosecdef: boolean;
        provolatile: string;
        config: string[];
      }>(
        `select p.oid::regprocedure::text as funcao, p.prosecdef, p.provolatile, p.proconfig as config
           from pg_proc p where p.oid::regprocedure::text = any($1) order by 1`,
        [Object.keys(FUNCOES)],
      );
      expect(linhas.map((l) => l.funcao)).toEqual(Object.keys(FUNCOES).sort());
      for (const l of linhas) {
        expect(l.config, l.funcao).toEqual(['search_path=pg_catalog, pg_temp']);
        expect(l.prosecdef, l.funcao).toBe(FUNCOES[l.funcao]?.definer);
        expect(l.provolatile, l.funcao).toBe(FUNCOES[l.funcao]?.volatilidade);
      }
    });
  });

  it('só quem usa executa: authz pela API, as regras puras de mkt pela API e pelos serviços, os gatilhos ninguém', async () => {
    await caso(db, postgres, async (s) => {
      const linhas = await s.linhas<{ funcao: string; papel: string; executa: boolean }>(
        `select f.funcao, r.papel, has_function_privilege(r.papel, f.funcao::regprocedure, 'execute') as executa
           from unnest($1::text[]) as f(funcao) cross join unnest($2::text[]) as r(papel)`,
        [Object.keys(FUNCOES), QUEM],
      );
      expect(linhas).toHaveLength(Object.keys(FUNCOES).length * QUEM.length);
      for (const l of linhas) {
        expect(l.executa, `${l.papel} executa ${l.funcao}`).toBe(FUNCOES[l.funcao]?.quem.includes(l.papel));
      }
    });
  });

  it('os gatilhos estão ligados: novo usuário em auth.users, papel protegido e só-acréscimo da auditoria', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        await s.linhas(
          `select tgrelid::regclass::text as tabela, tgname::text as gatilho, tgfoid::regprocedure::text as funcao
             from pg_trigger
            where not tgisinternal and tgenabled = 'O'
              and tgrelid in ('auth.users'::regclass, 'mkt.profiles'::regclass, 'mkt.audit_log'::regclass)
            order by 1, 2`,
        ),
      ).toEqual([
        { tabela: 'auth.users', gatilho: 'mkt_handle_new_user', funcao: 'private.handle_new_user()' },
        { tabela: 'mkt.audit_log', gatilho: 'audit_log_append_only', funcao: 'private.append_only()' },
        { tabela: 'mkt.audit_log', gatilho: 'audit_log_no_truncate', funcao: 'private.append_only()' },
        { tabela: 'mkt.audit_log', gatilho: 'audit_log_updated_at', funcao: 'private.set_updated_at()' },
        { tabela: 'mkt.profiles', gatilho: 'profiles_guard', funcao: 'private.profiles_guard()' },
        { tabela: 'mkt.profiles', gatilho: 'profiles_updated_at', funcao: 'private.set_updated_at()' },
      ]);
    });
  });
});

// Migração 04: as duas marcas; contas e campanhas com a marca e a plataforma da conta; o operador da campanha
// protegido e o histórico só por acréscimo; o código REP- dos representantes; o login do app só como resumo; perfis e
// sites (docs/dados/tabelas.md, seção 1, e papeis-e-rls.md, "Gatilhos que conferem quem pede"). Os dados são os
// inventados de fixtures/usuarios.sql e fixtures/marketing.sql.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Quem,
  type Sessao,
  abrirBanco,
  aplicarFixture,
  caso,
  postgres,
  servico,
  usuario,
} from './apoio/banco';
import {
  ACAO_QUE_CRIOU,
  CAMPANHA_CLAUDE_CS,
  CAMPANHA_HUMANO_CS,
  CONTA_GOOGLE_PL,
  CONTA_META_CS,
  REP_DO_APP,
  REP_DO_CRM,
} from './apoio/marketing';
import { DONO, EX_GESTOR, GESTOR } from './apoio/usuarios';

type Marca = 'cs' | 'plumene' | null;

let db: PGlite;

beforeAll(async () => {
  db = await abrirBanco();
  await aplicarFixture(db, 'usuarios');
  await aplicarFixture(db, 'marketing');
});

afterAll(async () => {
  await db.close();
});

const MARCA = '(select id from mkt.brands where code = $1)';

/** Uma conta de anúncio; sem nada, uma conta Meta válida da cs. */
function conta(c: {
  marca?: Marca;
  plataforma?: string;
  fonte?: string;
  externo?: string;
  moeda?: string;
  teto?: number | null;
  gasto?: number | null;
}): [string, unknown[]] {
  return [
    `insert into mkt.ad_accounts (brand_id, platform, source, external_id, name, currency, spend_cap_cents,
                                  amount_spent_cents)
     values (${MARCA}, $2, $3, $4, 'Conta de teste', $5, $6, $7) returning id::text`,
    [
      c.marca === undefined ? 'cs' : c.marca,
      c.plataforma ?? 'meta',
      c.fonte ?? 'meta_ads',
      c.externo ?? 'act_910000000000001',
      c.moeda ?? 'BRL',
      c.teto ?? null,
      c.gasto ?? null,
    ],
  ];
}

/** Uma campanha; sem nada, uma campanha válida do humano na conta Meta da cs. */
function campanha(c: {
  conta?: string;
  marca?: Marca;
  plataforma?: string;
  fonte?: string;
  externo?: string;
  nome?: string;
  smart?: boolean;
  orcamento?: number | null;
  teto?: number | null;
  operador?: string;
  acao?: string | null;
}): [string, unknown[]] {
  return [
    `insert into mkt.campaigns (ad_account_id, brand_id, platform, source, external_id, name, status, is_smart_plus,
                                daily_budget_cents, spend_cap_cents, managed_by, created_by_action_id)
     values ($2, ${MARCA}, $3, $4, $5, $6, 'active', $7, $8, $9, $10, $11) returning id::text`,
    [
      c.marca === undefined ? 'cs' : c.marca,
      c.conta ?? CONTA_META_CS,
      c.plataforma ?? 'meta',
      c.fonte ?? 'meta_ads',
      c.externo ?? '120200000000009999',
      c.nome ?? 'campanha-de-teste',
      c.smart ?? false,
      c.orcamento ?? null,
      c.teto ?? null,
      c.operador ?? 'human',
      c.acao ?? null,
    ],
  ];
}

interface Troca {
  from_operator: string | null;
  to_operator: string;
  reason: string;
  note: string | null;
  actor_kind: string;
  changed_by: string | null;
}

/** O histórico de operador de uma campanha, do mais antigo ao mais novo. */
async function historico(s: Sessao, id: string): Promise<Troca[]> {
  await s.como(postgres);
  return s.linhas<Troca>(
    `select from_operator::text, to_operator::text, reason::text, note, actor_kind::text, changed_by::text
       from mkt.campaign_managed_by_history
      where campaign_id = $1
      order by changed_at, from_operator nulls first`,
    [id],
  );
}

async function operador(s: Sessao, id: string): Promise<string> {
  await s.como(postgres);
  return s.valor<string>('select managed_by::text from mkt.campaigns where id = $1', [id]);
}

const IMPORTADA: Troca = {
  from_operator: null,
  to_operator: 'human',
  reason: 'imported',
  note: null,
  actor_kind: 'system',
  changed_by: null,
};

/**
 * Stand-in de api.change_campaign_operator (migração 09): deixa na transação a chave, o motivo e a nota, e grava.
 * E uma releitura como a do worker e a do executor (ingest.*), que só muda o operador se alguém tentar.
 */
const FUNCOES_DE_TESTE = `
  create function test.trocar_operador(p_campaign uuid, p_to mkt.operator, p_reason text,
                                       p_note text default null, p_chave boolean default true) returns void
  language plpgsql security definer set search_path = '' as $$
  begin
    if p_chave then
      perform set_config('mkt.allow_operator_change', 'on', true);
    end if;
    perform set_config('mkt.operator_change_reason', coalesce(p_reason, ''), true);
    perform set_config('mkt.operator_change_note', coalesce(p_note, ''), true);
    update mkt.campaigns set managed_by = p_to where id = p_campaign;
    perform set_config('mkt.allow_operator_change', 'off', true);
  end $$;
  create function test.reler_campanha(p_campaign uuid, p_status mkt.campaign_status,
                                      p_operador mkt.operator default null) returns void
  language plpgsql security definer set search_path = '' as $$
  begin
    update mkt.campaigns
       set status = p_status, last_seen_at = now(), managed_by = coalesce(p_operador, managed_by)
     where id = p_campaign;
  end $$;
  grant execute on function test.trocar_operador(uuid, mkt.operator, text, text, boolean),
    test.reler_campanha(uuid, mkt.campaign_status, mkt.operator) to authenticated, mkt_worker, mkt_executor;
`;

describe('marcas', () => {
  it('as duas marcas nascem com a migração, sem o id do CRM (o worker preenche pela sigla)', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        await s.linhas('select code::text, name, source::text, external_id from mkt.brands order by code'),
      ).toEqual([
        { code: 'cs', name: 'Corpo Sensual', source: 'csp360', external_id: null },
        { code: 'plumene', name: 'Plumene', source: 'csp360', external_id: null },
      ]);
    });
  });

  it('código da lista, nome de 2 a 60 letras e um id do CRM por marca', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro('23514', `insert into mkt.brands (code, name) values ('outra', 'Outra marca')`);
      await s.erro('23505', `insert into mkt.brands (code, name) values ('cs', 'De novo')`);
      await s.erro('23514', `update mkt.brands set name = 'X' where code = 'cs'`);
      await s.erro('23514', `update mkt.brands set name = '${'x'.repeat(61)}' where code = 'cs'`);
      await s.exec(`update mkt.brands set external_id = 'marca-teste-1' where code = 'cs'`);
      await s.erro('23505', `update mkt.brands set external_id = 'marca-teste-1' where code = 'plumene'`);
    });
  });
});

describe('contas de anúncio', () => {
  it('marca obrigatória, só real, fonte de anúncio e uma conta por id da plataforma', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro('23502', ...conta({ marca: null }));
      await s.erro('23514', ...conta({ moeda: 'USD' }));
      await s.erro('23514', ...conta({ fonte: 'csv' }));
      await s.erro('23514', ...conta({ fonte: 'instagram' }));
      await s.erro('23514', ...conta({ plataforma: 'instagram' }));
      await s.erro('23505', ...conta({ externo: 'act_900000000000001' }));
      // Controle: a mesma conta, com tudo certo, entra.
      expect(await s.linhas(...conta({}))).toHaveLength(1);
      expect(
        await s.linhas(...conta({ plataforma: 'tiktok', fonte: 'tiktok_ads', externo: '7100000001' })),
      ).toHaveLength(1);
    });
  });

  it('o teto da conta só na Meta e nunca 0 (o 0 da Meta, sem teto, entra nulo); o gasto do teto não é negativo', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro('23514', ...conta({ teto: 0 }));
      await s.erro('23514', ...conta({ teto: -100 }));
      await s.erro('23514', ...conta({ gasto: -1 }));
      await s.erro('23514', ...conta({ plataforma: 'tiktok', fonte: 'tiktok_ads', teto: 100000 }));
      await s.erro('23514', ...conta({ plataforma: 'google', fonte: 'google_ads', gasto: 0 }));
      await s.erro('23514', `update mkt.ad_accounts set spend_cap_cents = 0 where id = '${CONTA_META_CS}'`);
      expect(await s.linhas(...conta({ teto: 100000, gasto: 0 }))).toHaveLength(1);
      expect(await s.linhas(...conta({ externo: 'act_910000000000002', teto: null }))).toHaveLength(1);
    });
  });
});

describe('campanhas', () => {
  it('a marca e a plataforma são as da conta (chave composta), e a marca é obrigatória', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro('23503', ...campanha({ marca: 'plumene' }));
      await s.erro('23503', ...campanha({ plataforma: 'google', fonte: 'google_ads' }));
      await s.erro('23503', ...campanha({ conta: CONTA_GOOGLE_PL }));
      await s.erro('23502', ...campanha({ marca: null }));
      await s.erro('23514', ...campanha({ fonte: 'csv' }));
      await s.erro('23505', ...campanha({ externo: '120200000000000001' }));
      await s.erro(
        '23503',
        `update mkt.campaigns set brand_id = ${MARCA} where id = '${CAMPANHA_HUMANO_CS}'`,
        ['plumene'],
      );
      expect(await s.linhas(...campanha({}))).toHaveLength(1);
      expect(
        await s.linhas(
          ...campanha({
            conta: CONTA_GOOGLE_PL,
            marca: 'plumene',
            plataforma: 'google',
            fonte: 'google_ads',
          }),
        ),
      ).toHaveLength(1);
    });
  });

  it('Smart+ só no TikTok; orçamento e teto da campanha não negativos', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro('23514', ...campanha({ smart: true }));
      await s.erro('23514', ...campanha({ orcamento: -1 }));
      await s.erro('23514', ...campanha({ teto: -1 }));
      expect(await s.linhas(...campanha({ orcamento: 0, teto: 0 }))).toHaveLength(1);
      const tiktok = await s.valor<string>(
        ...conta({ plataforma: 'tiktok', fonte: 'tiktok_ads', externo: '7100000002' }),
      );
      expect(
        await s.linhas(
          ...campanha({
            conta: tiktok,
            plataforma: 'tiktok',
            fonte: 'tiktok_ads',
            externo: '1800000001',
            smart: true,
          }),
        ),
      ).toHaveLength(1);
    });
  });

  it('a chave da UTM sai do nome (minúsculas, espaço simples) e ninguém a grava à mão', async () => {
    await caso(db, postgres, async (s) => {
      const id = await s.valor<string>(...campanha({ nome: '  Black   Friday\tAtacado ' }));
      expect(await s.valor('select utm_campaign_key from mkt.campaigns where id = $1', [id])).toBe(
        'black friday atacado',
      );
      await s.exec(`update mkt.campaigns set name = 'Dia das Mães  2027' where id = '${id}'`);
      expect(await s.valor('select utm_campaign_key from mkt.campaigns where id = $1', [id])).toBe(
        'dia das mães 2027',
      );
      await s.erro('428C9', `update mkt.campaigns set utm_campaign_key = 'outra' where id = '${id}'`);
    });
  });
});

describe('o operador da campanha (gatilhos campaigns_managed_by_guard e campaigns_managed_by_audit)', () => {
  it('campanha nova nasce do humano, com o histórico "importada" do sistema', async () => {
    await caso(db, postgres, async (s) => {
      const id = await s.valor<string>(...campanha({}));
      expect(await operador(s, id)).toBe('human');
      expect(await historico(s, id)).toEqual([IMPORTADA]);
      expect(await historico(s, CAMPANHA_HUMANO_CS)).toEqual([IMPORTADA]);
    });
  });

  it('do Claude, só a campanha que a central criou, com a ação; sem a ação, PT422 e nada entra', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        (await s.erro('PT422', ...campanha({ operador: 'claude', externo: '120200000000008888' }))).message,
      ).toBe('TRF-422');
      expect(
        await s.valor(`select count(*)::int from mkt.campaigns where external_id = '120200000000008888'`),
      ).toBe(0);
      const id = await s.valor<string>(...campanha({ operador: 'claude', acao: ACAO_QUE_CRIOU }));
      const criada = {
        ...IMPORTADA,
        to_operator: 'claude',
        reason: 'created_by_claude',
        actor_kind: 'claude',
      };
      expect(await historico(s, id)).toEqual([criada]);
      expect(await historico(s, CAMPANHA_CLAUDE_CS)).toEqual([criada]);
    });
  });

  it('o dono, pela API, com o segundo fator e a chave, troca o operador; o histórico guarda quem, de quem para quem e por quê', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(FUNCOES_DE_TESTE);
      const antes = await s.valor<string>('select updated_at::text from mkt.campaigns where id = $1', [
        CAMPANHA_HUMANO_CS,
      ]);
      await s.como(usuario(DONO, 'aal2'));
      await s.exec(`select test.trocar_operador('${CAMPANHA_HUMANO_CS}', 'claude', 'handover_to_claude')`);
      expect(await operador(s, CAMPANHA_HUMANO_CS)).toBe('claude');
      expect(
        await s.valor<string>('select updated_at::text from mkt.campaigns where id = $1', [
          CAMPANHA_HUMANO_CS,
        ]),
      ).not.toBe(antes);

      await s.como(usuario(DONO, 'aal2'));
      await s.exec(
        `select test.trocar_operador('${CAMPANHA_HUMANO_CS}', 'human', 'other', 'Volta ao manual até o fim da promoção')`,
      );
      expect(await operador(s, CAMPANHA_HUMANO_CS)).toBe('human');
      // As duas trocas são da mesma transação (o mesmo changed_at): confere sem depender da ordem.
      const trocas = await historico(s, CAMPANHA_HUMANO_CS);
      expect(trocas).toHaveLength(3);
      expect(trocas).toEqual(
        expect.arrayContaining([
          IMPORTADA,
          {
            from_operator: 'human',
            to_operator: 'claude',
            reason: 'handover_to_claude',
            note: null,
            actor_kind: 'user',
            changed_by: DONO,
          },
          {
            from_operator: 'claude',
            to_operator: 'human',
            reason: 'other',
            note: 'Volta ao manual até o fim da promoção',
            actor_kind: 'user',
            changed_by: DONO,
          },
        ]),
      );
    });
  });

  it('sem a chave, sem o segundo fator, sem configure_traffic, perfil inativo, serviço com o token do dono ou o dono do banco: PT403, e nada muda', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(FUNCOES_DE_TESTE);
      const trocar = (chave = true) =>
        `select test.trocar_operador('${CAMPANHA_HUMANO_CS}', 'claude', 'handover_to_claude', null, ${chave})`;
      const tokenDoDono = { sub: DONO, role: 'authenticated', aal: 'aal2' };
      const tentativas: Array<[Quem, string]> = [
        [usuario(DONO, 'aal2'), trocar(false)],
        [usuario(DONO, 'aal1'), trocar()],
        [usuario(GESTOR, 'aal2'), trocar()],
        [usuario(EX_GESTOR, 'aal2'), trocar()],
        // Uma sessão direta define o token que quiser: só o session_user separa a API dos serviços.
        [servico('mkt_worker', tokenDoDono), trocar()],
        [servico('mkt_executor', tokenDoDono), trocar()],
      ];
      for (const [quem, sql] of tentativas) {
        await s.como(quem);
        expect((await s.erro('PT403', sql)).message).toBe('TRF-403');
      }

      // Nem o dono do banco, com a chave, o motivo e o token do dono.
      await s.como(postgres);
      await s.exec(`
        select set_config('mkt.allow_operator_change', 'on', true);
        select set_config('mkt.operator_change_reason', 'handover_to_claude', true);
        select set_config('request.jwt.claims', '${JSON.stringify(tokenDoDono)}', true);
      `);
      await s.erro(
        'PT403',
        `update mkt.campaigns set managed_by = 'claude' where id = '${CAMPANHA_HUMANO_CS}'`,
      );
      expect(await operador(s, CAMPANHA_HUMANO_CS)).toBe('human');
      expect(await historico(s, CAMPANHA_HUMANO_CS)).toEqual([IMPORTADA]);
    });
  });

  it('o worker e o executor releem a campanha sem mudar o operador; o mesmo operador de novo não vai para o histórico', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(FUNCOES_DE_TESTE);
      for (const papel of ['mkt_worker', 'mkt_executor'] as const) {
        await s.como(servico(papel));
        await s.exec(`select test.reler_campanha('${CAMPANHA_CLAUDE_CS}', 'active')`);
        expect(
          (await s.erro('PT403', `select test.reler_campanha('${CAMPANHA_CLAUDE_CS}', 'paused', 'human')`))
            .message,
        ).toBe('TRF-403');
      }
      await s.como(postgres);
      expect(
        await s.linhas('select status::text, managed_by::text from mkt.campaigns where id = $1', [
          CAMPANHA_CLAUDE_CS,
        ]),
      ).toEqual([{ status: 'active', managed_by: 'claude' }]);
      await s.exec(`update mkt.campaigns set managed_by = managed_by where id = '${CAMPANHA_CLAUDE_CS}'`);
      expect(await historico(s, CAMPANHA_CLAUDE_CS)).toHaveLength(1);
    });
  });

  it('RLS-22: o worker e o executor não gravam campanha direto, nem o operador', async () => {
    for (const papel of ['mkt_worker', 'mkt_executor'] as const) {
      await caso(db, servico(papel, { sub: DONO, role: 'authenticated', aal: 'aal2' }), async (s) => {
        await s.erro(
          '42501',
          `update mkt.campaigns set managed_by = 'claude' where id = '${CAMPANHA_HUMANO_CS}'`,
        );
        await s.erro(
          '42501',
          `update mkt.campaigns set status = 'paused' where id = '${CAMPANHA_HUMANO_CS}'`,
        );
        await s.erro('42501', ...campanha({}));
        await s.erro('42501', `delete from mkt.campaigns where id = '${CAMPANHA_HUMANO_CS}'`);
      });
    }
  });

  it('a troca pede motivo da lista, e "outro" pede nota de 10 letras sem e-mail nem telefone; recusada, nada muda', async () => {
    await caso(db, postgres, async (s) => {
      await s.exec(FUNCOES_DE_TESTE);
      await s.como(usuario(DONO, 'aal2'));
      const trocar = (motivo: string | null, nota: string | null = null) =>
        s.erro(motivo === null ? '23502' : '23514', 'select test.trocar_operador($1, $2, $3, $4)', [
          CAMPANHA_HUMANO_CS,
          'claude',
          motivo,
          nota,
        ]);
      await trocar(null);
      await trocar('cansou');
      await trocar('other');
      await trocar('other', 'Curta');
      await trocar('other', 'Combinado com a compradora em compras@exemplo.com.br');
      await trocar('other', 'Ligar antes para (11) 98765-4321 e confirmar');
      expect(await operador(s, CAMPANHA_HUMANO_CS)).toBe('human');
      expect(await historico(s, CAMPANHA_HUMANO_CS)).toEqual([IMPORTADA]);
    });
  });
});

describe('histórico de operador: só por acréscimo', () => {
  it('ninguém altera, apaga ou esvazia, nem o dono do banco, nem a linha antiga, nem em cascata pela campanha', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        (await s.erro('PT403', `update mkt.campaign_managed_by_history set reason = 'correction'`)).message,
      ).toBe('LOG-403');
      await s.erro('PT403', 'delete from mkt.campaign_managed_by_history');
      await s.erro('PT403', 'truncate mkt.campaign_managed_by_history');
      await s.erro('PT403', 'truncate mkt.campaigns cascade');
      // Sem prazo de guarda: nem a linha de anos atrás sai.
      await s.exec(
        `insert into mkt.campaign_managed_by_history (campaign_id, to_operator, reason, actor_kind, changed_at)
         values ('${CAMPANHA_HUMANO_CS}', 'human', 'correction', 'system', now() - interval '10 years')`,
      );
      await s.erro(
        'PT403',
        `delete from mkt.campaign_managed_by_history where changed_at < now() - interval '5 years'`,
      );
      expect(await s.valor('select count(*)::int from mkt.campaign_managed_by_history')).toBe(4);
    });
  });

  it('RLS-17: pela API ninguém grava, altera ou apaga o histórico, nem o dono com o segundo fator', async () => {
    await caso(db, usuario(DONO, 'aal2'), async (s) => {
      expect(await s.valor('select count(*)::int from mkt.campaign_managed_by_history')).toBe(3);
      await s.erro('42501', `update mkt.campaign_managed_by_history set note = 'Mudança feita à mão'`);
      await s.erro('42501', 'delete from mkt.campaign_managed_by_history');
      await s.erro(
        '42501',
        `insert into mkt.campaign_managed_by_history (campaign_id, to_operator, reason, actor_kind, changed_by)
         values ('${CAMPANHA_HUMANO_CS}', 'claude', 'correction', 'user', '${DONO}')`,
      );
    });
  });

  it('as conferências: "outro" com nota de 10 a 500 letras sem dado pessoal; a pessoa leva o id, o Claude e o sistema não', async () => {
    await caso(db, postgres, async (s) => {
      const linha = (motivo: string, nota: string | null, ator: string, quem: string | null) =>
        s.linhas(
          `insert into mkt.campaign_managed_by_history (campaign_id, from_operator, to_operator, reason, note,
                                                        actor_kind, changed_by)
           values ($1, 'human', 'claude', $2, $3, $4, $5) returning id`,
          [CAMPANHA_HUMANO_CS, motivo, nota, ator, quem],
        );
      const recusa = (motivo: string, nota: string | null, ator: string, quem: string | null) =>
        s.erro(
          '23514',
          `insert into mkt.campaign_managed_by_history (campaign_id, from_operator, to_operator, reason, note,
                                                        actor_kind, changed_by)
           values ($1, 'human', 'claude', $2, $3, $4, $5)`,
          [CAMPANHA_HUMANO_CS, motivo, nota, ator, quem],
        );
      await recusa('other', null, 'user', DONO);
      await recusa('other', 'Curta', 'user', DONO);
      await recusa('other', 'x'.repeat(501), 'user', DONO);
      await recusa('correction', 'Avisar a pessoa em pessoa@example.com', 'user', DONO);
      await recusa('correction', 'Telefone 11987654321 para confirmar', 'user', DONO);
      await recusa('correction', 'Documento 123.456.789-01 conferido', 'user', DONO);
      await recusa('correction', null, 'user', null);
      await recusa('correction', null, 'system', DONO);
      await recusa('correction', null, 'claude', DONO);
      await recusa('correction', null, 'robot', null);
      expect(await linha('correction', null, 'user', DONO)).toHaveLength(1);
      expect(await linha('other', 'Operador marcado errado na importação', 'system', null)).toHaveLength(1);
    });
  });
});

describe('representantes: o código REP- (gatilho sales_reps_code)', () => {
  /** O número que a sequência dá a seguir. */
  const proximo = (s: Sessao) =>
    s.valor<number>(
      'select (case when is_called then last_value + 1 else last_value end)::int from mkt.sales_rep_code_seq',
    );
  const rep = (n: number) => `REP-${String(n).padStart(4, '0')}`;

  it('vem da sequência, na ordem, e o código que vier no insert é ignorado', async () => {
    await caso(db, postgres, async (s) => {
      const n = await proximo(s);
      expect(
        await s.linhas(
          `insert into mkt.sales_reps (external_id, code) values ('usr-ordem-1', null), ('usr-ordem-2', 'REP-9999')
           returning code`,
        ),
      ).toEqual([{ code: rep(n) }, { code: rep(n + 1) }]);
    });
  });

  it('a releitura não gasta número: insert … on conflict, do update ou do nothing, fica com o mesmo código', async () => {
    await caso(db, postgres, async (s) => {
      const n = await proximo(s);
      const primeiro = await s.valor<string>(
        `insert into mkt.sales_reps (external_id, crm_role) values ('usr-releitura', 'field_rep') returning code`,
      );
      expect(primeiro).toBe(rep(n));
      for (let i = 0; i < 3; i++) {
        expect(
          await s.valor<string>(
            `insert into mkt.sales_reps (external_id, crm_role, is_active) values ('usr-releitura', 'supervisor', false)
             on conflict (source, external_id)
             do update set crm_role = excluded.crm_role, is_active = excluded.is_active, code = excluded.code
             returning code`,
          ),
        ).toBe(primeiro);
        expect(
          await s.linhas(
            `insert into mkt.sales_reps (external_id) values ('usr-releitura') on conflict do nothing returning code`,
          ),
        ).toEqual([]);
      }
      expect(await proximo(s)).toBe(n + 1);
      expect(
        await s.linhas(
          `select crm_role::text, is_active from mkt.sales_reps where external_id = 'usr-releitura'`,
        ),
      ).toEqual([{ crm_role: 'supervisor', is_active: false }]);
      expect(
        await s.valor<string>(`insert into mkt.sales_reps (external_id) values ('usr-novo') returning code`),
      ).toBe(rep(n + 1));
    });
  });

  it('quem só tem login de app (sem id do CRM) ganha um código para cada um', async () => {
    await caso(db, postgres, async (s) => {
      const n = await proximo(s);
      expect(
        await s.linhas(`insert into mkt.sales_reps (external_id) values (null), (null) returning code`),
      ).toEqual([{ code: rep(n) }, { code: rep(n + 1) }]);
    });
  });

  it('o código nunca muda; o resto da linha muda', async () => {
    await caso(db, postgres, async (s) => {
      const antes = await s.valor<string>('select code from mkt.sales_reps where id = $1', [REP_DO_CRM]);
      expect(
        (await s.erro('PT422', `update mkt.sales_reps set code = 'REP-0999' where id = '${REP_DO_CRM}'`))
          .message,
      ).toBe('COD-422');
      await s.exec(
        `update mkt.sales_reps set is_active = false, crm_role = 'manager' where id = '${REP_DO_CRM}'`,
      );
      expect(await s.valor('select code from mkt.sales_reps where id = $1', [REP_DO_CRM])).toBe(antes);
      await s.erro('23514', `update mkt.sales_reps set crm_role = 'vendedor' where id = '${REP_DO_CRM}'`);
    });
  });

  it('o login do app: só o resumo HMAC-SHA256, com a marca, um por marca e resumo; sai junto com o representante', async () => {
    const resumo = 'ab'.repeat(32);
    await caso(db, postgres, async (s) => {
      const login = (marca: Marca, chave: string) =>
        [
          `insert into mkt.sales_rep_app_logins (sales_rep_id, brand_id, app_login_key) values ($2, ${MARCA}, $3)`,
          [marca, REP_DO_APP, chave],
        ] as [string, unknown[]];
      for (const chave of [
        'vendedora@exemplo.com.br',
        'cs:login.da.vendedora',
        'AB'.repeat(32),
        'ab'.repeat(31),
        'ab'.repeat(33),
      ]) {
        await s.erro('23514', ...login('cs', chave));
      }
      await s.erro('23502', ...login(null, resumo));
      await s.exec(
        `insert into mkt.sales_rep_app_logins (sales_rep_id, brand_id, app_login_key)
         values ('${REP_DO_APP}', (select id from mkt.brands where code = 'cs'), '${resumo}')`,
      );
      await s.erro('23505', ...login('cs', resumo));
      await s.linhas(...login('plumene', resumo));
      expect(
        await s.valor(
          `select count(*)::int from mkt.sales_rep_app_logins where sales_rep_id = '${REP_DO_APP}'`,
        ),
      ).toBe(3);
      await s.exec(`delete from mkt.sales_reps where id = '${REP_DO_APP}'`);
      expect(await s.valor('select count(*)::int from mkt.sales_rep_app_logins')).toBe(0);
    });
  });
});

describe('perfis do Instagram e sites', () => {
  it('perfil com marca, um por id do Instagram', async () => {
    await caso(db, postgres, async (s) => {
      const perfil = (marca: Marca, externo: string) =>
        [
          `insert into mkt.ig_accounts (brand_id, external_id, username) values (${MARCA}, $2, 'perfil.de.teste')`,
          [marca, externo],
        ] as [string, unknown[]];
      await s.erro('23502', ...perfil(null, '17840000000000009'));
      await s.erro('23505', ...perfil('plumene', '17840000000000001'));
      expect(await s.linhas(...perfil('plumene', '17840000000000009'))).toHaveLength(0);
      expect(
        await s.valor(`select source::text from mkt.ig_accounts where external_id = '17840000000000009'`),
      ).toBe('instagram');
    });
  });

  it('site: domínio em minúsculas e sem www; GA4 com a fonte ga4 e Search Console com search_console', async () => {
    await caso(db, postgres, async (s) => {
      const site = (marca: Marca, tipo: string, fonte: string, host: string, externo = '900000009') =>
        [
          `insert into mkt.web_properties (brand_id, kind, source, external_id, host) values (${MARCA}, $2, $3, $4, $5)`,
          [marca, tipo, fonte, externo, host],
        ] as [string, unknown[]];
      await s.erro('23502', ...site(null, 'ga4_property', 'ga4', 'plumene.example.com'));
      await s.erro('23514', ...site('plumene', 'ga4_property', 'ga4', 'Plumene.example.com'));
      await s.erro('23514', ...site('plumene', 'ga4_property', 'ga4', 'www.plumene.example.com'));
      await s.erro('23514', ...site('plumene', 'ga4_property', 'search_console', 'plumene.example.com'));
      await s.erro('23514', ...site('plumene', 'gsc_site', 'ga4', 'plumene.example.com'));
      await s.erro('23514', ...site('plumene', 'gsc_site', 'csv', 'plumene.example.com'));
      await s.erro('23505', ...site('plumene', 'ga4_property', 'ga4', 'plumene.example.com', '900000001'));
      await s.linhas(...site('plumene', 'ga4_property', 'ga4', 'plumene.example.com'));
      await s.linhas(
        ...site(
          'plumene',
          'gsc_site',
          'search_console',
          'plumene.example.com',
          'sc-domain:plumene.example.com',
        ),
      );
      expect(await s.valor('select count(*)::int from mkt.web_properties')).toBe(4);
    });
  });
});

describe('funções, gatilhos e índices da migração 04', () => {
  const GATILHOS = [
    'private.campaigns_managed_by_audit()',
    'private.campaigns_managed_by_guard()',
    'private.sales_reps_code()',
  ];
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

  it('as funções de gatilho: security definer, search_path vazio e ninguém executa', async () => {
    await caso(db, postgres, async (s) => {
      const linhas = await s.linhas<{ funcao: string; prosecdef: boolean; config: string[] }>(
        `select p.oid::regprocedure::text as funcao, p.prosecdef, p.proconfig as config
           from pg_proc p where p.oid::regprocedure::text = any($1) order by 1`,
        [GATILHOS],
      );
      expect(linhas.map((l) => l.funcao)).toEqual(GATILHOS);
      for (const l of linhas) {
        expect(l.prosecdef, l.funcao).toBe(true);
        expect(l.config, l.funcao).toEqual(['search_path=""']);
      }
      expect(
        await s.linhas(
          `select f.funcao, r.papel from unnest($1::text[]) as f(funcao) cross join unnest($2::text[]) as r(papel)
            where has_function_privilege(r.papel, f.funcao::regprocedure, 'execute')`,
          [GATILHOS, QUEM],
        ),
      ).toEqual([]);
    });
  });

  it('os gatilhos estão ligados nas tabelas', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        await s.linhas(
          `select tgrelid::regclass::text as tabela, tgname::text as gatilho, tgfoid::regprocedure::text as funcao
             from pg_trigger
            where not tgisinternal and tgenabled = 'O'
              and tgrelid in ('mkt.campaigns'::regclass, 'mkt.campaign_managed_by_history'::regclass,
                              'mkt.sales_reps'::regclass)
            order by 1, 2`,
        ),
      ).toEqual([
        {
          tabela: 'mkt.campaign_managed_by_history',
          gatilho: 'campaign_managed_by_history_append_only',
          funcao: 'private.append_only()',
        },
        {
          tabela: 'mkt.campaign_managed_by_history',
          gatilho: 'campaign_managed_by_history_no_truncate',
          funcao: 'private.append_only()',
        },
        {
          tabela: 'mkt.campaign_managed_by_history',
          gatilho: 'campaign_managed_by_history_updated_at',
          funcao: 'private.set_updated_at()',
        },
        {
          tabela: 'mkt.campaigns',
          gatilho: 'campaigns_managed_by_audit',
          funcao: 'private.campaigns_managed_by_audit()',
        },
        {
          tabela: 'mkt.campaigns',
          gatilho: 'campaigns_managed_by_guard',
          funcao: 'private.campaigns_managed_by_guard()',
        },
        { tabela: 'mkt.campaigns', gatilho: 'campaigns_updated_at', funcao: 'private.set_updated_at()' },
        { tabela: 'mkt.sales_reps', gatilho: 'sales_reps_code', funcao: 'private.sales_reps_code()' },
        { tabela: 'mkt.sales_reps', gatilho: 'sales_reps_updated_at', funcao: 'private.set_updated_at()' },
      ]);
      // updated_at em milissegundos, por gatilho, em toda tabela da migração.
      for (const tabela of [
        'brands',
        'ad_accounts',
        'campaigns',
        'campaign_managed_by_history',
        'sales_reps',
        'sales_rep_app_logins',
        'ig_accounts',
        'web_properties',
      ]) {
        expect(
          await s.valor(
            `select count(*)::int from pg_trigger
              where tgrelid = $1::regclass and tgname = $2 and tgfoid = 'private.set_updated_at()'::regprocedure`,
            [`mkt.${tabela}`, `${tabela}_updated_at`],
          ),
          tabela,
        ).toBe(1);
      }
    });
  });

  it('os índices de tabelas.md', async () => {
    await caso(db, postgres, async (s) => {
      expect(
        await s.linhas(
          `select indexname::text from pg_indexes
            where schemaname = 'mkt' and indexname in ('campaigns_utm', 'campaigns_brand_status',
                                                       'campaign_managed_by_history_campaign')
            order by 1`,
        ),
      ).toEqual([
        { indexname: 'campaign_managed_by_history_campaign' },
        { indexname: 'campaigns_brand_status' },
        { indexname: 'campaigns_utm' },
      ]);
    });
  });
});

// Migração 02: as listas fechadas iguais ao labels.ts (RLS-25), o quadro de role_permissions e os feriados; e quem
// lê as duas tabelas (as políticas de authenticated entram na 03). docs/dados/listas.md e papeis-e-rls.md.
import { LISTAS } from '@csp-mkt/shared';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Quem, abrirBanco, anon, aplicarFixture, caso, postgres, servico, usuario } from './apoio/banco';
import { type Domain, consultaDe, domainsDoMkt } from './apoio/catalogo';
import { DONO, EX_GESTOR, GESTOR, PODE, SEM_PERFIL } from './apoio/usuarios';

/** Domain → lista do labels.ts quando o nome não é o mesmo em camelCase (listas.md, "Como funciona"). */
const LISTA_DO_DOMAIN: Readonly<Record<string, string>> = {
  brand_code: 'brand',
  lead_origin: 'leadSource',
  connector_code: 'connectorId',
  ai_source: 'geoSource',
};

/**
 * Domain que ainda não tem lista no labels.ts, cada um com o motivo (listas.md, "Listas novas", e metricas.md,
 * seção 8). O rótulo entra quando uma tela mostrar a lista, e esta lista se esvazia na fase 4. A migração que cria
 * um domain sem rótulo põe o nome aqui, com o motivo.
 */
const SO_NO_BANCO: Readonly<Record<string, string>> = {
  data_source: 'o sistema de onde veio a linha; só aparece na tela no "Arquivo CSV" de um snapshot',
  lead_kind: 'de qual tabela do CRM veio o lead (negócio do funil ou lead do SDR); nenhuma tela mostra',
  crm_customer_status: 'o clientes.status do CRM, que decide a etapa "Cadastro"; não é etiqueta de tela',
  upstream_trigger: 'como rodou a sincronização apps → CSP 360; o cartão do CSP 360 mostra na fase 4',
  rep_crm_role: 'o papel do código REP- no CRM; serve ao filtro de representante da fase 4',
  web_property_kind: 'propriedade do GA4 ou do Search Console; o cadastro é por script, sem tela',
  ga4_channel:
    'saída de mkt.v_ga4_channel_daily; o Ga4Channel de queries/seo-geo.ts vai para o shared na fase 4',
  site_check_item:
    'item da checagem dos sites; o SiteCheckItem de queries/seo-geo.ts vai para o shared na fase 4',
  site_check_finding:
    'o achado do worker na checagem; a tela mostra o estado que sai dele (site_check_status)',
  site_check_status:
    'saída da view da checagem; hoje vive em queries/seo-geo.ts e vai para o shared na fase 4',
  discard_reason: 'motivo do descarte em lista fechada; a janela de descartar ganha a escolha na fase 4',
  done_via: 'se a central executou ou alguém marcou como feita; a trilha mostra na fase 4',
  operator_change_reason: 'motivo da troca de operador (decisão 0008); a troca entra na tela na fase 4',
  actor_kind: 'quem fez cada passo da trilha; a tela mostra o nome da pessoa, "Claude" ou "Sistema"',
  run_status: 'andamento da rodada do Claude; a faixa do Claude mostra na fase 4',
  stop_scope: 'o alcance do "Parar tudo" (decisão 0022); hoje só as campanhas do Claude',
  execution_operation: 'cada escrita numa plataforma (decisão 0038); as execuções entram na tela na fase 4',
  execution_status: 'andamento da escrita numa plataforma; a fila do Tráfego mostra na fase 4',
  execution_block_reason: 'por que a central não executou; o texto de cada motivo entra na fase 4',
  traffic_event: 'eventos do diário, que o protótipo ainda escreve em português no módulo do Tráfego',
  connector_setup_state: 'o que o dono configurou; a tela mostra o estado calculado (connector_status)',
  sync_job: 'cada trabalho de um conector; o cartão diz qual atrasou na fase 4',
  sync_trigger: 'como a rodada começou; fica só na trilha das rodadas',
  sync_status: 'andamento de cada rodada; o cartão do conector mostra na fase 4',
  credential_purpose: 'leitura ou escrita (decisão 0005); o estado da credencial entra no cartão na fase 4',
  credential_status: 'o estado da credencial ("Vence logo", "Recusada"); o cartão mostra na fase 4',
  app_action: 'as ações de role_permissions; os rótulos (ROTULO_DA_ACAO) vão para o labels.ts na fase 4',
  theme_preference: 'o tema guardado no perfil; a tela usa o localStorage ("", light, dark) até ler o perfil',
  view_mode: 'a visão padrão do perfil; na URL continua ?visao=visualizador ou gestor',
  notice_kind: 'os avisos; os ids em português do avisos.ts viram estes códigos na fase 4',
  notice_channel: 'canal do aviso; hoje a tela usa CANAIS_DE_AVISO, do avisos.ts',
  outbox_status: 'andamento da fila de avisos; nenhuma tela mostra a fila',
  saved_filter_scope: 'qual barra o "Meus filtros" guarda; não aparece como texto na tela',
  audit_event: 'eventos da auditoria; os rótulos entram quando houver tela, na fase 4',
  deactivation_reason: 'motivo de tirar o acesso; a janela de tirar acesso entra na fase 4',
  period_code:
    'o período dos filtros; na URL fica em português (este-mes, 7d…), traduzido numa função só na fase 4',
  // Listas de saída de metricas.md, seção 8, adiantadas nas migrações 10 e 11.
  spend_situation:
    'a situação do gasto contra o limite ou a verba (mkt.pace); o rótulo entra com api.kpi_spend_limits na fase 4',
  limit_alert:
    'o alerta da régua do limite (mkt.v_account_month); a Visão geral e os canais mostram na fase 4',
  action_alert:
    'o alerta de cada ação da fila (api.v_traffic_actions); o texto de cada alerta entra na fase 4',
};

const TABELAS_DO_LABELS = LISTAS as unknown as Readonly<Record<string, Readonly<Record<string, unknown>>>>;

const camelCase = (nome: string): string =>
  nome.replace(/_([a-z0-9])/g, (_, letra: string) => letra.toUpperCase());
const listaDoLabels = (domain: string): string => LISTA_DO_DOMAIN[domain] ?? camelCase(domain);
const ordenada = (codigos: readonly string[]): string[] => [...codigos].sort();

let db: PGlite;
let domains: Domain[];

beforeAll(async () => {
  db = await abrirBanco();
  await aplicarFixture(db, 'usuarios');
  domains = await domainsDoMkt(consultaDe(db));
});

afterAll(async () => {
  await db.close();
});

describe('os domain de mkt', () => {
  it('cada lista é texto com um check só, <lista>_check, na forma value in (…), sem código repetido', () => {
    expect(domains.length).toBeGreaterThanOrEqual(51);
    for (const d of domains) {
      expect(d.nome, d.nome).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(d.base, d.nome).toBe('text');
      expect(d.restricoes, d.nome).toEqual([`${d.nome}_check`]);
      expect(d.codigos.length, `${d.nome}: ${d.definicoes.join(' ')}`).toBeGreaterThan(0);
      expect(new Set(d.codigos).size, d.nome).toBe(d.codigos.length);
      for (const codigo of d.codigos) expect(codigo, d.nome).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it('o check é o que o teste leu: cada código passa e um código de fora é recusado', async () => {
    await caso(db, postgres, async (s) => {
      for (const d of domains) {
        for (const codigo of d.codigos) {
          expect(await s.valor(`select $1::mkt.${d.nome}::text`, [codigo]), d.nome).toBe(codigo);
        }
        await s.erro('23514', `select $1::mkt.${d.nome}`, ['codigo_que_nao_existe']);
        await s.erro('23514', `select $1::mkt.${d.nome}`, [d.codigos[0]?.toUpperCase()]);
      }
    });
  });
});

describe('RLS-25: cada domain igual à lista do labels.ts', () => {
  it('as listas com rótulo têm os mesmos códigos no banco e no labels.ts', () => {
    const comparadas: string[] = [];
    for (const d of domains.filter((d) => !(d.nome in SO_NO_BANCO))) {
      const lista = listaDoLabels(d.nome);
      const tabela = TABELAS_DO_LABELS[lista];
      expect(
        tabela,
        `mkt.${d.nome} não tem a lista "${lista}" no labels.ts nem está em SO_NO_BANCO`,
      ).toBeDefined();
      expect(ordenada(Object.keys(tabela ?? {})), `mkt.${d.nome} × labels.ts ${lista}`).toEqual(
        ordenada(d.codigos),
      );
      comparadas.push(lista);
    }
    // Toda lista do labels.ts tem o seu domain: nenhuma fica só no front sem aparecer aqui.
    expect(ordenada(comparadas)).toEqual(ordenada(Object.keys(LISTAS)));
  });

  it('SO_NO_BANCO só tem domain que existe e que ainda não tem rótulo, cada um com o motivo', () => {
    const nomes = new Set(domains.map((d) => d.nome));
    for (const [nome, motivo] of Object.entries(SO_NO_BANCO)) {
      expect(nomes.has(nome), `SO_NO_BANCO cita mkt.${nome}, que não existe`).toBe(true);
      expect(TABELAS_DO_LABELS[listaDoLabels(nome)], `mkt.${nome} já tem rótulo: sai de SO_NO_BANCO`).toBe(
        undefined,
      );
      expect(motivo.length, nome).toBeGreaterThanOrEqual(20);
    }
  });

  it('as cinco listas que mudaram com o banco já estão no labels.ts como o banco as guarda', () => {
    const codigos = (nome: string) => ordenada(domains.find((d) => d.nome === nome)?.codigos ?? []);
    // Faturado é carimbo (is_invoiced), não status; cancelado e orçamento entram.
    expect(codigos('order_status')).toEqual(['cancelled', 'quote', 'sent']);
    expect(ordenada(Object.keys(LISTAS.orderStatus))).toEqual(['cancelled', 'quote', 'sent']);
    // "Outro assistente" não some do total; "falhou" pede decisão; "simulado" vira "a ligar".
    expect(codigos('ai_source')).toContain('other');
    expect(Object.keys(LISTAS.geoSource)).toContain('other');
    expect(codigos('action_status')).toContain('failed');
    expect(Object.keys(LISTAS.actionStatus)).toContain('failed');
    expect(codigos('connector_status')).toEqual(['disabled', 'down', 'late', 'not_connected', 'ok']);
    expect(Object.keys(LISTAS.connectorStatus)).not.toContain('simulated');
    expect(codigos('customer_situation')).toEqual(ordenada(Object.keys(LISTAS.customerSituation)));
  });
});

describe('role_permissions: a única lista de permissões', () => {
  it('é o quadro de listas.md: o dono pode tudo menos ver dado pessoal de lead; o gestor, só ler e operar', async () => {
    await caso(db, postgres, async (s) => {
      const linhas = await s.linhas<{ role: string; acoes: string[] }>(
        `select role::text, array_agg(action::text order by action) as acoes
           from mkt.role_permissions group by role order by role`,
      );
      expect(linhas).toEqual([
        { role: 'owner', acoes: ordenada(PODE.owner) },
        { role: 'traffic_manager', acoes: ordenada(PODE.traffic_manager) },
      ]);
      expect(
        await s.valor(
          `select count(*)::int from mkt.role_permissions where action = 'view_lead_personal_data'`,
        ),
      ).toBe(0);
    });
  });

  it('uma linha por papel e ação, só com papel e ação das listas', async () => {
    await caso(db, postgres, async (s) => {
      await s.erro(
        '23505',
        `insert into mkt.role_permissions (role, action) values ('owner', 'view_numbers')`,
      );
      await s.erro(
        '23514',
        `insert into mkt.role_permissions (role, action) values ('owner', 'ver_numeros')`,
      );
      await s.erro(
        '23514',
        `insert into mkt.role_permissions (role, action) values ('admin', 'view_numbers')`,
      );
    });
  });
});

describe('holidays: feriados nacionais do ano e do seguinte', () => {
  const FERIADOS = [
    ['01-01', 'Confraternização Universal'],
    ['04-21', 'Tiradentes'],
    ['05-01', 'Dia do Trabalho'],
    ['09-07', 'Independência do Brasil'],
    ['10-12', 'Nossa Senhora Aparecida'],
    ['11-02', 'Finados'],
    ['11-15', 'Proclamação da República'],
    ['11-20', 'Dia Nacional de Zumbi e da Consciência Negra'],
    ['12-25', 'Natal'],
  ] as const;

  it('2026 e 2027: as datas fixas e a Paixão de Cristo (sexta antes da Páscoa), um por dia', async () => {
    await caso(db, postgres, async (s) => {
      const linhas = await s.linhas<{ dia: string; nome: string }>(
        `select holiday_on::text as dia, name as nome from mkt.holidays order by holiday_on`,
      );
      const esperados = ['2026', '2027']
        .flatMap((ano) => [
          ...FERIADOS.map(([dia, nome]) => ({ dia: `${ano}-${dia}`, nome })),
          { dia: ano === '2026' ? '2026-04-03' : '2027-03-26', nome: 'Paixão de Cristo' },
        ])
        .sort((a, b) => a.dia.localeCompare(b.dia));
      expect(linhas).toEqual(esperados);
      expect(
        await s.valor(
          `select count(*)::int from mkt.holidays where name = 'Paixão de Cristo' and extract(isodow from holiday_on) = 5`,
        ),
      ).toBe(2);
      await s.erro(
        '23505',
        `insert into mkt.holidays (holiday_on, name) values ('2026-12-25', 'Natal de novo')`,
      );
    });
  });
});

describe('quem lê as listas de apoio', () => {
  const contar = `select (select count(*)::int from mkt.role_permissions) as permissoes,
                         (select count(*)::int from mkt.holidays) as feriados`;

  it('o worker e quem tem perfil ativo leem tudo; sem perfil ou com perfil inativo, nada', async () => {
    const leem: Quem[] = [servico('mkt_worker'), usuario(DONO), usuario(GESTOR), usuario(DONO, 'aal2')];
    for (const quem of leem) {
      await caso(db, quem, async (s) => {
        expect(await s.linhas(contar)).toEqual([{ permissoes: 18, feriados: 20 }]);
      });
    }
    for (const quem of [usuario(EX_GESTOR, 'aal2'), usuario(SEM_PERFIL, 'aal2')]) {
      await caso(db, quem, async (s) => {
        expect(await s.linhas(contar)).toEqual([{ permissoes: 0, feriados: 0 }]);
      });
    }
  });

  it('o executor, o n8n, os scripts e anon não leem', async () => {
    const naoLeem: Quem[] = [anon, servico('mkt_executor'), servico('n8n_notifier'), servico('mkt_setup')];
    for (const quem of naoLeem) {
      await caso(db, quem, async (s) => {
        await s.erro('42501', 'select count(*) from mkt.role_permissions');
        await s.erro('42501', 'select count(*) from mkt.holidays');
      });
    }
  });

  it('ninguém grava as listas de apoio: nem o dono pela API, nem o worker', async () => {
    for (const quem of [usuario(DONO, 'aal2'), servico('mkt_worker')]) {
      await caso(db, quem, async (s) => {
        await s.erro(
          '42501',
          `insert into mkt.role_permissions (role, action) values ('traffic_manager', 'stop_all')`,
        );
        await s.erro('42501', `update mkt.role_permissions set action = 'stop_all'`);
        await s.erro('42501', `delete from mkt.holidays`);
      });
    }
  });
});

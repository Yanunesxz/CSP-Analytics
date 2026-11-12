/**
 * RLS-27, a lista permitida: quem dos seis papéis executa cada função dos sete esquemas, escrita à mão e à parte do
 * banco de propósito (docs/dados/papeis-e-rls.md, "Privilégios por esquema" e "Funções de ação"). O teste compara com
 * has_function_privilege: função nova sem linha aqui, linha sem função ou um grant a mais fazem o teste falhar.
 * notify ainda não tem função (as da fila do n8n entram na migração 13, na fase 4).
 */
import { FUNCOES_DE_API } from './acoes';

/** Os papéis que o caso RLS-27 confere (service_role e authenticator ficam de fora: o Supabase cuida deles). */
export const PAPEIS_DO_CATALOGO = [
  'anon',
  'authenticated',
  'mkt_worker',
  'mkt_executor',
  'mkt_setup',
  'n8n_notifier',
] as const;

export type PapelDoCatalogo = (typeof PAPEIS_DO_CATALOGO)[number];

const TELA: readonly PapelDoCatalogo[] = ['authenticated'];
const FORMULAS: readonly PapelDoCatalogo[] = ['authenticated', 'mkt_worker', 'mkt_executor'];
const WORKER: readonly PapelDoCatalogo[] = ['mkt_worker'];
const EXECUTOR: readonly PapelDoCatalogo[] = ['mkt_executor'];
const SCRIPTS: readonly PapelDoCatalogo[] = ['mkt_setup'];
const NINGUEM: readonly PapelDoCatalogo[] = [];

/** As upsert do worker que recebem a rodada e o lote (a checagem dos sites não tem rodada). */
export const UPSERTS_COM_RODADA: readonly string[] = [
  'upsert_ad_accounts',
  'upsert_ad_activity_log',
  'upsert_ad_campaign_daily',
  'upsert_brands',
  'upsert_campaigns',
  'upsert_crm_customer_brands',
  'upsert_crm_customer_reps',
  'upsert_crm_customers',
  'upsert_crm_funnels',
  'upsert_crm_leads',
  'upsert_crm_orders',
  'upsert_crm_upstream_runs',
  'upsert_ga4_traffic_daily',
  'upsert_ig_account_daily',
  'upsert_ig_accounts',
  'upsert_ig_media',
  'upsert_ig_media_daily',
  'upsert_sales_rep_app_logins',
  'upsert_sales_reps',
  'upsert_seo_daily',
  'upsert_seo_query_daily',
];

const GRUPOS: ReadonlyArray<[readonly PapelDoCatalogo[], readonly string[]]> = [
  // api: só a tela, uma a uma, na migração que cria cada uma (09).
  [TELA, Object.values(FUNCOES_DE_API).map((f) => f.assinatura)],
  // authz: as que as políticas chamam.
  [
    TELA,
    [
      'authz.can(mkt.app_action)',
      'authz.display_name(uuid)',
      'authz.is_active_user()',
      'authz.requires_second_factor(mkt.app_action)',
    ],
  ],
  // mkt: as fórmulas e as regras, que rodam com os direitos de quem chama: a tela, o worker e o executor.
  [
    FORMULAS,
    [
      'mkt.action_alert(uuid)',
      'mkt.action_exceeds_limit(uuid)',
      'mkt.action_extra_spend_cents(uuid)',
      'mkt.ads_covered(uuid,mkt.platform)',
      'mkt.ai_source_of(text,text)',
      'mkt.csv_header_has_personal_data(text)',
      'mkt.execution_extra_spend_cents(uuid)',
      'mkt.execution_may_increase_spend(uuid)',
      'mkt.has_personal_data(text)',
      'mkt.host_matches(text,text[])',
      'mkt.is_known_origin_text(text)',
      'mkt.limit_alert(bigint,bigint)',
      'mkt.notice_default(mkt.notice_kind)',
      'mkt.now()',
      'mkt.pace(bigint,bigint,integer,integer)',
      'mkt.ratio(numeric,numeric)',
      'mkt.source_covered(mkt.connector_code)',
      'mkt.sp_day(timestamp with time zone)',
      'mkt.today()',
      'mkt.url_host(text)',
      'mkt.utm_key(text)',
      'mkt.utm_source_family(text)',
      'mkt.valid_action_params(mkt.action_kind,mkt.platform,jsonb)',
      'mkt.valid_activity_details(text,jsonb)',
      'mkt.valid_audit_changes(mkt.audit_event,jsonb)',
      'mkt.valid_claude_context(jsonb)',
      'mkt.valid_crm_text(text,boolean)',
      'mkt.valid_notice_payload(mkt.notice_kind,jsonb)',
      'mkt.valid_saved_filters(mkt.saved_filter_scope,jsonb)',
    ],
  ],
  // A conferência da execução lê o estado das credenciais e os perfis: só as funções do executor (dono postgres).
  [NINGUEM, ['mkt.execution_allowed(uuid)']],
  // ingest: o worker, uma a uma.
  [
    WORKER,
    [
      'ingest.add_claude_proposal(uuid,integer,mkt.brand_code,mkt.platform,uuid,mkt.action_kind,text,text,jsonb,mkt.level,mkt.level,bigint)',
      'ingest.delete_missing(text,uuid)',
      'ingest.finish_run(uuid,mkt.sync_status,text,text,timestamp with time zone)',
      'ingest.record_claude_run(uuid,mkt.brand_code,mkt.run_status,text,text,text,jsonb,timestamp with time zone,jsonb,integer,integer,integer,text,timestamp with time zone)',
      'ingest.replace_day(uuid,text,text,date,jsonb)',
      'ingest.set_credential_status(uuid,mkt.credential_status)',
      'ingest.start_run(mkt.connector_code,mkt.sync_job,mkt.sync_trigger,mkt.brand_code,timestamp with time zone,timestamp with time zone)',
      'ingest.take_requested_run(mkt.connector_code)',
      ...UPSERTS_COM_RODADA.map((f) => `ingest.${f}(uuid,jsonb)`),
      'ingest.upsert_site_checks(jsonb)',
    ],
  ],
  // ingest: o executor, só o tráfego.
  [
    EXECUTOR,
    [
      'ingest.next_execution()',
      'ingest.set_action_progress(uuid,mkt.action_status)',
      'ingest.update_execution(uuid,mkt.execution_status,integer,text,text,jsonb,mkt.execution_block_reason,jsonb)',
    ],
  ],
  // private: o worker lê e troca só o segredo de leitura; o executor não lê segredo (o de escrita fica nas variáveis dele).
  [
    WORKER,
    ['private.read_credential(uuid)', 'private.rotate_credential(uuid,text,timestamp with time zone)'],
  ],
  // private: o resto, ninguém (gatilhos, filas, conferências e a ingestão linha a linha).
  [
    NINGUEM,
    [
      'private.action_progress(uuid,mkt.action_status)',
      'private.append_only()',
      'private.campaigns_managed_by_audit()',
      'private.campaigns_managed_by_guard()',
      'private.cancel_action_executions(uuid)',
      'private.clean_crm_text(text,boolean)',
      'private.crm_leads_code()',
      'private.domain_codes(regtype)',
      'private.execution_request(mkt.execution_operation,mkt.platform,jsonb,text)',
      'private.handle_new_user()',
      'private.ingest_ad_account(jsonb,text,text,uuid)',
      'private.ingest_ad_activity(jsonb,text,text,uuid)',
      'private.ingest_ad_campaign_daily(jsonb,text,text,uuid)',
      'private.ingest_batch(uuid,jsonb,text[],text)',
      'private.ingest_brand(jsonb,text,text,uuid)',
      'private.ingest_campaign(jsonb,text,text,uuid)',
      'private.ingest_crm_customer(jsonb,text,text,uuid)',
      'private.ingest_crm_customer_brand(jsonb,text,text,uuid)',
      'private.ingest_crm_customer_rep(jsonb,text,text,uuid)',
      'private.ingest_crm_funnel(jsonb,text,text,uuid)',
      'private.ingest_crm_lead(jsonb,text,text,uuid)',
      'private.ingest_crm_order(jsonb,text,text,uuid)',
      'private.ingest_crm_upstream_run(jsonb,text,text,uuid)',
      'private.ingest_ga4_traffic_daily(jsonb,text,text,uuid)',
      'private.ingest_ig_account(jsonb,text,text,uuid)',
      'private.ingest_ig_account_daily(jsonb,text,text,uuid)',
      'private.ingest_ig_media(jsonb,text,text,uuid)',
      'private.ingest_ig_media_daily(jsonb,text,text,uuid)',
      'private.ingest_row_problem(jsonb,text,text[],text[],text[])',
      'private.ingest_sales_rep(jsonb,text,text,uuid)',
      'private.ingest_sales_rep_app_login(jsonb,text,text,uuid)',
      'private.ingest_seo_daily(jsonb,text,text,uuid)',
      'private.ingest_seo_query_daily(jsonb,text,text,uuid)',
      'private.ingest_site_check(jsonb,text,text,uuid)',
      'private.is_ignored_code(text)',
      'private.is_stale(timestamp with time zone,timestamp with time zone)',
      'private.next_code(text,regclass)',
      'private.platform_executions_guard()',
      'private.platform_executions_log()',
      'private.profiles_guard()',
      'private.queue_execution(uuid)',
      'private.queue_spend_cap(uuid,bigint)',
      'private.queue_stop_executions(uuid,mkt.execution_operation)',
      'private.read_back_campaign(mkt.platform_executions,jsonb)',
      'private.refusal_code(text,text)',
      'private.rep_for_login(uuid,text)',
      'private.sales_reps_code()',
      'private.set_updated_at()',
      'private.traffic_actions_code()',
      'private.traffic_actions_log()',
      'private.traffic_actions_transition()',
      'private.valid_note(text,integer,integer)',
      'private.validate_action(mkt.brand_code,mkt.platform,uuid,mkt.action_kind,text,text,jsonb,mkt.level,mkt.level,bigint)',
      'private.write_credential_ok(uuid)',
    ],
  ],
  // setup: os scripts de configuração.
  [
    SCRIPTS,
    [
      'setup.create_first_owner_invitation(text,text)',
      'setup.mark_lead_funnel(text)',
      'setup.register_ad_account(mkt.brand_code,mkt.platform,text,text)',
      'setup.register_credential(mkt.connector_code,mkt.credential_purpose,text,text,timestamp with time zone)',
      'setup.register_ig_account(mkt.brand_code,text,text)',
      'setup.register_web_property(mkt.brand_code,mkt.web_property_kind,text,text)',
    ],
  ],
];

/** Cada função (como o catálogo mostra, regprocedure) com os papéis que a executam, em ordem. */
export function quemExecuta(): Map<string, readonly PapelDoCatalogo[]> {
  const mapa = new Map<string, readonly PapelDoCatalogo[]>();
  for (const [papeis, funcoes] of GRUPOS) {
    for (const funcao of funcoes) {
      if (mapa.has(funcao)) throw new Error(`Função repetida na lista permitida: ${funcao}`);
      mapa.set(funcao, papeis);
    }
  }
  return mapa;
}

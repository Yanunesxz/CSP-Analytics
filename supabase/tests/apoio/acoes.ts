/**
 * O que os testes da migração 09 esperam, escrito à parte do banco de propósito (docs/dados/papeis-e-rls.md, "Funções
 * de ação"): cada função de api com a assinatura do catálogo e uma chamada inerte (id que não existe, updated_at
 * antigo, contagem 0: mesmo que a proteção falhasse, nada importante seria gravado), as de private e as regras de mkt.
 */

/** Id que não existe em tabela nenhuma. */
export const ZERO = '00000000-0000-0000-0000-000000000000';

/** Um updated_at que nenhuma linha tem. */
export const ANTIGO = '2000-01-01T00:00:00.000Z';

export interface FuncaoDeApi {
  /** Como o catálogo mostra (regprocedure). */
  assinatura: string;
  /** Uma chamada com argumentos inertes. */
  chamada: string;
}

/** As funções de api da migração 09: as de ação e as de leitura com regra própria. */
export const FUNCOES_DE_API: Readonly<Record<string, FuncaoDeApi>> = {
  propose_action: {
    assinatura:
      'api.propose_action(mkt.brand_code,mkt.platform,uuid,mkt.action_kind,text,text,jsonb,mkt.level,mkt.level,bigint,boolean)',
    chamada: `select api.propose_action('cs', 'meta', null, 'pause', 'Chamada inerte', 'Chamada inerte do teste.',
                                        '{"status": "paused"}', 'low', 'low', null, false)`,
  },
  approve_action: {
    assinatura: 'api.approve_action(uuid,timestamp with time zone)',
    chamada: `select api.approve_action('${ZERO}', '${ANTIGO}')`,
  },
  discard_action: {
    assinatura: 'api.discard_action(uuid,mkt.discard_reason,text,timestamp with time zone)',
    chamada: `select api.discard_action('${ZERO}', 'other', 'Chamada inerte do teste.', '${ANTIGO}')`,
  },
  mark_action_done: {
    assinatura: 'api.mark_action_done(uuid,text,timestamp with time zone)',
    chamada: `select api.mark_action_done('${ZERO}', 'Chamada inerte.', '${ANTIGO}')`,
  },
  retry_execution: {
    assinatura: 'api.retry_execution(uuid,timestamp with time zone)',
    chamada: `select api.retry_execution('${ZERO}', '${ANTIGO}')`,
  },
  save_strategy: {
    assinatura:
      'api.save_strategy(mkt.brand_code,date,text,bigint,bigint,bigint,integer,timestamp with time zone)',
    chamada: `select api.save_strategy('cs', '2000-01-01', '', null, null, null, null, '${ANTIGO}')`,
  },
  set_spend_limit: {
    assinatura: 'api.set_spend_limit(uuid,bigint,timestamp with time zone)',
    chamada: `select api.set_spend_limit('${ZERO}', 0, null)`,
  },
  stop_all: {
    assinatura: 'api.stop_all(mkt.brand_code,integer)',
    chamada: `select api.stop_all(null, 0)`,
  },
  undo_stop: {
    assinatura: 'api.undo_stop(uuid,timestamp with time zone)',
    chamada: `select api.undo_stop('${ZERO}', '${ANTIGO}')`,
  },
  change_campaign_operator: {
    assinatura:
      'api.change_campaign_operator(uuid,mkt.operator,mkt.operator_change_reason,text,timestamp with time zone)',
    chamada: `select api.change_campaign_operator('${ZERO}', 'human', 'correction', null, '${ANTIGO}')`,
  },
  retry_connector: {
    assinatura: 'api.retry_connector(mkt.connector_code)',
    chamada: `select api.retry_connector('csp360')`,
  },
  set_connector_state: {
    assinatura:
      'api.set_connector_state(mkt.connector_code,mkt.connector_setup_state,timestamp with time zone)',
    chamada: `select api.set_connector_state('csp360', 'disabled', '${ANTIGO}')`,
  },
  confirm_mass_delete: {
    assinatura: 'api.confirm_mass_delete(uuid)',
    chamada: `select api.confirm_mass_delete('${ZERO}')`,
  },
  upload_csv: {
    assinatura: 'api.upload_csv(mkt.connector_code,mkt.brand_code,text,text)',
    chamada: `select api.upload_csv('meta', 'cs', 'inerte.csv', e'campaign_id,spend\\n1,0\\n')`,
  },
  invite_user: {
    assinatura: 'api.invite_user(text,text,mkt.role)',
    chamada: `select api.invite_user('inerte@example.invalid', 'Pessoa inerte', 'traffic_manager')`,
  },
  revoke_invitation: {
    assinatura: 'api.revoke_invitation(uuid)',
    chamada: `select api.revoke_invitation('${ZERO}')`,
  },
  change_role: {
    assinatura: 'api.change_role(uuid,mkt.role,timestamp with time zone)',
    chamada: `select api.change_role('${ZERO}', 'traffic_manager', '${ANTIGO}')`,
  },
  revoke_access: {
    assinatura: 'api.revoke_access(uuid,mkt.deactivation_reason,text,timestamp with time zone)',
    chamada: `select api.revoke_access('${ZERO}', 'security', null, '${ANTIGO}')`,
  },
  save_profile_preferences: {
    assinatura: 'api.save_profile_preferences(mkt.theme_preference,mkt.brand_code,mkt.view_mode,text)',
    chamada: `select api.save_profile_preferences('device', null, 'viewer', null)`,
  },
  save_notification_preference: {
    assinatura: 'api.save_notification_preference(mkt.notice_kind,boolean,boolean)',
    chamada: `select api.save_notification_preference('weekly_report', true, false)`,
  },
  save_filter: {
    assinatura: 'api.save_filter(mkt.saved_filter_scope,text,jsonb)',
    chamada: `select api.save_filter('bar', 'Inerte', '{}')`,
  },
  delete_saved_filter: {
    assinatura: 'api.delete_saved_filter(uuid)',
    chamada: `select api.delete_saved_filter('${ZERO}')`,
  },
  my_profile: { assinatura: 'api.my_profile()', chamada: 'select * from api.my_profile()' },
  my_permissions: { assinatura: 'api.my_permissions()', chamada: 'select * from api.my_permissions()' },
  list_role_permissions: {
    assinatura: 'api.list_role_permissions()',
    chamada: 'select * from api.list_role_permissions()',
  },
  check_text: { assinatura: 'api.check_text(text)', chamada: `select api.check_text('texto de teste')` },
  list_users: { assinatura: 'api.list_users()', chamada: 'select * from api.list_users()' },
  credential_status: {
    assinatura: 'api.credential_status()',
    chamada: 'select * from api.credential_status()',
  },
  my_notification_preferences: {
    assinatura: 'api.my_notification_preferences()',
    chamada: 'select * from api.my_notification_preferences()',
  },
};

/**
 * As de private desta migração: ninguém executa (só as funções do dono, pelo dono). As filas e a conferência da ação
 * são as que a migração 10 também usa.
 */
export const FUNCOES_PRIVADAS: readonly string[] = [
  'private.cancel_action_executions(uuid)',
  'private.domain_codes(regtype)',
  'private.execution_request(mkt.execution_operation,mkt.platform,jsonb,text)',
  'private.is_stale(timestamp with time zone,timestamp with time zone)',
  'private.queue_execution(uuid)',
  'private.queue_spend_cap(uuid,bigint)',
  'private.queue_stop_executions(uuid,mkt.execution_operation)',
  'private.valid_note(text,integer,integer)',
  'private.validate_action(mkt.brand_code,mkt.platform,uuid,mkt.action_kind,text,text,jsonb,mkt.level,mkt.level,bigint)',
  'private.write_credential_ok(uuid)',
];

/** As regras de mkt desta migração: a tela, o worker e o executor (o padrão do esquema). */
export const REGRAS_DE_MKT: readonly string[] = [
  'mkt.csv_header_has_personal_data(text)',
  'mkt.execution_may_increase_spend(uuid)',
];

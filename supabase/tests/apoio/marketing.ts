/**
 * O que os testes das migrações 04 a 06 esperam: os ids de tests/fixtures/marketing.sql (dados inventados) e quem lê
 * cada tabela, escrito à parte do banco de propósito (docs/dados/papeis-e-rls.md, "Políticas" e "Privilégios por
 * esquema"): o teste compara os dois.
 */

/** Conta Meta da Corpo Sensual, com o teto da conta. */
export const CONTA_META_CS = '00000000-0000-4000-8000-000000000201';
/** Conta Google da Plumene. */
export const CONTA_GOOGLE_PL = '00000000-0000-4000-8000-000000000202';
/** Campanha do humano na conta Meta da cs. */
export const CAMPANHA_HUMANO_CS = '00000000-0000-4000-8000-000000000211';
/** Campanha criada pela central na conta Meta da cs: nasce do Claude, com a ação que a criou. */
export const CAMPANHA_CLAUDE_CS = '00000000-0000-4000-8000-000000000212';
/** Campanha do humano na conta Google da Plumene. */
export const CAMPANHA_HUMANO_PL = '00000000-0000-4000-8000-000000000213';
/** A ação de tráfego que criou a campanha do Claude (ACT-0001, feita pela central; a chave entra na migração 07). */
export const ACAO_QUE_CRIOU = '00000000-0000-4000-8000-0000000002f1';
/** Representante do CRM (com usuarios.id). */
export const REP_DO_CRM = '00000000-0000-4000-8000-000000000221';
/** Representante só de app (sem id do CRM), com um login da cs. */
export const REP_DO_APP = '00000000-0000-4000-8000-000000000222';
/** Perfil do Instagram da cs. */
export const PERFIL_IG_CS = '00000000-0000-4000-8000-000000000231';
/** Post do perfil da cs. */
export const POST_IG_CS = '00000000-0000-4000-8000-000000000291';
/** Propriedade GA4 da cs. */
export const GA4_CS = '00000000-0000-4000-8000-000000000241';
/** Propriedade do Search Console da cs. */
export const GSC_CS = '00000000-0000-4000-8000-000000000242';
/** O funil padrão do CRM, que é o de leads (decisão 0041, item 1). */
export const FUNIL_DE_LEADS = '00000000-0000-4000-8000-000000000251';
/** O funil antigo dos leads do site: não é o padrão, e o script de configuração já o marcou como de leads. */
export const FUNIL_ANTIGO_DE_LEADS = '00000000-0000-4000-8000-000000000252';
/**
 * Cliente com UTM de primeiro contato e carteira na cs; na cs, um cliente antigo que recomprou: situação nula (decisão
 * 0041) e a compra do ERP mais antiga já vista guardada (decisão 0042).
 */
export const CLIENTE_A = '00000000-0000-4000-8000-000000000261';
/** Prospecto, sem situação. */
export const CLIENTE_B = '00000000-0000-4000-8000-000000000262';
/** Negócio do funil de leads, da cs. */
export const LEAD_NEGOCIO = '00000000-0000-4000-8000-000000000271';
/** Lead do SDR, sem marca (decisão 0014). */
export const LEAD_SDR = '00000000-0000-4000-8000-000000000272';
/**
 * O negócio da conversão do lead do SDR: veio do CRM sem funil (conta como do funil padrão) e sem marca, com a origem
 * "SDR WhatsApp" (decisão 0041, itens 1 e 3).
 */
export const LEAD_NEGOCIO_DO_SDR = '00000000-0000-4000-8000-000000000273';
/** Pedido enviado do cliente A na cs. */
export const PEDIDO = '00000000-0000-4000-8000-000000000281';

export type Permissao = 'view_numbers' | 'view_leads' | 'view_traffic' | 'view_connectors';

/** As tabelas das migrações 04 a 06 e a permissão que libera a leitura de cada uma (tabelas.md, "Todas as tabelas"). */
export const LEITURA: Readonly<Record<string, Permissao>> = {
  'mkt.brands': 'view_numbers',
  'mkt.ad_accounts': 'view_numbers',
  'mkt.campaigns': 'view_numbers',
  'mkt.campaign_managed_by_history': 'view_traffic',
  'mkt.sales_reps': 'view_numbers',
  'mkt.sales_rep_app_logins': 'view_numbers',
  'mkt.ig_accounts': 'view_numbers',
  'mkt.web_properties': 'view_numbers',
  'mkt.crm_funnels': 'view_leads',
  'mkt.crm_origin_map': 'view_leads',
  'mkt.crm_customers': 'view_numbers',
  'mkt.crm_customer_brands': 'view_numbers',
  'mkt.crm_customer_reps': 'view_numbers',
  'mkt.crm_leads': 'view_leads',
  'mkt.crm_orders': 'view_numbers',
  'mkt.crm_upstream_runs': 'view_connectors',
  'mkt.ad_campaign_daily': 'view_numbers',
  'mkt.ad_activity_log': 'view_traffic',
  'mkt.ig_account_daily': 'view_numbers',
  'mkt.ig_media': 'view_numbers',
  'mkt.ig_media_daily': 'view_numbers',
  'mkt.seo_daily': 'view_numbers',
  'mkt.seo_query_daily': 'view_numbers',
  'mkt.ga4_traffic_daily': 'view_numbers',
  'mkt.site_checks': 'view_numbers',
};

/** O que o executor lê destas tabelas: marcas, contas, campanhas e o gasto por campanha. O worker lê todas. */
export const EXECUTOR_LE: readonly string[] = [
  'mkt.brands',
  'mkt.ad_accounts',
  'mkt.campaigns',
  'mkt.ad_campaign_daily',
];

/**
 * Tabelas de fato em que a marca pode faltar (decisão 0014): o lead sem marca e as de trilha ou operação, com o
 * sentido "as duas marcas" ou "não é de marca". Em toda outra tabela, brand_id é obrigatório.
 */
export const MARCA_PODE_FALTAR: readonly string[] = [
  'mkt.crm_leads',
  'mkt.crm_upstream_runs',
  'mkt.claude_runs',
  'mkt.traffic_stops',
  'mkt.traffic_log',
  'mkt.sync_runs',
];

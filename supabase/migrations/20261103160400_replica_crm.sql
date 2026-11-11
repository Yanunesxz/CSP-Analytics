-- Migração 05 · réplica mínima do CSP 360 (docs/dados/plano.md, "Ordem"; decisões 0006, 0012, 0014 e 0015)
--
-- O que faz: cria crm_funnels, crm_origin_map (com o de-para inicial, só valores genéricos de canal), crm_customers,
--   crm_customer_brands, crm_customer_reps, crm_leads, crm_orders e crm_upstream_runs (docs/dados/tabelas.md, seção 2):
--   só ids, marca, datas, situação, origem e UTM, representante por id e a chave clientes.id; nunca nome, telefone,
--   e-mail, documento ou texto livre de pessoa. A UTM e a origem que vêm do CRM passam por mkt.valid_crm_text no check
--   (sem @ e, fora o nome de campanha, sem dado pessoal), a última barreira depois da limpeza das funções ingest.*. O
--   lead aceita marca nula ("Sem marca", decisão 0014); pedido, situação e carteira, não. Cada tabela nasce com a RLS
--   ligada, a leitura de quem tem a permissão (view_leads nos leads, funis e de-para; view_connectors nas rodadas apps →
--   CRM; view_numbers no resto) e a do worker. E o código LEAD- do lead do SDR, por gatilho: vem da sequência, não
--   gasta número na releitura e nunca muda.
-- Risco: baixo. Só cria; as tabelas nascem vazias, menos o de-para (valores genéricos, nenhum nome de pessoa). Nada lê
--   o CRM: a réplica é gravada pelo worker, pelas funções ingest.* (migração 10).
-- Como reverter (só no projeto de teste, antes de produção, e depois de reverter as migrações seguintes):
--   drop table mkt.crm_upstream_runs, mkt.crm_orders, mkt.crm_leads, mkt.crm_customer_reps, mkt.crm_customer_brands,
--     mkt.crm_customers, mkt.crm_origin_map, mkt.crm_funnels;
--   drop function private.crm_leads_code();
-- Conferir (o de-para inicial; e cada tabela com a política da sua permissão):
--   select raw_value, origin from mkt.crm_origin_map order by origin, raw_value;
--   select tablename, policyname, qual from pg_policies
--    where schemaname = 'mkt' and tablename like 'crm\_%' and 'authenticated' = any(roles) order by 1;

-- ---------- Tabelas ----------

-- Funis de venda do CRM. Qual é o funil de leads é configuração do CSP-MKT (só por migração, quando o time do CRM
-- decidir): um só pode ser.
create table if not exists mkt.crm_funnels (
  id uuid primary key default gen_random_uuid(),
  source mkt.data_source not null default 'csp360',
  external_id text not null,
  name text not null,
  is_default boolean not null default false,
  is_lead_funnel boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (source, external_id)
);
alter table mkt.crm_funnels enable row level security;
create unique index if not exists crm_funnels_one_lead_funnel on mkt.crm_funnels (is_lead_funnel) where is_lead_funnel;

-- De-para da origem do negócio (negocios.origem, texto sem lista no CRM) para a origem do lead. Só a migração grava:
-- valor novo é conferido no CSP 360 e entra aqui por migração.
create table if not exists mkt.crm_origin_map (
  id uuid primary key default gen_random_uuid(),
  raw_value text not null unique check (raw_value = lower(btrim(raw_value)) and raw_value <> ''),
  origin mkt.lead_origin not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now())
);
alter table mkt.crm_origin_map enable row level security;

-- O de-para inicial: só nomes genéricos de canal e de fonte, normalizados (minúsculas, sem espaço nas pontas), com a
-- mesma origem que a classificação da UTM dá (metricas.md, 3.1). O "google" sozinho fica de fora: pago ou orgânico
-- depende do meio, e a classificação decide. Nenhum texto com nome de pessoa entra no repositório.
insert into mkt.crm_origin_map (raw_value, origin) values
  ('site', 'site'),
  ('whatsapp', 'sdr'),
  ('indicação', 'referral'),
  ('indicacao', 'referral'),
  ('meta ads', 'meta'),
  ('facebook ads', 'meta'),
  ('instagram ads', 'meta'),
  ('tiktok ads', 'tiktok'),
  ('google ads', 'google'),
  ('busca orgânica', 'organic'),
  ('busca organica', 'organic'),
  ('direto', 'direct')
on conflict (raw_value) do nothing;

-- Clientes (dimensão compartilhada, sem marca: a base do CRM é uma só). As UTMs de primeiro contato vêm da view
-- clientes_utm pedida ao CRM, limpas na entrada.
create table if not exists mkt.crm_customers (
  id uuid primary key default gen_random_uuid(),
  source mkt.data_source not null default 'csp360',
  external_id text not null,
  code text not null,
  crm_status mkt.crm_customer_status not null,
  is_known_by_erp boolean not null default false,
  has_app_owner boolean not null default false,
  first_utm_source text,
  first_utm_medium text,
  first_utm_campaign text,
  source_created_at timestamptz not null,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (source, external_id),
  check (mkt.valid_crm_text(first_utm_source) and mkt.valid_crm_text(first_utm_medium)
         and mkt.valid_crm_text(first_utm_campaign, true))
);
alter table mkt.crm_customers enable row level security;
create index if not exists crm_customers_code on mkt.crm_customers (code);

-- Situação e última compra por cliente e marca: a régua do CRM, lida da view clientes_situacao (decisão 0012), e o
-- retrato do ERP sem os pedidos do CRM (clientes_compras_marca, decisão 0030).
create table if not exists mkt.crm_customer_brands (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references mkt.crm_customers(id) on delete cascade,
  brand_id uuid not null references mkt.brands(id),
  situation mkt.customer_situation,
  is_lost_manual boolean not null default false,
  last_purchase_on date,
  erp_first_purchase_on date,
  erp_last_purchase_on date,
  erp_total_purchased_cents bigint check (erp_total_purchased_cents >= 0),
  situation_computed_at timestamptz,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (customer_id, brand_id)
);
alter table mkt.crm_customer_brands enable row level security;
create index if not exists crm_customer_brands_brand on mkt.crm_customer_brands (brand_id, situation);

-- Carteira: quem tem o cliente no app de cada marca (donos_app), pelo código do representante.
create table if not exists mkt.crm_customer_reps (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references mkt.crm_customers(id) on delete cascade,
  brand_id uuid not null references mkt.brands(id),
  sales_rep_id uuid not null references mkt.sales_reps(id) on delete cascade,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (customer_id, brand_id, sales_rep_id)
);
alter table mkt.crm_customer_reps enable row level security;
create index if not exists crm_customer_reps_rep on mkt.crm_customer_reps (sales_rep_id, brand_id);

-- Leads: negócios do funil de leads e leads do SDR. A marca pode faltar ("Sem marca", decisão 0014). A etapa, o 1º
-- pedido e a origem classificada não são colunas: saem de mkt.v_leads.
create table if not exists mkt.crm_leads (
  id uuid primary key default gen_random_uuid(),
  source mkt.data_source not null default 'csp360',
  kind mkt.lead_kind not null,
  external_id text not null,
  code text not null unique,
  brand_id uuid references mkt.brands(id),
  customer_id uuid references mkt.crm_customers(id) on delete set null,
  crm_funnel_id uuid references mkt.crm_funnels(id) on delete set null,
  crm_origin_raw text check (crm_origin_raw is null
                             or (crm_origin_raw = lower(btrim(crm_origin_raw)) and mkt.valid_crm_text(crm_origin_raw))),
  is_origin_unmapped boolean not null default false,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  referrer_host text check (referrer_host is null or (referrer_host = lower(referrer_host) and referrer_host !~ '[/:@]')),
  assigned_rep_id uuid references mkt.sales_reps(id) on delete set null,
  source_created_at timestamptz not null,
  source_updated_at timestamptz,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (source, kind, external_id),
  check (kind = 'deal' or crm_funnel_id is null),
  check (not is_origin_unmapped or crm_origin_raw is null),
  check (mkt.valid_crm_text(utm_source) and mkt.valid_crm_text(utm_medium) and mkt.valid_crm_text(utm_campaign, true))
);
alter table mkt.crm_leads enable row level security;
create index if not exists crm_leads_brand_created on mkt.crm_leads (brand_id, source_created_at);
create index if not exists crm_leads_customer on mkt.crm_leads (customer_id);
create index if not exists crm_leads_rep on mkt.crm_leads (assigned_rep_id);
create index if not exists crm_leads_utm on mkt.crm_leads (mkt.utm_key(utm_campaign));

-- Pedidos, em todos os status: o enviado e depois cancelado sai da conta. Faturado é carimbo do enviado
-- (is_invoiced), nunca status (seção 9 do padrão).
create table if not exists mkt.crm_orders (
  id uuid primary key default gen_random_uuid(),
  source mkt.data_source not null default 'csp360',
  external_id text not null,
  brand_id uuid not null references mkt.brands(id),
  customer_id uuid references mkt.crm_customers(id) on delete set null,
  status mkt.order_status not null,
  is_invoiced boolean not null default false,
  invoiced_at timestamptz,
  total_cents bigint not null check (total_cents >= 0),
  invoiced_total_cents bigint check (invoiced_total_cents >= 0),
  sales_rep_id uuid references mkt.sales_reps(id) on delete set null,
  sent_at timestamptz,
  source_created_at timestamptz not null,
  source_updated_at timestamptz,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (source, external_id),
  check (not is_invoiced or status = 'sent'),
  check (invoiced_at is null or is_invoiced)
);
alter table mkt.crm_orders enable row level security;
-- As contas de pedido filtram e ordenam pelo dia de envio (São Paulo), só nos enviados.
create index if not exists crm_orders_brand_order_on
  on mkt.crm_orders (brand_id, (mkt.sp_day(coalesce(sent_at, source_created_at)))) where status = 'sent';
create index if not exists crm_orders_customer
  on mkt.crm_orders (customer_id, brand_id, (coalesce(sent_at, source_created_at))) where status = 'sent';
create index if not exists crm_orders_rep on mkt.crm_orders (sales_rep_id);

-- Rodadas apps → CSP 360 (sincronizacoes), para o cartão do CSP 360 explicar atraso de pedido. Guarda 90 dias.
create table if not exists mkt.crm_upstream_runs (
  id uuid primary key default gen_random_uuid(),
  source mkt.data_source not null default 'csp360',
  external_id text not null,
  brand_id uuid references mkt.brands(id),            -- nulo: rodada que não é de uma marca
  run_trigger mkt.upstream_trigger not null,          -- cron | manual | script
  started_at timestamptz not null,
  finished_at timestamptz,
  is_ok boolean not null,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (source, external_id)
);
alter table mkt.crm_upstream_runs enable row level security;
create index if not exists crm_upstream_runs_started on mkt.crm_upstream_runs (brand_id, started_at desc);

-- ---------- Gatilhos ----------

create or replace trigger crm_funnels_updated_at before update on mkt.crm_funnels
  for each row execute function private.set_updated_at();
create or replace trigger crm_origin_map_updated_at before update on mkt.crm_origin_map
  for each row execute function private.set_updated_at();
create or replace trigger crm_customers_updated_at before update on mkt.crm_customers
  for each row execute function private.set_updated_at();
create or replace trigger crm_customer_brands_updated_at before update on mkt.crm_customer_brands
  for each row execute function private.set_updated_at();
create or replace trigger crm_customer_reps_updated_at before update on mkt.crm_customer_reps
  for each row execute function private.set_updated_at();
create or replace trigger crm_leads_updated_at before update on mkt.crm_leads
  for each row execute function private.set_updated_at();
create or replace trigger crm_orders_updated_at before update on mkt.crm_orders
  for each row execute function private.set_updated_at();
create or replace trigger crm_upstream_runs_updated_at before update on mkt.crm_upstream_runs
  for each row execute function private.set_updated_at();

-- Código LEAD- do lead do SDR, que não tem código no CRM (o negócio usa o NEG- de lá). Na releitura, o lead que já
-- existe fica com o mesmo código e a sequência não anda; o código que vier no insert é ignorado; e o código do SDR
-- nunca muda (o do negócio é o do CRM, que a releitura atualiza).
create or replace function private.crm_leads_code() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
begin
  if tg_op = 'UPDATE' then
    if old.kind = 'sdr' and new.code is distinct from old.code then
      raise sqlstate 'PT422' using message = 'COD-422';
    end if;
    return new;
  end if;

  if new.kind <> 'sdr' then
    return new;
  end if;
  select l.code into v_code
    from mkt.crm_leads l
   where l.source = new.source and l.kind = new.kind and l.external_id = new.external_id;
  if v_code is null then
    v_code := private.next_code('LEAD', 'mkt.lead_code_seq');
  end if;
  new.code := v_code;
  return new;
end $$;

create or replace trigger crm_leads_code before insert or update of code on mkt.crm_leads
  for each row execute function private.crm_leads_code();

-- ---------- Políticas (papeis-e-rls.md) ----------
-- Só leitura: authenticated pela permissão e o worker, que grava pelas funções ingest.*. O executor não lê a réplica
-- (RLS-34).

drop policy if exists crm_funnels_read on mkt.crm_funnels;
create policy crm_funnels_read on mkt.crm_funnels
  for select to authenticated using ((select authz.can('view_leads')));
drop policy if exists crm_funnels_worker_read on mkt.crm_funnels;
create policy crm_funnels_worker_read on mkt.crm_funnels
  for select to mkt_worker using (true);

drop policy if exists crm_origin_map_read on mkt.crm_origin_map;
create policy crm_origin_map_read on mkt.crm_origin_map
  for select to authenticated using ((select authz.can('view_leads')));
drop policy if exists crm_origin_map_worker_read on mkt.crm_origin_map;
create policy crm_origin_map_worker_read on mkt.crm_origin_map
  for select to mkt_worker using (true);

drop policy if exists crm_customers_read on mkt.crm_customers;
create policy crm_customers_read on mkt.crm_customers
  for select to authenticated using ((select authz.can('view_numbers')));
drop policy if exists crm_customers_worker_read on mkt.crm_customers;
create policy crm_customers_worker_read on mkt.crm_customers
  for select to mkt_worker using (true);

drop policy if exists crm_customer_brands_read on mkt.crm_customer_brands;
create policy crm_customer_brands_read on mkt.crm_customer_brands
  for select to authenticated using ((select authz.can('view_numbers')));
drop policy if exists crm_customer_brands_worker_read on mkt.crm_customer_brands;
create policy crm_customer_brands_worker_read on mkt.crm_customer_brands
  for select to mkt_worker using (true);

drop policy if exists crm_customer_reps_read on mkt.crm_customer_reps;
create policy crm_customer_reps_read on mkt.crm_customer_reps
  for select to authenticated using ((select authz.can('view_numbers')));
drop policy if exists crm_customer_reps_worker_read on mkt.crm_customer_reps;
create policy crm_customer_reps_worker_read on mkt.crm_customer_reps
  for select to mkt_worker using (true);

drop policy if exists crm_leads_read on mkt.crm_leads;
create policy crm_leads_read on mkt.crm_leads
  for select to authenticated using ((select authz.can('view_leads')));
drop policy if exists crm_leads_worker_read on mkt.crm_leads;
create policy crm_leads_worker_read on mkt.crm_leads
  for select to mkt_worker using (true);

drop policy if exists crm_orders_read on mkt.crm_orders;
create policy crm_orders_read on mkt.crm_orders
  for select to authenticated using ((select authz.can('view_numbers')));
drop policy if exists crm_orders_worker_read on mkt.crm_orders;
create policy crm_orders_worker_read on mkt.crm_orders
  for select to mkt_worker using (true);

drop policy if exists crm_upstream_runs_read on mkt.crm_upstream_runs;
create policy crm_upstream_runs_read on mkt.crm_upstream_runs
  for select to authenticated using ((select authz.can('view_connectors')));
drop policy if exists crm_upstream_runs_worker_read on mkt.crm_upstream_runs;
create policy crm_upstream_runs_worker_read on mkt.crm_upstream_runs
  for select to mkt_worker using (true);

-- ---------- Quem lê e quem executa ----------
-- authenticated já tem só select pelo privilégio padrão de mkt (migração 01). O worker, tabela por tabela.
grant select on mkt.crm_funnels, mkt.crm_origin_map, mkt.crm_customers, mkt.crm_customer_brands,
  mkt.crm_customer_reps, mkt.crm_leads, mkt.crm_orders, mkt.crm_upstream_runs
  to mkt_worker;

-- O gatilho ninguém chama: só o dono, pela tabela.
revoke all on function private.crm_leads_code() from public, anon, authenticated;

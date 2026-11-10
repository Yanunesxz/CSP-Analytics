# Dicionário de dados — tabelas do CSP-MKT

> Proposta da fase 3, para o dono aprovar. O SQL aqui é **rascunho**: ainda não é migração e não roda em lugar
> nenhum. A ordem das migrações e como reverter estão em [`plano.md`](plano.md); as listas fechadas usadas como
> tipo (`mkt.platform`, `mkt.operator`…) estão em [`listas.md`](listas.md); as políticas completas, em
> [`papeis-e-rls.md`](papeis-e-rls.md).

## Como ler

- Toda tabela tem também `id uuid primary key default gen_random_uuid()`, `created_at timestamptz not null default
  now()` e `updated_at timestamptz not null default date_trunc('milliseconds', now())`, com o gatilho
  `set_updated_at`. O `updated_at` fica em milissegundos para a trava otimista: o valor que a tela lê (texto no
  Supabase, `Date` no PGlite) volta igual. Para não repetir, essas três colunas não aparecem nos quadros (aparecem no
  SQL). A exceção é `profiles.id`, que é o id do login.
- **Quem grava:** `worker` = o worker de leitura em Python, com o papel Postgres `mkt_worker`; `executor` = o serviço
  que escreve nas plataformas, com o papel `mkt_executor` (decisão 0017); `função` = uma função `api.*` chamada pela
  tela, que confere o papel no banco; `script` = um script de configuração com `--executar`, pelas funções `setup.*`;
  `migração` = só por migração; `ninguém` = a linha nunca muda depois de criada.
- **RLS:** todas as tabelas têm RLS ligada. `anon` não lê nada. `authenticated` não tem `insert`, `update` nem
  `delete` em tabela nenhuma: toda escrita da tela passa por função (decisão 0013). O resumo de cada tabela diz
  qual permissão do `role_permissions` libera a leitura (`view_numbers`, `view_leads`, `view_traffic`…).
- **Marca:** `brand_id uuid not null` em tabela de fato. Tabelas de trilha ou de operação aceitam `brand_id` nulo
  com o sentido "as duas marcas" ou "não é de marca" (decisão 0014).

## Peças comuns

```sql
-- Esquemas (decisão 0013). Só "api" fica na lista de esquemas expostos do PostgREST.
create schema if not exists mkt;
create schema if not exists api;
create schema if not exists authz;     -- as funções que as políticas chamam (papeis-e-rls.md)
create schema if not exists ingest;
create schema if not exists notify;
create schema if not exists private;
create schema if not exists setup;     -- cadastro pelos scripts de configuração

-- Domain, tipo, papel e restrição: criados só se ainda não existem (o Postgres não tem "if not exists" para eles).
-- Domain nunca é apagado: mudar a lista é "alter domain" (listas.md).
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'mkt' and t.typname = 'campaign_status') then
    create domain mkt.campaign_status as text check (value in ('active', 'paused', 'ended'));
  end if;
end $$;

-- updated_at por gatilho, em toda tabela (em milissegundos, para a trava otimista)
create or replace function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := date_trunc('milliseconds', now());
  return new;
end $$;

-- Dia de São Paulo de um instante. É immutable (o fuso é fixo no nome), então serve em índice.
-- Fica na migração 01 porque os índices de crm_orders (migração 05) usam.
create or replace function mkt.sp_day(p timestamptz) returns date
language sql immutable parallel safe set search_path = '' as $$
  select (p at time zone 'America/Sao_Paulo')::date
$$;

-- Chave de casamento da UTM com a campanha (decisão 0009): minúsculas, espaços simples, sem espaço nas pontas.
-- A mesma função normaliza o nome da campanha e a utm_campaign do lead.
create or replace function mkt.utm_key(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select nullif(lower(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'))), '')
$$;

-- Barra dado pessoal em texto livre que vai para o Claude ou para a trilha:
-- e-mail, telefone com DDD (com ou sem máscara), CPF e CNPJ. "\y" é o limite de palavra do Postgres (o "\b" da tela):
-- um id de campanha de 18 dígitos ou um "act_…" não parecem telefone nem documento.
create or replace function mkt.has_personal_data(p text) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(p, '') ~ '[[:alnum:]_.+-]+@[[:alnum:]_-]+\.[[:alnum:]_.]+'                 -- e-mail
      or coalesce(p, '') ~ '\(?\y[0-9]{2}\)?\s?9?[0-9]{4}[-\s]?[0-9]{4}\y'                  -- telefone com DDD
      or coalesce(p, '') ~ '\y[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2}\y'                    -- CPF
      or coalesce(p, '') ~ '\y[0-9]{2}\.?[0-9]{3}\.?[0-9]{3}/?[0-9]{4}-?[0-9]{2}\y'          -- CNPJ
$$;

-- Código humano PREFIXO-0001 por sequência no banco (seção 9 do padrão). O lpad nunca corta: o 10.000º é LEAD-10000.
create sequence if not exists mkt.lead_code_seq;
create sequence if not exists mkt.sales_rep_code_seq;
create sequence if not exists mkt.traffic_action_code_seq;
create or replace function private.next_code(p_prefix text, p_seq regclass) returns text
language sql volatile set search_path = '' as $$
  select p_prefix || '-' || lpad(s.n::text, greatest(4, length(s.n::text)), '0')
    from (select nextval(p_seq) as n) s
$$;
```

`mkt.has_personal_data` é a única regra de dado pessoal em texto livre: a tela confere o texto antes de enviar
chamando `api.check_text`, que usa esta função, e o banco recusa de novo no `check` (decisão 0018; a `temDadoPessoal`
sai do TypeScript). Ela vale só para texto livre (título, motivo, nota, estratégia, prompt): num `jsonb` com ids, um
número longo pareceria telefone. Para `jsonb` valem funções que aceitam só as chaves previstas
(`mkt.valid_action_params`, `mkt.valid_claude_context`, `mkt.valid_notice_payload`, `mkt.valid_saved_filters`,
`mkt.valid_activity_details`, `mkt.valid_audit_changes`). Casos de teste da função: recusa e-mail, telefone com e sem
máscara, CPF e CNPJ; deixa passar um id de campanha de 18 dígitos (`campanha 120200000000000000`) e um id de conta
`act_…`. Casos de `private.next_code`: 9999 → `LEAD-9999` e 10000 → `LEAD-10000` (o mesmo que o `codigo()` de
`rules.ts` dá enquanto existir).

---

## 1. Dimensões

### `brands` — marcas do grupo

Uma linha por marca (decisão 0003). Uma terceira marca é uma linha nova, sem mudança de estrutura.

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `code` | `mkt.brand_code` | não | — | `cs` ou `plumene`; é o valor de `?marca=` |
| `name` | `text` | não | — | Nome na tela ("Corpo Sensual", "Plumene") |
| `source` | `mkt.data_source` | não | `'csp360'` | Sistema dono do cadastro |
| `external_id` | `text` | sim | — | `marcas.id` no CRM; o worker preenche na primeira leitura, pela sigla |

- **Chaves:** PK `id`; únicas `code` e `(source, external_id)`.
- **Grava:** migração (as duas linhas, sem `external_id`) e worker (só `external_id` e `name`).
- **RLS:** lê quem tem `view_numbers`. Ninguém grava pela API.

```sql
create table if not exists mkt.brands (
  id uuid primary key default gen_random_uuid(),
  code mkt.brand_code not null unique,
  name text not null check (length(name) between 2 and 60),
  source mkt.data_source not null default 'csp360',
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (source, external_id)
);
```

### `ad_accounts` — contas de anúncio por plataforma e marca

Uma linha por conta (Meta `act_…`, anunciante TikTok, cliente Google Ads). A marca vem da conta, porque cada marca
tem a sua conta em cada plataforma (suposição da Parte 4 do prompt; se uma conta for das duas marcas, a marca passa a
vir do nome da campanha, com decisão nova).

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `brand_id` | `uuid` | não | — | Marca da conta |
| `platform` | `mkt.platform` | não | — | `meta`, `tiktok` ou `google` |
| `source` | `mkt.data_source` | não | — | `meta_ads`, `tiktok_ads` ou `google_ads` |
| `external_id` | `text` | não | — | Id da conta na plataforma, como texto |
| `name` | `text` | não | — | Nome da conta na plataforma |
| `currency` | `text` | não | `'BRL'` | Só real; conta em outra moeda é recusada na entrada |
| `time_zone` | `text` | não | `'America/Sao_Paulo'` | Fuso da conta, lido da plataforma; outro fuso gera aviso na tela |
| `is_active` | `boolean` | não | `true` | Falso quando a conta some ou é desligada |
| `last_seen_at` | `timestamptz` | sim | — | Última leitura que viu a conta |
| `spend_cap_cents` | `bigint` | sim | — | Só Meta: o `spend_cap` da conta, lido pelo worker na releitura diária; nulo = sem teto (a Meta devolve `0` para a conta sem teto, e o worker grava nulo) |
| `amount_spent_cents` | `bigint` | sim | — | Só Meta: o `amount_spent` da conta na mesma leitura, o gasto contado no teto desde a última gravação com `reset`; serve para comparar a sobra do teto com a sobra do limite do mês |
| `first_read_at` | `timestamptz` | sim | — | Primeira leitura que trouxe dado desta conta; nunca volta a nulo. Diz se a marca tem base no canal ("Sem dados" × 0) |

- **Chaves:** PK `id`; únicas `(source, external_id)` e `(id, brand_id, platform)` (alvo das chaves compostas
  das tabelas filhas, que garantem a mesma marca e plataforma da conta).
- **Grava:** script (`scripts/configurar-contas.mjs --executar`, por `setup.register_ad_account`, que cadastra a conta
  com a marca, coisa que só o dono sabe) e worker (nome, moeda, fuso, `is_active`, `last_seen_at`, `first_read_at` e,
  na Meta, `spend_cap_cents` e `amount_spent_cents`).
  Conta que o token vê e não está cadastrada é ignorada ([`integracoes.md`](integracoes.md)). **RLS:** lê
  `view_numbers`.

```sql
create table if not exists mkt.ad_accounts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references mkt.brands(id),
  platform mkt.platform not null,
  source mkt.data_source not null check (source in ('meta_ads', 'tiktok_ads', 'google_ads')),
  external_id text not null,
  name text not null,
  currency text not null default 'BRL' check (currency = 'BRL'),
  time_zone text not null default 'America/Sao_Paulo',
  is_active boolean not null default true,
  last_seen_at timestamptz,
  spend_cap_cents bigint check (spend_cap_cents > 0),   -- o 0 da Meta (sem teto) entra nulo
  amount_spent_cents bigint check (amount_spent_cents >= 0),
  first_read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (source, external_id),
  unique (id, brand_id, platform),
  check (platform = 'meta' or (spend_cap_cents is null and amount_spent_cents is null))
);
```

### `campaigns` — campanhas, com o operador (decisão 0008)

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `ad_account_id` | `uuid` | não | — | Conta da campanha |
| `brand_id` | `uuid` | não | — | Marca (igual à da conta, por chave composta) |
| `platform` | `mkt.platform` | não | — | Plataforma (igual à da conta) |
| `source` | `mkt.data_source` | não | — | `meta_ads`, `tiktok_ads` ou `google_ads` (a campanha que vem do CSV já leva a fonte da plataforma: assim a API a reconhece depois, sem duplicar) |
| `external_id` | `text` | não | — | Id da campanha na plataforma |
| `name` | `text` | não | — | Nome na plataforma; pela convenção da decisão 0009, é a `utm_campaign` dos anúncios |
| `utm_campaign_key` | `text` | sim | gerada | `mkt.utm_key(name)`: a chave que casa com a UTM do lead |
| `managed_by` | `mkt.operator` | não | `'human'` | Quem opera: `human` ou `claude`. Importada sem dono nasce `human` |
| `status` | `mkt.campaign_status` | não | — | `active`, `paused` ou `ended`, convertido do status efetivo da plataforma |
| `daily_budget_cents` | `bigint` | sim | — | Orçamento diário; nulo quando o orçamento fica no conjunto ou grupo de anúncios, ou quando é compartilhado com outras campanhas (Google) |
| `spend_cap_cents` | `bigint` | sim | — | Teto que a plataforma tem na campanha (informação; o limite do CSP-MKT fica em `spend_limits`) |
| `is_smart_plus` | `boolean` | não | `false` | Campanha Smart+ do TikTok, que muda de status por outra chamada ([`integracoes.md`](integracoes.md), seção 14) |
| `created_by_action_id` | `uuid` | sim | — | A ação de tráfego que criou a campanha (o Claude só cria pela central) |
| `source_created_at` | `timestamptz` | sim | — | Criação na plataforma |
| `last_seen_at` | `timestamptz` | sim | — | Última leitura que viu a campanha |

- **Chaves:** PK `id`; única `(source, external_id)`; únicas `(id, brand_id)` e `(id, brand_id, platform)` (alvo das
  chaves compostas das tabelas filhas); estrangeira composta
  `(ad_account_id, brand_id, platform)` → `ad_accounts`; `created_by_action_id` → `traffic_actions`, `on delete set
  null` (criada na migração do tráfego, que vem depois).
- **Índices:** `(utm_campaign_key, brand_id)` não único: o casamento da UTM filtra pela chave. O mesmo nome na mesma
  marca deixa a UTM repetida, e a atribuição não escolhe uma das campanhas (regra em [`metricas.md`](metricas.md), seção
  3.2); `(brand_id, status)`.
- **Gatilhos:** `campaigns_managed_by_guard` (antes de `update`: `managed_by` só muda dentro de
  `api.change_campaign_operator`, que liga `mkt.allow_operator_change` na transação, com `session_user =
  'authenticator'` e `authz.can('configure_traffic')`; o worker e o executor nunca mudam o operador por `update`) e
  `campaigns_managed_by_audit` (depois de `insert` e de `update of managed_by`: grava `campaign_managed_by_history`).
- **Campanha criada pela central:** nasce `claude` já na inserção, por um de dois caminhos, nunca por `update`: o
  executor grava a campanha, com `created_by_action_id` e `managed_by = 'claude'`, na mesma transação que confirma a
  execução (`ingest.update_execution`); ou `ingest.upsert_campaigns`, ao inserir campanha cujo nome termina com o
  código de uma ação `create` aprovada, com execução `sent` ou `confirmed` na mesma conta, grava `managed_by = 'claude'`
  e a ação. Fora disso, campanha nova nasce `human`.
- **Grava:** worker (tudo menos `managed_by` depois de criada), executor (o status relido e a campanha criada pela
  central) e a função de troca de operador.
- **RLS:** lê `view_numbers`.
- **Status:** a tela não muda o status. Pausar, reativar e "Parar tudo" viram execução na plataforma
  (`platform_executions`); o status muda quando a releitura confirmar.

```sql
create table if not exists mkt.campaigns (
  id uuid primary key default gen_random_uuid(),
  ad_account_id uuid not null,
  brand_id uuid not null,
  platform mkt.platform not null,
  source mkt.data_source not null check (source in ('meta_ads', 'tiktok_ads', 'google_ads')),
  external_id text not null,
  name text not null,
  utm_campaign_key text generated always as (mkt.utm_key(name)) stored,
  managed_by mkt.operator not null default 'human',
  status mkt.campaign_status not null,
  daily_budget_cents bigint check (daily_budget_cents >= 0),
  spend_cap_cents bigint check (spend_cap_cents >= 0),
  is_smart_plus boolean not null default false check (not is_smart_plus or platform = 'tiktok'),
  created_by_action_id uuid,
  source_created_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (source, external_id),
  unique (id, brand_id),
  unique (id, brand_id, platform),
  foreign key (ad_account_id, brand_id, platform) references mkt.ad_accounts (id, brand_id, platform)
);
create index if not exists campaigns_utm on mkt.campaigns (utm_campaign_key, brand_id);
create index if not exists campaigns_brand_status on mkt.campaigns (brand_id, status);
```

### `campaign_managed_by_history` — troca de operador

Uma linha por troca de mão (decisão 0008: quem, quando, por quê). O nome fica no singular, como
`order_status_history` do padrão; a 0008 escreveu `campaigns_managed_by_history`.

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `campaign_id` | `uuid` | não | — | Campanha |
| `from_operator` | `mkt.operator` | sim | — | Operador anterior; nulo na criação |
| `to_operator` | `mkt.operator` | não | — | Operador novo |
| `reason` | `mkt.operator_change_reason` | não | — | `imported`, `created_by_claude`, `handover_to_claude`, `back_to_human`, `correction`, `other` |
| `note` | `text` | sim | — | Obrigatória com `other`; 10 a 500 letras, sem dado pessoal |
| `actor_kind` | `mkt.actor_kind` | não | — | `user`, `claude` ou `system` |
| `changed_by` | `uuid` | sim | — | Pessoa (`profiles`), quando `actor_kind = 'user'` |
| `changed_at` | `timestamptz` | não | `now()` | Quando |

- **Grava:** só o gatilho de `campaigns`. Ninguém altera nem apaga (gatilho de só-acréscimo).
- **RLS:** lê `view_traffic`.

```sql
create table if not exists mkt.campaign_managed_by_history (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references mkt.campaigns(id),
  from_operator mkt.operator,
  to_operator mkt.operator not null,
  reason mkt.operator_change_reason not null,
  note text check (note is null or (length(note) between 10 and 500 and not mkt.has_personal_data(note))),
  actor_kind mkt.actor_kind not null,
  changed_by uuid references mkt.profiles(id),
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  check (reason <> 'other' or note is not null),
  check ((actor_kind = 'user') = (changed_by is not null))
);
create index if not exists campaign_managed_by_history_campaign
  on mkt.campaign_managed_by_history (campaign_id, changed_at desc);
```

### `sales_reps` e `sales_rep_app_logins` — representantes, sem nome

Dimensão compartilhada (sem marca). O CSP-MKT dá a cada pessoa um código `REP-0001` próprio; o nome fica no CRM
(decisão 0025). Uma pessoa pode ter um login de app em cada marca.

`sales_reps`:

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `code` | `text` | não | `REP-0001` | Código mostrado na tela, por sequência |
| `source` | `mkt.data_source` | não | `'csp360'` | Sistema de origem |
| `external_id` | `text` | sim | — | `usuarios.id` do CRM; nulo para quem só tem login de app |
| `crm_role` | `mkt.rep_crm_role` | sim | — | `manager`, `supervisor`, `internal_seller`, `field_rep`, `customer_service` (atendimento). Papel do CRM fora da lista entra nulo, sem derrubar a rodada (decisão 0041, item 8) |
| `is_active` | `boolean` | não | `true` | Ativo no CRM |
| `last_seen_at` | `timestamptz` | sim | — | Última leitura |

`sales_rep_app_logins`:

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `sales_rep_id` | `uuid` | não | — | Representante |
| `brand_id` | `uuid` | não | — | Marca do app |
| `app_login_key` | `text` | não | — | Resumo HMAC-SHA256 do login no app daquela marca, com o segredo `REP_LOGIN_HMAC_KEY` do worker. O login em claro nunca é gravado nem vai para o log (pode ser e-mail, documento ou nome) |

- **Chaves:** `sales_reps`: única `code`, única `(source, external_id)`. `sales_rep_app_logins`: única
  `(brand_id, app_login_key)`; `sales_rep_id` → `sales_reps`, `on delete cascade`.
- **Gatilho:** `sales_reps_code` (antes de `insert`, preenche `code` com `private.next_code('REP',
  'mkt.sales_rep_code_seq')`). O código nunca muda. `ingest.upsert_sales_reps` atualiza primeiro o que existe
  (`update … from`) e depois insere só o que é novo (`insert … where not exists … on conflict do nothing`): a sequência
  anda só com linha nova (no `insert … on conflict do update`, o gatilho de `insert` roda também na linha que já existe
  e gastaria um número a cada releitura).
- **Grava:** worker. **RLS:** lê `view_numbers`.

```sql
create table if not exists mkt.sales_reps (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  source mkt.data_source not null default 'csp360',
  external_id text,
  crm_role mkt.rep_crm_role,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (source, external_id)
);

create table if not exists mkt.sales_rep_app_logins (
  id uuid primary key default gen_random_uuid(),
  sales_rep_id uuid not null references mkt.sales_reps(id) on delete cascade,
  brand_id uuid not null references mkt.brands(id),
  app_login_key text not null check (app_login_key ~ '^[0-9a-f]{64}$'),   -- resumo HMAC-SHA256, nunca o login
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (brand_id, app_login_key)
);
```

### `ig_accounts` — perfis do Instagram

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `brand_id` | `uuid` | não | — | Marca do perfil |
| `source` | `mkt.data_source` | não | `'instagram'` | — |
| `external_id` | `text` | não | — | `ig_user_id` |
| `username` | `text` | não | — | O @ do perfil da marca |
| `is_active` | `boolean` | não | `true` | — |
| `first_read_at` | `timestamptz` | sim | — | Primeira leitura que trouxe dado do perfil; nunca volta a nulo (base de "Sem dados" × 0) |

- **Chaves:** única `(source, external_id)`; única `(id, brand_id)`. **Grava:** script
  (`scripts/configurar-contas.mjs --executar`, por `setup.register_ig_account`, que cadastra o perfil com a marca e o
  @) e worker (`username`, `is_active`, `first_read_at`); perfil que o token vê e não está cadastrado é ignorado.
  **RLS:** lê `view_numbers`.

```sql
create table if not exists mkt.ig_accounts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references mkt.brands(id),
  source mkt.data_source not null default 'instagram',
  external_id text not null,
  username text not null,
  is_active boolean not null default true,
  first_read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (source, external_id),
  unique (id, brand_id)
);
```

### `web_properties` — propriedades do GA4 e do Search Console

Uma linha por propriedade GA4 e por propriedade do Search Console, de cada marca. Substitui as variáveis
`GA4_PROPERTY_ID_*` e `GSC_SITE_*` do `.env.example`, que não são segredo.

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `brand_id` | `uuid` | não | — | Marca do site |
| `kind` | `mkt.web_property_kind` | não | — | `ga4_property` ou `gsc_site` |
| `source` | `mkt.data_source` | não | — | `ga4` ou `search_console` |
| `external_id` | `text` | não | — | Id da propriedade GA4, ou o endereço da propriedade no Search Console |
| `host` | `text` | não | — | Domínio do site, sem `www` |
| `is_active` | `boolean` | não | `true` | — |
| `first_read_at` | `timestamptz` | sim | — | Primeira leitura que trouxe dado da propriedade; nunca volta a nulo (base de "Sem dados" × 0) |

- **Chaves:** única `(source, external_id)`; única `(id, brand_id)`.
- **Grava:** script (`scripts/configurar-sites.mjs --executar`, por `setup.register_web_property`; configuração do
  dono) e worker (`first_read_at`). **RLS:** lê `view_numbers`.

```sql
create table if not exists mkt.web_properties (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references mkt.brands(id),
  kind mkt.web_property_kind not null,
  source mkt.data_source not null check (source in ('ga4', 'search_console')),
  external_id text not null,
  host text not null check (host = lower(host) and host !~ '^www\.'),
  is_active boolean not null default true,
  first_read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (source, external_id),
  unique (id, brand_id),
  check ((kind = 'ga4_property') = (source = 'ga4'))
);
```

---

## 2. Réplica do CSP 360 (decisões 0006, 0012, 0014, 0015, 0041 e 0042)

Regras de todas as tabelas `crm_*`:

- Só id, marca, datas, situação, origem e UTM, representante (por id) e a chave de junção `clientes.id`. Nunca nome,
  telefone, e-mail, documento, endereço ou texto livre de pessoa. O documento não vem: a junção já é `clientes.id`.
- `source = 'csp360'` e `external_id` = o id da linha no CRM. O `id` daqui é gerado no CSP-MKT.
- O que vem em português do CRM é convertido na entrada (status, situação) para as listas em inglês.
- **O CRM como ele é:** o que esta seção diz do CRM foi conferido no código do CRM em 10/11/2026; nada foi lido do
  banco. O que o CRM não entrega fica nulo aqui e "Sem dados" na tela, sem valor inventado (decisão 0041, item 6).
- **UTM que vem do CRM** (`utm_source`, `utm_medium`, `utm_campaign`): vem do endereço do formulário público, onde
  qualquer pessoa escreve o que quiser, e ferramentas de e-mail podem pôr ali o e-mail do assinante. Entra cortada em
  150 letras. Na função `ingest.*`, vira nulo o valor com `@` ou que `mkt.has_personal_data` marque; em `utm_campaign`
  vale só o teste do `@`, para não perder nome de campanha com número. A rodada conta `PERSONAL_DATA_DROPPED` em
  `sync_runs`. Cada tabela leva o mesmo teste num `check` (`mkt.valid_crm_text`), como última barreira. `utm_term` e
  `utm_content` não entram: nenhuma conta usa (regra 6).
- **Origem do negócio** (`negocios.origem`: a `utm_source` do site ou "site", um valor da lista da tela do CRM,
  "SDR WhatsApp" na conversão do SDR ou o texto de uma importação antiga): não é gravada como veio.
  `ingest.upsert_crm_leads` guarda em `crm_origin_raw` só o valor normalizado (minúsculas, sem espaço nas pontas) que
  está em `crm_origin_map`, que é uma fonte de UTM conhecida da classificação (`mkt.is_known_origin_text`, a mesma
  lista de `mkt.classify_lead_origin`) ou que é igual à `utm_source` de primeiro contato do cliente, já replicada e
  limpa (é o que liga o negócio do site à UTM dele, [`metricas.md`](metricas.md), seção 3.2). Outro texto vira nulo e
  o lead fica com `is_origin_unmapped = true`. Valor novo é conferido no CSP 360 e entra no de-para por migração.
- **O texto já vem limpo do CRM:** a view entrega a origem do negócio e as três UTMs sem espaço nas pontas, cortadas
  em 150 letras e nulas quando vazias ou quando parecem e-mail, telefone, CPF ou CNPJ (na campanha, número solto
  passa, porque é o id da campanha). A origem vem sem o trecho de nome de representante que as listas de reativação
  gravaram, e o nome de funil com dado pessoal vem trocado por um rótulo. O teste daqui continua, como segunda
  barreira: o que a view já tirou não entra na contagem `PERSONAL_DATA_DROPPED` nem vira origem sem de-para.
- `last_seen_at` = última leitura que viu a linha. A passada completa diária apaga a linha que sumiu do CRM, sem
  cópia (decisão 0015).
- **Grava:** worker, sempre pelas funções `ingest.*` (o de-para `crm_origin_map`, só por migração). **RLS:** lê quem
  tem `view_leads` (leads, funis, de-para), `view_connectors` (`crm_upstream_runs`) ou `view_numbers` (o resto).
  Ninguém grava pela API.

```sql
-- Última barreira para a UTM que vem do CRM (a função ingest.* já limpou antes). Fica na migração 01.
create or replace function mkt.valid_crm_text(p text, p_is_campaign boolean default false) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select p is null or (length(p) <= 150 and strpos(p, '@') = 0
                       and (p_is_campaign or not mkt.has_personal_data(p)))
$$;
```

### `crm_funnels` — funis de venda do CRM

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `source`, `external_id` | `mkt.data_source`, `text` | não | `'csp360'` | `funis_venda.id` |
| `name` | `text` | não | — | Nome do funil |
| `is_default` | `boolean` | não | `false` | Funil padrão no CRM |
| `is_lead_funnel` | `boolean` | não | `false` | É funil de leads: o funil padrão do CRM e o funil antigo dos leads do site. Mais de um pode ser verdadeiro (decisão 0041, item 1) |
| `last_seen_at` | `timestamptz` | sim | — | — |

- **Funil de leads** (decisão 0041, item 1): são dois, o funil padrão do CRM e o funil antigo dos leads do site. O
  lead do site nasce no funil padrão desde 05/11/2026; os negócios abertos do funil antigo foram movidos para ele com
  o mesmo id, e os encerrados ficaram no funil antigo. Negócio sem funil no CRM conta como do funil padrão. Não há
  mais trava de um só funil de leads.
- **Grava:** worker (nome e padrão; no funil padrão, `is_lead_funnel` segue `is_default` na ingestão) e script (uma
  função `setup.*` marca uma vez, pelo id, o funil antigo dos leads do site, para o histórico encerrado entrar). Quando
  o funil de leads muda (o CRM troca o funil padrão, ou o funil antigo é marcado), a próxima passada completa refaz
  `crm_leads`.
- **Em aberto** (decisão 0041): o funil padrão é o funil de vendas do time comercial, e nele também há negócio aberto
  à mão. O negócio aberto à mão com a origem "Carteira" ou "Prospecção ativa" conta como lead? O dono decide antes da
  primeira carga. Até lá, ele entra em `crm_leads` e a origem aparece na pendência de origem sem de-para da tela de
  Leads.

```sql
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
-- Sem índice único em is_lead_funnel: os funis de leads são o padrão e o antigo dos leads do site (decisão 0041).
```

### `crm_origin_map` — de-para da origem do negócio

`negocios.origem` no CRM é texto, sem lista fechada no banco: a `utm_source` do site ou "site", um valor da lista da
tela do CRM, "SDR WhatsApp" na conversão do SDR ou o texto de uma importação antiga. Este de-para leva cada valor para
a origem do lead (`mkt.lead_origin`); `sdr whatsapp` vai para `sdr` (decisão 0041, item 3). Valor que não está aqui e
é uma fonte de UTM conhecida segue a regra da função de classificação (`mkt.classify_lead_origin`, em `metricas.md`);
o resto não é gravado (seção "Regras", acima).

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `raw_value` | `text` | não | — | Valor normalizado (minúsculas, sem espaço nas pontas) |
| `origin` | `mkt.lead_origin` | não | — | Origem do lead |

- **Grava:** migração. A migração 05 só leva valores genéricos (fonte de UTM, canal, rótulo do ClickUp), revistos antes
  do commit; texto com nome de pessoa nunca entra no repositório. **RLS:** lê `view_leads`.

```sql
create table if not exists mkt.crm_origin_map (
  id uuid primary key default gen_random_uuid(),
  raw_value text not null unique check (raw_value = lower(btrim(raw_value)) and raw_value <> ''),
  origin mkt.lead_origin not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now())
);
```

### `crm_customers` — clientes (sem marca)

Dimensão compartilhada: a base de clientes do CRM é uma só (decisão 0003).

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `source`, `external_id` | | não | `'csp360'` | `clientes.id`, chave da ficha 360 |
| `code` | `text` | não | — | `CLI-0001` do CRM |
| `crm_status` | `mkt.crm_customer_status` | não | — | `prospect`, `active` ou `inactive` (de `clientes.status`) |
| `is_known_by_erp` | `boolean` | não | `false` | O ERP conhece o cliente (`retrato_carregado`) |
| `has_app_owner` | `boolean` | não | `false` | Tem dono na carteira de algum app (`donos_app` não vazio) |
| `first_utm_source` | `text` | sim | — | UTM do primeiro contato, gravada pela função de leads do CRM (limpa na entrada, seção "Regras") |
| `first_utm_medium` | `text` | sim | — | idem |
| `first_utm_campaign` | `text` | sim | — | idem |
| `source_created_at` | `timestamptz` | não | — | `clientes.criado_em`. No cliente criado pela tela do CRM vem só o dia: o instante exatamente à meia-noite UTC é data pura (decisão 0041, item 5) |
| `last_seen_at` | `timestamptz` | não | — | — |

- **Chaves:** única `(source, external_id)`; índice em `code`.
- As três UTMs vêm da view `clientes_utm` do CRM, que só traz o cliente com pelo menos uma delas: quem não está na
  view fica com as três nulas. É a UTM de primeiro contato: o primeiro valor não vazio de cada campo, campo a campo,
  então as três podem vir de envios diferentes. Quem já é cliente ativo na hora do envio não recebe UTM no cadastro
  (fica só a origem do negócio), e o valor pode ser editado à mão no CRM. Só há UTM para quem entrou pelo site, desde
  09/09/2026. A view já entrega o valor limpo (seção "Regras").

```sql
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
create index if not exists crm_customers_code on mkt.crm_customers (code);
```

### `crm_customer_brands` — situação e última compra por marca

Uma linha por cliente e marca. A situação é a da régua do CRM, por marca; o CSP-MKT não recalcula a régua (decisão
0012). Em 10/11/2026 o CRM não a entrega: a régua só roda na tela de lá, sem SQL, e o perdido marcado à mão é coluna
do cliente (não é por marca) e não está nas views lidas. Enquanto for assim, `situation`, `is_lost_manual`,
`last_purchase_on` e `situation_computed_at` ficam nulas (decisão 0041, item 6) e a linha nasce só da view
`clientes_compras_marca`. A Base mostra quem comprou, com "Sem situação"; ativos, inativos e perdidos ficam "Sem
dados" ([`metricas.md`](metricas.md), seção 4.7).

O retrato do ERP (view `clientes_compras_marca`) é cópia do que o Control exportou para o app pela última vez; o CRM
só copia. Traz a última compra e o total de cerca de 24 meses; a primeira compra vem sempre nula. O retrato da marca é
trocado inteiro quando muda: a última compra anterior some. Ele pode incluir compra feita pelo app e já faturada, com
atraso. Por isso a réplica guarda a compra do ERP mais antiga que já viu (`erp_earliest_purchase_on`): a primeira
compra, quando o CRM a entregar; até lá, a menor última compra lida até hoje. Essa data nunca anda para a frente, e é
ela que a regra do histórico usa: o cliente não é novo na marca se ela é anterior ao dia do 1º pedido do CRM (decisão
0042, que também diz o que essa data não resolve).

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `customer_id` | `uuid` | não | — | Cliente |
| `brand_id` | `uuid` | não | — | Marca |
| `situation` | `mkt.customer_situation` | sim | — | `lead`, `active`, `inactive_recent`, `inactive_old`, `lost`; nulo = sem base, ou situação que o CRM não entrega |
| `is_lost_manual` | `boolean` | sim | — | Marcado como perdido à mão no CRM; nulo enquanto o CRM não entregar (decisão 0041, item 6) |
| `last_purchase_on` | `date` | sim | — | Última compra que a régua do CRM usou (CRM e retrato do ERP); nula enquanto o CRM não entregar a situação |
| `erp_first_purchase_on` | `date` | sim | — | Primeira compra na marca no retrato do ERP (campo `primeira_compra`). Vem sempre nula: o CRM não guarda a primeira compra |
| `erp_last_purchase_on` | `date` | sim | — | Última compra na marca no retrato do ERP, como veio na última leitura (campo `ultima_compra`). Anda para a frente quando o retrato muda |
| `erp_earliest_purchase_on` | `date` | sim | — | A compra do ERP mais antiga que a réplica já viu na marca. Só é trocada por uma data anterior. É a data da regra do histórico (decisões 0030 e 0042) |
| `erp_total_purchased_cents` | `bigint` | sim | — | Total comprado na marca no retrato do ERP, de cerca de 24 meses (campo `total_comprado`, em reais na origem, convertido para centavos na entrada; negativo ou fora do formato vem nulo). Só informação: não decide cliente novo (o total pode ter compra de depois do 1º pedido do CRM) |
| `situation_computed_at` | `timestamptz` | sim | — | Quando o CRM calculou a situação; nula enquanto o CRM não entregar a situação |
| `last_seen_at` | `timestamptz` | não | — | — |

```sql
create table if not exists mkt.crm_customer_brands (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references mkt.crm_customers(id) on delete cascade,
  brand_id uuid not null references mkt.brands(id),
  situation mkt.customer_situation,
  is_lost_manual boolean,                 -- nulo enquanto o CRM não entregar (decisão 0041)
  last_purchase_on date,
  erp_first_purchase_on date,
  erp_last_purchase_on date,
  erp_earliest_purchase_on date,          -- a mais antiga já vista; só troca por data anterior (decisão 0042)
  erp_total_purchased_cents bigint check (erp_total_purchased_cents >= 0),
  situation_computed_at timestamptz,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (customer_id, brand_id)
);
create index if not exists crm_customer_brands_brand on mkt.crm_customer_brands (brand_id, situation);
```

### `crm_customer_reps` — carteira por marca

Quem tem o cliente na carteira do app de cada marca (`donos_app`). Um cliente pode ter mais de um representante e
um por marca.

```sql
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
create index if not exists crm_customer_reps_rep on mkt.crm_customer_reps (sales_rep_id, brand_id);
```

### `crm_leads` — leads (negócios do funil de leads e leads do SDR)

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `source` | `mkt.data_source` | não | `'csp360'` | — |
| `kind` | `mkt.lead_kind` | não | — | `deal` (negócio do funil de leads) ou `sdr` (fila do SDR) |
| `external_id` | `text` | não | — | `negocios.id` ou `leads_sdr.id` |
| `code` | `text` | não | — | `NEG-0001` do CRM; para o SDR, que não tem código, `LEAD-0001` gerado aqui |
| `brand_id` | `uuid` | **sim** | — | Marca; nulo = "Sem marca" (lead do SDR, negócio sem marca; decisão 0014) |
| `customer_id` | `uuid` | sim | — | Cliente no CRM; nulo = "A cadastrar" |
| `crm_funnel_id` | `uuid` | sim | — | Funil do negócio; nulo no SDR. Negócio sem funil no CRM conta como do funil padrão (decisão 0041, item 1) |
| `crm_origin_raw` | `text` | sim | — | `negocios.origem` normalizado, só quando está no de-para ou é uma fonte de UTM conhecida; outro texto não é gravado (seção "Regras") |
| `is_origin_unmapped` | `boolean` | não | `false` | O negócio tinha origem no CRM, mas fora do de-para e das fontes conhecidas: a origem fica `referral` e a tela de Leads conta a pendência |
| `utm_source`, `utm_medium`, `utm_campaign` | `text` | sim | — | UTM do próprio lead. Nulas: o CRM não tem UTM por lead, e vale a de primeiro contato do cliente (decisões 0031 e 0041, item 6). Preenche quando o CRM passar a gravar por envio (lacuna 10 do levantamento do CRM); limpa na entrada |
| `referrer_host` | `text` | sim | — | Domínio de onde a pessoa veio. Nulo: o CRM não tem `referrer` por lead. Preenche quando o CRM passar a gravar (lacuna 9) |
| `assigned_rep_id` | `uuid` | sim | — | Quem recebeu o lead no CRM (`sales_reps`), pela view `negocios_responsavel`. Nulo quando o CRM não entrega o id ("Sem representante") e no lead do SDR |
| `source_created_at` | `timestamptz` | não | — | Quando o lead chegou (`criado_em` do CRM). No negócio aberto pela tela do CRM vem só o dia |
| `source_updated_at` | `timestamptz` | sim | — | `atualizado_em` do CRM. Não diz quando o CRM gravou |
| `last_seen_at` | `timestamptz` | não | — | — |

- **Chaves:** única `(source, kind, external_id)`; única `code`. `customer_id`, `crm_funnel_id` e `assigned_rep_id`
  com `on delete set null` (o que sai do CRM sai daqui sem travar a exclusão).
- **Índices:** `(brand_id, source_created_at)`, `(customer_id)`, `(assigned_rep_id)`, `(mkt.utm_key(utm_campaign))`.
- **Gatilho:** `crm_leads_code` (antes de `insert` com `kind = 'sdr'`, preenche `code` com
  `private.next_code('LEAD', 'mkt.lead_code_seq')`). `ingest.upsert_crm_leads` atualiza primeiro o que existe e
  depois insere só o que é novo, como em `sales_reps`: a sequência anda só com linha nova.
- **Quais negócios entram:** a leitura traz os negócios de todos os funis; `ingest.upsert_crm_leads` grava o que está
  num funil de leads (`crm_funnels.is_lead_funnel`: o funil padrão do CRM e o funil antigo dos leads do site) ou que
  já existe em `crm_leads`, e ignora o resto ([`integracoes.md`](integracoes.md), seção 3.4). O negócio sem funil no
  CRM conta como do funil padrão e entra: é como nasce o negócio da conversão do SDR (decisão 0041, item 1). O negócio
  aberto à mão no funil padrão também entra; se ele conta como lead está em aberto (decisão 0041).
- **Lead é o negócio** (decisão 0041, item 2): quem já tem negócio aberto no funil de leads e manda o formulário de
  novo não ganha negócio novo; o CRM anota o envio no que existe. O envio repetido não vira outro lead nem muda
  `source_created_at`, e por isso "Leads" pode ficar abaixo de "Leads informados pela plataforma". Quem já é cliente
  ativo e manda o formulário abre negócio no funil de leads: conta como lead e não ganha UTM. A chave do lead é o id
  do negócio (`external_id`): o código mostrado (`code`) pode ser reaproveitado no CRM depois de uma limpeza.
- **Responsável:** no CRM o responsável do negócio é o nome, em texto, e o nome nunca sai de lá. A view
  `negocios_responsavel` só devolve o id de `usuarios` quando o nome (sem espaço nas pontas, sem diferença de
  maiúscula) é de exatamente uma pessoa, de qualquer papel, ativa ou não. Nome repetido, desconhecido ou vazio: o
  negócio não vem na view e `assigned_rep_id` fica nulo. O lead do SDR não tem responsável.
- **Carimbos** (decisão 0041, itens 4 e 5): no negócio nenhum gatilho atualiza `atualizado_em`. A função dos sites
  grava o instante do envio; a tela do CRM grava `criado_em` e `atualizado_em` só com o dia (meia-noite UTC), ao criar
  e a cada edição; algumas ações não regravam o carimbo. Por isso a leitura de 5 min relê a janela de 3 dias, e a
  passada completa diária pega o resto. No dia do lead, o instante exatamente à meia-noite UTC é data pura: vale a
  data como está, sem converter para São Paulo. Os outros instantes convertem.
- **Não guarda** a etapa, o 1º pedido nem a origem classificada: são derivados em `mkt.v_leads` (decisão 0001; o
  protótipo grava `stage` e `source`). A view também resolve o lead do SDR que virou negócio (conta uma vez; a ligação
  entre os dois é o cliente, decisão 0041, item 3) e usa a UTM do primeiro contato do cliente quando o lead não tem a
  sua.

```sql
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
create index if not exists crm_leads_brand_created on mkt.crm_leads (brand_id, source_created_at);
create index if not exists crm_leads_customer on mkt.crm_leads (customer_id);
create index if not exists crm_leads_rep on mkt.crm_leads (assigned_rep_id);
create index if not exists crm_leads_utm on mkt.crm_leads (mkt.utm_key(utm_campaign));
```

### `crm_orders` — pedidos

Todos os status entram, para um pedido enviado e depois cancelado sair da conta. Faturado é carimbo, não status
(seção 9 do padrão): o `faturado` do CRM vira `status = 'sent'` com `is_invoiced = true`. O CRM só tem pedido que
nasceu nos apps: o pedido digitado direto no Control não chega, e o pedido apagado no app vira cancelado.

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `source`, `external_id` | | não | `'csp360'` | `pedidos.id` |
| `brand_id` | `uuid` | não | — | Marca do pedido |
| `customer_id` | `uuid` | sim | — | Cliente; nulo = "A vincular" (não conta para cliente novo até vincular) |
| `status` | `mkt.order_status` | não | — | `quote` (orçamento), `sent` (enviado, inclui o faturado), `cancelled` |
| `is_invoiced` | `boolean` | não | `false` | O CRM marcou como faturado |
| `invoiced_at` | `timestamptz` | sim | — | Nulo até o CRM gravar a data do faturado (lacuna 3) |
| `total_cents` | `bigint` | não | — | Soma dos itens (quantidade × preço) convertida para centavos na entrada, em decimal, como o prompt manda; troca por `pedidos.total` quando o CRM trouxer |
| `invoiced_total_cents` | `bigint` | sim | — | "Sem dados" até o Control abrir o faturamento (decisão 0004) |
| `sales_rep_id` | `uuid` | sim | — | Quem vendeu (`vendedor_app`) |
| `sent_at` | `timestamptz` | sim | — | Nulo até o CRM gravar a data de envio (lacuna 4) |
| `source_created_at` | `timestamptz` | não | — | Criação do pedido no app; é a data do pedido enquanto `sent_at` não existir |
| `source_updated_at` | `timestamptz` | sim | — | `atualizado_em` do CRM: é o relógio do app, pode ser nulo e pode chegar atrasado. Status ou cliente trocados à mão no CRM não o regravam; na leitura por janela, o pedido sem carimbo vale por `criado_em` (decisão 0041, item 4) |
| `last_seen_at` | `timestamptz` | não | — | — |

- **Índices:** as contas de pedido filtram e ordenam pelo dia de envio, `mkt.sp_day(coalesce(sent_at,
  source_created_at))` (VG5, `mkt.v_first_orders`, `mkt.v_customer_orders`), então os índices usam essa expressão, só
  nos pedidos enviados: `(brand_id, dia de envio)` e `(customer_id, brand_id, instante de envio)` (1º pedido por cliente
  e marca); e `(sales_rep_id)`. Por isso `mkt.sp_day` fica na migração 01.
- **Chaves:** `sales_rep_id` → `sales_reps`, `on delete set null`; `customer_id` → `crm_customers`, `on delete set
  null` (o pedido vira "A vincular").

```sql
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
create index if not exists crm_orders_brand_order_on
  on mkt.crm_orders (brand_id, (mkt.sp_day(coalesce(sent_at, source_created_at)))) where status = 'sent';
create index if not exists crm_orders_customer
  on mkt.crm_orders (customer_id, brand_id, (coalesce(sent_at, source_created_at))) where status = 'sent';
create index if not exists crm_orders_rep on mkt.crm_orders (sales_rep_id);
```

### `crm_upstream_runs` — rodadas apps → CSP 360

Cópia da última linha de `sincronizacoes` por marca, para o cartão do CSP 360 explicar atraso de pedido
(`upstreamLastRunAt` no protótipo).

```sql
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
create index if not exists crm_upstream_runs_started on mkt.crm_upstream_runs (brand_id, started_at desc);
```

- **RLS:** lê `view_connectors`. Guarda 90 dias (limpeza diária pelo `pg_cron`).

---

## 3. Mídia paga, Instagram, SEO, GEO e GA4 (snapshots)

Regras de todos os snapshots:

- A chave natural é a idempotência (`unique`): a leitura de hora em hora regrava o mesmo dia (`on conflict … do
  update`).
- **Releitura troca o dia inteiro:** numa transação, `ingest.replace_day` grava as linhas lidas e apaga as do mesmo
  dia e da mesma conta, perfil ou propriedade que não vieram (a plataforma deixa de devolver a linha de campanha sem
  número no dia; o GA4 muda origem, meio e canal enquanto o dia não fecha). Vale para `ad_campaign_daily` (por conta e
  dia, inclusive as linhas do CSV, porque a API vence), `ga4_traffic_daily` e `seo_query_daily` (por propriedade e
  dia). Só liga depois de a leitura trazer campanha apagada e arquivada ([`integracoes.md`](integracoes.md), seções 4 e
  7); senão a troca apagaria o gasto delas.
- `fetched_at` = quando o número foi lido. O dia (`metric_on`) é o que a plataforma informa (veja "Dia das
  plataformas" no [README](README.md)).
- Contagem sem sufixo (`impressions`, `clicks`, `sessions`), em `bigint`; dinheiro em `_cents`.
- **Grava:** worker, pelas funções `ingest.*` (inclusive o CSV, decisão 0016). **RLS:** lê `view_numbers`;
  `ad_activity_log`, `view_traffic`.

### `ad_campaign_daily` — gasto e resultado por campanha e dia

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `campaign_id` | `uuid` | não | — | Campanha |
| `brand_id` | `uuid` | não | — | Marca (igual à da campanha, por chave composta) |
| `platform` | `mkt.platform` | não | — | Plataforma (igual à da campanha) |
| `metric_on` | `date` | não | — | Dia do relatório, no fuso da conta |
| `spend_cents` | `bigint` | não | `0` | Investimento, convertido para centavos na entrada (Meta em reais, Google em micros, TikTok com 2 casas) |
| `impressions` | `bigint` | não | `0` | Impressões |
| `clicks` | `bigint` | não | `0` | Cliques |
| `platform_leads` | `bigint` | não | `0` | Leads que a plataforma informa ("Leads informados pela plataforma", decisão 0027); não é o lead do CSP 360 |
| `conversions` | `numeric(14,2)` | não | `0` | Conversões da plataforma (o Google entrega fração) |
| `conversion_value_cents` | `bigint` | não | `0` | Receita que a plataforma informa; 0 = sem rastreio de valor |
| `source` | `mkt.data_source` | não | — | Quem gravou por último: a API da plataforma ou `csv` |
| `fetched_at` | `timestamptz` | não | — | Quando foi lido |

- **Chaves:** única `(campaign_id, metric_on)`; estrangeira composta `(campaign_id, brand_id, platform)`.
- **Índices:** `(brand_id, metric_on)`, `(metric_on)`.
- **CSV × API:** a função `ingest.upsert_ad_campaign_daily` deixa a API regravar uma linha do CSV, e nunca o
  contrário (o CSV só cobre o tempo em que a API ainda não foi aprovada). Na releitura, a API troca o dia inteiro da
  conta, também as linhas que vieram do CSV.

```sql
create table if not exists mkt.ad_campaign_daily (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  brand_id uuid not null,
  platform mkt.platform not null,
  metric_on date not null,
  spend_cents bigint not null default 0 check (spend_cents >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  platform_leads bigint not null default 0 check (platform_leads >= 0),
  conversions numeric(14,2) not null default 0 check (conversions >= 0),
  conversion_value_cents bigint not null default 0 check (conversion_value_cents >= 0),
  source mkt.data_source not null check (source in ('meta_ads', 'tiktok_ads', 'google_ads', 'csv')),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (campaign_id, metric_on),
  foreign key (campaign_id, brand_id, platform) references mkt.campaigns (id, brand_id, platform)
);
create index if not exists ad_campaign_daily_brand_day on mkt.ad_campaign_daily (brand_id, metric_on);
create index if not exists ad_campaign_daily_day on mkt.ad_campaign_daily (metric_on);
```

### `ad_activity_log` — alterações feitas nas plataformas

Cópia diária do `activities` da Meta e do `change_event` do Google (decisão 0005): mostra o que mudou fora da
central. O TikTok não tem esse registro. Nunca guarda o nome de quem alterou, só se foi a credencial de escrita do
CSP-MKT.

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `ad_account_id`, `brand_id`, `platform` | | não | — | Conta (chave composta) |
| `campaign_id` | `uuid` | sim | — | Campanha, quando a alteração é numa campanha conhecida |
| `source`, `external_id` | | não | — | `meta_ads` ou `google_ads` + id do evento na plataforma |
| `occurred_at` | `timestamptz` | não | — | Quando a alteração aconteceu |
| `change_kind` | `text` | não | — | Tipo da alteração, como a plataforma chama |
| `is_by_csp_mkt` | `boolean` | não | — | Feita pela credencial de escrita do CSP-MKT |
| `details` | `jsonb` | não | `'{}'` | Só o tipo do objeto, o id, o campo, o valor antigo e o valor novo; conferido por `mkt.valid_activity_details` |

- Só entram eventos de campanha, conjunto, anúncio e limite de gasto da conta. Eventos de usuário, papel e cobrança
  ficam fora, porque o objeto pode ser uma pessoa; nunca `object_name` nem `actor_*`.
- **RLS:** lê `view_traffic`. Guarda 13 meses.

```sql
create table if not exists mkt.ad_activity_log (
  id uuid primary key default gen_random_uuid(),
  ad_account_id uuid not null,
  brand_id uuid not null,
  platform mkt.platform not null,
  campaign_id uuid references mkt.campaigns(id),
  source mkt.data_source not null check (source in ('meta_ads', 'google_ads')),
  external_id text not null,
  occurred_at timestamptz not null,
  change_kind text not null check (change_kind ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  is_by_csp_mkt boolean not null,
  details jsonb not null default '{}' check (mkt.valid_activity_details(change_kind, details)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (source, external_id),
  foreign key (ad_account_id, brand_id, platform) references mkt.ad_accounts (id, brand_id, platform)
);
create index if not exists ad_activity_log_account_time on mkt.ad_activity_log (ad_account_id, occurred_at desc);
```

### `ig_account_daily` — perfil do Instagram por dia

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `ig_account_id`, `brand_id` | `uuid` | não | — | Perfil (chave composta) |
| `metric_on` | `date` | não | — | Dia da API |
| `followers_count` | `bigint` | sim | — | Seguidores no fim do dia (o último retrato do dia, do campo `followers_count` do perfil) |
| `reach` | `bigint` | sim | — | Alcance do dia |
| `views` | `bigint` | sim | — | Visualizações do dia: a API trocou `impressions` por `views` em 2025, então "impressões" não existe mais na fonte |
| `total_interactions` | `bigint` | sim | — | Interações do dia (o "engajamento" do protótipo) |
| `fetched_at` | `timestamptz` | não | — | — |

- Nulo = a API não devolveu aquela métrica no dia (diferente de 0). **Chave:** única `(ig_account_id, metric_on)`.
- O rótulo da tela ("Impressões" ou "Visualizações") e o alcance somado por dia são decisões de métrica, em
  `metricas.md`.

```sql
create table if not exists mkt.ig_account_daily (
  id uuid primary key default gen_random_uuid(),
  ig_account_id uuid not null,
  brand_id uuid not null,
  metric_on date not null,
  followers_count bigint check (followers_count >= 0),
  reach bigint check (reach >= 0),
  views bigint check (views >= 0),
  total_interactions bigint check (total_interactions >= 0),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (ig_account_id, metric_on),
  foreign key (ig_account_id, brand_id) references mkt.ig_accounts (id, brand_id)
);
```

### `ig_media` e `ig_media_daily` — posts e o retrato diário de cada post

As métricas de post são acumuladas e continuam crescendo: o worker tira um retrato por dia (72 h de hora em hora,
depois 1×/dia até 30 dias). A tela usa o retrato mais recente.

`ig_media`:

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `ig_account_id`, `brand_id` | `uuid` | não | — | Perfil |
| `source`, `external_id` | | não | `'instagram'` | `ig_media_id` |
| `media_type` | `mkt.ig_media_type` | não | — | `image`, `video`, `carousel`, `reel` |
| `published_at` | `timestamptz` | não | — | Publicação |
| `caption_excerpt` | `text` | sim | — | Começo da legenda, até 120 letras |
| `permalink` | `text` | sim | — | Link do post (o protótipo não tinha) |

`ig_media_daily`:

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `ig_media_id`, `brand_id` | `uuid` | não | — | Post |
| `captured_on` | `date` | não | — | Dia (São Paulo) do retrato |
| `reach`, `views`, `likes`, `comments`, `saves`, `shares`, `total_interactions` | `bigint` | sim | — | Valores acumulados até o retrato; `shares` é novo em relação ao protótipo |
| `fetched_at` | `timestamptz` | não | — | — |

```sql
create table if not exists mkt.ig_media (
  id uuid primary key default gen_random_uuid(),
  ig_account_id uuid not null,
  brand_id uuid not null,
  source mkt.data_source not null default 'instagram',
  external_id text not null,
  media_type mkt.ig_media_type not null,
  published_at timestamptz not null,
  caption_excerpt text check (length(caption_excerpt) <= 120),
  permalink text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (source, external_id),
  unique (id, brand_id),
  foreign key (ig_account_id, brand_id) references mkt.ig_accounts (id, brand_id)
);
create index if not exists ig_media_brand_published on mkt.ig_media (brand_id, published_at);

create table if not exists mkt.ig_media_daily (
  id uuid primary key default gen_random_uuid(),
  ig_media_id uuid not null,
  brand_id uuid not null,
  captured_on date not null,
  reach bigint check (reach >= 0),
  views bigint check (views >= 0),
  likes bigint check (likes >= 0),
  comments bigint check (comments >= 0),
  saves bigint check (saves >= 0),
  shares bigint check (shares >= 0),
  total_interactions bigint check (total_interactions >= 0),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (ig_media_id, captured_on),
  foreign key (ig_media_id, brand_id) references mkt.ig_media (id, brand_id) on delete cascade
);
```

### `seo_daily` e `seo_query_daily` — Search Console (relatório "Web")

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `web_property_id`, `brand_id` | `uuid` | não | — | Propriedade do Search Console (chave composta) |
| `metric_on` | `date` | não | — | Dia do Search Console (fuso do Pacífico) |
| `query` | `text` | não | — | Só em `seo_query_daily`: a consulta, até 500 letras |
| `impressions`, `clicks` | `bigint` | não | — | — |
| `position` | `numeric(7,2)` | sim | — | Posição média como a API devolve (já ponderada por impressões no dia ou na consulta) |
| `fetched_at` | `timestamptz` | não | — | — |

- **Chaves:** `seo_daily`: única `(web_property_id, metric_on)`. `seo_query_daily`: única `(web_property_id,
  metric_on, query)`. O worker guarda as 1.000 consultas com mais cliques por dia e propriedade (o resto não muda a
  tela, que mostra as 10 maiores do período).

```sql
create table if not exists mkt.seo_daily (
  id uuid primary key default gen_random_uuid(),
  web_property_id uuid not null,
  brand_id uuid not null,
  metric_on date not null,
  impressions bigint not null check (impressions >= 0),
  clicks bigint not null check (clicks >= 0),
  position numeric(7,2) check (position > 0),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (web_property_id, metric_on),
  foreign key (web_property_id, brand_id) references mkt.web_properties (id, brand_id)
);

create table if not exists mkt.seo_query_daily (
  id uuid primary key default gen_random_uuid(),
  web_property_id uuid not null,
  brand_id uuid not null,
  metric_on date not null,
  query text not null check (length(query) between 1 and 500),
  impressions bigint not null check (impressions >= 0),
  clicks bigint not null check (clicks >= 0),
  position numeric(7,2) check (position > 0),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (web_property_id, metric_on, query),
  foreign key (web_property_id, brand_id) references mkt.web_properties (id, brand_id)
);
create index if not exists seo_query_daily_brand_day on mkt.seo_query_daily (brand_id, metric_on);
```

### `ga4_traffic_daily` — sessões do GA4 por origem, meio e canal

Uma tabela bruta no lugar das duas do protótipo (`ga4_channel_daily` e `GeoDaily`): o canal e o assistente de IA
são derivados em SQL (`mkt.v_ga4_channel_daily` e `mkt.v_ga4_ai_daily`), com a mesma função que classifica o
`referrer` do lead. Assim o histórico de antes de 13/05/2026, quando o GA4 ainda não tinha o canal "AI Assistant",
também é classificado.

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `web_property_id`, `brand_id` | `uuid` | não | — | Propriedade GA4 (chave composta) |
| `metric_on` | `date` | não | — | Dia da propriedade (configurada em `America/Sao_Paulo`) |
| `session_source` | `text` | não | — | `sessionSource` (`google`, `chatgpt.com`, `(direct)`…) |
| `session_medium` | `text` | não | — | `sessionMedium` |
| `channel_group_raw` | `text` | não | — | `sessionDefaultChannelGroup` como o GA4 devolve |
| `sessions` | `bigint` | não | — | Sessões |
| `lead_events` | `bigint` | sim | — | Eventos `generate_lead` (guardados; mostrar ou não é decisão de métrica) |
| `fetched_at` | `timestamptz` | não | — | — |

```sql
create table if not exists mkt.ga4_traffic_daily (
  id uuid primary key default gen_random_uuid(),
  web_property_id uuid not null,
  brand_id uuid not null,
  metric_on date not null,
  session_source text not null,
  session_medium text not null,
  channel_group_raw text not null,
  sessions bigint not null check (sessions >= 0),
  lead_events bigint check (lead_events >= 0),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (web_property_id, metric_on, session_source, session_medium, channel_group_raw),
  foreign key (web_property_id, brand_id) references mkt.web_properties (id, brand_id)
);
create index if not exists ga4_traffic_daily_brand_day on mkt.ga4_traffic_daily (brand_id, metric_on);
```

### `site_checks` — checagem diária dos sites

O worker abre `robots.txt`, `llms.txt` e as páginas principais (JSON-LD) de cada site. Guarda o achado em lista
fechada; o estado "Em ordem" ou "Atenção" e o texto da tela saem do achado, em SQL e no `labels.ts`.

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `web_property_id`, `brand_id` | `uuid` | não | — | Site |
| `host` | `text` | não | — | Domínio conferido |
| `item` | `mkt.site_check_item` | não | — | `robots_txt`, `llms_txt`, `json_ld` |
| `finding` | `mkt.site_check_finding` | não | — | `found`, `missing`, `blocks_ai_bots` (bloqueia robô de busca de IA), `blocks_ai_training` (bloqueia só robô de treino), `invalid`, `unreachable` |
| `http_status` | `integer` | sim | — | Código HTTP da resposta |
| `detail` | `text` | sim | — | Detalhe técnico curto (até 300 letras) |
| `checked_at` | `timestamptz` | não | — | Quando conferiu |
| `checked_on` | `date` | não | — | Dia de São Paulo da conferência |

```sql
create table if not exists mkt.site_checks (
  id uuid primary key default gen_random_uuid(),
  web_property_id uuid not null,
  brand_id uuid not null,
  host text not null,
  item mkt.site_check_item not null,
  finding mkt.site_check_finding not null,
  http_status integer check (http_status between 100 and 599),
  detail text check (length(detail) <= 300),
  checked_at timestamptz not null,
  checked_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (web_property_id, item, checked_on),
  foreign key (web_property_id, brand_id) references mkt.web_properties (id, brand_id)
);
```

### Fica fora da v1 (nenhuma tela usa)

- `gsc_ai_feature_daily`: impressões em AI Overviews e AI Mode, do relatório de IA generativa do Search Console, que
  só existe na interface e exporta CSV. O protótipo aprovado traz só o aviso de que a medição de GEO é parcial.
  Quando a tela ganhar o bloco: `(web_property_id, brand_id, metric_on, feature ai_overview|ai_mode, impressions,
  source = 'csv')`, única `(web_property_id, metric_on, feature)`.
- `ad_creatives`: criativos (decisão 0010 diz que são do CSP-MKT), quando a ação "Trocar criativo" executar de
  verdade (na v1, lance e criativo não executam pela central).
- `crm_marketing_events`: cópia de `historico_marketing` do CRM. Nenhuma conta da v1 usa: a atribuição é pela UTM do
  lead e pela de primeiro contato do cliente (decisões 0009 e 0031), e o histórico não tem marca nem negócio. Pela regra
  6 (só dados necessários), não é replicado. Entra com decisão nova quando a atribuição por evento for pedida, com as
  mesmas regras de texto da seção 2 (`(source, external_id, customer_id, brand_id, event_type, crm_event_source,
  utm_source, utm_medium, utm_campaign, occurred_at, source_registered_at)`, sem `origem` e `campanha` digitadas).
- `webhook_inbox`: entrada de webhooks. A v1 não recebe webhook: leads de anúncio entram no CRM, e o CSP-MKT lê o
  número de leads da plataforma pelos relatórios. Se o CRM avisar o CSP-MKT em quase tempo real (Parte 4), a tabela
  entra com `(source, external_id, received_at, payload_digest, processed_at)` e segredo no cabeçalho.

---

## 4. Tráfego com IA (o CSP-MKT é o dono; decisões 0005, 0020 a 0023)

Toda escrita destas tabelas pela tela passa pelas funções de [`papeis-e-rls.md`](papeis-e-rls.md), que conferem o
papel, a trava otimista (`updated_at` lido) e gravam o diário. O worker grava as rodadas e as propostas do Claude; o
executor grava as execuções e o andamento das ações.

### `traffic_strategies` — estratégia por marca e mês

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `brand_id` | `uuid` | não | — | Marca |
| `month_on` | `date` | não | — | Mês (dia 1) |
| `body` | `text` | não | `''` | Texto que o Claude lê; até 4.000 letras, sem dado pessoal. É o único texto livre escrito por pessoa que vai para o Claude: a tela diz, embaixo do campo, "Este texto vai para o Claude. Não escreva nome de cliente, lead ou pessoa." |
| `budget_cents` | `bigint` | sim | — | Verba do mês; nulo = "A definir" |
| `target_cost_per_new_customer_cents` | `bigint` | sim | — | Meta de custo por cliente novo |
| `target_cost_per_lead_cents` | `bigint` | sim | — | Meta de custo por lead; também é o limite do aviso "Custo por lead acima do limite" |
| `target_new_customers` | `integer` | sim | — | Meta de clientes novos no mês |
| `updated_by` | `uuid` | não | — | Quem salvou por último |

- **Chave:** única `(brand_id, month_on)` (o protótipo tinha uma por marca, sem mês). Cada mudança vai para
  `traffic_log` com `{campo: {antes, depois}}`; não há tabela de versões.
- **Grava:** `api.save_strategy` (`operate_traffic`). **RLS:** lê `view_traffic`.

```sql
create table if not exists mkt.traffic_strategies (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references mkt.brands(id),
  month_on date not null check (extract(day from month_on) = 1),
  body text not null default '' check (length(body) <= 4000 and not mkt.has_personal_data(body)),
  budget_cents bigint check (budget_cents >= 0),
  target_cost_per_new_customer_cents bigint check (target_cost_per_new_customer_cents > 0),
  target_cost_per_lead_cents bigint check (target_cost_per_lead_cents > 0),
  target_new_customers integer check (target_new_customers > 0),
  updated_by uuid not null references mkt.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (brand_id, month_on)
);
```

### `spend_limits` — limite de gasto por conta e mês (decisão 0021)

Uma linha por conta e por dia em que o limite mudou. Vale a linha mais recente com `valid_from_on` até o dia
consultado: mudar no meio do mês vale para o mês inteiro dali em diante, e o mês passado continua com o limite que
tinha.

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `ad_account_id`, `brand_id`, `platform` | | não | — | Conta (chave composta) |
| `monthly_limit_cents` | `bigint` | não | — | Quanto a conta pode gastar no mês do calendário de São Paulo |
| `valid_from_on` | `date` | não | — | Vale a partir deste dia |
| `set_by` | `uuid` | não | — | Quem definiu |

- **Chave:** única `(ad_account_id, valid_from_on)`: mudar duas vezes no mesmo dia atualiza a linha do dia.
- **Grava:** `api.set_spend_limit` (`configure_traffic`, só o dono). **RLS:** lê `view_numbers` (a régua aparece
  na Visão geral e nos canais).
- O limite é um controle do CSP-MKT: alimenta o aviso "Gasto perto do limite", o alerta da proposta e a trava da
  execução (o executor não executa o que passa do limite, e conta sem limite vigente não recebe nada que possa aumentar
  o gasto: `no_spend_limit`). Ele avisa e barra execução nova; não pausa o que já roda.
- Na Meta, antes de ligar a credencial de escrita de uma conta, o teto também fica gravado na plataforma (decisão
  0021): o `spend_cap` da conta. Todo dia 1, a execução `set_account_spend_cap` (criada pelo `pg_cron`, por
  `private.queue_monthly_spend_caps`) grava com `spend_cap_action=reset` o limite do mês; quando o dono muda o limite
  no meio do mês, `api.set_spend_limit` grava do mesmo jeito a sobra do limite novo (limite − gasto da conta no mês).
  Como a Meta conta o gasto depois do `reset` fica a confirmar na primeira escrita ([`integracoes.md`](integracoes.md),
  seção 19). O worker lê o teto na releitura diária (`ad_accounts.spend_cap_cents`), e o executor bloqueia a escrita
  (`no_spend_limit`) se ele faltar ou se a sobra dele passar da sobra do limite do mês.

```sql
create table if not exists mkt.spend_limits (
  id uuid primary key default gen_random_uuid(),
  ad_account_id uuid not null,
  brand_id uuid not null,
  platform mkt.platform not null,
  monthly_limit_cents bigint not null check (monthly_limit_cents >= 0),
  valid_from_on date not null,
  set_by uuid not null references mkt.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (ad_account_id, valid_from_on),
  foreign key (ad_account_id, brand_id, platform) references mkt.ad_accounts (id, brand_id, platform)
);
```

### `claude_runs` — rodadas do Claude (prompt e contexto)

Uma linha por vez que o worker chama a Claude API. Guarda a trilha da decisão 0005 (prompt e contexto) uma vez por
rodada, e não em cada ação.

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `brand_id` | `uuid` | sim | — | Marca analisada; nulo = as duas |
| `status` | `mkt.run_status` | não | — | `running`, `succeeded`, `failed` |
| `model` | `text` | não | — | Id do modelo usado |
| `prompt_version` | `text` | não | — | Versão do texto de instrução, que vive no repositório do worker |
| `prompt` | `text` | não | — | Instrução enviada, sem dado pessoal |
| `context` | `jsonb` | não | — | Números enviados: só agregados por marca, canal e campanha, sem lead nem cliente; as chaves permitidas são conferidas por `mkt.valid_claude_context` |
| `output` | `jsonb` | sim | — | Resposta estruturada (as propostas) |
| `input_tokens`, `output_tokens` | `integer` | sim | — | Consumo |
| `proposals_refused` | `integer` | não | `0` | Propostas da resposta que `private.validate_action` recusou (ficam de fora) |
| `error_code` | `text` | sim | — | Código do erro, sem texto livre |
| `started_at`, `finished_at` | `timestamptz` | não / sim | — | — |

- **Grava:** worker. O worker cria o `id` da rodada antes de chamar a API, e `ingest.record_claude_run` é upsert por
  esse id: se o worker cair entre a resposta e o fim da rodada, repetir não duplica. **RLS:** lê `view_traffic`.
  Guarda 13 meses; a ação continua e perde só o vínculo (`on delete set null`).
- O contexto pode levar nome digitado na estratégia ou no nome de uma campanha (o filtro reconhece e-mail, telefone e
  documento, não nome). É risco residual, com a Anthropic como operadora ([README](README.md), "Dado pessoal"), e
  exceção à regra "nunca leva nome" da 0005, registrada na decisão 0020.

```sql
create table if not exists mkt.claude_runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references mkt.brands(id),
  status mkt.run_status not null,
  model text not null,
  prompt_version text not null,
  prompt text not null check (not mkt.has_personal_data(prompt)),
  context jsonb not null check (mkt.valid_claude_context(context)),
  output jsonb,
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  proposals_refused integer not null default 0 check (proposals_refused >= 0),
  error_code text check (error_code ~ '^[A-Z0-9_-]{2,40}$'),
  started_at timestamptz not null,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now())
);
create index if not exists claude_runs_started on mkt.claude_runs (started_at desc);
```

### `traffic_actions` — "O que podemos fazer" e a fila de aprovação

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `code` | `text` | não | `ACT-0001` | Código humano, usado no aviso e no diário |
| `brand_id` | `uuid` | não | — | Marca |
| `platform` | `mkt.platform` | sim | — | Nulo = ação sem canal (site, medição) |
| `ad_account_id` | `uuid` | sim | — | Conta: a da campanha; sem campanha, a única conta ativa da marca no canal (`api.propose_action`); nulo sem canal |
| `campaign_id` | `uuid` | sim | — | Campanha; nulo em campanha nova ou ação sem campanha |
| `kind` | `mkt.action_kind` | não | — | `create`, `pause`, `budget`, `bid`, `creative`, `pending_fix` |
| `title` | `text` | não | — | 5 a 140 letras |
| `rationale` | `text` | não | — | O porquê, 10 a 2.000 letras, sem dado pessoal |
| `params` | `jsonb` | não | `'{}'` | Parâmetros por tipo (quadro abaixo); congelados depois da aprovação |
| `impact`, `effort` | `mkt.level` | não | — | `low`, `medium`, `high` |
| `cost_cents` | `bigint` | sim | — | Custo estimado; nulo = sem estimativa, 0 = sem custo |
| `status` | `mkt.action_status` | não | `'idea'` | `idea`, `approved`, `running`, `done`, `failed`, `discarded` |
| `proposed_by_kind` | `mkt.operator` | não | — | `human` ou `claude` (o `proposedBy` do protótipo) |
| `proposed_by` | `uuid` | sim | — | A pessoa, quando humano |
| `claude_run_id` | `uuid` | sim | — | A rodada que propôs, quando Claude |
| `claude_item` | `integer` | sim | — | Posição da proposta na resposta da rodada; com `claude_run_id`, faz a gravação repetida não duplicar |
| `approved_by`, `approved_at` | `uuid`, `timestamptz` | sim | — | Quem aprovou e quando |
| `discarded_by`, `discarded_at` | `uuid`, `timestamptz` | sim | — | Quem descartou e quando (o protótipo não guardava pela tela de canal) |
| `discard_reason` | `mkt.discard_reason` | sim | — | Motivo em lista fechada (seção 9 do padrão) |
| `discard_note` | `text` | sim | — | O texto do motivo, 10 a 1.000 letras (separado do `result`) |
| `done_via` | `mkt.done_via` | sim | — | `platform_api` (o executor executou) ou `manual` ("Marcar como feita") |
| `done_by` | `uuid` | sim | — | Quem marcou como feita (o protótipo preenchia o aprovador) |
| `executed_at` | `timestamptz` | sim | — | Quando ficou feita |
| `result` | `text` | sim | — | O que foi feito, 5 a 1.000 letras |

Parâmetros por tipo (conferidos por `mkt.valid_action_params(kind, platform, params)` num `check`):

| Tipo | `params` |
|---|---|
| `budget` | `{"daily_budget_cents": int, "previous_daily_budget_cents": int?}` |
| `pause` | `{"status": "paused"}` |
| `creative` | `{"creative_ref": text}` |
| `create` | `{"objective": text, "daily_budget_cents": int, "name": text}` (o nome segue a convenção da `utm_campaign`) e o que a plataforma exige: `"special_ad_categories": [text]` na Meta (`[]` quando não há); `"advertising_channel_type": text` e `"bidding_strategy": text` no Google; `"budget_mode": text` no TikTok |
| `bid` | `{"bid_strategy": text, "target_cpa_cents": int?}` |
| `pending_fix` | `{"area": text, "env": text?}`, com `area` em `ga4`, `search_console`, `site`, `crm` ou `pixel` |
| ideia registrada | `{"origin": "central"}` somado aos do tipo |

- `mkt.valid_action_params` exige os campos da plataforma da ação: o pedido enviado é o que foi aprovado, e o executor
  nunca inventa campo. A campanha nasce pausada; no Google, `contains_eu_political_advertising` vai sempre falso,
  mostrado na aprovação.
- **Chaves:** única `code`; `(campaign_id, brand_id, platform)` → `campaigns` e `(ad_account_id, brand_id, platform)`
  → `ad_accounts` (a ação não aponta para conta ou campanha de outra marca ou de outro canal); única
  `(claude_run_id, claude_item)`.
- **Índices:** `(status, brand_id)`, `(created_at desc)`, `(campaign_id)`.
- **Gatilhos:** `traffic_actions_code` (preenche `code`); `traffic_actions_transition` (só deixa as passagens do
  quadro abaixo, confere quem pede pelo `session_user` e pela permissão, e trava `params` fora de `idea`;
  [`papeis-e-rls.md`](papeis-e-rls.md), "Gatilhos que conferem quem pede"); `traffic_actions_log` (depois de `insert` e
  de mudança de status, grava `traffic_log`).
- **Grava:** `api.propose_action`, `api.approve_action`, `api.discard_action`, `api.mark_action_done`, o worker
  (propostas do Claude, sempre em `idea`) e o executor (`running`, `done`, `failed`). **RLS:** lê `view_traffic`; a
  Visão geral lê o contador da fila por `api.kpi_overview`, que só devolve números.

| De | Para | Quem |
|---|---|---|
| (inserção) | `approved` | `api.propose_action` com `approve_now` (pede também `approve_action`) |
| `idea` | `approved` | `api.approve_action` (não vale para `pending_fix`) |
| `idea` | `done` | `api.mark_action_done`, só `pending_fix` |
| `idea`, `approved`, `failed` | `discarded` | `api.discard_action` |
| `approved` | `running` | executor, ao mandar a execução |
| `approved`, `failed`, `running` (com a execução bloqueada) | `done` | `api.mark_action_done` (feita fora da central); de `approved`, também o executor (já estava como pedido) |
| `approved`, `running` | `done`, `failed` | executor, depois de reler na plataforma |
| `failed` | `approved` | `api.approve_action` de novo ("Tentar de novo") |

```sql
create table if not exists mkt.traffic_actions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  brand_id uuid not null references mkt.brands(id),
  platform mkt.platform,
  ad_account_id uuid,
  campaign_id uuid,
  kind mkt.action_kind not null,
  title text not null check (length(title) between 5 and 140),
  rationale text not null check (length(rationale) between 10 and 2000),
  params jsonb not null default '{}',
  impact mkt.level not null,
  effort mkt.level not null,
  cost_cents bigint check (cost_cents >= 0),
  status mkt.action_status not null default 'idea',
  proposed_by_kind mkt.operator not null,
  proposed_by uuid references mkt.profiles(id),
  claude_run_id uuid references mkt.claude_runs(id) on delete set null,
  claude_item integer check (claude_item >= 1),
  approved_by uuid references mkt.profiles(id),
  approved_at timestamptz,
  discarded_by uuid references mkt.profiles(id),
  discarded_at timestamptz,
  discard_reason mkt.discard_reason,
  discard_note text check (discard_note is null or length(discard_note) between 10 and 1000),
  done_via mkt.done_via,
  done_by uuid references mkt.profiles(id),
  executed_at timestamptz,
  result text check (result is null or length(result) between 5 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  foreign key (campaign_id, brand_id, platform) references mkt.campaigns (id, brand_id, platform),
  foreign key (ad_account_id, brand_id, platform) references mkt.ad_accounts (id, brand_id, platform),
  unique (claude_run_id, claude_item),
  check (campaign_id is null or platform is not null),
  check (ad_account_id is null or platform is not null),
  check (mkt.valid_action_params(kind, platform, params)),
  check (not mkt.has_personal_data(concat_ws(' ', title, rationale, discard_note, result))),
  check ((proposed_by_kind = 'human') = (proposed_by is not null)),
  check ((proposed_by_kind = 'claude') = (claude_item is not null)),
  check (status not in ('approved', 'running', 'failed') or (approved_by is not null and approved_at is not null)),
  check (status <> 'discarded' or (discarded_by is not null and discarded_at is not null
                                   and discard_reason is not null and discard_note is not null)),
  check (status <> 'done' or (executed_at is not null and done_via is not null)),
  check (done_via is distinct from 'manual' or (done_by is not null and result is not null))
);
create index if not exists traffic_actions_status on mkt.traffic_actions (status, brand_id);
create index if not exists traffic_actions_created on mkt.traffic_actions (created_at desc);
create index if not exists traffic_actions_campaign on mkt.traffic_actions (campaign_id);

-- campaigns nasce antes de traffic_actions: a chave de created_by_action_id entra aqui,
-- num bloco que confere pg_constraint antes (a migração roda de novo sem erro).
alter table mkt.campaigns
  add constraint campaigns_created_by_action foreign key (created_by_action_id)
  references mkt.traffic_actions(id) on delete set null;
```

### `traffic_stops` e `traffic_stop_campaigns` — "Parar tudo" (decisão 0022)

O botão vira um comando registrado: quem, quando, a marca, o alcance e cada campanha, com a execução de cada uma em
`platform_executions`. Uma campanha fica em no máximo uma parada aberta (`undone_at` nulo): a segunda parada pega só
as campanhas que a primeira não pegou, e o botão nunca é recusado. "Desfazer a parada" reativa só as campanhas desta
parada que continuam pausadas e que não estão em outra parada aberta ([`papeis-e-rls.md`](papeis-e-rls.md), "Exemplo:
parar tudo").

| Coluna (`traffic_stops`) | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `brand_id` | `uuid` | sim | — | Marca; nulo = as duas |
| `scope` | `mkt.stop_scope` | não | `'claude_only'` | Alcance da parada; hoje só `claude_only` (decisão 0022) |
| `requested_by`, `requested_at` | `uuid`, `timestamptz` | não | — | Quem parou e quando |
| `undone_by`, `undone_at` | `uuid`, `timestamptz` | sim | — | Quem desfez e quando |

| Coluna (`traffic_stop_campaigns`) | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `traffic_stop_id` | `uuid` | não | — | A parada |
| `campaign_id`, `brand_id` | `uuid` | não | — | A campanha ativa no momento da parada |
| `status_before` | `mkt.campaign_status` | não | — | Status lido antes de parar |

```sql
create table if not exists mkt.traffic_stops (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references mkt.brands(id),
  scope mkt.stop_scope not null default 'claude_only',
  requested_by uuid not null references mkt.profiles(id),
  requested_at timestamptz not null default now(),
  undone_by uuid references mkt.profiles(id),
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  check ((undone_by is null) = (undone_at is null))
);

create table if not exists mkt.traffic_stop_campaigns (
  id uuid primary key default gen_random_uuid(),
  traffic_stop_id uuid not null references mkt.traffic_stops(id),
  campaign_id uuid not null,
  brand_id uuid not null,
  status_before mkt.campaign_status not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (traffic_stop_id, campaign_id),
  foreign key (campaign_id, brand_id) references mkt.campaigns (id, brand_id)
);
```

- **Grava:** `api.stop_all` e `api.undo_stop` (`stop_all`). **RLS:** lê `view_traffic`.

### `platform_executions` — cada escrita numa plataforma

Uma linha por chamada de escrita que o executor faz (ou deixou de fazer). Os parâmetros são uma cópia dos aprovados e
não mudam depois de criados.

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `brand_id`, `platform`, `ad_account_id` | | não | — | Conta (chave composta) |
| `campaign_id` | `uuid` | sim | — | Campanha, quando há |
| `traffic_action_id` | `uuid` | sim | — | A ação aprovada que gerou a execução |
| `traffic_stop_campaign_id` | `uuid` | sim | — | Ou a campanha de uma parada (pausar ou reativar) |
| `spend_limit_id` | `uuid` | sim | — | Ou o limite que gerou a escrita na conta (`set_account_spend_cap`) |
| `operation` | `mkt.execution_operation` | não | — | `pause`, `activate`, `set_daily_budget`, `create_campaign`, `set_account_spend_cap` (lance e criativo não executam na v1) |
| `request` | `jsonb` | não | — | Exatamente o que vai ser enviado; bate com os `params` congelados da ação |
| `idempotency_key` | `text` | não | — | Única; a Meta recebe em `X-Client-Idempotent-Key` |
| `status` | `mkt.execution_status` | não | `'queued'` | `queued`, `blocked`, `sent`, `confirmed`, `failed`, `cancelled` (a ação foi descartada ou feita à mão antes de a central executar; decisão 0038) |
| `blocked_reason` | `mkt.execution_block_reason` | sim | — | `no_write_credential`, `no_spend_limit`, `over_spend_limit`, `stopped`, `approval_invalid`, `campaign_ended`, `connector_disabled` |
| `attempts` | `integer` | não | `0` | Tentativas (no máximo 5, com espera crescente) |
| `http_status`, `error_code` | `integer`, `text` | sim | — | Resposta da plataforma |
| `error_message` | `text` | sim | — | Mensagem curta, até 300 letras, sem dado pessoal |
| `response` | `jsonb` | sim | — | Só o que confirma: status e valores lidos de volta |
| `queued_at`, `sent_at`, `confirmed_at`, `failed_at`, `cancelled_at` | `timestamptz` | — | — | Andamento |

- **Grava:** as funções de ação (e, todo dia 1, `private.queue_monthly_spend_caps`, pelo `pg_cron`) criam a linha em
  `queued`; o executor confere `mkt.execution_allowed` (aprovação, credencial de escrita, limite do mês, parada aberta,
  campanha encerrada, conector desligado; [`integracoes.md`](integracoes.md), seção 14) e passa para `sent`,
  `confirmed` (a releitura já mostra o pedido feito) ou `blocked`. Sem credencial de escrita (a v1 começa assim), a
  execução fica `blocked` e a tela diz o que fazer na plataforma; a ação pode ser marcada como feita à mão, e a execução
  vira `cancelled`.
  Quando o motivo deixa de valer (credencial ligada, parada desfeita, limite definido), "Tentar de novo"
  (`api.retry_execution`) devolve a execução para `queued`, e o executor confere tudo outra vez. **RLS:** lê
  `view_traffic`.
- **Gatilho:** `platform_executions_guard`: `insert` só pela API (dentro das funções de ação) ou por
  `private.queue_monthly_spend_caps`, que só o `pg_cron` chama; `request`, `operation`, `idempotency_key`,
  `traffic_action_id`, `traffic_stop_campaign_id`, `spend_limit_id`, `campaign_id` e `ad_account_id` nunca mudam; o
  status só passa por `queued` → `blocked | sent | confirmed | cancelled` (`confirmed` direto quando a releitura antes
  de mandar já mostra o pedido feito), `blocked` → `queued | cancelled` e `sent` → `sent | confirmed | failed`.
- **Gatilho:** `platform_executions_log` (depois de `insert` e de `update of status`): grava em `traffic_log` o evento
  `execution_status_changed`, com `platform_execution_id`, `campaign_id` e `changes` = `{status: {antes, depois},
  blocked_reason}` (seção 9 do padrão: mudança de status com histórico por gatilho).

```sql
create table if not exists mkt.platform_executions (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  platform mkt.platform not null,
  ad_account_id uuid not null,
  campaign_id uuid references mkt.campaigns(id),
  traffic_action_id uuid references mkt.traffic_actions(id) on delete cascade,
  traffic_stop_campaign_id uuid references mkt.traffic_stop_campaigns(id),
  spend_limit_id uuid references mkt.spend_limits(id),
  operation mkt.execution_operation not null,
  request jsonb not null,
  idempotency_key text not null unique,
  status mkt.execution_status not null default 'queued',
  blocked_reason mkt.execution_block_reason,
  attempts integer not null default 0 check (attempts between 0 and 5),
  http_status integer check (http_status between 100 and 599),
  error_code text check (error_code ~ '^[A-Za-z0-9_.:-]{1,60}$'),
  error_message text check (length(error_message) <= 300),
  response jsonb,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  confirmed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  check (num_nonnulls(traffic_action_id, traffic_stop_campaign_id, spend_limit_id) = 1),
  check ((operation = 'set_account_spend_cap') = (spend_limit_id is not null)),
  check ((status = 'blocked') = (blocked_reason is not null)),
  foreign key (ad_account_id, brand_id, platform) references mkt.ad_accounts (id, brand_id, platform)
);
create index if not exists platform_executions_open on mkt.platform_executions (status) where status in ('queued', 'sent');
```

### `traffic_log` — diário de tráfego

Só acréscimo: ninguém altera nem apaga (gatilho), menos a limpeza de 5 anos. É também o histórico de status das
ações e das execuções.

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `seq` | `bigint` | não | identidade | Ordem de gravação: desempata eventos com a mesma hora (a hora é a da transação, e uma transação grava vários) |
| `occurred_at` | `timestamptz` | não | `now()` | Quando |
| `event` | `mkt.traffic_event` | não | — | `action_proposed`, `action_approved`, `action_running`, `action_done`, `action_failed`, `action_discarded`, `stop_all`, `stop_undone`, `limit_changed`, `strategy_saved`, `operator_changed`, `execution_retried`, `execution_status_changed` |
| `brand_id` | `uuid` | sim | — | Marca; nulo = as duas (parada nas duas marcas) |
| `platform` | `mkt.platform` | sim | — | Canal, quando há |
| `actor_kind`, `actor_id` | `mkt.actor_kind`, `uuid` | não / sim | — | Quem fez: pessoa, Claude ou o sistema |
| `traffic_action_id`, `campaign_id`, `traffic_stop_id`, `spend_limit_id`, `traffic_strategy_id`, `platform_execution_id` | `uuid` | sim | — | O registro de que o evento fala |
| `changes` | `jsonb` | não | `'{}'` | `{campo: {antes, depois}}` no limite, na estratégia, no operador e na situação da execução |

- **Índices:** `(occurred_at desc, seq desc)` (a página do diário anda por esse par), `(brand_id, occurred_at desc)`,
  `(traffic_action_id)`.
- **Grava:** gatilhos e funções de ação; os eventos `action_running`, `action_done` e `action_failed` saem do gatilho
  quando o executor muda o status, e `execution_status_changed`, do gatilho de `platform_executions`. **RLS:** lê
  `view_traffic`.
- **Limpeza de 5 anos:** apaga `traffic_log`, depois `platform_executions` (também as de parada e de teto da conta,
  que não caem com a ação) e `traffic_actions` (o diário aponta para a ação e para a execução).

```sql
create table if not exists mkt.traffic_log (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  occurred_at timestamptz not null default now(),
  event mkt.traffic_event not null,
  brand_id uuid references mkt.brands(id),
  platform mkt.platform,
  actor_kind mkt.actor_kind not null,
  actor_id uuid references mkt.profiles(id),
  traffic_action_id uuid references mkt.traffic_actions(id),
  campaign_id uuid references mkt.campaigns(id),
  traffic_stop_id uuid references mkt.traffic_stops(id),
  spend_limit_id uuid references mkt.spend_limits(id),
  traffic_strategy_id uuid references mkt.traffic_strategies(id),
  platform_execution_id uuid references mkt.platform_executions(id),
  changes jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  check ((actor_kind = 'user') = (actor_id is not null))
);
create index if not exists traffic_log_time on mkt.traffic_log (occurred_at desc, seq desc);
create index if not exists traffic_log_brand_time on mkt.traffic_log (brand_id, occurred_at desc);
create index if not exists traffic_log_action on mkt.traffic_log (traffic_action_id);
```

---

## 5. Sistema: conectores, usuários, preferências, avisos e auditoria

### `connectors` — uma linha por integração

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `code` | `mkt.connector_code` | não | — | `csp360`, `meta`, `instagram`, `tiktok`, `google_ads`, `ga4`, `search_console` |
| `setup_state` | `mkt.connector_setup_state` | não | `'not_connected'` | `connected`, `not_connected` (a ligar) ou `disabled` (desligado pelo dono) |
| `expected_every_minutes` | `integer` | não | — | Frequência esperada: 5 (CSP 360), 60 (mídia e Instagram), 1.440 (GA4 e Search Console) |
| `late_tolerance_minutes` | `integer` | não | — | Folga antes de virar "Atrasado": 10% da frequência, no mínimo 5 min |
| `first_success_at` | `timestamptz` | sim | — | Primeira rodada que deu certo (também a de um CSV); nunca volta a nulo. Diz se a fonte tem base: "Sem dados" × 0 (decisão 0034) |
| `last_success_at` | `timestamptz` | sim | — | Última rodada que deu certo; base do "atualizado há" de toda tela. Fica aqui porque `sync_runs` guarda só 90 dias |

- O estado da tela (`ok`, `late`, `down`, `not_connected`, `disabled`) é calculado em `mkt.v_connector_health` a
  partir de `sync_runs`, de `connector_jobs` e das duas datas acima; não é coluna. As duas datas são gravadas por
  `ingest.finish_run`. Rodada `partial` conta como boa para as duas datas; o cartão mostra o aviso com o código.
- **Grava:** migração (as sete linhas); `setup_state` muda por função do dono (`api.set_connector_state`,
  `retry_connector`) ou pelo worker quando a primeira rodada dá certo. **RLS:** lê `view_connectors`.

```sql
create table if not exists mkt.connectors (
  id uuid primary key default gen_random_uuid(),
  code mkt.connector_code not null unique,
  setup_state mkt.connector_setup_state not null default 'not_connected',
  expected_every_minutes integer not null check (expected_every_minutes > 0),
  late_tolerance_minutes integer not null check (late_tolerance_minutes >= 0),
  first_success_at timestamptz,
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  check ((first_success_at is null) = (last_success_at is null))
);
```

### `connector_jobs` — cada trabalho de cada conector

O conector tem mais de um trabalho (leitura de hora em hora, releitura diária, passada completa do CRM…). Se só a
leitura mais frequente desse certo, o cartão ficaria "Funcionando" com a releitura ou a passada completa falhando todo
dia: os números não seriam corrigidos e o que saiu do CRM não sairia daqui. Uma linha por trabalho agendado de
[`integracoes.md`](integracoes.md), seção 2.1 (`csv_import` não tem linha: roda quando chega um arquivo).

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `connector_id` | `uuid` | não | — | Conector |
| `job` | `mkt.sync_job` | não | — | O trabalho (`crm_incremental`, `crm_full_pass`, `ads_hourly`, `ads_backfill`…), o mesmo de `sync_runs.job` |
| `expected_every_minutes` | `integer` | não | — | De quanto em quanto tempo deve dar certo (60, 1.440…) |
| `late_tolerance_minutes` | `integer` | não | — | Folga antes de virar "Atrasado" |
| `last_success_at` | `timestamptz` | sim | — | Última rodada boa deste trabalho |

- **Chave:** única `(connector_id, job)`. **Grava:** migração (as linhas) e `ingest.finish_run` (`last_success_at`).
  **RLS:** lê `view_connectors`.

```sql
create table if not exists mkt.connector_jobs (
  id uuid primary key default gen_random_uuid(),
  connector_id uuid not null references mkt.connectors(id),
  job mkt.sync_job not null,
  expected_every_minutes integer not null check (expected_every_minutes > 0),
  late_tolerance_minutes integer not null check (late_tolerance_minutes >= 0),
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (connector_id, job)
);
```

### `sync_runs` — cada rodada de cada conector

É o diário da sincronização e a marca d'água da réplica (decisão 0006). Uma linha por rodada; "Tentar de novo"
cria uma linha `requested` que o worker pega no minuto seguinte.

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `connector_id` | `uuid` | não | — | Conector |
| `job` | `mkt.sync_job` | não | — | O que a rodada faz: `ads_hourly`, `ads_backfill`, `crm_incremental`, `crm_full_pass`… (os trabalhos de [`integracoes.md`](integracoes.md), seção 2.1) |
| `run_trigger` | `mkt.sync_trigger` | não | — | `schedule`, `manual_retry`, `backfill`, `csv_upload` |
| `status` | `mkt.sync_status` | não | — | `requested`, `running`, `succeeded`, `partial`, `failed` |
| `brand_id` | `uuid` | sim | — | Marca da conta lida; nulo = todas as contas do conector |
| `requested_by` | `uuid` | sim | — | Quem pediu (só `manual_retry` e `csv_upload`) |
| `requested_at`, `started_at`, `finished_at` | `timestamptz` | sim | — | Andamento |
| `rows_written`, `rows_deleted`, `rows_refused` | `integer` | não | `0` | Linhas gravadas, apagadas e recusadas pelo banco (moeda, lista, `check`; [`integracoes.md`](integracoes.md), seção 2.3) |
| `watermark_from_at`, `watermark_to_at` | `timestamptz` | sim | — | Janela lida; o `watermark_to_at` da última rodada boa é o próximo `since`. No CSP 360 a leitura de 5 min não usa a marca d'água: relê a janela de 3 dias (decisão 0041, item 4) |
| `personal_data_dropped` | `integer` | não | `0` | Valores de texto do CRM que viraram nulo por parecer dado pessoal (`PERSONAL_DATA_DROPPED`) |
| `error_code` | `text` | sim | — | Código do erro (`HTTP_429`, `CURRENCY`, `SCHEMA_DRIFT`, `EMPTY_SOURCE`, `SPEND_MISMATCH`, `MASS_DELETE_BLOCKED`…) |
| `error_message` | `text` | sim | — | Mensagem curta, até 300 letras, sem dado pessoal |
| `mass_delete_confirmed_by`, `mass_delete_confirmed_at` | `uuid`, `timestamptz` | sim | — | O dono confirmou a exclusão que a trava de 20% segurou (`api.confirm_mass_delete`); a passada seguinte apaga |

- **Índices:** `(connector_id, started_at desc)`; único parcial `(connector_id) where status = 'requested' and
  run_trigger = 'manual_retry'` (um pedido de "Tentar de novo" por vez; cada CSV tem a sua rodada).
- **Grava:** worker; `api.retry_connector` cria o pedido; `api.upload_csv` cria a rodada de cada arquivo
  (`csv_upload`); `api.confirm_mass_delete` grava a confirmação. **RLS:** lê `view_connectors`. Guarda 90 dias.

```sql
create table if not exists mkt.sync_runs (
  id uuid primary key default gen_random_uuid(),
  connector_id uuid not null references mkt.connectors(id),
  job mkt.sync_job not null,
  run_trigger mkt.sync_trigger not null,
  status mkt.sync_status not null,
  brand_id uuid references mkt.brands(id),
  requested_by uuid references mkt.profiles(id),
  requested_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  rows_written integer not null default 0 check (rows_written >= 0),
  rows_deleted integer not null default 0 check (rows_deleted >= 0),
  rows_refused integer not null default 0 check (rows_refused >= 0),
  watermark_from_at timestamptz,
  watermark_to_at timestamptz,
  personal_data_dropped integer not null default 0 check (personal_data_dropped >= 0),
  error_code text check (error_code ~ '^[A-Z0-9_-]{2,40}$'),
  error_message text check (length(error_message) <= 300),
  mass_delete_confirmed_by uuid references mkt.profiles(id),
  mass_delete_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  check (run_trigger not in ('manual_retry', 'csv_upload') or requested_by is not null),
  check ((mass_delete_confirmed_by is null) = (mass_delete_confirmed_at is null))
);
create index if not exists sync_runs_connector_time on mkt.sync_runs (connector_id, started_at desc);
create unique index if not exists sync_runs_one_request on mkt.sync_runs (connector_id)
  where status = 'requested' and run_trigger = 'manual_retry';
```

### `csv_imports` — arquivos CSV de reserva (decisão 0035)

O relatório de campanha exportado do gerenciador da plataforma, enquanto a API não é aprovada. O conteúdo fica aqui só
até o worker ler; depois sai, e fica o registro. Detalhe em [`integracoes.md`](integracoes.md), seção 12.

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `connector_id` | `uuid` | não | — | Conector da plataforma (`meta`, `tiktok` ou `google_ads`) |
| `brand_id` | `uuid` | não | — | Marca das contas do arquivo |
| `file_name` | `text` | não | — | Nome do arquivo, até 200 letras |
| `size_bytes` | `integer` | não | — | Tamanho, até 5 MB |
| `content` | `text` | sim | — | O arquivo; nulo depois de lido (relatório de campanha, sem dado de pessoa) |
| `uploaded_by`, `uploaded_at` | `uuid`, `timestamptz` | não | — | Quem enviou e quando |
| `sync_run_id` | `uuid` | sim | — | A rodada que importou |
| `rows_imported`, `rows_refused` | `integer` | sim | — | Resultado |
| `refusal_code` | `text` | sim | — | `CSV_PERSONAL_DATA`, `CSV_NO_CAMPAIGN_ID`, `CURRENCY`… |

- **Grava:** `api.upload_csv` (`retry_connector`, só o dono) e o worker (resultado e limpeza do conteúdo). **RLS:** lê
  `view_connectors`. Guarda 90 dias.

```sql
create table if not exists mkt.csv_imports (
  id uuid primary key default gen_random_uuid(),
  connector_id uuid not null references mkt.connectors(id),
  brand_id uuid not null references mkt.brands(id),
  file_name text not null check (length(file_name) between 1 and 200),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  content text,
  uploaded_by uuid not null references mkt.profiles(id),
  uploaded_at timestamptz not null default now(),
  sync_run_id uuid references mkt.sync_runs(id) on delete set null,
  rows_imported integer check (rows_imported >= 0),
  rows_refused integer check (rows_refused >= 0),
  refusal_code text check (refusal_code ~ '^[A-Z0-9_-]{2,40}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now())
);
```

### `private.connector_credentials` — credenciais cifradas (decisão 0017)

Só para o que **renova** (token do Instagram de 60 dias, refresh token que a plataforma troca). O que não muda fica
nas variáveis do Railway. O valor fica no Supabase Vault (cifrado); a tabela guarda o apontador e o estado. A
credencial de escrita, que fica só nas variáveis do executor, tem aqui uma linha só de estado, sem segredo
(`vault_secret_id` nulo): é por ela que o banco sabe se pode executar ([`integracoes.md`](integracoes.md), seções 14 e
18).

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `connector_id` | `uuid` | não | — | Conector |
| `purpose` | `mkt.credential_purpose` | não | — | `read` ou `write` (sempre separadas) |
| `account_ref` | `text` | sim | — | Conta, perfil ou propriedade que a credencial cobre; nulo = todas |
| `vault_secret_id` | `uuid` | sim | — | Segredo em `vault.secrets`; nulo só na linha de estado da credencial de escrita |
| `status` | `mkt.credential_status` | não | `'valid'` | `valid`, `expiring`, `invalid`, `revoked` |
| `expires_at`, `last_rotated_at`, `last_checked_at` | `timestamptz` | sim | — | Validade e conferências |

- Esquema `private`: nenhuma política e nenhum `grant` para `anon` ou `authenticated`, nem para o dono. O segredo
  sai só por `private.read_credential(id)`, só para o `mkt_worker` e só as de leitura (a função confere o
  `session_user`); o executor não lê segredo do banco: o de escrita fica nas variáveis dele. Só o worker troca, por `private.rotate_credential(id, …)`, com o segredo como
  parâmetro ligado no servidor, nunca no texto do SQL. As duas são `security definer`. A linha e o primeiro segredo
  nascem por `setup.register_credential`, no script de configuração (`mkt_setup`), também com o segredo como
  parâmetro ligado. A tela vê só o estado, por `api.credential_status()`. Quem decifra o Vault está na decisão 0017.

```sql
create table if not exists private.connector_credentials (
  id uuid primary key default gen_random_uuid(),
  connector_id uuid not null references mkt.connectors(id),
  purpose mkt.credential_purpose not null,
  account_ref text,
  vault_secret_id uuid,
  status mkt.credential_status not null default 'valid',
  expires_at timestamptz,
  last_rotated_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique nulls not distinct (connector_id, purpose, account_ref),
  check (vault_secret_id is not null or purpose = 'write')
);
alter table private.connector_credentials enable row level security;
revoke all on private.connector_credentials from public, anon, authenticated;
```

### `profiles` — usuários

O id é o do login (`auth.users`). O e-mail fica só no `auth`; a lista de usuários lê de lá por função.

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `id` | `uuid` | não | — | `auth.users.id` |
| `display_name` | `text` | não | — | Nome mostrado ("por {nome}" no diário) |
| `role` | `mkt.role` | não | — | `owner` ou `traffic_manager` (decisão 0011) |
| `is_active` | `boolean` | não | `true` | Falso = acesso tirado; a RLS nega na hora |
| `theme_preference` | `mkt.theme_preference` | não | `'device'` | `device`, `light`, `dark` (o padrão manda guardar também no perfil) |
| `default_brand` | `mkt.brand_code` | sim | — | Marca padrão; nulo = as duas |
| `default_view` | `mkt.view_mode` | não | `'viewer'` | `viewer` (Visualizador) ou `manager` (Gestor de tráfego) |
| `whatsapp_digits` | `text` | sim | — | WhatsApp só para avisos, `55` + DDD + número; nulo = "A cadastrar" |
| `invited_by` | `uuid` | sim | — | Quem convidou; nulo só no primeiro dono |
| `deactivated_at`, `deactivated_by` | `timestamptz`, `uuid` | sim | — | Quando e quem tirou o acesso |
| `deactivation_reason` | `mkt.deactivation_reason` | sim | — | Motivo em lista fechada: `left_company`, `role_changed`, `security`, `other` (seção 9 do padrão) |
| `deactivation_note` | `text` | sim | — | Obrigatória com `other`; 10 a 500 letras, sem dado pessoal |

- **Gatilhos:**
  - `private.handle_new_user` (`security definer`, `set search_path = ''`, dono `postgres`; depois de `insert` em
    `auth.users`) cria o perfil só se `new.invited_at` não for nulo e houver um convite com `email_normalized =
    lower(new.email)`, `accepted_at` nulo, `revoked_at` nulo, `expires_at > now()` e `invited_by` de perfil ativo com
    `manage_users` (`invited_by` nulo só no convite do primeiro dono). O nome e o papel vêm só do convite, nunca de
    `raw_user_meta_data` nem de `raw_app_meta_data`. Sem convite válido, não cria, e a pessoa não lê nada.
  - `profiles_guard` (antes de `update`): `role`, `is_active`, `deactivated_*` e `deactivation_*` só mudam dentro de
    `api.change_role` e `api.revoke_access`, com a chave da transação, `session_user = 'authenticator'` e
    `authz.can('manage_users')`; ninguém muda o próprio papel; o último dono ativo não perde o papel nem o acesso (a
    contagem vem depois de `select … for update` nos donos ativos).
- **Ao tirar o acesso** (`api.revoke_access`): saem `whatsapp_digits`, as `notification_preferences` e os
  `saved_filters` da pessoa, e os avisos pendentes dela viram `skipped`; a Edge Function `tirar-acesso` troca o e-mail
  do login por `removido+<id>@invalid`. Fica só o nome, pelo prazo da trilha.
- **Grava:** as funções de usuário e de preferências. **RLS:** cada um lê o próprio perfil; quem tem `manage_users`
  lê todos. O nome de quem aprovou aparece nas telas de tráfego por `api.v_traffic_log`, que devolve só o nome.

```sql
create table if not exists mkt.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) between 2 and 80),
  role mkt.role not null,
  is_active boolean not null default true,
  theme_preference mkt.theme_preference not null default 'device',
  default_brand mkt.brand_code,
  default_view mkt.view_mode not null default 'viewer',
  whatsapp_digits text check (whatsapp_digits ~ '^55[0-9]{10,11}$'),
  invited_by uuid references mkt.profiles(id),
  deactivated_at timestamptz,
  deactivated_by uuid references mkt.profiles(id),
  deactivation_reason mkt.deactivation_reason,
  deactivation_note text check (deactivation_note is null
                                or (length(deactivation_note) between 10 and 500
                                    and not mkt.has_personal_data(deactivation_note))),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  check (is_active = (deactivated_at is null)),
  check (is_active or deactivation_reason is not null),
  check (deactivation_reason is distinct from 'other' or deactivation_note is not null)
);
```

### `invitations` — convites

O link do convite é o do Supabase Auth (de uso único, com validade; o token não passa por esta tabela). Aqui fica o
papel que a pessoa recebe e o andamento.

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `email_normalized` | `text` | não | — | E-mail em minúsculas, sem espaço |
| `display_name` | `text` | não | — | Nome mostrado, digitado por quem convida (o perfil nasce com ele) |
| `role` | `mkt.role` | não | — | Papel que a pessoa recebe |
| `invited_by` | `uuid` | sim | — | Quem convidou; nulo só no primeiro dono (script) |
| `expires_at` | `timestamptz` | não | — | Validade (7 dias) |
| `accepted_at`, `accepted_profile_id` | | sim | — | Quando entrou e qual perfil nasceu |
| `revoked_at`, `revoked_by` | | sim | — | Convite cancelado |

- **Chave:** único parcial `(email_normalized) where accepted_at is null and revoked_at is null` (um convite aberto
  por e-mail; o gatilho de novo usuário ainda confere a validade). **Grava:** `api.invite_user`,
  `api.revoke_invitation`, `setup.create_first_owner_invitation` e o gatilho de novo usuário. **RLS:** lê
  `manage_users`. O `pg_cron` apaga a linha quando `coalesce(accepted_at, revoked_at, expires_at) < now() - interval
  '90 days'` (o e-mail é dado pessoal; o convite vencido também sai).

```sql
create table if not exists mkt.invitations (
  id uuid primary key default gen_random_uuid(),
  email_normalized text not null
    check (email_normalized = lower(btrim(email_normalized)) and email_normalized ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  display_name text not null check (length(btrim(display_name)) between 2 and 80),
  role mkt.role not null,
  invited_by uuid references mkt.profiles(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_profile_id uuid references mkt.profiles(id),
  revoked_at timestamptz,
  revoked_by uuid references mkt.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now())
);
create unique index if not exists invitations_one_open
  on mkt.invitations (email_normalized) where accepted_at is null and revoked_at is null;
```

### `notification_preferences` — avisos de cada pessoa

Sem linha, vale o padrão: e-mail em tudo, WhatsApp só no urgente (`mkt.notice_default`). A regra sai do
`avisos.ts` e vira função SQL; a tela mostra o que `api.my_notification_preferences()` devolve.

```sql
create table if not exists mkt.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references mkt.profiles(id) on delete cascade,
  notice mkt.notice_kind not null,
  is_email_enabled boolean not null,
  is_whatsapp_enabled boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (profile_id, notice)
);
```

- **Grava:** `api.save_notification_preference` (`edit_settings`, só o próprio). **RLS:** cada um lê o seu.

### `saved_filters` — "Meus filtros"

Conjuntos salvos por pessoa, como o prompt pede ("por usuário"); saem do `localStorage`.

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `profile_id` | `uuid` | não | — | Dono do conjunto |
| `scope` | `mkt.saved_filter_scope` | não | — | `bar` (barra de filtros) ou `traffic_list` (lista do Tráfego) |
| `name` | `text` | não | — | Nome, 1 a 40 letras; salvar de novo com o mesmo nome substitui |
| `filters` | `jsonb` | não | — | Só as chaves de filtro daquela barra (`mkt.valid_saved_filters(scope, filters)`) |

```sql
create table if not exists mkt.saved_filters (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references mkt.profiles(id) on delete cascade,
  scope mkt.saved_filter_scope not null,
  name text not null check (length(btrim(name)) between 1 and 40),
  filters jsonb not null check (mkt.valid_saved_filters(scope, filters)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (profile_id, scope, name)
);
```

- **Grava:** `api.save_filter` e `api.delete_saved_filter` (só o próprio). **RLS:** cada um lê os seus.

### `notification_outbox` — fila de avisos (decisão 0019)

O banco decide o que avisar (gatilho ou `pg_cron`), já com o horário de envio; o n8n lê, envia e marca.

| Coluna | Tipo | Nulo | Padrão | Descrição |
|---|---|---|---|---|
| `profile_id` | `uuid` | não | — | Quem recebe |
| `notice` | `mkt.notice_kind` | não | — | Qual aviso |
| `channel` | `mkt.notice_channel` | não | — | `email` ou `whatsapp` |
| `dedupe_key` | `text` | não | — | Única: o mesmo fato não vira dois avisos |
| `payload` | `jsonb` | não | — | Título, números, código da ação e link; nunca dado de cliente nem de lead (chaves conferidas por `mkt.valid_notice_payload`) |
| `send_after_at` | `timestamptz` | não | — | Agora, no urgente; no próximo horário comercial, no resto |
| `status` | `mkt.outbox_status` | não | `'pending'` | `pending`, `sent`, `failed`, `skipped` |
| `attempts`, `sent_at`, `error_code` | | — | — | Andamento |

```sql
create table if not exists mkt.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references mkt.profiles(id) on delete cascade,
  notice mkt.notice_kind not null,
  channel mkt.notice_channel not null,
  dedupe_key text not null unique,
  payload jsonb not null check (mkt.valid_notice_payload(notice, payload)),
  send_after_at timestamptz not null,
  status mkt.outbox_status not null default 'pending',
  attempts integer not null default 0 check (attempts between 0 and 5),
  sent_at timestamptz,
  error_code text check (error_code ~ '^[A-Z0-9_-]{2,40}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now())
);
create index if not exists notification_outbox_pending on mkt.notification_outbox (send_after_at) where status = 'pending';
```

- **Grava:** as funções que enfileiram (`private.enqueue_*`, chamadas por gatilho e pelo `pg_cron`) e o `n8n_notifier`
  (só `status`, `attempts`, `sent_at`, `error_code`, por `notify.*`). O que não é urgente e cai no mesmo horário
  comercial vai num resumo por pessoa e canal: `notify.claim_pending` junta as linhas pendentes com o mesmo
  `profile_id`, `channel` e `send_after_at` num item só, e `notify.mark_sent` fecha todas. Na hora de entregar, o banco
  confere de novo a permissão e a preferência (decisão 0019). **RLS:** nenhuma leitura para `authenticated`. Guarda
  90 dias.

### `holidays` — feriados (horário comercial dos avisos)

```sql
create table if not exists mkt.holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_on date not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now())
);
```

- Feriados nacionais carregados por migração a cada ano, até 1º de dezembro do ano anterior (item fixo de "Próximos
  passos" no `ESTADO.md`); usados só por `mkt.next_business_slot()`. **RLS:** lê quem tem perfil ativo.

### `role_permissions` — o que cada papel pode

A única lista de permissões do sistema (o `PERMISSOES` de `rules.ts` sai na fase 4; decisão 0018). Toda política e
toda função de ação consultam esta tabela por `authz.can(acao)`; a tela lê as permissões do usuário em
`api.my_permissions()` e o quadro dos dois papéis em `api.list_role_permissions()`.

```sql
create table if not exists mkt.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role mkt.role not null,
  action mkt.app_action not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (role, action)
);
```

- **Grava:** migração. **RLS:** lê quem tem perfil ativo (a tela de Usuários mostra o quadro).

### `audit_log` — auditoria do que não é tráfego

Convites, troca de papel, acesso tirado, conector ligado ou desligado, "Tentar de novo", exclusão em massa confirmada,
estado de credencial. Só acréscimo, como o `traffic_log`.

```sql
create table if not exists mkt.audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_kind mkt.actor_kind not null,
  actor_id uuid references mkt.profiles(id),
  event mkt.audit_event not null,
  target_table text not null check (target_table ~ '^[a-z_]{3,63}$'),
  target_id uuid,
  changes jsonb not null default '{}' check (mkt.valid_audit_changes(event, changes)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  check ((actor_kind = 'user') = (actor_id is not null))
);
create index if not exists audit_log_time on mkt.audit_log (occurred_at desc);
```

- `changes` nunca leva e-mail: `mkt.valid_audit_changes` aceita só as chaves previstas de cada evento (no convite, só
  `invitation_id` e o papel; na troca de papel, o papel antes e depois; no acesso tirado, o motivo).
- **Grava:** funções de ação e o worker (estado de credencial). **RLS:** lê `manage_users`. Guarda 2 anos.

---

## 6. Views base (nomes; regras em `metricas.md`)

| View | O que entrega |
|---|---|
| `mkt.v_leads` | Lead com origem classificada, UTM efetiva, campanha atribuída (ou UTM repetida), etapa e o 1º pedido que o converteu; o lead do SDR que virou negócio conta uma vez |
| `mkt.v_first_orders` | 1º pedido enviado por cliente e marca, com o histórico do retrato do ERP e o 1º pedido do grupo (decisões 0012, 0030 e 0042) |
| `mkt.v_new_customers` | Cliente novo na marca e no grupo, com o lead do primeiro toque (decisão 0031) |
| `mkt.v_customer_orders` | Pedidos enviados com a compra anterior na marca e no grupo (recompra, reativação, receita) |
| `mkt.v_customer_brand_status` | Situação, perdido manual e última compra por cliente e marca (também para quem só tem pedido, sem linha da view do CRM) |
| `mkt.v_campaigns` | Campanha com o operador, a chave da UTM e as marcas de UTM repetida (na mesma plataforma) e de nome repetido na marca |
| `mkt.v_account_month` | Por conta, no mês corrente: gasto até hoje, limite vigente, projeção, situação, alerta e campanhas ativas |
| `mkt.v_ga4_channel_daily`, `mkt.v_ga4_ai_daily` | Sessões do GA4 por canal e por assistente de IA |
| `mkt.v_ig_media_latest` | O retrato mais recente de cada post |
| `mkt.v_site_checks_latest` | Última checagem de cada item de cada site, com o estado |
| `mkt.v_connector_health` | Estado efetivo de cada conector (o pior entre os seus trabalhos), última rodada boa, atraso, trabalhos atrasados, falhas seguidas e o aviso da última rodada boa, quando ela terminou em parte |
| `api.v_traffic_actions` | Ações com campanha, conta, alerta e execução, sem prompt |
| `api.v_traffic_log` | Diário com o nome de quem fez (só o nome) |

Toda view, de `api` **e de `mkt`**, é `security_invoker = true`: a RLS das tabelas vale para quem chama, também quando
uma função de KPI lê a view base. As regras e o SQL das views e das funções `api.kpi_*` estão em
[`metricas.md`](metricas.md).

## Todas as tabelas

| Tabela | Esquema | Grão | Marca | Quem grava | Lê |
|---|---|---|---|---|---|
| `brands` | mkt | marca | é a marca | migração, worker | `view_numbers` |
| `ad_accounts` | mkt | conta de anúncio | não nula | script, worker | `view_numbers` |
| `campaigns` | mkt | campanha | não nula | worker, executor, função | `view_numbers` |
| `campaign_managed_by_history` | mkt | troca de operador | do pai | gatilho | `view_traffic` |
| `sales_reps` | mkt | pessoa do CRM ou login de app | sem | worker | `view_numbers` |
| `sales_rep_app_logins` | mkt | login de app por marca | não nula | worker | `view_numbers` |
| `ig_accounts` | mkt | perfil | não nula | script, worker | `view_numbers` |
| `web_properties` | mkt | propriedade GA4 ou Search Console | não nula | script, worker | `view_numbers` |
| `crm_funnels` | mkt | funil do CRM | sem | worker, script | `view_leads` |
| `crm_origin_map` | mkt | valor de origem | sem | migração | `view_leads` |
| `crm_customers` | mkt | cliente | sem | worker | `view_numbers` |
| `crm_customer_brands` | mkt | cliente × marca | não nula | worker | `view_numbers` |
| `crm_customer_reps` | mkt | cliente × marca × representante | não nula | worker | `view_numbers` |
| `crm_leads` | mkt | lead | nula = sem marca | worker | `view_leads` |
| `crm_orders` | mkt | pedido | não nula | worker | `view_numbers` |
| `crm_upstream_runs` | mkt | rodada apps → CRM | nula = sem marca | worker | `view_connectors` |
| `ad_campaign_daily` | mkt | campanha × dia | não nula | worker | `view_numbers` |
| `ad_activity_log` | mkt | alteração na plataforma | não nula | worker | `view_traffic` |
| `ig_account_daily` | mkt | perfil × dia | não nula | worker | `view_numbers` |
| `ig_media` | mkt | post | não nula | worker | `view_numbers` |
| `ig_media_daily` | mkt | post × dia do retrato | não nula | worker | `view_numbers` |
| `seo_daily` | mkt | propriedade × dia | não nula | worker | `view_numbers` |
| `seo_query_daily` | mkt | propriedade × dia × consulta | não nula | worker | `view_numbers` |
| `ga4_traffic_daily` | mkt | propriedade × dia × origem × meio × canal | não nula | worker | `view_numbers` |
| `site_checks` | mkt | site × item × dia | não nula | worker | `view_numbers` |
| `traffic_strategies` | mkt | marca × mês | não nula | função | `view_traffic` |
| `spend_limits` | mkt | conta × dia de vigência | não nula | função | `view_numbers` |
| `claude_runs` | mkt | rodada do Claude | nula = as duas | worker | `view_traffic` |
| `traffic_actions` | mkt | ação | não nula | função, worker, executor | `view_traffic` |
| `traffic_stops` | mkt | parada | nula = as duas | função | `view_traffic` |
| `traffic_stop_campaigns` | mkt | parada × campanha | não nula | função | `view_traffic` |
| `platform_executions` | mkt | chamada de escrita | não nula | função, banco (`pg_cron`), executor | `view_traffic` |
| `traffic_log` | mkt | evento do diário | nula = as duas | gatilho, função | `view_traffic` |
| `connectors` | mkt | integração | sem | migração, função, worker | `view_connectors` |
| `connector_jobs` | mkt | conector × trabalho | sem | migração, worker | `view_connectors` |
| `sync_runs` | mkt | rodada | nula = todas as contas | worker, função | `view_connectors` |
| `csv_imports` | mkt | arquivo CSV enviado | não nula | função, worker | `view_connectors` |
| `connector_credentials` | private | credencial | sem | script, worker (por função) | ninguém (o worker lê o segredo de leitura por função) |
| `profiles` | mkt | usuário | sem | gatilho, função | o próprio; `manage_users` |
| `invitations` | mkt | convite | sem | função, script, gatilho | `manage_users` |
| `notification_preferences` | mkt | pessoa × aviso | sem | função | o próprio |
| `saved_filters` | mkt | conjunto salvo | sem | função | o próprio |
| `notification_outbox` | mkt | aviso a enviar | sem | banco, n8n | ninguém pela API |
| `holidays` | mkt | feriado | sem | migração | perfil ativo |
| `role_permissions` | mkt | papel × permissão | sem | migração | perfil ativo |
| `audit_log` | mkt | evento de auditoria | sem | função, worker | `manage_users` |

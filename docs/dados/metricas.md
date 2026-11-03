# Métricas — views e funções de KPI

> Aprovado na fase 3, em 03/11/2026. O SQL aqui é a especificação: as migrações em `supabase/migrations/` o
> transformam em código, com os testes da seção 9.
> Tabelas em [`tabelas.md`](tabelas.md), listas em [`listas.md`](listas.md), acesso em
> [`papeis-e-rls.md`](papeis-e-rls.md), conectores em [`integracoes.md`](integracoes.md). Base: as consultas do
> protótipo aprovado (`apps/web/src/data/queries.ts` e `queries/*.ts`), os testes delas e as decisões 0001 a 0038.
> As decisões 0013 a 0038 foram aceitas em 03/11/2026; onde a conta depende de uma de produto (0021 a 0033), o texto
> diz qual.

## Como ler

- Cada número da tela leva o código do levantamento do protótipo (VG1, CH3, TR11…). A seção 6 tem um quadro por tela.
- **Filtros:** `M` marca · `P` período · `Cmp` comparar · `Ca` canal · `Cp` campanha · `Op` operador · `Or` origem ·
  `Rep` representante.
- **Sem dados** (seção 2.3): `N1` a fonte nunca trouxe dado → nulo · `N2` divisão por zero ou por nulo → nulo ·
  `N3` "Não se aplica" → nulo, com o motivo · `N4` a fonte tem base e nada cai no recorte → 0 · `N5` a fonte ainda não
  manda o dado → sempre nulo.
- **Testes do protótipo:** `[Q]` `apps/web/src/data/queries.test.ts` · `[VG]` `[CH]` `[BA]` `[LE]` `[CA]` `[IG]`
  `[SG]` `[TR]` `[CO]` `[SI]` = `apps/web/src/data/queries/{visao-geral, chegada-de-clientes, base-de-clientes, leads,
  canais, instagram, seo-geo, trafego-ia, conectores, sistema}.test.ts` · `[PE]` `apps/web/src/lib/periodo.test.ts` ·
  `[RU]` `packages/shared/src/rules.test.ts` · `[RE]` `apps/web/src/modules/trafego-ia/regras.test.ts` · `[OP]`
  `apps/web/src/modules/canais/operacoes.test.ts`. **muda** = o caso continua, esperando outro valor, pela decisão
  citada. Os testes em SQL ficam em `supabase/tests/kpi/` (seção 9).

---

## 1. Do banco à tela (decisão 0034)

```
tabelas (mkt) ─► 1. fatos: views mkt.v_* ─► 2. fórmulas: funções mkt.* ─► 3. tela: api.kpi_* e api.list_* ─► React
```

1. **Fatos.** Uma linha por coisa (lead, 1º pedido, cliente novo, conta no mês, conector), com as derivações de uma
   regra só. Não recebem filtro de tela.
2. **Fórmulas.** Recortes (`mkt.campaigns_in_scope`, `mkt.leads_in_scope`, `mkt.new_customers`), somas e razões
   (`mkt.acquisition`, `mkt.ad_summary`, `mkt.pace`). Cada fórmula mora numa função só.
3. **Tela.** Uma função por tela recebe os filtros, chama as fórmulas e devolve um `jsonb` pequeno, já agregado. Lista
   tem função própria, com no máximo 200 itens e o total.

Regras:

- O React chama `api.*` e só formata. Não soma, não conta, não divide, não ordena número.
- **Nenhuma chamada traz mais de 1.000 linhas.** A função de tela devolve um valor só (o `jsonb`), e lista para em 200
  itens por página. O limite de 1.000 linhas do Supabase nunca corta uma conta, porque toda conta acontece no banco.
- Número com comparação sai como `{"current": …, "previous": …, "variation": …}`. Sem comparação, `previous` e
  `variation` vêm nulos. A comparação usa só os dias completos de cada fonte (seção 2.1).
- Dinheiro em centavos inteiros (custo arredondado no fim; meio centavo arredonda para cima). Taxa e parte como fração
  de 0 a 1, com 4 casas. ROAS com 2 casas. A variação é calculada antes de arredondar.
- Toda função de tela é `stable`, `security invoker` e `set search_path = ''`. A primeira linha confere **todas** as
  permissões das tabelas que a função lê (`authz.can`; seção 5): um papel sem uma delas recebe `KPI-403`, nunca um 0
  que a RLS produziu ao esconder as linhas. Os filtros só são lidos depois disso. A RLS das tabelas vale porque toda
  view, em `api` **e em `mkt`**, nasce com `security_invoker = true`. Filtro inválido: `PT400` / `KPI-400`. Sem
  permissão: `PT403` / `KPI-403`.
- **Desempenho.** Cada função de tela lê cada fonte uma vez por chamada: os leads, os clientes novos e o gasto do
  período atual e do anterior saem de CTEs materializadas sobre o intervalo que cobre os dois, e cada lado é um
  `count(*) filter (where …)` sobre elas (`mkt.acquisition`, seção 4.3). Marca, canal e total saem dos mesmos CTEs com
  `grouping sets`, e a fórmula de cada número continua numa função só (`mkt.acquisition_ratios`, `mkt.pace`…), aplicada
  sobre as somas. Meta: cada chamada em até 300 ms, medida na fase 4 com vários anos de dados inventados. Se passar da
  meta, `mkt.v_leads` e `mkt.v_new_customers` viram tabelas refeitas pelo worker no fim de cada rodada do CRM já na v1,
  com decisão nova.

### 1.1 Os filtros

A URL continua como está no protótipo. A tela traduz a URL para o objeto de filtros numa função só
(`apps/web/src/data/fonte.ts`, com teste), e o banco recebe códigos em inglês (decisão 0016).

| Chave | Na URL | Valores no banco | Ausente |
|---|---|---|---|
| `brand` | `marca` | `cs`, `plumene` | as duas (`todas`) |
| `period` | `periodo` | `this_month`, `last_month`, `last_7_days`, `last_30_days`, `last_90_days` (`mkt.period_code`; `este-mes`, `mes-passado`, `7d`, `30d`, `90d` na URL) | `this_month` |
| `compare` | `comparar` | `true`, `false` | `true` |
| `platform` | `canal` | `meta`, `tiktok`, `google` | todos os canais |
| `campaign` | `campanha` | id da campanha (o daqui ou o da plataforma) ou `utm_campaign` | todas |
| `operator` | `operador` | `human`, `claude` | os dois (`todos`) |
| `origin` | `origem` | as origens de `mkt.lead_origin` | todas |
| `sales_rep` | `representante` | código `REP-0001` | todos |

Chave desconhecida ou código fora da lista: `KPI-400`. Campanha ou representante que não existe (link antigo): o
recorte fica vazio e as contagens dão 0, sem erro.

```sql
create domain mkt.period_code as text
  check (value in ('this_month', 'last_month', 'last_7_days', 'last_30_days', 'last_90_days'));

create type mkt.kpi_filters as (
  brand_id     uuid,              -- nulo = as duas
  period       mkt.period_code,
  compare      boolean,
  platform     mkt.platform,      -- nulo = todos os canais
  campaign_ids uuid[],            -- nulo = todas; vazio = a campanha da URL não existe
  operator     mkt.operator,      -- nulo = os dois
  origin       mkt.lead_origin,   -- nulo = todas
  sales_rep_id uuid               -- nulo = todos
);

create or replace function mkt.parse_filters(p jsonb) returns mkt.kpi_filters
language plpgsql stable set search_path = '' as $$
declare
  f mkt.kpi_filters;
  v_none constant uuid := '00000000-0000-0000-0000-000000000000';   -- não casa com nenhuma linha
begin
  p := coalesce(p, '{}');
  if jsonb_typeof(p) <> 'object' or exists (
       select 1 from jsonb_object_keys(p) k
        where k not in ('brand', 'period', 'compare', 'platform', 'campaign', 'operator', 'origin', 'sales_rep')) then
    raise sqlstate 'PT400' using message = 'KPI-400';
  end if;

  if p->>'brand' is not null then
    f.brand_id := coalesce((select b.id from mkt.brands b where b.code = (p->>'brand')::mkt.brand_code), v_none);
  end if;
  f.period   := coalesce(p->>'period', 'this_month');
  f.compare  := coalesce((p->>'compare')::boolean, true);
  f.platform := p->>'platform';
  f.operator := p->>'operator';
  f.origin   := p->>'origin';
  if p->>'campaign' is not null then
    f.campaign_ids := array(select c.id from mkt.campaigns c
                             where c.id::text = p->>'campaign'
                                or c.external_id = btrim(p->>'campaign')
                                or c.utm_campaign_key = mkt.utm_key(p->>'campaign'));
  end if;
  if p->>'sales_rep' is not null then
    f.sales_rep_id := coalesce((select r.id from mkt.sales_reps r where r.code = p->>'sales_rep'), v_none);
  end if;
  return f;
exception
  when check_violation or invalid_text_representation then
    raise sqlstate 'PT400' using message = 'KPI-400';
end $$;
```

---

## 2. Regras comuns

### 2.1 Dia e período (decisão 0026)

- **Dia** é o do calendário de `America/Sao_Paulo` (UTC−3 o ano inteiro, sem horário de verão). Um instante vira dia
  por `mkt.sp_day`. O dia que a plataforma entrega (`metric_on`) fica como veio (decisão 0016).
- **Hoje** é o relógio do banco, no fuso de São Paulo. `mkt.now()` lê o relógio de `test.clock` só quando
  `to_regclass('test.clock')` não é nulo. Essa tabela só existe no PGlite (testes e modo demonstração), criada pelo
  arquivo de apoio (`supabase-shim.sql`). O arquivo também dá `usage` no esquema `test` e `select` em `test.clock` a
  `authenticated`, `mkt_worker` e `mkt_executor`: `mkt.now()` roda com os direitos de quem chama, e sem `usage` o
  `to_regclass` dá erro em vez de nulo. Vazia, vale `now()`. Em produção vale `now()`: nenhuma sessão, nem a do worker
  ou do executor, muda o "hoje" das contas (não há configuração de sessão que mexa no relógio).
- As pontas do intervalo entram (`[início, fim]`). Instante nulo nunca entra.

| Período | Intervalo | Anterior (comparação) |
|---|---|---|
| Este mês | dia 1 → hoje | dia 1 → o mesmo dia do mês anterior; se o mês anterior for mais curto, até o último dia dele (decisão 0026) |
| Mês passado | o mês anterior inteiro | o mês antes dele, inteiro |
| 7, 30 e 90 dias | hoje − N + 1 → hoje | os N dias antes do início |

- **Dias completos de cada fonte.** Cada fonte tem dias que ainda não fecharam: o anúncio tem hoje pela metade, o GA4
  não tem hoje e tem ontem parcial, o Search Console com `dataState=final` não tem os últimos 2 a 3 dias, o Instagram
  atrasa até 48 h. A janela anterior está completa. `mkt.complete_through(code)` devolve o último dia fechado:
  anúncios e CSP 360 = ontem; GA4 = o último dia lido 12 h depois de fechar; Search Console = o maior `metric_on` com
  dado final; Instagram = anteontem. O `current` mostra até agora; a `variation` compara só os dias completos, o mesmo
  número de dias nos dois lados, sem passar do fim do período anterior (`comparable_current` e `comparable_previous`):
  em "Este mês", o mês anterior mais curto para no último dia dele, e "Mês passado" compara os dois meses inteiros. No
  dia 1 de "Este mês", ainda não há dia completo: a variação fica nula, nunca uma queda. A tela diz "até {data}" quando
  a fonte para antes de hoje.
- **Mês corrente** (limites, verba e estratégia): dia 1 → hoje, com dias decorridos e dias do mês. Não muda com o
  período escolhido.
- **Coorte:** os 4 meses que terminam no mês do fim do intervalo.
- **Contas de tempo:** dias = diferença de dias de São Paulo; horas = diferença de instantes ÷ 3.600, com fração;
  minutos de conector arredondados, nunca abaixo de 0.

```sql
-- mkt.now e mkt.today ficam na migração 01 (plano.md): a trava do limite, na 10, já usa.
create or replace function mkt.now() returns timestamptz
language plpgsql stable set search_path = '' as $$
declare
  v timestamptz;
begin
  -- Só nos testes: o arquivo de apoio do PGlite cria test.clock. Em produção a tabela não existe.
  if to_regclass('test.clock') is not null then
    execute 'select max(now_at) from test.clock' into v;
  end if;
  return coalesce(v, now());
end $$;

create or replace function mkt.today() returns date
language sql stable set search_path = '' as $$
  select (mkt.now() at time zone 'America/Sao_Paulo')::date
$$;

-- mkt.sp_day (dia de São Paulo de um instante) fica na migração 01: tabelas.md, "Peças comuns".

create type mkt.period_window as (
  current_window      daterange,   -- [início, hoje] em dias de São Paulo: o valor mostrado
  previous_window     daterange,   -- o período anterior inteiro
  comparable_current  daterange,   -- [início, último dia completo da fonte]; nulo sem dia completo
  comparable_previous daterange,   -- os mesmos N dias, contados do início do anterior
  days                integer
);

create or replace function mkt.period_window(p_period mkt.period_code, p_complete_through date default null,
                                             p_today date default null)
returns mkt.period_window
language plpgsql stable set search_path = '' as $$
declare
  v_today      date := coalesce(p_today, mkt.today());
  v_month      date := date_trunc('month', v_today)::date;
  v_prev_month date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_n          integer;
  v_start      date;
  w            mkt.period_window;
  v_end        date;
begin
  if p_period = 'this_month' then
    w.current_window  := daterange(v_month, v_today, '[]');
    -- os mesmos dias do mês anterior, até o último dia dele (decisão 0026).
    w.previous_window := daterange(v_prev_month, least(v_prev_month + (v_today - v_month), v_month - 1), '[]');
    w.days := v_today - v_month + 1;
  elsif p_period = 'last_month' then
    w.current_window  := daterange(v_prev_month, v_month - 1, '[]');
    w.previous_window := daterange((v_prev_month - interval '1 month')::date, v_prev_month - 1, '[]');
    w.days := v_month - v_prev_month;
  else
    v_n := case p_period when 'last_7_days' then 7 when 'last_30_days' then 30 else 90 end;
    v_start := v_today - (v_n - 1);
    w.current_window  := daterange(v_start, v_today, '[]');
    w.previous_window := daterange(v_start - v_n, v_start - 1, '[]');
    w.days := v_n;
  end if;

  -- Dias completos: corta o atual no último dia fechado da fonte e o anterior no mesmo número de dias.
  v_end := least(upper(w.current_window) - 1, coalesce(p_complete_through, upper(w.current_window) - 1));
  if v_end >= lower(w.current_window) then
    w.comparable_current  := daterange(lower(w.current_window), v_end, '[]');
    w.comparable_previous := case
      -- "Mês passado" com o mês todo fechado: o mês antes dele, inteiro (decisão 0026), mesmo quando é mais longo.
      when p_period = 'last_month' and v_end = upper(w.current_window) - 1 then w.previous_window
      else daterange(lower(w.previous_window),
                     least(lower(w.previous_window) + (v_end - lower(w.current_window)),
                           upper(w.previous_window) - 1), '[]')
    end;
  end if;
  return w;
end $$;

-- Para a tela montar o rótulo ("vs. 1º a 3 de outubro") sem fazer conta de data.
create or replace function mkt.period_json(w mkt.period_window) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'start_on', lower(w.current_window), 'end_on', upper(w.current_window) - 1,
    'compared_through_on', upper(w.comparable_current) - 1,
    'previous_start_on', lower(w.comparable_previous), 'previous_end_on', upper(w.comparable_previous) - 1,
    'days', w.days)
$$;
```

### 2.2 O que cada filtro recorta

| Fato | `M` | `Ca` | `Op` | `Cp` | `Or` | `Rep` | `P` |
|---|---|---|---|---|---|---|---|
| Campanha (`mkt.campaigns_in_scope`) | `brand_id = X` | `platform` | `managed_by` | id (daqui ou da plataforma), ou chave da UTM igual | — | — | — (qualquer status) |
| Gasto (`ad_campaign_daily`) | pela campanha | pela campanha | pela campanha | pela campanha | — | — | `metric_on` |
| Lead (`mkt.leads_in_scope`) | X **ou sem marca** | origem do lead = canal | campanha atribuída do operador | campanha atribuída | `origin` | quem recebeu (`assigned_rep_id`) | `created_on` |
| Cliente novo (`mkt.new_customers`) | escopo da marca; sem marca, escopo do grupo (seção 2.4) | origem do lead do crédito | campanha do lead do crédito | campanha do lead do crédito | origem do lead do crédito | quem recebeu o lead do crédito | `first_order_on` |
| Pedido | `brand_id = X` | — | — | — | — | — | dia do envio |
| Cliente (Base) | compra e situação na marca; sem marca, em qualquer marca | — | — | — | — | carteira na marca (`crm_customer_reps`) | pedidos do período |
| Instagram | perfil da marca | — | — | — | — | — | `metric_on`, `published_at` |
| Search Console, GA4 | propriedade da marca | — | — | — | — | — | `metric_on` |
| Checagem dos sites | site da marca | — | — | — | — | — | a mais recente |
| Ação de tráfego | `brand_id = X` (ação sempre tem marca) | `platform = X` (ação sem canal sai) | `proposed_by_kind` | `campaign_id` | — | — | listas sem janela; contagens com janela |
| Diário | marca do evento, ou evento das duas marcas | evento de ação: canal da ação (ação sem canal some); limite: canal do evento; parar, desfazer e estratégia ficam | evento de ação: `proposed_by_kind` da ação; com `human`, somem parar e desfazer; limite e estratégia ficam | evento de ação: campanha da ação; parar e desfazer só se pausaram a campanha (`traffic_stop_campaigns`); limite e estratégia somem | — | — | `occurred_at` |
| Conectores, usuários | — | — | — | — | — | — | — |

Com a decisão 0031, a origem do lead atribuído é a plataforma da campanha. Por isso "canal" e "origem paga" dizem a
mesma coisa no lead, e a soma das células por canal fecha com o total atribuído.

No Diário, o evento de execução (`execution_status_changed`) segue o filtro da ação, da parada ou do limite que a
gerou.

### 2.3 Sem dados × 0 (decisão 0034)

A regra do protótipo (nulo quando **a tabela inteira** está vazia) vira: **a fonte tem base quando o conector já
trouxe dado alguma vez** (`connectors.first_success_at`, que nunca volta a nulo) **e a conta, o perfil ou a propriedade
da marca também** (`first_read_at`). Sem base, o número é nulo e a tela diz "Sem dados". Com base e nada no recorte,
é 0. Na série por dia, o retrato (Instagram, Search Console, GA4) fica nulo no dia sem linha, mesmo com base. O fato
de evento (gasto, leads, clientes, pedidos) dá 0 no dia sem nada (seção 7, nº 13). Dado do próprio CSP-MKT (ações,
estratégia, limites, diário) sempre tem base: zero é zero.

| Fonte | Tem base quando | Exemplo |
|---|---|---|
| Gasto, campanhas, impressões | o conector da plataforma já trouxe dado **e** a conta da marca nele já foi lida (`ad_accounts.first_read_at`) | TikTok "A ligar": a linha do TikTok fica "Sem dados"; o total soma só os canais com base e a tela diz quais faltam |
| Leads, clientes, pedidos | `csp360` já trouxe dado | — |
| Situação do cliente | alguma linha de `crm_customer_brands` tem situação (a view do CRM existe) | sem a view: Ativos, Inativos e Perdidos "Sem dados" |
| Instagram | o conector já trouxe dado e o perfil ativo da marca já foi lido (`mkt.ig_covered`) | perfil de uma marca ainda não ligado: a marca fica "Sem dados", a outra mostra os números |
| Search Console, GA4 | o conector já trouxe dado e a propriedade ativa da marca daquele tipo já foi lida (`mkt.web_covered`) | um site já mede e o outro não: o segundo fica "Sem dados", não 0 |
| Checagem dos sites | existe checagem do site da marca | — |
| Valor faturado, tempo entre as etapas do meio | nunca, até o CRM mandar o dado | `N5` |

Cada `api.kpi_*` devolve também `coverage` (`{"csp360": true, "meta": true, "tiktok": false, …}`), para a tela dizer
"A ligar" no lugar certo, e `has_data` (estado vazio da tela, quadro abaixo).

```sql
create or replace function mkt.source_covered(p_code mkt.connector_code) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select c.first_success_at is not null from mkt.connectors c where c.code = p_code), false)
$$;

-- Gasto: o canal tem base e a conta da marca nele já foi lida. Sem canal: algum canal com base.
create or replace function mkt.ads_covered(p_brand_id uuid, p_platform mkt.platform) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1
      from mkt.ad_accounts a
      join mkt.connectors c
        on c.code = case a.platform when 'google' then 'google_ads' else a.platform::text end
     where c.first_success_at is not null and a.first_read_at is not null
       and (p_brand_id is null or a.brand_id = p_brand_id)
       and (p_platform is null or a.platform = p_platform))
$$;

-- Instagram: o conector tem base e o perfil ativo da marca já foi lido.
create or replace function mkt.ig_covered(p_brand_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select mkt.source_covered('instagram')
     and exists (select 1 from mkt.ig_accounts a
                  where a.is_active and a.first_read_at is not null
                    and (p_brand_id is null or a.brand_id = p_brand_id))
$$;

-- Search Console e GA4: o conector tem base e a propriedade ativa da marca daquele tipo já foi lida.
create or replace function mkt.web_covered(p_brand_id uuid, p_kind mkt.web_property_kind) returns boolean
language sql stable set search_path = '' as $$
  select mkt.source_covered((case p_kind when 'ga4_property' then 'ga4' else 'search_console' end)::mkt.connector_code)
     and exists (select 1 from mkt.web_properties w
                  where w.is_active and w.kind = p_kind and w.first_read_at is not null
                    and (p_brand_id is null or w.brand_id = p_brand_id))
$$;
```

Todas leem `connectors`, que a RLS libera com `view_connectors`. Os dois papéis têm; quem não tivesse receberia
`KPI-403` (decisão 0034).

**Estado vazio da tela** (o `.yn-empty` com o próximo passo), pela fonte de cada tela:

| Tela | Vazia quando |
|---|---|
| Visão geral | nenhuma fonte tem base (CSP 360, anúncios e Instagram) |
| Chegada, Leads, Base | o CSP 360 não tem base |
| Meta, TikTok, Google | o conector da rota não tem base e não há campanha |
| Instagram | o Instagram não tem base |
| SEO e GEO | Search Console, GA4, checagem e CSP 360 sem base |
| Tráfego com IA | nenhuma campanha e nenhuma ação |
| Conectores | nunca (os sete cartões existem desde a migração) |

### 2.4 Marca e "As duas" (decisões 0003, 0014 e 0030)

- Fato com marca: `brand_id = X`. "As duas": sem filtro de marca.
- Lead sem marca: entra em toda marca escolhida e em "As duas", contado uma vez; a tela separa "Sem marca".
- **Cliente novo:** com uma marca, o 1º pedido enviado **naquela marca**; em "As duas", o 1º pedido enviado **do
  grupo**, cada cliente uma vez (decisão 0030). Quem já comprava de uma marca e estreou na outra é novo da segunda
  marca, mas não do grupo.
- **Antigo, recompra, reativado, última compra:** no recorte da marca escolhida; em "As duas", em qualquer marca.
- **Situação:** a da marca escolhida; em "As duas", a melhor entre as marcas: a de menor
  `mkt.list_rank('customer_situation', …)` (ativo, inativo recente, inativo antigo, perdido, lead; seção 8). Nula só
  quando nenhuma marca tem situação.
- **Quebra por marca em "As duas":** cada linha com a regra da marca e o total com a regra do grupo. A soma das marcas
  pode passar do total; a tela mostra quantos clientes estrearam numa marca já comprando da outra
  (`cross_brand_new_customers`).

### 2.5 Comparação

- `variation = (atual comparável − anterior comparável) ÷ |anterior comparável|`, só com os dias completos da fonte
  (seção 2.1); nula se algum lado é nulo, se o anterior é 0 ou se ainda não há dia completo. `previous` mostra o
  anterior comparável, e o rótulo diz as datas dele.
- **Nunca comparam** (decisão 0029): "Leads que viraram cliente", as etapas do funil depois de "Leads", a coorte e a
  conversão por origem, marca, campanha e representante. O lead mais novo teve menos tempo para comprar.
- Humano × Claude: `difference = (claude − humano) ÷ |humano|`, sem comparação com o período anterior.

```sql
create or replace function mkt.ratio(p_num numeric, p_den numeric) returns numeric
language sql immutable parallel safe set search_path = '' as $$
  select case when p_num is null or p_den is null or p_den = 0 then null else p_num / p_den end
$$;

create or replace function mkt.round_as(p numeric, p_kind text) returns numeric
language sql immutable parallel safe set search_path = '' as $$
  select case p_kind
           when 'money'    then round(p)       -- centavos inteiros; meio centavo arredonda para cima
           when 'fraction' then round(p, 4)    -- taxa e parte, de 0 a 1
           when 'decimal'  then round(p, 2)    -- ROAS
           else p end                          -- contagem
$$;

-- O valor mostrado é o de até agora; a variação compara os dias completos dos dois lados (seção 2.1).
create or replace function mkt.metric(p_current numeric, p_comparable_current numeric, p_comparable_previous numeric,
                                      p_compare boolean, p_kind text default 'count') returns jsonb
language sql immutable parallel safe set search_path = '' as $$
  select jsonb_build_object(
    'current',   mkt.round_as(p_current, p_kind),
    'previous',  case when p_compare then mkt.round_as(p_comparable_previous, p_kind) end,
    'variation', case when p_compare
                      then round(mkt.ratio(p_comparable_current - p_comparable_previous, abs(p_comparable_previous)), 4)
                 end)
$$;
```

### 2.6 Custo com origem ou representante (decisão 0032)

Com representante, o custo "Não se aplica": o investimento não se divide por representante. Com origem de mídia paga,
a origem vira o canal. Com outra origem, ou com origem paga diferente do canal escolhido, "Não se aplica". Leads,
clientes novos e taxas continuam com todos os filtros. A regra vale em toda tela, também na Visão geral quando a URL
trouxer esses filtros.

```sql
create domain mkt.not_applicable_reason as text check (value in ('sales_rep', 'origin'));

create type mkt.cost_scope as (filters mkt.kpi_filters, not_applicable mkt.not_applicable_reason);

create or replace function mkt.cost_scope(f mkt.kpi_filters) returns mkt.cost_scope
language plpgsql immutable set search_path = '' as $$
begin
  if f.sales_rep_id is not null then
    return row(f, 'sales_rep')::mkt.cost_scope;
  end if;
  if f.origin is not null then
    if f.origin::text not in ('meta', 'tiktok', 'google')
       or (f.platform is not null and f.platform::text <> f.origin::text) then
      return row(f, 'origin')::mkt.cost_scope;
    end if;
    f.platform := f.origin::text;     -- origem paga vira o canal
    f.origin := null;
  end if;
  return row(f, null)::mkt.cost_scope;
end $$;
```

---

## 3. Lead, cliente novo e atribuição (as views base)

### 3.1 Origem do lead

A regra de `classificarOrigem` (`packages/shared/src/rules.ts`) passa para SQL, com os mesmos casos de teste. Ordem:

1. Lead do SDR → `sdr`.
2. Lead com UTM (a dele ou a herdada, seção 3.2) → classificação pela UTM: de assistente de IA (também em forma de
   domínio, como `chatgpt.com`, que o ChatGPT põe nos links) → `ai_assistant`; fonte da Meta → `meta`; do TikTok →
   `tiktok`; do Google com meio pago → `google`, sem meio pago → `organic`; `sdr`/`whatsapp` → `sdr`; `site` → `site`;
   `direct` → `direct`; outra → `referral`.
3. Sem UTM e com `referrer` (quando o CRM passar a gravar): redirecionador do Google Ads → `google`; assistente de IA
   → `ai_assistant`; buscador → `organic`; os próprios sites (`web_properties.host`) → `site`; outro site →
   `referral`. É o que separa busca orgânica e IA do lead do site que chega sem UTM.
4. Sem UTM e sem `referrer`: o texto `negocios.origem` do CRM passa pelo de-para `crm_origin_map` (rótulos do ClickUp,
   `site`).
5. Fora do de-para, o texto gravado é uma fonte de UTM conhecida e vai para a mesma classificação. Texto fora do de-para
   e das fontes conhecidas não é gravado (`is_origin_unmapped`, [`tabelas.md`](tabelas.md), seção 2) e o lead fica
   `referral`; sem texto nenhum → `direct`.
6. **A campanha casada vence** (decisão 0031): lead atribuído a uma campanha tem a origem igual à plataforma dela.

A lista de assistentes de IA mora só em `mkt.ai_source_of`, e a de fontes de UTM, só em `mkt.utm_source_family`: a
classificação, o GA4 e a gravação da origem (`mkt.is_known_origin_text`) usam as mesmas. O negócio com
`is_origin_unmapped` é contado na tela de Leads (`unmapped_origin_count`), para o de-para ganhar a linha que falta
(migração, conferida no CSP 360). As funções de origem abaixo, até `mkt.is_known_origin_text`, entram na migração 10,
antes das `ingest.*` que as usam ([`plano.md`](plano.md)).

```sql
-- Host de um endereço: tira protocolo, usuário, porta e caminho; depois www., m., l. e lm. (nessa ordem),
-- como o host() de rules.ts.
create or replace function mkt.url_host(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select nullif(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      regexp_replace(lower(btrim(coalesce(p, ''))), '^[a-z][a-z0-9+.-]*://(?:[^@/]*@)?([^/:?#]+).*$', '\1'),
      '^www\.', ''), '^m\.', ''), '^l\.', ''), '^lm\.', ''),
    '')
$$;

-- Sufixo terminado em ponto ("google.") vale em qualquer lugar do host; o resto, host igual ou subdomínio.
create or replace function mkt.host_matches(p_host text, p_patterns text[]) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(bool_or(case when right(s, 1) = '.' then strpos(p_host, s) > 0
                               else p_host = s or right(p_host, length(s) + 1) = '.' || s end), false)
    from unnest(p_patterns) s
$$;

-- Assistente de IA de uma fonte (utm_source, sessionSource do GA4 ou referrer). A lista mora só aqui.
-- Criada antes de classify_lead_origin na migração.
create or replace function mkt.ai_source_of(p_session_source text, p_channel_group text) returns mkt.ai_source
language sql immutable parallel safe set search_path = '' as $$
  select (case
    when mkt.host_matches(h, '{chatgpt.com,chat.openai.com}') or h in ('chatgpt', 'openai') then 'chatgpt'
    when mkt.host_matches(h, '{perplexity.ai}') or h = 'perplexity' then 'perplexity'
    when mkt.host_matches(h, '{claude.ai}') or h in ('claude', 'anthropic') then 'claude'
    when mkt.host_matches(h, '{gemini.google.com}') or h = 'gemini' then 'gemini'
    when mkt.host_matches(h, '{copilot.microsoft.com}') or h = 'copilot' then 'copilot'
    when p_channel_group = 'AI Assistant' then 'other'
  end)::mkt.ai_source
  from (select coalesce(mkt.url_host(p_session_source), '') as h) x
$$;

-- Família da fonte de UTM. A lista de fontes mora só aqui: a classificação e a gravação da origem usam.
create or replace function mkt.utm_source_family(p_source text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case
    when s = '' then null
    when mkt.ai_source_of(s, null) is not null then 'ai_assistant'   -- antes da Meta: "chatgpt.com" é IA
    when s = any ('{meta,facebook,fb,instagram,ig,fbig}') then 'meta'
    when s = any ('{tiktok,tt}') then 'tiktok'
    when s = any ('{google,adwords,googleads,youtube,bing,microsoft}') then 'search'
    when s in ('sdr', 'whatsapp') then 'sdr'
    when s = 'site' then 'site'
    when s in ('direct', '(direct)') then 'direct'
  end
  from (select lower(btrim(coalesce(p_source, ''))) as s) x
$$;

-- O texto de negocios.origem pode ser gravado? Só se é uma fonte conhecida (o de-para é conferido à parte).
create or replace function mkt.is_known_origin_text(p text) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select mkt.utm_source_family(p) is not null
$$;

create or replace function mkt.classify_lead_origin(p_referrer text, p_utm_source text, p_utm_medium text,
                                                    p_own_hosts text[]) returns mkt.lead_origin
language sql immutable parallel safe set search_path = '' as $$
  with v as (
    select lower(btrim(coalesce(p_utm_source, ''))) as src,
           lower(btrim(coalesce(p_utm_medium, ''))) as med,
           coalesce(mkt.url_host(p_referrer), '') as h
  )
  select (case
    when src <> '' then case mkt.utm_source_family(src)
      when 'ai_assistant' then 'ai_assistant'
      when 'meta'   then 'meta'
      when 'tiktok' then 'tiktok'
      when 'search' then
        case when med = any ('{cpc,ppc,paid,paidsearch,paid_social,paidsocial,cpm,display,pmax,video,ads}')
             then 'google' else 'organic' end
      when 'sdr'    then 'sdr'
      when 'site'   then 'site'
      when 'direct' then 'direct'
      else 'referral' end
    when h = '' then 'direct'
    when mkt.host_matches(h, '{googleads.g.doubleclick.net,googleadservices.com,syndicatedsearch.goog}') then 'google'
    when mkt.ai_source_of(h, null) is not null then 'ai_assistant'
    when mkt.host_matches(h, '{google.,bing.com,duckduckgo.com,yahoo.com,ecosia.org}') then 'organic'
    when mkt.host_matches(h, p_own_hosts) then 'site'
    else 'referral'
  end)::mkt.lead_origin
  from v
$$;
```

O teste de paridade (decisão 0018) roda os casos de `[RU]` "classificarOrigem" nas duas versões, com os hosts dos dois
sites, até a versão em TypeScript sair, mais os novos: `utm_source=chatgpt.com` → `ai_assistant` e
`utm_source=perplexity.ai` → `ai_assistant` (no protótipo eles caem em `referral`: **muda**).

### 3.2 UTM e campanha (decisão 0031)

1. **UTM do lead:** a do próprio lead, quando o CRM passar a gravar por envio. Até lá, a UTM de primeiro contato do
   cliente vale **só** para o negócio do site que a gravou: o primeiro negócio do cliente cuja origem no CRM é igual à
   `utm_source` de primeiro contato. Os outros leads do cliente ficam sem UTM.
2. **Campanha:** primeiro pelo id. Quando a `utm_campaign` é o id da campanha na plataforma (`{{campaign.id}}` na
   Meta, `__CAMPAIGN_ID__` no TikTok, `{campaignid}` no Google, no sufixo do link), casa com `campaigns.external_id`:
   o id nunca se repete. Sem candidata pelo id, a chave da `utm_campaign` (`mkt.utm_key`: minúsculas, espaços simples)
   casa com o nome da campanha. Nos dois casos: mesma marca do lead (lead sem marca: qualquer marca) e, quando a UTM
   diz a plataforma (origem `meta`, `tiktok` ou `google`), a mesma plataforma.
3. Uma candidata → **atribuído**. Mais de uma → **UTM repetida**: o lead não é atribuído a nenhuma, e a tela mostra a
   pendência "Duas campanhas com o mesmo nome". Nenhuma → sem atribuição.
4. **Crédito do cliente novo: primeiro toque.** O primeiro lead do cliente antes do 1º pedido (na marca: leads da marca
   ou sem marca; no grupo: qualquer lead). Desempate pelo código. A campanha e a origem desse lead são as do cliente
   novo.

A pendência e a marca na linha da campanha saem da mesma conta da atribuição:

- `is_utm_ambiguous` (o mesmo nome na mesma marca e plataforma): nenhum lead é atribuído pelo nome a essas campanhas
  (custo por cliente novo e ROAS nulos na linha, marca "UTM repetida").
- `has_utm_name_conflict` (o mesmo nome na mesma marca, em plataformas diferentes): só o lead com `utm_source` paga é
  atribuído pelo nome, e a pendência aparece também nesse caso.
- O lead que chega pelo id da campanha nunca é ambíguo.

```sql
create or replace view mkt.v_campaigns with (security_invoker = true) as
select c.*,
       count(*) over (partition by c.brand_id, c.platform, c.utm_campaign_key) > 1 as is_utm_ambiguous,
       count(*) over (partition by c.brand_id, c.utm_campaign_key) > 1 as has_utm_name_conflict
  from mkt.campaigns c;
```

### 3.3 Etapa e conversão do lead

| Etapa | Quando |
|---|---|
| `invoiced` | o 1º pedido que converteu o lead está faturado (`is_invoiced`) |
| `first_order` | o cliente fez o 1º pedido enviado da marca do lead (sem marca: de qualquer marca) **depois** de o lead chegar, e não comprava essa marca antes |
| `registered` | o app ou o ERP conhecem o cliente (`is_known_by_erp`, `has_app_owner` ou status diferente de prospecto) |
| `prospect` | o lead tem cliente no CRM (o lead do site já nasce aqui) |
| `lead` | sem cliente (lead do SDR ainda não convertido) |

Lead de quem já comprava a marca não converte: a etapa para em `registered`. O negócio que nasce da conversão de um lead
do SDR conta uma vez, como o lead do SDR, com a marca do negócio quando o SDR não tem (a confirmar com o time do CRM
como a conversão preenche `negocios.origem`; o de-para leva esse texto para `sdr`).

### 3.4 `mkt.v_leads`

```sql
create or replace view mkt.v_leads with (security_invoker = true) as
with own_hosts as (
  select coalesce(array_agg(distinct w.host), '{}') as hosts from mkt.web_properties w
),
base as (
  select l.*, mkt.sp_day(l.source_created_at) as created_on, m.origin as mapped_origin
    from mkt.crm_leads l
    left join mkt.crm_origin_map m on m.raw_value = lower(btrim(l.crm_origin_raw))
),
-- 1. Negócio que continua um lead do SDR: conta uma vez, como o lead do SDR.
sdr_link as (
  select distinct on (d.id) d.id as deal_id, s.id as sdr_id, d.brand_id as deal_brand_id, d.source_created_at
    from base d
    join base s on s.kind = 'sdr' and s.customer_id = d.customer_id
               and s.source_created_at <= d.source_created_at
   where d.kind = 'deal' and d.mapped_origin = 'sdr'
   order by d.id, s.source_created_at desc, s.code desc
),
leads as (
  select b.id, b.code, b.kind, b.customer_id, b.crm_origin_raw, b.is_origin_unmapped, b.mapped_origin, b.utm_source,
         b.utm_medium, b.utm_campaign, b.referrer_host, b.assigned_rep_id, b.source_created_at, b.created_on,
         coalesce(b.brand_id, (select k.deal_brand_id from sdr_link k
                                where k.sdr_id = b.id and k.deal_brand_id is not null
                                order by k.source_created_at limit 1)) as brand_id
    from base b
   where not exists (select 1 from sdr_link k where k.deal_id = b.id)
),
-- 2. UTM de primeiro contato do cliente: só para o negócio do site que a gravou.
first_touch as (
  select distinct on (l.customer_id) l.id
    from leads l
    join mkt.crm_customers c on c.id = l.customer_id
   where l.kind = 'deal' and l.utm_source is null and l.utm_campaign is null
     and c.first_utm_source is not null
     and lower(btrim(l.crm_origin_raw)) = lower(btrim(c.first_utm_source))
   order by l.customer_id, l.source_created_at, l.code
),
utm as (
  select l.*,
         case when l.utm_source is not null or l.utm_campaign is not null then 'lead'
              when ft.id is not null then 'customer_first_touch' end as utm_from,
         coalesce(l.utm_source,   case when ft.id is not null then c.first_utm_source end)   as eff_utm_source,
         coalesce(l.utm_medium,   case when ft.id is not null then c.first_utm_medium end)   as eff_utm_medium,
         coalesce(l.utm_campaign, case when ft.id is not null then c.first_utm_campaign end) as eff_utm_campaign
    from leads l
    left join first_touch ft on ft.id = l.id
    left join mkt.crm_customers c on c.id = l.customer_id
),
-- 3. Origem pela regra (SDR, UTM, referrer, de-para, texto do CRM).
classified as (
  select u.*,
         case when u.kind = 'sdr' then 'sdr'::mkt.lead_origin
              when u.utm_from is not null
                then mkt.classify_lead_origin(u.referrer_host, u.eff_utm_source, u.eff_utm_medium, o.hosts)
              when u.referrer_host is not null
                then mkt.classify_lead_origin(u.referrer_host, null, null, o.hosts)
              when u.mapped_origin is not null then u.mapped_origin
              when u.is_origin_unmapped then 'referral'::mkt.lead_origin   -- texto do CRM fora do de-para (não gravado)
              else mkt.classify_lead_origin(null, u.crm_origin_raw, null, o.hosts)
         end as origin_by_rule
    from utm u cross join own_hosts o
),
-- 4. Campanha: primeiro pelo id da plataforma; sem candidata pelo id, pelo nome. Sempre a mesma marca (se o lead tem)
--    e a mesma plataforma (se a origem é paga).
by_id as (
  select l.id as lead_id, c.id as campaign_id, c.platform
    from classified l
    join mkt.campaigns c on c.external_id = btrim(l.eff_utm_campaign)
   where (l.brand_id is null or c.brand_id = l.brand_id)
     and (l.origin_by_rule::text not in ('meta', 'tiktok', 'google') or c.platform::text = l.origin_by_rule::text)
),
by_name as (
  select l.id as lead_id, c.id as campaign_id, c.platform
    from classified l
    join mkt.campaigns c on c.utm_campaign_key = mkt.utm_key(l.eff_utm_campaign)
   where not exists (select 1 from by_id b where b.lead_id = l.id)
     and (l.brand_id is null or c.brand_id = l.brand_id)
     and (l.origin_by_rule::text not in ('meta', 'tiktok', 'google') or c.platform::text = l.origin_by_rule::text)
),
candidates as (
  select u.*, count(*) over (partition by u.lead_id) as n
    from (select * from by_id union all select * from by_name) u
),
attribution as (
  select lead_id,
         case when max(n) = 1 then (array_agg(campaign_id))[1] end as campaign_id,
         case when max(n) = 1 then (array_agg(platform))[1] end    as platform,
         (case when max(n) = 1 then 'attributed' else 'ambiguous' end)::mkt.attribution_status as status
    from candidates group by lead_id
),
-- 5. Conversão: o 1º pedido que fez do cliente um cliente novo da marca do lead, depois de o lead chegar.
conversion as (
  select distinct on (l.id) l.id as lead_id, f.brand_id as converted_brand_id,
         f.first_order_at, f.first_order_on, f.first_order_is_invoiced
    from classified l
    join mkt.v_first_orders f
      on f.customer_id = l.customer_id
     and (l.brand_id is null or f.brand_id = l.brand_id)
     and not f.is_known_before
     and f.first_order_at >= l.source_created_at
   order by l.id, f.first_order_at, f.brand_id
)
select l.id, l.code, l.kind, l.brand_id, l.customer_id, l.assigned_rep_id, l.referrer_host,
       l.source_created_at as created_at, l.created_on,
       l.eff_utm_source as utm_source, l.eff_utm_medium as utm_medium, l.eff_utm_campaign as utm_campaign, l.utm_from,
       coalesce(a.platform::text::mkt.lead_origin, l.origin_by_rule) as origin,   -- a campanha casada decide o canal
       a.campaign_id as attributed_campaign_id,
       coalesce(a.status, (case when l.eff_utm_campaign is null then 'no_utm' else 'no_match' end)::mkt.attribution_status)
         as attribution_status,
       cv.converted_brand_id, cv.first_order_at, cv.first_order_on,
       (case when cv.first_order_is_invoiced then 'invoiced'
             when cv.first_order_at is not null then 'first_order'
             when c.id is not null and (c.is_known_by_erp or c.has_app_owner or c.crm_status <> 'prospect')
               then 'registered'
             when c.id is not null then 'prospect'
             else 'lead' end)::mkt.lead_stage as stage,
       l.is_origin_unmapped
  from classified l
  left join attribution a on a.lead_id = l.id
  left join conversion cv on cv.lead_id = l.id
  left join mkt.crm_customers c on c.id = l.customer_id;
```

### 3.5 `mkt.v_first_orders` — o 1º pedido por cliente e marca

- Pedido que conta: `status = 'sent'` (o faturado incluso) e com cliente. "A vincular" fica fora até vincular;
  orçamento e cancelado nunca contam (decisão 0015).
- Data do pedido: `sent_at` quando o CRM mandar; até lá, a criação no app (`source_created_at`).
- **Histórico** (decisão 0030): o CRM só tem pedido desde agosto de 2026. O cliente **não é novo** na marca se o retrato
  do ERP mostra compra na marca antes do 1º pedido do CRM: a primeira ou a última compra do ERP
  (`erp_first_purchase_on`, `erp_last_purchase_on`) anterior a ele. O total comprado no ERP não decide: ele pode ter
  compra feita só pelo ERP depois da estreia, e um cliente novo de setembro viraria antigo para trás.
- **Grupo:** o 1º pedido do grupo é o mais antigo entre as marcas (desempate pela marca); o cliente não é novo no grupo
  se o retrato de alguma marca mostra compra antes dele.

```sql
create or replace view mkt.v_first_orders with (security_invoker = true) as
with sent as (
  select o.id, o.customer_id, o.brand_id, o.total_cents, o.is_invoiced,
         coalesce(o.sent_at, o.source_created_at) as order_at
    from mkt.crm_orders o
   where o.status = 'sent' and o.customer_id is not null
),
firsts as (
  select distinct on (s.customer_id, s.brand_id)
         s.customer_id, s.brand_id, s.id as first_order_id, s.order_at as first_order_at,
         mkt.sp_day(s.order_at) as first_order_on, s.total_cents as first_order_total_cents,
         s.is_invoiced as first_order_is_invoiced
    from sent s
   order by s.customer_id, s.brand_id, s.order_at, s.id
),
erp as (   -- retrato do ERP por marca, sem os pedidos do CRM: só as datas decidem
  select cb.customer_id, cb.brand_id, cb.erp_first_purchase_on, cb.erp_last_purchase_on
    from mkt.crm_customer_brands cb
),
flagged as (
  select f.*,
         coalesce(e.erp_first_purchase_on < f.first_order_on or e.erp_last_purchase_on < f.first_order_on, false)
           as is_known_before,
         row_number() over (partition by f.customer_id order by f.first_order_at, f.brand_id) = 1 as is_group_first,
         min(f.first_order_on) over (partition by f.customer_id) as group_first_order_on
    from firsts f
    left join erp e using (customer_id, brand_id)
)
select f.*,
       exists (select 1 from erp e
                where e.customer_id = f.customer_id
                  and (e.erp_first_purchase_on < f.group_first_order_on
                       or e.erp_last_purchase_on < f.group_first_order_on)) as is_group_known_before
  from flagged f;
```

### 3.6 `mkt.v_new_customers` — cliente novo e o lead que leva o crédito

Uma linha por cliente novo em cada escopo: `brand` (uma por cliente e marca em que estreou) e `group` (uma por
cliente, no 1º pedido do grupo). Clientes novos são contados **pelo pedido** (decisão 0029): quem fez o 1º pedido sem
passar por lead no CRM conta, sem crédito de campanha.

```sql
create or replace view mkt.v_new_customers with (security_invoker = true) as
with new_rows as (
  select 'brand'::text as scope, f.customer_id, f.brand_id, f.first_order_id, f.first_order_at,
         f.first_order_on, f.first_order_total_cents
    from mkt.v_first_orders f
   where not f.is_known_before
  union all
  select 'group', f.customer_id, f.brand_id, f.first_order_id, f.first_order_at,
         f.first_order_on, f.first_order_total_cents
    from mkt.v_first_orders f
   where f.is_group_first and not f.is_group_known_before
),
credit as (   -- primeiro toque (decisão 0031)
  select n.scope, n.customer_id, n.brand_id, l.id as lead_id, l.origin, l.attributed_campaign_id,
         l.assigned_rep_id, l.referrer_host,
         row_number() over (partition by n.scope, n.customer_id, n.brand_id order by l.created_at, l.code) as rn
    from new_rows n
    join mkt.v_leads l
      on l.customer_id = n.customer_id
     and l.created_at <= n.first_order_at
     and (n.scope = 'group' or l.brand_id is null or l.brand_id = n.brand_id)
)
select n.*, c.lead_id, c.origin, c.attributed_campaign_id, c.assigned_rep_id, c.referrer_host,
       -- novo na marca, mas já comprava de outra marca do grupo (nota da tabela por marca)
       (n.scope = 'brand' and not exists (select 1 from new_rows g
                                           where g.scope = 'group' and g.customer_id = n.customer_id
                                             and g.brand_id = n.brand_id)) as is_cross_brand
  from new_rows n
  left join credit c on c.scope = n.scope and c.customer_id = n.customer_id
                    and c.brand_id = n.brand_id and c.rn = 1;
```

---

## 4. Fórmulas

### 4.1 Recortes

```sql
create or replace function mkt.campaigns_in_scope(f mkt.kpi_filters) returns setof mkt.campaigns
language sql stable set search_path = '' as $$
  select c.* from mkt.campaigns c
   where (f.brand_id is null or c.brand_id = f.brand_id)
     and (f.platform is null or c.platform = f.platform)
     and (f.operator is null or c.managed_by = f.operator)
     and (f.campaign_ids is null or c.id = any (f.campaign_ids))
$$;

create or replace function mkt.leads_in_scope(f mkt.kpi_filters) returns setof mkt.v_leads
language sql stable set search_path = '' as $$
  select l.* from mkt.v_leads l
    left join mkt.campaigns c on c.id = l.attributed_campaign_id
   where (f.brand_id is null or l.brand_id = f.brand_id or l.brand_id is null)   -- sem marca entra (0014)
     and (f.origin is null or l.origin = f.origin)
     and (f.platform is null or l.origin::text = f.platform::text)               -- canal = origem do lead
     and (f.operator is null or c.managed_by = f.operator)
     and (f.campaign_ids is null or l.attributed_campaign_id = any (f.campaign_ids))
     and (f.sales_rep_id is null or l.assigned_rep_id = f.sales_rep_id)
$$;

create or replace function mkt.new_customers(f mkt.kpi_filters, p_window daterange)
returns setof mkt.v_new_customers
language sql stable set search_path = '' as $$
  select n.* from mkt.v_new_customers n
    left join mkt.campaigns c on c.id = n.attributed_campaign_id
   where n.scope = case when f.brand_id is null then 'group' else 'brand' end   -- decisão 0030
     and (f.brand_id is null or n.brand_id = f.brand_id)
     and n.first_order_on <@ p_window
     and (f.origin is null or n.origin = f.origin)
     and (f.platform is null or n.origin::text = f.platform::text)
     and (f.operator is null or c.managed_by = f.operator)
     and (f.campaign_ids is null or n.attributed_campaign_id = any (f.campaign_ids))
     and (f.sales_rep_id is null or n.assigned_rep_id = f.sales_rep_id)
$$;
```

### 4.2 Mídia — `mkt.ad_summary(f, janela)`

Soma `ad_campaign_daily` das campanhas de `mkt.campaigns_in_scope(f)` na janela. Sem base (`mkt.ads_covered`), tudo
nulo; com base e sem linha, 0.

| Saída | Conta | Nulo |
|---|---|---|
| `investment_cents` | Σ `spend_cents` | N1 |
| `impressions`, `clicks` | Σ | N1 |
| `platform_leads` | Σ `platform_leads` (leads que a plataforma informa) | N1 |
| `conversions`, `conversion_value_cents` | Σ (informados pela plataforma) | N1 |
| `ctr` | cliques ÷ impressões | N2 |
| `cpc_cents` | investimento ÷ cliques | N2 |
| `platform_cost_per_lead_cents` | investimento ÷ `platform_leads` | N2 |
| `cost_per_conversion_cents` | investimento ÷ conversões | N2 |
| `platform_roas` | valor informado ÷ investimento; nulo com valor 0 (`conversion_value_cents` 0 = sem rastreio de valor, [`tabelas.md`](tabelas.md)) | N2 N5 |

### 4.3 Aquisição — `mkt.acquisition(f, w)`

É a conta do número de sucesso. Custo por lead (decisão 0027), custo por cliente novo e ROAS (decisão 0028) saem
daqui, e em nenhum outro lugar. Devolve uma linha por lado (`current`, `comparable_current`, `comparable_previous`;
seção 2.1) lendo cada fonte **uma vez**: leads, clientes novos e gasto saem de CTEs materializadas sobre o intervalo
que cobre o atual e o anterior (`range_merge`), e cada lado é um `filter` sobre elas. `by_brand`, `by_platform` e
`daily` saem dos mesmos CTEs, com `grouping sets`.

```sql
create type mkt.acquisition_row as (
  side                     text,     -- current | comparable_current | comparable_previous
  investment_cents         bigint,   -- nulo: nenhuma conta de anúncio com base no recorte
  leads                    bigint,   -- nulo: o CSP 360 nunca trouxe dado
  attributed_leads         bigint,
  new_customers            bigint,
  attributed_new_customers bigint,
  attributed_revenue_cents bigint,   -- valor do 1º pedido dos clientes novos atribuídos
  cost_per_lead_cents         numeric,
  cost_per_new_customer_cents numeric,
  roas                        numeric
);

create or replace function mkt.acquisition_ratios(
  p_investment_cents bigint, p_attributed_leads bigint, p_attributed_new bigint, p_attributed_revenue_cents bigint,
  p_is_utm_ambiguous boolean default false,     -- só a linha de campanha (CA14) passa mkt.v_campaigns.is_utm_ambiguous
  out cost_per_lead_cents numeric, out cost_per_new_customer_cents numeric, out roas numeric)
language sql immutable parallel safe set search_path = '' as $$
  select mkt.ratio(p_investment_cents, p_attributed_leads),                        -- decisão 0027
         case when not p_is_utm_ambiguous                                           -- UTM repetida: nulo (0009, 0028)
              then mkt.ratio(p_investment_cents, p_attributed_new) end,           -- decisões 0012 e 0029
         case when not p_is_utm_ambiguous
              then mkt.ratio(p_attributed_revenue_cents, p_investment_cents) end  -- decisão 0028: sem investimento, nulo
$$;

create or replace function mkt.acquisition(f mkt.kpi_filters, w mkt.period_window)
returns setof mkt.acquisition_row
language sql stable set search_path = '' as $$
  with span as (select range_merge(w.previous_window, w.current_window) as r),
  camp as materialized (select c.id from mkt.campaigns_in_scope(f) c),
  l as materialized (
    select created_on, attributed_campaign_id in (select id from camp) as is_attributed
      from mkt.leads_in_scope(f), span where created_on <@ span.r),
  n as materialized (
    select first_order_on, attributed_campaign_id in (select id from camp) as is_attributed, first_order_total_cents
      from mkt.new_customers(f, (select r from span))),
  d as materialized (
    select metric_on, spend_cents from mkt.ad_campaign_daily, span
     where campaign_id in (select id from camp) and metric_on <@ span.r),
  cov as (select mkt.ads_covered(f.brand_id, f.platform) as ads, mkt.source_covered('csp360') as crm),
  sides(side, win) as (values ('current', w.current_window),
                              ('comparable_current', w.comparable_current),
                              ('comparable_previous', w.comparable_previous)),
  agg as (
    select s.side,
      case when cov.ads and s.win is not null
           then (select coalesce(sum(d.spend_cents), 0)::bigint from d where d.metric_on <@ s.win) end as inv,
      case when cov.crm and s.win is not null then (select count(*) from l where l.created_on <@ s.win) end as leads,
      case when cov.crm and s.win is not null
           then (select count(*) from l where l.created_on <@ s.win and l.is_attributed) end as att_leads,
      case when cov.crm and s.win is not null then (select count(*) from n where n.first_order_on <@ s.win) end as new_c,
      case when cov.crm and s.win is not null
           then (select count(*) from n where n.first_order_on <@ s.win and n.is_attributed) end as att_new,
      case when cov.crm and s.win is not null
           then (select coalesce(sum(n.first_order_total_cents), 0)::bigint from n
                  where n.first_order_on <@ s.win and n.is_attributed) end as att_rev
    from sides s cross join cov
  )
  select (a.side, a.inv, a.leads, a.att_leads, a.new_c, a.att_new, a.att_rev,
          r.cost_per_lead_cents, r.cost_per_new_customer_cents, r.roas)::mkt.acquisition_row
    from agg a
    cross join lateral mkt.acquisition_ratios(a.inv, a.att_leads, a.att_new, a.att_rev) r
$$;
```

- "As duas" conta cada cliente uma vez porque `mkt.new_customers` usa o escopo do grupo (uma linha por cliente).
- `mkt.new_customers(f, janela)` recebe o intervalo que cobre os dois períodos; o lado sai do `filter`.
- Em quebra por marca ou por canal, a função de tela soma os mesmos CTEs com `grouping sets` e aplica a mesma
  `mkt.acquisition_ratios` em cada linha.
- Campanha com UTM repetida (`is_utm_ambiguous`): na linha dela, custo por cliente novo e ROAS ficam nulos, com a
  marca "UTM repetida" (decisão 0009: "Sem dados" para campanha sem `utm_campaign` casável). A linha passa
  `is_utm_ambiguous` para `mkt.acquisition_ratios`; as outras linhas ficam com o padrão `false`.

### 4.4 Humano × Claude — `mkt.operator_comparison(f, janela)`

Uma lista única de linhas, a mesma em toda tela; cada tela mostra as que lhe cabem. O filtro de operador da URL não
vale aqui (a comparação é ele). A regra de custo da seção 2.6 vale: com "Não se aplica", o bloco some.

| Linha (`mkt.operator_line`) | Conta, por operador | Sentido | VG | CH | LE | Canal | TR |
|---|---|---|---|---|---|---|---|
| `investment` | Σ gasto das campanhas do operador no recorte | neutro | sim | sim | sim | sim | sim |
| `budget_share` | `investment` ÷ gasto de todas as campanhas do recorte | neutro | sim | sim | — | sim | sim |
| `active_campaigns` | # campanhas ativas do operador | neutro | sim | — | — | sim | sim |
| `leads` | # leads do período atribuídos às campanhas do operador (CSP 360) | neutro | sim | — | sim | sim | sim |
| `converted_leads` | # desses leads que viraram cliente (por lead, decisão 0029) | neutro | — | — | sim | — | — |
| `cost_per_lead` | `investment` ÷ `leads` | menor é melhor | sim | — | sim | sim | sim |
| `lead_to_customer_rate` | `converted_leads` ÷ `leads` (por lead) | maior é melhor | — | — | sim | — | — |
| `platform_leads` | leads informados pela plataforma | neutro | — | — | — | sim | sim |
| `platform_cost_per_lead` | `investment` ÷ `platform_leads` | menor é melhor | — | — | — | sim | sim |
| `conversions` | conversões informadas pela plataforma | neutro | — | — | — | sim | sim |
| `cost_per_conversion` | `investment` ÷ `conversions` | menor é melhor | — | — | — | sim | sim |
| `new_customers` | # clientes novos do período atribuídos às campanhas do operador | neutro | sim | sim | — | sim | sim |
| `cost_per_new_customer` | `investment` ÷ `new_customers` | menor é melhor | sim | sim | — | sim | sim |
| `roas` | receita do 1º pedido desses clientes ÷ `investment` | maior é melhor | sim | — | — | sim | sim |
| `actions_proposed` | # ações propostas pelo operador, criadas no período; marca e canal, e o filtro de campanha não vale | neutro | — | — | — | sim | sim |
| `actions_done` | # ações do operador feitas no período (`executed_at`); marca e canal, e o filtro de campanha não vale | neutro | — | — | — | sim | sim |

- `difference = (claude − humano) ÷ |humano|`. A tela pinta melhor ou pior só nas linhas com sentido: **eficiência se
  julga, volume não** (o volume depende da verba de cada um).
- `by_platform[]`: por canal do filtro (ou os três), `investment`, `leads`, `cost_per_lead` e `new_customers` de cada
  operador e a diferença de custo por lead (as barras do Tráfego).

### 4.5 Ritmo, conta do mês e limite (decisão 0021)

Uma régua só para o limite (Visão geral, canais e Tráfego) e para a verba da estratégia. As funções desta seção e a
view `mkt.v_account_month` entram na migração 10, antes de `mkt.execution_allowed`, que as usa
([`plano.md`](plano.md)).

```sql
create domain mkt.spend_situation as text check (value in ('over_limit', 'will_exceed', 'on_track'));
create domain mkt.limit_alert as text check (value in ('near_limit', 'over_limit'));

create or replace function mkt.pace(p_spent bigint, p_target bigint, p_days_elapsed integer, p_days_in_month integer,
  out projection_cents bigint, out expected_today_cents bigint, out usage numeric, out situation mkt.spend_situation)
language sql immutable parallel safe set search_path = '' as $$
  select round(p_spent::numeric / p_days_elapsed * p_days_in_month)::bigint,
         round(p_target::numeric * p_days_elapsed / p_days_in_month)::bigint,
         mkt.ratio(p_spent, p_target),
         (case when p_spent is null or p_target is null then null
               when p_spent >= p_target then 'over_limit'          -- como o protótipo: chegou ao limite (também 0 de 0)
               when round(p_spent::numeric / p_days_elapsed * p_days_in_month) > p_target then 'will_exceed'
               else 'on_track' end)::mkt.spend_situation
$$;

-- Recebe o gasto e o limite, não o uso: com limite 0, o uso é nulo, e o alerta precisa dizer "acima", como a situação.
create or replace function mkt.limit_alert(p_spent bigint, p_limit bigint) returns mkt.limit_alert
language sql immutable parallel safe set search_path = '' as $$
  select (case when p_spent >= p_limit then 'over_limit'
               when p_spent >= 0.9 * p_limit then 'near_limit' end)::mkt.limit_alert
$$;

-- Uma linha por conta de anúncio ativa, no mês corrente de São Paulo.
create or replace view mkt.v_account_month with (security_invoker = true) as
with m as (
  select date_trunc('month', mkt.today())::date as month_on, mkt.today() as today,
         (date_trunc('month', mkt.today()) + interval '1 month')::date - 1 as month_end
),
spent as (   -- todo o gasto da conta no mês, de qualquer campanha e status
  select c.ad_account_id, sum(d.spend_cents)::bigint as spent_cents   -- sum(bigint) devolve numeric
    from mkt.ad_campaign_daily d
    join mkt.campaigns c on c.id = d.campaign_id
   cross join m
   where d.metric_on between m.month_on and m.today
   group by c.ad_account_id
),
lim as (     -- o limite vigente hoje
  select distinct on (s.ad_account_id) s.ad_account_id, s.id as spend_limit_id, s.monthly_limit_cents
    from mkt.spend_limits s cross join m
   where s.valid_from_on <= m.today
   order by s.ad_account_id, s.valid_from_on desc
),
camp as (
  select c.ad_account_id,
         count(*) filter (where c.status = 'active') as active_campaigns,
         count(*) filter (where c.status = 'active' and c.managed_by = 'claude') as active_claude_campaigns,
         sum(c.daily_budget_cents) filter (where c.status = 'active')::bigint as active_daily_budget_cents
    from mkt.campaigns c group by c.ad_account_id
),
base as (
  select a.id as ad_account_id, a.brand_id, a.platform, m.month_on,
         m.today - m.month_on + 1 as days_elapsed, m.month_end - m.month_on + 1 as days_in_month,
         -- A base é a da própria conta da linha: conta nova ainda não lida fica "Sem dados", não R$ 0.
         case when a.first_read_at is not null and mkt.ads_covered(a.brand_id, a.platform)
              then coalesce(s.spent_cents, 0) end as spent_cents,
         l.spend_limit_id, l.monthly_limit_cents,
         -- Sem base, "Sem dados" (como o protótipo); com base e nada ativo, 0 e R$ 0.
         case when a.first_read_at is not null and mkt.ads_covered(a.brand_id, a.platform)
              then coalesce(c.active_campaigns, 0) end as active_campaigns,
         case when a.first_read_at is not null and mkt.ads_covered(a.brand_id, a.platform)
              then coalesce(c.active_claude_campaigns, 0) end as active_claude_campaigns,
         case when a.first_read_at is not null and mkt.ads_covered(a.brand_id, a.platform)
              then coalesce(c.active_daily_budget_cents, 0)::bigint end as active_daily_budget_cents
    from mkt.ad_accounts a
   cross join m
    left join spent s on s.ad_account_id = a.id
    left join lim l on l.ad_account_id = a.id
    left join camp c on c.ad_account_id = a.id
   where a.is_active
)
select b.*, p.projection_cents, p.expected_today_cents, p.usage, p.situation,
       mkt.limit_alert(b.spent_cents, b.monthly_limit_cents) as alert
  from base b
 cross join lateral mkt.pace(b.spent_cents, b.monthly_limit_cents, b.days_elapsed, b.days_in_month) p;
```

**Ação ou execução que aumenta o gasto** (alerta da fila e trava da execução, a mesma conta nos dois lugares). A
trava falha fechada: sem base para a conta, ela barra.

| Tipo | Gasto a mais no resto do mês (`mkt.action_extra_spend_cents`, `mkt.execution_extra_spend_cents`) |
|---|---|
| `budget` (`set_daily_budget`) | `greatest(0, novo − coalesce(orçamento atual da campanha, params.previous_daily_budget_cents, 0))` × dias que faltam no mês, contando hoje |
| `create` (`create_campaign`) | `params.daily_budget_cents` × dias que faltam |
| `activate` (desfazer a parada; só execução) | orçamento diário da campanha × dias que faltam |
| `bid`, `creative` | `cost_cents`. Sem custo estimado, o alerta aparece quando o uso do mês passa de 90% (na v1 os dois não executam pela central) |
| `pause`, `pending_fix`, `set_account_spend_cap` | 0 |

- `mkt.action_exceeds_limit(action_id)` = gasto a mais > 0 **e** projeção do mês + gasto a mais > limite. Nulo (sem
  gasto lido, sem orçamento conhecido) conta como verdadeiro em `mkt.execution_allowed`: a execução fica `blocked` com
  `over_spend_limit`, e a fila mostra `exceeds_month_limit`.
- **Conta sem limite vigente:** operação que pode aumentar o gasto (`mkt.execution_may_increase_spend`: `activate`,
  `create_campaign`, `set_daily_budget` acima do atual ou com o atual desconhecido) fica `blocked` com `no_spend_limit`,
  e a fila mostra o alerta `no_spend_limit`.
- **Parada aberta na marca:** operação que pode aumentar o gasto fica `blocked` com `stopped` (decisão 0022).
- Pausar e reduzir nunca são barrados. O executor usa as mesmas funções em `mkt.execution_allowed`
  ([`integracoes.md`](integracoes.md), seção 14), com o "hoje" do banco (`mkt.today()`, que nenhuma sessão muda).

### 4.6 Ação de tráfego: fila, pendências e lista

- **Recorte:** marca exata (a ação sempre tem marca); canal (ação sem canal sai com filtro de canal); operador =
  `proposed_by_kind`; campanha = `campaign_id`.
- **Conta da ação** (para o limite): `ad_account_id` da ação. Sem conta (ação sem canal), nulo, e não há alerta de
  limite.
- **Fila** ("Esperando sua decisão"): `idea` que não é `pending_fix`, e `failed` (a plataforma recusou e alguém
  decide entre tentar de novo e descartar). **Ordem única:** impacto por `mkt.list_rank('level', impact) desc` (alto
  primeiro), esforço por `mkt.list_rank('level', effort)` (baixo primeiro), a mais antiga primeiro. Custo da fila =
  Σ `cost_cents` dos itens que têm estimativa. Com a fila vazia, 0 (dado do CSP-MKT, seção 2.3). Nulo ("Sem custo
  estimado") quando a fila tem itens e nenhum tem `cost_cents`.
- **Pendências:** `pending_fix` fora de `done` e `discarded`, na mesma ordem.
- **Lista** ("O que podemos fazer"): ordem por status (`mkt.list_rank('action_status', status)`: `idea`, `failed`,
  `approved`, `running`, `done`, `discarded`), depois impacto, esforço e a mais nova.
- **Alerta** de cada item (`mkt.action_alert`), nesta ordem: feita ou descartada → nenhum; campanha encerrada →
  `campaign_ended`; pausa de campanha pausada → `already_paused`; orçamento, lance ou criativo em campanha pausada →
  `waits_campaign_active`; falhou → `platform_refused` (com o código); aumento de gasto em conta sem limite →
  `no_spend_limit`; aumento de gasto que passa do limite (ou sem base para a conta) → `exceeds_month_limit` (seção
  4.5).

### 4.7 Base de clientes

Escopo (seção 2.4): a marca escolhida, ou o grupo em "As duas".

- **Da base:** situação no escopo diferente de `lead` e (comprou no escopo, ou tem situação). Comprou = pedido
  enviado no CRM ou compra no retrato do ERP.
- **Situação:** `crm_customer_brands.situation` da marca; em "As duas", a melhor entre as marcas. Sem nenhuma linha com
  situação, ativos, inativos e perdidos são nulos.
- **Última compra** no escopo: a maior entre o último pedido enviado do CRM e `erp_last_purchase_on`.
- **Antigo no período:** pedido do CRM no escopo antes do início, ou `erp_first_purchase_on` (ou
  `erp_last_purchase_on`) antes do início.
- **Recompra:** antigo com pedido enviado no período. Taxa = recompraram ÷ antigos.
- **Reativado:** antigo cujo 1º pedido do período veio 90 dias ou mais depois da compra anterior a ele. A compra
  anterior é `greatest(previous_order_on_in_brand, erp_last_purchase_on)` (em "As duas", `previous_order_on_in_group`
  e o maior `erp_last_purchase_on` das marcas), e `erp_last_purchase_on` só conta quando é anterior a esse pedido. Sem
  compra anterior conhecida, não é antigo e não é reativado (o protótipo contava a partir do pedido mais antigo do
  conjunto; isso sai).
- **A base existe com o que há:** `mkt.v_customer_brand_status` começa na união dos pares cliente × marca de
  `crm_customer_brands` e dos pedidos. Enquanto as views do CRM não existirem, a Base mostra quem tem pedido, com
  situação nula, e não 0 cliente com pedidos enviados na Visão geral.
- **Receita de antigos × novos:** Σ dos pedidos enviados do período, de antigos e dos outros.
- **Faixas de dias sem comprar** (`mkt.recency_bucket`): 0–30, 31–90, 91–180, 181–365, 366 ou mais; fica fora quem não
  tem compra ou tem dias negativos.

```sql
-- Pedidos enviados com a compra anterior na marca e no grupo: a base de recompra, reativação e receita.
create or replace view mkt.v_customer_orders with (security_invoker = true) as
select o.id as order_id, o.customer_id, o.brand_id, o.total_cents, o.is_invoiced,
       mkt.sp_day(coalesce(o.sent_at, o.source_created_at)) as order_on,
       lag(mkt.sp_day(coalesce(o.sent_at, o.source_created_at)))
         over (partition by o.customer_id, o.brand_id order by coalesce(o.sent_at, o.source_created_at), o.id)
         as previous_order_on_in_brand,
       lag(mkt.sp_day(coalesce(o.sent_at, o.source_created_at)))
         over (partition by o.customer_id order by coalesce(o.sent_at, o.source_created_at), o.id)
         as previous_order_on_in_group
  from mkt.crm_orders o
 where o.status = 'sent' and o.customer_id is not null;

-- Situação e última compra por cliente e marca (a régua é a do CRM; o CSP-MKT não recalcula).
-- Começa na união dos pares da view do CRM e dos pedidos: sem a view, quem tem pedido continua na base.
create or replace view mkt.v_customer_brand_status with (security_invoker = true) as
with pairs as (
  select customer_id, brand_id from mkt.crm_customer_brands
  union
  select customer_id, brand_id from mkt.v_customer_orders
),
o_agg as (
  select customer_id, brand_id, max(order_on) as last_order_on, count(*) as orders_count
    from mkt.v_customer_orders group by customer_id, brand_id
)
select p.customer_id, p.brand_id, cb.situation, coalesce(cb.is_lost_manual, false) as is_lost_manual,
       cb.erp_first_purchase_on, cb.erp_last_purchase_on,
       greatest(o.last_order_on, cb.erp_last_purchase_on) as last_purchase_on,
       (coalesce(o.orders_count, 0) > 0 or cb.erp_last_purchase_on is not null) as has_purchase
  from pairs p
  left join mkt.crm_customer_brands cb on cb.customer_id = p.customer_id and cb.brand_id = p.brand_id
  left join o_agg o on o.customer_id = p.customer_id and o.brand_id = p.brand_id;
```

O reativado sai do primeiro pedido do período de cada cliente: a compra anterior a ele é
`greatest(previous_order_on_in_brand, erp_last_purchase_on)` (ou com `_in_group` em "As duas"), com
`erp_last_purchase_on` só quando é anterior a esse pedido. Reativado = essa compra existe e a distância é de 90 dias ou
mais.

### 4.8 Instagram, Search Console e GA4

- **Base:** Instagram por `mkt.ig_covered(marca)`; Search Console e GA4 por `mkt.web_covered(marca, tipo)` (seção
  2.3). A marca sem perfil ou propriedade lida fica "Sem dados", não 0.
- **Instagram (decisão 0033):** seguidores = o último `followers_count` **não nulo** do período; saldo = ele − o último
  não nulo antes do período (ou o primeiro do período). Alcance = **soma do alcance de cada dia**. "Impressões" vira
  **Visualizações** (`views`). Engajamento vira **Interações** (`total_interactions`, se a API confirmar que é só
  orgânico; seção 19 de [`integracoes.md`](integracoes.md)), no perfil e no post. Taxa de interação = interações ÷
  alcance somado (perfil) ou ÷ alcance do post. Post usa o retrato mais recente (`mkt.v_ig_media_latest`). Dia sem
  linha na série: nulo.
- **Search Console:** somas de `seo_daily`; CTR = cliques ÷ impressões; **posição média ponderada pelas impressões em
  todo lugar** (indicador, dia e consulta): Σ(posição × impressões) ÷ Σ impressões, nula com 0 impressões. Dia sem linha
  na série: nulo.
- **GA4:** canal e assistente de IA derivados da linha bruta, também para o tempo antes de 13/05/2026, quando o GA4 ainda
  não tinha o canal "AI Assistant". `mkt.ai_source_of` está na seção 3.1 (a lista de assistentes mora só lá).

```sql
create or replace function mkt.ga4_channel_of(p_channel_group text, p_session_source text) returns mkt.ga4_channel
language sql immutable parallel safe set search_path = '' as $$
  select (case
    when mkt.ai_source_of(p_session_source, p_channel_group) is not null then 'ai_assistant'
    when p_channel_group = 'Organic Search' then 'organic_search'
    when p_channel_group = 'Direct'         then 'direct'
    when p_channel_group = 'Paid Search'    then 'paid_search'
    when p_channel_group = 'Paid Social'    then 'paid_social'
    when p_channel_group = 'Organic Social' then 'organic_social'
    when p_channel_group = 'Referral'       then 'referral'
    else 'other' end)::mkt.ga4_channel             -- inclui Cross-network, Email, Unassigned
$$;

create or replace view mkt.v_ga4_channel_daily with (security_invoker = true) as
select t.brand_id, t.web_property_id, t.metric_on,
       mkt.ga4_channel_of(t.channel_group_raw, t.session_source) as channel,
       sum(t.sessions) as sessions, sum(t.lead_events) as lead_events
  from mkt.ga4_traffic_daily t
 group by 1, 2, 3, 4;

create or replace view mkt.v_ga4_ai_daily with (security_invoker = true) as
select t.brand_id, t.web_property_id, t.metric_on,
       mkt.ai_source_of(t.session_source, t.channel_group_raw) as ai_source, sum(t.sessions) as sessions
  from mkt.ga4_traffic_daily t
 where mkt.ai_source_of(t.session_source, t.channel_group_raw) is not null
 group by 1, 2, 3, 4;
```

- **Buscador do lead** (`mkt.search_engine_of(referrer)`): `google` (host com `google.`), `bing`, `duckduckgo`,
  `yahoo`, `ecosia`, `other`; sem endereço → `no_referrer`. **Assistente do lead** (só dos leads com origem
  `ai_assistant`): `case when coalesce(mkt.url_host(referrer_host), mkt.url_host(utm_source)) is null then null else
  coalesce(mkt.ai_source_of(referrer_host, null), mkt.ai_source_of(utm_source, null), 'other') end`; nulo → "Sem
  endereço de origem", `other` → "Outro assistente" (como o protótipo, que separa os dois).
- **Checagem dos sites** (`mkt.v_site_checks_latest`): o resultado mais recente de cada item de cada site; `found` e
  `blocks_ai_training` → `ok`, o resto → `warning`.
- **Post** (`mkt.v_ig_media_latest`): o retrato de `ig_media_daily` com o maior `captured_on` de cada post.

### 4.9 Saúde dos conectores — `mkt.v_connector_health` (decisão 0024)

```sql
create or replace view mkt.v_connector_health with (security_invoker = true) as
with runs as (
  select r.connector_id,
         count(*) filter (where r.status = 'failed'
                            and r.finished_at > coalesce(c.last_success_at, '-infinity')) as consecutive_failures,
         max(r.finished_at) filter (where r.status = 'failed') as last_failure_at,
         (array_agg(r.error_code order by r.finished_at desc) filter (where r.status = 'failed'))[1] as last_failure_code,
         -- aviso da última rodada boa: o código do partial; nulo quando ela deu certo inteira
         (array_agg(r.error_code order by r.finished_at desc)
            filter (where r.status in ('succeeded', 'partial')))[1] as last_partial_code,
         (array_agg(r.status order by r.finished_at desc)
            filter (where r.status in ('succeeded', 'partial', 'failed')))[1] as last_finished_status,
         coalesce(sum(r.rows_written) filter (where r.finished_at > mkt.now() - interval '24 hours'), 0) as rows_written_24h,
         bool_or(r.status = 'requested' and r.run_trigger = 'manual_retry') as retry_requested,   -- CSV na fila não conta
         bool_or(r.status = 'running') as is_running
    from mkt.sync_runs r
    join mkt.connectors c on c.id = r.connector_id
   group by r.connector_id
),
-- Cada trabalho de connector_jobs: atrasado depois da frequência mais a folga; caído depois de duas frequências,
-- com a última rodada dele falhada.
jobs as (
  select j.connector_id,
         bool_or(x.minutes > 2 * j.expected_every_minutes and x.last_status = 'failed') as any_down,
         bool_or(x.minutes > j.expected_every_minutes + j.late_tolerance_minutes) as any_late,
         array_agg(j.job order by j.job)
           filter (where x.minutes > j.expected_every_minutes + j.late_tolerance_minutes) as late_jobs
    from mkt.connector_jobs j
    join mkt.connectors c on c.id = j.connector_id
   cross join lateral (
     select round(extract(epoch from mkt.now() - coalesce(j.last_success_at, c.first_success_at)) / 60) as minutes,
            (select r.status from mkt.sync_runs r
              where r.connector_id = j.connector_id and r.job = j.job
                and r.status in ('succeeded', 'partial', 'failed')
              order by r.finished_at desc limit 1) as last_status) x
   group by j.connector_id
),
h as (
  select c.*, r.consecutive_failures, r.last_failure_at, r.last_failure_code, r.last_partial_code,
         r.last_finished_status,
         coalesce(r.rows_written_24h, 0) as rows_written_24h,
         coalesce(r.retry_requested, false) as retry_requested, coalesce(r.is_running, false) as is_running,
         case when c.last_success_at is not null
              then greatest(0, round(extract(epoch from mkt.now() - c.last_success_at) / 60))::integer end
           as minutes_since_success
    from mkt.connectors c
    left join runs r on r.connector_id = c.id
)
select h.code, h.setup_state, h.expected_every_minutes, h.late_tolerance_minutes,
       h.first_success_at, h.last_success_at, h.minutes_since_success,
       case when h.minutes_since_success is not null
            then greatest(0, h.minutes_since_success - h.expected_every_minutes) end as delay_minutes,
       coalesce(h.consecutive_failures, 0) as consecutive_failures, h.last_failure_at, h.last_failure_code,
       h.last_partial_code, h.rows_written_24h, h.retry_requested, h.is_running, jb.late_jobs,
       (case
          when h.setup_state = 'disabled' then 'disabled'
          when h.first_success_at is null then 'not_connected'      -- nunca deu certo: "A ligar", mesmo com falha
          when (h.last_finished_status = 'failed'
                and h.minutes_since_success > 2 * h.expected_every_minutes)
               or coalesce(jb.any_down, false) then 'down'
          when h.minutes_since_success > h.expected_every_minutes + h.late_tolerance_minutes
               or coalesce(jb.any_late, false) then 'late'
          else 'ok'
        end)::mkt.connector_status as status
  from h
  left join jobs jb on jb.connector_id = h.id;
```

- `delay_minutes` é o que o cartão mostra ("2 h 10 min além do esperado"); o estado só vira "Atrasado" depois da folga
  (`late_tolerance_minutes`: 10% da frequência, no mínimo 5 min).
- O cartão "A ligar" mostra a última falha e o código, quando houver tentativa.
- **Cada trabalho conta.** O estado do conector é o pior entre o acima e o de cada trabalho de `connector_jobs`
  (trabalho cujo `last_success_at` passou de `expected_every_minutes + late_tolerance_minutes` → `late`; de duas vezes
  a frequência, com a última rodada dele falhada → `down`; CTE `jobs`). O cartão diz qual trabalho está atrasado
  (`late_jobs`: "Releitura atrasada", "Passada completa atrasada"). Assim a passada completa do CRM, que apaga o que
  saiu de lá, nunca fica parada sem ninguém ver.
- **Rodada apps → CSP 360:** a última rodada OK de `crm_upstream_runs` por marca; atrasada depois de 10 min de
  frequência + 5 de folga; sem linha → "Sem dados".
- **"Atualizado há"** de cada tela = a `last_success_at` mais antiga entre as fontes com base que a tela usa (seção
  6.11). Na tela de Conectores, a mais recente.

---

## 5. Funções de tela

Todas: `stable`, `security invoker`, `set search_path = ''`, `revoke all … from public, anon`, `grant execute … to
authenticated`. As views `api.v_traffic_actions` e `api.v_traffic_log` continuam como base das listas do Tráfego e do
teste de RLS; o nome de quem fez sai de `authz.display_name` (só o nome, para quem tem `view_traffic`).

| Função | Tela | Permissão (todas conferidas na primeira linha) | Devolve |
|---|---|---|---|
| `api.kpi_overview(p_filters jsonb)` | Visão geral | `view_numbers`, `view_leads`, `view_traffic` e `view_connectors` | indicadores, por marca, por canal, por dia, contador da fila |
| `api.kpi_operators(p_filters jsonb)` | Gestor: Visão geral, Chegada, Leads, canais, Tráfego | `view_numbers`, `view_leads`, `view_traffic` e `view_connectors` | linhas Humano × Claude e `by_platform` |
| `api.kpi_spend_limits(p_filters jsonb)` | Gestor: Visão geral, canais, Tráfego | `view_numbers` e `view_connectors` | contas do mês: gasto, limite, uso, projeção, situação, alerta, ativas, do Claude, verba diária |
| `api.kpi_acquisition(p_filters jsonb)` | Chegada de clientes | `view_numbers`, `view_leads` e `view_connectors` | indicadores, matriz, funil, origem, marca, coorte, representante, opções |
| `api.kpi_customer_base(p_filters jsonb)` | Base de clientes | `view_numbers` e `view_connectors` | hoje, no período, faixas, por marca, por representante, recortes, opções |
| `api.list_customers(p_filters jsonb, p_segment mkt.customer_segment, p_limit int, p_offset int)` | Base (lista) | `view_numbers` | `{total, items}`, até 200 |
| `api.kpi_leads(p_filters jsonb)` | Leads | `view_leads`, `view_numbers` e `view_connectors` | indicadores, por dia, origem, marca, campanha, chips, opções |
| `api.list_leads(p_filters jsonb, p_stage mkt.lead_stage, p_limit int, p_offset int)` | Leads (lista) | `view_leads` e `view_numbers` (nome da campanha) | `{total, items}`, até 200 |
| `api.kpi_channel(p_platform mkt.platform, p_filters jsonb)` | Meta, TikTok, Google | `view_numbers`, `view_leads`, `view_traffic` e `view_connectors` | indicadores, séries, campanhas (até 200), selos, chips, opções de campanha, fila do canal, parar tudo |
| `api.kpi_instagram(p_filters jsonb)` | Instagram | `view_numbers` e `view_connectors` | perfis, séries, posts (até 200) |
| `api.kpi_seo_geo(p_filters jsonb)` | SEO e GEO | `view_numbers`, `view_leads`, `view_traffic` (pendências) e `view_connectors` | busca, IA, leads e clientes por fonte, checagem, pendências |
| `api.kpi_traffic(p_filters jsonb)` | Tráfego com IA | `view_traffic`, `view_numbers`, `view_leads` (a estratégia usa VG1 e LE3) e `view_connectors` | fila, indicadores, pendências, Claude agora, parada ativa, estratégias, opções de campanha |
| `api.list_traffic_actions(p_filters jsonb, p_list jsonb, p_limit int, p_offset int)` | Tráfego (lista) | `view_traffic`, `view_numbers` (campanha) e `view_connectors` (alerta de limite) | chips por status, `{total, total_without_list_filters, items}` |
| `api.list_traffic_log(p_filters jsonb, p_before_at timestamptz, p_before_seq bigint, p_limit int)` | Tráfego (diário) | `view_traffic` | até 200 eventos, mais novos primeiro (`order by occurred_at desc, seq desc`; a página seguinte começa em `(occurred_at, seq) < (p_before_at, p_before_seq)`), e o total |
| `api.preview_action(p_campaign_id uuid, p_kind mkt.action_kind, p_params jsonb)` | janelas Pausar e Ajustar | `operate_traffic`, `view_numbers`, `view_leads` e `view_connectors` | custo estimado (o mesmo de `api.propose_action`) e o alerta de limite, antes de gravar |
| `api.kpi_connectors()` | Conectores | `view_connectors` | cartões, resumo, situação geral, rodada apps → CSP 360, credenciais |

A base de cada fonte (`connectors`, seção 2.3) pede `view_connectors`: toda função de tela que lê a base confere essa
permissão na primeira linha, com as outras, e quem não a tiver recebe `KPI-403` (decisão 0034).

Esboço da Visão geral (as outras seguem o mesmo molde):

```sql
create or replace function api.kpi_overview(p_filters jsonb) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  f  mkt.kpi_filters;
  w  mkt.period_window;
  cs mkt.cost_scope;
  r  mkt.acquisition_row;
  a  mkt.acquisition_row;   -- current
  ac mkt.acquisition_row;   -- comparable_current (dias completos)
  ap mkt.acquisition_row;   -- comparable_previous
begin
  -- Permissão antes de tudo: quem não pode recebe KPI-403, nunca KPI-400 nem um 0 da RLS.
  if not (authz.can('view_numbers') and authz.can('view_leads') and authz.can('view_traffic')
          and authz.can('view_connectors')) then
    raise sqlstate 'PT403' using message = 'KPI-403';
  end if;
  f  := mkt.parse_filters(p_filters);
  w  := mkt.period_window(f.period, least(mkt.complete_through('csp360'), mkt.complete_through('meta')));
  cs := mkt.cost_scope(f);
  -- Uma chamada só: as três linhas vêm juntas, e cada fonte é lida uma vez (seção 4.3).
  for r in select * from mkt.acquisition(cs.filters, w) loop
    case r.side when 'current' then a := r; when 'comparable_current' then ac := r; else ap := r; end case;
  end loop;

  return jsonb_build_object(
    'period',     mkt.period_json(w),
    'coverage',   mkt.coverage_json(),
    'updated_at', mkt.freshness('{csp360,meta,tiktok,google_ads,instagram}'),
    'cost_not_applicable', cs.not_applicable,
    'cost_per_new_customer',
      case when cs.not_applicable is null
           then mkt.metric(a.cost_per_new_customer_cents, ac.cost_per_new_customer_cents,
                           ap.cost_per_new_customer_cents, f.compare, 'money') end,
    'attributed_new_customers', a.attributed_new_customers,
    'new_customers', mkt.metric(a.new_customers, ac.new_customers, ap.new_customers, f.compare),
    'leads',         mkt.metric(a.leads, ac.leads, ap.leads, f.compare),
    'investment',    mkt.metric(a.investment_cents, ac.investment_cents, ap.investment_cents, f.compare, 'money'),
    'orders',        mkt.orders_summary(f, w),                -- VG5 a VG8
    'instagram_reach_sum',                                     -- VG9, com os dias completos do Instagram
      mkt.ig_reach_summary(f, mkt.period_window(f.period, mkt.complete_through('instagram'))),
    'leads_without_brand', mkt.leads_without_brand(f, w),
    'by_brand',    mkt.acquisition_by(cs, w, 'brand'),        -- grouping sets, a mesma acquisition_ratios
    'by_platform', mkt.acquisition_by(cs, w, 'platform'),
    'daily',       mkt.leads_and_new_customers_by_day(f, w.current_window),
    'has_data',    mkt.source_covered('csp360') or mkt.ads_covered(null, null) or mkt.ig_covered(null),
    'queue_count', mkt.queue_count(f));
end $$;

revoke all on function api.kpi_overview(jsonb) from public, anon;
grant execute on function api.kpi_overview(jsonb) to authenticated;
```

Funções de apoio citadas no esboço, todas `stable` e no esquema `mkt`: `coverage_json()` (base de cada conector,
seção 2.3); `freshness(códigos)` (a rodada boa mais antiga entre os conectores com base); `complete_through(código)`
(o último dia completo de cada fonte, seção 2.1); `orders_summary(f, w)` (VG5 a VG8); `ig_reach_summary(f, w)` (VG9);
`leads_without_brand(f, w)`; `acquisition_by(escopo de custo, w,
'brand' | 'platform')` (as linhas por marca ou canal, com `grouping sets` e `mkt.acquisition_ratios`);
`leads_and_new_customers_by_day(f, janela)`; `queue_count(f)` (seção 4.6). O nome de quem fez, nas telas de tráfego,
sai de `authz.display_name(profile_id)`, que devolve só o nome e só para quem tem `view_traffic`
([`papeis-e-rls.md`](papeis-e-rls.md)).

---

## 6. Métrica por métrica

### 6.1 Visão geral — `api.kpi_overview`; Gestor: `api.kpi_operators`, `api.kpi_spend_limits`

| # | Na tela | Chave | Conta | Filtros | Sem dados | Teste |
|---|---|---|---|---|---|---|
| VG1 | Custo por cliente novo | `cost_per_new_customer` | `mkt.acquisition`: investimento ÷ clientes novos atribuídos | M P Cmp Ca Cp Op; Or e Rep pela 0032 | N1 N2 N3 | [Q] "conta leads, clientes novos, investimento e custo…"; [VG] "o divisor do custo são os clientes novos que vieram de campanha" |
| VG2 | Clientes novos | `new_customers` | clientes com o 1º pedido no período (seção 3.6), contados pelo pedido | todos | N1 N4 | [Q] idem; [VG] "traz os números do período…" — **muda** (0029: entra cliente sem lead; 0030: grupo em "As duas") |
| VG3 | Leads | `leads` | leads do recorte que chegaram no período | todos | N1 N4 | [Q] idem |
| VG4 | Investimento | `investment` | Σ gasto das campanhas do recorte, só canais com base | M P Cmp Ca Cp Op; Or de mídia paga entra como canal (0032) | N1 N4 | [Q] idem |
| VG5 | Pedidos enviados | `orders.count` | pedidos `sent` (o faturado incluso) com dia de envio no período | M P Cmp | N1 N4 | [Q] idem — **muda** (0015: orçamento e cancelado saem) |
| VG6 | Valor dos pedidos | `orders.total_cents` | Σ `total_cents` dos pedidos de VG5 | M P Cmp | N1 N4 | [Q] idem |
| VG7 | Valor faturado | `orders.invoiced_total_cents` | Σ `invoiced_total_cents` dos pedidos de VG5 faturados; nulo se algum não tem valor | M P Cmp | N5 | [Q] `valorFaturado` nulo |
| VG8 | "N pedidos faturados" | `orders.invoiced_count` | pedidos de VG5 com `is_invoiced` | M P Cmp | N1 | [Q] `faturados` |
| VG9 | Alcance somado dos dias (Instagram) | `instagram_reach_sum` | Σ `reach` de `ig_account_daily` no período; base por `mkt.ig_covered` | M P Cmp | N1 N4 | [Q] idem — rótulo muda (0033) |
| VG10 | "…pelos N clientes novos que vieram de campanha" | `attributed_new_customers` | o divisor de VG1 | como VG1 | N1 | [VG] "o divisor do custo…" |
| VG11 | "N leads sem marca…" | `leads_without_brand` | leads do período sem marca | todos | N1 | [VG] "sinaliza os leads sem marca, que entram nas duas marcas" |
| VG12 | Por marca (só em "As duas") | `by_brand[]` | linha por marca (escopo da marca) e total (grupo): investimento, leads atribuídos, clientes novos atribuídos, custo, `cross_brand_new_customers` | M P Cmp Ca Cp Op; Or de mídia paga entra como canal (0032) | como VG1 | [VG] "por marca e por canal seguem o contexto e o filtro"; [Q] "por canal e por marca", "marca × canal com total" — **muda** o total (0030) |
| VG13 | Por canal (sem filtro de canal) | `by_platform[]` | a mesma conta com o canal; o lead conta no canal da sua origem | M P Cmp Cp Op; Or de mídia paga entra como canal (0032) | N1 por canal | idem |
| VG14 | Gráfico custo por canal | `by_platform[].cost_per_new_customer` | = VG13 | — | todos nulos → "Sem dados" | [VG] idem |
| VG15 | Leads e clientes novos por dia | `daily[]` | por dia: leads com `created_on` = dia; clientes novos com `first_order_on` = dia; 0 no dia sem nada | M P Ca Cp Op Or Rep | N1 (todos os dias) | [VG] "leads e clientes novos por dia, no dia de São Paulo, com o cliente contado uma vez" — **muda** (0029: entra cliente sem lead; 0030: grupo em "As duas"; 0031: primeiro toque) |
| VG16 | Humano × Claude (Gestor) | `api.kpi_operators`, linhas VG da seção 4.4 | seção 4.4 | M P Ca Cp (Op não vale) | por linha | [VG] "na visão Gestor: Humano × Claude na ordem da tela, com o lado melhor…" — **muda** (0027; 0028: ROAS; seção 7 nº 5) |
| VG17 | Verba e limite por conta (Gestor) | `api.kpi_spend_limits` | `mkt.v_account_month`: gasto do mês até hoje ÷ limite do mês; perto a partir de 0,9, acima a partir de 1 | M Ca (o período não muda a régua) | N1 no gasto; sem limite → "Limite não definido" | [VG] "na visão Gestor: verba e limite por conta…", "…a partir de 100% do limite…" — **muda** (0021) |
| VG18 | Contador de "Abrir Tráfego com IA" | `queue_count` | ações na fila (seção 4.6) | M Ca Cp Op | dado do CSP-MKT: 0 esconde o contador | [VG] "na visão Gestor: propostas na fila, sem as pendências de medição" |

### 6.2 Chegada de clientes — `api.kpi_acquisition`

| # | Na tela | Chave | Conta | Filtros | Sem dados | Teste |
|---|---|---|---|---|---|---|
| CH1 | Leads | `leads` | = VG3 | todos | N1 N4 | [CH] "KPIs com as mesmas contas da Visão geral" |
| CH2 | Clientes novos | `new_customers` | = VG2 | todos | N1 N4 | idem — **muda** (0029, 0030) |
| CH3 | Leads que viraram cliente | `lead_to_customer_rate`, `converted_leads` | leads do período com `first_order_at` ÷ leads do período, **por lead**, sem comparação | todos | N1 N2 | [CH] "conversão dos leads do período e tempo até o 1º pedido" — **muda** (0029: sem variação) |
| CH4 | Custo por cliente novo | `cost_per_new_customer`, `cost_not_applicable` | = VG1 com `mkt.cost_scope` | todos | N1 N2 N3 | [CH] "origem paga mostra o custo do canal…"; [CH] `filtrosDeCusto` (4 casos) → `cost-scope.test.ts` — **muda** o caso "origem paga diferente do canal fica, para o custo ficar sem base" (0032: vira "Não se aplica") |
| CH5 | Matriz marca × canal | `matrix[]` | célula = `mkt.acquisition` com a marca (nula = grupo) e o canal (nulo = todos); "Ver investimento e clientes atribuídos" traz investimento, atribuídos, custo e anterior | M P Cmp Ca Cp Op; Rep → N3; Or pela 0032 (origem paga: custo na coluna do canal dela e no total, N3 nas outras; outra origem: N3) | como VG1 | [CH] "matriz marca × canal com As duas…", "com uma marca só, sem linha As duas" — **muda** a linha "As duas" (0029, 0030, 0031) |
| CH6 | Humano × Claude (Gestor) | `api.kpi_operators`: `investment`, `budget_share`, `new_customers`, `cost_per_new_customer` | seção 4.4; com N3 o bloco some | M P Ca Cp | por linha | [CH] "Humano × Claude só nas linhas de cliente novo" |
| CH7 | Funil | `funnel[]` | etapa i: leads do período com `mkt.list_rank('lead_stage', stage) >= i` (a ordem da lista, nunca a do texto); da anterior = total_i ÷ total_{i−1}; do total = total_i ÷ total_0; comparação **só** em "Leads" | todos | N1 N2 | [Q] "etapas acumuladas com taxas", "do 1º pedido em diante só conta quem tem o carimbo do pedido…"; [CH] "funil com o total, a taxa da etapa anterior…" — **muda** (0029) |
| CH8 | Do lead ao 1º pedido (dias) | `days_to_first_order` | média de `first_order_on − created_on` dos leads do período que viraram cliente | todos | N1; nulo sem nenhum | [Q] `tempoMedio`; [CH] "conversão dos leads do período e tempo…" |
| CH9 | Entre as outras etapas | `days_between_other_stages` | nulo até o CRM datar as etapas (lacunas 1 a 3 do levantamento do CRM) | — | N5 | — |
| CH10 | "N leads sem marca entram no funil" | `leads_without_brand` | = VG11 | todos | N1 | [CH] idem |
| CH11 | Por origem (dois gráficos) | `by_origin[]` | origens com lead no período: leads, viraram (por lead), conversão; ordem: leads, depois `mkt.list_rank('lead_origin', origin)` | todos | N1 | [CH] "por origem, do maior para o menor; empate segue a ordem das origens" |
| CH12 | Por marca (só em "As duas") | `by_brand[]` | por marca: leads da marca ou sem marca, viraram, conversão, dias | todos | N1 | [CH] "por marca só com As duas…" |
| CH13 | Coorte | `cohort[]` | os 4 meses que terminam no mês do fim do período: leads que chegaram no mês, viraram até hoje, conversão | M Ca Cp Op Or Rep | N1 | [Q] "coorte com os 4 meses certos também no dia 31…"; [CH] "coorte dos últimos 4 meses" |
| CH14 | Por representante | `by_sales_rep[]`, `leads_without_sales_rep` | quem recebeu o lead (0025): leads, viraram, conversão, dias; ordem: viraram, leads, código (regra de código da seção 8); sem representante = total − soma | todos | N1 | [CH] "por representante e os leads ainda sem representante" |
| CH15 | Opções do painel | `options.campaigns[]`, `options.sales_reps[]` | campanhas da marca e do canal, por nome (até 200); representantes que já receberam lead da marca, por código (regras de nome e de código da seção 8) | M Ca | — | [CH] "opções de campanha (da marca) e de representante" |

### 6.3 Base de clientes — `api.kpi_customer_base`, `api.list_customers`

| # | Na tela | Chave | Conta (seção 4.7) | Filtros | Sem dados | Teste |
|---|---|---|---|---|---|---|
| BA1 | Clientes na base | `today.customers`, `today.without_situation` | da base no escopo | M Rep | N1 | [BA] "hoje, pela situação do CSP 360…", "tem pedido ou situação de cliente…" — **muda** (0030: escopo da marca; sai quem não comprou da marca) |
| BA2–4 | Ativos · Inativos (recentes e antigos) · Perdidos | `today.active`, `today.inactive` (recentes + antigos; nula sem situação conhecida), `today.inactive_recent`, `today.inactive_old`, `today.lost` | da base por situação: a da marca; em "As duas", a melhor | M Rep | N1; nulo sem situação conhecida | [BA] "sem situação: ativos, inativos e perdidos ficam null" — **muda** (situação por marca) |
| BA5 | Sem situação | `today.without_situation` | da base sem situação | M Rep | N1 | [BA] idem |
| BA6 | Taxa de recompra | `period.repurchase_rate`, `period.repurchased` | recompraram ÷ antigos, no escopo | M P Cmp Rep | N1 N2 | [BA] "no período: recompra, reativados e receita…" — **muda** (antigo no escopo, 0030) |
| BA7 | Reativados | `period.reactivated` | antigos com 90 dias ou mais sem comprar antes do 1º pedido do período | M P Cmp Rep | N1 | [BA] idem; [Q] "antigos, recompra, reativados…" — **muda** (sem o pedido mais antigo do conjunto) |
| BA8 | Receita de antigos | `period.old_revenue_cents` | Σ pedidos do período dos antigos | M P Cmp Rep | N1 N4 | [BA] idem |
| BA9 | Receita de novos | `period.new_revenue_cents` | Σ pedidos do período dos outros | M P Cmp Rep | N1 N4 | [BA] idem |
| BA10 | Parte dos antigos e dos novos | `period.old_revenue_share`, `period.new_revenue_share` | antigos ÷ (antigos + novos); novos ÷ (antigos + novos), só o atual | M P Cmp Rep | N2 | [BA] idem |
| BA11 | Tempo desde a última compra | `recency[]` | da base por faixa (`mkt.recency_bucket`), com a última compra no escopo | M Rep | N1 | [BA] "tempo desde a última compra, por faixa" — **muda** (na marca, a da marca) |
| BA12 | Por marca | `by_brand[]` | uma linha por marca e "As duas" (grupo): clientes, ativos, inativos, perdidos, recompraram, taxa, reativados | P Rep | N1 | [BA] "por marca: cada marca com a própria régua…" — **muda** (0030) |
| BA13 | Por representante | `by_sales_rep[]` | carteira (0025) na marca; em "As duas", em qualquer marca (quem está em duas carteiras conta nas duas linhas); "Sem carteira" por último; ordem: clientes, código (seção 8) | M P Rep | N1 | [BA] "por representante: carteira de cada um…" — **muda** (0025: a soma das carteiras deixa de fechar com o total) |
| BA14 | Chips | `segments` | ativos, inativos, perdidos (nulos sem situação), reativados, sem situação | M P Rep | — | [BA] "cada filtro rápido mostra o seu grupo, na ordem da lista" |
| BA15 | Lista | `api.list_customers` | da base, há mais tempo sem comprar primeiro (nulo por último), depois código (seção 8); código, marcas em que comprou, situação, última compra, no período ("Reativado" ou "Comprou"), id do CRM para o link | M P Rep + recorte | vazia | [BA] "lista: há mais tempo sem comprar primeiro…", "corta no limite e diz quantos o grupo tem" |
| BA16 | Opções de representante | `options.sales_reps[]` | códigos com carteira na marca, pela regra de código da seção 8 | M | — | [BA] "representante: só a carteira dele" |
| BA17 | Aviso do CSP 360 e "atualizado há" | `source` | `mkt.v_connector_health` do `csp360` | — | — | [BA] "conector do CSP 360, para avisar atraso" |

### 6.4 Leads — `api.kpi_leads`, `api.list_leads`

| # | Na tela | Chave | Conta | Filtros | Sem dados | Teste |
|---|---|---|---|---|---|---|
| LE1 | Leads | `leads` | = VG3 | todos | N1 N4 | [LE] "conta os leads do período e compara com o anterior" |
| LE2 | Lead → cliente novo; "X de Y leads viraram cliente" | `lead_to_customer_rate`, `converted_leads`, `leads` | = CH3, por lead, sem comparação | todos | N1 N2 | [LE] "lead → cliente novo: … um por cliente" — **muda** (0029: por lead) |
| LE3 | Custo por lead | `cost_per_lead`, `cost_not_applicable` | `mkt.acquisition` com `mkt.cost_scope`: investimento ÷ leads do período atribuídos (0027) | todos | N1 N2 N3 | [LE] "custo por lead = investimento ÷ leads de anúncio…", "o custo por lead é o mesmo da Visão geral…", "origem de anúncio…", "origem sem mídia ou um representante…", "com leads mas sem investimento lido…" |
| LE4 | Sem marca · WhatsApp | `leads_without_brand` | leads do período sem marca, com comparação | todos | N1 | [LE] "lead sem marca (SDR) em separado…" |
| LE5 | Leads por dia | `daily[]` | por dia: total, cs, plumene e sem marca (marca exata); 0 no dia sem lead | todos | N1 | [LE] "por dia: um ponto por dia do período…" |
| LE6 | Por origem | `by_origin[]` | origens com lead no período ou no anterior: leads (comparação), viraram, taxa; maior primeiro, empate por `mkt.list_rank('lead_origin', origin)` | todos | N1 | [LE] "por origem: só as presentes, maior primeiro…" — **muda** (0029: viraram por lead) |
| LE7 | Por marca | `by_brand[]` | marca exata (cs, plumene, sem marca; com marca escolhida, ela e sem marca): leads (comparação), viraram, taxa | todos | N1 | [LE] "por marca: as duas e Sem marca" — **muda** (0029: viraram por lead) |
| LE8 | Por campanha | `by_campaign[]` | uma linha por campanha atribuída e uma por UTM sem campanha (com a marca "UTM repetida" quando casa com mais de uma): leads (comparação), viraram, taxa; no Gestor, operador, investimento e custo por lead (só campanha atribuída; N3 com a 0032); nome pela regra da seção 8 | todos | N1 | [LE] "por campanha: casa a UTM com a campanha…", "por campanha: investimento e custo por lead…" — **muda** (0029: viraram por lead) |
| LE9 | Humano × Claude | `api.kpi_operators`: `leads`, `converted_leads`, `lead_to_customer_rate`, `investment`, `cost_per_lead`, na ordem da tela | seção 4.4 | M P Ca Cp (Op não vale) | por linha | [LE] "Humano × Claude: a mesma linha lado a lado…", "…ignora o filtro de operador…" — **muda** (0029: por lead; 0032: com N3 o bloco some) |
| LE10 | Chips de origem | `origin_chips[]` | leads do período por origem, sem o filtro de origem; só acima de 0; maior primeiro, empate por `mkt.list_rank('lead_origin', origin)` | M P Ca Cp Op Rep | vazia | [LE] "chips de origem…" |
| LE11 | Chips de etapa | `stage_chips[]` | leads do período por etapa exata, na ordem do funil | todos | N1 | [LE] "chips de etapa…" |
| LE12 | Lista e "Mostrando N de M" | `api.list_leads` | leads do período (ou da etapa), mais novos primeiro, desempate pelo código; código, origem, marca, campanha (o nome da campanha atribuída; sem campanha, a `utm_campaign` só quando `mkt.has_personal_data` não a marca, senão "UTM sem campanha"), etapa, chegada, id do CRM para o link ou "A cadastrar"; total | todos + etapa | vazia | [LE] "mais novos primeiro…", "só os campos combinados…", "a etapa filtra só a lista…", "corta em 200…", "lê a etapa da URL…" |
| LE13 | Opções | `options` | campanhas da marca; representantes que receberam lead da marca (regras de nome e de código da seção 8) | M Ca | — | [LE] "marca escolhida inclui o lead sem marca e só as opções dela" |
| — | Origem fora do de-para | `unmapped_origin_count` | leads do período com `is_origin_unmapped` (pendência de dado, não número de marketing) | M P | N1 | novo |

### 6.5 Canais — `api.kpi_channel(p_platform, p_filters)`

O canal vem da rota e vence `platform` dos filtros.

| # | Na tela | Chave | Conta | Filtros | Sem dados | Teste |
|---|---|---|---|---|---|---|
| CA1 | Investimento | `investment` | `mkt.ad_summary` das campanhas da rota | M P Cmp Cp Op | N1 N4 | [CA] "KPIs e campanhas só da plataforma da rota…", "o canal vem da rota, não do filtro ?canal=" — **muda** (0027 e 0028: `totais.leads` e `totais.roas` deixam de ser os da plataforma) |
| CA2 | Leads | `leads` | leads do período atribuídos às campanhas da rota (CSP 360) | idem | N1 | **muda** (0027) |
| CA3 | Custo por lead | `cost_per_lead` | CA1 ÷ CA2 | idem | N2 | **muda** (0027) |
| CA4 | Custo por cliente novo | `cost_per_new_customer` | CA1 ÷ CA5 | idem | N2 | [CA] idem — **muda** (0029, 0030, 0031) |
| CA5 | Clientes novos | `attributed_new_customers` | clientes novos do período atribuídos às campanhas da rota | idem | N1 | [CA] idem — **muda** (0029, 0030, 0031) |
| CA6 | ROAS | `roas` | receita do 1º pedido dos clientes de CA5 ÷ CA1 | idem | N1 N2 | **muda** (0028) |
| CA7 | Conversões | `conversions` | Σ informado pela plataforma | idem | N1 N4 | [CA] idem |
| CA8 | Custo por conversão | `cost_per_conversion` | CA1 ÷ CA7 | idem | N2 | [CA] idem |
| CA9 | Impressões | `impressions` | Σ | idem | N1 N4 | [CA] idem |
| CA10 | Cliques | `clicks` | Σ | idem | N1 N4 | [CA] idem |
| CA11 | CTR | `ctr` | cliques ÷ impressões | idem | N2 | [CA] idem |
| CA12 | CPC | `cpc` | investimento ÷ cliques | idem | N2 | [CA] idem |
| — | Leads, custo por lead e ROAS informados pela plataforma | `platform_leads`, `platform_cost_per_lead`, `platform_roas` | seção 4.2; aparecem na tabela de campanhas e no "Ver como tabela" | idem | N1 N2 | [Q] "uma linha por campanha, com CPL, ROAS…" — **muda** (nomes) |
| CA13 | Investimento e leads por dia, por operador | `daily_by_operator[]` | por dia e operador (os dois, ou o do filtro, só os que têm campanha): Σ gasto e leads atribuídos; 0 no dia sem número | M P Cp Op | N1 → lista vazia | [CA] "séries por operador somam o investimento do período" — **muda** (0027: a série de leads passa a ser a do CSP 360) |
| CA14 | Campanhas (Resultado, Anúncios, Verba e teto) | `campaigns[]` (até 200), `campaigns_total` | campanhas da rota com gasto, lead atribuído ou cliente novo atribuído no período ou no anterior, ou ativas (a soma das linhas fecha com CA2 e CA5); ordem: investimento atual, nome (seção 8), id; CA1–CA12 por campanha e os números da plataforma; verba diária; teto da plataforma (informação); uso do teto = investimento ÷ teto; UTM repetida: custo por cliente novo e ROAS nulos | M P Cmp Cp Op | N1 N2 | [Q] "uma linha por campanha…"; [CA] idem — **muda** (0029, 0030, 0031; só as relevantes; desempate explícito) |
| CA15 | Selos "Pausa aprovada / em execução" e "Orçamento aprovado" | `campaigns[].open_actions[]` | ações `pause` ou `budget` da campanha com status `approved` ou `running`, sem filtro; valor de `params.daily_budget_cents` | — | vazia | [CA] "ações abertas (aprovadas ou em execução)…"; [CA] `orcamentoPedido` |
| CA16 | Chips Humano e Claude | `operator_counts` | campanhas da marca na plataforma por operador, qualquer status | M | N1 | [CA] "filtro de operador…", "chips, opções de campanha…" |
| CA17 | Propostas do canal, "1 de N" | `queue[]` | a fila (seção 4.6) com a plataforma da rota, na ordem única | M Cp Op | vazia | [CA] "fila de propostas do canal…" — **muda** (ordem única) |
| CA18 | Humano × Claude e a frase | `api.kpi_operators` (linhas de canal) | seção 4.4; a frase usa o custo por cliente novo ou, sem ele, o custo por lead | M P Cp + rota | por linha | [CA] "Humano × Claude com o sentido de cada diferença…" — **muda** (0028: ROAS) |
| CA19 | Verba e limite por conta | `api.kpi_spend_limits` | = VG17 com a rota | M | como VG17 | [CA] "verba e teto por conta…" — **muda** (0021) |
| CA20 | Parar tudo | `stop_all.active_claude_campaigns`, `stop_all.by_platform` | campanhas ativas do Claude da marca, em todos os canais, que ainda não estão numa parada aberta (0022; é o número que `api.stop_all` confere) | M | N1 | [CA] "parar tudo conta as ativas do Claude…"; [OP] "a contagem da tela é o que a ação pausa" |
| CA21 | Aviso do conector e "atualizado há" | `source` | `mkt.v_connector_health` do conector da rota | — | — | [CA] "chips, opções de campanha e conector da plataforma" |
| CA22 | Janelas Pausar e Ajustar | `api.preview_action` | investimento, custo por lead e clientes novos da linha; custo estimado do ajuste = `greatest(0, novo − coalesce(atual, params.previous_daily_budget_cents, 0))` × 30, e o alerta de limite (seção 4.5) | — | — | [OP] "ajuste de orçamento guarda o valor novo e o anterior…" → `traffic.test.ts` |
| CA23 | Opções do filtro de campanha | `options.campaigns[]` | campanhas da marca na plataforma da rota, qualquer status, por nome (regra de nome da seção 8), até 200 | M | — | [CA] "chips, opções de campanha e conector da plataforma" |

### 6.6 Instagram — `api.kpi_instagram`

Base de todos os números: `mkt.ig_covered(marca)` (seção 2.3). A marca sem perfil lido fica "Sem dados".

| # | Na tela | Chave | Conta (seção 4.8) | Filtros | Sem dados | Teste |
|---|---|---|---|---|---|---|
| IG1 | Seguidores e saldo | `profiles[].followers`, `followers_change` | último não nulo do período; saldo contra o último não nulo antes dele | M P | N1; nulo sem linha no período | [IG] "em As duas traz os dois perfis…"; [Q] "instagram por marca" |
| IG2 | Alcance somado dos dias | `reach_sum` | Σ `reach` | M P Cmp | N1 N4 | [IG] idem — rótulo muda (0033) |
| IG3 | Visualizações | `views` | Σ `views` | M P Cmp | N1 N4 | **muda**: era "Impressões" (0033) |
| IG4 | Interações | `interactions` | Σ `total_interactions` | M P Cmp | N1 N4 | rótulo muda (0033) |
| IG5 | Taxa de interação | `interaction_rate` | IG4 ÷ IG2 | M P Cmp | N2 | — |
| IG6 | Salvos | `saves` | Σ `saves` do retrato mais recente dos posts publicados no período | M P Cmp | N1 N4 | [IG] "sem nenhum número do Instagram…" |
| IG7 | "N posts publicados no período" | `posts_count` | posts publicados no período | M P | N1 | [Q] `posts` |
| IG8–9 | Seguidores e alcance por dia | `daily[]` | valor do dia; nulo sem linha | M P | — | [IG] idem |
| IG10 | Posts do período | `posts[]` (até 200), `posts_total` | interações e taxa do post; ordem: alcance, publicação | M P | vazia | [IG] "posts do período com engajamento = curtidas + comentários + salvos…" — **muda** (0033) |
| IG11 | Aviso e "atualizado há" | `source`, `has_data` | conector `instagram` | — | — | [IG] "traz o estado do conector…", "outras telas com dados e o Instagram sem nada…" |

### 6.7 SEO e GEO — `api.kpi_seo_geo`

Base: Search Console por `mkt.web_covered(marca, 'gsc_site')` (SG1 a SG7) e GA4 por `mkt.web_covered(marca,
'ga4_property')` (SG8 a SG12). Um site que já mede e outro que não: o segundo fica "Sem dados", não 0.

| # | Na tela | Chave | Conta (seção 4.8) | Filtros | Sem dados | Teste |
|---|---|---|---|---|---|---|
| SG1–3 | Impressões, cliques, CTR | `seo.impressions`, `seo.clicks`, `seo.ctr` | Σ `seo_daily` das propriedades da marca | M P Cmp | N1 N2 | [SG] "reaproveita os indicadores de seoGeo…" |
| SG4 | Posição média | `seo.position` | ponderada pelas impressões | M P Cmp | N1; nula com 0 impressões | [Q] "posição média ponderada pelas impressões; sem impressões é null, nunca 0" |
| SG5 | Cliques por dia | `seo.daily[]` | por marca e dia; nulo sem linha | M P | — | [SG] "desenha cliques e posição por dia…" |
| SG6 | Posição por dia | `seo.daily[]` | a posição do dia; nula com 0 impressões | M P | — | idem — **muda** (seção 7 nº 6) |
| SG7 | Consultas que mais trazem; "N consultas · X% dos cliques" | `seo.top_queries[]` (10), `seo.queries_count`, `seo.top_queries_click_share` | por marca e consulta: Σ impressões, Σ cliques, CTR, posição ponderada; ordem: cliques, impressões, consulta (regra de nome da seção 8) | M P | N1; vazia | [SG] "lista as consultas do período…" — **muda** (nº 6) |
| SG8 | Sessões de IA | `geo.ai_sessions` | Σ sessões de `mkt.v_ga4_ai_daily` | M P Cmp | N1 | [SG] "soma as sessões por assistente…" — **muda** (passa a somar "Outro assistente") |
| SG9 | Parcela de IA | `geo.ai_share` | SG8 ÷ Σ sessões de todos os canais | M P Cmp | N1 N2 | [SG] "calcula a parcela de IA nas sessões do GA4…" |
| SG10 | Sessões por assistente | `geo.by_ai_source[]` | os cinco e "Outro assistente": sessões (comparação) e parte; ordem: sessões, depois `mkt.list_rank('ai_source', …)` | M P Cmp | N1 | [SG] idem — **muda** (entra "Outro") |
| SG11 | Sessões por canal | `geo.by_channel[]` | canais com sessão; parte; maior primeiro | M P | vazia | [SG] idem |
| SG12 | Sessões de IA por dia | `geo.daily[]` | por marca e dia; nulo sem linha | M P | — | [SG] idem |
| SG13–16 | Leads e clientes novos da busca orgânica e de IA | `leads.organic`, `new_customers.organic`, `leads.ai`, `new_customers.ai` | leads do período com a origem; clientes novos do período cujo lead do crédito tem a origem | M P Cmp Ca Cp Op Rep | N1 | [SG] "conta leads e clientes novos da busca orgânica e de IA…", "respeita a marca e os filtros de lead da URL só nos leads" — **muda** (nº 10) |
| SG17 | Leads por fonte | `by_source[]` | orgânico por buscador, IA por assistente: leads (atual e anterior) e clientes novos; entra a linha com algum número; orgânico primeiro; ordem: leads, clientes, nome (seção 8) | idem | vazia | [SG] "abre por buscador e por assistente…" |
| SG18 | Checagem dos sites | `site_checks[]`, `site_checks_warnings` | `mkt.v_site_checks_latest` da marca; `warning` contados | M | vazia | [SG] "mostra o resultado mais recente de cada item…" |
| SG19 | Pendências de medição (Gestor) | `pending_fixes[]` | pendências abertas da marca, sem canal, campanha e operador | M | vazia | [SG] "traz as pendências de medição abertas da marca escolhida" |
| SG20 | Selos e "atualizado há" | `sources` | `search_console`, `ga4`, `csp360`; o topo usa a mais antiga das que têm base | — | — | [SG] "dá o selo de cada fonte…" |

### 6.8 Tráfego com IA — `api.kpi_traffic`, `api.list_traffic_actions`, `api.list_traffic_log`

| # | Na tela | Chave | Conta | Filtros | Sem dados | Teste |
|---|---|---|---|---|---|---|
| TR1 | Esperando sua decisão (e contador da aba) | `queue.count`, `queue.cost_cents` | fila da seção 4.6 e o custo dela | M Ca Cp Op | dado do CSP-MKT | [TR] "é a mesma fila de acoes()…"; [Q] "fila de aprovação sem pendências…" |
| TR2 | Aprovadas, a executar | `approved` | ações `approved` do recorte | M Ca Cp Op | — | [TR] "feitas pela data de execução e horas até aprovar…" |
| TR3 | Feitas no período | `done_in_period` | ações `done` com `executed_at` no período | + P Cmp | N4 | idem |
| TR4 | Horas até aprovar, em média | `hours_to_approve` | média de `approved_at − created_at`, em horas, das ações com `approved_at` no período | + P Cmp | N2 (nula sem nenhuma) | idem |
| TR5 | Fila de aprovação, "1 de N" | `queue.items[]` | ordem única; cada item: campanha (nome, status), conta do mês da conta da ação (`ad_account_id` em `mkt.v_account_month`; sem conta, nulo e sem alerta de limite), custo, impacto, esforço, proposta em, quem propôs, alerta | M Ca Cp Op | vazia | [TR] "a ordem desempata pela mais antiga", "traz os fatos e o alerta de cada proposta" |
| TR6 | Alerta da ação | `queue.items[].alert` | seção 4.6 (a conta do limite é a mesma da execução) | — | — | [TR] "traz os fatos e o alerta…" — **muda** (nº 19) |
| TR7 | Pendências | `pending_fixes[]` | `pending_fix` abertas do recorte, na ordem da fila | M Ca Cp Op | vazia | [TR] "pendência de medição não entra na fila…" |
| TR8 | O que podemos fazer | `api.list_traffic_actions` | ações do recorte filtradas por impacto e esforço; chips por status; lista pelo status; ordem da seção 4.6; `total_without_list_filters` | M Ca Cp Op + status, impacto, esforço | dado do CSP-MKT | [TR] "lista tudo na ordem…", "status, impacto e esforço filtram…" |
| TR9 | O Claude agora | `claude_now`, `claude_now.stoppable` | campanhas ativas do Claude nas marcas da tela, em todos os canais e por canal; e, para o botão "Parar tudo do Claude", as que ainda não estão numa parada aberta (= CA20, o número que `api.stop_all` confere) | M | N1 | [TR] "conta as campanhas ativas do Claude na marca, em todos os canais" |
| TR10 | "Claude parado…" e "Desfazer" | `active_stop` | última parada da marca (ou das duas) não desfeita, com campanha ainda pausada: quando, quem (nome), quantas, ainda pausadas, execuções bloqueadas | M | — | [TR] "mostra a parada enquanto…", "some depois de desfeita" |
| TR11 | Estratégia por marca | `strategies[]` | mês corrente, só a marca: investido no mês (qualquer status); orçamento diário somado das campanhas ativas da marca (`strategies[].active_daily_budget_cents`, a dica da verba); verba contra `mkt.pace`; custo por cliente novo (VG1); custo por lead (LE3); **clientes novos das campanhas** (atribuídos) contra a meta; custo ≤ meta → `within_target`, senão `above_target`; clientes ≥ meta → `target_met`, ≥ meta × dias decorridos ÷ dias do mês → `on_pace`, senão `behind_pace`; "Atualizada em … por {nome}" | M | meta nula → "A definir" | [TR] "sem estratégia…", "com estratégia…", "situações das metas" |
| TR12 | Limites de gasto por conta | `api.kpi_spend_limits` | = VG17, com projeção e situação | M Ca | como VG17 | [TR] "soma o gasto de todas as campanhas da conta no mês…", "o período escolhido não muda o gasto do mês", "respeita marca e canal", "sem dados…" — **muda** (0021: limite da conta, não a soma dos tetos) |
| TR13 | Humano × Claude e barras de custo por lead por canal | `api.kpi_operators` | as linhas da coluna TR da seção 4.4 (todas menos `converted_leads` e `lead_to_customer_rate`); barras = `by_platform[].cost_per_lead` | M P Ca Cp (Op não vale) | por linha | [RE] "custo menor é melhor; volume e verba não se julgam" — **muda** (leads, conversões e clientes novos deixam de ser julgados) |
| TR14 | Diário, "Mostrando N de M" | `api.list_traffic_log` | eventos de `traffic_log` no período, mais novos primeiro (desempate pela ordem de gravação, `seq`), com nome de quem fez e motivo; filtros da seção 2.2 | M P Ca Cp Op | vazio | [TR] "monta proposta, aprovação, execução e feita…", "junta o registro da tela…", "filtros da barra valem para o registro também", "o painel devolve 20 de cada vez e o total" |
| TR15 | Opções do filtro de campanha e campanhas da janela "Registrar ideia" | `options.campaigns[]` | campanhas das marcas da tela, com id, nome, marca, canal e status, qualquer status, por nome (regra de nome da seção 8), até 200; a barra usa as do canal do filtro e a janela tira as encerradas | M | — | novo (no protótipo a barra lê o store direto) |

### 6.9 Conectores — `api.kpi_connectors`

| # | Na tela | Chave | Conta (seção 4.9) | Sem dados | Teste |
|---|---|---|---|---|---|
| CO1 | Cartão de cada integração | `cards[]` | estado, última rodada boa, minutos, atraso, trabalhos atrasados (`late_jobs`), falhas seguidas, última falha (hora e código), aviso da última rodada boa que terminou em parte (código), linhas em 24 h, "Tentar de novo" pedido, estado da credencial (`api.credential_status`), CSV na fila | os sete cartões existem desde a migração | [CO] "atraso = minutos desde a última sincronização…", "funcionando que passou do esperado vira atrasado…", "conector que nunca sincronizou…" — **muda** (0024: folga e falhas seguidas) |
| CO2 | Ordem | `cards[]` | caídos, atrasados, funcionando, a ligar, desligados; empate pela ordem do menu, `mkt.list_rank('connector_menu', code)` (CSP 360, Meta, TikTok, Google Ads, Instagram, Search Console, GA4, como o `ORDEM_DOS_CONECTORES` do protótipo), depois o nome | — | [CO] "o que pede ação vem primeiro…" — **muda** (simulado → a ligar) |
| CO3 | Resumo e situação geral | `summary`, `overall` | contagem por estado; geral `down` > `late` > `ok` (`mkt.connectors_overall`) | — | [CO] "tudo em dia, com um simulado a ligar" — **muda** (a ligar) |
| CO4 | Rodada apps → CSP 360 | `upstream[]` | por marca: última rodada OK, minutos, atrasada depois de 15 min | sem linha → "Sem dados" | [CO] `rodadaAppsCrm` (3 casos) — **muda** (folga de 5 min) |
| CO5 | "atualizado há" | `updated_at` | a rodada boa mais recente entre todos | — | [Q] "conectores com atraso" |
| CO6 | Filtros | — | nenhum filtro vale | — | [CO] "marca, período e filtros de tela não mudam os conectores" |

### 6.10 Usuários, Configurações e Diagnóstico

- **Usuários:** `api.list_users()` (`security definer`, [`papeis-e-rls.md`](papeis-e-rls.md); dono primeiro, depois
  nome), contagem por papel. Com banco, há sempre um dono: a contagem nunca é nula. O quadro "Pode / Não pode" dos
  dois papéis vem de `role_permissions` (a única lista, decisão 0018) por `api.list_role_permissions()` (também
  `security definer`): papel, ação e se pede o segundo fator, para perfil ativo (a mesma regra da política da tabela).
  As ações que pedem o segundo fator ficam numa função só, `authz.requires_second_factor(acao)`, chamada por
  `authz.can`, `api.my_permissions()` e `api.list_role_permissions()`.
  A lista de ações e os rótulos vêm do `labels.ts`. `api.my_permissions()` traz só as do usuário e serve para mostrar
  ou esconder botões.
  [SI] "dono primeiro e, dentro do papel, por nome" → `users.test.ts`; "sem cadastro de acessos…" fica só no modo
  demonstração vazio.
- **Configurações:** `api.my_profile()`, `api.my_notification_preferences()`. Versão: `/version.json`, fora do banco.
- **Diagnóstico:** não lê o banco.

### 6.11 Contadores e "atualizado há"

- **Menu:** sem contador hoje. Se entrar, a fonte é TR1.
- Botão "Abrir Tráfego com IA" = VG18; aba "Fila e ações" = TR1; "1 de N" = TR5 e CA17.
- Chips: LE10, LE11, CA16, BA1 e BA14, TR8. O número do botão "Filtros" conta filtros na URL: não é dado.

| Tela | "Atualizado há" = a rodada boa mais antiga entre |
|---|---|
| Visão geral | `csp360`, `meta`, `tiktok`, `google_ads`, `instagram` (as que têm base) |
| Chegada, Leads | `csp360` e os anúncios com base (custo) |
| Base | `csp360` |
| Meta, TikTok, Google | o conector da rota e `csp360` |
| Instagram | `instagram` |
| SEO e GEO | `search_console`, `ga4`, `csp360` |
| Tráfego com IA | `meta`, `tiktok`, `google_ads`, `csp360` |
| Conectores | a mais recente de todas |
| Usuários | nenhuma fonte de fora: é dado do próprio CSP-MKT, lido na hora; mostra a hora da leitura (o protótipo mostrava a hora do conjunto de exemplo) |

### 6.12 O que não vira conta

Calculado no protótipo e sem tela: não vira view. `kpisVisaoGeral.porMarca` e `.porCanal` (a Visão geral usa
`custoPorClienteNovo`); `leadsPorOrigem` (só o `semMarca` fica, como VG11); `seoGeo().seo.serie`,
`geo.leadsPorAssistente`, `geo.clientesNovosPorAssistente` e `GeoDaily.leads` (o `lead_events` do GA4 fica guardado em
`ga4_traffic_daily`, sem tela, enquanto o lead do CSP 360 for a contagem oficial); `acoes().resumo` (menos
`custoEstimadoDaFilaCents`, que o Tráfego mostra em "Esperando sua decisão" e é o `queue.cost_cents` de TR1) e
`emExecucao`;
o `esperadoHoje` do ritmo (sai de `mkt.pace` e fica disponível); `baseDeClientes.porSituacao` e `antigos`; `ordersCount`,
`revenueCents` e `receitaNoPeriodoCents` da lista da base; o anterior e a variação de `viraramCliente`, de
`taxaConversao` e de `variacaoSeguidores`.

---

## 7. Divergências do protótipo → regra única

| # | Divergência (levantamento 7.4) | Regra | Onde |
|---|---|---|---|
| 1 | Uso do limite com três leituras | Limite por conta e mês; gasto do mês até hoje de todas as campanhas da conta; a mesma régua em toda tela | 0021; `mkt.v_account_month` |
| 2 | "Viraram cliente" por lead ou por cliente | Por lead, na conversão; por cliente, na contagem de clientes novos | 0029; `mkt.v_leads`, `mkt.v_new_customers` |
| 3 | Conversão com ou sem variação | Conversão de coorte nunca compara | 0029; seção 2.5 |
| 4 | "Ações executadas" pela criação | Pela data em que ficou feita (`executed_at`) | seção 4.4 |
| 5 | Cinco regras de "melhor ou pior" | Só eficiência se julga: custo menor é melhor; ROAS e taxa lead → cliente maiores são melhores; volume (leads, conversões, clientes novos), verba, parcela, campanhas e ações são neutros | seção 4.4 |
| 6 | Posição média ponderada no indicador e simples na série | Ponderada pelas impressões em todo lugar; nula com 0 impressões | seção 4.8 |
| 7 | Qual lead fica na deduplicação | Primeiro toque, desempate pelo código | 0031; `mkt.v_new_customers` |
| 8 | Canal compara a origem e a soma das células fica abaixo do total | A campanha casada decide a origem do lead; canal = origem | 0031; `mkt.v_leads` |
| 9 | UTM repetida: no protótipo vale a última | Não atribui e mostra a pendência | 0031; `mkt.v_leads` |
| 10 | Cliente novo contado em duas fontes | Um lead de crédito, uma origem: cada cliente em uma fonte | 0031; SG13–SG17 |
| 11 | Base mistura "qualquer marca" e "a marca" | Um escopo só: a marca escolhida, ou o grupo em "As duas" | 0030; seção 4.7 |
| 12 | Engajamento do perfil × do post | Interações da API (`total_interactions`) nos dois | 0033 |
| 13 | Dia sem número: 0 ou nulo | Fato de evento (gasto, leads, clientes) dá 0 no dia sem nada; retrato (Instagram, Search Console, GA4) dá nulo | seções 2.3 e 4.8 |
| 14 | Opções de representante de fontes diferentes | Pelo papel (0025): quem recebeu lead da marca em Chegada e Leads; carteira da marca na Base | CH15, LE13, BA16 |
| 15 | Meta de clientes novos contra os atribuídos | Fica: a estratégia é da mídia paga; a tela diz "Clientes novos das campanhas". O custo por lead é o da 0027 | TR11 |
| 16 | Descartar e parar pelo canal sem quem nem quando | Toda escrita passa por função com a trilha | 0020; `papeis-e-rls.md` |
| 17 | Ordem da fila diferente no canal e no Tráfego | Uma só: impacto, esforço, a mais antiga | seção 4.6 |
| 18 | "Marcar como feita" preenche o aprovador | `done_by` e `done_via`; o aprovador não muda | 0020 |
| 19 | Alerta de limite soma 30 dias de custo ao gasto do mês | Gasto a mais só no resto do mês, sobre a projeção; só o que aumenta gasto; a mesma conta barra a execução | seção 4.5 |

---

## 8. Listas de saída

Códigos que só existem na resposta das funções. Cada uma é um `domain` (a função converte o resultado para ele, e o
teste de paridade com o `labels.ts` vale como nas outras listas; até a fase 4 elas ficam na lista `SO_NO_BANCO` do teste,
[`listas.md`](listas.md)). Rótulos e tons entram no `labels.ts` na fase 4.

**Ordem das listas num lugar só.** Os `domain` são texto e não guardam ordem: em texto, `first_order` < `invoiced` <
`lead`, e `high` < `low` < `medium`. Toda conta que depende da ordem de uma lista (funil "etapa ≥ i", impacto e
esforço da fila, status da lista, desempate por origem, por assistente e por conector, a melhor situação em "As duas")
usa `mkt.list_rank`. O teste de paridade confere cada array com `opcoes()` do `labels.ts` e com o
`ORDEM_DOS_CONECTORES` do protótipo.

```sql
create or replace function mkt.list_rank(p_list text, p_code text) returns integer
language sql immutable parallel safe set search_path = '' as $$
  select array_position(case p_list
    when 'lead_stage'         then array['lead','prospect','registered','first_order','invoiced']
    when 'lead_origin'        then array['meta','tiktok','google','site','organic','ai_assistant','sdr','referral','direct']
    when 'ai_source'          then array['chatgpt','perplexity','claude','gemini','copilot','other']
    when 'level'              then array['low','medium','high']
    when 'action_status'      then array['idea','failed','approved','running','done','discarded']
    when 'customer_situation' then array['active','inactive_recent','inactive_old','lost','lead']
    when 'recency_bucket'     then array['up_to_30','31_to_90','91_to_180','181_to_365','over_365']
    when 'connector_menu'     then array['csp360','meta','tiktok','google_ads','instagram','search_console','ga4']
  end, p_code)
$$;
```

**Ordem de código e de nome.** O protótipo ordena códigos com `localeCompare('pt-BR', { numeric: true })` e nomes em
português. No SQL a ordem não depende da collation do banco (a do PGlite e a do Supabase podem diferir):

- Código: `order by regexp_replace(code, '[0-9]+$', '') collate "C", substring(code from '[0-9]+$')::bigint` (`REP-9`
  antes de `REP-10`).
- Nome: `order by mkt.sort_text(name) collate "C", name collate "C"`.

```sql
create or replace function mkt.sort_text(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select lower(translate(p, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
                            'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'))
$$;
```

Vale em CH14, CH15, BA13, BA15, BA16, LE8, LE13, SG7, SG17 e CA14.

| Domain | Código → rótulo | Onde |
|---|---|---|
| `mkt.period_code` (entrada) | `this_month` → Este mês · `last_month` → Mês passado · `last_7_days` → Últimos 7 dias · `last_30_days` → Últimos 30 dias · `last_90_days` → Últimos 90 dias | filtros |
| `mkt.not_applicable_reason` | `sales_rep` → "Não se aplica: o investimento não se divide por representante" · `origin` → "Não se aplica: esta origem não tem investimento neste canal" | custo |
| `mkt.attribution_status` | `attributed` → Atribuído à campanha · `ambiguous` → UTM repetida · `no_match` → UTM sem campanha · `no_utm` → Sem UTM | Leads |
| `mkt.spend_situation` | `over_limit` → Passou do limite (ou da verba) · `will_exceed` → Vai passar · `on_track` → Dentro | limites e verba |
| `mkt.limit_alert` | `near_limit` → Perto do limite · `over_limit` → Acima do limite | Visão geral, canais |
| `mkt.target_situation` | `within_target` → Dentro da meta · `above_target` → Acima da meta · `target_met` → Meta batida · `on_pace` → No ritmo da meta · `behind_pace` → Abaixo do ritmo | estratégia |
| `mkt.recency_bucket` | `up_to_30` → Até 30 dias · `31_to_90` → 31 a 90 dias · `91_to_180` → 91 a 180 dias · `181_to_365` → 181 a 365 dias · `over_365` → Mais de 1 ano | Base |
| `mkt.customer_segment` | `active` → Ativos · `inactive` → Inativos · `lost` → Perdidos · `reactivated` → Reativados · `no_situation` → Sem situação (na URL continua `?recorte=ativos…`) | Base |
| `mkt.search_engine` | `google` · `bing` · `duckduckgo` · `yahoo` · `ecosia` · `other` → Outro buscador · `no_referrer` → Sem endereço de origem | SEO e GEO |
| `mkt.connectors_overall` | `down` → Caído · `late` → Atrasado · `ok` → Em dia | Conectores |
| `mkt.operator_line` | as 16 linhas da seção 4.4 | Humano × Claude |
| `mkt.comparison_direction` | `lower_is_better` · `higher_is_better` · `neutral` | Humano × Claude |
| `mkt.action_alert` | `campaign_ended` → Campanha encerrada · `already_paused` → Já está pausada · `waits_campaign_active` → Só vale quando a campanha voltar · `platform_refused` → A plataforma recusou · `no_spend_limit` → Conta sem limite de gasto · `exceeds_month_limit` → Passa do limite do mês | fila |

---

## 9. Testes: do protótipo para o SQL

- **Onde:** `supabase/tests/kpi/*.test.ts` (Vitest), sobre o PGlite com as migrações (decisão 0018). Cada arquivo tem
  os seus dados inventados em `supabase/tests/fixtures/`, gravados pelas mesmas funções `ingest.*` do worker, e fixa o
  relógio gravando a hora em `test.clock` (tabela que só o arquivo de apoio dos testes cria; seção 2.1).
- **Como:** cada caso do protótipo vira um caso SQL com os mesmos dados e o mesmo resultado; o caso marcado **muda**
  nas tabelas da seção 6 passa a esperar o valor da decisão citada. A versão em TypeScript sai quando o caso SQL passar
  (decisão 0018).
- **"Com os dados de exemplo":** o gerador de `apps/web/src/data/sample` grava no PGlite, e o teste confere que todo
  bloco tem número e que nenhuma divisão escapa de `mkt.ratio` (no SQL, divisão por zero é erro, não `NaN`).

| Protótipo | SQL | Observação |
|---|---|---|
| `[PE]` `periodo.test.ts` | `period.test.ts` | "este mês vai do dia 1 até hoje e compara com o mês anterior inteiro" **muda** (0026); os outros quatro iguais, mais os dias completos: no dia 1 a variação é nula; com a fonte até ontem, os dois lados têm o mesmo número de dias, menos quando o período anterior acaba antes |
| `[Q]` `filtrarPeriodo` | `period.test.ts` | "aceita dia e instante ISO, inclusivo nas pontas, no dia de São Paulo" vira caso de `mkt.sp_day` e `<@` |
| `[Q]` `kpisVisaoGeral`, `[VG]` | `overview.test.ts` | seção 6.1 |
| `[Q]` `funilChegada`, `custoPorClienteNovo`, `[CH]` | `acquisition.test.ts`, `cost-scope.test.ts` | seção 6.2 |
| `[Q]` `baseDeClientes`, `[BA]` | `customer-base.test.ts` | seção 6.3 |
| `[LE]` | `leads.test.ts` | seção 6.4 |
| `[Q]` `metricasPorCampanha e porOperador`, `[CA]`, `[OP]` | `channel.test.ts`, `operators.test.ts` | seção 6.5 |
| `[Q]` "instagram por marca", `[IG]` | `instagram.test.ts` | seção 6.6 |
| `[Q]` "seo e geo…", "posição média…", `[SG]` | `seo-geo.test.ts` | seção 6.7; `complementosDeExemplo` vira dado do gerador |
| `[Q]` "fila de aprovação…", `[TR]`, `[RE]` | `traffic.test.ts`, `spend-limits.test.ts` | seção 6.8; `escalarLimites` (3 casos) sai com a 0021: o limite não se reparte |
| `[Q]` "conectores com atraso", `[CO]` | `connectors.test.ts` | seção 6.9 |
| `[RU]` "classificarOrigem" | `lead-origin.test.ts` | paridade TS × SQL até o TS sair; novos: `utm_source=chatgpt.com` → `ai_assistant` e `utm_source=perplexity.ai` → `ai_assistant` |
| `[SI]` `usuarios` | `users.test.ts` | "dados de exemplo: só o dono…" fica só no modo demonstração |
| — (novos) | `leads-view.test.ts`, `first-orders.test.ts`, `new-customers.test.ts` | SDR que virou negócio conta uma vez; UTM herdada só no negócio do site; UTM repetida; UTM com o id da campanha casa pelo id; campanha casada decide o canal; o retrato do ERP marca o cliente antigo pelas datas (cliente que estreou em setembro e depois comprou só pelo ERP continua novo); novo na marca × novo no grupo; primeiro toque; pedido "A vincular" e cancelado fora; cliente sem lead conta como novo e não é atribuído; texto de origem fora do de-para não é gravado e fica `referral` |
| — (novos) | `coverage.test.ts` | conector sem `first_success_at` → nulo; com base e sem linha → 0; canal sem conta da marca lida → nulo; perfil ou propriedade de uma marca sem leitura → nulo nela e número na outra |
| — (novos) | `list-rank.test.ts`, `sort.test.ts` | cada array de `mkt.list_rank` igual ao `labels.ts`; `REP-9` antes de `REP-10`; nome com acento na mesma ordem no PGlite e no Supabase |
| — (novos) | `spend-limits.test.ts` | conta sem limite bloqueia aumento (`no_spend_limit`); orçamento atual nulo usa o anterior dos parâmetros; sem base, a trava barra; reativar conta como aumento; limite 0 sem gasto fica "Passou do limite", como o protótipo, e o alerta da mesma linha diz "Acima do limite" |

---

## 10. Em aberto

- **Com o time do CRM:** como a conversão do SDR preenche `negocios.origem` (para juntar o lead do SDR ao negócio,
  seção 3.3); as views da Parte 4 (`clientes_situacao`, `clientes_utm`, `clientes_compras_marca`,
  `negocios_responsavel`); o retrato do ERP **sem** os pedidos do CRM, com a primeira e a última compra por marca
  (`erp_first_purchase_on`, `erp_last_purchase_on`); a data de envio, o carimbo de faturado e a UTM e o `referrer` por
  lead (lacunas 3, 4, 9 e 10). Sem eles, as contas funcionam com o que há e melhoram sozinhas quando as colunas forem
  preenchidas.
- **O dono responde** as decisões 0026 a 0033 (e a 0021, de que depende a régua do limite). Cada uma diz o que muda
  se a resposta for outra.
- **Medir na fase 4:** o tempo de `mkt.v_leads` e de `mkt.v_new_customers` com volume de anos; se passar da meta,
  tabela de fatos refeita pelo worker (decisão nova).
- **De-para de origem:** a migração 05 só leva valores genéricos (fonte de UTM, canal, rótulo do ClickUp), revistos
  antes do commit; texto com nome de pessoa nunca entra no repositório. Valor novo aparece em `unmapped_origin_count` e
  é conferido no CSP 360.
- **Representante do lead:** enquanto o CRM não der o responsável por id, quase todo lead fica "Sem representante"
  (decisão 0025).

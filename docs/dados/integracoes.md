# Integrações — réplica do CRM, conectores, execução e avisos

> Proposta da fase 3, para o dono aprovar. Nada foi ligado: nenhum conector, nenhuma credencial, nenhuma chamada. O
> SQL e os exemplos são **rascunho**. Base: o levantamento do CRM, a documentação oficial das plataformas lida em
> 03/11/2026 e as decisões 0004 a 0006, 0010, 0015, 0017, 0019, 0020 e 0034 a 0038. As tabelas citadas estão em
> [`tabelas.md`](tabelas.md); as contas que usam esses dados, em [`metricas.md`](metricas.md).
>
> **A confirmar** = ponto que a documentação não deixou claro. O worker confere na primeira leitura, e o resultado
> vai para o `ESTADO.md`.

## 1. Resumo

| Conector | Dono do dado | O que o CSP-MKT lê | Leitura | Releitura | Chave natural | Credencial (decisão 0036) |
|---|---|---|---|---|---|---|
| `csp360` | CSP 360 | marcas, funis, representantes, clientes, situação por marca, leads, pedidos, rodadas apps → CRM | a cada 5 min | passada completa 1×/dia | `(csp360, id no CRM)` | papel Postgres só-leitura |
| `meta` | Meta | contas, campanhas, gasto e resultado por campanha e dia, alterações | de hora em hora: hoje e ontem | 1×/dia: 28 dias | `(campaign_id, metric_on)` | usuário do sistema de leitura |
| `instagram` | Meta | perfil por dia, seguidores, posts e o retrato diário de cada post | de hora em hora | 1×/dia: 3 dias da conta, 30 dias de posts | `(ig_account_id, metric_on)`, `(ig_media_id, captured_on)` | o mesmo usuário do sistema |
| `tiktok` | TikTok | anunciantes, campanhas, gasto e resultado por campanha e dia | de hora em hora: hoje e ontem | 1×/dia: 28 dias | `(campaign_id, metric_on)` | app de leitura |
| `google_ads` | Google | contas, campanhas, gasto e resultado por campanha e dia, alterações | de hora em hora: hoje e ontem | 1×/dia: 30 dias (até 90) | `(campaign_id, metric_on)` | conta de serviço "Somente leitura" |
| `ga4` | Google | sessões por dia, origem, meio e canal; eventos `generate_lead` | 1×/dia | 14 dias | `(web_property_id, metric_on, origem, meio, canal)` | conta de serviço, Leitor |
| `search_console` | Google | totais do dia e consultas do dia (relatório Web) | 1×/dia | 10 dias | `(web_property_id, metric_on)` e `+ consulta` | conta de serviço, usuário restrito |
| — (checagem) | sites do grupo | `robots.txt`, `llms.txt`, JSON-LD | 1×/dia | — | `(web_property_id, item, checked_on)` | nenhuma |

Fora dos conectores: a **Claude API** (só no worker, seção 15), o **executor** (o serviço que escreve nas plataformas,
seção 14) e o **n8n** (só avisos, seção 16). Nenhum webhook entra na v1 (decisões 0035 e 0037).

---

## 2. O worker (Python, decisão 0001)

### 2.1 Processo e agenda

- Dois serviços Python no Railway, sempre ligados, com agenda interna em horário de São Paulo (decisão 0017):
  - o **worker de leitura**: lê as fontes, grava pelas funções `ingest.*` e roda o Claude. Entra no banco com o papel
    `mkt_worker` (`WORKER_DATABASE_URL`) e só tem credenciais de leitura;
  - o **executor**: só escreve nas plataformas o que foi aprovado (seção 14). Entra com o papel `mkt_executor`
    (`EXECUTOR_DATABASE_URL`) e é o único com os tokens de escrita.
- Nenhum dos dois usa a chave de serviço do Supabase. Cada trabalho pega uma trava no banco (`pg_try_advisory_lock`)
  antes de começar: duas instâncias nunca rodam o mesmo trabalho.
- Cada trabalho agendado com conector (todos os do quadro com horário, menos `csv_import` e os pedidos de "Tentar de
  novo") tem uma linha em `connector_jobs`, com a frequência esperada: o cartão do conector fica "Atrasado" quando
  qualquer trabalho dele atrasa, não só o mais frequente ([`metricas.md`](metricas.md), seção 4.9).
- Testes: `pytest` por adaptador, com respostas gravadas e inventadas, e `ruff`, num job de CI da fase 4.

| Trabalho (`sync_runs.job`) | Conector | Quando | O que faz |
|---|---|---|---|
| `crm_incremental` | `csp360` | a cada 5 min | leads, pedidos, clientes citados, rodadas apps → CRM |
| `crm_full_pass` | `csp360` | 03:00 | as tabelas com passada diária (quadro 3.2), inteiras; apaga o que sumiu do CRM |
| `ads_hourly` | `meta`, `tiktok`, `google_ads` | de hora em hora, aos 10 min | contas, campanhas, gasto de hoje e de ontem |
| `ads_backfill` | idem | 04:00 | releitura de 28 dias (Meta, TikTok) ou 30 (Google), trocando o dia inteiro; na Meta, também o teto da conta e o gasto contado nele |
| `ads_activity` | `meta`, `google_ads` | 04:30 | alterações feitas nas contas |
| `ig_hourly` | `instagram` | de hora em hora, aos 20 min | seguidores, números de hoje e de ontem, posts das últimas 72 h |
| `ig_daily` | `instagram` | 05:00 | 3 dias da conta, posts dos últimos 30 dias |
| `ga4_daily` | `ga4` | 14:00 | últimos 14 dias (o dia anterior fica pronto em cerca de 12 h) |
| `gsc_daily` | `search_console` | 06:30 | últimos 10 dias |
| `csv_import` | a plataforma do arquivo | quando chega um arquivo | importa o CSV (seção 12) |
| (sem `sync_runs`) checagem | — | 07:00 | `robots.txt`, `llms.txt`, JSON-LD (seção 11) |
| (em `claude_runs`) rodada do Claude | — | 07:30, por marca | seção 15 |
| pedidos de "Tentar de novo" | qualquer | a cada minuto | pega `sync_runs` em `requested` |
| execuções (no **executor**) | — | a cada 30 s | `platform_executions` em `queued` (seção 14) |

### 2.2 Um adaptador por provedor, um evento único (decisão 0035)

Cada provedor tem um adaptador: CSP 360, Meta, Instagram, TikTok, Google Ads, GA4, Search Console, sites e um
adaptador de CSV por plataforma. O adaptador é o único lugar que conhece o formato do provedor. Ele fala com a API e
devolve registros num formato só, o **evento de ingestão**:

| Campo | O que é |
|---|---|
| `kind` | o tipo do registro, um por tabela de destino: `ad_account`, `campaign`, `ad_campaign_daily`, `ad_activity`, `ig_account`, `ig_account_daily`, `ig_media`, `ig_media_daily`, `seo_daily`, `seo_query_daily`, `ga4_traffic_daily`, `site_check`, `brand`, `crm_funnel`, `sales_rep`, `sales_rep_app_login`, `crm_customer`, `crm_customer_brand`, `crm_customer_rep`, `crm_lead`, `crm_order`, `crm_upstream_run` |
| `source` | o sistema de origem (`mkt.data_source`) |
| `key` | a chave natural, com os ids **externos** (o adaptador nunca conhece o id interno) |
| `brand` | `cs`, `plumene` ou nulo (lead sem marca) |
| `values` | as colunas já convertidas (seção 2.4) |
| `fetched_at` | quando foi lido |

```json
{
  "kind": "ad_campaign_daily",
  "source": "meta_ads",
  "brand": "cs",
  "key": { "campaign_external_id": "<id da campanha>", "metric_on": "2026-11-02" },
  "values": { "spend_cents": 53395, "impressions": 18120, "clicks": 402, "platform_leads": 0,
              "conversions": 0, "conversion_value_cents": 0 },
  "fetched_at": "2026-11-03T13:10:04Z"
}
```

Trocar de provedor (ou de versão da API) é trocar o adaptador; o banco e as contas não mudam.

### 2.3 Gravação

- Um gravador só leva os registros às funções `ingest.upsert_<tabela>(p_run_id, p_rows jsonb)`, em lotes de até 1.000,
  uma transação por lote. A função resolve as chaves externas (campanha, conta, cliente, representante), insere ou
  atualiza pela chave natural e aplica as regras de escrita: nunca muda `managed_by` de campanha que já existe; a API
  regrava a linha do CSV, nunca o contrário; o texto que vem do CRM é limpo ([`tabelas.md`](tabelas.md), seção 2); a
  primeira leitura que traz dado de uma conta, perfil ou propriedade preenche `first_read_at`.
- **Releitura troca o dia inteiro:** numa transação, `ingest.replace_day` grava as linhas lidas e apaga as do mesmo dia e
  da mesma conta, perfil ou propriedade que não vieram. Vale para `ad_campaign_daily` (por conta e dia, inclusive as
  linhas do CSV, porque a API vence), `ga4_traffic_daily` e `seo_query_daily` (por propriedade e dia). Só liga depois de
  a leitura trazer campanha apagada e arquivada (seções 4 e 7); senão a troca apaga o gasto delas.
- **Conferência do gasto:** toda rodada de anúncios compara, por conta e dia, o total da conta (Meta `level=account`,
  TikTok `data_level=AUCTION_ADVERTISER`, Google `FROM customer`) com a soma das campanhas gravadas. Diferença acima de
  R$ 1,00 termina a rodada `partial` com `SPEND_MISMATCH`, e o cartão avisa.
- Linha recusada pelo banco (moeda, lista, `check`) não derruba o lote: volta como recusada, com o código. A rodada
  termina `partial`, e a contagem fica em `sync_runs`. `partial` conta como rodada boa para `last_success_at` e
  `first_success_at`; o cartão mostra o aviso com o código.
- A rodada abre com `ingest.start_run(conector, trabalho, gatilho, marca)` e fecha com `ingest.finish_run(…)`. Quando
  dá certo, `connectors.last_success_at` e `connector_jobs.last_success_at` recebem o fim da rodada, e
  `connectors.first_success_at` é preenchida se ainda estiver vazia: com `first_read_at`, é ela que diz se a fonte tem
  base ("Sem dados" × 0, decisão 0034).

### 2.4 Conversões na entrada

| O quê | Regra |
|---|---|
| Dinheiro | centavos em `bigint`, com decimal (nunca ponto flutuante). Meta: gasto em reais, em texto, × 100; orçamento já em centavos. Google: micros ÷ 10.000. TikTok: decimal com 2 casas × 100. Meio centavo arredonda para cima |
| Moeda | só real. Conta em outra moeda é recusada com tudo o que é dela (`CURRENCY`); as outras contas seguem; a rodada termina `partial` e o cartão avisa |
| Dia | o dia que a plataforma entrega, no fuso da conta; o fuso vai para `ad_accounts.time_zone`, e a tela avisa se não for `America/Sao_Paulo` |
| Instante | UTC (`timestamptz`) |
| Status | para as listas do banco ([`listas.md`](listas.md)): Meta `effective_status`, Google `status` e `serving_status`, TikTok `operation_status` |
| Texto | só nome de conta, de campanha e de perfil; o começo da legenda do post (até 120 letras, sem as menções `@`); a consulta de busca (até 500 letras); origem, meio e canal do GA4 como vêm; o tipo e os valores de uma alteração (`mkt.valid_activity_details`); o detalhe da checagem dos sites (até 300 letras). Do CRM, só os nomes da marca e do funil, a UTM limpa e a origem do negócio quando conhecida ([`tabelas.md`](tabelas.md), seção 2) |
| Login do app | `<marca>:<login>` vira resumo HMAC-SHA256 com `REP_LOGIN_HMAC_KEY` antes de gravar; o login em claro nunca é gravado nem vai para o log |
| Dado pessoal | nunca. O adaptador descarta antes de gravar e antes de registrar em log |

### 2.5 Retentativa e limites

- Rede ou erro 5xx: espera 1, 2, 4, 8 e 16 s, no máximo 5 tentativas.
- Limite da plataforma (429 e códigos próprios): respeita `Retry-After` ou a espera que a plataforma pede (seções 4 a
  10).
- Outro 4xx: não repete; a rodada falha com o código (`HTTP_403`, `TOKEN_INVALID`…).
- Esgotou: rodada `failed`. O cartão do conector mostra a falha, e o aviso "Conector parado" segue a decisão 0019.

### 2.6 Diário e marca d'água

- `sync_runs` guarda cada rodada: janela lida (`watermark_from_at`, `watermark_to_at`), linhas gravadas, apagadas e
  recusadas, valores de texto descartados por parecer dado pessoal, código e mensagem curta do erro. Guarda 90 dias.
- O worker pega a hora **antes** de consultar e usa como o próximo início. A leitura incremental seguinte começa no
  `watermark_to_at` da última rodada boa, menos a folga.
- Não há tabela `integration_log` (o padrão sugere uma): a rodada fica em `sync_runs`, a escrita em
  `platform_executions` e cada chamada no log JSON do worker e do executor (decisão 0035).

### 2.7 Log

Uma linha JSON por evento: `ts`, `level`, `connector`, `job`, `run_id`, `op`, `count`, `ms`, `http_status`,
`error_code` e `external_id` (só de conta, campanha ou propriedade; nunca de pessoa). Nunca token, cabeçalho de
autorização, id ou código de cliente e de lead, login de app, nome, telefone, e-mail ou corpo de resposta.

### 2.8 Primeira carga

| Fonte | Desde quando |
|---|---|
| Anúncios (Meta, TikTok, Google) | 01/08/2026, o começo do histórico de pedidos do CRM, para o custo ter os dois lados |
| Instagram | os 90 dias de conta que a API guarda; posts dos últimos 90 dias |
| Search Console | os 16 meses que a API guarda |
| GA4 | desde que a propriedade mede |
| CSP 360 | tudo, pela passada completa |

A primeira carga é uma rodada `backfill`, em blocos (no TikTok, 30 dias por chamada).

---

## 3. CSP 360 — a réplica (decisões 0006 e 0015)

### 3.1 Credencial e o que pedir ao time do CRM

- Um papel Postgres `csp_mkt_reader`, criado pelo time do CRM só para o CSP-MKT: `login nosuperuser nocreatedb
  nocreaterole noinherit nobypassrls noreplication connection limit 3`, senha trocada a cada 90 dias,
  `statement_timeout` de 30 s, conexão com TLS e `sslmode=verify-full` pelo pooler do projeto do CRM. Nunca a chave
  de serviço do CRM.
- **Toda leitura passa por views** num esquema só do CSP-MKT no banco do CRM, com só as colunas do quadro 3.2 (também
  as das tabelas simples), e o papel tem `usage` só nesse esquema. O papel não executa função nenhuma. Esse esquema fica
  fora da lista de esquemas expostos da API do CRM: as views rodam com os direitos de quem as criou.
- Se o time do CRM preferir dar `select` por coluna em `public`, ele confirma que nenhuma função de `public` é
  executável por `csp_mkt_reader` (por exemplo, `revoke execute on all functions in schema public from public`,
  mantendo os `grant` dos papéis do app). Com permissão por coluna, toda leitura lista as colunas: `select *` falha, de
  propósito.
- Se a leitura for direta numa tabela com RLS ligada, ou se uma view for `security_invoker`, o papel precisa de uma
  política de leitura naquela tabela: com RLS ligada, o `grant` sozinho devolve zero linhas, sem erro (a seção 3.4 faz
  essa leitura vazia falhar alto).
- `default_transaction_read_only = on` é reforço: a trava é o papel ter só `select`.
- No Railway: `CSP360_DATABASE_URL` (decisão 0036), só no worker de leitura.

### 3.2 Tabelas e colunas

| No CRM (lido pela view de mesmo nome) | Colunas lidas | Vai para | Leitura |
|---|---|---|---|
| `marcas` | `id, sigla, nome_fantasia` | `brands` (`external_id`, `name`) | passada diária |
| `funis_venda` | `id, nome, padrao` | `crm_funnels` | passada diária |
| `usuarios` | `id, papel, ativo, logins_app` | `sales_reps`, `sales_rep_app_logins` (login como resumo HMAC) | passada diária |
| `clientes` | `id, codigo, status, criado_em, retrato_carregado, donos_app` | `crm_customers`, `crm_customer_reps` | por id a cada 5 min (os citados) e passada diária |
| `negocios` | `id, codigo, cliente_id, marca_id, funil_id, origem, criado_em, atualizado_em` | `crm_leads` (`kind = 'deal'`) | a cada 5 min por `atualizado_em`, de todos os funis, e passada diária |
| `leads_sdr` | `id, criado_em, atualizado_em, cliente_id` | `crm_leads` (`kind = 'sdr'`) | idem |
| `pedidos` | `id, marca_id, cliente_id, status, criado_em, atualizado_em, vendedor_app` | `crm_orders` | a cada 5 min por `coalesce(atualizado_em, criado_em)`, e passada diária |
| `pedido_itens` | `pedido_id, quantidade, preco_unitario` | `crm_orders.total_cents` (soma) | com os pedidos da rodada |
| `sincronizacoes` | `id, marca_id, disparo, iniciada_em, terminada_em, ok` | `crm_upstream_runs` | a cada 5 min, as últimas de cada marca |
| view `clientes_situacao` | `cliente_id, marca_id, situacao, perdido_manual, ultima_compra, calculada_em` | `crm_customer_brands` (`situation`, `is_lost_manual`, `last_purchase_on`, `situation_computed_at`) | com os clientes |
| view `clientes_utm` | `cliente_id, utm_source, utm_medium, utm_campaign` (das chaves `utm-source`, `utm-medium` e `utm-campaign` dos campos personalizados do cliente; sem `utm-term` nem `pagina-site`) | `crm_customers.first_utm_*` | com os clientes |
| view `clientes_compras_marca` | `cliente_id, marca_id, primeira_compra, ultima_compra, total_comprado` | `crm_customer_brands` (`erp_first_purchase_on`, `erp_last_purchase_on`, `erp_total_purchased_cents`) | com os clientes |
| view `negocios_responsavel` | `negocio_id, responsavel_id` | `crm_leads.assigned_rep_id` | com os negócios |

Nunca é pedido: nome, contato, e-mail, telefone, documento, inscrição estadual, endereço, cidade, observações,
títulos e descrições de negócio, responsável por nome, motivos em texto livre, respostas de formulário, conversas, o
histórico de marketing (`historico_marketing`, fora da v1: nenhuma conta usa) e a chave de evento da distribuição de
leads. O documento do cliente não vem: a junção é `clientes.id`, que o CRM já resolveu.

### 3.3 Permissões a pedir

```sql
-- No banco do CRM, pelo time do CRM. O nome do esquema é escolha dele; aqui, "csp_mkt".
-- O esquema fica fora da lista de esquemas expostos da API do CRM.
grant usage on schema csp_mkt to csp_mkt_reader;   -- e nenhum outro esquema

-- Uma view por tabela lida, só com as colunas do quadro 3.2:
create view csp_mkt.marcas as select id, sigla, nome_fantasia from public.marcas;
create view csp_mkt.funis_venda as select id, nome, padrao from public.funis_venda;
create view csp_mkt.usuarios as select id, papel, ativo, logins_app from public.usuarios;
create view csp_mkt.clientes as
  select id, codigo, status, criado_em, retrato_carregado, donos_app from public.clientes;
create view csp_mkt.negocios as
  select id, codigo, cliente_id, marca_id, funil_id, origem, criado_em, atualizado_em from public.negocios;
create view csp_mkt.leads_sdr as select id, criado_em, atualizado_em, cliente_id from public.leads_sdr;
create view csp_mkt.pedidos as
  select id, marca_id, cliente_id, status, criado_em, atualizado_em, vendedor_app from public.pedidos;
create view csp_mkt.pedido_itens as select pedido_id, quantidade, preco_unitario from public.pedido_itens;
create view csp_mkt.sincronizacoes as
  select id, marca_id, disparo, iniciada_em, terminada_em, ok from public.sincronizacoes;
-- e as views com regra do quadro abaixo: clientes_situacao, clientes_utm, clientes_compras_marca,
-- negocios_responsavel

grant select on all tables in schema csp_mkt to csp_mkt_reader;

-- Só se alguma view for security_invoker, ou se o time preferir select por coluna nas tabelas: em cada tabela
-- lida que tiver RLS ligada (o time do CRM confere), a política de leitura do papel. Sem ela, zero linhas e sem erro.
-- create policy csp_mkt_reader_select on public.<tabela> for select to csp_mkt_reader using (true);

-- Quando existir: csp_mkt.negocios_utm (UTM e referrer por lead) e as colunas novas pedidas na Parte 4:
-- pedidos.enviado_em, faturado_em, total; negocios.responsavel_id; leads_sdr.marca_id, origem, codigo;
-- a data de cada mudança de fase do negócio.
```

| View pedida | O que entrega | Por quê |
|---|---|---|
| `clientes_situacao` | uma linha por cliente e marca: a situação da régua do CRM, o perdido manual e a última compra que a régua usou | o CSP-MKT não recalcula a régua (decisão 0012) |
| `clientes_utm` | as UTMs de primeiro contato (fonte, meio e campanha), lidas dos campos personalizados pela chave de cada campo | o jsonb inteiro leva texto livre junto |
| `clientes_compras_marca` | o retrato do ERP por marca: primeira e última compra e total comprado, **sem** os pedidos do CRM | saber quem já comprava antes de agosto de 2026 (decisão 0030) |
| `negocios_responsavel` | o responsável do negócio como id de `usuarios`, não como nome | representante por código (decisão 0025) |
| `negocios_utm` (depois) | UTM, `referrer` (só o domínio) e página (só o caminho, sem `?` nem `#`) de cada negócio, gravados pela função de leads dos sites | lead com a própria UTM; busca orgânica e IA pelo `referrer` (decisão 0031) |

### 3.4 Leitura

- **Incremental, a cada 5 min:** páginas de 1.000, pela marca d'água `(instante, id)` menos 15 min de folga.

```sql
-- Exemplo: negócios de todos os funis (a função ingest decide quais entram), lidos pelo csp_mkt_reader.
select id, codigo, cliente_id, marca_id, funil_id, origem, criado_em, atualizado_em
  from csp_mkt.negocios
 where (atualizado_em, id) > ($1, $2)                 -- marca d'água menos 15 min
 order by atualizado_em, id
 limit 1000;
```

- **Clientes citados:** os clientes que os leads e os pedidos da rodada citam e que ainda não estão na réplica são
  lidos por id (até 1.000 por chamada), com as três views. Linha que cita cliente novo puxa o cliente na mesma rodada.
- **Passada completa, 03:00:** as tabelas do quadro 3.2 com passada diária, inteiras, em páginas de 1.000 por id.
  Cada tabela lida inteira passa por `ingest.delete_missing`, que apaga o que não apareceu, sem cópia (decisão 0015).
  As rodadas apps → CRM (`sincronizacoes`) ficam fora: a leitura traz só as últimas de cada marca, e o `pg_cron` apaga
  as de mais de 90 dias.
- **Trava de exclusão em massa, no banco:** `ingest.delete_missing` conta antes de apagar; acima de 20% das linhas de
  uma tabela, nada é apagado, a rodada termina `partial` com `MASS_DELETE_BLOCKED` e o cartão avisa (protege contra
  leitura que voltou vazia por engano). O bloqueio em 3 passadas seguidas vira o aviso urgente "Exclusão em massa
  segurada" ao dono. Ele confere e confirma por `api.confirm_mass_delete(run_id)` (permissão `retry_connector`, evento
  `mass_delete_confirmed` no `audit_log`), e a passada seguinte apaga. Uma limpeza de verdade no CRM, inclusive a
  exclusão pedida por titulares, sai daqui assim.
- **Leitura vazia falha alto:** na primeira carga e na passada completa, `clientes`, `pedidos` ou `negocios` com zero
  linhas terminam a rodada `failed` com `EMPTY_SOURCE`, e `first_success_at` não é preenchida (a tela continua
  "Sem dados", nunca 0).
- **Funil de leads:** a leitura de `negocios` (5 min e passada completa) traz todos os funis. `ingest.upsert_crm_leads`
  grava o negócio que está no funil marcado em `crm_funnels.is_lead_funnel` ou que já existe em `crm_leads`, e ignora o
  resto. `ingest.delete_missing` em `crm_leads` (`kind = 'deal'`) apaga só o id que não existe mais em `negocios`, em
  qualquer funil: o negócio que sai do funil de leads continua lead aqui. Até o time do CRM confirmar qual funil vale,
  a migração marca o funil em que a função de leads dos sites grava hoje.
- **Ordem na rodada:** marcas → funis → representantes → clientes e views → leads → pedidos com itens → rodadas apps →
  CRM.

### 3.5 Conversões

| CRM | CSP-MKT |
|---|---|
| `marcas.sigla` `CS`, `PL` | `brands.code` `cs`, `plumene` |
| `pedidos.status` `orcamento`, `enviado`, `faturado`, `cancelado` | `quote`, `sent`, `sent` + `is_invoiced`, `cancelled` |
| Σ `quantidade × preco_unitario` | `total_cents`, em decimal, × 100 e arredondado, até o CRM mandar `pedidos.total` |
| `vendedor_app`, `donos_app` (`<marca>:<login>`) | o worker troca o login pelo resumo HMAC antes de gravar → `sales_rep_app_logins` → `sales_reps` (código `REP-` novo para chave nova) |
| `clientes.status` `prospecto`, `ativo`, `inativo` | `prospect`, `active`, `inactive` |
| `situacao` `lead`, `ativo`, `inativo-recente`, `inativo-antigo`, `perdido`, "sem base" | `lead`, `active`, `inactive_recent`, `inactive_old`, `lost`, nulo |
| `sincronizacoes.disparo` | `mkt.upstream_trigger` |
| `negocios.origem` | `crm_origin_raw` só quando está no de-para, é uma fonte de UTM conhecida ou é a `utm_source` de primeiro contato do cliente; outro texto não é gravado e o lead fica `is_origin_unmapped` ([`tabelas.md`](tabelas.md), seção 2; a classificação é SQL, `metricas.md` 3.1) |
| UTM do CRM | cortada em 150 letras; vira nulo o valor com `@` ou que pareça dado pessoal (`PERSONAL_DATA_DROPPED`) |
| lead do SDR | código `LEAD-` gerado aqui; marca nula (decisão 0014) |

### 3.6 Quando o CRM muda ou cai

- Antes de ler, o worker confere as colunas no `information_schema` do CRM. Faltou coluna: a rodada falha com
  `SCHEMA_DRIFT`, nada é gravado pela metade, o cartão fica "Caído" (decisão 0015).
- CRM fora do ar: leads, clientes e pedidos param no último retrato; o resto do sistema segue. Quando volta, a leitura
  retoma da marca d'água (com a folga), e a passada diária confere tudo.
- Coluna nova que o CRM passar a gravar (data de envio, faturado, UTM por lead, responsável por id, marca do SDR)
  preenche coluna que já existe aqui, sem mudar a estrutura.

---

## 4. Meta Ads

| | |
|---|---|
| Autenticação | app do grupo no gerenciador de negócios; usuário do sistema de **leitura** com `ads_read` (mais as permissões do Instagram, seção 6); token que não vence; `appsecret_proof` com o segredo do app em toda chamada. No nível Limited, o app tem 1 usuário do sistema: o de leitura. O de escrita nasce depois do Full (App Review e Business Verification). Ligar a leitura cedo: as chamadas de hora em hora contam para as 500 chamadas em 15 dias, com menos de 15% de erro, que o Full pede. O nível Limited basta para ler as contas do próprio portfólio (a confirmar) |
| Versão | v26.0, fixa. Trocar de versão é PR com teste |
| Contas | cadastradas por script, com a marca (`scripts/configurar-contas.mjs --executar`, por `setup.register_ad_account`); o worker atualiza nome, moeda, fuso e se está ativa e, na releitura diária, o `spend_cap` e o `amount_spent` da conta (`ad_accounts.spend_cap_cents`, `amount_spent_cents`; o `spend_cap` 0, que na Meta quer dizer sem teto, entra nulo). Conta que o token vê e não está cadastrada é ignorada (contada no log) |
| Campanhas | `GET /act_{id}/campaigns` com `effective_status` incluindo `DELETED` e `ARCHIVED`: `id, name, effective_status, daily_budget, spend_cap, created_time`. Orçamento nos conjuntos (campanha sem `daily_budget`) → `daily_budget_cents` nulo |
| Gasto e resultado | `GET /act_{id}/insights` com `level=campaign`, `time_increment=1`, `time_range`, `filtering` em `campaign.effective_status` com `ACTIVE`, `PAUSED`, `DELETED`, `ARCHIVED`, `IN_PROCESS` e `WITH_ISSUES` (senão o gasto de campanha apagada some), e `use_unified_attribution_setting=true` (para bater com o gerenciador; a confirmar): `campaign_id, date_start, spend, impressions, inline_link_clicks, actions, action_values` |
| Colunas | `spend` → `spend_cents`; `inline_link_clicks` → `clicks` (clique no link, comparável ao do Google e do TikTok); `actions` de lead → `platform_leads`; de compra e cadastro → `conversions`; `action_values` de compra → `conversion_value_cents`. A lista de `action_type` de cada coluna é constante do adaptador (a confirmar na primeira leitura) |
| Alterações | `GET /act_{id}/activities` desde a última leitura: `event_time, event_type, object_id, extra_data` → `ad_activity_log`. Copia só eventos de campanha, conjunto, anúncio e limite de gasto da conta; eventos de usuário, papel e cobrança ficam fora; nunca `object_name` nem `actor_*`. `is_by_csp_mkt` quando a alteração veio do app do CSP-MKT; a chave é um resumo (hash) de objeto, tipo e hora |
| Frequência | de hora em hora: hoje e ontem; 1×/dia: os últimos 28 dias (depois disso a Meta não muda o número) |
| Chave | campanha `(meta_ads, id)`; dia `(campaign_id, metric_on)` |
| Limites | cota por conta e hora; o worker lê `X-Business-Use-Case`, `X-Ad-Account-Usage` e `X-FB-Ads-Insights-Throttle` e desacelera antes do limite; erros 4, 17, 613 e 80000 a 80014 esperam e repetem; consulta grande vai para o relatório assíncrono; "dado demais numa chamada" encurta a janela |
| Quando cai | cartão "Atrasado" ou "Caído"; os números param no último retrato; a releitura de 28 dias cobre a falta; falta maior pede uma rodada `backfill` |
| Escrita | outro usuário do sistema, com `ads_management`, só depois da aprovação da Meta, e só no executor (seção 14) |

## 5. Formulários de lead das plataformas (decisão 0037)

- O CSP-MKT **não** assina webhook de lead e **não** lê a pessoa: nem o Lead Ads da Meta, nem o formulário do TikTok,
  nem o do Google. O corpo do TikTok e do Google traz nome, telefone e e-mail, e a entrada de lead é do CRM (decisão
  0010).
- O número de leads de formulário de cada campanha chega pelo relatório da plataforma (`platform_leads`), com o nome
  "Leads informados pela plataforma" (decisão 0027).
- Se o grupo usar formulário de plataforma, o lead entra no CRM pelo contrato de distribuição do time do CRM e chega
  aqui pela réplica, como qualquer lead. A chave de evento dessa distribuição não é lida aqui (ela reidentifica a pessoa
  na plataforma). Para o lead de formulário ser atribuído à campanha, o CRM precisa guardar a campanha de origem
  (pendência, seção 19).
- `webhook_inbox` continua fora da v1 ([`tabelas.md`](tabelas.md)). Se um dia entrar, o webhook responde 200 na hora,
  confere a assinatura no cabeçalho e processa depois.

## 6. Instagram

| | |
|---|---|
| Autenticação | pelo login do Facebook: o mesmo app e o mesmo usuário do sistema de leitura, com `instagram_basic`, `instagram_manage_insights` e `pages_read_engagement`, e a Página ligada ao perfil. Se o token de usuário do sistema não cobrir o Instagram (a confirmar), o plano B é o token do login do Instagram, de 60 dias, guardado no Vault e renovado pelo worker antes de vencer (decisão 0017) |
| Perfis | cadastrados por script, com a marca (`scripts/configurar-contas.mjs --executar`, por `setup.register_ig_account`); o worker atualiza o @ e se está ativo. Perfil que o token vê e não está cadastrado é ignorado |
| Perfil por dia | `GET /{ig_user_id}/insights`: `reach` com `period=day` e `metric_type=time_series`; `views` e `total_interactions` com `metric_type=total_value`, um dia por chamada → `ig_account_daily` |
| Seguidores | `GET /{ig_user_id}?fields=followers_count` de hora em hora; o último retrato do dia de São Paulo fica como os seguidores do dia (a métrica `follower_count` não existe para perfil pequeno e só cobre 30 dias) |
| Posts | `GET /{ig_user_id}/media`: `id, media_type, media_product_type, timestamp, permalink, caption` → `ig_media`; `GET /{media_id}/insights`: `reach, views, likes, comments, saved, shares, total_interactions` → `ig_media_daily`, um retrato por dia |
| Orgânico | a tela mostra o orgânico (decisão 0033): `views`, `likes` e `comments` são só orgânicos; os `total_*` (desde 22/04/2026) somam o anúncio e não são lidos. Se `total_interactions` incluir anúncio (a confirmar), Interações = curtidas + comentários + salvos + compartilhamentos |
| Dia | o dia que a API entrega (`end_time`, que indica o dia do Pacífico; a confirmar); a tela avisa |
| Frequência | de hora em hora: seguidores, hoje e ontem, posts das últimas 72 h; 1×/dia: 3 dias da conta e posts dos últimos 30 dias |
| Releitura | 3 dias (o dado atrasa até 48 h). A API guarda só 90 dias da conta: o CSP-MKT guarda a própria cópia |
| Chave | perfil `(instagram, ig_user_id)`; dia `(ig_account_id, metric_on)`; post `(instagram, media_id)`; retrato `(ig_media_id, captured_on)` |
| Limites | chamadas em 24 h proporcionais ao movimento da conta; Story e métricas de 24 h ficam fora da v1 |
| Quando cai | cartão; os números param; falta de até 90 dias volta pela releitura; mais que isso fica sem número |

## 7. TikTok Ads

| | |
|---|---|
| Autenticação | dois apps de desenvolvedor do grupo: **leitura** (relatórios e anunciantes, no worker) e **escrita** (gestão de anúncios, só no executor). Cada app tem o seu token de longo prazo, que não vence; token revogado derruba o cartão com o código |
| Versão | v1.3. A Reporting v2.0 (de 23/10/2026) troca nomes de parâmetro; a mudança entra num PR próprio, com teste |
| Anunciantes | cadastrados por script, com a marca |
| Campanhas | `GET /campaign/get/` com `STATUS_ALL`: `campaign_id, campaign_name, operation_status, budget, budget_mode, create_time`. O worker marca a campanha Smart+ (`campaigns.is_smart_plus`; a confirmar se `/campaign/get/` traz essas campanhas ou se a leitura é por `/smart_plus/campaign/get/`) |
| Gasto e resultado | `GET /report/integrated/get/`: `report_type=BASIC`, `data_level=AUCTION_CAMPAIGN`, `dimensions=["campaign_id","stat_time_day"]`, com o filtro de status que inclui apagadas (`STATUS_ALL`; o padrão `STATUS_NOT_DELETE` some com o gasto de campanha apagada), métricas `spend, impressions, clicks, conversion` e as de formulário e valor (constantes do adaptador, a confirmar); `page_size=1000`; até 30 dias por chamada |
| Colunas | `spend` (real, 2 casas) → centavos; `budget` com `BUDGET_MODE_DAY` → `daily_budget_cents`; outros modos → nulo |
| Alterações | o TikTok não tem registro de alterações: nada em `ad_activity_log` |
| Frequência | de hora em hora: hoje e ontem; 1×/dia: 28 dias, em blocos de até 30 |
| Chave | campanha `(tiktok_ads, campaign_id)`; dia `(campaign_id, metric_on)` |
| Limites | por app, por segundo, minuto e dia; código 40100: espera 5 min, ou até 00:00 UTC no limite do dia |
| Quando cai | como a Meta |
| Escrita | o app de escrita, no executor (seção 14). Orçamento novo precisa ser pelo menos 105% do gasto atual. A partir de 01/01/2027, campanha de leads só se cria pelas chamadas Smart+ |

## 8. Google Ads

| | |
|---|---|
| Autenticação | conta de serviço com acesso direto à conta Google Ads: uma com papel "Somente leitura" para ler (no worker), outra com "Padrão" para escrever (só no executor). Sem developer token (deixou de existir em 09/09/2026) e sem refresh token de pessoa (exige verificação em duas etapas e cai quando a pessoa sai). Escopo `https://www.googleapis.com/auth/adwords`; `login-customer-id` só se houver conta de administrador (MCC) |
| Nível de acesso | Explorer (2.880 operações por dia em contas reais) cobre a leitura de hora em hora e a escrita da v1; Basic se faltar |
| Versão | v26, fixa (fim previsto para novembro de 2027). Trocar é PR com teste |
| Contas | cadastradas por script, com a marca |
| Leitura | `GoogleAdsService.SearchStream`: `campaign.id, campaign.name, campaign.status, campaign.serving_status, campaign_budget.amount_micros, campaign_budget.explicitly_shared, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value` de `campaign`, com `segments.date` na janela. Leads de formulário numa segunda consulta, só com `campaign.id`, `segments.date`, `segments.conversion_action_category` e `metrics.conversions` (a categoria não aceita custo, impressões e cliques na mesma consulta) |
| Colunas | `cost_micros` ÷ 10.000 → centavos; `amount_micros` ÷ 10.000 → `daily_budget_cents`; orçamento compartilhado (`explicitly_shared`) → `daily_budget_cents` nulo; `conversions` com fração → `numeric(14,2)`; `conversions_value` (reais) × 100; status `ENABLED` → active, `PAUSED` → paused, `REMOVED` ou `serving_status = ENDED` → ended (a campanha que passou da data de fim continua `ENABLED`) |
| Alterações | `change_event` dos últimos 2 dias, 1×/dia (a API guarda 30 dias e até 10.000 linhas por consulta) → `ad_activity_log`, com o mesmo filtro de tipos da Meta. O e-mail de quem alterou nunca é gravado: só serve para marcar `is_by_csp_mkt` |
| Fuso | `segments.date` no fuso da conta (a confirmar); `customer.time_zone` vai para `ad_accounts.time_zone` |
| Frequência | de hora em hora: hoje e ontem; 1×/dia: 30 dias, ou a maior janela de conversão da conta, até 90 |
| Chave | campanha `(google_ads, campaign.id)`; dia `(campaign_id, metric_on)`; alteração `(google_ads, resource_name)` |
| Limites | conta operação, não página; bloqueio por consumo: espera 5 ou 30 min |
| Quando cai | como a Meta |
| Escrita | a conta de serviço "Padrão", no executor (seção 14). Orçamento: sempre o que já existe (trocar por um novo no mesmo dia pode somar os dois gastos); orçamento compartilhado nunca é ajustado pela central. Criação com `validate_only` antes |

## 9. GA4

| | |
|---|---|
| Autenticação | conta de serviço com papel Leitor em cada propriedade; escopo `analytics.readonly` |
| Propriedades | `web_properties` (`kind = 'ga4_property'`), cadastradas por script (`scripts/configurar-sites.mjs --executar`, por `setup.register_web_property`) |
| Leitura | `runReport` com `date, sessionSource, sessionMedium, sessionDefaultChannelGroup` e `sessions`; um segundo relatório com `eventCount` de `eventName = generate_lead` → `lead_events`; páginas de 10.000 |
| Fuso | a propriedade em `America/Sao_Paulo` (conferir na configuração de cada uma) |
| Frequência | 1×/dia, às 14:00 (o dia anterior fica pronto em cerca de 12 h) |
| Releitura | 14 dias (o GA4 muda o dado por até 12 dias), trocando o dia inteiro da propriedade |
| Chave | `(web_property_id, metric_on, session_source, session_medium, channel_group_raw)` |
| Limites | cota em tokens por propriedade, por hora e por dia; `returnPropertyQuota` acompanha o consumo |
| IA | o canal "AI Assistant" existe desde 13/05/2026; antes disso, o CSP-MKT classifica pela origem da sessão (`mkt.ai_source_of`) |
| Quando não está ligado | cartão "A ligar" até os sites terem o ID do GA4; o bloco de IA da marca sem propriedade lida fica "Sem dados" |

## 10. Search Console

| | |
|---|---|
| Autenticação | a mesma conta de serviço do GA4, como usuário restrito de cada propriedade (a confirmar); plano B: OAuth de uma pessoa do grupo com refresh token no Vault. Escopo `webmasters.readonly` |
| Leitura | `searchAnalytics.query` com `type=web` e `dataState=final`: `dimensions=[date]` → `seo_daily`; `dimensions=[date, query]`, um dia por chamada, `rowLimit=25000`, guardando as 1.000 consultas com mais cliques → `seo_query_daily` |
| Dia | o horário do Pacífico, como a API entrega; a tela avisa |
| Frequência e releitura | 1×/dia: os últimos 10 dias (o dado final sai em 2 a 3 dias), trocando o dia inteiro das consultas |
| Histórico | a API guarda 16 meses: a primeira carga pega tudo, e o CSP-MKT guarda a própria cópia |
| Chave | `(web_property_id, metric_on)`; `(web_property_id, metric_on, query)` |
| Limites | por site, por usuário e por projeto; página e consulta juntas é a consulta mais cara (não é usada) |
| IA generativa | AI Overviews e AI Mode só aparecem na tela do Search Console, com exportação em CSV; ficam fora da v1 (`gsc_ai_feature_daily` em [`tabelas.md`](tabelas.md)) |

## 11. Checagem dos sites

- 1×/dia, às 07:00, para cada `web_properties.host`: `https://{host}/robots.txt`, `https://{host}/llms.txt` e a página
  inicial (o JSON-LD em `<script type="application/ld+json">`).
- Achado (`mkt.site_check_finding`): `robots.txt` → `found`, `missing` (404), `blocks_ai_bots` quando bloqueia um
  robô de busca de IA (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User),
  `blocks_ai_training` quando bloqueia só robô de treino (GPTBot, ClaudeBot, Google-Extended; não tira o site das
  respostas de IA e não pede "Atenção") ou `unreachable`; `llms.txt` → `found`, `missing` ou `unreachable`; JSON-LD →
  `found` (JSON válido com `@type`), `invalid` ou `missing`.
- Tempo limite de 10 s; o `User-Agent` diz que é a checagem do CSP-MKT; não segue link para fora do host.
- Chave `(web_property_id, item, checked_on)`. Não tem cartão em Conectores; site fora do ar vira `unreachable`.

## 12. CSV de reserva (decisão 0035)

Para quando a aprovação de uma API atrasa: o relatório de campanha por dia, exportado do gerenciador da plataforma.

1. O dono envia o arquivo no cartão do conector (botão "Enviar CSV", fase 4; não está no protótipo).
2. `api.upload_csv(conector, marca, nome do arquivo, conteúdo)` confere a permissão (`retry_connector`), o tamanho
   (até 5 MB) e grava em `mkt.csv_imports`, com uma rodada `requested` de gatilho `csv_upload`.
3. O worker lê o arquivo, passa pelo adaptador CSV da plataforma e grava pelas mesmas funções `ingest.*`, com
   `source = 'csv'` nas linhas do dia.
4. Quando a rodada termina, o conteúdo é apagado da tabela; fica só o registro (nome, tamanho, linhas, resultado).

Regras:

- Só relatório de campanha por dia: id e nome da campanha, dia, gasto, impressões, cliques e resultados. Sem o id da
  campanha, o arquivo é recusado (`CSV_NO_CAMPAIGN_ID`): é o id que faz a API reconhecer a campanha depois, sem
  duplicar. A campanha que nasce do CSV leva a fonte e o id da plataforma; só a linha do dia leva `source = 'csv'`.
- Arquivo com coluna de nome, e-mail, telefone ou documento é recusado inteiro (`CSV_PERSONAL_DATA`, decisão 0037).
- Moeda real; dia no fuso da conta.
- A API regrava a linha do CSV quando ligar, e nunca o contrário.
- A primeira importação boa dá base à fonte (`first_success_at`); o cartão mostra "A ligar · números por arquivo CSV".

## 13. Saúde do conector — o que a tela de Conectores lê

`api.kpi_connectors()` junta `mkt.v_connector_health` ([`metricas.md`](metricas.md), seção 4.9), o estado das
credenciais (`api.credential_status()`), a rodada apps → CSP 360 e os CSV na fila.

| Estado (decisão 0024) | Quando |
|---|---|
| Funcionando (`ok`) | a última rodada boa de cada trabalho está dentro da frequência mais a folga |
| Atrasado (`late`) | algum trabalho passou da frequência mais a folga (10% da frequência, no mínimo 5 min) |
| Caído (`down`) | a última rodada falhou e não há rodada boa há mais de duas frequências |
| A ligar (`not_connected`) | nunca houve rodada boa (mesmo com tentativa que falhou: o cartão mostra a última falha e o código) |
| Desligado (`disabled`) | o dono desligou |

- **O pior trabalho manda:** o estado do conector é o pior entre os seus trabalhos (`connector_jobs`); o cartão diz
  qual está atrasado ("Releitura atrasada", "Passada completa atrasada").
- **Falhas seguidas:** rodadas que falharam desde a última boa, com a hora e o código da última falha. **Linhas
  gravadas em 24 h** continuam.
- **Tentar de novo:** `api.retry_connector(código)` cria a rodada `requested`; o worker pega em até 1 min e roda o
  trabalho principal do conector (CRM: incremental; anúncios: o de hora em hora; Instagram, GA4, Search Console: o
  diário). A tela mostra "Tentando de novo" enquanto a rodada está pedida ou rodando e relê a cada 15 s, por até 3 min;
  depois diz o resultado, com o código quando falha.
- **Ligar e desligar:** desligado, o worker não roda os trabalhos do conector, e a execução nas plataformas fica
  bloqueada (`connector_disabled`).
- **Credencial:** "Vence logo" 7 dias antes de vencer, com o aviso urgente "Credencial vence logo" (decisão 0019);
  recusada (401 ou 403) derruba o cartão com "Credencial recusada".
- **Aviso** "Conector parado" (decisão 0019): quando o estado vira "Caído" ou "Atrasado", um aviso por pessoa e por
  ocorrência (`dedupe_key`), e "Tudo funcionando de novo desde {hora}" quando volta.

## 14. Execução das ações do Claude (decisões 0005, 0020 e 0038)

Nada é executado sem aprovação na central, e só quando houver credencial de escrita aprovada na plataforma. Quem
executa é o **executor**, um serviço à parte do worker de leitura, com o papel `mkt_executor` e os únicos tokens de
escrita (decisão 0017).

1. **Fila aprovada.** `api.approve_action`, `api.propose_action` com `approve_now`, `api.stop_all`, `api.undo_stop` e
   `api.set_spend_limit` (o teto da conta na Meta) criam as execuções em `platform_executions` (`queued`); todo dia 1,
   `private.queue_monthly_spend_caps`, pelo `pg_cron`, cria a do teto do mês (abaixo). O `request` é exatamente o que
   foi aprovado, traduzido para a operação da plataforma; os parâmetros da ação congelaram na aprovação. Cada execução tem `idempotency_key` única. Na v1, lance (`bid`) e criativo (`creative`) não executam pela
   central: `private.queue_execution` não cria execução para eles, e a tela diz "Faça na plataforma e marque como
   feita".
2. **Executor.** A cada 30 s, `ingest.next_execution()` pega a próxima (`for update skip locked`): as de "Parar tudo"
   primeiro; uma por campanha de cada vez.
3. **Pode executar?** `mkt.execution_allowed`, nesta ordem (o primeiro que falhar vira o motivo de `blocked`):
   - a aprovação confere: a ação está `approved` ou `running`, com `approved_by` de um perfil ativo cujo papel tem
     `approve_action` em `role_permissions` (na parada: `traffic_stops.requested_by` com `stop_all`; no teto da conta:
     `spend_limits.set_by` com `configure_traffic`); o `request` bate com os `params` congelados → senão
     `approval_invalid`;
   - conector ligado → `connector_disabled`;
   - credencial de escrita existe e está válida (a linha de estado dela em `private.connector_credentials`, seção 18)
     → `no_write_credential`;
   - campanha não encerrada → `campaign_ended`;
   - operação que pode aumentar o gasto (`activate`, `set_daily_budget` acima do atual, `create_campaign`) numa marca
     com parada aberta → `stopped`;
   - a mesma operação numa conta sem limite vigente → `no_spend_limit`; na Meta, também quando o `spend_cap` da conta,
     lido pelo worker na releitura diária (`ad_accounts.spend_cap_cents`), falta, ou quando a sobra dele
     (`spend_cap_cents` − `amount_spent_cents`) passa da sobra do limite do mês (limite − gasto da conta no mês,
     `mkt.v_account_month`);
   - a mesma operação passando do limite do mês (`mkt.action_exceeds_limit` ou, para `activate`,
     `mkt.execution_extra_spend_cents`: a mesma conta do alerta da fila; `activate` conta como orçamento diário da
     campanha × dias que faltam no mês), ou sem base para a conta → `over_spend_limit`.
   Pausar e reduzir nunca são barrados. Não pode → `blocked`, com o motivo, e a tela diz o que fazer na plataforma.
4. **Relê antes.** O executor lê o objeto na plataforma. Já está como pedido → `confirmed`, sem mandar nada.
5. **Manda.** Com a chave da execução (quadro abaixo) → `sent`, tentativas + 1.
6. **Confirma relendo.** Igual ao pedido → `confirmed`; a ação vira `done` (`done_via = 'platform_api'`,
   `executed_at`), e a campanha é atualizada com o que foi lido. Sem resposta ou diferente → nova tentativa (1, 2, 4, 8,
   16 s; até 5), sempre relendo antes. Erro 4xx → `failed`; a ação vira `failed` e volta para a fila com o código.
7. **Queda no meio.** Execução `sent` sem confirmação é relida antes de qualquer nova tentativa.
8. **Sem credencial de escrita** (o começo da v1): toda execução fica `blocked` (`no_write_credential`). A pessoa faz na
   plataforma e marca como feita; a execução vira `cancelled`.
9. **Parar tudo** (decisão 0022): uma execução `pause` por campanha ativa do Claude que ainda não está numa parada
   aberta; as execuções na fila da marca que podem aumentar o gasto viram `blocked` (`stopped`). "Desfazer" cria
   `activate` só para as campanhas da parada que a última leitura mostra pausadas e que não estão em outra parada
   aberta; a reativação passa pelo limite do mês como qualquer aumento. Se a pausa ficar em `queued` por mais de 2 min
   (executor fora do ar), a tela mostra a lista para pausar à mão e sai o aviso urgente "Parar tudo sem confirmação".

| Operação | Meta | TikTok | Google Ads |
|---|---|---|---|
| Pausar, reativar | `POST /{campaign_id}` `status=PAUSED` ou `ACTIVE` | `campaign/status/update/` `DISABLE` ou `ENABLE`; na Smart+, `smart_plus/campaign/status/update/` | `MutateCampaigns`, `status` |
| Orçamento diário | `POST /{campaign_id}` `daily_budget` em centavos, só com orçamento na campanha; até 4 mudanças por hora | `campaign/update/` `budget`, pelo menos 105% do gasto | `MutateCampaignBudgets`, `amount_micros` do orçamento que já existe, nunca compartilhado |
| Criar campanha (sempre pausada) | `POST /act_{id}/campaigns` com `status=PAUSED` e `special_ad_categories` | `smart_plus/campaign/create/` (obrigatório a partir de 2027 para leads), pausada | `Mutate` atômico (orçamento e campanha) com `status=PAUSED`, `validate_only` antes |
| Teto da conta (`set_account_spend_cap`) | `POST /act_{id}` com `spend_cap_action=reset` e `spend_cap` = sobra do limite do mês (no dia 1, o limite inteiro), em reais (a leitura vem em centavos) | — | — |
| Confirmar | `GET /{campaign_id}?fields=status,effective_status,daily_budget` | `campaign/get/` | o recurso devolvido (`MUTABLE_RESOURCE`) e releitura |
| Não repetir | cabeçalho `X-Client-Idempotent-Key` = a chave da execução | valor final e releitura | valor final, releitura e nome único |

- **Teto da conta na Meta, todo mês:** no dia 1, às 00:05 de São Paulo, o `pg_cron` chama
  `private.queue_monthly_spend_caps()`. Ela cria uma execução `set_account_spend_cap` (com `reset`, o limite do mês
  inteiro) para cada conta Meta com limite vigente e credencial de escrita. Quando o dono muda o limite no meio do mês,
  `api.set_spend_limit` cria a mesma execução com a sobra do limite novo. O executor manda como qualquer execução. Como
  a Meta conta o gasto depois do `reset` fica a confirmar na primeira escrita, antes de ligar a escrita (seção 19).
- **Campanha criada pela central** leva o código da ação no nome (`…-act-0012`), dentro da convenção da UTM, e o id
  da campanha no sufixo do link (decisão 0031). O executor procura o nome antes de criar e grava a campanha, com
  `created_by_action_id` e `managed_by = 'claude'`, na mesma transação que confirma a execução. Se a leitura de hora em
  hora chegar antes, `ingest.upsert_campaigns`, ao inserir campanha cujo nome termina com o código de uma ação `create`
  aprovada, com execução `sent` ou `confirmed` na mesma conta, já grava `managed_by = 'claude'` e a ação (decisão
  0008). O operador nunca muda por `update` do worker ou do executor.
- **Ajuste de orçamento** numa campanha com orçamento nos conjuntos, ou com orçamento compartilhado no Google, é
  recusado já na proposta (`private.validate_action`, chamada por `api.propose_action` e por
  `ingest.add_claude_proposal`), com o texto "O orçamento desta campanha é dividido com outras ou fica nos conjuntos:
  ajuste na plataforma".
- **Teto**, em cinco travas: o limite do mês antes de mandar; conta sem limite não recebe aumento; o teto gravado na
  própria Meta antes de ligar a escrita (decisão 0021); "Parar tudo"; e nada automático (só vai o que foi aprovado,
  decisão 0005), com uma exceção: a regravação do teto da Meta no dia 1, que repete o limite que o dono aprovou
  (decisão 0021). Ao chegar no teto, a Meta para todas as campanhas da conta, também as do gestor humano. O limite do CSP-MKT avisa e barra execução nova; ele não pausa o que já roda.
- **O usuário de escrita** só gerencia campanhas das contas cadastradas e, na Meta, o limite de gasto da conta
  (`spend_cap`), sem acesso a pagamento nem a usuários. Qual permissão da conta a Meta pede para gravar o `spend_cap`
  fica a confirmar (seção 19).

## 15. O Claude: rodada, contexto e resposta

- **Quando:** 1×/dia, às 07:30, por marca, depois da releitura dos números, e só com o conector de anúncios da marca em
  dia. Rodada fora de hora: recomendação, não na v1 (a diária basta e o custo fica previsível). Se o dono pedir, entra
  com decisão nova um botão "Pedir análise agora" para quem tem `operate_traffic`, com no máximo uma rodada a mais por
  marca por dia.
- **Entrada:** `mkt.claude_context(brand_id)`, uma função SQL (o worker não calcula nada): no mês corrente e nos últimos
  30 dias, por canal e por campanha, status, operador, orçamento diário, gasto, leads e clientes novos atribuídos
  (contagens), custo por lead, custo por cliente novo, ROAS e os números informados pela plataforma; por conta, limite,
  gasto do mês e projeção; a estratégia do mês (texto e metas); as pendências de medição; o estado dos conectores. Das
  ações dos últimos 30 dias vão só `code`, `kind`, `status`, `platform`, campanha, `params`, `done_via` e
  `discard_reason`; o título vai só nas propostas do próprio Claude. Nunca vão `rationale`, `result` nem
  `discard_note`. O único texto livre escrito por pessoa é `traffic_strategies.body`, e a tela da estratégia diz,
  embaixo do campo: "Este texto vai para o Claude. Não escreva nome de cliente, lead ou pessoa."
- **Nunca vai:** id ou código de lead e de cliente, código de representante, nome, telefone, e-mail, documento,
  endereço, texto vindo do CRM. `mkt.valid_claude_context` aceita só as chaves previstas e recusa qualquer outra chave
  de texto, e todo texto passa por `mkt.has_personal_data`. Recusado, a rodada falha antes de chamar a API
  (`CONTEXT_REFUSED`). O filtro não reconhece nome: o nome digitado na estratégia ou no nome de uma campanha é risco
  residual, com a Anthropic como operadora ([README](README.md), "Dado pessoal"), aceito como exceção na decisão 0020.
- **Instrução:** texto versionado no repositório do worker (`prompt_version`): o Claude só propõe; responde no formato
  combinado; respeita o limite e a estratégia; nome de campanha nova pela convenção da UTM.
- **Resposta:** JSON estruturado, uma proposta por item (tipo, marca, canal, campanha, título, motivo, parâmetros,
  impacto, esforço, custo). O worker cria o id da rodada antes de chamar a API; `ingest.record_claude_run` é upsert por
  esse id, e cada proposta grava por `(claude_run_id, claude_item)`: repetir não duplica. Cada proposta passa por
  `private.validate_action`, a mesma função que `api.propose_action` chama, e nasce `idea`; a inválida fica de fora e
  é contada em `claude_runs.proposals_refused`.
- **Modelo e chave:** `ANTHROPIC_MODEL` (id fixo, gravado em `claude_runs.model`) e `ANTHROPIC_API_KEY`, só no worker
  de leitura.
- **Guarda:** prompt, contexto e resposta por 13 meses (`claude_runs`). O log leva só tokens, tempo e quantas propostas.
- **Falhou:** `claude_runs.status = 'failed'` com o código; nada é proposto; a fila continua como estava.

## 16. n8n: só avisos (decisões 0001 e 0019)

- Um fluxo: a cada 5 min, `notify.claim_pending(50)` → por canal, e-mail ou WhatsApp (API oficial, com modelo
  aprovado) → `notify.mark_sent` ou `notify.mark_failed`. Cabe em até ~15 nós. O banco já entrega o resumo (os avisos
  não urgentes da mesma pessoa, canal e horário num item só) e já confere de novo a permissão e a preferência.
- O banco decide o que avisar e quando; o n8n não lê tabela nenhuma (papel `n8n_notifier`, que só executa
  `notify.claim_pending`, `notify.mark_sent` e `notify.mark_failed`).
- As credenciais do n8n (banco, e-mail, WhatsApp) ficam nas credenciais do próprio n8n, no Railway, nunca no
  repositório. O JSON do fluxo vai para `n8n-fluxos/` a cada mudança.
- Variáveis do n8n no Railway: `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`, `EXECUTIONS_DATA_SAVE_ON_ERROR=none`,
  `EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS=false` (o teste de um fluxo no editor pegaria avisos de verdade da fila; o
  fluxo também fica sem configuração própria de guardar execução), `EXECUTIONS_DATA_PRUNE=true`, `EXECUTIONS_DATA_MAX_AGE=168` (7 dias) e `N8N_ENCRYPTION_KEY` como segredo do Railway
  (é a chave que cifra as credenciais do n8n; sem ela, o n8n gera uma e guarda no mesmo volume do que ela cifra).
  O n8n não guarda execução, nem a que falhou: a falha fica só na fila (`notify.mark_failed(id, error_code)` grava o
  código em `notification_outbox`, sem o endereço), e o reenvio sai de lá.
- Renovar token não é tarefa do n8n: é do worker (decisão 0017).
- n8n fora do ar: os avisos ficam na fila e saem quando ele voltar, sem repetir (`dedupe_key`); o que não é urgente vai
  no próximo horário comercial.

## 17. Quando o outro lado cai

| Fonte | O que para | O que continua | O que a tela diz | Quando volta |
|---|---|---|---|---|
| CSP 360 | leads, clientes e pedidos no último retrato | mídia, Instagram, SEO e GEO; o custo usa os clientes até a última leitura | "O CSP 360 não responde desde {hora}. Leads e pedidos param aí; os números de mídia seguem." | a leitura retoma da marca d'água, e a passada diária confere tudo |
| Meta, TikTok, Google | gasto e campanhas do canal | o resto | faixa na tela do canal e na Visão geral | a releitura de 28 ou 30 dias cobre a falta |
| Instagram | números do perfil e dos posts | o resto | faixa na tela do Instagram | releitura de 3 dias; mais de 90 dias sem leitura fica sem número |
| GA4, Search Console | blocos de IA e de busca | o resto | selo de cada fonte na tela de SEO e GEO | releitura de 14 e 10 dias |
| Claude API | a rodada do dia | tudo; a fila continua | nada novo é proposto | a próxima rodada |
| Executor | as escritas aprovadas | a leitura, as telas, a fila | depois de 2 min, a pausa do "Parar tudo" vira lista para pausar à mão, com aviso urgente | a fila sai na ordem, relendo antes |
| Escrita na plataforma | a execução | o resto | execução "Falhou", com o código; a ação volta para a fila | "Tentar de novo" |
| n8n | avisos fora do sistema | avisos na tela, contadores | — | a fila manda o que ficou, sem repetir |
| Banco do CSP-MKT | tudo | — | "Não deu para carregar", com o código | — |

## 18. Credenciais (decisões 0005, 0017 e 0036)

Só os nomes. Os valores ficam no Railway, no Vault, nos segredos das Edge Functions e do GitHub, nas credenciais do
próprio n8n e, só a `MKT_SETUP_DATABASE_URL`, no `.env` local de quem configura; nunca no código, no README, no chat ou
com prefixo `VITE_`.

| Onde | Nome | Para quê |
|---|---|---|
| Railway (worker de leitura) | `WORKER_DATABASE_URL` | o worker no banco do CSP-MKT, papel `mkt_worker` |
| | `CSP360_DATABASE_URL` | réplica do CRM, papel `csp_mkt_reader` (sai `CSP360_SUPABASE_URL` e `CSP360_READONLY_KEY`) |
| | `META_APP_ID`, `META_APP_SECRET` | app da Meta (Marketing API e Instagram) |
| | `META_ACCESS_TOKEN_READ` | token do usuário do sistema de leitura |
| | `TIKTOK_READ_APP_ID`, `TIKTOK_READ_APP_SECRET`, `TIKTOK_READ_ACCESS_TOKEN` | app de leitura (sai `TIKTOK_APP_ID` e `TIKTOK_APP_SECRET`) |
| | `GOOGLE_ADS_READ_SERVICE_ACCOUNT_JSON` | conta de serviço "Somente leitura" do Google Ads (saem `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET` e `GOOGLE_ADS_REFRESH_TOKEN`) |
| | `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | só se houver conta de administrador; não é segredo |
| | `GOOGLE_SERVICE_ACCOUNT_JSON` | GA4 e Search Console, só leitura |
| | `REP_LOGIN_HMAC_KEY` | resumo do login dos apps (`sales_rep_app_logins`) |
| | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Claude API |
| Railway (executor) | `EXECUTOR_DATABASE_URL` | o executor no banco do CSP-MKT, papel `mkt_executor` |
| | `META_APP_ID`, `META_APP_SECRET`, `META_ACCESS_TOKEN_WRITE` | o app e o usuário do sistema de escrita (só depois da aprovação da Meta) |
| | `TIKTOK_WRITE_APP_ID`, `TIKTOK_WRITE_APP_SECRET`, `TIKTOK_WRITE_ACCESS_TOKEN` | app de escrita |
| | `GOOGLE_ADS_WRITE_SERVICE_ACCOUNT_JSON`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | conta de serviço "Padrão" do Google Ads |
| Vault (`private.connector_credentials`) | — | só o que renova sozinho: o plano B do Instagram e o do Search Console (de leitura). O primeiro segredo entra por `setup.register_credential`, pelo script de configuração |
| `private.connector_credentials`, sem segredo | — | uma linha de estado por credencial de escrita (`purpose = 'write'`, `vault_secret_id` nulo). O segredo fica só nas variáveis do executor. A linha nasce por `setup.register_credential` quando a plataforma aprova a escrita. É ela que `mkt.execution_allowed`, `api.set_spend_limit` e `api.credential_status()` leem |
| Edge Functions | `SUPABASE_SERVICE_ROLE_KEY` | convidar e tirar acesso (sai do worker) |
| Vercel (front) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SAMPLE_DATA`, `VITE_CSP360_APP_URL` | o front; nenhum é segredo |
| Railway (n8n) | `N8N_ENCRYPTION_KEY` e as variáveis `EXECUTIONS_DATA_*` (seção 16) | cifra das credenciais do n8n e histórico de execuções desligado |
| n8n (credenciais dele) | — | banco (`n8n_notifier`), e-mail e WhatsApp |
| `.env` local de quem configura (nunca no Railway) | `MKT_SETUP_DATABASE_URL` | os scripts de configuração, papel `mkt_setup` |
| GitHub (CI) | os de [`plano.md`](plano.md) | migrações, teste de RLS e o job manual do primeiro dono |

Saem também `GA4_PROPERTY_ID_*` e `GSC_SITE_*` (viram `web_properties`), `SUPABASE_URL` do worker,
`N8N_WEBHOOK_SECRET` (o n8n não recebe webhook: busca a fila em `notify.claim_pending`) e `ALERT_WHATSAPP_GROUP_ID` (o
aviso vai para o WhatsApp de cada perfil, decisão 0019). O `.env.example` muda na fase 4, no mesmo PR do worker.

## 19. A confirmar e pendências com terceiros

**A confirmar na primeira leitura** (vai para o `ESTADO.md` com o resultado):

- Meta: se o nível Limited basta para ler as contas do próprio portfólio; quais `action_type` contam lead, conversão e
  valor; se `use_unified_attribution_setting=true` bate com o gerenciador; se o insights por campanha devolve campanha
  apagada e arquivada sem o `filtering`.
- Instagram: se o token de usuário do sistema cobre o Instagram; o fuso do dia (`end_time`); se `total_interactions`
  inclui as interações de anúncio.
- TikTok: o atraso de processamento do relatório; os nomes das métricas de formulário e de valor; se `/campaign/get/`
  traz as campanhas Smart+ e como ler e mudar o orçamento delas.
- Google Ads: o fuso de `segments.date`; a categoria de conversão de formulário; se `metrics.conversions` conta na data
  do clique (a releitura de até 90 dias cobre).
- Search Console: se a conta de serviço entra como usuária da propriedade.
- GA4: o fuso de cada propriedade.
- Meta, TikTok e Google: quanto cada uma gasta acima do orçamento diário (decisão 0021).

**A confirmar na primeira escrita** (numa conta de teste ou antes de ligar a escrita numa conta de verdade):

- Meta: que o `spend_cap_action=reset` zera o `amount_spent` e que o teto passa a contar o gasto dali em diante; qual
  permissão da conta a Meta pede para gravar o `spend_cap`, sem dar acesso a pagamento nem a usuários.

**Depende de outros** (não trava o banco; o que faltar fica "Sem dados" ou "A ligar"):

- **Time do CRM:** o papel `csp_mkt_reader`, o esquema de views e as permissões da seção 3.3 (e, se alguma leitura for
  direta numa tabela com RLS ligada, a política de leitura do papel nela); as views `clientes_situacao`, `clientes_utm`,
  `clientes_compras_marca` (com a primeira e a última compra por marca, sem os pedidos do CRM) e `negocios_responsavel`;
  qual funil vale como funil de leads; como a conversão do SDR preenche a origem do negócio; as colunas de data (envio,
  faturado, mudança de fase); a UTM e o `referrer` por lead (`negocios_utm`); o formato do login dos apps; a campanha
  de origem do lead de formulário de plataforma, se o grupo usar.
- **Meta:** Business Verification e App Review para a escrita (o item mais longo).
- **TikTok:** perfil de desenvolvedor aprovado e os dois apps.
- **Google:** projeto do Google Cloud com o nível de acesso pedido; as contas de serviço como usuárias da conta Google
  Ads, do GA4 e do Search Console; se o projeto estiver numa organização, liberar a criação de chave para as três
  contas de serviço (`iam.disableServiceAccountKeyCreation`).
- **Sites:** o ID do GA4 nos dois sites, para o conector deixar de estar "A ligar".
- **Dono:** quais contas de anúncio, perfis e propriedades são de cada marca (para os scripts de cadastro).

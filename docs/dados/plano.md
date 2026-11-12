# Plano: do modelo aprovado ao banco

> Aprovado pelo dono em 03/11/2026 ("Aprovar tudo"), com as decisões de produto 0021 a 0033 como recomendadas.

## Como a fase 3 fecha

1. O dono aprova este modelo (os arquivos de `docs/dados/` e as decisões 0013 a 0038) e responde as decisões de
   produto (0021 a 0033). No PR da aprovação, as decisões passam de "proposta" a "aceita", com a data (seção "No PR da
   aprovação", abaixo). Feito em 03/11/2026.
2. As migrações 01 a 10 e, adiantadas da 11, as views de `api` (`api.v_traffic_actions`, `api.v_traffic_log`) com o
   que elas usam de `mkt` (`mkt.v_account_month`, na 10, e `mkt.action_alert`) são escritas, com os testes da camada 1
   no `pnpm verify` (`supabase/tests/casos-de-rls.test.ts` fecha os casos sobre o que existe até ali).
3. O CI aplica as migrações no **projeto Supabase de teste** e roda o teste de RLS pela API (camada 2,
   [`papeis-e-rls.md`](papeis-e-rls.md)). No portão rodam os casos sobre o que existe até ali.
4. Com a camada 2 inteira passando, o portão da fase 3 fecha e o resultado vai para o `ESTADO.md`. O resto (views de
   KPI, worker, executor, front ligado no banco) é a fase 4.

O teste de RLS precisa de um banco de verdade: por isso o portão fecha depois das migrações, num projeto que não é o
de produção, e sem nenhum dado real.

## Ordem das migrações

Nome `supabase/migrations/AAAAMMDDHHMMSS_o_que_faz.sql`. Os números abaixo marcam a ordem. As migrações 01 a 10 e a
parte adiantada da 11 já têm o nome final (escritas na fase 3); o resto da 11, a 12 e a 13 ganham a hora quando forem
escritas, na fase 4, sempre depois da última que existir (`scripts/conferir-migracoes.mjs` confere a versão única).
Toda migração começa com o cabeçalho do padrão (o que faz, risco, como reverter, uma consulta para conferir) e roda de
novo sem erro: `if not exists` onde o Postgres tem; política com `drop policy if exists` antes do `create`; gatilho
com `create or replace trigger`; domain, tipo, papel e restrição criados só se ainda não existem, num bloco que
confere `pg_type`, `pg_roles` e `pg_constraint` (modelo em [`tabelas.md`](tabelas.md), "Peças comuns"); domain nunca é
apagado: mudar a lista é `alter domain`. Cada tabela nasce já com a RLS ligada: nunca existe uma tabela sem RLS entre
uma migração e outra. Toda função dos sete esquemas, `security definer` ou `invoker`, também as de gatilho, nasce com
`set search_path = pg_catalog, pg_temp`, com o `pg_temp` explícito e por último: sem o `pg_temp` no caminho, o esquema
temporário da sessão é procurado primeiro para tipos e tabelas (RLS-27, [`papeis-e-rls.md`](papeis-e-rls.md)). Toda
função `security definer` nasce com `revoke` de `public` e `grant` só ao papel que a usa.

| # | Arquivo | O que cria | Como reverter |
|---|---|---|---|
| 01 | `20261103160000_esquemas_e_papeis.sql` | Antes de tudo, `alter default privileges for role postgres revoke execute on functions from public`; esquemas `mkt`, `api`, `authz`, `ingest`, `notify`, `private`, `setup`; papéis `mkt_worker`, `mkt_executor`, `mkt_setup` e `n8n_notifier` (sem login: a senha entra pelo CI, nunca no arquivo; nenhum com `bypassrls`); `revoke` de `public` e `anon`; as extensões `pg_cron` e `supabase_vault` só onde existem (`do $$ begin if exists (select 1 from pg_available_extensions where name = 'pg_cron') then create extension if not exists pg_cron; end if; end $$;`, o mesmo para `supabase_vault`: o PGlite não tem as duas, e o arquivo de apoio cria os esboços); `pg_net`, `http` e `dblink` desligadas; GraphQL desligado; `private.set_updated_at`, `mkt.sp_day`, `mkt.utm_key`, `mkt.has_personal_data`, `mkt.valid_crm_text`, `mkt.now`, `mkt.today`, `private.next_code` e as sequências | `drop schema … cascade` dos sete esquemas; `drop role` dos quatro papéis |
| 02 | `20261103160100_listas_fechadas.sql` | Os `domain` de [`listas.md`](listas.md); `role_permissions` (a única lista de permissões); `holidays` (feriados nacionais do ano e do seguinte), as duas já com a RLS ligada e a política de leitura do worker; a de `authenticated` usa `authz.is_active_user` e entra na 03. No mesmo PR: as cinco listas que mudam (`order_status`, `ai_source`, `action_status`, `connector_status`, `customer_situation`) entram no `labels.ts` e nos tipos de `packages/shared`, com o ajuste das consultas do protótipo (`invoiced` → `is_invoiced`, `simulated` → `not_connected`) e do `labels.test.ts`; as listas que ainda não estão no `labels.ts` ficam na lista `SO_NO_BANCO` do teste de paridade, com o motivo | `drop table`; `drop domain` |
| 03 | `20261103160200_usuarios.sql` | `profiles`, `invitations`, `notification_preferences`, `saved_filters`, `audit_log`; `authz.can`, `authz.requires_second_factor`, `authz.is_active_user`, `authz.display_name`, `mkt.valid_saved_filters`, `mkt.valid_audit_changes`, `mkt.notice_default`; gatilhos de novo usuário (em `auth.users`), de papel protegido e de só-acréscimo; RLS, também as políticas de leitura de `role_permissions` e `holidays` | `drop table` primeiro e sem `cascade` (com uma seguinte aplicada, ele para antes de tudo); `drop trigger` em `auth.users` |
| 04 | `20261103160300_dimensoes.sql` | `brands` (as duas marcas, sem o id do CRM), `ad_accounts`, `campaigns`, `campaign_managed_by_history`, `sales_reps`, `sales_rep_app_logins`, `ig_accounts`, `web_properties`; gatilhos do operador, o de código de `sales_reps` e o de só-acréscimo de `campaign_managed_by_history`; RLS | `drop table` na ordem inversa |
| 05 | `20261103160400_replica_crm.sql` | `crm_funnels`, `crm_origin_map` (com o de-para inicial, só valores genéricos, e as origens do negócio aberto à mão, que não é lead), `crm_customers`, `crm_customer_brands`, `crm_customer_reps`, `crm_leads`, `crm_orders`, `crm_upstream_runs`; o gatilho de código de `crm_leads`; RLS | `drop table` na ordem inversa |
| 06 | `20261103160500_snapshots.sql` | `ad_campaign_daily`, `ad_activity_log`, `ig_account_daily`, `ig_media`, `ig_media_daily`, `seo_daily`, `seo_query_daily`, `ga4_traffic_daily`, `site_checks`; `mkt.valid_activity_details`; RLS | `drop table` |
| 07 | `20261103160600_trafego.sql` | `traffic_strategies`, `spend_limits`, `claude_runs`, `traffic_actions` (e a chave `campaigns.created_by_action_id`), `traffic_stops`, `traffic_stop_campaigns`, `platform_executions`, `traffic_log`; `mkt.valid_action_params`, `mkt.valid_claude_context`; gatilhos de código, transição, execução protegida, diário (também o da execução) e só-acréscimo de `traffic_log`; RLS | `alter table mkt.campaigns drop constraint …`; `drop table` na ordem inversa |
| 08 | `20261103160700_conectores.sql` | `connectors` (as sete linhas, com frequência e folga), `connector_jobs` (uma linha por trabalho), `sync_runs`, `csv_imports`, `private.connector_credentials`, `notification_outbox`, `mkt.valid_notice_payload`; RLS | `drop table` |
| 09 | `20261103160800_funcoes_de_acao.sql` | As funções `api.*` de ação e de leitura com regra própria (`api.my_profile`, `api.my_permissions`, `api.list_role_permissions`, `api.check_text`, `api.list_users`, `api.credential_status`…) e `private.validate_action`, com `revoke` e `grant` uma a uma; e, adiantadas da 10 porque as de `api` já as chamam, as filas e conferências da execução (`private.queue_execution`, `private.queue_stop_executions`, `private.queue_spend_cap`, `private.execution_request`, `private.write_credential_ok` e `mkt.execution_may_increase_spend`) | `drop function` |
| 10 | `20261103160900_ingestao.sql` | As funções `ingest.*` do worker (`start_run`, `take_requested_run`, `finish_run`, `set_credential_status`, uma `upsert_*` por tabela da réplica, das dimensões e dos retratos, `upsert_site_checks`, `replace_day`, `delete_missing`, `record_claude_run`, `add_claude_proposal`) e do executor (`next_execution`, `update_execution`, `set_action_progress`), com o lote e cada linha em `private.ingest_*` (sem `grant`); `private.read_credential`, `private.rotate_credential`, `mkt.execution_allowed`, `mkt.execution_extra_spend_cents` e as `setup.*` (`register_ad_account`, `register_ig_account`, `register_web_property`, `mark_lead_funnel`, que marca o funil antigo dos leads do site (decisão 0041), `register_credential`, `create_first_owner_invitation`), com `grant` função por função a cada papel; no começo do arquivo, antes delas e das `ingest.*`, as funções de [`metricas.md`](metricas.md) de que elas dependem: as de origem (`mkt.url_host`, `mkt.host_matches`, `mkt.ai_source_of`, `mkt.utm_source_family`, `mkt.is_known_origin_text`) e as da conta do limite (`mkt.ratio`, `mkt.pace` e `mkt.limit_alert`, com os domains `mkt.spend_situation` e `mkt.limit_alert`; `mkt.source_covered`, `mkt.ads_covered`, a view `mkt.v_account_month`, adiantada da 11, `mkt.action_extra_spend_cents` e `mkt.action_exceeds_limit`) | `drop function`; `drop view` |
| 11 (adiantada) | `20261103161000_views_da_api.sql` | Para o portão da fase 3: `api.v_traffic_actions` e `api.v_traffic_log` (`security_invoker`) e o alerta de cada ação da fila (`mkt.action_alert`, com o domain `mkt.action_alert`); a `mkt.v_account_month`, de que o alerta depende, já entra na 10 | `drop view`; `drop function` |
| 11 (fase 4) | `…_views_base.sql` | As outras views `mkt.v_*` e `api.v_*` (regras em `metricas.md`) | `drop view` |
| 12 (fase 4) | `…_kpi.sql` | As funções `api.kpi_*` e `api.list_*` (regras em `metricas.md`) e `mkt.claude_context` (o contexto da rodada do Claude, [`integracoes.md`](integracoes.md), seção 15) | `drop function` |
| 13 (fase 4) | `…_avisos_e_agenda.sql` | Funções de `notify`, `private.enqueue_*`, `mkt.next_business_slot`, `private.queue_monthly_spend_caps`, as regras que enfileiram avisos e os trabalhos do `pg_cron` (avisos; o teto da conta na Meta, todo dia 1 às 00:05, por `private.queue_monthly_spend_caps`; e limpezas de prazo de guarda: `invitations` 90 dias depois de aceito, revogado ou vencido; `sync_runs`, `notification_outbox`, `crm_upstream_runs` e `csv_imports` 90 dias; `claude_runs` e `ad_activity_log` 13 meses; `audit_log` 2 anos; `traffic_log`, depois `platform_executions` (também as de parada e de teto da conta, que não caem com a ação) e `traffic_actions`, 5 anos) | `cron.unschedule`; `drop function` |

- **Reverter antes de ir para produção:** no projeto de teste, apagar os sete esquemas e reaplicar tudo. O "Como
  reverter" do cabeçalho de cada migração vale só depois de reverter as seguintes, da última até a 01; a camada 1
  (`supabase/tests/migracoes.test.ts`) roda o roteiro inteiro e confere que cada passo volta o catálogo ao de antes
  da migração.
- **Reverter depois de produção:** migração nova que desfaz (nunca editar uma migração já aplicada). O CI compara com
  a `main` e reprova o PR que muda um arquivo de migração antigo.
- **Compatível com o deploy:** coluna nova nasce opcional até o código que depende dela subir (seção 10 do padrão).
  Na v1 o banco nasce antes do front ligado nele, então as migrações 01 a 13 entram sem esse cuidado; daí em diante,
  vale a regra.

## Como o CI aplica

O CI de hoje está em `docs/ci.yml` e não roda no GitHub (o token do `push` não tem o escopo `workflow`). Ele precisa
voltar para `.github/workflows/ci.yml` antes da primeira migração. Proposta de passos novos:

| Quando | Passo | Segredos (nomes) |
|---|---|---|
| Todo PR | `pnpm verify`, que agora inclui `supabase/tests` (PGlite: aplica o arquivo de apoio e as migrações, roda a camada 1 e a paridade das listas) | nenhum |
| Todo PR | Checagem de versão única (já existe), "migração antiga não muda" e "migração não toca o cofre": reprova migração que cite `vault.decrypted_secrets`, `vault.secrets`, `net.http_`, as funções da extensão `http` (`http_get`, `http_post`, `http(`…; a coluna `http_status` não conta) ou `dblink` fora de `private.read_credential` e `private.rotate_credential` | nenhum |
| PR com mudança em `supabase/` | O job usa `concurrency: supabase-teste` (um por vez) e começa recriando o projeto de teste: apaga os sete esquemas e o histórico de migrações e aplica tudo do zero com `supabase db push` (CLI do Supabase instalada no runner do GitHub, que tem Docker; não precisa de Docker local). Depois, a senha dos papéis de serviço e `scripts/testar-rls.mjs --executar` | `SUPABASE_DB_URL_TESTE`, `SUPABASE_URL_TESTE`, `SUPABASE_ANON_KEY_TESTE`, `SUPABASE_SERVICE_ROLE_KEY_TESTE`, `MKT_WORKER_DB_PASSWORD_TESTE`, `MKT_EXECUTOR_DB_PASSWORD_TESTE`, `MKT_SETUP_DB_PASSWORD_TESTE`, `N8N_NOTIFIER_DB_PASSWORD_TESTE` |
| Push na `main` | `supabase db push` em **produção**, num ambiente do GitHub com aprovação manual do dono, e a senha dos papéis de serviço | `SUPABASE_DB_URL_PRODUCAO`, `MKT_WORKER_DB_PASSWORD`, `MKT_EXECUTOR_DB_PASSWORD`, `MKT_SETUP_DB_PASSWORD`, `N8N_NOTIFIER_DB_PASSWORD` |
| Depois do push em produção | Só o caso RLS-01 a 03 (sem login), que não precisa de usuário | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| Manual (`workflow_dispatch`), uma vez | O convite do primeiro dono: chama `setup.create_first_owner_invitation` e pede o convite ao Supabase Auth com a `service_role`, num ambiente com aprovação do dono | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MKT_SETUP_DATABASE_URL` |

A senha dos papéis de serviço entra por `alter role … with login password` num passo do CI que lê o segredo e nunca o
imprime. Nada é colado no SQL Editor (decisão 0006). "Mesclar sem aplicar não é mesclar": PR mesclado com migração
que não subiu entra em "Quebrado ou arriscado" no `ESTADO.md`.

Isso vale para o banco do CSP-MKT. O CRM não tem CI de migração: a migração de leitura de lá (o papel
`csp_mkt_reader`, sem login, e as views do esquema `csp_mkt`) é rodada pelo dono no SQL Editor do CRM. O worker não
tem senha no banco do CRM: lê pela API de dados, com um token do papel, que vai direto para o Railway (decisão 0040).

## Seed

| Onde | O que entra | Como |
|---|---|---|
| Produção e teste | Só o que é configuração: listas, `role_permissions`, as duas marcas, os sete conectores e os trabalhos de cada um, feriados, o de-para inicial de origem (só valores genéricos, revistos antes do commit) | Nas próprias migrações |
| Produção | O primeiro dono | O job manual do GitHub (seção acima): cria o convite `owner` com o nome e o e-mail informados na hora e pede o convite ao Supabase Auth; a pessoa define a senha no link (nunca uma senha de exemplo) e cadastra o segundo fator no primeiro acesso |
| Produção | Contas de anúncio (`ad_accounts`), perfis do Instagram (`ig_accounts`) e propriedades GA4 e Search Console (`web_properties`) de cada marca | `scripts/configurar-contas.mjs --executar` e `scripts/configurar-sites.mjs --executar`, com os ids passados na hora, pelas funções `setup.*` com o papel `mkt_setup` (`MKT_SETUP_DATABASE_URL`, lida do `.env` na hora; nunca no Railway). O papel só executa essas funções: o computador de quem configura não tem o banco inteiro |
| Produção | O funil antigo dos leads do site como funil de leads (decisão 0041, item 1), para o histórico encerrado entrar | Depois da primeira passada completa do CSP 360 (antes dela, o funil não lido é recusado com `SET-404`), o script de configuração da fase 4 chama `setup.mark_lead_funnel` com o id do funil no CRM, passado na hora e nunca no repositório, com o papel `mkt_setup` (`MKT_SETUP_DATABASE_URL`). A passada completa seguinte traz os negócios encerrados dele, antes de ler a conversão de setembro e outubro |
| Teste (camada 2) | Usuários de teste (um `owner` com segundo fator, um `traffic_manager`, um sem acesso) e poucas linhas inventadas | `scripts/testar-rls.mjs --executar`, que cria e apaga no fim |
| Testes no `pnpm verify` | Casos pequenos por teste, inventados | `supabase/tests/fixtures/*.sql` |
| Modo demonstração | Os dados de exemplo de hoje | O gerador determinístico de `apps/web/src/data/sample` continua sendo a fonte (datas relativas a hoje, nenhum nome real). Na demonstração, o front sobe o PGlite, aplica o arquivo de apoio e as migrações e grava o que o gerador produz pelas mesmas funções `ingest.*` do worker (decisão 0018). Sem `VITE_SAMPLE_DATA`, abre vazio. "Recomeçar" recria o banco do navegador |

Nenhum seed traz dado real, senha ou chave. O dono de demonstração (`demo-owner`) só existe no PGlite do navegador,
com `aal2` no token de exemplo, para as telas do dono funcionarem.

## O que o dono providencia

- [x] Responder as decisões de produto 0021 (limite de gasto), 0022 (parar tudo), 0023 (quem aprova, com o segundo
  fator), 0024 (erros do conector) e 0025 (representante), e as de número 0026 a 0033 (comparação de "Este mês", custo
  por lead, ROAS, cliente novo por indicador, cliente novo da marca e do grupo, atribuição, custo com origem ou
  representante, Instagram): feito em 03/11/2026, aceitas como recomendadas.
- [ ] Os acessos e contas da seção 19 de [`integracoes.md`](integracoes.md) (contas de anúncio, perfis e propriedades de
  cada marca; aprovação da Meta para a escrita; apps do TikTok; contas de serviço do Google).
- [ ] **Dois projetos Supabase**, produção e teste, na região de São Paulo, com: cadastro aberto desligado; login
  anônimo desligado; só o esquema `api` na lista de esquemas expostos da API; senha com 12 caracteres ou mais e
  proteção contra senha vazada (se o plano tiver); lista de redirecionamento só com o endereço do sistema, sem curinga;
  troca de e-mail confirmada nos dois endereços; MFA (TOTP) ligado, obrigatório para o dono (decisão 0023); a gravação
  do log de auditoria do Auth no banco desligada (o log fica nos registros do projeto) ou, se não der, limpeza de 90
  dias no `pg_cron`; o e-mail de convite em português; o endereço do sistema na configuração do Auth. O CI faz o resto.
- [ ] Projeto de produção no plano pago do Supabase (backup diário automático); no gratuito, um backup diário pelo CI,
  guardado fora do Git e sem hash de senha.
- [ ] Verificação em duas etapas nas contas de Supabase, Vercel, Railway, GitHub, n8n, Meta Business, Google (Cloud,
  Ads, GA4, Search Console) e TikTok for Business.
- [ ] Os segredos do GitHub da tabela acima (só os nomes vão para o `.env.example`) e a volta do CI para
  `.github/workflows/ci.yml`.
- [ ] Os ids das contas de anúncio e das propriedades GA4 e Search Console de cada marca, e o id do funil antigo dos
  leads do site no CRM, para os scripts de configuração (nunca no repositório).
- [ ] No CRM (não trava a criação do banco): aprovar o PR do acesso de leitura, rodar no SQL Editor de lá a migração
  de leitura do CSP-MKT e a conferência do fim do arquivo. Depois da decisão 0040: expor o esquema `csp_mkt` na API só
  para o papel de leitura e emitir o token, colado direto no Railway (`CSP360_API_TOKEN`).
- [ ] Do time do CRM: o que continua aberto em [`integracoes.md`](integracoes.md), seção 19, "Time do CRM" (a lista
  fica só lá).

## No PR da aprovação (fase 3)

Quando o dono aprovar, o mesmo PR que muda o status das decisões ajusta o que deixou de valer fora de `docs/dados/`:

- **Decisões:** 0013 a 0038 passam a "aceita", com a data. Na 0006, o Contexto e a primeira alternativa já foram
  reescritos em 03/11/2026, sem o detalhe de acesso do CRM. No PR, o Status dela vira "aceita; contexto e primeira
  alternativa reescritos em 2026-11-03; trechos substituídos pela 0015", e a consequência da lista de leads ganha
  "também a campanha e a etapa, como o protótipo aprovado em 03/11/2026". Na 0008: "**Status:** aceita; trecho
  substituído pela 0016". Na 0011: "aceita; trecho substituído pela 0018". Na 0001: "aceita; trecho substituído pela 0018 e
  uso de Edge Function ampliado pela 0017". Na 0003: "aceita; complementada pela 0014 e pela 0030". Na 0012: "aceita;
  complementada pela 0030". Na 0005: "aceita; exceções registradas na 0020 (nome digitado no contexto do Claude) e na 0021
  (teto da conta na Meta regravado todo dia 1)".
- **`CLAUDE.md`, "Regras vigentes":** Stack ("o React só chama `api.*`: views e funções, filtradas no banco", 0013 e
  0034; "Edge Functions só onde o banco precisa reagir sem servidor ou onde o Auth exige a chave de serviço (convidar
  e tirar acesso)", 0017); Uma empresa, duas marcas ("exceto lead sem marca", 0014); Dado pessoal mínimo ("a lista de
  leads mostra código, origem, marca, campanha, etapa, data e o link para a ficha 360 no CSP 360", 0006; "nome
  digitado na estratégia ou no nome de campanha é risco residual", 0020); Lead e cliente novo ("cliente novo de uma
  marca = 1º pedido enviado dessa marca, deduplicado por `clientes.id`, e não é novo quem o retrato do ERP mostra
  comprando a marca antes; em "As duas", cliente novo do grupo, o 1º pedido enviado em qualquer marca", 0030);
  Credenciais ("segredo que renova fica no Supabase Vault, apontado por `private.connector_credentials`; segredo que
  não muda fica no Railway; a `service_role` de produção só nos segredos das Edge Functions `convidar` e
  `tirar-acesso` e do job manual do primeiro dono, e a do projeto de teste só no CI; as senhas dos papéis de serviço
  entram pelo CI, dos segredos do GitHub, e cada serviço guarda só a própria conexão (`WORKER_DATABASE_URL` e
  `EXECUTOR_DATABASE_URL` no Railway, a do `n8n_notifier` nas credenciais do n8n); `MKT_SETUP_DATABASE_URL` só no
  `.env` local de quem configura e no segredo do job manual do primeiro dono; leitura no worker,
  escrita só no executor", 0017 e 0036); Ingestão ("nenhum webhook na v1; CSV só de relatório de campanha", 0035 e
  0037); Sistemas com que conversa (tirar "e Lead Ads"). Com a resposta do dono às decisões de produto: A v1 só lê
  ("Nada automático, exceto regravar todo dia 1 o teto da conta na Meta com o limite que o dono aprovou"; "limite de
  gasto por conta e por mês"; "Parar tudo só nas campanhas do Claude", 0021 e 0022); Papéis ("aprovar, mudar limite ou
  operador, gerir usuários e mexer em conector pedem o segundo fator", 0023); Atribuição ("pelo id da campanha antes
  do nome, crédito ao primeiro toque, UTM repetida sem atribuição", 0031).
- **`README.md` do projeto:** linha do CSP 360 sem "e histórico de marketing" (0015); linha da Meta "Lê campanhas,
  gasto e a contagem de leads de formulário, sem a pessoa";
  linha do n8n "Entrega os avisos que o banco enfileira (e-mail e WhatsApp)"; "Dicionário de dados" vira o link para
  `docs/dados/tabelas.md` e `docs/dados/integracoes.md` (seção 3.2: o que é replicado e o que não é), sem segunda
  cópia.

## Mudanças no repositório na fase 4

- `.env.example`: entram `WORKER_DATABASE_URL` e `EXECUTOR_DATABASE_URL` (decisão 0017), `REP_LOGIN_HMAC_KEY`
  ([`integracoes.md`](integracoes.md), seção 2.4), `ANTHROPIC_MODEL`, `MKT_SETUP_DATABASE_URL` (só local) e
  `VITE_CSP360_APP_URL` (endereço da ficha 360, não é segredo); saem `GA4_PROPERTY_ID_*` e `GSC_SITE_*` (vão para
  `web_properties`), `N8N_WEBHOOK_SECRET` e `ALERT_WHATSAPP_GROUP_ID` (sem uso: o n8n busca a fila no banco, e o aviso
  vai para o WhatsApp de cada perfil); `SUPABASE_SERVICE_ROLE_KEY` sai do Railway e fica só nos segredos das Edge
  Functions e do job manual. Os nomes das credenciais de plataforma são revistos em
  [`integracoes.md`](integracoes.md), seção 18 (decisão 0036).
- `packages/shared`: listas com os códigos novos ([`listas.md`](listas.md)); `ROTULO_DA_ACAO`, `RESUMO_DO_PAPEL`,
  `Ga4Channel`, `SiteCheckItem` e os avisos vão para `labels.ts`; `PERMISSOES` e `temDadoPessoal` saem (a tela lê
  `api.my_permissions()` e confere texto com `api.check_text`, decisão 0018); `classificarOrigem`,
  `assistenteDoHost` e as regras de `queries.ts` saem do TypeScript quando a versão SQL passar nos mesmos casos de
  teste.
- `apps/web`: uma fonte de dados única (`data/fonte.ts`) com duas implementações: Supabase (chamadas a `api.*`) e
  PGlite (as mesmas chamadas, no navegador, para o modo demonstração e para os testes de tela).
- `supabase/`: `migrations/`, `tests/` (PGlite e o arquivo de apoio do Supabase, com `test.clock`) e `functions/`
  (`convidar`, `tirar-acesso`).

## Fica para a fase 4

- O resto da migração 11 e a 12: as views e as funções de KPI de [`metricas.md`](metricas.md), com os casos de teste do
  protótipo passados para SQL (seção 9 de lá). A camada 2 inteira roda de novo antes de o front ligar no banco.
  Os casos que voltam inteiros (marcados com `it.todo` em `supabase/tests/casos-de-rls.test.ts` e com `fase4` em
  `scripts/testar-rls.mjs`): RLS-01, 05, 20 e 21 com as `api.kpi_*` (anon negado, o gestor lê números e leads, perfil
  inativo e login sem perfil recebem `PT403`) e RLS-24 com as views novas da 11 e da 12.
- O worker de leitura e o executor em Python de [`integracoes.md`](integracoes.md) (um adaptador por provedor, o
  executor e a rodada do Claude) e o job de CI deles (ruff e pytest).
- A migração 13 (avisos e agenda) e os fluxos do n8n, com o caso RLS-33 (`notify.claim_pending` pula o aviso de quem
  perdeu o acesso ou o papel).
- O login no front, a tela de Usuários ligada às funções e as Edge Functions `convidar` e `tirar-acesso`.
- `gsc_ai_feature_daily`, `ad_creatives`, `crm_marketing_events` e `webhook_inbox`, se uma tela passar a pedir.

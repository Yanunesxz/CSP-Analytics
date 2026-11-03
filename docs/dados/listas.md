# Listas fechadas

> Proposta da fase 3. Cada lista vira um `domain` no esquema `mkt` (decisão 0016): o código em inglês fica no banco,
> o rótulo em português e a cor ficam no `packages/shared/src/labels.ts`. A conta usa o código, nunca o rótulo.

## Como funciona

```sql
-- Um domain por lista: a mesma regra vale em toda coluna que usa a lista.
create domain mkt.campaign_status as text check (value in ('active', 'paused', 'ended'));

-- Mudar a lista é uma migração que troca o check do domain (e o labels.ts no mesmo PR):
alter domain mkt.campaign_status drop constraint campaign_status_check;
alter domain mkt.campaign_status add constraint campaign_status_check
  check (value in ('active', 'paused', 'ended', 'archived'));
```

- **Por que `domain` e não tabela de apoio:** a lista só muda com código (rótulo e cor estão no front), o `check`
  barra o valor errado na entrada e não pede `join`. Tabela fica para o que tem atributo próprio: marcas
  (`brands`) e permissões (`role_permissions`).
- **Uma lista, dois arquivos, um teste:** o `pnpm verify` sobe o banco no PGlite, lê os `check` de cada domain e
  compara com as chaves do `labels.ts` (decisão 0018). Lista diferente nos dois lados reprova o build. O teste lê um
  mapa explícito domain → lista do `labels.ts` (`brand_code` → `brand`, `lead_origin` → `leadSource`,
  `connector_code` → `connectorId`, `ai_source` → `geoSource`; nas outras, o mesmo nome em camelCase, como
  `campaign_status` → `campaignStatus`). Domain que ainda não tem lista no `labels.ts` (as listas novas abaixo e as de
  saída de [`metricas.md`](metricas.md), seção 8) fica na lista `SO_NO_BANCO` do teste, com o motivo; essa lista se
  esvazia na fase 4. As cinco listas que mudam (`order_status`, `ai_source`, `action_status`, `connector_status`,
  `customer_situation`) entram no `labels.ts` e nos tipos de `packages/shared` no mesmo PR da migração 02, com o
  ajuste das consultas do protótipo que dependem delas (`status === 'invoiced'` → `is_invoiced`; `simulated` →
  `not_connected`) e do `labels.test.ts` (o caso das cores de série deixa o `other` de `ai_source` de fora, como já
  deixa o `leadSource`; o caso de `tom` passa a usar `not_connected`).
- **A ordem da lista** não está no `domain` (o texto ordena por letra). Quando uma conta depende da ordem (funil,
  impacto, status, desempate), ela usa `mkt.list_rank` ([`metricas.md`](metricas.md), seção 8), conferida contra o
  `labels.ts` pelo mesmo teste.
- **Dado de fora** é convertido na entrada (worker e funções `ingest.*`): o banco nunca guarda `enviado`, `ACTIVE`
  ou `Organic Search`.
- **Tom** é o do padrão (`success`, `info`, `warning`, `danger`, `muted`). **Série** é a cor de série da decisão 0007,
  só em gráfico, chip e legenda.

## Listas que já estão no `labels.ts`

| Domain | Código → rótulo (tom ou série) | O que muda e por quê |
|---|---|---|
| `mkt.brand_code` | `cs` → Corpo Sensual (série 2) · `plumene` → Plumene (série 6) | Nada. No banco a marca é a tabela `brands`; o domain só valida `brands.code` e `profiles.default_brand` |
| `mkt.platform` | `meta` → Meta Ads (série 4) · `tiktok` → TikTok Ads (série 2) · `google` → Google Ads (série 3) | Nada |
| `mkt.operator` | `human` → Humano (série 4) · `claude` → Claude (série 3) | Nada |
| `mkt.campaign_status` | `active` → Ativa (success) · `paused` → Pausada (warning) · `ended` → Encerrada (muted) | Nada. Conversão: Meta `ACTIVE`/`IN_PROCESS`/`WITH_ISSUES` → active, `PAUSED`/`CAMPAIGN_PAUSED` → paused, `ARCHIVED`/`DELETED` → ended; Google `ENABLED`/`PAUSED`/`REMOVED`; TikTok `ENABLE`/`DISABLE`/`DELETE` |
| `mkt.lead_stage` | `lead` → Lead (muted) · `prospect` → Prospecto (info) · `registered` → Cadastro (info) · `first_order` → 1º pedido enviado (success) · `invoiced` → Faturado (success) | Nada na lista. Muda o lugar: a etapa é calculada em `mkt.v_leads`, não é coluna |
| `mkt.lead_origin` | `meta`, `tiktok`, `google` (como a plataforma) · `site` → Site (série 5) · `organic` → Busca orgânica (série 1) · `ai_assistant` → Assistente de IA (série 6) · `sdr` → SDR · WhatsApp (texto secundário) · `referral` → Indicação (texto) · `direct` → Direto (prata) | Nada na lista. A lista se chama `leadSource` no `labels.ts`; no banco a coluna é `origin` (`source` é o sistema de onde a linha veio, decisão 0016). A classificação sai de `classificarOrigem` (TS) e vai para `mkt.classify_lead_origin` (SQL) |
| `mkt.customer_situation` | `active` → Ativo (success) · `inactive_recent` → Inativo recente (warning) · `inactive_old` → Inativo antigo (warning) · `lost` → Perdido (danger) · `lead` → Lead (muted) · nulo → Sem situação | **Muda a ordem:** a melhor primeiro e `lead` por último, a mesma de `mkt.list_rank('customer_situation', …)`, que escolhe a melhor situação em "As duas"; o `labels.ts` muda junto no PR da migração 02. Passa a ser por marca (`crm_customer_brands`). Conversão do CRM: `ativo`, `inativo-recente`, `inativo-antigo`, `perdido` (régua ou manual), `lead`; "sem base" → nulo |
| `mkt.order_status` | `quote` → Orçamento (muted) · `sent` → Enviado (info) · `cancelled` → Cancelado (danger) | **Muda.** Entram `quote` e `cancelled` (um pedido enviado e depois cancelado tem de sair da conta) e sai `invoiced`: faturado é carimbo (`is_invoiced`, seção 9 do padrão). A etiqueta "Faturado" (success) continua na tela, lida do carimbo. Conversão: `orcamento` → quote, `enviado` → sent, `faturado` → sent + `is_invoiced`, `cancelado` → cancelled |
| `mkt.ig_media_type` | `image` → Imagem · `video` → Vídeo · `carousel` → Carrossel · `reel` → Reel (todos muted) | Nada. Conversão: `IMAGE`, `VIDEO`, `CAROUSEL_ALBUM`; `media_product_type = REELS` → reel |
| `mkt.ai_source` | `chatgpt` → ChatGPT (série 1) · `perplexity` → Perplexity (série 5) · `claude` → Claude (série 3) · `gemini` → Gemini (série 4) · `copilot` → Copilot (série 6) · `other` → Outro assistente (texto secundário) | **Muda.** O nome sai de `geoSource` para `ai_source` (a mesma lista serve ao GA4 e ao `referrer` do lead) e entra `other`, para sessão de IA de assistente fora da lista não sumir do total |
| `mkt.action_kind` | `create` → Criar campanha (info) · `pause` → Pausar (warning) · `budget` → Ajustar orçamento (info) · `bid` → Ajustar lance (info) · `creative` → Trocar criativo (info) · `pending_fix` → Pendência de medição (danger) | Nada |
| `mkt.action_status` | `idea` → Ideia (muted) · `failed` → Falhou (danger) · `approved` → Aprovada (info) · `running` → Em execução (warning) · `done` → Feita (success) · `discarded` → Descartada (danger) | **Muda.** Entra `failed`: a plataforma pode recusar a escrita, e o diário precisa dizer isso. De `failed`, aprovar de novo é "Tentar de novo". A ordem é a da lista do Tráfego (`failed` logo depois de `idea`, porque pede decisão) |
| `mkt.level` | `low` → Baixo (muted) · `medium` → Médio (warning) · `high` → Alto (danger) | Nada |
| `mkt.connector_code` | `meta` → Meta Ads · `instagram` → Instagram · `tiktok` → TikTok Ads · `google_ads` → Google Ads · `ga4` → GA4 · `search_console` → Search Console · `csp360` → CSP 360 (todos muted) | Nada; no `labels.ts` a lista se chama `connectorId`. A ordem dos cartões não é esta: é a do menu (`ORDEM_DOS_CONECTORES`, `mkt.list_rank('connector_menu', …)`) |
| `mkt.connector_status` (saída de `mkt.v_connector_health`) | `ok` → Funcionando (success) · `late` → Atrasado (warning) · `down` → Caído (danger) · `not_connected` → A ligar (muted) · `disabled` → Desligado (muted) | **Muda.** `simulated` → "Simulado" vira `not_connected` → "A ligar": fora do modo demonstração nada é simulado, e o cartão quer dizer "ainda não foi ligado". Entra `disabled` (o padrão pede liga e desliga por canal) |
| `mkt.role` | `owner` → Dono (info) · `traffic_manager` → Gestor de tráfego (info) | Nada |

## Listas novas (vão para o `labels.ts` na fase 4)

### Origem e réplica

| Domain | Código → rótulo (tom) | Por quê |
|---|---|---|
| `mkt.data_source` | `csp360` → CSP 360 · `meta_ads` → Meta Ads · `tiktok_ads` → TikTok Ads · `google_ads` → Google Ads · `instagram` → Instagram · `ga4` → GA4 · `search_console` → Search Console · `csv` → Arquivo CSV | O sistema de onde veio cada linha (`source + external_id`). Só aparece na tela no "Arquivo CSV" de um snapshot |
| `mkt.lead_kind` | `deal` → Negócio do funil de leads · `sdr` → Lead do SDR | O lead vem de duas tabelas do CRM |
| `mkt.crm_customer_status` | `prospect` → Prospecto · `active` → Ativo · `inactive` → Inativo | `clientes.status` do CRM, usado na etapa "Cadastro"; não é a situação da régua |
| `mkt.upstream_trigger` | `cron` → Automática · `manual` → Manual · `script` → Script | `sincronizacoes.disparo` |
| `mkt.rep_crm_role` | `manager` → Gestor · `supervisor` → Supervisor · `internal_seller` → Vendedora interna · `field_rep` → Representante · `relationship` → Relacionamento | Diz se o código `REP-` é de quem recebe o lead no CRM ou do representante do app |
| `mkt.web_property_kind` | `ga4_property` → Propriedade GA4 · `gsc_site` → Propriedade do Search Console | Uma tabela para as duas |

As listas do histórico de marketing do CRM (tipo de evento e fonte) ficam para quando `crm_marketing_events` entrar
([`tabelas.md`](tabelas.md), "Fica fora da v1"): nenhuma conta da v1 usa esse histórico.

### Canais, SEO e GEO

| Domain | Código → rótulo (tom) | Por quê |
|---|---|---|
| `mkt.ga4_channel` (saída de `mkt.v_ga4_channel_daily`) | `organic_search` → Busca orgânica · `ai_assistant` → Assistente de IA · `direct` → Direto · `paid_search` → Busca paga · `paid_social` → Social pago · `organic_social` → Social orgânico · `referral` → Indicação · `other` → Outros | Estava em `queries/seo-geo.ts` (`Ga4Channel`); vai para o shared. Entra `other` para o total de sessões bater com o GA4 (e-mail, vídeo, não atribuído) |
| `mkt.site_check_item` | `robots_txt` → robots.txt · `llms_txt` → llms.txt · `json_ld` → JSON-LD | Estava em `queries/seo-geo.ts` |
| `mkt.site_check_finding` | `found` → Encontrado · `missing` → Não encontrado · `blocks_ai_bots` → Bloqueia robôs de busca de IA · `blocks_ai_training` → Bloqueia só o treino de IA · `invalid` → Com erro · `unreachable` → Site não respondeu | O achado do worker; o estado sai dele. Bloquear só o robô de treino (GPTBot, ClaudeBot, Google-Extended) não tira o site das respostas de IA |
| `mkt.site_check_status` (saída de view) | `ok` → Em ordem (success) · `warning` → Atenção (warning) | Estava em `queries/seo-geo.ts`. `ok` = `found` ou `blocks_ai_training`; o resto é `warning` |

### Tráfego

| Domain | Código → rótulo (tom) | Por quê |
|---|---|---|
| `mkt.discard_reason` | `not_worth_it` → Não compensa o custo · `wrong_numbers` → Números errados · `bad_timing` → Não é o momento · `duplicate` → Repetida · `against_strategy` → Contra a estratégia · `other` → Outro | Desfecho negativo exige motivo de lista fechada (seção 9 do padrão). O texto de 10 letras do protótipo continua, em `discard_note` |
| `mkt.done_via` | `platform_api` → Executada pela central · `manual` → Feita fora da central | Diz se o Claude executou ou alguém marcou como feita |
| `mkt.operator_change_reason` | `imported` → Importada da plataforma · `created_by_claude` → Criada pelo Claude · `handover_to_claude` → Passou para o Claude · `back_to_human` → Voltou para o humano · `correction` → Correção · `other` → Outro (exige nota) | Decisão 0008: trocar o dono é ação registrada, com o porquê |
| `mkt.actor_kind` | `user` → pessoa (mostra o nome) · `claude` → Claude · `system` → Sistema | Quem fez cada passo da trilha; o Claude não é usuário |
| `mkt.run_status` | `running` → Rodando (warning) · `succeeded` → Concluída (success) · `failed` → Falhou (danger) | Rodada do Claude |
| `mkt.stop_scope` | `claude_only` → Só as campanhas do Claude | Decisão 0022 (proposta). Se o dono escolher parar tudo, entra `all_campaigns` → Todas as campanhas |
| `mkt.execution_operation` | `pause` → Pausar · `activate` → Reativar · `set_daily_budget` → Mudar orçamento diário · `create_campaign` → Criar campanha · `set_account_spend_cap` → Gravar limite na conta | Cada chamada de escrita numa plataforma. Lance e criativo não executam pela central na v1 (a tela diz "Faça na plataforma e marque como feita"); `set_bid` e `swap_creative` entram na fase que os executar |
| `mkt.execution_status` | `queued` → Na fila (muted) · `blocked` → Bloqueada (warning) · `sent` → Enviada (info) · `confirmed` → Confirmada (success) · `failed` → Falhou (danger) · `cancelled` → Cancelada (muted) | Andamento da escrita; "Bloqueada" diz o que fazer na plataforma; "Cancelada" quando a ação foi descartada ou feita à mão antes de a central executar (decisão 0038) |
| `mkt.execution_block_reason` | `no_write_credential` → Sem credencial de escrita · `no_spend_limit` → Conta sem limite de gasto · `over_spend_limit` → Passa do limite do mês · `stopped` → Parada pelo Parar tudo · `approval_invalid` → Aprovação não confere · `campaign_ended` → Campanha encerrada · `connector_disabled` → Conector desligado | Por que a central não executou ([`integracoes.md`](integracoes.md), seção 14) |
| `mkt.traffic_event` | `action_proposed` → Proposta · `action_approved` → Aprovada por … · `action_running` → Em execução · `action_done` → Feita · `action_failed` → Falhou · `action_discarded` → Descartada por … · `stop_all` → Parou tudo do Claude · `stop_undone` → Desfez a parada · `limit_changed` → Limite de gasto mudou · `strategy_saved` → Estratégia atualizada · `operator_changed` → Operador da campanha mudou · `execution_retried` → Execução pedida de novo · `execution_status_changed` → Execução mudou de situação | Os eventos do diário do protótipo, em inglês, mais `action_failed`, `operator_changed`, `execution_retried` ("Tentar de novo" numa execução bloqueada) e `execution_status_changed` (o histórico de status de cada execução, por gatilho) |

### Conectores, usuários e avisos

| Domain | Código → rótulo (tom) | Por quê |
|---|---|---|
| `mkt.connector_setup_state` | `connected` → Ligado · `not_connected` → A ligar · `disabled` → Desligado | O que o dono configurou; o estado da tela é calculado |
| `mkt.sync_job` | `crm_incremental` → Leitura do CRM · `crm_full_pass` → Passada completa · `ads_hourly` e `ig_hourly` → Leitura de hora em hora · `ads_backfill` e `ig_daily` → Releitura · `ads_activity` → Alterações nas contas · `ga4_daily` e `gsc_daily` → Leitura diária · `csv_import` → Arquivo CSV | Os trabalhos de cada conector ([`integracoes.md`](integracoes.md), seção 2.1); o cartão diz qual atrasou |
| `mkt.sync_trigger` | `schedule` → Agendada · `manual_retry` → Tentar de novo · `backfill` → Releitura · `csv_upload` → Arquivo CSV | Como a rodada começou |
| `mkt.sync_status` | `requested` → Pedida (muted) · `running` → Rodando (info) · `succeeded` → Deu certo (success) · `partial` → Em parte (warning) · `failed` → Falhou (danger) | Andamento da rodada |
| `mkt.credential_purpose` | `read` → Leitura · `write` → Escrita | Decisão 0005: sempre separadas |
| `mkt.credential_status` | `valid` → Válida (success) · `expiring` → Vence logo (warning) · `invalid` → Recusada (danger) · `revoked` → Revogada (muted) | O cartão do conector avisa antes de vencer |
| `mkt.app_action` | ver quadro abaixo | As ações do `rules.ts`, em inglês |
| `mkt.theme_preference` | `device` → Aparelho · `light` → Claro · `dark` → Escuro | No `localStorage` o tema é `''`, `light` ou `dark`; no perfil, `device` no lugar do vazio |
| `mkt.view_mode` | `viewer` → Visualizador · `manager` → Gestor de tráfego | A visão padrão no perfil; na URL continua `?visao=visualizador` ou `?visao=gestor` |
| `mkt.notice_kind` | `connector_down` → Conector parado · `spend_near_limit` → Gasto perto do limite · `cost_per_lead_high` → Custo por lead acima do limite · `proposal_to_approve` → Proposta do Claude para aprovar · `weekly_report` → Relatório da semana · `credential_expiring` → Credencial vence logo (urgente; só para quem tem `retry_connector`) · `stop_not_confirmed` → Parar tudo sem confirmação (urgente; só para quem tem `stop_all`) · `mass_delete_blocked` → Exclusão em massa segurada (urgente; só para quem tem `retry_connector`) | Os ids de `avisos.ts` estavam em português (`conector_parado`…); viram código em inglês. Os três últimos são novos: token que vence (o README do projeto promete), pausa do Parar tudo que não saiu em 2 min, e a trava de 20% da réplica em 3 passadas seguidas |
| `mkt.notice_channel` | `email` → E-mail · `whatsapp` → WhatsApp | Igual a `avisos.ts` |
| `mkt.outbox_status` | `pending` → Na fila · `sent` → Enviado · `failed` → Falhou · `skipped` → Não enviado (a pessoa desligou) | Fila de avisos |
| `mkt.saved_filter_scope` | `bar` → Barra de filtros · `traffic_list` → Lista do Tráfego | Os dois "Meus filtros" do protótipo |
| `mkt.audit_event` | `first_owner_created` · `invite_sent` · `invite_revoked` · `role_changed` · `access_revoked` · `connector_state_changed` · `connector_retry_requested` · `mass_delete_confirmed` · `credential_status_changed` | Eventos de auditoria (rótulos na fase 4, quando houver tela) |
| `mkt.deactivation_reason` | `left_company` → Saiu da empresa · `role_changed` → Mudou de função · `security` → Segurança · `other` → Outro (exige nota) | Tirar o acesso é desfecho negativo: motivo de lista fechada (seção 9 do padrão) |

### Permissões (`mkt.app_action`)

As ações do `rules.ts` estavam em português (`ver_numeros`…). Viram código em inglês no banco. O mapa `PERMISSOES` do
`rules.ts` sai na fase 4: a tela lê as permissões do usuário em `api.my_permissions()`, e `role_permissions` fica a
única lista (decisão 0018). O rótulo de `ROTULO_DA_ACAO` vai para o `labels.ts`. Entra uma ação nova,
`configure_traffic`. As marcadas com ² pedem o segundo fator (TOTP) do login (decisão 0023).

| Hoje (`rules.ts`) | Código novo | Rótulo | `owner` | `traffic_manager` |
|---|---|---|---|---|
| `ver_numeros` | `view_numbers` | Ver os números de marketing | sim | sim |
| `ver_leads` | `view_leads` | Ver a lista de leads, sem dado pessoal | sim | sim |
| `ver_lead_dado_pessoal` | `view_lead_personal_data` | Ver nome, telefone e e-mail de lead | **ninguém** | **ninguém** |
| `ver_trafego_ia` | `view_traffic` | Abrir o Tráfego com IA | sim | sim |
| `operar_trafego_ia` | `operate_traffic` | Operar o Tráfego com IA (propor, estratégia, marcar como feita) | sim | sim |
| `aprovar_acao` | `approve_action` ² | Aprovar ou descartar ações | sim | não (decisão 0023, proposta) |
| `parar_tudo` | `stop_all` | Parar e reativar as campanhas do Claude | sim | não |
| — | `configure_traffic` ² | Mudar limites de gasto e o operador das campanhas | sim | não |
| `ver_conectores` | `view_connectors` | Ver os conectores | sim | sim |
| `tentar_conector_de_novo` | `retry_connector` ² | Tentar um conector de novo, ligar e desligar, enviar CSV, confirmar exclusão em massa | sim | não |
| `gerir_usuarios` | `manage_users` ² | Convidar pessoas, definir papéis e tirar acesso | sim | não |
| `ver_diagnostico` | `view_diagnostics` | Abrir o Diagnóstico | sim | não |
| `editar_configuracoes` | `edit_settings` | Mudar tema, marca padrão, avisos e meus filtros | sim | sim |

`configure_traffic` existe porque "Mudar limite" usava `aprovar_acao` sem ação própria (`trafego-ia.md`) e a troca
de operador (decisão 0008) não tinha dono.

## Listas que ficam só no front

Não são dado do banco; continuam no código da tela: visão na URL, estado de demonstração (`?estado=`), aba do
Tráfego, formato da linha Humano × Claude. As listas que só existem na saída de uma conta (faixa de dias sem comprar,
buscador do lead, situação do gasto, situação da meta, alerta de limite, motivo de "Não se aplica", situação geral dos
conectores, recorte da Base, linhas de Humano × Claude, sentido da comparação, status da atribuição do lead, alerta
da ação da fila) são `domain` definidos com as funções, em
[`metricas.md`](metricas.md), seção 8.

O período deixou de ser só do front: o banco calcula o intervalo e o anterior (decisões 0026 e 0034), e a lista de
entrada é `mkt.period_code` (`this_month`, `last_month`, `last_7_days`, `last_30_days`, `last_90_days`). A URL continua
com `este-mes`, `mes-passado`, `7d`, `30d` e `90d`, e a tela traduz numa função só ([`metricas.md`](metricas.md), seção
1.1).

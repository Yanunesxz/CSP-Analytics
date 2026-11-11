# 0015 — Réplica do CRM: tabelas `crm_*`, leitura e exclusão

- **Data:** 2026-11-03
- **Status:** aceita em 2026-11-03 (técnica; substitui na 0006 a leitura de `historico_marketing`, a passada completa só em clientes e a chave de junção por documento)

## Contexto

A decisão 0006 define a réplica mínima do CSP 360. O levantamento do CRM mostrou: carimbo de alteração que nem
sempre muda; status e situação em português; "faturado" guardado como status; sem data de envio nem de faturado;
situação do cliente calculada na leitura, por marca; UTM do primeiro contato em campos personalizados do cliente;
responsável do negócio guardado pelo nome; e linha apagada que a leitura incremental não vê.

## Decisão

- Tabelas `crm_customers`, `crm_customer_brands`, `crm_customer_reps`, `crm_leads`, `crm_orders`, `crm_funnels`,
  `crm_origin_map` e `crm_upstream_runs` no esquema `mkt`, com `source = 'csp360'` e `external_id` = o id no CRM. Só
  as colunas de `docs/dados/tabelas.md`; o documento do cliente não vem, porque a junção já é `clientes.id`. O
  histórico de marketing (`historico_marketing`) não é replicado na v1: nenhuma conta usa.
- A leitura passa por views num esquema só do CSP-MKT no banco do CRM, com só as colunas pedidas; o papel
  `csp_mkt_reader` não executa função nenhuma (`docs/dados/integracoes.md`, seção 3).
- Leitura a cada 5 min pelo carimbo de cada tabela, com 15 min de folga e páginas de 1.000 por `id`, **mais uma
  passada completa por dia em todas as tabelas** (não só em clientes), porque o carimbo não é confiável. As rodadas
  apps → CRM ficam fora: a leitura traz só as últimas de cada marca.
- A passada completa **apaga** a linha que sumiu do CRM, sem cópia em `jsonb`. É exceção à regra do padrão de copiar
  antes de excluir: o CSP-MKT não é o dono do dado, e a cópia guardaria o que o titular pediu para apagar. O
  `sync_runs` registra só quantas linhas saíram. A trava de exclusão em massa (mais de 20% de uma tabela) fica no banco,
  em `ingest.delete_missing`, e o dono confirma pela central quando a limpeza é de verdade.
- Texto que a equipe digita no CRM não é copiado: a origem do negócio só entra quando é um valor conhecido, e a UTM
  entra limpa (até 150 letras, sem `@` nem dado pessoal).
- Na entrada: `orcamento` → `quote`, `enviado` → `sent`, `faturado` → `sent` com `is_invoiced = true`, `cancelado` →
  `cancelled`; valor do pedido = soma dos itens em centavos, calculada em decimal, até o CRM trazer o total; situação
  por marca lida da view do CRM, nunca recalculada; representante como código `REP-` do CSP-MKT.
- A etapa do lead, o 1º pedido e a origem classificada não são gravados: são derivados em SQL (`mkt.v_leads`).
- O funil de leads é um só, marcado em `crm_funnels.is_lead_funnel` por migração, quando o time do CRM decidir. A
  leitura traz os negócios de todos os funis; o banco grava os do funil de leads e os que já são leads aqui.
- Antes da primeira leitura de cada rodada, o worker confere as colunas no `information_schema` do CRM; se faltar
  alguma, a rodada falha com `SCHEMA_DRIFT` e o cartão do CSP 360 fica "Caído", sem gravar nada pela metade.

## Alternativas consideradas

- **Cópia antes de excluir, ou exclusão lógica:** contraria o pedido de exclusão do titular (LGPD) num sistema que
  não é o dono do dado.
- **Passada completa só em clientes (como a 0006 diz):** pedido cancelado e negócio apagado continuariam contados.
- **Gravar a etapa do lead:** seria regra no worker, contra a decisão 0001.

## Consequências

- O que o CRM passar a gravar (Parte 4 do prompt) preenche colunas que já existem: `invoiced_at`, `sent_at`, UTM e
  `referrer_host` por lead, `assigned_rep_id`.
- O que sai do CRM sai daqui em até 24 h, dentro do prazo de 15 dias do padrão, com a passada completa em dia: o
  cartão do CSP 360 avisa quando ela atrasa (`connector_jobs`).
- A passada completa diária custa uma leitura inteira das tabelas do CRM por dia, paginada.
- Em 10/11/2026: o código do CRM foi lido (nada foi lido do banco) e a decisão 0041 ajusta esta ao CRM como ele é. O
  funil de leads deixa de ser um só, marcado por migração: é o funil padrão do CRM e o funil antigo dos leads do site,
  e negócio sem funil conta como do padrão. A leitura de 5 min deixa de ser pelo carimbo com 15 min de folga e passa a
  ser por janela de 3 dias, porque a tela do CRM grava o carimbo do negócio só com o dia; a passada completa diária
  continua. A leitura é pela API de dados (decisão 0040): o worker confere as colunas pedindo cada view com a lista
  de colunas, e não no `information_schema`, e `SCHEMA_DRIFT` vale para as 12 views que existem.
- Em 10/11/2026: o que não chega fica "Sem dados" (decisão 0041, item 6). A view de situação não existe no CRM: em
  `crm_customer_brands` a situação fica nula e `is_lost_manual` aceita nulo. O retrato do ERP por marca vem sem a
  primeira compra (decisão 0042). `assigned_rep_id` já vem em parte: o CRM guarda o responsável pelo nome, e a leitura
  devolve o id só quando o nome é de uma pessoa só (decisão 0025). A UTM e o `referrer` por lead continuam sem existir
  no CRM: `utm_*` e `referrer_host` de `crm_leads` ficam nulos, e vale a UTM de primeiro contato do cliente (decisão
  0031). A origem e a UTM já chegam limpas da view do CRM; o teste daqui continua, como segunda barreira.

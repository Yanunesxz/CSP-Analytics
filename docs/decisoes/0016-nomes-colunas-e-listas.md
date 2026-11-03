# 0016 — Nomes, colunas e listas fechadas no banco

- **Data:** 2026-11-03
- **Status:** aceita em 2026-11-03 (técnica; substitui na 0008 o nome `campaigns_managed_by_history`)

## Contexto

O padrão manda inglês, `snake_case`, `_cents`, `_at`, `_on`, `id` uuid, `source + external_id` e listas fechadas,
mas não diz como guardar a lista no banco. O protótipo usa ids em texto, `date` para o dia, `source` para a origem
comercial do lead e códigos de permissão em português. A palavra `source` tem dois sentidos no padrão (sistema de
origem e origem comercial).

## Decisão

- **Três palavras, três sentidos:** `source` é o sistema de onde a linha veio (`csp360`, `meta_ads`, `csv`…);
  `origin` é a origem comercial do lead (`meta`, `organic`, `sdr`…); `platform` é a plataforma de mídia paga.
- Datas de fora levam `source_` (`source_created_at`), para não confundir com o `created_at` da linha. Só data usa
  `_on` (`metric_on`, `month_on`, `checked_on`). Contagem em `bigint` sem sufixo (`impressions`); `_qty` fica para
  quantidade de item.
- `id uuid` em toda tabela, inclusive na réplica; `profiles.id` é o id do login.
- Cada lista fechada é um `domain` com `check`, com o código em inglês; rótulo e cor ficam no `labels.ts`. Um teste
  no `pnpm verify` compara os dois lados. As permissões passam a código em inglês (`view_numbers`…) no banco, e entra
  `configure_traffic`; o mapa `PERMISSOES` do `rules.ts` sai na fase 4 (decisão 0018).
- Idempotência: `unique (source, external_id)` em tudo que vem de fora com id próprio; nos snapshots, a chave natural
  (`campaign_id, metric_on`). O CSV grava nas mesmas tabelas com `source = 'csv'`; a API regrava o CSV, nunca o
  contrário.
- Chave estrangeira composta (`id, brand_id`, e `platform` quando há) garante que a filha tem a marca do pai.
- O dia é o de São Paulo, menos o que a plataforma entrega por dia: contas de anúncio precisam estar em
  `America/Sao_Paulo` (o worker guarda o fuso e a tela avisa se não estiver); Search Console e Instagram usam o dia do
  Pacífico, com aviso na tela.
- `campaign_managed_by_history` no singular, como o `order_status_history` do padrão (a 0008 escreveu no plural).
- Instante sempre com `_at` (`watermark_from_at`, `send_after_at`); sim ou não sempre com `is_` ou `has_`
  (`is_lead_funnel`, `is_email_enabled`).
- `code` é o código humano `PREFIXO-0001`. Em `brands` e `connectors`, `code` é a chave curta (o valor de `?marca=` e o
  id do conector): exceção registrada aqui.

## Alternativas consideradas

- **`check` repetido em cada coluna:** a mesma lista em vários lugares do banco.
- **Tabela de apoio por lista:** o rótulo já mora no `labels.ts`; seria um `join` a mais em toda consulta sem ganho.
- **`enum` do Postgres:** não deixa tirar valor da lista e complica a migração.

## Consequências

- Na fase 4, `labels.ts`, `rules.ts`, `types.ts` e os dados de exemplo mudam de nome junto com o banco (lista em
  `docs/dados/listas.md` e no README de `docs/dados/`).
- Mudar uma lista é uma migração que troca o `check` do domain e o `labels.ts` no mesmo PR.

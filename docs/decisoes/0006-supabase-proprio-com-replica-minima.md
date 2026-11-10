# 0006 — Dados em projeto Supabase próprio, com réplica mínima do CRM

- **Data:** 2026-10-30
- **Status:** aceita (contexto e primeira alternativa reescritos em 2026-11-03 para tirar o detalhe de acesso do CRM, sem mudar a decisão; trechos substituídos pela 0015)

## Contexto

O CRM (CSP 360) é outro sistema, com outro time, outro projeto Supabase e as próprias regras de acesso. O CSP-MKT precisa de views de KPI, RLS por papel e tabelas próprias de marketing, e não pode ter dado pessoal além do mínimo.

## Decisão

Projeto Supabase próprio do CSP-MKT. O worker mantém uma réplica mínima do CRM: incremental por `atualizado_em` em `pedidos`, `negocios` e `leads_sdr`, por `registrado_em` em `historico_marketing`, e passada completa diária em `clientes` (que só tem `criado_em`); paginando de 1.000 em 1.000; marca d'água e diário em `sync_runs`. A réplica traz só id, marca, datas, status/situação, origem/UTM, representante (id) e a chave de junção (`document` só dígitos, ou hash dela) — nunca nome, telefone ou e-mail. O worker usa uma credencial de leitura criada no CRM só para o CSP-MKT (papel Postgres só-leitura nas tabelas necessárias), nunca a chave de serviço do CRM. Sem leitura direta dos Supabase dos apps. Migrações só em `supabase/migrations/AAAAMMDDHHMMSS_o_que_faz.sql`, idempotentes, aplicadas por CI, nunca no SQL Editor. RLS em toda tabela por `profiles.role`, testada pela API com um usuário de cada papel (portão da fase 3).

Latência: leads a cada 5 min pela réplica (quase tempo real exige o CRM avisar o CSP-MKT, mudança no sistema do outro time); métricas de mídia e Instagram de hora em hora; SEO, GEO e GA4 uma vez por dia; "atualizado há X min" em toda tela.

## Alternativas consideradas

- **Mesmo projeto do CRM:** rejeitada — misturaria as regras de acesso dos dois sistemas, colocaria tabelas de marketing no banco de produção do CRM e faria o login do gestor de tráfego depender de regra nova no CRM.
- **Projeto próprio lendo o CRM ao vivo por Edge Function:** rejeitada — o CRM não tem RPC nem view e devolve 1.000 linhas por chamada; toda tela dependeria da latência do outro sistema.

## Consequências

- Pedir ao time do CRM a credencial só-leitura e, para a situação do cliente, uma view ou RPC (o CSP-MKT não recalcula a régua).
- Um dicionário de dados no README com o que é replicado e o que não é.
- A lista de leads mostra código, origem, marca, campanha, etapa, data e o link para a ficha 360 no CSP 360 (campanha e etapa como o protótipo aprovado em 03/11/2026).
- Em 10/11/2026: o worker passa a ler o CRM pela API de dados, com um token do papel de leitura, sem login no banco (decisão 0040). O papel `csp_mkt_reader` e as views do esquema `csp_mkt` estão na migração de leitura do CRM, que o dono roda no SQL Editor de lá; a regra "nunca no SQL Editor" vale para o banco do CSP-MKT. A leitura de 5 min passa a ser por janela de 3 dias, e a view de situação do cliente não existe: a situação fica "Sem dados" e o CSP-MKT continua sem recalcular a régua (decisão 0041).

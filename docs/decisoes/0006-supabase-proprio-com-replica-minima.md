# 0006 — Dados em projeto Supabase próprio, com réplica mínima do CRM

- **Data:** 2026-10-30
- **Status:** aceita

## Contexto

O CRM (CSP 360) tem um projeto Supabase só, sem views nem RPC, com uma política única para usuários logados (lê e grava tudo) e migrações aplicadas à mão. O CSP-MKT precisa de views de KPI, RLS por papel e tabelas próprias de marketing, e não pode ter dado pessoal além do mínimo.

## Decisão

Projeto Supabase próprio do CSP-MKT. O worker mantém uma réplica mínima do CRM: incremental por `atualizado_em` em `pedidos`, `negocios` e `leads_sdr`, por `registrado_em` em `historico_marketing`, e passada completa diária em `clientes` (que só tem `criado_em`); paginando de 1.000 em 1.000; marca d'água e diário em `sync_runs`. A réplica traz só id, marca, datas, status/situação, origem/UTM, representante (id) e a chave de junção (`document` só dígitos, ou hash dela) — nunca nome, telefone ou e-mail. O worker usa uma credencial de leitura criada no CRM só para o CSP-MKT (papel Postgres só-leitura nas tabelas necessárias), nunca a chave de serviço do CRM. Sem leitura direta dos Supabase dos apps. Migrações só em `supabase/migrations/AAAAMMDDHHMMSS_o_que_faz.sql`, idempotentes, aplicadas por CI, nunca no SQL Editor. RLS em toda tabela por `profiles.role`, testada pela API com um usuário de cada papel (portão da fase 3).

Latência: leads a cada 5 min pela réplica (quase tempo real exige o CRM avisar o CSP-MKT, mudança no sistema do outro time); métricas de mídia e Instagram de hora em hora; SEO, GEO e GA4 uma vez por dia; "atualizado há X min" em toda tela.

## Alternativas consideradas

- **Mesmo projeto do CRM:** rejeitada — herdaria "logado = acesso a tudo", colocaria tabelas de marketing no banco de produção do CRM por migração manual e impediria o login do gestor de tráfego sem RLS nova no CRM.
- **Projeto próprio lendo o CRM ao vivo por Edge Function:** rejeitada — o CRM não tem RPC nem view e devolve 1.000 linhas por chamada; toda tela dependeria da latência do outro sistema.

## Consequências

- Pedir ao time do CRM a credencial só-leitura e, para a situação do cliente, uma view ou RPC (o CSP-MKT não recalcula a régua).
- Um dicionário de dados no README com o que é replicado e o que não é.
- A lista de leads mostra código, origem, marca, data e o link para a ficha 360 no CSP 360.

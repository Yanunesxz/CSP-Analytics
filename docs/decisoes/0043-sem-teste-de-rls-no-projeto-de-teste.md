# 0043 — Sem teste de RLS no projeto de teste

- **Data:** 2026-11-23
- **Status:** aceita em 2026-11-23 (decisão do dono: "nao quero fazer testa rls", "pode tirar")

## Contexto

O portão da fase 3 pedia a camada 2 do teste de RLS: o CI recria um projeto Supabase de teste, aplica as migrações,
cria usuários `owner`, `traffic_manager` e sem login e tenta ler e gravar o que não devia. O projeto de teste e os 8
segredos `*_TESTE` não existem no `CSP-Analytics`, e o dono não quer mantê-los.

## Decisão

O job `rls-teste` do CI fica desligado (só roda com a variável do repositório `RLS_TESTE = ligado`). O portão da fase 3
fecha sem a camada 2. Continuam valendo:

- a camada 1, no PGlite, em todo PR (`pnpm verify`): políticas, grants, lista permitida de funções e casos de RLS no SQL;
- em produção, depois de cada migração aplicada pelo job `producao`, os casos sem login (RLS-01 a 03);
- o job `producao` só roda com a aprovação do dono no ambiente `producao`.

## Consequências

- O que só a API real mostra fica sem prova automática: o login com segundo fator (TOTP), o JWT com o papel, o
  PostgREST e a "Data API" expondo só o `api`, e os papéis de serviço conectando com a própria senha.
- Um erro de RLS que o PGlite não reproduz chega a produção. Antes de convidar o `traffic_manager`, vale conferir à mão,
  logado com ele, que a lista de leads e as ações de aprovação são negadas.
- Para religar: criar o projeto de teste no plano grátis (ele pausa depois de 7 dias sem uso), os 8 segredos `*_TESTE` em
  Repository secrets e a variável `RLS_TESTE = ligado`.

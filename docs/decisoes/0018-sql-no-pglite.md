# 0018 — O SQL roda no PGlite nos testes e no modo demonstração

- **Data:** 2026-11-03
- **Status:** proposta (técnica, aguarda a aprovação do modelo; substitui na 0011 a regra de permissão em `packages/shared`, que passa a ser `role_permissions`, no banco, e na 0001 as permissões e a regra de dado pessoal em `packages/shared`)

## Contexto

Toda fórmula de KPI vive em SQL (decisão 0001), toda regra pura tem teste em Vitest e nenhuma regra roda em dois
lugares. Hoje as regras estão em `apps/web/src/data/queries.ts` (TypeScript), que também alimenta o modo
demonstração, que funciona sem banco. O portão da fase 3 pede RLS testada, e esta máquina não tem Supabase CLI nem
Docker.

## Decisão

- Entra o PGlite (`@electric-sql/pglite`, o Postgres compilado para WebAssembly), com versão fixa, como dependência de
  desenvolvimento e do modo demonstração.
- `supabase/tests` (Vitest) sobe o PGlite dentro do `pnpm verify`, aplica um arquivo de apoio que imita o Supabase
  (papéis `anon`, `authenticated`, `service_role`, `authenticator`, `mkt_worker`, `mkt_executor`, `mkt_setup`,
  `n8n_notifier`; `auth.uid()` lendo o token; esboços de `vault` e `cron`; e `test.clock`, o relógio dos testes) e
  depois **as mesmas migrações** de `supabase/migrations/`. Ali rodam: a camada 1 do teste de RLS, os casos de KPI de
  hoje (passados de `queries.test.ts` para SQL) e o teste de paridade dos domains com o `labels.ts`.
- **Permissão e dado pessoal também saem do TypeScript:** a tela lê as permissões em `api.my_permissions()` (de
  `role_permissions`) e confere texto livre em `api.check_text(p_text)`, que usa `mkt.has_personal_data`, no Supabase e
  no PGlite. `PERMISSOES` e `temDadoPessoal` saem do `packages/shared`. As conferências de uma proposta moram em
  `private.validate_action`, que `api.propose_action` e `ingest.add_claude_proposal` chamam.
- O modo demonstração carrega o PGlite no navegador só quando não há Supabase configurado, aplica as migrações e grava
  os dados do gerador de exemplo pelas funções `ingest.*`. O front fala com uma fonte só (`data/fonte.ts`): Supabase em
  produção, PGlite na demonstração, com as mesmas chamadas a `api.*`.
- As regras em TypeScript (`queries.ts`, `classificarOrigem`) saem quando a versão SQL passar nos mesmos casos.
- O portão continua sendo a camada 2: o teste pela API num projeto Supabase de teste.

## Alternativas consideradas

- **TypeScript na demonstração e SQL em produção, com teste de paridade:** duas implementações de cada número, e o
  teste de paridade ficaria do tamanho do código.
- **Supabase CLI com Docker local:** não existe nesta máquina e pesa para quem abrir o projeto.
- **Testar só no projeto de teste remoto:** todo PR dependeria de internet e de segredos, e cada rodada seria lenta.

## Consequências

- Uma dependência nova. O primeiro carregamento do modo demonstração fica mais pesado (alguns MB de WebAssembly), só
  nele; o pacote de produção não leva o PGlite.
- O SQL das migrações fica no que o Postgres do PGlite e o do Supabase têm em comum; o que é só do Supabase entra no
  arquivo de apoio.
- Conferir na fase 4, com um caso-sentinela, que o PGlite aplica RLS depois de `set role`; se não aplicar, a camada 1
  fica com funções, restrições e gatilhos, e a RLS inteira vai para a camada 2.

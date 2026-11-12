# 0013 — Esquemas do banco e o que a API expõe

- **Data:** 2026-11-03
- **Status:** aceita em 2026-11-03 (técnica)

## Contexto

O React só lê views e nunca soma linhas (decisão 0001), toda tabela tem RLS por papel (decisões 0006 e 0011) e a
tela trabalha com filtros que uma view não recebe (marca, período, canal, campanha, operador, origem,
representante; "As duas" conta cada cliente uma vez). O Supabase expõe o esquema `public` inteiro pela API, e uma
view comum roda com os direitos de quem a criou, pulando a RLS das tabelas.

## Decisão

- As tabelas ficam no esquema `mkt`, que **não** é exposto pela API. O único esquema exposto é `api`.
- `api` tem três coisas: views de leitura com `security_invoker = true` e `security_barrier = true`; funções de KPI
  `api.kpi_*` (`security invoker`, `stable`), que recebem os filtros como parâmetros; e funções de ação
  (`security definer`, `search_path` vazio), que conferem a permissão em `role_permissions`, aplicam a trava otimista e
  gravam a trilha.
- `authenticated` lê as tabelas de `mkt` só através de `api` e da RLS, e não tem `insert`, `update` nem `delete` em
  tabela nenhuma: toda escrita da tela passa por função. `anon` não tem acesso a nenhum esquema.
- O worker de leitura e o executor gravam pelas funções do esquema `ingest`, cada um só as suas; o n8n executa só três
  funções de `notify`; as funções que as políticas chamam ficam em `authz` (assim `authenticated` não alcança
  `private`); gatilhos, filas e credenciais ficam em `private`; o cadastro dos scripts de configuração, em `setup`.
- Nenhuma função nasce executável por `PUBLIC`: a migração 01 tira esse padrão do Postgres antes de criar qualquer
  função, e cada função recebe `grant` só do papel que a usa. Toda função `security definer`, de qualquer esquema,
  tem `search_path` vazio e nomes qualificados.
- O GraphQL do Supabase fica desligado.
- Erros das funções voltam com o código HTTP no `sqlstate` (`PT403`, `PT404`, `PT409`, `PT422`) e o código da tela na
  mensagem (`TRF-409`), nunca o texto técnico.

## Alternativas consideradas

- **Tudo em `public` com RLS:** é o caminho padrão do Supabase, mas deixa cada tabela consultável pela API com
  qualquer filtro, e a regra "o React só lê views" passa a depender de disciplina, não do banco.
- **Só views, sem funções:** view não recebe parâmetro; "As duas" sem somar as marcas e os filtros de lead não cabem.
- **Escrita por Edge Function:** um servidor a mais para o que uma função SQL faz numa transação só, com a trilha
  junto; a decisão 0001 deixa Edge Function só para o que o banco não resolve sozinho.

## Consequências

- O front chama `api.*` e nada mais; número novo na tela é função nova em `api`, com teste.
- O projeto Supabase precisa de "esquemas expostos = `api`" na configuração da API (está no plano).
- O teste de RLS confere `security_invoker` em toda view de `api`, que nenhuma tabela de `mkt` responde pela API e,
  no catálogo, quem pode executar cada função (`docs/dados/papeis-e-rls.md`, RLS-27).
- Em 11/11/2026: o "`search_path` vazio" acima passa a ser `set search_path = pg_catalog, pg_temp`, em toda função dos
  sete esquemas (definer ou invoker). Com o caminho vazio, o esquema temporário da sessão é procurado primeiro para
  tipos e tabelas, e um serviço com conexão própria rodava código como o dono das funções (revisão de 10/11/2026). O
  RLS-27 confere o caminho de cada função e, como cada serviço, que um tipo trocado no `pg_temp` não roda como o dono.

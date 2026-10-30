# 0001 — Stack e monorepo, com worker em Python como exceção

- **Data:** 2026-10-30
- **Status:** aceita

## Contexto

O padrão Yan Nunes (decisão 0004 do SystemDesing) fixa React + Vite + TypeScript + Tailwind 4 + Supabase, n8n para automação simples (até ~15 nós) e Node + TypeScript + Fastify para integração pesada; Python fica permitido só para script isolado de dados ou IA, com registro. O dono pediu "React para desempenho e Python para automações", além de Supabase, Railway, Vercel e n8n. O CSP-MKT precisa de conectores permanentes para seis APIs (Meta, TikTok, Google Ads, Instagram, GA4, Search Console), de uma réplica do CRM e de um operador que chama a Claude API — trabalho de servidor, não script isolado.

## Decisão

Monorepo pnpm com `apps/web` (React 18 + Vite + TypeScript strict + Tailwind 4 + lucide-react + Vitest, publicado na Vercel só pela `main`), `apps/worker` (**Python** no Railway: conectores, réplica do CRM, gravação dos snapshots e o operador de tráfego que chama a Claude API), `packages/shared` (listas fechadas, rótulos, permissões e regras usadas pelo front e pelo banco, com teste) e `supabase/` (migrações e Edge Functions). n8n só para gatilhos externos e avisos que cabem em até ~15 nós; Edge Functions só onde o banco do CSP-MKT precisar reagir sem servidor. Nenhuma regra roda em dois lugares e nenhuma fórmula de KPI vive no worker nem no React: toda métrica derivada é view ou função SQL no Postgres.

Nome do repositório: produto Yan Nunes → `yn-csp-mkt` pela regra de `docs/05` do padrão. Até o dono renomear o repositório no GitHub, `CSP-MKT` fica como exceção registrada aqui.

## Alternativas consideradas

- **Worker em Node + TypeScript + Fastify (a do padrão):** uma língua só no repositório, `packages/shared` servindo front e worker. Rejeitada porque os SDKs oficiais das plataformas e da Anthropic têm suporte de primeira classe em Python e foi o que o dono pediu; o custo da segunda língua é contido ao concentrar as fórmulas em SQL.
- **Tudo em Edge Functions (Deno):** sem servidor. Rejeitada: cron de hora em hora com seis APIs, renovação de tokens e chamadas longas à Claude API não cabem bem no limite e no modelo das Edge Functions.
- **Tudo em n8n:** rejeitada pelo próprio padrão (regra de negócio e mais de ~15 nós viram código) e porque o Code node do n8n não roda Python com bibliotecas.

## Consequências

- Duas linguagens no repositório; `scripts/` continua Node ESM com ensaio por padrão (`--executar` grava), como o padrão manda.
- O worker só coleta e grava brutos; o React só lê views; qualquer KPI novo nasce como migração SQL com teste.
- CI precisa, na fase 4, de um job Python (ruff + pytest) além do `pnpm verify`.
- Ferramenta nova além destas só com decisão registrada.

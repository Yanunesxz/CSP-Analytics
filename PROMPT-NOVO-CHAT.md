# Prompt para começar uma sessão nova — CSP-MKT

<!--
  Cole o conteúdo na primeira mensagem de uma sessão nova de IA (Claude Code, Lovable, ChatGPT).
  Atualizado em: 2026-10-30
  Nada de senha, token, chave ou dado pessoal aqui. Segredo que passou por chat já vazou.
-->

## Onde você está

Você vai trabalhar no **CSP-MKT**, da Yan Nunes — Sistemas & Consultoria.
- O que é: central de marketing do grupo Corpo Sensual e Plumene — custo por cliente novo por marca e canal, chegada de leads, campanhas de Meta/TikTok/Google separando gestor humano e Claude, Instagram, SEO e GEO, e a fila de aprovação do que o Claude executa.
- Para quem: o dono do grupo; depois, o gestor de tráfego.
- Stack: React + Vite + TypeScript + Tailwind 4 + Supabase (padrão Yan Nunes v0.4.0), com worker em Python no Railway (desvio registrado) e n8n para gatilhos e avisos.
- Repositório: Yanunesxz/CSP-MKT. Produção: ainda não publicado.

## Quem vence quando os documentos discordam

1. Para **regras do negócio**: `docs/PROMPT-CSP-MKT.md` (prompt de partida com as 10 perguntas respondidas) e `docs/decisoes/` vencem.
2. Para **visual, dados e segurança**: `PADRAO-YAN-NUNES.md` vence, com os desvios registrados em `CLAUDE.md` → "Regras vigentes".
3. Para **o estado do projeto**: vale o **código**. Nenhum documento (nem este) vence o que está no Git.

## Leia antes de qualquer coisa

1. `CLAUDE.md` (regras vigentes deste sistema).
2. `ESTADO.md` (o que está pronto, o que falta, o que está quebrado).
3. `PADRAO-YAN-NUNES.md` (padrão visual e técnico).
4. As decisões em `docs/decisoes/` que tocam o que você vai mexer.

Siga o processo de criação (seção 0 do padrão) a partir da fase que está no `ESTADO.md`.

## Regras invioláveis deste sistema

- O fluxo de dados é fixo: `ERP Control → apps de Representantes → CSP 360 → CSP-MKT`. Este sistema só lê; nunca grava no CRM, nos apps ou no Control.
- Nenhum dado pessoal aqui: a réplica do CRM não traz nome, telefone nem e-mail; o Claude nunca recebe nome, documento ou telefone; logs sem dado pessoal.
- O Claude só executa ação nas contas de anúncio depois de aprovação na central, com teto de gasto por conta e botão de parar tudo.
- `brand_id` em toda tabela de fato, nunca em cliente; não existe `company_id` nem `marca_id`.
- Toda métrica derivada é view ou função SQL; o React só lê views, filtradas no banco, e nunca soma linhas.
- Nenhuma cor fora dos tokens, inclusive nos gráficos (`--color-series-*` só para canal, marca e operador).
- Migração só por arquivo em `supabase/migrations/`, aplicada por CI; nunca no SQL Editor. Credencial nunca com `VITE_`, nunca em log.
- Fatos de segurança de outros sistemas e contagens que envelhecem não entram em README, ESTADO nem decisões.

## Como verificar antes de dizer que terminou

- `pnpm verify` sem erro.
- Abrir as telas que mudaram em **1280px e 375px**, nos temas **claro e escuro**.
- Testar com um usuário de cada papel afetado (`owner`; `traffic_manager` quando existir).
- Atualizar `ESTADO.md` no mesmo PR.

## Como eu gosto de trabalhar

- Português do Brasil, direto, sem enrolação. Aponte erro e risco, mesmo que seja duro.
- Uma branch e um PR por assunto. Nunca push direto na `main`.
- Mudança visual global só entra depois de eu aprovar no preview.
- Tela nova passa pelas 8 perguntas das leis de UX (seção 7 do padrão) antes de eu aprovar.
- Texto de aviso, e-mail ou mensagem ao cliente segue a seção 8 do padrão.
- "Mesclar sem aplicar não é mesclar": se o PR tem migração, ela precisa estar aplicada.

## Sua primeira resposta

1. Rode `git status` e `git log --oneline -10`. **Não confie em commit citado em documento**: confira.
2. Resuma em 5 linhas o que entendeu do estado do projeto.
3. Liste o que vai fazer antes de mexer em qualquer arquivo.

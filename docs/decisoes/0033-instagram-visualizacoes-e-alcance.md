# 0033 — Instagram: visualizações, alcance somado por dia e interações

- **Data:** 2026-11-03
- **Status:** aceita em 2026-11-03 (decisão de produto; o dono aprovou a recomendação)

## Contexto

A API do Instagram trocou `impressions` por `views` em 2025: "Impressões" não existe mais na fonte. O alcance de um
período não é a soma dos dias, porque a mesma conta alcançada em dois dias conta duas vezes; e a API só dá o alcance
único da janela consultada, guardando 90 dias da conta. O engajamento do perfil é um campo do dia; o do post, no
protótipo, é curtidas + comentários + salvos.

## Decisão

- "Impressões" vira **"Visualizações"** (`views`), no perfil e nos posts.
- "Alcance" passa a se chamar **"Alcance somado dos dias"**: a soma do alcance de cada dia. O "Como contamos" diz que a
  mesma conta pode aparecer em mais de um dia.
- "Engajamento" vira **"Interações"** (`total_interactions` da API), no perfil e no post; inclui compartilhamentos.
  Taxa de interação = interações ÷ alcance somado (perfil) ou ÷ alcance do post.
- O Instagram mostra o orgânico. Visualizações = `views`. Interações = `total_interactions`, se a API confirmar que ele
  é só orgânico; se incluir anúncio, Interações = curtidas + comentários + salvos + compartilhamentos. Post
  impulsionado mostra o orgânico (os `total_*` da API, que somam o anúncio, não são lidos).
- Na Visão geral, o alcance do Instagram segue o mesmo nome e a mesma conta.

## Alternativas consideradas

- **Alcance único do período, pedido à API na hora da tela:** só os últimos 90 dias, uma chamada por filtro, e a tela
  passaria a depender da API.
- **Manter o nome "Impressões" para `views`:** nome errado para a métrica.
- **Manter curtidas + comentários + salvos no post:** não bate com o número do perfil e deixa os compartilhamentos de
  fora.

## Consequências

- Os rótulos mudam no Instagram e na Visão geral; o teste de posts do protótipo muda.
- As colunas já existem: `ig_account_daily.views`, `ig_media_daily.shares` e `total_interactions`.

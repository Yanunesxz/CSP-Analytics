# 0032 — Custo "Não se aplica" com filtro de representante ou de origem sem mídia

- **Data:** 2026-11-03
- **Status:** aceita em 2026-11-03 (decisão de produto; o dono aprovou a recomendação)

## Contexto

O investimento é por campanha. Ele não se divide por representante e não existe para origem sem mídia paga (busca
orgânica, SDR, indicação). No protótipo, a Chegada e Leads mostram "Não se aplica", cada tela com a sua regra; a Visão
geral aplica esses filtros aos leads e calcula o custo assim mesmo.

## Decisão

- Com **representante**: custo por cliente novo, custo por lead e ROAS = "Não se aplica" ("o investimento não se
  divide por representante").
- Com **origem de mídia paga** (Meta, TikTok, Google): a origem vira o canal, e o custo é o do canal.
- Com **outra origem**, ou com origem paga diferente do canal escolhido: "Não se aplica".
- Uma função só (`mkt.cost_scope`), em toda tela, inclusive na Visão geral quando a URL trouxer esses filtros. Leads,
  clientes novos e taxas continuam respeitando todos os filtros.

## Alternativas consideradas

- **Ratear o investimento pelos leads de cada representante:** inventa custo.
- **Ignorar o filtro no custo:** o número deixaria de ser do recorte que a tela diz.
- **Esconder o filtro nas telas de custo:** perde o recorte de leads e de conversão, que é útil.

## Consequências

- A regra sai de `chegada-de-clientes.ts` e de `leads.ts` e vira teste em SQL (os quatro casos de `filtrosDeCusto`).
- A Visão geral passa a mostrar "Não se aplica" quando o link trouxer representante ou origem sem mídia.
- O bloco Humano × Claude some nesses casos.

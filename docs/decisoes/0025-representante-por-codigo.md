# 0025 — Representante aparece por código

- **Data:** 2026-11-03
- **Status:** aceita em 2026-11-03 (decisão de produto; o dono aprovou a recomendação)

## Contexto

As telas filtram e quebram os números por representante (Chegada, Leads, Base). A réplica do CRM não traz nome
(decisão 0006), e o CRM guarda o responsável do negócio pelo nome. O representante aparece em três papéis: quem
**recebeu** o lead no CRM, quem tem o cliente na **carteira** do app e quem **vendeu** o pedido.

## Decisão

Na v1 o representante aparece **por código** (`REP-0001`), gerado pelo CSP-MKT a partir do id do CRM ou da chave do
login no app, como no protótipo. O nome continua só no CSP 360. Cada tela diz qual papel o código mede: em Leads e na
Chegada, quem recebeu o lead; na Base, a carteira; no pedido, quem vendeu.

Motivo: o nome do representante é dado pessoal e pede finalidade e base legal; o código atende ao filtro e à
comparação, e quem precisa saber quem é quem confere no CSP 360.

## Alternativas consideradas

- **Trazer o nome do representante do CRM, visível só para o dono:** mais fácil de ler, mas muda a regra da réplica
  (decisão 0006) e pede registro de finalidade e base legal.
- **O dono dá um apelido a cada código no CSP-MKT:** fácil de ler sem trazer dado do CRM, mas é um cadastro a manter e
  uma tela a mais.

## Consequências

- Enquanto o CRM não der o responsável do negócio por id (Parte 4 do prompt), o lead fica sem representante e a
  Chegada mostra quase tudo em "Sem representante".
- Se o dono quiser o nome, entra uma decisão nova que substitui esta e ajusta a 0006.
- Em 10/11/2026: conferido no código do CRM. O CRM continua guardando o responsável do negócio pelo nome, mas a view
  `negocios_responsavel` devolve o id quando o nome (sem espaço nas pontas e sem diferença de maiúscula) é de
  exatamente uma pessoa. Esses leads ganham o código `REP-` de quem recebeu. Nome repetido, desconhecido ou vazio: o
  lead continua em "Sem representante" (decisão 0041, item 6). O lead do SDR não tem responsável. O nome não sai do
  CRM.

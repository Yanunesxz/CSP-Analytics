# 0029 — Cliente novo por indicador: dia do 1º pedido para contar, leads do período para converter

- **Data:** 2026-11-03
- **Status:** proposta (decisão de produto, aguarda o dono)

## Contexto

O protótipo conta cliente novo de dois jeitos. "Clientes novos" e o custo contam pelo dia do 1º pedido, com o lead de
qualquer data. "Leads que viraram cliente" conta, dos leads do período, os que já fizeram o 1º pedido. As telas
misturam: a Chegada conta por lead e mostra a variação; Leads junta pelo cliente e esconde a variação, porque ela
"enganava". E o protótipo só conhece o cliente novo que passou por lead: quem fez o 1º pedido pelo representante, sem
lead no CRM, não aparece.

## Decisão

Recomendação, para o dono decidir:

Duas medidas, cada uma com um nome fixo:

1. **"Clientes novos", "Custo por cliente novo" e "ROAS"** contam pelo **dia do 1º pedido enviado**, no período. Cada
   cliente conta uma vez, e o lead pode ser de qualquer data. A contagem parte **do pedido** (decisão 0012): quem
   estreou sem lead no CRM conta como cliente novo, sem atribuição a campanha.
2. **"Leads que viraram cliente"** conta, dos **leads que chegaram no período**, quantos já fizeram o 1º pedido
   enviado. Conta **por lead** e vale para a taxa, o funil, a coorte e as quebras por origem, marca, campanha e
   representante. **Nunca compara com o período anterior**: o lead mais novo teve menos tempo para comprar.

Motivo: o custo precisa do gasto e do cliente no mesmo período; a conversão precisa do lead e do que aconteceu com ele.

## Alternativas consideradas

- **Só pelo 1º pedido:** perde a conversão do lead.
- **Só pelos leads do período:** o custo do mês dependeria de cliente que ainda vai comprar e mudaria todo dia.
- **Juntar pelo cliente na conversão:** mistura lead e cliente na mesma razão ("1 de 10 leads" quando 3 leads
  compraram).

## Consequências

- A Chegada perde a variação da conversão e das etapas do funil depois de "Leads".
- Leads passa a contar a conversão por lead.
- "Clientes novos" inclui quem estreou sem lead; o custo por cliente novo continua dividindo só pelos atribuídos.
- Os testes que mudam estão em `docs/dados/metricas.md`, seção 6.

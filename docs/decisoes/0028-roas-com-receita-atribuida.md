# 0028 — ROAS com a receita do 1º pedido dos clientes novos atribuídos

- **Data:** 2026-11-03
- **Status:** aceita em 2026-11-03 (decisão de produto; o dono aprovou a recomendação)

## Contexto

O protótipo calcula o ROAS com a receita que a plataforma informa, quase sempre zero: os sites não têm pixel nem valor
de conversão. Os parâmetros do prompt pedem receita atribuída (decisão 0009). O CRM tem pedido desde agosto de 2026,
com valor pela soma dos itens; o faturado ainda não tem valor (decisão 0004).

## Decisão

"ROAS" = valor do 1º pedido enviado dos clientes novos do período atribuídos às campanhas do recorte ÷ investimento
dessas campanhas no período.

- Valor = soma dos itens, sem desconto, até o CRM trazer o total do pedido.
- Sem investimento: "Sem dados". Com investimento e nenhum cliente: 0,00.
- Campanha com UTM repetida: "Sem dados" na linha dela (decisão 0009).
- O ROAS que a plataforma informa fica com esse nome ("ROAS informado pela plataforma"), só na tela de canal.

Motivo: liga o gasto do período aos clientes que esse gasto trouxe no mesmo período, como o custo por cliente novo.

## Alternativas consideradas

- **Receita informada pela plataforma:** zero hoje e não fecha com o pedido.
- **Todos os pedidos do período dos clientes que vieram de campanha:** mistura o gasto de hoje com o cliente trazido
  meses atrás.
- **Receita do cliente em 90 dias:** mais perto do valor real, mas pede janela, histórico e 90 dias de espera. Pode
  entrar depois, ao lado deste, com decisão nova.

## Consequências

- ROAS e custo por cliente novo usam o mesmo cliente e o mesmo período (`mkt.acquisition`).
- O número é bruto (sem desconto) até o CRM mandar o total do pedido.
- Quando o Control abrir o faturamento, uma decisão nova diz se o ROAS passa a usar o valor faturado.

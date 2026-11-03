# 0012 — Definição de lead e de cliente novo

- **Data:** 2026-10-30
- **Status:** aceita (complementada pela 0030)

## Contexto

Cada etapa da chegada de um cliente mora numa tabela diferente do CRM: negócio no funil de leads, cadastro em `clientes` (sem marca; inclui carteiras importadas por planilha e os clientes criados em lote na migração de 01/09/2026), pedido em `pedidos` (`status` `orcamento | enviado | faturado | cancelado`; o CRM junta `approved` e `sent_erp` do app em `enviado`) e faturado como carimbo manual até o Control abrir o canal. O número de sucesso depende de uma definição única.

## Decisão

Cliente novo de uma marca = primeiro `pedidos` dessa marca com `status = 'enviado'` no CRM, deduplicado por `clientes.id`. Tudo antes disso é lead: contato do site, lead do SDR, prospecto e cadastro no CRM. Faturado é etapa posterior do mesmo funil, com valor "Sem dados" até o Control abrir o canal de faturamento. "Cliente antigo" = cliente com pedido enviado em qualquer marca antes do período filtrado; a situação ativo/inativo/perdido vem da régua do CRM, quando o CRM a expuser por view.

## Alternativas consideradas

- **Lead no funil do CRM como "novo":** mede captação, não conversão.
- **Cadastro no CRM:** sem marca e com picos falsos de importação.
- **Primeiro pedido faturado:** hoje é carimbo manual, sem número do Control nem valor; só vale quando o canal abrir.

## Consequências

- O funil de Chegada de clientes é lead → prospecto → cadastro → 1º pedido enviado → faturado, e "cliente novo" é a quarta etapa.
- Custo por cliente novo = investimento do período ÷ clientes novos atribuídos (decisão 0009).
- As duas medidas de venda (pedidos enviados e faturado) aparecem lado a lado, sempre; a definição não troca no meio da série.

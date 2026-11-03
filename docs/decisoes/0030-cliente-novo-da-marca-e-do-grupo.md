# 0030 — Cliente novo da marca e cliente novo do grupo ("As duas")

- **Data:** 2026-11-03
- **Status:** proposta (decisão de produto, aguarda o dono; complementa a 0003 e a 0012)

## Contexto

A decisão 0012 diz que cliente novo de uma marca é o 1º pedido enviado dessa marca. A decisão 0003 diz que "As duas"
conta cada cliente uma vez, e trata como defeito contar como "novo na Plumene" quem já compra da Corpo Sensual. O
protótipo, em "As duas", junta os clientes novos de cada marca: quem já comprava de uma e estreou na outra conta como
novo do grupo. E o CRM só tem pedido desde agosto de 2026; antes disso há só o retrato do ERP (última compra e total
por marca). Sem ele, todo cliente antigo pareceria novo no primeiro pedido depois de agosto.

## Decisão

Recomendação, para o dono decidir:

- **Com uma marca escolhida:** cliente novo da marca = 1º pedido enviado **naquela marca**, mesmo que o cliente já
  compre da outra (decisão 0012). É o número que diz se a mídia da marca trouxe comprador novo para ela.
- **Em "As duas":** cliente novo **do grupo** = 1º pedido enviado em qualquer marca. Quem já comprava de uma marca não
  é novo do grupo (decisão 0003). A tabela por marca mostra cada marca com a regra dela e o total com a regra do grupo;
  a soma das marcas pode passar do total, e a nota diz quantos estrearam numa marca já comprando da outra.
- **Antigo, recompra, reativado e última compra** seguem o mesmo recorte: na marca escolhida, quem comprou dela; em
  "As duas", quem comprou de qualquer marca. Isso ajusta a frase da 0012 ("em qualquer marca") para a visão de uma
  marca só.
- **Histórico:** o cliente não é novo se o retrato do ERP mostra compra na marca antes do 1º pedido do CRM (primeira
  ou última compra do ERP anterior a ele). O total comprado no ERP não decide: ele pode ter compra feita só pelo ERP
  depois da estreia, e um cliente novo viraria antigo para trás.

## Alternativas consideradas

- **Sempre do grupo:** a Plumene nunca veria como seu o cliente que veio da Corpo Sensual, e o custo por cliente novo
  da marca ficaria maior do que é.
- **Juntar os novos de cada marca em "As duas" (o protótipo):** conta como novo do grupo quem já era cliente.
- **Ignorar o retrato do ERP:** todo cliente antigo vira novo no 1º pedido depois de agosto de 2026.

## Consequências

- Custo por cliente novo em "As duas" = investimento total ÷ clientes novos do grupo atribuídos.
- A tabela por marca ganha a nota de quem estreou numa marca já comprando da outra.
- A Base calcula antigo, recompra e reativado no recorte da marca, ou do grupo.
- O pedido ao time do CRM da view `clientes_compras_marca` (o retrato do ERP **sem** os pedidos do CRM, com a primeira
  e a última compra por marca) passa a ser necessário para a regra do histórico (`docs/dados/integracoes.md`,
  seção 3).

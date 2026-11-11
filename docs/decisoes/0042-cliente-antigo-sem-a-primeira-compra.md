# 0042 — Cliente antigo sem a primeira compra do ERP

- **Data:** 2026-11-10
- **Status:** aceita em 2026-11-11 (aprovada pelo dono; complementa a 0030)

## Contexto

A regra do histórico da decisão 0030 diz que o cliente não é novo se o retrato do ERP mostra compra na marca antes do
1º pedido do CRM, pela primeira ou pela última compra do ERP. Ela contava com um retrato sem os pedidos do CRM e com a
primeira compra. Conferido no código do CRM em 10/11/2026:

- O retrato por marca é cópia do que o Control exportou para o app pela última vez: só a **última compra** e o total
  de cerca de 24 meses. A **primeira compra não vem**: o CRM não a guarda em lugar nenhum.
- Quando o Control exporta de novo, o retrato da marca é trocado inteiro: a última compra anterior some.
- O retrato pode incluir a compra feita pelo app, depois de faturada.

Com isso, a última compra anda para a frente. O cliente antigo que volta a comprar pelo app passa a ter a última compra
depois do 1º pedido do CRM e deixa de parecer antigo: conta como cliente novo, e o custo por cliente novo fica menor do
que é.

## Decisão

- A réplica guarda, por cliente e marca, a **compra do ERP mais antiga que já viu** (`erp_earliest_purchase_on`): a
  primeira compra, quando o CRM a entregar; até lá, a menor última compra lida até hoje. Essa data **nunca anda para a
  frente**.
- A regra do histórico da 0030 passa a usar essa data: o cliente não é novo na marca se ela é anterior ao dia do 1º
  pedido do CRM. O resto da 0030 não muda.
- O total comprado no ERP continua sem decidir nada.

## O que esta decisão não resolve

- **Quem voltou a comprar antes da primeira leitura.** Se o retrato já foi trocado pela compra nova, a data antiga não
  existe mais em lugar nenhum do CRM, e esse cliente conta como novo uma vez. Só a primeira compra por marca, vinda do
  Control, corrige (pedido ao time do CRM).
- **Compra digitada direto no Control.** O CRM só tem pedido que nasceu nos apps. Quem vira cliente por um pedido
  digitado no Control não tem 1º pedido no CRM: não conta como cliente novo, e depois aparece como antigo. Os clientes
  novos daqui são os que chegaram pelos apps. As 4 semanas de medição do número de sucesso dizem o tamanho disso; se
  for grande, vira decisão nova.

## Alternativas consideradas

- **Deixar como está:** o cliente antigo que recompra pelo app vira novo assim que o pedido é faturado.
- **Tratar como antigo todo cliente que tem retrato:** o cliente novo de verdade ganha retrato depois da primeira
  compra faturada e viraria antigo para trás.
- **Esperar a primeira compra vir do Control:** não tem data, e o número de sucesso começa a ser medido antes.

## Consequências

- `crm_customer_brands` ganha a coluna `erp_earliest_purchase_on`, que só é trocada por uma data anterior.
- `metricas.md`, seção 3.5, usa essa data na regra do histórico; a Base (antigo, recompra e reativado) também.
- A tela diz que cliente novo é quem fez o 1º pedido pelos apps.
- Pedido ao time do CRM: a primeira compra por marca, que o Control tem e hoje não desce para o app.

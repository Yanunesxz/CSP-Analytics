# 0041 — Réplica do CRM: ajustes ao CRM como ele é

- **Data:** 2026-11-10
- **Status:** aceita em 2026-11-11 (aprovada pelo dono; complementa a 0012 e a 0015)

## Contexto

A decisão 0015 foi escrita com o que se sabia do CRM em 03/11/2026 e deixou perguntas para o time de lá. Em 10/11/2026
o código do CRM foi lido de ponta a ponta (nada foi lido do banco) e o acesso de leitura foi escrito lá. O que apareceu:

- O lead do site nasce no **funil padrão** do CRM desde 05/11/2026. Os negócios abertos do funil antigo dos leads do
  site foram movidos para ele com o mesmo id; os encerrados ficaram no funil antigo. No CRM, negócio sem funil também é
  do funil padrão, e é assim que nasce o negócio da conversão do SDR.
- O funil padrão é o funil de vendas do time comercial: nele também está o negócio que a equipe abre à mão.
- Os carimbos não dizem quando o CRM gravou. A tela do CRM grava `criado_em` e `atualizado_em` do negócio só com o dia,
  ao criar e a cada edição; só o lead do site tem hora. O carimbo do pedido é o relógio do app e pode chegar atrasado ou
  vazio. O cliente não tem carimbo de alteração.
- A situação do cliente não existe em SQL (a régua roda só na tela do CRM), não há UTM nem `referrer` por lead, e o
  responsável do negócio é o nome, que só vira id quando é de uma pessoa só.
- Os papéis de usuário do CRM mudaram: saiu o de relacionamento e entrou o de atendimento.

## Decisão

1. **Funil de leads por regra, não por migração.** É funil de leads o funil padrão do CRM (`is_default`) e o funil
   antigo dos leads do site, marcado uma vez, pelo id, por uma função de configuração (`setup.*`), para o histórico
   encerrado entrar. Negócio sem funil conta como do funil padrão. Sai a trava de um só funil de leads.
2. **Lead é o negócio, não o envio.** Quem já tem negócio aberto e manda o formulário de novo não vira lead novo. A
   chave é o id do negócio: o código que a tela mostra pode ser reaproveitado no CRM.
3. **O lead do SDR convertido conta uma vez.** O negócio que nasce da conversão (origem "SDR WhatsApp") liga-se ao lead
   do SDR pelo cliente, e o de-para leva essa origem para `sdr`.
4. **Leitura de 5 min por janela, não por marca d'água.** Em `negocios`, `leads_sdr` e `pedidos`, cada rodada relê as
   linhas com carimbo nos últimos 3 dias (hoje e os dois dias anteriores, em UTC). O cliente citado por uma linha lida
   é relido na mesma rodada, com as views de UTM e de compras, exista ou não na réplica. A passada completa diária
   continua, e é ela que pega o resto.
5. **Instante exatamente à meia-noite UTC é data pura.** No dia do lead e do cliente, vale a data como está, sem
   converter para São Paulo. Os outros instantes convertem.
6. **O que não chega fica "Sem dados", sem valor inventado.** Situação do cliente: nula, e `is_lost_manual` passa a
   aceitar nulo. UTM e `referrer` do lead: nulos; vale a UTM de primeiro contato do cliente (decisão 0031).
   Responsável: nulo quando o CRM não entrega o id ("Sem representante").
7. **Conferência de colunas só no que existe.** `SCHEMA_DRIFT` vale para as 12 views do esquema `csp_mkt`.
   `EMPTY_SOURCE` vale só para `clientes`, `pedidos` e `negocios`: as views com regra podem voltar vazias de verdade.
8. **Papel do representante.** A lista `rep_crm_role` troca `relationship` por `customer_service`. Papel fora da lista
   entra nulo, sem derrubar a rodada.

## Fica em aberto (pede o dono, antes da primeira carga)

- **Negócio aberto à mão conta como lead?** A tela do CRM abre negócio com a origem "Carteira" (o padrão do campo) e
  "Prospecção ativa". É trabalho do time comercial, não chegada de marketing. Recomendação: entra na réplica e não
  conta como lead. Até decidir, essas origens aparecem na pendência de origem sem de-para da tela de Leads.

## Alternativas consideradas

- **Manter um funil só:** os leads encerrados no funil antigo ficariam fora, e a conversão de setembro e outubro
  sairia só com quem ainda estava aberto.
- **Manter a marca d'água com 15 min de folga:** o negócio aberto ou alterado pela tela do CRM nasce com carimbo de
  meia-noite e só apareceria na passada do dia seguinte.
- **Reler a tabela inteira a cada 5 min:** funciona hoje, mas cresce com o tempo. A janela de 3 dias com a passada
  diária dá o mesmo resultado.
- **Recalcular a situação aqui:** seriam duas réguas (decisão 0012).

## Consequências

- `docs/dados/integracoes.md` (seções 3.2 a 3.6 e 19), `tabelas.md` (réplica do CRM), `metricas.md` (3.1 a 3.5 e 4.7)
  e `listas.md` descrevem o CRM como ele é.
- Migrações: sai o índice de um só funil de leads; `is_lost_manual` aceita nulo; a lista `rep_crm_role` muda; o
  de-para ganha "sdr whatsapp"; a ingestão segue as regras 1 a 8.
- Com o time do CRM (lista em `integracoes.md`, seção 19): a régua da situação em SQL, a UTM e o `referrer` por lead, o
  responsável por id, as datas de envio e de faturado, e a chave única nos itens do pedido.
- Depois de o acesso ser criado no CRM, o dono roda lá a conferência do acesso. Quatro números dela (negócios sem
  funil, pedidos sem carimbo, funis padrão e o fuso do banco) ajustam esta decisão, se preciso.

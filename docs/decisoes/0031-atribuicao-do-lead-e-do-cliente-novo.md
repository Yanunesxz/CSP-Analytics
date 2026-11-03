# 0031 — Atribuição do lead e do cliente novo: UTM, canal e primeiro toque

- **Data:** 2026-11-03
- **Status:** proposta (decisão de produto, aguarda o dono; detalha a 0009)

## Contexto

A decisão 0009 liga campanha → lead → cliente por UTM e `clientes.id`, mas não diz:

- qual UTM vale para cada lead, já que hoje o CRM guarda só a do primeiro contato, no cliente;
- o que fazer quando duas campanhas têm o mesmo nome;
- o que é o "canal" do lead (o protótipo compara a origem, e a soma dos canais fica abaixo do total);
- qual lead leva o crédito quando o cliente teve mais de um (o protótipo pega o primeiro da lista, sem regra).

## Decisão

Recomendação, para o dono decidir:

1. **UTM do lead:** a do próprio lead, quando o CRM passar a gravar por envio. Até lá, a UTM de primeiro contato do
   cliente vale só para o negócio do site que a gravou: o primeiro negócio do cliente cuja origem é a `utm_source`
   gravada. Os outros leads do cliente ficam sem UTM.
2. **Campanha:** quando a `utm_campaign` é o id da campanha na plataforma (`{{campaign.id}}` na Meta,
   `__CAMPAIGN_ID__` no TikTok, `{campaignid}` no Google, no sufixo do link), casa pelo id (`campaigns.external_id`)
   antes do nome; o id nunca se repete. Senão, a `utm_campaign` (em minúsculas, com espaços simples) casa com o nome
   da campanha da mesma marca do lead (lead sem marca: qualquer marca) e, quando a UTM diz a plataforma, da mesma
   plataforma. Uma campanha → atribuído. Mais de uma → "UTM repetida": não atribui e mostra a pendência. Nenhuma → sem
   atribuição.
3. **Canal:** o lead atribuído tem a origem igual à plataforma da campanha. "Canal" e "origem paga" passam a dizer a
   mesma coisa, e a soma dos canais fecha com o total atribuído.
4. **Crédito do cliente novo: primeiro toque.** O primeiro lead do cliente antes do 1º pedido (na marca: lead da marca
   ou sem marca). Desempate pelo código.

Motivo: hoje só o primeiro contato tem UTM no CRM, e a pergunta da T1 é "qual canal trouxe este cliente".

## Alternativas consideradas

- **Último toque:** credita o lead mais recente. Com o dado de hoje, quase nunca haveria UTM nesse lead, e quase nada
  seria atribuído.
- **Qualquer lead pago:** favorece a mídia paga e deixa o custo por cliente novo otimista.
- **Escolher uma das campanhas quando a UTM se repete:** seria atribuição inventada.
- **Click ids:** ficam para decisão futura, como a 0009 já diz.

## Consequências

- A convenção "nome da campanha = `utm_campaign`" vira regra do Tráfego com IA, e a quebra aparece como pendência.
- A convenção do Tráfego com IA põe o id no sufixo do link de toda campanha; no Google é o jeito de ter UTM sem
  digitar (ele não tem parâmetro automático com o nome), e campanha renomeada não perde a atribuição.
- Lead de cliente que já comprava a marca não conta como conversão.
- Quando o CRM gravar a UTM por lead, o último toque pode ser reavaliado com decisão nova, sem mudar o modelo.
- As regras ficam em `mkt.v_leads` e `mkt.v_new_customers` (`docs/dados/metricas.md`, seção 3).

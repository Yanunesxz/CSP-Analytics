# 0009 — Atribuição campanha → lead → cliente → pedido por UTM e `clientes.id`

- **Data:** 2026-10-30
- **Status:** aceita

## Contexto

Custo por cliente novo e ROAS por canal precisam ligar o investimento ao pedido. Hoje a UTM só é persistida no CRM em campos personalizados do prospecto (pela função de leads dos sites) e em `historico_marketing`; `leads_sdr` não tem marca, origem nem UTM; nenhum formulário grava click ids (`gclid`, `fbclid`).

## Decisão

Na v1 a atribuição usa a UTM que o CRM já grava no prospecto (`utm-source`, `utm-medium`, `utm-campaign`, `utm-term`) e a chave `clientes.id` (CNPJ → telefone → e-mail já resolvidos pelo CRM). Atribuição por canal e por `utm_campaign`, casada com `campaigns` pelo nome da campanha. Lead sem UTM é classificado pelo `referrer` (busca orgânica, assistente de IA, direto). Click ids e conversão offline ficam para uma decisão futura, porque tocam os dois sites e o CRM.

## Alternativas consideradas

- **Carregar gclid/fbclid/client_id até o CRM agora:** atribuição por anúncio e conversão offline, mas mudança em três repositórios antes da primeira tela.
- **Sem ligação técnica:** investimento de um lado e pedidos do outro; o número de sucesso não existiria.

## Consequências

- A convenção de nome de campanha nas plataformas precisa bater com `utm_campaign` nos anúncios; isso entra nas regras do módulo Tráfego com IA.
- ROAS e custo por cliente novo mostram "Sem dados" para campanha sem `utm_campaign` casável.
- Em 10/11/2026: conferido no código do CRM; nada foi lido do banco. A leitura traz só `utm_source`, `utm_medium` e `utm_campaign`, as do primeiro contato do cliente: cada campo é o primeiro valor não vazio, e os três podem vir de envios diferentes. Não há UTM nem `referrer` por lead. O lead do site sem UTM chega com a origem "site"; busca orgânica e assistente de IA só entram na origem do lead quando a própria UTM diz. Lead é o negócio, e não o envio: quem já tem negócio aberto e manda o formulário de novo não vira lead novo (decisão 0041). O que continua aberto com o time do CRM está em `docs/dados/integracoes.md`, seção 19.

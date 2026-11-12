# 0027 — Custo por lead com os leads do CSP 360 atribuídos às campanhas

- **Data:** 2026-11-03
- **Status:** aceita em 2026-11-03 (decisão de produto; o dono aprovou a recomendação)

## Contexto

O protótipo tem dois custos por lead com o mesmo nome. A Visão geral, a Chegada, Leads e a meta da estratégia usam
investimento ÷ leads do CSP 360 cuja UTM casa com a campanha. A tela de canal e o Humano × Claude usam investimento ÷
leads que a plataforma informa. Os sites não têm pixel nem a conversão do Google Ads ligada, então o número da
plataforma hoje é quase sempre zero, ou só o do formulário de lead da própria plataforma.

## Decisão

"Custo por lead" = investimento das campanhas do recorte no período ÷ leads do CSP 360 que chegaram no período e foram
atribuídos a essas campanhas (decisões 0009 e 0031). É o mesmo número em toda tela, na meta da estratégia e no aviso
"Custo por lead acima do limite" (decisão 0019).

O número da plataforma continua, com outro nome: "Leads informados pela plataforma" e "Custo por lead informado", na
tabela de campanhas, no "Ver como tabela" da tela de canal e no Humano × Claude.

Motivo: é o lead que entra no funil e vira cliente. O da plataforma conta só o que ela vê, e hoje não mede.

## Alternativas consideradas

- **Só o da plataforma:** é o que o gestor vê no gerenciador, mas não fecha com o funil e hoje é zero.
- **Os dois com o mesmo nome:** é o que existe hoje, e confunde.

## Consequências

- Os indicadores "Leads" e "CPL" da tela de canal passam a ser os do CSP 360; as linhas de lead do Humano × Claude
  também.
- Lead sem UTM que case com uma campanha não entra no custo por lead; entra no total de leads.
- Os testes de canal e de Humano × Claude que esperavam o número da plataforma mudam (`docs/dados/metricas.md`,
  seção 6).
- Em 10/11/2026: conferido no código do CRM que lead é o negócio, e não o envio (decisão 0041, item 2). Quem já tem
  negócio aberto no funil de leads e manda o formulário de novo não vira lead novo: o CRM anota o envio no negócio que
  existe. O custo por lead conta esse lead uma vez, e "Leads informados pela plataforma" pode ser maior que "Leads".
  Quem já é cliente ativo e manda o formulário abre negócio e conta como lead.
- Em 11/11/2026 (decisão 0041, item 9): o cliente ativo só abre negócio se não tiver negócio em aberto gravado no
  funil padrão. O envio anotado num negócio aberto à mão, que não é lead, não conta em lugar nenhum: é um limite,
  pedido ao time do CRM (`docs/dados/integracoes.md`, seções 3.4 e 19).

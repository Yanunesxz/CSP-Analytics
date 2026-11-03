# 0027 — Custo por lead com os leads do CSP 360 atribuídos às campanhas

- **Data:** 2026-11-03
- **Status:** proposta (decisão de produto, aguarda o dono)

## Contexto

O protótipo tem dois custos por lead com o mesmo nome. A Visão geral, a Chegada, Leads e a meta da estratégia usam
investimento ÷ leads do CSP 360 cuja UTM casa com a campanha. A tela de canal e o Humano × Claude usam investimento ÷
leads que a plataforma informa. Os sites não têm pixel nem a conversão do Google Ads ligada, então o número da
plataforma hoje é quase sempre zero, ou só o do formulário de lead da própria plataforma.

## Decisão

Recomendação, para o dono decidir:

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

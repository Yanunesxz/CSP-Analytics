# 0037 — Leads de formulário das plataformas: só a contagem

- **Data:** 2026-11-03
- **Status:** aceita em 2026-11-03 (técnica; detalha a 0006 e a 0010)

## Contexto

O Lead Ads da Meta, o formulário do TikTok e o do Google entregam o lead por webhook ou por API. A Meta manda só ids no
webhook, mas a leitura do lead traz as respostas; o TikTok e o Google mandam nome, telefone e e-mail no corpo. A entrada
de lead é do CRM (decisão 0010), e a réplica não traz dado pessoal (decisão 0006). O CSV exportado das plataformas
também pode ser de lead.

## Decisão

- O CSP-MKT **não** assina webhook de lead e **não** lê o lead de plataforma. Lê só a contagem de leads de cada campanha
  por dia, no relatório da plataforma (`platform_leads`).
- Se o grupo usar formulário de plataforma, o lead entra no CRM pelo contrato de distribuição do time do CRM e chega
  aqui pela réplica, como qualquer lead. A chave de evento dessa distribuição não é lida aqui: ela reidentifica a
  pessoa na plataforma.
- O CSV de reserva aceita só relatório de campanha. Arquivo com coluna de nome, e-mail, telefone ou documento é
  recusado inteiro.

## Alternativas consideradas

- **Guardar só o id do lead da plataforma:** exige endpoint público e ainda recebe o corpo com dado pessoal do TikTok e
  do Google.
- **Trazer o lead completo:** contra a 0006 e a 0010.

## Consequências

- O lead de formulário aparece na lista de Leads só quando o CRM o receber; até lá, só a contagem informada pela
  plataforma.
- Para atribuir esse lead à campanha, o CRM precisa guardar a campanha de origem (pendência em
  `docs/dados/integracoes.md`).
- `webhook_inbox` continua fora da v1.

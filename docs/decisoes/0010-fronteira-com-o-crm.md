# 0010 — O CSP-MKT é o dono de marketing; o que fica no CRM

- **Data:** 2026-10-30
- **Status:** aceita

## Contexto

O CRM (CSP 360) tem uma página de automação e campanhas só com dados de exemplo, tabelas `campanhas` e `automacoes` vazias e, no roadmap, os blocos "Entrada de leads (Meta Lead Ads, Google Ads, landing pages)" e "Marketing e atribuição", adiados até o núcleo estabilizar. Sem fronteira, os dois times construiriam a mesma coisa.

## Decisão

O CSP-MKT é o dono de marketing: campanhas, gasto, criativos, atribuição e ações de tráfego vivem só nele. O CRM mantém `historico_marketing`, a fila do SDR e a entrada de leads dos sites; a página de automação do CRM sai ou vira link para a central (a combinar com o time do CRM). Na fase seguinte à v1, o CSP-MKT passa a alimentar `historico_marketing` com `fonte = 'integracao'`.

## Alternativas consideradas

- **Dividido (leads no CRM, campanhas no CSP-MKT):** é quase o mesmo desenho; a diferença é que leads de anúncio (Meta Lead Ads) entrariam no CRM pelo contrato de distribuição — continua possível como extensão.
- **CRM mantém tudo:** o CSP-MKT só visualizaria e dependeria de um modelo de campanha que o CRM ainda não tem.

## Consequências

- O time do CRM não constrói campanhas, atribuição nem conectores de mídia.
- Pendências com o CRM (credencial só-leitura, view de situação do cliente, ampliar a `sincronizar-apps`, mesclar a função de leads) estão na Parte 4 de `docs/PROMPT-CSP-MKT.md`.

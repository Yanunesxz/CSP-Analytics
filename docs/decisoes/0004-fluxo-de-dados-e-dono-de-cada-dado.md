# 0004 — Fluxo de dados fixo e dono de cada dado

- **Data:** 2026-10-30
- **Status:** aceita

## Contexto

O grupo já decidiu, no CRM (CSP 360), que o ERP Control é a fonte-mãe e dono do número do pedido, que os apps de Representantes são a ponte com o ERP e que o CRM lê os apps e nunca fala com o Control. O CSP-MKT entra na ponta dessa cadeia. O padrão (`docs/04`) manda registrar o dono de cada dado.

## Decisão

Fluxo fixo, não revisitar: `ERP Control → apps de Representantes → CSP 360 → CSP-MKT`. O CSP-MKT lê de cima para baixo; nunca cria pedido, nunca fala com o Control, nunca grava nos apps; na v1 também não grava no CRM. Leads correm no sentido contrário (site → CRM → app → ERP) e o CSP-MKT só observa.

| Dado | Dono | O CSP-MKT |
|---|---|---|
| Pedido e faturamento | ERP Control (chega pelos apps e pelo CRM) | só lê |
| Cliente e lead | CSP 360 | só lê, sem dado pessoal |
| Métrica de mídia, Instagram, SEO e GEO | cada plataforma | guarda snapshot com data |
| Estratégia, ações e aprovações de tráfego | CSP-MKT | é o dono |

## Alternativas consideradas

- **Ler os apps direto:** traria `orders.total`, `source` e vitrine, mas fura a cadeia, exige duas credenciais a mais e refaz a deduplicação que o CRM já faz. Rejeitada na v1 (pergunta 3 do prompt).
- **Ler o ERP direto:** proibido pela arquitetura do grupo.

## Consequências

- O que o CRM não replica dos apps (`orders.total`, `invoiced_total`, `source`) só entra se o time do CRM ampliar a `sincronizar-apps`.
- "Faturado" segue o carimbo do CRM; valor faturado fica "Sem dados" até o Control abrir o canal de faturamento.
- Gravar no CRM (`historico_marketing` com `fonte = 'integracao'`) é fase posterior, com decisão própria.

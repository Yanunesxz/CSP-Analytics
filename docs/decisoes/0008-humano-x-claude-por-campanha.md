# 0008 — Números do humano e do Claude separados por campanha

- **Data:** 2026-10-30
- **Status:** aceita (trecho substituído pela 0016)

## Contexto

O dono quer ver o desempenho do gestor de tráfego humano e o do Claude com números separados. A unidade de separação define o modelo de dados e o que precisa ser lido das plataformas.

## Decisão

Cada campanha tem um dono: `campaigns(external_id, platform, brand_id, managed_by human|claude, …)`, com `campaigns_managed_by_history` por gatilho quando a gestão troca de mão. Os insights são lidos no nível de campanha e somados por dono; o toggle Visualizador ↔ Gestor de tráfego só filtra essa coluna. Como toda ação do Claude passa pela central (decisão 0005), `managed_by = claude` é preenchido na criação; campanha importada das plataformas sem dono conhecido nasce `human`.

## Alternativas consideradas

- **Conta de anúncios separada por operador:** atribuição limpa, mas dobra credenciais e pixels por marca.
- **Por alteração (ator de cada mudança no log da plataforma):** exige identidades de escrita distintas, cron frequente (a Meta devolve uma semana de `activities` por padrão) e uma regra de atribuição contestável.
- **Teste A/B por janelas com orçamentos iguais:** compara pares, não totais; pode ser feito depois, por cima deste modelo.

## Consequências

- A tela de canal mostra a mesma linha de métricas para os dois operadores, lado a lado, com a diferença em %.
- Trocar o dono de uma campanha é ação registrada (quem, quando, por quê).

# 0002 — Gráficos: cores só de tokens, biblioteca decidida na fase 2

- **Data:** 2026-10-30
- **Status:** aceita

## Contexto

O padrão só tem gráficos sem biblioteca (`.yn-bars` e `.yn-columns`, uma série, 0 a 100, sempre com "Ver como tabela") e não cita biblioteca de gráficos na stack. O CSP-MKT é quase todo série temporal e multissérie (leads por dia, gasto e CPL por canal, Humano × Claude), com dezenas de gráficos por tela. O padrão proíbe a paleta de uma biblioteca (seção 3), não a biblioteca.

## Decisão

Todo gráfico usa só cores de tokens (`var(--color-…)` e, para séries, os tokens da decisão 0007), tem `<details class="yn-as-table">` ao lado com os mesmos números e tem estados "Sem dados" e erro próprios (o padrão só os tem para KPI e lista). `.yn-bars` e `.yn-columns` onde bastam (ranking, comparação por categoria). Para série temporal e multissérie, a escolha entre SVG próprio em React e uma biblioteca leve (Recharts ou uPlot) é feita na fase 2, pelo critério tempo de entrega e desempenho com mais de 10 gráficos por tela, e registrada como atualização desta decisão.

## Alternativas consideradas

- **Só os gráficos CSS do padrão:** rejeitada — não há linha, eixo, tooltip, legenda nem multissérie; as telas de canal não se desenham com eles.
- **Fechar SVG próprio agora:** rejeitada — eixos, tooltip, legenda, multissérie e acessibilidade feitos do zero é escopo que atrasa a entrega; a decisão fica para quando as telas existirem.
- **Biblioteca com a paleta dela:** rejeitada pela seção 3 do padrão.

## Consequências

- Componente de gráfico único em `apps/web/src/components/ui/` que recebe dados e séries e aplica os tokens; nenhuma tela instancia biblioteca direto.
- "Ver como tabela" e os estados "Sem dados"/erro fazem parte do componente, não de cada tela.
- Conferir os gráficos nos dois temas e em 375px e 1280px antes de qualquer PR.

# 0026 — "Este mês" compara com os mesmos dias do mês anterior

- **Data:** 2026-11-03
- **Status:** proposta (decisão de produto, aguarda o dono)

## Contexto

No protótipo, "Este mês" vai do dia 1 até hoje e compara com o mês anterior inteiro (`lib/periodo.ts`, com teste).
Nos primeiros dias do mês, toda contagem (clientes novos, leads, investimento, pedidos) aparece em queda forte e em
vermelho: uma urgência falsa (lei 18 do padrão). É uma das "Pendências de desenho" do índice das telas. Com a fase 3,
o período passa a ser calculado no banco (`mkt.period_window`, decisão 0034).

## Decisão

Recomendação, para o dono decidir:

"Este mês" compara com **os mesmos dias do mês anterior**: do dia 1 até o mesmo dia; se o mês anterior for mais
curto, até o último dia dele. O rótulo diz o intervalo ("vs. 1º a 3 de outubro"). "Mês passado" continua contra o mês
anterior inteiro, e 7, 30 e 90 dias continuam contra os N dias anteriores.

A variação compara os dias completos dos dois lados (até ontem, em "Este mês"; menos para a fonte que fecha o dia
depois, como o Search Console e o Instagram); o número de hoje entra no valor, não na comparação. No dia 1 ainda não
há dia completo, e a variação fica vazia, nunca uma queda.

Motivo: compara o que é comparável e não pinta queda que não existe. A T1 continua sem toque.

## Alternativas consideradas

- **Mês anterior inteiro (como o protótipo):** número fechado e fácil de explicar, mas o começo do mês sempre parece
  queda.
- **Mesmos dias úteis:** mais justo com fim de semana e feriado, mas difícil de explicar e muda com o calendário.
- **Projetar o mês até o fim:** compara mês com mês, mas mostra número que ainda não aconteceu.

## Consequências

- O caso "este mês vai do dia 1 até hoje e compara com o mês anterior inteiro" de `periodo.test.ts` muda e vai para
  `supabase/tests/kpi/period.test.ts`.
- A tela monta o rótulo a partir das datas que a função devolve.
- A régua do limite, a verba e a estratégia não mudam: usam o mês corrente (decisão 0021).
- Se o dono preferir o mês inteiro, é uma linha em `mkt.period_window` (`docs/dados/metricas.md`, seção 2.1).

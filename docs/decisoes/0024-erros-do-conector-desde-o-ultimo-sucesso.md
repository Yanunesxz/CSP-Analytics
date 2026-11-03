# 0024 — Erros do conector contados desde o último sucesso

- **Data:** 2026-11-03
- **Status:** aceita em 2026-11-03 (decisão de produto; o dono aprovou a recomendação)

## Contexto

O cartão de cada conector mostra "Erros em 24 h". No protótipo, "Tentar de novo" zera esse número; com dado de
verdade, um erro das últimas 24 h continua contado depois de o conector voltar, e o cartão segue vermelho sem nada
errado agora.

## Decisão

O cartão mostra **"Falhas seguidas"**: quantas rodadas falharam desde a última que deu certo (zera no primeiro
sucesso), com a hora e o código da última falha. "Linhas gravadas em 24 h" continua. O estado do cartão segue a mesma
lógica: **Atrasado** quando a última rodada boa passou da frequência mais a folga; **Caído** quando a última rodada
falhou e não há rodada boa há mais de duas frequências.

Motivo: o cartão responde "está funcionando agora?"; o histórico de instabilidade fica no diário do conector.

## Alternativas consideradas

- **Erros nas últimas 24 h:** mostra instabilidade, mas pinta de vermelho o que já voltou.
- **Os dois números no cartão:** mais leitura no cartão, para pouca decisão a mais.

## Consequências

- O rótulo muda de "Erros em 24 h" para "Falhas seguidas".
- A conta fica em `mkt.v_connector_health`, a partir de `sync_runs` e `connector_jobs`; o aviso "Conector parado" usa
  o mesmo estado.
- O estado conta cada trabalho do conector, não só a leitura mais frequente: a releitura diária ou a passada completa
  que falha todo dia deixa o cartão "Atrasado", com o nome do trabalho.
- Conector que nunca deu certo fica "A ligar" mesmo com tentativa que falhou, e o cartão mostra a falha e o código.

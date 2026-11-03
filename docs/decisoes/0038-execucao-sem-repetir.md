# 0038 — Execução nas plataformas sem repetir

- **Data:** 2026-11-03
- **Status:** aceita em 2026-11-03 (técnica; detalha a 0020)

## Contexto

A decisão 0020 cria `platform_executions` com chave de idempotência. Só a Meta aceita uma chave de idempotência; o
Google e o TikTok não. A rede pode cair depois de a plataforma aplicar a mudança e antes de a resposta chegar; o executor
pode cair no meio; e uma ação que falhou pode ser aprovada de novo. O padrão pede que repetir nunca duplique.

## Decisão

- Toda escrita é um **valor final**, nunca um incremento: "pausar", "reativar", "orçamento diário = X". Repetir dá o
  mesmo resultado.
- Antes de mandar, o executor **relê** o objeto na plataforma; se já está como pedido, confirma sem mandar.
- A chave da execução vai no cabeçalho da Meta. Criar campanha leva o código da ação no nome, e o executor procura o nome
  antes de criar (o Google e o TikTok não têm chave).
- Uma execução por vez por campanha; "Parar tudo" passa na frente; execução enviada sem resposta é relida antes de nova
  tentativa; até 5 tentativas; erro 4xx não repete.
- O limite do mês só barra o que aumenta o gasto; pausar e reduzir nunca são barrados. A conta é a mesma do alerta da
  fila (`mkt.action_exceeds_limit`; para reativar, `mkt.execution_extra_spend_cents`), e sem base para a conta ela
  barra. Conta sem limite não recebe aumento.
- O pedido enviado é o que foi aprovado: a criação leva os campos que cada plataforma exige, aprovados junto, e nasce
  pausada nas três.
- Execução que não vai mais acontecer (ação descartada ou feita à mão) fica `cancelled`.

## Alternativas consideradas

- **Confiar só na chave da plataforma:** o Google e o TikTok não têm.
- **Marcar como feita sem reler:** a tela diria o que a plataforma não fez.
- **Incremento ("mais 10% de orçamento"):** repetir dobraria o efeito.

## Consequências

- `mkt.execution_status` ganha `cancelled` (`docs/dados/listas.md`).
- A proposta de ajuste recusa campanha com orçamento nos conjuntos ("ajuste na plataforma").
- O executor é escrito na fase 4, com teste de cada caso: já confirmado, sem resposta, recusado, passa do limite, conta
  sem limite, parada aberta, aprovação que não confere, sem credencial de escrita.

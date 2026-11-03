# 0020 — Trilha do tráfego: ações, rodadas do Claude, execuções e diário

- **Data:** 2026-11-03
- **Status:** aceita em 2026-11-03 (técnica; detalha a 0005 e registra nela uma exceção: o nome digitado no contexto do Claude)

## Contexto

A decisão 0005 pede a trilha (proposto por, prompt, contexto, ação, parâmetros, status, aprovado por, executado em,
resultado) e a cópia diária dos registros de alteração da Meta e do Google. No protótipo: descartar pela tela de canal
e "Parar tudo" não guardam quem nem quando; "Marcar como feita" preenche o aprovador com quem marcou; o motivo do
descarte e o resultado dividem a mesma coluna; o diário mora no navegador; e "Parar tudo" muda o status da campanha
sem a plataforma ter parado.

## Decisão

- `traffic_actions` ganha código (`ACT-0001`), o status `failed`, quem descartou e quando, motivo de descarte em lista
  fechada com o texto separado, `done_by` e `done_via`; os parâmetros congelam na aprovação; as passagens de status
  permitidas ficam num gatilho.
- `claude_runs` guarda o prompt, o contexto e a resposta de cada rodada, uma vez por rodada, por 13 meses. O `check`
  barra e-mail, telefone e documento; nome, o filtro não reconhece. O nome digitado na estratégia ou no nome de uma
  campanha é risco residual, aceito como exceção à regra "nunca leva nome" da 0005, com o aviso embaixo do campo da
  estratégia.
- `platform_executions` registra cada escrita numa plataforma: os parâmetros exatos, uma chave de idempotência, o
  andamento (`queued`, `blocked`, `sent`, `confirmed`, `failed`), até 5 tentativas com espera crescente e a
  confirmação relendo a plataforma. Antes de enviar, o executor (serviço à parte do worker, decisão 0017) confere
  `mkt.execution_allowed`: a aprovação no banco, conector ligado, credencial de escrita, campanha não encerrada,
  parada aberta, conta com limite e o limite do mês com o custo estimado. Um gatilho trava os parâmetros e as passagens
  de status da execução.
- O gatilho de transição da ação confere quem pede pelo `session_user` e pela permissão: só a API aprova e descarta,
  só o executor anda com a execução, e o worker só insere proposta do Claude em `idea`.
- O status da campanha só muda pela leitura da plataforma. "Parar tudo" vira `traffic_stops` com as campanhas e uma
  execução por campanha; sem credencial de escrita, as execuções ficam `blocked` e a tela lista o que pausar à mão.
- `traffic_log` é o diário, só de acréscimo, e também o histórico de status das ações e das execuções; guarda 5 anos.
- `ad_activity_log` copia por dia o que mudou nas contas da Meta e do Google, sem o nome de quem mudou.

## Alternativas consideradas

- **Um registro único em `jsonb`:** sem chave estrangeira e difícil de consultar por ação ou campanha.
- **Histórico de status separado do diário:** a mesma informação em dois lugares.
- **Mudar o status da campanha na hora de parar:** a tela diria "pausada" sem a plataforma ter pausado.

## Consequências

- A janela de descarte ganha a lista de motivos; "Parar tudo" mostra as execuções bloqueadas; "Desfazer a parada" e
  "Tentar de novo" (de uma ação que falhou) usam as mesmas execuções.
- O executor é escrito na fase 4 e roda desde o começo da v1: sem credencial de escrita, ele marca cada execução
  `blocked` (`no_write_credential`) e a tela diz o que fazer na plataforma. A escrita de cada plataforma liga quando a
  credencial dela for aprovada. Na v1, lance e criativo não executam pela central: a tela diz "Faça na plataforma e
  marque como feita".

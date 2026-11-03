# 0019 — Avisos: o banco decide e enfileira, o n8n entrega

- **Data:** 2026-11-03
- **Status:** proposta (técnica, aguarda a aprovação do modelo)

## Contexto

A decisão 0001 deixa o n8n só para gatilhos externos e avisos. O padrão manda o aviso não urgente sair em horário
comercial de São Paulo, juntar vários num resumo, respeitar o que cada pessoa escolheu e manter a regra de horário
útil num lugar só. O protótipo guarda as escolhas no navegador e diz que, na fase 3, elas vão para o perfil, que o
n8n lê.

## Decisão

- O banco decide o que avisar, em funções SQL chamadas por gatilho ou pelo `pg_cron`: conector caído ou atrasado
  (`mkt.v_connector_health`), credencial que vence em até 7 dias, gasto da conta a partir de 90% do limite do mês,
  custo por lead acima da meta da estratégia da marca, proposta nova na fila, pausa do "Parar tudo" sem confirmação em
  2 min, exclusão em massa segurada em 3 passadas seguidas, relatório da semana.
- Cada aviso vira uma linha em `notification_outbox`, por pessoa e canal, com `dedupe_key` (o mesmo fato não vira dois
  avisos) e `send_after_at` (agora no urgente; no próximo horário comercial, com feriados de `holidays`, no resto).
- As escolhas ficam em `notification_preferences`; sem linha, vale o padrão de `mkt.notice_default` (e-mail em tudo,
  WhatsApp só no urgente). Só recebe quem tem a permissão que o aviso aponta.
- O que não é urgente e cai no mesmo horário comercial vai num resumo por pessoa e canal: `notify.claim_pending` junta
  as linhas pendentes com o mesmo `profile_id`, `channel` e `send_after_at` num item só, e `notify.mark_sent` fecha
  todas.
- O n8n pega os pendentes por `notify.claim_pending`, envia e marca. O texto leva números, código e link, nunca dado
  de cliente ou de lead.
- O banco confere de novo a permissão na hora de entregar: `notify.claim_pending` só devolve aviso de perfil ativo,
  cujo papel ainda tem a permissão do aviso e cuja preferência ainda liga o canal; os outros viram `skipped`. Tirar o
  acesso ou trocar o papel marca como `skipped` os avisos pendentes daquela pessoa.

## Alternativas consideradas

- **O n8n consulta as views e decide:** a regra iria para o n8n, um segundo lugar, e ele precisaria ler o banco.
- **O worker envia:** o worker passaria a ter credenciais de e-mail e WhatsApp, contra a decisão 0001.
- **Edge Function com webhooks:** mais peças para o mesmo resultado.

## Consequências

- "Custo por lead acima do limite" usa a meta de custo por lead da estratégia: não nasce tela nova de configuração.
- O endereço de entrega (e-mail do login ou WhatsApp do perfil) sai do banco para o n8n, que vira operador do dado:
  registrar no `ESTADO.md` (regra 15).
- Os fluxos do n8n ficam pequenos (pegar, enviar, marcar), dentro do limite de ~15 nós.
- O horário útil mora só em `mkt.next_business_slot` (SQL), não em `lib/business-hours.ts`: desvio de `docs/03` do
  padrão, porque quem decide o envio é o banco; a tela não calcula horário útil. Os feriados do ano seguinte entram por
  migração até 1º de dezembro (item fixo de "Próximos passos" no `ESTADO.md`).
- O n8n não guarda execução: a falha fica na fila, sem o endereço, e as credenciais dele são cifradas com uma chave
  própria no Railway (`docs/dados/integracoes.md`, seção 16).

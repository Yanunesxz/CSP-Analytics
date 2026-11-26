# 0044 — Convite de outro dono pelo CI

- **Data:** 2026-11-26
- **Status:** proposta em 2026-11-26 (pedido do dono: o segundo login entra como dono, "dono", "preciso do meu login e do dele")

## Contexto

O dono quer um segundo login de dono logo depois do dele. A tela de usuários e a Edge Function `convidar` (decisão
0017), que mandariam o convite com a `service_role`, ainda não existem. O único caminho de convite pronto é o job
`primeiro-dono`, que só vale enquanto não há dono ativo.

## Decisão

Um job manual novo no CI, `convidar-dono` (Actions → CI → Run workflow, `acao = convidar-dono`, nome e e-mail), igual ao
`primeiro-dono`:

- pede a aprovação do dono no ambiente `producao`, que faz as vezes do segundo fator;
- conecta como `mkt_setup` e chama `setup.create_owner_invitation` (migração 13): só com um dono ativo, papel `owner`,
  7 dias, em nome do dono ativo mais antigo, para o gatilho de novo usuário aceitar; a auditoria leva só o id e o papel;
- manda o convite do Supabase Auth com a `service_role`, que fica só no segredo do ambiente `producao`.

Só convida dono. O `traffic_manager` espera a tela de usuários.

## Consequências

- O e-mail do convite sai pelo SMTP do Supabase. O de fábrica só entrega a membros da organização no Supabase, 2 por
  hora: para alguém de fora, o dono configura um SMTP próprio em Authentication → Emails → SMTP Settings antes do job.
- Quando a tela de usuários e a Edge Function `convidar` existirem, o job sai, e a função fica só para emergência.

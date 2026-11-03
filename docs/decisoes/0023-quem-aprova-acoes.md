# 0023 — Só o dono aprova ações na v1, com o segundo fator

- **Data:** 2026-11-03
- **Status:** proposta (decisão de produto, aguarda o dono)

## Contexto

A decisão 0005 fala em aprovação "do dono (ou do gestor, quando existir)". O `rules.ts` do protótipo dá aprovar,
descartar e parar tudo só ao dono, e a tela de Usuários mostra isso. Na v1 só o dono entra (decisão 0011).

## Decisão

Recomendação, para o dono decidir:

Na v1, **só o dono** aprova e descarta ações, para tudo, muda limite de gasto e troca o operador de uma campanha
(`approve_action`, `stop_all`, `configure_traffic`). O gestor de tráfego propõe, registra ideia, escreve a estratégia
e marca como feita. Rever quando o gestor entrar no sistema.

Aprovar, mudar limite ou operador, gerir usuários e mexer em conector pedem o segundo fator (TOTP) no login do dono.
"Parar tudo" nunca pede: é o botão de emergência.

Motivo: as decisões que gastam dinheiro ficam com quem paga. O dono pode propor e aprovar no mesmo passo (o "Pausar" e
o "Ajustar" da tela de canal), com as duas linhas no diário. A conta que aprova gasto é protegida por mais que uma
senha.

## Alternativas consideradas

- **O gestor aprova tudo:** mais rápido no dia a dia, sem conferência de outra pessoa.
- **O gestor aprova até um valor:** equilíbrio entre os dois, mas pede um teto numérico e uma decisão própria; é o
  caminho natural quando o gestor entrar.

## Consequências

- Mudar depois é uma linha em `role_permissions`, por migração (a tela lê as permissões do banco, decisão 0018).
- Quando o gestor ganhar aprovação, a decisão nova diz se ele pode aprovar a própria proposta.
- O dono cadastra um app autenticador no primeiro acesso; sem o segundo fator, a sessão vê os números, os leads, o
  tráfego e os conectores, mas não aprova, não muda limite nem operador, não mexe em conector e não vê nem gere
  usuários.
- O aviso "Proposta do Claude para aprovar" vai só para quem pode aprovar.

# 0011 — Papéis desde o primeiro PR, um usuário na v1

- **Data:** 2026-10-30
- **Status:** aceita (trecho substituído pela 0018)

## Contexto

Na v1 só o dono entra; o gestor de tráfego humano entra depois. O padrão (`docs/06`) diz que "a tela esconder o botão não é segurança" e exige RLS por papel testada no portão da fase 3. O dono pediu um toggle Visualizador ↔ Gestor de tráfego no estilo do tema claro/escuro.

## Decisão

`profiles.role` em lista fechada desde o primeiro PR: `owner` (tudo) e `traffic_manager` (lê números e opera o Tráfego com IA; não vê lead com dado pessoal). RLS por papel em toda tabela, rota protegida e item de menu que some vêm da mesma regra em `packages/shared`; toda política confere `profiles.role`, nunca só "está logado". Convite por e-mail pronto; na v1 só o `owner` cadastrado. O toggle Visualizador ↔ Gestor de tráfego muda o que a tela mostra (Visualizador: só números; Gestor de tráfego: estratégia, ações, fila de aprovação e Humano × Claude), nunca o que a pessoa pode fazer.

## Alternativas consideradas

- **Só visão, sem papéis:** rejeitada — quando o gestor entrasse, a segurança teria de ser refeita.
- **Login do gestor já na v1:** rejeitada pelo dono — por enquanto só ele entra.

## Consequências

- O portão da fase 3 testa a RLS com um usuário `owner` e um `traffic_manager` pela API, mesmo sem gestor real.
- Complementada pela [0043](0043-papel-so-do-resumo.md) (12/11/2026): o terceiro papel, `summary_viewer`, vê só o
  Resumo simples, e o portão testa também um usuário dele.
- O módulo Usuários existe na v1 com um usuário.

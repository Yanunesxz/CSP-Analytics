# 0043 — Papel só do resumo

- **Data:** 2026-11-12
- **Status:** aceita em 2026-11-12 (escolhida pelo dono: "Só o resumo"; complementa a 0011)

## Contexto

O Resumo simples (`/resumo`, tarefa T7) foi feito para mandar o link a quem paga os anúncios e não trabalha com
marketing. Para essa pessoa entrar quando houver login, os papéis da decisão 0011 não servem:

- `owner` vê e faz tudo: aprova as ações do Claude, mexe em limite, conectores e usuários.
- `traffic_manager` vê todos os números e a lista de leads, e opera o Tráfego com IA.

Ela precisa só do resumo: quanto foi gasto, onde, quantos clientes novos vieram, quanto custou cada um e quanto voltou.

## Decisão

- Papel novo na lista fechada `mkt.role`: **`summary_viewer`**, "Leitor do resumo".
- Ação nova em `mkt.app_action`: **`view_summary`**, "Ver o Resumo simples". Os três papéis têm.
- O `summary_viewer` tem só `view_summary` e `edit_settings` (o próprio tema, a marca padrão e os próprios filtros).
  Não tem `view_numbers`, `view_leads`, `view_traffic`, `view_connectors` nem nenhuma ação que grava em nome da
  empresa. Nenhuma das ações dele pede o segundo fator.
- No banco, nenhuma política nova: sem `view_numbers` e as outras, a RLS que já existe não deixa ler tabela de
  número, lead, tráfego, conector ou pessoa. Na fase 4, o Resumo simples ganha uma função `api.*` própria, que confere
  `view_summary` e devolve só os totais da tela (sem lead, sem cliente, sem dado pessoal).
- Na tela, quem tem o papel entra no Resumo simples: o menu mostra só ele e as Configurações, e as telas de números
  (Visão geral, Chegada e Base de clientes, os canais, Instagram, SEO e GEO) passam a pedir `ver_numeros`. O app
  instalável já abre no resumo.
- Quem dá o acesso é o dono, pelo convite de Usuários, como os outros papéis.
- Migração nova (`20261112150000_papel_so_resumo.sql`): as migrações 01 a 11 já estão em produção e não mudam.

## Consequências

- O teste de RLS (camadas 1 e 2) passa a ter um usuário deste papel: ele não lê nada das tabelas e views de hoje e
  não chama nenhuma função que grava; só o próprio perfil, as próprias preferências e o quadro de permissões.
- O usuário só nasce no banco de produção depois do portão da fase 3, como os outros.
- A migração nova só vai para a `main` depois de o dono confirmar que a aplicação automática do Supabase de produção
  está desligada ("Deploy to production"), ou de o teste de RLS virar checagem obrigatória do PR.

## O que fica para depois

- **Relatório semanal por e-mail:** o aviso `weekly_report` pede `view_numbers` (`mkt.notice_default`), então o
  leitor do resumo não o assina. Se ele deve receber o resumo por e-mail, é um aviso novo, com decisão própria.
- **Na demonstração**, `?papel=summary_viewer` no endereço de abertura mostra o sistema como esse papel vê (sem login,
  só no protótipo).

## Alternativas consideradas

- **Dar `owner`:** a pessoa poderia aprovar ação do Claude, mudar limite de gasto e dar acesso a outras pessoas.
- **Dar `traffic_manager`:** veria a lista de leads e operaria o Tráfego com IA, o que não precisa.
- **Link aberto, sem login:** os números de gasto e de clientes ficariam com qualquer pessoa que recebesse o link, e a
  regra "toda política confere o papel" (0011) deixaria de valer para essa tela.

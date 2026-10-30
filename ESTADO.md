# Estado do projeto — CSP-MKT

> **Atualizado em:** 2026-10-30 · **por:** sessão de IA (Claude Code), branch `chore/iniciar-projeto`
> Atualize este arquivo em **todo PR**. Ele é o que a próxima pessoa ou IA lê primeiro.
> Nada de senha, token ou dado pessoal aqui.

## Fase do processo

- Fase atual: **2. Desenhar** (1. Entender fechada em 2026-10-30: resumo do entendimento aprovado por escrito pelo dono — "ok, segue")
- Portão da fase: o dono faz a tarefa principal no protótipo em modo demonstração, no computador e em 375px, sem ajuda — "saber, em até 3 cliques, quanto custou cada cliente novo por marca e por canal neste mês, comparado ao mês anterior"
- Número de sucesso: custo por cliente novo por marca e canal — hoje desconhecido → conhecido toda semana para as duas marcas (meta de valor depois de 4 semanas medidas); relatório semanal de marketing — hoje não existe → 5 min numa tela. Última medição: nenhuma (nada mede ainda; GA4 dos sites sem ID)
- Último resumo enviado ao cliente: 2026-10-30 (modelo 1, fase 1)

## Em produção

- Versão: nenhuma (nada publicado)
- O que está funcionando: nada ainda

## Em andamento

| O quê | Quem | Branch / PR | Situação |
|---|---|---|---|
| Arquivos do padrão, CLAUDE.md, ESTADO.md, decisões 0001–0012 | sessão de IA | `chore/iniciar-projeto` | pronto para PR |
| Fase 2: tarefas principais, telas com estados e protótipo no modo demonstração | sessão de IA | `feat/prototipo-demonstracao` | começando |

## Quebrado ou arriscado

- Nada em produção. Riscos conhecidos: a aprovação da Meta para o Claude executar (Full Access: App Review + Business Verification) é o item mais longo e ainda não começou; os sites não medem nada (`NEXT_PUBLIC_GA_ID` vazio em produção); a `sincronizar-apps` do CRM não traz `orders.total`, `invoiced_total` nem `source`; a função de leads dos sites está fora da `main` do CRM.

## Próximos passos

1. Fase 2: lista de 3 a 7 tarefas principais com o caminho mais curto; cada tela com os estados carregando, vazio, erro, sem dados e sucesso; conferência com as 8 perguntas de UX; protótipo no modo demonstração com as duas marcas, os controles globais e Humano × Claude lado a lado.
2. Fase 3: tabelas, status, papéis, RLS, views de KPI e cada conector; domínio marketing; só depois do "ok" da fase 2.
3. Em paralelo, as pendências da Parte 4 de `docs/PROMPT-CSP-MKT.md` (acessos e mudanças no CRM).

## Diagnóstico

- Última execução: nenhuma (ainda não há tela)
- Itens "Conferir" confirmados (o quê, quando, quem): nenhum
- Rastreadores em uso e para quê: nenhum (sistema interno não rastreia)

## Pendências que dependem do cliente

- Quantas horas por semana custa hoje juntar os números dos painéis (campo "Quanto custa hoje" do prompt).
- Renomear o repositório para `yn-csp-mkt` ou manter `CSP-MKT` com a exceção registrada na decisão 0001.
- Confirmar as suposições da Parte 3 do prompt que mudam tela: Instagram só métricas na v1; representantes só como dimensão; "cliente antigo" = quem já fez pedido antes do período.
- Contas por marca em cada plataforma (Meta, Google Ads, TikTok, GA4, Search Console) e quem é administrador de cada uma.
- Criar no projeto do CRM a credencial só-leitura para a réplica (fase 3).
- Começar a Business Verification e o App Review da Meta (item mais longo da lista).
- Preencher `NEXT_PUBLIC_GA_ID` e `NEXT_PUBLIC_GOOGLE_ADS_CONVERSAO` na Vercel dos dois sites.
- Lista completa na Parte 4 de `docs/PROMPT-CSP-MKT.md`.

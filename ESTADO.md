# Estado do projeto — CSP-MKT

> **Atualizado em:** 2026-10-30 · **por:** sessão de IA (Claude Code), branch `feat/prototipo-demonstracao`
> Atualize este arquivo em **todo PR**. Ele é o que a próxima pessoa ou IA lê primeiro.
> Nada de senha, token ou dado pessoal aqui.

## Fase do processo

- Fase atual: **2. Desenhar**, com o protótipo pronto para o portão (1. Entender fechada em 2026-10-30: resumo do entendimento aprovado por escrito pelo dono — "ok, segue")
- Portão da fase: o dono faz a tarefa principal no protótipo em modo demonstração, no computador e em 375px, sem ajuda — "saber, em até 3 cliques, quanto custou cada cliente novo por marca e por canal neste mês, comparado ao mês anterior". No código, a T1 fecha em 0 a 1 toque a partir da Visão geral (conferido no navegador em 30/10/2026)
- Número de sucesso: custo por cliente novo por marca e canal — hoje desconhecido → conhecido toda semana para as duas marcas (meta de valor depois de 4 semanas medidas); relatório semanal de marketing — hoje não existe → 5 min numa tela. Última medição: nenhuma (nada mede ainda; GA4 dos sites sem ID)
- Último resumo enviado ao cliente: 2026-10-30 (modelo 1, fase 1); prévia da fase 2 enviada em 2026-10-30 (modelo 2)

## Em produção

- Versão: nenhuma (nada publicado)
- O que está funcionando: nada ainda

## Em andamento

| O quê | Quem | Branch / PR | Situação |
|---|---|---|---|
| Arquivos do padrão, CLAUDE.md, ESTADO.md, decisões 0001–0012 | sessão de IA | `chore/iniciar-projeto` | publicada; PR para a `main` a abrir |
| Fase 2: protótipo no modo demonstração (13 telas, estados, Visualizador × Gestor de tráfego, Humano × Claude) | sessão de IA | `feat/prototipo-demonstracao` (sobre `chore/iniciar-projeto`) | pronto para o portão; publicada |

O protótipo abre com `pnpm dev:exemplo` (dados de exemplo, sem `.env`). Telas: Visão geral, Chegada de clientes, Base de clientes, Leads, Meta Ads, TikTok Ads, Google Ads, Instagram, SEO e GEO, Tráfego com IA, Conectores, Usuários, Configurações e Diagnóstico. Cada tela tem o seu `docs/telas/<módulo>.md`; tarefas T1–T6, revisão de UX e pendências de desenho em `docs/telas/README.md`; o contrato dos módulos em `docs/telas/00-contrato.md`. `pnpm verify` verde em 30/10/2026 (18 testes no shared, 436 no web, build). Conferido no navegador em 30/10/2026: 1280px claro e escuro, 375px claro e escuro, a T1, a gaveta, os estados de `?estado=` e o Diagnóstico.

## Quebrado ou arriscado

- Nada em produção. Riscos conhecidos: a aprovação da Meta para o Claude executar (Full Access: App Review + Business Verification) é o item mais longo e ainda não começou; os sites não medem nada (`NEXT_PUBLIC_GA_ID` vazio em produção); a `sincronizar-apps` do CRM não traz `orders.total`, `invoiced_total` nem `source`; a função de leads dos sites está fora da `main` do CRM.
- **O CI não roda no GitHub:** o token usado no `git push` não tem o escopo `workflow`, então o workflow ficou em `docs/ci.yml`. Até ele voltar para `.github/workflows/ci.yml` (pelo site do GitHub ou com um token com esse escopo), rode `pnpm verify` antes de todo push.
- Números do protótipo são de exemplo e algumas definições ainda não estão fechadas (lista em "Próximos passos", item 4): não tirar conclusão de negócio deles.

## Próximos passos

1. **Portão da fase 2:** o dono abre `pnpm dev:exemplo`, faz a T1 no computador e em 375px sem ajuda e decide as "Pendências de desenho" de `docs/telas/README.md` (resumo em "Pendências que dependem do cliente", abaixo).
2. **Fase 3** (só depois do "ok" da fase 2): tabelas, status, papéis, RLS, views de KPI e cada conector; domínio marketing. As regras que hoje vivem em `src/data/queries.ts` e `src/data/queries/*.ts` viram views e funções SQL, com os mesmos testes.
3. Em paralelo, as pendências da Parte 4 de `docs/PROMPT-CSP-MKT.md` (acessos e mudanças no CRM).
4. Definições de número para fechar na fase 3 (cada uma muda o que a tela mostra; detalhe no `.md` de cada tela):
   - limite de gasto (`spendCapCents`): mensal, da vida da campanha ou do período; a Visão geral e Tráfego com IA hoje leem diferente;
   - custo por lead: leads do CSP 360 atribuídos pela UTM × leads informados pela plataforma (hoje há as duas, em telas diferentes);
   - ROAS com a receita atribuída da decisão 0009, não a informada pela plataforma;
   - cliente novo por indicador: dia do 1º pedido no período × leads do período que viraram cliente;
   - custo com filtro de origem ou representante (hoje regra local em Chegada e Leads; levar para a view);
   - réplica do CRM com a data de cada mudança de etapa e o carimbo de faturado; situação do cliente por marca;
   - Instagram: "impressões" virou "visualizações" na API da Meta; alcance somado por dia × alcance único;
   - conectores: "erros nas últimas 24 h" × "desde o último sucesso".
5. Dívidas do protótipo, antes ou durante a fase 3:
   - uma janela de confirmação única em `components/ui` (`canais/Modal.tsx` e `trafego-ia/Janela.tsx` são cópias; `usuarios/JanelaDeConvite.tsx` monta a própria);
   - `Kpi` com variação neutra (investimento, impressões) e `Meter` sem cor de atenção; ordenação da tabela empilhada no celular; rótulo do `GraficoBarras` que corta em 375px;
   - listas fechadas que ficaram nos módulos e vão para `packages/shared` (`ROTULO_DA_ACAO`, `RESUMO_DO_PAPEL`, `Ga4Channel`, `SiteCheckItem`, `assistenteDoHost`); complementos de exemplo do SEO para `data/sample`; endereço de exemplo do CSP 360 num lugar só;
   - `useFiltros` devolve objeto novo a cada mudança de URL (cada tela recalcula, 50–85 ms com os dados de exemplo);
   - `actions.ts` sem "definir limite", "reativar campanhas" e `enviarConvite`; descartar e "Parar tudo" não gravam quem nem quando;
   - estratégia por marca, limite por conta e diário de tráfego ficam em `modules/trafego-ia/estado.ts` até a fase 3 (`traffic_strategies`, `traffic_log`);
   - avisos do React Router sobre as flags v7 no console; contornos locais que o `index.css` deixou redundantes (`min-w-0` em volta da `BarraDeFiltros`, `margin: auto` na janela de convite);
   - dados de exemplo: nenhum conector "Caído" (o estado só aparece com `?estado=erro` e nos testes) e títulos de ação que se repetem.

## Diagnóstico

- Última execução: 2026-10-30 16:11, no modo demonstração (`pnpm dev:exemplo`), 13 telas em 375, 1280 e 1920px: **0 Falhou, 0 Atenção**, 4 Conferir, 5 OK, 8 Não se aplica. A rodada anterior acusou "Atenção" no 17 (tabela do "Ver como tabela" rolando de lado em cartão de meia tela, em 1280px), já corrigido.
- Atenção ao rodar com o painel do navegador escondido: a transição de cor dos botões (`.yn-btn`) não anda numa página fora da tela, e o 10 (contraste) acusa botões a 1,0:1 e 1,1:1 no tema escuro, medidos no meio da troca de tema. Conferido à mão em 30/10/2026: terminada a transição, o contraste passa. A rodada acima desligou as transições só nas páginas abertas pelo Diagnóstico. Com a tela à vista, o Diagnóstico espera 150 ms e a transição dura 120 ms.
- Itens "Conferir" ainda sem confirmação (6 só dados necessários, 8 leitor de tela, 11 teclado, 15 LGPD): ficam para a fase 5, com o banco e o login de verdade
- Itens "Conferir" confirmados (o quê, quando, quem): nenhum
- Rastreadores em uso e para quê: nenhum (sistema interno não rastreia)

## Pendências que dependem do cliente

- **Decisões de tela (portão da fase 2), detalhe em `docs/telas/README.md`:**
  - Visão geral em 375px: os 8 indicadores, um por linha, empurram o custo por marca e por canal para duas telas abaixo. Dividir em "Aquisição" e "Venda e alcance" ou dois indicadores por linha?
  - "Este mês" compara com o mês anterior inteiro (nos primeiros dias tudo aparece em queda). Comparar com os mesmos dias do mês anterior?
  - Tela de canal em 375px, visão Gestor: Humano × Claude vem depois de 12 indicadores. Subir o bloco ou mostrá-lo também no Visualizador?
  - Tráfego com IA no Visualizador mostra só um aviso: os links para ele já devem levar a visão Gestor?
  - "Parar tudo" pausa só as campanhas do Claude na marca, ou também as do gestor humano?
  - O gestor de tráfego aprova ações do Claude? A decisão 0005 fala em aprovação "do dono (ou do gestor)", mas hoje só o dono aprova e para tudo.
  - Instagram na visão Gestor: ganha "Propor impulsionar post"?
  - Base de clientes: a receita por representante e a coluna de representante saíram da lista para caber em 1280px; confirmar.
  - Conectores: "Tentar de novo" aparece nas duas visões, por ser recuperação de falha; confirmar.
- Quantas horas por semana custa hoje juntar os números dos painéis (campo "Quanto custa hoje" do prompt).
- Renomear o repositório para `yn-csp-mkt` ou manter `CSP-MKT` com a exceção registrada na decisão 0001.
- Confirmar as suposições da Parte 3 do prompt que mudam tela: Instagram só métricas na v1; representantes só como dimensão; "cliente antigo" = quem já fez pedido antes do período.
- Contas por marca em cada plataforma (Meta, Google Ads, TikTok, GA4, Search Console) e quem é administrador de cada uma.
- Criar no projeto do CRM a credencial só-leitura para a réplica (fase 3).
- Começar a Business Verification e o App Review da Meta (item mais longo da lista).
- Preencher `NEXT_PUBLIC_GA_ID` e `NEXT_PUBLIC_GOOGLE_ADS_CONVERSAO` na Vercel dos dois sites.
- Devolver o CI para `.github/workflows/ci.yml` (criar o arquivo pelo site do GitHub com o conteúdo de `docs/ci.yml`, ou dar ao token o escopo `workflow`).
- Lista completa na Parte 4 de `docs/PROMPT-CSP-MKT.md`.

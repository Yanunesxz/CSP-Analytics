# Estado do projeto — CSP-MKT

> **Atualizado em:** 2026-11-05 · **por:** sessão de IA (Claude Code), branch `docs/acessos-das-conexoes`
> Atualize este arquivo em **todo PR**. Ele é o que a próxima pessoa ou IA lê primeiro.
> Nada de senha, token ou dado pessoal aqui.

## Fase do processo

- Fase atual: **3. Modelar** — modelo de dados aprovado pelo dono em 2026-11-03 ("Aprovar tudo": o modelo de `docs/dados/`, as decisões 0013 a 0038 e as de produto 0021 a 0033 como recomendadas); falta a parte 2 do portão (migrações e o teste de RLS pela API)
- Fases fechadas: 1. Entender em 2026-10-30 (resumo aprovado por escrito pelo dono — "ok, segue"); 2. Desenhar em 2026-11-03 (o dono fez a T1 no protótipo e aprovou — "Aprovado, seguir"; o protótipo segue como está e as pendências de desenho de tela viram melhoria, sem bloquear)
- Portão da fase 3: RLS testada com um usuário de cada papel (`owner`, `traffic_manager`) e sem login, tentando ler, alterar e chamar o que não devia, e sendo negado. Fecha em duas partes: o dono aprova o modelo e responde as decisões de produto (feito em 2026-11-03); depois as migrações rodam no projeto Supabase de teste e o teste de RLS passa pela API (`docs/dados/plano.md`)
- Número de sucesso: custo por cliente novo por marca e canal — hoje desconhecido → conhecido toda semana para as duas marcas (meta de valor depois de 4 semanas medidas); relatório semanal de marketing — hoje não existe → 5 min numa tela. Última medição: nenhuma (nada mede ainda; GA4 dos sites sem ID)
- Último resumo enviado ao cliente: 2026-10-30 (modelo 1, fase 1); prévia da fase 2 enviada em 2026-10-30 (modelo 2); o modelo de dados e as decisões de produto da fase 3 em 2026-11-03, aprovados no mesmo dia

## Em produção

- Versão: nenhuma em produção de verdade. O protótipo está no ar em https://csp-mkt.vercel.app desde 2026-11-04: a Vercel publica a `main` com dados de exemplo e a faixa "Modo demonstração" (`apps/web/vercel.json`: `pnpm build:exemplo`; no projeto da Vercel, Root Directory `apps/web`; sem variável de ambiente; `noindex`). O endereço abre para quem tiver o link. Quando o front ler o banco (fase 4), o `buildCommand` volta a ser `pnpm build`.
- O que está funcionando: as 13 telas do protótipo com dados de exemplo inventados, com "CSP MKT" no menu e "Criado por Yan Nunes" no rodapé (decisão 0039); nenhum dado real

## Em andamento

| O quê | Quem | Branch / PR | Situação |
|---|---|---|---|
| Fase 3, parte 2: migrações 01 a 10, views de `api` e o teste de RLS no PGlite (camada 1) | sessão de IA | `feat/banco-e-rls` | em andamento |

Já na `main`: desde 03/11/2026, por avanço direto e sem PR, os arquivos do padrão e as decisões 0001–0012, o protótipo da fase 2, o modelo de dados da fase 3 e a prévia na Vercel, com "Este mês" contra os mesmos dias do mês anterior; desde 04/11/2026, "CSP MKT" no menu e o crédito no rodapé (decisão 0039, branch `feat/nome-csp-mkt`).

Acessos das conexões, abertos pelo dono em 04/11/2026 com a lista da sessão de IA "Conexões". Nenhum token nem chave foi gerado: o token da Meta e as chaves do Google nascem no dia de subir o worker, direto no Railway.

- **Supabase de teste** (`csp-mkt-teste`, região São Paulo): login com a configuração de `docs/dados/plano.md` (cadastro aberto e login anônimo desligados, TOTP ligado, senha de 12 caracteres ou mais, endereço `http://localhost:5173`) e os 8 segredos `*_TESTE` no GitHub, com a URL do banco pelo Session pooler (porta 5432). A lista de esquemas expostos fica só com `api` depois da primeira migração (o teste de RLS confere).
- **Meta:** app `CSP-MKT` no Limited Access, com o caso de uso da API de Marketing e o do Instagram com login do Facebook; usuário do sistema de leitura `csp-mkt-leitura` (funcionário, só ver desempenho nas contas, páginas e perfis das duas marcas), sem token. Pela documentação lida em 04/11/2026, o Limited Access lê as contas do próprio portfólio e permite 1 usuário do sistema e 1 administrador; o Full Access (10 usuários do sistema, e com ele o de escrita) pede 500 chamadas à API de Marketing em 15 dias, com menos de 15% de erro, e o App Review do Marketing API Access Tier.
- **Google:** projeto `csp-mkt` com Google Ads API, Google Analytics Data API e Google Search Console API; nível Explorer pedido (2.880 operações por dia em contas reais; o developer token acabou em 09/09/2026, conferido na documentação em 04/11/2026); contas de serviço `csp-mkt-ads-leitura` (Somente leitura no Google Ads) e `csp-mkt-google-leitura` (Leitor no GA4 e Restrito no Search Console), sem chave. A de escrita do Ads fica para quando o executor existir.
- **TikTok:** hoje as marcas anunciam só na Meta e no Google Ads; o conector do TikTok fica "A ligar".
- **A confirmar:** se os nomes criados são os da lista (os de cima); se a verificação do negócio na Meta foi enviada ou já existia; a aprovação do Explorer; se as propriedades GA4 dos sites já existiam; se o Search Console aceitou a conta de serviço; se a organização do Google Cloud deixa criar chave de conta de serviço (`iam.disableServiceAccountKeyCreation`); a verificação em duas etapas em cada conta.

O protótipo abre com `pnpm dev:exemplo` (dados de exemplo, sem `.env`). Telas: Visão geral, Chegada de clientes, Base de clientes, Leads, Meta Ads, TikTok Ads, Google Ads, Instagram, SEO e GEO, Tráfego com IA, Conectores, Usuários, Configurações e Diagnóstico. Cada tela tem o seu `docs/telas/<módulo>.md`; tarefas T1–T6, revisão de UX e pendências de desenho em `docs/telas/README.md`; o contrato dos módulos em `docs/telas/00-contrato.md`. `pnpm verify` verde em 30/10/2026 (18 testes no shared, 436 no web, build). Conferido no navegador em 30/10/2026: 1280px claro e escuro, 375px claro e escuro, a T1, a gaveta, os estados de `?estado=` e o Diagnóstico. Em 04/11/2026, com "CSP MKT" no menu e o crédito no rodapé: `pnpm verify` verde (18 testes no shared, 438 no web, build) e a casca conferida no navegador em 1280px e 375px, claro e escuro, com a gaveta.

O modelo de dados aprovado começa por `docs/dados/README.md`: camadas e esquemas do banco, fluxo de cada dado, latência, convenções, dado pessoal e prazo de guarda. O detalhe está em `tabelas.md` (dicionário, com o DDL proposto), `listas.md`, `papeis-e-rls.md` (matriz de acesso, políticas, funções de ação e os casos do teste de RLS), `plano.md` (migrações, CI, seed e o que o dono providencia), `metricas.md` (a view ou função de cada número das telas, com as divergências do protótipo resolvidas) e `integracoes.md` (réplica do CSP 360, cada conector, execução das ações do Claude, avisos e credenciais). As decisões 0013 a 0020 e 0034 a 0038 são técnicas; as 0021 a 0033 são de produto, aprovadas como recomendadas. Antes da aprovação, a proposta passou por três conferências independentes (segurança e LGPD; números; padrão e integrações), foi corrigida, passou por uma segunda rodada (coerência entre os arquivos, cobertura do protótipo, integrações e regras do projeto) e por uma revisão independente das correções. O que só se confirma na primeira leitura ou na primeira escrita de cada plataforma está em `docs/dados/integracoes.md`, seção 19 (por exemplo, como a Meta conta o gasto depois de zerar o teto da conta).

## Quebrado ou arriscado

- Nada em produção (o endereço da Vercel é o protótipo). Riscos conhecidos: a aprovação da Meta para o Claude executar (Full Access) é o item mais longo: o app e o usuário de leitura existem desde 04/11/2026, mas as 500 chamadas em 15 dias que o App Review pede só começam com o worker lendo, e a verificação do negócio está a confirmar; os sites não medem nada (`NEXT_PUBLIC_GA_ID` vazio em produção); a `sincronizar-apps` do CRM não traz `orders.total`, `invoiced_total` nem `source`; a função de leads dos sites está fora da `main` do CRM.
- **O CI não roda no GitHub:** o token usado no `git push` não tem o escopo `workflow`, então o workflow ficou em `docs/ci.yml`. Até ele voltar para `.github/workflows/ci.yml` (pelo site do GitHub ou com um token com esse escopo), rode `pnpm verify` antes de todo push.
- O Google Ads aposentou o developer token em 09/09/2026 (o acesso passou a ser pelo projeto do Google Cloud): `GOOGLE_ADS_DEVELOPER_TOKEN` e o OAuth do Google Ads no `.env.example` não valem mais. A proposta usa contas de serviço (decisão 0036); o `.env.example` muda na fase 4.
- Números do protótipo são de exemplo. "Este mês" já compara com os mesmos dias do mês anterior (decisão 0026, desde 03/11/2026); as outras regras ainda são as de antes das decisões 0027 a 0033 (a tela passa a ler as contas do banco na fase 4): não tirar conclusão de negócio deles.

## Próximos passos

1. **Migrações 01 a 10** em `supabase/migrations/` e as views de `api` adiantadas, com o teste de RLS no PGlite (camada 1) no `pnpm verify` (a aprovação, com o status das decisões, o `CLAUDE.md` e o `README.md`, está na `main` desde 2026-11-03).
2. **Portão da fase 3, parte 2:** o CI aplica as migrações no projeto Supabase de teste e roda o teste de RLS pela API (camada 2) com `owner`, `traffic_manager` e sem login. O projeto de teste e os segredos do GitHub existem desde 04/11/2026; falta o CI de volta em `.github/workflows/`. O resultado entra aqui.
3. **Fase 4, conexões** (depois do portão): o worker em Python (`apps/worker`), começando pelo CSP 360, pela Meta e pelo Google Ads, com os testes em respostas gravadas. No mesmo dia: o token da Meta e as chaves do Google, direto no Railway, e os ids de cada conta, página, perfil e propriedade pelos scripts de cadastro. A contagem das 500 chamadas da Meta começa aí.
4. Em paralelo: o que o dono providencia (`docs/dados/plano.md`) e os pedidos ao time do CRM (`docs/dados/integracoes.md`, seções 3 e 19).
5. Dívidas do protótipo, para a fase 4 (quando o front ligar no banco):
   - uma janela de confirmação única em `components/ui` (`canais/Modal.tsx` e `trafego-ia/Janela.tsx` são cópias; `usuarios/JanelaDeConvite.tsx` monta a própria);
   - `Kpi` com variação neutra (investimento, impressões) e `Meter` sem cor de atenção; ordenação da tabela empilhada no celular; rótulo do `GraficoBarras` que corta em 375px;
   - listas fechadas que ficaram nos módulos e vão para `packages/shared` (`ROTULO_DA_ACAO`, `RESUMO_DO_PAPEL`, `Ga4Channel`, `SiteCheckItem`, `assistenteDoHost`); complementos de exemplo do SEO para `data/sample`; endereço de exemplo do CSP 360 num lugar só;
   - `useFiltros` devolve objeto novo a cada mudança de URL (cada tela recalcula, 50–85 ms com os dados de exemplo);
   - `actions.ts` sem "definir limite", "reativar campanhas" e `enviarConvite`; descartar e "Parar tudo" não gravam quem nem quando;
   - estratégia por marca, limite por conta e diário de tráfego ficam em `modules/trafego-ia/estado.ts` até o front ler `traffic_strategies`, `spend_limits` e `traffic_log`;
   - avisos do React Router sobre as flags v7 no console; contornos locais que o `index.css` deixou redundantes (`min-w-0` em volta da `BarraDeFiltros`, `margin: auto` na janela de convite);
   - dados de exemplo: nenhum conector "Caído" (o estado só aparece com `?estado=erro` e nos testes) e títulos de ação que se repetem.

## Diagnóstico

- Última execução: 2026-10-30 16:11, no modo demonstração (`pnpm dev:exemplo`), 13 telas em 375, 1280 e 1920px: **0 Falhou, 0 Atenção**, 4 Conferir, 5 OK, 8 Não se aplica. A rodada anterior acusou "Atenção" no 17 (tabela do "Ver como tabela" rolando de lado em cartão de meia tela, em 1280px), já corrigido.
- Atenção ao rodar com o painel do navegador escondido: a transição de cor dos botões (`.yn-btn`) não anda numa página fora da tela, e o 10 (contraste) acusa botões a 1,0:1 e 1,1:1 no tema escuro, medidos no meio da troca de tema. Conferido à mão em 30/10/2026: terminada a transição, o contraste passa. A rodada acima desligou as transições só nas páginas abertas pelo Diagnóstico. Com a tela à vista, o Diagnóstico espera 150 ms e a transição dura 120 ms.
- Itens "Conferir" ainda sem confirmação (6 só dados necessários, 8 leitor de tela, 11 teclado, 15 LGPD): ficam para a fase 5, com o banco e o login de verdade
- Itens "Conferir" confirmados (o quê, quando, quem): nenhum
- Rastreadores em uso e para quê: nenhum (sistema interno não rastreia)

## Pendências que dependem do cliente

- **Melhorias de tela da fase 2** (não bloqueiam; detalhe em `docs/telas/README.md`): Visão geral em 375px; Humano × Claude no canal em 375px; os links para Tráfego com IA já levarem `?visao=gestor`; "Propor impulsionar post" no Instagram; a coluna de representante na Base de clientes; "Tentar de novo" nas duas visões. "Este mês", "Parar tudo" e "o gestor aprova?" viraram as decisões 0026, 0022 e 0023.
- O projeto Supabase de **produção** na região de São Paulo, com a configuração de `docs/dados/plano.md` ("O que o dono providencia"); o de teste existe desde 04/11/2026. Verificação em duas etapas nas contas de Supabase, Vercel, Railway, GitHub, n8n e das plataformas (a confirmar).
- Quem cuida da LGPD do grupo: encarregado, canal do titular e a confirmação das bases legais do quadro de dado pessoal (`docs/dados/README.md`).
- Do time do CRM: o papel só-leitura e as views do CSP-MKT (`docs/dados/integracoes.md`, seção 3) e qual funil vale como funil de leads.
- Os ids de cada marca para os scripts de cadastro: contas de anúncio da Meta (`act_…`), páginas e perfis do Instagram, contas do Google Ads (e a de administrador, se houver), propriedades GA4 e do Search Console. Os acessos e as contas de serviço estão em "Em andamento".
- Meta: confirmar a verificação do negócio; o App Review do Marketing API Access Tier só depois de o worker fazer as 500 chamadas em 15 dias (item mais longo da lista).
- Preencher `NEXT_PUBLIC_GA_ID` e `NEXT_PUBLIC_GOOGLE_ADS_CONVERSAO` na Vercel dos dois sites. Site público com GA4 pede o aviso de cookies (regra 3 do padrão), no repositório de cada site.
- Devolver o CI para `.github/workflows/ci.yml` (criar o arquivo pelo site do GitHub com o conteúdo de `docs/ci.yml`, ou dar ao token o escopo `workflow`).
- Quantas horas por semana custa hoje juntar os números dos painéis (campo "Quanto custa hoje" do prompt).
- Renomear o repositório para `cliente-csp-mkt` (sistema de cliente desde a decisão 0039) ou manter `CSP-MKT` com a exceção registrada na decisão 0001.
- Pôr no contrato que o crédito "Criado por Yan Nunes" faz parte da entrega; tirá-lo é a versão sem marca (decisão 0039).
- Confirmar as suposições da Parte 3 do prompt que mudam tela: Instagram só métricas na v1; representantes só como dimensão; "cliente antigo" = quem já fez pedido antes do período.
- Lista completa na Parte 4 de `docs/PROMPT-CSP-MKT.md` e na seção 19 de `docs/dados/integracoes.md`.

# SEO e GEO — `/seo-geo`

> Grupo **Canais** do menu, ícone `search`. Todos os papéis veem. **Só leitura na v1.** GEO aqui é Generative
> Engine Optimization (visibilidade em assistentes de IA), não corte geográfico.
> Tela: `apps/web/src/modules/seo-geo/` · consulta: `apps/web/src/data/queries/seo-geo.ts` (`painelSeoGeo`,
> que parte de `seoGeo()` de `queries.ts`, com teste em `seo-geo.test.ts`).

## O que a pessoa faz nesta tela

- Vê se a busca orgânica está crescendo: impressões, cliques, CTR e posição média no Google, comparados com o
  período anterior; cliques e posição dia a dia, por marca; e as consultas que mais trazem cliques.
- Vê quanto os assistentes de IA trazem ao site: sessões por assistente (ChatGPT, Perplexity, Claude, Gemini,
  Copilot), a parcela de IA nas sessões do site e as sessões de todos os canais do GA4.
- Vê quantos leads e clientes novos chegaram pela busca orgânica e por IA, por buscador e por assistente, e abre
  a tela que trabalha cada número (Leads ou Chegada de clientes, já filtrada pela origem).
- Confere se cada site está pronto para buscadores e IA: robots.txt, llms.txt e JSON-LD.
- Uma vez por mês, lê no Search Console as impressões em AI Overviews e no AI Mode, que não têm API.

## Ação principal

**Abrir o Search Console** (`.yn-btn--primary` na barra do topo, abre em outra aba, `rel="noopener noreferrer"`).
A tela é de leitura e a v1 só lê; a única tarefa que a pessoa faz fora daqui, todo mês, é a leitura do relatório
"Generative AI performance" do Search Console, que o aviso fixo de GEO explica. Todo o resto é número na tela.
O controle mais usado depois dela é o **Período**, primeiro item da barra de filtros; a marca vem do seletor
**Marca** do menu e segue a pessoa entre as telas.

## Como a tela está montada (de cima para baixo)

1. **Barra de filtros**: Período (padrão "Este mês"), chave "Comparar com o anterior" e botão "Filtros". SEO e
   GEO se filtram só por marca e período (não há canal, campanha nem operador na busca orgânica), então o
   painel "Filtros" mostra só "Meus filtros".
2. **Visão Gestor de tráfego**: aviso das pendências que travam a medição (ver "Visão").
3. **Busca orgânica · SEO** — rótulo da seção, "Como os sites aparecem e recebem cliques na busca do Google." e,
   no canto, o selo "Search Console · atualizado há X". Aviso se o Search Console estiver atrasado ou caído.
   Quatro indicadores (Impressões, Cliques, CTR, Posição média); os gráficos "Cliques por dia" e "Posição média
   por dia" lado a lado, uma linha por marca; a tabela "Consultas que mais trazem" (até 10, por cliques).
4. **Assistentes de IA · GEO** — selo "GA4" (com "Simulado" enquanto o conector não liga). O aviso fixo "A
   medição de GEO é parcial"; aviso se o GA4 estiver atrasado ou caído. Dois indicadores (Sessões de IA, Parcela
   de IA nas sessões); os gráficos de barras "Sessões por assistente" (cor de cada assistente) e "Sessões por
   canal" (Busca orgânica e Assistente de IA em cor de série, os outros canais em cinza: só o que importa aqui se
   destaca); o gráfico "Sessões de IA por dia", uma linha por marca.
5. **Leads e clientes novos** — selo "CSP 360 · atualizado há X". Quatro indicadores que levam à tela que
   trabalha o número (Leads da busca orgânica e Leads de assistentes de IA → Leads; Clientes novos da busca e
   Clientes novos de IA → Chegada de clientes, sempre com `?origem=`); a tabela "Leads por fonte" (Fonte, Origem,
   Leads, Clientes novos), busca orgânica primeiro e, em cada origem, do maior para o menor.
6. **Checagem dos sites** — um cartão por marca (as duas em "As duas"), com o site e os itens robots.txt,
   llms.txt e JSON-LD: o estado em texto (`.yn-badge` "Em ordem" ou "Atenção"), o que foi encontrado e, na
   atenção, o que fazer; no rodapé, "Conferido em DD/MM/AAAA HH:MM · N itens pedem atenção".

Cada seção é um `<section aria-labelledby>` com o rótulo em `h2` no estilo `.yn-eyebrow`, separada da anterior
por uma linha; os títulos dos gráficos e tabelas são os destaques de leitura.

## O que cada número quer dizer

| Número | Conta (na consulta, nunca na tela) |
|---|---|
| Impressões, Cliques | Soma diária do Search Console (relatório "Web") das marcas do filtro, no período. |
| CTR | Cliques ÷ impressões do período. |
| Posição média | Média das posições diárias ponderada pelas impressões (como o Search Console). Quanto menor, melhor: a cor da comparação inverte (cair é verde). |
| Cliques e posição por dia | O número do dia de cada marca; dia sem número fica vazio (não vira 0). |
| Consultas que mais trazem | Impressões e cliques de cada consulta somados no período, CTR e posição ponderada; até 10, por cliques. O resumo diz quanto dos cliques do período elas somam: o Search Console esconde as consultas raras, então a soma fica abaixo do total. |
| Sessões de IA | Sessões do GA4 vindas dos cinco assistentes, no período. |
| Sessões por assistente | As mesmas sessões, por assistente, com a parte de cada um nas sessões de IA. |
| Parcela de IA nas sessões | Sessões do canal "Assistente de IA" ÷ sessões de todos os canais do GA4, no período. |
| Sessões por canal | Sessões de cada canal do grupo de canais do CSP-MKT no GA4 (Busca orgânica, Assistente de IA, Direto, Busca paga, Social pago, Social orgânico, Indicação), só os que tiveram sessão. |
| Leads da busca orgânica / de assistentes de IA | Leads do CSP 360 criados no período cuja origem é busca orgânica ou assistente de IA (regra `classificarOrigem`; em 10/11/2026 o CRM ainda não grava o `referrer` por lead: sem UTM, o lead chega como "site", decisão 0041). |
| Clientes novos da busca / de IA | Desses leads (de qualquer data), os que fizeram o 1º pedido enviado no período, um por cliente do CSP 360 (decisão 0012). |
| Leads por fonte | Os mesmos leads e clientes novos por buscador (Google, Bing, DuckDuckGo…) e por assistente; lead sem endereço de origem aparece como "Sem endereço de origem". |
| Comparação | A mesma conta no período anterior: "vs. mês anterior" ou "vs. N dias anteriores". Com a chave desligada, a linha some. |

Sem base, o indicador mostra "Sem dados" (nunca 0), a tabela "—" e o gráfico "Sem dados". Nenhum dado pessoal
passa pela tela: só contagens.

## De onde vem cada bloco (e o que ainda é exemplo)

- **Search Console** (impressões, cliques, CTR, posição) e **GA4** (sessões por assistente) já existem em `Dados`
  (`seoDaily`, `geoDaily`); leads e clientes novos vêm de `leads` (réplica do CSP 360).
- **As consultas, as sessões por canal do GA4 e a checagem dos sites ainda não existem em `Dados`.** A consulta
  recebe esses três como `ComplementosSeoGeo`. No modo demonstração com dados de exemplo, `painelSeoGeo` os gera
  a partir do próprio conjunto, de forma determinística (as consultas repartem as impressões e os cliques de cada
  dia sem passar do total; o canal "Assistente de IA" é a soma exata de `geoDaily`; a checagem traz um site com
  dois itens em atenção e outro todo em ordem). Fora desse modo, vêm vazios e os três blocos mostram "Sem dados":
  a tela nunca põe número inventado ao lado de número real. Quando `Dados` e o gerador de `sample/` ganharem
  esses campos, os complementos saem da consulta.
- A checagem de exemplo usa só o que se sabe dos sites: o robots.txt libera todos os robôs; o llms.txt e o
  JSON-LD aparecem num site e não no outro.

## Estados

| Estado | Como forçar | O que aparece |
|---|---|---|
| Carregando | `?estado=carregando` | Esqueleto de 4 indicadores e 2 gráficos (`aria-busy`). A barra de filtros continua. |
| Vazia | `?estado=vazio` ou sem dados de exemplo | Ícone de busca, "Nenhum número de SEO e GEO ainda", "Os números chegam do Search Console e do GA4 uma vez por dia, depois que os conectores ligarem." e o botão "Ver conectores". |
| Erro | `?estado=erro` | "Não deu para carregar", "Tente de novo em alguns segundos. Se continuar, veja os conectores.", botão "Tentar de novo" (tira o `?estado=`) e "Código DEMO-500". |
| Sem dados | `?estado=sem-dados`, ou uma fonte sem número nenhum | A tela inteira com cada indicador em "Sem dados", cada gráfico em "Sem dados — Nenhum número no período para este gráfico.", as tabelas e a checagem em "Sem dados" com de onde o número vem. O aviso fixo de GEO continua. |
| Sucesso | sem parâmetro, com dados de exemplo | As quatro seções com números, comparação, gráficos com "Ver como tabela", tabelas e a checagem. |
| Período sem consulta ou sem lead | período curto | Indicadores normais; no lugar da tabela, "Nenhuma consulta no período" ou "Nenhum lead da busca ou de IA no período", com "Escolha um período maior em Período…". |
| Conector atrasado ou caído | estado do cartão em Conectores | Aviso amarelo ou vermelho dentro da seção da fonte, com a data da última sincronização e "Ver conectores"; o selo do canto mostra o estado em `.yn-badge`. |

"atualizado há X" na barra do topo é a sincronização **mais antiga** entre Search Console, GA4 e CSP 360 (as que
já sincronizaram), para nunca prometer frescor que um bloco não tem; cada seção mostra a da sua fonte.

## Textos

| Onde | Texto |
|---|---|
| Ação principal | "Abrir o Search Console" (dica "Abre o Search Console em outra aba"; para leitor de tela, "(abre em outra aba)") |
| Aviso fixo de GEO (azul) | **A medição de GEO é parcial** — "Entram aqui só as visitas e os leads que chegaram clicando num assistente de IA: quando a IA cita a marca e a pessoa não clica, nada aparece. As impressões em AI Overviews e no AI Mode só existem no relatório "Generative AI performance" do Search Console, sem API. Confira uma vez por mês em Abrir o Search Console." |
| Conector atrasado (amarelo) | **O {Search Console / GA4 / CSP 360} está atrasado** — "A última sincronização foi em DD/MM/AAAA HH:MM. Os números desta seção podem estar desatualizados." + "Ver conectores" |
| Conector caído (vermelho) | **O {…} parou de sincronizar** — "A última sincronização foi em DD/MM/AAAA HH:MM. Os números desta seção são dessa sincronização." (ou "O conector ainda não sincronizou.") + "Ver conectores" |
| Gestor, com pendência (amarelo) | **Pendências que travam a medição** — lista "{título} · {marca}" (ex.: "GA4 sem ID no site · Corpo Sensual") + "Busca orgânica e assistentes de IA não têm operador nem verba: Humano × Claude e o limite de gasto ficam nos anúncios." + "Ver em Tráfego com IA" |
| Gestor, sem pendência (azul) | **SEO e GEO não têm operador nem verba** — "Humano × Claude e o limite de gasto ficam nos anúncios." + "Ver Google Ads" |
| Selo da seção | "Search Console · atualizado há X h" · "GA4" + `.yn-badge` "Simulado" · "CSP 360 · atualizado há X min" |
| Tabela de consultas | "Consultas que mais trazem — As buscas com mais cliques no período. O Search Console esconde as consultas raras, então a soma fica abaixo do total." · "N consultas · X% dos cliques do período" |
| Vazios das tabelas | "Sem dados — As consultas chegam do Search Console uma vez por dia." · "Nenhuma consulta no período — Escolha um período maior em Período para ver as consultas." · "Sem dados — Os leads chegam do CSP 360 a cada 5 minutos." · "Nenhum lead da busca ou de IA no período — Escolha um período maior em Período para ver de onde vieram." |
| Checagem | "Em ordem" · "Atenção" · "Conferido em DD/MM/AAAA HH:MM · N itens pedem atenção" / "· Tudo em ordem" · vazio "Sem dados — A checagem roda uma vez por dia e confere o robots.txt, o llms.txt e o JSON-LD de cada site." |
| Detalhes da checagem (exemplo) | "Libera todos os robôs, inclusive os de IA (GPTBot, ClaudeBot e PerplexityBot)." · "Não encontrado em /llms.txt. Publique um resumo do site para os assistentes de IA." · "Nenhum JSON-LD na página inicial. Descreva a empresa e os produtos com dados estruturados." · "Publicado em /llms.txt." · "JSON-LD em todas as páginas conferidas." |

"Ver conectores" só aparece para quem pode ver Conectores (`ver_conectores`); "Ver em Tráfego com IA", para
quem pode ver Tráfego com IA (`ver_trafego_ia`). Na v1, os dois papéis podem.

## Visão: Visualizador · Gestor de tráfego

Busca orgânica e assistentes de IA não têm operador (Humano × Claude), verba nem limite de gasto, então a Visão
não muda os números desta tela. Em **Gestor de tráfego** aparece, acima das seções, o aviso com as pendências
que travam a medição (as mesmas da lista "O que podemos fazer" de Tráfego com IA, pela marca escolhida) e o
link para lá. Em **Visualizador**, só números, sem ação.

## Filtros

Marca (menu) e período (barra) valem para tudo. Os filtros de lead que chegarem pela URL (`?origem=`,
`?representante=`, `?canal=`…) aparecem como chip ativo na barra e valem só para os leads e clientes novos;
Search Console e GA4 respondem a marca e período.

## Responsivo e temas

- **1280px**: indicadores até 4 por linha, os dois gráficos de cada seção lado a lado, tabelas completas e os
  dois cartões da checagem lado a lado. Sem rolagem lateral.
- **375px**: tudo empilhado, 1 indicador por linha, gráficos na largura toda, as duas tabelas viram cards
  (a consulta ou a fonte é o título do card) e os cartões da checagem empilham. Sem rolagem lateral na página
  (as tabelas de "Ver como tabela" rolam de lado dentro do próprio quadro).
- Conferida no protótipo em 30/10/2026 em 1280px e 375px, claro e escuro, nos cinco `?estado=`, com "As duas",
  uma marca só e a visão Gestor de tráfego.

## As 8 perguntas de UX (seção 7 do padrão)

1. **Qual é a uma ação principal, e ela é o botão mais forte, no alcance do dedo?** Abrir o Search Console para a
   leitura mensal de AI Overviews e AI Mode: é o único `.yn-btn--primary`, na barra do topo (no celular desce
   para a linha de baixo do título, sempre à vista). O resto é leitura.
2. **Funciona como os sites que a pessoa já usa?** Sim: os nomes e as contas do Search Console (impressões,
   cliques, CTR, posição ponderada) e do GA4 (sessões, canais); tabela que ordena pelo título da coluna; gráficos
   com legenda e "Ver como tabela".
3. **Dá para entender os grupos sem ler tudo?** Uma seção por fonte (Search Console, GA4, CSP 360, sites), com
   rótulo, linha separando e o selo da fonte no canto; dentro, indicadores, depois gráficos, depois tabela.
4. **Tem algo que dá para tirar?** Tirados: filtros que não valem aqui (canal, campanha, operador), a contagem de
   leads do GA4 por assistente (o lead vem do CSP 360, dono do dado: dois "leads" diferentes confundiriam), a
   variação em cada linha das tabelas e o aviso de conector simulado (o selo já diz).
5. **O sistema fez o trabalho chato e aceitou o que a pessoa digitou?** A posição já vem ponderada, a parcela de
   IA já calculada, cada lead já classificado pelo endereço de origem e o buscador ou assistente já nomeado; a
   tela abre em "Este mês" comparando com o anterior e na marca da última escolha. Não há o que digitar.
6. **Como fica quando demora, quando dá errado e quando dá certo?** Esqueleto enquanto carrega; erro com
   "Tentar de novo" e código; conector atrasado ou caído com aviso na seção, data da última sincronização e link;
   "Sem dados" quando falta base; sucesso com os números e a comparação.
7. **A pessoa sabe o que falta e até quando?** "atualizado há X" no topo (a fonte mais atrasada) e em cada
   seção; a checagem diz quantos itens pedem atenção e o que fazer; a visão Gestor lista as pendências que travam
   a medição. Não há meta de SEO ou GEO na v1; quando houver, vira `.yn-meter`.
8. **O mais importante está no começo do menu e no topo da lista?** Pendências no topo quando a visão é Gestor;
   a busca orgânica (a fonte que já mede) primeiro, IA depois, conversão em leads e clientes em seguida e a
   checagem por último; consultas e fontes abrem pelo maior número.

## Para decidir na fase 3

- **Tabelas que faltam em `Dados`**: consultas diárias do Search Console (`seo_query_daily`: marca, dia, consulta,
  impressões, cliques, posição), sessões diárias por canal do GA4 (`ga4_channel_daily`, com o grupo de canais do
  CSP-MKT criado em cada propriedade) e a checagem diária dos sites (`site_checks`: marca, host, item, estado,
  detalhe, conferido em), feita pelo worker. Com elas, os complementos de exemplo saem de `queries/seo-geo.ts`
  para `sample/`.
- **Listas fechadas** desta tela (canal do GA4, item e estado da checagem) e o host → assistente de IA
  (`assistenteDoHost`) vão para `packages/shared` (`labels.ts` e `rules.ts`), junto de `ehAssistenteDeIa`.
- **Leitura mensal de AI Overviews e AI Mode**: decidir se o número lido à mão é registrado no CSP-MKT (tabela
  própria e um campo nesta tela) ou fica só no Search Console.
- **Cliente novo**: esta tela conta pelo dia do 1º pedido enviado (como a Visão geral e `seoGeo()`); `leadsPorOrigem`
  conta, dos leads do período, os que já viraram cliente. Fixar uma definição por indicador nas views.
- **Lead do GA4 por assistente** (`geoDaily.leads`, evento `generate_lead`): fica fora da tela enquanto o lead do
  CSP 360 for a contagem oficial; decidir se entra como "formulários enviados" no GA4.
- **Nome do relatório** de IA generativa na interface em português do Search Console, para o aviso usar o nome que
  a pessoa vê.

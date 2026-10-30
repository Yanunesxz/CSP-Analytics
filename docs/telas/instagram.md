# Instagram — `/instagram`

> Grupo **Canais** do menu, ícone `camera`. Todos os papéis veem. **Só leitura na v1**: publicar, agendar,
> comentários e mensagens ficam fora (CLAUDE.md, "Fica fora da primeira versão").
> Tela: `apps/web/src/modules/instagram/` · consulta: `apps/web/src/data/queries/instagram.ts`
> (`painelInstagram`, parte de `instagram()` de `queries.ts`, com teste em `instagram.test.ts`).

## O que a pessoa faz nesta tela

- Vê como cada perfil (Corpo Sensual e Plumene) foi no período: seguidores e o saldo do período, alcance,
  impressões, engajamento, taxa de engajamento e salvos, cada um comparado com o período anterior.
- Vê a tendência de seguidores e de alcance dia a dia, com os dois perfis no mesmo gráfico.
- Acha os posts que mais alcançaram, mais engajaram e mais foram salvos.

## Ação principal

**Comparar os perfis no período e achar os posts que mais renderam.** É uma tela de leitura: não há botão
principal (`.yn-btn--primary`), porque a v1 só lê o Instagram. O controle mais usado é o **Período**, o
primeiro item da barra de filtros; a marca vem do seletor **Marca** do menu e segue a pessoa entre as telas.

## Como a tela está montada (de cima para baixo)

1. **Barra de filtros**: Período (padrão "Este mês"), chave "Comparar com o anterior" e botão "Filtros".
   O Instagram só se filtra por marca e período (não tem canal, campanha, operador, origem nem
   representante), então o painel "Filtros" mostra só "Meus filtros" (conjuntos salvos de período).
2. **Avisos**, só quando acontecem (ver "Textos").
3. **Perfis**: um bloco por marca, com o nome e o ponto da cor da marca (decisão 0007), a linha
   "N posts publicados no período" e seis indicadores: Seguidores, Alcance, Impressões, Engajamento,
   Taxa de engajamento e Salvos. Em **As duas** os dois blocos ficam lado a lado; com uma marca escolhida,
   só o bloco dela, na largura toda.
4. **Gráficos**, lado a lado: "Seguidores por dia" e "Alcance por dia", uma linha por perfil na cor da marca,
   com legenda e "Ver como tabela".
5. **Posts do período**: tabela do maior para o menor alcance. Colunas: Post (miniatura sem imagem real, só
   o formato do post com `aspect-ratio`, a legenda cortada com a inteira na dica, e o perfil em "As duas"),
   Tipo, Data, Alcance, Engajamento (com "X% do alcance" embaixo e curtidas, comentários e salvos na dica)
   e Salvos. O título de Tipo, Data, Alcance, Engajamento e Salvos reordena a tabela.

## O que cada número quer dizer

| Número | Conta (na consulta, nunca na tela) |
|---|---|
| Seguidores | Total no último dia do período que tem número. A linha de baixo é o saldo do período: último dia − dia anterior ao início ("+N no período", "-N no período" ou "Sem variação no período"). |
| Alcance | Soma do alcance diário do perfil no período (a mesma conta em dois dias conta duas vezes). |
| Impressões | Soma das impressões diárias do perfil no período. |
| Engajamento | Soma do engajamento diário do perfil no período. |
| Taxa de engajamento | Engajamento ÷ alcance do período. |
| Salvos | Salvos dos posts publicados no período. |
| Engajamento do post | Curtidas + comentários + salvos do post; a taxa do post é esse engajamento ÷ alcance do post. |
| Comparação | A mesma conta no período anterior: "vs. mês anterior" ou "vs. N dias anteriores". Com a chave desligada, a linha some. |

Sem base, o indicador mostra "Sem dados" (nunca 0) e a tabela mostra "—".

## Estados

| Estado | Como forçar | O que aparece |
|---|---|---|
| Carregando | `?estado=carregando` | Esqueleto de 4 indicadores e 2 gráficos (`aria-busy`). A barra de filtros continua. |
| Vazia | `?estado=vazio` ou sem dados de exemplo | Ícone de câmera, "Nenhum número do Instagram ainda", "Os números dos perfis aparecem aqui depois que o conector do Instagram sincronizar." e o botão "Ver conectores". |
| Erro | `?estado=erro` | "Não deu para carregar", "Tente de novo em alguns segundos. Se continuar, veja os conectores.", botão "Tentar de novo" (tira o `?estado=`) e "Código DEMO-500". |
| Sem dados | `?estado=sem-dados`, ou o conector do Instagram sem número nenhum | Aviso "O Instagram ainda não mandou números"; cada indicador em "Sem dados"; os dois gráficos em "Sem dados — Nenhum número no período para este gráfico."; posts em "Sem dados — Nenhum post chegou do Instagram para este período." |
| Sucesso | sem parâmetro, com dados de exemplo | Os blocos dos perfis com os números e a comparação, os dois gráficos e a tabela de posts. |
| Período sem posts | Período curto sem publicação | Os indicadores normais e, no lugar da tabela, "Nenhum post no período — Escolha um período maior em Período para ver os posts." |
| Conector atrasado ou caído | estado do cartão Instagram em Conectores | Aviso amarelo ou vermelho no topo do conteúdo, com a data da última sincronização e o link "Ver conectores". |

"atualizado há X min" na barra do topo vem da última sincronização do conector do Instagram (de hora em
hora); sem o cartão do conector, vem da última atualização dos dados.

## Textos

| Onde | Texto |
|---|---|
| Linha do perfil | "N posts publicados no período" · "1 post publicado no período" · "Nenhum post publicado no período" |
| Indicador Seguidores | "+N no período" · "-N no período" · "Sem variação no período" |
| Aviso conector caído (vermelho) | **O Instagram parou de sincronizar** — "A última sincronização foi em DD/MM/AAAA HH:MM. Os números abaixo são dessa sincronização." + "Ver conectores" |
| Aviso conector atrasado (amarelo) | **O Instagram está atrasado** — "A última sincronização foi em DD/MM/AAAA HH:MM. Os números podem estar desatualizados." + "Ver conectores" |
| Aviso sem números (azul) | **O Instagram ainda não mandou números** — "Os números dos perfis aparecem aqui depois que o conector do Instagram sincronizar." + "Ver conectores" |
| Aviso na visão Gestor de tráfego (azul) | **Post orgânico não tem operador nem verba** — "Humano × Claude e o limite de gasto ficam nos anúncios. Os anúncios no Instagram são da Meta." + "Ver Meta Ads" |
| Gráficos | "Seguidores por dia — Total de seguidores no fim de cada dia." · "Alcance por dia — Contas alcançadas em cada dia." · "Ver como tabela" |
| Tabela | "Posts do período — Do maior para o menor alcance." · "N posts" · "X% do alcance" · dica "N curtidas, N comentários e N salvos" · botões "Ordenar por …" |
| Vazio da tabela | "Nenhum post no período — Escolha um período maior em Período para ver os posts." |

O link "Ver conectores" só aparece para quem pode ver Conectores (`ver_conectores`; na v1, os dois papéis).

## Visão: Visualizador · Gestor de tráfego

A Visão não muda os números desta tela: o Instagram orgânico não tem operador (Humano × Claude), verba nem
limite de gasto. Em **Gestor de tráfego** aparece só o aviso que leva a **Meta Ads**, onde ficam os anúncios
no Instagram com o Humano × Claude. Em **Visualizador**, só números, sem ação.

## Responsivo e temas

- **1280px**: os dois perfis lado a lado (2 indicadores por linha em cada um), os dois gráficos lado a lado e a
  tabela com 6 colunas sem rolar de lado. Com uma marca só, os indicadores ficam até 4 por linha.
- **375px**: tudo empilhado (Corpo Sensual primeiro), 1 indicador por linha, gráficos na largura toda e a tabela
  vira cards (a legenda do post é o título do card). Sem rolagem lateral na página. No celular os títulos das
  colunas ficam escondidos, então os posts seguem na ordem do alcance.
- Conferida no protótipo em 30/10/2026 em 1280px e 375px, claro e escuro, nos cinco `?estado=`, com
  "As duas", uma marca só e a visão Gestor de tráfego.

## As 8 perguntas de UX (seção 7 do padrão)

1. **Qual é a uma ação principal, e ela é o botão mais forte, no alcance do dedo?** Ler e comparar os perfis
   no período. Não há botão principal porque a v1 só lê o Instagram; o Período é o primeiro controle do
   conteúdo e a marca está no menu (gaveta no celular). Nada de ação escondida.
2. **Funciona como os sites que a pessoa já usa?** Sim: os mesmos números e nomes do Instagram (seguidores,
   alcance, impressões, engajamento, salvos), tabela que ordena pelo título da coluna como uma planilha,
   gráfico com legenda e "Ver como tabela".
3. **Dá para entender os grupos sem ler tudo?** Um bloco por perfil, com o nome e a cor da marca; os
   gráficos juntos; os posts numa seção própria; 24px entre os blocos.
4. **Tem algo que dá para tirar?** Tirado: filtros que não valem para o Instagram (canal, operador, origem),
   colunas de curtidas e comentários (estão na dica do engajamento) e um indicador só de "posts" (virou a
   linha do perfil). Ficou o que a especificação pede.
5. **O sistema fez o trabalho chato e aceitou o que a pessoa digitou?** O saldo de seguidores, a taxa de
   engajamento e o engajamento de cada post já vêm somados; a tela abre em "Este mês" comparando com o
   anterior e na marca que a pessoa escolheu por último. Não há o que digitar.
6. **Como fica quando demora, quando dá errado e quando dá certo?** Esqueleto enquanto carrega; erro com
   "Tentar de novo" e código; conector atrasado ou caído com aviso, data da última sincronização e link;
   "Sem dados" quando falta base; sucesso com os números e a comparação.
7. **A pessoa sabe o que falta e até quando?** "atualizado há X min" da última sincronização do Instagram e o
   aviso de atraso dizem até quando os números valem. Não há meta de Instagram na v1, então não há "quanto
   falta"; quando entrar meta, vira `.yn-meter`.
8. **O mais importante está no começo do menu e no topo da lista?** Avisos acima de tudo quando existem;
   Seguidores é o primeiro indicador de cada perfil; os posts abrem pelo maior alcance.

## Para decidir na fase 3

- **Impressões × visualizações**: a Meta passou a trocar `impressions` por `views` nas métricas do Instagram
  em 2025. Conferir na fase 3 se o indicador "Impressões" vira "Visualizações" (e o campo de `ig_account_daily`).
- **Alcance do período**: hoje é a soma do alcance diário. Decidir se a view usa o alcance único do
  intervalo, quando a API devolver esse total, e se o nome muda.
- **Engajamento do post** não tem compartilhamentos (o modelo de post não tem esse campo).
- **Link para o post** (permalink) na tabela quando o conector existir.
- **Visão Gestor de tráfego**: se deve ganhar "Propor impulsionar post" (viraria ideia em Tráfego com IA).

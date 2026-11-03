# Visão geral — rota `/`

> Módulo `apps/web/src/modules/visao-geral` · consulta `apps/web/src/data/queries/visao-geral.ts` (com teste) ·
> textos que dependem dos números em `modules/visao-geral/textos.ts` (com teste). Tarefa principal: **T1**.
> Contrato técnico em [`00-contrato.md`](00-contrato.md); índice das telas em [`README.md`](README.md).

## O que a pessoa faz aqui

- **Abre o sistema e já sabe quanto custou cada cliente novo** no mês, por marca e por canal, comparado ao mês
  anterior, sem tocar em nada (T1).
- Vê o resto do período num lugar só: clientes novos, leads, investimento, pedidos enviados e o valor deles, valor
  faturado e alcance no Instagram. Cada indicador leva à tela que trabalha o número.
- Troca o período, liga ou desliga a comparação e filtra por canal ou operador na barra de filtros; troca a marca no
  menu lateral.
- Na visão **Gestor de tráfego**: compara Humano × Claude, confere a verba e o limite de gasto de cada conta e abre
  o Tráfego com IA.

## Ação principal

**Abrir Tráfego com IA** — botão principal na barra do topo, só na visão Gestor de tráfego e só para quem pode ver
Tráfego com IA (`pode(papel, 'ver_trafego_ia')`), com o número de propostas esperando aprovação.

Na visão Visualizador a tela não tem botão principal: ela só mostra números (regra da Visão). O ponto de partida é
o primeiro indicador, **Custo por cliente novo**, no topo à esquerda; tocar nele abre Chegada de clientes já rolada
até o custo por marca e canal.

## Caminho da T1

| Pergunta | Caminho | Toques |
|---|---|---|
| Quanto custou o cliente novo neste mês, comparado ao anterior? | Indicador "Custo por cliente novo", com a variação contra os mesmos dias do mês anterior ("vs. 1º a 3 de outubro", decisão 0026) | 0 |
| E por marca e por canal? | Tabelas "Por marca" e "Por canal" do bloco "Custo por cliente novo", logo depois dos indicadores nas duas visões, com a variação embaixo de cada custo | 0 |
| Marca × canal cruzados | Tocar no indicador "Custo por cliente novo" → Chegada de clientes em `#custo-por-cliente-novo` (a matriz) | 1 |
| Só uma marca, por canal | Tocar no nome da marca na tabela "Por marca" → Chegada de clientes daquela marca, no mesmo bloco | 1 |
| Só uma marca, a tela toda | Marca no menu → Corpo Sensual ou Plumene (em 375px: ☰ → Marca → a marca → fechar a gaveta) | 2 (4) |

## O que aparece, de cima para baixo

1. **Barra de filtros** (componente comum): período ("Este mês" por padrão), "Comparar com o anterior", filtros
   rápidos **Meta Ads · TikTok Ads · Google Ads** (na visão Gestor, também **Humano · Claude**) e o botão
   **Filtros** com canal e operador. Tudo na URL.
2. **Oito indicadores** do período, em grade de até 4 por linha:

   | Indicador | Leva a | Observação |
   |---|---|---|
   | Custo por cliente novo | Chegada de clientes, já no custo por marca e canal (`#custo-por-cliente-novo`) | Cair é verde, subir é vermelho |
   | Clientes novos | Chegada de clientes | 1º pedido enviado, um por cliente (decisão 0012) |
   | Leads | Leads | Todas as origens, incluindo os sem marca |
   | Investimento | Chegada de clientes, no custo por marca e canal (ou a tela do canal, com filtro de canal) | Variação sem cor: gastar mais não é bom nem ruim |
   | Pedidos enviados | Base de clientes | |
   | Valor dos pedidos | Base de clientes | |
   | Valor faturado | Chegada de clientes | "Sem dados" até o Control abrir o faturamento; a nota diz quantos pedidos já foram faturados |
   | Alcance no Instagram | Instagram | |

   Os links levam a marca, a visão, o período e, nas telas que filtram por eles, o canal e o operador.
3. **Notas** embaixo dos indicadores (ver Textos).
4. **Custo por cliente novo** (a T1, logo depois dos números nas duas visões): tabela **Por marca** (só em "As
   duas") e tabela **Por canal** (só sem filtro de canal), com investimento, leads, clientes novos e custo por
   cliente novo, todos de campanha (pela UTM), e a variação embaixo do custo. A marca leva ao custo daquela marca
   por canal, na Chegada de clientes (`#custo-por-cliente-novo`); o canal, à tela do canal. No celular as tabelas
   viram cartões.
5. *(Gestor)* **Humano × Claude**: a mesma linha para os dois, lado a lado, com "Claude vs. Humano" em %:
   investimento, parcela da verba, campanhas ativas, leads (plataformas), custo por lead (plataformas), clientes
   novos, custo por cliente novo e ROAS. Em custo e ROAS a diferença diz "melhor" ou "pior" em texto.
6. *(Gestor)* **Verba e limite de gasto por conta**: uma linha por marca, um cartão por plataforma, com a régua do
   investimento do período contra a soma dos limites das campanhas ativas, a verba diária e quantas campanhas
   estão ativas. Selo **Perto do limite** a partir de 90% e **Acima do limite** a partir de 100%. Na frase do
   bloco, **Ver limites em Tráfego com IA** (aba "Limites de gasto", onde o limite muda; só para quem vê o módulo).
7. **Gráficos**, lado a lado no computador: **Custo por cliente novo por canal** (barras na cor de cada canal; só
   sem filtro de canal) e **Leads e clientes novos por dia** (linhas em tons neutros, porque a cor de série só
   identifica marca, canal e operador — decisão 0007). Os dois com "Ver como tabela".

## Estados

| Estado | Como forçar | O que aparece |
|---|---|---|
| Carregando | `?estado=carregando` | Esqueleto da tela (quatro indicadores e dois gráficos), com `aria-busy` |
| Vazia | `?estado=vazio` ou sem dados de exemplo | "Nenhum número ainda", o próximo passo e o botão "Ver conectores" |
| Erro | `?estado=erro` | "Não deu para carregar", "Tentar de novo" (tira o `?estado=`) e "Código DEMO-500" |
| Sem dados | `?estado=sem-dados` | A tela inteira: cada indicador em "Sem dados", tabelas com "—", réguas em "Sem dados" e os dois gráficos em "Sem dados" — nunca 0 |
| Sucesso | sem parâmetro, com dados de exemplo | Números, variações, tabelas, réguas e gráficos; "atualizado há X min" embaixo do título |

A barra de filtros fica visível em todos os estados. Na visão Gestor, o botão "Abrir Tráfego com IA" também (sem o
contador enquanto carrega ou com erro).

## Textos

Botões e links:

- **Abrir Tráfego com IA** — com o contador de propostas; o leitor de tela ouve ", N propostas esperando aprovação".
- **Ver conectores** — no estado vazio.
- **Tentar de novo** — no erro.
- **Ver como tabela** — em cada gráfico.
- **Ver limites em Tráfego com IA** — na visão Gestor, na frase do bloco de verba e limite.
- Os indicadores e os nomes de marca e de canal nas tabelas são links ("Ver custo por cliente novo",
  "Ver o custo de Plumene por canal", "Ver Meta Ads" na dica).

Avisos e notas:

| Quando | Texto |
|---|---|
| Sempre | "Custo por cliente novo divide o investimento pelos N clientes novos que vieram de campanha (pela UTM)." (com 1: "pelo 1 cliente novo que veio de campanha"; com 0: "Nenhum cliente novo veio de campanha (pela UTM) no período: o custo por cliente novo fica sem dados.") |
| Sem filtro de canal, operador ou campanha | "Clientes novos conta todas as origens." |
| Há leads sem marca no período | "N leads sem marca (SDR · WhatsApp) entram no total." — com uma marca escolhida: "…aparecem aqui e na outra marca." |
| Com filtro de canal, operador ou campanha | "Pedidos, valor faturado e alcance no Instagram não separam canal, operador nem campanha: valem para as duas marcas." (ou "a marca toda") |
| Valor faturado | "N pedidos faturados. O valor chega com o Control." — sem base: "O valor chega quando o Control abrir o faturamento." |
| Indicador sem base | "Sem dados" + "Sem base vs. mês anterior" (com "Comparar com o anterior" desligado: "Sem base para calcular") |
| "Comparar com o anterior" desligado | Some a variação de todo indicador e de toda tabela; nenhum texto fala do período anterior |
| Humano × Claude | "Cada campanha tem um dono. A última coluna mostra quanto o Claude ficou acima ou abaixo do Humano no período." |
| Verba e limite | "Investimento do período nas campanhas ativas de cada conta, contra a soma dos limites de gasto delas." · "Verba diária R$ X · N campanhas ativas" · "Sem campanha ativa" · "Perto do limite" · "Acima do limite" |
| Custo por marca e canal | "Leads e clientes novos que vieram de campanha (pela UTM). Embaixo de cada custo, a variação vs. mês anterior." |
| Gráfico de barras | "Investimento do canal ÷ clientes novos que vieram das campanhas dele." |
| Gráfico de linhas | "Todas as origens. O cliente novo conta no dia do 1º pedido enviado." — com filtro: "Só o que passa pelos filtros. …" |
| Gráfico sem número | "Sem dados" + "Nenhum número no período para este gráfico." |

## Regras de número

Toda conta vive em `data/queries/visao-geral.ts`, que junta `kpisVisaoGeral`, `custoPorClienteNovo`, `porOperador`
e `acoes` de `data/queries.ts` (as futuras views `kpi_*`). A tela não soma linhas.

- Custo por cliente novo = investimento ÷ clientes novos que vieram de campanha (decisões 0009 e 0012). Por isso o
  indicador "Clientes novos" (todas as origens) não divide o investimento: a nota diz qual é o divisor.
- Leads e clientes novos por dia somam exatamente os indicadores do período (o teste confere em oito recortes).
- Em Humano × Claude, leads e custo por lead são os que as plataformas contam, por isso o rótulo "(plataformas)":
  o indicador "Leads" da mesma tela vem do CSP 360.
- Verba e limite por conta usam só as campanhas ativas; o alerta é `perto` a partir de 90% (`LIMITE_DE_ALERTA`) e
  `acima` a partir de 100%.
- Marca escolhida inclui o lead sem marca (decisão 0003); "As duas" conta cada cliente uma vez.

## Responsivo e temas

- **1280px:** quatro indicadores por linha; tabelas inteiras; os dois gráficos lado a lado; na visão Gestor, três
  cartões de conta por marca.
- **375px:** um indicador por linha; as tabelas viram cartões (`.yn-table--stack` dentro de `.yn-container`); os
  gráficos empilham; sem rolagem lateral na página (conferido: `scrollWidth` = `clientWidth`). Só a tabela do
  "Ver como tabela" rola de lado dentro do próprio quadro, como o padrão permite.
- **Claro e escuro:** só tokens e classes `yn-*`; as linhas do gráfico diário usam `--color-silver` e
  `--color-text`, que trocam com o tema.

## As 8 perguntas de UX (seção 7)

1. **Qual é a ação principal, e ela é o botão mais forte, no alcance do dedo?** Na visão Gestor, "Abrir Tráfego com
   IA", o único `.yn-btn--primary` da tela, na barra do topo, com o contador de propostas. Na visão Visualizador não
   há ação de gravar: o número da T1 é o primeiro indicador, o maior texto do topo, e é tocável inteiro.
2. **Funciona como os sites que a pessoa já usa?** Painel no formato dos gerenciadores de anúncio: indicadores no
   topo com a variação, tabelas por marca e canal, gráficos com legenda; card e nome são links, como em qualquer
   painel; filtros em cima, menu à esquerda.
3. **Dá para entender os grupos sem ler tudo?** Quatro blocos com título: os números do período, custo por cliente
   novo por marca e por canal, (Gestor) Humano × Claude e verba por conta, e os gráficos. Na verba, uma linha por
   marca.
4. **Tem algo que dá para tirar?** Tabela de uma linha só some (marca ou canal já escolhidos); o gráfico de barras
   some com filtro de canal; o bloco do gestor só aparece na visão Gestor. Custo por lead e a matriz marca × canal
   ficam em Chegada de clientes e nas telas de canal.
5. **O sistema fez o trabalho chato e aceitou o que a pessoa digitou?** O período já abre em "Este mês" comparando
   com o anterior; o custo vem pronto por marca e canal; a nota diz qual é o divisor do custo e o que o filtro não
   alcança; os links levam os filtros junto e o de custo abre a Chegada de clientes já no bloco certo. Não há campo
   para digitar.
6. **Como fica quando demora, quando dá errado e quando dá certo?** Esqueleto enquanto carrega; "Não deu para
   carregar" com "Tentar de novo" e código no erro; "Nenhum número ainda" com o caminho para Conectores quando está
   vazia; "Sem dados" em cada número sem base; e, dando certo, os números com "atualizado há X min".
7. **A pessoa sabe o que falta e até quando?** A régua mostra quanto do limite de gasto cada conta já usou, com
   "Perto do limite" e "Acima do limite" e o link para onde o limite muda; o contador diz quantas propostas esperam
   aprovação; o valor faturado diz que chega com o Control.
8. **O mais importante está no começo do menu e no topo da lista?** Visão geral é o primeiro item do menu; Custo
   por cliente novo é o primeiro indicador e o custo por marca e por canal é o primeiro bloco depois dos números,
   nas duas visões (a T1 não muda de lugar quando a pessoa troca a Visão); na visão Gestor, Humano × Claude e a
   verba vêm logo depois. Em 375px os oito indicadores ficam um por linha antes das tabelas (pendência de desenho
   no [índice](README.md)).

## Fica para depois

- A semântica do limite de gasto (por período, por mês ou vitalício) é da fase 3: hoje a régua compara o
  investimento do período com a soma dos `spendCapCents` das campanhas ativas, e em 90 dias passa de 100%.
- Em 375px, os oito indicadores um por linha empurram o custo por marca e por canal para depois de cerca de duas
  telas de rolagem: dividir os indicadores em "Aquisição" (antes do custo) e "Venda e alcance" (depois), ou dois por
  linha no celular. Decisão de desenho, no [índice](README.md).

`tela.test.ts` desenha a tela no servidor e confere os destinos dos links da T1, a ordem dos blocos na visão Gestor
e que, sem comparação, nenhum texto fala do período anterior.

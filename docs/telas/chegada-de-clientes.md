# Chegada de clientes (`/chegada`)

> Grupo **Clientes** do menu, ícone `users` · todos os papéis que entram no sistema.
> Tela: `apps/web/src/modules/chegada-de-clientes/` · consulta: `apps/web/src/data/queries/chegada-de-clientes.ts`
> (`chegadaDeClientes`, composta por cima de `kpisVisaoGeral`, `funilChegada`, `custoPorClienteNovo`,
> `porOperador` e `leadsPorOrigem` de `queries.ts`, com teste em `chegada-de-clientes.test.ts`) ·
> contrato: [`00-contrato.md`](00-contrato.md).

## O que a pessoa faz nesta tela

- Sabe **quanto custou cada cliente novo por marca e por canal** no período, comparado com o período
  anterior (tarefa T1 do [índice](README.md), o número de sucesso do sistema).
- Vê o **caminho dos leads** do período: lead → prospecto no CRM → cadastro → 1º pedido enviado → faturado,
  quanto passou de uma etapa para a outra e quanto tempo leva do lead ao 1º pedido (tarefa T2).
- Vê **de onde chegam** os leads e quais origens viram cliente: pela UTM do anúncio e, sem UTM, pelo site
  de onde o lead veio (busca orgânica, assistente de IA, site próprio, indicação, direto).
- Compara as **marcas**, os **meses de chegada** (coorte) e os **representantes** (dimensão, não módulo).
- Na visão **Gestor de tráfego**, compara o humano e o Claude nas contas de cliente novo.

Caminho mais curto da T1: na Visão geral, tocar no indicador **Custo por cliente novo** (ou no **Investimento**, ou
no nome de uma marca na tabela "Por marca") abre esta tela já rolada até o bloco "Custo por cliente novo por marca
e canal", o primeiro depois dos indicadores (1 toque). Os links usam a âncora `/chegada#custo-por-cliente-novo`
(`ANCORA_DO_CUSTO` em `src/rotas.ts`); o indicador de custo das telas de canal leva para o mesmo bloco, já no canal.

## Três números parecidos, três perguntas diferentes

| Número | Pergunta | Base |
|---|---|---|
| **Clientes novos** (indicador) | Quantos fizeram o 1º pedido enviado **neste período**? | Data do 1º pedido, um por cliente (decisão 0012). É a mesma conta da Visão geral. |
| **Viraram cliente** (funil, origem, marca, coorte, representante) | Dos leads que **chegaram neste período**, quantos já fizeram o 1º pedido? | Data de chegada do lead. Um lead de setembro que comprou em outubro conta em "Clientes novos" de outubro e em "Viraram cliente" de setembro. |
| **Clientes atribuídos** (custo) | Quantos clientes novos do período vieram de uma campanha? | UTM da campanha (decisão 0009). É o divisor do custo por cliente novo. |

Por isso "Clientes novos ÷ Leads" não é a conversão da tela: a conversão é "Viraram cliente ÷ Leads".

## Ação principal (uma só)

**Ver leads** (botão principal na barra do topo, ícone `inbox`): abre a lista de Leads com os mesmos filtros
desta tela (origem, canal, campanha, operador, representante, além de marca, visão e período). É o próximo
passo natural depois de achar uma etapa ou uma origem fraca. Fora ele, a tela só lê: nenhum botão grava nada.

## O que aparece, de cima para baixo

1. **Barra de filtros**: Período (padrão "Este mês"), chave "Comparar com o anterior", cinco filtros rápidos
   de origem com o ponto da cor da série (Meta Ads, Google Ads, TikTok Ads, Busca orgânica, Assistente de IA)
   e o botão **Filtros**, com Origem, Canal, Campanha, Operador, Representante e **Meus filtros**. A marca vem
   do seletor **Marca** do menu. Tudo fica na URL.
2. **Indicadores** (4): **Leads** · **Clientes novos** · **Leads que viraram cliente** (%) · **Custo por
   cliente novo** (cair é verde). Cada um com a variação contra o período anterior.
3. **Custo por cliente novo por marca e canal**: matriz com uma linha por marca e "As duas" (cada cliente
   contado uma vez) e uma coluna por canal e "Todos os canais"; em cada célula o custo e, embaixo, a variação.
   Com uma marca escolhida no menu some a linha "As duas"; com um canal no filtro some a coluna de total.
   Embaixo, "Ver investimento e clientes atribuídos" abre a conta de cada célula (investimento, clientes
   atribuídos, custo e custo do período anterior).
4. **Humano × Claude** (só na visão Gestor de tráfego): Investimento, Parcela da verba, Clientes novos e Custo
   por cliente novo das campanhas de cada operador, lado a lado, com a diferença em %. Investimento e parcela
   ficam sem cor; clientes e custo ganham verde ou vermelho pelo que é melhor.
5. **Funil dos leads do período**: as cinco etapas em barras (proporcionais aos leads do período), com o total
   e quanto passou da etapa anterior; ao lado, "Do lead ao 1º pedido" (dias, em média), "Entre as outras
   etapas" e quantos leads sem marca (SDR · WhatsApp) entram no funil. "Ver como tabela" mostra etapa, leads,
   da etapa anterior, do total e o período anterior.
6. **Leads por origem** e **Conversão em cliente por origem**, lado a lado (empilham no celular), com a cor da
   série de cada origem e "Ver como tabela".
7. **Por marca** (só com "As duas" no menu): Corpo Sensual e Plumene, cada uma com Leads, Viraram cliente,
   Conversão e Do lead ao 1º pedido. O lead sem marca (SDR) entra nas duas (decisão 0003).
8. **Coorte por mês de chegada**: os últimos 4 meses até o fim do período, com leads, viraram cliente e
   conversão. A tabela não reordena, para manter a linha do tempo.
9. **Por representante**: leads recebidos, viraram cliente, conversão e tempo até o 1º pedido; começa por quem
   mais converteu e reordena pelo título da coluna. Embaixo, quantos leads ainda estão sem representante.

### Filtros que não dividem o custo

O investimento é por campanha. Por isso a consulta trata os filtros assim (função `filtrosDeCusto`):

- **Origem paga** (Meta Ads, TikTok Ads, Google Ads) vale como **canal** para o custo: o filtro "Meta Ads"
  mostra o custo da Meta.
- **Origem não paga** (busca orgânica, assistente de IA, site, SDR, indicação, direto) e **representante** não
  dividem investimento: o indicador de custo mostra "Não se aplica", o bloco de custo explica e oferece tirar
  o filtro, e Humano × Claude não aparece. O resto da tela (leads, funil, quebras) segue o filtro.

## Responsivo

- Computador: indicadores até 4 por linha; os dois gráficos de origem lado a lado; o funil com as barras à
  esquerda e o tempo entre etapas à direita; tudo na largura toda do monitor (conferido em 1280 e 1920px).
- Celular (375px): uma coluna; os filtros rápidos rolam de lado na própria linha; a matriz de custo e as
  tabelas viram cartões (`.yn-table--stack`); as tabelas de "Ver como tabela" rolam de lado dentro do card.
  A página nunca rola de lado (conferido com todas as tabelas abertas).
- Tablet (768px): menu na gaveta, indicadores 3 + 1; tabelas mais largas que o card rolam dentro do card.

## Estados

| Estado | Como forçar | O que aparece |
|---|---|---|
| Carregando | `?estado=carregando` | Barra de filtros e esqueleto da tela (4 indicadores e 2 gráficos, `aria-busy`). O botão "Ver leads" continua na barra do topo. |
| Vazio | `?estado=vazio` ou abrir sem dados de exemplo | Ícone de tomada, **"Nenhum lead ainda"**, "Os leads chegam do CSP 360 pelo conector. Veja se ele está ligado em Conectores." e o botão **Ver conectores**. |
| Erro | `?estado=erro` | **"Não deu para carregar"**, "Tente de novo em alguns segundos. Se continuar, veja os conectores.", botão **Tentar de novo** (tira o `?estado=`) e "Código DEMO-500". |
| Sem dados | `?estado=sem-dados` | Os 4 indicadores com **"Sem dados"** ("Sem base vs. mês anterior") e cada bloco com o vazio "Sem dados" e a frase do bloco (ex.: funil "Nenhum lead no período para montar o funil."). Nunca 0. |
| Sucesso | sem parâmetro, com dados de exemplo | Tudo acima com números, gráficos com "Ver como tabela" e tabelas. |
| Filtro sem lead | ex.: `?canal=meta&origem=google` | Indicadores em 0, funil com **"Nenhum lead neste período"**, "Tire um filtro ou troque o período." e **Limpar filtros**; gráficos de origem em "Sem dados". |
| Custo não se aplica | `?representante=REP-03` ou `?origem=organic` | Indicador "Não se aplica" com a nota; bloco de custo com o aviso e o botão para tirar o filtro. |

## Textos (botões e avisos)

- Barra do topo: eyebrow "Clientes", título "Chegada de clientes", "atualizado há X min", botão **Ver leads**.
- Indicadores: "Leads", "Clientes novos", "Leads que viraram cliente", "Custo por cliente novo";
  variação "+26,1% vs. mês anterior"; sem base: "Sem dados" e "Sem base vs. mês anterior".
- Custo com representante: indicador "Não se aplica" · "O investimento é por campanha, não por representante.";
  bloco "O custo não se divide por representante" · "O investimento é por campanha. Tire o filtro de
  representante para ver o custo por marca e canal." · botão **Tirar filtro de representante**.
- Custo com origem não paga: indicador "Não se aplica" · "Só canal pago tem investimento."; bloco "Esta origem
  não tem investimento" · "Só Meta Ads, TikTok Ads e Google Ads têm custo. Tire o filtro de origem para ver o
  custo por marca e canal." · botão **Tirar filtro de origem**.
- Matriz: "Investimento ÷ clientes novos atribuídos pela UTM da campanha. Abaixo de cada valor, a variação vs.
  mês anterior." · "O traço (—) quer dizer que o canal não teve investimento ou cliente novo atribuído no
  período. "As duas" conta cada cliente uma vez." · **Ver investimento e clientes atribuídos**.
- Humano × Claude: "Campanhas de cada operador no período. Diferença = quanto o Claude está acima ou abaixo do
  humano."
- Funil: "Dos leads que chegaram no período, quantos já passaram por cada etapa. Cliente novo = 1º pedido
  enviado." · "A porcentagem é quanto passou da etapa anterior." · "O CRM ainda não manda a data de cada
  etapa, só a do lead e a do 1º pedido. Faturado hoje é marcado à mão no CRM."
- Origem: "Pela UTM do anúncio; sem UTM, pelo site de onde o lead veio (busca orgânica, assistente de IA)." ·
  "Quantos leads de cada origem já fizeram o 1º pedido enviado."
- Marca: "Leads do período e quantos já viraram cliente em cada marca." · "Os N leads sem marca (SDR ·
  WhatsApp) entram nas duas marcas."
- Coorte: "Leads de cada mês e quantos já viraram cliente até hoje. Os meses mais novos ainda estão
  convertendo."
- Representante: "Leads que cada representante recebeu no período, quantos já viraram cliente e em quantos
  dias, em média." · "N leads do período ainda estão sem representante." · vazio "Nenhum lead com
  representante" · "Os leads deste período ainda não foram passados para um representante."

## As 8 perguntas de UX (seção 7 do padrão)

1. **Qual é a uma ação principal, e ela é o botão mais forte, no alcance do dedo?** "Ver leads", o único
   `.yn-btn--primary`, na barra do topo; no celular ele desce para a linha logo abaixo do título, no topo da
   tela. A tarefa da tela é ler: o número principal (custo por cliente novo) está no 4º indicador e no
   primeiro bloco, sem toque nenhum.
2. **Funciona como os sites que a pessoa já usa?** Filtros no topo como no CRM e na RD Station, período com
   "vs. mês anterior", funil de cima para baixo, "Ver como tabela" em todo gráfico, título de coluna que
   ordena a tabela. Marca no menu, igual às outras telas.
3. **Dá para entender os grupos sem ler tudo?** Um card por pergunta, cada um com título e uma frase:
   quanto custa, quem opera, por onde os leads passam, de onde vêm, marca, mês e representante. 24px
   entre os cards.
4. **Tem algo que dá para tirar?** Saiu o custo por lead (é da tela de Leads e o humano × Claude usaria outra
   base de leads), o tempo por origem (pesava a tabela sem responder a pergunta da tela) e os totais
   repetidos da matriz quando há uma marca ou um canal só. "Por marca" só aparece com "As duas".
5. **O sistema fez o trabalho chato e aceitou o que a pessoa digitou?** A tela faz a conta da matriz, dos
   totais sem contar o cliente duas vezes, da conversão por etapa e do tempo até o pedido; transforma a origem
   paga em canal para o custo; e, quando um filtro não divide o custo, diz por quê e tira o filtro com um
   toque.
6. **Como fica quando demora, quando dá errado e quando dá certo?** Esqueleto ao carregar; "Não deu para
   carregar" com "Tentar de novo" e código; "Nenhum lead ainda" com o caminho para Conectores; "Sem dados"
   por bloco; filtro sem lead com "Limpar filtros". Ver a tabela de estados.
7. **A pessoa sabe o que falta e até quando?** "atualizado há X min" na barra do topo; "Sem dados" e "Não se
   aplica" sempre com o motivo; o funil avisa que o CRM ainda não data as etapas do meio e que faturado é
   manual; a coorte avisa que os meses novos ainda estão convertendo; a lista de representantes diz quantos
   leads ainda estão sem dono.
8. **O mais importante está no começo do menu e no topo da lista?** "Chegada de clientes" é o primeiro item do
   grupo Clientes. Na tela, o custo por cliente novo (número de sucesso) vem logo depois dos indicadores;
   representante, a dimensão de apoio, fecha a tela. As tabelas começam pelo que mais pesa (origem por leads,
   representante por quem mais converteu).

## Fica para a fase 3 (depende de dado que ainda não chega)

- **Tempo entre as etapas do meio** (lead → prospecto → cadastro, 1º pedido → faturado): o modelo só tem a data
  do lead e a do 1º pedido. A réplica do CRM precisa trazer a data de cada mudança de etapa do negócio e a data
  do carimbo de faturado.
- **Tempo até o primeiro contato** do representante (Parâmetros por área): depende da mesma data de etapa.
- **Valor faturado**: "Sem dados" até o Control abrir o canal de faturamento (decisão 0004).
- Qual funil do CRM conta como lead ("Venda Direta — Leads" ou a cópia) é decisão do time do CRM (Parte 4 do
  prompt); até lá, o funil desta tela segue o que a réplica trouxer.

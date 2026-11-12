# Resumo simples — rota `/resumo`

> Módulo `apps/web/src/modules/resumo-simples` · consulta `apps/web/src/data/queries/resumo-simples.ts` (com teste) ·
> textos em `modules/resumo-simples/textos.ts` (com teste). Tarefa principal: **T7**.
> Contrato técnico em [`00-contrato.md`](00-contrato.md); índice das telas em [`README.md`](README.md).
> Tela proposta em 12/11/2026, depois do portão da fase 2: está no protótipo, com dados de exemplo, **esperando a
> aprovação do dono** antes de ganhar função no banco (fase 4).

## Para quem é

Para quem paga os anúncios e não trabalha com marketing. A pessoa recebe o link, abre (quase sempre no celular) e
precisa entender, sem ajuda e sem conhecer nenhuma sigla: quanto gastou, onde, quantos clientes isso trouxe, quanto
custou cada um e quanto voltou.

## O que a pessoa faz aqui

- **Lê o resumo em três ou quatro frases** e já sabe o principal, sem tocar em nada (T7).
- Confere os quatro números do período, cada um com a frase que diz o que ele é.
- Vê para onde o dinheiro foi: por canal, por marca e campanha por campanha.
- Tira a dúvida de uma palavra no glossário do fim da tela.
- Troca o período e liga ou desliga a comparação; troca a marca no menu lateral.
- Quem envia toca em **Copiar link** e cola na conversa.

## Ação principal

**Copiar link** — botão secundário na barra do topo. Copia o endereço da tela com a marca e o período, para quem
recebe abrir no mesmo recorte (a visão e o `?estado=` da demonstração não vão no link). A tela só lê: não há botão
principal, como na Visão geral em Visualizador.

"Este mês" no link é o mês de quando a pessoa abre, não o de quando foi enviado: para um mês fechado, envie com
"Mês passado".

## O que aparece, de cima para baixo

1. **Barra de filtros** (componente comum): período ("Este mês" por padrão) e "Comparar com o anterior". Sem o
   botão "Filtros": a tela não filtra canal, operador nem campanha.
2. **Em poucas palavras** (cartão): o período e a marca no rótulo e as frases, com os números em negrito:
   - "Você gastou **R$ X** em anúncios nas duas marcas."
   - "Esses anúncios trouxeram **N pessoas interessadas** e **M clientes novos**."
   - "Cada cliente novo custou, em média, **R$ Y**."
   - "Para cada R$ 1 gasto, voltaram **R$ Z** no primeiro pedido desses clientes (R$ W no total)."
   - Em letra menor: "Contando todos os caminhos (anúncio, indicação, busca, WhatsApp e os outros), chegaram N
     pessoas interessadas e M clientes novos no período."
3. **Quatro números**, até quatro por linha, na ordem em que o dinheiro anda. Cada cartão tem o número, a
   diferença para o período de comparação em palavras ("R$ 1.250 a mais", "5 a menos", "Igual") e uma frase:

   | Cartão | Frase | Cor da diferença |
   |---|---|---|
   | Você gastou | "Pago às plataformas para mostrar os anúncios." | sem cor: gastar mais não é bom nem ruim |
   | Clientes novos | "Chegaram por um anúncio e fizeram o primeiro pedido." | a mais é verde |
   | Cada cliente novo custou | "O gasto dividido pelos clientes novos. Quanto menor, melhor." | a menos é verde |
   | Voltou para cada R$ 1 | "O primeiro pedido desses clientes somou R$ W. Quanto maior, melhor." | a mais é verde |

4. **Onde o dinheiro foi gasto** e **Quanto foi para cada marca**: barras do gasto por canal (na cor de cada canal,
   decisão 0007) e por marca, lado a lado no computador, cada uma com "Ver como tabela" (a parte do gasto e os
   clientes novos). A frase do gráfico explica o nome de cada plataforma. O de canal some com filtro de canal na
   URL; o de marca, com uma marca escolhida.
5. **O que cada canal trouxe** (tabela) e, em "As duas", **Por marca**: gastou, interessados, clientes novos, custo
   por cliente e voltou por R$ 1. Embaixo do nome do canal, onde o anúncio aparece ("Facebook e Instagram"). O canal
   leva à tela do canal; a marca, ao resumo só dela. No celular viram cartões.
6. **Campanha por campanha** (tabela, as mesmas colunas): as campanhas com gasto, pessoa interessada ou cliente novo
   no período, da que mais gastou para a que menos gastou. Com mais de 10, aparecem as 8 que mais gastaram e as
   outras ficam em **Ver as outras N campanhas**. O nome leva à tela do canal, já na campanha. Campanha que gastou e
   não trouxe cliente mostra "Sem cliente novo" no custo.
7. **O que cada palavra quer dizer** (cartão): gasto, canal, campanha, pessoa interessada (lead), cliente novo,
   custo de cada cliente novo, quanto voltou (ROAS) e "veio de anúncio".
8. **Deixe o resumo na tela do celular** (cartão): o convite para instalar o CSP MKT como app, como o app dos
   representantes. Onde o navegador oferece (Chrome, Edge, Samsung Internet), o botão **Instalar o app** abre o
   convite dele ("App instalado. O ícone do CSP MKT já está na tela."). No iPhone, o texto ensina o caminho pelo
   Compartilhar do Safari; nos outros navegadores, pelo menu. Aberto pelo ícone, o cartão some.

## O app no celular

- **Como funciona:** `public/manifest.webmanifest` (nome "CSP MKT", ícone "CSP" branco sobre preto) e um service
  worker mínimo (`public/sw.js`). O ícone abre direto no Resumo simples (`start_url` = `/resumo`); segurar o ícone
  mostra o atalho "Visão geral".
- **Nada fica guardado no aparelho:** o service worker só atende a abertura de página. Sem internet, em vez do erro
  do navegador, aparece "Sem internet" com "Tentar de novo". A versão nova continua avisada pelo `/version.json`.
- **Só na build:** no `pnpm dev` o service worker não liga (a porta 5173 é de vários projetos).
- **As cores do manifesto e do `theme-color`** são o branco e o preto da paleta, escritos em hexadecimal: o
  navegador não lê token ali.
- **Instalar não dá acesso:** o app é o mesmo site, com o mesmo login. Sem login e sem banco (até a fase 4), o
  ícone abre o resumo vazio no site da Vercel, como o navegador.

## Caminho da T7

| Pergunta | Onde está | Toques |
|---|---|---|
| Quanto gastei, quantos clientes vieram, quanto custou cada um e quanto voltou? | As frases de "Em poucas palavras" | 0 |
| Subiu ou caiu? | A diferença embaixo de cada um dos quatro números | 0 |
| Onde gastei? | Barras por canal e por marca | 0 (rolagem no celular) |
| Qual campanha está cara? | "Campanha por campanha", coluna "Custo por cliente" | 0 (rolagem) |
| O que é lead? E ROAS? | "O que cada palavra quer dizer" | 0 (rolagem) |

## Estados

| Estado | Como forçar | O que aparece |
|---|---|---|
| Carregando | `?estado=carregando` | Esqueleto da tela, com `aria-busy` |
| Vazia | `?estado=vazio` ou sem dados de exemplo | "Nenhum número ainda", o próximo passo e o botão "Ver conectores" |
| Erro | `?estado=erro` | "Não deu para carregar", "Tentar de novo" e "Código DEMO-500" |
| Sem dados | `?estado=sem-dados` | A frase "Os números de anúncio deste período ainda não chegaram.", os quatro números em "Sem dados", os gráficos em "Sem dados", as tabelas com "—" e a lista de campanhas em "Sem dados" — nunca 0 |
| Sucesso | sem parâmetro, com dados de exemplo | Frases, números, gráficos e tabelas; "atualizado há X min" embaixo do título |

A barra de filtros e o botão "Copiar link" ficam visíveis em todos os estados.

## Textos

Botões e links: **Copiar link** ("Link copiado. Cole na conversa para enviar."; se o navegador não deixar: "Não deu
para copiar: copie o endereço da barra do navegador."), **Ver como tabela**, **Ver as outras N campanhas**, **Ver
conectores** (vazio), **Tentar de novo** (erro). Os nomes de canal, marca e campanha são links ("Ver Meta Ads",
"Ver o resumo só de Plumene", "Ver a campanha em Google Ads" na dica).

| Quando | Texto |
|---|---|
| Sem gasto no período | "Você não gastou com anúncios nas duas marcas neste período." (só essa frase) |
| Gastou e ninguém comprou | "Esses anúncios trouxeram N pessoas interessadas, e ainda nenhum cliente novo (ninguém fez o primeiro pedido)." — o cartão do custo fica em "Sem dados" e explica por quê |
| Cliente novo de quem chegou antes do período | "Esses anúncios trouxeram M clientes novos, de pessoas que chegaram antes deste período." |
| Sem o valor dos pedidos | A frase do retorno não aparece; o cartão fica em "Sem dados" |
| Comparação ligada | "Embaixo de cada número, a diferença para o período de comparação (1º a 12 de outubro)." |
| Comparação desligada, ou sem número para comparar | Some a diferença de cada cartão e a nota; nenhum texto fala do período de comparação |
| Tabelas | "Interessados e clientes novos são só os que vieram de anúncio. Custo por cliente é o gasto dividido pelos clientes novos; voltou por R$ 1 é o primeiro pedido deles dividido pelo gasto." |
| Campanhas | "Aparecem as campanhas com gasto, pessoa interessada ou cliente novo no período, da que mais gastou para a que menos gastou. N campanhas ficaram de fora por não terem nada no período." |

Palavras da tela: **gasto** (não "investimento"), **pessoa interessada** (não "lead"), **quanto voltou** (não
"ROAS"). O nome do mercado aparece só no glossário, entre parênteses.

## Regras de número

Toda conta vive em `data/queries/resumo-simples.ts`. A tela não soma linhas.

- **Gasto, pessoas interessadas, clientes novos e custo por cliente novo** são os da tarefa T1: vêm de
  `custoPorClienteNovo` (total, por canal, por marca) e de `metricasPorCampanha` (por campanha). O teste confere
  que o total do resumo é igual ao da T1. "Pessoas interessadas" são os leads do CSP 360 atribuídos a campanha
  (decisão 0027); "clientes novos", os atribuídos a campanha, pelo dia do 1º pedido enviado (decisões 0012 e 0029).
- **Quanto voltou** segue a decisão 0028: valor do 1º pedido dos clientes novos atribuídos ÷ gasto das mesmas
  campanhas. Sem gasto: sem dados. Com gasto e nenhum cliente novo: R$ 0. Cliente novo sem pedido na base: sem
  dados. No protótipo, o 1º pedido é o pedido mais antigo do cliente; no banco, o número sai de `mkt.acquisition`.
  As telas de canal do protótipo ainda mostram o ROAS informado pela plataforma: os dois só ficam iguais na fase 4.
- **Todos os caminhos** (a frase em letra menor) são os indicadores "Leads" e "Clientes novos" da Visão geral.
- A soma das campanhas e a soma dos canais fecham com o total (o teste confere nos dados de exemplo, em três
  marcas e três períodos).
- **Reais inteiros:** o dinheiro aparece arredondado para o real ("R$ 27.038"); só "voltou para cada R$ 1" mostra
  centavos. A diferença é calculada sobre os dois números já arredondados, para fechar com o que a pessoa vê.
- **No banco (fase 4):** a tela pede uma função `api.*` própria, montada sobre `mkt.acquisition`, sem conta nova
  (`docs/dados/metricas.md` ainda não tem as linhas desta tela).

## Responsivo e temas

- **1280px:** as frases, os quatro números e os dois gráficos cabem na primeira tela; as três tabelas inteiras, sem
  rolar de lado (por isso as colunas não ordenam: as setas não cabiam).
- **1920px:** quatro cartões por linha usando a largura toda.
- **375px:** tudo em uma coluna; as tabelas viram cartões; o nome da campanha quebra linha; sem rolagem lateral na
  página (conferido: `scrollWidth` = `clientWidth`).
- **Claro e escuro:** só tokens e classes `yn-*`; contraste mínimo medido de 6,1:1 no claro e 6,5:1 no escuro.

## As 8 perguntas de UX (seção 7)

1. **Qual é a ação principal, e ela é o botão mais forte, no alcance do dedo?** Ler. O único botão da tela é
   "Copiar link", na barra do topo, para quem envia.
2. **Funciona como os sites que a pessoa já usa?** Lê-se como um extrato: frases em cima, números grandes, barras
   e tabela. Nada de gesto escondido.
3. **Dá para entender os grupos sem ler tudo?** Cada bloco tem título em forma de pergunta respondida: "Em poucas
   palavras", "Onde o dinheiro foi gasto", "O que cada canal trouxe", "Campanha por campanha", "O que cada palavra
   quer dizer".
4. **Tem algo que dá para tirar?** Saíram os centavos, a ordenação das tabelas, o botão "Filtros" e as campanhas
   sem nada no período; gráfico e tabela de uma linha só somem; as campanhas menores ficam recolhidas.
5. **O sistema fez o trabalho chato e aceitou o que a pessoa digitou?** As contas vêm prontas e em frase; a
   diferença vem em reais e em unidades, não em %; o link já leva a marca e o período. Não há campo para digitar.
6. **Como fica quando demora, quando dá errado e quando dá certo?** Esqueleto, "Não deu para carregar" com
   "Tentar de novo", "Nenhum número ainda" com o caminho para Conectores e "Sem dados" em cada número sem base.
7. **A pessoa sabe o que falta e até quando?** O rótulo do primeiro cartão diz o período com as datas; "atualizado
   há X min" fica embaixo do título.
8. **O mais importante está no começo do menu e no topo da lista?** É o segundo item do menu, logo depois da Visão
   geral; as frases vêm primeiro; as campanhas vêm da que mais gastou para a que menos gastou.

## Fica para depois

- **Quem recebe entra com o papel `summary_viewer`** (decisão 0043, 12/11/2026): vê só esta tela e as próprias
  Configurações; na entrada ("/") vai direto para cá. Hoje o site abre sem login e sem dados. O dono convida em
  Usuários quando houver login (fase 4), e o usuário só nasce no banco de produção depois do portão da fase 3. Na
  demonstração, `/resumo?papel=summary_viewer` mostra a tela como essa pessoa vai ver.
- **Instalação conferida só em simulação:** no painel de teste o Chrome não dispara o convite; o botão foi conferido
  com um convite simulado. Falta instalar num celular de verdade (Android e iPhone).
- **Entre 641 e cerca de 900px de área** (tablet, notebook pequeno) as tabelas rolam de lado dentro do próprio
  bloco, como as da Visão geral; a página não rola de lado.
- **Rótulo do gráfico em 375px:** "Corpo Sensual" corta no gráfico por marca (dívida do `GraficoBarras`, já no
  `ESTADO.md`).
- **Compartilhar pelo celular** (folha de compartilhamento do aparelho) no lugar de só copiar.
- **Conferir com gente de verdade:** quem vai receber faz a T7 no celular, sem ajuda (portão da fase 2 para esta
  tela).

`tela.test.ts` desenha a tela no servidor e confere a ordem dos blocos, que o gasto e o custo são os da T1, os
destinos dos links, o que some com uma marca só e com a comparação desligada, as campanhas recolhidas e os estados.
`src/lib/app-instalavel.test.ts` confere o que oferecer em cada aparelho e o manifesto: cada ícone existe com o
tamanho declarado (sem isso o Chrome não oferece a instalação), o `start_url` é uma rota do sistema e o service
worker não guarda nada.

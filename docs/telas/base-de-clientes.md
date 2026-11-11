# Base de clientes (`/base`)

> Grupo **Clientes** do menu · todos os papéis que entram no sistema (`ver_numeros`).
> Tela: `apps/web/src/modules/base-de-clientes/` · consulta: `apps/web/src/data/queries/base-de-clientes.ts`
> (`painelDaBase`, por cima de `baseDeClientes` de `queries.ts`) · contrato: [`00-contrato.md`](00-contrato.md).

## O que a pessoa faz nesta tela

- Vê os clientes que já compraram (a base), por marca e por representante, e como estão **hoje** pela
  situação que o CSP 360 calcula: ativos, inativos (recentes e antigos) e perdidos.
- Vê o que aconteceu **no período**: taxa de recompra, reativados (voltaram depois de 90 dias ou mais sem
  pedido) e receita de clientes antigos × novos, comparados com o período anterior.
- Acha quem parou de comprar e quem voltou (filtros rápidos da lista) e abre o cliente no CSP 360, onde ele
  é trabalhado. O CSP-MKT só lê: a lista mostra código, marcas, situação e datas, nunca nome ou contato.

Tarefa principal da tela (T5 do [índice](README.md)): **ver quem da base antiga parou de comprar e quem
voltou**. Caminho: menu → **Base de clientes** (os KPIs Inativos, Perdidos e Reativados já respondem) →
tocar no KPI **Inativos**, **Perdidos** ou **Reativados**, que abre a lista já filtrada e rola até ela, ou no
filtro rápido da lista (2 toques) → **Abrir no CSP 360** na linha (3 toques).

## Ação principal (uma só)

**Abrir lista no CSP 360**: o único botão principal, na barra do topo. Abre em outra aba a mesma seleção
(marca, representante e filtro rápido) na lista de clientes do CSP 360, para a equipe trabalhar os
clientes lá. Cada linha da lista tem o link discreto **Abrir no CSP 360**, que abre a ficha 360 daquele
cliente. Os endereços são de exemplo (`https://csp360.example/clientes…`); o real entra na fase 3.

## O que aparece, de cima para baixo

1. **Barra de filtros**: período (padrão "Este mês"), chave "Comparar com o anterior" e botão **Filtros**
   (painel com **Representante** e **Meus filtros**). A marca vem do menu. Canal, campanha, operador e
   origem não aparecem: cliente da base não tem canal.
2. **Avisos**, só quando acontecem (`.yn-alert`):
   - CSP 360 atrasado (amarelo) ou parado (vermelho), com a hora da última sincronização e "Ver conectores";
   - CSP 360 sem a situação dos clientes (azul);
   - visão **Gestor de tráfego** (azul): a base não tem operador nem verba, com o link "Ver chegada de clientes".
3. **Hoje, pela situação do CSP 360** ("Não muda com o período."): Clientes na base · Ativos · Inativos
   ("N recentes · N antigos") · Perdidos.
4. **No período** (datas do período): Taxa de recompra · Reativados · Receita de antigos · Antigos na
   receita, com a variação contra o período anterior. Quando o anterior foi zero, o KPI diz
   "0 no período anterior" em vez de uma variação impossível.

   Cada contagem de clientes é link para a lista desta tela, já no filtro rápido dela e rolada até ela
   (`/base?recorte=inativos#lista-de-clientes`, mantendo marca, período e representante): **Clientes na base**
   → Todos, **Ativos**, **Inativos**, **Perdidos** e **Reativados** → o chip de mesmo nome. Sem a situação do CSP
   360, Ativos, Inativos e Perdidos não viram link (o chip não existe); sem base, nenhum vira.
5. **Como contamos** (fechado, `.yn-accordion`): a definição de cada número.
6. **Gráficos**, lado a lado (empilham quando aperta), os dois com "Ver como tabela":
   - **Tempo desde a última compra**: clientes por faixa de dias sem comprar (até 30, 31 a 90, 91 a 180,
     181 a 365, mais de 1 ano), em cor neutra: a faixa não vira situação, a régua é do CSP 360;
   - **Receita do período: antigos × novos**: barras com o valor e a parte de cada um na receita.
7. **Por marca** (só em "As duas"): Corpo Sensual, Plumene e "As duas" com clientes, ativos, inativos,
   perdidos, recompra (quantos · taxa) e reativados. Quem compra das duas aparece nas duas linhas; "As duas"
   conta cada cliente uma vez.
8. **Por representante**: a carteira de cada código do CSP 360, maior primeiro, "Sem representante" por
   último, com as mesmas colunas.
9. **Clientes**: filtros rápidos **Todos · Ativos · Inativos · Perdidos · Reativados · Sem situação**, cada
   um com a contagem, e a lista: Cliente (código) · Marcas · Situação · Última compra ("data · há N dias")
   · No período ("Reativado" ou "Comprou") · Ficha 360 ("Abrir no CSP 360"). Há mais tempo sem comprar
   primeiro; ordena por qualquer coluna no cabeçalho; até 200 linhas, com aviso quando passa disso.

## Filtros e estado na URL

| O quê | Onde | Na URL |
|---|---|---|
| Marca | seletor do menu (`.yn-context`) | `?marca=cs\|plumene\|todas` |
| Visão | `.yn-segmented` da barra do topo | `?visao=visualizador\|gestor` |
| Período e comparação | barra de filtros | `?periodo=…`, `?comparar=false` |
| Representante | painel **Filtros** | `?representante=REP-03` (código, nunca nome) |
| Filtro rápido da lista | chips acima da lista | `?recorte=ativos\|inativos\|perdidos\|reativados\|sem-situacao` |
| Estado de demonstração | — | `?estado=carregando\|vazio\|erro\|sem-dados` |

O filtro rápido não é global: não segue para outras telas e "Limpar filtros" não o apaga (ele fica à vista
nos chips). Um link com `?recorte=reativados` abre a lista já filtrada.

## Visão e papel

- **Visualizador** e **Gestor de tráfego** veem a mesma tela: só números e links para o CSP 360, porque a
  base não tem campanha nem ação de tráfego. Na visão Gestor de tráfego aparece o aviso de onde ficam
  Humano × Claude e o custo por cliente novo.
- Todo papel com acesso aos números vê a tela. O link "Ver conectores" dos avisos só aparece para quem pode
  ver conectores. A ficha 360 abre no CSP 360, que decide quem a vê; aqui não há dado pessoal.

## Estados

| Estado | Como ver | O que aparece |
|---|---|---|
| Carregando | `?estado=carregando` | Esqueleto: 4 indicadores e 2 gráficos (`aria-busy`). |
| Vazio | `?estado=vazio` ou abrir sem dados de exemplo | "Nenhum cliente ainda" · "Os clientes chegam do CSP 360. Ligue o conector do CSP 360 para ver a base aqui." · botão **Ver conectores**. |
| Erro | `?estado=erro` | "Não deu para carregar" · "Tente de novo em alguns segundos. Se continuar, veja os conectores." · botão **Tentar de novo** · "Código DEMO-500". |
| Sem dados | `?estado=sem-dados` | A tela inteira com cada KPI em "Sem dados", os dois gráficos em "Sem dados", as tabelas com "Sem dados · Nenhum cliente chegou do CSP 360 ainda." e a lista sem filtros rápidos, com "A lista aparece quando os clientes chegarem do CSP 360." Nunca 0. |
| CSP 360 sem a situação | dado real sem a régua do CSP 360 | Ativos, Inativos e Perdidos em "Sem dados" com "O CSP 360 ainda não envia a situação"; aviso azul; os filtros rápidos de situação somem; recompra, reativados, receita e lista continuam. |
| CSP 360 atrasado ou parado | conector `csp360` em `late` ou `down` | Aviso amarelo "O CSP 360 está atrasado" ou vermelho "O CSP 360 parou de sincronizar", com a última sincronização. |
| Sucesso | sem parâmetro, com dados de exemplo | Números, gráficos, tabelas e lista. "atualizado há X min" na barra do topo vem da última sincronização do CSP 360. |
| Depois de dar certo | tocar em **Inativos** (ou outro filtro rápido) | O chip fica pressionado, a lista mostra só o grupo, a URL guarda o filtro e o botão principal passa a abrir a mesma lista no CSP 360. |
| Grupo sem clientes | filtro rápido sem ninguém | "Nenhum cliente neste grupo" · "Escolha outro filtro rápido ou veja a base inteira." · botão **Ver todos**. |
| Filtros sem clientes | ex.: representante sem carteira na marca | "Nenhum cliente com esses filtros" · "Limpe os filtros para ver a base inteira." |

## Texto de cada botão e aviso

- Botão principal: **Abrir lista no CSP 360** (leitor de tela: "Abrir lista no CSP 360 (abre em outra aba)").
- Em cada linha: **Abrir no CSP 360** (leitor de tela: "Abrir no CSP 360 (código do cliente, abre em outra aba)").
- Filtros rápidos: **Todos**, **Ativos**, **Inativos**, **Perdidos**, **Reativados**, **Sem situação**.
- Lista vazia num filtro: **Ver todos**. Vazio: **Ver conectores**. Erro: **Tentar de novo**.
- Notas dos KPIs: "N sem situação no CSP 360" ou "Com pedido em alguma marca"; "N recentes · N antigos";
  "O CSP 360 ainda não envia a situação"; "N no período anterior".
- Avisos: "O CSP 360 está atrasado" · "O CSP 360 parou de sincronizar" (com "A última sincronização foi em
  dd/mm/aaaa hh:mm.") · "O CSP 360 ainda não envia a situação dos clientes" · "A base não tem operador nem verba".
- Lista cortada: "Mostrando 200 de N clientes, os que estão há mais tempo sem comprar. Escolha um filtro
  rápido ou um representante para ver os outros."

## Como contamos

Toda conta vive na consulta (pura, com teste) e vira view SQL na fase 3; a tela só formata.

- **Cliente da base**: tem pedido enviado em alguma marca, ou o CSP 360 diz uma situação que não é "lead"
  (decisão 0012). Quem ainda não comprou é lead e fica em Leads e em Chegada de clientes.
- **Situação**: vem do CSP 360, pela régua de cada marca. Sem ela, "Sem dados": o CSP-MKT não recalcula a
  régua (decisão 0006).
- **Antigo**: já tinha pedido antes do início do período, em qualquer marca. **Novo**: o 1º pedido foi no
  período (decisão 0012).
- **Taxa de recompra**: antigos que fizeram pedido no período ÷ todos os antigos.
- **Reativado**: antigo que voltou a comprar no período depois de 90 dias ou mais sem pedido. Com uma marca
  escolhida, contam só os pedidos dela (a régua é por marca), por isso as linhas por marca podem somar mais
  reativados que "As duas".
- **Receita**: soma dos pedidos enviados no período. O valor faturado fica "Sem dados" até o Control abrir
  o canal de faturamento (decisão 0004).
- **Tempo desde a última compra**: dias entre a última compra e hoje, no fuso de São Paulo.

## As 8 perguntas de UX (seção 7 do padrão)

1. **Qual é a uma ação principal, e ela é o botão mais forte, no alcance do dedo?** "Abrir lista no CSP 360",
   o único `.yn-btn--primary`, na barra do topo; no celular ele desce para a linha de baixo do título,
   visível sem rolar. O link de cada linha é discreto (`.yn-btn--ghost`).
2. **Funciona como os sites que a pessoa já usa?** Sim: filtros rápidos em chips com contagem, tabela que
   ordena pelo cabeçalho, link com o ícone de "abre fora", menu à esquerda, filtros no botão "Filtros".
3. **Dá para entender os grupos sem ler tudo?** Dois blocos com título ("Hoje, pela situação do CSP 360" e
   "No período"), depois os gráficos, as tabelas por marca e por representante e a lista por último.
4. **Tem algo que dá para tirar?** Saíram: receita por representante (fica para o módulo de desempenho de
   representantes, fora da v1), coluna de representante na lista (está no filtro e na tabela), quantidade
   de pedidos por cliente e os filtros de canal, campanha, operador e origem, que não se aplicam à base.
5. **O sistema fez o trabalho chato e aceitou o que a pessoa digitou?** Recompra, reativados, faixas de dias
   e "há N dias" vêm calculados; os chips já dizem quantos clientes há em cada grupo; tocar num KPI de
   clientes já filtra a lista e rola até ela; o botão principal leva a mesma seleção para o CSP 360. Não há
   campo para digitar.
6. **Como fica quando demora, quando dá errado e quando dá certo?** Esqueleto; "Não deu para carregar" com
   "Tentar de novo" e código; avisos de CSP 360 atrasado ou parado; "Sem dados" nunca vira 0; o chip tocado
   fica pressionado e a lista muda na hora.
7. **A pessoa sabe o que falta e até quando?** "atualizado há X min" da última sincronização do CSP 360; as
   datas do período; "O CSP 360 ainda não envia a situação" quando falta a régua; a lista cortada diz
   quantos clientes ficaram de fora e como vê-los.
8. **O mais importante está no começo do menu e no topo da lista?** A situação de hoje vem primeiro e o
   período logo depois; a lista fica no fim da tela, mas os KPIs do topo levam direto a ela já filtrada; a
   lista começa por quem está há mais tempo sem comprar (perdidos e inativos no topo) e ordenar por Situação
   começa por Perdido.

## Limites do protótipo e pendências (fase 3)

- **Situação por marca**: no protótipo cada cliente tem uma situação só; no CSP 360 a régua é por marca.
  Conferido no código do CRM em 10/11/2026: a régua só roda na tela de lá e a leitura não traz a situação. Até a
  régua existir em SQL no CRM, vale o estado "CSP 360 sem a situação" (decisão 0041).
- **Reativado olha os pedidos conhecidos**: sem pedido anterior no conjunto, a conta parte do pedido mais
  antigo conhecido (no CSP 360, o histórico começa em agosto de 2026). O modelo usa também a compra do ERP
  mais antiga que a réplica já viu, por marca, para não contar como reativado quem comprou antes da janela: o
  retrato do ERP traz só a última compra (decisão 0042).
- **Endereço do CSP 360**: os links são de exemplo; o endereço real e os parâmetros da lista de clientes do
  CSP 360 (marca, representante, situação) se combinam com o time do CRM.
- **Atalho dos KPIs**: feito na revisão de UX da fase 2 (`linkCom` passou a aceitar `?recorte=` e âncora;
  `linkDaLista` em `recorte.ts`; `tela.test.ts` confere os destinos e o caso sem dados).

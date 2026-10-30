# Leads — `/leads`

> Grupo **Clientes** do menu · pasta `apps/web/src/modules/leads` · números de `painelDeLeads` em
> `apps/web/src/data/queries/leads.ts` (vira a view `kpi_leads` na fase 3), com teste em `leads.test.ts`.
> Quem vê: `owner` e `traffic_manager` (`ver_leads`). A tela não tem dado pessoal, então os dois veem igual.

## O que a pessoa faz nesta tela

- Vê quantos leads chegaram no período, comparados com o período anterior, e quantos deles já viraram cliente.
- Vê de onde chegam: por **origem** (Meta Ads, TikTok Ads, Google Ads, Site, Busca orgânica, Assistente de IA,
  SDR · WhatsApp, Indicação, Direto), por **marca** (Corpo Sensual, Plumene e **Sem marca · WhatsApp**, o lead do
  SDR, separado), por **dia** e por **campanha** (`utm_campaign`).
- Filtra pela barra de filtros (período, chips rápidos de origem e o painel "Filtros") e filtra a lista pelos
  chips de **etapa** (Lead, Prospecto, Cadastro, 1º pedido enviado, Faturado).
- Abre a ficha 360 de um lead no CSP 360. Aqui só aparecem código, origem, marca, campanha, data e etapa: nome,
  telefone e e-mail ficam no CSP 360 (decisão 0006).
- Na visão **Gestor de tráfego**, compara Humano × Claude nos leads de campanha e vê o operador, o investimento e o
  custo por lead de cada campanha.

Tarefa T2 do [README](README.md) ("ver de onde chegam os leads e em que etapa estão"): menu → **Leads** (1 toque);
uma origem: chip da barra (2 toques); uma etapa: chip da lista (2 toques).

## A ação principal (uma só)

**Abrir funil no CSP 360**: o único botão principal (`.yn-btn--primary`), na barra do topo, com ícone de link
externo; abre o funil de leads do CSP 360 em outra aba. É lá que a equipe trabalha cada lead: o CSP-MKT só lê
(decisões 0004 e 0010). Na lista, **Abrir ficha** em cada linha é um botão discreto (a ação daquele lead).

## Como a tela é montada (de cima para baixo)

| Bloco | O que mostra | Visão |
|---|---|---|
| Barra de filtros | Período (padrão "Este mês"), "Comparar com o anterior", até 5 chips de origem (as que mais trouxeram leads no período, com a contagem) e o botão **Filtros** (canal, campanha, origem, representante; operador só na visão Gestor) | as duas |
| Indicadores | **Leads** (com a variação); **Lead → cliente novo** (com "X de Y leads viraram cliente"; leva à Chegada de clientes com os mesmos filtros de origem, canal, campanha, operador e representante); **Custo por lead** (com a variação; custo que cai fica verde); **Sem marca · WhatsApp** | as duas |
| Leads por dia | Linha com uma série por marca e uma para Sem marca · WhatsApp, com "Ver como tabela" | as duas |
| Leads por origem · Leads por marca | Barras lado a lado (empilham quando aperta), cada uma com "Ver como tabela" e, na tabela, quantos viraram cliente e a taxa | as duas |
| Leads por campanha | Tabela por `utm_campaign`: **Campanha** (nome; embaixo, o ponto e o nome do canal, a marca e a UTM), **Leads** (embaixo, a variação vs. o período anterior), **Viraram cliente** (embaixo, "11,1% dos leads"), **Custo por lead** | as duas; Gestor acrescenta **Operador** e **Investimento** |
| Humano × Claude | Leads de campanha, viraram cliente, lead → cliente novo, investimento e custo por lead, lado a lado, com a diferença do Claude em relação ao humano (verde = melhor, vermelho = pior; investimento sem cor) | só Gestor |
| Lista de leads | Chips de etapa com contagem, resumo ("Mostrando os 200 mais recentes de N leads…"), tabela com Código, Origem (ponto da cor da origem + nome), Marca, Campanha, Chegou em, Etapa, Ficha 360 | as duas |

## Regras dos números (todas em `painelDeLeads`, nenhuma conta na tela)

- **Lead do período:** chegou (`createdAt`) num dia do período, no calendário de São Paulo. Os filtros da barra valem
  para a tela toda; a **etapa vale só para a lista** (os indicadores e gráficos descrevem todos os leads do período).
- **Viraram cliente:** leads do período que já fizeram o 1º pedido enviado (etapa 1º pedido enviado ou Faturado),
  um por cliente (decisão 0012). É a coorte dos leads do período: não é o mesmo número de "Clientes novos" da Visão
  geral, que conta os 1ºs pedidos feitos dentro do período.
- **Lead → cliente novo:** viraram cliente ÷ leads do período. **Sem comparação com o período anterior, de
  propósito:** os leads do período ainda estão comprando e os do período anterior tiveram mais tempo, então a
  variação acusaria uma queda que não existe (nos dados de exemplo, "-67%" em vermelho). O cartão mostra "X de Y
  leads viraram cliente" no lugar.
- **Custo por lead:** investimento das campanhas do filtro no período ÷ leads cuja `utm_campaign` casa com essas
  campanhas (a mesma conta da Visão geral; o investimento vem de `metricasPorCampanha`). Com uma origem de anúncio
  no filtro, conta só o investimento daquele canal. Com origem sem mídia (site, orgânico, IA, SDR, indicação, direto)
  ou com um representante escolhido, mostra **"Não se aplica"** com o motivo.
- **Comparação desligada** ("Comparar com o anterior"): a variação some e nenhum indicador fala do período anterior
  (sem base, "Sem base para calcular" em vez de "Sem base vs. mês anterior").
- **Sem marca · WhatsApp:** lead do SDR, sem marca; entra nas duas marcas e é sinalizado (decisão 0003).
- **Por campanha:** UTM que casa com campanha cadastrada mostra o nome dela; a que não casa aparece com a própria
  UTM, "Sem campanha cadastrada", sem custo.
- **Humano × Claude:** quem opera a campanha da UTM do lead (decisão 0008); ignora o filtro de operador, porque a
  comparação é ele.
- **Lista:** no máximo 200, mais novos primeiro; "A cadastrar" no lugar do link quando o lead ainda não tem ficha
  de cliente no CSP 360.

## Estados

| Estado | Como ver | O que aparece |
|---|---|---|
| Carregando | `?estado=carregando` | Esqueleto: 4 cartões e 2 gráficos, com `aria-busy`. A barra de filtros fica no lugar. |
| Vazia | `?estado=vazio`, ou o modo demonstração sem `VITE_SAMPLE_DATA` | "**Nenhum lead ainda**" · "Os leads chegam do CSP 360 a cada 5 minutos. Veja em Conectores se o CSP 360 está funcionando." · botão **Ver conectores** |
| Erro | `?estado=erro` | "**Não deu para carregar**" · "Tente de novo em alguns segundos. Se continuar, veja os conectores." · botão **Tentar de novo** · "Código DEMO-500" |
| Sem dados | `?estado=sem-dados` | A tela inteira: os 4 indicadores em "Sem dados" ("Sem base vs. mês anterior"); cada gráfico com "Sem dados · Nenhum número no período para este gráfico." (sem legenda); campanhas "Sem dados · Nenhum lead de campanha para contar no período."; lista "Sem dados · A lista aparece quando os leads chegarem do CSP 360."; chips de etapa sem contagem. Nunca 0. |
| Sucesso | sem parâmetro, com os dados de exemplo | Números, gráficos com "Ver como tabela", tabelas ordenáveis pelo cabeçalho, lista com **Abrir ficha**. |
| Filtro sem resultado | um filtro ou etapa que não acha nada | Lista: "**Nenhum lead com estes filtros**" · "Mude o período, escolha outra etapa ou limpe os filtros." · **Limpar filtros** (limpa a barra e a etapa de uma vez). Campanhas: "Nenhum lead de campanha no período" · "Leads com utm_campaign aparecem aqui. Mude o período ou os filtros." Contagem com base é 0, não "Sem dados". |

**Depois de dar certo:** a tela não grava nada. Ao trocar período, origem, etapa ou visão, os números respondem na
hora, a URL guarda a escolha (o link compartilhado abre igual) e o resumo da lista é lido pelo leitor de tela
(`aria-live`). **Abrir ficha** e **Abrir funil no CSP 360** abrem o CSP 360 em outra aba, sem tirar a pessoa daqui.

## Textos de cada botão e aviso

| Onde | Texto |
|---|---|
| Barra do topo | "Clientes" (eyebrow) · **Leads** (h1, desenhado pela casca) · "atualizado há X min" · botão principal **Abrir funil no CSP 360** (dica: "Abre o funil de leads do CSP 360 em outra aba") |
| Barra de filtros | "Comparar com o anterior" · chips "Meta Ads 38", "Google Ads 21"… · **Filtros** · chip ativo "Origem: Busca orgânica" com "Remover filtro Origem" · **Limpar filtros** |
| Indicadores | "Leads" · "Lead → cliente novo" + "2 de 7 leads viraram cliente" · "Custo por lead" ("Não se aplica" + "Leads desta origem não têm custo de mídia." ou "O investimento não se divide por representante.") · "Sem marca · WhatsApp" + "Leads do SDR, contados nas duas marcas" · variação "+26,1% vs. mês anterior" |
| Gráficos | "Leads por dia" · "Por marca. O lead do SDR chega sem marca e aparece como Sem marca · WhatsApp." · "Leads por origem" · "Anúncio pela UTM; site, busca orgânica e assistente de IA pelo endereço de onde a pessoa veio." · "Leads por marca" · "Quantos leads chegaram para cada marca e quantos já viraram cliente." · "Ver como tabela" · detalhe "3 viraram cliente · 25,0%" |
| Campanhas | "Leads por campanha" · "Pela utm_campaign de cada lead, com a variação vs. o período anterior. UTM que não casa com campanha cadastrada aparece com o próprio nome." (sem "com a variação…" quando a comparação está desligada) · "Sem campanha cadastrada" · "11,1% dos leads" · dica da variação "Variação vs. o período anterior" |
| Humano × Claude | "Humano × Claude" · "Leads das campanhas de cada operador no período. A diferença é do Claude em relação ao humano." |
| Lista | "Lista de leads" · "Só código, origem, marca, campanha, data e etapa. Nome e telefone ficam na ficha 360, no CSP 360." · grupo "Filtrar a lista por etapa" · **Ver todas as etapas** · "Mostrando os 200 mais recentes de 340 leads. Use os filtros para achar um lead." / "52 leads, os mais recentes primeiro." · **Abrir ficha** (nome acessível "Abrir a ficha 360 de LEAD-0123 no CSP 360") · "A cadastrar" |

## Responsivo (pelo espaço)

- **1280px:** 4 indicadores numa linha; origem e marca lado a lado; as três tabelas cabem inteiras nas duas visões
  (marca, campanha e data quebram linha; canal e marca vão embaixo do nome da campanha). Em área menor, a tabela rola
  de lado dentro do quadro, nunca a página.
- **375px:** 1 indicador por linha; gráficos um embaixo do outro; chips rolam de lado numa linha; as três tabelas
  viram cards (`.yn-table--stack`, o título do card é a campanha, a linha do Humano × Claude ou o código do lead); o
  botão principal desce para a linha de baixo da barra do topo, ainda no topo.
- Claro e escuro só por tokens; cor de série (decisão 0007) só em gráfico, chip, legenda e no ponto ao lado do nome
  do canal ou da origem, sempre com o rótulo.
- **Conferido no navegador** (build de demonstração com dados de exemplo, 30/10/2026): 1280px claro e escuro e 375px
  claro, visões Visualizador e Gestor; sem rolagem lateral na página (`scrollWidth` = largura da janela), tabelas
  sem rolagem interna em 1280px, cards em 375px; chips de etapa e de origem gravam na URL; "Limpar filtros" do
  estado sem resultado limpa barra e etapa de uma vez.

## As 8 perguntas de UX (seção 7 do padrão)

1. **Qual é a uma ação principal, e ela é o botão mais forte, no alcance do dedo?** "Abrir funil no CSP 360", o único
   botão principal, no topo; no celular desce para a linha de baixo do título. O que mais se usa aqui (os filtros)
   vem logo abaixo, e "Abrir ficha" fica dentro de cada linha.
2. **Funciona como os sites que a pessoa já usa?** Filtros no topo e indicadores, gráficos e lista na ordem dos
   painéis da RD Station; chips com contagem; ícone de link externo para o que abre em outra aba; ordenação
   clicando no cabeçalho; "Ver como tabela" em todo gráfico.
3. **Dá para entender os grupos sem ler tudo?** Quanto (indicadores) → quando (por dia) → de onde (origem e marca)
   → por qual campanha → quem operou (Humano × Claude, no Gestor) → quais leads (lista). Cada bloco tem título e
   uma frase.
4. **Tem algo que dá para tirar?** Saíram: o representante da lista (não foi pedido e não ajuda a achar o lead), a
   variação da taxa de conversão (enganava), Operador e Investimento na visão Visualizador, o operador no painel
   "Filtros" do Visualizador, e três colunas da tabela de campanhas (canal e marca foram para baixo do nome; a
   variação e a taxa, para baixo do número), para ela caber inteira em 1280px.
5. **O sistema fez o trabalho chato e aceitou o que a pessoa digitou?** A origem já vem classificada (UTM ou endereço
   de onde a pessoa veio), a UTM já vem casada com a campanha, o SDR já vem separado, os chips já trazem a contagem,
   o período já abre em "Este mês" comparando com o anterior e cada lead já tem o link da ficha.
6. **Como fica quando demora, quando dá errado e quando dá certo?** Esqueleto; "Não deu para carregar" com "Tentar
   de novo" e código; "Nenhum lead ainda" com "Ver conectores"; "Sem dados" (nunca 0); "Nenhum lead com estes
   filtros" com "Limpar filtros". Ver **Estados**.
7. **A pessoa sabe o que falta e até quando?** "atualizado há X min" (leads chegam a cada 5 minutos); "Mostrando os
   200 mais recentes de N"; "A cadastrar" quando o lead ainda não tem ficha; "Não se aplica" com o motivo no custo.
8. **O mais importante está no começo do menu e no topo da lista?** No menu, Leads fecha o grupo Clientes, depois de
   Chegada e Base (posição serial: o fim do grupo também é lembrado). Na tela, os indicadores vêm primeiro; origens,
   marcas e campanhas vêm da maior para a menor; a lista vem do lead mais novo para o mais antigo.

## Limites conhecidos

- A etapa (`?etapa=`) não está em `Filtros`: não entra em "Meus filtros" nem no "Limpar filtros" da barra (a lista
  tem o seu "Ver todas as etapas" e o "Limpar filtros" do estado sem resultado limpa os dois).
- O endereço do CSP 360 é de exemplo (`https://csp360.example`) até o CRM informar o real.
- A barra de filtros fica dentro de um `div.min-w-0`: sem ele, a fila de chips (que não quebra no celular) alarga a
  grade do `.yn-content` e a página rola de lado em 375px. É contorno local; a correção de raiz é na fundação
  (`.mkt-filters`), e então o `div` pode sair.
- `tela.test.ts` desenha a tela no servidor em todos os estados (`?estado=`), nas duas visões e com a etapa, e
  confere que não aparece dado pessoal; não substitui a conferência no navegador a cada mudança de layout.

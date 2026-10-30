# Canais pagos — `/canais/meta` · `/canais/tiktok` · `/canais/google`

> Grupo **Canais** do menu (Meta Ads, TikTok Ads, Google Ads), ícone `megaphone`. Todos os papéis veem; o que
> cada um pode fazer vem do papel, não da Visão (decisão 0011). Uma tela só, parametrizada pela plataforma.
> Tela: `apps/web/src/modules/canais/` · consulta: `apps/web/src/data/queries/canais.ts` (`painelDoCanal`,
> montada sobre `metricasPorCampanha`, `porOperador`, `acoes` e `conectores` de `queries.ts`, com teste em
> `canais.test.ts`). Endereço com outra plataforma mostra "Canal não encontrado".

## O que a pessoa faz nesta tela

- Vê quanto o canal investiu no período e o que voltou: leads, custo por lead, clientes novos, custo por
  cliente novo, ROAS, conversões, custo por conversão, impressões, cliques, CTR e custo por clique, cada um
  comparado com o período anterior.
- Vê investimento e leads dia a dia, uma linha para o humano e outra para o Claude.
- Acha a campanha que gasta mais ou que custa mais por cliente novo, com o operador (Humano · Claude) e o status.
- Na visão **Gestor de tráfego**: compara Humano × Claude na mesma linha de números, com a diferença em %;
  vê verba diária e teto de gasto de cada conta (marca × plataforma); aprova ou descarta a proposta do topo da
  fila do canal; pausa uma campanha ou ajusta o orçamento dela; e para tudo do Claude numa emergência.

## Ação principal

- **Visualizador**: ler o custo por cliente novo do canal e comparar com o período anterior. É leitura: não há
  `.yn-btn--primary`. O primeiro controle é o **Período**; a marca vem do seletor **Marca** do menu.
- **Gestor de tráfego**: **Aprovar** a proposta do topo da fila do canal — o único `.yn-btn--primary` da tela,
  dentro do cartão `.yn-decision`, que é o primeiro bloco do conteúdo nesta visão. Pausar e Ajustar orçamento são secundários, dentro de cada campanha; "Parar
  tudo do Claude" é botão de perigo, em outro bloco, longe do Aprovar. **Nenhum botão executa nada na
  plataforma**: aprovar, pausar e ajustar gravam uma ação de tráfego na trilha (aprovada, para quem tem
  `aprovar_acao`; proposta, para quem só tem `operar_trafego_ia`), que o worker executa depois, quando houver
  credencial de escrita (decisão 0005).

## Como a tela está montada (de cima para baixo)

1. **Barra de filtros** (`BarraDeFiltros`): Período (padrão "Este mês"), chave "Comparar com o anterior", chips
   rápidos **Humano** e **Claude** com o número de campanhas de cada um no canal, e o botão "Filtros" com
   **Campanha**, **Operador** e "Meus filtros". Canal não é filtro aqui: vem da rota, e um `?canal=` que chegue
   por link sai da URL sozinho.
2. **Aviso do conector** da plataforma, só quando está atrasado ou caído.
3. *Só Gestor de tráfego* — **Propostas para {canal}**, antes dos números porque é o que pede ação (lei 9): a
   proposta mais nova da fila do canal num `.yn-decision` (tipo, título, motivo, quem propôs, marca, campanha,
   custo estimado, impacto · esforço, data) com "1 de N", **Descartar** e **Aprovar**; o link "Ver as N em
   Tráfego com IA" leva à fila inteira, já no canal.
4. **12 indicadores** (até 4 por linha em 1280px, 1 por linha em 375px): Investimento · Leads · Custo por lead
   (CPL) · Custo por cliente novo · Clientes novos · ROAS · Conversões · Custo por conversão (CPA) · Impressões ·
   Cliques · Taxa de cliques (CTR) · Custo por clique (CPC). Leads leva a **Leads** (origem = esta plataforma);
   Clientes novos leva a **Chegada de clientes** (canal = esta plataforma) e Custo por cliente novo, ao mesmo
   lugar já rolado até o custo por marca e canal (`/chegada?canal=…#custo-por-cliente-novo`). Embaixo, uma
   linha diz de onde vem cada número. Com "Comparar com o anterior" desligado, nenhum indicador fala do período
   anterior.
5. *Só Gestor de tráfego* — **Humano × Claude**: a mesma linha de números para os dois (investimento, parcela da
   verba, campanhas ativas, leads, custo por lead, conversões, custo por conversão, ROAS, clientes novos, custo
   por cliente novo, ações propostas e executadas) e a diferença Claude em relação ao humano. Só as métricas
   de eficiência ganham cor (custo menor = verde, ROAS maior = verde); volume fica neutro, porque depende da
   verba de cada um. Uma frase no topo resume pelo número de sucesso: "No período, o custo por cliente novo
   do Claude está 23,1% acima do humano."
6. *Só Gestor de tráfego* — **Verba e teto da conta**: uma régua (`.yn-meter`) por marca com o uso do teto
   (investido pelas campanhas ativas ÷ teto de gasto delas), verba diária, teto de gasto e campanhas ativas
   ("5 (2 do Claude)"); a régua fica amarela a partir de 90%. Embaixo, **Parar tudo do Claude** (só para quem
   tem `parar_tudo`).
7. **Gráficos** lado a lado: "Investimento por dia" (eixo em reais) e "Leads por dia", uma linha por operador nas
   cores de série do operador (decisão 0007), legenda com rótulo e "Ver como tabela".
8. **Campanhas**: tabela do maior para o menor investimento. A primeira coluna é a campanha inteira — nome e,
   embaixo, chips de marca (em "As duas"), operador e status, mais o selo da ação já decidida ("Pausa
   aprovada", "Orçamento aprovado: R$ 240 por dia") e, no Gestor, **Pausar** e **Ajustar orçamento**. Os números
   vêm em conjuntos de colunas (`.yn-segmented` "Colunas da tabela", guardado em `?colunas=`):
   - **Resultado** (padrão): Investimento, Leads, CPL, Custo por cliente novo (com "N clientes novos" embaixo);
   - **Anúncios**: Impressões, Cliques, CTR, CPC, CPA (com "N conversões" embaixo), ROAS;
   - **Verba e teto** (só Gestor): Verba diária, Teto de gasto, Investido, Uso do teto (amarelo a partir de 90%).

   O título de cada coluna reordena a tabela. No celular, cada campanha vira um card.

## O que cada número quer dizer

| Número | Conta (na consulta, nunca na tela) |
|---|---|
| Investimento | Soma do gasto diário das campanhas do canal no período (marca, operador e campanha filtrados). |
| Leads, Conversões, Impressões, Cliques | Somas do que a plataforma informa por dia. |
| CPL · CPC · CPA | Investimento ÷ leads · ÷ cliques · ÷ conversões da plataforma. |
| CTR | Cliques ÷ impressões. |
| ROAS | Receita que a plataforma informa ÷ investimento; "Sem dados" quando nenhuma campanha tem receita rastreada ("Sem receita atribuída às campanhas"). |
| Clientes novos | Leads do canal que chegaram ao 1º pedido enviado no período, um por cliente do CSP 360, atribuídos à campanha pela UTM (decisões 0009 e 0012). |
| Custo por cliente novo | Investimento ÷ clientes novos atribuídos. |
| Verba diária · Teto de gasto | Soma do orçamento diário · do teto das campanhas **ativas** da conta. |
| Uso do teto | Investido pelas campanhas ativas no período ÷ teto delas. |
| Humano × Claude | Cada lado com as campanhas do seu operador; diferença = (Claude − humano) ÷ humano. |
| Parar tudo | Campanhas ativas do Claude na marca escolhida, em todos os canais (a mesma regra de `pararTudo`). |

Sem base, o indicador mostra "Sem dados" (nunca 0) e a tabela mostra "—".

## Estados

| Estado | Como forçar | O que aparece |
|---|---|---|
| Carregando | `?estado=carregando` | Esqueleto de indicadores e gráficos (`aria-busy`). A barra de filtros continua. |
| Vazia | `?estado=vazio` ou sem dados de exemplo | Ícone de megafone, "Nenhum número de {canal} ainda", "Ligue o conector de {canal} para as campanhas chegarem aqui." e "Ver conectores". |
| Erro | `?estado=erro` | "Não deu para carregar", "Tente de novo em alguns segundos. Se continuar, veja os conectores.", "Tentar de novo" (tira o `?estado=`) e "Código DEMO-500". |
| Sem dados | `?estado=sem-dados` | Cada indicador em "Sem dados"; gráficos em "Sem dados — Nenhum número no período para este gráfico."; campanhas em "Sem dados — Nenhum número de campanha no período."; no Gestor, "Sem dados de propostas no período.", Humano × Claude com "—" e réguas em "Sem dados", sem o botão de parar tudo. |
| Sucesso | sem parâmetro, com dados de exemplo | Indicadores com a comparação, gráficos, campanhas; no Gestor, a proposta do topo, Humano × Claude e verba e teto. |
| Filtro sem resultado | Campanha ou operador que não tem campanha no canal | "Nenhuma campanha com esses filtros — Limpe os filtros para ver todas as campanhas do canal." + "Limpar filtros". |
| Canal sem campanha | A marca não tem campanha neste canal | "Nenhuma campanha de {canal} em {marca} — Quando o conector trouxer campanhas, elas aparecem aqui." + "Ver conectores". |
| Fila vazia (Gestor) | Nenhuma proposta esperando | "Nenhuma proposta esperando aprovação neste canal." |
| Conector atrasado ou caído | estado do cartão do canal em Conectores | Aviso amarelo ou vermelho no topo do conteúdo (ver "Textos"). |
| Depois de dar certo | aprovar, descartar, pausar, ajustar, parar | Aviso rápido (`.yn-toast`) com o próximo passo; a proposta seguinte sobe ("1 de N−1"); a campanha ganha o selo da ação e trava Pausar e Ajustar orçamento para não duplicar; depois de parar tudo, as campanhas do Claude aparecem como "Pausada". |

"atualizado há X" na barra do topo vem da última sincronização do conector da plataforma (Meta Ads, TikTok Ads
ou Google Ads); sem o cartão do conector, vem da última atualização dos dados.

## Textos

| Onde | Texto |
|---|---|
| Linha sob os indicadores | "Leads, conversões e receita são os que o {canal} informa. Clientes novos vêm do CSP 360, pela UTM da campanha." |
| ROAS sem receita | "Sem dados" + "Sem receita atribuída às campanhas" |
| Aviso conector atrasado (amarelo) | **Conector de {canal} atrasado** — "A última sincronização foi há 3 h; o esperado é a cada 1 h. Os números podem estar defasados." + "Ver conectores" |
| Aviso conector caído (vermelho) | **Conector de {canal} caído** — "Sem sincronizar desde DD/MM/AAAA HH:MM. Os números desta tela param aí." (sem nenhuma sincronização: "Ainda não sincronizou. Os números desta tela não chegaram.") + "Ver conectores" |
| Propostas | "Propostas para {canal}" · "Ver as N em Tráfego com IA" (ou "Abrir Tráfego com IA") · "1 de N" · botões "Descartar" e "Aprovar" · sem papel que aprova: "Só o dono aprova propostas." |
| Janela Aprovar | "Aprovar a proposta?" · título da proposta · Quem propôs · Campanha · Custo estimado · "Aprovar não executa nada agora: a ação entra na fila de execução de Tráfego com IA e só roda quando houver credencial de escrita." · "Cancelar" · "Aprovar proposta" → aviso "Proposta aprovada." |
| Janela Descartar | "Descartar a proposta?" · campo "Motivo (fica no diário de ações)" · "Pelo menos 10 letras." · "Cancelar" · "Descartar proposta" (travado até 10 letras) → "Proposta descartada." |
| Humano × Claude | "Humano × Claude" · frase do número de sucesso (ou "A mesma linha de números para os dois em {canal}, no período.") · "Diferença = Claude em relação ao humano." |
| Verba e teto | "Verba e teto da conta" · "Campanhas ativas de {canal}. O uso do teto conta o que elas investiram no período." · régua "R$ X no período" / "teto de R$ Y" · "Perto do teto: a plataforma para as campanhas quando ele acaba." · "Nenhuma campanha ativa nesta conta." |
| Parar tudo | "Parar tudo pausa na hora as campanhas ativas do Claude em todos os canais, nas duas marcas. As do humano continuam." (ou "… de Corpo Sensual.") · botão "Parar tudo do Claude" · sem nenhuma ativa: botão travado e "Nenhuma campanha do Claude ativa agora." |
| Parar tudo, 1ª confirmação | "Parar tudo do Claude?" · "Pausa na hora as N campanhas ativas do Claude nas duas marcas, em todos os canais. As campanhas do humano continuam." · uma linha por canal ("Meta Ads — 3 campanhas ativas") · "Cancelar" · "Continuar" |
| Parar tudo, 2ª confirmação | "Confirme: parar N campanhas do Claude" · caixa "Entendo que elas param de veicular agora e só voltam quando alguém reativar." · "Cancelar" · "Parar N campanhas" (travado até marcar a caixa) → "N campanhas do Claude pausadas." |
| Campanha | botões "Pausar" e "Ajustar orçamento" · travados com a dica "Já há uma ação aprovada para esta campanha. Acompanhe em Tráfego com IA." · selos "Pausa aprovada", "Pausa em execução", "Orçamento aprovado: R$ X por dia", "Orçamento em execução" |
| Janela Pausar | "Pausar {campanha}?" · Operador · Marca · Investido no período · Custo por lead · Clientes novos · "Motivo (opcional)" · "Fica no diário de ações de Tráfego com IA." · "Cancelar" · "Aprovar pausa" (ou "Propor pausa") → "Pausa aprovada. Acompanhe a execução em Tráfego com IA." (ou "Pausa proposta. O dono aprova em Tráfego com IA.") |
| Janela Ajustar orçamento | "Ajustar o orçamento de {campanha}" · campo "Novo orçamento diário (R$)", já com o valor de hoje · "Hoje: R$ X por dia. Aceita 150, 150,00 ou 1.500,00." · "Sobe 25,0%: R$ 30 a mais por dia, cerca de R$ 900 em 30 dias." (+ " Mudança grande: confira o valor." acima de 50%) · erros "Informe um valor em reais, como 150 ou 150,00.", "Use um valor maior que zero.", "O valor é igual ao de hoje." · "Motivo (opcional)" · "Cancelar" · "Aprovar orçamento" (ou "Propor orçamento") → "Orçamento aprovado. Acompanhe a execução em Tráfego com IA." |
| Fechar com algo digitado | "Descartar o que você digitou?" · "Continuar editando" · "Descartar" |
| Canal não encontrado | "Esse canal não existe" · "O endereço pode ter mudado. Escolha um dos canais pagos." · "Ver Meta Ads" · "Ver TikTok Ads" · "Ver Google Ads" |

Os links "Ver conectores" só aparecem para quem pode ver Conectores (`ver_conectores`), e "Ver as N em Tráfego
com IA" só para quem vê o módulo (`ver_trafego_ia`).

## Visão e papel

| | Visualizador | Gestor de tráfego |
|---|---|---|
| Indicadores, gráficos, campanhas | sim | sim |
| Propostas do canal, Humano × Claude, verba e teto | não | sim |
| Conjunto de colunas "Verba e teto" | não | sim |
| Aprovar e Descartar | não | papel com `aprovar_acao` (dono) |
| Pausar e Ajustar orçamento | não | `aprovar_acao` → já aprovada; só `operar_trafego_ia` → vira proposta |
| Parar tudo do Claude | não | papel com `parar_tudo` (dono) |

A Visão só muda o que a tela mostra; o papel decide o que a pessoa pode fazer (decisão 0011).

## Responsivo e temas

- **1280px** (menu aberto): 4 indicadores por linha; gráficos lado a lado; Humano × Claude e a tabela de
  campanhas na largura toda, sem rolar de lado em nenhum dos três conjuntos de colunas (conferido: largura da
  tabela = largura da área). Em **1920px**, 6 indicadores por linha.
- **375px**: 1 indicador por linha, gráficos empilhados, Humano × Claude e campanhas viram cards
  (`.yn-table--stack`), botões com 44px de toque, sem rolagem lateral na página.
- Claro e escuro só por tokens; cores de série só no operador e na marca (chips, legenda e linhas dos gráficos).
- Conferida no protótipo em 30/10/2026 em 1280px e 375px, claro e escuro, nos cinco `?estado=`, nas duas
  visões, com "As duas" e uma marca, nos três canais e com o canal inexistente; aprovar, descartar, pausar,
  ajustar orçamento (valor inválido, igual e com "R$ 1.000,00"), fechar com texto digitado e parar tudo
  exercitados na demonstração.

## As 8 perguntas de UX (seção 7 do padrão)

1. **Qual é a uma ação principal, e ela é o botão mais forte, no alcance do dedo?** No Visualizador, ler o custo
   por cliente novo comparado ao período anterior — não há botão principal. No Gestor, **Aprovar** a proposta
   do topo da fila: é o único botão principal, no rodapé do cartão da proposta, que abre o conteúdo nessa
   visão; no celular fica no canto direito do cartão, com 44px, no alcance do polegar. Parar tudo é botão de
   perigo, noutro bloco, bem abaixo.
2. **Funciona como os sites que a pessoa já usa?** Como o gerenciador de anúncios: conjuntos de colunas
   (Resultado, Anúncios), as siglas do próprio pedido (CPL, CTR, CPC, CPA, ROAS), ordenação pelo título da
   coluna, Pausar e orçamento na linha da campanha; aprovar e reprovar como o `.yn-decision` do padrão.
3. **Dá para entender os grupos sem ler tudo?** Cada bloco tem título (Propostas, Humano × Claude, Verba e teto,
   gráficos, Campanhas) e 24px de distância; a identidade da campanha (marca, operador, status) fica junta, em
   chips embaixo do nome.
4. **Tem algo que dá para tirar?** Tirados: colunas separadas de marca, operador e status (viraram chips), as
   colunas de clientes novos e de conversões (foram para baixo do custo que elas explicam), canal, origem e
   representante do painel de filtros (não valem aqui) e o `?canal=` redundante da URL.
5. **O sistema fez o trabalho chato e aceitou o que a pessoa digitou?** O orçamento abre com o valor de hoje;
   aceita 150, 150,00, 1.500,00 e "R$"; mostra na hora quanto muda por dia e em 30 dias e calcula o custo
   estimado; o motivo é opcional (a trilha registra que não houve); período, comparação e marca já vêm prontos.
6. **Como fica quando demora, quando dá errado e quando dá certo?** Esqueleto; erro com "Tentar de novo" e
   código; aviso de conector atrasado ou caído; "Sem dados" sem base; erro no próprio campo, sem apagar o que
   foi digitado; as janelas travam o botão enquanto gravam, o Esc pergunta antes de descartar texto; o sucesso
   tem aviso com o próximo passo e o selo na campanha.
7. **A pessoa sabe o que falta e até quando?** "atualizado há X" do conector do canal; régua do teto com "Perto do
   teto"; "1 de N" na fila de propostas; selo "Pausa aprovada" até a execução.
8. **O mais importante está no começo do menu e no topo da lista?** Avisos de conector acima de tudo; no Gestor,
   o que pede ação (a proposta) vem antes dos números; Investimento, Leads, CPL e Custo por cliente novo na
   primeira linha de indicadores; a tabela abre pelo maior investimento.

## Para decidir na fase 3

- **ROAS**: hoje é a receita que a plataforma informa (`revenue_cents` do snapshot). Os Parâmetros pedem receita
  atribuída (pedido enviado do cliente novo, por UTM + `clientes.id`) ÷ investimento. Decidir qual vale aqui e
  se os dois aparecem com nomes diferentes.
- **Dois "custo por lead"**: aqui é investimento ÷ leads da plataforma; na Visão geral é investimento ÷ leads do
  CSP 360 atribuídos à campanha. Dar nomes diferentes ou escolher um.
- **Parar tudo** pausa o Claude em todos os canais da marca (é a regra de `pararTudo`). Se o dono quiser
  "parar só este canal", vira ação nova. A parada também não fica na trilha de ações hoje.
- **Teto de gasto**: no modelo é por campanha (`spendCapCents`); a Meta tem também o `spend_cap` da conta.
  Definir de qual teto a régua fala e a janela dele (mês ou vida da campanha).
- **Reativar** campanha pausada e **trocar o operador** de uma campanha (decisão 0008) não estão nesta tela.
- **T3 do README**: ajustado na revisão de UX da fase 2. O bloco Humano × Claude é da visão Gestor de tráfego:
  1 toque já nela (menu → canal), 2 partindo do Visualizador. Fica a decidir se ele aparece também no
  Visualizador, e se, em 375px, sobe para antes dos 12 indicadores na visão Gestor.

`tela.test.ts` desenha a tela no servidor e confere os destinos dos indicadores (Leads, Clientes novos e Custo
por cliente novo) e que, sem comparação, nenhum indicador fala do período anterior.

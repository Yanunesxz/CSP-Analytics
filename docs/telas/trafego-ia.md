# Tráfego com IA — `/trafego`

> Grupo **Tráfego** do menu · pasta `apps/web/src/modules/trafego-ia` · números de `painelDoTrafego` em
> `apps/web/src/data/queries/trafego-ia.ts` (vira as views `kpi_trafego_*` na fase 3), com teste em
> `trafego-ia.test.ts`. Quem abre: quem tem `ver_trafego_ia` (`owner` e `traffic_manager`); a rota e o item do
> menu conferem o papel. Nenhuma plataforma é chamada: o operador Claude é simulado (decisão 0005).

## O que a pessoa faz nesta tela

- **Decide as propostas** do Claude e as ideias do gestor, uma por vez, com os fatos que justificam cada uma:
  **Aprovar** ou **Descartar** (com motivo). Aprovar só muda o status para "Aprovada" e grava quem e quando; nada
  executa (a execução liga quando houver credencial de escrita; até lá, **Marcar como feita**).
- Vê e filtra **O que podemos fazer**: todas as ações (propostas do Claude, ideias do gestor e pendências que travam
  a medição, como "GA4 sem ID no site"), com custo estimado, impacto, esforço, quem propôs e status (Ideia ·
  Aprovada · Em execução · Feita · Descartada). Filtra por marca (menu), canal, campanha e operador (barra de
  filtros), status (chips), impacto e esforço (painel "Filtrar a lista") e salva conjuntos em **Meus filtros da
  lista**. Registra ideia nova.
- Acompanha **o Claude agora** (quantas campanhas ele opera) e usa **Parar tudo do Claude** (confirmação dupla), com
  **Desfazer a parada** logo depois.
- Escreve a **estratégia do mês por marca** (texto que o Claude lê, verba, metas) e vê o mês até hoje ao lado.
- Acompanha e muda os **limites de gasto por conta** (marca × canal).
- Compara **Humano × Claude** com a mesma linha de números para os dois.
- Lê o **diário de ações**: quem propôs, aprovou, executou, descartou, parou ou mudou o quê, e quando.

Tarefa T4 do [README](README.md) ("aprovar uma proposta do Claude"): menu → **Tráfego com IA** → **Aprovar** na
fila (o primeiro bloco da aba que abre) → **Aprovar proposta** na confirmação, que mostra o nome e o custo estimado
(3 toques; partindo do Visualizador, + **Ver como gestor de tráfego**).
Uma proposta específica da lista: **Decidir** na linha dela leva a proposta para a fila (`?proposta=`).

## A ação principal (uma só)

**Aprovar**, no cartão da fila de aprovação: o único botão principal (`.yn-btn--primary`) da tela, ao lado de
**Descartar** (secundário). "Parar tudo do Claude" (botão de perigo) fica no cartão "O Claude agora", acima das abas,
sempre à vista e longe do Aprovar. No Visualizador, o único botão é **Ver como gestor de tráfego**.

## Como a tela é montada (de cima para baixo)

| Bloco | O que mostra | Visão |
|---|---|---|
| Aviso da visão | `.yn-empty` "Esta tela é da visão Gestor de tráfego" + **Ver como gestor de tráfego** (troca `?visao=` e a memória) | só Visualizador |
| Barra de filtros | Período (padrão "Este mês"), "Comparar com o anterior", 5 chips rápidos (Humano, Claude, Meta Ads, TikTok Ads, Google Ads) e **Filtros** (canal, campanha, operador, "Meus filtros") | Gestor |
| O Claude agora | Campanhas ativas do Claude na marca, por canal; "Ele propõe; nada roda sem aprovação…"; **Parar tudo do Claude**; depois de parar, aviso "Claude parado…" com **Desfazer a parada** | Gestor |
| Abas (`?aba=`) | **Fila e ações** (com o número da fila) · **Estratégia** · **Limites de gasto** · **Humano × Claude** · **Diário**; setas, Home e End mudam de aba | Gestor |
| Fila e ações → fila de aprovação | O primeiro bloco da aba (o que pede decisão vem antes de tudo; no celular, o **Aprovar** fica na primeira tela). `.yn-decision`: tipo · marca · canal, título, quem propôs (chip Humano/Claude), por quê, ficha (custo estimado, impacto, esforço, campanha, gasto da conta no mês, proposta em), alerta quando há, "‹ 1 de 10 ›", **Descartar** e **Aprovar** | Gestor |
| Fila e ações → pendências | `.yn-alert` "N pendências travam a medição" com **Marcar como feita** em cada uma | Gestor, quando há |
| Fila e ações → indicadores | Esperando sua decisão (e o custo estimado da fila) · Aprovadas, a executar · Feitas no período (variação) · Horas até aprovar, em média (variação; cair é verde). Com "Comparar com o anterior" desligado, a variação some e nenhum texto fala do período anterior | Gestor |
| Fila e ações → O que podemos fazer | **Registrar ideia**; chips de status com contagem; **Filtrar a lista** (impacto, esforço, Meus filtros da lista); chips ativos com "Remover filtro"; resumo `aria-live`; uma linha por ação com status, por quê, ficha, alerta, resultado e o próximo passo (**Decidir** ou **Marcar como feita**) | Gestor |
| Estratégia | Um cartão por marca: texto do mês, régua da verba (gasto do mês até hoje contra a verba e a projeção), custo por cliente novo, custo por lead e clientes novos no mês contra as metas; **Escrever/Editar estratégia** | Gestor |
| Limites de gasto | Por marca, um cartão por canal: régua do gasto do mês contra o limite, projeção do mês, campanhas ativas (e do Claude), selo "Passou do limite"/"Vai passar do limite", **Mudar limite** | Gestor |
| Humano × Claude | Tabela com a mesma linha para os dois (investimento, parcela da verba, campanhas ativas, leads, custo por lead, conversões, custo por conversão, ROAS, clientes novos, custo por cliente novo, ações propostas e executadas) e "Claude vs. humano" com "melhor"/"pior"; barras "Custo por lead por canal" com "Ver como tabela" | Gestor |
| Diário | `.yn-timeline` do período, do mais novo ao mais antigo, 20 de cada vez (**Mostrar mais**, `?diario=`) | Gestor |

## Regras dos números (todas em `painelDoTrafego`, nenhuma conta na tela)

- **Fila de aprovação:** a mesma de `acoes().filaDeAprovacao` (a da Visão geral): ideias que não são pendência de
  medição, com os filtros da barra. Ordem: maior impacto, menor esforço, a que espera há mais tempo.
- **O que podemos fazer:** todas as ações com os filtros da barra; os chips de status contam com impacto e esforço,
  sem o status. Ordem: Ideia, Aprovada, Em execução, Feita, Descartada; dentro de cada, impacto, esforço e a mais
  nova. No máximo 200 linhas (o resto pede filtro).
- **Alerta da ação** (fato, não opinião): campanha encerrada; pausa de campanha já pausada; mudança em campanha
  pausada; custo estimado que, somado ao gasto do mês, passa do limite da conta.
- **Indicadores:** "Feitas no período" pela data de execução; "Horas até aprovar" = média entre proposta e
  aprovação das aprovadas no período; os dois comparam com o período anterior. Sem ações: "Sem dados".
- **Limite e verba são do mês corrente até hoje**, qualquer que seja o período escolhido. Limite da conta = soma
  dos limites (`spendCapCents`) das campanhas ativas, como em `acoes().tetos`; gasto da conta = todas as campanhas
  dela. Projeção = gasto ÷ dias corridos × dias do mês. "Passou" quando gasto ≥ limite; "Vai passar" quando a
  projeção passa do limite. **Mudar limite** reparte o novo valor entre as campanhas ativas da conta, na mesma
  proporção (a soma bate ao centavo), para a Visão geral e as telas de canal mostrarem o mesmo.
- **Estratégia:** custo por cliente novo, custo por lead e clientes novos do mês com a mesma conta da Visão geral
  (`custoPorClienteNovo`). Custo até a meta está "dentro"; clientes novos comparam com a parte da meta que já
  deveria ter chegado até hoje. Meta vazia é "A definir" (nunca inventada).
- **Parar tudo do Claude:** pausa toda campanha ativa do Claude na marca escolhida, em todos os canais
  (`pararTudo` da fundação). As do humano continuam. **Desfazer** reativa só as que continuam pausadas.
- **Diário:** proposta (`createdAt`), aprovação (`approvedAt`, com o nome de quem aprovou), em execução e feita
  (`executedAt`, com o resultado) vêm da própria ação; descarte (hora e autor), mudança de limite, parar tudo,
  desfazer e estratégia vêm do registro da tela. Descarte sem hora conhecida (dado antigo) não vira linha.
- **Humano × Claude:** `porOperador` da fundação; ignora o filtro de operador, porque a comparação é ele.
  Investimento, parcela da verba, campanhas ativas e ações não são "melhor" nem "pior".

## Estados

| Estado | Como ver | O que aparece |
|---|---|---|
| Carregando | `?estado=carregando` | Esqueleto (`aria-busy`): 4 cartões e 2 blocos. A barra de filtros fica no lugar. |
| Vazia | `?estado=vazio`, ou a demonstração sem `VITE_SAMPLE_DATA` | "**Nada para operar ainda**" · "As campanhas, as propostas do Claude e os limites de gasto aparecem quando os conectores trouxerem as contas de anúncio. Veja o que falta ligar em Conectores." · **Ver conectores** |
| Erro | `?estado=erro` | "**Não deu para carregar**" · "Tente de novo em alguns segundos. Se continuar, veja os conectores." · **Tentar de novo** · "Código DEMO-500" |
| Sem dados | `?estado=sem-dados` | A tela inteira: os 4 indicadores em "Sem dados"; "Sem dados das campanhas do Claude." (Parar tudo travado); fila, lista e diário com "Sem dados" e o que falta; estratégia e limites com "Sem dados" e "Meta a definir"; gráfico "Sem dados". Nunca 0. |
| Sucesso | sem parâmetro, com os dados de exemplo | Tudo acima, com números, alertas e o diário. |
| Fila vazia | todas decididas | "**Nenhuma proposta esperando você**" · "As novas propostas do Claude e as ideias do gestor aparecem aqui. O que já foi decidido está no Diário." |
| Filtro sem resultado | um filtro que não acha nada | Fila: "**Nenhuma proposta com estes filtros**" + **Limpar filtros**. Lista: "**Nenhuma ação com estes filtros**" + **Limpar filtros** (limpa barra e lista de uma vez). Diário: "**Nada no diário neste período**". |
| Visualizador | `?visao=visualizador` | Só o aviso da visão e **Ver como gestor de tráfego**. |

**Depois de dar certo** (aviso rápido `.yn-toast`, e o diário ganha a linha na hora):

| Ação | Aviso | O que muda na tela |
|---|---|---|
| Aprovar | "Proposta aprovada: [título]." | A fila anda para a próxima ("1 de 9"); o foco fica no Aprovar |
| Descartar | "Proposta descartada: [título]." | A fila anda; o motivo fica na ação e no diário |
| Marcar como feita | "Ação marcada como feita." / "Pendência marcada como feita." | Status "Feita" e o resultado na linha |
| Registrar ideia | "Ideia registrada. Ela está na fila de aprovação." (pendência: "Pendência registrada.") | Entra na lista e na fila |
| Parar tudo | "N campanhas do Claude pausadas." | Aviso "Claude parado…" com **Desfazer a parada** |
| Desfazer a parada | "N campanhas do Claude reativadas." | O aviso some |
| Mudar limite | "Limite de [canal] · [marca] salvo." | A régua e o selo da conta mudam |
| Salvar estratégia | "Estratégia de [marca] salva." | O cartão mostra o texto, a verba, as metas e "Atualizada em … por …" |

## Textos de cada botão e aviso

| Onde | Texto |
|---|---|
| Barra do topo | "Tráfego" (eyebrow) · **Tráfego com IA** (h1, desenhado pela casca) · "atualizado há X min" |
| O Claude agora | "Opera N campanhas ativas nas duas marcas: Meta Ads 3 · TikTok Ads 3 · Google Ads 4." · "Ele propõe; nada roda sem aprovação. A execução nas plataformas liga quando houver credencial de escrita." · **Parar tudo do Claude** · "Claude parado nas duas marcas" · **Desfazer a parada** |
| Parar tudo, etapa 1 | "Parar tudo do Claude?" · "Pausa agora as N campanhas ativas do Claude …, em todos os canais. As campanhas do humano continuam." · **Cancelar** · **Continuar** |
| Parar tudo, etapa 2 | "Confirme: parar N campanhas do Claude" · caixa "Entendo que elas param de veicular agora e só voltam quando alguém reativar." · "Fica no diário de ações, com quem parou e quando. Dá para desfazer logo depois." · **Parar N campanhas** (travado até marcar a caixa) |
| Fila | "Fila de aprovação" · "Uma proposta por vez: primeiro a de maior impacto e menor esforço." · "Proposta anterior" / "Próxima proposta" (botões só com ícone) · **Descartar** · **Aprovar** · "Aprovar não executa nada agora: a ação espera a execução, que liga quando houver credencial de escrita na plataforma. Feita fora daqui, use "Marcar como feita"." · sem papel para aprovar: "Só o dono aprova ou descarta. A proposta espera por ele aqui." |
| Aprovar | "Aprovar a proposta?" · título · Quem propôs, Marca e canal, Campanha, Custo estimado · alerta · **Aprovar proposta** |
| Descartar | "Descartar a proposta?" · "Motivo (fica no diário de ações)" · "Pelo menos 10 letras." · **Descartar proposta** |
| Marcar como feita | "Marcar como feita?" · "O que foi feito (fica no diário de ações)" · "Onde e como, para quem ler depois. Pelo menos 5 letras." · **Marcar como feita** |
| Lista | "O que podemos fazer" · **Registrar ideia** · chips "Ideia 12", "Aprovada 3"… · **Filtrar a lista** · "Impacto: Alto" com "Remover filtro Impacto" · **Limpar filtros da lista** · "20 ações: primeiro o que pede decisão, depois o que está em andamento." · **Decidir** (ou **Ver na fila** sem papel para aprovar) · **Marcar como feita** |
| Filtrar a lista | "Impacto" e "Esforço" (Todos · Baixo · Médio · Alto) · "Meus filtros da lista" · "Salvar os filtros de agora como" · **Salvar** · "Excluir o conjunto …" · **Limpar filtros da lista** · **Fechar** |
| Registrar ideia | "O que fazer" · "Por quê" · "Marca" · "Canal" ("Nenhum (site, medição)") · "Tipo de ação" · "Campanha (opcional)" · "Impacto" · "Esforço" · "Custo estimado (R$, opcional)" · **Registrar ideia** |
| Estratégia | "Estratégia por marca" · **Escrever estratégia** / **Editar estratégia** · "Ainda não escrita" / "Atualizada em … por …" · "Verba de outubro a definir." · "No ritmo de hoje, outubro fecha em R$ X." · "Meta a definir" · selos "Acima da meta", "Abaixo do ritmo", "Vai passar da verba", "Passou da verba" |
| Editar estratégia | "Estratégia do mês" (o Claude lê; sem nome, telefone ou documento) · "Verba do mês (R$)" · "Meta de custo por cliente novo (R$)" ("Deixe em branco até ter 4 semanas medidas.") · "Meta de custo por lead (R$)" · "Meta de clientes novos no mês" · **Salvar estratégia** |
| Limites | "Limites de gasto por conta" · "R$ X gastos" / "de R$ Y" · "Sem campanha ativa nesta conta: não há limite para acompanhar." · selos "Passou do limite", "Vai passar do limite" · **Mudar limite** |
| Mudar limite | "Limite de Meta Ads · Corpo Sensual" · "Novo limite do mês (R$)" · "O limite da conta é a soma dos limites das campanhas ativas: cada uma muda na mesma proporção." · aviso "Fica abaixo do que a conta já gastou no mês…" · **Salvar limite** |
| Diário | "Diário de ações" · "Proposta do Claude", "Proposta do humano", "Pendência de medição registrada", "Aprovada por …", "Em execução", "Feita", "Descartada por …", "Parou tudo do Claude", "Desfez a parada do Claude", "Limite de gasto mudou", "Estratégia atualizada" · "Mostrando 20 de N registros." · **Mostrar mais 20** |
| Janelas | Esc fecha; clicar fora não fecha; com algo digitado pergunta "Descartar o que você digitou?" (**Continuar editando** · **Descartar**); erro de campo leva o foco ao primeiro campo com erro |

## Responsivo (pelo espaço)

- **1280px:** 4 indicadores numa linha; a ficha da proposta numa linha só; a lista e a tabela Humano × Claude cabem
  inteiras (sem rolagem interna); 3 contas por linha em Limites.
- **375px:** 1 indicador por linha; a ficha da proposta e a de cada ação em 2 colunas; botões da proposta embaixo
  do "1 de 10"; chips de status e as abas rolam de lado (só elas); a tabela Humano × Claude vira cards; janelas
  ocupam a largura; nada passa de 375px (conferido em cada aba).
- Claro e escuro só por tokens; cor de série (decisão 0007) só no chip e na legenda de operador e marca, sempre com
  o nome; status (aprovada, em execução, feita, descartada) e alertas com as cores de status do padrão.
- **Conferido no navegador** (build de demonstração com dados de exemplo, 30/10/2026): 1280px claro e escuro,
  375px claro e escuro (com toque emulado), nas cinco abas e no Visualizador; sem rolagem lateral na página;
  fluxos feitos de ponta a ponta: aprovar (com confirmação), parar tudo (duas etapas) e desfazer, estratégia,
  mudar limite (abaixo do gasto), registrar ideia (com erros e com sucesso), marcar como feita, filtros da lista
  e conjunto salvo, teclado nas abas.

## As 8 perguntas de UX (seção 7 do padrão)

1. **Qual é a uma ação principal, e ela é o botão mais forte, no alcance do dedo?** Aprovar, o único botão
   principal, no cartão da fila, o primeiro bloco da aba "Fila e ações" (antes das pendências, dos indicadores e
   da lista; até a revisão de UX da fase 2 vinha depois dos quatro indicadores, que no celular o empurravam para
   fora da primeira tela). No celular fica na largura do polegar, embaixo da ficha da proposta. Parar tudo é botão
   de perigo, separado, acima das abas.
2. **Funciona como os sites que a pessoa já usa?** Fila de aprovação como uma caixa de entrada (uma por vez,
   anterior e próxima), abas no topo, filtros com chips e painel lateral como nos painéis da RD Station,
   confirmação antes do que não dá para voltar e "Desfazer" depois do que dá.
3. **Dá para entender os grupos sem ler tudo?** O Claude agora (o estado e a trava) → abas por assunto: decidir
   (fila e lista), o plano (estratégia), o dinheiro (limites), a comparação (Humano × Claude) e a história
   (diário). Cada bloco tem título e uma frase.
4. **Tem algo que dá para tirar?** Saíram: a régua de "esperado hoje" nos limites e na verba (pintava de atenção
   quem gastava abaixo do ritmo, que é bom), aprovar direto da lista (a decisão fica com os fatos, na fila), a
   tabela da lista (virou linhas que quebram, sem rolagem) e os cartões de meta dentro do cartão da estratégia.
5. **O sistema fez o trabalho chato e aceitou o que a pessoa digitou?** A fila já vem na ordem de prioridade com os
   fatos e o alerta de limite; o limite novo é repartido entre as campanhas sozinho; a verba sugere o orçamento
   diário das ativas; campos de dinheiro aceitam "1.500", "1500,50", "R$ 1.500"; o texto para o Claude barra
   e-mail, telefone e documento.
6. **Como fica quando demora, quando dá errado e quando dá certo?** Esqueleto; "Não deu para carregar" com "Tentar
   de novo" e código; "Nada para operar ainda" com "Ver conectores"; "Sem dados" (nunca 0); e o aviso de cada ação
   com o nome do item, mais a linha no diário. Ver **Estados**.
7. **A pessoa sabe o que falta e até quando?** "1 de 10" na fila e o número na aba; "Esperando sua decisão" com o
   custo estimado; "Aprovadas, a executar"; projeção do mês em cada conta e na verba; "Abaixo do ritmo" da meta;
   "Mostrando 20 de N" no diário; "atualizado há X min".
8. **O mais importante está no começo do menu e no topo da lista?** No menu, Tráfego com IA é o grupo próprio,
   antes de Sistema. Na tela, a trava (Parar tudo) e o que pede decisão vêm primeiro: a fila abre a aba, as
   pendências vêm logo depois e os indicadores, que resumem, depois delas; na lista, Ideia antes de Aprovada, Em
   execução, Feita e Descartada, e o maior impacto com o menor esforço no topo.

## Limites conhecidos

- **Estratégia e parte do diário ficam num registro local da tela** (`modules/trafego-ia/estado.ts`): o tipo
  `Dados` ainda não tem estratégia, nem diário para parar tudo, desfazer, mudança de limite e hora/autor do
  descarte. O registro vale para o conjunto em que foi feito: o "Recomeçar" e o `?estado=sem-dados` o ignoram. Na
  fase 3 vira `traffic_strategies` e `traffic_log` (com RLS por papel) e as ações vão para `data/actions.ts`.
- `descartarAcao` da fundação não guarda quando nem quem descartou: a tela anota isso no registro local.
- Mudar limite e desfazer a parada gravam nas campanhas por `store.alterar`, dentro do módulo, porque
  `data/actions.ts` não tem essas ações.
- Status, impacto, esforço, aba, proposta e diário são chaves só desta tela (fora de `Filtros`): não entram no
  "Limpar filtros" nem no "Meus filtros" da barra. A lista tem os seus ("Limpar filtros da lista" e "Meus filtros
  da lista", em `localStorage` `meus-filtros-trafego`, com canal, campanha e operador junto).
- Mudar limite exige `aprovar_acao` (só o dono): não existe uma ação própria em `rules.ts` para o limite.
- `spendCapCents` não diz de que período é; aqui é tratado como limite do mês.
- Os dados de exemplo repetem títulos de ação (há mais de uma "Criar campanha de remarketing para Corpo
  Sensual"): depois de aprovar, a próxima da fila pode ter o mesmo título. O aviso com o título e o "1 de N"
  mostram que a fila andou.
- `.yn-tabs` do padrão sobra 1px em pé (aba com margem de -1px num contêiner que rola de lado) e mostra uma barra
  de rolagem vertical: a tela corrige com `overflow-y: hidden` na fila de abas, até a correção no padrão.
- A janela (`Janela.tsx`) é uma cópia local da janela da tela de canal: falta uma janela comum em `components/ui`.
- `tela.test.ts` desenha a tela no servidor em todos os estados, nas duas visões e em cada aba; `estado.test.ts`
  roda as ações contra o store. Nada disso substitui a conferência no navegador a cada mudança de layout.

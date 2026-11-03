# Telas do CSP-MKT — fase 2 (protótipo no modo demonstração)

> Índice dos módulos e das tarefas principais da fase 2, com o caminho mais curto de cada uma.
> O contrato técnico que cada módulo segue está em [`00-contrato.md`](00-contrato.md).
> Portão da fase: o dono faz a T1 no protótipo, no computador e em 375px, sem ajuda.

## Como abrir o protótipo

```bash
pnpm install
pnpm dev:exemplo     # modo demonstração com dados de exemplo (sem Supabase), em http://localhost:5173
```

Sem `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` o app abre sem login, como o dono de exemplo, com a faixa preta
"Modo demonstração · dados de exemplo" e o botão "Recomeçar". `pnpm dev:exemplo` é o `pnpm dev` com
`VITE_SAMPLE_DATA=true` (`--mode exemplo`, funciona igual no Windows); com `pnpm dev` puro abre vazio.
Para ver qualquer tela num estado específico, acrescente `?estado=carregando|vazio|erro|sem-dados` na URL.

## Módulos (uma rota por módulo, no menu gaveta)

| Grupo | Módulo | Rota | Pasta | Quem vê |
|---|---|---|---|---|
| Início | Visão geral | `/` | `src/modules/visao-geral` | todos |
| Clientes | Chegada de clientes | `/chegada` | `src/modules/chegada-de-clientes` | todos |
| Clientes | Base de clientes | `/base` | `src/modules/base-de-clientes` | todos |
| Clientes | Leads | `/leads` | `src/modules/leads` | todos (sem dado pessoal) |
| Canais | Meta Ads · TikTok Ads · Google Ads | `/canais/meta` · `/canais/tiktok` · `/canais/google` | `src/modules/canais` (um componente, `:plataforma`) | todos |
| Canais | Instagram | `/instagram` | `src/modules/instagram` | todos |
| Canais | SEO e GEO | `/seo-geo` | `src/modules/seo-geo` | todos |
| Tráfego | Tráfego com IA | `/trafego` | `src/modules/trafego-ia` | `owner`, `traffic_manager` |
| Sistema | Conectores | `/conectores` | `src/modules/conectores` | `owner`, `traffic_manager` |
| Sistema | Usuários | `/usuarios` | `src/modules/usuarios` | `owner` |
| Sistema | Diagnóstico | `/diagnostico` | `src/modules/diagnostico` (pronto) | `owner` |
| Sistema | Configurações | `/configuracoes` | `src/modules/configuracoes` (tema pronto) | todos |

Controles globais (em toda tela, pela casca): **Marca** no `.yn-context` do menu (`?marca=cs|plumene|todas`), **Visão**
no `.yn-segmented` da barra do topo (`?visao=visualizador|gestor`), **Tema** no botão lua/sol e em Configurações.
Filtros de dados são componente (`BarraDeFiltros`) de toda tela de números, nunca rota.

## Tarefas principais e o caminho mais curto

Contagem a partir do sistema aberto na Visão geral, com os dados de exemplo. "Toque" = clique ou toque. No
computador o menu está sempre à vista; em 375px ele é gaveta, então "menu → item" custa um toque a mais (☰).
Contagens conferidas no código em 30/10/2026 (revisão de UX da fase 2).

| # | Tarefa | Caminho mais curto | Computador | 375px |
|---|---|---|---|---|
| T1 | Saber quanto custou cada cliente novo por marca e por canal neste mês, comparado ao mês anterior | A Visão geral já abre em "Este mês" comparando com o anterior. O total é o 1º indicador, **Custo por cliente novo**, com a variação (0 toques). Logo depois dos indicadores, nas duas visões, o bloco **Custo por cliente novo** traz as tabelas **Por marca** e **Por canal**, com a variação embaixo de cada custo (0 toques; em 375px as tabelas viram cartões, depois dos oito indicadores). A matriz marca × canal: tocar no indicador **Custo por cliente novo** abre **Chegada de clientes** já rolada até "Custo por cliente novo por marca e canal" (`/chegada#custo-por-cliente-novo`, 1 toque). Uma marca só, por canal: tocar no nome da marca na tabela **Por marca** (1 toque), ou **Marca** no menu → a marca (2 toques no computador; em 375px, ☰ → Marca → a marca, 3, e a gaveta fecha sozinha). | 0 a 1 | 0 a 1 |
| T2 | Ver de onde chegam os leads e em que etapa estão | Menu → **Chegada de clientes**: funil lead → prospecto → cadastro → 1º pedido → faturado e o gráfico "Leads por origem". Lista com código, origem e etapa: menu → **Leads**; uma etapa só, chip da lista (+1). | 1 a 2 | 2 a 3 |
| T3 | Comparar Humano × Claude por canal | O bloco "Humano × Claude" é da visão **Gestor de tráfego**. Já nela: menu → **Meta Ads** (ou TikTok Ads, Google Ads): a mesma linha de métricas para os dois, com a diferença em % (1 toque). Partindo do Visualizador: + **Gestor de tráfego** no topo (2). Na Visão geral em Gestor, o bloco aparece somado; por canal, chip do canal na barra de filtros (+1). | 1 a 2 | 2 a 3 |
| T4 | Aprovar uma proposta do Claude | Menu → **Tráfego com IA** → **Aprovar** no cartão da fila de aprovação, o primeiro bloco da aba "Fila e ações" → **Aprovar proposta** na confirmação, que mostra o nome e o custo estimado (3 toques). Na Visão geral em Gestor, **Abrir Tráfego com IA** substitui o menu. Partindo do Visualizador: + **Ver como gestor de tráfego** (4). | 3 a 4 | 4 a 5 |
| T5 | Ver quem da base antiga parou de comprar e quem voltou | Menu → **Base de clientes**: os indicadores **Inativos**, **Perdidos** e **Reativados** já respondem (1 toque); tocar num deles abre a lista já filtrada e rolada até ela (`/base?recorte=inativos#lista-de-clientes`, 2 toques), o mesmo que o chip da lista. **Abrir no CSP 360** na linha abre a ficha 360 (3). | 1 a 3 | 2 a 4 |
| T6 | Ver qual conector está atrasado e tentar de novo | Menu → **Conectores**: o cartão atrasado vem em amarelo ("Atrasado") e o caído em vermelho, primeiro na lista, com "atualizado há X min"; **Tentar de novo** é o botão principal do primeiro cartão com problema (2 toques). | 2 | 3 |

**Portão da fase 2 (T1):** fecha em até 1 toque a partir da Visão geral, no computador e em 375px. Em 375px os
números por marca e por canal ficam depois dos oito indicadores (rolagem, sem toque): ver "Pendências de desenho".

Toda tela responde às 8 perguntas de UX da seção 7 do padrão antes de ir para aprovação, e mostra os cinco estados
(carregando, vazio, erro, sem dados, sucesso) pelo parâmetro `?estado=`.

## Revisão de UX da fase 2 (30/10/2026)

As 8 perguntas da seção 7 foram conferidas no código de cada módulo, contra o `.md` de cada tela. O que era pequeno
foi corrigido; o resto está em "Pendências de desenho".

- **Links que faltavam:** o indicador **Custo por cliente novo** (Visão geral e telas de canal), o **Investimento**
  da Visão geral e o nome da marca na tabela "Por marca" abrem a Chegada de clientes já no custo por marca e canal.
  Os indicadores **Clientes na base**, **Ativos**, **Inativos**, **Perdidos** e **Reativados** da Base de clientes
  abrem a lista já filtrada, mantendo o representante. Em Leads, **Lead → cliente novo** abre a Chegada de clientes
  com os mesmos filtros (antes perdia a origem e o canal). Na visão Gestor, o bloco de verba da Visão geral ganhou **Ver
  limites em Tráfego com IA**, o próximo passo de "Perto do limite" e "Acima do limite". `linkCom` aceita âncora e
  parâmetros da tela de destino (`montarLink`, com teste); as âncoras ficam em `src/rotas.ts`.
- **Ordem:** na Visão geral, o custo por marca e por canal (T1) vem logo depois dos indicadores também na visão
  Gestor, antes de Humano × Claude. Em Tráfego com IA, a fila de aprovação (o único botão principal, T4) abre a aba,
  antes das pendências, dos indicadores e da lista: no celular o **Aprovar** fica na primeira tela.
- **Texto:** com "Comparar com o anterior" desligado, nenhum indicador fala do período anterior (Visão geral, Leads,
  telas de canal e Tráfego com IA mostravam "Sem base vs. mês anterior" com a comparação desligada). Indicador sem
  dados diz só "Sem base para calcular", com ou sem comparação.
- **Casca:** a troca de tela volta ao topo (com `#âncora`, quem rola é a tela de destino); escolher a marca fecha a
  gaveta no celular e devolve o foco ao botão do menu. No celular, o botão de tema fica na linha do título (descia
  sozinho para uma terceira linha) e os filtros rápidos dividem a linha com "Filtros", rolando de lado: o primeiro
  indicador da Visão geral subiu cerca de 100px.
- **"Ver como tabela" em meia tela:** o cabeçalho e a coluna "Detalhe" quebram linha, e a tabela cabe no cartão em
  1280px sem rolar de lado (o Diagnóstico apontava isso na Visão geral e em Leads).
- **Testes:** `tela.test.ts` novos na Visão geral, na Base de clientes e nas telas de canal, e casos novos no de
  Tráfego com IA, desenham a tela no servidor e conferem os destinos dos links e a ordem dos blocos.

## Pendências de desenho (melhorias, não bloqueiam)

O portão da fase 2 fechou em 03/11/2026 com o protótipo como está: estas pendências viram melhorias de tela, sem
bloquear a fase 3. As de número ("Este mês", "Parar tudo", quem aprova) viraram decisões de produto da fase 3.

- **Visão geral em 375px:** os oito indicadores ficam um por linha e empurram as tabelas por marca e por canal para
  depois de cerca de duas telas de rolagem. Proposta: dividir os indicadores em "Aquisição" (custo por cliente novo,
  clientes novos, leads, investimento), seguidos do custo por marca e por canal, e "Venda e alcance" (pedidos,
  valor, faturado, Instagram) depois; ou dois indicadores por linha no celular.
- **"Este mês" contra o mês anterior inteiro** (resolvida): no começo do mês, as contagens apareciam em queda forte e
  em vermelho, uma urgência falsa (lei 18). A [decisão 0026](../decisoes/0026-comparacao-de-este-mes.md), aceita em
  03/11/2026, compara com os mesmos dias do mês anterior, e o protótipo já faz isso desde 03/11/2026 (`lib/periodo.ts`,
  com teste), com o rótulo "vs. 1º a 3 de outubro". Comparar só os dias completos de cada fonte vem com o banco, na
  fase 4.
- **Canal em 375px, visão Gestor:** Humano × Claude (T3) vem depois de 12 indicadores um por linha.
- **Tráfego com IA no Visualizador:** abrir o módulo mostra só "Esta tela é da visão Gestor de tráfego"; decidir se
  os links para ele ("Ver pendências em Tráfego com IA", em Conectores e SEO e GEO) já levam `?visao=gestor`.

## Estados que toda tela precisa mostrar

| Estado | Como forçar | O que aparece |
|---|---|---|
| Carregando | `?estado=carregando` | `Esqueleto` no lugar do conteúdo (`aria-busy`) |
| Vazio | `?estado=vazio` ou abrir sem `VITE_SAMPLE_DATA` | `.yn-empty` com o próximo passo ("Ligue um conector…") |
| Erro | `?estado=erro` | `.yn-empty[data-state=error]` "Não deu para carregar" + "Tentar de novo" + código |
| Sem dados | `?estado=sem-dados` | A tela inteira, com cada KPI em "Sem dados" e cada gráfico em "Sem dados" (nunca 0) |
| Sucesso | sem parâmetro, com dados de exemplo | Números, gráficos com "Ver como tabela", listas |

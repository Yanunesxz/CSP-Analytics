# Telas do CSP-MKT — fase 2 (protótipo no modo demonstração)

> Índice dos módulos e das tarefas principais da fase 2, com o caminho mais curto de cada uma.
> O contrato técnico que cada módulo segue está em [`00-contrato.md`](00-contrato.md).
> Portão da fase: o dono faz a T1 no protótipo, no computador e em 375px, sem ajuda.

## Como abrir o protótipo

```bash
pnpm install
VITE_SAMPLE_DATA=true pnpm dev     # modo demonstração com dados de exemplo (sem Supabase)
```

Sem `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` o app abre sem login, como o dono de exemplo, com a faixa preta
"Modo demonstração · dados de exemplo" e o botão "Recomeçar". Sem `VITE_SAMPLE_DATA=true` abre vazio.
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

Contagem a partir do sistema aberto na Visão geral, com os dados de exemplo. "Toque" = clique ou toque.

| # | Tarefa | Caminho mais curto | Toques |
|---|---|---|---|
| T1 | Saber quanto custou cada cliente novo por marca e por canal neste mês, comparado ao mês anterior | A Visão geral já abre em "Este mês" comparando com o anterior e mostra o KPI **Custo por cliente novo** e os cards por marca e por canal (0 toques para o total). Para a tabela marca × canal: tocar no KPI **Custo por cliente novo** → abre **Chegada de clientes** na seção "Custo por cliente novo" (1 toque). Para uma marca só: **Marca** no menu → Corpo Sensual ou Plumene (2 toques). | 0 a 3 |
| T2 | Ver de onde chegam os leads e em que etapa estão | Menu → **Chegada de clientes**: funil lead → prospecto → cadastro → 1º pedido → faturado e o gráfico "Leads por origem" (1 toque). Lista por origem com código e etapa: menu → **Leads** (1 toque). | 1 |
| T3 | Comparar Humano × Claude por canal | Menu → **Meta Ads** (ou TikTok, Google): bloco "Humano × Claude" com a mesma linha de métricas lado a lado e a diferença em % (1 toque). Com a Visão em **Gestor de tráfego** o bloco aparece já na Visão geral, por canal (1 toque no segmented). | 1 |
| T4 | Aprovar uma proposta do Claude | Menu → **Tráfego com IA** → fila de aprovação no topo → **Aprovar** na proposta (2 toques). A confirmação mostra o nome da ação e o custo estimado. | 2 a 3 |
| T5 | Ver quem da base antiga parou de comprar e quem voltou | Menu → **Base de clientes**: KPIs "Inativos", "Perdidos" e "Reativados"; chips rápidos **Inativos** e **Reativados** filtram a lista (2 toques). Cada linha tem o link para a ficha 360 no CSP 360. | 2 |
| T6 | Ver qual conector está atrasado e tentar de novo | Menu → **Conectores**: o cartão atrasado vem em amarelo ("Atrasado") e o caído em vermelho, com "atualizado há X min"; botão **Tentar de novo** no cartão (2 toques). | 2 |

Toda tela responde às 8 perguntas de UX da seção 7 do padrão antes de ir para aprovação, e mostra os cinco estados
(carregando, vazio, erro, sem dados, sucesso) pelo parâmetro `?estado=`.

## Estados que toda tela precisa mostrar

| Estado | Como forçar | O que aparece |
|---|---|---|
| Carregando | `?estado=carregando` | `Esqueleto` no lugar do conteúdo (`aria-busy`) |
| Vazio | `?estado=vazio` ou abrir sem `VITE_SAMPLE_DATA` | `.yn-empty` com o próximo passo ("Ligue um conector…") |
| Erro | `?estado=erro` | `.yn-empty[data-state=error]` "Não deu para carregar" + "Tentar de novo" + código |
| Sem dados | `?estado=sem-dados` | A tela inteira, com cada KPI em "Sem dados" e cada gráfico em "Sem dados" (nunca 0) |
| Sucesso | sem parâmetro, com dados de exemplo | Números, gráficos com "Ver como tabela", listas |

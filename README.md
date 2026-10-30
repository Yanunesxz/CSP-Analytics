# CSP-MKT

> Padrão: [SystemDesing v0.4.0](https://github.com/Yanunesxz/SystemDesing/tree/v0.4.0) — produto Yan Nunes (preto e branco, sem cor de cliente), menu do celular em gaveta. Desvios registrados: cores de série tiradas do Tangram ([decisão 0007](docs/decisoes/0007-cores-de-serie-do-tangram.md)) e worker em Python ([decisão 0001](docs/decisoes/0001-stack-e-monorepo.md)).

Central de marketing do grupo Corpo Sensual e Plumene: mostra numa tela só quanto custa cada cliente novo por marca e por canal, de onde chegam os leads, como vão as campanhas de Meta, TikTok e Google (separando o gestor humano do Claude), o Instagram, o SEO e o GEO, e deixa o dono aprovar o que o Claude vai executar nas contas de anúncio.

## O que faz

- **Visão geral:** leads, clientes novos, custo por cliente novo, investimento, pedidos e alcance, por marca e por canal; cada número leva à tela que o trabalha.
- **Chegada de clientes:** funil lead → prospecto → cadastro → 1º pedido enviado → faturado, por marca, origem, período e representante.
- **Base de clientes:** ativos, inativos e perdidos, recompra e reativação dos clientes que já existem.
- **Leads:** por marca e origem (anúncio, site, busca orgânica, assistentes de IA, SDR), sem dado pessoal — a ficha fica no CSP 360.
- **Meta Ads, TikTok Ads, Google Ads:** investimento e resultado por conta e campanha, separados por operador (humano × Claude).
- **Instagram:** seguidores, alcance e engajamento por perfil e por post (só leitura).
- **SEO e GEO:** busca orgânica (Search Console) e assistentes de IA (GA4 e `referrer` dos leads).
- **Tráfego com IA:** estratégia, propostas do Claude, a lista "O que podemos fazer", fila de aprovação, limites de gasto e botão de parar tudo.
- **Conectores:** estado de cada integração e "atualizado há X min".

## Sistemas e integrações

| Sistema / serviço | O que faz com ele |
|---|---|
| CSP 360 (CRM do grupo) | Lê, por réplica mínima (só ids, marca, datas, status, origem/UTM e chave de junção), clientes, pedidos, negócios, leads do SDR e histórico de marketing, com credencial só-leitura criada para o CSP-MKT. Não grava na v1. |
| Apps de Representantes (Corpo Sensual e Plumene) | Não lê direto: o que precisa já chega pelo CRM. |
| ERP Control | Nunca: o faturado e o retrato chegam pelos apps → CRM. |
| Meta Marketing API (+ Lead Ads) | Lê campanhas, gasto e leads; executa ações do Claude só depois de aprovação, com credencial de escrita separada. |
| Instagram API | Lê métricas de conta e de post. |
| TikTok Marketing API | Lê campanhas e gasto; escrita como na Meta. |
| Google Ads API | Lê campanhas e gasto; escrita como na Meta. |
| GA4 Data API | Lê sessões, canais (inclusive "AI Assistant") e conversões dos dois sites. |
| Search Console API | Lê impressões, cliques e consultas (relatório "Web"). |
| Claude API | Analisa e propõe ações de tráfego; só no worker. |
| n8n | Gatilhos externos e avisos (token vencendo, conector caído, CPL acima do limite). |

## Fluxo de dados (fixo, não revisitar)

`ERP Control → apps de Representantes → CSP 360 → CSP-MKT`. O CSP-MKT lê de cima para baixo; nunca cria pedido, nunca fala com o Control, nunca grava nos apps. Leads correm no sentido contrário (site → CRM → app → ERP) e o CSP-MKT só observa.

## Dono de cada dado

| Dado | Dono | O CSP-MKT |
|---|---|---|
| Pedido e faturamento | ERP Control (chega pelos apps e pelo CRM) | só lê |
| Cliente e lead | CSP 360 | só lê, sem dado pessoal |
| Métrica de mídia, Instagram, SEO e GEO | cada plataforma | guarda snapshot com data |
| Estratégia, ações e aprovações de tráfego | CSP-MKT | é o dono |

## Dicionário de dados

A preencher na fase 3 (tabelas, status, views de KPI e conectores). Regras que já valem: inglês e `snake_case`; dinheiro em `*_cents`; data e hora em `*_at` com fuso `America/Sao_Paulo`; status em lista fechada em inglês com rótulo em português; `brand_id` em toda tabela de fato e nunca em cliente ([decisão 0003](docs/decisoes/0003-marca-como-dimensao.md)); `external_id` + `source` em tudo que vem de fora; toda métrica derivada é view ou função SQL.

## Estrutura

Monorepo pnpm: `apps/web` (React 18 + Vite + TypeScript + Tailwind 4, na Vercel), `apps/worker` (Python no Railway: conectores, réplica do CRM, operador Claude), `packages/shared` (listas fechadas, rótulos e regras usadas pelo front e pelo banco), `supabase/` (migrações e Edge Functions). Detalhes na [decisão 0001](docs/decisoes/0001-stack-e-monorepo.md).

## Como rodar

```bash
cp .env.example .env   # preencha os valores; sem VITE_SUPABASE_URL o app abre no modo demonstração
pnpm install
pnpm dev               # apps/web em http://localhost:5173
```

`VITE_SAMPLE_DATA=true` carrega dados de exemplo (duas marcas, campanhas, leads sem nome real) no modo demonstração.

## Como testar

```bash
pnpm verify            # tipos, lint, testes e build de todos os pacotes
```

## Decisões

Decisões específicas deste sistema ficam em [`docs/decisoes/`](docs/decisoes/). O prompt de partida, com as 10 perguntas respondidas em 29–30/10/2026, está em [`docs/PROMPT-CSP-MKT.md`](docs/PROMPT-CSP-MKT.md).

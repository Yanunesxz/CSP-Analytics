# CSP-MKT

> Padrão: [SystemDesing v0.4.0](https://github.com/Yanunesxz/SystemDesing/tree/v0.4.0) — sistema de cliente do grupo ("CSP MKT" no menu, preto e branco, crédito "Criado por Yan Nunes" no rodapé; [decisão 0039](docs/decisoes/0039-sistema-de-cliente-csp-mkt.md)), menu do celular em gaveta. Desvios registrados: cores de série tiradas do Tangram ([decisão 0007](docs/decisoes/0007-cores-de-serie-do-tangram.md)) e worker em Python ([decisão 0001](docs/decisoes/0001-stack-e-monorepo.md)).

Central de marketing do grupo Corpo Sensual e Plumene: mostra numa tela só quanto custa cada cliente novo por marca e por canal, de onde chegam os leads, como vão as campanhas de Meta, TikTok e Google (separando o gestor humano do Claude), o Instagram, o SEO e o GEO, e deixa o dono aprovar o que o Claude vai executar nas contas de anúncio.

## O que faz

- **Visão geral:** leads, clientes novos, custo por cliente novo, investimento, pedidos e alcance, por marca e por canal; cada número leva à tela que o trabalha.
- **Chegada de clientes:** funil lead → prospecto → cadastro → 1º pedido enviado → faturado, por marca, origem, período e representante.
- **Base de clientes:** ativos, inativos e perdidos, recompra e reativação dos clientes que já existem.
- **Leads:** por marca e origem (anúncio, site, busca orgânica, assistentes de IA, SDR), sem dado pessoal — a ficha fica no CSP 360.
- **Meta Ads, TikTok Ads, Google Ads:** investimento e resultado por conta e campanha, separados por operador (humano × Claude).
- **Instagram:** seguidores, visualizações, alcance e interações por perfil e por post (só leitura, só orgânico).
- **SEO e GEO:** busca orgânica (Search Console) e assistentes de IA (GA4 e `referrer` dos leads).
- **Tráfego com IA:** estratégia, propostas do Claude, a lista "O que podemos fazer", fila de aprovação, limites de gasto e botão de parar tudo.
- **Conectores:** estado de cada integração e "atualizado há X min".

## Sistemas e integrações

| Sistema / serviço | O que faz com ele |
|---|---|
| CSP 360 (CRM do grupo) | Lê, por réplica mínima (só ids, marca, datas, status, origem/UTM e chave de junção), clientes, pedidos, negócios e leads do SDR, com credencial só-leitura criada para o CSP-MKT. Não grava na v1. |
| Apps de Representantes (Corpo Sensual e Plumene) | Não lê direto: o que precisa já chega pelo CRM. |
| ERP Control | Nunca: o faturado e o retrato chegam pelos apps → CRM. |
| Meta Marketing API | Lê campanhas, gasto e a contagem de leads de formulário, sem a pessoa; executa ações do Claude só depois de aprovação, com credencial de escrita separada, e regrava todo dia 1 o teto da conta com o limite aprovado. |
| Instagram API | Lê métricas de conta e de post. |
| TikTok Marketing API | Lê campanhas e gasto; escrita como na Meta. |
| Google Ads API | Lê campanhas e gasto; escrita como na Meta. |
| GA4 Data API | Lê sessões, canais (inclusive "AI Assistant") e conversões dos dois sites. |
| Search Console API | Lê impressões, cliques e consultas (relatório "Web"). |
| Claude API | Analisa e propõe ações de tráfego; só no worker. |
| n8n | Entrega os avisos que o banco enfileira, por e-mail e WhatsApp (credencial vencendo, conector caído, custo por lead acima da meta). |

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

Em [`docs/dados/`](docs/dados/README.md), aprovado na fase 3: tabelas e colunas ([`tabelas.md`](docs/dados/tabelas.md)), listas fechadas, papéis e RLS, views e funções de KPI, e o que é replicado do CSP 360 e o que não é ([`integracoes.md`](docs/dados/integracoes.md), seção 3.2). As convenções (nomes, dinheiro, datas, listas, marca) ficam só lá, na seção "Convenções" de [`docs/dados/README.md`](docs/dados/README.md).

## Estrutura

Monorepo pnpm: `apps/web` (React 18 + Vite + TypeScript + Tailwind 4, na Vercel), `apps/worker` (Python no Railway: conectores, réplica do CRM, operador Claude), `packages/shared` (listas fechadas, rótulos e regras usadas pelo front e pelo banco), `supabase/` (migrações e Edge Functions). Detalhes na [decisão 0001](docs/decisoes/0001-stack-e-monorepo.md).

## Como rodar

```bash
pnpm install
pnpm dev:exemplo       # protótipo com dados de exemplo em http://localhost:5173 (sem .env)
```

Para ligar no Supabase: `cp .env.example .env`, preencha os valores e rode `pnpm dev`. Sem `VITE_SUPABASE_URL` o app abre no modo demonstração, vazio; `VITE_SAMPLE_DATA=true` (ou `pnpm dev:exemplo`) carrega dados de exemplo inventados — duas marcas, campanhas, leads sem nome real. Para ver um estado de tela, acrescente `?estado=carregando`, `vazio`, `erro` ou `sem-dados` ao endereço.

## Como testar

```bash
pnpm verify            # tipos, lint, testes e build de todos os pacotes
```

## Decisões

Decisões específicas deste sistema ficam em [`docs/decisoes/`](docs/decisoes/). O prompt de partida, com as 10 perguntas respondidas em 29–30/10/2026, está em [`docs/PROMPT-CSP-MKT.md`](docs/PROMPT-CSP-MKT.md).

# Instruções para IA — CSP-MKT

<!--
  Este arquivo tem só as regras VIGENTES. Regra que mudou é substituída aqui, não empilhada.
  O histórico (o que foi decidido, quando, por quem e por quê) vai em docs/decisoes/, um arquivo por decisão.
  AGENTS.md é uma cópia deste arquivo para outras IAs de código; mantenha os dois iguais.
-->

Este sistema segue o padrão Yan Nunes. Leia e siga:

@PADRAO-YAN-NUNES.md

Antes de começar qualquer tarefa, leia `ESTADO.md`. Para o estado do projeto, vale o código: confira `git status` e `git log`.

Siga o processo de criação da seção 0 do padrão: veja em `ESTADO.md` a fase atual e não pule o portão dela (nada de código antes de o problema, as telas e os dados estarem aprovados).

## Sobre este sistema

- **O que faz:** central de marketing do grupo Corpo Sensual e Plumene. Mostra numa tela só quanto custa cada cliente novo por marca e por canal, de onde chegam os leads, como vão as campanhas de Meta, TikTok e Google (separando o gestor humano do Claude), o Instagram, o SEO e o GEO, e deixa o dono aprovar o que o Claude vai executar nas contas de anúncio.
- **Número de sucesso (hoje → meta):** custo por cliente novo, por marca e por canal: desconhecido → conhecido toda semana para as duas marcas a partir do primeiro mês (meta de valor fixada depois de 4 semanas medidas). Relatório semanal de marketing: não existe → 5 minutos numa tela.
- **Fica fora da primeira versão:** publicar, agendar, comentários e mensagens do Instagram; envio de públicos para Meta e Google; disparos de WhatsApp e e-mail; automações do CRM; histórico do ERP anterior a agosto de 2026; gravar no CRM; leitura direta dos Supabase dos apps; login do gestor de tráfego (a estrutura nasce pronta; o cadastro fica para quando ele entrar); click ids na atribuição; abas embaixo no celular; execução do Claude sem aprovação.
- **Produto Yan Nunes ou cliente:** produto Yan Nunes.
- **Se for de cliente, cor principal:** não se aplica (preto no claro, branco no escuro; sem `tema-cliente.css`, sem crédito no rodapé). `.yn-sidebar__product` = "YAN NUNES · MKT".
- **Domínio:** outro — marketing e mídia. O mais próximo em `docs/dominios/` do SystemDesing é `crm.md` (`marketing_events`, `marketing_opt_in`); o domínio marketing deste sistema é proposto na fase 3.
- **Menu no celular:** gaveta (o dono usa computador; o celular responde pelo espaço).
- **Perfil do diagnóstico:** página pública não · vende online não · rastreamento não (o sistema lê rastreadores dos sites, não rastreia) · dado pessoal sim (mínimo; ver regras). `perfil: { publico: false, vende: false, rastreamento: false, dadosPessoais: true }` — valem as regras 6, 7, 8, 9, 10, 11, 15, 16 e 17 de `docs/07`.
- **Sistemas com que conversa:** CSP 360 (CRM do grupo, só leitura por réplica mínima); Meta Marketing API e Lead Ads; Instagram API; TikTok Marketing API; Google Ads API; GA4 Data API; Search Console API; Claude API (só no worker); n8n (gatilhos e avisos). Nunca os apps de Representantes direto, nunca o ERP Control.
- **Dono de cada dado:** pedido e faturamento → ERP Control (chegam pelos apps e pelo CRM); cliente e lead → CSP 360; métrica de mídia, Instagram, SEO e GEO → cada plataforma (aqui só snapshot com data); estratégia, ações e aprovações de tráfego → CSP-MKT.
- **Papéis e o que cada um vê:** `owner` vê e faz tudo; `traffic_manager` vê números e opera o Tráfego com IA, sem lead com dado pessoal. Na v1 só existe o `owner`, mas papéis, convite e RLS por papel existem desde o primeiro PR. O toggle Visualizador ↔ Gestor de tráfego muda o que a tela mostra, nunca o que a pessoa pode fazer.
- **Como rodar:** `pnpm install` e `pnpm dev:exemplo` (protótipo com dados de exemplo, sem `.env`). Sem `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` o app abre no modo demonstração (sem login, vazio, faixa "Modo demonstração"); `VITE_SAMPLE_DATA=true` ou `--mode exemplo` carrega dados de exemplo pelo `store`. `?estado=carregando|vazio|erro|sem-dados` força o estado da tela.
- **Como testar:** `pnpm verify` (tipos, lint, testes e build de todos os pacotes). Toda regra pura (fórmula de KPI, classificação de origem, status) tem teste.

## Regras vigentes deste sistema

Cada regra aponta para a decisão em `docs/decisoes/`.

- **Fluxo de dados fixo:** `ERP Control → apps de Representantes → CSP 360 → CSP-MKT`. O CSP-MKT só lê, nunca cria pedido, nunca fala com o Control, nunca grava nos apps. ([0004](docs/decisoes/0004-fluxo-de-dados-e-dono-de-cada-dado.md))
- **Uma empresa, duas marcas:** `brand_id uuid not null` em toda tabela de fato; nunca em cliente ou dimensão compartilhada; não existe `company_id` nem `marca_id`. "As duas" é ausência de filtro, contando cada cliente uma vez. ([0003](docs/decisoes/0003-marca-como-dimensao.md))
- **A v1 só lê.** A única escrita fora do CSP-MKT é a execução de ação de tráfego pelo Claude, sempre depois de aprovação na central e só quando houver credencial de escrita aprovada. Nada automático; teto de gasto por conta e botão de parar tudo. ([0005](docs/decisoes/0005-v1-so-le-e-claude-executa-apos-aprovacao.md))
- **Dados em projeto Supabase próprio** com réplica mínima do CRM (só id, marca, datas, situação, origem/UTM, representante e chave de junção; nunca nome, telefone ou e-mail), credencial só-leitura criada no CRM para este sistema, migrações só em `supabase/migrations/` aplicadas por CI, RLS em toda tabela por `profiles.role`. ([0006](docs/decisoes/0006-supabase-proprio-com-replica-minima.md))
- **Dado pessoal mínimo:** a lista de leads mostra código, origem, marca, data e o link para a ficha 360 no CSP 360; o contexto enviado ao Claude nunca leva nome, documento ou telefone; logs sem dado pessoal. ([0006](docs/decisoes/0006-supabase-proprio-com-replica-minima.md))
- **Cores de série:** tokens `--color-series-1..6` tirados dos tokens de dataviz do Tangram, só para canal (e origem do lead, inclusive o assistente de IA), marca e operador em gráfico, chip e legenda; nunca em botão, status ou texto. É desvio da seção 3 do padrão. ([0007](docs/decisoes/0007-cores-de-serie-do-tangram.md))
- **Gráficos:** cores só de tokens, "Ver como tabela" em todo gráfico, estados "Sem dados" e erro também para gráfico; `.yn-bars`/`.yn-columns` onde bastam; SVG próprio ou biblioteca leve com cor dos tokens, decidido na fase 2. ([0002](docs/decisoes/0002-graficos.md))
- **Humano × Claude por campanha:** `campaigns.managed_by` (`human | claude`) com histórico de troca; tudo que o Claude cria nasce `claude`; campanha importada sem dono nasce `human`. ([0008](docs/decisoes/0008-humano-x-claude-por-campanha.md))
- **Atribuição por UTM + `clientes.id`:** por canal e `utm_campaign`, com a UTM que o CRM já grava no prospecto; click ids ficam para decisão futura. ([0009](docs/decisoes/0009-atribuicao-por-utm-e-cliente.md))
- **O CSP-MKT é o dono de marketing:** campanhas, gasto, criativos, atribuição e ações de tráfego vivem só aqui; o CRM mantém `historico_marketing`, SDR e a entrada de leads dos sites. ([0010](docs/decisoes/0010-fronteira-com-o-crm.md))
- **Papéis desde o primeiro PR:** `profiles.role` em lista fechada (`owner`, `traffic_manager`); toda política confere o papel, nunca só "está logado". ([0011](docs/decisoes/0011-papeis-desde-o-primeiro-pr.md))
- **Lead e cliente novo:** cliente novo de uma marca = primeiro `pedidos` dessa marca com `status = 'enviado'` no CRM, deduplicado por `clientes.id`; tudo antes disso é lead. Faturado é etapa posterior, com valor "Sem dados" até o Control abrir o canal. ([0012](docs/decisoes/0012-lead-e-cliente-novo.md))
- **Stack:** monorepo pnpm (`apps/web`, `apps/worker` em Python, `packages/shared`, `supabase/`). Python no worker é exceção registrada à decisão 0004 do padrão. Nenhuma fórmula de KPI vive no worker nem no React: toda métrica derivada é view ou função SQL; o React só lê views, filtradas no banco, e nunca soma linhas. n8n só para gatilhos externos e avisos; Edge Functions só onde o banco precisa reagir sem servidor; nenhuma regra roda em dois lugares. ([0001](docs/decisoes/0001-stack-e-monorepo.md))
- **Latência:** leads a cada 5 min pela réplica; mídia e Instagram de hora em hora; SEO, GEO e GA4 uma vez por dia; "atualizado há X min" em toda tela. ([0006](docs/decisoes/0006-supabase-proprio-com-replica-minima.md))
- **Credenciais:** leitura e escrita separadas por plataforma; só no Railway ou em `connector_credentials` cifrada sem leitura para `anon`/`authenticated`; nunca `VITE_`, nunca em log; nomes no `.env.example`. ([0005](docs/decisoes/0005-v1-so-le-e-claude-executa-apos-aprovacao.md))
- **Ingestão:** um adaptador por provedor convertendo para evento único; webhook responde 200 e processa depois; idempotência por `source + external_id`; CSV exportado da plataforma aceito como `source = 'csv'` enquanto uma aprovação de API atrasa. ([0001](docs/decisoes/0001-stack-e-monorepo.md))
- **Controles globais:** marca no `.yn-context` do menu lateral refletida em `?marca=`; tema pelo mecanismo do padrão (nunca na URL); visão Visualizador · Gestor de tráfego em `.yn-segmented` na barra do topo com `?visao=`. Filtros são componente de toda tela de números, nunca rota.
- **Contagens e nomes que envelhecem** (seguidores, representantes, pedidos) não entram em documento; fatos de segurança de outros sistemas ficam fora de README, ESTADO e decisões.

## Ao terminar uma tarefa

1. Build e testes sem erro (`pnpm verify`).
2. Telas conferidas em 1280px e 375px, claro e escuro.
3. `ESTADO.md` atualizado no mesmo PR.

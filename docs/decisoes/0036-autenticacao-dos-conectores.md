# 0036 — Autenticação de cada conector e nomes das credenciais

- **Data:** 2026-11-03
- **Status:** aceita em 2026-11-03 (técnica; detalha a 0005 e a 0017)

## Contexto

Os nomes do `.env.example` foram escritos antes do levantamento das APIs. Desde 09/09/2026 o Google Ads não usa mais
developer token; desde 21/04/2026, gerar refresh token de uma pessoa exige verificação em duas etapas. A réplica do CRM
precisa conferir colunas antes de ler e paginar por chave. O Instagram pode ser lido pelo login do Facebook ou pelo do
Instagram.

## Decisão

- **CSP 360:** papel Postgres `csp_mkt_reader`, criado pelo time do CRM, só de leitura: só views num esquema próprio,
  com só as colunas pedidas; o papel não executa função. Conexão por `CSP360_DATABASE_URL`.
- **Meta e Instagram:** um app; dois usuários do sistema (leitura e escrita), com token que não vence; o Instagram pelo
  login do Facebook. Plano B do Instagram: o token do login do Instagram, guardado no Vault e renovado pelo worker.
- **TikTok:** dois apps (leitura e escrita), cada um com o seu token de longo prazo.
- **Google Ads:** duas contas de serviço com acesso direto à conta ("Somente leitura" e "Padrão"); sem developer token
  e sem refresh token.
- **GA4 e Search Console:** uma conta de serviço só de leitura.
- **Claude:** chave e modelo só no worker.
- **Nomes:** a lista está em `docs/dados/integracoes.md`, seção 18. O `.env.example` muda na fase 4, no PR do worker.

## Alternativas consideradas

- **OAuth de uma pessoa no Google Ads:** pede verificação em duas etapas, e o acesso cai quando a pessoa sai.
- **Um token para ler e escrever:** contra a decisão 0005.
- **Chave da API REST do CRM:** não confere colunas antes de ler e não pagina por chave.
- **Login do Instagram como caminho principal:** token de 60 dias para renovar, e sem as métricas que só o login do
  Facebook traz.

## Consequências

- Pedir ao time do CRM o papel e as permissões (lista em `integracoes.md`, seção 3).
- Pedir cedo à Meta a aprovação da escrita. Na Meta, o usuário de leitura vem agora; o de escrita, depois do Full (no
  nível Limited o app tem um usuário do sistema só). Ligar a leitura cedo ajuda: as chamadas contam para o Full.
- Os tokens de escrita ficam só no executor (decisão 0017).
- Saem do `.env.example` o developer token e o OAuth do Google Ads, a chave e o endereço da API do CRM, os ids de
  propriedade (viram `web_properties`) e as credenciais únicas do TikTok; entram os nomes por finalidade (leitura e
  escrita).

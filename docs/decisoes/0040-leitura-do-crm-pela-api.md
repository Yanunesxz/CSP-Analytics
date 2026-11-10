# 0040 — Leitura do CRM pela API de dados, sem login no banco

- **Data:** 2026-11-10
- **Status:** proposta em 2026-11-10 (aguarda o dono; muda o caminho de acesso das decisões 0006, 0017 e 0036)

## Contexto

As decisões 0006, 0017 e 0036 previam um papel Postgres só de leitura no CRM, `csp_mkt_reader`, com login e senha, e o
worker ligado ao banco de lá por `CSP360_DATABASE_URL`. Em 10/11/2026 o acesso foi escrito no repositório do CRM (o
papel, o esquema `csp_mkt` e as 12 views) e revisado antes de ser ligado. A revisão mostrou três coisas:

- Um login no banco do CRM alcança mais do que as views. Alcança o que todo papel com login alcança naquele projeto, e
  isso o CRM não consegue tirar de um papel só.
- Os limites do papel (tempo por consulta e transação só de leitura) são padrões da sessão: quem tem a senha desliga
  os dois.
- A senha moraria no Railway do CSP-MKT. Se vazasse, o estrago possível no CRM seria maior do que ler as views.

Nada disso aconteceu: o papel nasce sem login e ainda não foi ligado. A decisão 0036 tinha descartado a API do CRM por
dois motivos: não conferir colunas antes de ler e não paginar por chave. Os dois têm saída, descrita abaixo.

## Decisão

- O worker lê as **mesmas 12 views** do esquema `csp_mkt` pela **API de dados do CRM** (HTTPS), e não por conexão ao
  banco. O papel `csp_mkt_reader` fica **sem login**.
- A credencial é um **token** emitido no CRM para esse papel. Pela API, quem tem o token só faz o que o papel pode: ler
  as 12 views. Não abre sessão no banco, não troca configuração e não alcança mais nada.
- **Colunas conferidas antes de ler:** o worker pede cada view com a lista exata de colunas do quadro 3.2 de
  `docs/dados/integracoes.md`. Se faltar view ou coluna, a API recusa a chamada e a rodada termina com `SCHEMA_DRIFT`,
  como na decisão 0015.
- **Paginação por chave:** páginas de até 1.000 linhas, em ordem de chave (o carimbo e o id, ou só o id), pedindo
  sempre o que vem depois da última chave lida. Nunca por número de página.
- **Variáveis** (substituem `CSP360_DATABASE_URL`): `CSP360_API_URL` (o endereço da API do CRM), `CSP360_API_KEY` (a
  chave pública da API de lá, que não é segredo) e `CSP360_API_TOKEN` (o token do papel; segredo, só no Railway do
  worker).
- **Troca do token a cada 90 dias**, no CRM, pelo dono. A troca derruba o token anterior na hora. O token nunca passa
  por chat, Git ou log.
- O resto das decisões 0006, 0015, 0017 e 0036 continua: réplica mínima, só views, sem dado pessoal, leitura a cada
  5 min com passada completa diária, e o CSP-MKT nunca grava no CRM.

## Alternativas consideradas

- **Login no banco, como estava:** é o que a revisão reprovou. A credencial de marketing passaria a valer mais do que
  os dados de marketing.
- **Login no banco, tirando do CRM o que o login alcança:** muda a operação do CRM por causa do CSP-MKT, volta a abrir
  se alguém religar, e os limites do papel continuam sendo só padrões da sessão.
- **O CRM empurrar os dados para o CSP-MKT:** o CRM passaria a conhecer o CSP-MKT e a gravar fora dele, contra a
  decisão 0004.
- **Chave de serviço ou chave pública da API do CRM, sem token do papel:** a primeira lê o CRM inteiro; a segunda não
  lê as views. Nenhuma serve.

## Consequências

- `docs/dados/integracoes.md` (seções 3.1, 3.3, 3.4, 3.6, 18 e 19) descreve a leitura pela API.
- No CRM: o esquema `csp_mkt` entra na API só para o papel de leitura (para os outros papéis continua fechado) e um
  script de lá emite o token, que o dono cola direto no Railway. É um PR no repositório do CRM, depois desta decisão.
- O `.env.example` muda na fase 4, no PR do worker, como a decisão 0036 já previa.
- O token tem validade conhecida: o cartão do CSP 360 avisa antes de vencer (a forma fica para o PR do worker).
- A confirmar na primeira leitura: se a API do CRM aceita o token do papel, a página de 1.000 linhas e o tempo de cada
  página.
- Enquanto esta decisão não for aceita, o papel fica sem login e fora da API: nada sai do CRM.

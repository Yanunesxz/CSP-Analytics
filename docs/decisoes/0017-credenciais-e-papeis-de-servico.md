# 0017 — Credenciais e papéis de serviço

- **Data:** 2026-11-03
- **Status:** proposta (técnica, aguarda a aprovação do modelo; detalha a 0005 e amplia na 0001 o uso de Edge Function: também onde o Auth exige a chave de serviço, convidar e tirar acesso)

## Contexto

A decisão 0005 deixa as credenciais no Railway ou numa tabela `connector_credentials` cifrada, sem leitura para
`anon` e `authenticated`, com leitura e escrita separadas. Algumas credenciais renovam sozinhas (o token do Instagram
vence em 60 dias; refresh token pode ser trocado pela plataforma) e o worker precisa guardar a nova. A chave
`service_role` do Supabase passa por cima de toda a RLS.

## Decisão

- Segredo que não muda (token de usuário do sistema, conta de serviço, segredo de app, chave da Claude API, chave
  só-leitura do CRM) fica nas variáveis do Railway, com leitura e escrita em nomes separados.
- Segredo que renova fica no Supabase Vault (cifrado), apontado por `private.connector_credentials` (finalidade,
  estado, validade). Nenhum `grant` para `anon` ou `authenticated`, nem para o dono. O worker lê e troca só por
  `private.read_credential` e `private.rotate_credential`. O primeiro segredo entra por `setup.register_credential`,
  pelo script de configuração, como parâmetro ligado. A tela vê só o estado.
- A credencial de escrita fica só nas variáveis do executor e tem em `private.connector_credentials` uma linha só de
  estado, sem segredo, criada por `setup.register_credential` quando a plataforma aprova a escrita: é por ela que o
  banco sabe se pode executar.
- O worker de leitura entra no banco com o papel Postgres próprio `mkt_worker` (lê as tabelas da lista dele, nunca as
  de pessoas; grava por `ingest`), nunca com a `service_role`, e só tem credenciais de leitura.
- **O executor é um serviço e um papel à parte** (`mkt_executor`): só ele tem os tokens de escrita das plataformas,
  só ele executa as funções de execução, e os tokens de escrita ficam só nas variáveis dele: o executor não lê o
  Vault, e o banco guarda da credencial de escrita só a linha de estado. Um erro
  na ingestão ou um vazamento do worker de leitura não entrega a escrita.
- O n8n entra com `n8n_notifier`, que só executa três funções da fila de avisos. Os scripts de configuração entram com
  `mkt_setup`, que só executa as funções `setup.*`. A `service_role` fica só nas Edge Functions que o Auth exige
  (convidar e tirar acesso) e no job manual do primeiro dono.
- As senhas dos papéis de serviço entram pelo CI, de segredos do GitHub, e nunca aparecem em arquivo ou log.

## Alternativas consideradas

- **Tudo em variável de ambiente:** o worker não teria onde guardar o token renovado.
- **Tabela cifrada com `pgcrypto` e a chave numa variável:** chave cuidada à mão; o Vault já faz isso.
- **Worker com a `service_role`:** um vazamento abriria o banco inteiro, sem RLS.

## Consequências

- Uma conexão a mais por serviço (`WORKER_DATABASE_URL` no Railway); a `SUPABASE_SERVICE_ROLE_KEY` sai do worker.
- Conferir na fase 4 se o pooler do Supabase aceita os papéis próprios; se não aceitar, conexão direta.
- O cartão do conector avisa "Vence logo" pelo estado da credencial.
- Segundo a documentação do Supabase, a chave do Vault é gerida por ele, fora do banco; backup e dump levam só o texto
  cifrado. Decifra quem tem o papel `postgres`: o painel (só o dono) e o CI de produção (só migração, com aprovação do
  dono). O CI reprova migração que cite `vault.decrypted_secrets`, `vault.secrets`, `net.http_`, as funções da extensão `http` (`http_get`, `http_post`, `http(`…; a coluna `http_status` não conta) ou `dblink`
  fora de `private.read_credential` e `private.rotate_credential`, e as extensões `pg_net`, `http` e `dblink` ficam
  desligadas.
- O worker chama `private.rotate_credential` só com parâmetro ligado no servidor (psycopg 3), nunca com o valor no
  texto do SQL, e a função não repete o segredo em mensagem de erro.
- Dois serviços no Railway em vez de um: `WORKER_DATABASE_URL` e `EXECUTOR_DATABASE_URL`, e os nomes `*_WRITE` só no
  executor (`docs/dados/integracoes.md`, seção 18).

-- Dados inventados da camada 2 do teste de RLS, só no projeto de TESTE (docs/dados/plano.md, "Seed").
--
-- O que faz: cria o convite vencido do RLS-32, uma conta de anúncio (por setup.register_ad_account, o caminho dos
--   scripts de configuração) e uma campanha inventadas (marca cs, Meta), uma rodada da passada completa do CRM em
--   andamento (RLS-30) e as duas credenciais de teste: a de leitura aponta para um segredo inventado no Vault (o
--   controle do RLS-30); a de escrita é só a linha de estado, sem segredo, como a tabela exige
--   (setup.register_credential), e private.read_credential tem de recusar pela finalidade (RLS-30 e RLS-34). O convite
--   do primeiro dono de teste vem antes, no passo do CI que chama setup.create_first_owner_invitation com o papel
--   mkt_setup.
-- Quem roda: o CI, como postgres, depois das migrações. Nada aqui é dado real: e-mail em .invalid, ids inventados.
--   supabase/tests/camada-2.test.ts roda este arquivo no PGlite a cada pnpm verify.
-- Como desfazer: o passo de limpeza do CI apaga os sete esquemas; o segredo de teste do Vault tem nome fixo
--   (csp_mkt_rls_teste) e é reaproveitado entre rodadas.
-- Uso: psql "$SUPABASE_DB_URL_TESTE" -X -q -At -v ON_ERROR_STOP=1 -v etiqueta="$RLS_ETIQUETA" -f scripts/testar-rls-dados.sql
-- Saída: uma linha JSON com os ids (RLS_DADOS de scripts/testar-rls.mjs e as variáveis de testar-rls-servicos.sql).

\set ON_ERROR_STOP on
\o /dev/null

begin;

-- Convite vencido (RLS-32), no formato do convite do primeiro dono: o teste entra com ele antes de o dono existir,
-- e só a validade pode barrar o perfil.
insert into mkt.invitations (email_normalized, display_name, role, invited_by, expires_at, created_at)
values (format('rls-vencido-%s@teste.invalid', :'etiqueta'), 'Convite vencido', 'owner', null,
        now() - interval '1 day', now() - interval '8 days');

-- Conta inventada, pelo mesmo caminho da configuração de verdade.
select setup.register_ad_account('cs', 'meta', 'act_rls_teste', 'Conta inventada do teste de RLS') as ad_account_id \gset

-- Campanha inventada. Nasce do humano, ativa (na produção vem do worker); o teste passa para o Claude pela API.
insert into mkt.campaigns (ad_account_id, brand_id, platform, source, external_id, name, status, daily_budget_cents)
select a.id, a.brand_id, a.platform, a.source, 'rls_teste_campanha', 'rls-teste-campanha', 'active', 5000
  from mkt.ad_accounts a
 where a.id = :'ad_account_id'
returning id as campaign_id,
          to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as campaign_updated_at \gset

-- Passada completa do CRM em andamento: ingest.delete_missing só corta por uma rodada assim (RLS-30).
insert into mkt.sync_runs (connector_id, job, run_trigger, status, started_at)
select c.id, 'crm_full_pass', 'schedule', 'running', now() - interval '1 minute'
  from mkt.connectors c
 where c.code = 'csp360'
returning id as rodada_id \gset

-- Segredo inventado no Vault, com nome fixo: reaproveitado entre rodadas, nada acumula. Por isso a credencial de
-- leitura entra direto, e não por setup.register_credential, que guardaria um segredo novo a cada rodada.
select coalesce((select s.id from vault.secrets s where s.name = 'csp_mkt_rls_teste'),
                vault.create_secret('segredo inventado do teste de RLS', 'csp_mkt_rls_teste',
                                    'Só para o teste de RLS do projeto de teste; sem valor real')) as segredo_id \gset

-- Credencial de leitura com o segredo: o controle do RLS-30 (o worker lê esta).
insert into private.connector_credentials (connector_id, purpose, account_ref, vault_secret_id)
select c.id, 'read', 'rls-teste', :'segredo_id'
  from mkt.connectors c
 where c.code = 'instagram'
returning id as cred_leitura \gset

-- Credencial de escrita: só a linha de estado, sem segredo (o de escrita fica nas variáveis do executor).
select setup.register_credential('meta', 'write', 'rls-teste', null, null) as cred_escrita \gset

commit;

\o
select json_build_object(
  'ad_account_id', :'ad_account_id',
  'campaign_id', :'campaign_id',
  'campaign_updated_at', :'campaign_updated_at',
  'rodada_id', :'rodada_id',
  'cred_leitura', :'cred_leitura',
  'cred_escrita', :'cred_escrita');

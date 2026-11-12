-- Dados inventados de conectores para os testes da migração 08: pelo menos uma linha em cada tabela dela. Depende de
-- fixtures/usuarios.sql (o dono). Os ids são os de tests/apoio/trafego.ts; nada é dado real, nem segredo: a
-- credencial de leitura guarda só um apontador inventado, e o arquivo CSV, números de exemplo.
--
--   Meta ligada, com a rodada de hora em hora ...401 que deu certo, a rodada do arquivo CSV ...403 (o arquivo ...411)
--     e a linha de estado da credencial de escrita ...422, sem segredo
--   Instagram a ligar, com a credencial de leitura ...421 apontando para o Vault
--   GA4 a ligar, com o "Tentar de novo" ...402 na fila
--   o aviso ...431 do relatório da semana para o dono, por e-mail, na fila
--
-- Só no PGlite: o "supabase test db" roda todo .sql desta pasta.
begin;
do $$
begin
  if version() not like '%PGlite%' then
    raise exception 'fixtures/conectores.sql é só para o PGlite (testes)';
  end if;
end $$;

-- A Meta ligada pelo worker na primeira rodada boa; os trabalhos dela com a última rodada boa de cada um.
update mkt.connectors
   set setup_state = 'connected', first_success_at = now() - interval '20 days', last_success_at = now() - interval '10 minutes'
 where code = 'meta';
update mkt.connector_jobs j
   set last_success_at = now() - case j.job when 'ads_hourly' then interval '10 minutes' else interval '9 hours' end
  from mkt.connectors c
 where c.id = j.connector_id and c.code = 'meta';

insert into mkt.sync_runs (id, connector_id, job, run_trigger, status, started_at, finished_at, rows_written,
                           watermark_from_at, watermark_to_at)
select '00000000-0000-4000-8000-000000000401', c.id, 'ads_hourly', 'schedule', 'succeeded',
       now() - interval '12 minutes', now() - interval '10 minutes', 48, now() - interval '1 hour 12 minutes',
       now() - interval '12 minutes'
  from mkt.connectors c where c.code = 'meta';

insert into mkt.sync_runs (id, connector_id, job, run_trigger, status, requested_by, requested_at)
select '00000000-0000-4000-8000-000000000402', c.id, 'ga4_daily', 'manual_retry', 'requested',
       '00000000-0000-4000-8000-0000000000d1', now() - interval '1 minute'
  from mkt.connectors c where c.code = 'ga4';

insert into mkt.sync_runs (id, connector_id, job, run_trigger, status, brand_id, requested_by, requested_at)
select '00000000-0000-4000-8000-000000000403', c.id, 'csv_import', 'csv_upload', 'requested', b.id,
       '00000000-0000-4000-8000-0000000000d1', now() - interval '2 minutes'
  from mkt.connectors c cross join mkt.brands b where c.code = 'meta' and b.code = 'cs';

insert into mkt.csv_imports (id, connector_id, brand_id, file_name, size_bytes, content, uploaded_by, sync_run_id)
select '00000000-0000-4000-8000-000000000411', c.id, b.id, 'relatorio-campanhas-teste.csv', 92,
       e'campaign_id,campaign_name,day,spend\n120200000000000001,cs-prospeccao-lojistas,2026-11-02,48.70\n',
       '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000000403'
  from mkt.connectors c cross join mkt.brands b where c.code = 'meta' and b.code = 'cs';

-- Credenciais: a de leitura do Instagram aponta para um segredo do Vault (o id é inventado: nenhum segredo aqui); a de
-- escrita da Meta é só a linha de estado.
insert into private.connector_credentials (id, connector_id, purpose, account_ref, vault_secret_id, status,
                                           expires_at, last_rotated_at)
select '00000000-0000-4000-8000-000000000421', c.id, 'read', '17840000000000001',
       '00000000-0000-4000-8000-0000000004a1', 'valid', now() + interval '50 days', now() - interval '10 days'
  from mkt.connectors c where c.code = 'instagram';
insert into private.connector_credentials (id, connector_id, purpose, status)
select '00000000-0000-4000-8000-000000000422', c.id, 'write', 'valid'
  from mkt.connectors c where c.code = 'meta';

insert into mkt.notification_outbox (id, profile_id, notice, channel, dedupe_key, payload, send_after_at)
values ('00000000-0000-4000-8000-000000000431', '00000000-0000-4000-8000-0000000000d1', 'weekly_report', 'email',
        'teste:weekly_report:2026-10-26:email',
        '{"title": "Relatório da semana", "link": "/visao-geral", "from_on": "2026-10-26", "to_on": "2026-11-01",
          "spend_cents": 310000, "leads": 84, "new_customers": 11}',
        now() + interval '1 hour');
commit;

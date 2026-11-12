-- Casos de RLS na conexão de cada serviço, no projeto de TESTE (camada 2; docs/dados/papeis-e-rls.md, "Casos").
--
-- O que faz: com a conexão do próprio papel (a senha que o CI acabou de definir), tenta o que o papel não pode e
--   confere que o banco nega pelo privilégio (42501), não por acaso. postgres: RLS-24 (catálogo). mkt_worker: RLS-18,
--   22 e 30. mkt_executor: RLS-34. n8n_notifier: RLS-18, 23 e 28. O que depende da assinatura de cada ingest.* com
--   argumentos válidos fica na camada 1 (PGlite). supabase/tests/camada-2.test.ts roda este arquivo no PGlite, com cada
--   papel, a cada pnpm verify.
-- Nada grava: tudo roda numa transação desfeita no fim.
-- Saída: um NOTICE por caso, "RLS-22 mkt_worker passou" ou "… falhou"; com -v motivo=1, a etapa e o SQLSTATE (nunca
--   dado). Se um caso falhou, o psql sai com erro no fim.
-- Uso: psql "<url do papel>" -X -q -v ON_ERROR_STOP=1 -v papel=mkt_worker -v cred_leitura=<uuid> \
--        -v cred_escrita=<uuid> -v rodada_id=<uuid> -f scripts/testar-rls-servicos.sql

\set ON_ERROR_STOP on
\o /dev/null
\if :{?papel}
\else
  \set papel ''
\endif
\if :{?cred_leitura}
\else
  \set cred_leitura ''
\endif
\if :{?cred_escrita}
\else
  \set cred_escrita ''
\endif
\if :{?rodada_id}
\else
  \set rodada_id ''
\endif
\if :{?motivo}
\else
  \set motivo ''
\endif

select :'papel' = 'postgres' as e_catalogo, :'papel' = 'mkt_worker' as e_worker,
       :'papel' = 'mkt_executor' as e_executor, :'papel' = 'n8n_notifier' as e_n8n,
       session_user = :'papel' and :'papel' in ('postgres', 'mkt_worker', 'mkt_executor', 'n8n_notifier') as conexao_certa
\gset
\if :conexao_certa
\else
  do $$ begin raise exception 'Esta conexão não é do papel pedido (-v papel=…).'; end $$;
\endif

select set_config('rls.papel', :'papel', false), set_config('rls.motivo', :'motivo', false),
       set_config('rls.cred_leitura', :'cred_leitura', false), set_config('rls.cred_escrita', :'cred_escrita', false),
       set_config('rls.rodada', :'rodada_id', false), set_config('rls.relatorio', '', false);

begin;

\if :e_catalogo
-- RLS-24: toda view de api e de mkt roda com os direitos de quem chama; as de api também com security_barrier.
do $$
declare
  v_falhas text[] := '{}';
  v_view text;
begin
  if to_regclass('api.v_traffic_actions') is null or to_regclass('api.v_traffic_log') is null then
    v_falhas := v_falhas || 'faltam api.v_traffic_actions ou api.v_traffic_log'::text;
  end if;
  for v_view in
    select format('%I.%I', n.nspname, c.relname)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('api', 'mkt') and c.relkind = 'v'
       and not exists (select 1 from unnest(coalesce(c.reloptions, '{}')) o
                        where lower(o) in ('security_invoker=true', 'security_invoker=on', 'security_invoker=1'))
  loop
    v_falhas := v_falhas || ('sem security_invoker: ' || v_view);
  end loop;
  for v_view in
    select format('%I.%I', n.nspname, c.relname)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'api' and c.relkind = 'v'
       and not exists (select 1 from unnest(coalesce(c.reloptions, '{}')) o
                        where lower(o) in ('security_barrier=true', 'security_barrier=on', 'security_barrier=1'))
  loop
    v_falhas := v_falhas || ('sem security_barrier: ' || v_view);
  end loop;
  perform set_config('rls.relatorio',
    current_setting('rls.relatorio') || E'\n' || 'RLS-24|' || array_to_string(v_falhas, '; '), true);
end $$;
\endif

\if :e_worker
-- RLS-18 (parte do worker): o segredo sai só por private.read_credential, nunca pelo Vault direto.
-- RLS-22: o worker não chama api, não altera ação nem operador.
-- RLS-30: tabelas de pessoas, aprovação por update com o token do dono, delete_missing fora da lista, a função do
-- executor e a credencial de escrita.
do $$
declare
  v_falhas text[] := '{}';
  v_sql text;
begin
  foreach v_sql in array array[
    'select 1 from vault.decrypted_secrets limit 1'
  ] loop
    begin
      execute v_sql;
      v_falhas := v_falhas || ('executou: ' || v_sql);
    exception
      when insufficient_privilege then null;
      when others then v_falhas := v_falhas || (sqlstate || ' em: ' || v_sql);
    end;
  end loop;
  perform set_config('rls.relatorio',
    current_setting('rls.relatorio') || E'\n' || 'RLS-18|' || array_to_string(v_falhas, '; '), true);
end $$;

do $$
declare
  v_falhas text[] := '{}';
  v_sql text;
begin
  foreach v_sql in array array[
    'select api.approve_action(''00000000-0000-0000-0000-000000000000''::uuid, now())',
    'update mkt.traffic_actions set status = status where false',
    'update mkt.campaigns set managed_by = managed_by where false',
    'insert into mkt.traffic_actions (id) values (gen_random_uuid())'
  ] loop
    begin
      execute v_sql;
      v_falhas := v_falhas || ('executou: ' || v_sql);
    exception
      when insufficient_privilege then null;
      when others then v_falhas := v_falhas || (sqlstate || ' em: ' || v_sql);
    end;
  end loop;
  perform set_config('rls.relatorio',
    current_setting('rls.relatorio') || E'\n' || 'RLS-22|' || array_to_string(v_falhas, '; '), true);
end $$;

do $$
declare
  v_falhas text[] := '{}';
  v_sql text;
  v_rodada uuid;
  v_ok boolean;
begin
  -- Com o token de um dono (o banco nem chega a conferir: falta o privilégio).
  perform set_config('request.jwt.claims',
    '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated", "aal": "aal2"}', true);
  foreach v_sql in array array[
    'select 1 from mkt.profiles limit 1',
    'select 1 from mkt.invitations limit 1',
    'select 1 from mkt.notification_preferences limit 1',
    'select 1 from mkt.saved_filters limit 1',
    'select 1 from mkt.audit_log limit 1',
    'update mkt.traffic_actions set status = ''approved'' where status = ''idea''',
    'update mkt.traffic_actions set status = ''discarded'' where status = ''idea''',
    'select ingest.next_execution()',
    'select ingest.set_action_progress(null::uuid, null::mkt.action_status)',
    'select ingest.update_execution(null::uuid, null::mkt.execution_status)'
  ] loop
    begin
      execute v_sql;
      v_falhas := v_falhas || ('executou: ' || v_sql);
    exception
      when insufficient_privilege then null;
      when others then v_falhas := v_falhas || (sqlstate || ' em: ' || v_sql);
    end;
  end loop;
  perform set_config('request.jwt.claims', '', true);

  -- delete_missing fora da lista da réplica: recusado pela função (o controle, na lista, passa com a mesma rodada).
  begin
    v_rodada := current_setting('rls.rodada')::uuid;
    begin
      perform ingest.delete_missing('crm_funnels', v_rodada);
    exception when others then
      v_falhas := v_falhas || (sqlstate || ' no controle: delete_missing(crm_funnels)');
    end;
    begin
      perform ingest.delete_missing('profiles', v_rodada);
      v_falhas := v_falhas || 'delete_missing(profiles) executou'::text;
    exception when others then
      if sqlstate <> 'PT422' then
        v_falhas := v_falhas || (sqlstate || ' em delete_missing(profiles): não foi a lista que recusou');
      end if;
    end;
  exception when invalid_text_representation then
    v_falhas := v_falhas || 'sem a rodada (-v rodada_id)'::text;
  end;

  -- Credencial: a de leitura sai (controle); a de escrita (só a linha de estado, sem segredo) é recusada pela
  -- finalidade (PT403 da função), não por falta de privilégio.
  begin
    begin
      execute 'select private.read_credential($1) = ''segredo inventado do teste de RLS'''
        into v_ok using current_setting('rls.cred_leitura')::uuid;
      if v_ok is not true then
        v_falhas := v_falhas || 'controle: read_credential(leitura) não devolveu o segredo de teste'::text;
      end if;
    exception when others then
      v_falhas := v_falhas || (sqlstate || ' no controle: read_credential(leitura)');
    end;
    begin
      execute 'select private.read_credential($1)' using current_setting('rls.cred_escrita')::uuid;
      v_falhas := v_falhas || 'read_credential(escrita) devolveu'::text;
    exception when others then
      if sqlstate <> 'PT403' then
        v_falhas := v_falhas || (sqlstate || ' em read_credential(escrita): não foi a finalidade que recusou');
      end if;
    end;
  exception when invalid_text_representation then
    v_falhas := v_falhas || 'sem as credenciais (-v cred_leitura e cred_escrita)'::text;
  end;

  perform set_config('rls.relatorio',
    current_setting('rls.relatorio') || E'\n' || 'RLS-30|' || array_to_string(v_falhas, '; '), true);
end $$;
\endif

\if :e_executor
-- RLS-34: o executor não grava o que é do worker, não chama api, não lê segredo nem lead.
do $$
declare
  v_falhas text[] := '{}';
  v_sql text;
  v_quantas integer := 0;
begin
  for v_sql in
    select format('select %I.%I(%s)', n.nspname, p.proname,
                  coalesce((select string_agg(format('null::%s', format_type(a.t, null)), ', ' order by a.o)
                              from unnest(p.proargtypes::oid[]) with ordinality as a(t, o)), ''))
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where p.prokind = 'f'
       and ((n.nspname = 'ingest' and (p.proname like 'upsert\_%' or p.proname = 'add_claude_proposal'))
            or n.nspname = 'api')
  loop
    v_quantas := v_quantas + 1;
    begin
      execute v_sql;
      v_falhas := v_falhas || ('executou: ' || v_sql);
    exception
      when insufficient_privilege then null;
      when others then v_falhas := v_falhas || (sqlstate || ' em: ' || v_sql);
    end;
  end loop;
  if v_quantas = 0 then
    v_falhas := v_falhas || 'nenhuma ingest.upsert_*, add_claude_proposal nem api.* no catálogo'::text;
  end if;
  foreach v_sql in array array[
    'select private.read_credential(nullif(current_setting(''rls.cred_leitura''), '''')::uuid)',
    'select private.read_credential(nullif(current_setting(''rls.cred_escrita''), '''')::uuid)',
    'select 1 from mkt.crm_leads limit 1',
    'select 1 from vault.decrypted_secrets limit 1'
  ] loop
    begin
      execute v_sql;
      v_falhas := v_falhas || ('executou: ' || v_sql);
    exception
      when insufficient_privilege then null;
      when others then v_falhas := v_falhas || (sqlstate || ' em: ' || v_sql);
    end;
  end loop;
  perform set_config('rls.relatorio',
    current_setting('rls.relatorio') || E'\n' || 'RLS-34|' || array_to_string(v_falhas, '; '), true);
end $$;
\endif

\if :e_n8n
-- RLS-18 e RLS-28 (parte do n8n): nada de segredo nem das funções de private.
do $$
declare
  v_falhas text[] := '{}';
  v_sql text;
begin
  foreach v_sql in array array[
    'select 1 from vault.decrypted_secrets limit 1'
  ] loop
    begin
      execute v_sql;
      v_falhas := v_falhas || ('executou: ' || v_sql);
    exception
      when insufficient_privilege then null;
      when others then v_falhas := v_falhas || (sqlstate || ' em: ' || v_sql);
    end;
  end loop;
  perform set_config('rls.relatorio',
    current_setting('rls.relatorio') || E'\n' || 'RLS-18|' || array_to_string(v_falhas, '; '), true);
end $$;

-- RLS-23: o n8n não lê tabela nem view de mkt (só as três funções de notify).
do $$
declare
  v_falhas text[] := '{}';
  v_sql text;
  v_quantas integer := 0;
begin
  for v_sql in
    select format('select 1 from %I.%I limit 1', n.nspname, c.relname)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'mkt' and c.relkind in ('r', 'p', 'v', 'm', 'f')
  loop
    v_quantas := v_quantas + 1;
    begin
      execute v_sql;
      v_falhas := v_falhas || ('executou: ' || v_sql);
    exception
      when insufficient_privilege then null;
      when others then v_falhas := v_falhas || (sqlstate || ' em: ' || v_sql);
    end;
  end loop;
  if v_quantas < 45 then
    v_falhas := v_falhas || ('só ' || v_quantas || ' tabelas e views em mkt no catálogo');
  end if;
  perform set_config('rls.relatorio',
    current_setting('rls.relatorio') || E'\n' || 'RLS-23|' || array_to_string(v_falhas, '; '), true);
end $$;

do $$
declare
  v_falhas text[] := '{}';
  v_sql text;
begin
  foreach v_sql in array array[
    'select private.read_credential(null::uuid)',
    'select private.rotate_credential(null::uuid, null::text, null::timestamptz)',
    'select private.queue_execution(null::uuid)',
    'select 1 from vault.decrypted_secrets limit 1'
  ] loop
    begin
      execute v_sql;
      v_falhas := v_falhas || ('executou: ' || v_sql);
    exception
      when insufficient_privilege then null;
      when others then v_falhas := v_falhas || (sqlstate || ' em: ' || v_sql);
    end;
  end loop;
  perform set_config('rls.relatorio',
    current_setting('rls.relatorio') || E'\n' || 'RLS-28|' || array_to_string(v_falhas, '; '), true);
end $$;
\endif

-- Relatório: um NOTICE por caso; se algum falhou, o psql sai com erro (e a transação é desfeita).
do $$
declare
  v_linha text;
  v_caso text;
  v_falhas text;
  v_falharam text := '';
begin
  foreach v_linha in array string_to_array(current_setting('rls.relatorio'), E'\n') loop
    continue when v_linha = '';
    v_caso := split_part(v_linha, '|', 1);
    v_falhas := substr(v_linha, length(v_caso) + 2);
    if v_falhas = '' then
      raise notice '% % passou', v_caso, current_setting('rls.papel');
    else
      v_falharam := v_falharam || ' ' || v_caso;
      if current_setting('rls.motivo') <> '' then
        raise notice '% % falhou · %', v_caso, current_setting('rls.papel'), v_falhas;
      else
        raise notice '% % falhou', v_caso, current_setting('rls.papel');
      end if;
    end if;
  end loop;
  if v_falharam <> '' then
    raise exception 'Casos de serviço que falharam:%', v_falharam;
  end if;
end $$;
rollback;

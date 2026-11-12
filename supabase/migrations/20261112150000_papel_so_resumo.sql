-- Migração 11a · o papel só do resumo (decisão 0043), depois das 01 a 11, que já estão em produção
--
-- O que faz: põe na lista de papéis (mkt.role) o summary_viewer, quem só vê o Resumo simples, e na lista de ações
--   (mkt.app_action) o view_summary, "Ver o Resumo simples"; e grava em role_permissions o view_summary dos três
--   papéis e o edit_settings do summary_viewer (o próprio tema, a marca padrão e os próprios filtros). Nenhuma política
--   nova: o summary_viewer não tem view_numbers, view_leads, view_traffic nem view_connectors, então a RLS de hoje não
--   lhe mostra tabela de número, lead, tráfego, conector ou pessoa. Na fase 4, a função api.* do Resumo simples confere
--   view_summary.
-- Risco: baixo. Troca o check de dois domains por um com um código a mais (os de antes continuam valendo) e insere
--   linhas em role_permissions. Não mexe em dado de pessoa. As migrações 01 a 11 não mudam (já estão em produção).
-- Como reverter (só no projeto de teste, antes de produção, e depois de reverter as migrações seguintes; sem perfil
--   nem convite com o papel novo):
--   delete from mkt.role_permissions where role = 'summary_viewer' or action = 'view_summary';
--   alter domain mkt.app_action drop constraint app_action_check;
--   alter domain mkt.app_action add constraint app_action_check check (value in ('view_numbers', 'view_leads',
--     'view_lead_personal_data', 'view_traffic', 'operate_traffic', 'approve_action', 'stop_all', 'configure_traffic',
--     'view_connectors', 'retry_connector', 'manage_users', 'view_diagnostics', 'edit_settings'));
--   alter domain mkt.role drop constraint role_check;
--   alter domain mkt.role add constraint role_check check (value in ('owner', 'traffic_manager'));
-- Conferir (os três papéis e o que cada um pode):
--   select role, string_agg(action, ', ' order by action) from mkt.role_permissions group by role order by role;

-- Os códigos novos vão no fim de cada lista: api.my_permissions e api.list_role_permissions ordenam pela ordem da
-- lista, e a dos papéis e ações de antes não muda. Rodar de novo não troca o check outra vez.
do $$
begin
  if not ('summary_viewer' = any(private.domain_codes('mkt.role'))) then
    alter domain mkt.role drop constraint role_check;
    alter domain mkt.role add constraint role_check
      check (value in ('owner', 'traffic_manager', 'summary_viewer'));
  end if;
  if not ('view_summary' = any(private.domain_codes('mkt.app_action'))) then
    alter domain mkt.app_action drop constraint app_action_check;
    alter domain mkt.app_action add constraint app_action_check
      check (value in ('view_numbers', 'view_leads', 'view_lead_personal_data', 'view_traffic', 'operate_traffic',
                       'approve_action', 'stop_all', 'configure_traffic', 'view_connectors', 'retry_connector',
                       'manage_users', 'view_diagnostics', 'edit_settings', 'view_summary'));
  end if;
end $$;

-- listas.md, "Permissões": o resumo para os três; o leitor do resumo, só ele e as próprias configurações.
insert into mkt.role_permissions (role, action) values
  ('owner', 'view_summary'),
  ('traffic_manager', 'view_summary'),
  ('summary_viewer', 'view_summary'),
  ('summary_viewer', 'edit_settings')
on conflict (role, action) do nothing;

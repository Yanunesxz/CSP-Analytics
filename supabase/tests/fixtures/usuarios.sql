-- Usuários inventados para os testes de usuários, permissões e auditoria (nenhum dado real; e-mails em example.com
-- e o domínio reservado .invalid). Os ids são os de tests/usuarios.test.ts e tests/listas.test.ts.
--
--   ...d1  Dono de teste       owner            primeiro dono (convite sem quem convidou)
--   ...d2  Segundo dono        owner            convidado pelo dono
--   ...e1  Gestor de teste     traffic_manager  convidado pelo dono
--   ...e2  Ex-gestor de teste  traffic_manager  perdeu o acesso (perfil inativo)
--   ...f1  (sem perfil)        —                login sem convite
--
-- Só no PGlite: o "supabase test db" roda todo .sql desta pasta, e num banco de verdade isto criaria logins.
begin;
do $$
begin
  if version() not like '%PGlite%' then
    raise exception 'fixtures/usuarios.sql é só para o PGlite (testes)';
  end if;
end $$;

-- O primeiro dono: o convite sem quem convidou, aceito pelo gatilho de novo usuário (como no job do primeiro dono).
insert into mkt.invitations (id, email_normalized, display_name, role, invited_by, expires_at)
values ('00000000-0000-4000-8000-0000000001d1', 'dono.teste@example.com', 'Dono de teste', 'owner', null,
        now() + interval '7 days');
insert into auth.users (id, email, invited_at)
values ('00000000-0000-4000-8000-0000000000d1', 'dono.teste@example.com', now());

-- Convidados pelo dono: um segundo dono e um gestor de tráfego.
insert into mkt.invitations (id, email_normalized, display_name, role, invited_by, expires_at) values
  ('00000000-0000-4000-8000-0000000001d2', 'segundo.dono@example.com', 'Segundo dono', 'owner',
   '00000000-0000-4000-8000-0000000000d1', now() + interval '7 days'),
  ('00000000-0000-4000-8000-0000000001e1', 'gestor.teste@example.com', 'Gestor de teste', 'traffic_manager',
   '00000000-0000-4000-8000-0000000000d1', now() + interval '7 days');
insert into auth.users (id, email, invited_at) values
  ('00000000-0000-4000-8000-0000000000d2', 'segundo.dono@example.com', now()),
  ('00000000-0000-4000-8000-0000000000e1', 'gestor.teste@example.com', now());

-- Quem perdeu o acesso: o login com o e-mail trocado (o que a Edge Function tirar-acesso faz) e o perfil inativo,
-- gravado direto (o gatilho de papel protegido só olha o update).
insert into auth.users (id, email)
values ('00000000-0000-4000-8000-0000000000e2', 'removido+00000000-0000-4000-8000-0000000000e2@invalid');
insert into mkt.profiles (id, display_name, role, is_active, invited_by, deactivated_at, deactivated_by,
                          deactivation_reason)
values ('00000000-0000-4000-8000-0000000000e2', 'Ex-gestor de teste', 'traffic_manager', false,
        '00000000-0000-4000-8000-0000000000d1', now(), '00000000-0000-4000-8000-0000000000d1', 'left_company');

-- Login convidado no Auth, mas sem convite no CSP-MKT: nenhum perfil.
insert into auth.users (id, email, invited_at)
values ('00000000-0000-4000-8000-0000000000f1', 'sem.convite@example.com', now());

-- Meus filtros e avisos do dono; e os que sobraram de quem perdeu o acesso (a RLS não os mostra nem a ele).
insert into mkt.saved_filters (profile_id, scope, name, filters) values
  ('00000000-0000-4000-8000-0000000000d1', 'bar', 'Meta do mês', '{"period": "this_month", "platform": "meta"}'),
  ('00000000-0000-4000-8000-0000000000d1', 'traffic_list', 'Ideias do Claude',
   '{"operator": "claude", "status": "idea"}'),
  ('00000000-0000-4000-8000-0000000000e2', 'bar', 'Semana', '{"period": "last_7_days"}');
insert into mkt.notification_preferences (profile_id, notice, is_email_enabled, is_whatsapp_enabled) values
  ('00000000-0000-4000-8000-0000000000d1', 'weekly_report', true, true),
  ('00000000-0000-4000-8000-0000000000e2', 'weekly_report', false, false);

-- Uma linha de auditoria: o convite do gestor.
insert into mkt.audit_log (actor_kind, actor_id, event, target_table, target_id, changes)
values ('user', '00000000-0000-4000-8000-0000000000d1', 'invite_sent', 'invitations',
        '00000000-0000-4000-8000-0000000001e1',
        '{"invitation_id": "00000000-0000-4000-8000-0000000001e1", "role": "traffic_manager"}');
commit;

-- Migração 13 · Convite de outro dono pelo CI (decisão 0044)
--
-- O que faz: cria setup.create_owner_invitation, para o job manual "convidar-dono" do CI convidar um segundo dono
--   enquanto a tela de usuários e a Edge Function "convidar" não existem. Só com um dono ativo (sem ele, o caminho é o
--   primeiro-dono); o convite sai em nome do dono ativo mais antigo, para o gatilho de novo usuário aceitar
--   (private.handle_new_user confere que quem convidou é ativo e tem manage_users). Papel owner, validade de 7 dias. O
--   mesmo convite aberto e válido de dono volta o mesmo; o vencido é revogado antes. A auditoria leva só o id e o papel.
-- Risco: baixo. Só cria uma função security definer, executável só por mkt_setup. Quem dispara é o job do CI, que pede
--   a aprovação do dono no ambiente "producao".
-- Como reverter (só no projeto de teste, antes de produção, e depois de reverter as migrações seguintes):
--   drop function setup.create_owner_invitation(text, text);
-- Conferir (só o mkt_setup executa):
--   select has_function_privilege('mkt_setup', 'setup.create_owner_invitation(text, text)', 'execute');

create or replace function setup.create_owner_invitation(p_email text, p_display_name text)
returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_email text := lower(btrim(p_email));
  v_name text := btrim(p_display_name);
  v_owner uuid;
  v_open mkt.invitations;
  v mkt.invitations;
begin
  perform pg_advisory_xact_lock(hashtext('mkt.manage_users'));
  select p.id into v_owner
    from mkt.profiles p
    join mkt.role_permissions rp on rp.role = p.role and rp.action = 'manage_users'
   where p.role = 'owner' and p.is_active
   order by p.created_at, p.id
   limit 1;
  if v_owner is null then
    raise sqlstate 'PT422' using message = 'USR-422', detail = 'no_owner';
  end if;
  if v_email is null or length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise sqlstate 'PT422' using message = 'USR-422', detail = 'email';
  end if;
  if v_name is null or length(v_name) not between 2 and 80 then
    raise sqlstate 'PT422' using message = 'USR-422', detail = 'display_name';
  end if;
  if exists (select 1 from auth.users u join mkt.profiles p on p.id = u.id where lower(btrim(u.email)) = v_email) then
    raise sqlstate 'PT422' using message = 'USR-422', detail = 'has_profile';
  end if;

  select i.* into v_open
    from mkt.invitations i
   where i.email_normalized = v_email and i.accepted_at is null and i.revoked_at is null
     for update;
  if found then
    if v_open.expires_at > now() then
      if v_open.role = 'owner' and v_open.invited_by is not null then
        return v_open.id;
      end if;
      raise sqlstate 'PT422' using message = 'USR-422', detail = 'open_invitation';
    end if;
    update mkt.invitations i set revoked_at = now() where i.id = v_open.id;
    insert into mkt.audit_log (actor_kind, event, target_table, target_id, changes)
    values ('system', 'invite_revoked', 'invitations', v_open.id, jsonb_build_object('invitation_id', v_open.id));
  end if;

  insert into mkt.invitations (email_normalized, display_name, role, invited_by, expires_at)
  values (v_email, v_name, 'owner', v_owner, now() + interval '7 days')
  returning * into v;
  insert into mkt.audit_log (actor_kind, event, target_table, target_id, changes)
  values ('system', 'invite_sent', 'invitations', v.id, jsonb_build_object('invitation_id', v.id, 'role', v.role));
  return v.id;
end $$;

revoke all on function setup.create_owner_invitation(text, text) from public, anon, authenticated;
grant execute on function setup.create_owner_invitation(text, text) to mkt_setup;

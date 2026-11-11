-- Migração 03 · usuários, convites, preferências, meus filtros e auditoria (docs/dados/plano.md, "Ordem")
--
-- O que faz: cria profiles, invitations, notification_preferences, saved_filters e audit_log, cada uma com a RLS
--   ligada e a política de leitura (docs/dados/papeis-e-rls.md, "Políticas"), e as políticas de leitura de
--   role_permissions e holidays para quem tem perfil ativo; as funções que as políticas chamam (authz.can,
--   authz.requires_second_factor, authz.is_active_user, authz.display_name); as conferências de jsonb
--   (mkt.valid_saved_filters, mkt.valid_audit_changes) e o padrão de cada aviso (mkt.notice_default); e os
--   gatilhos: perfil só com convite válido (em auth.users), papel e acesso protegidos e auditoria só por acréscimo.
-- Risco: médio. Põe um gatilho em auth.users: um erro nele barra a criação de login no Supabase Auth. Não toca em
--   dado: as tabelas nascem vazias.
-- Como reverter (só no projeto de teste, antes de produção):
--   drop trigger if exists mkt_handle_new_user on auth.users;
--   drop policy if exists role_permissions_read on mkt.role_permissions;
--   drop policy if exists holidays_read on mkt.holidays;
--   drop table mkt.audit_log, mkt.saved_filters, mkt.notification_preferences, mkt.invitations, mkt.profiles cascade;
--   drop function authz.can(mkt.app_action), authz.requires_second_factor(mkt.app_action), authz.is_active_user(),
--     authz.display_name(uuid), mkt.valid_saved_filters(mkt.saved_filter_scope, jsonb),
--     mkt.valid_audit_changes(mkt.audit_event, jsonb), mkt.notice_default(mkt.notice_kind),
--     private.handle_new_user(), private.profiles_guard(), private.append_only();
-- Conferir (quantos perfis por papel e situação; o gatilho em auth.users):
--   select role, is_active, count(*) from mkt.profiles group by 1, 2 order by 1, 2;
--   select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;

-- ---------- Regras puras: segundo fator, avisos e conferências de jsonb ----------

-- Ações que pedem o segundo fator (TOTP; decisão 0023). A lista mora só aqui: authz.can, api.my_permissions e
-- api.list_role_permissions chamam esta função. Parar tudo nunca pede: é o botão de emergência.
create or replace function authz.requires_second_factor(p_action mkt.app_action) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select p_action in ('approve_action', 'configure_traffic', 'manage_users', 'retry_connector')
$$;

-- O padrão de cada aviso (decisão 0019; a regra sai do avisos.ts do protótipo): a permissão que o aviso aponta (só
-- recebe quem tem), se é urgente e os canais ligados quando a pessoa não escolheu: e-mail em tudo, WhatsApp só no
-- urgente. O que não é urgente sai em horário comercial, junto num resumo.
create or replace function mkt.notice_default(
  p_notice mkt.notice_kind,
  out required_action mkt.app_action,
  out is_urgent boolean,
  out is_email_enabled boolean,
  out is_whatsapp_enabled boolean)
language sql immutable parallel safe set search_path = '' as $$
  select d.required_action::mkt.app_action, d.is_urgent, true, d.is_urgent
    from (values
      ('connector_down',      'view_connectors', true),
      ('spend_near_limit',    'view_traffic',    true),
      ('cost_per_lead_high',  'view_numbers',    true),
      ('proposal_to_approve', 'approve_action',  false),
      ('weekly_report',       'view_numbers',    false),
      ('credential_expiring', 'retry_connector', true),
      ('stop_not_confirmed',  'stop_all',        true),
      ('mass_delete_blocked', 'retry_connector', true)
    ) as d(notice, required_action, is_urgent)
   where d.notice = p_notice
$$;

-- "Meus filtros" guardam só as chaves de filtro daquela barra, com os nomes e os códigos do banco (metricas.md,
-- 1.1): a barra de filtros (período, comparar, canal, campanha, operador, origem, representante) ou a lista do
-- Tráfego (canal, campanha, operador, status, impacto, esforço). Nulo é "sem filtro". Chave a mais, tipo errado ou
-- código fora da lista: falso. O valor confere com o próprio domain, sem repetir a lista aqui.
create or replace function mkt.valid_saved_filters(p_scope mkt.saved_filter_scope, p_filters jsonb)
returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  v_key text;
  v_value jsonb;
  v_text text;
begin
  if p_scope is null or jsonb_typeof(p_filters) is distinct from 'object' then
    return false;
  end if;
  for v_key, v_value in select e.key, e.value from jsonb_each(p_filters) e loop
    continue when jsonb_typeof(v_value) = 'null';
    if p_scope = 'bar' and v_key = 'compare' then
      if jsonb_typeof(v_value) <> 'boolean' then
        return false;
      end if;
      continue;
    end if;
    if jsonb_typeof(v_value) <> 'string' then
      return false;
    end if;
    v_text := v_value #>> '{}';
    case
      when p_scope = 'bar' and v_key = 'period' then
        perform v_text::mkt.period_code;
      when v_key = 'platform' then
        perform v_text::mkt.platform;
      when v_key = 'operator' then
        perform v_text::mkt.operator;
      when v_key = 'campaign' then
        -- O id da campanha (daqui ou da plataforma) ou a utm_campaign: até 150 letras, sem @.
        if btrim(v_text) = '' or not mkt.valid_crm_text(v_text, true) then
          return false;
        end if;
      when p_scope = 'bar' and v_key = 'origin' then
        perform v_text::mkt.lead_origin;
      when p_scope = 'bar' and v_key = 'sales_rep' then
        if v_text !~ '^REP-[0-9]{4,}$' then
          return false;
        end if;
      when p_scope = 'traffic_list' and v_key = 'status' then
        perform v_text::mkt.action_status;
      when p_scope = 'traffic_list' and v_key in ('impact', 'effort') then
        perform v_text::mkt.level;
      else
        return false;
    end case;
  end loop;
  return true;
exception
  when check_violation then
    return false;   -- código fora da lista do domain
end $$;

-- A auditoria guarda só as chaves previstas de cada evento, nunca e-mail (tabelas.md, audit_log): no convite, o id
-- e o papel; na troca de papel, o papel antes e depois; no acesso tirado, o motivo; nos conectores e credenciais, o
-- conector e o estado. Mudança é {"before": código, "after": código}. Cada valor confere com o tipo da chave.
create or replace function mkt.valid_audit_changes(p_event mkt.audit_event, p_changes jsonb)
returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  v_key text;
  v_value jsonb;
  v_kind text;
  v_is_change boolean;
  v_item jsonb;
  v_text text;
begin
  if p_event is null or jsonb_typeof(p_changes) is distinct from 'object' then
    return false;
  end if;
  for v_key, v_value in select e.key, e.value from jsonb_each(p_changes) e loop
    v_kind := case
      when v_key = 'invitation_id' and p_event in ('first_owner_created', 'invite_sent', 'invite_revoked') then 'uuid'
      when v_key = 'role' and p_event in ('first_owner_created', 'invite_sent') then 'role'
      when v_key = 'role' and p_event = 'role_changed' then 'role'
      when v_key = 'reason' and p_event = 'access_revoked' then 'deactivation_reason'
      when v_key = 'connector' and p_event in ('connector_state_changed', 'connector_retry_requested',
                                               'mass_delete_confirmed', 'credential_status_changed') then 'connector'
      when v_key = 'sync_run_id' and p_event in ('connector_retry_requested', 'mass_delete_confirmed') then 'uuid'
      when v_key = 'setup_state' and p_event = 'connector_state_changed' then 'setup_state'
      when v_key = 'purpose' and p_event = 'credential_status_changed' then 'credential_purpose'
      when v_key = 'status' and p_event = 'credential_status_changed' then 'credential_status'
    end;
    if v_kind is null then
      return false;   -- chave fora do quadro do evento
    end if;

    v_is_change := (p_event = 'role_changed' and v_key = 'role') or v_key in ('setup_state', 'status');
    if v_is_change then
      if jsonb_typeof(v_value) <> 'object' or not v_value ?& array['before', 'after']
         or (select count(*) from jsonb_object_keys(v_value)) <> 2 then
        return false;
      end if;
    end if;

    for v_item in
      select x.item
        from jsonb_array_elements(case when v_is_change
                                       then jsonb_build_array(v_value -> 'before', v_value -> 'after')
                                       else jsonb_build_array(v_value) end) as x(item)
    loop
      if jsonb_typeof(v_item) <> 'string' then
        return false;
      end if;
      v_text := v_item #>> '{}';
      case v_kind
        when 'uuid' then perform v_text::uuid;
        when 'role' then perform v_text::mkt.role;
        when 'deactivation_reason' then perform v_text::mkt.deactivation_reason;
        when 'connector' then perform v_text::mkt.connector_code;
        when 'setup_state' then perform v_text::mkt.connector_setup_state;
        when 'credential_purpose' then perform v_text::mkt.credential_purpose;
        when 'credential_status' then perform v_text::mkt.credential_status;
      end case;
    end loop;
  end loop;
  return true;
exception
  when check_violation or invalid_text_representation then
    return false;   -- código fora da lista ou id que não é uuid
end $$;

-- ---------- Tabelas ----------

-- Usuários. O id é o do login (auth.users); o e-mail fica só no auth. O perfil nasce pelo gatilho de novo usuário,
-- com o nome e o papel do convite.
create table if not exists mkt.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) between 2 and 80),
  role mkt.role not null,
  is_active boolean not null default true,
  theme_preference mkt.theme_preference not null default 'device',
  default_brand mkt.brand_code,
  default_view mkt.view_mode not null default 'viewer',
  whatsapp_digits text check (whatsapp_digits ~ '^55[0-9]{10,11}$'),
  invited_by uuid references mkt.profiles(id),
  deactivated_at timestamptz,
  deactivated_by uuid references mkt.profiles(id),
  deactivation_reason mkt.deactivation_reason,
  deactivation_note text check (deactivation_note is null
                                or (length(deactivation_note) between 10 and 500
                                    and not mkt.has_personal_data(deactivation_note))),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  check (is_active = (deactivated_at is null)),
  check (is_active or deactivation_reason is not null),
  check (deactivation_reason is distinct from 'other' or deactivation_note is not null)
);
alter table mkt.profiles enable row level security;

-- Convites. O link é o do Supabase Auth (uso único, com validade; o token não passa por aqui). Um convite aberto por
-- e-mail; aceito e revogado não andam juntos, e o aceite diz qual perfil nasceu.
create table if not exists mkt.invitations (
  id uuid primary key default gen_random_uuid(),
  email_normalized text not null
    check (email_normalized = lower(btrim(email_normalized)) and email_normalized ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  display_name text not null check (length(btrim(display_name)) between 2 and 80),
  role mkt.role not null,
  invited_by uuid references mkt.profiles(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_profile_id uuid references mkt.profiles(id),
  revoked_at timestamptz,
  revoked_by uuid references mkt.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  check ((accepted_at is null) = (accepted_profile_id is null)),
  check (accepted_at is null or revoked_at is null)
);
alter table mkt.invitations enable row level security;
create unique index if not exists invitations_one_open
  on mkt.invitations (email_normalized) where accepted_at is null and revoked_at is null;

-- Avisos de cada pessoa. Sem linha, vale mkt.notice_default.
create table if not exists mkt.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references mkt.profiles(id) on delete cascade,
  notice mkt.notice_kind not null,
  is_email_enabled boolean not null,
  is_whatsapp_enabled boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (profile_id, notice)
);
alter table mkt.notification_preferences enable row level security;

-- "Meus filtros", por pessoa; salvar de novo com o mesmo nome substitui.
create table if not exists mkt.saved_filters (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references mkt.profiles(id) on delete cascade,
  scope mkt.saved_filter_scope not null,
  name text not null check (length(btrim(name)) between 1 and 40),
  filters jsonb not null check (mkt.valid_saved_filters(scope, filters)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  unique (profile_id, scope, name)
);
alter table mkt.saved_filters enable row level security;

-- Auditoria do que não é tráfego. Só acréscimo (gatilho abaixo); guarda 2 anos (limpeza no pg_cron, migração 13).
create table if not exists mkt.audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_kind mkt.actor_kind not null,
  actor_id uuid references mkt.profiles(id),
  event mkt.audit_event not null,
  target_table text not null check (target_table ~ '^[a-z_]{3,63}$'),
  target_id uuid,
  changes jsonb not null default '{}' check (mkt.valid_audit_changes(event, changes)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now()),
  check ((actor_kind = 'user') = (actor_id is not null))
);
alter table mkt.audit_log enable row level security;
create index if not exists audit_log_time on mkt.audit_log (occurred_at desc);

-- ---------- Funções que as políticas chamam (esquema authz) ----------

-- Permissão do usuário logado: perfil ativo + papel com a ação em role_permissions. O papel vem do perfil, nunca do
-- token: trocar ou tirar o papel vale na próxima chamada. O que gasta dinheiro ou mexe em acesso pede o segundo fator.
create or replace function authz.can(p_action mkt.app_action) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from mkt.profiles p
      join mkt.role_permissions rp on rp.role = p.role and rp.action = p_action
     where p.id = auth.uid() and p.is_active
       and (not authz.requires_second_factor(p_action)
            or coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
  )
$$;

create or replace function authz.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from mkt.profiles p where p.id = auth.uid() and p.is_active)
$$;

-- Só o nome de quem fez um passo do tráfego ("Aprovada por {nome}"), e só para quem tem view_traffic: o gestor de
-- tráfego não lê o perfil dos outros, mas o diário e a fila mostram o nome. O perfil inativo continua com o nome,
-- pelo prazo da trilha.
create or replace function authz.display_name(p_profile_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select p.display_name
    from mkt.profiles p
   where p.id = p_profile_id and authz.can('view_traffic')
$$;

-- ---------- Gatilhos ----------

create or replace trigger profiles_updated_at before update on mkt.profiles
  for each row execute function private.set_updated_at();
create or replace trigger invitations_updated_at before update on mkt.invitations
  for each row execute function private.set_updated_at();
create or replace trigger notification_preferences_updated_at before update on mkt.notification_preferences
  for each row execute function private.set_updated_at();
create or replace trigger saved_filters_updated_at before update on mkt.saved_filters
  for each row execute function private.set_updated_at();
create or replace trigger audit_log_updated_at before update on mkt.audit_log
  for each row execute function private.set_updated_at();

-- Perfil só para quem foi convidado (tabelas.md, profiles): quando o login do Supabase Auth tem invited_at, procura o
-- convite aberto e válido do e-mail, de quem ainda gere usuários com perfil ativo. Sem quem convidou, só o convite de
-- dono e só enquanto não há dono ativo (o primeiro dono). O nome e o papel vêm só do convite, nunca dos metadados do
-- login. Sem convite válido nada é criado, e a pessoa não lê nada. Login que já tem perfil não ganha outro.
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_invitation mkt.invitations;
begin
  if new.invited_at is null or new.email is null
     or exists (select 1 from mkt.profiles p where p.id = new.id) then
    return new;
  end if;

  select i.* into v_invitation
    from mkt.invitations i
   where i.email_normalized = lower(btrim(new.email))
     and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
     and (exists (select 1
                    from mkt.profiles p
                    join mkt.role_permissions rp on rp.role = p.role and rp.action = 'manage_users'
                   where p.id = i.invited_by and p.is_active)
          or (i.invited_by is null and i.role = 'owner'
              and not exists (select 1 from mkt.profiles p where p.role = 'owner' and p.is_active)))
   for update of i;
  if not found then
    return new;
  end if;

  insert into mkt.profiles (id, display_name, role, invited_by)
  values (new.id, v_invitation.display_name, v_invitation.role, v_invitation.invited_by);

  update mkt.invitations
     set accepted_at = now(), accepted_profile_id = new.id
   where id = v_invitation.id;
  return new;
end $$;

-- Também no update de invited_at: o Auth cria o login e grava invited_at logo depois, num update da mesma
-- transação (convite e generate_link). Sem isso, o convite de verdade nunca criaria o perfil.
create or replace trigger mkt_handle_new_user after insert or update of invited_at on auth.users
  for each row execute function private.handle_new_user();

-- Papel e acesso só mudam por api.change_role e api.revoke_access (migração 09): com a chave da transação
-- (set_config('mkt.allow_role_change', 'on', true)), pela API (session_user authenticator, que uma sessão direta
-- não troca) e com manage_users. Ninguém muda o próprio; o último dono ativo não perde o papel nem o acesso; acesso
-- tirado não volta (para devolver, convide de novo: nasce um login e um perfil novos).
create or replace function private.profiles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_other_owners integer;
begin
  if (new.role, new.is_active, new.deactivated_at, new.deactivated_by, new.deactivation_reason,
      new.deactivation_note)
     is not distinct from
     (old.role, old.is_active, old.deactivated_at, old.deactivated_by, old.deactivation_reason,
      old.deactivation_note) then
    return new;
  end if;

  if coalesce(current_setting('mkt.allow_role_change', true), '') <> 'on'
     or session_user::text <> 'authenticator'
     or not authz.can('manage_users') then
    raise sqlstate 'PT403' using message = 'USR-403';
  end if;
  if new.id = auth.uid() or (new.is_active and not old.is_active) then
    raise sqlstate 'PT422' using message = 'USR-422';
  end if;

  if old.role = 'owner' and old.is_active and (new.role <> 'owner' or not new.is_active) then
    -- Trava os donos ativos antes de contar: duas trocas ao mesmo tempo não tiram os dois últimos.
    perform 1 from mkt.profiles p where p.role = 'owner' and p.is_active for update;
    select count(*) into v_other_owners
      from mkt.profiles p
     where p.role = 'owner' and p.is_active and p.id <> new.id;
    if v_other_owners = 0 then
      raise sqlstate 'PT422' using message = 'USR-422';
    end if;
  end if;
  return new;
end $$;

create or replace trigger profiles_guard before update on mkt.profiles
  for each row execute function private.profiles_guard();

-- Trilha só por acréscimo (audit_log aqui; traffic_log e campaign_managed_by_history usam o mesmo gatilho): ninguém
-- altera nem apaga, nem o dono do banco. A exceção é a limpeza do prazo de guarda (pg_cron, migração 13): apagar
-- passa só na linha vencida, pela coluna e pelo prazo que o gatilho recebe ('occurred_at', '2 years').
create or replace function private.append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and tg_nargs = 2
     and (to_jsonb(old) ->> tg_argv[0])::timestamptz < now() - tg_argv[1]::interval then
    return old;
  end if;
  raise sqlstate 'PT403' using message = 'LOG-403';
end $$;

create or replace trigger audit_log_append_only before update or delete on mkt.audit_log
  for each row execute function private.append_only('occurred_at', '2 years');
create or replace trigger audit_log_no_truncate before truncate on mkt.audit_log
  for each statement execute function private.append_only();

-- ---------- Políticas (papeis-e-rls.md) ----------
-- Só leitura para authenticated: nenhuma tabela tem insert, update ou delete para ele, nem política nem grant. Os
-- papéis de serviço não leem pessoas: nenhuma destas tabelas tem _worker_read nem _executor_read.

-- Perfis: o próprio, ou todos para quem gere usuários.
drop policy if exists profiles_read on mkt.profiles;
create policy profiles_read on mkt.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select authz.can('manage_users')));

-- Convites e auditoria: só quem gere usuários.
drop policy if exists invitations_read on mkt.invitations;
create policy invitations_read on mkt.invitations
  for select to authenticated using ((select authz.can('manage_users')));

drop policy if exists audit_log_read on mkt.audit_log;
create policy audit_log_read on mkt.audit_log
  for select to authenticated using ((select authz.can('manage_users')));

-- Preferências e meus filtros: só os próprios, e só com perfil ativo.
drop policy if exists notification_preferences_read on mkt.notification_preferences;
create policy notification_preferences_read on mkt.notification_preferences
  for select to authenticated
  using (profile_id = (select auth.uid()) and (select authz.is_active_user()));

drop policy if exists saved_filters_read on mkt.saved_filters;
create policy saved_filters_read on mkt.saved_filters
  for select to authenticated
  using (profile_id = (select auth.uid()) and (select authz.is_active_user()));

-- Listas de apoio da migração 02: qualquer perfil ativo.
drop policy if exists role_permissions_read on mkt.role_permissions;
create policy role_permissions_read on mkt.role_permissions
  for select to authenticated using ((select authz.is_active_user()));

drop policy if exists holidays_read on mkt.holidays;
create policy holidays_read on mkt.holidays
  for select to authenticated using ((select authz.is_active_user()));

-- ---------- Quem executa ----------
-- As de authz, só a API (as políticas rodam com os direitos de quem lê). As de private, ninguém: são gatilhos. As
-- de mkt ficam com o padrão da migração 01 (tela, worker e executor): são regras puras, sem leitura de tabela.
revoke all on function authz.can(mkt.app_action), authz.requires_second_factor(mkt.app_action),
  authz.is_active_user(), authz.display_name(uuid) from public;
grant execute on function authz.can(mkt.app_action), authz.requires_second_factor(mkt.app_action),
  authz.is_active_user(), authz.display_name(uuid) to authenticated;
revoke all on function private.handle_new_user(), private.profiles_guard(), private.append_only()
  from public, anon, authenticated;

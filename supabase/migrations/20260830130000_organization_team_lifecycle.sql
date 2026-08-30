create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email_normalized text not null check (
    email_normalized=lower(btrim(email_normalized))
    and char_length(email_normalized) between 3 and 254
    and email_normalized ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  role public.organization_role not null check (role <> 'owner'),
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  delivery_status text not null default 'queued' check (delivery_status in ('queued','sent','not_required','failed')),
  provider_user_id uuid references auth.users(id) on delete set null,
  invited_by uuid not null references auth.users(id) on delete restrict,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_by uuid references auth.users(id) on delete set null,
  request_id uuid not null,
  failure_code text check (failure_code is null or char_length(failure_code)<=120),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,invited_by,request_id),
  check (expires_at>created_at),
  check ((status='accepted')=(accepted_at is not null)),
  check ((status='revoked')=(revoked_at is not null))
);

create unique index organization_invitations_pending_email_idx
  on public.organization_invitations(organization_id,email_normalized)
  where status='pending';
create index organization_invitations_org_created_idx
  on public.organization_invitations(organization_id,created_at desc);

create table public.organization_security_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('organization_member','organization_invitation')),
  entity_id uuid not null,
  action text not null check (action in ('invited','invitation_delivery_changed','invitation_accepted','invitation_revoked','role_changed','member_removed')),
  actor_user_id uuid references auth.users(id) on delete set null,
  subject_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object' and octet_length(details::text)<=4096),
  created_at timestamptz not null default now()
);

create index organization_security_events_org_time_idx
  on public.organization_security_events(organization_id,created_at desc);

alter table public.organization_invitations enable row level security;
alter table public.organization_security_events enable row level security;

revoke all on public.organization_invitations,public.organization_security_events from public,anon,authenticated;
grant select on public.organization_security_events to authenticated;

create policy organization_security_events_manager_select on public.organization_security_events
  for select to authenticated using (private.has_org_role(organization_id,array['owner','admin']::public.organization_role[]));

create or replace function private.team_actor_role(target_organization uuid, actor_user uuid)
returns public.organization_role
language sql stable security definer set search_path=''
as $$
  select role from public.organization_members
  where organization_id=target_organization and user_id=actor_user
$$;

revoke all on function private.team_actor_role(uuid,uuid) from public,anon,authenticated;

create or replace function public.list_organization_team(target_organization uuid)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  actor_user uuid := auth.uid();
  actor_role public.organization_role;
  result jsonb;
begin
  if actor_user is null then raise exception 'authentication_required'; end if;
  actor_role := private.team_actor_role(target_organization,actor_user);
  if actor_role is null or actor_role not in ('owner','admin') then raise exception 'insufficient_role'; end if;

  update public.organization_invitations
  set status='expired',updated_at=now()
  where organization_id=target_organization and status='pending' and expires_at<=now();

  select jsonb_build_object(
    'members',coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id',member.user_id,
        'display_name',left(coalesce(nullif(user_row.raw_user_meta_data->>'full_name',''),nullif(user_row.raw_user_meta_data->>'name',''),split_part(user_row.email,'@',1),'Miembro'),80),
        'email',user_row.email,
        'role',member.role,
        'joined_at',member.created_at,
        'last_sign_in_at',user_row.last_sign_in_at
      ) order by case member.role when 'owner' then 1 when 'admin' then 2 when 'agronomist' then 3 when 'operator' then 4 else 5 end, member.created_at)
      from public.organization_members member
      join auth.users user_row on user_row.id=member.user_id
      where member.organization_id=target_organization
    ),'[]'::jsonb),
    'invitations',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',invitation.id,
        'email',invitation.email_normalized,
        'role',invitation.role,
        'status',invitation.status,
        'delivery_status',invitation.delivery_status,
        'expires_at',invitation.expires_at,
        'created_at',invitation.created_at,
        'failure_code',invitation.failure_code
      ) order by invitation.created_at desc)
      from (select * from public.organization_invitations where organization_id=target_organization order by created_at desc limit 100) invitation
    ),'[]'::jsonb)
  ) into result;
  return result;
end
$$;

create or replace function public.accept_organization_invitation(target_invitation uuid)
returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  actor_user uuid := auth.uid();
  actor_email text;
  invitation public.organization_invitations%rowtype;
begin
  if actor_user is null then raise exception 'authentication_required'; end if;
  select lower(email) into actor_email from auth.users where id=actor_user;
  if actor_email is null then raise exception 'verified_email_required'; end if;

  select * into invitation from public.organization_invitations where id=target_invitation for update;
  if not found then raise exception 'invitation_not_found'; end if;
  if invitation.status<>'pending' then raise exception 'invitation_not_pending'; end if;
  if invitation.expires_at<=now() then
    update public.organization_invitations set status='expired',updated_at=now() where id=target_invitation;
    raise exception 'invitation_expired';
  end if;
  if invitation.email_normalized<>actor_email then raise exception 'invitation_email_mismatch'; end if;

  insert into public.organization_members(organization_id,user_id,role)
  values(invitation.organization_id,actor_user,invitation.role)
  on conflict(organization_id,user_id) do nothing;

  update public.organization_invitations
  set status='accepted',accepted_by=actor_user,accepted_at=now(),provider_user_id=coalesce(provider_user_id,actor_user),updated_at=now()
  where id=target_invitation;

  insert into public.organization_security_events(organization_id,entity_type,entity_id,action,actor_user_id,subject_user_id,details)
  values(invitation.organization_id,'organization_invitation',invitation.id,'invitation_accepted',actor_user,actor_user,jsonb_build_object('role',invitation.role));
  return invitation.organization_id;
end
$$;

create or replace function public.change_organization_member_role(
  target_organization uuid,
  target_user uuid,
  new_member_role public.organization_role,
  request_id uuid
)
returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  actor_user uuid := auth.uid();
  actor_role public.organization_role;
  previous_role public.organization_role;
begin
  if actor_user is null then raise exception 'authentication_required'; end if;
  actor_role:=private.team_actor_role(target_organization,actor_user);
  select role into previous_role from public.organization_members where organization_id=target_organization and user_id=target_user for update;
  if previous_role is null then raise exception 'member_not_found'; end if;
  if target_user=actor_user or previous_role='owner' or new_member_role='owner' then raise exception 'owner_protection'; end if;
  if actor_role='admin' and (previous_role='admin' or new_member_role='admin') then raise exception 'owner_role_required'; end if;
  if actor_role is null or actor_role not in ('owner','admin') then raise exception 'insufficient_role'; end if;
  if previous_role=new_member_role then return target_user; end if;

  update public.organization_members set role=new_member_role where organization_id=target_organization and user_id=target_user;
  insert into public.organization_security_events(organization_id,entity_type,entity_id,action,actor_user_id,subject_user_id,details)
  values(target_organization,'organization_member',target_user,'role_changed',actor_user,target_user,jsonb_build_object('previous_role',previous_role,'new_role',new_member_role,'request_id',request_id));
  return target_user;
end
$$;

create or replace function public.remove_organization_member(
  target_organization uuid,
  target_user uuid,
  request_id uuid
)
returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  actor_user uuid := auth.uid();
  actor_role public.organization_role;
  removed_role public.organization_role;
begin
  if actor_user is null then raise exception 'authentication_required'; end if;
  actor_role:=private.team_actor_role(target_organization,actor_user);
  select role into removed_role from public.organization_members where organization_id=target_organization and user_id=target_user for update;
  if removed_role is null then raise exception 'member_not_found'; end if;
  if target_user=actor_user or removed_role='owner' then raise exception 'owner_protection'; end if;
  if actor_role='admin' and removed_role='admin' then raise exception 'owner_role_required'; end if;
  if actor_role is null or actor_role not in ('owner','admin') then raise exception 'insufficient_role'; end if;
  if exists(select 1 from public.scouting_visits where organization_id=target_organization and assigned_to=target_user and status in ('planned','in_progress')) then
    raise exception 'member_has_open_scouting_visits';
  end if;

  delete from public.organization_members where organization_id=target_organization and user_id=target_user;
  insert into public.organization_security_events(organization_id,entity_type,entity_id,action,actor_user_id,subject_user_id,details)
  values(target_organization,'organization_member',target_user,'member_removed',actor_user,target_user,jsonb_build_object('role',removed_role,'request_id',request_id));
  return target_user;
end
$$;

create or replace function public.revoke_organization_invitation(target_invitation uuid, request_id uuid)
returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  actor_user uuid:=auth.uid();
  actor_role public.organization_role;
  invitation public.organization_invitations%rowtype;
begin
  if actor_user is null then raise exception 'authentication_required'; end if;
  select * into invitation from public.organization_invitations where id=target_invitation for update;
  if not found then raise exception 'invitation_not_found'; end if;
  actor_role:=private.team_actor_role(invitation.organization_id,actor_user);
  if actor_role is null or actor_role not in ('owner','admin') then raise exception 'insufficient_role'; end if;
  if actor_role='admin' and invitation.role='admin' then raise exception 'owner_role_required'; end if;
  if invitation.status<>'pending' then raise exception 'invitation_not_pending'; end if;

  update public.organization_invitations set status='revoked',revoked_by=actor_user,revoked_at=now(),updated_at=now() where id=target_invitation;
  insert into public.organization_security_events(organization_id,entity_type,entity_id,action,actor_user_id,details)
  values(invitation.organization_id,'organization_invitation',invitation.id,'invitation_revoked',actor_user,jsonb_build_object('email',invitation.email_normalized,'request_id',request_id));
  return target_invitation;
end
$$;

create or replace function public.prepare_organization_invitation_server(
  target_organization uuid,
  invitation_email text,
  invitation_role public.organization_role,
  invitation_expires_at timestamptz,
  invitation_request_id uuid,
  actor_user uuid
)
returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  normalized_email text:=lower(btrim(invitation_email));
  actor_role public.organization_role;
  invitation_id uuid;
begin
  actor_role:=private.team_actor_role(target_organization,actor_user);
  if actor_role is null or actor_role not in ('owner','admin') then raise exception 'insufficient_role'; end if;
  if invitation_role='owner' or (actor_role='admin' and invitation_role='admin') then raise exception 'owner_role_required'; end if;
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or char_length(normalized_email)>254 then raise exception 'invalid_email'; end if;
  if invitation_expires_at<=now() or invitation_expires_at>now()+interval '14 days' then raise exception 'invalid_expiration'; end if;
  if (select count(*) from public.organization_invitations where organization_id=target_organization and invited_by=actor_user and created_at>now()-interval '1 hour')>=10 then
    raise exception 'invitation_rate_limit';
  end if;

  select id into invitation_id from public.organization_invitations
  where organization_id=target_organization and invited_by=actor_user and request_id=invitation_request_id;
  if invitation_id is not null then return invitation_id; end if;

  update public.organization_invitations set status='expired',updated_at=now()
  where organization_id=target_organization and email_normalized=normalized_email and status='pending' and expires_at<=now();
  select id into invitation_id from public.organization_invitations
  where organization_id=target_organization and email_normalized=normalized_email and status='pending';
  if invitation_id is not null then return invitation_id; end if;

  insert into public.organization_invitations(organization_id,email_normalized,role,invited_by,request_id,expires_at)
  values(target_organization,normalized_email,invitation_role,actor_user,invitation_request_id,invitation_expires_at)
  returning id into invitation_id;
  insert into public.organization_security_events(organization_id,entity_type,entity_id,action,actor_user_id,details)
  values(target_organization,'organization_invitation',invitation_id,'invited',actor_user,jsonb_build_object('email',normalized_email,'role',invitation_role,'expires_at',invitation_expires_at));
  return invitation_id;
exception when unique_violation then
  select id into invitation_id from public.organization_invitations
  where organization_id=target_organization and email_normalized=normalized_email and status='pending';
  return invitation_id;
end
$$;

create or replace function public.mark_organization_invitation_delivery_server(
  target_invitation uuid,
  next_delivery_status text,
  target_provider_user uuid,
  target_failure_code text
)
returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  invitation public.organization_invitations%rowtype;
begin
  if next_delivery_status not in ('sent','not_required','failed') then raise exception 'invalid_delivery_status'; end if;
  select * into invitation from public.organization_invitations where id=target_invitation for update;
  if not found then raise exception 'invitation_not_found'; end if;
  update public.organization_invitations set
    delivery_status=next_delivery_status,
    provider_user_id=coalesce(target_provider_user,provider_user_id),
    failure_code=case when next_delivery_status='failed' then left(coalesce(target_failure_code,'provider_error'),120) else null end,
    updated_at=now()
  where id=target_invitation;
  insert into public.organization_security_events(organization_id,entity_type,entity_id,action,actor_user_id,subject_user_id,details)
  values(invitation.organization_id,'organization_invitation',invitation.id,'invitation_delivery_changed',invitation.invited_by,target_provider_user,jsonb_build_object('delivery_status',next_delivery_status,'failure_code',case when next_delivery_status='failed' then left(coalesce(target_failure_code,'provider_error'),120) else null end));
  return target_invitation;
end
$$;

revoke all on function public.list_organization_team(uuid) from public,anon;
revoke all on function public.accept_organization_invitation(uuid) from public,anon;
revoke all on function public.change_organization_member_role(uuid,uuid,public.organization_role,uuid) from public,anon;
revoke all on function public.remove_organization_member(uuid,uuid,uuid) from public,anon;
revoke all on function public.revoke_organization_invitation(uuid,uuid) from public,anon;
revoke all on function public.prepare_organization_invitation_server(uuid,text,public.organization_role,timestamptz,uuid,uuid) from public,anon,authenticated;
revoke all on function public.mark_organization_invitation_delivery_server(uuid,text,uuid,text) from public,anon,authenticated;

grant execute on function public.list_organization_team(uuid) to authenticated;
grant execute on function public.accept_organization_invitation(uuid) to authenticated;
grant execute on function public.change_organization_member_role(uuid,uuid,public.organization_role,uuid) to authenticated;
grant execute on function public.remove_organization_member(uuid,uuid,uuid) to authenticated;
grant execute on function public.revoke_organization_invitation(uuid,uuid) to authenticated;
grant execute on function public.prepare_organization_invitation_server(uuid,text,public.organization_role,timestamptz,uuid,uuid) to service_role;
grant execute on function public.mark_organization_invitation_delivery_server(uuid,text,uuid,text) to service_role;

comment on table public.organization_invitations is 'Tenant invitations with explicit delivery, expiry, acceptance, and revocation lifecycle. Browser writes are forbidden.';
comment on table public.organization_security_events is 'Immutable tenant-security audit trail readable only by organization managers.';
comment on function public.accept_organization_invitation(uuid) is 'Accepts only a pending invitation whose normalized email exactly matches the authenticated user.';
comment on function public.remove_organization_member(uuid,uuid,uuid) is 'Revokes tenant membership immediately; blocks removal while open field work remains assigned.';

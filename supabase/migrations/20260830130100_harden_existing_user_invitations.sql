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
  pending_delivery text;
  pending_request uuid;
  pending_role public.organization_role;
begin
  actor_role:=private.team_actor_role(target_organization,actor_user);
  if actor_role is null or actor_role not in ('owner','admin') then raise exception 'insufficient_role'; end if;
  if invitation_role='owner' or (actor_role='admin' and invitation_role='admin') then raise exception 'owner_role_required'; end if;
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or char_length(normalized_email)>254 then raise exception 'invalid_email'; end if;
  if invitation_expires_at<=now() or invitation_expires_at>now()+interval '14 days' then raise exception 'invalid_expiration'; end if;
  if exists(
    select 1 from public.organization_members member join auth.users user_row on user_row.id=member.user_id
    where member.organization_id=target_organization and lower(user_row.email)=normalized_email
  ) then raise exception 'already_organization_member'; end if;
  if (select count(*) from public.organization_invitations where organization_id=target_organization and invited_by=actor_user and created_at>now()-interval '1 hour')>=10 then
    raise exception 'invitation_rate_limit';
  end if;

  select id into invitation_id from public.organization_invitations
  where organization_id=target_organization and invited_by=actor_user and request_id=invitation_request_id;
  if invitation_id is not null then return invitation_id; end if;

  update public.organization_invitations set status='expired',updated_at=now()
  where organization_id=target_organization and email_normalized=normalized_email and status='pending' and expires_at<=now();
  select id,delivery_status,request_id,role into invitation_id,pending_delivery,pending_request,pending_role from public.organization_invitations
  where organization_id=target_organization and email_normalized=normalized_email and status='pending';
  if invitation_id is not null then
    if pending_delivery in ('failed','queued') and pending_role=invitation_role then return invitation_id; end if;
    raise exception 'invitation_already_pending';
  end if;

  insert into public.organization_invitations(organization_id,email_normalized,role,invited_by,request_id,expires_at)
  values(target_organization,normalized_email,invitation_role,actor_user,invitation_request_id,invitation_expires_at)
  returning id into invitation_id;
  insert into public.organization_security_events(organization_id,entity_type,entity_id,action,actor_user_id,details)
  values(target_organization,'organization_invitation',invitation_id,'invited',actor_user,jsonb_build_object('email',normalized_email,'role',invitation_role,'expires_at',invitation_expires_at));
  return invitation_id;
exception when unique_violation then
  select id,request_id into invitation_id,pending_request from public.organization_invitations
  where organization_id=target_organization and email_normalized=normalized_email and status='pending';
  if pending_request=invitation_request_id then return invitation_id; end if;
  raise exception 'invitation_already_pending';
end
$$;

create or replace function public.lookup_organization_invitation_user_server(target_invitation uuid)
returns uuid
language sql stable security definer set search_path=''
as $$
  select user_row.id
  from public.organization_invitations invitation
  join auth.users user_row on lower(user_row.email)=invitation.email_normalized
  where invitation.id=target_invitation and invitation.status='pending' and invitation.expires_at>now()
  limit 1
$$;

revoke all on function public.prepare_organization_invitation_server(uuid,text,public.organization_role,timestamptz,uuid,uuid) from public,anon,authenticated;
revoke all on function public.lookup_organization_invitation_user_server(uuid) from public,anon,authenticated;
grant execute on function public.prepare_organization_invitation_server(uuid,text,public.organization_role,timestamptz,uuid,uuid) to service_role;
grant execute on function public.lookup_organization_invitation_user_server(uuid) to service_role;

comment on function public.lookup_organization_invitation_user_server(uuid) is 'Service-only lookup used to route existing accounts through email-bound manual acceptance without enumerating Auth users in the browser.';

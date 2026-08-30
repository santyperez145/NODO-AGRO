create index if not exists scouting_visits_assignee_status_time_idx
  on public.scouting_visits(assigned_to,status,scheduled_for)
  where assigned_to is not null;

create or replace function public.list_scouting_assignees(target_establishment uuid)
returns table(user_id uuid, display_name text, member_role public.organization_role)
language sql stable security definer set search_path='' as $$
  select member.user_id,
    left(coalesce(
      nullif(trim(account.raw_user_meta_data->>'full_name'),''),
      nullif(trim(account.raw_user_meta_data->>'name'),''),
      'Miembro '||left(member.user_id::text,8)
    ),120) as display_name,
    member.role
  from public.establishments establishment
  join public.organization_members member on member.organization_id=establishment.organization_id
  join auth.users account on account.id=member.user_id
  where establishment.id=target_establishment
    and private.is_org_member(establishment.organization_id)
    and member.role in ('owner','admin','agronomist','operator')
  order by display_name,member.user_id
$$;

revoke all on function public.list_scouting_assignees(uuid) from public,anon;
grant execute on function public.list_scouting_assignees(uuid) to authenticated;

comment on function public.list_scouting_assignees(uuid) is 'Tenant-scoped Scout directory with bounded display names and no email disclosure.';

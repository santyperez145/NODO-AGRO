create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.is_org_member(target_organization uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.organization_members where organization_id = target_organization and user_id = auth.uid()) $$;

create or replace function private.has_org_role(target_organization uuid, allowed_roles public.organization_role[])
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.organization_members where organization_id = target_organization and user_id = auth.uid() and role = any(allowed_roles)) $$;

grant usage on schema private to authenticated;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid, public.organization_role[]) to authenticated;

drop policy memberships_select on public.organization_members;
create policy memberships_select on public.organization_members for select to authenticated
using (user_id = (select auth.uid()) or private.has_org_role(organization_id, array['owner','admin']::public.organization_role[]));

drop policy organizations_select_member on public.organizations;
create policy organizations_select_member on public.organizations for select to authenticated using (private.is_org_member(id));
drop policy establishments_select on public.establishments;
create policy establishments_select on public.establishments for select to authenticated using (private.is_org_member(organization_id));
drop policy establishments_insert on public.establishments;
create policy establishments_insert on public.establishments for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin']::public.organization_role[]));
drop policy establishments_update on public.establishments;
create policy establishments_update on public.establishments for update to authenticated using (private.has_org_role(organization_id, array['owner','admin']::public.organization_role[])) with check (private.has_org_role(organization_id, array['owner','admin']::public.organization_role[]));
drop policy establishments_delete on public.establishments;
create policy establishments_delete on public.establishments for delete to authenticated using (private.has_org_role(organization_id, array['owner']::public.organization_role[]));
drop policy devices_select on public.devices;
create policy devices_select on public.devices for select to authenticated using (private.is_org_member(organization_id));
drop policy devices_insert on public.devices;
create policy devices_insert on public.devices for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin']::public.organization_role[]));
drop policy devices_update on public.devices;
create policy devices_update on public.devices for update to authenticated using (private.has_org_role(organization_id, array['owner','admin']::public.organization_role[]));
drop policy devices_delete on public.devices;
create policy devices_delete on public.devices for delete to authenticated using (private.has_org_role(organization_id, array['owner']::public.organization_role[]));
drop policy readings_select on public.sensor_readings;
create policy readings_select on public.sensor_readings for select to authenticated using (private.is_org_member(organization_id));

create or replace function public.create_organization(organization_name text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare new_id uuid; current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if char_length(trim(organization_name)) not between 2 and 120 then raise exception 'Organization name must contain 2 to 120 characters'; end if;
  insert into public.organizations(name) values (trim(organization_name)) returning id into new_id;
  insert into public.organization_members(organization_id,user_id,role) values (new_id,current_user_id,'owner');
  return new_id;
end $$;
revoke all on function public.create_organization(text) from public, anon;
grant execute on function public.create_organization(text) to authenticated;

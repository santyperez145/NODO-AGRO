create table private.device_credentials (
  device_id uuid primary key references public.devices(id) on delete cascade,
  token_digest text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
revoke all on private.device_credentials from public, anon, authenticated;

create or replace function public.provision_device(
  target_establishment uuid,
  device_external_id text,
  device_kind text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target_org uuid;
  new_device_id uuid;
  plain_token text := encode(gen_random_bytes(32), 'hex');
begin
  select organization_id into target_org from public.establishments where id = target_establishment;
  if target_org is null or not private.has_org_role(target_org, array['owner','admin']::public.organization_role[]) then raise exception 'Not authorized'; end if;
  if trim(device_external_id) = '' then raise exception 'External ID is required'; end if;
  if device_kind not in ('gateway','weather','soil','rfid','camera','machine','water') then raise exception 'Invalid device kind'; end if;
  insert into public.devices(organization_id, establishment_id, external_id, kind, status)
    values (target_org, target_establishment, trim(device_external_id), device_kind, 'provisioning')
    returning id into new_device_id;
  insert into private.device_credentials(device_id, token_digest)
    values (new_device_id, encode(digest(plain_token, 'sha256'), 'hex'));
  return jsonb_build_object('device_id', new_device_id, 'token', plain_token);
end $$;
revoke all on function public.provision_device(uuid,text,text) from public, anon;
grant execute on function public.provision_device(uuid,text,text) to authenticated;

create or replace function public.resolve_device_token(candidate_digest text)
returns table(device_id uuid, organization_id uuid, establishment_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  update private.device_credentials credentials
  set last_used_at = now()
  from public.devices device
  where credentials.token_digest = candidate_digest
    and credentials.revoked_at is null
    and device.id = credentials.device_id
    and device.status <> 'retired'
  returning device.id, device.organization_id, device.establishment_id;
end $$;
revoke all on function public.resolve_device_token(text) from public, anon, authenticated;
grant execute on function public.resolve_device_token(text) to service_role;

comment on function public.provision_device(uuid,text,text) is 'Returns a device token exactly once. Store it in the physical gateway secure storage.';
comment on function public.resolve_device_token(text) is 'Service-role-only token validation used by the telemetry ingestion function.';

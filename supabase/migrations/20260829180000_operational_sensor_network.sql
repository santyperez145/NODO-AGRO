alter table public.devices
  add column display_name text,
  add column parcel_id uuid references public.land_parcels(id) on delete set null,
  add column expected_interval_minutes integer not null default 60,
  add column installed_at timestamptz not null default now();

update public.devices set display_name = external_id where display_name is null;

alter table public.devices
  alter column display_name set not null,
  add constraint devices_display_name_length check (char_length(trim(display_name)) between 2 and 100),
  add constraint devices_expected_interval check (expected_interval_minutes between 1 and 10080);

create index devices_parcel_idx on public.devices(parcel_id) where parcel_id is not null;

drop function public.provision_device(uuid,text,text);

create function public.provision_device(
  target_establishment uuid,
  device_external_id text,
  device_kind text,
  device_display_name text,
  target_parcel uuid,
  reporting_interval_minutes integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target_org uuid;
  parcel_establishment uuid;
  new_device_id uuid;
  plain_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  select organization_id into target_org from public.establishments where id = target_establishment;
  if target_org is null or not private.has_org_role(target_org, array['owner','admin']::public.organization_role[]) then
    raise exception 'Not authorized';
  end if;
  if char_length(trim(device_external_id)) not between 2 and 100 then raise exception 'Invalid external ID'; end if;
  if char_length(trim(device_display_name)) not between 2 and 100 then raise exception 'Invalid device name'; end if;
  if device_kind not in ('gateway','weather','soil','rfid','camera','machine','water') then raise exception 'Invalid device kind'; end if;
  if reporting_interval_minutes not between 1 and 10080 then raise exception 'Invalid reporting interval'; end if;

  if target_parcel is not null then
    select establishment_id into parcel_establishment
      from public.land_parcels
      where id = target_parcel and organization_id = target_org;
    if parcel_establishment is distinct from target_establishment then raise exception 'Parcel does not belong to establishment'; end if;
  end if;

  insert into public.devices(
    organization_id, establishment_id, external_id, kind, status,
    display_name, parcel_id, expected_interval_minutes
  ) values (
    target_org, target_establishment, trim(device_external_id), device_kind, 'provisioning',
    trim(device_display_name), target_parcel, reporting_interval_minutes
  ) returning id into new_device_id;

  insert into private.device_credentials(device_id, token_digest)
    values (new_device_id, encode(extensions.digest(plain_token, 'sha256'), 'hex'));

  return jsonb_build_object('device_id', new_device_id, 'token', plain_token);
end $$;

revoke all on function public.provision_device(uuid,text,text,text,uuid,integer) from public, anon;
grant execute on function public.provision_device(uuid,text,text,text,uuid,integer) to authenticated;

comment on function public.provision_device(uuid,text,text,text,uuid,integer) is
  'Provisions a tenant-scoped device and returns its ingestion token exactly once.';

create view public.latest_sensor_readings
with (security_invoker = true)
as
select distinct on (reading.device_id, reading.metric)
  reading.id,
  reading.organization_id,
  device.establishment_id,
  reading.device_id,
  reading.observed_at,
  reading.metric,
  reading.value,
  reading.unit,
  reading.quality,
  reading.ingested_at
from public.sensor_readings reading
join public.devices device on device.id = reading.device_id
order by reading.device_id, reading.metric, reading.observed_at desc;

revoke all on public.latest_sensor_readings from public, anon, authenticated;
grant select on public.latest_sensor_readings to authenticated;

comment on view public.latest_sensor_readings is
  'Latest observation per device and metric. Uses invoker security so underlying tenant RLS remains authoritative.';

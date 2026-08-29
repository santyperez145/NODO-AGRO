create type public.device_command_status as enum ('queued','delivered','succeeded','failed','expired','cancelled');

create table public.device_twins (
  device_id uuid primary key references public.devices(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  desired_state jsonb not null default '{}'::jsonb check (jsonb_typeof(desired_state) = 'object'),
  desired_version bigint not null default 0 check (desired_version >= 0),
  desired_updated_at timestamptz,
  reported_state jsonb not null default '{}'::jsonb check (jsonb_typeof(reported_state) = 'object'),
  reported_version bigint not null default 0 check (reported_version >= 0),
  reported_updated_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.device_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  command_type text not null check (command_type in ('request_status','set_reporting_interval','restart_agent')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 4096),
  status public.device_command_status not null default 'queued',
  idempotency_key uuid not null,
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  not_before timestamptz not null default now(),
  expires_at timestamptz not null,
  delivered_at timestamptz,
  lease_until timestamptz,
  delivery_attempts integer not null default 0 check (delivery_attempts >= 0),
  acknowledged_at timestamptz,
  result jsonb,
  unique(device_id,idempotency_key),
  check (expires_at > created_at)
);

create table public.device_command_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  command_id uuid not null references public.device_commands(id) on delete cascade,
  event_type text not null check (event_type in ('queued','delivered','succeeded','failed','expired','cancelled')),
  actor_type text not null check (actor_type in ('user','device','system')),
  actor_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index device_commands_delivery_idx on public.device_commands(device_id,status,not_before,expires_at);
create index device_commands_establishment_time_idx on public.device_commands(establishment_id,created_at desc);
create index device_command_events_command_time_idx on public.device_command_events(command_id,created_at);

alter table public.device_twins enable row level security;
alter table public.device_commands enable row level security;
alter table public.device_command_events enable row level security;

revoke all on public.device_twins,public.device_commands,public.device_command_events from public,anon,authenticated;
grant select on public.device_twins,public.device_commands,public.device_command_events to authenticated;

create policy device_twins_select on public.device_twins for select to authenticated
  using (private.is_org_member(organization_id));
create policy device_commands_select on public.device_commands for select to authenticated
  using (private.is_org_member(organization_id));
create policy device_command_events_select on public.device_command_events for select to authenticated
  using (private.is_org_member(organization_id));

create function private.create_device_twin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.device_twins(device_id,organization_id) values (new.id,new.organization_id)
    on conflict (device_id) do nothing;
  return new;
end $$;

revoke all on function private.create_device_twin() from public,anon,authenticated;

create trigger devices_create_twin
after insert on public.devices
for each row execute function private.create_device_twin();

insert into public.device_twins(device_id,organization_id)
select id,organization_id from public.devices
on conflict (device_id) do nothing;

create function public.queue_device_command(
  target_device uuid,
  command_name text,
  command_payload jsonb,
  command_idempotency_key uuid,
  ttl_seconds integer
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  target_org uuid;
  target_establishment uuid;
  target_status text;
  new_command_id uuid;
  interval_minutes integer;
begin
  select organization_id,establishment_id,status into target_org,target_establishment,target_status
    from public.devices where id=target_device;
  if target_org is null or not private.has_org_role(target_org,array['owner','admin']::public.organization_role[]) then
    raise exception 'Not authorized';
  end if;
  if target_status='retired' then raise exception 'Device is retired'; end if;
  if command_name not in ('request_status','set_reporting_interval','restart_agent') then raise exception 'Unsupported command'; end if;
  if command_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if ttl_seconds not between 60 and 86400 then raise exception 'TTL must be between 60 and 86400 seconds'; end if;
  command_payload:=coalesce(command_payload,'{}'::jsonb);
  if jsonb_typeof(command_payload)<>'object' or octet_length(command_payload::text)>4096 then raise exception 'Invalid command payload'; end if;

  if command_name='set_reporting_interval' then
    if coalesce(command_payload->>'minutes','') !~ '^[0-9]{1,5}$' then raise exception 'Interval minutes is required'; end if;
    interval_minutes:=(command_payload->>'minutes')::integer;
    if interval_minutes not between 1 and 10080 then raise exception 'Invalid reporting interval'; end if;
  elsif command_payload<>'{}'::jsonb then
    raise exception 'This command does not accept a payload';
  end if;

  select id into new_command_id from public.device_commands
    where device_id=target_device and idempotency_key=command_idempotency_key;
  if new_command_id is not null then return new_command_id; end if;

  insert into public.device_commands(
    organization_id,establishment_id,device_id,command_type,payload,idempotency_key,requested_by,expires_at
  ) values (
    target_org,target_establishment,target_device,command_name,command_payload,command_idempotency_key,auth.uid(),now()+make_interval(secs=>ttl_seconds)
  ) on conflict (device_id,idempotency_key) do nothing returning id into new_command_id;

  if new_command_id is null then
    select id into new_command_id from public.device_commands
      where device_id=target_device and idempotency_key=command_idempotency_key;
    return new_command_id;
  end if;

  if command_name='set_reporting_interval' then
    update public.device_twins set
      desired_state=jsonb_set(desired_state,'{reporting_interval_minutes}',to_jsonb(interval_minutes),true),
      desired_version=desired_version+1,
      desired_updated_at=now()
      where device_id=target_device;
  end if;

  insert into public.device_command_events(organization_id,device_id,command_id,event_type,actor_type,actor_user_id,details)
    values(target_org,target_device,new_command_id,'queued','user',auth.uid(),jsonb_build_object('ttl_seconds',ttl_seconds));
  return new_command_id;
end $$;

revoke all on function public.queue_device_command(uuid,text,jsonb,uuid,integer) from public,anon;
grant execute on function public.queue_device_command(uuid,text,jsonb,uuid,integer) to authenticated;

create function public.claim_device_command(target_device uuid)
returns table(id uuid,command_type text,payload jsonb,expires_at timestamptz,delivery_attempts integer)
language plpgsql security definer set search_path = '' as $$
declare
  command_row public.device_commands%rowtype;
begin
  with expired as (
    update public.device_commands set status='expired',acknowledged_at=now(),lease_until=null
      where device_id=target_device and status in ('queued','delivered') and expires_at<=now()
      returning organization_id,device_id,id
  ) insert into public.device_command_events(organization_id,device_id,command_id,event_type,actor_type)
    select organization_id,device_id,id,'expired','system' from expired;

  select * into command_row from public.device_commands
    where device_id=target_device
      and status in ('queued','delivered')
      and not_before<=now() and expires_at>now()
      and (status='queued' or lease_until is null or lease_until<=now())
      and delivery_attempts<10
    order by created_at
    for update skip locked
    limit 1;
  if command_row.id is null then return; end if;

  update public.device_commands set
    status='delivered',delivered_at=coalesce(delivered_at,now()),lease_until=now()+interval '90 seconds',delivery_attempts=delivery_attempts+1
    where device_commands.id=command_row.id
    returning * into command_row;
  insert into public.device_command_events(organization_id,device_id,command_id,event_type,actor_type,details)
    values(command_row.organization_id,target_device,command_row.id,'delivered','device',jsonb_build_object('attempt',command_row.delivery_attempts));
  return query select command_row.id,command_row.command_type,command_row.payload,command_row.expires_at,command_row.delivery_attempts;
end $$;

revoke all on function public.claim_device_command(uuid) from public,anon,authenticated;
grant execute on function public.claim_device_command(uuid) to service_role;

create function public.ack_device_command(target_device uuid,target_command uuid,next_status text,command_result jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  command_row public.device_commands%rowtype;
  interval_minutes integer;
begin
  if next_status not in ('succeeded','failed') then raise exception 'Invalid acknowledgement status'; end if;
  command_result:=coalesce(command_result,'{}'::jsonb);
  if jsonb_typeof(command_result)<>'object' or octet_length(command_result::text)>8192 then raise exception 'Invalid result'; end if;
  select * into command_row from public.device_commands where id=target_command and device_id=target_device for update;
  if command_row.id is null then raise exception 'Command not found'; end if;
  if command_row.status::text=next_status then return; end if;
  if command_row.status<>'delivered' then raise exception 'Command is not awaiting acknowledgement'; end if;

  update public.device_commands set status=next_status::public.device_command_status,acknowledged_at=now(),lease_until=null,result=command_result
    where id=target_command;
  update public.devices set status='online',last_seen_at=now() where id=target_device;

  if next_status='succeeded' and command_row.command_type='set_reporting_interval' then
    interval_minutes:=(command_row.payload->>'minutes')::integer;
    update public.devices set expected_interval_minutes=interval_minutes where id=target_device;
    update public.device_twins set
      reported_state=jsonb_set(reported_state,'{reporting_interval_minutes}',to_jsonb(interval_minutes),true),
      reported_version=reported_version+1,reported_updated_at=now()
      where device_id=target_device;
  end if;

  insert into public.device_command_events(organization_id,device_id,command_id,event_type,actor_type,details)
    values(command_row.organization_id,target_device,target_command,next_status,'device',command_result);
end $$;

revoke all on function public.ack_device_command(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.ack_device_command(uuid,uuid,text,jsonb) to service_role;

create function public.report_device_state(target_device uuid,state_payload jsonb,state_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  current_version bigint;
begin
  if state_version<1 then raise exception 'State version must be positive'; end if;
  if jsonb_typeof(state_payload)<>'object' or octet_length(state_payload::text)>16384 then raise exception 'Invalid reported state'; end if;
  select reported_version into current_version from public.device_twins where device_id=target_device for update;
  if current_version is null then raise exception 'Device twin not found'; end if;
  if state_version>current_version then
    update public.device_twins set reported_state=state_payload,reported_version=state_version,reported_updated_at=now()
      where device_id=target_device;
  end if;
  update public.devices set status='online',last_seen_at=now() where id=target_device;
  return greatest(current_version,state_version);
end $$;

revoke all on function public.report_device_state(uuid,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.report_device_state(uuid,jsonb,bigint) to service_role;

comment on table public.device_twins is 'Desired and reported device state with monotonic versions.';
comment on table public.device_commands is 'Durable, expiring and idempotent safe-command queue. Arbitrary actuation is intentionally unsupported.';

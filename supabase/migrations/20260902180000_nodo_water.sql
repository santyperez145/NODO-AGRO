alter table public.weather_daily_observations
  add column et0_mm double precision check (et0_mm is null or (et0_mm >= 0 and et0_mm <= 40)),
  add column observation_kind text not null default 'observed' check (observation_kind in ('observed','forecast'));

create type public.irrigation_method as enum ('sprinkler','drip','flood','pivot','unknown');
create type public.water_balance_status as enum ('running','completed','partial','failed');
create type public.water_review_status as enum ('watch','verify','insufficient');
create type public.water_coverage_status as enum ('reference_only','with_irrigation','with_soil','with_canopy','instrumented');

create table public.irrigation_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  parcel_id uuid not null references public.land_parcels(id) on delete restrict,
  applied_on date not null,
  depth_mm numeric(8,2) not null check (depth_mm > 0 and depth_mm <= 500),
  method public.irrigation_method not null default 'unknown',
  notes text check (notes is null or char_length(notes) <= 500),
  reversal_of uuid references public.irrigation_events(id) on delete restrict,
  request_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id,request_id),
  unique (reversal_of),
  check (applied_on <= current_date + 1)
);

create table public.water_balance_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  algorithm_version text not null check (char_length(algorithm_version) between 3 and 80),
  requested_by uuid references auth.users(id) on delete set null,
  status public.water_balance_status not null default 'running',
  window_start date not null,
  window_end date not null,
  parcel_count integer not null default 0 check (parcel_count between 0 and 100),
  succeeded_count integer not null default 0 check (succeeded_count between 0 and parcel_count),
  failed_count integer not null default 0 check (failed_count between 0 and parcel_count),
  weather_days integer not null default 0 check (weather_days >= 0),
  error_code text check (error_code is null or char_length(error_code) <= 120),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  check (window_end >= window_start),
  check ((status='running' and completed_at is null) or (status<>'running' and completed_at is not null))
);

create table public.parcel_water_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  parcel_id uuid not null references public.land_parcels(id) on delete cascade,
  run_id uuid not null references public.water_balance_runs(id) on delete restrict,
  algorithm_version text not null check (char_length(algorithm_version) between 3 and 80),
  window_start date not null,
  window_end date not null,
  rain_mm double precision not null check (rain_mm >= 0),
  et0_mm double precision not null check (et0_mm >= 0),
  irrigation_mm double precision not null check (irrigation_mm >= 0),
  reference_balance_mm double precision not null,
  weather_days integer not null check (weather_days >= 0),
  ndmi_latest double precision check (ndmi_latest is null or ndmi_latest between -1 and 1),
  ndmi_delta double precision,
  ndmi_captured_at timestamptz,
  soil_moisture_pct double precision check (soil_moisture_pct is null or soil_moisture_pct between 0 and 100),
  soil_observed_at timestamptz,
  coverage_status public.water_coverage_status not null,
  review_status public.water_review_status not null,
  limitations jsonb not null check (jsonb_typeof(limitations)='array' and octet_length(limitations::text)<=4096),
  computed_at timestamptz not null default now(),
  unique (parcel_id,window_start,window_end,algorithm_version),
  check (window_end >= window_start)
);

create index irrigation_events_establishment_time_idx
  on public.irrigation_events(establishment_id,applied_on desc);
create index water_balance_runs_establishment_time_idx
  on public.water_balance_runs(establishment_id,started_at desc);
create index parcel_water_balances_establishment_idx
  on public.parcel_water_balances(establishment_id,window_end desc);

create function private.enforce_water_scope() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  establishment_org uuid;
  parcel_org uuid;
  parcel_establishment uuid;
  run_org uuid;
  run_establishment uuid;
begin
  select organization_id into establishment_org from public.establishments where id=new.establishment_id;
  if establishment_org is null or establishment_org<>new.organization_id then
    raise exception 'Water establishment scope mismatch';
  end if;
  if tg_table_name in ('irrigation_events','parcel_water_balances') then
    select organization_id,establishment_id into parcel_org,parcel_establishment
      from public.land_parcels where id=new.parcel_id;
    if parcel_org is null or parcel_org<>new.organization_id or parcel_establishment<>new.establishment_id then
      raise exception 'Water parcel scope mismatch';
    end if;
  end if;
  if tg_table_name='parcel_water_balances' then
    select organization_id,establishment_id into run_org,run_establishment
      from public.water_balance_runs where id=new.run_id;
    if run_org is null or run_org<>new.organization_id or run_establishment<>new.establishment_id then
      raise exception 'Water balance run scope mismatch';
    end if;
  end if;
  return new;
end;
$$;

create trigger irrigation_event_scope_guard
  before insert or update on public.irrigation_events
  for each row execute function private.enforce_water_scope();
create trigger water_balance_run_scope_guard
  before insert or update on public.water_balance_runs
  for each row execute function private.enforce_water_scope();
create trigger parcel_water_balance_scope_guard
  before insert or update on public.parcel_water_balances
  for each row execute function private.enforce_water_scope();

create function public.record_irrigation_event(
  target_establishment uuid,
  target_parcel uuid,
  applied_on date,
  depth_mm numeric,
  irrigation_method public.irrigation_method,
  event_notes text,
  request_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  target_org uuid;
  parcel_establishment uuid;
  existing_event uuid;
  new_event_id uuid;
begin
  select organization_id into target_org from public.establishments where id=target_establishment;
  if target_org is null or not private.has_org_role(target_org,array['owner','admin','agronomist','operator']::public.organization_role[]) then
    raise exception 'Not authorized';
  end if;
  if request_id is null then raise exception 'Request ID is required'; end if;
  select id into existing_event from public.irrigation_events where organization_id=target_org and request_id=record_irrigation_event.request_id;
  if existing_event is not null then return existing_event; end if;
  if applied_on is null or applied_on>current_date+1 then raise exception 'Invalid irrigation date'; end if;
  if depth_mm is null or depth_mm<=0 or depth_mm>500 then raise exception 'Irrigation depth must be between 0.01 and 500 mm'; end if;
  if event_notes is not null and char_length(event_notes)>500 then raise exception 'Notes are too long'; end if;
  select establishment_id into parcel_establishment
    from public.land_parcels where id=target_parcel and organization_id=target_org;
  if parcel_establishment is distinct from target_establishment then raise exception 'Parcel does not belong to establishment'; end if;
  insert into public.irrigation_events(organization_id,establishment_id,parcel_id,applied_on,depth_mm,method,notes,request_id,created_by)
  values(target_org,target_establishment,target_parcel,applied_on,depth_mm,coalesce(irrigation_method,'unknown'),nullif(trim(event_notes),''),request_id,auth.uid())
  returning id into new_event_id;
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
  values(target_org,target_establishment,'irrigation_event',new_event_id,'created',auth.uid(),jsonb_build_object('parcel_id',target_parcel,'depth_mm',depth_mm,'method',irrigation_method));
  return new_event_id;
end;
$$;

create function public.reverse_irrigation_event(target_event uuid, reversal_reason text, request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  event_row public.irrigation_events%rowtype;
  existing_event uuid;
  new_event_id uuid;
begin
  select * into event_row from public.irrigation_events where id=target_event;
  if event_row.id is null or not private.has_org_role(event_row.organization_id,array['owner','admin','agronomist']::public.organization_role[]) then
    raise exception 'Not authorized';
  end if;
  if event_row.reversal_of is not null then raise exception 'A reversal cannot be reversed'; end if;
  if request_id is null then raise exception 'Request ID is required'; end if;
  select id into existing_event from public.irrigation_events where organization_id=event_row.organization_id and request_id=reverse_irrigation_event.request_id;
  if existing_event is not null then return existing_event; end if;
  if exists(select 1 from public.irrigation_events where reversal_of=event_row.id) then raise exception 'Irrigation event is already reversed'; end if;
  if char_length(trim(reversal_reason)) not between 2 and 300 then raise exception 'Reversal reason is required'; end if;
  insert into public.irrigation_events(organization_id,establishment_id,parcel_id,applied_on,depth_mm,method,notes,reversal_of,request_id,created_by)
  values(event_row.organization_id,event_row.establishment_id,event_row.parcel_id,current_date,event_row.depth_mm,event_row.method,'Reversión: '||trim(reversal_reason),event_row.id,request_id,auth.uid())
  returning id into new_event_id;
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
  values(event_row.organization_id,event_row.establishment_id,'irrigation_event',new_event_id,'reversed',auth.uid(),jsonb_build_object('reversal_of',event_row.id,'reason',trim(reversal_reason)));
  return new_event_id;
end;
$$;

create view public.latest_parcel_water_balances
with (security_invoker=true) as
select distinct on (balance.parcel_id) balance.*
from public.parcel_water_balances balance
order by balance.parcel_id, balance.computed_at desc;

alter table public.operational_audit_events drop constraint if exists operational_audit_events_entity_type_check;
alter table public.operational_audit_events add constraint operational_audit_events_entity_type_check
  check (entity_type in ('livestock_group','livestock_event','machine_asset','machine_event','financial_entry','maintenance_work_order','scouting_visit','scouting_finding','scouting_media','irrigation_event'));

alter table public.irrigation_events enable row level security;
alter table public.water_balance_runs enable row level security;
alter table public.parcel_water_balances enable row level security;

revoke all on public.irrigation_events,public.water_balance_runs,public.parcel_water_balances from public,anon,authenticated;
grant select on public.irrigation_events,public.water_balance_runs,public.parcel_water_balances,public.latest_parcel_water_balances to authenticated;
grant select,insert,update on public.irrigation_events,public.water_balance_runs,public.parcel_water_balances to service_role;

create policy irrigation_events_select on public.irrigation_events for select to authenticated
  using (private.is_org_member(organization_id));
create policy water_balance_runs_select on public.water_balance_runs for select to authenticated
  using (private.is_org_member(organization_id));
create policy parcel_water_balances_select on public.parcel_water_balances for select to authenticated
  using (private.is_org_member(organization_id));

revoke all on function private.enforce_water_scope() from public,anon,authenticated;
revoke all on function public.record_irrigation_event(uuid,uuid,date,numeric,public.irrigation_method,text,uuid) from public,anon;
revoke all on function public.reverse_irrigation_event(uuid,text,uuid) from public,anon;
grant execute on function public.record_irrigation_event(uuid,uuid,date,numeric,public.irrigation_method,text,uuid) to authenticated;
grant execute on function public.reverse_irrigation_event(uuid,text,uuid) to authenticated;

comment on table public.irrigation_events is 'Declared irrigation depths; append-only operational evidence, not a pump command.';
comment on table public.parcel_water_balances is 'Reference water ledger: rain + declared irrigation - FAO-56 ET0. Not crop ET, not a prescription.';
comment on column public.weather_daily_observations.et0_mm is 'FAO-56 reference evapotranspiration from Open-Meteo; not crop water use.';

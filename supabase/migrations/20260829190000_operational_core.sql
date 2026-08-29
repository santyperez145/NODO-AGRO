create type public.livestock_group_status as enum ('active','closed');
create type public.livestock_event_type as enum ('initial_stock','birth','purchase','sale','mortality','transfer_in','transfer_out','adjustment','weighing');
create type public.machine_status as enum ('active','maintenance','unavailable','retired');
create type public.machine_event_type as enum ('usage','service','repair','inspection');
create type public.financial_direction as enum ('income','expense');

create table public.livestock_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  parcel_id uuid references public.land_parcels(id) on delete set null,
  name text not null check (char_length(trim(name)) between 2 and 100),
  species text not null check (species in ('cattle','sheep','goat','horse','other')),
  category text not null check (char_length(trim(category)) between 2 and 60),
  head_count integer not null check (head_count >= 0),
  average_weight_kg numeric(10,2) check (average_weight_kg > 0),
  status public.livestock_group_status not null default 'active',
  last_observed_at timestamptz not null,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (establishment_id,name)
);

create table public.livestock_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  group_id uuid not null references public.livestock_groups(id) on delete restrict,
  event_type public.livestock_event_type not null,
  occurred_at timestamptz not null,
  head_delta integer not null,
  resulting_head_count integer not null check (resulting_head_count >= 0),
  average_weight_kg numeric(10,2) check (average_weight_kg > 0),
  reason text check (reason is null or char_length(reason) <= 500),
  idempotency_key uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id,idempotency_key),
  check ((event_type = 'weighing' and head_delta = 0 and average_weight_kg is not null) or event_type <> 'weighing')
);

create table public.machine_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 2 and 100),
  kind text not null check (kind in ('tractor','harvester','implement','vehicle','pump','generator','other')),
  manufacturer text check (manufacturer is null or char_length(manufacturer) <= 100),
  model text check (model is null or char_length(model) <= 100),
  serial_number text check (serial_number is null or char_length(serial_number) between 2 and 120),
  model_year integer check (model_year between 1950 and 2100),
  current_hours numeric(12,1) not null default 0 check (current_hours >= 0),
  service_interval_hours numeric(10,1) not null default 250 check (service_interval_hours > 0),
  last_service_hours numeric(12,1) not null default 0 check (last_service_hours >= 0 and last_service_hours <= current_hours),
  status public.machine_status not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (establishment_id,display_name)
);

create unique index machine_assets_org_serial_unique
  on public.machine_assets(organization_id,serial_number)
  where serial_number is not null;

create table public.machine_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  machine_id uuid not null references public.machine_assets(id) on delete restrict,
  event_type public.machine_event_type not null,
  occurred_at timestamptz not null,
  hours_delta numeric(10,1) not null default 0 check (hours_delta >= 0),
  meter_hours numeric(12,1) not null check (meter_hours >= 0),
  notes text check (notes is null or char_length(notes) <= 1000),
  idempotency_key uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id,idempotency_key),
  check ((event_type = 'usage' and hours_delta > 0) or (event_type <> 'usage' and hours_delta = 0))
);

create table public.financial_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  parcel_id uuid references public.land_parcels(id) on delete set null,
  machine_id uuid references public.machine_assets(id) on delete set null,
  direction public.financial_direction not null,
  occurred_on date not null,
  category text not null check (char_length(trim(category)) between 2 and 80),
  amount numeric(16,2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  description text not null check (char_length(trim(description)) between 2 and 500),
  reference text check (reference is null or char_length(reference) <= 120),
  reversal_of uuid references public.financial_entries(id) on delete restrict,
  idempotency_key uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id,idempotency_key),
  unique (reversal_of)
);

create table public.operational_audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  entity_type text not null check (entity_type in ('livestock_group','livestock_event','machine_asset','machine_event','financial_entry')),
  entity_id uuid not null,
  action text not null check (action in ('created','event_recorded','reversed')),
  actor_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 8192),
  created_at timestamptz not null default now()
);

create index livestock_groups_establishment_idx on public.livestock_groups(establishment_id,status,name);
create index livestock_events_group_time_idx on public.livestock_events(group_id,occurred_at desc);
create index machine_assets_establishment_idx on public.machine_assets(establishment_id,status,display_name);
create index machine_events_asset_time_idx on public.machine_events(machine_id,occurred_at desc);
create index financial_entries_establishment_date_idx on public.financial_entries(establishment_id,occurred_on desc,created_at desc);
create index audit_events_establishment_time_idx on public.operational_audit_events(establishment_id,created_at desc);

alter table public.livestock_groups enable row level security;
alter table public.livestock_events enable row level security;
alter table public.machine_assets enable row level security;
alter table public.machine_events enable row level security;
alter table public.financial_entries enable row level security;
alter table public.operational_audit_events enable row level security;

revoke all on public.livestock_groups,public.livestock_events,public.machine_assets,public.machine_events,public.financial_entries,public.operational_audit_events from public,anon,authenticated;
grant select on public.livestock_groups,public.livestock_events,public.machine_assets,public.machine_events,public.financial_entries to authenticated;
grant select on public.operational_audit_events to authenticated;

create policy livestock_groups_select on public.livestock_groups for select to authenticated
  using (private.is_org_member(organization_id));
create policy livestock_events_select on public.livestock_events for select to authenticated
  using (private.is_org_member(organization_id));
create policy machine_assets_select on public.machine_assets for select to authenticated
  using (private.is_org_member(organization_id));
create policy machine_events_select on public.machine_events for select to authenticated
  using (private.is_org_member(organization_id));
create policy financial_entries_select on public.financial_entries for select to authenticated
  using (private.is_org_member(organization_id));
create policy operational_audit_select on public.operational_audit_events for select to authenticated
  using (private.has_org_role(organization_id,array['owner','admin']::public.organization_role[]));

create function public.create_livestock_group(
  target_establishment uuid,
  target_parcel uuid,
  group_name text,
  group_species text,
  group_category text,
  initial_head_count integer,
  initial_average_weight_kg numeric,
  observed_at timestamptz,
  group_notes text,
  request_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  target_org uuid;
  parcel_establishment uuid;
  new_group_id uuid;
  new_event_id uuid := gen_random_uuid();
begin
  select organization_id into target_org from public.establishments where id = target_establishment;
  if target_org is null or not private.has_org_role(target_org,array['owner','admin','agronomist','operator']::public.organization_role[]) then raise exception 'Not authorized'; end if;
  if request_id is null then raise exception 'Request ID is required'; end if;
  select group_id into new_group_id from public.livestock_events where organization_id=target_org and idempotency_key=request_id;
  if new_group_id is not null then return new_group_id; end if;
  if char_length(trim(group_name)) not between 2 and 100 then raise exception 'Invalid group name'; end if;
  if group_species not in ('cattle','sheep','goat','horse','other') then raise exception 'Invalid species'; end if;
  if char_length(trim(group_category)) not between 2 and 60 then raise exception 'Invalid category'; end if;
  if initial_head_count < 1 then raise exception 'Initial head count must be positive'; end if;
  if initial_average_weight_kg is not null and initial_average_weight_kg <= 0 then raise exception 'Average weight must be positive'; end if;
  if observed_at is null or observed_at > now() + interval '5 minutes' then raise exception 'Invalid observation time'; end if;
  if group_notes is not null and char_length(group_notes) > 1000 then raise exception 'Notes are too long'; end if;
  if target_parcel is not null then
    select establishment_id into parcel_establishment from public.land_parcels where id=target_parcel and organization_id=target_org;
    if parcel_establishment is distinct from target_establishment then raise exception 'Parcel does not belong to establishment'; end if;
  end if;

  insert into public.livestock_groups(organization_id,establishment_id,parcel_id,name,species,category,head_count,average_weight_kg,last_observed_at,notes,created_by)
  values(target_org,target_establishment,target_parcel,trim(group_name),group_species,trim(group_category),initial_head_count,initial_average_weight_kg,observed_at,nullif(trim(group_notes),''),auth.uid())
  returning id into new_group_id;
  insert into public.livestock_events(id,organization_id,establishment_id,group_id,event_type,occurred_at,head_delta,resulting_head_count,average_weight_kg,reason,idempotency_key,created_by)
  values(new_event_id,target_org,target_establishment,new_group_id,'initial_stock',observed_at,initial_head_count,initial_head_count,initial_average_weight_kg,'Alta inicial',request_id,auth.uid());
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
  values(target_org,target_establishment,'livestock_group',new_group_id,'created',auth.uid(),jsonb_build_object('event_id',new_event_id,'head_count',initial_head_count));
  return new_group_id;
end $$;

create function public.record_livestock_event(
  target_group uuid,
  event_name public.livestock_event_type,
  occurred_at timestamptz,
  head_change integer,
  measured_average_weight_kg numeric,
  event_reason text,
  request_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  group_row public.livestock_groups%rowtype;
  existing_event uuid;
  new_event_id uuid;
  next_count integer;
begin
  select * into group_row from public.livestock_groups where id=target_group for update;
  if group_row.id is null or not private.has_org_role(group_row.organization_id,array['owner','admin','agronomist','operator']::public.organization_role[]) then raise exception 'Not authorized'; end if;
  if request_id is null then raise exception 'Request ID is required'; end if;
  select id into existing_event from public.livestock_events where organization_id=group_row.organization_id and idempotency_key=request_id;
  if existing_event is not null then return existing_event; end if;
  if event_name='initial_stock' then raise exception 'Initial stock is created with the group'; end if;
  if occurred_at is null or occurred_at > now() + interval '5 minutes' then raise exception 'Invalid event time'; end if;
  if event_reason is not null and char_length(event_reason)>500 then raise exception 'Reason is too long'; end if;
  if measured_average_weight_kg is not null and measured_average_weight_kg<=0 then raise exception 'Average weight must be positive'; end if;
  if event_name in ('birth','purchase','transfer_in') and head_change<=0 then raise exception 'This event requires a positive head change'; end if;
  if event_name in ('sale','mortality','transfer_out') and head_change>=0 then raise exception 'This event requires a negative head change'; end if;
  if event_name='adjustment' and head_change=0 then raise exception 'Adjustment cannot be zero'; end if;
  if event_name='weighing' and (head_change<>0 or measured_average_weight_kg is null) then raise exception 'Weighing requires zero head change and an average weight'; end if;
  next_count:=group_row.head_count+head_change;
  if next_count<0 then raise exception 'Event would make head count negative'; end if;

  insert into public.livestock_events(organization_id,establishment_id,group_id,event_type,occurred_at,head_delta,resulting_head_count,average_weight_kg,reason,idempotency_key,created_by)
  values(group_row.organization_id,group_row.establishment_id,group_row.id,event_name,occurred_at,head_change,next_count,measured_average_weight_kg,nullif(trim(event_reason),''),request_id,auth.uid())
  returning id into new_event_id;
  update public.livestock_groups set head_count=next_count,average_weight_kg=coalesce(measured_average_weight_kg,average_weight_kg),status=case when next_count=0 then 'closed' else 'active' end,last_observed_at=occurred_at,updated_at=now() where id=group_row.id;
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
  values(group_row.organization_id,group_row.establishment_id,'livestock_event',new_event_id,'event_recorded',auth.uid(),jsonb_build_object('group_id',group_row.id,'event_type',event_name,'head_delta',head_change,'resulting_head_count',next_count));
  return new_event_id;
end $$;

create function public.create_machine_asset(
  target_establishment uuid,
  asset_name text,
  asset_kind text,
  asset_manufacturer text,
  asset_model text,
  asset_serial_number text,
  asset_model_year integer,
  initial_hours numeric,
  maintenance_interval_hours numeric,
  previous_service_hours numeric
) returns uuid language plpgsql security definer set search_path = '' as $$
declare target_org uuid; new_asset_id uuid;
begin
  select organization_id into target_org from public.establishments where id=target_establishment;
  if target_org is null or not private.has_org_role(target_org,array['owner','admin','agronomist','operator']::public.organization_role[]) then raise exception 'Not authorized'; end if;
  if char_length(trim(asset_name)) not between 2 and 100 then raise exception 'Invalid asset name'; end if;
  if asset_kind not in ('tractor','harvester','implement','vehicle','pump','generator','other') then raise exception 'Invalid asset kind'; end if;
  if initial_hours<0 or maintenance_interval_hours<=0 or previous_service_hours<0 or previous_service_hours>initial_hours then raise exception 'Invalid hour meter values'; end if;
  if asset_model_year is not null and asset_model_year not between 1950 and 2100 then raise exception 'Invalid model year'; end if;
  insert into public.machine_assets(organization_id,establishment_id,display_name,kind,manufacturer,model,serial_number,model_year,current_hours,service_interval_hours,last_service_hours,created_by)
  values(target_org,target_establishment,trim(asset_name),asset_kind,nullif(trim(asset_manufacturer),''),nullif(trim(asset_model),''),nullif(trim(asset_serial_number),''),asset_model_year,initial_hours,maintenance_interval_hours,previous_service_hours,auth.uid())
  returning id into new_asset_id;
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
  values(target_org,target_establishment,'machine_asset',new_asset_id,'created',auth.uid(),jsonb_build_object('kind',asset_kind,'initial_hours',initial_hours));
  return new_asset_id;
end $$;

create function public.record_machine_event(
  target_machine uuid,
  event_name public.machine_event_type,
  occurred_at timestamptz,
  usage_hours numeric,
  event_notes text,
  request_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  asset_row public.machine_assets%rowtype;
  existing_event uuid;
  new_event_id uuid;
  next_hours numeric;
begin
  select * into asset_row from public.machine_assets where id=target_machine for update;
  if asset_row.id is null or not private.has_org_role(asset_row.organization_id,array['owner','admin','agronomist','operator']::public.organization_role[]) then raise exception 'Not authorized'; end if;
  if asset_row.status='retired' then raise exception 'Asset is retired'; end if;
  if request_id is null then raise exception 'Request ID is required'; end if;
  select id into existing_event from public.machine_events where organization_id=asset_row.organization_id and idempotency_key=request_id;
  if existing_event is not null then return existing_event; end if;
  if occurred_at is null or occurred_at>now()+interval '5 minutes' then raise exception 'Invalid event time'; end if;
  if event_notes is not null and char_length(event_notes)>1000 then raise exception 'Notes are too long'; end if;
  if event_name='usage' and usage_hours<=0 then raise exception 'Usage hours must be positive'; end if;
  if event_name<>'usage' and usage_hours<>0 then raise exception 'Only usage events accept hours'; end if;
  next_hours:=asset_row.current_hours+usage_hours;
  insert into public.machine_events(organization_id,establishment_id,machine_id,event_type,occurred_at,hours_delta,meter_hours,notes,idempotency_key,created_by)
  values(asset_row.organization_id,asset_row.establishment_id,asset_row.id,event_name,occurred_at,usage_hours,next_hours,nullif(trim(event_notes),''),request_id,auth.uid())
  returning id into new_event_id;
  update public.machine_assets set current_hours=next_hours,last_service_hours=case when event_name='service' then next_hours else last_service_hours end,status=case when event_name='repair' then 'maintenance' else 'active' end,updated_at=now() where id=asset_row.id;
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
  values(asset_row.organization_id,asset_row.establishment_id,'machine_event',new_event_id,'event_recorded',auth.uid(),jsonb_build_object('machine_id',asset_row.id,'event_type',event_name,'meter_hours',next_hours));
  return new_event_id;
end $$;

create function public.record_financial_entry(
  target_establishment uuid,
  target_parcel uuid,
  target_machine uuid,
  entry_direction public.financial_direction,
  entry_date date,
  entry_category text,
  entry_amount numeric,
  entry_currency text,
  entry_description text,
  entry_reference text,
  request_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare target_org uuid; parcel_establishment uuid; machine_establishment uuid; existing_entry uuid; new_entry_id uuid;
begin
  select organization_id into target_org from public.establishments where id=target_establishment;
  if target_org is null or not private.has_org_role(target_org,array['owner','admin']::public.organization_role[]) then raise exception 'Not authorized'; end if;
  if request_id is null then raise exception 'Request ID is required'; end if;
  select id into existing_entry from public.financial_entries where organization_id=target_org and idempotency_key=request_id;
  if existing_entry is not null then return existing_entry; end if;
  if entry_date is null or entry_date>current_date+1 then raise exception 'Invalid entry date'; end if;
  if char_length(trim(entry_category)) not between 2 and 80 then raise exception 'Invalid category'; end if;
  if entry_amount<=0 then raise exception 'Amount must be positive'; end if;
  entry_currency:=upper(trim(entry_currency));
  if entry_currency!~'^[A-Z]{3}$' then raise exception 'Invalid ISO currency code'; end if;
  if char_length(trim(entry_description)) not between 2 and 500 then raise exception 'Invalid description'; end if;
  if entry_reference is not null and char_length(entry_reference)>120 then raise exception 'Reference is too long'; end if;
  if target_parcel is not null then
    select establishment_id into parcel_establishment from public.land_parcels where id=target_parcel and organization_id=target_org;
    if parcel_establishment is distinct from target_establishment then raise exception 'Parcel does not belong to establishment'; end if;
  end if;
  if target_machine is not null then
    select establishment_id into machine_establishment from public.machine_assets where id=target_machine and organization_id=target_org;
    if machine_establishment is distinct from target_establishment then raise exception 'Machine does not belong to establishment'; end if;
  end if;
  insert into public.financial_entries(organization_id,establishment_id,parcel_id,machine_id,direction,occurred_on,category,amount,currency,description,reference,idempotency_key,created_by)
  values(target_org,target_establishment,target_parcel,target_machine,entry_direction,entry_date,trim(entry_category),entry_amount,entry_currency,trim(entry_description),nullif(trim(entry_reference),''),request_id,auth.uid())
  returning id into new_entry_id;
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
  values(target_org,target_establishment,'financial_entry',new_entry_id,'created',auth.uid(),jsonb_build_object('direction',entry_direction,'amount',entry_amount,'currency',entry_currency));
  return new_entry_id;
end $$;

create function public.reverse_financial_entry(target_entry uuid, reversal_reason text, request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare entry_row public.financial_entries%rowtype; existing_entry uuid; new_entry_id uuid;
begin
  select * into entry_row from public.financial_entries where id=target_entry;
  if entry_row.id is null or not private.has_org_role(entry_row.organization_id,array['owner','admin']::public.organization_role[]) then raise exception 'Not authorized'; end if;
  if entry_row.reversal_of is not null then raise exception 'A reversal cannot be reversed'; end if;
  if request_id is null then raise exception 'Request ID is required'; end if;
  select id into existing_entry from public.financial_entries where organization_id=entry_row.organization_id and idempotency_key=request_id;
  if existing_entry is not null then return existing_entry; end if;
  if exists(select 1 from public.financial_entries where reversal_of=entry_row.id) then raise exception 'Entry is already reversed'; end if;
  if char_length(trim(reversal_reason)) not between 2 and 300 then raise exception 'Reversal reason is required'; end if;
  insert into public.financial_entries(organization_id,establishment_id,parcel_id,machine_id,direction,occurred_on,category,amount,currency,description,reference,reversal_of,idempotency_key,created_by)
  values(entry_row.organization_id,entry_row.establishment_id,entry_row.parcel_id,entry_row.machine_id,case when entry_row.direction='income' then 'expense' else 'income' end,current_date,entry_row.category,entry_row.amount,entry_row.currency,'Reversión: '||trim(reversal_reason),entry_row.reference,entry_row.id,request_id,auth.uid())
  returning id into new_entry_id;
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
  values(entry_row.organization_id,entry_row.establishment_id,'financial_entry',new_entry_id,'reversed',auth.uid(),jsonb_build_object('reversal_of',entry_row.id,'reason',trim(reversal_reason)));
  return new_entry_id;
end $$;

revoke all on function public.create_livestock_group(uuid,uuid,text,text,text,integer,numeric,timestamptz,text,uuid) from public,anon;
revoke all on function public.record_livestock_event(uuid,public.livestock_event_type,timestamptz,integer,numeric,text,uuid) from public,anon;
revoke all on function public.create_machine_asset(uuid,text,text,text,text,text,integer,numeric,numeric,numeric) from public,anon;
revoke all on function public.record_machine_event(uuid,public.machine_event_type,timestamptz,numeric,text,uuid) from public,anon;
revoke all on function public.record_financial_entry(uuid,uuid,uuid,public.financial_direction,date,text,numeric,text,text,text,uuid) from public,anon;
revoke all on function public.reverse_financial_entry(uuid,text,uuid) from public,anon;
grant execute on function public.create_livestock_group(uuid,uuid,text,text,text,integer,numeric,timestamptz,text,uuid) to authenticated;
grant execute on function public.record_livestock_event(uuid,public.livestock_event_type,timestamptz,integer,numeric,text,uuid) to authenticated;
grant execute on function public.create_machine_asset(uuid,text,text,text,text,text,integer,numeric,numeric,numeric) to authenticated;
grant execute on function public.record_machine_event(uuid,public.machine_event_type,timestamptz,numeric,text,uuid) to authenticated;
grant execute on function public.record_financial_entry(uuid,uuid,uuid,public.financial_direction,date,text,numeric,text,text,text,uuid) to authenticated;
grant execute on function public.reverse_financial_entry(uuid,text,uuid) to authenticated;

create view public.operational_summary
with (security_invoker = true) as
select
  establishment.id as establishment_id,
  establishment.organization_id,
  coalesce((select sum(group_record.head_count) from public.livestock_groups group_record where group_record.establishment_id=establishment.id and group_record.status='active'),0)::bigint as livestock_heads,
  (select count(*) from public.livestock_groups group_record where group_record.establishment_id=establishment.id and group_record.status='active')::integer as active_livestock_groups,
  (select count(*) from public.machine_assets asset where asset.establishment_id=establishment.id and asset.status<>'retired')::integer as active_machines,
  (select count(*) from public.machine_assets asset where asset.establishment_id=establishment.id and asset.status<>'retired' and asset.current_hours>=asset.last_service_hours+asset.service_interval_hours)::integer as maintenance_due,
  coalesce((select sum(entry.amount) from public.financial_entries entry where entry.establishment_id=establishment.id and entry.direction='income' and date_trunc('month',entry.occurred_on::timestamp)=date_trunc('month',current_date::timestamp)),0) as month_income,
  coalesce((select sum(entry.amount) from public.financial_entries entry where entry.establishment_id=establishment.id and entry.direction='expense' and date_trunc('month',entry.occurred_on::timestamp)=date_trunc('month',current_date::timestamp)),0) as month_expense,
  (select max(event.occurred_at) from public.livestock_events event where event.establishment_id=establishment.id) as last_livestock_event_at,
  (select max(event.occurred_at) from public.machine_events event where event.establishment_id=establishment.id) as last_machine_event_at,
  (select max(entry.created_at) from public.financial_entries entry where entry.establishment_id=establishment.id) as last_financial_entry_at
from public.establishments establishment;

revoke all on public.operational_summary from public,anon,authenticated;
grant select on public.operational_summary to authenticated;

comment on table public.financial_entries is 'Append-only operational ledger. Corrections are opposite-direction entries linked through reversal_of.';
comment on table public.operational_audit_events is 'Server-owned audit trail for operational mutations; browser roles cannot insert, update or delete it.';
comment on view public.operational_summary is 'Tenant-scoped operational KPIs; security_invoker keeps underlying RLS authoritative.';

create type public.pilot_program_status as enum ('active','completed','cancelled');
create type public.pilot_snapshot_type as enum ('baseline','current','final');
create type public.pilot_value_category as enum ('avoided_downtime','maintenance_saving','input_saving','yield_protection','labor_saving','other');
create type public.pilot_claim_status as enum ('declared','internally_verified','rejected');

create table public.pilot_programs(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 3 and 120),
  hypothesis text not null check (char_length(trim(hypothesis)) between 20 and 1000),
  success_definition text not null check (char_length(trim(success_definition)) between 20 and 1000),
  status public.pilot_program_status not null default 'active',
  started_on date not null,
  target_end_on date not null,
  baseline_window_days smallint not null check (baseline_window_days between 7 and 90),
  activated_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,request_id),
  check(target_end_on>started_on),
  check((status='completed' and completed_at is not null and cancelled_at is null) or
        (status='cancelled' and cancelled_at is not null and completed_at is null) or
        (status='active' and completed_at is null and cancelled_at is null))
);

create unique index pilot_programs_one_active_establishment_idx
  on public.pilot_programs(establishment_id) where status='active';
create index pilot_programs_org_time_idx on public.pilot_programs(organization_id,created_at desc);

create table public.pilot_snapshots(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  program_id uuid not null references public.pilot_programs(id) on delete cascade,
  snapshot_type public.pilot_snapshot_type not null,
  window_start_on date not null,
  window_end_on date not null,
  metrics jsonb not null check (jsonb_typeof(metrics)='object' and octet_length(metrics::text)<=32768),
  limitations jsonb not null check (jsonb_typeof(limitations)='array' and octet_length(limitations::text)<=8192),
  source_version text not null check (char_length(source_version) between 3 and 80),
  captured_by uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  captured_at timestamptz not null default now(),
  unique(organization_id,request_id),
  unique(program_id,snapshot_type,window_end_on),
  check(window_end_on>=window_start_on)
);

create index pilot_snapshots_program_time_idx on public.pilot_snapshots(program_id,captured_at desc);

create table public.pilot_value_claims(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  program_id uuid not null references public.pilot_programs(id) on delete cascade,
  category public.pilot_value_category not null,
  amount numeric(16,2) not null check (amount>0 and amount<=100000000000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  calculation_method text not null check (char_length(trim(calculation_method)) between 20 and 1500),
  evidence_reference text not null check (char_length(trim(evidence_reference)) between 5 and 500),
  status public.pilot_claim_status not null default 'declared',
  claimed_by uuid not null references auth.users(id) on delete restrict,
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note)<=1000),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,request_id),
  check((status='declared' and reviewed_by is null and reviewed_at is null) or
        (status in ('internally_verified','rejected') and reviewed_by is not null and reviewed_at is not null))
);

create index pilot_value_claims_program_time_idx on public.pilot_value_claims(program_id,created_at desc);

create table public.pilot_audit_events(
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  program_id uuid not null references public.pilot_programs(id) on delete cascade,
  entity_type text not null check(entity_type in ('pilot_program','pilot_snapshot','pilot_value_claim')),
  entity_id uuid not null,
  action text not null check(action in ('launched','snapshot_captured','status_changed','value_declared','value_reviewed')),
  actor_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object' and octet_length(details::text)<=8192),
  created_at timestamptz not null default now()
);

create index pilot_audit_events_program_time_idx on public.pilot_audit_events(program_id,created_at desc);

alter table public.pilot_programs enable row level security;
alter table public.pilot_snapshots enable row level security;
alter table public.pilot_value_claims enable row level security;
alter table public.pilot_audit_events enable row level security;

revoke all on public.pilot_programs,public.pilot_snapshots,public.pilot_value_claims,public.pilot_audit_events from public,anon,authenticated;
grant select on public.pilot_programs,public.pilot_snapshots,public.pilot_value_claims to authenticated;
grant select on public.pilot_audit_events to authenticated;

create policy pilot_programs_member_select on public.pilot_programs for select to authenticated using(private.is_org_member(organization_id));
create policy pilot_snapshots_member_select on public.pilot_snapshots for select to authenticated using(private.is_org_member(organization_id));
create policy pilot_value_claims_member_select on public.pilot_value_claims for select to authenticated using(private.is_org_member(organization_id));
create policy pilot_audit_manager_select on public.pilot_audit_events for select to authenticated using(private.has_org_role(organization_id,array['owner','admin']::public.organization_role[]));

create or replace function private.build_pilot_metrics(target_establishment uuid, window_start date, window_end date)
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  establishment_row public.establishments%rowtype;
  range_start timestamptz;
  range_end timestamptz;
  result jsonb;
begin
  select * into establishment_row from public.establishments where id=target_establishment;
  if not found then raise exception 'establishment_not_found'; end if;
  if window_end<window_start then raise exception 'invalid_measurement_window'; end if;
  range_start:=window_start::timestamp at time zone establishment_row.timezone;
  range_end:=(window_end+1)::timestamp at time zone establishment_row.timezone;

  select jsonb_build_object(
    'monitored_hectares',jsonb_build_object('value',coalesce((select round(sum(parcel.area_hectares)::numeric,2) from public.land_parcels parcel where parcel.establishment_id=target_establishment),0),'unit','ha','source','land_parcels.current','windowed',false),
    'parcels_count',jsonb_build_object('value',(select count(*) from public.land_parcels parcel where parcel.establishment_id=target_establishment),'unit','count','source','land_parcels.current','windowed',false),
    'reporting_devices',jsonb_build_object('value',(select count(distinct reading.device_id) from public.sensor_readings reading join public.devices device on device.id=reading.device_id where device.establishment_id=target_establishment and reading.observed_at>=range_start and reading.observed_at<range_end),'unit','count','source','sensor_readings.observed_at','windowed',true),
    'sensor_readings',jsonb_build_object('value',(select count(*) from public.sensor_readings reading join public.devices device on device.id=reading.device_id where device.establishment_id=target_establishment and reading.observed_at>=range_start and reading.observed_at<range_end),'unit','count','source','sensor_readings.observed_at','windowed',true),
    'scouting_visits_created',jsonb_build_object('value',(select count(*) from public.scouting_visits visit where visit.establishment_id=target_establishment and visit.created_at>=range_start and visit.created_at<range_end),'unit','count','source','scouting_visits.created_at','windowed',true),
    'scouting_visits_completed',jsonb_build_object('value',(select count(*) from public.scouting_visits visit where visit.establishment_id=target_establishment and visit.completed_at>=range_start and visit.completed_at<range_end),'unit','count','source','scouting_visits.completed_at','windowed',true),
    'scouting_cycle_hours',jsonb_build_object('value',(select round(avg(extract(epoch from (visit.completed_at-visit.created_at))/3600)::numeric,2) from public.scouting_visits visit where visit.establishment_id=target_establishment and visit.completed_at>=range_start and visit.completed_at<range_end),'unit','hours','source','scouting_visits.completed_at-created_at','windowed',true),
    'field_findings',jsonb_build_object('value',(select count(*) from public.scouting_findings finding where finding.establishment_id=target_establishment and finding.observed_at>=range_start and finding.observed_at<range_end),'unit','count','source','scouting_findings.observed_at','windowed',true),
    'evidence_photos',jsonb_build_object('value',(select count(*) from public.scouting_finding_media media where media.establishment_id=target_establishment and media.captured_at>=range_start and media.captured_at<range_end),'unit','count','source','scouting_finding_media.captured_at','windowed',true),
    'work_orders_opened',jsonb_build_object('value',(select count(*) from public.maintenance_work_orders work_order where work_order.establishment_id=target_establishment and work_order.opened_at>=range_start and work_order.opened_at<range_end),'unit','count','source','maintenance_work_orders.opened_at','windowed',true),
    'work_orders_completed',jsonb_build_object('value',(select count(*) from public.maintenance_work_orders work_order where work_order.establishment_id=target_establishment and work_order.completed_at>=range_start and work_order.completed_at<range_end),'unit','count','source','maintenance_work_orders.completed_at','windowed',true),
    'preventive_orders_completed',jsonb_build_object('value',(select count(*) from public.maintenance_work_orders work_order where work_order.establishment_id=target_establishment and work_order.work_type='preventive' and work_order.completed_at>=range_start and work_order.completed_at<range_end),'unit','count','source','maintenance_work_orders.completed_at','windowed',true),
    'maintenance_cost',jsonb_build_object('value',coalesce((select round(sum(work_order.actual_cost),2) from public.maintenance_work_orders work_order where work_order.establishment_id=target_establishment and work_order.status='completed' and work_order.currency=establishment_row.base_currency and work_order.completed_at>=range_start and work_order.completed_at<range_end),0),'unit',establishment_row.base_currency,'source','maintenance_work_orders.actual_cost','windowed',true),
    'operating_expense',jsonb_build_object('value',coalesce((select round(sum(entry.amount),2) from public.financial_entries entry where entry.establishment_id=target_establishment and entry.currency=establishment_row.base_currency and entry.direction='expense' and entry.occurred_on between window_start and window_end),0),'unit',establishment_row.base_currency,'source','financial_entries.occurred_on','windowed',true),
    'operating_income',jsonb_build_object('value',coalesce((select round(sum(entry.amount),2) from public.financial_entries entry where entry.establishment_id=target_establishment and entry.currency=establishment_row.base_currency and entry.direction='income' and entry.occurred_on between window_start and window_end),0),'unit',establishment_row.base_currency,'source','financial_entries.occurred_on','windowed',true)
  ) into result;
  return result;
end
$$;

create or replace function private.pilot_limitations()
returns jsonb language sql immutable security definer set search_path=''
as $$ select jsonb_build_array(
  'Las métricas describen registros persistidos; no demuestran causalidad ni atribuyen por sí solas un resultado a NODO.',
  'Hectáreas y lotes representan el inventario actual, no una reconstrucción histórica de la ventana.',
  'Costos e ingresos incluyen sólo asientos en la moneda base y dependen de la completitud del libro operativo.',
  'Ceros pueden significar ausencia real o una fuente aún no instrumentada; deben interpretarse junto con la cobertura de datos.'
) $$;

revoke all on function private.build_pilot_metrics(uuid,date,date) from public,anon,authenticated;
revoke all on function private.pilot_limitations() from public,anon,authenticated;

create or replace function public.launch_pilot_program(
  target_establishment uuid,
  program_name text,
  program_hypothesis text,
  program_success_definition text,
  target_end date,
  baseline_days integer,
  request_id uuid
)
returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  actor_user uuid:=auth.uid();
  establishment_row public.establishments%rowtype;
  actor_role public.organization_role;
  local_start date;
  program_id uuid;
begin
  if actor_user is null then raise exception 'authentication_required'; end if;
  select * into establishment_row from public.establishments where id=target_establishment;
  if not found then raise exception 'establishment_not_found'; end if;
  actor_role:=private.team_actor_role(establishment_row.organization_id,actor_user);
  if actor_role is null or actor_role not in ('owner','admin') then raise exception 'insufficient_role'; end if;
  local_start:=(now() at time zone establishment_row.timezone)::date;
  if target_end<local_start+7 or target_end>local_start+365 then raise exception 'invalid_target_end'; end if;
  if baseline_days not between 7 and 90 then raise exception 'invalid_baseline_window'; end if;
  if char_length(trim(program_name)) not between 3 and 120 or char_length(trim(program_hypothesis)) not between 20 and 1000 or char_length(trim(program_success_definition)) not between 20 and 1000 then raise exception 'invalid_program_text'; end if;

  select program.id into program_id from public.pilot_programs program where program.organization_id=establishment_row.organization_id and program.request_id=launch_pilot_program.request_id;
  if program_id is not null then return program_id; end if;
  if exists(select 1 from public.pilot_programs where establishment_id=target_establishment and status='active') then raise exception 'active_pilot_exists'; end if;

  insert into public.pilot_programs(organization_id,establishment_id,name,hypothesis,success_definition,started_on,target_end_on,baseline_window_days,created_by,updated_by,request_id)
  values(establishment_row.organization_id,target_establishment,trim(program_name),trim(program_hypothesis),trim(program_success_definition),local_start,target_end,baseline_days,actor_user,actor_user,request_id)
  returning id into program_id;
  insert into public.pilot_snapshots(organization_id,establishment_id,program_id,snapshot_type,window_start_on,window_end_on,metrics,limitations,source_version,captured_by,request_id)
  values(establishment_row.organization_id,target_establishment,program_id,'baseline',local_start-baseline_days,local_start-1,private.build_pilot_metrics(target_establishment,local_start-baseline_days,local_start-1),private.pilot_limitations(),'pilot-metrics-v1',actor_user,gen_random_uuid());
  insert into public.pilot_audit_events(organization_id,establishment_id,program_id,entity_type,entity_id,action,actor_user_id,details)
  values(establishment_row.organization_id,target_establishment,program_id,'pilot_program',program_id,'launched',actor_user,jsonb_build_object('baseline_days',baseline_days,'target_end_on',target_end));
  return program_id;
end
$$;

create or replace function public.capture_pilot_snapshot(target_program uuid, request_id uuid)
returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  actor_user uuid:=auth.uid();
  program_row public.pilot_programs%rowtype;
  establishment_row public.establishments%rowtype;
  actor_role public.organization_role;
  window_end date;
  snapshot_id uuid;
begin
  if actor_user is null then raise exception 'authentication_required'; end if;
  select * into program_row from public.pilot_programs where id=target_program for update;
  if not found then raise exception 'pilot_not_found'; end if;
  if program_row.status<>'active' then raise exception 'pilot_not_active'; end if;
  actor_role:=private.team_actor_role(program_row.organization_id,actor_user);
  if actor_role is null or actor_role not in ('owner','admin','agronomist') then raise exception 'insufficient_role'; end if;
  select * into establishment_row from public.establishments where id=program_row.establishment_id;
  window_end:=(now() at time zone establishment_row.timezone)::date;
  select snapshot.id into snapshot_id from public.pilot_snapshots snapshot where snapshot.organization_id=program_row.organization_id and snapshot.request_id=capture_pilot_snapshot.request_id;
  if snapshot_id is not null then return snapshot_id; end if;
  select id into snapshot_id from public.pilot_snapshots where program_id=target_program and snapshot_type='current' and window_end_on=window_end;
  if snapshot_id is not null then return snapshot_id; end if;

  insert into public.pilot_snapshots(organization_id,establishment_id,program_id,snapshot_type,window_start_on,window_end_on,metrics,limitations,source_version,captured_by,request_id)
  values(program_row.organization_id,program_row.establishment_id,program_row.id,'current',program_row.started_on,window_end,private.build_pilot_metrics(program_row.establishment_id,program_row.started_on,window_end),private.pilot_limitations(),'pilot-metrics-v1',actor_user,request_id)
  returning id into snapshot_id;
  insert into public.pilot_audit_events(organization_id,establishment_id,program_id,entity_type,entity_id,action,actor_user_id,details)
  values(program_row.organization_id,program_row.establishment_id,program_row.id,'pilot_snapshot',snapshot_id,'snapshot_captured',actor_user,jsonb_build_object('snapshot_type','current','window_end_on',window_end));
  return snapshot_id;
end
$$;

create or replace function public.transition_pilot_program(target_program uuid, next_status public.pilot_program_status, closing_note text, request_id uuid)
returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  actor_user uuid:=auth.uid();
  program_row public.pilot_programs%rowtype;
  establishment_row public.establishments%rowtype;
  actor_role public.organization_role;
  local_end date;
  snapshot_id uuid;
begin
  if actor_user is null then raise exception 'authentication_required'; end if;
  select * into program_row from public.pilot_programs where id=target_program for update;
  if not found then raise exception 'pilot_not_found'; end if;
  if program_row.status<>'active' or next_status not in ('completed','cancelled') then raise exception 'invalid_pilot_transition'; end if;
  if closing_note is null or char_length(trim(closing_note)) not between 10 and 1000 then raise exception 'closing_note_required'; end if;
  actor_role:=private.team_actor_role(program_row.organization_id,actor_user);
  if actor_role is null or actor_role not in ('owner','admin') then raise exception 'insufficient_role'; end if;
  select * into establishment_row from public.establishments where id=program_row.establishment_id;
  local_end:=(now() at time zone establishment_row.timezone)::date;

  if next_status='completed' then
    insert into public.pilot_snapshots(organization_id,establishment_id,program_id,snapshot_type,window_start_on,window_end_on,metrics,limitations,source_version,captured_by,request_id)
    values(program_row.organization_id,program_row.establishment_id,program_row.id,'final',program_row.started_on,local_end,private.build_pilot_metrics(program_row.establishment_id,program_row.started_on,local_end),private.pilot_limitations(),'pilot-metrics-v1',actor_user,request_id)
    on conflict(program_id,snapshot_type,window_end_on) do nothing returning id into snapshot_id;
  end if;
  update public.pilot_programs set status=next_status,completed_at=case when next_status='completed' then now() else null end,cancelled_at=case when next_status='cancelled' then now() else null end,updated_by=actor_user,updated_at=now() where id=target_program;
  insert into public.pilot_audit_events(organization_id,establishment_id,program_id,entity_type,entity_id,action,actor_user_id,details)
  values(program_row.organization_id,program_row.establishment_id,program_row.id,'pilot_program',program_row.id,'status_changed',actor_user,jsonb_build_object('previous_status',program_row.status,'next_status',next_status,'closing_note',trim(closing_note),'final_snapshot_id',snapshot_id));
  return program_row.id;
end
$$;

create or replace function public.record_pilot_value_claim(
  target_program uuid,
  value_category public.pilot_value_category,
  value_amount numeric,
  value_calculation_method text,
  value_evidence_reference text,
  request_id uuid
)
returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  actor_user uuid:=auth.uid();
  program_row public.pilot_programs%rowtype;
  establishment_row public.establishments%rowtype;
  actor_role public.organization_role;
  claim_id uuid;
begin
  if actor_user is null then raise exception 'authentication_required'; end if;
  select * into program_row from public.pilot_programs where id=target_program;
  if not found then raise exception 'pilot_not_found'; end if;
  actor_role:=private.team_actor_role(program_row.organization_id,actor_user);
  if actor_role is null or actor_role not in ('owner','admin') then raise exception 'insufficient_role'; end if;
  if value_amount<=0 or value_amount>100000000000000 then raise exception 'invalid_value_amount'; end if;
  if char_length(trim(value_calculation_method)) not between 20 and 1500 or char_length(trim(value_evidence_reference)) not between 5 and 500 then raise exception 'insufficient_value_evidence'; end if;
  select * into establishment_row from public.establishments where id=program_row.establishment_id;
  select claim.id into claim_id from public.pilot_value_claims claim where claim.organization_id=program_row.organization_id and claim.request_id=record_pilot_value_claim.request_id;
  if claim_id is not null then return claim_id; end if;

  insert into public.pilot_value_claims(organization_id,establishment_id,program_id,category,amount,currency,calculation_method,evidence_reference,claimed_by,request_id)
  values(program_row.organization_id,program_row.establishment_id,program_row.id,value_category,value_amount,establishment_row.base_currency,trim(value_calculation_method),trim(value_evidence_reference),actor_user,request_id)
  returning id into claim_id;
  insert into public.pilot_audit_events(organization_id,establishment_id,program_id,entity_type,entity_id,action,actor_user_id,details)
  values(program_row.organization_id,program_row.establishment_id,program_row.id,'pilot_value_claim',claim_id,'value_declared',actor_user,jsonb_build_object('category',value_category,'amount',value_amount,'currency',establishment_row.base_currency));
  return claim_id;
end
$$;

create or replace function public.review_pilot_value_claim(target_claim uuid, accepted boolean, reviewer_note text, request_id uuid)
returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  actor_user uuid:=auth.uid();
  claim_row public.pilot_value_claims%rowtype;
  actor_role public.organization_role;
  next_status public.pilot_claim_status;
begin
  if actor_user is null then raise exception 'authentication_required'; end if;
  select * into claim_row from public.pilot_value_claims where id=target_claim for update;
  if not found then raise exception 'claim_not_found'; end if;
  if claim_row.status<>'declared' then raise exception 'claim_already_reviewed'; end if;
  actor_role:=private.team_actor_role(claim_row.organization_id,actor_user);
  if actor_role is null or actor_role not in ('owner','admin') then raise exception 'insufficient_role'; end if;
  if accepted and claim_row.claimed_by=actor_user then raise exception 'independent_reviewer_required'; end if;
  if reviewer_note is null or char_length(trim(reviewer_note)) not between 10 and 1000 then raise exception 'review_note_required'; end if;
  next_status:=case when accepted then 'internally_verified'::public.pilot_claim_status else 'rejected'::public.pilot_claim_status end;
  update public.pilot_value_claims set status=next_status,reviewed_by=actor_user,reviewed_at=now(),review_note=trim(reviewer_note),updated_at=now() where id=target_claim;
  insert into public.pilot_audit_events(organization_id,establishment_id,program_id,entity_type,entity_id,action,actor_user_id,details)
  values(claim_row.organization_id,claim_row.establishment_id,claim_row.program_id,'pilot_value_claim',claim_row.id,'value_reviewed',actor_user,jsonb_build_object('status',next_status,'review_note',trim(reviewer_note),'request_id',request_id));
  return claim_row.id;
end
$$;

revoke all on function public.launch_pilot_program(uuid,text,text,text,date,integer,uuid) from public,anon;
revoke all on function public.capture_pilot_snapshot(uuid,uuid) from public,anon;
revoke all on function public.transition_pilot_program(uuid,public.pilot_program_status,text,uuid) from public,anon;
revoke all on function public.record_pilot_value_claim(uuid,public.pilot_value_category,numeric,text,text,uuid) from public,anon;
revoke all on function public.review_pilot_value_claim(uuid,boolean,text,uuid) from public,anon;
grant execute on function public.launch_pilot_program(uuid,text,text,text,date,integer,uuid) to authenticated;
grant execute on function public.capture_pilot_snapshot(uuid,uuid) to authenticated;
grant execute on function public.transition_pilot_program(uuid,public.pilot_program_status,text,uuid) to authenticated;
grant execute on function public.record_pilot_value_claim(uuid,public.pilot_value_category,numeric,text,text,uuid) to authenticated;
grant execute on function public.review_pilot_value_claim(uuid,boolean,text,uuid) to authenticated;

comment on table public.pilot_snapshots is 'Immutable evidence snapshots calculated from tenant-scoped persisted operations. Metrics describe records and never prove causality.';
comment on table public.pilot_value_claims is 'Economic value ledger separating declarations, internal two-person review, and rejection. Internal verification is not external validation.';
comment on function public.launch_pilot_program(uuid,text,text,text,date,integer,uuid) is 'Launches one active pilot per establishment and locks an automatic pre-pilot baseline in the same transaction.';

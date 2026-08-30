create type public.scouting_visit_status as enum ('planned','in_progress','completed','cancelled');
create type public.scouting_priority as enum ('low','medium','high','critical');
create type public.scouting_source_type as enum ('manual','satellite_ndvi','satellite_ndmi','weather','iot');
create type public.scouting_finding_category as enum ('crop_condition','pest_signal','water','soil','infrastructure','other');
create type public.scouting_severity as enum ('info','low','medium','high','critical');

alter table public.operational_audit_events drop constraint if exists operational_audit_events_entity_type_check;
alter table public.operational_audit_events add constraint operational_audit_events_entity_type_check
  check (entity_type in ('livestock_group','livestock_event','machine_asset','machine_event','financial_entry','maintenance_work_order','scouting_visit','scouting_finding'));
alter table public.operational_audit_events drop constraint if exists operational_audit_events_action_check;
alter table public.operational_audit_events add constraint operational_audit_events_action_check
  check (action in ('created','event_recorded','reversed','status_changed','finding_recorded'));

create table public.scouting_visits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  parcel_id uuid not null references public.land_parcels(id) on delete restrict,
  source_type public.scouting_source_type not null default 'manual',
  source_metric_id uuid references public.parcel_satellite_metrics(id) on delete restrict,
  source_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(source_snapshot)='object' and octet_length(source_snapshot::text)<=8192),
  title text not null check (char_length(trim(title)) between 2 and 160),
  objective text check (objective is null or char_length(objective)<=1500),
  priority public.scouting_priority not null default 'medium',
  status public.scouting_visit_status not null default 'planned',
  scheduled_for timestamptz not null,
  assigned_to uuid references auth.users(id) on delete set null,
  summary text check (summary is null or char_length(summary)<=1500),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  lock_version integer not null default 1 check (lock_version>0),
  idempotency_key uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,idempotency_key),
  check ((status='completed' and completed_at is not null and cancelled_at is null) or
         (status='cancelled' and cancelled_at is not null and completed_at is null) or
         (status in ('planned','in_progress') and completed_at is null and cancelled_at is null)),
  check (status<>'in_progress' or started_at is not null)
);

create table public.scouting_visit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  visit_id uuid not null references public.scouting_visits(id) on delete restrict,
  action text not null check (action in ('created','status_changed')),
  previous_status public.scouting_visit_status,
  next_status public.scouting_visit_status not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object' and octet_length(details::text)<=8192),
  idempotency_key uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id,idempotency_key)
);

create table public.scouting_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  parcel_id uuid not null references public.land_parcels(id) on delete restrict,
  visit_id uuid not null references public.scouting_visits(id) on delete restrict,
  category public.scouting_finding_category not null,
  severity public.scouting_severity not null,
  observed_at timestamptz not null,
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  notes text not null check (char_length(trim(notes)) between 2 and 2000),
  idempotency_key uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id,idempotency_key),
  check ((latitude is null and longitude is null and accuracy_m is null) or
         (latitude is not null and longitude is not null and accuracy_m is not null and
          latitude between -90 and 90 and longitude between -180 and 180 and accuracy_m between 0 and 10000))
);

create index scouting_visits_establishment_status_time_idx on public.scouting_visits(establishment_id,status,scheduled_for);
create index scouting_visits_parcel_time_idx on public.scouting_visits(parcel_id,created_at desc);
create index scouting_visit_events_visit_time_idx on public.scouting_visit_events(visit_id,created_at desc);
create index scouting_findings_visit_time_idx on public.scouting_findings(visit_id,observed_at desc);

create function private.validate_scouting_scope() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  parcel_scope record;
  metric_scope record;
  visit_scope record;
begin
  if tg_table_name='scouting_visits' then
    select organization_id,establishment_id into parcel_scope from public.land_parcels where id=new.parcel_id;
    if parcel_scope.organization_id is distinct from new.organization_id or parcel_scope.establishment_id is distinct from new.establishment_id then
      raise exception 'Parcel does not belong to scouting scope';
    end if;
    if new.source_metric_id is not null then
      select organization_id,establishment_id,parcel_id,index_name into metric_scope from public.parcel_satellite_metrics where id=new.source_metric_id;
      if metric_scope.organization_id is distinct from new.organization_id or metric_scope.establishment_id is distinct from new.establishment_id
         or metric_scope.parcel_id is distinct from new.parcel_id or new.source_type::text is distinct from 'satellite_'||metric_scope.index_name then
        raise exception 'Satellite metric does not belong to scouting scope';
      end if;
    elsif new.source_type<>'manual' then
      raise exception 'Non-manual visit requires a source reference';
    end if;
    if new.assigned_to is not null and not exists(
      select 1 from public.organization_members member where member.organization_id=new.organization_id and member.user_id=new.assigned_to
    ) then raise exception 'Assignee is not an organization member'; end if;
  elsif tg_table_name='scouting_findings' then
    select organization_id,establishment_id,parcel_id into visit_scope from public.scouting_visits where id=new.visit_id;
    if visit_scope.organization_id is distinct from new.organization_id or visit_scope.establishment_id is distinct from new.establishment_id
       or visit_scope.parcel_id is distinct from new.parcel_id then raise exception 'Finding does not belong to visit scope'; end if;
  elsif tg_table_name='scouting_visit_events' then
    select organization_id,establishment_id into visit_scope from public.scouting_visits where id=new.visit_id;
    if visit_scope.organization_id is distinct from new.organization_id or visit_scope.establishment_id is distinct from new.establishment_id then
      raise exception 'Visit event does not belong to scouting scope';
    end if;
  end if;
  return new;
end $$;

create trigger scouting_visits_scope_guard before insert or update on public.scouting_visits
  for each row execute function private.validate_scouting_scope();
create trigger scouting_visit_events_scope_guard before insert or update on public.scouting_visit_events
  for each row execute function private.validate_scouting_scope();
create trigger scouting_findings_scope_guard before insert or update on public.scouting_findings
  for each row execute function private.validate_scouting_scope();

alter table public.scouting_visits enable row level security;
alter table public.scouting_visit_events enable row level security;
alter table public.scouting_findings enable row level security;

revoke all on public.scouting_visits,public.scouting_visit_events,public.scouting_findings from public,anon,authenticated;
grant select on public.scouting_visits,public.scouting_visit_events,public.scouting_findings to authenticated;

create policy scouting_visits_select on public.scouting_visits for select to authenticated using (private.is_org_member(organization_id));
create policy scouting_visit_events_select on public.scouting_visit_events for select to authenticated using (private.is_org_member(organization_id));
create policy scouting_findings_select on public.scouting_findings for select to authenticated using (private.is_org_member(organization_id));

create function public.create_scouting_visit(
  target_establishment uuid,
  target_parcel uuid,
  target_source_metric uuid,
  visit_title text,
  visit_objective text,
  visit_priority public.scouting_priority,
  visit_scheduled_for timestamptz,
  request_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  target_org uuid;
  parcel_scope record;
  metric_scope public.parcel_satellite_metrics%rowtype;
  source_kind public.scouting_source_type:='manual'::public.scouting_source_type;
  source_data jsonb:='{}'::jsonb;
  existing_visit uuid;
  new_visit uuid;
begin
  select organization_id into target_org from public.establishments where id=target_establishment;
  if target_org is null or not private.has_org_role(target_org,array['owner','admin','agronomist','operator']::public.organization_role[]) then raise exception 'Not authorized'; end if;
  if request_id is null then raise exception 'Request ID is required'; end if;
  select id into existing_visit from public.scouting_visits where organization_id=target_org and idempotency_key=request_id;
  if existing_visit is not null then return existing_visit; end if;
  select organization_id,establishment_id into parcel_scope from public.land_parcels where id=target_parcel;
  if parcel_scope.organization_id is distinct from target_org or parcel_scope.establishment_id is distinct from target_establishment then raise exception 'Invalid parcel'; end if;
  if char_length(trim(visit_title)) not between 2 and 160 then raise exception 'Invalid visit title'; end if;
  if visit_objective is not null and char_length(visit_objective)>1500 then raise exception 'Objective is too long'; end if;
  if visit_scheduled_for is null or visit_scheduled_for<now()-interval '1 day' or visit_scheduled_for>now()+interval '1 year' then raise exception 'Invalid schedule'; end if;

  if target_source_metric is not null then
    select * into metric_scope from public.parcel_satellite_metrics where id=target_source_metric;
    if metric_scope.id is null or metric_scope.organization_id<>target_org or metric_scope.establishment_id<>target_establishment or metric_scope.parcel_id<>target_parcel then
      raise exception 'Invalid satellite source';
    end if;
    source_kind:=case metric_scope.index_name when 'ndvi' then 'satellite_ndvi'::public.scouting_source_type else 'satellite_ndmi'::public.scouting_source_type end;
    source_data:=jsonb_build_object('metric_id',metric_scope.id,'index_name',metric_scope.index_name,'mean_value',metric_scope.mean_value,
      'quality_status',metric_scope.quality_status,'captured_at',metric_scope.captured_at,'scene_id',metric_scope.satellite_scene_id,'algorithm_version',metric_scope.algorithm_version);
  end if;

  insert into public.scouting_visits(
    organization_id,establishment_id,parcel_id,source_type,source_metric_id,source_snapshot,title,objective,priority,scheduled_for,
    assigned_to,idempotency_key,created_by,updated_by
  ) values (
    target_org,target_establishment,target_parcel,source_kind,target_source_metric,source_data,trim(visit_title),nullif(trim(visit_objective),''),visit_priority,
    visit_scheduled_for,auth.uid(),request_id,auth.uid(),auth.uid()
  ) returning id into new_visit;
  insert into public.scouting_visit_events(organization_id,establishment_id,visit_id,action,next_status,details,idempotency_key,created_by)
    values(target_org,target_establishment,new_visit,'created','planned',jsonb_build_object('priority',visit_priority,'scheduled_for',visit_scheduled_for,'source_type',source_kind),request_id,auth.uid());
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
    values(target_org,target_establishment,'scouting_visit',new_visit,'created',auth.uid(),jsonb_build_object('parcel_id',target_parcel,'priority',visit_priority,'source_type',source_kind));
  return new_visit;
end $$;

create function public.transition_scouting_visit(
  target_visit uuid,
  next_state public.scouting_visit_status,
  closing_summary text,
  request_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  visit_row public.scouting_visits%rowtype;
  existing_event bigint;
  allowed boolean:=false;
begin
  select * into visit_row from public.scouting_visits where id=target_visit for update;
  if visit_row.id is null or not private.has_org_role(visit_row.organization_id,array['owner','admin','agronomist','operator']::public.organization_role[]) then raise exception 'Not authorized'; end if;
  if request_id is null then raise exception 'Request ID is required'; end if;
  select id into existing_event from public.scouting_visit_events where organization_id=visit_row.organization_id and idempotency_key=request_id;
  if existing_event is not null then return visit_row.id; end if;
  if visit_row.status in ('completed','cancelled') then raise exception 'Visit is closed'; end if;
  allowed:=(visit_row.status='planned' and next_state in ('in_progress','cancelled')) or
           (visit_row.status='in_progress' and next_state in ('completed','cancelled'));
  if not allowed then raise exception 'Invalid scouting transition'; end if;
  if next_state in ('completed','cancelled') and coalesce(char_length(trim(closing_summary)),0) not between 2 and 1500 then raise exception 'Closing summary is required'; end if;

  update public.scouting_visits set status=next_state,
    started_at=case when next_state='in_progress' then coalesce(started_at,now()) else started_at end,
    completed_at=case when next_state='completed' then now() else completed_at end,
    cancelled_at=case when next_state='cancelled' then now() else cancelled_at end,
    summary=case when next_state in ('completed','cancelled') then trim(closing_summary) else summary end,
    lock_version=lock_version+1,updated_by=auth.uid(),updated_at=now()
  where id=visit_row.id;
  insert into public.scouting_visit_events(organization_id,establishment_id,visit_id,action,previous_status,next_status,details,idempotency_key,created_by)
    values(visit_row.organization_id,visit_row.establishment_id,visit_row.id,'status_changed',visit_row.status,next_state,
      jsonb_strip_nulls(jsonb_build_object('summary',nullif(trim(closing_summary),''))),request_id,auth.uid());
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
    values(visit_row.organization_id,visit_row.establishment_id,'scouting_visit',visit_row.id,'status_changed',auth.uid(),jsonb_build_object('from',visit_row.status,'to',next_state,'parcel_id',visit_row.parcel_id));
  return visit_row.id;
end $$;

create function public.record_scouting_finding(
  target_visit uuid,
  finding_category public.scouting_finding_category,
  finding_severity public.scouting_severity,
  finding_observed_at timestamptz,
  finding_latitude double precision,
  finding_longitude double precision,
  finding_accuracy_m double precision,
  finding_notes text,
  request_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  visit_row public.scouting_visits%rowtype;
  existing_finding uuid;
  new_finding uuid;
begin
  select * into visit_row from public.scouting_visits where id=target_visit;
  if visit_row.id is null or not private.has_org_role(visit_row.organization_id,array['owner','admin','agronomist','operator']::public.organization_role[]) then raise exception 'Not authorized'; end if;
  if visit_row.status<>'in_progress' then raise exception 'Visit must be in progress'; end if;
  if request_id is null then raise exception 'Request ID is required'; end if;
  select id into existing_finding from public.scouting_findings where organization_id=visit_row.organization_id and idempotency_key=request_id;
  if existing_finding is not null then return existing_finding; end if;
  if finding_observed_at is null or finding_observed_at>now()+interval '5 minutes' or finding_observed_at<now()-interval '30 days' then raise exception 'Invalid observation time'; end if;
  if char_length(trim(finding_notes)) not between 2 and 2000 then raise exception 'Invalid finding notes'; end if;
  if (finding_latitude is null)<>(finding_longitude is null) or (finding_latitude is null)<>(finding_accuracy_m is null) then raise exception 'Incomplete location'; end if;
  if finding_latitude is not null and (finding_latitude not between -90 and 90 or finding_longitude not between -180 and 180 or finding_accuracy_m not between 0 and 10000) then raise exception 'Invalid location'; end if;

  insert into public.scouting_findings(organization_id,establishment_id,parcel_id,visit_id,category,severity,observed_at,latitude,longitude,accuracy_m,notes,idempotency_key,created_by)
    values(visit_row.organization_id,visit_row.establishment_id,visit_row.parcel_id,visit_row.id,finding_category,finding_severity,finding_observed_at,
      finding_latitude,finding_longitude,finding_accuracy_m,trim(finding_notes),request_id,auth.uid()) returning id into new_finding;
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
    values(visit_row.organization_id,visit_row.establishment_id,'scouting_finding',new_finding,'finding_recorded',auth.uid(),
      jsonb_build_object('visit_id',visit_row.id,'parcel_id',visit_row.parcel_id,'category',finding_category,'severity',finding_severity,'geolocated',finding_latitude is not null));
  return new_finding;
end $$;

revoke all on function private.validate_scouting_scope() from public,anon,authenticated;
revoke all on function public.create_scouting_visit(uuid,uuid,uuid,text,text,public.scouting_priority,timestamptz,uuid) from public,anon;
revoke all on function public.transition_scouting_visit(uuid,public.scouting_visit_status,text,uuid) from public,anon;
revoke all on function public.record_scouting_finding(uuid,public.scouting_finding_category,public.scouting_severity,timestamptz,double precision,double precision,double precision,text,uuid) from public,anon;
grant execute on function public.create_scouting_visit(uuid,uuid,uuid,text,text,public.scouting_priority,timestamptz,uuid) to authenticated;
grant execute on function public.transition_scouting_visit(uuid,public.scouting_visit_status,text,uuid) to authenticated;
grant execute on function public.record_scouting_finding(uuid,public.scouting_finding_category,public.scouting_severity,timestamptz,double precision,double precision,double precision,text,uuid) to authenticated;

comment on table public.scouting_visits is 'NODO Scout field visits linked to a parcel and optional immutable source snapshot.';
comment on table public.scouting_findings is 'Append-only field observations. Geolocation is optional and preserves device-reported accuracy.';
comment on function public.record_scouting_finding(uuid,public.scouting_finding_category,public.scouting_severity,timestamptz,double precision,double precision,double precision,text,uuid) is 'Records an idempotent field observation only while an authorized scouting visit is in progress.';

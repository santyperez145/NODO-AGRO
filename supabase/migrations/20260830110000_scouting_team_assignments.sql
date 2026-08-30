alter table public.scouting_visit_events drop constraint if exists scouting_visit_events_action_check;
alter table public.scouting_visit_events add constraint scouting_visit_events_action_check
  check (action in ('created','assigned','status_changed'));

alter table public.operational_audit_events drop constraint if exists operational_audit_events_action_check;
alter table public.operational_audit_events add constraint operational_audit_events_action_check
  check (action in ('created','event_recorded','reversed','status_changed','finding_recorded','media_attached','assignment_changed'));

create function private.can_operate_scouting_visit(target_organization uuid, assigned_user uuid, actor_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.organization_members member
    where member.organization_id=target_organization and member.user_id=actor_user
      and (member.role in ('owner','admin','agronomist') or (member.role='operator' and assigned_user=actor_user))
  )
$$;

create or replace function private.validate_scouting_media_scope() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  finding_scope record;
begin
  select finding.organization_id,finding.establishment_id,finding.parcel_id,finding.visit_id,visit.assigned_to
    into finding_scope
  from public.scouting_findings finding
  join public.scouting_visits visit on visit.id=finding.visit_id
  where finding.id=new.finding_id;
  if finding_scope.organization_id is distinct from new.organization_id
     or finding_scope.establishment_id is distinct from new.establishment_id
     or finding_scope.parcel_id is distinct from new.parcel_id
     or finding_scope.visit_id is distinct from new.visit_id then
    raise exception 'Media does not belong to finding scope';
  end if;
  if not private.can_operate_scouting_visit(new.organization_id,finding_scope.assigned_to,new.created_by) then
    raise exception 'Actor is not authorized for this visit';
  end if;
  return new;
end $$;

create function public.list_scouting_assignees(target_establishment uuid)
returns table(user_id uuid, display_name text, member_role public.organization_role)
language sql stable security definer set search_path='' as $$
  select member.user_id,
    coalesce(
      nullif(trim(account.raw_user_meta_data->>'full_name'),''),
      nullif(trim(account.raw_user_meta_data->>'name'),''),
      nullif(split_part(account.email,'@',1),''),
      'Miembro'
    ) as display_name,
    member.role
  from public.establishments establishment
  join public.organization_members member on member.organization_id=establishment.organization_id
  join auth.users account on account.id=member.user_id
  where establishment.id=target_establishment
    and private.is_org_member(establishment.organization_id)
    and member.role in ('owner','admin','agronomist','operator')
  order by display_name,member.user_id
$$;

create function public.create_scouting_visit_v2(
  target_establishment uuid,
  target_parcel uuid,
  target_source_metric uuid,
  visit_title text,
  visit_objective text,
  visit_priority public.scouting_priority,
  visit_scheduled_for timestamptz,
  assigned_user uuid,
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
  chosen_assignee uuid:=coalesce(assigned_user,auth.uid());
begin
  select organization_id into target_org from public.establishments where id=target_establishment;
  if target_org is null or not private.has_org_role(target_org,array['owner','admin','agronomist','operator']::public.organization_role[]) then raise exception 'Not authorized'; end if;
  if request_id is null then raise exception 'Request ID is required'; end if;
  select id into existing_visit from public.scouting_visits where organization_id=target_org and idempotency_key=request_id;
  if existing_visit is not null then return existing_visit; end if;
  if not exists(
    select 1 from public.organization_members where organization_id=target_org and user_id=chosen_assignee
      and role in ('owner','admin','agronomist','operator')
  ) then raise exception 'Invalid assignee'; end if;
  if chosen_assignee<>auth.uid() and not private.has_org_role(target_org,array['owner','admin','agronomist']::public.organization_role[]) then
    raise exception 'Only supervisors can assign another member';
  end if;
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
    visit_scheduled_for,chosen_assignee,request_id,auth.uid(),auth.uid()
  ) returning id into new_visit;
  insert into public.scouting_visit_events(organization_id,establishment_id,visit_id,action,next_status,details,idempotency_key,created_by)
    values(target_org,target_establishment,new_visit,'created','planned',jsonb_build_object('priority',visit_priority,'scheduled_for',visit_scheduled_for,'source_type',source_kind,'assigned_to',chosen_assignee),request_id,auth.uid());
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
    values(target_org,target_establishment,'scouting_visit',new_visit,'created',auth.uid(),jsonb_build_object('parcel_id',target_parcel,'priority',visit_priority,'source_type',source_kind,'assigned_to',chosen_assignee));
  return new_visit;
end $$;

create function public.reassign_scouting_visit(target_visit uuid, assigned_user uuid, request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  visit_row public.scouting_visits%rowtype;
  existing_event bigint;
begin
  select * into visit_row from public.scouting_visits where id=target_visit for update;
  if visit_row.id is null or not private.has_org_role(visit_row.organization_id,array['owner','admin','agronomist']::public.organization_role[]) then raise exception 'Not authorized'; end if;
  if request_id is null then raise exception 'Request ID is required'; end if;
  select id into existing_event from public.scouting_visit_events where organization_id=visit_row.organization_id and idempotency_key=request_id;
  if existing_event is not null then return visit_row.id; end if;
  if visit_row.status in ('completed','cancelled') then raise exception 'Visit is closed'; end if;
  if not exists(
    select 1 from public.organization_members where organization_id=visit_row.organization_id and user_id=assigned_user
      and role in ('owner','admin','agronomist','operator')
  ) then raise exception 'Invalid assignee'; end if;
  if visit_row.assigned_to=assigned_user then return visit_row.id; end if;

  update public.scouting_visits set assigned_to=assigned_user,lock_version=lock_version+1,updated_by=auth.uid(),updated_at=now()
    where id=visit_row.id;
  insert into public.scouting_visit_events(organization_id,establishment_id,visit_id,action,previous_status,next_status,details,idempotency_key,created_by)
    values(visit_row.organization_id,visit_row.establishment_id,visit_row.id,'assigned',visit_row.status,visit_row.status,
      jsonb_build_object('previous_assignee',visit_row.assigned_to,'assigned_to',assigned_user),request_id,auth.uid());
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
    values(visit_row.organization_id,visit_row.establishment_id,'scouting_visit',visit_row.id,'assignment_changed',auth.uid(),
      jsonb_build_object('previous_assignee',visit_row.assigned_to,'assigned_to',assigned_user,'status',visit_row.status));
  return visit_row.id;
end $$;

create or replace function public.transition_scouting_visit(
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
  if visit_row.id is null or not private.can_operate_scouting_visit(visit_row.organization_id,visit_row.assigned_to,auth.uid()) then raise exception 'Not authorized for this visit'; end if;
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
      jsonb_strip_nulls(jsonb_build_object('summary',nullif(trim(closing_summary),''),'assigned_to',visit_row.assigned_to)),request_id,auth.uid());
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
    values(visit_row.organization_id,visit_row.establishment_id,'scouting_visit',visit_row.id,'status_changed',auth.uid(),jsonb_build_object('from',visit_row.status,'to',next_state,'parcel_id',visit_row.parcel_id,'assigned_to',visit_row.assigned_to));
  return visit_row.id;
end $$;

create or replace function public.record_scouting_finding(
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
  select * into visit_row from public.scouting_visits where id=target_visit for update;
  if visit_row.id is null or not private.can_operate_scouting_visit(visit_row.organization_id,visit_row.assigned_to,auth.uid()) then raise exception 'Not authorized for this visit'; end if;
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
      jsonb_build_object('visit_id',visit_row.id,'parcel_id',visit_row.parcel_id,'category',finding_category,'severity',finding_severity,'geolocated',finding_latitude is not null,'assigned_to',visit_row.assigned_to));
  return new_finding;
end $$;

revoke all on function private.can_operate_scouting_visit(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.list_scouting_assignees(uuid) from public,anon;
grant execute on function public.list_scouting_assignees(uuid) to authenticated;
revoke all on function public.create_scouting_visit(uuid,uuid,uuid,text,text,public.scouting_priority,timestamptz,uuid) from authenticated;
revoke all on function public.create_scouting_visit_v2(uuid,uuid,uuid,text,text,public.scouting_priority,timestamptz,uuid,uuid) from public,anon;
grant execute on function public.create_scouting_visit_v2(uuid,uuid,uuid,text,text,public.scouting_priority,timestamptz,uuid,uuid) to authenticated;
revoke all on function public.reassign_scouting_visit(uuid,uuid,uuid) from public,anon;
grant execute on function public.reassign_scouting_visit(uuid,uuid,uuid) to authenticated;

comment on function public.list_scouting_assignees(uuid) is 'Tenant-scoped Scout directory without exposing member email addresses.';
comment on function public.create_scouting_visit_v2(uuid,uuid,uuid,text,text,public.scouting_priority,timestamptz,uuid,uuid) is 'Creates an auditable field visit assigned to an eligible organization member.';
comment on function public.reassign_scouting_visit(uuid,uuid,uuid) is 'Supervisor-only reassignment of an open field visit with immutable history.';

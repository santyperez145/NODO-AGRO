create or replace function public.create_scouting_visit(
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

revoke all on function public.create_scouting_visit(uuid,uuid,uuid,text,text,public.scouting_priority,timestamptz,uuid) from public,anon;
grant execute on function public.create_scouting_visit(uuid,uuid,uuid,text,text,public.scouting_priority,timestamptz,uuid) to authenticated;

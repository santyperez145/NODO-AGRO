create or replace function public.record_irrigation_event(
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
  select event.id into existing_event
    from public.irrigation_events event
    where event.organization_id=target_org and event.request_id=record_irrigation_event.request_id;
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

create or replace function public.reverse_irrigation_event(target_event uuid, reversal_reason text, request_id uuid)
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
  select event.id into existing_event
    from public.irrigation_events event
    where event.organization_id=event_row.organization_id and event.request_id=reverse_irrigation_event.request_id;
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

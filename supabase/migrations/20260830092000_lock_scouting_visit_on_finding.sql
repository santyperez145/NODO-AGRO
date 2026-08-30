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

revoke all on function public.record_scouting_finding(uuid,public.scouting_finding_category,public.scouting_severity,timestamptz,double precision,double precision,double precision,text,uuid) from public,anon;
grant execute on function public.record_scouting_finding(uuid,public.scouting_finding_category,public.scouting_severity,timestamptz,double precision,double precision,double precision,text,uuid) to authenticated;

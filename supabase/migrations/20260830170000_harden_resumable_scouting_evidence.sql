create or replace function public.attach_scouting_media_server(
  target_finding uuid,
  target_object_path text,
  media_filename text,
  media_mime_type text,
  media_size_bytes bigint,
  media_sha256 text,
  media_capture_source text,
  media_captured_at timestamptz,
  media_caption text,
  request_id uuid,
  actor_user uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  finding_row public.scouting_findings%rowtype;
  visit_status public.scouting_visit_status;
  visit_assignee uuid;
  actor_role public.organization_role;
  existing_media uuid;
  new_media uuid;
  object_metadata jsonb;
  expected_prefix text;
begin
  if auth.role()<>'service_role' then raise exception 'Service role required'; end if;
  if request_id is null or actor_user is null then raise exception 'Request and actor are required'; end if;
  select * into finding_row from public.scouting_findings where id=target_finding for update;
  if finding_row.id is null then raise exception 'Finding not found'; end if;
  select role into actor_role from public.organization_members where organization_id=finding_row.organization_id and user_id=actor_user;
  if actor_role is null or actor_role not in ('owner','admin','agronomist','operator') then raise exception 'Actor is not authorized'; end if;
  select id into existing_media from public.scouting_finding_media where organization_id=finding_row.organization_id and scouting_finding_media.request_id=attach_scouting_media_server.request_id;
  if existing_media is not null then return existing_media; end if;
  select status,assigned_to into visit_status,visit_assignee from public.scouting_visits where id=finding_row.visit_id for update;
  if visit_status<>'in_progress' then raise exception 'Visit must be in progress'; end if;
  if actor_role='operator' and visit_assignee is distinct from actor_user then raise exception 'Visit is assigned to another member'; end if;
  if media_mime_type not in ('image/jpeg','image/png','image/webp') or media_size_bytes not between 1 and 8388608 then raise exception 'Invalid media type or size'; end if;
  if media_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Invalid media digest'; end if;
  if media_capture_source not in ('camera','library') then raise exception 'Invalid capture source'; end if;
  if media_captured_at is null or media_captured_at>now()+interval '5 minutes' or media_captured_at<now()-interval '30 days' then raise exception 'Invalid capture time'; end if;
  if char_length(media_filename) not between 1 and 180 or (media_caption is not null and char_length(media_caption)>500) then raise exception 'Invalid media description'; end if;
  expected_prefix:=finding_row.organization_id::text||'/'||finding_row.establishment_id::text||'/'||finding_row.visit_id::text||'/'||finding_row.id::text||'/';
  if left(target_object_path,char_length(expected_prefix))<>expected_prefix then raise exception 'Invalid object path'; end if;
  select metadata into object_metadata from storage.objects where bucket_id='scouting-evidence' and name=target_object_path;
  if object_metadata is null then raise exception 'Stored object not found'; end if;
  if coalesce((object_metadata->>'size')::bigint,-1)<>media_size_bytes or coalesce(object_metadata->>'mimetype','')<>media_mime_type then raise exception 'Stored object metadata mismatch'; end if;

  insert into public.scouting_finding_media(
    organization_id,establishment_id,parcel_id,visit_id,finding_id,object_path,original_filename,mime_type,size_bytes,sha256,
    capture_source,captured_at,caption,request_id,created_by
  ) values(
    finding_row.organization_id,finding_row.establishment_id,finding_row.parcel_id,finding_row.visit_id,finding_row.id,target_object_path,
    media_filename,media_mime_type,media_size_bytes,media_sha256,media_capture_source,media_captured_at,nullif(trim(media_caption),''),request_id,actor_user
  ) returning id into new_media;
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
    values(finding_row.organization_id,finding_row.establishment_id,'scouting_media',new_media,'media_attached',actor_user,
      jsonb_build_object('finding_id',finding_row.id,'visit_id',finding_row.visit_id,'mime_type',media_mime_type,'size_bytes',media_size_bytes,'sha256',media_sha256));
  return new_media;
end $$;

revoke all on function public.attach_scouting_media_server(uuid,text,text,text,bigint,text,text,timestamptz,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.attach_scouting_media_server(uuid,text,text,text,bigint,text,text,timestamptz,text,uuid,uuid) to service_role;

comment on function public.attach_scouting_media_server(uuid,text,text,text,bigint,text,text,timestamptz,text,uuid,uuid) is 'Service-only idempotent attachment of a verified private object; authorization and operator assignment are rechecked transactionally.';

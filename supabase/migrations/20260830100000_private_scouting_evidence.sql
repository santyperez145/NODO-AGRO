insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('scouting-evidence','scouting-evidence',false,8388608,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

alter table public.operational_audit_events drop constraint if exists operational_audit_events_entity_type_check;
alter table public.operational_audit_events add constraint operational_audit_events_entity_type_check
  check (entity_type in ('livestock_group','livestock_event','machine_asset','machine_event','financial_entry','maintenance_work_order','scouting_visit','scouting_finding','scouting_media'));
alter table public.operational_audit_events drop constraint if exists operational_audit_events_action_check;
alter table public.operational_audit_events add constraint operational_audit_events_action_check
  check (action in ('created','event_recorded','reversed','status_changed','finding_recorded','media_attached'));

create table public.scouting_finding_media(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  parcel_id uuid not null references public.land_parcels(id) on delete restrict,
  visit_id uuid not null references public.scouting_visits(id) on delete restrict,
  finding_id uuid not null references public.scouting_findings(id) on delete restrict,
  bucket_id text not null default 'scouting-evidence' check (bucket_id='scouting-evidence'),
  object_path text not null unique check (char_length(object_path) between 10 and 700),
  original_filename text not null check (char_length(original_filename) between 1 and 180),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  size_bytes bigint not null check (size_bytes between 1 and 8388608),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  capture_source text not null check (capture_source in ('camera','library')),
  captured_at timestamptz not null,
  caption text check (caption is null or char_length(caption)<=500),
  request_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(organization_id,request_id)
);

create index scouting_finding_media_finding_time_idx on public.scouting_finding_media(finding_id,captured_at desc);

create function private.validate_scouting_media_scope() returns trigger
language plpgsql security definer set search_path='' as $$
declare finding_scope record;
begin
  select organization_id,establishment_id,parcel_id,visit_id into finding_scope
  from public.scouting_findings where id=new.finding_id;
  if finding_scope.organization_id is distinct from new.organization_id
     or finding_scope.establishment_id is distinct from new.establishment_id
     or finding_scope.parcel_id is distinct from new.parcel_id
     or finding_scope.visit_id is distinct from new.visit_id then
    raise exception 'Media does not belong to finding scope';
  end if;
  return new;
end $$;

create trigger scouting_finding_media_scope_guard before insert or update on public.scouting_finding_media
  for each row execute function private.validate_scouting_media_scope();

alter table public.scouting_finding_media enable row level security;
revoke all on public.scouting_finding_media from public,anon,authenticated;
grant select on public.scouting_finding_media to authenticated;
create policy scouting_finding_media_select on public.scouting_finding_media for select to authenticated
  using(private.is_org_member(organization_id));

create function private.can_read_scouting_evidence(object_name text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare path_parts text[];
declare target_org uuid;
begin
  path_parts:=storage.foldername(object_name);
  if cardinality(path_parts)<>4 then return false; end if;
  target_org:=path_parts[1]::uuid;
  return exists(
    select 1 from public.scouting_finding_media media
    join public.organization_members member on member.organization_id=media.organization_id
    where media.bucket_id='scouting-evidence' and media.object_path=object_name
      and media.organization_id=target_org and member.user_id=auth.uid()
  );
exception when invalid_text_representation then return false;
end $$;

create policy scouting_evidence_read on storage.objects for select to authenticated
  using(bucket_id='scouting-evidence' and private.can_read_scouting_evidence(name));

create function public.attach_scouting_media_server(
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
  existing_media uuid;
  new_media uuid;
  object_metadata jsonb;
  expected_prefix text;
begin
  if auth.role()<>'service_role' then raise exception 'Service role required'; end if;
  if request_id is null or actor_user is null then raise exception 'Request and actor are required'; end if;
  select * into finding_row from public.scouting_findings where id=target_finding for update;
  if finding_row.id is null then raise exception 'Finding not found'; end if;
  if not exists(select 1 from public.organization_members where organization_id=finding_row.organization_id and user_id=actor_user and role in ('owner','admin','agronomist','operator')) then
    raise exception 'Actor is not authorized';
  end if;
  select id into existing_media from public.scouting_finding_media where organization_id=finding_row.organization_id and scouting_finding_media.request_id=attach_scouting_media_server.request_id;
  if existing_media is not null then return existing_media; end if;
  select status into visit_status from public.scouting_visits where id=finding_row.visit_id for update;
  if visit_status<>'in_progress' then raise exception 'Visit must be in progress'; end if;
  if media_mime_type not in ('image/jpeg','image/png','image/webp') or media_size_bytes not between 1 and 8388608 then raise exception 'Invalid media type or size'; end if;
  if media_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Invalid media digest'; end if;
  if media_capture_source not in ('camera','library') then raise exception 'Invalid capture source'; end if;
  if media_captured_at is null or media_captured_at>now()+interval '5 minutes' or media_captured_at<now()-interval '30 days' then raise exception 'Invalid capture time'; end if;
  if char_length(media_filename) not between 1 and 180 or (media_caption is not null and char_length(media_caption)>500) then raise exception 'Invalid media description'; end if;
  expected_prefix:=finding_row.organization_id::text||'/'||finding_row.establishment_id::text||'/'||finding_row.visit_id::text||'/'||finding_row.id::text||'/';
  if left(target_object_path,char_length(expected_prefix))<>expected_prefix then raise exception 'Invalid object path'; end if;
  select metadata into object_metadata from storage.objects where bucket_id='scouting-evidence' and name=target_object_path;
  if object_metadata is null then raise exception 'Stored object not found'; end if;
  if coalesce((object_metadata->>'size')::bigint,-1)<>media_size_bytes or coalesce(object_metadata->>'mimetype','')<>media_mime_type then
    raise exception 'Stored object metadata mismatch';
  end if;

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

revoke all on function private.validate_scouting_media_scope() from public,anon,authenticated;
revoke all on function private.can_read_scouting_evidence(text) from public,anon;
grant execute on function private.can_read_scouting_evidence(text) to authenticated;
revoke all on function public.attach_scouting_media_server(uuid,text,text,text,bigint,text,text,timestamptz,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.attach_scouting_media_server(uuid,text,text,text,bigint,text,text,timestamptz,text,uuid,uuid) to service_role;

comment on table public.scouting_finding_media is 'Immutable metadata for private field images uploaded through the authenticated evidence service.';
comment on function public.attach_scouting_media_server(uuid,text,text,text,bigint,text,text,timestamptz,text,uuid,uuid) is 'Service-only atomic attachment of a verified private object to an active scouting finding.';

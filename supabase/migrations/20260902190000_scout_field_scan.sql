create type public.scouting_scan_verdict as enum ('clean','unknown','blocked');

alter table public.scouting_finding_media
  add column scan_verdict public.scouting_scan_verdict,
  add column scan_algorithm_version text check (scan_algorithm_version is null or char_length(scan_algorithm_version) between 3 and 80),
  add column scan_providers text[] not null default '{}',
  add column scan_limitations jsonb not null default '[]'::jsonb
    check (jsonb_typeof(scan_limitations)='array' and octet_length(scan_limitations::text)<=4096);

create table public.scouting_media_scans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  media_id uuid references public.scouting_finding_media(id) on delete set null,
  object_path text check (object_path is null or char_length(object_path) between 10 and 700),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  algorithm_version text not null check (char_length(algorithm_version) between 3 and 80),
  verdict public.scouting_scan_verdict not null,
  providers text[] not null default '{}',
  structural_findings jsonb not null default '[]'::jsonb
    check (jsonb_typeof(structural_findings)='array' and octet_length(structural_findings::text)<=2048),
  catalog_hits jsonb not null default '[]'::jsonb
    check (jsonb_typeof(catalog_hits)='array' and octet_length(catalog_hits::text)<=4096),
  limitations jsonb not null default '[]'::jsonb
    check (jsonb_typeof(limitations)='array' and octet_length(limitations::text)<=4096),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  scanned_at timestamptz not null default now(),
  unique (organization_id,request_id)
);

create index scouting_media_scans_org_hash_idx
  on public.scouting_media_scans(organization_id,sha256,scanned_at desc);

alter table public.operational_audit_events drop constraint if exists operational_audit_events_entity_type_check;
alter table public.operational_audit_events add constraint operational_audit_events_entity_type_check
  check (entity_type in ('livestock_group','livestock_event','machine_asset','machine_event','financial_entry','maintenance_work_order','scouting_visit','scouting_finding','scouting_media','irrigation_event','scouting_scan'));

alter table public.operational_audit_events drop constraint if exists operational_audit_events_action_check;
alter table public.operational_audit_events add constraint operational_audit_events_action_check
  check (action in ('created','event_recorded','reversed','status_changed','finding_recorded','media_attached','assignment_changed','scan_blocked','scan_recorded'));

create function private.enforce_scouting_scan_scope() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  establishment_org uuid;
  media_org uuid;
begin
  select organization_id into establishment_org from public.establishments where id=new.establishment_id;
  if establishment_org is null or establishment_org<>new.organization_id then
    raise exception 'Scouting scan establishment scope mismatch';
  end if;
  if new.media_id is not null then
    select organization_id into media_org from public.scouting_finding_media where id=new.media_id;
    if media_org is null or media_org<>new.organization_id then
      raise exception 'Scouting scan media scope mismatch';
    end if;
  end if;
  return new;
end;
$$;

create trigger scouting_media_scan_scope_guard
  before insert or update on public.scouting_media_scans
  for each row execute function private.enforce_scouting_scan_scope();

create function public.record_scouting_media_scan_server(
  target_organization uuid,
  target_establishment uuid,
  target_media uuid,
  target_object_path text,
  media_sha256 text,
  scan_verdict public.scouting_scan_verdict,
  scan_algorithm text,
  scan_providers text[],
  structural_findings jsonb,
  catalog_hits jsonb,
  scan_limitations jsonb,
  request_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  existing_scan uuid;
  new_scan uuid;
begin
  if auth.role()<>'service_role' then raise exception 'Service role required'; end if;
  if request_id is null then raise exception 'Request ID is required'; end if;
  if media_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Invalid media digest'; end if;
  if char_length(scan_algorithm) not between 3 and 80 then raise exception 'Invalid scan algorithm'; end if;
  select scan.id into existing_scan
    from public.scouting_media_scans scan
    where scan.organization_id=target_organization and scan.request_id=record_scouting_media_scan_server.request_id;
  if existing_scan is not null then return existing_scan; end if;
  insert into public.scouting_media_scans(
    organization_id,establishment_id,media_id,object_path,sha256,algorithm_version,verdict,providers,
    structural_findings,catalog_hits,limitations,request_id
  ) values (
    target_organization,target_establishment,target_media,nullif(target_object_path,''),media_sha256,scan_algorithm,scan_verdict,
    coalesce(scan_providers,'{}'::text[]),coalesce(structural_findings,'[]'::jsonb),coalesce(catalog_hits,'[]'::jsonb),
    coalesce(scan_limitations,'[]'::jsonb),request_id
  ) returning id into new_scan;
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
  values(
    target_organization,target_establishment,'scouting_scan',new_scan,
    case when scan_verdict='blocked' then 'scan_blocked' else 'scan_recorded' end,
    null,
    jsonb_build_object('sha256',media_sha256,'verdict',scan_verdict,'algorithm',scan_algorithm,'media_id',target_media)
  );
  return new_scan;
end;
$$;

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
  existing_media uuid;
  new_media uuid;
  object_metadata jsonb;
  expected_prefix text;
  latest_scan public.scouting_media_scans%rowtype;
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

  select * into latest_scan
    from public.scouting_media_scans scan
    where scan.organization_id=finding_row.organization_id
      and scan.sha256=media_sha256
      and scan.algorithm_version='field-scan-v1'
      and scan.scanned_at>now()-interval '2 hours'
    order by scan.scanned_at desc
    limit 1;
  if latest_scan.id is null then raise exception 'Field scan required'; end if;
  if latest_scan.verdict='blocked' then raise exception 'Media blocked by field scan'; end if;

  insert into public.scouting_finding_media(
    organization_id,establishment_id,parcel_id,visit_id,finding_id,object_path,original_filename,mime_type,size_bytes,sha256,
    capture_source,captured_at,caption,request_id,created_by,scan_verdict,scan_algorithm_version,scan_providers,scan_limitations
  ) values(
    finding_row.organization_id,finding_row.establishment_id,finding_row.parcel_id,finding_row.visit_id,finding_row.id,target_object_path,
    media_filename,media_mime_type,media_size_bytes,media_sha256,media_capture_source,media_captured_at,nullif(trim(media_caption),''),request_id,actor_user,
    latest_scan.verdict,latest_scan.algorithm_version,latest_scan.providers,latest_scan.limitations
  ) returning id into new_media;
  update public.scouting_media_scans set media_id=new_media where id=latest_scan.id and media_id is null;
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
    values(finding_row.organization_id,finding_row.establishment_id,'scouting_media',new_media,'media_attached',actor_user,
      jsonb_build_object('finding_id',finding_row.id,'visit_id',finding_row.visit_id,'mime_type',media_mime_type,'size_bytes',media_size_bytes,'sha256',media_sha256,'scan_verdict',latest_scan.verdict));
  return new_media;
end $$;

alter table public.scouting_media_scans enable row level security;
revoke all on public.scouting_media_scans from public,anon,authenticated;
grant select on public.scouting_media_scans to authenticated;
grant select,insert,update on public.scouting_media_scans to service_role;
create policy scouting_media_scans_select on public.scouting_media_scans for select to authenticated
  using (private.is_org_member(organization_id));

revoke all on function private.enforce_scouting_scan_scope() from public,anon,authenticated;
revoke all on function public.record_scouting_media_scan_server(uuid,uuid,uuid,text,text,public.scouting_scan_verdict,text,text[],jsonb,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.record_scouting_media_scan_server(uuid,uuid,uuid,text,text,public.scouting_scan_verdict,text,text[],jsonb,jsonb,jsonb,uuid) to service_role;

comment on table public.scouting_media_scans is 'Field evidence scan: structural polyglot check plus public malware hash catalogs. Hash only; the photo is never uploaded to a catalog.';
comment on column public.scouting_finding_media.scan_verdict is 'clean=no catalog hit and no polyglot; unknown=catalog miss or catalog error; blocked never attaches.';

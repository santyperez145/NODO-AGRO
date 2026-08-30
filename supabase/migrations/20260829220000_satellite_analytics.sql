create type public.satellite_analysis_status as enum ('running','completed','partial','failed');
create type public.satellite_quality_status as enum ('usable','cloud_limited','insufficient_pixels');

alter table public.satellite_scenes drop constraint if exists satellite_scenes_provider_external_id_key;
alter table public.satellite_scenes
  add constraint satellite_scenes_establishment_provider_external_key
  unique (establishment_id,provider,external_id);

create table public.satellite_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  satellite_scene_id uuid not null references public.satellite_scenes(id) on delete restrict,
  index_name text not null check (index_name in ('ndvi','ndmi')),
  requested_by uuid references auth.users(id) on delete set null,
  status public.satellite_analysis_status not null default 'running',
  parcel_count integer not null default 0 check (parcel_count between 0 and 100),
  succeeded_count integer not null default 0 check (succeeded_count between 0 and parcel_count),
  failed_count integer not null default 0 check (failed_count between 0 and parcel_count),
  error_code text check (error_code is null or char_length(error_code) <= 120),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status='running' and completed_at is null) or (status<>'running' and completed_at is not null)),
  check (succeeded_count + failed_count <= parcel_count)
);

create table public.parcel_satellite_metrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  parcel_id uuid not null references public.land_parcels(id) on delete cascade,
  satellite_scene_id uuid not null references public.satellite_scenes(id) on delete restrict,
  analysis_run_id uuid not null references public.satellite_analysis_runs(id) on delete restrict,
  index_name text not null check (index_name in ('ndvi','ndmi')),
  captured_at timestamptz not null,
  cloud_cover_pct double precision check (cloud_cover_pct between 0 and 100),
  mean_value double precision not null check (mean_value between -1 and 1),
  min_value double precision not null check (min_value between -1 and 1),
  max_value double precision not null check (max_value between -1 and 1),
  stddev_value double precision not null check (stddev_value >= 0),
  percentile_02 double precision check (percentile_02 between -1 and 1),
  percentile_98 double precision check (percentile_98 between -1 and 1),
  valid_percent double precision not null check (valid_percent between 0 and 100),
  pixel_count integer not null check (pixel_count > 0),
  quality_status public.satellite_quality_status not null,
  source_provider text not null,
  algorithm_version text not null check (char_length(algorithm_version) between 3 and 80),
  computed_at timestamptz not null default now(),
  unique (parcel_id,satellite_scene_id,index_name,algorithm_version),
  check (min_value <= mean_value and mean_value <= max_value)
);

create index satellite_analysis_runs_establishment_time_idx
  on public.satellite_analysis_runs(establishment_id,started_at desc);
create index parcel_satellite_metrics_establishment_index_time_idx
  on public.parcel_satellite_metrics(establishment_id,index_name,captured_at desc);

create function private.enforce_satellite_analysis_scope() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  scene_org uuid;
  scene_establishment uuid;
  parcel_org uuid;
  parcel_establishment uuid;
  run_org uuid;
  run_establishment uuid;
  run_scene uuid;
  run_index text;
begin
  select organization_id,establishment_id into scene_org,scene_establishment
    from public.satellite_scenes where id=new.satellite_scene_id;
  if scene_org is null or scene_org<>new.organization_id or scene_establishment<>new.establishment_id then
    raise exception 'Satellite scene scope mismatch';
  end if;

  if tg_table_name='parcel_satellite_metrics' then
    select organization_id,establishment_id into parcel_org,parcel_establishment
      from public.land_parcels where id=new.parcel_id;
    select organization_id,establishment_id,satellite_scene_id,index_name
      into run_org,run_establishment,run_scene,run_index
      from public.satellite_analysis_runs where id=new.analysis_run_id;
    if parcel_org is null or parcel_org<>new.organization_id or parcel_establishment<>new.establishment_id then
      raise exception 'Parcel scope mismatch';
    end if;
    if run_org is null or run_org<>new.organization_id or run_establishment<>new.establishment_id
       or run_scene<>new.satellite_scene_id or run_index<>new.index_name then
      raise exception 'Satellite analysis run scope mismatch';
    end if;
  end if;
  return new;
end;
$$;

create trigger satellite_analysis_run_scope_guard
  before insert or update on public.satellite_analysis_runs
  for each row execute function private.enforce_satellite_analysis_scope();
create trigger parcel_satellite_metric_scope_guard
  before insert or update on public.parcel_satellite_metrics
  for each row execute function private.enforce_satellite_analysis_scope();

alter table public.satellite_analysis_runs enable row level security;
alter table public.parcel_satellite_metrics enable row level security;

revoke all on public.satellite_analysis_runs,public.parcel_satellite_metrics from public,anon,authenticated;
grant select on public.satellite_analysis_runs,public.parcel_satellite_metrics to authenticated;
grant select,insert,update on public.satellite_analysis_runs,public.parcel_satellite_metrics to service_role;

create policy satellite_analysis_runs_select on public.satellite_analysis_runs for select to authenticated
  using (private.is_org_member(organization_id));
create policy parcel_satellite_metrics_select on public.parcel_satellite_metrics for select to authenticated
  using (private.is_org_member(organization_id));

comment on table public.satellite_analysis_runs is 'Auditable executions of real parcel-level satellite statistics.';
comment on table public.parcel_satellite_metrics is 'Scene-bound spectral statistics; proxies that require agronomic interpretation and field verification.';

revoke all on function private.enforce_satellite_analysis_scope() from public,anon,authenticated;

create type public.terrain_relief_status as enum ('running','completed','partial','failed');
create type public.terrain_quality_status as enum ('usable','insufficient_pixels','provider_gap');

create table public.terrain_relief_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  algorithm_version text not null check (char_length(algorithm_version) between 3 and 80),
  requested_by uuid references auth.users(id) on delete set null,
  status public.terrain_relief_status not null default 'running',
  product_id text not null check (char_length(product_id) between 3 and 80),
  collection text not null check (char_length(collection) between 3 and 80),
  resolution_meters numeric(6,2) not null check (resolution_meters > 0 and resolution_meters <= 1000),
  surface_kind text not null check (surface_kind in ('dsm')),
  vertical_datum text not null check (char_length(vertical_datum) between 3 and 40),
  horizontal_datum text not null check (char_length(horizontal_datum) between 3 and 40),
  published_le90abs_mean_m numeric(6,2) not null check (published_le90abs_mean_m > 0 and published_le90abs_mean_m <= 50),
  license_name text not null check (char_length(license_name) between 3 and 120),
  license_url text not null check (char_length(license_url) between 12 and 300),
  mosaic_search_id text check (mosaic_search_id is null or mosaic_search_id ~ '^[a-f0-9]{32}$'),
  dem_item_ids text[] not null default '{}'::text[] check (cardinality(dem_item_ids) between 0 and 24),
  bbox_west double precision check (bbox_west is null or (bbox_west between -180 and 180)),
  bbox_south double precision check (bbox_south is null or (bbox_south between -90 and 90)),
  bbox_east double precision check (bbox_east is null or (bbox_east between -180 and 180)),
  bbox_north double precision check (bbox_north is null or (bbox_north between -90 and 90)),
  parcel_count integer not null default 0 check (parcel_count between 0 and 100),
  succeeded_count integer not null default 0 check (succeeded_count between 0 and parcel_count),
  failed_count integer not null default 0 check (failed_count between 0 and parcel_count),
  error_code text check (error_code is null or char_length(error_code) <= 120),
  limitations jsonb not null default '[]'::jsonb check (jsonb_typeof(limitations)='array' and octet_length(limitations::text)<=4096),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status='running' and completed_at is null) or (status<>'running' and completed_at is not null)),
  check (
    (bbox_west is null and bbox_south is null and bbox_east is null and bbox_north is null)
    or (bbox_west is not null and bbox_south is not null and bbox_east is not null and bbox_north is not null
        and bbox_east >= bbox_west and bbox_north >= bbox_south)
  )
);

create table public.parcel_terrain_metrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  parcel_id uuid not null references public.land_parcels(id) on delete cascade,
  run_id uuid not null references public.terrain_relief_runs(id) on delete restrict,
  algorithm_version text not null check (char_length(algorithm_version) between 3 and 80),
  product_id text not null check (char_length(product_id) between 3 and 80),
  dem_item_id text not null check (dem_item_id ~ '^[A-Za-z0-9_-]{10,180}$'),
  elev_min_m double precision not null,
  elev_max_m double precision not null,
  elev_mean_m double precision not null,
  elev_median_m double precision,
  elev_stddev_m double precision not null check (elev_stddev_m >= 0),
  relief_m double precision not null check (relief_m >= 0),
  valid_percent double precision not null check (valid_percent between 0 and 100),
  pixel_count integer not null check (pixel_count >= 0),
  quality_status public.terrain_quality_status not null,
  resolution_meters numeric(6,2) not null check (resolution_meters > 0 and resolution_meters <= 1000),
  surface_kind text not null check (surface_kind in ('dsm')),
  vertical_datum text not null check (char_length(vertical_datum) between 3 and 40),
  published_le90abs_mean_m numeric(6,2) not null check (published_le90abs_mean_m > 0 and published_le90abs_mean_m <= 50),
  license_name text not null check (char_length(license_name) between 3 and 120),
  license_url text not null check (char_length(license_url) between 12 and 300),
  limitations jsonb not null check (jsonb_typeof(limitations)='array' and octet_length(limitations::text)<=4096),
  computed_at timestamptz not null default now(),
  unique (parcel_id, algorithm_version),
  check (elev_min_m <= elev_mean_m and elev_mean_m <= elev_max_m),
  check (elev_min_m <= elev_max_m),
  check (relief_m <= (elev_max_m - elev_min_m) + 0.01)
);

create index terrain_relief_runs_establishment_time_idx
  on public.terrain_relief_runs(establishment_id, started_at desc);
create index parcel_terrain_metrics_establishment_idx
  on public.parcel_terrain_metrics(establishment_id, computed_at desc);

create function private.enforce_terrain_scope() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  establishment_org uuid;
  parcel_org uuid;
  parcel_establishment uuid;
  run_org uuid;
  run_establishment uuid;
begin
  select organization_id into establishment_org from public.establishments where id=new.establishment_id;
  if establishment_org is null or establishment_org<>new.organization_id then
    raise exception 'Terrain establishment scope mismatch';
  end if;
  if tg_table_name='parcel_terrain_metrics' then
    select organization_id,establishment_id into parcel_org,parcel_establishment
      from public.land_parcels where id=new.parcel_id;
    if parcel_org is null or parcel_org<>new.organization_id or parcel_establishment<>new.establishment_id then
      raise exception 'Terrain parcel scope mismatch';
    end if;
    select organization_id,establishment_id into run_org,run_establishment
      from public.terrain_relief_runs where id=new.run_id;
    if run_org is null or run_org<>new.organization_id or run_establishment<>new.establishment_id then
      raise exception 'Terrain run scope mismatch';
    end if;
  end if;
  return new;
end;
$$;

create trigger terrain_relief_run_scope_guard
  before insert or update on public.terrain_relief_runs
  for each row execute function private.enforce_terrain_scope();
create trigger parcel_terrain_metric_scope_guard
  before insert or update on public.parcel_terrain_metrics
  for each row execute function private.enforce_terrain_scope();

create view public.latest_parcel_terrain_metrics
with (security_invoker=true) as
select distinct on (metric.parcel_id) metric.*
from public.parcel_terrain_metrics metric
order by metric.parcel_id, metric.computed_at desc;

create view public.latest_terrain_relief_runs
with (security_invoker=true) as
select distinct on (run.establishment_id) run.*
from public.terrain_relief_runs run
where run.status in ('completed','partial')
order by run.establishment_id, run.completed_at desc nulls last, run.started_at desc;

alter table public.terrain_relief_runs enable row level security;
alter table public.parcel_terrain_metrics enable row level security;

revoke all on public.terrain_relief_runs, public.parcel_terrain_metrics from public, anon, authenticated;
grant select on public.terrain_relief_runs, public.parcel_terrain_metrics,
  public.latest_parcel_terrain_metrics, public.latest_terrain_relief_runs to authenticated;
grant select, insert, update on public.terrain_relief_runs, public.parcel_terrain_metrics to service_role;

create policy terrain_relief_runs_select on public.terrain_relief_runs for select to authenticated
  using (private.is_org_member(organization_id));
create policy parcel_terrain_metrics_select on public.parcel_terrain_metrics for select to authenticated
  using (private.is_org_member(organization_id));

revoke all on function private.enforce_terrain_scope() from public, anon, authenticated;

comment on table public.terrain_relief_runs is
  'NODO Terrain relief builds against Copernicus DEM GLO-30. Hillshade is visual orientation; not a 3D mesh, flood model or survey grade.';
comment on table public.parcel_terrain_metrics is
  'Parcel elevation statistics from Copernicus DEM GLO-30 DSM. Published LE90ABS mean is global handbook evidence, not a local survey certificate.';
comment on column public.terrain_relief_runs.published_le90abs_mean_m is
  'Handbook LE90ABS mean excluding Greenland and Antarctica (~1.92 m). Local deviations occur.';
comment on column public.parcel_terrain_metrics.surface_kind is
  'DSM includes vegetation and structures; not a bare-earth DTM.';

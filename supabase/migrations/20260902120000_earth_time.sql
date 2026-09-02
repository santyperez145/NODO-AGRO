create table public.satellite_timeseries_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  index_name text not null check (index_name in ('ndvi','ndmi')),
  algorithm_version text not null check (char_length(algorithm_version) between 3 and 80),
  requested_by uuid references auth.users(id) on delete set null,
  status public.satellite_analysis_status not null default 'running',
  window_start timestamptz not null,
  window_end timestamptz not null,
  scene_count integer not null default 0 check (scene_count between 0 and 24),
  observation_target integer not null default 0 check (observation_target between 0 and 1200),
  succeeded_count integer not null default 0 check (succeeded_count between 0 and observation_target),
  failed_count integer not null default 0 check (failed_count between 0 and observation_target),
  skipped_existing_count integer not null default 0 check (skipped_existing_count >= 0),
  error_code text check (error_code is null or char_length(error_code) <= 120),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  check (window_end >= window_start),
  check ((status='running' and completed_at is null) or (status<>'running' and completed_at is not null)),
  check (succeeded_count + failed_count <= observation_target)
);

create table public.parcel_index_baselines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  parcel_id uuid not null references public.land_parcels(id) on delete cascade,
  index_name text not null check (index_name in ('ndvi','ndmi')),
  algorithm_version text not null check (char_length(algorithm_version) between 3 and 80),
  observation_count integer not null check (observation_count >= 1),
  window_start timestamptz not null,
  window_end timestamptz not null,
  median_value double precision not null check (median_value between -1 and 1),
  percentile_25 double precision not null check (percentile_25 between -1 and 1),
  percentile_75 double precision not null check (percentile_75 between -1 and 1),
  latest_mean double precision not null check (latest_mean between -1 and 1),
  latest_captured_at timestamptz not null,
  latest_delta double precision,
  computed_at timestamptz not null default now(),
  unique (parcel_id,index_name,algorithm_version),
  check (window_end >= window_start),
  check (percentile_25 <= median_value and median_value <= percentile_75)
);

create table public.weather_daily_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  observed_on date not null,
  precipitation_mm double precision not null check (precipitation_mm >= 0 and precipitation_mm <= 500),
  source text not null check (char_length(source) between 3 and 80),
  created_at timestamptz not null default now(),
  unique (establishment_id,observed_on,source)
);

alter table public.satellite_analysis_runs
  add column algorithm_version text check (algorithm_version is null or char_length(algorithm_version) between 3 and 80),
  add column timeseries_run_id uuid references public.satellite_timeseries_runs(id) on delete set null;

alter table public.parcel_satellite_metrics
  add column scl_clear_percent double precision check (scl_clear_percent is null or scl_clear_percent between 0 and 100),
  add column scl_cloud_percent double precision check (scl_cloud_percent is null or scl_cloud_percent between 0 and 100),
  add column scl_class_counts jsonb check (
    scl_class_counts is null
    or (jsonb_typeof(scl_class_counts)='object' and octet_length(scl_class_counts::text)<=2048)
  ),
  add column median_value double precision check (median_value is null or median_value between -1 and 1),
  add column timeseries_run_id uuid references public.satellite_timeseries_runs(id) on delete set null,
  add constraint parcel_satellite_metrics_scl_algorithm_check check (
    algorithm_version not like '%scl-v1'
    or (scl_clear_percent is not null and scl_cloud_percent is not null and scl_class_counts is not null)
  );

create index satellite_timeseries_runs_establishment_time_idx
  on public.satellite_timeseries_runs(establishment_id,started_at desc);
create index parcel_index_baselines_establishment_idx
  on public.parcel_index_baselines(establishment_id,index_name);
create index weather_daily_observations_establishment_day_idx
  on public.weather_daily_observations(establishment_id,observed_on desc);
create index parcel_satellite_metrics_algorithm_time_idx
  on public.parcel_satellite_metrics(establishment_id,algorithm_version,captured_at desc);

create function private.enforce_earth_time_scope() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  establishment_org uuid;
  parcel_org uuid;
  parcel_establishment uuid;
  run_org uuid;
  run_establishment uuid;
begin
  select organization_id into establishment_org
    from public.establishments where id=new.establishment_id;
  if establishment_org is null or establishment_org<>new.organization_id then
    raise exception 'Earth Time establishment scope mismatch';
  end if;

  if tg_table_name='parcel_index_baselines' then
    select organization_id,establishment_id into parcel_org,parcel_establishment
      from public.land_parcels where id=new.parcel_id;
    if parcel_org is null or parcel_org<>new.organization_id or parcel_establishment<>new.establishment_id then
      raise exception 'Earth Time parcel scope mismatch';
    end if;
  end if;

  if tg_table_name in ('satellite_analysis_runs','parcel_satellite_metrics') and new.timeseries_run_id is not null then
    select organization_id,establishment_id into run_org,run_establishment
      from public.satellite_timeseries_runs where id=new.timeseries_run_id;
    if run_org is null or run_org<>new.organization_id or run_establishment<>new.establishment_id then
      raise exception 'Earth Time series run scope mismatch';
    end if;
  end if;
  return new;
end;
$$;

create trigger satellite_timeseries_run_scope_guard
  before insert or update on public.satellite_timeseries_runs
  for each row execute function private.enforce_earth_time_scope();
create trigger parcel_index_baseline_scope_guard
  before insert or update on public.parcel_index_baselines
  for each row execute function private.enforce_earth_time_scope();
create trigger weather_daily_observation_scope_guard
  before insert or update on public.weather_daily_observations
  for each row execute function private.enforce_earth_time_scope();
create trigger satellite_analysis_run_timeseries_scope_guard
  before insert or update on public.satellite_analysis_runs
  for each row execute function private.enforce_earth_time_scope();
create trigger parcel_satellite_metric_timeseries_scope_guard
  before insert or update on public.parcel_satellite_metrics
  for each row execute function private.enforce_earth_time_scope();

create function private.refresh_parcel_index_baselines(
  target_establishment uuid,
  target_index text,
  target_algorithm text
) returns integer
language plpgsql security definer set search_path='' as $$
declare
  written integer;
begin
  if target_index not in ('ndvi','ndmi') or char_length(target_algorithm) not between 3 and 80 then
    raise exception 'Invalid Earth Time baseline contract';
  end if;

  delete from public.parcel_index_baselines
  where establishment_id=target_establishment
    and index_name=target_index
    and algorithm_version=target_algorithm;

  insert into public.parcel_index_baselines (
    organization_id,establishment_id,parcel_id,index_name,algorithm_version,
    observation_count,window_start,window_end,median_value,percentile_25,percentile_75,
    latest_mean,latest_captured_at,latest_delta
  )
  with usable as (
    select organization_id,establishment_id,parcel_id,mean_value,captured_at
    from public.parcel_satellite_metrics
    where establishment_id=target_establishment
      and index_name=target_index
      and algorithm_version=target_algorithm
      and quality_status='usable'
  ),
  agg as (
    select organization_id,establishment_id,parcel_id,
           count(*)::integer as observation_count,
           min(captured_at) as window_start,
           max(captured_at) as window_end,
           percentile_cont(0.5) within group (order by mean_value) as median_value,
           percentile_cont(0.25) within group (order by mean_value) as percentile_25,
           percentile_cont(0.75) within group (order by mean_value) as percentile_75
    from usable
    group by organization_id,establishment_id,parcel_id
  ),
  latest as (
    select distinct on (parcel_id) parcel_id, mean_value as latest_mean, captured_at as latest_captured_at
    from usable
    order by parcel_id, captured_at desc
  )
  select agg.organization_id,agg.establishment_id,agg.parcel_id,target_index,target_algorithm,
         agg.observation_count,agg.window_start,agg.window_end,agg.median_value,agg.percentile_25,agg.percentile_75,
         latest.latest_mean,latest.latest_captured_at,
         case when agg.observation_count>=3 then latest.latest_mean-agg.median_value else null end
  from agg
  join latest on latest.parcel_id=agg.parcel_id;

  get diagnostics written = row_count;
  return written;
end;
$$;

create view public.parcel_earth_series
with (security_invoker=true) as
select metric.id,metric.organization_id,metric.establishment_id,metric.parcel_id,metric.satellite_scene_id,
       metric.index_name,metric.algorithm_version,metric.captured_at,metric.mean_value,metric.median_value,
       metric.min_value,metric.max_value,metric.stddev_value,metric.percentile_02,metric.percentile_98,
       metric.valid_percent,metric.pixel_count,metric.quality_status,metric.scl_clear_percent,metric.scl_cloud_percent,
       metric.cloud_cover_pct,metric.source_provider,metric.computed_at
from public.parcel_satellite_metrics metric
where metric.algorithm_version like '%scl-v1';

alter table public.satellite_timeseries_runs enable row level security;
alter table public.parcel_index_baselines enable row level security;
alter table public.weather_daily_observations enable row level security;

revoke all on public.satellite_timeseries_runs,public.parcel_index_baselines,public.weather_daily_observations from public,anon,authenticated;
grant select on public.satellite_timeseries_runs,public.parcel_index_baselines,public.weather_daily_observations,public.parcel_earth_series to authenticated;
grant select,insert,update on public.satellite_timeseries_runs,public.parcel_index_baselines,public.weather_daily_observations to service_role;

create policy satellite_timeseries_runs_select on public.satellite_timeseries_runs for select to authenticated
  using (private.is_org_member(organization_id));
create policy parcel_index_baselines_select on public.parcel_index_baselines for select to authenticated
  using (private.is_org_member(organization_id));
create policy weather_daily_observations_select on public.weather_daily_observations for select to authenticated
  using (private.is_org_member(organization_id));

create function public.refresh_parcel_index_baselines(
  target_establishment uuid,
  target_index text,
  target_algorithm text
) returns integer
language sql security definer set search_path='' as $$
  select private.refresh_parcel_index_baselines(target_establishment, target_index, target_algorithm);
$$;

revoke all on function private.enforce_earth_time_scope() from public,anon,authenticated;
revoke all on function private.refresh_parcel_index_baselines(uuid,text,text) from public,anon,authenticated;
revoke all on function public.refresh_parcel_index_baselines(uuid,text,text) from public,anon,authenticated;
grant execute on function private.refresh_parcel_index_baselines(uuid,text,text) to service_role;
grant execute on function public.refresh_parcel_index_baselines(uuid,text,text) to service_role;

comment on table public.satellite_timeseries_runs is 'Auditable catalog-wide SCL-gated satellite series executions.';
comment on table public.parcel_index_baselines is 'Lot-own empirical median of usable SCL-gated observations; not a certified phenology calendar.';
comment on table public.weather_daily_observations is 'Daily precipitation persisted from a licensed public weather archive for series overlays.';
comment on view public.parcel_earth_series is 'Read model of SCL-gated parcel observations; invoker security preserves RLS.';

create type public.parcel_use as enum ('crop', 'pasture', 'livestock', 'fallow', 'other');
create type public.recommendation_status as enum ('open', 'accepted', 'dismissed', 'completed');
create type public.recommendation_priority as enum ('critical', 'high', 'medium', 'low');

create table public.land_parcels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 100),
  use public.parcel_use not null default 'other',
  crop text,
  area_hectares numeric(12,2) not null check (area_hectares > 0),
  health_score smallint check (health_score between 0 and 100),
  boundary_geojson jsonb,
  created_at timestamptz not null default now(),
  unique (establishment_id, name)
);

create table public.weather_observations (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  observed_at timestamptz not null,
  temperature_c double precision not null,
  humidity_pct double precision not null check (humidity_pct between 0 and 100),
  precipitation_mm double precision not null check (precipitation_mm >= 0),
  wind_kmh double precision not null check (wind_kmh >= 0),
  forecast_rain_7d_mm double precision not null check (forecast_rain_7d_mm >= 0),
  source text not null,
  source_payload jsonb,
  created_at timestamptz not null default now(),
  unique (establishment_id, observed_at, source)
);

create table public.satellite_scenes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  provider text not null,
  collection text not null,
  external_id text not null,
  captured_at timestamptz not null,
  cloud_cover_pct double precision check (cloud_cover_pct between 0 and 100),
  catalog_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, external_id)
);

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  parcel_id uuid references public.land_parcels(id) on delete set null,
  fingerprint text not null,
  title text not null check (char_length(title) between 3 and 180),
  rationale text not null,
  action text not null,
  priority public.recommendation_priority not null,
  status public.recommendation_status not null default 'open',
  confidence smallint not null check (confidence between 0 and 100),
  evidence jsonb not null default '[]'::jsonb,
  expected_value jsonb not null default '{}'::jsonb,
  valid_until timestamptz,
  generated_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  outcome_note text,
  unique (establishment_id, fingerprint)
);

create index land_parcels_establishment_idx on public.land_parcels(establishment_id);
create index weather_establishment_time_idx on public.weather_observations(establishment_id, observed_at desc);
create index satellite_establishment_time_idx on public.satellite_scenes(establishment_id, captured_at desc);
create index recommendations_establishment_status_idx on public.recommendations(establishment_id, status, priority);

alter table public.land_parcels enable row level security;
alter table public.weather_observations enable row level security;
alter table public.satellite_scenes enable row level security;
alter table public.recommendations enable row level security;

revoke all on public.land_parcels, public.weather_observations, public.satellite_scenes, public.recommendations from anon, authenticated;
grant select on public.land_parcels, public.weather_observations, public.satellite_scenes, public.recommendations to authenticated;
grant insert, update, delete on public.land_parcels to authenticated;
grant update on public.recommendations to authenticated;

create policy parcels_select on public.land_parcels for select to authenticated using (private.is_org_member(organization_id));
create policy parcels_write on public.land_parcels for all to authenticated
  using (private.has_org_role(organization_id, array['owner','admin','agronomist']::public.organization_role[]))
  with check (private.has_org_role(organization_id, array['owner','admin','agronomist']::public.organization_role[]));
create policy weather_select on public.weather_observations for select to authenticated using (private.is_org_member(organization_id));
create policy satellite_select on public.satellite_scenes for select to authenticated using (private.is_org_member(organization_id));
create policy recommendations_select on public.recommendations for select to authenticated using (private.is_org_member(organization_id));
create policy recommendations_update on public.recommendations for update to authenticated
  using (private.has_org_role(organization_id, array['owner','admin','agronomist','operator']::public.organization_role[]))
  with check (private.has_org_role(organization_id, array['owner','admin','agronomist','operator']::public.organization_role[]));

create or replace function public.bootstrap_establishment(
  organization_name text,
  establishment_name text,
  establishment_latitude double precision,
  establishment_longitude double precision,
  establishment_area_hectares numeric
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  new_organization_id uuid;
  new_establishment_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if exists(select 1 from public.organization_members where user_id = current_user_id) then
    raise exception 'User already belongs to an organization';
  end if;
  if char_length(trim(organization_name)) not between 2 and 120 then raise exception 'Invalid organization name'; end if;
  if char_length(trim(establishment_name)) not between 2 and 120 then raise exception 'Invalid establishment name'; end if;
  if establishment_latitude not between -90 and 90 or establishment_longitude not between -180 and 180 then raise exception 'Invalid coordinates'; end if;
  if establishment_area_hectares <= 0 then raise exception 'Area must be positive'; end if;
  insert into public.organizations(name) values (trim(organization_name)) returning id into new_organization_id;
  insert into public.organization_members(organization_id, user_id, role) values (new_organization_id, current_user_id, 'owner');
  insert into public.establishments(organization_id, name, latitude, longitude, area_hectares)
    values (new_organization_id, trim(establishment_name), establishment_latitude, establishment_longitude, establishment_area_hectares)
    returning id into new_establishment_id;
  return jsonb_build_object('organization_id', new_organization_id, 'establishment_id', new_establishment_id);
end $$;
revoke all on function public.bootstrap_establishment(text,text,double precision,double precision,numeric) from public, anon;
grant execute on function public.bootstrap_establishment(text,text,double precision,double precision,numeric) to authenticated;

create or replace function public.set_recommendation_status(target_id uuid, next_status public.recommendation_status, note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare target_org uuid;
begin
  select organization_id into target_org from public.recommendations where id = target_id;
  if target_org is null or not private.has_org_role(target_org, array['owner','admin','agronomist','operator']::public.organization_role[]) then
    raise exception 'Not authorized';
  end if;
  update public.recommendations set status = next_status, decided_at = now(), decided_by = auth.uid(), outcome_note = nullif(trim(note), '') where id = target_id;
end $$;
revoke all on function public.set_recommendation_status(uuid,public.recommendation_status,text) from public, anon;
grant execute on function public.set_recommendation_status(uuid,public.recommendation_status,text) to authenticated;

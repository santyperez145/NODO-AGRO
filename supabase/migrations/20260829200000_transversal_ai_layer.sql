create type public.ai_analysis_status as enum ('running','completed','failed');
create type public.ai_feedback_rating as enum ('useful','not_useful');

alter table public.establishments
  add column country_code text not null default 'AR',
  add column locale text not null default 'es-AR',
  add column timezone text not null default 'America/Argentina/Buenos_Aires',
  add column unit_system text not null default 'metric',
  add constraint establishments_country_code_iso check (country_code ~ '^[A-Z]{2}$'),
  add constraint establishments_locale_format check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  add constraint establishments_timezone_length check (char_length(timezone) between 3 and 64),
  add constraint establishments_unit_system check (unit_system in ('metric','imperial'));

create table public.ai_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  analysis_type text not null default 'operational_brief' check (analysis_type in ('operational_brief')),
  question text check (question is null or char_length(question) between 2 and 500),
  status public.ai_analysis_status not null default 'running',
  prompt_version text not null check (char_length(prompt_version) between 1 and 40),
  model_provider text not null check (char_length(model_provider) between 2 and 40),
  model_name text not null check (char_length(model_name) between 2 and 100),
  context_hash text not null check (context_hash ~ '^[a-f0-9]{64}$'),
  evidence_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence_snapshot)='object' and octet_length(evidence_snapshot::text)<=262144),
  result jsonb check (result is null or (jsonb_typeof(result)='object' and octet_length(result::text)<=131072)),
  error_code text check (error_code is null or char_length(error_code)<=80),
  input_tokens integer check (input_tokens is null or input_tokens>=0),
  output_tokens integer check (output_tokens is null or output_tokens>=0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default (now()+interval '24 hours'),
  check ((status='completed' and result is not null and completed_at is not null) or status<>'completed'),
  check ((status='failed' and error_code is not null and completed_at is not null) or status<>'failed')
);

create table public.ai_analysis_feedback (
  run_id uuid not null references public.ai_analysis_runs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating public.ai_feedback_rating not null,
  comment text check (comment is null or char_length(comment)<=500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (run_id,user_id)
);

create index ai_runs_establishment_time_idx on public.ai_analysis_runs(establishment_id,created_at desc);
create index ai_runs_user_rate_idx on public.ai_analysis_runs(requested_by,created_at desc);
create index ai_runs_context_cache_idx on public.ai_analysis_runs(establishment_id,context_hash,created_at desc) where status='completed';

alter table public.ai_analysis_runs enable row level security;
alter table public.ai_analysis_feedback enable row level security;

revoke all on public.ai_analysis_runs,public.ai_analysis_feedback from public,anon,authenticated;
grant select on public.ai_analysis_runs,public.ai_analysis_feedback to authenticated;

create policy ai_runs_select_member on public.ai_analysis_runs for select to authenticated
  using (private.is_org_member(organization_id));
create policy ai_feedback_select on public.ai_analysis_feedback for select to authenticated
  using (user_id=(select auth.uid()) or private.has_org_role(organization_id,array['owner','admin']::public.organization_role[]));

create or replace function public.submit_ai_analysis_feedback(
  target_run uuid,
  feedback_rating public.ai_feedback_rating,
  feedback_comment text default null
) returns void language plpgsql security definer set search_path='' as $$
declare target_org uuid;
begin
  select organization_id into target_org from public.ai_analysis_runs where id=target_run and status='completed';
  if target_org is null or not private.is_org_member(target_org) then raise exception 'Not authorized'; end if;
  if feedback_comment is not null and char_length(feedback_comment)>500 then raise exception 'Comment is too long'; end if;
  insert into public.ai_analysis_feedback(run_id,organization_id,user_id,rating,comment)
  values(target_run,target_org,auth.uid(),feedback_rating,nullif(trim(feedback_comment),''))
  on conflict(run_id,user_id) do update set rating=excluded.rating,comment=excluded.comment,updated_at=now();
end $$;

revoke all on function public.submit_ai_analysis_feedback(uuid,public.ai_feedback_rating,text) from public,anon;
grant execute on function public.submit_ai_analysis_feedback(uuid,public.ai_feedback_rating,text) to authenticated;

create view public.latest_ai_analysis
with (security_invoker=true) as
select distinct on (run.establishment_id)
  run.id,run.organization_id,run.establishment_id,run.analysis_type,run.question,
  run.prompt_version,run.result,run.created_at,run.completed_at,run.expires_at
from public.ai_analysis_runs run
where run.status='completed'
order by run.establishment_id,run.completed_at desc;

revoke all on public.latest_ai_analysis from public,anon,authenticated;
grant select on public.latest_ai_analysis to authenticated;

comment on table public.ai_analysis_runs is 'Auditable, tenant-scoped intelligence outputs grounded only in a server-built operational snapshot.';
comment on column public.ai_analysis_runs.evidence_snapshot is 'Exact bounded evidence supplied to the analysis engine; contains no browser-authored tenant context.';
comment on view public.latest_ai_analysis is 'Latest completed brief per establishment using invoker security so tenant RLS remains authoritative.';

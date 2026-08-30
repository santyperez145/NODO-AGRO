create or replace view public.latest_ai_analysis
with (security_invoker=true) as
select distinct on (run.establishment_id)
  run.id,run.organization_id,run.establishment_id,run.analysis_type,run.question,
  run.prompt_version,run.result,run.created_at,run.completed_at,run.expires_at
from public.ai_analysis_runs run
where run.status='completed' and run.expires_at>now()
order by run.establishment_id,run.completed_at desc;

comment on view public.latest_ai_analysis is
  'Latest non-expired brief per establishment using invoker security so tenant RLS remains authoritative.';

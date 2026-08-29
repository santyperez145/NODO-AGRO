revoke update on public.recommendations from authenticated;
drop policy if exists recommendations_update on public.recommendations;

comment on table public.recommendations is 'Server-generated evidence is immutable to browser roles. Users change workflow state only through set_recommendation_status.';

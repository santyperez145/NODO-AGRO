-- Outcome v2: accepting a recommendation opens a verifiable outcome cycle server-side.
-- Return type changes from void to uuid, so drop before recreate.

drop function if exists public.set_recommendation_status(uuid, public.recommendation_status, text);

create function public.set_recommendation_status(
  target_id uuid,
  next_status public.recommendation_status,
  note text default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  target_org uuid;
  establishment uuid;
  title text;
  cycle_id uuid;
  open_request uuid := gen_random_uuid();
begin
  select recommendations.organization_id, recommendations.establishment_id, recommendations.title
    into target_org, establishment, title
    from public.recommendations
    where recommendations.id = set_recommendation_status.target_id;
  if target_org is null or not private.has_org_role(target_org, array['owner','admin','agronomist','operator']::public.organization_role[]) then
    raise exception 'Not authorized';
  end if;

  update public.recommendations
    set status = set_recommendation_status.next_status,
        decided_at = now(),
        decided_by = auth.uid(),
        outcome_note = nullif(trim(set_recommendation_status.note), '')
    where recommendations.id = set_recommendation_status.target_id;

  if set_recommendation_status.next_status = 'accepted' then
    select cycle.id into cycle_id
      from public.outcome_cycles cycle
      where cycle.recommendation_id = set_recommendation_status.target_id
        and cycle.status <> 'rejected'
      order by cycle.created_at desc
      limit 1;
    if cycle_id is null then
      cycle_id := public.open_outcome_cycle(
        establishment,
        left('Decisión aceptada: ' || coalesce(title, 'recomendación'), 180),
        'recommendation'::public.outcome_signal_kind,
        set_recommendation_status.target_id,
        null,
        open_request
      );
    end if;
  end if;

  return cycle_id;
end;
$$;

revoke all on function public.set_recommendation_status(uuid, public.recommendation_status, text) from public, anon;
grant execute on function public.set_recommendation_status(uuid, public.recommendation_status, text) to authenticated;

comment on function public.set_recommendation_status(uuid, public.recommendation_status, text) is
  'Updates recommendation workflow state. Accepting opens or reuses an Outcome Ledger cycle for that recommendation; returns the cycle id when applicable.';

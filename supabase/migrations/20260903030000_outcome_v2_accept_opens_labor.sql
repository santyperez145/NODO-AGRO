-- Outcome v2.1: accepting a recommendation with a parcel also opens a Scout visit and links labor.

create or replace function public.set_recommendation_status(
  target_id uuid,
  next_status public.recommendation_status,
  note text default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  target_org uuid;
  establishment uuid;
  title text;
  rationale text;
  action_text text;
  priority public.recommendation_priority;
  parcel uuid;
  cycle_id uuid;
  visit_id uuid;
  open_request uuid := gen_random_uuid();
  visit_request uuid := gen_random_uuid();
  labor_request uuid := gen_random_uuid();
  visit_priority public.scouting_priority;
  visit_title text;
  visit_objective text;
  cycle_status public.outcome_cycle_status;
begin
  select recommendations.organization_id,
         recommendations.establishment_id,
         recommendations.title,
         recommendations.rationale,
         recommendations.action,
         recommendations.priority,
         recommendations.parcel_id
    into target_org, establishment, title, rationale, action_text, priority, parcel
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
    select cycle.id, cycle.status into cycle_id, cycle_status
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
      cycle_status := 'open'::public.outcome_cycle_status;
    end if;

    -- Bridge señal → labor: crear recorrida y enlazarla cuando hay lote.
    if parcel is not null
       and cycle_id is not null
       and cycle_status = 'open'::public.outcome_cycle_status then
      visit_priority := priority::text::public.scouting_priority;
      visit_title := left('Verificar: ' || coalesce(title, 'recomendación'), 160);
      visit_objective := left(
        coalesce(action_text, '') || E'\n\n' || coalesce(rationale, ''),
        1500
      );
      visit_id := public.create_scouting_visit_v2(
        establishment,
        parcel,
        null,
        visit_title,
        visit_objective,
        visit_priority,
        now() + interval '1 day',
        auth.uid(),
        visit_request
      );
      perform public.link_outcome_labor(
        cycle_id,
        'scouting_visit'::public.outcome_labor_kind,
        visit_id,
        labor_request
      );
    end if;
  end if;

  return cycle_id;
end;
$$;

comment on function public.set_recommendation_status(uuid, public.recommendation_status, text) is
  'Updates recommendation workflow. Accepting opens/reuses an Outcome cycle and, when a parcel exists, creates a Scout visit and links it as labor.';

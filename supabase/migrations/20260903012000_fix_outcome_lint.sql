-- Fix remaining Outcome Ledger lint: method_note ambiguity and event id type.

create or replace function public.link_outcome_labor(
  target_cycle uuid,
  labor_kind public.outcome_labor_kind,
  labor_ref uuid,
  request_id uuid
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  cycle_row public.outcome_cycles%rowtype;
  actor uuid := auth.uid();
  existing bigint;
  visit public.scouting_visits%rowtype;
  work_order public.maintenance_work_orders%rowtype;
  irrigation public.irrigation_events%rowtype;
  next_status public.outcome_cycle_status;
begin
  if actor is null then raise exception 'Not authenticated'; end if;
  if link_outcome_labor.request_id is null or labor_ref is null then raise exception 'Request ID and labor reference are required'; end if;

  select * into cycle_row from public.outcome_cycles where id=target_cycle for update;
  if cycle_row.id is null or not private.has_org_role(cycle_row.organization_id, array['owner','admin','agronomist','operator']::public.organization_role[]) then
    raise exception 'Not authorized';
  end if;
  select events.id into existing
    from public.outcome_cycle_events events
    where events.organization_id=cycle_row.organization_id and events.request_id=link_outcome_labor.request_id;
  if existing is not null then return target_cycle; end if;
  if cycle_row.status not in ('open','labor_linked') then raise exception 'Cycle cannot accept labor in its current status'; end if;
  if cycle_row.labor_kind is not null and cycle_row.status = 'labor_linked' then raise exception 'Labor already linked'; end if;

  if labor_kind = 'scouting_visit' then
    select * into visit from public.scouting_visits where id=labor_ref and establishment_id=cycle_row.establishment_id;
    if visit.id is null then raise exception 'Scouting visit not found'; end if;
    if cycle_row.parcel_id is not null and visit.parcel_id is distinct from cycle_row.parcel_id then
      raise exception 'Visit parcel does not match cycle';
    end if;
    update public.outcome_cycles set
      labor_kind='scouting_visit', scouting_visit_id=visit.id, work_order_id=null, irrigation_event_id=null,
      parcel_id=coalesce(cycle_row.parcel_id, visit.parcel_id),
      status='labor_linked', updated_at=now()
      where id=target_cycle;
  elsif labor_kind = 'maintenance_work_order' then
    select * into work_order from public.maintenance_work_orders where id=labor_ref and establishment_id=cycle_row.establishment_id;
    if work_order.id is null then raise exception 'Work order not found'; end if;
    update public.outcome_cycles set
      labor_kind='maintenance_work_order', work_order_id=work_order.id, scouting_visit_id=null, irrigation_event_id=null,
      status='labor_linked', updated_at=now()
      where id=target_cycle;
  else
    select * into irrigation from public.irrigation_events where id=labor_ref and establishment_id=cycle_row.establishment_id and reversal_of is null;
    if irrigation.id is null then raise exception 'Irrigation event not found'; end if;
    if exists(select 1 from public.irrigation_events r where r.reversal_of=irrigation.id) then raise exception 'Irrigation event was reversed'; end if;
    if cycle_row.parcel_id is not null and irrigation.parcel_id is distinct from cycle_row.parcel_id then
      raise exception 'Irrigation parcel does not match cycle';
    end if;
    update public.outcome_cycles set
      labor_kind='irrigation_event', irrigation_event_id=irrigation.id, scouting_visit_id=null, work_order_id=null,
      parcel_id=coalesce(cycle_row.parcel_id, irrigation.parcel_id),
      status='labor_linked', updated_at=now()
      where id=target_cycle;
  end if;

  next_status := 'labor_linked'::public.outcome_cycle_status;
  insert into public.outcome_cycle_events(organization_id,establishment_id,cycle_id,action,previous_status,next_status,details,request_id,actor_user_id)
  values(cycle_row.organization_id,cycle_row.establishment_id,target_cycle,'labor_linked',cycle_row.status,next_status,
    jsonb_build_object('labor_kind',labor_kind,'labor_ref',labor_ref),link_outcome_labor.request_id,actor);
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
  values(cycle_row.organization_id,cycle_row.establishment_id,'outcome_cycle',target_cycle,'status_changed',actor,
    jsonb_build_object('from',cycle_row.status,'to',next_status,'labor_kind',labor_kind));
  return target_cycle;
end;
$$;

create or replace function public.link_outcome_cost(
  target_cycle uuid,
  target_entry uuid,
  request_id uuid
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  cycle_row public.outcome_cycles%rowtype;
  entry_row public.financial_entries%rowtype;
  actor uuid := auth.uid();
  existing bigint;
begin
  if actor is null then raise exception 'Not authenticated'; end if;
  if link_outcome_cost.request_id is null or target_entry is null then raise exception 'Request ID and financial entry are required'; end if;

  select * into cycle_row from public.outcome_cycles where id=target_cycle for update;
  if cycle_row.id is null or not private.has_org_role(cycle_row.organization_id, array['owner','admin','agronomist']::public.organization_role[]) then
    raise exception 'Not authorized';
  end if;
  select events.id into existing
    from public.outcome_cycle_events events
    where events.organization_id=cycle_row.organization_id and events.request_id=link_outcome_cost.request_id;
  if existing is not null then return target_cycle; end if;
  if cycle_row.status not in ('open','labor_linked','cost_linked') then raise exception 'Cycle cannot accept cost in its current status'; end if;
  if cycle_row.financial_entry_id is not null and cycle_row.status in ('cost_linked','outcome_declared','internally_verified') then
    raise exception 'Cost already linked';
  end if;

  select * into entry_row from public.financial_entries where id=target_entry and establishment_id=cycle_row.establishment_id;
  if entry_row.id is null then raise exception 'Financial entry not found'; end if;
  if entry_row.reversal_of is not null then raise exception 'Cannot link a reversal entry'; end if;
  if exists(select 1 from public.financial_entries r where r.reversal_of=entry_row.id) then raise exception 'Financial entry was reversed'; end if;
  if cycle_row.parcel_id is not null and entry_row.parcel_id is not null and entry_row.parcel_id is distinct from cycle_row.parcel_id then
    raise exception 'Financial entry parcel does not match cycle';
  end if;

  update public.outcome_cycles set
    financial_entry_id=entry_row.id,
    status='cost_linked',
    result_category=null, result_amount=null, result_currency=null, method_note=null,
    updated_at=now()
  where id=target_cycle;

  insert into public.outcome_cycle_events(organization_id,establishment_id,cycle_id,action,previous_status,next_status,details,request_id,actor_user_id)
  values(cycle_row.organization_id,cycle_row.establishment_id,target_cycle,'cost_linked',cycle_row.status,'cost_linked',
    jsonb_build_object('financial_entry_id',entry_row.id,'amount',entry_row.amount,'currency',entry_row.currency,'direction',entry_row.direction),
    link_outcome_cost.request_id,actor);
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
  values(cycle_row.organization_id,cycle_row.establishment_id,'outcome_cycle',target_cycle,'status_changed',actor,
    jsonb_build_object('from',cycle_row.status,'to','cost_linked','financial_entry_id',entry_row.id));
  return target_cycle;
end;
$$;

create or replace function public.declare_outcome_result(
  target_cycle uuid,
  result_category public.outcome_result_category,
  method_note text,
  request_id uuid
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  cycle_row public.outcome_cycles%rowtype;
  entry_row public.financial_entries%rowtype;
  actor uuid := auth.uid();
  existing bigint;
begin
  if actor is null then raise exception 'Not authenticated'; end if;
  if declare_outcome_result.request_id is null then raise exception 'Request ID is required'; end if;
  if char_length(trim(declare_outcome_result.method_note)) not between 20 and 1500 then raise exception 'Method note must be between 20 and 1500 characters'; end if;

  select * into cycle_row from public.outcome_cycles where id=target_cycle for update;
  if cycle_row.id is null or not private.has_org_role(cycle_row.organization_id, array['owner','admin','agronomist']::public.organization_role[]) then
    raise exception 'Not authorized';
  end if;
  select events.id into existing
    from public.outcome_cycle_events events
    where events.organization_id=cycle_row.organization_id and events.request_id=declare_outcome_result.request_id;
  if existing is not null then return target_cycle; end if;
  if cycle_row.status <> 'cost_linked' or cycle_row.financial_entry_id is null then
    raise exception 'Link a financial entry before declaring an outcome';
  end if;

  select * into entry_row from public.financial_entries where id=cycle_row.financial_entry_id;
  if entry_row.id is null then raise exception 'Linked financial entry missing'; end if;

  update public.outcome_cycles set
    result_category=declare_outcome_result.result_category,
    result_amount=entry_row.amount,
    result_currency=entry_row.currency,
    method_note=trim(declare_outcome_result.method_note),
    status='outcome_declared',
    updated_at=now()
  where id=target_cycle;

  insert into public.outcome_cycle_events(organization_id,establishment_id,cycle_id,action,previous_status,next_status,details,request_id,actor_user_id)
  values(cycle_row.organization_id,cycle_row.establishment_id,target_cycle,'outcome_declared','cost_linked','outcome_declared',
    jsonb_build_object('category',declare_outcome_result.result_category,'amount',entry_row.amount,'currency',entry_row.currency),
    declare_outcome_result.request_id,actor);
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
  values(cycle_row.organization_id,cycle_row.establishment_id,'outcome_cycle',target_cycle,'status_changed',actor,
    jsonb_build_object('from','cost_linked','to','outcome_declared','category',declare_outcome_result.result_category));
  return target_cycle;
end;
$$;

create or replace function public.review_outcome_cycle(
  target_cycle uuid,
  accepted boolean,
  reviewer_note text,
  request_id uuid
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  cycle_row public.outcome_cycles%rowtype;
  actor uuid := auth.uid();
  existing bigint;
  next_status public.outcome_cycle_status;
begin
  if actor is null then raise exception 'Not authenticated'; end if;
  if review_outcome_cycle.request_id is null then raise exception 'Request ID is required'; end if;
  if char_length(trim(coalesce(reviewer_note,''))) not between 5 and 1000 then raise exception 'Review note is required'; end if;

  select * into cycle_row from public.outcome_cycles where id=target_cycle for update;
  if cycle_row.id is null or not private.has_org_role(cycle_row.organization_id, array['owner','admin']::public.organization_role[]) then
    raise exception 'Not authorized';
  end if;
  select events.id into existing
    from public.outcome_cycle_events events
    where events.organization_id=cycle_row.organization_id and events.request_id=review_outcome_cycle.request_id;
  if existing is not null then return target_cycle; end if;
  if cycle_row.status <> 'outcome_declared' then raise exception 'Only declared outcomes can be reviewed'; end if;
  if cycle_row.opened_by = actor then raise exception 'A second identity must review the outcome'; end if;

  next_status := case when accepted then 'internally_verified'::public.outcome_cycle_status else 'rejected'::public.outcome_cycle_status end;
  update public.outcome_cycles set
    status=next_status, reviewed_by=actor, reviewed_at=now(), review_note=trim(reviewer_note), updated_at=now()
  where id=target_cycle;

  insert into public.outcome_cycle_events(organization_id,establishment_id,cycle_id,action,previous_status,next_status,details,request_id,actor_user_id)
  values(cycle_row.organization_id,cycle_row.establishment_id,target_cycle,'reviewed','outcome_declared',next_status,
    jsonb_build_object('accepted',accepted,'review_note',trim(reviewer_note)),review_outcome_cycle.request_id,actor);
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
  values(cycle_row.organization_id,cycle_row.establishment_id,'outcome_cycle',target_cycle,'status_changed',actor,
    jsonb_build_object('from','outcome_declared','to',next_status));
  return target_cycle;
end;
$$;

-- NODO Outcome Ledger: verifiable signal → decision → labor → cost → result cycles.
-- Amounts only come from linked financial_entries. Internal verification ≠ external ROI.

create type public.outcome_signal_kind as enum (
  'satellite_metric','water_balance','recommendation','scouting_visit','manual'
);
create type public.outcome_labor_kind as enum (
  'scouting_visit','maintenance_work_order','irrigation_event'
);
create type public.outcome_cycle_status as enum (
  'open','labor_linked','cost_linked','outcome_declared','internally_verified','rejected'
);
create type public.outcome_result_category as enum (
  'avoided_loss','input_saving','labor_saving','maintenance_saving','incremental_income','other'
);

create table public.outcome_cycles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  parcel_id uuid references public.land_parcels(id) on delete set null,
  title text not null check (char_length(trim(title)) between 3 and 180),
  status public.outcome_cycle_status not null default 'open',
  signal_kind public.outcome_signal_kind not null,
  satellite_metric_id uuid references public.parcel_satellite_metrics(id) on delete set null,
  water_balance_id uuid references public.parcel_water_balances(id) on delete set null,
  recommendation_id uuid references public.recommendations(id) on delete set null,
  signal_scouting_visit_id uuid references public.scouting_visits(id) on delete set null,
  signal_snapshot jsonb not null check (jsonb_typeof(signal_snapshot)='object' and octet_length(signal_snapshot::text)<=8192),
  labor_kind public.outcome_labor_kind,
  scouting_visit_id uuid references public.scouting_visits(id) on delete set null,
  work_order_id uuid references public.maintenance_work_orders(id) on delete set null,
  irrigation_event_id uuid references public.irrigation_events(id) on delete set null,
  financial_entry_id uuid references public.financial_entries(id) on delete set null,
  result_category public.outcome_result_category,
  result_amount numeric(16,2) check (result_amount is null or (result_amount > 0 and result_amount <= 100000000000000)),
  result_currency text check (result_currency is null or result_currency ~ '^[A-Z]{3}$'),
  method_note text check (method_note is null or char_length(trim(method_note)) between 20 and 1500),
  limitations jsonb not null default '[]'::jsonb check (jsonb_typeof(limitations)='array' and octet_length(limitations::text)<=4096),
  opened_by uuid not null references auth.users(id) on delete restrict,
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, request_id),
  check (
    (signal_kind = 'satellite_metric' and satellite_metric_id is not null)
    or (signal_kind = 'water_balance' and water_balance_id is not null)
    or (signal_kind = 'recommendation' and recommendation_id is not null)
    or (signal_kind = 'scouting_visit' and signal_scouting_visit_id is not null)
    or (signal_kind = 'manual')
  ),
  check (
    (labor_kind is null and scouting_visit_id is null and work_order_id is null and irrigation_event_id is null)
    or (labor_kind = 'scouting_visit' and scouting_visit_id is not null and work_order_id is null and irrigation_event_id is null)
    or (labor_kind = 'maintenance_work_order' and work_order_id is not null and scouting_visit_id is null and irrigation_event_id is null)
    or (labor_kind = 'irrigation_event' and irrigation_event_id is not null and scouting_visit_id is null and work_order_id is null)
  ),
  check (
    (status in ('open') and labor_kind is null and financial_entry_id is null and result_category is null)
    or (status = 'labor_linked' and labor_kind is not null and financial_entry_id is null and result_category is null)
    or (status = 'cost_linked' and financial_entry_id is not null and result_category is null)
    or (status = 'outcome_declared' and financial_entry_id is not null and result_category is not null
        and result_amount is not null and result_currency is not null and method_note is not null
        and reviewed_by is null and reviewed_at is null)
    or (status in ('internally_verified','rejected') and financial_entry_id is not null and result_category is not null
        and result_amount is not null and result_currency is not null and method_note is not null
        and reviewed_by is not null and reviewed_at is not null)
  )
);

create table public.outcome_cycle_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  cycle_id uuid not null references public.outcome_cycles(id) on delete cascade,
  action text not null check (action in ('opened','labor_linked','cost_linked','outcome_declared','reviewed')),
  previous_status public.outcome_cycle_status,
  next_status public.outcome_cycle_status not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object' and octet_length(details::text)<=4096),
  request_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, request_id)
);

create index outcome_cycles_establishment_time_idx on public.outcome_cycles(establishment_id, created_at desc);
create index outcome_cycles_status_idx on public.outcome_cycles(establishment_id, status);
create index outcome_cycle_events_cycle_time_idx on public.outcome_cycle_events(cycle_id, created_at desc);

create function private.enforce_outcome_scope() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  establishment_org uuid;
  parcel_org uuid;
  parcel_establishment uuid;
begin
  select organization_id into establishment_org from public.establishments where id=new.establishment_id;
  if establishment_org is null or establishment_org <> new.organization_id then
    raise exception 'Outcome establishment scope mismatch';
  end if;
  if new.parcel_id is not null then
    select organization_id, establishment_id into parcel_org, parcel_establishment
      from public.land_parcels where id=new.parcel_id;
    if parcel_org is null or parcel_org <> new.organization_id or parcel_establishment <> new.establishment_id then
      raise exception 'Outcome parcel scope mismatch';
    end if;
  end if;
  return new;
end;
$$;

create trigger outcome_cycle_scope_guard
  before insert or update on public.outcome_cycles
  for each row execute function private.enforce_outcome_scope();

create trigger outcome_cycle_event_scope_guard
  before insert or update on public.outcome_cycle_events
  for each row execute function private.enforce_outcome_scope();

create or replace function public.open_outcome_cycle(
  target_establishment uuid,
  cycle_title text,
  signal_kind public.outcome_signal_kind,
  signal_ref uuid,
  manual_notes text,
  request_id uuid
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  target_org uuid;
  actor uuid := auth.uid();
  existing uuid;
  new_id uuid;
  parcel uuid;
  snapshot jsonb;
  initial_status public.outcome_cycle_status := 'open';
  labor public.outcome_labor_kind;
  visit_id uuid;
  metric public.parcel_satellite_metrics%rowtype;
  balance public.parcel_water_balances%rowtype;
  recommendation public.recommendations%rowtype;
  visit public.scouting_visits%rowtype;
begin
  if actor is null then raise exception 'Not authenticated'; end if;
  if request_id is null then raise exception 'Request ID is required'; end if;
  if char_length(trim(cycle_title)) not between 3 and 180 then raise exception 'Invalid title'; end if;

  select organization_id into target_org from public.establishments where id=target_establishment;
  if target_org is null or not private.has_org_role(target_org, array['owner','admin','agronomist','operator']::public.organization_role[]) then
    raise exception 'Not authorized';
  end if;

  select id into existing from public.outcome_cycles where organization_id=target_org and request_id=open_outcome_cycle.request_id;
  if existing is not null then return existing; end if;

  if signal_kind = 'satellite_metric' then
    if signal_ref is null then raise exception 'Signal reference is required'; end if;
    select * into metric from public.parcel_satellite_metrics where id=signal_ref and establishment_id=target_establishment;
    if metric.id is null then raise exception 'Satellite metric not found'; end if;
    parcel := metric.parcel_id;
    snapshot := jsonb_build_object(
      'kind','satellite_metric','metric_id',metric.id,'parcel_id',metric.parcel_id,
      'index_name',metric.index_name,'mean_value',metric.mean_value,'quality_status',metric.quality_status,
      'algorithm_version',metric.algorithm_version,'captured_at',metric.captured_at,'pixel_count',metric.pixel_count
    );
  elsif signal_kind = 'water_balance' then
    if signal_ref is null then raise exception 'Signal reference is required'; end if;
    select * into balance from public.parcel_water_balances where id=signal_ref and establishment_id=target_establishment;
    if balance.id is null then raise exception 'Water balance not found'; end if;
    parcel := balance.parcel_id;
    snapshot := jsonb_build_object(
      'kind','water_balance','balance_id',balance.id,'parcel_id',balance.parcel_id,
      'reference_balance_mm',balance.reference_balance_mm,'review_status',balance.review_status,
      'algorithm_version',balance.algorithm_version,'window_start',balance.window_start,'window_end',balance.window_end
    );
  elsif signal_kind = 'recommendation' then
    if signal_ref is null then raise exception 'Signal reference is required'; end if;
    select * into recommendation from public.recommendations where id=signal_ref and establishment_id=target_establishment;
    if recommendation.id is null then raise exception 'Recommendation not found'; end if;
    parcel := recommendation.parcel_id;
    snapshot := jsonb_build_object(
      'kind','recommendation','recommendation_id',recommendation.id,'parcel_id',recommendation.parcel_id,
      'title',recommendation.title,'priority',recommendation.priority,'confidence',recommendation.confidence,
      'status',recommendation.status,'evidence',recommendation.evidence,'expected_value',recommendation.expected_value
    );
  elsif signal_kind = 'scouting_visit' then
    if signal_ref is null then raise exception 'Signal reference is required'; end if;
    select * into visit from public.scouting_visits where id=signal_ref and establishment_id=target_establishment;
    if visit.id is null then raise exception 'Scouting visit not found'; end if;
    parcel := visit.parcel_id;
    visit_id := visit.id;
    labor := 'scouting_visit';
    initial_status := 'labor_linked';
    snapshot := jsonb_build_object(
      'kind','scouting_visit','visit_id',visit.id,'parcel_id',visit.parcel_id,
      'source_type',visit.source_type,'title',visit.title,'status',visit.status,
      'source_snapshot',visit.source_snapshot,'scheduled_for',visit.scheduled_for
    );
  else
    if char_length(trim(coalesce(manual_notes,''))) not between 20 and 800 then
      raise exception 'Manual signal requires notes between 20 and 800 characters';
    end if;
    snapshot := jsonb_build_object('kind','manual','notes',trim(manual_notes),'opened_at',now());
  end if;

  insert into public.outcome_cycles(
    organization_id,establishment_id,parcel_id,title,status,signal_kind,
    satellite_metric_id,water_balance_id,recommendation_id,signal_scouting_visit_id,signal_snapshot,
    labor_kind,scouting_visit_id,opened_by,request_id,limitations
  ) values (
    target_org,target_establishment,parcel,trim(cycle_title),initial_status,signal_kind,
    case when signal_kind='satellite_metric' then signal_ref else null end,
    case when signal_kind='water_balance' then signal_ref else null end,
    case when signal_kind='recommendation' then signal_ref else null end,
    case when signal_kind='scouting_visit' then signal_ref else null end,
    snapshot, labor, visit_id, actor, open_outcome_cycle.request_id,
    jsonb_build_array(
      'El ciclo enlaza evidencia operativa; no inventa montos.',
      'internally_verified no equivale a ROI externo ni auditoría contable.'
    )
  ) returning id into new_id;

  insert into public.outcome_cycle_events(organization_id,establishment_id,cycle_id,action,previous_status,next_status,details,request_id,actor_user_id)
  values(target_org,target_establishment,new_id,'opened',null,initial_status,jsonb_build_object('signal_kind',signal_kind,'signal_ref',signal_ref),open_outcome_cycle.request_id,actor);

  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
  values(target_org,target_establishment,'outcome_cycle',new_id,'created',actor,jsonb_build_object('signal_kind',signal_kind,'status',initial_status));

  return new_id;
end;
$$;

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
  existing uuid;
  visit public.scouting_visits%rowtype;
  work_order public.maintenance_work_orders%rowtype;
  irrigation public.irrigation_events%rowtype;
  next_status public.outcome_cycle_status;
begin
  if actor is null then raise exception 'Not authenticated'; end if;
  if request_id is null or labor_ref is null then raise exception 'Request ID and labor reference are required'; end if;

  select * into cycle_row from public.outcome_cycles where id=target_cycle for update;
  if cycle_row.id is null or not private.has_org_role(cycle_row.organization_id, array['owner','admin','agronomist','operator']::public.organization_role[]) then
    raise exception 'Not authorized';
  end if;
  select id into existing from public.outcome_cycle_events where organization_id=cycle_row.organization_id and request_id=link_outcome_labor.request_id;
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

  next_status := 'labor_linked';
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
  existing uuid;
begin
  if actor is null then raise exception 'Not authenticated'; end if;
  if request_id is null or target_entry is null then raise exception 'Request ID and financial entry are required'; end if;

  select * into cycle_row from public.outcome_cycles where id=target_cycle for update;
  if cycle_row.id is null or not private.has_org_role(cycle_row.organization_id, array['owner','admin','agronomist']::public.organization_role[]) then
    raise exception 'Not authorized';
  end if;
  select id into existing from public.outcome_cycle_events where organization_id=cycle_row.organization_id and request_id=link_outcome_cost.request_id;
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
  existing uuid;
begin
  if actor is null then raise exception 'Not authenticated'; end if;
  if request_id is null then raise exception 'Request ID is required'; end if;
  if char_length(trim(method_note)) not between 20 and 1500 then raise exception 'Method note must be between 20 and 1500 characters'; end if;

  select * into cycle_row from public.outcome_cycles where id=target_cycle for update;
  if cycle_row.id is null or not private.has_org_role(cycle_row.organization_id, array['owner','admin','agronomist']::public.organization_role[]) then
    raise exception 'Not authorized';
  end if;
  select id into existing from public.outcome_cycle_events where organization_id=cycle_row.organization_id and request_id=declare_outcome_result.request_id;
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
    method_note=trim(method_note),
    status='outcome_declared',
    updated_at=now()
  where id=target_cycle;

  insert into public.outcome_cycle_events(organization_id,establishment_id,cycle_id,action,previous_status,next_status,details,request_id,actor_user_id)
  values(cycle_row.organization_id,cycle_row.establishment_id,target_cycle,'outcome_declared','cost_linked','outcome_declared',
    jsonb_build_object('category',result_category,'amount',entry_row.amount,'currency',entry_row.currency),
    declare_outcome_result.request_id,actor);
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
  values(cycle_row.organization_id,cycle_row.establishment_id,'outcome_cycle',target_cycle,'status_changed',actor,
    jsonb_build_object('from','cost_linked','to','outcome_declared','category',result_category));
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
  existing uuid;
  next_status public.outcome_cycle_status;
begin
  if actor is null then raise exception 'Not authenticated'; end if;
  if request_id is null then raise exception 'Request ID is required'; end if;
  if char_length(trim(coalesce(reviewer_note,''))) not between 5 and 1000 then raise exception 'Review note is required'; end if;

  select * into cycle_row from public.outcome_cycles where id=target_cycle for update;
  if cycle_row.id is null or not private.has_org_role(cycle_row.organization_id, array['owner','admin']::public.organization_role[]) then
    raise exception 'Not authorized';
  end if;
  select id into existing from public.outcome_cycle_events where organization_id=cycle_row.organization_id and request_id=review_outcome_cycle.request_id;
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

create view public.outcome_ledger_summary
with (security_invoker=true) as
select
  cycle.establishment_id,
  cycle.organization_id,
  count(*) filter (where cycle.status not in ('rejected')) as open_or_active_cycles,
  count(*) filter (where cycle.status = 'internally_verified') as internally_verified_cycles,
  coalesce(sum(cycle.result_amount) filter (where cycle.status = 'internally_verified'), 0) as internally_verified_amount,
  max(cycle.updated_at) as last_updated_at
from public.outcome_cycles cycle
group by cycle.establishment_id, cycle.organization_id;

alter table public.operational_audit_events drop constraint if exists operational_audit_events_entity_type_check;
alter table public.operational_audit_events add constraint operational_audit_events_entity_type_check
  check (entity_type in (
    'livestock_group','livestock_event','machine_asset','machine_event','financial_entry',
    'maintenance_work_order','scouting_visit','scouting_finding','scouting_media','irrigation_event',
    'scouting_scan','outcome_cycle'
  ));

alter table public.outcome_cycles enable row level security;
alter table public.outcome_cycle_events enable row level security;

revoke all on public.outcome_cycles, public.outcome_cycle_events from public, anon, authenticated;
grant select on public.outcome_cycles, public.outcome_cycle_events, public.outcome_ledger_summary to authenticated;

create policy outcome_cycles_select on public.outcome_cycles for select to authenticated
  using (private.is_org_member(organization_id));
create policy outcome_cycle_events_select on public.outcome_cycle_events for select to authenticated
  using (private.is_org_member(organization_id));

revoke all on function private.enforce_outcome_scope() from public, anon, authenticated;
revoke all on function public.open_outcome_cycle(uuid,text,public.outcome_signal_kind,uuid,text,uuid) from public, anon;
revoke all on function public.link_outcome_labor(uuid,public.outcome_labor_kind,uuid,uuid) from public, anon;
revoke all on function public.link_outcome_cost(uuid,uuid,uuid) from public, anon;
revoke all on function public.declare_outcome_result(uuid,public.outcome_result_category,text,uuid) from public, anon;
revoke all on function public.review_outcome_cycle(uuid,boolean,text,uuid) from public, anon;

grant execute on function public.open_outcome_cycle(uuid,text,public.outcome_signal_kind,uuid,text,uuid) to authenticated;
grant execute on function public.link_outcome_labor(uuid,public.outcome_labor_kind,uuid,uuid) to authenticated;
grant execute on function public.link_outcome_cost(uuid,uuid,uuid) to authenticated;
grant execute on function public.declare_outcome_result(uuid,public.outcome_result_category,text,uuid) to authenticated;
grant execute on function public.review_outcome_cycle(uuid,boolean,text,uuid) to authenticated;

comment on table public.outcome_cycles is
  'Verifiable signal→labor→cost→result cycles. Amounts come only from linked financial_entries; internal verification is not external ROI.';
comment on column public.outcome_cycles.result_amount is
  'Copied from the linked financial entry at declaration time; never invented by the client.';

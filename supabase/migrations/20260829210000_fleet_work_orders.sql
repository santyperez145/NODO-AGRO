create type public.maintenance_work_type as enum ('preventive','corrective','inspection');
create type public.maintenance_priority as enum ('low','medium','high','critical');
create type public.maintenance_work_order_status as enum ('open','scheduled','in_progress','blocked','completed','cancelled');

create table public.maintenance_work_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  machine_id uuid not null references public.machine_assets(id) on delete restrict,
  work_type public.maintenance_work_type not null,
  title text not null check (char_length(title) between 2 and 160),
  description text check (description is null or char_length(description) <= 1500),
  priority public.maintenance_priority not null default 'medium',
  status public.maintenance_work_order_status not null default 'open',
  due_on date,
  responsible text check (responsible is null or char_length(responsible) <= 120),
  estimated_cost numeric(14,2) check (estimated_cost is null or estimated_cost >= 0),
  actual_cost numeric(14,2) check (actual_cost is null or actual_cost >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  opened_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  completion_notes text check (completion_notes is null or char_length(completion_notes) <= 1000),
  lock_version integer not null default 1 check (lock_version > 0),
  idempotency_key uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,idempotency_key)
);

create table public.maintenance_work_order_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  work_order_id uuid not null references public.maintenance_work_orders(id) on delete cascade,
  action text not null check (action in ('created','status_changed')),
  previous_status public.maintenance_work_order_status,
  next_status public.maintenance_work_order_status not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object'),
  idempotency_key uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id,idempotency_key)
);

create index maintenance_orders_establishment_status_idx on public.maintenance_work_orders(establishment_id,status,due_on);
create index maintenance_orders_machine_time_idx on public.maintenance_work_orders(machine_id,created_at desc);
create index maintenance_order_events_order_time_idx on public.maintenance_work_order_events(work_order_id,created_at desc);

alter table public.maintenance_work_orders enable row level security;
alter table public.maintenance_work_order_events enable row level security;

revoke all on public.maintenance_work_orders,public.maintenance_work_order_events from public,anon,authenticated;
grant select on public.maintenance_work_orders,public.maintenance_work_order_events to authenticated;

create policy maintenance_orders_select on public.maintenance_work_orders for select to authenticated
using (private.has_org_role(organization_id,array['owner','admin','agronomist','operator','viewer']::public.organization_role[]));
create policy maintenance_order_events_select on public.maintenance_work_order_events for select to authenticated
using (private.has_org_role(organization_id,array['owner','admin','agronomist','operator','viewer']::public.organization_role[]));

create function private.validate_maintenance_order_scope() returns trigger
language plpgsql security definer set search_path='' as $$
declare machine_scope record; establishment_currency text;
begin
  select organization_id,establishment_id into machine_scope from public.machine_assets where id=new.machine_id;
  if machine_scope.organization_id is distinct from new.organization_id or machine_scope.establishment_id is distinct from new.establishment_id then
    raise exception 'Machine does not belong to work order scope';
  end if;
  select base_currency into establishment_currency from public.establishments where id=new.establishment_id and organization_id=new.organization_id;
  if establishment_currency is null or new.currency<>establishment_currency then raise exception 'Work order currency must match establishment base currency'; end if;
  return new;
end $$;

create trigger maintenance_work_order_scope_guard before insert or update on public.maintenance_work_orders
for each row execute function private.validate_maintenance_order_scope();

create function public.create_machine_work_order(
  target_machine uuid,
  work_kind public.maintenance_work_type,
  order_title text,
  order_description text,
  order_priority public.maintenance_priority,
  due_date date,
  responsible_label text,
  expected_cost numeric,
  request_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare asset_row public.machine_assets%rowtype; establishment_currency text; existing_order uuid; new_order uuid;
begin
  select * into asset_row from public.machine_assets where id=target_machine;
  if asset_row.id is null or not private.has_org_role(asset_row.organization_id,array['owner','admin','agronomist','operator']::public.organization_role[]) then raise exception 'Not authorized'; end if;
  if asset_row.status='retired' then raise exception 'Asset is retired'; end if;
  if request_id is null then raise exception 'Request ID is required'; end if;
  select id into existing_order from public.maintenance_work_orders where organization_id=asset_row.organization_id and idempotency_key=request_id;
  if existing_order is not null then return existing_order; end if;
  if char_length(trim(order_title)) not between 2 and 160 then raise exception 'Invalid work order title'; end if;
  if order_description is not null and char_length(order_description)>1500 then raise exception 'Description is too long'; end if;
  if due_date is not null and due_date<current_date then raise exception 'Due date cannot be in the past'; end if;
  if responsible_label is not null and char_length(responsible_label)>120 then raise exception 'Responsible label is too long'; end if;
  if expected_cost is not null and expected_cost<0 then raise exception 'Estimated cost cannot be negative'; end if;
  select establishment.base_currency into establishment_currency from public.establishments establishment where establishment.id=asset_row.establishment_id and establishment.organization_id=asset_row.organization_id;

  insert into public.maintenance_work_orders(
    organization_id,establishment_id,machine_id,work_type,title,description,priority,due_on,responsible,estimated_cost,currency,idempotency_key,created_by,updated_by
  ) values (
    asset_row.organization_id,asset_row.establishment_id,asset_row.id,work_kind,trim(order_title),nullif(trim(order_description),''),order_priority,due_date,
    nullif(trim(responsible_label),''),expected_cost,establishment_currency,request_id,auth.uid(),auth.uid()
  ) returning id into new_order;
  insert into public.maintenance_work_order_events(organization_id,establishment_id,work_order_id,action,next_status,details,idempotency_key,created_by)
  values(asset_row.organization_id,asset_row.establishment_id,new_order,'created','open',jsonb_build_object('priority',order_priority,'due_on',due_date),request_id,auth.uid());
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
  values(asset_row.organization_id,asset_row.establishment_id,'maintenance_work_order',new_order,'created',auth.uid(),jsonb_build_object('machine_id',asset_row.id,'priority',order_priority,'work_type',work_kind));
  return new_order;
end $$;

create function public.transition_machine_work_order(
  target_order uuid,
  next_state public.maintenance_work_order_status,
  closing_note text,
  final_cost numeric,
  request_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare order_row public.maintenance_work_orders%rowtype; asset_row public.machine_assets%rowtype; existing_event bigint; allowed boolean:=false; machine_event_type public.machine_event_type;
begin
  select * into order_row from public.maintenance_work_orders where id=target_order for update;
  if order_row.id is null or not private.has_org_role(order_row.organization_id,array['owner','admin','agronomist','operator']::public.organization_role[]) then raise exception 'Not authorized'; end if;
  if request_id is null then raise exception 'Request ID is required'; end if;
  select id into existing_event from public.maintenance_work_order_events where organization_id=order_row.organization_id and idempotency_key=request_id;
  if existing_event is not null then return order_row.id; end if;
  if order_row.status in ('completed','cancelled') then raise exception 'Work order is closed'; end if;

  allowed :=
    (order_row.status='open' and next_state in ('scheduled','in_progress','cancelled')) or
    (order_row.status='scheduled' and next_state in ('open','in_progress','cancelled')) or
    (order_row.status='in_progress' and next_state in ('blocked','completed','cancelled')) or
    (order_row.status='blocked' and next_state in ('in_progress','cancelled'));
  if not allowed then raise exception 'Invalid work order transition'; end if;
  if next_state in ('completed','cancelled') and coalesce(char_length(trim(closing_note)),0) not between 2 and 1000 then raise exception 'Closing note is required'; end if;
  if next_state='completed' and (final_cost is null or final_cost<0) then raise exception 'Final cost is required and cannot be negative'; end if;

  update public.maintenance_work_orders set
    status=next_state,
    started_at=case when next_state='in_progress' then coalesce(started_at,now()) else started_at end,
    completed_at=case when next_state='completed' then now() else completed_at end,
    cancelled_at=case when next_state='cancelled' then now() else cancelled_at end,
    completion_notes=case when next_state in ('completed','cancelled') then trim(closing_note) else completion_notes end,
    actual_cost=case when next_state='completed' then final_cost else actual_cost end,
    lock_version=lock_version+1,updated_by=auth.uid(),updated_at=now()
  where id=order_row.id;

  insert into public.maintenance_work_order_events(organization_id,establishment_id,work_order_id,action,previous_status,next_status,details,idempotency_key,created_by)
  values(order_row.organization_id,order_row.establishment_id,order_row.id,'status_changed',order_row.status,next_state,
    jsonb_strip_nulls(jsonb_build_object('closing_note',nullif(trim(closing_note),''),'actual_cost',case when next_state='completed' then final_cost else null end)),request_id,auth.uid());

  if next_state='completed' then
    select * into asset_row from public.machine_assets where id=order_row.machine_id for update;
    machine_event_type:=case order_row.work_type when 'preventive' then 'service'::public.machine_event_type when 'corrective' then 'repair'::public.machine_event_type else 'inspection'::public.machine_event_type end;
    insert into public.machine_events(organization_id,establishment_id,machine_id,event_type,occurred_at,hours_delta,meter_hours,notes,idempotency_key,created_by)
    values(order_row.organization_id,order_row.establishment_id,order_row.machine_id,machine_event_type,now(),0,asset_row.current_hours,'OT completada: '||order_row.title,request_id,auth.uid());
    update public.machine_assets set
      last_service_hours=case when order_row.work_type='preventive' then current_hours else last_service_hours end,
      status='active',updated_at=now()
    where id=order_row.machine_id;
  end if;

  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
  values(order_row.organization_id,order_row.establishment_id,'maintenance_work_order',order_row.id,'status_changed',auth.uid(),jsonb_build_object('from',order_row.status,'to',next_state,'machine_id',order_row.machine_id));
  return order_row.id;
end $$;

revoke all on function public.create_machine_work_order(uuid,public.maintenance_work_type,text,text,public.maintenance_priority,date,text,numeric,uuid) from public,anon;
revoke all on function public.transition_machine_work_order(uuid,public.maintenance_work_order_status,text,numeric,uuid) from public,anon;
grant execute on function public.create_machine_work_order(uuid,public.maintenance_work_type,text,text,public.maintenance_priority,date,text,numeric,uuid) to authenticated;
grant execute on function public.transition_machine_work_order(uuid,public.maintenance_work_order_status,text,numeric,uuid) to authenticated;

drop view public.operational_summary;
create view public.operational_summary with (security_invoker=true) as
select
  establishment.id as establishment_id,
  establishment.organization_id,
  establishment.base_currency,
  coalesce((select sum(group_record.head_count) from public.livestock_groups group_record where group_record.establishment_id=establishment.id and group_record.status='active'),0)::bigint as livestock_heads,
  (select count(*) from public.livestock_groups group_record where group_record.establishment_id=establishment.id and group_record.status='active')::integer as active_livestock_groups,
  (select count(*) from public.machine_assets asset where asset.establishment_id=establishment.id and asset.status<>'retired')::integer as active_machines,
  (select count(*) from public.machine_assets asset where asset.establishment_id=establishment.id and asset.status<>'retired' and asset.current_hours>=asset.last_service_hours+asset.service_interval_hours)::integer as maintenance_due,
  coalesce((select sum(entry.amount) from public.financial_entries entry where entry.establishment_id=establishment.id and entry.currency=establishment.base_currency and entry.direction='income' and date_trunc('month',entry.occurred_on::timestamp)=date_trunc('month',current_date::timestamp)),0) as month_income,
  coalesce((select sum(entry.amount) from public.financial_entries entry where entry.establishment_id=establishment.id and entry.currency=establishment.base_currency and entry.direction='expense' and date_trunc('month',entry.occurred_on::timestamp)=date_trunc('month',current_date::timestamp)),0) as month_expense,
  (select max(event.occurred_at) from public.livestock_events event where event.establishment_id=establishment.id) as last_livestock_event_at,
  (select max(event.occurred_at) from public.machine_events event where event.establishment_id=establishment.id) as last_machine_event_at,
  (select max(entry.created_at) from public.financial_entries entry where entry.establishment_id=establishment.id) as last_financial_entry_at,
  (select count(*) from public.maintenance_work_orders work_order where work_order.establishment_id=establishment.id and work_order.status not in ('completed','cancelled'))::integer as open_work_orders,
  (select count(*) from public.maintenance_work_orders work_order where work_order.establishment_id=establishment.id and work_order.status not in ('completed','cancelled') and work_order.due_on<current_date)::integer as overdue_work_orders,
  coalesce((select sum(work_order.actual_cost) from public.maintenance_work_orders work_order where work_order.establishment_id=establishment.id and work_order.status='completed' and work_order.currency=establishment.base_currency and date_trunc('month',work_order.completed_at)=date_trunc('month',current_date::timestamp)),0) as month_maintenance_cost
from public.establishments establishment;

revoke all on public.operational_summary from public,anon,authenticated;
grant select on public.operational_summary to authenticated;

comment on table public.maintenance_work_orders is 'Tenant-scoped NODO Fleet work orders with guarded state transitions, planned and actual cost, and optimistic versioning.';
comment on table public.maintenance_work_order_events is 'Append-only work order history. Browser roles can read but cannot forge events.';
comment on function public.transition_machine_work_order(uuid,public.maintenance_work_order_status,text,numeric,uuid) is 'Applies an idempotent state-machine transition and creates the machine history event only when work is completed.';
comment on view public.operational_summary is 'Tenant-scoped operating KPIs including fleet work orders; security_invoker keeps underlying RLS authoritative.';

create or replace function public.record_livestock_event(
  target_group uuid,
  event_name public.livestock_event_type,
  occurred_at timestamptz,
  head_change integer,
  measured_average_weight_kg numeric,
  event_reason text,
  request_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  group_row public.livestock_groups%rowtype;
  existing_event uuid;
  new_event_id uuid;
  next_count integer;
begin
  select * into group_row from public.livestock_groups where id=target_group for update;
  if group_row.id is null or not private.has_org_role(group_row.organization_id,array['owner','admin','agronomist','operator']::public.organization_role[]) then raise exception 'Not authorized'; end if;
  if request_id is null then raise exception 'Request ID is required'; end if;
  select id into existing_event from public.livestock_events where organization_id=group_row.organization_id and idempotency_key=request_id;
  if existing_event is not null then return existing_event; end if;
  if event_name='initial_stock' then raise exception 'Initial stock is created with the group'; end if;
  if occurred_at is null or occurred_at > now() + interval '5 minutes' then raise exception 'Invalid event time'; end if;
  if event_reason is not null and char_length(event_reason)>500 then raise exception 'Reason is too long'; end if;
  if measured_average_weight_kg is not null and measured_average_weight_kg<=0 then raise exception 'Average weight must be positive'; end if;
  if head_change is null then raise exception 'Head change is required'; end if;
  if event_name in ('birth','purchase','transfer_in') and head_change<=0 then raise exception 'This event requires a positive head change'; end if;
  if event_name in ('sale','mortality','transfer_out') and head_change>=0 then raise exception 'This event requires a negative head change'; end if;
  if event_name='adjustment' and head_change=0 then raise exception 'Adjustment cannot be zero'; end if;
  if event_name='weighing' and (head_change<>0 or measured_average_weight_kg is null) then raise exception 'Weighing requires zero head change and an average weight'; end if;
  next_count:=group_row.head_count+head_change;
  if next_count<0 then raise exception 'Event would make head count negative'; end if;

  insert into public.livestock_events(organization_id,establishment_id,group_id,event_type,occurred_at,head_delta,resulting_head_count,average_weight_kg,reason,idempotency_key,created_by)
  values(group_row.organization_id,group_row.establishment_id,group_row.id,event_name,occurred_at,head_change,next_count,measured_average_weight_kg,nullif(trim(event_reason),''),request_id,auth.uid())
  returning id into new_event_id;
  update public.livestock_groups set head_count=next_count,average_weight_kg=coalesce(measured_average_weight_kg,average_weight_kg),status=(case when next_count=0 then 'closed' else 'active' end)::public.livestock_group_status,last_observed_at=occurred_at,updated_at=now() where id=group_row.id;
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
  values(group_row.organization_id,group_row.establishment_id,'livestock_event',new_event_id,'event_recorded',auth.uid(),jsonb_build_object('group_id',group_row.id,'event_type',event_name,'head_delta',head_change,'resulting_head_count',next_count));
  return new_event_id;
end $$;

create or replace function public.record_machine_event(
  target_machine uuid,
  event_name public.machine_event_type,
  occurred_at timestamptz,
  usage_hours numeric,
  event_notes text,
  request_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  asset_row public.machine_assets%rowtype;
  existing_event uuid;
  new_event_id uuid;
  next_hours numeric;
begin
  select * into asset_row from public.machine_assets where id=target_machine for update;
  if asset_row.id is null or not private.has_org_role(asset_row.organization_id,array['owner','admin','agronomist','operator']::public.organization_role[]) then raise exception 'Not authorized'; end if;
  if asset_row.status='retired' then raise exception 'Asset is retired'; end if;
  if request_id is null then raise exception 'Request ID is required'; end if;
  select id into existing_event from public.machine_events where organization_id=asset_row.organization_id and idempotency_key=request_id;
  if existing_event is not null then return existing_event; end if;
  if occurred_at is null or occurred_at>now()+interval '5 minutes' then raise exception 'Invalid event time'; end if;
  if event_notes is not null and char_length(event_notes)>1000 then raise exception 'Notes are too long'; end if;
  if usage_hours is null then raise exception 'Usage hours are required'; end if;
  if event_name='usage' and usage_hours<=0 then raise exception 'Usage hours must be positive'; end if;
  if event_name<>'usage' and usage_hours<>0 then raise exception 'Only usage events accept hours'; end if;
  next_hours:=asset_row.current_hours+usage_hours;
  insert into public.machine_events(organization_id,establishment_id,machine_id,event_type,occurred_at,hours_delta,meter_hours,notes,idempotency_key,created_by)
  values(asset_row.organization_id,asset_row.establishment_id,asset_row.id,event_name,occurred_at,usage_hours,next_hours,nullif(trim(event_notes),''),request_id,auth.uid())
  returning id into new_event_id;
  update public.machine_assets set current_hours=next_hours,last_service_hours=case when event_name='service' then next_hours else last_service_hours end,status=(case when event_name='repair' then 'maintenance' else 'active' end)::public.machine_status,updated_at=now() where id=asset_row.id;
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
  values(asset_row.organization_id,asset_row.establishment_id,'machine_event',new_event_id,'event_recorded',auth.uid(),jsonb_build_object('machine_id',asset_row.id,'event_type',event_name,'meter_hours',next_hours));
  return new_event_id;
end $$;

create or replace function public.reverse_financial_entry(target_entry uuid, reversal_reason text, request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare entry_row public.financial_entries%rowtype; existing_entry uuid; new_entry_id uuid;
begin
  select * into entry_row from public.financial_entries where id=target_entry;
  if entry_row.id is null or not private.has_org_role(entry_row.organization_id,array['owner','admin']::public.organization_role[]) then raise exception 'Not authorized'; end if;
  if entry_row.reversal_of is not null then raise exception 'A reversal cannot be reversed'; end if;
  if request_id is null then raise exception 'Request ID is required'; end if;
  select id into existing_entry from public.financial_entries where organization_id=entry_row.organization_id and idempotency_key=request_id;
  if existing_entry is not null then return existing_entry; end if;
  if exists(select 1 from public.financial_entries where reversal_of=entry_row.id) then raise exception 'Entry is already reversed'; end if;
  if char_length(trim(reversal_reason)) not between 2 and 300 then raise exception 'Reversal reason is required'; end if;
  insert into public.financial_entries(organization_id,establishment_id,parcel_id,machine_id,direction,occurred_on,category,amount,currency,description,reference,reversal_of,idempotency_key,created_by)
  values(entry_row.organization_id,entry_row.establishment_id,entry_row.parcel_id,entry_row.machine_id,(case when entry_row.direction='income' then 'expense' else 'income' end)::public.financial_direction,current_date,entry_row.category,entry_row.amount,entry_row.currency,'Reversión: '||trim(reversal_reason),entry_row.reference,entry_row.id,request_id,auth.uid())
  returning id into new_entry_id;
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
  values(entry_row.organization_id,entry_row.establishment_id,'financial_entry',new_entry_id,'reversed',auth.uid(),jsonb_build_object('reversal_of',entry_row.id,'reason',trim(reversal_reason)));
  return new_entry_id;
end $$;

comment on function public.record_livestock_event(uuid,public.livestock_event_type,timestamptz,integer,numeric,text,uuid) is 'Records an idempotent livestock event under a row lock and prevents negative stock.';
comment on function public.record_machine_event(uuid,public.machine_event_type,timestamptz,numeric,text,uuid) is 'Records idempotent usage and maintenance events and derives the asset meter state.';
comment on function public.reverse_financial_entry(uuid,text,uuid) is 'Corrects an immutable ledger entry by creating exactly one opposite-direction entry.';

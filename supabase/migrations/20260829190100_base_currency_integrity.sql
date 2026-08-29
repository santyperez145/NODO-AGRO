alter table public.establishments
  add column base_currency text not null default 'ARS',
  add constraint establishments_base_currency_iso check (base_currency ~ '^[A-Z]{3}$');

create or replace function public.record_financial_entry(
  target_establishment uuid,
  target_parcel uuid,
  target_machine uuid,
  entry_direction public.financial_direction,
  entry_date date,
  entry_category text,
  entry_amount numeric,
  entry_currency text,
  entry_description text,
  entry_reference text,
  request_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare target_org uuid; establishment_currency text; parcel_establishment uuid; machine_establishment uuid; existing_entry uuid; new_entry_id uuid;
begin
  select organization_id,base_currency into target_org,establishment_currency from public.establishments where id=target_establishment;
  if target_org is null or not private.has_org_role(target_org,array['owner','admin']::public.organization_role[]) then raise exception 'Not authorized'; end if;
  if request_id is null then raise exception 'Request ID is required'; end if;
  select id into existing_entry from public.financial_entries where organization_id=target_org and idempotency_key=request_id;
  if existing_entry is not null then return existing_entry; end if;
  if entry_date is null or entry_date>current_date+1 then raise exception 'Invalid entry date'; end if;
  if char_length(trim(entry_category)) not between 2 and 80 then raise exception 'Invalid category'; end if;
  if entry_amount<=0 then raise exception 'Amount must be positive'; end if;
  entry_currency:=upper(trim(entry_currency));
  if entry_currency<>establishment_currency then raise exception 'Entry currency must match establishment base currency (%)',establishment_currency; end if;
  if char_length(trim(entry_description)) not between 2 and 500 then raise exception 'Invalid description'; end if;
  if entry_reference is not null and char_length(entry_reference)>120 then raise exception 'Reference is too long'; end if;
  if target_parcel is not null then
    select establishment_id into parcel_establishment from public.land_parcels where id=target_parcel and organization_id=target_org;
    if parcel_establishment is distinct from target_establishment then raise exception 'Parcel does not belong to establishment'; end if;
  end if;
  if target_machine is not null then
    select establishment_id into machine_establishment from public.machine_assets where id=target_machine and organization_id=target_org;
    if machine_establishment is distinct from target_establishment then raise exception 'Machine does not belong to establishment'; end if;
  end if;
  insert into public.financial_entries(organization_id,establishment_id,parcel_id,machine_id,direction,occurred_on,category,amount,currency,description,reference,idempotency_key,created_by)
  values(target_org,target_establishment,target_parcel,target_machine,entry_direction,entry_date,trim(entry_category),entry_amount,entry_currency,trim(entry_description),nullif(trim(entry_reference),''),request_id,auth.uid())
  returning id into new_entry_id;
  insert into public.operational_audit_events(organization_id,establishment_id,entity_type,entity_id,action,actor_user_id,details)
  values(target_org,target_establishment,'financial_entry',new_entry_id,'created',auth.uid(),jsonb_build_object('direction',entry_direction,'amount',entry_amount,'currency',entry_currency));
  return new_entry_id;
end $$;

drop view public.operational_summary;
create view public.operational_summary
with (security_invoker = true) as
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
  (select max(entry.created_at) from public.financial_entries entry where entry.establishment_id=establishment.id) as last_financial_entry_at
from public.establishments establishment;

revoke all on public.operational_summary from public,anon,authenticated;
grant select on public.operational_summary to authenticated;

comment on column public.establishments.base_currency is 'ISO 4217 operating currency used for comparable financial KPIs. Cross-currency entries require a future explicit FX contract.';
comment on view public.operational_summary is 'Tenant-scoped KPIs in each establishment base currency; security_invoker keeps underlying RLS authoritative.';

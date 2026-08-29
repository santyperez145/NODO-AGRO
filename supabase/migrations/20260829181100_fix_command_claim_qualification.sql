create or replace function public.claim_device_command(target_device uuid)
returns table(id uuid,command_type text,payload jsonb,expires_at timestamptz,delivery_attempts integer)
language plpgsql security definer set search_path = '' as $$
declare
  command_row public.device_commands%rowtype;
begin
  with expired as (
    update public.device_commands command set status='expired',acknowledged_at=now(),lease_until=null
      where command.device_id=target_device
        and command.status in ('queued','delivered')
        and command.expires_at<=now()
      returning command.organization_id,command.device_id,command.id
  ) insert into public.device_command_events(organization_id,device_id,command_id,event_type,actor_type)
    select expired.organization_id,expired.device_id,expired.id,'expired','system' from expired;

  select command.* into command_row from public.device_commands command
    where command.device_id=target_device
      and command.status in ('queued','delivered')
      and command.not_before<=now() and command.expires_at>now()
      and (command.status='queued' or command.lease_until is null or command.lease_until<=now())
      and command.delivery_attempts<10
    order by command.created_at
    for update skip locked
    limit 1;
  if command_row.id is null then return; end if;

  update public.device_commands command set
    status='delivered',
    delivered_at=coalesce(command.delivered_at,now()),
    lease_until=now()+interval '90 seconds',
    delivery_attempts=command.delivery_attempts+1
    where command.id=command_row.id
    returning command.* into command_row;
  insert into public.device_command_events(organization_id,device_id,command_id,event_type,actor_type,details)
    values(command_row.organization_id,target_device,command_row.id,'delivered','device',jsonb_build_object('attempt',command_row.delivery_attempts));
  return query select command_row.id,command_row.command_type,command_row.payload,command_row.expires_at,command_row.delivery_attempts;
end $$;

revoke all on function public.claim_device_command(uuid) from public,anon,authenticated;
grant execute on function public.claim_device_command(uuid) to service_role;

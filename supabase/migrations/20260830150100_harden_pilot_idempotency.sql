create or replace function public.transition_pilot_program(target_program uuid, next_status public.pilot_program_status, closing_note text, request_id uuid)
returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  actor_user uuid:=auth.uid();
  program_row public.pilot_programs%rowtype;
  establishment_row public.establishments%rowtype;
  actor_role public.organization_role;
  local_end date;
  snapshot_id uuid;
begin
  if actor_user is null then raise exception 'authentication_required'; end if;
  select * into program_row from public.pilot_programs where id=target_program for update;
  if not found then raise exception 'pilot_not_found'; end if;
  actor_role:=private.team_actor_role(program_row.organization_id,actor_user);
  if actor_role is null or actor_role not in ('owner','admin') then raise exception 'insufficient_role'; end if;
  if next_status not in ('completed','cancelled') then raise exception 'invalid_pilot_transition'; end if;
  if program_row.status=next_status then return program_row.id; end if;
  if program_row.status<>'active' then raise exception 'invalid_pilot_transition'; end if;
  if closing_note is null or char_length(trim(closing_note)) not between 10 and 1000 then raise exception 'closing_note_required'; end if;
  select * into establishment_row from public.establishments where id=program_row.establishment_id;
  local_end:=(now() at time zone establishment_row.timezone)::date;

  if next_status='completed' then
    insert into public.pilot_snapshots(organization_id,establishment_id,program_id,snapshot_type,window_start_on,window_end_on,metrics,limitations,source_version,captured_by,request_id)
    values(program_row.organization_id,program_row.establishment_id,program_row.id,'final',program_row.started_on,local_end,private.build_pilot_metrics(program_row.establishment_id,program_row.started_on,local_end),private.pilot_limitations(),'pilot-metrics-v1',actor_user,request_id)
    on conflict(program_id,snapshot_type,window_end_on) do nothing returning id into snapshot_id;
  end if;
  update public.pilot_programs set status=next_status,completed_at=case when next_status='completed' then now() else null end,cancelled_at=case when next_status='cancelled' then now() else null end,updated_by=actor_user,updated_at=now() where id=target_program;
  insert into public.pilot_audit_events(organization_id,establishment_id,program_id,entity_type,entity_id,action,actor_user_id,details)
  values(program_row.organization_id,program_row.establishment_id,program_row.id,'pilot_program',program_row.id,'status_changed',actor_user,jsonb_build_object('previous_status',program_row.status,'next_status',next_status,'closing_note',trim(closing_note),'final_snapshot_id',snapshot_id,'request_id',request_id));
  return program_row.id;
end
$$;

create or replace function public.record_pilot_value_claim(
  target_program uuid,
  value_category public.pilot_value_category,
  value_amount numeric,
  value_calculation_method text,
  value_evidence_reference text,
  request_id uuid
)
returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  actor_user uuid:=auth.uid();
  program_row public.pilot_programs%rowtype;
  establishment_row public.establishments%rowtype;
  actor_role public.organization_role;
  claim_id uuid;
begin
  if actor_user is null then raise exception 'authentication_required'; end if;
  select * into program_row from public.pilot_programs where id=target_program;
  if not found then raise exception 'pilot_not_found'; end if;
  if program_row.status='cancelled' then raise exception 'cancelled_pilot_rejects_value'; end if;
  actor_role:=private.team_actor_role(program_row.organization_id,actor_user);
  if actor_role is null or actor_role not in ('owner','admin') then raise exception 'insufficient_role'; end if;
  if value_amount<=0 or value_amount>100000000000000 then raise exception 'invalid_value_amount'; end if;
  if char_length(trim(value_calculation_method)) not between 20 and 1500 or char_length(trim(value_evidence_reference)) not between 5 and 500 then raise exception 'insufficient_value_evidence'; end if;
  select * into establishment_row from public.establishments where id=program_row.establishment_id;
  select claim.id into claim_id from public.pilot_value_claims claim where claim.organization_id=program_row.organization_id and claim.request_id=record_pilot_value_claim.request_id;
  if claim_id is not null then return claim_id; end if;

  insert into public.pilot_value_claims(organization_id,establishment_id,program_id,category,amount,currency,calculation_method,evidence_reference,claimed_by,request_id)
  values(program_row.organization_id,program_row.establishment_id,program_row.id,value_category,value_amount,establishment_row.base_currency,trim(value_calculation_method),trim(value_evidence_reference),actor_user,request_id)
  returning id into claim_id;
  insert into public.pilot_audit_events(organization_id,establishment_id,program_id,entity_type,entity_id,action,actor_user_id,details)
  values(program_row.organization_id,program_row.establishment_id,program_row.id,'pilot_value_claim',claim_id,'value_declared',actor_user,jsonb_build_object('category',value_category,'amount',value_amount,'currency',establishment_row.base_currency));
  return claim_id;
end
$$;

create or replace function public.review_pilot_value_claim(target_claim uuid, accepted boolean, reviewer_note text, request_id uuid)
returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  actor_user uuid:=auth.uid();
  claim_row public.pilot_value_claims%rowtype;
  actor_role public.organization_role;
  next_status public.pilot_claim_status;
begin
  if actor_user is null then raise exception 'authentication_required'; end if;
  select * into claim_row from public.pilot_value_claims where id=target_claim for update;
  if not found then raise exception 'claim_not_found'; end if;
  actor_role:=private.team_actor_role(claim_row.organization_id,actor_user);
  if actor_role is null or actor_role not in ('owner','admin') then raise exception 'insufficient_role'; end if;
  next_status:=case when accepted then 'internally_verified'::public.pilot_claim_status else 'rejected'::public.pilot_claim_status end;
  if claim_row.status=next_status and claim_row.reviewed_by=actor_user then return claim_row.id; end if;
  if claim_row.status<>'declared' then raise exception 'claim_already_reviewed'; end if;
  if accepted and claim_row.claimed_by=actor_user then raise exception 'independent_reviewer_required'; end if;
  if reviewer_note is null or char_length(trim(reviewer_note)) not between 10 and 1000 then raise exception 'review_note_required'; end if;
  update public.pilot_value_claims set status=next_status,reviewed_by=actor_user,reviewed_at=now(),review_note=trim(reviewer_note),updated_at=now() where id=target_claim;
  insert into public.pilot_audit_events(organization_id,establishment_id,program_id,entity_type,entity_id,action,actor_user_id,details)
  values(claim_row.organization_id,claim_row.establishment_id,claim_row.program_id,'pilot_value_claim',claim_row.id,'value_reviewed',actor_user,jsonb_build_object('status',next_status,'review_note',trim(reviewer_note),'request_id',request_id));
  return claim_row.id;
end
$$;

revoke all on function public.transition_pilot_program(uuid,public.pilot_program_status,text,uuid) from public,anon;
revoke all on function public.record_pilot_value_claim(uuid,public.pilot_value_category,numeric,text,text,uuid) from public,anon;
revoke all on function public.review_pilot_value_claim(uuid,boolean,text,uuid) from public,anon;
grant execute on function public.transition_pilot_program(uuid,public.pilot_program_status,text,uuid) to authenticated;
grant execute on function public.record_pilot_value_claim(uuid,public.pilot_value_category,numeric,text,text,uuid) to authenticated;
grant execute on function public.review_pilot_value_claim(uuid,boolean,text,uuid) to authenticated;

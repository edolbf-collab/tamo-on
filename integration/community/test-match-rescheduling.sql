-- All fixtures and changes roll back; no notification is sent by these RPCs.
begin;
do $$
declare c marketplace_pilot.config%rowtype; mid uuid; sibling uuid; pid uuid;
 series uuid:=gen_random_uuid(); occurrence uuid:=gen_random_uuid(); result jsonb;
 old_start timestamptz:=now()+interval '10 days'; new_start timestamptz:=now()+interval '12 days';
 claims jsonb; original_role text; current_status text; before_attendance jsonb; before_team jsonb;
begin
 select * into strict c from marketplace_pilot.config where singleton;
 select jsonb_build_object('role','authenticated','sub',id,'email',email) into claims from auth.users where id=c.user_id;
 perform set_config('request.jwt.claims',claims::text,true);
 if not public.can_manage_matches(c.group_id) then raise exception 'Fixture organizer lacks access'; end if;
 insert into public.matches(group_id,title,starts_at,location,created_by,recurrence_series_id,recurrence_index,recurrence_total,confirmation_deadline,bbq_enabled,bbq_price)
 values(c.group_id,'Rollback reschedule test',old_start,'Test location',c.user_id,series,1,2,old_start-interval '1 day',true,25) returning id into mid;
 insert into public.matches(group_id,title,starts_at,location,created_by,recurrence_series_id,recurrence_index,recurrence_total)
 values(c.group_id,'Rollback sibling',old_start+interval '7 days','Test location',c.user_id,series,2,2) returning id into sibling;
 insert into public.players(group_id,name) values(c.group_id,'Rollback guest') returning id into pid;
 insert into public.match_attendance(group_id,match_id,player_id,status,bbq,bbq_guests,bbq_note)
 values(c.group_id,mid,pid,'confirmed',true,2,'Keep attendance');
 insert into public.team_assignments(group_id,match_id,player_id,team_name) values(c.group_id,mid,pid,'A');
 select to_jsonb(a) into before_attendance from public.match_attendance a where match_id=mid;
 select to_jsonb(t) into before_team from public.team_assignments t where match_id=mid;
 if public.community_match_edit_context(mid)->>'can_reschedule'<>'true' then raise exception 'Manual event not editable'; end if;
 result:=public.reschedule_manual_match(mid,c.group_id,new_start,old_start,12,null,90,'Updated notes');
 if result->>'schedule_changed'<>'true' or result->>'change_id' is null then raise exception 'Change audit missing'; end if;
 if not exists(select 1 from public.matches where id=mid and starts_at=new_start and duration_minutes=90 and notes='Updated notes'
   and confirmation_deadline=new_start-interval '1 day' and bbq_enabled and bbq_price=25 and recurrence_series_id=series and recurrence_index=1) then raise exception 'Settings or deadline inconsistent'; end if;
 if (select starts_at from public.matches where id=sibling)<>old_start+interval '7 days' then raise exception 'Sibling changed'; end if;
 if (select to_jsonb(a) from public.match_attendance a where match_id=mid) is distinct from before_attendance then raise exception 'Attendance changed'; end if;
 if (select to_jsonb(t) from public.team_assignments t where match_id=mid) is distinct from before_team then raise exception 'Teams changed'; end if;
 result:=public.reschedule_manual_match(mid,c.group_id,new_start,new_start,12,null,90,'Updated notes');
 if result->>'schedule_changed'<>'false' or result->>'change_id' is not null then raise exception 'Unchanged date produced notification'; end if;
 begin
  perform public.reschedule_manual_match(mid,c.group_id,new_start+interval '1 day',old_start,12,null,90,'Stale');
  raise exception using errcode='ZX001',message='Stale date accepted';
 exception when raise_exception then if sqlerrm not like 'A data deste evento mudou%' then raise; end if; end;
 begin
  perform public.reschedule_manual_match(mid,c.group_id,now()-interval '1 day',new_start,12,null,90,'Past');
  raise exception using errcode='ZX001',message='Past date accepted';
 exception when raise_exception then if sqlerrm not like 'Informe uma data%' then raise; end if; end;
 begin
  perform public.reschedule_manual_match(mid,c.group_id,new_start+interval '1 day',new_start,3,null,90,'Invalid capacity');
  raise exception using errcode='ZX001',message='Invalid settings accepted';
 exception when raise_exception then if sqlerrm not like 'Quantidade máxima%' then raise; end if; end;
 if (select starts_at from public.matches where id=mid)<>new_start then raise exception 'Rejected request changed date'; end if;
 begin
  perform public.reschedule_manual_match(mid,gen_random_uuid(),new_start+interval '1 day',new_start,12,null,90,'Foreign group');
  raise exception using errcode='ZX001',message='Foreign group accepted';
 exception when raise_exception then if sqlerrm not like 'Sem permissão%' then raise; end if; end;
 foreach current_status in array array['cancelled','finished','in_progress','draft'] loop
  update public.matches set status=current_status where id=mid;
  if public.community_match_edit_context(mid)->>'can_reschedule'<>'false' then raise exception 'Closed edit exposed'; end if;
  begin
   perform public.reschedule_manual_match(mid,c.group_id,new_start+interval '1 day',new_start,12,null,90,'Closed');
   raise exception using errcode='ZX001',message='Closed event accepted';
  exception when raise_exception then if sqlerrm not like 'Somente eventos agendados%' then raise; end if; end;
 end loop;
 update public.matches set status='scheduled',starts_at=now()-interval '1 hour' where id=mid;
 begin
  perform public.reschedule_manual_match(mid,c.group_id,new_start,now()-interval '1 hour',12,null,90,'Started');
  raise exception using errcode='ZX001',message='Started event accepted';
 exception when raise_exception then if sqlerrm not like 'Somente eventos agendados%' then raise; end if; end;
 update public.matches set starts_at=new_start where id=mid;
 insert into marketplace_pilot.events(occurrence_id,reservation_id,event_id,group_id,match_id,managed,state,source_updated_at,payload)
 values(occurrence,gen_random_uuid(),gen_random_uuid(),c.group_id,mid,true,'published',now(),'{}');
 if public.community_match_edit_context(mid)->>'can_reschedule'<>'false' then raise exception 'Marketplace edit exposed'; end if;
 begin
  perform public.reschedule_manual_match(mid,c.group_id,new_start+interval '1 day',new_start,12,null,90,'Marketplace');
  raise exception using errcode='ZX001',message='Marketplace event accepted';
 exception when raise_exception then if sqlerrm not like 'Este evento está vinculado%' then raise; end if; end;
 update marketplace_pilot.events set managed=false where occurrence_id=occurrence;
 begin
  perform public.reschedule_manual_match(mid,c.group_id,new_start+interval '1 day',new_start,12,null,90,'Manual linked');
  raise exception using errcode='ZX001',message='Linked manual event accepted';
 exception when raise_exception then if sqlerrm not like 'Este evento está vinculado%' then raise; end if; end;
 update marketplace_pilot.events set state='cancelled' where occurrence_id=occurrence;
 if public.community_match_edit_context(mid)->>'can_reschedule'<>'true' then raise exception 'Released manual event blocked'; end if;
 update marketplace_pilot.events set managed=true where occurrence_id=occurrence;
 if public.community_match_edit_context(mid)->>'can_reschedule'<>'false' then raise exception 'Managed cancelled event editable'; end if;
 -- Unchanged five-argument API remains available for existing clients.
 perform public.update_match_settings(mid,12,null,60,'Legacy settings');
 if (select starts_at from public.matches where id=mid)<>new_start then raise exception 'Legacy settings changed date'; end if;
 select role into original_role from public.group_members where group_id=c.group_id and user_id=c.user_id;
 update public.group_members set role='member' where group_id=c.group_id and user_id=c.user_id;
 begin
  perform public.reschedule_manual_match(mid,c.group_id,new_start+interval '1 day',new_start,12,null,90,'Not organizer');
  raise exception using errcode='ZX001',message='Member accepted';
 exception when raise_exception then if sqlerrm not like 'Sem permissão%' then raise; end if; end;
 begin
  perform public.community_match_edit_context(mid);
  raise exception using errcode='ZX001',message='Member read edit context';
 exception when raise_exception then if sqlerrm not like 'Sem permissão%' then raise; end if; end;
 update public.group_members set role=original_role where group_id=c.group_id and user_id=c.user_id;
 if has_function_privilege('anon','public.community_match_edit_context(uuid)','execute')
 or has_function_privilege('anon','public.reschedule_manual_match(uuid,uuid,timestamptz,timestamptz,integer,integer,integer,text)','execute')
 or not has_function_privilege('authenticated','public.reschedule_manual_match(uuid,uuid,timestamptz,timestamptz,integer,integer,integer,text)','execute') then raise exception 'Incorrect API grants'; end if;
 perform set_config('request.jwt.claims','{"role":"anon"}',true);
 begin
  perform public.community_match_edit_context(mid);
  raise exception using errcode='ZX001',message='Anonymous context accepted';
 exception when sqlstate 'PT403' then null; when raise_exception then if sqlerrm not like 'Usuário não autenticado%' then raise; end if; end;
end $$;
rollback;
select 'PASS: dates, atomic settings, attendance, teams, recurrence, deadline, stale edits, past/closed events, Marketplace links, authorization and legacy API' as result;

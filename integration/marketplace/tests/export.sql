begin;
do $$
declare c private.community_marketplace_pilot%rowtype;g uuid;sp uuid;sid uuid:=gen_random_uuid();rid uuid;payload jsonb;out jsonb;owner_session uuid;
begin
 select * into strict c from private.community_marketplace_pilot where singleton;
 select id into strict owner_session from auth.sessions where user_id=c.marketplace_user_id and (not_after is null or not_after>now()) order by created_at desc limit 1;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 g:=public.pilot_import_community_group(jsonb_build_object('group_id',c.community_group_id,'user_id',c.community_user_id,'name','Teste FC','events','[]'::jsonb));
 if public.pilot_import_community_group(jsonb_build_object('group_id',c.community_group_id,'user_id',c.community_user_id,'name','Teste FC','events','[]'::jsonb))<>g then raise exception 'Group duplicated'; end if;
 begin perform public.pilot_import_community_group(jsonb_build_object('group_id',gen_random_uuid(),'user_id',c.community_user_id)); raise exception 'Foreign group accepted';exception when sqlstate 'PT403' then null;end;
 select vs.id into strict sp from public.venue_spaces vs join public.venues v on v.id=vs.venue_id join public.partners p on p.id=v.partner_id where vs.active and v.published and p.status='approved' order by vs.created_at limit 1;
 insert into public.schedule_slots(id,venue_space_id,starts_at,ends_at,price,status,created_by)
 values(sid,sp,date_trunc('hour',now())+interval '70 days',date_trunc('hour',now())+interval '70 days 1 hour',100,'available',c.marketplace_user_id);
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',c.marketplace_user_id,'session_id',owner_session)::text,true);
 payload:=public.create_reservation_prebooking(sid,g,null,true,'marketplace-pilot-166-r2',true);
 rid:=(payload->>'reservation_id')::uuid;
 out:=public.pilot_export_community_events();
 if not exists(select 1 from jsonb_array_elements(out) e where (e->>'reservation_id')::uuid=rid and e->>'state'='standby_payment') then raise exception 'Standby export missing'; end if;
 -- Simulate authoritative C39 state transitions inside this rolled-back test only.
 update public.reservations set status='confirmed',event_publication_status='published',updated_at=clock_timestamp() where id=rid;
 update public.marketplace_events set status='published',updated_at=clock_timestamp() where id=(payload->>'event_id')::uuid;
 out:=public.pilot_export_community_events();
 if not exists(select 1 from jsonb_array_elements(out) e where (e->>'reservation_id')::uuid=rid and e->>'state'='published') then raise exception 'Paid export missing'; end if;
 update public.reservations set status='cancelled',updated_at=clock_timestamp() where id=rid;
 out:=public.pilot_export_community_events();
 if not exists(select 1 from jsonb_array_elements(out) e where (e->>'reservation_id')::uuid=rid and e->>'state'='cancelled') then raise exception 'Cancellation missing'; end if;
 if exists(select 1 from jsonb_array_elements(out) e where e->>'group_id'<>c.community_group_id::text) then raise exception 'Another group exported'; end if;
end $$;
rollback;
select 'PASS: group import idempotence, group scope, real C39 prebooking, standby/paid/cancelled export' as result;

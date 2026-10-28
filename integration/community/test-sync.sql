begin;
do $$
declare c marketplace_pilot.config%rowtype; event uuid:=gen_random_uuid();occ uuid:=gen_random_uuid();res uuid:=gen_random_uuid();
  item jsonb;result jsonb;mid uuid;manual uuid;before_count integer; v timestamptz:=clock_timestamp();
begin
 select * into strict c from marketplace_pilot.config where singleton;
 select count(*) into before_count from public.matches where group_id=c.group_id;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 item:=jsonb_build_object('group_id',c.group_id,'event_id',event,'occurrence_id',occ,'reservation_id',res,'mode','new','code','INTEGRATION-TEST',
   'title','Teste transacional','starts_at',now()+interval '10 days','ends_at',now()+interval '10 days 1 hour',
   'location','Quadra fictícia','amount',100,'source_updated_at',v,'state','standby_payment');
 perform public.community_marketplace_pilot_apply(c.user_id,jsonb_build_array(item));
 if (select count(*) from public.matches where group_id=c.group_id)<>before_count then raise exception 'Pending game was published'; end if;
 item:=item||jsonb_build_object('state','published','source_updated_at',v+interval '1 second');
 perform public.community_marketplace_pilot_apply(c.user_id,jsonb_build_array(item));
 select match_id into strict mid from marketplace_pilot.events where occurrence_id=occ;
 if mid is null or not exists(select 1 from public.matches where id=mid and status='scheduled' and group_id=c.group_id) then raise exception 'Paid game missing'; end if;
 result:=public.community_marketplace_pilot_apply(c.user_id,jsonb_build_array(item));
 if result->>'updated'<>'0' or (select count(*) from public.matches where group_id=c.group_id)<>before_count+1 then raise exception 'Duplicate event'; end if;
 update public.matches set bbq_enabled=true,bbq_price=25,max_players=18,notes='Preserve native settings' where id=mid;
 item:=item||jsonb_build_object('state','cancelled','source_updated_at',v+interval '2 seconds');
 perform public.community_marketplace_pilot_apply(c.user_id,jsonb_build_array(item));
 if not exists(select 1 from public.matches where id=mid and status='cancelled' and bbq_enabled and max_players=18 and notes='Preserve native settings') then raise exception 'Native settings changed'; end if;
 perform public.community_marketplace_pilot_apply(c.user_id,jsonb_build_array(item||jsonb_build_object('state','published','source_updated_at',v)));
 if (select status from public.matches where id=mid)<>'cancelled' then raise exception 'Stale snapshot accepted'; end if;
 begin
  perform public.community_marketplace_pilot_apply(c.user_id,jsonb_build_array(item||jsonb_build_object('group_id',gen_random_uuid())));
  raise exception 'Another group accepted';
 exception when sqlstate 'PT403' then null;end;
 insert into public.matches(group_id,title,starts_at,location,created_by) values(c.group_id,'Manual test',now()+interval '12 days','Manual location',c.user_id) returning id into manual;
 item:=item||jsonb_build_object('occurrence_id',gen_random_uuid(),'reservation_id',gen_random_uuid(),'mode','existing','existing_match_id',manual);
 perform public.community_marketplace_pilot_apply(c.user_id,jsonb_build_array(item));
 if not exists(select 1 from public.matches where id=manual and status='scheduled' and title='Manual test' and location='Manual location') then raise exception 'Existing game was overwritten'; end if;
 if has_function_privilege('authenticated','public.community_marketplace_pilot_apply(uuid,jsonb)','execute') then raise exception 'Write RPC exposed'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',c.user_id,'session_id',gen_random_uuid())::text,true);
 begin perform public.community_marketplace_pilot_context();raise exception 'Revoked Community session passed';exception when sqlstate 'PT403' then null;end;
end $$;
rollback;
select 'PASS: standby, paid publication, duplicate retry, cancellation, native settings, stale snapshots, other group denial, existing game, private RPC, revoked session' as result;

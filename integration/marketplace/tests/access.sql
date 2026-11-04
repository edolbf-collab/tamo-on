-- Transactional checks against Marketplace staging only. No test rows persist.
begin;
select set_config('request.jwt.claims', jsonb_build_object(
  'role','authenticated','sub',c.marketplace_user_id,
  'session_id',(select s.id from auth.sessions s where s.user_id=c.marketplace_user_id and (s.not_after is null or s.not_after>now()) order by s.created_at desc limit 1)
)::text,true) from private.community_marketplace_pilot c;
set local role authenticated;
do $$ begin
  perform public.marketplace_pilot_check_request();
  if (select count(*) from public.profiles)=0 then raise exception 'Owner RLS read failed'; end if;
  if has_function_privilege('authenticated','public.community_marketplace_pilot_identity(uuid,boolean,text)','execute') then raise exception 'Bridge RPC is exposed'; end if;
end $$;
select set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',gen_random_uuid(),'session_id',gen_random_uuid())::text,true);
do $$ begin
  if (select count(*) from public.profiles)<>0 then raise exception 'Nonowner could read profiles'; end if;
  if (select count(*) from public.reservations)<>0 then raise exception 'Nonowner could read reservations'; end if;
  if (select count(*) from storage.objects)<>0 then raise exception 'Nonowner could read storage'; end if;
  begin
    perform public.marketplace_pilot_check_request();
    raise exception 'Nonowner pre-request passed';
  exception when sqlstate 'PT403' then null; end;
  begin
    perform public.assert_marketplace_writable();
    raise exception 'Nonowner write gate passed';
  exception when sqlstate 'PT403' then null; end;
end $$;
reset role;
-- Even the owner without a live session must be denied.
select set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',marketplace_user_id,'session_id',gen_random_uuid())::text,true) from private.community_marketplace_pilot;
set local role authenticated;
do $$ begin
  begin perform public.marketplace_pilot_check_request(); raise exception 'Revoked session passed';
    exception when sqlstate 'PT403' then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ begin
  begin perform public.marketplace_pilot_check_request(); raise exception 'Anonymous pre-request passed';
    exception when sqlstate 'PT403' then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.marketplace_pilot_check_request();
reset role;
do $$ begin
  begin
    update public.marketplace_settings set real_money_enabled=true where id;
    raise exception 'Real money unexpectedly enabled';
  exception when raise_exception then if sqlerrm<>'PILOT_SIMULATION_ONLY' then raise; end if; end;
  if exists(select 1 from storage.buckets where id='marketplace-venue-photos' and public) then raise exception 'Photos public'; end if;
end $$;
rollback;
select 'owner, nonowner, anonymous, revoked session, service role, private storage, simulated money: PASS' as checks;

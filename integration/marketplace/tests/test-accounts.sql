-- Run after provisioning in Marketplace staging. Uses existing sessions only; changes roll back.
begin;
create temporary table pilot_test_subjects as
select a.marketplace_user_id as id,a.email,c.marketplace_user_id=a.marketplace_user_id as owner,
 (select s.id from auth.sessions s where s.user_id=a.marketplace_user_id and (s.not_after is null or s.not_after>now()) order by s.created_at desc limit 1) as session_id
from private.marketplace_pilot_accounts a cross join private.community_marketplace_pilot c where a.enabled;


do $$ declare t record; boot jsonb; begin
 for t in select * from pilot_test_subjects where session_id is not null loop
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',t.id,'email',t.email,'session_id',t.session_id)::text,true);
  execute 'set local role authenticated';
  perform public.marketplace_pilot_check_request();
  perform public.assert_marketplace_writable();
  boot:=public.marketplace_bootstrap();
  if (boot->'profile'->>'id')::uuid is distinct from t.id then raise exception 'Wrong bootstrap profile'; end if;
  if coalesce((boot->>'is_admin')::boolean,false) is distinct from t.owner then raise exception 'Role escalation'; end if;
  if not t.owner then
   begin perform public.pilot_export_community_events(); raise exception 'Test account exported owner events';
    exception when no_data_found then null; when sqlstate 'PT403' then null; end;
  end if;
  if has_table_privilege('authenticated','private.marketplace_pilot_accounts','select') then raise exception 'Allowlist exposed'; end if;
  if has_function_privilege('authenticated','public.community_marketplace_pilot_identity(uuid,boolean,text)','execute') then raise exception 'Identity RPC exposed'; end if;
  execute 'reset role';
 end loop;
end $$;

-- Revocation and the global kill switch take effect on an existing session.
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',id,'email',email,'session_id',session_id)::text,true)
from pilot_test_subjects where not owner and session_id is not null limit 1;
update private.marketplace_pilot_accounts set enabled=false where marketplace_user_id=auth.uid();
set local role authenticated;
do $$ begin
 begin perform public.marketplace_pilot_check_request(); raise exception 'Revoked account passed';
 exception when sqlstate 'PT403' then null; end;
 if exists(select 1 from public.reservations) then raise exception 'Revoked account read reservations'; end if;
end $$;
reset role;
update private.marketplace_pilot_accounts set enabled=true where marketplace_user_id=auth.uid();
update private.community_marketplace_pilot set enabled=false;
set local role authenticated;
do $$ begin
 begin perform public.marketplace_pilot_check_request(); raise exception 'Kill switch failed';
 exception when sqlstate 'PT403' then null; end;
end $$;
reset role;
rollback;
select 'allowlisted accounts, existing roles, writes, owner-only sync, revocation and kill switch: PASS' as checks;

begin;
do $$
declare c marketplace_pilot.config%rowtype; payload text; signature text; secret text; first_result jsonb; second_result jsonb;
begin
 if not exists(select 1 from vault.secrets where name='tamoon_community_sync_hmac_v1') then
  perform vault.create_secret(repeat('b',64),'tamoon_community_sync_hmac_v1','Rollback-only test key');
 end if;
 select decrypted_secret into strict secret from vault.decrypted_secrets where name='tamoon_community_sync_hmac_v1';
 select * into strict c from marketplace_pilot.config where singleton;
 payload:=jsonb_build_object('version',1,'nonce',gen_random_uuid(),'sent_at',now(),'actor',c.user_id,'marketplace_user_id',c.marketplace_user_id,'group_id',c.group_id,'items','[]'::jsonb)::text;
 signature:=encode(extensions.hmac(convert_to(payload,'UTF8'),decode(secret,'hex'),'sha256'),'hex');
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 first_result:=public.community_marketplace_pilot_receive(payload,signature);
 second_result:=public.community_marketplace_pilot_receive(payload,signature);
 if first_result<>second_result or first_result->>'ok'<>'true' then raise exception 'Idempotent delivery failed'; end if;
 begin perform public.community_marketplace_pilot_receive(payload,repeat('0',64));raise exception 'Unsigned delivery passed';exception when sqlstate 'PT403' then null;end;
 begin perform public.community_marketplace_pilot_receive(payload||' ',signature);raise exception 'Modified delivery passed';exception when sqlstate 'PT403' then null;end;
 payload:=(payload::jsonb||jsonb_build_object('nonce',gen_random_uuid(),'sent_at',now()-interval '10 minutes'))::text;
 signature:=encode(extensions.hmac(convert_to(payload,'UTF8'),decode(secret,'hex'),'sha256'),'hex');
 begin perform public.community_marketplace_pilot_receive(payload,signature);raise exception 'Expired delivery passed';exception when sqlstate 'PT403' then null;end;
 payload:=(payload::jsonb||jsonb_build_object('sent_at',now(),'group_id',gen_random_uuid()))::text;
 signature:=encode(extensions.hmac(convert_to(payload,'UTF8'),decode(secret,'hex'),'sha256'),'hex');
 begin perform public.community_marketplace_pilot_receive(payload,signature);raise exception 'Foreign group passed';exception when sqlstate 'PT403' then null;end;
 perform set_config('request.jwt.claims','{"role":"anon"}',true);
 begin perform public.community_marketplace_pilot_apply(c.user_id,'[]');raise exception 'Anonymous manual apply passed';exception when sqlstate 'PT403' then null;end;
 if has_function_privilege('anon','marketplace_pilot.apply_items(uuid,jsonb)','execute') or has_function_privilege('authenticated','marketplace_pilot.apply_items(uuid,jsonb)','execute') then raise exception 'Private applier exposed'; end if;
 if has_function_privilege('anon','public.community_marketplace_pilot_receive(text,text)','execute') or has_function_privilege('authenticated','public.community_marketplace_pilot_receive(text,text)','execute') then raise exception 'Direct delivery RPC exposed'; end if;
 if has_table_privilege('authenticated','marketplace_pilot.deliveries','select') then raise exception 'Delivery audit exposed'; end if;
end $$;
rollback;
select 'PASS: signed delivery, idempotent replay, tampering, expiry, group scope, manual API and private audit' as result;

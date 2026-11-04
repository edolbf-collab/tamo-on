begin;
do $$
declare s private.community_sync_delivery%rowtype; rid bigint; result text;
begin
 if not exists(select 1 from vault.secrets where name='tamoon_community_sync_hmac_v1') then
  perform vault.create_secret(repeat('b',64),'tamoon_community_sync_hmac_v1','Rollback-only test key');
 end if;
 -- pg_net only sends after commit. This test always rolls back, so no HTTP is sent.
 update private.community_sync_delivery set enabled=true,endpoint='https://example.invalid/test',publishable_key='test',request_id=null,in_flight_version=null,
  requested_version=10,delivered_version=9,next_attempt_at=now(),failures=0 where singleton;
 result:=private.deliver_community_sync();
 if result<>'sent' then raise exception 'Worker failed to schedule: %',result; end if;
 select * into strict s from private.community_sync_delivery where singleton; rid:=s.request_id;
 if rid is null or s.in_flight_version<>10 then raise exception 'Missing in-flight version'; end if;
 if private.deliver_community_sync()<>'waiting' then raise exception 'Concurrent delivery scheduled'; end if;
 -- An update arriving during transmission must stay pending after acknowledgment.
 update private.community_sync_delivery set requested_version=11 where singleton;
 insert into net._http_response(id,status_code,content) values(rid,200,'{"ok":true}');
 result:=private.deliver_community_sync();
 select * into strict s from private.community_sync_delivery where singleton;
 if s.delivered_version<>10 or s.in_flight_version<>11 or result<>'sent' then raise exception 'Newer revision lost'; end if;
 insert into net._http_response(id,status_code,content) values(s.request_id,503,'{}');
 if private.deliver_community_sync()<>'retry_scheduled' then raise exception 'Failure did not retry'; end if;
 select * into strict s from private.community_sync_delivery where singleton;
 if s.failures<>1 or s.delivered_version<>10 or s.request_id is not null or s.next_attempt_at<=now() then raise exception 'Retry state invalid'; end if;
 if private.deliver_community_sync()<>'idle' then raise exception 'Backoff ignored'; end if;
 update private.community_sync_delivery set enabled=false where singleton;
 if private.deliver_community_sync()<>'paused' then raise exception 'Disabled worker ran'; end if;
 if has_function_privilege('authenticated','private.deliver_community_sync()','execute') or has_function_privilege('anon','private.community_sync_snapshot()','execute') or has_table_privilege('authenticated','private.community_sync_delivery','select') then raise exception 'Server queue exposed'; end if;
end $$;
rollback;
select 'PASS: enqueue, concurrent delivery, revision tracking, HTTP retry, backoff, disabled worker, private scope' as result;

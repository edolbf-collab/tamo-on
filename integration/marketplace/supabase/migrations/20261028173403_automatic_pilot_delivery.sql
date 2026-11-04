-- Durable coalesced delivery: writes mark a revision; Cron sends after commit.
create table private.community_sync_delivery (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 endpoint text, publishable_key text,
 requested_version bigint not null default 1, delivered_version bigint not null default 0,
 in_flight_version bigint, request_id bigint, last_attempt_at timestamptz, last_success_at timestamptz,
 next_attempt_at timestamptz not null default now(), failures integer not null default 0, last_error text
);
alter table private.community_sync_delivery enable row level security;
revoke all on private.community_sync_delivery from public,anon,authenticated;
insert into private.community_sync_delivery(singleton) values(true);

create function private.community_sync_snapshot() returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.community_marketplace_pilot%rowtype; result jsonb;
begin
  select * into strict c from private.community_marketplace_pilot where singleton and enabled;
  if not exists(select 1 from private.marketplace_pilot_accounts a join public.profiles p on p.id=a.marketplace_user_id join auth.users u on u.id=p.id
    where a.marketplace_user_id=c.marketplace_user_id and a.enabled and p.status='active'
      and u.email_confirmed_at is not null and lower(u.email)=a.email and (u.banned_until is null or u.banned_until<now())) then raise exception 'PILOT_OWNER_DISABLED'; end if;
  select coalesce(jsonb_agg(x.item order by x.occurred_at),'[]') into result from (
    select o.starts_at occurred_at,jsonb_build_object(
      'group_id',g.external_group_id,'reservation_id',r.id,'occurrence_id',o.id,'event_id',e.id,
      'existing_match_id',case when r.event_mode='existing' then e.external_event_id else null end,
      'mode',r.event_mode,'code',r.public_code,'title',e.title,'starts_at',o.starts_at,'ends_at',o.ends_at,
      'location',v.name,'amount',o.allocated_value,
      'source_updated_at',greatest(r.updated_at,o.updated_at,e.updated_at),
      'state',case when r.status in ('cancelled','expired','refund_pending','refunded') or o.status='cancelled' then 'cancelled'
        when r.status in ('confirmed','completed') and (e.status in ('published','completed','linked_existing') or r.event_publication_status='published') then 'published'
        else 'standby_payment' end
    ) item
    from public.reservations r join public.marketplace_groups g on g.id=r.group_id
    join public.reservation_occurrences o on o.reservation_id=r.id
    join public.marketplace_events e on e.id=r.event_id
    join public.venues v on v.id=r.venue_id
    where r.user_id=c.marketplace_user_id and g.owner_profile_id=c.marketplace_user_id
      and g.external_group_id=c.community_group_id::text and r.event_mode in ('new','existing')
  ) x;
  if jsonb_array_length(result)>200 then raise exception 'PILOT_BATCH_LIMIT'; end if;
  return result;
end $$;

revoke all on function private.community_sync_snapshot() from public,anon,authenticated;

create function private.mark_community_sync() returns trigger
language plpgsql security definer set search_path='' as $$
declare c private.community_marketplace_pilot%rowtype; belongs boolean:=false;
begin
 select * into c from private.community_marketplace_pilot where singleton;
 if not found then return new; end if;
 if TG_OP='UPDATE' and old is not distinct from new then return new; end if;
 if TG_TABLE_NAME='reservations' then
  belongs:=new.user_id=c.marketplace_user_id and exists(select 1 from public.marketplace_groups g where g.id=new.group_id and g.owner_profile_id=c.marketplace_user_id and g.external_group_id=c.community_group_id::text);
 elsif TG_TABLE_NAME='reservation_occurrences' then
  belongs:=exists(select 1 from public.reservations r join public.marketplace_groups g on g.id=r.group_id where r.id=new.reservation_id and r.user_id=c.marketplace_user_id and g.owner_profile_id=c.marketplace_user_id and g.external_group_id=c.community_group_id::text);
 elsif TG_TABLE_NAME='marketplace_events' then
  belongs:=exists(select 1 from public.marketplace_groups g where g.id=new.group_id and g.owner_profile_id=c.marketplace_user_id and g.external_group_id=c.community_group_id::text);
 end if;
 if belongs then
  update private.community_sync_delivery set requested_version=requested_version+1 where singleton;
 end if;
 return new;
end $$;
revoke all on function private.mark_community_sync() from public,anon,authenticated;
create trigger community_sync_reservation after insert or update on public.reservations for each row execute function private.mark_community_sync();
create trigger community_sync_occurrence after insert or update on public.reservation_occurrences for each row execute function private.mark_community_sync();
create trigger community_sync_event after insert or update on public.marketplace_events for each row execute function private.mark_community_sync();

create function private.deliver_community_sync() returns text
language plpgsql security definer set search_path='' as $$
declare s private.community_sync_delivery%rowtype; c private.community_marketplace_pilot%rowtype;
 response net._http_response%rowtype; secret text; payload text; signature text; rid bigint;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('tamoon-community-sync',0)) then return 'busy'; end if;
 select * into strict s from private.community_sync_delivery where singleton for update;
 select * into c from private.community_marketplace_pilot where singleton and enabled;
 if not found or not s.enabled then return 'paused'; end if;
 if s.request_id is not null then
  select * into response from net._http_response where id=s.request_id;
  if not found and s.last_attempt_at>now()-interval '90 seconds' then return 'waiting'; end if;
  if response.status_code between 200 and 299 and response.error_msg is null and (response.content::jsonb->>'ok')='true' then
   update private.community_sync_delivery set delivered_version=s.in_flight_version,request_id=null,in_flight_version=null,
    last_success_at=now(),failures=0,last_error=null,next_attempt_at=now() where singleton returning * into s;
  else
   update private.community_sync_delivery set request_id=null,in_flight_version=null,failures=failures+1,
    last_error=case when response.id is null then 'DELIVERY_TIMEOUT' else 'HTTP_'||coalesce(response.status_code::text,'NETWORK') end,
    next_attempt_at=now()+make_interval(secs=>least(300,power(2,least(failures+1,8))::integer*5)) where singleton;
   return 'retry_scheduled';
  end if;
 end if;
 if s.requested_version<=s.delivered_version or s.next_attempt_at>now() then return 'idle'; end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='tamoon_community_sync_hmac_v1';
 if secret is null or s.endpoint is null or s.publishable_key is null then raise exception 'DELIVERY_NOT_CONFIGURED'; end if;
 payload:=jsonb_build_object('version',1,'nonce',gen_random_uuid(),'sent_at',clock_timestamp(),
   'actor',c.community_user_id,'marketplace_user_id',c.marketplace_user_id,'group_id',c.community_group_id,
   'items',private.community_sync_snapshot())::text;
 signature:=encode(extensions.hmac(convert_to(payload,'UTF8'),decode(secret,'hex'),'sha256'),'hex');
 rid:=net.http_post(url:=s.endpoint,headers:=jsonb_build_object('Content-Type','application/json','apikey',s.publishable_key),
   body:=jsonb_build_object('p_payload',payload,'p_signature',signature),timeout_milliseconds:=10000);
 update private.community_sync_delivery set request_id=rid,in_flight_version=s.requested_version,last_attempt_at=now() where singleton;
 return 'sent';
exception when others then
 update private.community_sync_delivery set request_id=null,in_flight_version=null,failures=failures+1,
  last_error='WORKER_'||SQLSTATE,next_attempt_at=now()+interval '1 minute' where singleton;
 return 'retry_scheduled';
end $$;
revoke all on function private.deliver_community_sync() from public,anon,authenticated;
select cron.schedule('tamoon-community-sync','10 seconds','select private.deliver_community_sync()');

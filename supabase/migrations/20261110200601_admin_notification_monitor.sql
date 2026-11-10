-- Native telemetry is additive. No message contents, credentials or provider payloads.
create table tamoon_push.native_attempts (
 id uuid primary key default gen_random_uuid(),
 platform text not null check(platform in ('android','ios')),
 subscription_id uuid not null,
 user_id uuid not null references auth.users(id) on delete cascade,
 group_id uuid references public.groups(id) on delete set null,
 delivery_id uuid not null,
 attempt_number int not null check(attempt_number between 1 and 10),
 max_attempts int not null check(max_attempts between attempt_number and 10),
 is_final boolean not null,
 status text not null check(status in ('sent','failed')),
 status_code int,
 error_category text,
 duration_ms int not null check(duration_ms between 0 and 120000),
 event_type text not null check(char_length(event_type)<=80),
 created_at timestamptz not null default now(),
 unique(platform,delivery_id,attempt_number)
);
create index native_attempts_user_date on tamoon_push.native_attempts(user_id,created_at desc);
create index native_attempts_device_date on tamoon_push.native_attempts(platform,subscription_id,created_at desc);
create index native_attempts_date on tamoon_push.native_attempts(created_at desc);
create index native_attempts_group on tamoon_push.native_attempts(group_id) where group_id is not null;
alter table tamoon_push.native_attempts enable row level security;
revoke all on tamoon_push.native_attempts from public,anon,authenticated;

create function tamoon_push.record_native_attempt(p_event jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare
 v_platform text:=p_event->>'platform';v_id uuid:=(p_event->>'subscription_id')::uuid;
 v_user uuid:=(p_event->>'user_id')::uuid;v_updated timestamptz:=(p_event->>'registered_at')::timestamptz;
 v_delivery uuid:=(p_event->>'delivery_id')::uuid;v_attempt int:=(p_event->>'attempt_number')::int;
 v_max int:=(p_event->>'max_attempts')::int;v_ok boolean:=(p_event->>'success')::boolean;
 v_final boolean:=(p_event->>'is_final')::boolean;v_code int:=(p_event->>'status_code')::int;
 v_category text:=p_event->>'error_category';v_table text;v_found uuid;v_rows int;
begin
 if v_platform is null or v_platform not in ('android','ios') or v_id is null or v_user is null or v_updated is null
    or v_delivery is null or v_attempt is null or v_attempt not between 1 and 10 or v_max is null or v_max not between v_attempt and 10
    or v_ok is null or v_final is null then raise exception 'INVALID_TELEMETRY';end if;
 v_final:=v_final or v_ok;
 v_table:=case v_platform when 'android' then 'android_push_subscriptions' else 'native_push_subscriptions' end;
 -- Same registration guard used immediately before sending. Old-account or rotated-token results are discarded.
 execute format('select id from public.%I where id=$1 and user_id=$2 and updated_at=$3 for update',v_table)
 into v_found using v_id,v_user,v_updated;
 if v_found is null then return;end if;
 v_category:=case when v_ok then null when v_code in (401,403) then 'authentication' when v_code=410 then 'invalid_subscription'
  when v_category in ('transport','timeout','rate_limited','provider_unavailable','invalid_subscription','authentication','invalid_payload') then v_category else 'unknown' end;
 insert into tamoon_push.native_attempts(platform,subscription_id,user_id,group_id,delivery_id,attempt_number,max_attempts,is_final,status,status_code,error_category,duration_ms,event_type)
 values(v_platform,v_id,v_user,(select id from public.groups where id=nullif(p_event->>'group_id','')::uuid),v_delivery,v_attempt,v_max,v_final,
 case when v_ok then 'sent' else 'failed' end,v_code,v_category,greatest(0,least(coalesce((p_event->>'duration_ms')::int,0),120000)),left(coalesce(nullif(p_event->>'event_type',''),'push'),80))
 on conflict(platform,delivery_id,attempt_number) do nothing;
 get diagnostics v_rows=row_count;
 if v_rows=0 then return;end if;
 -- Only final results change the current state; retries remain visible in the history.
 if v_ok then
  execute format('update public.%I set last_attempt_at=now(),last_success_at=now(),consecutive_failures=0,last_failure_status=null,last_failure_reason=null where id=$1',v_table) using v_id;
 elsif v_final then
  execute format('update public.%I set last_attempt_at=now(),last_failure_at=now(),last_failure_status=$2,last_failure_reason=$3,consecutive_failures=coalesce(consecutive_failures,0)+1,enabled=case when $2=410 then false else enabled end where id=$1',v_table) using v_id,v_code,v_category;
 end if;
end;$$;
revoke all on function tamoon_push.record_native_attempt(jsonb) from public,anon,authenticated;
grant execute on function tamoon_push.record_native_attempt(jsonb) to service_role;
create function public.record_native_push_attempt(p_event jsonb) returns void language sql security invoker set search_path='' as $$select tamoon_push.record_native_attempt(p_event);$$;
revoke all on function public.record_native_push_attempt(jsonb) from public,anon,authenticated;
grant execute on function public.record_native_push_attempt(jsonb) to service_role;

-- Operational history is retained for 90 days. Account deletion cascades immediately.
create function tamoon_push.prune_native_attempts() returns void language sql security definer set search_path='' as $$delete from tamoon_push.native_attempts where created_at<now()-interval '90 days';$$;
revoke all on function tamoon_push.prune_native_attempts() from public,anon,authenticated;
grant execute on function tamoon_push.prune_native_attempts() to service_role;
do $$begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('tamoon-native-push-retention','23 4 * * *','select tamoon_push.prune_native_attempts()');
 end if;
end;$$;

create view tamoon_admin.notification_devices as
select d.platform||':'||d.id::text id,d.user_id,d.platform,coalesce(p.name,u.email,'Conta removida') user_name,u.email,
 d.enabled,d.created_at,d.last_attempt_at,d.last_success_at,d.last_failure_at,d.last_failure_status,
 case when not d.enabled then 'disabled'
 when coalesce(d.consecutive_failures,0)>0 or (d.last_failure_status is not null and d.last_failure_at>coalesce(d.last_success_at,'-infinity'::timestamptz)) then 'attention'
 when d.last_success_at is not null then 'accepted' else 'untested' end status
from (
 select 'android' platform,id,user_id,enabled,created_at,last_attempt_at,last_success_at,last_failure_at,last_failure_status,consecutive_failures from public.android_push_subscriptions
 union all select 'ios',id,user_id,enabled,created_at,last_attempt_at,last_success_at,last_failure_at,last_failure_status,consecutive_failures from public.native_push_subscriptions
 union all select 'web',id,user_id,enabled,created_at,last_attempt_at,last_success_at,last_failure_at,last_failure_status,consecutive_failures from public.push_subscriptions
) d left join auth.users u on u.id=d.user_id left join public.profiles p on p.id=d.user_id;
-- Keep the daily queue and old directory on the same current-state classification.
create or replace view tamoon_admin.devices as
select (case d.platform when 'android' then 'Android' when 'ios' then 'iOS' else 'Web' end)||':'||split_part(d.id,':',2) id,
 d.user_name title,case d.platform when 'android' then 'Android' when 'ios' then 'iOS' else 'Web' end subtitle,d.status,d.created_at,array[d.user_id] related_ids,
 jsonb_build_object('Usuário',d.user_name,'E-mail',d.email,'Plataforma',d.platform,'Última tentativa',d.last_attempt_at,'Último aceite pelo provedor',d.last_success_at,'Última falha',d.last_failure_at,'Código da falha',d.last_failure_status) details
from tamoon_admin.notification_devices d;
create view tamoon_admin.notification_attempts as
select a.id,a.platform||':'||a.subscription_id::text device_id,a.user_id,a.platform,coalesce(p.name,u.email,'Conta removida') user_name,u.email,
 a.created_at,a.delivery_id,a.attempt_number,a.max_attempts,a.is_final,a.status,a.status_code,
 case when a.error_category in ('transport','timeout','rate_limited','provider_unavailable','invalid_subscription','authentication','invalid_payload') then a.error_category else null end error_category,
 a.duration_ms,a.event_type,g.name group_name
from (
 select id,platform,subscription_id,user_id,group_id,created_at,delivery_id,attempt_number,max_attempts,is_final,status,status_code,error_category,duration_ms,event_type from tamoon_push.native_attempts
 union all select id,'web',subscription_id,user_id,group_id,created_at,coalesce(delivery_id,id),coalesce(attempt_number,1),coalesce(max_attempts,1),coalesce(is_final,true),status,status_code,error_category,duration_ms,event_type from public.push_delivery_attempts
) a left join auth.users u on u.id=a.user_id left join public.profiles p on p.id=a.user_id left join public.groups g on g.id=a.group_id;
revoke all on tamoon_admin.notification_devices,tamoon_admin.notification_attempts from public,anon,authenticated;

create function tamoon_admin.notification_monitor(p_view text default 'devices',p_platform text default null,p_status text default null,p_search text default '',p_user_id uuid default null,p_device_id text default null,p_from timestamptz default null,p_to timestamptz default null,p_page int default 1,p_size int default 20) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_rows jsonb;v_summary jsonb;v_total int;v_from timestamptz:=coalesce(p_from,now()-interval '30 days');v_to timestamptz:=coalesce(p_to,now());v_platforms jsonb;
begin
 perform tamoon_admin.require_admin();
 if p_view is null or p_view not in ('devices','attempts') or p_page is null or p_page not between 1 and 100000 or p_size is null or p_size not between 1 and 50
 or char_length(coalesce(p_search,''))>120 or (p_platform is not null and p_platform not in ('android','ios','web'))
 or (p_device_id is not null and p_device_id !~ '^(android|ios|web):[a-f0-9-]{36}$')
 or v_to<=v_from or v_to-v_from>interval '90 days'
 or (p_status is not null and ((p_view='devices' and p_status not in ('accepted','attention','disabled','untested')) or (p_view='attempts' and p_status not in ('sent','failed','final_failed','recovered')))) then raise exception 'INVALID_FILTERS';end if;
 if p_view='devices' then
  with filtered as materialized (select * from tamoon_admin.notification_devices d where (p_platform is null or d.platform=p_platform) and (p_status is null or d.status=p_status)
   and (p_user_id is null or d.user_id=p_user_id) and (p_device_id is null or d.id=p_device_id)
   and (coalesce(p_search,'')='' or strpos(lower(concat_ws(' ',d.user_name,d.email,d.id)),lower(p_search))>0)),
  page as(select * from filtered order by last_attempt_at desc nulls last,id limit p_size offset (p_page-1)*p_size)
  select (select count(*) from filtered),coalesce((select jsonb_agg(to_jsonb(x) order by last_attempt_at desc nulls last,id) from page x),'[]'),
   (select jsonb_build_object('total',count(*),'enabled',count(*) filter(where enabled),'accepted',count(*) filter(where status='accepted'),'attention',count(*) filter(where status='attention'),'untested',count(*) filter(where status='untested'),'disabled',count(*) filter(where status='disabled')) from filtered),
   (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select platform,count(*) total,count(*) filter(where enabled) enabled from filtered group by platform order by platform)x)
  into v_total,v_rows,v_summary,v_platforms;
 else
  with filtered as materialized (select * from tamoon_admin.notification_attempts a where a.created_at>=v_from and a.created_at<v_to
   and (p_platform is null or a.platform=p_platform) and (p_user_id is null or a.user_id=p_user_id) and (p_device_id is null or a.device_id=p_device_id)
   and (coalesce(p_search,'')='' or strpos(lower(concat_ws(' ',a.user_name,a.email,a.group_name,a.event_type,a.delivery_id::text)),lower(p_search))>0)
   and (p_status is null or p_status=a.status or (p_status='final_failed' and a.status='failed' and a.is_final) or (p_status='recovered' and a.status='sent' and a.is_final and a.attempt_number>1))),
  page as(select * from filtered order by created_at desc,id limit p_size offset (p_page-1)*p_size)
  select (select count(*) from filtered),coalesce((select jsonb_agg(to_jsonb(x) order by created_at desc,id) from page x),'[]'),
   (select jsonb_build_object('total',count(*),'accepted',count(*) filter(where status='sent'),'failed',count(*) filter(where status='failed'),'final_failed',count(*) filter(where status='failed' and is_final),'recovered',count(*) filter(where status='sent' and is_final and attempt_number>1)) from filtered),'[]'::jsonb
  into v_total,v_rows,v_summary,v_platforms;
 end if;
 return jsonb_build_object('items',v_rows,'total',v_total,'summary',v_summary,'platforms',v_platforms,'checked_at',now(),'from',v_from,'to',v_to);
end;$$;
revoke all on function tamoon_admin.notification_monitor(text,text,text,text,uuid,text,timestamptz,timestamptz,int,int) from public,anon;
grant execute on function tamoon_admin.notification_monitor(text,text,text,text,uuid,text,timestamptz,timestamptz,int,int) to authenticated;
create function public.admin_notification_monitor(p_view text default 'devices',p_platform text default null,p_status text default null,p_search text default '',p_user_id uuid default null,p_device_id text default null,p_from timestamptz default null,p_to timestamptz default null,p_page int default 1,p_size int default 20) returns jsonb language sql stable security invoker set search_path='' as $$select tamoon_admin.notification_monitor(p_view,p_platform,p_status,p_search,p_user_id,p_device_id,p_from,p_to,p_page,p_size);$$;
revoke all on function public.admin_notification_monitor(text,text,text,text,uuid,text,timestamptz,timestamptz,int,int) from public,anon;
grant execute on function public.admin_notification_monitor(text,text,text,text,uuid,text,timestamptz,timestamptz,int,int) to authenticated;

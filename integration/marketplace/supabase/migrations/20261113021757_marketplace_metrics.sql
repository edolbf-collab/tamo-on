-- Read-only operational metrics. No materialized test data or financial mutations.
-- This helper is callable only by the guarded owner function below.
create function tamoon_admin.metrics_period(p_from date,p_to date,p_partners uuid[],p_space uuid)
returns jsonb language sql stable set search_path='' as $$
with bounds as (
 select p_from::timestamp at time zone 'America/Sao_Paulo' lo,(p_to+1)::timestamp at time zone 'America/Sao_Paulo' hi
), spaces as materialized (
 select s.id,s.name,v.name venue,p.trade_name partner,v.partner_id
 from public.venue_spaces s join public.venues v on v.id=s.venue_id join public.partners p on p.id=v.partner_id
 where v.partner_id=any(p_partners) and (p_space is null or s.id=p_space)
), reservations as materialized (
 select r.* from public.reservations r where r.partner_id=any(p_partners) and (p_space is null or r.venue_space_id=p_space)
), occurrences as materialized (
 select o.*,r.venue_space_id,r.status::text reservation_status from public.reservation_occurrences o
 join reservations r on r.id=o.reservation_id cross join bounds b
 where o.starts_at<b.hi and o.ends_at>b.lo
), ranges as materialized (
 select s.venue_space_id space,greatest(s.starts_at,b.lo) a,least(s.ends_at,b.hi) z,
 case when s.status::text='blocked' then 2 else 1 end priority
 from public.schedule_slots s join spaces sp on sp.id=s.venue_space_id cross join bounds b
 where s.starts_at<b.hi and s.ends_at>b.lo
 union all
 select o.venue_space_id,greatest(o.starts_at,b.lo),least(o.ends_at,b.hi),
 case when o.reservation_status in ('confirmed','completed') then 4 else 3 end
 from occurrences o cross join bounds b where o.status::text in ('active','completed')
 and o.reservation_status in ('confirmed','completed','pending_payment')
), edges as (
 select space,a t from ranges union select space,z from ranges
), segments as (
 select space,t a,lead(t) over(partition by space order by t) z from edges
), occupied as materialized (
 select s.space,s.a,s.z,max(r.priority) priority,extract(epoch from(s.z-s.a))/3600 hours
 from segments s join ranges r on r.space=s.space and r.a<s.z and r.z>s.a
 where s.z>s.a group by s.space,s.a,s.z
), space_totals as (
 select sp.*,coalesce(sum(o.hours) filter(where priority<>2),0) available,
 coalesce(sum(o.hours) filter(where priority=4),0) booked,
 coalesce(sum(o.hours) filter(where priority=3),0) held,
 coalesce(sum(o.hours) filter(where priority=2),0) blocked,
 coalesce(sum(o.hours) filter(where priority=1),0) free
 from spaces sp left join occupied o on o.space=sp.id group by sp.id,sp.name,sp.venue,sp.partner,sp.partner_id
), hourly as (
 select extract(isodow from(h at time zone 'America/Sao_Paulo'))::int weekday,
 extract(hour from(h at time zone 'America/Sao_Paulo'))::int hour_of_day,o.priority,
 extract(epoch from(least(o.z,h+interval '1 hour')-greatest(o.a,h)))/3600 hours
 from occupied o cross join lateral generate_series(date_trunc('hour',o.a),o.z-interval '1 microsecond',interval '1 hour') h
), heat as (
 select weekday,hour_of_day,sum(hours) filter(where priority<>2) available,sum(hours) filter(where priority=4) booked
 from hourly group by weekday,hour_of_day
), created as materialized (
 select r.* from reservations r cross join bounds b where r.created_at>=b.lo and r.created_at<b.hi
), snapshots as materialized (
 select private.reservation_financial_snapshot(r.id) data from created r
), customers as (
 select distinct r.user_id,r.partner_id from created r where r.status::text in ('confirmed','completed') and r.user_id is not null
), customer_history as (
 select c.*,exists(select 1 from public.reservations r cross join bounds b where r.partner_id=c.partner_id
 and r.user_id=c.user_id and r.status::text in ('confirmed','completed') and r.created_at<b.lo) is_returning
 from customers c
), cash as materialized (
 select m.* from private.financial_movements m cross join bounds b
 where m.partner_id=any(p_partners) and m.occurred_at>=b.lo and m.occurred_at<b.hi
 and (p_space is null or exists(select 1 from reservations r where r.id=m.reservation_id))
)
select jsonb_build_object(
 'from',p_from,'to',p_to,
 'hours', (select jsonb_build_object('available',coalesce(sum(available),0),'booked',coalesce(sum(booked),0),
 'held',coalesce(sum(held),0),'blocked',coalesce(sum(blocked),0),'free',coalesce(sum(free),0),
 'occupancy',round(100*sum(booked)/nullif(sum(available),0),1)) from space_totals),
 'spaces',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'venue',venue,'partner',partner,
 'available',available,'booked',booked,'held',held,'blocked',blocked,'free',free,'occupancy',round(100*booked/nullif(available,0),1)) order by partner,venue,name),'[]') from space_totals),
 'heat',(select coalesce(jsonb_agg(jsonb_build_object('weekday',weekday,'hour',hour_of_day,'available',coalesce(available,0),'booked',coalesce(booked,0),
 'occupancy',round(100*coalesce(booked,0)/nullif(available,0),1)) order by weekday,hour_of_day),'[]') from heat),
 'bookings',(select jsonb_build_object('created',count(*),'confirmed',count(*) filter(where status::text in('confirmed','completed')),
 'cancelled',count(*) filter(where status::text in('cancelled','refund_pending','refunded')),'expired',count(*) filter(where status::text='expired'),
 'pending',count(*) filter(where status::text='pending_payment'),
 'cancellation_rate',round(100.0*count(*) filter(where status::text in('cancelled','refund_pending','refunded'))/nullif(count(*),0),1),
 'contracted',coalesce(sum(net_value) filter(where status::text in('confirmed','completed')),0),
 'average',round(avg(net_value) filter(where status::text in('confirmed','completed')),2)) from created),
 'services',(select jsonb_build_object('occurrences',count(*),'value',coalesce(sum(allocated_value),0)) from occurrences o cross join bounds b
 where o.starts_at>=b.lo and o.starts_at<b.hi and o.status::text in('active','completed') and o.reservation_status in('confirmed','completed')),
 'customers',(select jsonb_build_object('new',count(*) filter(where not is_returning),'returning',count(*) filter(where is_returning)) from customer_history),
 'balances',(select jsonb_build_object('pending',coalesce(sum((data->>'balance_pending')::numeric),0),'refund_pending',coalesce(sum((data->>'refund_pending')::numeric),0)) from snapshots),
 'cash',(select jsonb_build_object('received',coalesce(sum(amount) filter(where kind='received'),0),'refunded',coalesce(sum(amount) filter(where kind='refund'),0),
 'fees',coalesce(sum(amount) filter(where kind='fee'),0),'commission',coalesce(sum(amount) filter(where kind='commission'),0),
 'partner_paid',coalesce(sum(amount) filter(where kind='partner_paid'),0),'liquidated',coalesce(sum(amount) filter(where kind='liquidated'),0),
 'legacy',count(*) filter(where date_quality='legacy' or evidence_source='legacy_ledger')) from cash)
);
$$;
revoke all on function tamoon_admin.metrics_period(date,date,uuid[],uuid) from public,anon,authenticated;

create function tamoon_admin.metrics_read(p_from date,p_to date,p_partner_id uuid default null,p_space_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_admin boolean;v_preview uuid;v_partners uuid[];v_result jsonb;v_options jsonb;v_spaces jsonb;v_monthly jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=auth.uid() and p.status::text='active') then
 raise sqlstate '42501' using message='METRICS_ACCESS_DENIED';end if;
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<p_from or p_to-p_from>365
 or p_from<date '2000-01-01' or p_to>date '2100-12-31' then raise exception 'METRICS_INVALID_PERIOD';end if;
 v_admin:=exists(select 1 from public.platform_admins where profile_id=auth.uid());
 if private.partner_readonly_active() then
   if not private.can_preview_partner() then raise sqlstate '42501' using message='METRICS_ACCESS_DENIED';end if;
   select partner_id into v_preview from private.partner_readonly_context where profile_id=auth.uid() and session_id=auth.jwt()->>'session_id';
   if v_preview is null or (p_partner_id is not null and p_partner_id<>v_preview) then raise sqlstate '42501' using message='METRICS_PARTNER_FORBIDDEN';end if;
   p_partner_id:=v_preview;v_admin:=false;
 end if;
 if not v_admin and p_partner_id is null then raise sqlstate '42501' using message='METRICS_PARTNER_REQUIRED';end if;
 if p_partner_id is not null and not(v_admin or private.has_partner_permission(p_partner_id,'manage_finance')) then
 raise sqlstate '42501' using message='METRICS_PARTNER_FORBIDDEN';end if;
 select coalesce(array_agg(p.id),'{}'),coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.trade_name) order by p.trade_name),'[]')
 into v_partners,v_options from public.partners p where p_partner_id is null or p.id=p_partner_id;
 if v_admin then select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',trade_name) order by trade_name),'[]') into v_options from public.partners;end if;
 if p_partner_id is not null and cardinality(v_partners)=0 then raise sqlstate '42501' using message='METRICS_PARTNER_FORBIDDEN';end if;
 if p_space_id is not null and not exists(select 1 from public.venue_spaces s join public.venues v on v.id=s.venue_id where s.id=p_space_id and v.partner_id=any(v_partners)) then
 raise sqlstate '42501' using message='METRICS_SPACE_FORBIDDEN';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',concat_ws(' · ',p.trade_name,v.name,s.name),'partner_id',p.id) order by p.trade_name,v.name,s.name),'[]')
 into v_spaces from public.venue_spaces s join public.venues v on v.id=s.venue_id join public.partners p on p.id=v.partner_id where p.id=any(v_partners);
 select jsonb_build_object('active',count(*) filter(where l.status::text='active'),'suspended',count(*) filter(where l.status::text='suspended'),
 'other',count(*) filter(where l.status::text not in('active','suspended','cancelled')),
 'monthly_value',coalesce(sum(l.monthly_price) filter(where l.status::text='active'),0)) into v_monthly
 from public.monthly_customer_links l where l.partner_id=any(v_partners) and(p_space_id is null or l.venue_space_id=p_space_id);
 v_result:=tamoon_admin.metrics_period(p_from,p_to,v_partners,p_space_id);
 return jsonb_build_object('current',v_result,'previous',tamoon_admin.metrics_period(p_from-(p_to-p_from+1),p_from-1,v_partners,p_space_id),
 'partners',v_options,'spaces',v_spaces,'monthly',v_monthly,'admin',v_admin,'generated_at',now(),'timezone','America/Sao_Paulo',
 'test_mode',not coalesce((select real_money_enabled from public.marketplace_settings where id=true),false));
end $$;
revoke all on function tamoon_admin.metrics_read(date,date,uuid,uuid) from public,anon;
grant execute on function tamoon_admin.metrics_read(date,date,uuid,uuid) to authenticated;
create function public.marketplace_metrics(p_from date,p_to date,p_partner_id uuid default null,p_space_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$select tamoon_admin.metrics_read(p_from,p_to,p_partner_id,p_space_id);$$;
revoke all on function public.marketplace_metrics(date,date,uuid,uuid) from public,anon;
grant execute on function public.marketplace_metrics(date,date,uuid,uuid) to authenticated;

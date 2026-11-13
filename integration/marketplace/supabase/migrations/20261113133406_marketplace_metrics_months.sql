-- Full calendar months, including the previous comparison month. No changes to records.
create or replace function tamoon_admin.metrics_read(p_from date,p_to date,p_partner_id uuid default null,p_space_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_admin boolean;v_preview uuid;v_partners uuid[];v_result jsonb;v_options jsonb;v_spaces jsonb;v_monthly jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=auth.uid() and p.status::text='active') then
 raise sqlstate '42501' using message='METRICS_ACCESS_DENIED';end if;
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<p_from or p_to-p_from>365
 or p_from<date '2000-01-01' or p_to>date '2100-12-31' then raise exception 'METRICS_INVALID_PERIOD';end if;
 if p_from<>date_trunc('month',p_from::timestamp)::date
 or p_to<>(date_trunc('month',p_from::timestamp)+interval '1 month - 1 day')::date
 or p_from>date_trunc('month',now() at time zone 'America/Sao_Paulo')::date then raise exception 'METRICS_INVALID_MONTH';end if;
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
 return jsonb_build_object('current',v_result,'previous',tamoon_admin.metrics_period((p_from-interval '1 month')::date,p_from-1,v_partners,p_space_id),
 'month_open',p_from=date_trunc('month',now() at time zone 'America/Sao_Paulo')::date,
 'partners',v_options,'spaces',v_spaces,'monthly',v_monthly,'admin',v_admin,'generated_at',now(),'timezone','America/Sao_Paulo',
 'test_mode',not coalesce((select real_money_enabled from public.marketplace_settings where id=true),false));
end $$;
revoke all on function tamoon_admin.metrics_read(date,date,uuid,uuid) from public,anon;
grant execute on function tamoon_admin.metrics_read(date,date,uuid,uuid) to authenticated;

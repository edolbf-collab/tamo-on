-- Freeze commercial eligibility independently of the group's later acceptance.
-- The snapshot is historical: no backfill for plans already closed before this change.
create table private.establishment_initial_imports (
 entry_id uuid primary key,
 venue_id uuid not null references private.establishment_plans(venue_id),
 label text not null, space_id uuid not null, weekday smallint not null,
 start_time time not null, end_time time not null,
 captured_at timestamptz not null default now(), captured_by uuid references public.profiles(id),
 bound_group_id uuid references public.marketplace_groups(id), bound_at timestamptz,
 released_at timestamptz,
 check ((bound_group_id is null)=(bound_at is null))
);
create index establishment_initial_imports_venue on private.establishment_initial_imports(venue_id);
alter table private.establishment_initial_imports enable row level security;
revoke all on private.establishment_initial_imports from public,anon,authenticated;

-- Do not FK-lock an import row while freezing: association approval locks that
-- row before updating it. The trigger preserves identity/deletion instead.
create function private.resolve_initial_portfolio_import() returns trigger
language plpgsql security definer set search_path='' as $$
declare s private.establishment_initial_imports;
begin
 select * into s from private.establishment_initial_imports where entry_id=old.id for update;
 if not found then
  if tg_op='DELETE' then return old;end if;
  return new;
 end if;
 if tg_op='DELETE' then raise exception 'PLAN_INITIAL_IMPORT_IMMUTABLE';end if;
 if new.id is distinct from old.id or new.venue_id is distinct from s.venue_id
 or (s.bound_group_id is not null and new.approved_group_id is distinct from s.bound_group_id)
 or (s.released_at is not null and new.state is distinct from 'released') then
  raise exception 'PLAN_INITIAL_IMPORT_IMMUTABLE';
 end if;
 if new.state='released' and s.bound_group_id is null and s.released_at is null then
  update private.establishment_initial_imports set released_at=now() where entry_id=s.entry_id;
  insert into private.establishment_plan_audit(venue_id,actor_id,action,detail)
  values(s.venue_id,auth.uid(),'initial_import_released',jsonb_build_object('entry_id',s.entry_id));
 elsif new.state='linked' and s.bound_group_id is null and s.released_at is null then
  if new.approved_group_id is null then raise exception 'PLAN_INITIAL_IMPORT_GROUP_REQUIRED';end if;
  -- agenda_initial_accept transitions to linked before creating the native
  -- monthly reservations. Their first captured rate is therefore already 0%.
  insert into private.establishment_initial_groups(venue_id,group_id,recorded_by)
  values(s.venue_id,new.approved_group_id,auth.uid()) on conflict(venue_id,group_id) do nothing;
  update private.establishment_initial_imports set bound_group_id=new.approved_group_id,bound_at=now() where entry_id=s.entry_id;
  insert into private.establishment_plan_audit(venue_id,actor_id,action,detail)
  values(s.venue_id,auth.uid(),'initial_import_linked',jsonb_build_object('entry_id',s.entry_id,'group_id',new.approved_group_id));
 end if;
 return new;
end;$$;
revoke all on function private.resolve_initial_portfolio_import() from public,anon,authenticated;
create trigger resolve_initial_portfolio_import after update or delete on private.agenda_initial_entries
for each row execute function private.resolve_initial_portfolio_import();

create or replace function public.establishment_plan_activate(p_venue_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v private.establishment_plans; today date:=(now() at time zone 'America/Sao_Paulo')::date; imports_count integer;
begin
 perform private.plan_assert_admin();
 -- Same ordering as import/accept/release: occupancy tables, then imports,
 -- then plan. Captures a precise cutoff even with concurrent import/accept.
 perform private.agenda_initial_lock();
 select * into v from private.establishment_plans where venue_id=p_venue_id for update;
 if not found then raise exception 'PLAN_NOT_FOUND';end if;
 if v.state='ready' then return jsonb_build_object('ok',true);end if;
 if v.starts_on<today or not(extract(year from v.starts_on)::integer=any(v.calendar_years)) then raise exception 'PLAN_REVIEW_START_AND_CALENDAR';end if;
 if exists(select 1 from private.agenda_initial_entries e where e.venue_id=p_venue_id and e.state='approved' and not exists(
 select 1 from private.establishment_initial_groups g where g.venue_id=e.venue_id and g.group_id=e.approved_group_id)) then raise exception 'PLAN_IMPORTED_GROUP_MISSING';end if;
 if exists(select 1 from public.monthly_customer_links l where l.venue_id=p_venue_id and l.origin='legacy' and l.group_id is not null and l.status not in('cancelled','ended')
 and not exists(select 1 from private.establishment_initial_groups g where g.venue_id=l.venue_id and g.group_id=l.group_id)) then raise exception 'PLAN_IMPORTED_GROUP_MISSING';end if;
 insert into private.establishment_initial_imports(entry_id,venue_id,label,space_id,weekday,start_time,end_time,captured_by,bound_group_id,bound_at)
 select e.id,e.venue_id,e.label,e.space_id,e.weekday,e.start_time,e.end_time,auth.uid(),
 case when e.state='linked' then e.approved_group_id end,case when e.state='linked' and e.approved_group_id is not null then now() end
 from private.agenda_initial_entries e where e.venue_id=p_venue_id and e.state in('protected','approved','linked');
 get diagnostics imports_count=row_count;
 update private.establishment_plans set state='ready',frozen_at=now(),frozen_by=auth.uid(),updated_at=now() where venue_id=p_venue_id;
 insert into private.establishment_invoices(venue_id,competence,due_on,amount,environment)
 values(p_venue_id,v.starts_on,v.starts_on,v.monthly_value,
 case when exists(select 1 from public.marketplace_settings where real_money_enabled) then 'production' else 'sandbox' end)
 on conflict(venue_id,competence,environment) do nothing;
 insert into private.establishment_plan_audit(venue_id,actor_id,action,detail)
 values(p_venue_id,auth.uid(),'portfolio_frozen',jsonb_build_object('initial_imports',imports_count));
 return jsonb_build_object('ok',true,'initial_imports',imports_count);
end;$$;
revoke all on function public.establishment_plan_activate(uuid) from public,anon;
grant execute on function public.establishment_plan_activate(uuid) to authenticated;

create or replace function public.establishment_plans_read(p_partner_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare is_admin boolean; preview uuid; allowed uuid[]; result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=auth.uid() and p.status::text='active') then raise sqlstate '42501' using message='PLAN_ACCESS_DENIED';end if;
 is_admin:=exists(select 1 from public.platform_admins where profile_id=auth.uid());
 if private.partner_readonly_active() then
  if not private.can_preview_partner() then raise sqlstate '42501' using message='PLAN_ACCESS_DENIED';end if;
  select partner_id into preview from private.partner_readonly_context where profile_id=auth.uid() and session_id=auth.jwt()->>'session_id';
  if preview is null or(p_partner_id is not null and p_partner_id<>preview) then raise sqlstate '42501' using message='PLAN_ACCESS_DENIED';end if;
  p_partner_id:=preview;is_admin:=false;
 end if;
 if not is_admin and (p_partner_id is null or not private.has_partner_permission(p_partner_id,'manage_finance')) then raise sqlstate '42501' using message='PLAN_ACCESS_DENIED';end if;
 select array_agg(id) into allowed from public.partners where (p_partner_id is null or id=p_partner_id) and(is_admin or id=p_partner_id);
 select jsonb_build_object('admin',is_admin,'today',(now() at time zone 'America/Sao_Paulo')::date,
 'test_mode',not coalesce((select real_money_enabled from public.marketplace_settings limit 1),false),
 'venues',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'partner_id',v.partner_id,'partner',p.trade_name,
 'address',concat_ws(', ',v.street,v.street_number,v.city,v.state),'spaces',(select count(*) from public.venue_spaces s where s.venue_id=v.id),
 'plan',to_jsonb(c),'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name)) from private.establishment_initial_groups ig join public.marketplace_groups g on g.id=ig.group_id where ig.venue_id=v.id),'[]'),
 'initial_imports',case when c.state='ready' then coalesce((select jsonb_agg(jsonb_build_object(
 'id',s.entry_id,'label',s.label,'weekday',s.weekday,'start_time',s.start_time,'end_time',s.end_time,
 'state',case when s.released_at is not null then 'released' when s.bound_group_id is not null then 'linked' else coalesce(e.state,'protected') end,
 'group_id',s.bound_group_id,'captured_at',s.captured_at) order by s.label,s.entry_id)
 from private.establishment_initial_imports s left join private.agenda_initial_entries e on e.id=s.entry_id where s.venue_id=v.id),'[]')
 else coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'label',e.label,'weekday',e.weekday,'start_time',e.start_time,'end_time',e.end_time,
 'state',e.state,'group_id',case when e.state='linked' then e.approved_group_id end,'captured_at',null) order by e.label,e.id)
 from private.agenda_initial_entries e where e.venue_id=v.id and e.state in('protected','approved','linked')),'[]') end,
 'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'competence',i.competence,'due_on',i.due_on,'amount',i.amount,'status',i.status,'invoice_url',i.invoice_url,'simulated',i.simulated,'environment',i.environment) order by i.competence desc) from private.establishment_invoices i where i.venue_id=v.id),'[]'),
 'forecast',coalesce((select jsonb_agg(jsonb_build_object('month',m::date,'due_on',private.plan_due_date(c.starts_on,m::date,c.holidays),'amount',c.monthly_value,'calendar_reviewed',extract(year from m)::integer=any(c.calendar_years))) from generate_series(c.starts_on::timestamp,c.starts_on::timestamp+interval '11 months',interval '1 month') m),'[]'),
 'suggested_groups',case when is_admin then coalesce((select jsonb_agg(distinct l.group_id) from public.monthly_customer_links l where l.venue_id=v.id and l.group_id is not null and l.status not in('cancelled','ended')),'[]') else '[]'::jsonb end
 ) order by p.trade_name,v.name) from public.venues v join public.partners p on p.id=v.partner_id left join private.establishment_plans c on c.venue_id=v.id where v.partner_id=any(allowed)),'[]'),
 'group_options',case when is_admin then coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.name) from public.marketplace_groups g where g.active),'[]') else '[]'::jsonb end) into result;
 return result;
end;$$;

revoke all on function public.establishment_plans_read(uuid) from public,anon;
grant execute on function public.establishment_plans_read(uuid) to authenticated;

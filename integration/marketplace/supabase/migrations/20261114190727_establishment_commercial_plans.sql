-- Commercial v2: one plan per physical establishment (venue), never per court/CNPJ.
-- Existing reservations and financial movements are deliberately not backfilled.
create table private.establishment_plans (
 venue_id uuid primary key references public.venues(id),
 starts_on date not null check(isfinite(starts_on) and extract(day from starts_on)=1),
 monthly_value numeric(12,2) not null default 300 check(monthly_value=300),
 new_group_rate numeric(5,2) not null default 5 check(new_group_rate=5),
 state text not null default 'draft' check(state in('draft','ready')),
 holidays date[] not null default '{}', calendar_years integer[] not null default '{}',
 frozen_at timestamptz, frozen_by uuid references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table private.establishment_initial_groups (
 venue_id uuid not null references private.establishment_plans(venue_id),
 group_id uuid not null references public.marketplace_groups(id),
 recorded_by uuid references public.profiles(id), recorded_at timestamptz not null default now(),
 primary key(venue_id,group_id)
);
create index establishment_initial_groups_group on private.establishment_initial_groups(group_id);
create table private.establishment_invoices (
 id uuid primary key default gen_random_uuid(), venue_id uuid not null references private.establishment_plans(venue_id),
 competence date not null check(extract(day from competence)=1), due_on date not null,
 amount numeric(12,2) not null check(amount>0),
 status text not null default 'planned' check(status in('planned','issuing','pending','paid','overdue','cancelled','refunded','review')),
 provider_id text unique, provider_customer text, invoice_url text,
 environment text not null default 'sandbox' check(environment in('sandbox','production')),
 simulated boolean not null default false, paid_at timestamptz,
 attempted_at timestamptz, last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(venue_id,competence,environment)
);
create index establishment_invoices_queue on private.establishment_invoices(status,competence);
create table private.establishment_plan_audit (
 id bigint generated always as identity primary key, venue_id uuid not null, actor_id uuid,
 action text not null, detail jsonb not null default '{}', created_at timestamptz not null default now()
);
create index establishment_plan_audit_venue on private.establishment_plan_audit(venue_id,created_at desc);
alter table private.establishment_plans enable row level security;
alter table private.establishment_initial_groups enable row level security;
alter table private.establishment_invoices enable row level security;
alter table private.establishment_plan_audit enable row level security;
revoke all on private.establishment_plans,private.establishment_initial_groups,private.establishment_invoices,private.establishment_plan_audit from public,anon,authenticated;

create function private.plan_due_date(p_start date,p_month date,p_holidays date[] default '{}') returns date
language plpgsql immutable set search_path='' as $$
declare d date; n integer:=0; md text;
begin
 if p_start is null or p_month is null or not isfinite(p_start) or not isfinite(p_month)
 or p_month<p_start or extract(day from p_month)<>1 then raise exception 'PLAN_INVALID_MONTH';end if;
 if p_start=p_month then return p_start;end if;
 for i in 0..27 loop
  d:=p_month+i;md:=to_char(d,'MM-DD');
  if extract(isodow from d)<=5 and not (d=any(coalesce(p_holidays,'{}')))
   and md not in('01-01','04-21','05-01','09-07','10-12','11-02','11-15','12-25')
   and not(md='11-20' and extract(year from d)>=2024) then n:=n+1;end if;
  if n=6 then return d;end if;
 end loop;
 raise exception 'PLAN_INVALID_CALENDAR';
end;$$;
revoke all on function private.plan_due_date(date,date,date[]) from public,anon,authenticated;

create function private.plan_assert_admin() returns void language plpgsql security definer set search_path='' as $$
begin
 perform tamoon_admin.require_admin();
 if private.partner_readonly_active() then raise sqlstate '42501' using message='PLAN_READ_ONLY';end if;
end;$$;
revoke all on function private.plan_assert_admin() from public,anon,authenticated;

create function public.establishment_plan_save(p_venue_id uuid,p_starts_on date,p_groups uuid[],p_holidays date[],p_calendar_year integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v private.establishment_plans; today date:=(now() at time zone 'America/Sao_Paulo')::date; old_groups jsonb; partner uuid;
begin
 perform private.plan_assert_admin();
 select partner_id into partner from public.venues where id=p_venue_id;
 if partner is null then raise exception 'PLAN_VENUE_NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended('establishment-plan:'||partner::text,0));
 -- Lock the venue even for a first save: concurrent drafts cannot overwrite a freeze.
 perform 1 from public.venues where id=p_venue_id for update;
 if not found then raise exception 'PLAN_VENUE_NOT_FOUND';end if;
 select * into v from private.establishment_plans where venue_id=p_venue_id for update;
 if v.state='ready' then raise exception 'PLAN_FROZEN';end if;
 if exists(select 1 from public.venues a join public.venues b on b.partner_id=a.partner_id and b.id<>a.id
 join private.establishment_plans other on other.venue_id=b.id where a.id=p_venue_id
 and nullif(lower(trim(a.street_number)),'')=nullif(lower(trim(b.street_number)),'')
 and nullif(lower(trim(a.city)),'')=nullif(lower(trim(b.city)),'') and a.state=b.state
 and (nullif(regexp_replace(a.zip,'[^0-9]','','g'),'')=nullif(regexp_replace(b.zip,'[^0-9]','','g'),'')
 or nullif(lower(regexp_replace(a.street,'\s','','g')),'')=nullif(lower(regexp_replace(b.street,'\s','','g')),''))) then raise exception 'PLAN_DUPLICATE_ADDRESS';end if;
 if p_starts_on is null or not isfinite(p_starts_on) or extract(day from p_starts_on)<>1
 or p_starts_on<today or p_starts_on>today+730 then raise exception 'PLAN_START_FIRST_FUTURE_MONTH';end if;
 if p_calendar_year is null or p_calendar_year<extract(year from today) or p_calendar_year>extract(year from today)+3
 or exists(select 1 from unnest(p_holidays) d where not isfinite(d) or extract(year from d)<>p_calendar_year or d is null)
 or coalesce(cardinality(p_holidays),0)>100 or coalesce(cardinality(p_groups),0)>2000 then raise exception 'PLAN_INVALID_CALENDAR';end if;
 if exists(select 1 from unnest(p_groups) id where id is null or not exists(select 1 from public.marketplace_groups g where g.id=id and g.active)) then raise exception 'PLAN_INVALID_GROUP';end if;
 select coalesce(jsonb_agg(group_id),'[]') into old_groups from private.establishment_initial_groups where venue_id=p_venue_id;
 insert into private.establishment_plans(venue_id,starts_on,holidays,calendar_years)
 values(p_venue_id,p_starts_on,coalesce(p_holidays,'{}'),array[p_calendar_year])
 on conflict(venue_id) do update set starts_on=excluded.starts_on,
 holidays=array(select distinct d from unnest(private.establishment_plans.holidays||excluded.holidays) d where extract(year from d)<>p_calendar_year or d=any(excluded.holidays)),
 calendar_years=array(select distinct y from unnest(private.establishment_plans.calendar_years||excluded.calendar_years) y),updated_at=now();
 delete from private.establishment_initial_groups where venue_id=p_venue_id;
 insert into private.establishment_initial_groups(venue_id,group_id,recorded_by)
 select p_venue_id,id,auth.uid() from(select distinct unnest(coalesce(p_groups,'{}')) id) g;
 insert into private.establishment_plan_audit(venue_id,actor_id,action,detail)
 values(p_venue_id,auth.uid(),'draft_saved',jsonb_build_object('starts_on',p_starts_on,'previous_groups',old_groups,'groups',p_groups,'calendar_year',p_calendar_year,'holidays',p_holidays));
 return jsonb_build_object('ok',true);
end;$$;

create function public.establishment_plan_activate(p_venue_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v private.establishment_plans; today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 perform private.plan_assert_admin();
 select * into v from private.establishment_plans where venue_id=p_venue_id for update;
 if not found then raise exception 'PLAN_NOT_FOUND';end if;
 if v.state='ready' then return jsonb_build_object('ok',true);end if;
 if v.starts_on<today or not(extract(year from v.starts_on)::integer=any(v.calendar_years)) then raise exception 'PLAN_REVIEW_START_AND_CALENDAR';end if;
 if exists(select 1 from private.agenda_initial_entries e where e.venue_id=p_venue_id and e.state='protected') then raise exception 'PLAN_IMPORT_PENDING';end if;
 if exists(select 1 from private.agenda_initial_entries e where e.venue_id=p_venue_id and e.state='approved' and not exists(
 select 1 from private.establishment_initial_groups g where g.venue_id=e.venue_id and g.group_id=e.approved_group_id)) then raise exception 'PLAN_IMPORTED_GROUP_MISSING';end if;
 if exists(select 1 from public.monthly_customer_links l where l.venue_id=p_venue_id and l.origin='legacy' and l.group_id is not null and l.status not in('cancelled','ended')
 and not exists(select 1 from private.establishment_initial_groups g where g.venue_id=l.venue_id and g.group_id=l.group_id)) then raise exception 'PLAN_IMPORTED_GROUP_MISSING';end if;
 update private.establishment_plans set state='ready',frozen_at=now(),frozen_by=auth.uid(),updated_at=now() where venue_id=p_venue_id;
 insert into private.establishment_invoices(venue_id,competence,due_on,amount,environment)
 values(p_venue_id,v.starts_on,v.starts_on,v.monthly_value,
 case when exists(select 1 from public.marketplace_settings where real_money_enabled) then 'production' else 'sandbox' end)
 on conflict(venue_id,competence,environment) do nothing;
 insert into private.establishment_plan_audit(venue_id,actor_id,action) values(p_venue_id,auth.uid(),'portfolio_frozen');
 return jsonb_build_object('ok',true);
end;$$;

-- Separate calendar maintenance cannot alter the frozen portfolio or issued invoices.
create function public.establishment_plan_calendar(p_venue_id uuid,p_year integer,p_holidays date[]) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform private.plan_assert_admin();
 if p_year is null or p_year<extract(year from now()) or p_year>extract(year from now())+3
 or exists(select 1 from unnest(p_holidays) d where d is null or not isfinite(d) or extract(year from d)<>p_year)
 or coalesce(cardinality(p_holidays),0)>100 then raise exception 'PLAN_INVALID_CALENDAR';end if;
 update private.establishment_plans set holidays=array(select distinct d from unnest(holidays||coalesce(p_holidays,'{}')) d where extract(year from d)<>p_year or d=any(coalesce(p_holidays,'{}'))),
 calendar_years=array(select distinct y from unnest(calendar_years||array[p_year]) y),updated_at=now() where venue_id=p_venue_id;
 if not found then raise exception 'PLAN_NOT_FOUND';end if;
 update private.establishment_invoices i set due_on=private.plan_due_date(p.starts_on,i.competence,p.holidays),updated_at=now()
 from private.establishment_plans p where p.venue_id=p_venue_id and i.venue_id=p.venue_id and i.status='planned' and i.attempted_at is null and extract(year from i.competence)=p_year;
 insert into private.establishment_plan_audit(venue_id,actor_id,action,detail) values(p_venue_id,auth.uid(),'calendar_reviewed',jsonb_build_object('year',p_year,'holidays',p_holidays));
 return jsonb_build_object('ok',true);
end;$$;

alter table public.reservations add column commercial_basis text,
 add column commercial_plan_venue_id uuid references private.establishment_plans(venue_id);
create index reservations_commercial_plan on public.reservations(commercial_plan_venue_id) where commercial_plan_venue_id is not null;
create function private.capture_establishment_rate() returns trigger language plpgsql security definer set search_path='' as $$
declare v private.establishment_plans; actual_venue uuid; actual_partner uuid; today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if tg_op='UPDATE' then
  if old.commercial_plan_venue_id is not null and (new.finance_commission_rate is distinct from old.finance_commission_rate
   or new.group_id is distinct from old.group_id or new.venue_id is distinct from old.venue_id or new.partner_id is distinct from old.partner_id
   or new.commercial_basis is distinct from old.commercial_basis or new.commercial_plan_venue_id is distinct from old.commercial_plan_venue_id) then
   raise exception 'PLAN_RESERVATION_CONTRACT_IMMUTABLE';end if;
  if old.commercial_plan_venue_id is not null and not exists(select 1 from public.venue_spaces s where s.id=new.venue_space_id and s.venue_id=old.commercial_plan_venue_id) then raise exception 'PLAN_VENUE_MISMATCH';end if;
  return new;
 end if;
 select s.venue_id,vv.partner_id into actual_venue,actual_partner from public.venue_spaces s join public.venues vv on vv.id=s.venue_id where s.id=new.venue_space_id;
 select * into v from private.establishment_plans where venue_id=coalesce(actual_venue,new.venue_id) for share;
 if not found then
  if exists(select 1 from public.marketplace_settings where real_money_enabled) then raise exception 'PLAN_REQUIRED';end if;
  return new;
 end if;
 if new.venue_id is distinct from actual_venue or new.partner_id is distinct from actual_partner then raise exception 'PLAN_VENUE_MISMATCH';end if;
 if v.state<>'ready' then
  if exists(select 1 from public.marketplace_settings where real_money_enabled) then raise exception 'PLAN_REVIEW_REQUIRED';end if;
  return new;
 end if;
 if today<v.starts_on then raise exception 'PLAN_NOT_STARTED';end if;
 if not exists(select 1 from private.establishment_invoices where venue_id=v.venue_id and competence=v.starts_on and status='paid'
 and (case when exists(select 1 from public.marketplace_settings where real_money_enabled)
 then environment='production' and not simulated else environment='sandbox' end)) then raise exception 'PLAN_FIRST_PAYMENT_REQUIRED';end if;
 new.commercial_plan_venue_id:=v.venue_id;
 if exists(select 1 from private.establishment_initial_groups where venue_id=v.venue_id and group_id=new.group_id) then
  new.commercial_basis:='initial_portfolio';new.finance_commission_rate:=0;
 else new.commercial_basis:='new_group';new.finance_commission_rate:=v.new_group_rate;end if;
 return new;
end;$$;
revoke all on function private.capture_establishment_rate() from public,anon,authenticated;
create trigger capture_establishment_rate before insert or update on public.reservations for each row execute function private.capture_establishment_rate();

create function public.establishment_plans_read(p_partner_id uuid default null) returns jsonb
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
 'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'competence',i.competence,'due_on',i.due_on,'amount',i.amount,'status',i.status,'invoice_url',i.invoice_url,'simulated',i.simulated,'environment',i.environment) order by i.competence desc) from private.establishment_invoices i where i.venue_id=v.id),'[]'),
 'forecast',coalesce((select jsonb_agg(jsonb_build_object('month',m::date,'due_on',private.plan_due_date(c.starts_on,m::date,c.holidays),'amount',c.monthly_value,'calendar_reviewed',extract(year from m)::integer=any(c.calendar_years))) from generate_series(c.starts_on::timestamp,c.starts_on::timestamp+interval '11 months',interval '1 month') m),'[]'),
 'suggested_groups',case when is_admin then coalesce((select jsonb_agg(distinct l.group_id) from public.monthly_customer_links l where l.venue_id=v.id and l.group_id is not null and l.status not in('cancelled','ended')),'[]') else '[]'::jsonb end
 ) order by p.trade_name,v.name) from public.venues v join public.partners p on p.id=v.partner_id left join private.establishment_plans c on c.venue_id=v.id where v.partner_id=any(allowed)),'[]'),
 'group_options',case when is_admin then coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.name) from public.marketplace_groups g where g.active),'[]') else '[]'::jsonb end) into result;
 return result;
end;$$;

-- Explicit sandbox aid; it cannot settle a real obligation.
create function public.establishment_plan_simulate(p_venue_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.plan_assert_admin();
 if not exists(select 1 from public.marketplace_settings where real_money_enabled=false) then raise exception 'PLAN_SIMULATION_DISABLED';end if;
 update private.establishment_invoices i set status='paid',simulated=true,paid_at=now(),updated_at=now()
 from private.establishment_plans p where i.venue_id=p_venue_id and p.venue_id=i.venue_id and i.competence=p.starts_on and i.status='planned' and i.attempted_at is null and i.environment='sandbox';
 if not found then raise exception 'PLAN_NOT_SIMULATABLE';end if;
 insert into private.establishment_plan_audit(venue_id,actor_id,action) values(p_venue_id,auth.uid(),'first_payment_simulated');
 return jsonb_build_object('ok',true);
end;$$;

revoke all on function public.establishment_plan_save(uuid,date,uuid[],date[],integer),public.establishment_plan_activate(uuid),public.establishment_plan_calendar(uuid,integer,date[]),public.establishment_plans_read(uuid),public.establishment_plan_simulate(uuid) from public,anon;
grant execute on function public.establishment_plan_save(uuid,date,uuid[],date[],integer),public.establishment_plan_activate(uuid),public.establishment_plan_calendar(uuid,integer,date[]),public.establishment_plans_read(uuid),public.establishment_plan_simulate(uuid) to authenticated;

-- Worker API. A failed/ambiguous POST is never automatically repeated: issuing/review
-- records must be reconciled by externalReference before another creation attempt.
create function public.establishment_billing_claim(p_environment text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare today date:=(now() at time zone 'America/Sao_Paulo')::date; m date; i private.establishment_invoices; out jsonb;
begin
 if p_environment not in('sandbox','production') or p_environment is null then raise exception 'PLAN_INVALID_ENVIRONMENT';end if;
 if p_environment='production' and not exists(select 1 from public.marketplace_settings where real_money_enabled) then raise exception 'PLAN_REAL_MONEY_DISABLED';end if;
 if p_environment='sandbox' and exists(select 1 from public.marketplace_settings where real_money_enabled) then raise exception 'PLAN_SANDBOX_DISABLED';end if;
 m:=date_trunc('month',today)::date;
 insert into private.establishment_invoices(venue_id,competence,due_on,amount,environment)
 select p.venue_id,m,private.plan_due_date(p.starts_on,m,p.holidays),p.monthly_value,p_environment
 from private.establishment_plans p where p.state='ready' and p.starts_on<=m and extract(year from m)::integer=any(p.calendar_years)
 on conflict(venue_id,competence,environment) do nothing;
 select x.* into i from private.establishment_invoices x join private.establishment_plans p on p.venue_id=x.venue_id
 where x.status='planned' and x.environment=p_environment and x.competence<=m and extract(year from x.competence)::integer=any(p.calendar_years)
 and x.attempted_at is null order by x.due_on,x.id for update of x skip locked limit 1;
 if not found then return null;end if;
 update private.establishment_invoices set status='issuing',attempted_at=now(),environment=p_environment,updated_at=now() where id=i.id;
 select jsonb_build_object('id',i.id,'reference','tamoon-plan:'||i.id,'amount',i.amount,'due_on',i.due_on,'competence',i.competence,
 'venue',v.name,'partner_id',p.id,'name',p.legal_name,'cpfCnpj',p.cnpj,'email',p.email,'environment',p_environment)
 into out from public.venues v join public.partners p on p.id=v.partner_id where v.id=i.venue_id;
 return out;
end;$$;

create function public.establishment_billing_result(p_id uuid,p_environment text,p_payment jsonb,p_error text default null) returns void
language plpgsql security definer set search_path='' as $$
declare i private.establishment_invoices; new_status text; url text;
begin
 select * into i from private.establishment_invoices where id=p_id for update;
 if not found or i.environment<>p_environment or i.simulated then raise exception 'PLAN_INVOICE_MISMATCH';end if;
 if p_error is not null then
  -- Keep the last verified payment state during transient failures, but rotate the
  -- reconciliation queue so a missing/ambiguous item cannot starve other venues.
  update private.establishment_invoices set status=case when provider_id is null then 'review' else status end,
   last_error=left(p_error,200),updated_at=now() where id=i.id;
  return;
 end if;
 if p_payment->>'externalReference' is distinct from 'tamoon-plan:'||i.id or (p_payment->>'value')::numeric is distinct from i.amount
 or nullif(p_payment->>'id','') is null or nullif(p_payment->>'customer','') is null
 or(p_payment->>'dueDate')::date is distinct from i.due_on
 or(i.provider_id is not null and i.provider_id<>p_payment->>'id')
 or(i.provider_customer is not null and i.provider_customer<>p_payment->>'customer') then raise exception 'PLAN_PAYMENT_MISMATCH';end if;
 url:=p_payment->>'invoiceUrl';
 if url is not null and url !~ '^https://(www\.|sandbox\.)?asaas\.com/' then raise exception 'PLAN_INVALID_PAYMENT_URL';end if;
 new_status:=case p_payment->>'status' when 'RECEIVED' then 'paid' when 'CONFIRMED' then 'paid' when 'OVERDUE' then 'overdue'
 when 'REFUNDED' then 'refunded' when 'DELETED' then 'cancelled' when 'PENDING' then 'pending' else 'review' end;
 update private.establishment_invoices set provider_id=p_payment->>'id',provider_customer=p_payment->>'customer',invoice_url=url,
 status=new_status,paid_at=case when new_status='paid' then coalesce(paid_at,now()) else paid_at end,last_error=null,updated_at=now() where id=i.id;
 insert into private.establishment_plan_audit(venue_id,action,detail) values(i.venue_id,'provider_reconciled',jsonb_build_object('invoice',i.id,'status',new_status,'environment',p_environment));
end;$$;

create function public.establishment_billing_pending(p_environment text) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'reference','tamoon-plan:'||x.id,'provider_id',x.provider_id)),'[]') from (
 select id,provider_id from private.establishment_invoices where environment=p_environment and not simulated
 and status in('issuing','pending','overdue','review','paid') order by updated_at limit 50) x;
$$;
revoke all on function public.establishment_billing_claim(text),public.establishment_billing_result(uuid,text,jsonb,text),public.establishment_billing_pending(text) from public,anon,authenticated;
grant execute on function public.establishment_billing_claim(text),public.establishment_billing_result(uuid,text,jsonb,text),public.establishment_billing_pending(text) to service_role;

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const root=new URL('../../',import.meta.url),id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
test('Marketplace metrics: periods, capacity, movements, monthly occurrences and authorization',async()=>{
 const db=new PGlite();const file=async p=>db.exec(await readFile(new URL(p,root),'utf8'));
 const role=async(who,as='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.uid',$1,false)",[who]);await db.exec('set role '+as);};
 const call=async(partner=null,space=null,from='2026-11-01',to='2026-11-30')=>(await db.query('select public.marketplace_metrics($1,$2,$3,$4) result',[from,to,partner,space])).rows[0].result;
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema audit;create schema tamoon_admin;
 create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.uid',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select '{"session_id":"test"}'::jsonb$$;
 grant usage on schema auth,tamoon_admin to authenticated;
 insert into auth.users values('${id(1)}','admin@test'),('${id(2)}','owner@test'),('${id(3)}','other@test'),('${id(4)}','staff@test');`);
 await file('tests/admin/market-schema.sql');await file('tests/admin/finance-schema.sql');await file('tests/admin/financial-snapshot.sql');
 await db.exec(`create table public.partner_members(partner_id uuid,profile_id uuid,role text,permissions jsonb,active boolean);
 create table public.schedule_slots(id uuid,venue_space_id uuid,starts_at timestamptz,ends_at timestamptz,status text);
 create table private.partner_readonly_context(profile_id uuid,session_id text,partner_id uuid);
 create function private.partner_readonly_active() returns boolean language sql as $$select exists(select 1 from private.partner_readonly_context where profile_id=auth.uid() and session_id=auth.jwt()->>'session_id')$$;
 create function private.can_preview_partner() returns boolean language sql as $$select exists(select 1 from public.platform_admins where profile_id=auth.uid())$$;
 create function private.has_partner_permission(p_partner_id uuid,p_permission text) returns boolean language sql as $$
 select exists(select 1 from public.platform_admins where profile_id=auth.uid()) or exists(
 select 1 from public.partner_members m join public.partners p on p.id=m.partner_id join public.profiles u on u.id=m.profile_id and u.status='active'
 where m.partner_id=p_partner_id and m.profile_id=auth.uid() and m.active and(m.role='owner' or coalesce((m.permissions->>p_permission)::boolean,false))
 and(p.onboarding_version=0 or p.status='approved' or(p.status='under_review' and p_permission in('manage_profile','manage_spaces','manage_documents'))))$$;
 insert into public.profiles(id,status) values('${id(1)}','active'),('${id(2)}','active'),('${id(3)}','active'),('${id(4)}','active');
 insert into public.platform_admins(profile_id) values('${id(1)}');
 insert into public.partners(id,trade_name,status,onboarding_version,commission_rate) values('${id(10)}','Arena A','approved',1,6),('${id(11)}','Arena B','approved',1,6);
 insert into public.partner_members values('${id(10)}','${id(2)}','owner','{}',true),('${id(11)}','${id(3)}','owner','{}',true),('${id(10)}','${id(4)}','staff','{"manage_schedule":true}',true);
 insert into public.venues(id,partner_id,name) values('${id(20)}','${id(10)}','Arena A'),('${id(21)}','${id(11)}','Arena B');
 insert into public.venue_spaces(id,venue_id,name,active) values('${id(30)}','${id(20)}','Quadra A',true),('${id(31)}','${id(21)}','Quadra B',true),('${id(32)}','${id(21)}','Quadra sem agenda',true);
 insert into public.marketplace_settings(id,real_money_enabled) values(true,false);
 insert into public.schedule_slots(id,venue_space_id,starts_at,ends_at,status) values
 ('${id(40)}','${id(30)}','2026-11-02 12:00Z','2026-11-02 16:00Z','available'),
 ('${id(41)}','${id(30)}','2026-11-02 14:00Z','2026-11-02 16:00Z','available'),
 ('${id(42)}','${id(30)}','2026-11-02 16:00Z','2026-11-02 17:00Z','blocked'),
 ('${id(43)}','${id(31)}','2026-11-03 12:00Z','2026-11-03 14:00Z','available'),
 ('${id(44)}','${id(30)}','2026-11-01 02:00Z','2026-11-01 04:00Z','available');
 insert into public.reservations(id,public_code,partner_id,venue_space_id,user_id,status,booking_mode,net_value,gross_value,voucher_discount,created_at) values
 ('${id(50)}','MONTHLY','${id(10)}','${id(30)}','${id(2)}','confirmed','monthly',200,200,0,'2026-11-01 12:00Z'),
 ('${id(51)}','HOLD','${id(10)}','${id(30)}','${id(2)}','pending_payment','single',100,100,0,'2026-11-01 12:00Z'),
 ('${id(52)}','CANCEL','${id(10)}','${id(30)}','${id(2)}','cancelled','single',100,100,0,'2026-11-01 12:00Z'),
 ('${id(53)}','OTHER','${id(11)}','${id(31)}','${id(3)}','confirmed','single',90,90,0,'2026-11-01 12:00Z'),
 ('${id(54)}','HISTORY','${id(10)}','${id(30)}','${id(2)}','completed','single',80,80,0,'2026-10-01 12:00Z');
 insert into public.reservation_occurrences(id,reservation_id,starts_at,ends_at,status,allocated_value) values
 ('${id(60)}','${id(50)}','2026-11-02 12:00Z','2026-11-02 13:30Z','active',100),
 ('${id(61)}','${id(50)}','2026-11-02 13:00Z','2026-11-02 14:00Z','completed',100),
 ('${id(62)}','${id(51)}','2026-11-02 14:00Z','2026-11-02 15:00Z','active',100),
 ('${id(63)}','${id(52)}','2026-11-02 15:00Z','2026-11-02 16:00Z','cancelled',100),
 ('${id(64)}','${id(53)}','2026-11-03 12:00Z','2026-11-03 13:00Z','active',90);
 insert into public.monthly_customer_links(id,partner_id,venue_space_id,status,monthly_price) values('${id(70)}','${id(10)}','${id(30)}','active',1380);
 insert into private.financial_movements(id,partner_id,reservation_id,kind,amount,occurred_at,date_quality) values
 ('${id(80)}','${id(10)}','${id(50)}','received',200,'2026-11-02 12:00Z','exact'),
 ('${id(81)}','${id(10)}','${id(52)}','refund',40,'2026-11-02 12:00Z','exact'),
 ('${id(82)}','${id(10)}','${id(50)}','fee',2,'2026-11-02 12:00Z','exact'),
 ('${id(83)}','${id(11)}','${id(53)}','received',90,'2026-11-02 12:00Z','exact'),
 ('${id(84)}','${id(10)}','${id(50)}','received',999,'2026-12-01 03:00Z','exact');`);
 await file('integration/marketplace/supabase/migrations/20261113021757_marketplace_metrics.sql');
 await role(id(1),'anon');await assert.rejects(call(),/permission denied/);
 await role(id(2));await assert.rejects(call(),/METRICS_PARTNER_REQUIRED/);await assert.rejects(call(id(11)),/METRICS_PARTNER_FORBIDDEN/);await assert.rejects(call(id(10),id(31)),/METRICS_SPACE_FORBIDDEN/);
 await assert.rejects(db.query('select tamoon_admin.metrics_period($1,$2,$3,$4)',['2026-11-01','2026-11-30',[id(11)],null]),/permission denied/);
 await role(id(4));await assert.rejects(call(id(10)),/METRICS_PARTNER_FORBIDDEN/);
 await role(id(2));const a=await call(id(10));assert.equal(a.admin,false);assert.equal(a.partners.length,1);assert.equal(a.current.hours.available,5);assert.equal(a.current.hours.booked,2);assert.equal(a.current.hours.held,1);assert.equal(a.current.hours.free,2);assert.equal(a.current.hours.blocked,1);assert.equal(a.current.hours.occupancy,40);
 assert.equal(a.current.bookings.created,3);assert.equal(a.current.bookings.cancelled,1);assert.equal(a.current.bookings.cancellation_rate,33.3);assert.equal(a.current.bookings.contracted,200);assert.equal(a.current.services.occurrences,2);assert.equal(a.current.services.value,200);
 assert.equal(a.current.cash.received,200);assert.equal(a.current.cash.refunded,40);assert.equal(a.monthly.active,1);assert.equal(a.monthly.monthly_value,1380);assert.equal(a.current.customers.returning,1);assert.equal(a.current.customers.new,0);
 assert.equal(a.previous.from,'2026-10-02');assert.equal(a.previous.to,'2026-10-31');
 assert.equal(a.current.heat.reduce((sum,h)=>sum+h.available,0),5);assert.equal(a.current.heat.reduce((sum,h)=>sum+h.booked,0),2);
 assert.ok(!JSON.stringify(a).includes('Arena B'));
 await assert.rejects(call(id(10),null,'2026-11-30','2026-11-01'),/METRICS_INVALID_PERIOD/);await assert.rejects(call(id(10),null,'2025-01-01','2026-11-01'),/METRICS_INVALID_PERIOD/);await assert.rejects(call(id(10),null,'infinity','infinity'),/METRICS_INVALID_PERIOD/);
 await role(id(1));const all=await call();assert.equal(all.current.cash.received,290);assert.equal(all.current.hours.booked,3);assert.equal(all.current.spaces.length,3);assert.equal(all.partners.length,2);assert.equal((await call(id(10))).partners.length,2);
 const empty=await call(id(11),id(32));assert.equal(empty.current.hours.occupancy,null);assert.equal(empty.current.bookings.average,null);assert.equal(empty.current.cash.received,0);
 if(process.env.METRICS_FIXTURE)await writeFile(process.env.METRICS_FIXTURE,JSON.stringify(all));
 await db.exec('reset role');await db.exec(`insert into private.partner_readonly_context values('${id(1)}','test','${id(10)}')`);await role(id(1));const preview=await call();assert.equal(preview.admin,false);assert.equal(preview.current.cash.received,200);assert.equal(preview.partners.length,1);await assert.rejects(call(id(11)),/METRICS_PARTNER_FORBIDDEN/);
 await db.exec('reset role');await db.exec(`delete from private.partner_readonly_context;update public.partner_members set active=false where profile_id='${id(2)}'`);await role(id(2));await assert.rejects(call(id(10)),/METRICS_PARTNER_FORBIDDEN/);
 await db.exec('reset role');await db.exec(`update public.profiles set status='blocked' where id='${id(1)}'`);await role(id(1));await assert.rejects(call(),/METRICS_ACCESS_DENIED/);
 await role('');await assert.rejects(call(),/METRICS_ACCESS_DENIED/);
 }finally{await db.close();}
});

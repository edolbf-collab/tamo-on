import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const root=new URL('../../',import.meta.url);
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const sections=['finance','financial_alerts','charges','quotas','stages','occurrences','movements','refund_requests','credits','vouchers','webhooks','integrations','settings'];
test('Financial administration uses official amounts, protects evidence and filters related records',async()=>{
 const db=new PGlite();
 const sql=async path=>db.exec(await readFile(new URL(path,root),'utf8'));
 const role=async (who,as='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.uid',$1,false)",[who]);await db.exec('set role '+as);};
 const call=async(section,scope=null,extra={})=>(await db.query('select public.admin_operations_directory($1,$2,$3,$4,$5,$6,$7,$8,$9) result',[section,extra.search||'',extra.status||null,extra.from||null,extra.to||null,scope,extra.page||1,20,extra.id||null])).rows[0].result;
 try {
  await db.exec(`create role anon;create role authenticated;create schema auth;create schema audit;
   create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.uid',true),'')::uuid$$;
   grant usage on schema auth to authenticated;insert into auth.users values('${id(1)}','admin@example.test'),('${id(2)}','member@example.test');`);
  await sql('tests/admin/market-schema.sql');await sql('tests/admin/finance-schema.sql');await sql('tests/admin/financial-snapshot.sql');
  await sql('integration/marketplace/supabase/migrations/20261110171834_admin_operations.sql');
  await sql('integration/marketplace/supabase/migrations/20261110182151_admin_financial_operations.sql');
  await db.exec(`insert into public.profiles(id,display_name,status) values('${id(1)}','Admin','active'),('${id(2)}','Pessoa','active');
   insert into public.platform_admins(profile_id) values('${id(1)}');
   insert into public.partners(id,trade_name,commission_rate,created_at) values('${id(3)}','Arena',6,'2026-11-01');
   insert into public.reservations(id,public_code,partner_id,user_id,status,booking_mode,gross_value,voucher_discount,net_value,created_at) values
    ('${id(10)}','RES-EXCESS','${id(3)}','${id(2)}','confirmed','single',100,0,100,'2026-11-10'),
    ('${id(11)}','RES-VOUCHER','${id(3)}','${id(2)}','confirmed','single',100,100,0,'2026-11-10'),
    ('${id(12)}','RES-MONTHLY','${id(3)}','${id(2)}','confirmed','monthly',100,0,100,'2026-11-10'),
    ('${id(13)}','RES-REFUND','${id(3)}','${id(2)}','refund_pending','single',100,0,100,'2026-11-10');
   insert into public.monthly_cycles(id,status,guarantee_required,initial_required) values('${id(20)}','active',30,30);
   update public.reservations set monthly_cycle_id='${id(20)}',first_service_liquidated_at='2026-11-01' where id='${id(12)}';
   insert into public.payments(id,reservation_id,amount,fee_amount,refunded_amount,status,provider,payment_channel,cash_availability,paid_at,created_at,metadata) values
    ('${id(30)}','${id(10)}',120,3,0,'confirmed','asaas','asaas_pix','received','2026-11-10','2026-11-10','{"secret":"SECRET_PAYLOAD","asaas_route":{"issuer_account_id":"SECRET_ACCOUNT"},"asaas_split":{"status":"DONE","commission_amount":6}}'),
    ('${id(31)}','${id(12)}',40,0,0,'confirmed','asaas','asaas_pix','awaiting_credit','2026-11-10','2026-11-10','{}'),
    ('${id(32)}','${id(13)}',100,0,20,'partially_refunded','asaas','asaas_pix','received','2026-11-10','2026-11-10','{}');
   insert into public.accounting_ledger(id,reservation_id,entry_type,amount) values('${id(33)}','${id(13)}','refund_required',50);
   insert into public.payment_intents(id,reservation_id,amount,status,provider,provider_payment_id,checkout_url,metadata,created_at) values('${id(40)}','${id(10)}',120,'confirmed','asaas','pay_test','SECRET_URL','{"key":"SECRET"}','2026-11-10');
   insert into public.reservation_participants(id,reservation_id,profile_id,amount_due,amount_paid,status,created_at) values('${id(41)}','${id(10)}','${id(2)}',100,120,'paid','2026-11-10');
   insert into public.monthly_payment_stages(id,reservation_id,monthly_cycle_id,stage,status,amount_required,amount_paid,due_at) values('${id(42)}','${id(12)}','${id(20)}','balance','pending',60,0,'2026-12-05');
   insert into public.reservation_occurrences(id,reservation_id,starts_at,ends_at,status,allocated_value) values('${id(43)}','${id(12)}','2026-12-03 18:00Z','2026-12-03 19:00Z','active',25);
   insert into private.financial_movements(id,reservation_id,partner_id,source_id,kind,channel,amount,occurred_at,date_quality,evidence_source,description) values('${id(44)}','${id(10)}','${id(3)}','${id(30)}','received','asaas_pix',120,'2026-11-10','exact','event','SECRET_DESCRIPTION');
   insert into private.asaas_refund_requests(id,reservation_id,payment_id,requested_by,amount,status,is_current,attempts,error_code,provider_evidence,retry_evidence,created_at) values('${id(45)}','${id(13)}','${id(32)}','${id(1)}',30,'unknown',true,1,'SECRET_ERROR','{"key":"SECRET"}','{"secret":"SECRET"}','2026-11-10');
   insert into public.webhook_events(id,provider,provider_event_id,event_type,payload,status,attempts,last_error,received_at) values
    ('${id(46)}','asaas','evt_test','PAYMENT_RECEIVED','{"payment":{"id":"pay_test","cpf":"SECRET_CPF"}}','processed',1,null,'2026-11-10'),
    ('${id(47)}','asaas','evt_other','OTHER','{"secret":"SECRET"}','failed',2,'SECRET_ERROR','2026-11-10');
   insert into public.partner_payment_configs(partner_id,asaas_status,asaas_subaccount_id,asaas_wallet_id,pix_direct_enabled) values('${id(3)}','active','SECRET_ACCOUNT','SECRET_WALLET',true);
   insert into public.marketplace_settings(id,real_money_enabled,default_commission_rate,asaas_pix_fixed_fee,updated_at) values(true,false,6,1.99,'2026-11-10');
   insert into public.vouchers(id,code,title,partner_id,source_reservation_id,status,discount_type,discount_value,expires_at,created_at) values('${id(48)}','TEST','Crédito','${id(3)}','${id(10)}','active','fixed',20,'2026-12-01','2026-11-10');`);
  for(const s of sections){await role(id(2));await assert.rejects(call(s),/Acesso restrito/);await role(id(1),'anon');await assert.rejects(call(s),/permission denied/);}
  await role(id(1));
  for(const s of sections){const result=await call(s);assert.ok(Array.isArray(result.items),s);assert.ok(!JSON.stringify(result).includes('SECRET'),s);await assert.rejects(db.query(`select * from tamoon_admin.${s}`),/permission denied/);}
  const excess=(await call('finance',id(10))).items[0];assert.equal(excess.status,'excess_received');assert.equal(excess.details['Valor excedente em conferência'],20);assert.equal(excess.details['Valor de comissão reconhecida'],6);
  assert.equal((await call('finance',id(11))).items[0].status,'voucher_settled');
  const monthly=(await call('finance',id(12))).items[0];assert.equal(monthly.details['Valor liquidado'],40);assert.equal(monthly.details['Valor a receber'],60);
  const refund=(await call('finance',id(13))).items[0];assert.equal(refund.status,'refund_pending');assert.equal(refund.details['Valor de devolução pendente'],30);
  assert.equal((await call('financial_alerts')).total,2);assert.equal((await call('financial_alerts',id(11))).total,0);
  assert.equal((await call('charges',id(10))).total,1);assert.equal((await call('charges',id(11))).total,0);
  assert.equal((await call('quotas',id(10))).total,1);assert.equal((await call('stages',id(20),{from:'2026-12-01',to:'2027-01-01'})).total,1);
  assert.equal((await call('occurrences',id(12),{from:'2026-11-01',to:'2026-12-01'})).total,0);
  assert.equal((await call('webhooks',id(10))).total,1);assert.equal((await call('webhooks')).total,2);
  assert.equal((await call('webhooks',id(10))).items[0].details['Reserva ID'],id(10));
  const credit=(await call('credits',id(10))).items[0];assert.equal(credit.details['Valor creditado ao parceiro'],111);assert.equal((await call('credits',id(12))).total,0);
  assert.equal((await call('settings')).items[0].details['Dinheiro real habilitado'],false);
  assert.match((await call('vouchers',id(10))).items[0].details['Validade efetiva'],/^2026-12-08/);
  assert.equal((await call('finance',null,{search:"' OR true --"})).total,0);
  assert.equal((await call('finance',null,{id:id(13)})).items[0].id,id(13));
  await db.exec('reset role');await db.query("update public.profiles set status='blocked' where id=$1",[id(1)]);await role(id(1));await assert.rejects(call('settings'),/Acesso restrito/);
 } finally {await db.close();}
});

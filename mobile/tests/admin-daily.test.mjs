import test from 'node:test';import assert from 'node:assert/strict';import {readFile,readdir} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
const root=new URL('../../',import.meta.url),id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
for(const mode of ['community','market'])test(`${mode}: daily summary, event dates, work tracking, conflict protection and admin isolation`,async()=>{
 const db=new PGlite(),sql=async path=>db.exec(await readFile(new URL(path,root),'utf8'));
 const role=async(user,as='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.uid',$1,false)",[user]);await db.exec('set role '+as);};
 const read=async(view,extra={})=>(await db.query('select public.admin_daily_read($1,$2,$3,$4,$5,$6,$7,$8,$9) result',[view,extra.from||null,extra.to||null,extra.search||'',extra.scope||null,extra.status||'pending',extra.page||1,extra.id||null,extra.kind||null])).rows[0].result;
 const save=async c=>(await db.query('select public.admin_daily_save($1::jsonb) result',[JSON.stringify(c)])).rows[0].result;
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema audit;create table auth.users(id uuid primary key,email text,created_at timestamptz default now());create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;insert into auth.users(id,email) values('${id(1)}','admin@example.test'),('${id(2)}','user@example.test');`);
 await sql(`tests/admin/${mode}-schema.sql`);
 if(mode==='community'){
  await sql('tests/admin/daily-community-schema.sql');await db.exec(`insert into public.platform_admins(email) values('admin@example.test');create function public.is_platform_admin() returns boolean language sql as $$select true$$;insert into public.profiles(id,name) values('${id(1)}','Admin'),('${id(2)}','Pessoa');`);
  await sql('supabase/migrations/20261110171752_admin_operations.sql');
 }else{
  await sql('tests/admin/finance-schema.sql');await sql('tests/admin/financial-snapshot.sql');await sql('integration/marketplace/supabase/migrations/20261110171834_admin_operations.sql');await sql('integration/marketplace/supabase/migrations/20261110182151_admin_financial_operations.sql');
  await db.exec(`insert into public.profiles(id,display_name,status) values('${id(1)}','Admin','active'),('${id(2)}','Pessoa','active');insert into public.platform_admins(profile_id) values('${id(1)}');`);
 }
 const folder=mode==='community'?'supabase/migrations/':'integration/marketplace/supabase/migrations/';const migration=(await readdir(new URL(folder,root))).find(n=>n.endsWith('_admin_daily_operations.sql'));await sql(folder+migration);
 await role(id(2));await assert.rejects(read('overview'),/Acesso restrito/);await assert.rejects(save({action:'create',id:id(4),title:'Não autorizado'}),/Acesso restrito/);
 await role(id(1),'anon');await assert.rejects(read('queue'),/permission denied/);await assert.rejects(save({action:'create'}),/permission denied/);
 await role(id(1));for(const name of ['work_items','followups','work_history','daily_queue','daily_sources','daily_agenda','daily_admins'])await assert.rejects(db.query('select * from tamoon_admin.'+name),/permission denied/);
 await assert.rejects(read('unknown'),/INVALID_FILTERS/);await assert.rejects(read('agenda',{from:'2026-01-01',to:'2028-01-01'}),/INVALID_FILTERS/);await assert.rejects(read('queue',{search:'x'.repeat(121)}),/INVALID_FILTERS/);
 const created=await save({action:'create',id:id(4),title:'Atendimento teste',description:'Descrição interna <script>'});assert.equal(created.id,'task:'+id(4));assert.equal((await save({action:'create',id:id(4),title:'Atendimento teste',description:'Descrição interna <script>'})).id,created.id);
 let row=(await read('queue',{id:created.id})).items[0];assert.equal(row.version,0);
 const command={action:'update',id:row.id,version:row.version,source_updated_at:row.updated_at,owner_id:id(1),due_at:'2020-01-01',stage:'working',note:'Nota privada interna',status:'working'};
 await save(command);await assert.rejects(save(command),/CONFLICT/);
 row=(await read('queue',{id:created.id})).items[0];assert.equal(row.owner_name,'Admin');assert.equal(row.overdue,true);assert.equal(row.version,1);
 await assert.rejects(save({...command,version:row.version,source_updated_at:row.updated_at,owner_id:id(2)}),/INVALID_OWNER/);
 assert.equal((await read('queue',{status:'mine'})).total,1);assert.equal((await read('queue',{status:'overdue'})).total,1);
 assert.equal((await read('overview')).stats.pending,1);
 const history=(await read('queue',{id:row.id})).history;assert.equal(history.length,2);assert.ok(!JSON.stringify(history).includes('Nota privada interna'));
 await save({...command,version:row.version,source_updated_at:row.updated_at,status:'resolved'});assert.equal((await read('queue')).total,0);assert.equal((await read('queue',{status:'closed'})).total,1);
 await db.exec('reset role');
 if(mode==='community'){
  await db.exec(`insert into public.groups(id,name,created_by) values('${id(3)}','Grupo teste','${id(2)}');insert into public.matches(id,group_id,title,status,starts_at,duration_minutes,created_at) values('${id(5)}','${id(3)}','Jogo agendado','scheduled','2026-12-01 23:30Z',90,'2020-01-01');insert into public.beta_feedback(id,group_id,title,description,context,status,created_at,updated_at) values('${id(6)}','${id(3)}','Erro no app','Descrição do relato','{"token":"SECRET"}','open',now(),now());insert into tamoon_safety.reports(id,group_id,target_type,details,snapshot,status,created_at,updated_at) values('${id(7)}','${id(3)}','match','Relato de denúncia','{"secret":"SECRET"}','open',now(),now());`);
 }else{
  await db.exec(`insert into public.partners(id,trade_name,status,created_at,updated_at) values('${id(3)}','Arena teste','pending',now(),now());insert into public.reservations(id,public_code,partner_id,status,gross_value,voucher_discount,net_value,created_at) values('${id(5)}','RES-TEST','${id(3)}','confirmed',100,0,100,'2020-01-01');insert into public.reservation_occurrences(id,reservation_id,starts_at,ends_at,status) values('${id(8)}','${id(5)}','2026-12-01 23:30Z','2026-12-02 01:00Z','active');insert into public.webhook_events(id,event_type,provider,status,payload,last_error,received_at) values('${id(7)}','PAYMENT_RECEIVED','asaas','failed','{"secret":"SECRET"}','SECRET',now());`);
 }
 await role(id(1));const agenda=await read('agenda',{from:'2026-12-02',to:'2026-12-03',scope:id(3)});assert.equal(agenda.total,1,'Events overlapping the day included regardless of creation');assert.equal(agenda.items[0].target_id,id(5));assert.equal((await read('agenda',{from:'2026-12-02',to:'2026-12-03',scope:id(2)})).total,0);
 const queue=await read('queue');assert.equal(queue.total,2);assert.ok(!JSON.stringify(queue).includes('SECRET'));
 const auto=queue.items.find(r=>r.kind===(mode==='community'?'report':'integration'));
 await assert.rejects(save({action:'update',id:auto.id,version:0,source_updated_at:auto.updated_at,stage:'working',status:'resolved'}),/INVALID_STATUS/);
 if(mode==='community'){
  const feedback=queue.items.find(r=>r.kind==='feedback');await save({action:'update',id:feedback.id,version:0,source_updated_at:feedback.updated_at,stage:'working',status:'resolved'});assert.equal((await read('queue',{kind:'feedback'})).total,0);
 }
 await db.exec('reset role');await db.exec(`insert into tamoon_admin.work_items(id,title,created_by) select gen_random_uuid(),'Teste '||n,'${id(1)}' from generate_series(1,23)n`);await role(id(1));const first=await read('queue',{kind:'support'}),second=await read('queue',{kind:'support',page:2});assert.equal(first.items.length,20);assert.equal(second.items.length,3);assert.equal(new Set([...first.items,...second.items].map(i=>i.id)).size,23);
 await db.exec('reset role');if(mode==='market')await db.exec(`update public.profiles set status='blocked' where id='${id(1)}'`);else await db.exec('delete from public.platform_admins');await role(id(1));await assert.rejects(read('overview'),/Acesso restrito/);await assert.rejects(save(command),/Acesso restrito/);
 }finally{await db.close();}
});

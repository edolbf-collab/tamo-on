import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const root=new URL('../../',import.meta.url);
const admin='00000000-0000-4000-8000-000000000001',regular='00000000-0000-4000-8000-000000000002',group='00000000-0000-4000-8000-000000000003';
for(const mode of ['community','market'])test(`${mode}: admin-only directory, pagination, safe fields and filters`,async()=>{
 const db=new PGlite();try{
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema audit;
   create table auth.users(id uuid primary key,email text,created_at timestamptz default now());
   create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.uid',true),'')::uuid $$;
   grant usage on schema auth to authenticated;
   insert into auth.users(id,email) values ('${admin}','admin@example.test'),('${regular}','regular@example.test');`);
  await db.exec(await readFile(new URL(`tests/admin/${mode}-schema.sql`,root),'utf8'));
  if(mode==='community')await db.exec(`insert into public.platform_admins(email) values ('admin@example.test');
   create function public.is_platform_admin() returns boolean language sql as $$ select true $$;
   insert into public.groups(id,name,created_by,created_at) values ('${group}','Antigo', '${regular}',now());`);
  else await db.exec(`insert into public.profiles(id,display_name,status) values ('${admin}','Admin','active'),('${regular}','Usuário','active');insert into public.platform_admins(profile_id) values ('${admin}');`);
  const path=mode==='community'?'supabase/migrations/20261110151314_admin_operations.sql':'integration/marketplace/supabase/migrations/20261110151321_admin_operations.sql';
  await db.exec(await readFile(new URL(path,root),'utf8'));
  const user=async(id,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.uid',$1,false)",[id]);await db.exec('set role '+role);};
  const call=async(section,search='',page=1,status=null,scope=null,size=20)=> (await db.query('select public.admin_operations_directory($1,$2,$3,null,null,$4,$5,$6) result',[section,search,status,scope,page,size])).rows[0].result;
  const section=mode==='community'?'groups':'partners';
  await user(regular);await assert.rejects(call(section),/Acesso restrito/);
  await user('');await assert.rejects(call(section),/Acesso restrito/);
  await user(admin,'anon');await assert.rejects(call(section),/permission denied/);
  await user(admin);await assert.rejects(db.query(`select * from tamoon_admin.${section}`),/permission denied/);
  for(const s of mode==='community'?['groups','users','members','events','devices']:['partners','reservations','payments','monthly','cycles','audit'])assert.ok(Array.isArray((await call(s)).items));
  await assert.rejects(call('auth.users;--'),/INVALID_SECTION/);await assert.rejects(call(section,'',0),/INVALID_FILTERS/);await assert.rejects(call(section,'x'.repeat(121)),/INVALID_FILTERS/);await assert.rejects(call(section,'',1,null,null,51),/INVALID_FILTERS/);
  await assert.rejects(db.query("select public.admin_operations_directory($1,'',null,'2026-11-10','2026-11-01')",[section]),/INVALID_FILTERS/);
  await db.exec('reset role');
  if(mode==='community'){
   await db.exec(`insert into public.profiles(id,name) values ('${regular}','Pessoa');
    insert into public.groups(id,name,created_by,created_at) select gen_random_uuid(),'Grupo '||i,'${regular}',now() from generate_series(1,24) i;
    insert into public.android_push_subscriptions(id,user_id,token,enabled,created_at,last_success_at,consecutive_failures) values (gen_random_uuid(),'${regular}','SECRET_ANDROID',true,now(),now(),0);
    insert into public.native_push_subscriptions(id,user_id,token,enabled,created_at,consecutive_failures) values (gen_random_uuid(),'${regular}','SECRET_IOS',true,now(),1);
    insert into public.push_subscriptions(id,user_id,endpoint,auth,p256dh,enabled,created_at,consecutive_failures) values (gen_random_uuid(),'${regular}','SECRET_ENDPOINT','SECRET_AUTH','SECRET_KEY',true,now(),0);`);
   await user(admin);let r=await call('groups');assert.equal(r.total,25);assert.equal(r.items.length,20);
   const next=await call('groups','',2);assert.equal(next.items.length,5);assert.equal(new Set([...r.items,...next.items].map(r=>r.id)).size,25);
   assert.equal((await call('groups','%',1)).total,0);assert.equal((await call('groups',"' OR true --")).total,0);
   assert.equal((await call('groups','',1,null,regular)).total,25);assert.equal((await call('groups','',1,null,admin)).total,0);
   assert.match((await call('groups','Antigo')).items[0].details['Criador original'],/Não comprovado/);
   assert.equal((await call('groups','Grupo 1')).items[0].details['Criador original'],'Pessoa');
   const devices=await call('devices');assert.equal(devices.total,3);assert.deepEqual(new Set(devices.items.map(r=>r.subtitle)),new Set(['Android','iOS','Web']));assert.ok(!JSON.stringify(devices).includes('SECRET'));
   assert.equal((await call('devices','',1,'attention')).total,1);
   await db.exec('reset role');await db.query('delete from auth.users where id=$1',[regular]);await user(admin);
   assert.equal((await call('groups','Grupo 1')).items[0].details['Criador original'],'Conta removida');
  }else{
   await db.exec(`insert into public.partners(id,trade_name,responsible_name,status,created_at) select gen_random_uuid(),'Quadra '||i,'Responsável','active',now() from generate_series(1,24) i;
    insert into audit.audit_logs(id,action,row_id,table_name,schema_name,old_data,new_data,metadata,created_at) values (1,'UPDATE','abc','payments','public','{"status":"pending","token":"SECRET_OLD"}','{"status":"paid","token":"SECRET_NEW"}','{"secret":"SECRET_META"}',now());`);
   await user(admin);const r=await call('partners');assert.equal(r.total,24);assert.equal(r.items.length,20);assert.equal((await call('partners','',2)).items.length,4);
   const audit=await call('audit');assert.equal(audit.items[0].details['Campos alterados'],'status, token');assert.ok(!JSON.stringify(audit).includes('SECRET'));
   await db.exec('reset role');await db.exec(`update public.profiles set status='blocked' where id='${admin}'`);await user(admin);await assert.rejects(call('partners'),/Acesso restrito/);
  }
 }finally{await db.close();}
});

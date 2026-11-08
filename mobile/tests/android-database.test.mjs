import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('Android migration enforces consent, RLS, rotation, account isolation and deletion; APNs remains valid',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`
   create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create schema tamoon_legal;
   create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.user_id',true),'')::uuid $$;
   grant usage on schema auth to authenticated;
   create function tamoon_legal.require_access() returns void language plpgsql as $$ begin
    if current_setting('request.legal',true) <> 'yes' then raise exception 'LEGAL_ACCEPTANCE_REQUIRED'; end if; end $$;
   create function public.has_beta_access() returns boolean language sql as $$ select current_setting('request.access',true) = 'yes' $$;
   insert into auth.users values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
  `);
  for(const file of ['20261107031426_native_ios_push.sql','20261108005750_native_android_push.sql'])await db.exec(await readFile(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
  const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002',installation='11111111-0000-4000-8000-000000000001';
  const token='AaBb01234567890123456789:Case-Sensitive',rotated=token+'New';
  const user=async(id,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.user_id',$1,false)",[id]);await db.exec('set role '+role);};
  await db.exec("select set_config('request.legal','yes',false),set_config('request.access','yes',false)");await user(a);
  const save=value=>db.query('select public.save_android_push_subscription($1,$2)',[value,installation]);
  await save(token);await save(rotated);
  let rows=(await db.query('select token from public.android_push_subscriptions')).rows;assert.deepEqual(rows,[{token:rotated}]);
  await assert.rejects(save('invalid'),/INVALID_DEVICE_REGISTRATION/);
  await assert.rejects(db.query('update public.android_push_subscriptions set enabled=false'),/permission denied/);
  await user(b);assert.equal((await db.query('select * from public.android_push_subscriptions')).rows.length,0);
  await db.query('select public.remove_android_push_subscription($1)',[installation]);
  await user(a);assert.equal((await db.query('select * from public.android_push_subscriptions')).rows.length,1);
  await user(b);await save(rotated);await user(a);assert.equal((await db.query('select * from public.android_push_subscriptions')).rows.length,0);
  await user(b);await db.query('select public.remove_android_push_subscription($1)',[installation]);
  assert.equal((await db.query('select * from public.android_push_subscriptions')).rows.length,0);
  await user(a,'anon');await assert.rejects(save(token),/permission denied/);
  await user('');await assert.rejects(save(token),/AUTH_REQUIRED/);
  await user(a);await db.exec("select set_config('request.legal','no',false)");await assert.rejects(save(token),/LEGAL_ACCEPTANCE_REQUIRED/);
  await db.exec("select set_config('request.legal','yes',false),set_config('request.access','no',false)");await assert.rejects(save(token),/ACCESS_DENIED/);
  await db.exec("select set_config('request.access','yes',false)");await save(token);
  await db.query('select public.save_native_push_subscription($1,$2,$3)',['ab'.repeat(32),'production',installation]);
  assert.match((await db.query('select endpoint from public.native_push_subscriptions')).rows[0].endpoint,/^apns:\/\/production\//);
  await db.exec('reset role');await db.query('delete from auth.users where id=$1',[a]);
  assert.equal((await db.query('select * from public.android_push_subscriptions')).rows.length,0);
  assert.equal((await db.query('select * from public.native_push_subscriptions')).rows.length,0);
 } finally {await db.close();}
});

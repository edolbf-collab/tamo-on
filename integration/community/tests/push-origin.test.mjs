import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {fcmPayload} from '../../../supabase/functions/publish-announcement/fcm.mjs';
import {apnsPayload} from '../../../supabase/functions/publish-announcement/apns.mjs';
import {recordNativeAttempt} from '../../../supabase/functions/publish-announcement/native-telemetry.mjs';
import {nativeNotificationURL} from '../../../mobile/src/push.mjs';

// Run the real request handler and provider URL validators, with only I/O mocked.
const source = await readFile(new URL('../../../supabase/functions/publish-announcement/index.ts', import.meta.url), 'utf8');
const code = stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm, ''), {mode:'strip'});
const user = {id:'user-test', email:'test@example.test'};

function fixture({origin, baseURL, provider='android', authenticated=true, telemetryUnavailable=false}) {
  let handler;
  const sent=[], updates=[], attempts=[];
  const table = provider === 'android' ? 'android_push_subscriptions' : 'native_push_subscriptions';
  const endpoint = provider === 'android' ? 'fcm://Android_Test_0123456789:Token' : `apns://production/${'a'.repeat(64)}`;
  const subscription = {id:'device-test', user_id:user.id, endpoint, updated_at:'2026-11-08T12:00:00Z'};
  const rows = {beta_access:[{status:'active',user_id:user.id}], group_members:[{role:'owner'}], groups:[{id:'group-test',name:'Grupo teste'}],
    push_subscriptions:[], native_push_subscriptions:[], android_push_subscriptions:[], [table]:[subscription]};
  const client = {
    auth:{getUser:async()=>({data:{user:authenticated ? user : null}})},
    rpc:async(name,args)=>{if(name==='record_native_push_attempt'){attempts.push(args.p_event);return {error:telemetryUnavailable?{message:'unavailable'}:null};}return {data:name==='community_legal_access_for_user'?true:[user.id]};},
    from(name) {
      assert(name in rows, `Unexpected table ${name}`);
      let values=rows[name];
      return {
        select(){return this;}, in(){return this;}, eq(){return this;},
        update(value){updates.push({table:name,...value}); values=[]; return this;},
        maybeSingle:async()=>({data:values[0]||null}), single:async()=>({data:values[0]||null}),
        then(resolve,reject){return Promise.resolve({data:values}).then(resolve,reject);}
      };
    }
  };
  const send = async (target, notification) => {
    assert.equal(target, endpoint);
    const payload = provider === 'android' ? fcmPayload(target,notification) : apnsPayload(notification);
    sent.push({notification,payload});
  };
  const env = {SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'test',SUPABASE_SERVICE_ROLE_KEY:'test',
    VAPID_PUBLIC_KEY:'test',VAPID_PRIVATE_KEY:'test',VAPID_SUBJECT:'mailto:test@example.test',APP_BASE_URL:baseURL};
  vm.runInNewContext(code, {Deno:{env:{get:name=>env[name]},serve:fn=>{handler=fn;}},
    createClient:()=>client, createFcmSender:()=>send, createApnsSender:()=>send, recordNativeAttempt,
    sendNotification:()=>{throw Error('Unexpected Web Push');},
    Response,URL,crypto,AbortSignal,setTimeout,console:{warn(){},error(){}}});
  return {sent,updates,attempts, async request(withAuthorization=true) {
    const headers={'Content-Type':'application/json'};
    if(origin)headers.Origin=origin;
    if(withAuthorization)headers.Authorization='Bearer test-session';
    return handler(new Request('https://test.supabase.co/functions/v1/publish-announcement', {
      method:'POST',headers,body:JSON.stringify({action:'test-push',groupId:'group-test',endpoint})
    }));
  }};
}

for(const origin of ['https://localhost','http://localhost','https://localhost:8443','capacitor://localhost','https://app.tamoon.app.br',undefined]) {
  for(const provider of ['android','ios']) {
    test(`${origin || 'no Origin'} creates a valid ${provider} notification and records success`, async()=>{
      const f=fixture({origin,provider});
      const response=await f.request();
      assert.equal(response.status,200);
      const result=await response.json();
      assert.equal(result.sent,1);assert.equal(result.failed,0);
      const url=provider==='android' ? f.sent[0].payload.message.data.url : f.sent[0].payload.url;
      assert.equal(url,'https://app.tamoon.app.br/?group=group-test&page=more');
      assert.equal(nativeNotificationURL(url,'https://localhost'),'https://localhost/?group=group-test&page=more');
      assert(f.attempts.some(row=>row.success===true&&row.is_final===true&&row.platform===provider));
      assert.equal(f.attempts[0].registered_at,'2026-11-08T12:00:00Z');
      assert.equal(f.updates.length,0);
    });
  }
}
test('configured public URL takes precedence over request Origin',async()=>{
  const f=fixture({origin:'https://other.test',baseURL:'https://app.tamoon.app.br/'});
  assert.equal((await (await f.request()).json()).sent,1);
});
test('foreign URLs remain rejected and do not disable the device',async()=>{
  const f=fixture({origin:'https://localhost.evil.test'});
  const result=await (await f.request()).json();
  assert.equal(result.sent,0);assert.equal(result.failed,1);assert.equal(result.failureStatus,400);
  assert.equal(f.sent.length,0);
  assert(f.attempts.some(row=>row.success===false&&row.is_final===true&&row.status_code===400));
  assert.ok(!JSON.stringify(f.attempts).includes('INVALID_NOTIFICATION_URL'));
  assert(!f.updates.some(row=>row.enabled===false));
});
test('native request Origin never bypasses session authentication',async()=>{
  for(const authenticated of [true,false]){
    const f=fixture({origin:'https://localhost',authenticated});
    assert.equal((await f.request(!authenticated)).status,401);
    assert.equal(f.sent.length,0);
  }
});

test('telemetry outage never turns an accepted native push into a failed send',async()=>{const f=fixture({origin:'https://localhost',telemetryUnavailable:true});const result=await(await f.request()).json();assert.equal(result.sent,1);assert.equal(result.failed,0);assert.equal(f.attempts.length,1);});

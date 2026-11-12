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

function fixture({origin, baseURL, provider='android', authenticated=true, telemetryUnavailable=false, action='test-push', countUnavailable=false, unread=3}) {
  let handler;
  const sent=[], updates=[], attempts=[], badgeQueries=[];
  const recipient = action === 'test-push' ? user.id : 'recipient-test';
  const table = provider === 'android' ? 'android_push_subscriptions' : 'native_push_subscriptions';
  const endpoint = provider === 'android' ? 'fcm://Android_Test_0123456789:Token' : `apns://production/${'a'.repeat(64)}`;
  const subscription = {id:'device-test', user_id:recipient, enabled:true, endpoint, updated_at:'2026-11-08T12:00:00Z'};
  const fresh = new Date().toISOString();
  const rows = {
    beta_access:[{email:user.email,status:'active',user_id:user.id},{status:'active',user_id:recipient}],
    group_members:[{role:'owner',user_id:user.id,group_id:'group-test'},{role:'member',user_id:recipient,group_id:'group-test'}],
    groups:[{id:'group-test',name:'Grupo teste'}],
    matches:[{id:'match-test',group_id:'group-test',title:'Partida',starts_at:fresh,location:'Quadra'}],
    players:[{id:'player-test',group_id:'group-test',user_id:recipient,name:'Membro'}],
    match_attendance:[{id:'attendance-test',group_id:'group-test',match_id:'match-test',player_id:'player-test',status:'confirmed'}],
    charges:[{id:'charge-test',group_id:'group-test',player_id:'player-test',description:'Cota',amount:10}],
    user_notifications:[
      ...Array.from({length:unread},(_,i)=>({id:`unread-${i}`,user_id:recipient,read_at:null,created_at:fresh})),
      {id:'read',user_id:recipient,read_at:fresh,created_at:fresh},
      {id:'old',user_id:recipient,read_at:null,created_at:'2020-01-01T00:00:00Z'},
      {id:'other',user_id:'unrelated',read_at:null,created_at:fresh}
    ],
    push_subscriptions:[], native_push_subscriptions:[], android_push_subscriptions:[], [table]:[subscription]
  };
  const client = {
    auth:{getUser:async()=>({data:{user:authenticated ? user : null}})},
    rpc:async(name,args)=>{if(name==='record_native_push_attempt'){attempts.push(args.p_event);return {error:telemetryUnavailable?{message:'unavailable'}:null};}return {data:name==='community_legal_access_for_user'?true:args.p_recipients};},
    from(name) {
      assert(name in rows, `Unexpected table ${name}`);
      let values=rows[name], badgeQuery=false;
      return {
        select(columns){if(name==='user_notifications'&&columns==='id'){badgeQuery=true;badgeQueries.push(name);}return this;},
        in(key,ids){values=values.filter(v=>ids.includes(v[key]));return this;},
        eq(key,value){values=values.filter(v=>v[key]===value);return this;},
        is(key,value){values=values.filter(v=>v[key]===value);return this;},
        gte(key,value){values=values.filter(v=>v[key]>=value);return this;},
        limit(n){values=values.slice(0,n);return this;},
        insert(items){values=items.map(v=>({...v,read_at:null,created_at:fresh}));rows[name].push(...values);return this;},
        update(value){updates.push({table:name,...value}); values=[]; return this;},
        maybeSingle:async()=>({data:values[0]||null}), single:async()=>({data:values[0]||null}),
        then(resolve,reject){return Promise.resolve({data:values,error:badgeQuery&&countUnavailable?{message:'count unavailable'}:null}).then(resolve,reject);}
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
  return {sent,updates,attempts,rows,badgeQueries, async request(withAuthorization=true) {
    const headers={'Content-Type':'application/json'};
    if(origin)headers.Origin=origin;
    if(withAuthorization)headers.Authorization='Bearer test-session';
    return handler(new Request('https://test.supabase.co/functions/v1/publish-announcement', {
      method:'POST',headers,body:JSON.stringify({action,groupId:'group-test',endpoint,matchId:'match-test',playerId:'player-test',chargeId:'charge-test',badgeCount:199})
    }));
  }};
}

for(const origin of ['https://localhost','http://localhost','https://localhost:8443','capacitor://localhost','https://app.tamoon.app.br','https://resenhafc-beta.pages.dev','https://localhost.evil.test',undefined]) {
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
test('stale configuration and request Origin cannot override the canonical URL',async()=>{
  const f=fixture({origin:'https://other.test',baseURL:'https://resenhafc-beta.pages.dev/'});
  assert.equal((await (await f.request()).json()).sent,1);
});
test('native request Origin never bypasses session authentication',async()=>{
  for(const authenticated of [true,false]){
    const f=fixture({origin:'https://localhost',authenticated});
    assert.equal((await f.request(!authenticated)).status,401);
    assert.equal(f.sent.length,0);
  }
});

test('telemetry outage never turns an accepted native push into a failed send',async()=>{const f=fixture({origin:'https://localhost',telemetryUnavailable:true});const result=await(await f.request()).json();assert.equal(result.sent,1);assert.equal(result.failed,0);assert.equal(f.attempts.length,1);});

for (const provider of ['ios','android']) {
  for (const action of ['attendance-confirmed','match-created','charge-created']) {
    test(`${provider} ${action}: legacy origin delivers canonical link and recipient unread count`,async()=>{
      const f=fixture({origin:'https://resenhafc-beta.pages.dev',provider,action});
      const response=await f.request();const result=await response.json();
      assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.sent,1);assert.equal(result.failed,0);
      const {notification,payload}=f.sent[0];
      assert.equal(new URL(notification.data.url).origin,'https://app.tamoon.app.br');
      assert.equal(notification.badgeCount,provider==='ios'?4:undefined); // three unread + newly inserted; excludes old/read/other users
      assert.equal(provider==='ios'?payload.aps.badge:payload.message.android.notification.notification_count,provider==='ios'?4:1);
      assert(f.rows.user_notifications.some(row=>row.target_url===notification.data.url&&row.user_id==='recipient-test'));
      assert.equal(f.badgeQueries.length,provider==='ios'?1:0);
    });
  }
  if (provider==='ios') test(`${provider} badge lookup failure does not block push or clear an existing badge`,async()=>{
    const f=fixture({provider,countUnavailable:true});
    assert.equal((await(await f.request()).json()).sent,1);
    assert.equal(f.sent[0].notification.badgeCount,undefined);
  });
  if (provider==='ios') test(`${provider} badge count matches the 200-item inbox limit`,async()=>{
    const f=fixture({provider,unread:250});
    assert.equal((await(await f.request()).json()).sent,1);
    assert.equal(f.sent[0].notification.badgeCount,200);
  });
}

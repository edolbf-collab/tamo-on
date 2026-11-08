import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativePush,nativeNotificationURL} from '../../../mobile/src/push.mjs';
import {createFcmSender,fcmPayload,fcmToken} from '../../../supabase/functions/publish-announcement/fcm.mjs';

const token='AaBbCcDd_0123456789:FCM-token-CaseSensitive';
function fixture({permission='granted',systemEnabled=true}={}) {
  const events={},calls=[],values=new Map();let enabled=false,account='user-a';
  const plugin={addListener:async(n,f)=>{events[n]=f;},checkPermissions:async()=>({receive:permission}),requestPermissions:async()=>({receive:permission}),
    createChannel:async value=>calls.push(['channel',value]),register:async()=>{queueMicrotask(()=>events.registration({value:token}));},
    unregister:async()=>calls.push(['unregister']),removeAllDeliveredNotifications:async()=>{}};
  const client={auth:{getSession:async()=>({data:{session:{user:{id:account}}}})},
    rpc:async(n,args)=>{calls.push([n,args]);enabled=n.startsWith('save');return {data:'id'};},
    from:n=>{calls.push(['table',n]);return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{enabled}})};},
    functions:{invoke:async(n,args)=>{calls.push([n,args.body]);return {data:{sent:1}};}}};
  const app={ready:true,state:{profile:{id:account},currentGroupId:'g'},drainNotificationOpen:async()=>{}};
  const push=createNativePush({plugin,platform:'android',origin:'https://localhost',notificationStatus:async()=>({enabled:systemEnabled}),
    storage:{getItem:async k=>values.get(k),setItem:async(k,v)=>values.set(k,v)},getApp:()=>app});
  return {push,plugin,client,events,calls,values,app,setAccount:value=>{account=value;}};
}
test('Android registers natively without Web Push; FCM token case survives storage and test targeting',async()=>{
  const f=fixture();await f.push.initialize(f.client,'user-a');await f.push.enable();
  assert.deepEqual(f.calls.find(([name])=>name==='save_android_push_subscription')[1].p_token,token);
  assert.equal((await f.push.status()).provider,'Google');assert.equal((await f.push.status()).active,true);
  assert(f.calls.some(([name,value])=>name==='table'&&value==='android_push_subscriptions'));
  await f.push.test();assert.equal(f.calls.at(-1)[1].endpoint,`fcm://${token}`);
  await f.push.disable();assert.equal((await f.push.status()).active,false);
  const names=f.calls.map(([name])=>name);assert(names.indexOf('remove_android_push_subscription')<names.indexOf('unregister'));
});
test('FCM rotation refreshes the account binding without requiring the user to relink',async()=>{
  const f=fixture();await f.push.initialize(f.client,'user-a');await f.push.enable();
  await f.events.registration({value:token+'New'});
  assert.equal((await f.push.status()).endpoint,`fcm://${token}New`);
  await f.push.disable();const saves=f.calls.filter(([n])=>n.startsWith('save')).length;
  await f.events.registration({value:token+'Late'});
  assert.equal(f.calls.filter(([n])=>n.startsWith('save')).length,saves);
});
test('Android OS denial and disabled notification channel never report successful activation',async()=>{
  for(const options of [{permission:'denied'},{systemEnabled:false}]){
    const f=fixture(options);await f.push.initialize(f.client,'user-a');await assert.rejects(f.push.enable(),/Permita/);
    assert(!f.calls.some(([n])=>n.startsWith('save')));assert.equal((await f.push.status()).active,false);
  }
});
test('Android notification opens the packaged origin; unsafe destinations are discarded',async()=>{
  assert.equal(nativeNotificationURL('/?notification=abc','https://localhost'),'https://localhost/?notification=abc');
  assert.equal(nativeNotificationURL('https://evil.test/','https://localhost'),null);
  const f=fixture();await f.push.initialize(f.client,'user-a');f.events.pushNotificationActionPerformed({notification:{data:{url:'/?notification=abc'}}});
  assert.equal(f.app.pendingNotificationUrl,'https://localhost/?notification=abc');
});
test('FCM payload is visible while closed, scoped to this app, and contains only allowed data',()=>{
  const endpoint=`fcm://${token}`,payload=fcmPayload(endpoint,{title:'Aviso',body:'Teste',data:{url:'/?notification=123',secret:'no'}});
  assert.equal(fcmToken(endpoint),token);assert.equal(payload.message.android.restricted_package_name,'br.app.tamoon');
  assert.equal(payload.message.android.notification.channel_id,'tamoon-alerts');assert.deepEqual(Object.keys(payload.message.data),['url']);
  assert(payload.message.notification);assert.throws(()=>fcmToken('https://evil.test/'+token));
  assert.throws(()=>fcmPayload(endpoint,{data:{url:'https://evil.test/'}}));
});
test('FCM uses signed OAuth with fixed endpoints and distinguishes stale devices from project/config errors',async()=>{
  const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const account={project_id:'tamoon-unit-tests',client_email:'sender@tamoon-unit-tests.iam.gserviceaccount.com',private_key:'-----BEGIN PRIVATE KEY-----\n'+Buffer.from(await crypto.subtle.exportKey('pkcs8',keys.privateKey)).toString('base64')+'\n-----END PRIVATE KEY-----'};
  const calls=[];let status=200,reason='';
  const sender=createFcmSender({env:()=>JSON.stringify(account),request:async(url,options)=>{
    calls.push({url,...options});
    if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'test-only',expires_in:3600});
    return Response.json(status===200?{name:'accepted'}:{error:{status:reason,details:reason==='UNREGISTERED'?[{'@type':'type.googleapis.com/google.firebase.fcm.v1.FcmError',errorCode:reason}]:[]}}, {status});
  }});
  const endpoint=`fcm://${token}`,notification={data:{url:'/'}};
  await sender(endpoint,notification);await sender(endpoint,notification);
  assert.equal(calls.filter(c=>c.url.endsWith('/token')).length,1);
  const [header,claims,signature]=new URLSearchParams(calls[0].body).get('assertion').split('.');
  assert(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',keys.publicKey,Buffer.from(signature,'base64url'),Buffer.from(`${header}.${claims}`)));
  assert.equal(JSON.parse(Buffer.from(claims,'base64url')).scope,'https://www.googleapis.com/auth/firebase.messaging');
  assert.equal(calls[1].url,'https://fcm.googleapis.com/v1/projects/tamoon-unit-tests/messages:send');
  status=404;reason='UNREGISTERED';await assert.rejects(sender(endpoint,notification),{statusCode:410});
  reason='NOT_FOUND';await assert.rejects(sender(endpoint,notification),{statusCode:503});
  status=400;reason='INVALID_ARGUMENT';await assert.rejects(sender(endpoint,notification),{statusCode:400});
  status=403;reason='SENDER_ID_MISMATCH';await assert.rejects(sender(endpoint,notification),{statusCode:403});
});
test('missing Firebase credentials cannot make network requests',async()=>{
  const sender=createFcmSender({env:()=>'',request:()=>{throw Error('must not send');}});
  await assert.rejects(sender(`fcm://${token}`,{data:{url:'/'}}),{statusCode:503,body:'FCM_NOT_CONFIGURED'});
});

test('empty native permission responses do not crash diagnostics or claim activation',async()=>{
  for(const response of [undefined,null,{}, {receive:'unexpected'}]) {
    const f=fixture(); await f.push.initialize(f.client,'user-a');
    f.plugin.checkPermissions=async()=>response;
    f.plugin.requestPermissions=async()=>response;
    assert.equal((await f.push.status()).permission,'unavailable');
    assert.equal((await f.push.status()).active,false);
    await assert.rejects(f.push.enable(),/Não foi possível consultar/);
    assert(!f.calls.some(([name])=>name.startsWith('save')));
  }
});

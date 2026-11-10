import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativePush, nativeNotificationURL} from '../../../mobile/src/push.mjs';
import {apnsDestination, apnsPayload, createApnsSender} from '../../../supabase/functions/publish-announcement/apns.mjs';

const token = 'ab'.repeat(32), endpoint = `apns://production/${token}`;
test('native notification links accept only community destinations', () => {
  assert.equal(nativeNotificationURL('https://app.tamoon.app.br/?notification=123'), 'capacitor://localhost/?notification=123');
  for (const url of ['https://evil.test/', 'javascript:alert(1)', 'https://app.tamoon.app.br/marketplace/', '//evil.test/']) assert.equal(nativeNotificationURL(url),null);
});
test('APNs hosts are fixed and tokens validated', () => {
  assert.equal(apnsDestination(endpoint),`https://api.push.apple.com/3/device/${token}`);
  assert.match(apnsDestination(endpoint.replace('production','sandbox')), /^https:\/\/api.sandbox.push.apple.com/);
  for (const url of ['https://evil.test/', 'apns://production/../x', endpoint+'?x=1']) assert.throws(() => apnsDestination(url));
});
test('APNs payload does not forward arbitrary metadata or badge counts', () => {
  const payload = apnsPayload({title:'A'.repeat(300),body:'B'.repeat(500),data:{url:'/?notification=id',secret:'hidden'}});
  assert.equal(payload.aps.alert.title.length,160);
  assert.equal(payload.aps.alert.body.length,240);
  assert.equal(payload.aps.badge,undefined);
  assert.equal(payload.secret,undefined);
  assert.throws(()=>apnsPayload({data:{url:'https://evil.test'}}));
});
test('APNs signs ES256, reuses tokens, and invalidates only device errors', async () => {
  const keys = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'}, true, ['sign','verify']);
  const pem = '-----BEGIN PRIVATE KEY-----\n'+Buffer.from(await crypto.subtle.exportKey('pkcs8',keys.privateKey)).toString('base64')+'\n-----END PRIVATE KEY-----';
  const env = name=>({APNS_PRIVATE_KEY:pem,APNS_KEY_ID:'ABCDEFGHIJ',APNS_TEAM_ID:'0123456789'}[name]);
  const sent = []; let status=200, reason='';
  const sender = createApnsSender({env,request:async(url,request)=>{sent.push({url,...request});return new Response(status===200?'':JSON.stringify({reason}),{status});}});
  const notification={title:'Aviso',body:'Teste',data:{url:'/'}};
  await sender(endpoint,notification,crypto.randomUUID());
  await sender(endpoint,notification,crypto.randomUUID());
  assert.equal(sent[0].headers.authorization,sent[1].headers.authorization);
  assert.equal(sent[0].headers['apns-topic'],'br.app.tamoon');
  assert.equal(sent[0].headers['apns-expiration'],'0');
  const [header,claims,signature] = sent[0].headers.authorization.slice(7).split('.');
  assert.equal(JSON.parse(Buffer.from(claims,'base64url')).iss,'0123456789');
  assert(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},keys.publicKey,Buffer.from(signature,'base64url'),Buffer.from(`${header}.${claims}`)));
  status=400;reason='BadDeviceToken'; await assert.rejects(sender(endpoint,notification,crypto.randomUUID()),{statusCode:410});
  status=403;reason='InvalidProviderToken'; await assert.rejects(sender(endpoint,notification,crypto.randomUUID()),{statusCode:403});
});
test('missing APNs credentials fail before any request', async () => {
  let called=false;
  const sender=createApnsSender({env:()=>'',request:async()=>{called=true;}});
  await assert.rejects(sender(endpoint,{data:{url:'/'}},crypto.randomUUID()),{statusCode:503});
  assert.equal(called,false);
});

function fixture({permission='granted', save}={}) {
  const events={}, values=new Map(), calls=[];
  let account='user-a', enabled=false;
  const plugin={
    addListener:async(name,fn)=>{events[name]=fn;},
    checkPermissions:async()=>({receive:permission}), requestPermissions:async()=>({receive:permission}),
    register:async()=>{queueMicrotask(()=>events.registration({value:token}));},
    unregister:async()=>{calls.push('unregister');}, removeAllDeliveredNotifications:async()=>{},
  };
  const client={auth:{getSession:async()=>({data:{session:{user:{id:account}}}})},
    rpc:async(name,args)=>{calls.push(name); if(name.startsWith('save')){if(save)await save();enabled=true;}else enabled=false; return {data:'id'};},
    from:()=>({select(){return this;},eq(){return this;},async maybeSingle(){return {data:{enabled}};}}),
    functions:{invoke:async(_,args)=>{calls.push(args.body);return {data:{sent:1}};}}
  };
  const app={ready:true,state:{profile:{id:'user-a'},currentGroupId:'group'},drainNotificationOpen:async()=>{},toast(){}};
  const push=createNativePush({plugin,storage:{getItem:async k=>values.get(k),setItem:async(k,v)=>values.set(k,v)},environment:'production',getApp:()=>app});
  return {push,client,events,calls,values,app,setAccount:value=>{account=value;}};
}
test('native push requires consent, verifies session, and targets only this phone in tests',async()=>{
  const f=fixture();await f.push.initialize(f.client,'user-a');
  assert.equal(f.calls.length,0);
  await f.push.enable();assert.equal((await f.push.status()).active,true);
  await f.push.test();assert.deepEqual(f.calls.at(-1),{action:'test-push',endpoint,groupId:'group'});
  await f.push.disable();assert.equal((await f.push.status()).active,false);
  assert(f.calls.indexOf('remove_native_push_subscription')<f.calls.indexOf('unregister'));
});
test('denied permission never creates a registration',async()=>{
  const f=fixture({permission:'denied'});await f.push.initialize(f.client,'user-a');
  await assert.rejects(f.push.enable(),/Ajustes/);assert.equal(f.calls.length,0);
});
test('account change during registration cannot bind a token',async()=>{
  const f=fixture();await f.push.initialize(f.client,'user-a');f.setAccount('user-b');
  await assert.rejects(f.push.enable(),/conta mudou/);assert.equal(f.calls.length,0);
});
test('logout waits for in-flight save and then removes the registration',async()=>{
  let release,started; const saving=new Promise(r=>{started=r;});
  const f=fixture({save:()=>{started();return new Promise(r=>{release=r;});}});
  await f.push.initialize(f.client,'user-a');
  const enable=f.push.enable();const outcome=enable.catch(error=>error);
  await saving;
  const disabled=f.push.disable();release();await disabled;await outcome;
  assert.deepEqual(f.calls,['save_native_push_subscription','remove_native_push_subscription','unregister']);
  assert.equal((await f.push.status()).active,false);
});
test('notification tapped before login is held until app is ready',async()=>{
  const f=fixture();f.app.ready=false;await f.push.listen();
  f.events.pushNotificationActionPerformed({notification:{data:{url:'/?notification=123'}}});
  assert.equal(f.app.pendingNotificationUrl,undefined);
  await f.push.initialize(f.client,'user-a');f.app.ready=true;f.push.flush();
  assert.equal(f.app.pendingNotificationUrl,'capacitor://localhost/?notification=123');
});

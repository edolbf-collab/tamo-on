import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function fixture({notification='default',push='prompt',linked=true,request='granted'}={}) {
 const subscription={endpoint:'https://push.example.test/device',options:{applicationServerKey:new Uint8Array([1,2,3]).buffer}};
 const permission={notification,push,request};
 const manager={getSubscription:async()=>subscription,permissionState:async()=>permission.push};
 const context=vm.createContext({console,setTimeout,clearTimeout,Uint8Array,URL,atob,Notification:{get permission(){return permission.notification;},requestPermission:async()=>permission.request},navigator:{userAgent:'Mozilla/5.0 (Linux; Android 16) Chrome/142',serviceWorker:{}},document:{addEventListener(){}}});
 context.window=context;context.PushManager=function(){};context.TAMOON_CONFIG={vapidPublicKey:'AQID'};
 vm.runInContext(fs.readFileSync(new URL('../../push-client.js',import.meta.url),'utf8'),context);
 vm.runInContext(fs.readFileSync(process.env.PUSH_TEST_APP_SOURCE||new URL('../../app.js',import.meta.url),'utf8'),context);
 const app=context.App;
 const state={profile:{id:'user-one'},currentGroupId:'group-one',push_subscriptions:linked?[{endpoint:subscription.endpoint,enabled:true}]:[]};
 app.state=state;
 app.repo={state,savePushSubscription:async()=>{state.push_subscriptions=[{endpoint:subscription.endpoint,enabled:true}];},removePushSubscription:async()=>{}};
 app.ensureServiceWorker=async()=>({pushManager:manager});
 const messages=[];let html='',handlers={};
 app.toast=(message,error=false)=>messages.push({message,error});
 app.modal=(title,markup,bind)=>{
  html=markup;handlers={};
  bind({querySelector:selector=>markup.includes(`id="${selector.slice(1)}"`)?{addEventListener:(event,handler)=>{handlers[selector]=handler;}}:null},()=>{html='';});
 };
 return {app,permission,messages,get html(){return html;},async click(id){assert.ok(handlers[id],id+' exists');await handlers[id]({currentTarget:{disabled:false,textContent:''}});}};
}

test('saved subscription with pending permission explains the state and keeps local diagnostic accessible',async()=>{
 const f=fixture();await f.app.openNotificationSettings();
 assert.match(f.html,/Vínculo salvo · permissão pendente/);
 assert.match(f.html,/id="localPushTest"/);
 assert.match(f.html,/id="recheckPush"/);
 assert.doesNotMatch(f.html,/Desativadas neste aparelho|id="testPush"/);
});
test('async registration grant exposes remote and local tests despite stale default snapshot',async()=>{
 const f=fixture({push:'granted'});await f.app.openNotificationSettings();
 assert.match(f.html,/id="testPush"/);assert.match(f.html,/id="localPushTest"/);
 assert.doesNotMatch(f.html,/permissão pendente/);
});
test('successful request with still-pending permission cannot display activation success',async()=>{
 const f=fixture({linked:false});await f.app.openNotificationSettings();await f.click('#enablePush');
 assert.match(f.html,/Vínculo salvo · permissão pendente/);
 assert.equal(f.messages.at(-1).error,true);assert.match(f.messages.at(-1).message,/permissão.*pendente/);
});
test('activation refreshes the same settings screen and enables the tests after confirmed grant',async()=>{
 const f=fixture({linked:false});await f.app.openNotificationSettings();f.permission.push='granted';await f.click('#enablePush');
 assert.match(f.html,/id="testPush"/);assert.equal(f.messages.at(-1).error,false);
});
test('rechecking sees permission changed in system settings without saving or rotating the subscription',async()=>{
 const f=fixture();await f.app.openNotificationSettings();
 f.permission.push='granted';await f.click('#recheckPush');assert.match(f.html,/id="testPush"/);
 f.permission.notification='denied';await f.app.openNotificationSettings();assert.match(f.html,/Bloqueadas nos ajustes/);assert.doesNotMatch(f.html,/id="testPush"/);
});

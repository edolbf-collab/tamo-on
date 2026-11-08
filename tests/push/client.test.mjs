import test from 'node:test';
import assert from 'node:assert/strict';
import '../../push-client.js';
const {register,diagnostic}=globalThis.TamoonPushClient;
const {readPermission}=globalThis.TamoonPushClient;
const key=new Uint8Array([1,2,3]);
function fixture({invalidated=false,oldKey=key,unsubscribeFails=false}={}){
 let current;const calls=[];
 const old={endpoint:'https://push.test/old',options:{applicationServerKey:oldKey.buffer},expirationTime:null,unsubscribe:async()=>{calls.push('unsubscribe');if(!unsubscribeFails)current=null;return !unsubscribeFails;}};current=old;
 const fresh={endpoint:'https://push.test/new'};
 const manager={getSubscription:async()=>current,subscribe:async()=>{calls.push('subscribe');current=fresh;return fresh;}};
 return {calls,old,fresh,options:{manager,key,record:{enabled:true,invalidated_at:invalidated?'2026-11-01':null},save:async sub=>calls.push('save:'+sub.endpoint),remove:async endpoint=>calls.push('remove:'+endpoint)}};
}
test('healthy subscription is retained without forced permission or rotation',async()=>{const f=fixture();assert.equal(await register(f.options),f.old);assert.deepEqual(f.calls,['save:https://push.test/old']);});
test('invalidated endpoint is replaced before saving, never simply re-enabled',async()=>{const f=fixture({invalidated:true});assert.equal(await register(f.options),f.fresh);assert.deepEqual(f.calls,['unsubscribe','subscribe','save:https://push.test/new','remove:https://push.test/old']);});
test('changed VAPID key rotates the subscription',async()=>{const f=fixture({oldKey:new Uint8Array([4,5,6])});await register(f.options);assert.equal(f.calls[0],'unsubscribe');});
test('manual recovery rotates even an apparently healthy endpoint',async()=>{const f=fixture();await register({...f.options,force:true});assert.equal(f.calls[0],'unsubscribe');});
test('failed unsubscribe never resaves a stale endpoint',async()=>{const f=fixture({invalidated:true,unsubscribeFails:true});await assert.rejects(register(f.options),/Não foi possível renovar/);assert.deepEqual(f.calls,['unsubscribe']);});
test('save failure does not remove the previous database record',async()=>{const f=fixture({invalidated:true});await assert.rejects(register({...f.options,save:async()=>{throw Error('network');}}),/network/);assert.equal(f.calls.some(c=>c.startsWith('remove')),false);});
test('account change during subscribe prevents binding to the wrong account',async()=>{const f=fixture({invalidated:true});let changed=false;const original=f.options.manager.subscribe;f.options.manager.subscribe=async()=>{const value=await original();changed=true;return value;};await assert.rejects(register({...f.options,assertAccount:()=>{if(changed)throw Error('account changed');}}),/account changed/);assert.equal(f.calls.some(c=>c.startsWith('save')),false);});
test('native active status is green without Web Push APIs',()=>{assert.equal(diagnostic({native:true,nativeStatus:{active:true,permission:'granted'},supported:false}).tone,'ok');});
test('browser permission alone or local subscription without server binding is not green',()=>{for(const input of [{supported:true,permission:'granted'},{supported:true,permission:'granted',subscription:{}},{supported:true,permission:'denied',subscription:{},record:{enabled:true}}])assert.equal(diagnostic(input).tone,'warn');});
test('provider acceptance does not claim display on the device',()=>{const d=diagnostic({supported:true,permission:'granted',subscription:{},record:{enabled:true,last_success_at:'2026-11-07'}});assert.equal(d.tone,'ok');assert.match(d.label,/exibição não confirmada/);});
test('query failures cannot be shown as disabled or healthy',()=>{assert.equal(diagnostic({error:true}).label,'Não foi possível verificar');});

test('expired subscription is replaced',async()=>{const f=fixture();f.old.expirationTime=Date.now()-1000;await register(f.options);assert.equal(f.calls[0],'unsubscribe');});
 test('overlapping activation cannot rotate an in-flight subscription',async()=>{const f=fixture();let release;f.options.save=()=>new Promise(resolve=>{release=resolve;});const first=register(f.options);while(!release)await Promise.resolve();await assert.rejects(register({...f.options,force:true}),/andamento/);release();await first;assert.equal(f.calls.includes('unsubscribe'),false);});

test('async push grant resolves a pending Notification snapshot without caching',async()=>{
 let state='granted';const options={notification:{permission:'default'},manager:{permissionState:async()=>state}};
 assert.equal((await readPermission(options)).permission,'granted');
 state='denied';assert.equal((await readPermission(options)).permission,'denied');
});
test('explicit notification or push denial never becomes a grant',async()=>{
 for(const [notification,push] of [['denied','granted'],['granted','denied']])
  assert.equal((await readPermission({notification:{permission:notification},manager:{permissionState:async()=>push}})).permission,'denied');
});
test('pending push permission is not inferred from old synchronous grant',async()=>{
 assert.equal((await readPermission({notification:{permission:'granted'},manager:{permissionState:async()=>'prompt'}})).permission,'default');
});
test('unsupported or failing permission query falls back without fabricating a grant',async()=>{
 for(const manager of [{},{permissionState:async()=>{throw Error('unsupported');}}]) {
  assert.equal((await readPermission({notification:{permission:'default'},manager})).permission,'default');
  assert.equal((await readPermission({notification:{permission:'granted'},manager})).permission,'granted');
 }
});

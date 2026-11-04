import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../../auth-access.js',import.meta.url),'utf8');
function fixture({flags={appleEnabled:true,linkingEnabled:true},native=null}={}) {
  const sandbox={URL,URLSearchParams,Date};vm.createContext(sandbox);vm.runInContext(source,sandbox);
  let current={id:'existing-id',email:'original@example.test',identities:[{provider:'google'}]};
  const values=new Map(),calls=[],redirects=[],cleaned=[];
  const client={auth:{getUser:async()=>({data:{user:current}}),signOut:async options=>{calls.push(['signOut',options]);current=null;},
    signInWithOAuth:async input=>{calls.push(['login',input]);return {data:{url:'https://project.supabase.co/auth/v1/authorize'}};},
    linkIdentity:async input=>{calls.push(['link',input]);return {data:{url:input.provider==='apple'?'https://appleid.apple.com/auth/authorize?state=verified':'https://accounts.google.com/o/oauth2/v2/auth?state=verified'}};}}};
  const location={href:'https://app.tamoon.app.br/?invite=TEST',search:'?invite=TEST',hash:'',assign:url=>redirects.push(url)};
  const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const api=sandbox.TamoonAuth.create({client,config:{supabaseUrl:'https://project.supabase.co',authRedirectUrl:'https://app.tamoon.app.br/'},flags,native,storage,location,history:{replaceState:(_,__,url)=>cleaned.push(url)},now:()=>10000000});
  return {api,client,values,calls,redirects,cleaned,location,storage,setUser:user=>current=user,user:()=>current,sandbox};
}
test('Apple remains unavailable until explicitly activated; Google keeps working',async()=>{
 const f=fixture({flags:{}});assert.equal(f.api.enabled('apple'),false);assert.equal(f.api.canLink('google'),false);
 await assert.rejects(f.api.login('apple'),/AUTH_NOT_AVAILABLE/);assert.equal(f.calls.length,0);
 await f.api.login('google');assert.equal(f.calls[0][0],'login');assert.equal(f.calls[0][1].options.skipBrowserRedirect,true);assert.equal(f.redirects.length,1);
});
test('linking authenticates the existing UUID and calls identity linking, never sign-in',async()=>{
 const f=fixture();await f.api.link('apple','existing-id');
 assert.deepEqual(f.calls.map(c=>c[0]),['link']);assert.equal(f.redirects.length,1);
 const pending=JSON.parse([...f.values.values()][0]);assert.deepEqual(pending,{provider:'apple',userId:'existing-id',at:10000000});
 assert.equal(f.calls[0][1].options.redirectTo,'https://app.tamoon.app.br/');
});
test('hidden Apple email links without copying, comparing or changing email/profile data',async()=>{
 const f=fixture();await f.api.link('apple','existing-id');
 f.setUser({...f.user(),identities:[...f.user().identities,{provider:'apple',identity_data:{email:'private@privaterelay.appleid.com'}}]});
 const result=await f.api.completePendingLink();assert.equal(result.ok,true);assert.equal(f.user().id,'existing-id');assert.equal(f.user().email,'original@example.test');assert.equal(f.values.size,0);assert.equal(f.cleaned[0],'/?invite=TEST');
});
test('Apple-first user can link Google to the original UUID',async()=>{
 const f=fixture();f.setUser({...f.user(),identities:[{provider:'apple'}]});await f.api.link('google','existing-id');
 assert.equal(f.calls[0][0],'link');assert.equal(f.calls[0][1].provider,'google');
 assert.equal(f.calls[0][1].options.queryParams.prompt,'select_account');
});
test('account switched before linking never starts a provider transaction',async()=>{
 const f=fixture();await assert.rejects(f.api.link('apple','other-id'),/ACCOUNT_CHANGED/);assert.equal(f.calls.length,0);assert.equal(f.values.size,0);
});
test('account switched on return closes local session and never reports success',async()=>{
 const f=fixture();await f.api.link('apple','existing-id');f.setUser({id:'other-id',identities:[{provider:'apple'}]});
 assert.equal((await f.api.completePendingLink()).ok,false);assert.equal(f.user(),null);assert.equal(f.calls.at(-1)[1].scope,'local');
});
test('already-linked identity is a no-op',async()=>{
 const f=fixture();assert.equal((await f.api.link('google','existing-id')).ok,true);assert.equal(f.calls.length,0);assert.equal(f.values.size,0);
});
test('identity belonging to another account is not merged or retried as sign-in',async()=>{
 const f=fixture();f.client.auth.linkIdentity=async()=>{throw {code:'identity_already_exists'};};
 await assert.rejects(f.api.link('apple','existing-id'));assert.equal(f.values.size,0);assert.equal(f.redirects.length,0);assert.equal(f.user().id,'existing-id');
 assert.match(f.sandbox.TamoonAuth.errorMessage({code:'identity_already_exists'}),/não foram unidos/);
});
test('cancelled callback preserves the original session and invite',async()=>{
 const f=fixture();await f.api.link('apple','existing-id');f.location.search='?invite=TEST&error=access_denied';f.location.href='https://app.tamoon.app.br/'+f.location.search;
 const result=await f.api.completePendingLink();assert.equal(result.ok,false);assert.match(result.message,/cancelada/);assert.equal(f.user().id,'existing-id');assert.equal(f.cleaned[0],'/?invite=TEST');
});
test('incomplete, expired and malformed transactions never announce success',async()=>{
 for(const at of [10000000,1,'invalid',10000001]){
  const f=fixture();f.values.set('tamoon-pending-identity-link',JSON.stringify({provider:'apple',userId:'existing-id',at}));
  assert.equal((await f.api.completePendingLink()).ok,false);assert.equal(f.values.size,0);
 }
});
test('unavailable local storage blocks linking before calling the provider',async()=>{
 const f=fixture();f.storage.setItem=()=>{throw Error('blocked');};await assert.rejects(f.api.link('apple','existing-id'),/STORAGE_UNAVAILABLE/);assert.equal(f.calls.length,0);
});
test('unrecognized providers and redirect domains are refused',async()=>{
 const f=fixture();await assert.rejects(f.api.login('github'),/AUTH_NOT_AVAILABLE/);
 f.client.auth.linkIdentity=async()=>({data:{url:'https://attacker.test/auth'}});
 await assert.rejects(f.api.link('apple','existing-id'),/INVALID_AUTH_URL/);assert.equal(f.redirects.length,0);assert.equal(f.values.size,0);
});
test('native Apple linking and Google OAuth both use the native bridge',async()=>{
 let f;const calls=[];const native={isIOS:true,appleAuth:async(_,linking)=>{calls.push(['apple',linking]);f.setUser({...f.user(),identities:[{provider:'apple'},{provider:'google'}]});},finishOAuth:async(_,url,provider,linking)=>{calls.push([provider,linking]);f.setUser({...f.user(),identities:[{provider:'apple'},{provider:'google'}]});}};
 f=fixture({native});assert.equal((await f.api.link('apple','existing-id')).ok,true);assert.deepEqual(calls,[['apple',true]]);
 f.setUser({...f.user(),identities:[{provider:'apple'}]});assert.equal((await f.api.link('google','existing-id')).ok,true);assert.equal(f.calls[0][1].options.redirectTo,'br.app.tamoon://auth/callback');assert.equal(f.redirects.length,0);
});
test('ordinary Android browser shows both; installed Android groups alternatives',()=>{
 const f=fixture();f.sandbox.navigator={userAgent:'Android'};f.sandbox.document={referrer:''};f.sandbox.matchMedia=()=>({matches:false});
 assert.equal(Boolean(f.sandbox.TamoonAuth.androidApp()),false);f.sandbox.matchMedia=()=>({matches:true});assert.equal(f.sandbox.TamoonAuth.androidApp(),true);
 f.sandbox.navigator.userAgent='iPhone';assert.equal(f.sandbox.TamoonAuth.androidApp(),false);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../functions/community-marketplace-session/handler.mjs';

const owner = {id:'community-owner',email:'owner@example.test',email_confirmed_at:'2026-01-01',identities:[{provider:'google'}]};
function fixture(overrides={}) {
  const calls=[];
  const community={auth:{getUser:async token=>{calls.push(['getUser',token]);return overrides.auth || {data:{user:owner}};}},
    rpc:async name=>name==='community_marketplace_pilot_context' ? (overrides.context || {data:{user_id:owner.id,marketplace_user_id:'market-owner',group_id:'test-group',name:'Teste FC'}}) : ({data:name==='is_platform_admin' ? overrides.admin !== false : {allowed:overrides.legal !== false}})};
  const admin={rpc:async(name,args)=>{if(name==='pilot_import_community_group'){calls.push(['import',args]);return overrides.importResult || {data:'market-group'}}calls.push(['mapping',args]);return overrides.mapping || {data:{marketplace_id:'market-owner',email:owner.email,can_sync_community:true}}},
    auth:{admin:{generateLink:async args=>{calls.push(['mint',args]);return {data:{user:{id:'market-owner'},properties:{hashed_token:'one-time-token'}}}}}}};
  const market={auth:{verifyOtp:async args=>{calls.push(['verify',args]);return {data:{user:{id:'market-owner'},session:{access_token:'access',refresh_token:'refresh'}}}}}};
  const handler=createHandler({communityUrl:'https://community.test',communityKey:'public',env:n=>({SUPABASE_URL:'https://market.test',SUPABASE_SERVICE_ROLE_KEY:'server-secret',SUPABASE_ANON_KEY:'market-public'}[n]),
    createClient:(url,key)=>url==='https://community.test'?community:key==='server-secret'?admin:market});
  return {calls,handler};
}
function req(action='session',headers={}) {return new Request('https://bridge.test',{method:'POST',headers:{Authorization:'Bearer community-token','Content-Type':'application/json',Origin:'https://app.tamoon.app.br',...headers},body:JSON.stringify({action,email:'attacker@example.test',marketplace_id:'attacker'})})}
test('rejects missing bearer before any backend call',async()=>{const f=fixture();assert.equal((await f.handler(req('session',{Authorization:''}))).status,401);assert.equal(f.calls.length,0)});
test('rejects foreign origin before auth',async()=>{const f=fixture();assert.equal((await f.handler(req('session',{Origin:'https://evil.test'}))).status,403);assert.equal(f.calls.length,0)});
test('auth failure cannot mint',async()=>{const f=fixture({auth:{error:{message:'invalid'}}});assert.equal((await f.handler(req())).status,401);assert.equal(f.calls.some(c=>c[0]==='mint'),false)});
test('non-owner mapping cannot mint',async()=>{const f=fixture({mapping:{error:{code:'PT403'}}});assert.equal((await f.handler(req())).status,403);assert.equal(f.calls.some(c=>c[0]==='mint'),false)});
test('rate limit cannot mint',async()=>{const f=fixture({mapping:{error:{code:'PT429'}}});assert.equal((await f.handler(req())).status,429)});
test('email mismatch cannot mint',async()=>{const f=fixture({mapping:{data:{marketplace_id:'market-owner',email:'different@example.test'}}});assert.equal((await f.handler(req())).status,403)});
test('supported identity and confirmed email required',async()=>{for(const patch of [{identities:[]},{email_confirmed_at:null}]){const f=fixture({auth:{data:{user:{...owner,...patch}}}});assert.equal((await f.handler(req())).status,403)}});
test('legal access required',async()=>{for(const patch of [{legal:false}]){const f=fixture(patch);assert.equal((await f.handler(req())).status,403);assert.equal(f.calls.some(c=>c[0]==='mint'),false)}});
test('status validates identity without generating session',async()=>{const f=fixture();const r=await f.handler(req('status'));assert.equal(r.status,200);assert.deepEqual(await r.json(),{allowed:true,canSyncCommunity:true,environment:'staging',realMoney:false});assert.equal(f.calls.some(c=>c[0]==='mint'),false);assert.equal(f.calls.find(c=>c[0]==='mapping')[1].p_exchange,false)});
test('session ignores supplied target and sends no email',async()=>{const f=fixture();const r=await f.handler(req());assert.equal(r.status,200);assert.deepEqual(await r.json(),{session:{access_token:'access',refresh_token:'refresh'},canSyncCommunity:true,environment:'staging',realMoney:false});assert.deepEqual(f.calls.find(c=>c[0]==='mint')[1],{type:'magiclink',email:owner.email});assert.equal(r.headers.get('cache-control'),'no-store')});
test('only allowlisted preview origin receives CORS headers',async()=>{const f=fixture();const r=await f.handler(req('status',{Origin:'https://marketplace-build-166.resenhafc-beta.pages.dev'}));assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://marketplace-build-166.resenhafc-beta.pages.dev')});
test('unknown action and GET rejected',async()=>{const f=fixture();assert.equal((await f.handler(req('impersonate'))).status,400);assert.equal((await f.handler(new Request('https://bridge.test'))).status,405)});
test('group import uses verified Community context and does not mint a session',async()=>{const f=fixture();const r=await f.handler(req('import_group'));assert.equal(r.status,200);assert.deepEqual(await r.json(),{group_id:'market-group',community_group_id:'test-group',name:'Teste FC'});assert.equal(f.calls.some(c=>c[0]==='mint'),false);assert.equal(f.calls.find(c=>c[0]==='import')[1].p_context.group_id,'test-group')});
test('missing or mismatched group context cannot import',async()=>{for(const context of [{error:{message:'denied'}},{data:{user_id:'other',marketplace_user_id:'market-owner'}},{data:{user_id:owner.id,marketplace_user_id:'other'}}]){const f=fixture({context});assert.equal((await f.handler(req('import_group'))).status,403);assert.equal(f.calls.some(c=>c[0]==='import'),false)}});
test('failed group import returns a retryable failure',async()=>{const f=fixture({importResult:{error:{message:'unavailable'}}});assert.equal((await f.handler(req('import_group'))).status,503)});

test('allowlisted customer is not required to be a platform admin',async()=>{const f=fixture({admin:false,mapping:{data:{marketplace_id:'market-owner',email:owner.email,can_sync_community:false}}});const r=await f.handler(req());assert.equal(r.status,200);assert.equal((await r.json()).canSyncCommunity,false)});
test('test accounts cannot import the owner group',async()=>{const f=fixture({mapping:{data:{marketplace_id:'market-owner',email:owner.email,can_sync_community:false}}});assert.equal((await f.handler(req('import_group'))).status,403);assert.equal(f.calls.some(c=>c[0]==='import'),false)});
test('mapping email is supplied from verified Auth identity only',async()=>{const f=fixture();await f.handler(req());assert.equal(f.calls.find(c=>c[0]==='mapping')[1].p_verified_email,owner.email)});
test('legacy production Pages origin works for installed clients',async()=>{const f=fixture();const r=await f.handler(req('status',{Origin:'https://resenhafc-beta.pages.dev'}));assert.equal(r.status,200);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://resenhafc-beta.pages.dev')});

test('Apple identity can reuse the existing allowlisted account without changing permissions',async()=>{
 const f=fixture({auth:{data:{user:{...owner,identities:[{provider:'apple',identity_data:{email:'hidden@privaterelay.appleid.com'}}]}}},mapping:{data:{marketplace_id:'market-owner',email:owner.email,can_sync_community:false}}});
 const response=await f.handler(req());assert.equal(response.status,200);assert.equal((await response.json()).canSyncCommunity,false);
 assert.equal(f.calls.find(c=>c[0]==='mapping')[1].p_community_id,owner.id);
 assert.equal(f.calls.find(c=>c[0]==='mapping')[1].p_verified_email,owner.email);
});
test('Apple does not grant access outside the pilot allowlist',async()=>{
 const f=fixture({auth:{data:{user:{...owner,identities:[{provider:'apple'}]}}},mapping:{error:{code:'PT403'}}});
 assert.equal((await f.handler(req())).status,403);assert.equal(f.calls.some(c=>c[0]==='mint'),false);
});
test('editable metadata cannot impersonate a verified Apple or Google identity',async()=>{
 for(const identities of [[],[{provider:'email'}]]){
  const f=fixture({auth:{data:{user:{...owner,identities,user_metadata:{provider:'apple',providers:['google','apple']}}}}});
  assert.equal((await f.handler(req())).status,403);assert.equal(f.calls.some(c=>c[0]==='mapping'),false);
 }
});

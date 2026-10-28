import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../functions/community-marketplace-session/handler.mjs';

const owner = {id:'community-owner',email:'owner@example.test',email_confirmed_at:'2026-01-01',identities:[{provider:'google'}]};
function fixture(overrides={}) {
  const calls=[];
  const community={auth:{getUser:async token=>{calls.push(['getUser',token]);return overrides.auth || {data:{user:owner}};}},
    rpc:async name=>({data:name==='is_platform_admin' ? overrides.admin !== false : {allowed:overrides.legal !== false}})};
  const admin={rpc:async(name,args)=>{calls.push(['mapping',args]);return overrides.mapping || {data:{marketplace_id:'market-owner',email:owner.email}}},
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
test('Google identity and confirmed email required',async()=>{for(const patch of [{identities:[]},{email_confirmed_at:null}]){const f=fixture({auth:{data:{user:{...owner,...patch}}}});assert.equal((await f.handler(req())).status,403)}});
test('Community admin and legal access both required',async()=>{for(const patch of [{admin:false},{legal:false}]){const f=fixture(patch);assert.equal((await f.handler(req())).status,403);assert.equal(f.calls.some(c=>c[0]==='mint'),false)}});
test('status validates identity without generating session',async()=>{const f=fixture();const r=await f.handler(req('status'));assert.equal(r.status,200);assert.deepEqual(await r.json(),{allowed:true,environment:'staging',realMoney:false});assert.equal(f.calls.some(c=>c[0]==='mint'),false);assert.equal(f.calls.find(c=>c[0]==='mapping')[1].p_exchange,false)});
test('session ignores supplied target and sends no email',async()=>{const f=fixture();const r=await f.handler(req());assert.equal(r.status,200);assert.deepEqual(await r.json(),{session:{access_token:'access',refresh_token:'refresh'},environment:'staging',realMoney:false});assert.deepEqual(f.calls.find(c=>c[0]==='mint')[1],{type:'magiclink',email:owner.email});assert.equal(r.headers.get('cache-control'),'no-store')});
test('only allowlisted preview origin receives CORS headers',async()=>{const f=fixture();const r=await f.handler(req('status',{Origin:'https://marketplace-build-166.resenhafc-beta.pages.dev'}));assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://marketplace-build-166.resenhafc-beta.pages.dev')});
test('unknown action and GET rejected',async()=>{const f=fixture();assert.equal((await f.handler(req('impersonate'))).status,400);assert.equal((await f.handler(new Request('https://bridge.test'))).status,405)});

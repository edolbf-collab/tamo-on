import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGateway} from '../../community/pilot-gateway.mjs';
function setup(options={}) {
 const calls=[];const snapshot=[{occurrence_id:'from-server'}];
 const community={auth:{getUser:async()=>({data:{user:{id:'community-user'}}})},rpc:async()=>({data:{user_id:'community-user',marketplace_user_id:options.other?'other':'market-user',group_id:'test-group'}})};
 const market={auth:{getUser:async()=>options.expired?{error:'expired'}:{data:{user:{id:'market-user'}}}},rpc:async()=>options.exportFailure?{error:'denied'}:{data:snapshot}};
 const admin={rpc:async(name,args)=>{calls.push({name,args});return options.applyFailure?{error:'offline'}:{data:{updated:1}}}};
 const handle=createGateway({marketUrl:'https://market.test',marketKey:'public',env:name=>({SUPABASE_URL:'https://community.test',SUPABASE_SERVICE_ROLE_KEY:'server',SUPABASE_ANON_KEY:'public'}[name]),
   createClient:(url,key)=>url==='https://market.test'?market:key==='server'?admin:community,
   fetcher:async()=>new Response('{}',{status:options.importFailure?503:200})});
 const req=(extra={})=>new Request('https://gateway.test',{method:'POST',headers:{Authorization:'Bearer community','X-Marketplace-Authorization':'Bearer market',...extra},body:JSON.stringify({action:'sync',p_items:[{occurrence_id:'forged'}],group_id:'other-group'})});
 return {handle,calls,req,snapshot};
}
test('gateway ignores browser snapshots and group IDs',async()=>{const f=setup();assert.equal((await f.handle(f.req())).status,200);assert.deepEqual(f.calls[0].args,{p_actor:'community-user',p_items:f.snapshot})});
test('both identities must match configured owner',async()=>{const f=setup({other:true});assert.equal((await f.handle(f.req())).status,403);assert.equal(f.calls.length,0)});
test('expired Marketplace identity cannot write Community',async()=>{const f=setup({expired:true});assert.equal((await f.handle(f.req())).status,401);assert.equal(f.calls.length,0)});
test('missing second session cannot write',async()=>{const f=setup();assert.equal((await f.handle(f.req({'X-Marketplace-Authorization':''}))).status,401);assert.equal(f.calls.length,0)});
test('import/export failures cannot write',async()=>{for(const opts of [{importFailure:true},{exportFailure:true}]){const f=setup(opts);assert.ok((await f.handle(f.req())).status>=400);assert.equal(f.calls.length,0)}});
test('failed destination reports retryable failure',async()=>{const f=setup({applyFailure:true});assert.equal((await f.handle(f.req())).status,503)});
test('foreign origins cannot invoke sync',async()=>{const f=setup();assert.equal((await f.handle(f.req({Origin:'https://evil.test'}))).status,403);assert.equal(f.calls.length,0)});

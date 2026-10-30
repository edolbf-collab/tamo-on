import {test} from 'node:test';
import assert from 'node:assert/strict';
import access from '../../../marketplace-access.js';
const session=id=>({user:{id},access_token:'test-access'});
const response=(status,data)=>new Response(JSON.stringify(data),{status});
const allow=()=>response(200,{allowed:true,canSyncCommunity:true});
function setup(options={}) {
 const changes=[],timers=[];let current=session('owner');
 const monitor=access.createMonitor({getSession:async()=>current,onChange:s=>changes.push(s),
  fetcher:async()=>allow(),schedule:fn=>{timers.push(fn);return timers.length},cancel:()=>{},...options});
 return {monitor,changes,timers,setSession:s=>{current=s}};
}
test('works without AbortSignal.timeout (older WebKit)',async()=>{
 const saved=AbortSignal.timeout;AbortSignal.timeout=undefined;
 try {const f=setup();await f.monitor.check();assert.equal(f.changes.at(-1).allowed,true);f.monitor.dispose();}
 finally{AbortSignal.timeout=saved}
});
test('transient network failure retries without restarting the app',async()=>{
 let calls=0;const f=setup({fetcher:async()=>{if(++calls===1)throw new Error('offline');return allow()}});
 await f.monitor.check();assert.equal(f.changes.at(-1).status,'unavailable');assert.equal(f.timers.length,1);
 await f.monitor.check({force:true});assert.equal(f.changes.at(-1).allowed,true);f.monitor.dispose();
});
test('expired access refreshes the session once before deciding',async()=>{
 let calls=0,refreshes=0;const f=setup({fetcher:async()=>++calls===1?response(401,{}):allow(),refreshSession:async()=>{refreshes++}});
 await f.monitor.check();assert.equal(refreshes,1);assert.equal(f.changes.at(-1).allowed,true);f.monitor.dispose();
});
test('resuming can restore access after a denial without granting it locally',async()=>{
 let allowed=false;const f=setup({fetcher:async()=>allowed?allow():response(403,{error:'PILOT_RESTRICTED'})});
 await f.monitor.check();assert.equal(f.changes.at(-1).allowed,false);
 allowed=true;await f.monitor.check({force:true});assert.equal(f.changes.at(-1).allowed,true);f.monitor.dispose();
});
test('late response after account switch cannot reveal restricted buttons',async()=>{
 let finish;const f=setup({fetcher:()=>new Promise(resolve=>{finish=resolve})});
 const pending=f.monitor.check();await new Promise(resolve=>setImmediate(resolve));
 f.setSession(session('other'));f.monitor.reset();finish(allow());await pending;
 assert.equal(f.changes.some(s=>s.allowed),false);f.monitor.dispose();
});
test('allowed customer has marketplace access without group sync capability',async()=>{
 const f=setup({fetcher:async()=>response(200,{allowed:true,canSyncCommunity:false})});await f.monitor.check();
 assert.equal(f.changes.at(-1).allowed,true);assert.equal(f.changes.at(-1).canSyncCommunity,false);f.monitor.dispose();
});
test('signed out and revoked identities stay locked',async()=>{
 const f=setup();f.setSession(null);await f.monitor.check();assert.equal(f.changes.at(-1).status,'signed_out');f.monitor.dispose();
 const g=setup({fetcher:async()=>response(403,{error:'PILOT_RESTRICTED'})});await g.monitor.check();
 assert.equal(g.changes.at(-1).allowed,false);assert.equal(g.timers.length,0);g.monitor.dispose();
});

test('prefetch accepts only the hashed public bundle and omits credentials',async()=>{
 const calls=[];const manifest=['assets/pilot-a123456789ab.js','../supabase-config.js','https://untrusted.test/script.js','assets/../../secret.js','assets/pilot-not-a-hash.js'];
 await access.preloadMarketplace(async(url,options)=>{calls.push({url,options});return response(200,url.includes('pilot-assets.json')?manifest:{});});
 assert.deepEqual(calls.map(c=>c.url),['/marketplace/pilot-assets.json?v=166r13','/marketplace/assets/pilot-a123456789ab.js']);
 assert.equal(calls[1].options.credentials,'omit');assert.equal(calls[1].options.cache,'force-cache');
});
test('failed prefetch rejects so a later entry can retry',async()=>{
 await assert.rejects(access.preloadMarketplace(async()=>response(503,{})),/PREFETCH_UNAVAILABLE/);
});

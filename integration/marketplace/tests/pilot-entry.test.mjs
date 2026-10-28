import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import access from '../../../marketplace-access.js';
const source=fs.readFileSync(new URL('../../../marketplace/pilot-entry.js',import.meta.url),'utf8');
async function start(scenario) {
 const owner=scenario==='owner',allowed=['owner','customer','partner'].includes(scenario),actions=[],requests=[],classes=new Set(['pilot-locked']);
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:'',addEventListener(){}});return nodes.get(id)};
 let ready,authChanged;const finished=new Promise(resolve=>{ready=resolve});
 const current=scenario==='anonymous'?null:{user:{id:'community'},access_token:'verified-community'};
 const community={auth:{getSession:async()=>({data:{session:current}}),onAuthStateChange:fn=>{authChanged=fn},refreshSession:async()=>{}}};
 const marketSession={access_token:'market',refresh_token:'market-refresh'};
 const sandbox={console,URL,URLSearchParams,Response,setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},
  sessionStorage:{removeItem(){}},location:{assign(){},reload(){}},
  document:{getElementById:node,querySelector:()=>node('syncBar'),createElement:()=>({}),addEventListener(){},
   body:{classList:{add:c=>{classes.add(c);ready()},remove:c=>{classes.delete(c);ready()}},append:tag=>queueMicrotask(()=>tag.onload())}},
  fetch:async url=>{requests.push(url);return new Response('[]',{status:200})},
  window:{addEventListener(){},supabase:{createClient:()=>community},TAMOON_CONFIG:{supabaseUrl:'https://community.test',supabasePublishableKey:'public'},
   TamoonPilotAccess:{...access,fetchWithTimeout:async(url,options)=>{
    requests.push(url);const action=JSON.parse(options.body).action;actions.push(action);
    if(!allowed)return new Response(JSON.stringify({error:'PILOT_RESTRICTED'}),{status:403});
    return new Response(JSON.stringify(action==='sync'?{group_name:'Teste FC',updated:1}:{session:marketSession,allowed:true,canSyncCommunity:owner}),{status:200});
   }},
   MarketplaceBackend:{client:{auth:{getSession:async()=>({data:{session:marketSession}}),signOut:async()=>{}}},
    init:async()=>{assert.deepEqual(sandbox.window.TamoonMarketplacePilot.takeSession(),marketSession);sandbox.window.TamoonMarketplacePilot.ready();}}}
 };
 vm.runInNewContext(source,sandbox);
 await Promise.race([finished,new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('gate did not settle')),1000);t.unref()})]);
 await new Promise(resolve=>setImmediate(resolve));
 return {actions,requests,classes,nodes,sandbox,authChanged};
}
for(const scenario of ['customer','partner'])test(`${scenario} opens without importing or syncing owner group`,async()=>{
 const f=await start(scenario);assert.equal(f.classes.has('pilot-locked'),false);assert.equal(f.nodes.get('syncBar').hidden,true);
 assert.deepEqual(f.actions,['session']);
 await f.sandbox.window.TamoonMarketplacePilot.sync();assert.deepEqual(f.actions,['session']);
 f.authChanged('SIGNED_OUT',null);assert.equal(f.classes.has('pilot-locked'),true);
});
test('owner retains group import and synchronization',async()=>{
 const f=await start('owner');assert.equal(f.classes.has('pilot-locked'),false);assert.equal(f.nodes.get('syncBar').hidden,false);
 assert.deepEqual(f.actions,['session','import_group','sync']);
});
for(const scenario of ['anonymous','denied'])test(`${scenario} stays locked before loading marketplace assets`,async()=>{
 const f=await start(scenario);assert.equal(f.classes.has('pilot-locked'),true);
 assert.equal(f.requests.some(x=>x.includes('pilot-assets.json')),false);
});

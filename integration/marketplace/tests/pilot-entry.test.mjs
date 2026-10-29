import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import access from '../../../marketplace-access.js';
const source=fs.readFileSync(new URL('../../../marketplace/pilot-entry.js',import.meta.url),'utf8');
async function start(scenario,options={}) {
 const owner=scenario==='owner',allowed=['owner','customer','partner'].includes(scenario),actions=[],requests=[],classes=new Set(['pilot-locked']);
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:'',listeners:{},addEventListener(event,fn){this.listeners[event]=fn},focus(){this.focused=true}});return nodes.get(id)};
 const signOuts=[],navigations=[],dialogs=[],timeouts=new Map(),windowEvents={},documentEvents={},emitted=[];let initialized=false,sequence=0,observer;
 let ready,authChanged;const finished=new Promise(resolve=>{ready=resolve});
 const current=scenario==='anonymous'?null:{user:{id:'community'},access_token:'verified-community'};
 const community={auth:{getSession:async()=>({data:{session:current}}),onAuthStateChange:fn=>{authChanged=fn},refreshSession:async()=>{}}};
 const marketSession={access_token:'market',refresh_token:'market-refresh'};
 const sandbox={console,URL,URLSearchParams,Response,Event,MutationObserver:class{constructor(fn){observer=fn}observe(){}},
  setTimeout:(fn,delay)=>{timeouts.set(++sequence,{fn,delay});return sequence},clearTimeout:id=>timeouts.delete(id),setInterval:()=>1,clearInterval(){},
  sessionStorage:{removeItem(){}},location:{assign:path=>navigations.push(path),reload(){navigations.push('reload')}},
  document:{hidden:false,visibilityState:'visible',getElementById:node,querySelector:()=>node('syncBar'),querySelectorAll:()=>dialogs.filter(x=>x.open),createElement:()=>({}),addEventListener:(event,fn)=>{documentEvents[event]=fn},
   body:{classList:{add:c=>{classes.add(c);ready()},remove:c=>{classes.delete(c);ready()}},append:tag=>queueMicrotask(()=>tag.onload())}},
  fetch:async url=>{requests.push(url);if(options.logoutDuringAssets)authChanged('SIGNED_OUT',null);return new Response('[]',{status:200})},
  window:{addEventListener:(event,fn)=>{windowEvents[event]=fn},dispatchEvent:event=>emitted.push(event.type),supabase:{createClient:()=>community},TAMOON_CONFIG:{supabaseUrl:'https://community.test',supabasePublishableKey:'public'},
   TamoonPilotAccess:{...access,fetchWithTimeout:async(url,requestOptions)=>{
    requests.push(url);const action=JSON.parse(requestOptions.body).action;actions.push(action);
    if(action==='status' && options.statusResponse)return options.statusResponse();
    if(!allowed)return new Response(JSON.stringify({error:'PILOT_RESTRICTED'}),{status:403});
    return new Response(JSON.stringify(action==='sync'?{group_name:'Teste FC',updated:1}:action==='session'?{session:marketSession,canSyncCommunity:owner}:{allowed:true,canSyncCommunity:owner}),{status:200});
   }},
   MarketplaceBackend:{client:{auth:{getSession:async()=>({data:{session:marketSession}}),signOut:async settings=>{signOuts.push(settings);if(options.signOutFails)throw new Error('offline')}}},
    init:async()=>{initialized=true;assert.deepEqual(sandbox.window.TamoonMarketplacePilot.takeSession(),marketSession);sandbox.window.TamoonMarketplacePilot.ready();}}}
 };
 vm.runInNewContext(source,sandbox);
 await Promise.race([finished,new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('gate did not settle')),1000);t.unref()})]);
 await new Promise(resolve=>setImmediate(resolve));
 return {actions,requests,classes,nodes,sandbox,authChanged,signOuts,navigations,initialized,dialogs,timeouts,windowEvents,documentEvents,emitted,observer};
}
for(const scenario of ['customer','partner'])test(`${scenario} opens without importing or syncing owner group`,async()=>{
 const f=await start(scenario);assert.equal(f.classes.has('pilot-locked'),false);assert.equal(f.nodes.get('syncBar').hidden,true);
 assert.deepEqual(f.actions,['session']);
 await f.sandbox.window.TamoonMarketplacePilot.sync();assert.deepEqual(f.actions,['session']);
 f.authChanged('SIGNED_OUT',null);assert.equal(f.classes.has('pilot-locked'),true);
});
test('owner imports the group, while manual sync is only diagnostic',async()=>{
 const f=await start('owner');assert.equal(f.classes.has('pilot-locked'),false);assert.equal(f.nodes.get('syncBar').hidden,false);
 assert.deepEqual(f.actions,['session','import_group']);
 await f.sandbox.window.TamoonMarketplacePilot.sync();assert.deepEqual(f.actions,['session','import_group','sync']);
});
for(const scenario of ['anonymous','denied'])test(`${scenario} stays locked before loading marketplace assets`,async()=>{
 const f=await start(scenario);assert.equal(f.classes.has('pilot-locked'),true);
 assert.equal(f.requests.some(x=>x.includes('pilot-assets.json')),false);
});

test('return clears only the Marketplace session and navigates to Community',async()=>{
 const f=await start('customer');
 await f.sandbox.window.TamoonMarketplacePilot.leave();
 assert.deepEqual(JSON.parse(JSON.stringify(f.signOuts)),[{scope:'local'}]);
 assert.deepEqual(f.navigations,['/']);
 assert.equal(f.classes.has('pilot-locked'),true);
 assert.equal(f.classes.has('pilot-leaving'),true);
 assert.equal(f.nodes.get('pilotMessage').textContent,'Voltando à Comunidade…');
 assert.equal(f.sandbox.window.TamoonMarketplacePilot.leaving,true);
 await f.sandbox.window.TamoonMarketplacePilot.leave();assert.equal(f.signOuts.length,1);
});
test('return still navigates when Marketplace session cleanup fails',async()=>{
 const f=await start('customer',{signOutFails:true});
 await f.sandbox.window.TamoonMarketplacePilot.leave();assert.deepEqual(f.navigations,['/']);
});
test('Community logout during asset loading cannot initialize Marketplace',async()=>{
 const f=await start('customer',{logoutDuringAssets:true});
 assert.equal(f.initialized,false);assert.equal(f.classes.has('pilot-locked'),true);
 f.sandbox.window.TamoonMarketplacePilot.ready();assert.equal(f.classes.has('pilot-locked'),true);
});

test('a fatal failure closes every modal before exposing usable recovery controls',async()=>{
 const f=await start('customer');let cancelled=0,stopped=0;
 f.sandbox.window.MarketplaceAsaasCommunication={cancel(){cancelled++}};
 f.sandbox.window.MarketplaceInlinePix={stop(){stopped++}};
 const dialog={open:true,close(value){assert.equal(value,'cancel');this.open=false}};f.dialogs.push(dialog);
 f.sandbox.window.TamoonMarketplacePilot.fail();
 assert.equal(dialog.open,false);assert.ok(cancelled&&stopped);assert.equal(f.nodes.get('pilotRetry').focused,true);
 f.nodes.get('pilotRetry').listeners.click();assert.deepEqual(f.navigations,['reload']);
 // A late payment callback must not trap the recovery screen in the top layer again.
 dialog.open=true;f.observer();assert.equal(dialog.open,false);
 f.sandbox.window.TamoonMarketplacePilot.ready();assert.equal(f.classes.has('pilot-locked'),true);
});
test('statement timeout after entry keeps the payment dialog and schedules one read recovery',async()=>{
 const f=await start('customer'),pilot=f.sandbox.window.TamoonMarketplacePilot;
 const dialog={open:true,close(){this.open=false}};f.dialogs.push(dialog);
 const error={code:'57014',message:'canceling statement due to statement timeout'};
 pilot.handleError(error);pilot.handleError(error);
 assert.equal(f.classes.has('pilot-locked'),false);assert.equal(dialog.open,true);assert.equal(f.timeouts.size,1);
 const [id,task]=[...f.timeouts][0];f.timeouts.delete(id);assert.equal(task.delay,2000);await task.fn();await new Promise(r=>setImmediate(r));
 assert.deepEqual(f.actions,['session','status']);assert.deepEqual(f.emitted,['tamoon-marketplace-retry']);
 pilot.ready();assert.equal(f.timeouts.size,0);
});
test('recovery backs off after server errors without minting another payment or session',async()=>{
 const f=await start('customer',{statusResponse:()=>new Response('unavailable',{status:503})});
 f.windowEvents.offline();
 let [id,task]=[...f.timeouts][0];f.timeouts.delete(id);await task.fn();await new Promise(r=>setImmediate(r));
 assert.equal([...f.timeouts.values()][0].delay,4000);assert.deepEqual(f.actions,['session','status']);assert.equal(f.classes.has('pilot-locked'),false);
});
test('a real access denial during recovery locks the page and cancels retries',async()=>{
 const f=await start('customer',{statusResponse:()=>new Response('{"error":"PILOT_RESTRICTED"}',{status:403})});
 f.windowEvents.offline();await f.windowEvents.online();await new Promise(r=>setImmediate(r));
 assert.equal(f.classes.has('pilot-locked'),true);assert.equal(f.timeouts.size,0);
 assert.equal(f.sandbox.window.TamoonMarketplacePilot.isTransient({status:403,message:'network denied'}),false);
});
test('checks are deduplicated on resume and a hidden app does not query access',async()=>{
 let resolve;const response=new Promise(r=>{resolve=r});
 const f=await start('customer',{statusResponse:()=>response});
 f.sandbox.document.hidden=true;f.windowEvents.online();assert.deepEqual(f.actions,['session']);
 f.sandbox.document.hidden=false;f.windowEvents.online();f.documentEvents.visibilitychange();await new Promise(r=>setImmediate(r));
 assert.deepEqual(f.actions,['session','status']);resolve(new Response('{"allowed":true}',{status:200}));await new Promise(r=>setImmediate(r));
});

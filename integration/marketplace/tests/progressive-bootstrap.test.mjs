import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../../marketplace/frontend/backend/marketplace-backend.js',import.meta.url),'utf8');
const appSource=fs.readFileSync(new URL('../../../marketplace/app.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
async function fixture({blocked=false,preview=false,delayPhotos=false}={}){
 const extra=deferred(),photos=deferred(),calls=[];let authChanged;
 const snapshot={profile:{id:'owner',status:blocked?'blocked':'active'},is_admin:false,partners:[],venues:[],spaces:[],venue_photos:delayPhotos?[{storage_path:'photo.jpg'}]:[],partner_memberships:[]};
 const client={auth:{setSession:async()=>({data:{session:{user:{id:'owner'}}}}),onAuthStateChange:fn=>{authChanged=fn}},
  rpc:async name=>{calls.push(name);if(name==='partner_readonly_status')return {data:{active:preview}};if(name==='marketplace_bootstrap')return {data:snapshot};if(name==='partner_readonly_bootstrap')return {data:{...snapshot,preview:{active:true,partner_id:'partner'}}};return {data:[]}},
  from:name=>{calls.push(name);const request=name==='cancellation_requests'?extra.promise:Promise.resolve({data:[]});const builder={select:()=>builder,order:()=>builder,then:(...args)=>request.then(...args)};return builder},
  storage:{from:()=>({createSignedUrls:()=>delayPhotos?photos.promise:Promise.resolve({data:[]})})}};
 const sandbox={console,setTimeout,clearTimeout,Date,Map,Set,CustomEvent:class {constructor(type,{detail}){this.type=type;this.detail=detail}},
  window:{TAMO_ON_MARKETPLACE_BACKEND_CONFIG:{enabled:true,supabaseUrl:'https://example.test',supabasePublishableKey:'public'},
   supabase:{createClient:()=>client},dispatchEvent(){},TamoonMarketplacePilot:{takeSession:()=>({access_token:'test',refresh_token:'test'}),fail(){}}}};
 vm.runInNewContext(source,sandbox);await sandbox.window.MarketplaceBackend.init();
 return {backend:sandbox.window.MarketplaceBackend,extra,photos,calls,snapshot,authChanged};
}
test('verified discovery is delivered before financial directories finish',async()=>{
 const f=await fixture();let core=null,complete=false;
 const pending=f.backend.bootstrap({force:true,onCore:value=>{core=value}}).then(value=>{complete=true;return value});
 await tick();assert.equal(core,f.snapshot);assert.equal(complete,false);assert.equal(f.backend.bootstrapCache,null);
 assert.ok(f.calls.includes('reservation_financial_status_directory'));
 f.extra.resolve({data:[]});const full=await pending;assert.equal(complete,true);assert.ok(Array.isArray(full.accounting_ledger));assert.equal(f.backend.bootstrapCache,full);
});
test('blocked accounts never receive progressive discovery',async()=>{
 const f=await fixture({blocked:true});let revealed=false;
 const result=await f.backend.bootstrap({onCore:()=>{revealed=true}});
 assert.equal(revealed,false);assert.equal(result.profile.status,'blocked');assert.equal(f.calls.includes('accounting_ledger'),false);
});
test('readonly preview does not expose normal progressive data',async()=>{
 const f=await fixture({preview:true});let revealed=false;
 const result=await f.backend.bootstrap({onCore:()=>{revealed=true}});
 assert.equal(revealed,false);assert.equal(result.preview.active,true);assert.equal(f.calls.includes('marketplace_bootstrap'),false);
});
test('identity change while photos finish prevents caching the previous account',async()=>{
 const f=await fixture({delayPhotos:true});const pending=f.backend.bootstrap();
 f.extra.resolve({data:[]});await tick();f.authChanged('SIGNED_OUT',null);f.photos.resolve({data:[]});
 await assert.rejects(pending,/AUTH_IDENTITY_CHANGED/);assert.equal(f.backend.bootstrapCache,null);
});
function extract(name,next){return appSource.slice(appSource.indexOf('  function '+name+'('),appSource.indexOf('  function '+next+'('));}
test('reservation event summary contains one empty state and retains distinct event status',()=>{
 const context={esc:s=>String(s).replaceAll('<','&lt;'),eventPublicationLabel:status=>({label:status==='none'?'Nenhum evento vinculado':'Publicado',className:'status-neutral'})};
 vm.createContext(context);vm.runInContext(extract('reservationEventSummary','userReservationCard'),context);
 const empty=context.reservationEventSummary({eventMode:'none',eventPublicationStatus:'none',event:'Nenhum evento vinculado'});
 assert.equal(empty.match(/Nenhum evento vinculado/g).length,1);
 const linked=context.reservationEventSummary({eventPublicationStatus:'published',event:'Pelada de quinta'});
 assert.match(linked,/Pelada de quinta/);assert.match(linked,/Publicado/);
});
function actionGate(context){
 const start=appSource.indexOf('  async function waitForInitialDetails('),end=appSource.indexOf('  async function setRole(',start);
 const sandbox={...context,showToast(){},window:{TamoonMarketplacePilot:{leaving:false}},backendIsOnline:()=>true};
 vm.createContext(sandbox);vm.runInContext(appSource.slice(start,end),sandbox);return sandbox;
}
test('actions wait for complete details and do not proceed after a failed load',async()=>{
 const d=deferred(),state={initialDetailsPending:true};const f=actionGate({backendRuntime:state,backendBootstrapPromise:d.promise});
 let done=false;const result=f.waitForInitialDetails().then(value=>{done=true;return value});
 await tick();assert.equal(done,false);state.initialDetailsPending=false;d.resolve();assert.equal(await result,true);
 const failed=actionGate({backendRuntime:{initialDetailsPending:true},backendBootstrapPromise:Promise.reject(new Error('network'))});
 assert.equal(await failed.waitForInitialDetails(),false);
});
test('navigation cannot resume if returning to Community while loading details',async()=>{
 const d=deferred(),state={initialDetailsPending:true};const f=actionGate({backendRuntime:state,backendBootstrapPromise:d.promise});
 const result=f.waitForInitialDetails();f.window.TamoonMarketplacePilot.leaving=true;state.initialDetailsPending=false;d.resolve();
 assert.equal(await result,false);
});

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
test('partner preview never calls writable agenda setup; normal mode still loads it',async()=>{
 const preview=await fixture({preview:true});await preview.backend.bootstrap();
 assert.equal(preview.calls.includes('agenda_initial_slot_flags'),false);
 assert.equal(preview.calls.includes('assert_marketplace_writable'),false);
 const normal=await fixture();normal.extra.resolve({data:[]});const data=await normal.backend.bootstrap();
 assert.ok(normal.calls.includes('agenda_initial_slot_flags'));assert.ok(Array.isArray(data.agenda_initial_slots));
});
test('share attention follows unpaid balance, including confirmed reservations',()=>{
 const context={reservationIsExpired:r=>r.expired,monthlyPaymentPresentation:r=>({closed:r.closed}),currentUserShare:r=>r.share};
 vm.createContext(context);vm.runInContext(extract('userShareIsPending','userPendingSharesCount'),context);
 for(const statusKey of ['pending','confirmed'])assert.equal(context.userShareIsPending({statusKey,share:{amount:30,paid:false}}),true);
 for(const r of [{statusKey:'cancelled'},{statusKey:'expired'},{statusKey:'confirmed',expired:true},{statusKey:'pending',monthlyCycleId:'cycle',closed:true},{statusKey:'confirmed',share:{amount:30,paid:true}},{statusKey:'pending',share:{amount:0,paid:false}}])assert.equal(context.userShareIsPending({share:{amount:30,paid:false},...r}),false);
});
test('payment notification opens and focuses its own share despite a previous filter',async()=>{
 const reservation={id:'R1',backendId:'uuid1'},row={id:'N1',type:'pix_share_pending',entity_type:'reservation',entity_id:'uuid1'};
 let focused=false,scrolled=false,read=false;
 const context={state:{role:'user',personalNotifications:[row],reservations:[reservation],activePage:{user:'discover'},filters:{userShareStatus:'Confirmadas'}},
 notificationVisibleForRole:()=>true,currentUserShare:()=>({amount:30,paid:false}),detailDialog:{close(){}},saveState(){},render(){},document:{hidden:false},window:{matchMedia:()=>({matches:true})},
 app:{querySelectorAll:()=>[{dataset:{uiKey:'reservation-R1'},scrollIntoView(){scrolled=true},focus(){focused=true}}]},readPersonalNotification:async()=>{read=true}};
 const start=appSource.indexOf('  async function openPersonalNotification('),end=appSource.indexOf('  document.addEventListener("click",event=>',start);
 vm.createContext(context);vm.runInContext(appSource.slice(start,end),context);await context.openPersonalNotification('N1');
 assert.equal(context.state.activePage.user,'shares');assert.equal(context.state.filters.userShareStatus,'Todas');assert.ok(focused&&scrolled&&read);
});

test('a failed photo request leaves the verified reservation data available', async()=>{
 const f=await fixture({delayPhotos:true});
 const ready=f.backend.bootstrap({force:true});
 f.extra.resolve({data:[]});f.photos.resolve({error:{status:503}});
 assert.equal((await ready).profile.id,'owner');
 assert.equal(f.backend.publicVenuePhotoUrl('photo.jpg'),'assets/preview-icon.svg');
});

test('a signed photo is usable while slower directories are pending and is discarded at sign out',async()=>{
 const f=await fixture({delayPhotos:true});let notified=0;
 const full=f.backend.bootstrap({force:true,onPhotos:()=>notified++});
 f.photos.resolve({data:[{path:'photo.jpg',signedUrl:'https://example.test/photo'}]});
 await tick();assert.equal(notified,1);assert.equal(f.backend.publicVenuePhotoUrl('photo.jpg'),'https://example.test/photo');
 f.extra.resolve({data:[]});await full;f.authChanged('SIGNED_OUT',null);
 assert.equal(f.backend.publicVenuePhotoUrl('photo.jpg'),'assets/preview-icon.svg');
});

test('the public gallery shows all catalog photos, with the favorite first',()=>{
 const context={state:{partnerProfile:{venueId:'another'}}};vm.createContext(context);
 vm.runInContext(extract('venueGalleryPhotos','venuePublicAddress'),context);
 const photos=context.venueGalleryPhotos({id:'venue',backendVenueId:'venue',gallery:[
  {id:'a',src:'a.jpg',storagePath:'a'}, {id:'b',src:'b.jpg',storagePath:'b',favorite:true}
 ]});
 assert.deepEqual(Array.from(photos,p=>p.storagePath),['b','a']);
});

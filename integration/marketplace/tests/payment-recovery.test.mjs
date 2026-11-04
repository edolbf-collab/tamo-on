import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=name=>fs.readFileSync(new URL('../../../marketplace/'+name,import.meta.url),'utf8');
const app=read('app.js');
const between=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));

function refreshFixture(error){
 const previous={profile:{id:'owner',status:'active'},partner_memberships:[]},handled=[];
 const context={URLSearchParams,location:{search:''},clearTimeout,setTimeout,
  backendRuntime:{enabled:true,bootstrap:previous,identityId:'owner',realtimeSubscribed:true},backendBootstrapPromise:null,
  partnerAccessGeneration:0,backendRefreshTables:new Set(),backendRefreshQueued:false,backendRealtimeRefreshTimer:null,
  backendRefreshSignature:'',partnerAccessPending:false,partnerAccessRetryTimer:null,partnerAccessRetryAttempt:0,
  window:{MarketplaceBackend:{session:{user:{id:'owner'}},bootstrap:async()=>{if(error)throw error;return previous}},
   TamoonMarketplacePilot:{handleError:e=>handled.push(e),isTransient:e=>e.code==='57014',ready(){}}},
  state:{role:'user'},backendIsOnline:()=>true,backendSyncStatus(){},render(){},updateBackendRoleAccess(){},backendErrorMessage:e=>e.message,
  syncStateFromBackend(){},refreshOpenVenueScheduleFromBackend(){},restoreAsaasReturn(){},
  detailDialog:{open:false},reservationDialog:{open:false},chatDialog:{open:false}};
 vm.createContext(context);vm.runInContext(between('  async function refreshBackendBootstrap(', '  async function handleBackendStatus('),context);
 return {context,handled,previous};
}
test('a timeout keeps the last verified snapshot, and a subsequent read restores updates',async()=>{
 const error={code:'57014',message:'canceling statement due to statement timeout'},f=refreshFixture(error);
 await assert.rejects(f.context.refreshBackendBootstrap(),e=>e===error);
 assert.equal(f.context.backendRuntime.bootstrap,f.previous);assert.deepEqual(f.handled,[error]);
 assert.equal(f.context.backendRuntime.refreshing,false);
 f.context.window.MarketplaceBackend.bootstrap=async()=>f.previous;
 await f.context.refreshBackendBootstrap();assert.equal(f.context.backendRuntime.refreshError,'');
});
test('permission denial does not keep the previous snapshot available',async()=>{
 const f=refreshFixture({code:'42501',message:'permission denied'});
 await assert.rejects(f.context.refreshBackendBootstrap());assert.equal(f.context.backendRuntime.bootstrap,null);
});
test('a failed response for an old identity cannot lock the new account',async()=>{
 const f=refreshFixture();f.context.window.MarketplaceBackend.bootstrap=async()=>{
  f.context.window.MarketplaceBackend.session={user:{id:'another'}};throw new Error('old request');
 };
 f.context.setTimeout=()=>{};
 await assert.rejects(f.context.refreshBackendBootstrap());assert.deepEqual(f.handled,[]);
});
test('Pix closes only on confirmed backend data belonging to the current identity',()=>{
 let closed=0;const reservation={backendId:'r1',backendOfficial:true,backendStatus:'pending_payment'};
 const c={backendIsOnline:()=>true,backendRuntime:{identityId:'owner'},window:{MarketplaceBackend:{session:{user:{id:'owner'}}}},
  state:{reservations:[reservation]},detailDialog:{open:true,dataset:{view:'asaas-payment',paymentIdentity:'owner',paymentReservationId:'r1'},close(){closed++}},showToast(){}};
 vm.createContext(c);vm.runInContext(between('  function officialSinglePaymentConfirmed(', '  function rememberAsaasReturn('),c);
 c.refreshOpenAsaasPaymentFromBackend();assert.equal(closed,0);
 reservation.backendStatus='confirmed';c.refreshOpenAsaasPaymentFromBackend();assert.equal(closed,0);
 reservation.paymentConfirmedAtIso='2026-10-29T00:18:48Z';c.refreshOpenAsaasPaymentFromBackend();assert.equal(closed,1);
});
test('cancelling communication releases modal and capture handlers before network completion',async()=>{
 const events={},timers=new Map();let sequence=0,scope,finish;
 const network=new Promise(r=>{finish=r});const element={textContent:'',focus(){}};
 const dialog={open:false,setAttribute(){},querySelector:()=>element,addEventListener(){},showModal(){this.open=true},close(){this.open=false}};
 const c={console,document:{createElement:()=>dialog,body:{appendChild(){},style:{overflow:'auto'}},addEventListener:(name,fn)=>{events[name]=fn},querySelector:()=>null},
  window:{addEventListener(){},TamoonMarketplacePilot:{blocked:false}},setTimeout:(fn,ms)=>{timers.set(++sequence,{fn,ms});return sequence},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(read('asaas-communication.js'),c);const api=c.window.MarketplaceAsaasCommunication;
 const pending=api.flow('Testando',async s=>{scope=s;await network;s.assertActive()});
 await Promise.resolve();assert.equal(dialog.open,true);assert.equal(api.isBusy(),true);
 const rejected=assert.rejects(pending,/ASAAS_COMMUNICATION_CANCELLED/);api.cancel();await rejected;
 assert.equal(dialog.open,false);assert.equal(api.isBusy(),false);assert.equal(scope.isActive(),false);
 assert.equal(c.document.body.style.overflow,'auto');assert.equal(timers.size,0);
 events.click({preventDefault(){assert.fail('recovery click blocked')},stopImmediatePropagation(){}});
 finish();await Promise.resolve();
});

test('monthly payment feedback distinguishes a paid quota from a fully paid monthly reservation',()=>{
 const c={currentUserPixShareState:()=>({paid:true})};vm.createContext(c);
 vm.runInContext(between('  function officialSinglePaymentConfirmed(', '  function asaasReturnBelongsToCurrentUser('),c);
 const r={id:'RES-001066',backendOfficial:true,monthly:true,pixSplit:true,backendStatus:'pending_payment'};
 assert.match(c.officialAsaasPaymentMessage(r),/aguarda as demais cotas/);
 r.backendStatus='confirmed';r.paymentConfirmedAtIso='2026-10-30T02:00:00Z';
 assert.match(c.officialAsaasPaymentMessage(r),/mensalidade está quitada/);
 assert.equal(c.officialSinglePaymentConfirmed(r),false);
});

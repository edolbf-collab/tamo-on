import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=name=>fs.readFileSync(new URL('../../../marketplace/'+name,import.meta.url),'utf8');
const appSource=read('app.js'),backendSource=read('frontend/backend/marketplace-backend.js');
const slice=(start,end)=>appSource.slice(appSource.indexOf(start),appSource.indexOf(end,appSource.indexOf(start)));
const configSource=read('backend-config.js');
const reservation={id:'RES-1069',backendId:'reservation-id',backendOfficial:true,statusKey:'pending',
 userId:'owner',paymentResponsibleId:'owner',paymentConfigured:true,paymentMethod:'pix_direct_partner',paymentDue:370};

async function fixture({readonly=false,response={mode:'asaas_pix_payer_required',payerName:'Pagador de teste'},httpError=null}={}) {
 const calls=[],mounts=[],details=[],failures=[];
 const client={auth:{setSession:async()=>({data:{session:{user:{id:'owner'}}}}),onAuthStateChange(){}},
  rpc:async name=>{calls.push({rpc:name});return {data:!readonly}},
  functions:{invoke:async(name,{body})=>{calls.push({name,body});return httpError
   ?{error:{context:{json:async()=>({error:httpError})}}}:{data:response}}}};
 const window={supabase:{createClient:()=>client},dispatchEvent(){},
  TamoonMarketplacePilot:{takeSession:()=>({access_token:'test',refresh_token:'test'})},
  MarketplaceAsaasCommunication:{run:async(label,fn)=>fn(),flow:async(label,fn)=>fn({assertActive(){}})},
  MarketplaceInlinePix:{mount:options=>mounts.push(options)}};
 const sandbox={window,console,URL,performance,Date,Map,Set,setTimeout,clearTimeout,
  CustomEvent:class {constructor(type,{detail}){this.detail=detail}},
  backendRuntime:{identityId:'owner'},backendIsOnline:()=>true,
  monthlyPaymentPresentation:()=>({closed:false}),pixCollectionForReservation:()=>null,
  state:{role:'user',reservations:[reservation]},detailDialog:{open:true,dataset:{},close(){}},detailBody:{},
  openDetail:detail=>details.push(detail),showAsaasCheckoutFailure:(r,e)=>failures.push(e.message),
  showToast:message=>failures.push(message),askConfirm:()=>{throw Error('Legacy simulator confirmation opened')},
  runBackendMutation:async(label,fn)=>{try{return await fn()}catch{return null}},
  officialAsaasPaymentMessage:()=>'',refreshOpenAsaasPaymentFromBackend(){},refreshBackendBootstrap:async()=>{},
  money:v=>'R$ '+v,esc:String};
 vm.createContext(sandbox);vm.runInContext(configSource,sandbox);vm.runInContext(backendSource,sandbox);
 await window.MarketplaceBackend.init();
 vm.runInContext(slice('  function currentUserPixShareState(', '  function stagingPaymentResultMessage('),sandbox);
 vm.runInContext(slice('  function requestOfficialStagingPaymentConfirmation(', '  function asaasCheckoutFailureMessage('),sandbox);
 vm.runInContext(slice('  async function runAsaasPaymentFlow(', '  async function backendEmailLogin('),sandbox);
 return {sandbox,calls,mounts,details,failures,backend:window.MarketplaceBackend};
}

test('published payment configuration opens the Asaas payer form instead of the disabled simulator',async()=>{
 const f=await fixture();await f.sandbox.requestOfficialStagingPaymentConfirmation(reservation);
 assert.deepEqual(f.calls.filter(x=>x.name).map(x=>x.name),['pix-charge-router']);
 assert.equal(f.mounts.length,1);assert.equal(f.mounts[0].result.mode,'asaas_pix_payer_required');
 assert.equal(f.details[0].title,'Dados do pagador');assert.deepEqual(f.failures,[]);
});
test('submitting payer data continues the same reservation and displays the Sandbox Pix response',async()=>{
 const f=await fixture();await f.sandbox.requestOfficialStagingPaymentConfirmation(reservation);
 const payer={name:'Pagador de teste',cpfCnpj:'test-only'};
 await f.mounts[0].onPayer(payer);
 assert.equal(f.calls.filter(x=>x.name).length,2);
 assert.equal(f.calls.at(-1).name,'pix-charge-router');
 assert.equal(f.calls.at(-1).body.reservationId,reservation.backendId);
 assert.equal(f.calls.at(-1).body.payer,payer);
 const qr=await fixture({response:{mode:'asaas_pix',status:'pending',amount:370,payload:'test',encodedImage:'test'}});
 await qr.sandbox.requestOfficialStagingPaymentConfirmation(reservation);
 assert.equal(qr.mounts[0].result.status,'pending');assert.equal(qr.details[0].title,'Pagar com Pix');
 assert.equal(reservation.statusKey,'pending');
});
test('direct simulator calls are blocked before any network request in the deployed Sandbox configuration',async()=>{
 const f=await fixture();await assert.rejects(f.backend.simulatePayment(reservation.backendId),/SIMULATION_DISABLED/);
 assert.deepEqual(f.calls,[]);
});
test('card payments also use the Asaas route without calling the simulator',async()=>{
 const f=await fixture({response:{mode:'asaas_checkout',amount:370,checkoutUrl:'https://sandbox.asaas.com/checkoutSession/show?id=test'}});
 await f.sandbox.requestOfficialStagingPaymentConfirmation({...reservation,paymentMethod:'credit_card_asaas'});
 assert.deepEqual(f.calls.filter(x=>x.name).map(x=>x.name),['payment-router']);
 assert.match(f.details[0].body,/https:\/\/sandbox\.asaas\.com\//);assert.equal(f.mounts.length,0);
});
test('readonly partner preview cannot reach a payment endpoint',async()=>{
 const f=await fixture({readonly:true});await f.sandbox.requestOfficialStagingPaymentConfirmation(reservation);
 assert.equal(f.calls.some(x=>x.name),false);assert.deepEqual(f.failures,['PARTNER_PREVIEW_READ_ONLY']);
});
test('another payer, paid share or completed reservation cannot start a payment',async()=>{
 const f=await fixture();
 for(const r of [{...reservation,paymentResponsibleId:'other'}, {...reservation,statusKey:'confirmed'},
  {...reservation,pixSplit:true,paymentParticipants:[{profileId:'owner',status:'paid'}]}]){
  await f.sandbox.requestOfficialStagingPaymentConfirmation(r);
 }
 assert.deepEqual(f.calls,[]);
});
test('provider errors leave payment pending and do not fall back to a synthetic confirmation',async()=>{
 const f=await fixture({httpError:'PAYMENT_WINDOW_EXPIRED'});
 await f.sandbox.requestOfficialStagingPaymentConfirmation(reservation);
 assert.deepEqual(f.failures,['PAYMENT_WINDOW_EXPIRED']);assert.equal(f.mounts.length,0);
 assert.deepEqual(f.calls.filter(x=>x.name).map(x=>x.name),['pix-charge-router']);
 assert.equal(reservation.statusKey,'pending');
});
test('production checkout URLs remain rejected',async()=>{
 const f=await fixture({response:{mode:'asaas_checkout',amount:370,checkoutUrl:'https://www.asaas.com/checkoutSession/show?id=test'}});
 await f.sandbox.requestOfficialStagingPaymentConfirmation({...reservation,paymentMethod:'credit_card_asaas'});
 assert.deepEqual(f.failures,['Endereço de pagamento inválido.']);assert.equal(f.details.length,0);
});

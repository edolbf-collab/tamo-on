import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inlinePixPayload,openInlinePix} from '../asaas/functions/_shared/asaas-inline-pix.mjs';

const at=Date.parse('2026-10-30T02:00:00Z');
const context={delivery_mode:'inline_pix',claimed:true,status:'creating',billing_type:'PIX',amount:1360,
 installment_id:'installment',participant_id:'participant',external_reference:'TAMOON:PIX:monthly',reservation_code:'RES-001066',
 customer_id:'cus_test_monthly',session_key:'PIX:monthly',claim_token:'00000000-0000-4000-8000-000000000001',
 due_at:'2026-11-01T19:45:00Z',provider_due_at:'2026-11-10T02:59:59Z',split_commission_amount:81.60,split_wallet_id:'commission'};

function fixture({mode='monthly',claimed=true,claimError=null,startError=null}={}){
 const calls=[],requests=[];
 const c={...context,claimed,...(!claimed?{status:'ready',provider_payment_id:'pay_monthly'}:{})};
 const payment={id:'pay_monthly',customer:c.customer_id,billingType:'PIX',value:c.amount,externalReference:c.external_reference,
  status:'PENDING',split:[{walletId:c.split_wallet_id,fixedValue:c.split_commission_amount}]};
 const reservation={booking_mode:mode,monthly_cycle_id:mode==='monthly'?'cycle':null,payment_method:'pix_direct_partner'};
 const admin={from:()=>({select:()=>({eq:()=>({single:async()=>({data:reservation})})})}),
  rpc:async(name,args)=>{calls.push({name,args});
   if(name==='claim_asaas_inline_pix')return claimError?{error:{message:claimError}}:{data:{...c}};
   if(name==='start_asaas_inline_pix' && startError)return {error:{message:startError}};
   if(name==='can_present_asaas_inline_pix')return {data:true};
   return {data:{}};
  }};
 const deps={env:name=>({ASAAS_SANDBOX_ENABLED:'true',MARKETPLACE_STAGING_SIMULATION:'false',ASAAS_API_KEY:'test-not-a-secret'})[name],
  jsonResponse:(body,status)=>({body,status}),now:()=>at,fetchImpl:async(url,options)=>{
   if(options.method==='POST')assert.equal(calls.at(-1).name,'start_asaas_inline_pix');
   requests.push({url,method:options.method,body:options.body?JSON.parse(options.body):null});
   const result=url.endsWith('/pixQrCode')?{encodedImage:'iVBORtest==',payload:'000201test'}:payment;
   return {ok:true,status:200,json:async()=>result};
  }};
 return {admin,deps,calls,requests};
}

test('monthly Pix keeps the provider due date at the balance cutoff and the app deadline at the guarantee cutoff',()=>{
 const payload=inlinePixPayload(context,context.customer_id,at);
 assert.equal(payload.dueDate,'2026-11-09');assert.equal(payload.value,1360);
 assert.deepEqual(payload.split,[{walletId:'commission',fixedValue:81.6}]);
 assert.throws(()=>inlinePixPayload(context,context.customer_id,Date.parse(context.due_at)),/PIX_PAYMENT_WINDOW_TOO_SHORT/);
 const single={...context,provider_due_at:null};
 assert.equal(inlinePixPayload(single,single.customer_id,at).dueDate,'2026-11-01');
});
for(const mode of ['monthly','single'])test(`${mode} Pix reaches the provider once, with a committed fence before POST`,async()=>{
 const f=fixture({mode}),r=await openInlinePix(f.admin,'reservation','owner',f.deps);
 assert.equal(r.status,200);assert.equal(r.body.status,'pending');assert.equal(r.body.dueAt,context.due_at);
 assert.deepEqual(f.requests.map(x=>x.method),['POST','GET','GET']);
 assert.equal(f.requests[0].body.value,1360);
 assert.deepEqual(f.calls.map(x=>x.name),['claim_asaas_inline_pix','start_asaas_inline_pix','bind_asaas_inline_pix','can_present_asaas_inline_pix']);
});
test('reopening a monthly Pix reuses the same provider payment without another POST',async()=>{
 const f=fixture({claimed:false}),r=await openInlinePix(f.admin,'reservation','owner',f.deps);
 assert.equal(r.status,200);assert.equal(r.body.paymentId,'pay_monthly');assert.equal(r.body.reused,true);
 assert.equal(f.requests.some(x=>x.method==='POST'),false);
});
test('unsupported monthly stages and an elapsed guarantee stop before contacting the provider',async()=>{
 for(const claimError of ['ASAAS_MONTHLY_PIX_SCOPE','PAYMENT_WINDOW_EXPIRED']){
  const f=fixture({claimError}),r=await openInlinePix(f.admin,'reservation','owner',f.deps);
  assert.equal(r.body.error,claimError);assert.deepEqual(f.requests,[]);
 }
 const f=fixture({startError:'PIX_PAYMENT_WINDOW_TOO_SHORT'}),r=await openInlinePix(f.admin,'reservation','owner',f.deps);
 assert.equal(r.body.error,'PIX_PAYMENT_WINDOW_TOO_SHORT');assert.deepEqual(f.requests,[]);
});

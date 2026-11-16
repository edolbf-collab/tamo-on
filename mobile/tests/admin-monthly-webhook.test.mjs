import test from 'node:test';import assert from 'node:assert/strict';
import {monthlyWebhookOutcome} from '../../integration/marketplace/asaas/functions/_shared/asaas-monthly-webhook.mjs';
import {processAsaasEvent} from '../../integration/marketplace/asaas/functions/_shared/asaas-event-processing.mjs';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function fixture(){
 const c={id:id(1),environment:'sandbox',reference:'tamoon-plan:'+id(1),amount:300,due_on:'2026-12-01',provider_id:'pay_monthly',provider_customer:'cus_partner'};
 const p={id:c.provider_id,customer:c.provider_customer,externalReference:c.reference,value:300,dueDate:c.due_on,billingType:'PIX',status:'RECEIVED'};
 const event={event_type:'PAYMENT_RECEIVED',provider_event_id:'evt_monthly',payload:{account:{id:id(2)},payment:{...p,status:'PENDING'}}},calls=[],http=[];
 const env={ASAAS_SANDBOX_ENABLED:'true',MARKETPLACE_STAGING_SIMULATION:'false',ASAAS_MAIN_ACCOUNT_ID:id(2),ASAAS_API_KEY:'main-key',ESTABLISHMENT_CHECKOUT_ENABLED:'true',ESTABLISHMENT_BILLING_ENVIRONMENT:'sandbox',ESTABLISHMENT_BILLING_MAIN_API_KEY:'main-key'};
 const admin={rpc:async(n,a)=>{calls.push({n,a});if(n==='establishment_webhook_context')return {data:c};if(n==='establishment_billing_result')return {data:null};throw Error(n);}};
 const deps={env:n=>env[n],fetch:async(u,o)=>{http.push({u,o});return Response.json(p);}};
 return {c,p,event,calls,http,admin,deps,env};
}
test('Monthly webhook reads current Asaas state and never routes to reservations',async()=>{const f=fixture();assert.equal(await processAsaasEvent(f.admin,f.event,f.deps),'processed');assert.deepEqual(f.calls.map(c=>c.n),['establishment_webhook_context','establishment_billing_result']);assert.equal(f.calls[1].a.p_payment.status,'RECEIVED');assert.equal(f.http.length,1);assert.equal(f.http[0].o.method,'GET');assert.equal(f.http[0].o.headers.access_token,'main-key');});
test('Monthly webhook rejects another account before contacting the provider',async()=>{const f=fixture();f.event.payload.account.id=id(3);await assert.rejects(monthlyWebhookOutcome(f.admin,f.event,f.deps),/ACCOUNT_MISMATCH/);assert.equal(f.http.length,0);assert.equal(f.calls.length,1);});
test('Monthly webhook validates provider identity, reference, value, date and splits',async()=>{for(const mismatch of [{id:'pay_other'},{customer:'cus_other'},{externalReference:'other'},{value:1},{dueDate:'2026-12-02'},{billingType:'BOLETO'},{split:[{id:'split'}]}]){const f=fixture();Object.assign(f.p,mismatch);await assert.rejects(monthlyWebhookOutcome(f.admin,f.event,f.deps),/PAYMENT_MISMATCH/);assert.equal(f.calls.length,1);}});
test('Duplicate or delayed notifications do not replace fresh paid state with stale payload',async()=>{const f=fixture();await monthlyWebhookOutcome(f.admin,f.event,f.deps);await monthlyWebhookOutcome(f.admin,f.event,f.deps);assert.ok(f.calls.filter(c=>c.n==='establishment_billing_result').every(c=>c.a.p_payment.status==='RECEIVED'));assert.ok(f.http.every(h=>h.o.method==='GET'));});
test('Deleted and restored monthly invoices reconcile the latest provider state',async()=>{const f=fixture();f.event.event_type='PAYMENT_DELETED';f.p.deleted=true;assert.equal(await monthlyWebhookOutcome(f.admin,f.event,f.deps),'processed');assert.equal(f.calls.at(-1).a.p_payment.status,'DELETED');f.event.event_type='PAYMENT_RESTORED';f.p.deleted=false;f.p.status='PENDING';await monthlyWebhookOutcome(f.admin,f.event,f.deps);assert.equal(f.calls.at(-1).a.p_payment.status,'PENDING');});
test('Provider failure keeps the webhook retryable instead of falsely acknowledging settlement',async()=>{const f=fixture();f.deps.fetch=async()=>new Response('Unavailable',{status:503});await assert.rejects(monthlyWebhookOutcome(f.admin,f.event,f.deps),/ASAAS_LOOKUP_HTTP_503/);assert.equal(f.calls.length,1);});
test('Reservation payments retain their existing routing',async()=>{const f=fixture();f.admin.rpc=async(n,a)=>{f.calls.push({n,a});return {data:n==='establishment_webhook_context'?null:n==='asaas_payment_event_scope'?'linked':n==='asaas_payment_route'?{issuer_account_id:null}:null};};assert.equal(await processAsaasEvent(f.admin,f.event,f.deps),'processed');assert.deepEqual(f.calls.map(c=>c.n),['establishment_webhook_context','asaas_payment_event_scope','asaas_payment_route','apply_asaas_account_event']);assert.equal(f.http.length,0);});

test('Webhook authentication rejects unsigned events and accepts a processed retry without replay',async()=>{
 const {handleAsaasWebhook}=await import('../../integration/marketplace/asaas/functions/asaas-webhook/handler.mjs');
 const f=fixture(),token='x'.repeat(40),payload={...f.event.payload,id:'evt_monthly',event:'PAYMENT_RECEIVED'};
 let writes=0,processed=0;
 const query={upsert:async()=>{writes++;return {error:null};},select:()=>query,eq:()=>query,single:async()=>({data:{id:id(8),status:'processed',payload}})};
 const deps={env:n=>n==='ASAAS_WEBHOOK_TOKEN'?token:f.env[n],adminClient:()=>({from:()=>query}),processWebhookEvent:async()=>{processed++;return {status:'processed'};},jsonResponse:(body,status=200)=>Response.json(body,{status}),corsHeaders:{}};
 const request=auth=>new Request('https://example.test/asaas-webhook',{method:'POST',headers:{'asaas-access-token':auth},body:JSON.stringify(payload)});
 assert.equal((await handleAsaasWebhook(request('bad'),deps)).status,401);assert.equal(writes,0);
 const result=await handleAsaasWebhook(request(token),deps);assert.equal(result.status,200);assert.equal((await result.json()).duplicate,true);assert.equal(writes,1);assert.equal(processed,0);
});

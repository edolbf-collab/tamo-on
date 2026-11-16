import test from 'node:test';import assert from 'node:assert/strict';
import {runBilling} from '../../integration/marketplace/asaas/functions/establishment-billing/core.mjs';
const bill={id:'a',reference:'tamoon-plan:a',amount:300,due_on:'2027-01-01',competence:'2027-01-01',venue:'Arena',name:'Arena Ltda',cpfCnpj:'12.345.678/0001-99',partner_id:'p'};
test('Main-account bill uses partner customer, exact due date and no split/transfer',async()=>{
 const calls=[],results=[];let claimed=false;
 await runBilling({environment:'sandbox',rpc:async(name,args)=>{if(name.endsWith('_pending'))return [];if(name.endsWith('_claim')){if(claimed)return null;claimed=true;return bill;}results.push(args);},request:async(method,path,body)=>{calls.push({method,path,body});if(method==='GET')return {data:path.startsWith('/customers')?[{id:'cus_partner',externalReference:'tamoon-partner:p',cpfCnpj:bill.cpfCnpj,notificationDisabled:true}]:[]};return {id:'pay_x',...body};}});
 const payment=calls.find(c=>c.path==='/payments');assert.equal(payment.body.value,300);assert.equal(payment.body.dueDate,'2027-01-01');assert.equal(payment.body.customer,'cus_partner');assert.equal(payment.body.billingType,'PIX');assert.deepEqual(payment.body.interest,{value:0});assert.deepEqual(payment.body.fine,{value:0});assert.equal(payment.body.split,undefined);assert.ok(!calls.some(c=>c.path.includes('transfer')));assert.equal(results[0].p_payment.id,'pay_x');
});

test('An individual reconciliation failure cannot stop other establishments or new invoices',async()=>{
 const results=[];let claimed=false,posts=0;
 const outcome=await runBilling({environment:'sandbox',rpc:async(name,args)=>{
  if(name.endsWith('_pending'))return [{id:'broken',provider_id:'pay_missing'},{id:'healthy',provider_id:'pay_healthy'}];
  if(name.endsWith('_claim')){if(claimed)return null;claimed=true;return bill;}
  results.push(args);
 },request:async(method,path,body)=>{
  if(path==='/payments/pay_missing')throw Error('ASAAS_REQUEST_FAILED');
  if(path==='/payments/pay_healthy')return {id:'pay_healthy',status:'RECEIVED'};
  if(method==='GET')return {data:path.startsWith('/customers')?[{id:'cus_x',externalReference:'tamoon-partner:p',cpfCnpj:bill.cpfCnpj,notificationDisabled:true}]:[],hasMore:false};
  posts++;return {id:'pay_new',...body};
 }});
 assert.deepEqual(outcome,{issued:1,reconciled:1,review:1});assert.equal(posts,1);
 assert.equal(results[0].p_error,'ASAAS_REQUEST_FAILED');assert.equal(results[1].p_payment.id,'pay_healthy');
});

for(const response of [{},{data:null},{data:[],hasMore:true},{data:[{id:'pay_1'}],totalCount:2}]){
 test('Incomplete provider listing never authorizes a payment POST: '+JSON.stringify(response),async()=>{
  let claimed=false,posts=0,saved;
  await runBilling({environment:'sandbox',rpc:async(n,a)=>{if(n.endsWith('_pending'))return [];if(n.endsWith('_claim')){if(claimed)return null;claimed=true;return bill;}saved=a;},request:async(m)=>{if(m==='POST')posts++;return response;}});
  assert.equal(posts,0);assert.ok(saved.p_error);assert.equal(saved.p_payment,null);
 });
}

test('An incomplete customer search cannot create a second customer or charge',async()=>{
 let claimed=false,posts=0,saved;
 await runBilling({environment:'sandbox',rpc:async(n,a)=>{if(n.endsWith('_pending'))return [];if(n.endsWith('_claim')){if(claimed)return null;claimed=true;return bill;}saved=a;},request:async(m,path)=>{if(m==='POST')posts++;return path.startsWith('/customers')?{data:[{id:'cus_x',externalReference:'tamoon-partner:p',cpfCnpj:bill.cpfCnpj,notificationDisabled:true}],hasMore:true}:{data:[]};}});
 assert.equal(posts,0);assert.equal(saved.p_error,'CUSTOMER_REVIEW_REQUIRED');
});

test('An uncertain payment remains in review when its reference is absent',async()=>{
 let saved;
 const result=await runBilling({environment:'sandbox',rpc:async(n,a)=>{if(n.endsWith('_pending'))return [{id:'a',reference:bill.reference}];if(n.endsWith('_claim'))return null;saved=a;},request:async(m)=>{assert.equal(m,'GET');return {data:[]};}});
 assert.equal(saved.p_error,'PROVIDER_RESULT_NOT_FOUND');assert.deepEqual(result,{issued:0,reconciled:0,review:1});
});
test('Ambiguous creation is held for reconciliation; a retry does not POST again',async()=>{
 let phase='planned',posts=0;const pending=[];
 const rpc=async(name,args)=>{if(name.endsWith('_pending'))return [...pending];if(name.endsWith('_claim')){if(phase!=='planned')return null;phase='issuing';return bill;}if(args.p_error){phase='review';if(!pending.length)pending.push({id:'a',reference:bill.reference});}};
 const request=async(method,path)=>{if(method==='POST'){posts++;throw Error('timeout');}return {data:path.startsWith('/customers')?[{id:'cus_x',externalReference:'tamoon-partner:p',cpfCnpj:bill.cpfCnpj,notificationDisabled:true}]:[]};};
 await runBilling({environment:'sandbox',rpc,request});await runBilling({environment:'sandbox',rpc,request});assert.equal(posts,1);assert.equal(phase,'review');
});
test('Existing reference is reconciled without creating another bill',async()=>{
 let claimed=false,posts=0;const payment={id:'pay_existing'};let saved;
 await runBilling({environment:'sandbox',rpc:async(n,a)=>{if(n.endsWith('_pending'))return [];if(n.endsWith('_claim')){if(claimed)return null;claimed=true;return bill;}saved=a;},request:async(m)=>{if(m==='POST')posts++;return {data:[payment]};}});
 assert.equal(posts,0);assert.equal(saved.p_payment.id,'pay_existing');
});

test('Monthly customers are isolated by partner reference and automatic notices stay disabled',async()=>{
 const {issueInvoice}=await import('../../integration/marketplace/asaas/functions/establishment-billing/core.mjs');
 const calls=[];await issueInvoice(bill,async(m,p,b)=>{calls.push({m,p,b});if(m==='GET')return {data:[]};return p==='/customers'?{id:'cus_new'}:{id:'pay_new'};});
 assert.ok(calls.some(c=>c.p==='/customers?externalReference=tamoon-partner%3Ap&limit=2'));
 const customer=calls.find(c=>c.p==='/customers');assert.equal(customer.b.notificationDisabled,true);assert.equal(customer.b.externalReference,'tamoon-partner:p');
 for(const override of [{notificationDisabled:false},{cpfCnpj:'00000000000000'},{externalReference:'other'}]){
  let posts=0;await assert.rejects(issueInvoice(bill,async(m,p)=>{if(m==='POST')posts++;return {data:p.startsWith('/customers')?[{id:'cus_x',externalReference:'tamoon-partner:p',cpfCnpj:bill.cpfCnpj,notificationDisabled:true,...override}]:[]};}),/CUSTOMER_REVIEW_REQUIRED/);assert.equal(posts,0);
 }
});

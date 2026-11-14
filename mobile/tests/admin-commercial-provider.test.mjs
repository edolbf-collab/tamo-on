import test from 'node:test';import assert from 'node:assert/strict';
import {runBilling} from '../../integration/marketplace/asaas/functions/establishment-billing/core.mjs';
const bill={id:'a',reference:'tamoon-plan:a',amount:300,due_on:'2027-01-01',competence:'2027-01-01',venue:'Arena',name:'Arena Ltda',cpfCnpj:'12.345.678/0001-99',partner_id:'p'};
test('Main-account bill uses partner customer, exact due date and no split/transfer',async()=>{
 const calls=[],results=[];let claimed=false;
 await runBilling({environment:'sandbox',rpc:async(name,args)=>{if(name.endsWith('_pending'))return [];if(name.endsWith('_claim')){if(claimed)return null;claimed=true;return bill;}results.push(args);},request:async(method,path,body)=>{calls.push({method,path,body});if(method==='GET')return {data:path.startsWith('/customers')?[{id:'cus_partner'}]:[]};return {id:'pay_x',...body};}});
 const payment=calls.find(c=>c.path==='/payments');assert.equal(payment.body.value,300);assert.equal(payment.body.dueDate,'2027-01-01');assert.equal(payment.body.customer,'cus_partner');assert.equal(payment.body.billingType,'PIX');assert.equal(payment.body.split,undefined);assert.ok(!calls.some(c=>c.path.includes('transfer')));assert.equal(results[0].p_payment.id,'pay_x');
});
test('Ambiguous creation is held for reconciliation; a retry does not POST again',async()=>{
 let phase='planned',posts=0;const pending=[];
 const rpc=async(name,args)=>{if(name.endsWith('_pending'))return pending;if(name.endsWith('_claim')){if(phase!=='planned')return null;phase='issuing';return bill;}if(args.p_error){phase='review';pending.push({id:'a',reference:bill.reference});}};
 const request=async(method,path)=>{if(method==='POST'){posts++;throw Error('timeout');}return {data:path.startsWith('/customers')?[{id:'cus_x'}]:[]};};
 await runBilling({environment:'sandbox',rpc,request});await runBilling({environment:'sandbox',rpc,request});assert.equal(posts,1);assert.equal(phase,'review');
});
test('Existing reference is reconciled without creating another bill',async()=>{
 let claimed=false,posts=0;const payment={id:'pay_existing'};let saved;
 await runBilling({environment:'sandbox',rpc:async(n,a)=>{if(n.endsWith('_pending'))return [];if(n.endsWith('_claim')){if(claimed)return null;claimed=true;return bill;}saved=a;},request:async(m)=>{if(m==='POST')posts++;return {data:[payment]};}});
 assert.equal(posts,0);assert.equal(saved.p_payment.id,'pay_existing');
});

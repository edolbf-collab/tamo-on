import test from 'node:test';
import assert from 'node:assert/strict';
import {provision} from '../../integration/marketplace/asaas/functions/establishment-receipts/provision.mjs';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function fixture({status='APPROVED',escrow=true,uncertain=false}={}){
 let claimed=false,route,created=0,enabled=false;
 const env=n=>({ASAAS_SANDBOX_ENABLED:'true',MARKETPLACE_STAGING_SIMULATION:'false',ASAAS_MAIN_ACCOUNT_ID:id(1),
  ASAAS_API_KEY:'sandbox-main',ASAAS_SUBACCOUNT_WEBHOOK_TOKEN:'x'.repeat(32),SUPABASE_URL:'https://example.supabase.co',ASAAS_ESCROW_DAYS:'7'})[n];
 const rpc=async(name,args)=>{
  if(name==='receipt_provision_claim'){
   const create=!claimed;claimed=true;
   return {partner:id(3),operation:id(5),customer:{},create};
  }
  if(name==='receipt_account_store'){route={accountId:args.p_account,walletId:args.p_wallet,apiKey:args.p_key};return;}
  if(name==='receipt_account_route')return route;
  if(name==='receipt_provision_finish'){enabled=true;return true;}
  assert.fail(name);
 };
 const fetch=async(url,options)=>{
  const path=new URL(url).pathname.slice(3);
  if(path==='/wallets/')return Response.json({data:[{id:id(1)}]});
  if(path==='/accounts'){created++;if(uncertain)throw Error('timeout');return Response.json({id:id(2),walletId:id(4),apiKey:'child'});}
  if(path==='/myAccount/status/')return Response.json({general:status});
  if(path==='/accounts/'+id(2))return Response.json({id:id(2),walletId:id(4)});
  if(path.endsWith('/escrow')){
   if(options.method==='POST')assert.deepEqual(JSON.parse(options.body),{enabled:true,isFeePayer:true,daysToExpire:7});
   return Response.json({enabled:escrow,isFeePayer:true,daysToExpire:7});
  }
  assert.fail(path);
 };
 return {run:()=>provision(id(6),{env,rpc,fetch}),counts:()=>({created,enabled})};
}
test('Aprovação cadastral e escrow confirmado são necessários para habilitar a arena',async()=>{
 for(const status of ['PENDING','AWAITING_APPROVAL']){
  const f=fixture({status});assert.equal((await f.run()).state,'activating');assert.equal(f.counts().enabled,false);
 }
 const rejected=fixture({escrow:false});await assert.rejects(rejected.run(),/ESCROW_UNCONFIRMED/);assert.equal(rejected.counts().enabled,false);
 const ok=fixture();assert.equal((await ok.run()).state,'on');await ok.run();assert.deepEqual(ok.counts(),{created:1,enabled:true});
});
test('Criação com resposta incerta não é repetida',async()=>{
 const f=fixture({uncertain:true});await assert.rejects(f.run(),/timeout/);await assert.rejects(f.run(),/CREATION_IN_REVIEW/);
 assert.deepEqual(f.counts(),{created:1,enabled:false});
});

test('A tarifa de abertura usa a conta principal, tem cobrança própria e não duplica o Pix',async()=>{
 const {openingFee}=await import('../../integration/marketplace/asaas/functions/establishment-receipts/fee.mjs');
 const claim={amount:12.90,customer:'cus_arena',reference:'tamoon-opening:'+id(2),due:'2026-12-01',create:true};
 const calls=[];
 const deps={env:n=>({ASAAS_SANDBOX_ENABLED:'true',MARKETPLACE_STAGING_SIMULATION:'false',ASAAS_API_KEY:'main'})[n],
  rpc:async name=>name==='receipt_fee_claim'?claim:null,
  fetch:async(url,opts)=>{
    assert.equal(opts.headers.access_token,'main');
    if(opts.method==='GET')return Response.json({data:[],hasMore:false,totalCount:0});
    const body=JSON.parse(opts.body);calls.push(body);return Response.json({...body,id:'pay_test'});
  }};
 await openingFee(id(6),id(3),deps);
 assert.equal(calls[0].value,12.90);assert.equal(calls[0].billingType,'PIX');
 claim.create=false;
 await assert.rejects(openingFee(id(6),id(3),deps),/RECEIPT_PROVIDER_REVIEW/);assert.equal(calls.length,1);
});

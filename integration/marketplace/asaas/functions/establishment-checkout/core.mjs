import {issueInvoice} from '../establishment-billing/core.mjs';
const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const payable=['pending','overdue'];
const dateMs=s=>Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(s||'')?s:String(s||'').replace(' ','T')+'-03:00');
export function validateMonthlyPayment(p,c){
 if(!/^pay_[\w-]+$/.test(p?.id||'')||p.id!==c.provider_id||p.customer!==c.provider_customer
 ||p.externalReference!==c.reference||p.billingType!=='PIX'||Number(p.value)!==Number(c.amount)||p.dueDate!==c.due_on
 ||p.deleted===true||!Array.isArray(p.split??[])||(p.split??[]).length
 ||Number(p.interest?.value||0)!==0||Number(p.fine?.value||0)!==0||Number(p.discount?.value||0)!==0)throw Error('PLAN_PAYMENT_MISMATCH');
 return p;
}
export function validateMonthlyQr(q,now=Date.now()){
 if(typeof q?.payload!=='string'||!q.payload.startsWith('000201')||q.payload.length>4096
 ||typeof q.encodedImage!=='string'||q.encodedImage.length>200000||!/^iVBOR[A-Za-z0-9+/=\r\n]+$/.test(q.encodedImage)
 ||!Number.isFinite(dateMs(q.expirationDate))||dateMs(q.expirationDate)<=now)throw Error('PLAN_PIX_UNAVAILABLE');
 return {payload:q.payload,encodedImage:q.encodedImage,expirationDate:q.expirationDate};
}
function partnerAccount(env,id){
 let rows;try{rows=JSON.parse(env('ESTABLISHMENT_BILLING_SANDBOX_ACCOUNTS')||'[]');}catch{throw Error('PLAN_BALANCE_NOT_CONFIGURED');}
 if(!Array.isArray(rows))throw Error('PLAN_BALANCE_NOT_CONFIGURED');
 const matches=rows.filter(x=>x.partnerId===id&&x.active!==false);
 if(matches.length!==1)return null;
 const r=matches[0];if(!uuid.test(r.accountId||'')||!uuid.test(r.walletId||'')||typeof r.apiKey!=='string'||r.apiKey.length<20)throw Error('PLAN_BALANCE_NOT_CONFIGURED');
 return r;
}
export async function monthlyCheckout(body,{userRpc,adminRpc,request,env,now=Date.now}){
 if(!uuid.test(body?.invoiceId||'')||!['open','refresh','status','balance'].includes(body.action))throw Error('PLAN_INVALID_REQUEST');
 let c=await userRpc('establishment_payment_context',{p_invoice_id:body.invoiceId});
 const base={invoiceId:c.id,amount:Number(c.amount),venue:c.venue,competence:c.competence,dueOn:c.due_on};
 if(['paid','cancelled','refunded'].includes(c.status)&&(body.action!=='status'||!c.provider_id))return {...base,status:c.status,mode:'closed'};
 // Explicit opt-in, isolated Sandbox credentials, and DB gate all apply together.
 if(!c.test_mode||c.environment!=='sandbox')throw Error('PLAN_CHECKOUT_SANDBOX_ONLY');
 if(env('ESTABLISHMENT_CHECKOUT_ENABLED')!=='true'){
  if(body.action==='balance')throw Error('PLAN_CHECKOUT_NOT_CONFIGURED');
  return {...base,mode:c.status==='planned'&&!c.attempted_at&&!c.provider_id?'simulation':'unavailable',status:c.status,balanceAvailable:false};
 }
 if(env('ESTABLISHMENT_BILLING_ENVIRONMENT')!=='sandbox')throw Error('PLAN_CHECKOUT_SANDBOX_ONLY');
 const key=env('ESTABLISHMENT_BILLING_MAIN_API_KEY'),wallet=env('ESTABLISHMENT_BILLING_MAIN_WALLET_ID');
 if(!key||!uuid.test(wallet||''))throw Error('PLAN_CHECKOUT_NOT_CONFIGURED');
 const main=(method,path,data)=>request(key,method,path,data);
 const wallets=await main('GET','/wallets');
 if(!wallets?.data?.some(x=>x.id===wallet))throw Error('PLAN_ISSUER_MISMATCH');
 if(body.action==='status'&&!c.provider_id)return {...base,mode:'status',status:c.status};
 if(c.status==='planned'){
  const item=await adminRpc('establishment_invoice_issue_claim',{p_id:c.id,p_environment:'sandbox'});
  if(item){try{const payment=await issueInvoice(item,main);await adminRpc('establishment_billing_result',{p_id:c.id,p_environment:'sandbox',p_payment:payment});}
   catch{await adminRpc('establishment_billing_result',{p_id:c.id,p_environment:'sandbox',p_payment:null,p_error:'CHECKOUT_ISSUANCE_REVIEW'});throw Error('PLAN_ISSUANCE_REVIEW');}}
  c=await userRpc('establishment_payment_context',{p_invoice_id:c.id});
 }
 if(!c.provider_id)throw Error('PLAN_ISSUANCE_REVIEW');
 const payment=validateMonthlyPayment(await main('GET','/payments/'+encodeURIComponent(c.provider_id)),c);
 await adminRpc('establishment_billing_result',{p_id:c.id,p_environment:'sandbox',p_payment:payment});
 if(body.action==='status')return {...base,mode:'status',status:({RECEIVED:'paid',CONFIRMED:'paid',PENDING:'pending',OVERDUE:'overdue',REFUNDED:'refunded',DELETED:'cancelled'})[payment.status]||'review'};
 if(['RECEIVED','CONFIRMED'].includes(payment.status))return {...base,mode:'closed',status:'paid'};
 if(!['PENDING','OVERDUE'].includes(payment.status))throw Error('PLAN_NOT_PAYABLE');
 const account=env('ESTABLISHMENT_BALANCE_ENABLED')==='true'&&!c.admin?partnerAccount(env,c.partner_id):null;
 let balanceAvailable=false,availableBalance=null;
 const sub=account?(method,path,data)=>request(account.apiKey,method,path,data):null;
 if(account){
  if(account.walletId===wallet||account.apiKey===key)throw Error('PLAN_PAYER_MISMATCH');
  const child=await main('GET','/accounts/'+account.accountId),childWallet=await sub('GET','/wallets');
  if(child.id!==account.accountId||child.walletId!==account.walletId||!childWallet?.data?.some(w=>w.id===account.walletId))throw Error('PLAN_PAYER_MISMATCH');
  const balance=await sub('GET','/finance/balance');
  if(!Number.isFinite(Number(balance.balance))||Number(balance.balance)<0)throw Error('PLAN_BALANCE_UNAVAILABLE');
  availableBalance=Number(balance.balance);balanceAvailable=availableBalance>=Number(c.amount);
 }
 // Any previous debit request prevents resubmission, including unknown HTTP outcomes.
 // Only a fresh receiving-account observation can settle the invoice.
 if(c.attempt){
  if(c.attempt.transaction_id&&sub){
   const tx=await sub('GET','/pix/transactions/'+encodeURIComponent(c.attempt.transaction_id));
   if(tx.id!==c.attempt.transaction_id||tx.description!=='tamoon-monthly:'+c.attempt.id||Number(tx.value)!==Number(c.amount)||tx.type!=='DEBIT')throw Error('PLAN_ATTEMPT_MISMATCH');
   await adminRpc('establishment_balance_result',{p_attempt_id:c.attempt.id,p_transaction_id:tx.id,p_state:tx.status==='DONE'?'done':['REFUSED','CANCELLED'].includes(tx.status)?'failed':'processing'});
  }
  return {...base,mode:'processing',status:c.status,balanceAvailable:false};
 }
 const pix=validateMonthlyQr(await main('GET','/payments/'+encodeURIComponent(c.provider_id)+'/pixQrCode'),now());
 if(body.action!=='balance')return {...base,mode:'pix',status:payment.status==='OVERDUE'?'overdue':'pending',pix,balanceAvailable,availableBalance};
 if(body.confirmed!==true||c.admin)throw Error('PLAN_PARTNER_CONFIRMATION_REQUIRED');
 if(!account)throw Error('PLAN_BALANCE_NOT_CONFIGURED');
 if(!balanceAvailable)throw Error('PLAN_INSUFFICIENT_BALANCE');
 // Recheck receipt immediately before claiming, then serialize debit attempts in SQL.
 const latest=validateMonthlyPayment(await main('GET','/payments/'+encodeURIComponent(c.provider_id)),c);
 if(!['PENDING','OVERDUE'].includes(latest.status))throw Error('PLAN_NOT_PAYABLE');
 const attempt=await userRpc('establishment_balance_claim',{p_invoice_id:c.id});
 if(!attempt.send)return {...base,mode:'processing',status:c.status,balanceAvailable:false};
 try{
  const tx=await sub('POST','/pix/qrCodes/pay',{qrCode:{payload:pix.payload},value:Number(c.amount),description:'tamoon-monthly:'+attempt.id});
  if(!uuid.test(tx?.id||''))throw Error('PLAN_ATTEMPT_MISMATCH');
  await adminRpc('establishment_balance_result',{p_attempt_id:attempt.id,p_transaction_id:tx.id,p_state:'processing'});
 }catch{
  await adminRpc('establishment_balance_result',{p_attempt_id:attempt.id,p_transaction_id:null,p_state:'review'});
  return {...base,mode:'review',status:c.status,balanceAvailable:false};
 }
 return {...base,mode:'processing',status:c.status,balanceAvailable:false};
}

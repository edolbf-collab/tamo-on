import {ASAAS_SANDBOX,requireSandbox,accountRegistry,accountKey,publicAccount,verifyPartnerAccount} from './asaas-accounts.mjs';
import {definitiveCheckoutRejection,sandboxCheckoutUrl} from './asaas-checkout-core.mjs';
const UUID=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PAYMENT=/^pay_[A-Za-z0-9_-]+$/,CUSTOMER=/^cus_[A-Za-z0-9_-]+$/;
export function validTaxId(value){
 const d=String(value||'').replace(/[.\-/\s]/g,'');
 if(!/^\d{11}$|^\d{14}$/.test(d)||/^(\d)\1+$/.test(d))return false;
 const digit=(s,weights)=>{const rem=[...s].reduce((sum,n,i)=>sum+Number(n)*weights[i],0)%11;return rem<2?0:11-rem;};
 if(d.length===11)return digit(d.slice(0,9),[10,9,8,7,6,5,4,3,2])===Number(d[9])&&digit(d.slice(0,10),[11,10,9,8,7,6,5,4,3,2])===Number(d[10]);
 return digit(d.slice(0,12),[5,4,3,2,9,8,7,6,5,4,3,2])===Number(d[12])&&digit(d.slice(0,13),[6,5,4,3,2,9,8,7,6,5,4,3,2])===Number(d[13]);
}
const rpcFor=admin=>async(name,args={})=>{const {data,error}=await admin.rpc(name,args);if(error)throw new Error(error.message);return data;};
async function request(path,context,deps,method='GET',body){
 if(!/^\/(customers(?:\?[^\r\n]*)?|payments(?:\?[^\r\n]*|\/pay_[A-Za-z0-9_-]+(?:\/pixQrCode)?)?)$/.test(path))throw new Error('ASAAS_RESOURCE_INVALID');
 const response=await (deps.fetchImpl||fetch)(ASAAS_SANDBOX+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),
  headers:{accept:'application/json','content-type':'application/json',access_token:accountKey(deps.env,context.issuer_account_id),
    'User-Agent':'TamoOn-Sandbox-22BB-C33'},...(body?{body:JSON.stringify(body)}:{})});
 let result;try{result=await response.json();}catch{throw new Error('ASAAS_INVALID_RESPONSE');}
 return {ok:response.ok,status:response.status,result};
}
async function get(path,c,d){const r=await request(path,c,d);if(!r.ok)throw new Error('ASAAS_LOOKUP_HTTP_'+r.status);return r.result;}
export function validatePixPayment(p,c){
 if(!PAYMENT.test(p?.id)||p.billingType!=='PIX'||p.externalReference!==c.external_reference||Number(p.value)!==Number(c.amount)
  ||!c.customer_id||p.customer!==c.customer_id||(c.provider_payment_id&&c.provider_payment_id!==p.id))throw new Error('ASAAS_PAYMENT_MISMATCH');
 const split=p.split??[];
 if(!Array.isArray(split))throw new Error('ASAAS_SPLIT_MISMATCH');
 if(Number(c.split_commission_amount)>0){if(split.length!==1||split[0].walletId!==c.split_wallet_id
   ||Number(split[0].fixedValue)!==Number(c.split_commission_amount))throw new Error('ASAAS_SPLIT_MISMATCH');}
 else if(split.length)throw new Error('ASAAS_SPLIT_MISMATCH');
 return p;
}
async function findPayment(c,deps){
 if(c.provider_payment_id)return validatePixPayment(await get('/payments/'+c.provider_payment_id,c,deps),c);
 const list=await get('/payments?externalReference='+encodeURIComponent(c.external_reference)+'&limit=2',c,deps);
 if(!Array.isArray(list.data)||list.hasMore||list.data.length>1)throw new Error('ASAAS_ROUTE_AMBIGUOUS');
 return list.data.length?validatePixPayment(list.data[0],c):null;
}
async function reconcile(p,c,rpc,deps){
 if(!['RECEIVED','CONFIRMED'].includes(p.status))return false;
 await rpc('apply_asaas_account_event',{p_event_id:'INLINE_PIX:'+p.id+':'+p.status,p_event_type:'PAYMENT_'+p.status,
  p_payment:p,p_account_id:c.issuer_account_id||deps.env('ASAAS_MAIN_ACCOUNT_ID')||null});return true;
}
export function inlinePixPayload(c,customerId,at=Date.now()){
 if(!CUSTOMER.test(customerId)||c.billing_type!=='PIX'||!c.installment_id||!c.external_reference
   ||!Number.isFinite(Number(c.amount))||Number(c.amount)<=0||Math.abs(Number(c.amount)*100-Math.round(Number(c.amount)*100))>0.000001
   ||!Number.isFinite(Date.parse(c.due_at))||Date.parse(c.due_at)-at<30000)throw new Error('PIX_PAYMENT_WINDOW_TOO_SHORT');
 // dueDate is only a calendar date. The server worker enforces the reservation deadline.
 const dueDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(c.provider_due_at||c.due_at));
 return {customer:customerId,billingType:'PIX',value:Number(c.amount),dueDate,externalReference:c.external_reference,
  description:`${c.participant_id?'Cota da reserva':'Reserva'} ${c.reservation_code} - Tâmo On Sandbox`,
  ...(Number(c.split_commission_amount)>0?{split:[{walletId:c.split_wallet_id,fixedValue:Number(c.split_commission_amount)}]}:{})};
}
async function customer(c,payer,deps){
 if(CUSTOMER.test(c.customer_id||''))return c.customer_id;
 const reference='TAMOON:PROFILE:'+c.owner_id;
 const list=await get('/customers?externalReference='+encodeURIComponent(reference)+'&limit=2',c,deps);
 if(!Array.isArray(list.data)||list.hasMore||list.data.length>1)throw new Error('PIX_CUSTOMER_REVIEW_REQUIRED');
 if(list.data.length){const item=list.data[0];if(!CUSTOMER.test(item.id)||item.externalReference!==reference||item.deleted===true)throw new Error('PIX_CUSTOMER_INVALID');return item.id;}
 if(!payer)return null;
 const name=typeof payer.name==='string'?payer.name.trim():'';
 const cpfCnpj=typeof payer.cpfCnpj==='string'?payer.cpfCnpj.replace(/[.\-/\s]/g,''):'';
 if(name.length<3||name.length>120||/[\u0000-\u001f]/.test(name)||!validTaxId(cpfCnpj))throw new Error('PIX_PAYER_INVALID');
 const r=await request('/customers',c,deps,'POST',{name,cpfCnpj,externalReference:reference,notificationDisabled:true});
 // No payment was sent. A following attempt searches the same external reference first.
 if(!r.ok)throw new Error('PIX_CUSTOMER_REJECTED');
 if(!CUSTOMER.test(r.result?.id)||r.result.externalReference!==reference)throw new Error('PIX_CUSTOMER_INVALID');
 return r.result.id;
}
export async function openInlinePix(admin,reservationId,profileId,deps,retryToken=null,payer=null){
 const respond=(body,status=200)=>deps.jsonResponse(body,status),rpc=rpcFor(admin),now=deps.now||Date.now;
 try{
  requireSandbox(deps.env);
  if(retryToken!==null&&!UUID.test(retryToken))return respond({error:'CHECKOUT_RETRY_INVALID'},400);
  const {data:r,error}=await admin.from('reservations').select('partner_id,booking_mode,monthly_cycle_id,payment_method').eq('id',reservationId).single();
  if(error)throw new Error('RESERVATION_NOT_FOUND');
  if(!r||!['single','monthly'].includes(r.booking_mode)||(r.booking_mode==='single'&&r.monthly_cycle_id)||r.payment_method!=='pix_direct_partner')return respond({error:'ASAAS_CHECKOUT_SCOPE'},409);
  const useSplit=deps.env('ASAAS_SPLIT_ENABLED')==='true';
  const partner=useSplit?accountRegistry(deps.env).find(x=>x.partnerId===r.partner_id&&x.active!==false):null;
  if(partner)await verifyPartnerAccount(partner,{env:deps.env,fetch:deps.fetchImpl||fetch});
  const c=await rpc('claim_asaas_inline_pix',{p_reservation_id:reservationId,p_profile_id:profileId,p_routing:publicAccount(partner),p_require_split:useSplit,p_retry_token:retryToken});
  if(c.delivery_mode==='checkout'){
   if(c.status==='ready')return respond({mode:'asaas_checkout',provider:'asaas',billingType:'PIX',amount:Number(c.amount),checkoutId:c.checkout_id,checkoutUrl:sandboxCheckoutUrl({id:c.checkout_id,link:c.checkout_url}),reused:true});
   if(deps.legacyCheckout)return await deps.legacyCheckout();
   return respond({error:'PIX_LEGACY_CHECKOUT_REVIEW_REQUIRED'},409);
  }
  const resultBase={mode:'asaas_pix',provider:'asaas',billingType:'PIX',amount:Number(c.amount),installmentId:c.installment_id,
    participantId:c.participant_id,dueAt:c.due_at,serverNow:new Date(now()).toISOString()};
  if(c.status==='paid')return respond({...resultBase,status:'paid'});
  if(['cancelled','expired'].includes(c.status))return respond({error:'CHECKOUT_CLOSED'},409);
  let payment;
  if(c.claimed){
   let id;
   try{id=await customer(c,payer,deps);}catch(e){return respond({error:e.message},422);}
   if(!id)return respond({mode:'asaas_pix_payer_required',payerName:c.payer_name||'',dueAt:c.due_at});
   c.customer_id=id;
   let payload;
   try{payload=inlinePixPayload(c,id,now());}catch(e){await rpc('finish_asaas_inline_pix_attempt',{p_session_key:c.session_key,p_claim_token:c.claim_token,p_outcome:'not_sent'});return respond({error:e.message},409);}
   // The durable fence is committed before the only monetary POST. Never retry a lost response.
   try{await rpc('start_asaas_inline_pix',{p_session_key:c.session_key,p_claim_token:c.claim_token,p_customer_id:id});}
   catch(e){return respond({error:['PIX_PAYMENT_WINDOW_TOO_SHORT','PIX_MAINTENANCE_UNAVAILABLE'].includes(e.message)?e.message:'CHECKOUT_AWAITING_RECONCILIATION'},409);}
   let response;
   try{response=await request('/payments',c,deps,'POST',payload);}catch{
    await rpc('finish_asaas_inline_pix_attempt',{p_session_key:c.session_key,p_claim_token:c.claim_token,p_outcome:'unknown'});
    return respond({error:'CHECKOUT_RESULT_UNKNOWN'},502);
   }
   if(!response.ok){
    const rejected=definitiveCheckoutRejection(response.status,response.result);
    const retry=await rpc('finish_asaas_inline_pix_attempt',{p_session_key:c.session_key,p_claim_token:c.claim_token,p_outcome:rejected?'rejected':'unknown',p_provider_status:response.status});
    return respond({error:'ASAAS_PIX_PAYMENT_ERROR',...retry},502);
   }
   try{payment=validatePixPayment(response.result,c);await rpc('bind_asaas_inline_pix',{p_session_key:c.session_key,p_payment:payment});}
   catch{return respond({error:'CHECKOUT_AWAITING_RECONCILIATION'},502);}
  }else{
   if(c.status==='failed')return respond({error:'CHECKOUT_RETRY_AVAILABLE',retryAllowed:c.retry_allowed===true,retryToken:c.retry_allowed?c.retry_token:null},409);
   payment=await findPayment(c,deps);
   if(!payment)return respond({error:'CHECKOUT_AWAITING_RECONCILIATION'},409);
   await rpc('bind_asaas_inline_pix',{p_session_key:c.session_key,p_payment:payment});
  }
  // Always read status before exposing/re-exposing a QR, including a just-created charge.
  payment=validatePixPayment(await get('/payments/'+payment.id,c,deps),c);
  if(await reconcile(payment,c,rpc,deps))return respond({...resultBase,status:'paid'});
  if(payment.deleted===true||payment.status!=='PENDING')return respond({error:'CHECKOUT_CLOSED'},409);
  if(Date.parse(c.due_at)<=now())return respond({error:'PAYMENT_WINDOW_EXPIRED'},409);
  const qr=await get('/payments/'+payment.id+'/pixQrCode',c,deps);
  if(typeof qr.encodedImage!=='string'||!/^iVBOR[0-9A-Za-z+/=]+$/.test(qr.encodedImage)||qr.encodedImage.length>500000
    ||typeof qr.payload!=='string'||!qr.payload.startsWith('000201')||qr.payload.length>4096)throw new Error('PIX_QR_INVALID');
  if(Date.parse(c.due_at)<=now())return respond({error:'PAYMENT_WINDOW_EXPIRED'},409);
  if(!await rpc('can_present_asaas_inline_pix',{p_session_key:c.session_key,p_profile_id:profileId}))return respond({error:'CHECKOUT_CLOSED'},409);
  return respond({...resultBase,status:'pending',paymentId:payment.id,encodedImage:qr.encodedImage,payload:qr.payload,
    serverNow:new Date(now()).toISOString(),reused:!c.claimed});
 }catch(e){
  const code=typeof e?.message==='string'&&/^[A-Z0-9_]{1,80}$/.test(e.message)?e.message:'ASAAS_PIX_UNAVAILABLE';
  return respond({error:code},503);
 }
}

export async function maintainInlinePix(admin,deps){
 requireSandbox(deps.env);const rpc=rpcFor(admin),jobs=await rpc('claim_asaas_inline_pix_jobs');
 if(!Array.isArray(jobs))throw new Error('PIX_JOBS_INVALID');
 // Independent charges can be checked concurrently; each has a DB lease.
 const results=await Promise.all(jobs.map(async c=>{
  let state='open',error=null;
  try{
   if(!c.sent_at||['not_sent','rejected'].includes(c.attempt_outcome)){
    if(c.close_required)state='closed';
   }else{
    const p=await findPayment(c,deps);
    if(!p)throw new Error('PIX_PAYMENT_AWAITING_RECONCILIATION');
    await rpc('bind_asaas_inline_pix',{p_session_key:c.session_key,p_payment:p});
    if(await reconcile(p,c,rpc,deps))state='paid';
    else if(p.deleted===true)state='closed';
    else if(c.close_required){
     if(!['PENDING','OVERDUE'].includes(p.status))throw new Error('PIX_PAYMENT_STATE_REVIEW');
     const deleted=await request('/payments/'+p.id,c,deps,'DELETE');
     if(deleted.ok&&deleted.result?.id===p.id&&deleted.result?.deleted===true)state='closed';
     else {
      // A payment may settle between GET and DELETE. Fresh evidence wins.
      const current=validatePixPayment(await get('/payments/'+p.id,c,deps),c);
      if(await reconcile(current,c,rpc,deps))state='paid';
      else if(current.deleted===true)state='closed';
      else throw new Error('PIX_PAYMENT_CLOSE_UNCONFIRMED');
     }
    }
   }
  }catch(e){error=/^[A-Z0-9_]{1,80}$/.test(e?.message||'')?e.message:'PIX_MAINTENANCE_ERROR';}
  await rpc('finish_asaas_inline_pix_job',{p_session_key:c.session_key,p_lease_token:c.lease_token,p_state:state,p_error:error});
  return {state,ok:!error};
 }));
 return {processed:results.length,failed:results.filter(x=>!x.ok).length};
}

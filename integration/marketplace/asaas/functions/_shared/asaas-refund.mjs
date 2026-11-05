import {checkRefundBalance} from './asaas-refund-balance.mjs';
import {forAccount} from './asaas-accounts.mjs';
import {refundPayload} from './asaas-refund-payload.mjs';
import {findRefundTransfer} from './asaas-refund-transfer.mjs';
import {findRefundPix} from './asaas-refund-pix.mjs';
const BASE='https://api-sandbox.asaas.com/v3';
export function refundConfig(env) {
  if(env('ASAAS_SANDBOX_ENABLED')!=='true'||env('MARKETPLACE_STAGING_SIMULATION')!=='false'
    ||(env('ASAAS_BASE_URL')||BASE).replace(/\/$/,'')!==BASE) throw new Error('REFUND_SANDBOX_REQUIRED');
  const key=env('ASAAS_API_KEY');
  if(!key) throw new Error('REFUND_API_KEY_REQUIRED');
  return key;
}
export async function asaasRequest(id,suffix,{env,fetch:fetcher=fetch},body) {
  if(!/^pay_[A-Za-z0-9_-]+$/.test(id)) throw new Error('REFUND_INVALID_PAYMENT_ID');
  const key=refundConfig(env);
  const response=await fetcher(`${BASE}/payments/${id}${suffix}`,{
    method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{access_token:key,'Content-Type':'application/json','User-Agent':'TamoOn-Sandbox-22BB'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  // Retain only a known, sanitized reason. Never persist/return raw provider bodies.
  if(!response.ok){
    let payload;try{payload=await response.json();}catch{}
    const errors=Array.isArray(payload?.errors)?payload.errors:[];
    const rejected=response.status>=400&&response.status<500&&![408,409,425,429].includes(response.status)
      &&errors.length>0&&errors.every(e=>typeof e?.code==='string'&&typeof e?.description==='string');
    const balance=response.status===400&&rejected&&errors.some(e=>
      /saldo (?:disponivel )?insuficiente|nao ha saldo suficiente|insufficient (?:available )?balance/i.test(
        e.description.normalize('NFD').replace(/[\u0300-\u036f]/g,'')));
    const error=new Error(balance?'REFUND_INSUFFICIENT_BALANCE':`REFUND_ASAAS_HTTP_${response.status}`);
    error.httpStatus=response.status;error.providerRejected=rejected;throw error;
  }
  const data=await response.json();
  if(!data||typeof data!=='object') throw new Error('REFUND_INVALID_RESPONSE');
  return data;
}
export async function fetchRefundEvidence(id,deps){
  const payment=await asaasRequest(id,'',deps);
  if(payment.id!==id)throw new Error('REFUND_PAYMENT_MISMATCH');
  // The payment GET may have refunds:null even after a cancelled refund.
  // Always obtain the complete list, including immediately before a POST.
  const refunds=[],seen=new Set();let complete=false,offset=0,total;
  for(let page=0;page<10;page++){
    const list=await asaasRequest(id,`/refunds?limit=100&offset=${offset}`,deps);
    const named=Object.hasOwn(list,'refunds');
    const items=Array.isArray(list)?list:named?list.refunds:list.data;
    if(!Array.isArray(items))throw new Error('REFUND_INCOMPLETE_LIST');
    if(list.offset!==undefined&&list.offset!==offset)throw new Error('REFUND_INCOMPLETE_LIST');
    if(list.totalCount!==undefined){
      if(!Number.isSafeInteger(list.totalCount)||list.totalCount<0||(total!==undefined&&total!==list.totalCount))throw new Error('REFUND_INCOMPLETE_LIST');
      total=list.totalCount;
    }
    for(const item of items){
      if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('REFUND_INVALID_EVIDENCE');
      const key=item.id||JSON.stringify([item.dateCreated,item.description,item.value,item.endToEndIdentifier]);
      if(seen.has(key))throw new Error('REFUND_AMBIGUOUS_LIST');
      seen.add(key);refunds.push(item);
    }
    offset+=items.length;
    if(Array.isArray(list)||list.hasMore===false||(named&&list.hasMore===undefined&&list.totalCount===undefined)){
      if(total!==undefined&&refunds.length!==total)throw new Error('REFUND_INCOMPLETE_LIST');
      complete=true;break;
    }
    if(list.hasMore!==true||items.length===0)throw new Error('REFUND_INCOMPLETE_LIST');
  }
  if(!complete)throw new Error('REFUND_INCOMPLETE_LIST');
  // Conflicting snapshots cannot authorize a new refund.
  if(Array.isArray(payment.refunds)){
    const done=items=>items.filter(r=>r.status==='DONE').reduce((n,r)=>n+Number(r.value),0);
    if(done(payment.refunds)>done(refunds)||payment.refunds.some(r=>!['DONE','CANCELLED','DENIED'].includes(r.status))
      &&!refunds.some(r=>!['DONE','CANCELLED','DENIED'].includes(r.status)))throw new Error('REFUND_INCONSISTENT_EVIDENCE');
  }
  payment.refunds=refunds;
  return payment;
}

export async function refundOperation(body,userId,admin,deps){
  const {reservationId,action='preview',paymentId,amount=null,expectedRequestId=null}=body||{};
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(!uuid.test(reservationId||'')||!['preview','submit','reconcile','retry','balance'].includes(action)
    ||(paymentId!=null&&!uuid.test(paymentId))||(expectedRequestId!=null&&!uuid.test(expectedRequestId)))throw new Error('REFUND_INVALID_REQUEST');
  const rpc=async(name,args)=>{const {data,error}=await admin.rpc(name,args);if(error)throw new Error(error.message);return data;};
  const identity={p_reservation_id:reservationId,p_profile_id:userId};
  const context=()=>rpc('asaas_refund_payments',identity);
  const safe=c=>({...c,payments:c.payments.map(p=>{
    const {provider_payment_id,claim_token,provider_transfer_id,provider_pix_transaction_id,request_created_at,route,...shown}=p;
    return {...shown,split_enabled:Boolean(route?.issuer_account_id)};
  })});
  let all=await context();
  if(action==='preview')return safe(all);
  const selected=paymentId?all.payments.filter(p=>p.payment_id===paymentId):all.payments;
  if(!selected.length||(['submit','retry','balance'].includes(action)&&selected.length!==1))throw new Error('REFUND_PAYMENT_REQUIRED');
  const apply=(c,p)=>rpc('apply_asaas_account_event',{p_event_id:`refund-reconcile:${crypto.randomUUID()}`,
    p_event_type:'REFUND_RECONCILIATION',p_payment:p,p_account_id:c.route?.issuer_account_id||deps.env('ASAAS_MAIN_ACCOUNT_ID')||null});
  if(action==='reconcile'){
    const lookups=new Map();
    for(const c of selected){
      if(!c.request_id||c.status==='completed')continue;
      const scoped=forAccount(deps,c.route?.issuer_account_id);
      await apply(c,await fetchRefundEvidence(c.provider_payment_id,scoped));
      const fresh=(await context()).payments.find(p=>p.payment_id===c.payment_id);
      if(fresh.request_id&&fresh.billing_type==='PIX'&&!['completed','partial','not_requested','rejected'].includes(fresh.status)){
        try{
          const transfer=fresh.provider_pix_transaction_id?null:await findRefundTransfer(fresh,scoped);
          if(transfer)await rpc('apply_asaas_refund_transfer',{p_event_id:`transfer-reconcile:${crypto.randomUUID()}`,
            p_request_id:fresh.request_id,p_transfer:transfer.transfer,p_observed_at:transfer.observedAt});
          else{
            const pix=await findRefundPix(fresh,scoped);
            if(pix)await rpc('apply_asaas_refund_pix',{p_event_id:`pix-reconcile:${crypto.randomUUID()}`,
              p_request_id:fresh.request_id,p_pix:pix.pix,p_observed_at:pix.observedAt});
            else lookups.set(c.payment_id,'not_found');
          }
        }catch{lookups.set(c.payment_id,'unavailable');}
      }
    }
    all=await context();return safe({...all,payments:all.payments.map(c=>({...c,...(lookups.has(c.payment_id)?{transfer_lookup:lookups.get(c.payment_id)}:{})}))});
  }
  let c=selected[0];const scoped=forAccount(deps,c.route?.issuer_account_id);
  if(action==='balance'){
    const evidence=await fetchRefundEvidence(c.provider_payment_id,scoped);
    const payload=refundPayload({...c,request_amount:c.amount,request_id:c.request_id||'preview'},evidence);
    try{return {...safe(all),balance:await checkRefundBalance(c,payload,deps)};}
    catch(error){if(error.balance)return {...safe(all),balance:error.balance};throw error;}
  }
  if((action==='retry'?!c.can_retry:!c.can_submit)||c.request_id!==expectedRequestId)return safe(all);
  let evidence=null;
  if(action==='retry'){
    const observedAt=new Date().toISOString();
    const transfer=c.provider_transfer_id?await findRefundTransfer(c,scoped):null;
    const pix=c.provider_pix_transaction_id?await findRefundPix(c,scoped):null;
    const payment=await fetchRefundEvidence(c.provider_payment_id,scoped);
    evidence={observed_at:observedAt,payment,transfer:transfer?.transfer||null,pix:pix?.pix||null};
  }
  c=await rpc('claim_asaas_refund_payment',{...identity,p_payment_id:c.payment_id,p_amount:amount,
    p_expected_request_id:expectedRequestId,p_retry_evidence:evidence});
  if(!c.claimed)return safe(await context());
  const finish=(status,code=null)=>rpc('finish_asaas_refund',{p_request_id:c.request_id,p_claim_token:c.claim_token,
    p_status:status,p_error_code:code,p_evidence:{}});
  let posting=false;
  try{
    const p=await fetchRefundEvidence(c.provider_payment_id,scoped);
    // Reconcile first; provider evidence may have advanced since the preview.
    await apply(c,p);
    const latest=(await context()).payments.find(x=>x.payment_id===c.payment_id);
    if(!latest||latest.request_id!==c.request_id||latest.status==='completed')throw new Error('REFUND_RECONCILIATION_REQUIRED');
    if(latest.split_review_required)throw new Error('REFUND_SPLIT_RECONCILIATION_REQUIRED');
    if(latest.denial_review_required)throw new Error('REFUND_RECONCILIATION_REQUIRED');
    const payload=refundPayload(c,p);
    await checkRefundBalance(c,payload,deps);
    posting=true;
    const response=await asaasRequest(c.provider_payment_id,'/refund',scoped,payload);
    if(response.id!==c.provider_payment_id)throw new Error('REFUND_INVALID_RESPONSE');
    await finish('submitted');
    // A successful POST is not final confirmation; the next GET/webhook confirms it.
  }catch(error){
    const definite=error.providerRejected===true;
    const uncertain=['REFUND_EXISTING_PROVIDER_REQUEST','REFUND_RECONCILIATION_REQUIRED','REFUND_SPLIT_RECONCILIATION_REQUIRED'].includes(error.message);
    const status=uncertain?'unknown':(!posting||definite?'rejected':'unknown');
    const raw=/^(REFUND|ASAAS)_[A-Z0-9_]+$/.test(error.message)?error.message:'REFUND_OUTCOME_UNKNOWN';
    await finish(status,posting?raw:raw.replace(/^REFUND_/,'REFUND_PREFLIGHT_'));
  }
  return safe(await context());
}

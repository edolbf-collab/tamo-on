// Preserve the deployed webhook v19 refund read behavior during monthly routing.
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
export async function fetchRefundEvidence(id,deps) {
  const payment=await asaasRequest(id,'',deps);
  if(payment.id!==id) throw new Error('REFUND_PAYMENT_MISMATCH');
  // The complete payment resource omits refunds (or returns null) before any
  // refund exists. Do not interpret that optional field as a malformed list.
  // RECEIVED or CONFIRMED may represent an empty history; a refund-related status still
  // requires explicit evidence and an unknown local request stays locked in SQL.
  if(payment.refunds==null && ['RECEIVED','CONFIRMED'].includes(payment.status)) {
    payment.refunds=[];
    return payment;
  }
  if(!Array.isArray(payment.refunds)) {
    const refunds=[];let complete=false;
    for(let page=0;page<10;page++){
      const list=await asaasRequest(id,`/refunds?limit=100&offset=${page*100}`,deps);
      const named=Object.hasOwn(list,'refunds');
      const items=Array.isArray(list)?list:named?list.refunds:list.data;
      if(!Array.isArray(items)) throw new Error('REFUND_EVIDENCE_REQUIRED');
      refunds.push(...items);
      if(Array.isArray(list)||list.hasMore===false || (named && list.hasMore===undefined && list.totalCount===undefined)){complete=true;break;}
      if(list.hasMore!==true||items.length===0) throw new Error('REFUND_INCOMPLETE_EVIDENCE');
    }
    if(!complete) throw new Error('REFUND_INCOMPLETE_EVIDENCE');
    payment.refunds=refunds;
  }
  return payment;
}


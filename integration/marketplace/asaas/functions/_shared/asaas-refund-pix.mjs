import {refundConfig} from './asaas-refund.mjs';
import {refundDescription} from './asaas-refund-transfer.mjs';
const BASE='https://api-sandbox.asaas.com/v3/pix/transactions';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const types=['CREDIT_REFUND','DEBIT_REFUND'];
const statuses=['AWAITING_BALANCE_VALIDATION','AWAITING_INSTANT_PAYMENT_ACCOUNT_BALANCE','AWAITING_CRITICAL_ACTION_AUTHORIZATION','AWAITING_CHECKOUT_RISK_ANALYSIS_REQUEST','AWAITING_CASH_IN_RISK_ANALYSIS_REQUEST','SCHEDULED','AWAITING_REQUEST','REQUESTED','DONE','REFUSED','CANCELLED'];
async function get(suffix,deps){
  const r=await (deps.fetch||fetch)(BASE+suffix,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000),headers:{access_token:refundConfig(deps.env),'Content-Type':'application/json','User-Agent':'TamoOn-Sandbox-22BB-C3'}});
  if(!r.ok)throw new Error(`REFUND_PIX_HTTP_${r.status}`);
  const data=await r.json();
  if(!data||typeof data!=='object')throw new Error('REFUND_PIX_INVALID_RESPONSE');
  return data;
}
async function detail(id,deps){
  if(!uuid.test(id||''))throw new Error('REFUND_PIX_INVALID_ID');
  const p=await get('/'+id,deps);
  if(p.id!==id)throw new Error('REFUND_PIX_MISMATCH');
  return p;
}
export {detail as getRefundPixDetail};
export async function findRefundPix(c,deps){
  let id=c.provider_pix_transaction_id;
  if(!id){
    const ids=new Set();let complete=false;
    for(let page=0;page<10;page++){
      // The Pix list does not document a creation-date filter. Read all pages
      // within the bounded diagnostic limit, never infer absence from one page.
      const list=await get(`?limit=100&offset=${page*100}`,deps);
      if(!Array.isArray(list.data)||typeof list.hasMore!=='boolean')throw new Error('REFUND_PIX_INCOMPLETE_LIST');
      for(const p of list.data)if(p.description===refundDescription(c)&&types.includes(p.type)){
        if(!uuid.test(p.id||'')||Number(p.value)!==Number(c.request_amount??c.payment_amount))throw new Error('REFUND_PIX_MISMATCH');
        ids.add(p.id);
      }
      if(ids.size>1)throw new Error('REFUND_PIX_AMBIGUOUS');
      if(!list.hasMore){complete=true;break;}
      if(!list.data.length)throw new Error('REFUND_PIX_INCOMPLETE_LIST');
    }
    if(!complete)throw new Error('REFUND_PIX_INCOMPLETE_LIST');
    if(!ids.size)return null;
    id=[...ids][0];
  }
  const observedAt=new Date().toISOString();
  const p=await detail(id,deps);
  if(!types.includes(p.type)||!statuses.includes(p.status)||Number(p.value)!==Number(c.request_amount??c.payment_amount)
    ||p.description!==refundDescription(c))throw new Error('REFUND_PIX_MISMATCH');
  let linkedPayment=p.payment;
  if(linkedPayment && linkedPayment!==c.provider_payment_id)throw new Error('REFUND_PIX_PAYMENT_MISMATCH');
  if(!linkedPayment){
    const original=await detail(p.originalTransaction?.id,deps);
    if(original.type!=='CREDIT'||original.payment!==c.provider_payment_id||Number(original.value)<Number(c.request_amount??c.payment_amount))throw new Error('REFUND_PIX_PAYMENT_MISMATCH');
    linkedPayment=original.payment;
  }
  return {pix:{id:p.id,type:p.type,status:p.status,value:p.value,description:p.description,
    payment:linkedPayment,refusalReason:typeof p.refusalReason==='string'?p.refusalReason.slice(0,500):null},observedAt};
}

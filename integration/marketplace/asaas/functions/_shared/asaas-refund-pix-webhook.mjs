import {findRefundPix, getRefundPixDetail} from './asaas-refund-pix.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const pixRefundEvents=['PIX_CREDIT_REFUND_REFUSED'];

// Event name supplied by Asaas support, ticket 1776705. Its public payload
// contract is not published. These are defensive adapters, not a claim that
// either envelope has been observed in Sandbox. Unknown/ambiguous envelopes
// remain failed in the durable queue instead of being silently ignored.
export function refundPixEventId(payload){
  const candidates=[];
  if(payload.pixTransaction!=null)candidates.push(typeof payload.pixTransaction==='string'?payload.pixTransaction:payload.pixTransaction.id);
  if(payload.pixTransactionId!=null)candidates.push(payload.pixTransactionId);
  for(const value of Object.values(payload)){
    if(value&&typeof value==='object'&&!Array.isArray(value)&&['CREDIT_REFUND','DEBIT_REFUND'].includes(value.type))candidates.push(value.id);
  }
  if(!candidates.length)throw new Error('REFUND_PIX_WEBHOOK_PAYLOAD_UNSUPPORTED');
  if(candidates.some(id=>typeof id!=='string'||!uuid.test(id)))throw new Error('REFUND_PIX_INVALID_ID');
  const ids=[...new Set(candidates.map(id=>id.toLowerCase()))];
  if(ids.length!==1)throw new Error('REFUND_PIX_AMBIGUOUS');
  return ids[0];
}

export async function processRefundPixWebhook(admin,eventId,payload,deps){
  const id=refundPixEventId(payload);
  // Payload only selects the resource. Status, value, description, reason and
  // payment linkage must come from the authenticated Sandbox API.
  const pix=await getRefundPixDetail(id,deps);
  const {data:context,error}=await admin.rpc('asaas_refund_pix_target',{p_pix:pix});
  if(error)throw error;
  if(!context)return false;
  const evidence=await findRefundPix({...context,provider_pix_transaction_id:id},deps);
  // Refusal notification can arrive before the API read model catches up.
  // Retry via the existing queue; never turn an unconfirmed refusal into DONE.
  if(!['REFUSED','CANCELLED','DONE'].includes(evidence.pix.status))throw new Error('REFUND_PIX_REFUSAL_NOT_VISIBLE');
  const {error:applyError}=await admin.rpc('apply_asaas_refund_pix',{
    p_event_id:eventId,p_request_id:context.request_id,p_pix:evidence.pix,p_observed_at:evidence.observedAt,
  });
  if(applyError)throw applyError;
  return true;
}

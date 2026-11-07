import {refundConfig} from './asaas-refund.mjs';
const BASE='https://api-sandbox.asaas.com/v3';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses=['PENDING','BANK_PROCESSING','BLOCKED','DONE','FAILED','CANCELLED'];
export const transferEvents=['TRANSFER_CREATED','TRANSFER_PENDING','TRANSFER_IN_BANK_PROCESSING','TRANSFER_BLOCKED','TRANSFER_DONE','TRANSFER_FAILED','TRANSFER_CANCELLED'];
export const refundDescription=c=>`Cancelamento ${c.reservation_code} - solicitação ${c.request_id}`;
async function get(path,deps){
  const response=await (deps.fetch||fetch)(BASE+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000),headers:{access_token:refundConfig(deps.env),'User-Agent':'TamoOn-Sandbox-22BB-C2'}});
  if(!response.ok)throw new Error(`REFUND_TRANSFER_HTTP_${response.status}`);
  const data=await response.json();
  if(!data||typeof data!=='object')throw new Error('REFUND_TRANSFER_INVALID_RESPONSE');
  return data;
}
export async function getRefundTransfer(id,deps){
  // The numeric pixTransactionId in the dashboard is not an API transfer ID.
  if(!uuid.test(id||''))throw new Error('REFUND_TRANSFER_INVALID_ID');
  const observedAt=new Date().toISOString();
  const t=await get('/transfers/'+id,deps);
  if(t.id!==id || !statuses.includes(t.status) || t.operationType!=='PIX'
    || !Number.isFinite(Number(t.value)) || Number(t.value)<=0)throw new Error('REFUND_TRANSFER_MISMATCH');
  return {transfer:{id:t.id,status:t.status,operationType:t.operationType,value:t.value,
    description:t.description,failReason:typeof t.failReason==='string'?t.failReason.slice(0,500):null},observedAt};
}
export async function findRefundTransfer(c,deps){
  if(c.provider_transfer_id)return getRefundTransfer(c.provider_transfer_id,deps);
  const created=Date.parse(c.request_created_at);
  if(!uuid.test(c.request_id||'') || !Number.isFinite(created))throw new Error('REFUND_TRANSFER_CONTEXT_REQUIRED');
  // Include previous UTC date because Asaas dates may use Sao Paulo time.
  const since=new Date(created-86400000).toISOString().slice(0,10);
  const params=new URLSearchParams({'dateCreated[ge]':since,limit:'100'});
  const ids=new Set();let complete=false;
  for(let page=0;page<10;page++){
    params.set('offset',String(page*100));
    const list=await get('/transfers?'+params,deps);
    if(!Array.isArray(list.data)||typeof list.hasMore!=='boolean')throw new Error('REFUND_TRANSFER_INCOMPLETE_LIST');
    for(const t of list.data)if(t.description===refundDescription(c)){
      if(!uuid.test(t.id||'') || t.operationType!=='PIX' || Number(t.value)!==Number(c.request_amount??c.payment_amount))throw new Error('REFUND_TRANSFER_MISMATCH');
      ids.add(t.id);
    }
    if(ids.size>1)throw new Error('REFUND_TRANSFER_AMBIGUOUS');
    if(!list.hasMore){complete=true;break;}
    if(list.data.length===0)throw new Error('REFUND_TRANSFER_INCOMPLETE_LIST');
  }
  if(!complete)throw new Error('REFUND_TRANSFER_INCOMPLETE_LIST');
  if(!ids.size)return null;
  const result=await getRefundTransfer([...ids][0],deps);
  if(result.transfer.description!==refundDescription(c)||Number(result.transfer.value)!==Number(c.request_amount??c.payment_amount))throw new Error('REFUND_TRANSFER_MISMATCH');
  return result;
}
export async function processRefundTransfer(admin,eventId,transfer,deps){
  const {data:target,error}=await admin.rpc('asaas_refund_transfer_target',{p_transfer:transfer});
  if(error)throw error;
  if(!target)return false; // Other account transfers are outside this feature.
  const current=await getRefundTransfer(transfer.id,deps);
  const {error:applyError}=await admin.rpc('apply_asaas_refund_transfer',{
    p_event_id:eventId,p_request_id:target.request_id,p_transfer:current.transfer,p_observed_at:current.observedAt
  });
  if(applyError)throw applyError;
  return true;
}

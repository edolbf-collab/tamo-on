import {accountRegistry,getAsaas,uuid} from './asaas-accounts.mjs';

// Only the authenticated webhook/processor calls this. No payment/refund POSTs.
export async function externalPaymentOutcome(admin,event,deps){
  const original=event.payload?.payment,accountId=event.payload?.account?.id;
  const rpc=async(name,args)=>{const {data,error}=await admin.rpc(name,args);if(error)throw error;return data;};
  const scope=await rpc('asaas_payment_event_scope',{p_payment:original});
  if(scope==='linked')return null;
  if(scope!=='external_candidate')throw new Error('ASAAS_PAYMENT_UNLINKED');
  if(!uuid.test(accountId||'') || (accountId!==deps.env('ASAAS_MAIN_ACCOUNT_ID')
    &&!accountRegistry(deps.env).some(a=>a.accountId===accountId)))throw new Error('ASAAS_EVENT_ACCOUNT_MISMATCH');
  const current=await getAsaas('/payments/'+original.id,deps,accountId);
  if(current.object!=='payment'||current.id!==original.id
    ||typeof current.value!=='number'||!Number.isFinite(current.value)||current.value<=0
    ||typeof original.value!=='number'||current.value!==original.value||current.billingType!==original.billingType
    ||!['PIX','BOLETO','CREDIT_CARD'].includes(current.billingType)
    ||!Object.hasOwn(current,'externalReference')||!Object.hasOwn(current,'checkoutSession')){
    throw new Error('ASAAS_EXTERNAL_EVIDENCE_MISMATCH');
  }
  // Recheck the original event and fresh GET atomically before recording ignored.
  const outcome=await rpc('ignore_verified_asaas_external_payment',{
    p_event_id:event.id,p_payment:current,p_account_id:accountId
  });
  if(!['ignored','processed'].includes(outcome))throw new Error('ASAAS_EXTERNAL_CLASSIFICATION_FAILED');
  return outcome;
}

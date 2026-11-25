import {provision} from '../establishment-receipts/provision.mjs';
import {monthlyWebhookOutcome} from './asaas-monthly-webhook.mjs';
import {receiptEnvironment,forAccount,getAsaas,accountRegistry} from './asaas-accounts.mjs';
import {fetchRefundEvidence} from './asaas-webhook-refund-evidence.mjs';
import {processRefundTransfer,transferEvents} from './asaas-refund-transfer.mjs';
import {processRefundPixWebhook,pixRefundEvents} from './asaas-refund-pix-webhook.mjs';
import {externalPaymentOutcome} from './asaas-external-payment.mjs';
const refundEvents=['PAYMENT_REFUNDED','PAYMENT_PARTIALLY_REFUNDED','PAYMENT_REFUND_IN_PROGRESS','PAYMENT_REFUND_DENIED'];
const paymentEvents=['PAYMENT_CONFIRMED','PAYMENT_RECEIVED',...refundEvents];
const splitEvents=['PAYMENT_SPLIT_DONE','PAYMENT_SPLIT_CANCELLED','PAYMENT_SPLIT_DIVERGENCE_BLOCK','PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED'];
const checkoutEvents=['CHECKOUT_CANCELED','CHECKOUT_EXPIRED','CHECKOUT_PAID','CHECKOUT_CREATED'];
export async function processAsaasEvent(admin,event,deps){
  const payload=event.payload||{},type=event.event_type||payload.event,accountId=payload.account?.id||null;
  if(accountId)deps={...deps,env:await receiptEnvironment(admin,deps.env,{accountId})};
  const rpc=async(name,args)=>{const {data,error}=await admin.rpc(name,args);if(error)throw error;return data;};
  if(type==='ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED'){
    if(!accountId)throw Error('ASAAS_EVENT_ACCOUNT_MISMATCH');
    const venues=await rpc('receipt_awaiting_venues',{p_account:accountId});
    for(const venue of venues)await provision(venue,{env:deps.env,rpc,fetch:deps.fetch||fetch});
    return 'processed';
  }
  const checkAccount=route=>{
    const expected=route?.issuer_account_id||deps.env('ASAAS_MAIN_ACCOUNT_ID');
    if(expected&&expected!==accountId)throw new Error('ASAAS_EVENT_ACCOUNT_MISMATCH');
  };
  if(transferEvents.includes(type)||pixRefundEvents.includes(type)){
    if(accountId&&accountId!==deps.env('ASAAS_MAIN_ACCOUNT_ID')&&!accountRegistry(deps.env).some(a=>a.accountId===accountId)){
      if(deps.env('ASAAS_MAIN_ACCOUNT_ID'))throw new Error('ASAAS_EVENT_ACCOUNT_MISMATCH');
    }
    const scoped=forAccount(deps,accountId===deps.env('ASAAS_MAIN_ACCOUNT_ID')?null:
      accountRegistry(deps.env).some(a=>a.accountId===accountId)?accountId:null);
    if(pixRefundEvents.includes(type))return await processRefundPixWebhook(admin,event.provider_event_id,payload,scoped)?'processed':'ignored';
    if(!payload.transfer)throw new Error('TRANSFER_PAYLOAD_REQUIRED');
    return await processRefundTransfer(admin,event.provider_event_id,payload.transfer,scoped)?'processed':'ignored';
  }
  if(checkoutEvents.includes(type)){
    if(!payload.checkout)throw new Error('CHECKOUT_PAYLOAD_REQUIRED');
    const route=await rpc('asaas_payment_route',{p_payment:{checkoutSession:payload.checkout.id,externalReference:payload.checkout.externalReference}});
    checkAccount(route);
    await rpc('apply_asaas_checkout_event',{p_event_type:type,p_checkout:payload.checkout});return 'processed';
  }
  if(type?.startsWith('PAYMENT_') && payload.payment?.externalReference?.startsWith('tamoon-opening:')){
    if(!accountId||accountId!==deps.env('ASAAS_MAIN_ACCOUNT_ID'))throw Error('ASAAS_EVENT_ACCOUNT_MISMATCH');
    const payment=await getAsaas('/payments/'+payload.payment.id,deps);
    await rpc('receipt_fee_result',{p_payment:payment});return 'processed';
  }
  if(type?.startsWith('PAYMENT_')&&payload.payment){const monthly=await monthlyWebhookOutcome(admin,event,deps);if(monthly)return monthly;}
  if(!paymentEvents.includes(type)&&!splitEvents.includes(type))return 'ignored';
  if(!payload.payment)throw new Error('PAYMENT_PAYLOAD_REQUIRED');
  const external=await externalPaymentOutcome(admin,event,deps);
  if(external)return external;
  const route=await rpc('asaas_payment_route',{p_payment:payload.payment});checkAccount(route);
  // Read the first, authenticated payload from the durable queue. Keep the
  // root additionalInfo even when GET /payments omits refunds entirely.
  if(type==='PAYMENT_REFUND_DENIED')await rpc('record_asaas_refund_denial',{p_event_id:event.provider_event_id});
  let payment=payload.payment;
  const scoped=forAccount(deps,route.issuer_account_id);
  if(refundEvents.includes(type))payment=await fetchRefundEvidence(payment.id,scoped);
  else if(route.issuer_account_id){
    const current=await getAsaas('/payments/'+payment.id,deps,route.issuer_account_id);
    if(current.id!==payment.id||Number(current.value)!==Number(payment.value)||current.billingType!==payment.billingType)throw new Error('ASAAS_PAYMENT_MISMATCH');
    payment={...payment,...(splitEvents.includes(type)?current:{}),...(current.netValue!=null?{netValue:current.netValue}:{}),split:current.split,refunds:current.refunds};
  }
  await rpc('apply_asaas_account_event',{p_event_id:event.provider_event_id,p_event_type:type,p_payment:payment,p_account_id:accountId});
  return 'processed';
}

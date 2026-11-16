import {getAsaas,uuid} from './asaas-accounts.mjs';
import {monthlyEnvironment} from '../establishment-billing/config.mjs';
import {validateMonthlyPayment} from '../establishment-checkout/core.mjs';
const events=new Set(['PAYMENT_CREATED','PAYMENT_UPDATED','PAYMENT_CONFIRMED','PAYMENT_RECEIVED','PAYMENT_OVERDUE','PAYMENT_DELETED','PAYMENT_RESTORED','PAYMENT_REFUNDED','PAYMENT_PARTIALLY_REFUNDED','PAYMENT_REFUND_IN_PROGRESS','PAYMENT_REFUND_DENIED']);
export async function monthlyWebhookOutcome(admin,event,deps){
 const original=event.payload?.payment;
 const rpc=async(name,args)=>{const {data,error}=await admin.rpc(name,args);if(error)throw error;return data;};
 const c=await rpc('establishment_webhook_context',{p_payment:original});
 if(!c)return null;
 const env=monthlyEnvironment(deps.env),main=env('ASAAS_MAIN_ACCOUNT_ID');
 if(!uuid.test(main||'')||event.payload?.account?.id!==main)throw Error('ASAAS_EVENT_ACCOUNT_MISMATCH');
 if(c.environment!=='sandbox'||env('ESTABLISHMENT_BILLING_ENVIRONMENT')!=='sandbox')throw Error('PLAN_CHECKOUT_SANDBOX_ONLY');
 if(!events.has(event.event_type||event.payload.event))return 'ignored';
 const key=env('ESTABLISHMENT_BILLING_MAIN_API_KEY');if(!key)throw Error('PLAN_CHECKOUT_NOT_CONFIGURED');
 // A webhook is a notification, not proof of the latest state. Read the issuer.
 const current=await getAsaas('/payments/'+encodeURIComponent(c.provider_id),{...deps,env:n=>n==='ASAAS_API_KEY'?key:env(n)},main);
 // Deleted/restore events also reconcile against fresh provider evidence.
 const payment=validateMonthlyPayment({...current,deleted:false},c);
 if(current.deleted===true)payment.status='DELETED';
 await rpc('establishment_billing_result',{p_id:c.id,p_environment:c.environment,p_payment:payment});
 return 'processed';
}

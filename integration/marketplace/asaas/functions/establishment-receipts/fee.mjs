import {ASAAS_SANDBOX,requireSandbox} from '../_shared/asaas-accounts.mjs';

export async function openingFee(venue,partner,{env,rpc,fetch}){
  requireSandbox(env);
  const key=env('ASAAS_API_KEY');
  if(!key)throw Error('RECEIPT_CONFIGURATION_REQUIRED');
  const claim=await rpc('receipt_fee_claim',{p_partner:partner,p_venue_id:venue});
  async function request(path,body){
    const response=await fetch(ASAAS_SANDBOX+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{access_token:key,'Content-Type':'application/json','User-Agent':'TamoOn'},...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok)throw Error('RECEIPT_PROVIDER_REVIEW');
    return response.json();
  }
  let payment;
  if(claim.id)payment=await request('/payments/'+encodeURIComponent(claim.id));
  else {
    const list=await request('/payments?limit=2&externalReference='+encodeURIComponent(claim.reference));
    if(!Array.isArray(list.data)||list.hasMore!==false||list.data.length>1||list.totalCount!==list.data.length)throw Error('RECEIPT_PROVIDER_REVIEW');
    payment=list.data[0];
    if(!payment && claim.create) payment=await request('/payments',{customer:claim.customer,billingType:'PIX',value:claim.amount,dueDate:claim.due,
      description:'Abertura da subconta de recebimentos Tâmo On',externalReference:claim.reference,interest:{value:0},fine:{value:0}});
    if(!payment)throw Error('RECEIPT_PROVIDER_REVIEW');
  }
  if(payment.externalReference!==claim.reference)throw Error('RECEIPT_PROVIDER_REVIEW');
  await rpc('receipt_fee_result',{p_payment:payment});
  return {state:'fee'};
}

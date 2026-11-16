// Main-account receivables. Never use a subaccount key, split, or wallet debit.
function uniqueResult(response, duplicateCode) {
 if(!Array.isArray(response?.data))throw Error('PROVIDER_INVALID_LIST');
 // A truncated list cannot establish absence or uniqueness.
 if(response.hasMore===true||Number(response.totalCount||0)>response.data.length||response.data.length>1)throw Error(duplicateCode);
 return response.data[0];
}
const errorCode=error=>/^[A-Z_]+$/.test(error?.message||'')?error.message:'PROVIDER_RESULT_REQUIRES_REVIEW';
export async function runBilling({rpc,request,environment}) {
 if(!['sandbox','production'].includes(environment))throw Error('BILLING_ENVIRONMENT');
 const list=await rpc('establishment_billing_pending',{p_environment:environment});
 let reconciled=0,issued=0,review=0;
 for(const item of list||[]) {
  try{
  // Read current provider state, not an unordered webhook payload.
  const payment=item.provider_id?await request('GET','/payments/'+encodeURIComponent(item.provider_id)):
   uniqueResult(await request('GET','/payments?externalReference='+encodeURIComponent(item.reference)+'&limit=2'),'DUPLICATE_REFERENCE');
  if(!payment)throw Error('PROVIDER_RESULT_NOT_FOUND');
  await rpc('establishment_billing_result',{p_id:item.id,p_environment:environment,p_payment:payment});reconciled++;
  }catch(error){
   await rpc('establishment_billing_result',{p_id:item.id,p_environment:environment,p_payment:null,p_error:errorCode(error)});review++;
  }
  // An ambiguous POST remains in review. Zero search results do not prove it failed.
 }
 for(let n=0;n<20;n++){
  const item=await rpc('establishment_billing_claim',{p_environment:environment});if(!item)break;
  try{
   const payment=await issueInvoice(item,request);
   await rpc('establishment_billing_result',{p_id:item.id,p_environment:environment,p_payment:payment});issued++;
  }catch(error){
   // Do not persist provider response bodies or credentials.
   await rpc('establishment_billing_result',{p_id:item.id,p_environment:environment,p_payment:null,p_error:errorCode(error)});review++;
  }
 }
 return {issued,reconciled,review};
}

export async function issueInvoice(item,request){
   let payment=uniqueResult(await request('GET','/payments?externalReference='+encodeURIComponent(item.reference)+'&limit=2'),'DUPLICATE_REFERENCE');
   if(!payment){
    const tax=String(item.cpfCnpj||'').replace(/\D/g,'');
    if(![11,14].includes(tax.length)||!item.name)throw Error('PARTNER_BILLING_DATA_REQUIRED');
    const existingCustomer=uniqueResult(await request('GET','/customers?cpfCnpj='+encodeURIComponent(tax)+'&limit=2'),'CUSTOMER_REVIEW_REQUIRED');
    const customer=existingCustomer||await request('POST','/customers',{
     name:item.name,cpfCnpj:tax,email:item.email||undefined,externalReference:'tamoon-partner:'+item.partner_id,
     notificationDisabled:true
    });
    if(!customer.id)throw Error('CUSTOMER_ID_MISSING');
    payment=await request('POST','/payments',{customer:customer.id,billingType:'PIX',value:Number(item.amount),dueDate:item.due_on,
     description:('Mensalidade Tâmo On — '+item.venue+' — '+item.competence.slice(0,7)).slice(0,500),externalReference:item.reference,
     interest:{value:0},fine:{value:0}});
   }
 return payment;
}

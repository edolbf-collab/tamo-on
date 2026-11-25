import {ASAAS_SANDBOX,accountRegistry,uuid} from '../_shared/asaas-accounts.mjs';

export async function provision(venueId,{env,rpc,fetch:fetcher}) {
  const legacy=accountRegistry(env);
  const main=env('ASAAS_API_KEY'),token=env('ASAAS_SUBACCOUNT_WEBHOOK_TOKEN');
  const project=env('SUPABASE_URL'), mainId=env('ASAAS_MAIN_ACCOUNT_ID');
  const days=Number(env('ASAAS_ESCROW_DAYS'));
  if(!main || !uuid.test(mainId||'') || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(project||'') ||
    !token || token.length<32 || !Number.isInteger(days) || days<1 || days>45) throw Error('RECEIPT_CONFIGURATION_REQUIRED');
  async function request(path,key,body) {
    const response=await fetcher(ASAAS_SANDBOX+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(20000),
      headers:{'Content-Type':'application/json','User-Agent':'TamoOn',access_token:key},...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok) throw Error('RECEIPT_PROVIDER_REVIEW');
    return response.json();
  }
  const wallets=await request('/wallets/',main);
  const mainWallet=wallets.data?.find(w=>w.id===env('ESTABLISHMENT_BILLING_MAIN_WALLET_ID'))?.id ||
    (!wallets.hasMore && wallets.data?.length===1 && wallets.data[0].id);
  if(!uuid.test(mainWallet||'')) throw Error('RECEIPT_CONFIGURATION_REQUIRED');
  const claim=await rpc('receipt_provision_claim',{p_venue_id:venueId});
  if(claim.create){
    const existing=legacy.find(a=>a.partnerId===claim.partner&&a.active!==false);
    const created=existing?{id:existing.accountId,walletId:existing.walletId,apiKey:existing.apiKey}:
      await request('/accounts',main,{...claim.customer,webhooks:[{name:'Tâmo On',url:project.replace(/\/$/,'')+'/functions/v1/asaas-webhook',
        email:claim.customer.email,enabled:true,interrupted:false,sendType:'SEQUENTIALLY',authToken:token,apiVersion:3,
        events:['ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED','PAYMENT_RECEIVED','PAYMENT_CONFIRMED','PAYMENT_REFUNDED','PAYMENT_PARTIALLY_REFUNDED','PAYMENT_REFUND_IN_PROGRESS','CHECKOUT_PAID','CHECKOUT_CANCELED','CHECKOUT_EXPIRED']}]});
    if(!uuid.test(created.id)||!uuid.test(created.walletId)||!created.apiKey) throw Error('RECEIPT_PROVIDER_REVIEW');
    await rpc('receipt_account_store',{p_partner:claim.partner,p_account:created.id,p_wallet:created.walletId,p_key:created.apiKey,p_main_wallet:mainWallet,p_existing:Boolean(existing)});
  }
  const route=await rpc('receipt_account_route',{p_partner:claim.partner});
  if(!route) throw Error('RECEIPT_CREATION_IN_REVIEW');
  const child=await request('/accounts/'+route.accountId,main);
  if(child.id!==route.accountId||child.walletId!==route.walletId) throw Error('RECEIPT_ACCOUNT_MISMATCH');
  const status=await request('/myAccount/status/',route.apiKey);
  if(status.general!=='APPROVED') return {state:'activating',reason:'registration'};
  const path='/accounts/'+route.accountId+'/escrow';
  await request(path,main,{enabled:true,isFeePayer:true,daysToExpire:days});
  const escrow=await request(path,main);
  if(escrow.enabled!==true||escrow.isFeePayer!==true||escrow.daysToExpire!==days) throw Error('RECEIPT_ESCROW_UNCONFIRMED');
  const applied=await rpc('receipt_provision_finish',{p_venue_id:venueId,p_operation:claim.operation,p_account:route.accountId});
  return {state:applied?'on':'off'};
}

import {accountKey,accountRegistry,ASAAS_SANDBOX} from './asaas-accounts.mjs';
const cents=n=>{if(typeof n!=='number'||!Number.isFinite(n)||n<0||Math.abs(n*100-Math.round(n*100))>0.00001)throw Error('REFUND_BALANCE_INVALID');return Math.round(n*100);};
async function balance(deps,accountId){
 const response=await (deps.fetch||fetch)(ASAAS_SANDBOX+'/finance/balance',{
  method:'GET',redirect:'error',signal:AbortSignal.timeout(20000),
  headers:{access_token:accountKey(deps.env,accountId),'User-Agent':'TamoOn-Refund-Review'}});
 if(!response.ok)throw Error('REFUND_BALANCE_UNAVAILABLE');
 const result=await response.json();return cents(result.balance);
}
export async function checkRefundBalance(c,payload,deps){
 const total=cents(payload.value),commission=(payload.splitRefunds||[]).reduce((n,s)=>n+cents(s.value),0);
 if(commission>total)throw Error('REFUND_BALANCE_INVALID');
 if(commission>0){
  const issuer=c.route?.issuer_account_id;
  const route=accountRegistry(deps.env).find(a=>a.accountId===issuer);
  if(!issuer||!route||route.commissionWalletId!==c.route.split_wallet_id)throw Error('REFUND_SPLIT_MISMATCH');
 }
 const issuerBalance=await balance(deps,c.route?.issuer_account_id||null);
 const platformBalance=commission>0?await balance(deps,null):null;
 const result={checked_at:new Date().toISOString(),issuer_available:issuerBalance/100,issuer_required:(total-commission)/100,
  platform_available:platformBalance===null?null:platformBalance/100,platform_required:commission/100,
  sufficient:issuerBalance>=total-commission&&(platformBalance===null||platformBalance>=commission)};
 if(!result.sufficient){const error=Error('REFUND_INSUFFICIENT_BALANCE');error.balance=result;throw error;}
 return result;
}

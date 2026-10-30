export const ASAAS_SANDBOX='https://api-sandbox.asaas.com/v3';
export const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function requireSandbox(env){
  if(env('ASAAS_SANDBOX_ENABLED')!=='true'||env('MARKETPLACE_STAGING_SIMULATION')!=='false'
    ||(env('ASAAS_BASE_URL')||ASAAS_SANDBOX).replace(/\/$/,'')!==ASAAS_SANDBOX)throw new Error('ASAAS_SANDBOX_REQUIRED');
}
export function accountRegistry(env){
  requireSandbox(env);
  const raw=env('ASAAS_SANDBOX_ACCOUNTS');
  if(!raw)return [];
  let rows;try{rows=JSON.parse(raw);}catch{throw new Error('ASAAS_ACCOUNTS_INVALID');}
  if(!Array.isArray(rows)||rows.length>50)throw new Error('ASAAS_ACCOUNTS_INVALID');
  if(rows.length&&!uuid.test(env('ASAAS_MAIN_ACCOUNT_ID')||''))throw new Error('ASAAS_MAIN_ACCOUNT_REQUIRED');
  const accounts=new Set(),partners=new Set();
  for(const r of rows){
    if(!r||!uuid.test(r.partnerId)||!uuid.test(r.accountId)||!uuid.test(r.walletId)
      ||typeof r.apiKey!=='string'||r.apiKey.length<20||!uuid.test(r.commissionWalletId)
      ||r.walletId===r.commissionWalletId||accounts.has(r.accountId)||(r.active!==false&&partners.has(r.partnerId)))throw new Error('ASAAS_ACCOUNTS_INVALID');
    accounts.add(r.accountId);if(r.active!==false)partners.add(r.partnerId);
  }
  return rows;
}
export function partnerAccount(env,partnerId){
  if(env('ASAAS_SPLIT_ENABLED')!=='true')return null;
  const row=accountRegistry(env).find(r=>r.partnerId===partnerId&&r.active!==false);
  if(!row)throw new Error('ASAAS_PARTNER_ACCOUNT_REQUIRED');
  if(!uuid.test(env('ASAAS_MAIN_ACCOUNT_ID')||''))throw new Error('ASAAS_MAIN_ACCOUNT_REQUIRED');
  return row;
}
export function accountKey(env,accountId=null){
  requireSandbox(env);
  if(accountId&&accountId!==env('ASAAS_MAIN_ACCOUNT_ID')){
    const row=accountRegistry(env).find(r=>r.accountId===accountId);
    if(!row)throw new Error('ASAAS_ISSUER_KEY_REQUIRED');
    return row.apiKey;
  }
  const key=env('ASAAS_API_KEY');if(!key)throw new Error('ASAAS_NOT_CONFIGURED');return key;
}
export function forAccount(deps,accountId){
  const key=accountKey(deps.env,accountId);
  // Existing PIX diagnostic adapters receive the correct issuer key too.
  return {...deps,accountId,env:name=>name==='ASAAS_API_KEY'?key:deps.env(name)};
}
export async function getAsaas(path,deps,accountId=null){
  if(!/^\/(payments\/pay_[A-Za-z0-9_-]+|accounts\/[0-9a-f-]{36}|wallets\/?)(\?.*)?$/.test(path))throw new Error('ASAAS_RESOURCE_INVALID');
  const r=await (deps.fetch||fetch)(ASAAS_SANDBOX+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{access_token:accountKey(deps.env,accountId),'User-Agent':'TamoOn-Sandbox-22BB-C17'}});
  if(!r.ok)throw new Error(`ASAAS_LOOKUP_HTTP_${r.status}`);
  const data=await r.json();if(!data||typeof data!=='object')throw new Error('ASAAS_INVALID_RESPONSE');return data;
}
export async function verifyPartnerAccount(row,deps){
  const child=await getAsaas('/accounts/'+row.accountId,deps);
  if(child.id!==row.accountId||child.walletId!==row.walletId)throw new Error('ASAAS_PARTNER_ACCOUNT_MISMATCH');
  const wallets=await getAsaas('/wallets/',deps,row.accountId);
  if(!Array.isArray(wallets.data)||!wallets.data.some(x=>x.id===row.walletId))throw new Error('ASAAS_PARTNER_KEY_MISMATCH');
  const main=await getAsaas('/wallets/',deps);
  if(!Array.isArray(main.data)||!main.data.some(x=>x.id===row.commissionWalletId))throw new Error('ASAAS_COMMISSION_WALLET_MISMATCH');
}
export function publicAccount(row){return row?{partner_id:row.partnerId,issuer_account_id:row.accountId,issuer_wallet_id:row.walletId,split_wallet_id:row.commissionWalletId}:null;}

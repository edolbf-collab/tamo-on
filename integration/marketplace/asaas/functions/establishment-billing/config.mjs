const sandbox='https://api-sandbox.asaas.com/v3';
const uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
// Only the existing MAIN Sandbox credentials may issue platform receivables.
export function monthlyEnvironment(env){
 if(env('ESTABLISHMENT_CHECKOUT_ENABLED')!==undefined)return env;
 if(env('ASAAS_SANDBOX_ENABLED')!=='true'||env('MARKETPLACE_STAGING_SIMULATION')!=='false')return env;
 if((env('ASAAS_BASE_URL')||sandbox).replace(/\/$/,'')!==sandbox)throw Error('PLAN_CHECKOUT_SANDBOX_ONLY');
 if(!env('ASAAS_API_KEY')||!uuid.test(env('ASAAS_MAIN_ACCOUNT_ID')||''))throw Error('PLAN_CHECKOUT_NOT_CONFIGURED');
 let rows;try{rows=JSON.parse(env('ASAAS_SANDBOX_ACCOUNTS')||'[]');}catch{throw Error('PLAN_CHECKOUT_NOT_CONFIGURED');}
 if(!Array.isArray(rows)||!rows.length||rows.some(r=>!uuid.test(r.commissionWalletId||'')||r.commissionWalletId===r.walletId))throw Error('PLAN_ISSUER_MISMATCH');
 const wallets=[...new Set(rows.map(r=>r.commissionWalletId))];
 if(wallets.length!==1)throw Error('PLAN_ISSUER_MISMATCH');
 const configured={ESTABLISHMENT_CHECKOUT_ENABLED:'true',ESTABLISHMENT_BILLING_ENABLED:'true',
  ESTABLISHMENT_BILLING_ENVIRONMENT:'sandbox',ESTABLISHMENT_BILLING_MAIN_API_KEY:env('ASAAS_API_KEY'),
  ESTABLISHMENT_BILLING_MAIN_WALLET_ID:wallets[0]};
 return name=>env(name)??configured[name];
}
export function sameSecret(a,b){if(!a||!b||a.length!==b.length)return false;let diff=0;for(let n=0;n<a.length;n++)diff|=a.charCodeAt(n)^b.charCodeAt(n);return diff===0;}

// Use the legal identity of the explicitly bound Sandbox subaccount. Never infer
// a partner from an email/CNPJ match or expose the subaccount API key.
export async function monthlyPartner(item,request,env){
 if(env('ESTABLISHMENT_BILLING_ENVIRONMENT')!=='sandbox'||!env('ASAAS_SANDBOX_ACCOUNTS'))return item;
 let rows;try{rows=JSON.parse(env('ASAAS_SANDBOX_ACCOUNTS'));}catch{throw Error('PLAN_PAYER_MISMATCH');}
 if(!Array.isArray(rows))throw Error('PLAN_PAYER_MISMATCH');
 const matches=rows.filter(r=>r.partnerId===item.partner_id&&r.active!==false);
 if(!matches.length)return item;
 if(matches.length!==1||!uuid.test(matches[0].accountId||'')||!uuid.test(matches[0].walletId||''))throw Error('PLAN_PAYER_MISMATCH');
 const row=matches[0],account=await request('GET','/accounts/'+row.accountId);
 if(account.id!==row.accountId||account.walletId!==row.walletId||account.walletId===env('ESTABLISHMENT_BILLING_MAIN_WALLET_ID'))throw Error('PLAN_PAYER_MISMATCH');
 const name=account.companyName||account.name,cpfCnpj=String(account.cpfCnpj||'').replace(/\D/g,'');
 if(!name||![11,14].includes(cpfCnpj.length))throw Error('PARTNER_BILLING_DATA_REQUIRED');
 return {...item,name,cpfCnpj,email:account.email||item.email};
}

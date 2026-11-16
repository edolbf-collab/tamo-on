import {createClient} from 'npm:@supabase/supabase-js@2.110.7';
import {runBilling,issueInvoice} from './core.mjs';
import {monthlyEnvironment,sameSecret} from './config.mjs';
import {validateMonthlyQr} from '../establishment-checkout/core.mjs';
Deno.serve(async(req)=>{
 if(req.method!=='POST')return Response.json({error:'METHOD_NOT_ALLOWED'},{status:405});
 const dedicated=Deno.env.get('ESTABLISHMENT_BILLING_JOB_SECRET');
 const token=req.headers.get(dedicated?'x-billing-job-secret':'x-marketplace-cron-secret')||'';
 if(!sameSecret(token,dedicated||Deno.env.get('MARKETPLACE_MONTHLY_CRON_SECRET')||''))return Response.json({error:'INVALID_CRON_SECRET'},{status:401});
 try{
  const env=monthlyEnvironment((name:string)=>Deno.env.get(name));
  if(env('ESTABLISHMENT_CHECKOUT_ENABLED')!=='true')return Response.json({error:'PLAN_CHECKOUT_NOT_CONFIGURED'},{status:503});
  if(env('ESTABLISHMENT_BILLING_ENVIRONMENT')!=='sandbox')throw Error('PLAN_CHECKOUT_SANDBOX_ONLY');
  const key=env('ESTABLISHMENT_BILLING_MAIN_API_KEY'),wallet=env('ESTABLISHMENT_BILLING_MAIN_WALLET_ID');
  if(!key||!wallet)throw Error('PLAN_CHECKOUT_NOT_CONFIGURED');
  const request=async(method:string,path:string,body?:unknown)=>{
   const r=await fetch('https://api-sandbox.asaas.com/v3'+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{access_token:key,'Content-Type':'application/json','User-Agent':'TamoOn-Monthly-Sandbox'},body:body?JSON.stringify(body):undefined});
   if(!r.ok)throw Error(r.status===401||r.status===403?'PLAN_PROVIDER_AUTH':'PLAN_PROVIDER_UNAVAILABLE');return r.json();
  };
  const wallets=await request('GET','/wallets');
  if(!wallets.data?.some((w:{id:string})=>w.id===wallet))throw Error('PLAN_ISSUER_MISMATCH');
  const body=await req.json();
  if(body.action==='inspect'){
   const keys=await request('GET','/pix/addressKeys?limit=100');
   let partner=null;
   if(body.partnerId){
    const rows=JSON.parse(env('ASAAS_SANDBOX_ACCOUNTS')||'[]').filter((r:{partnerId:string,active:boolean})=>r.partnerId===body.partnerId&&r.active!==false);
    if(rows.length!==1)throw Error('PLAN_PAYER_MISMATCH');
    const account=await request('GET','/accounts/'+encodeURIComponent(rows[0].accountId));
    if(account.id!==rows[0].accountId||account.walletId!==rows[0].walletId)throw Error('PLAN_PAYER_MISMATCH');
    partner={linked:true,name:account.companyName||account.name,cpfCnpjPresent:!!account.cpfCnpj,documentDigits:String(account.cpfCnpj||'').replace(/\D/g,'').length};
   }
   return Response.json({ok:true,environment:'sandbox',mainWallet:wallet,pixKeys:keys.data?.length||0,partner,activePixKeys:keys.data?.filter((k:{status:string})=>k.status==='ACTIVE').length||0});
  }
  const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await client.rpc(name,args);if(error)throw Error(error.message);return data;};
  if(body.action==='issue'){
   const item=await rpc('establishment_invoice_issue_claim',{p_id:body.invoiceId,p_environment:'sandbox'});
   if(!item)return Response.json({claimed:false});
   try{
    const p=await issueInvoice(item,request,env);await rpc('establishment_billing_result',{p_id:item.id,p_environment:'sandbox',p_payment:p});
    const qr=validateMonthlyQr(await request('GET','/payments/'+encodeURIComponent(p.id)+'/pixQrCode'));
    return Response.json({issued:true,paymentId:p.id,status:p.status,qrReady:true,payloadLength:qr.payload.length,imageLength:qr.encodedImage.length});
   }catch(error){await rpc('establishment_billing_result',{p_id:item.id,p_environment:'sandbox',p_payment:null,p_error:'PROVIDER_RESULT_REQUIRES_REVIEW'});throw error;}
  }
  if(body.action&&body.action!=='run')throw Error('PLAN_INVALID_REQUEST');
  if(env('ESTABLISHMENT_BILLING_ENABLED')!=='true')return Response.json({enabled:false});
  return Response.json(await runBilling({environment:'sandbox',rpc,request,env}));
 }catch(error){const code=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'PLAN_PROVIDER_UNAVAILABLE';return Response.json({error:code},{status:502});}
});

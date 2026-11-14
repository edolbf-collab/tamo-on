import {createClient} from 'npm:@supabase/supabase-js@2.110.7';
import {runBilling} from './core.mjs';
// Deployment is deliberately disabled until the issuer and the calendar are validated.
Deno.serve(async(req)=>{
 const secret=Deno.env.get('ESTABLISHMENT_BILLING_JOB_SECRET');
 if(req.method!=='POST'||!secret||req.headers.get('x-billing-job-secret')!==secret)return new Response('Unauthorized',{status:401});
 if(Deno.env.get('ESTABLISHMENT_BILLING_ENABLED')!=='true')return Response.json({enabled:false});
 const environment=Deno.env.get('ESTABLISHMENT_BILLING_ENVIRONMENT');
 if(!['sandbox','production'].includes(environment||''))return Response.json({error:'BILLING_ENVIRONMENT'},{status:503});
 const key=Deno.env.get('ESTABLISHMENT_BILLING_MAIN_API_KEY');
 const wallet=Deno.env.get('ESTABLISHMENT_BILLING_MAIN_WALLET_ID');
 if(!key||!wallet)return Response.json({error:'MAIN_ISSUER_NOT_CONFIGURED'},{status:503});
 const base=environment==='production'?'https://api.asaas.com/v3':'https://api-sandbox.asaas.com/v3';
 const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 try{
  const check=await fetch(base+'/wallets',{headers:{access_token:key,'User-Agent':'TamoOn-EstablishmentBilling'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!check.ok||!(await check.json()).data?.some((w:{id:string})=>w.id===wallet))return Response.json({error:'MAIN_ISSUER_MISMATCH'},{status:503});
  const result=await runBilling({environment,rpc:async(name:string,args:unknown)=>{
   const {data,error}=await client.rpc(name,args);if(error)throw Error('BILLING_DATABASE_ERROR');return data;
  },request:async(method:string,path:string,body:unknown)=>{
   const res=await fetch(base+path,{method,redirect:'error',headers:{access_token:key,'Content-Type':'application/json','User-Agent':'TamoOn-EstablishmentBilling'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
   if(!res.ok)throw Error('ASAAS_REQUEST_FAILED');return res.json();
  }});
  return Response.json(result);
 }catch{return Response.json({error:'BILLING_RUN_FAILED'},{status:502});}
});

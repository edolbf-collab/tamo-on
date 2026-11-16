import {createClient} from 'npm:@supabase/supabase-js@2.110.7';
import {monthlyCheckout} from './core.mjs';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:cors});
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({error:'PLAN_INVALID_REQUEST'},405);
 try{
  const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const user=createClient(url,anon,{global:{headers:{Authorization:req.headers.get('Authorization')||''}},auth:{persistSession:false}});
  const {data,error}=await user.auth.getUser();if(error||!data.user)return reply({error:'PLAN_SESSION_REQUIRED'},401);
  const admin=createClient(url,secret,{auth:{persistSession:false}});
  const rpc=(client:typeof user)=>async(name:string,args:Record<string,unknown>)=>{const {data,error}=await client.rpc(name,args);if(error)throw Error(error.message);return data;};
  const body=await req.json();
  return reply(await monthlyCheckout(body,{userRpc:rpc(user),adminRpc:rpc(admin),env:(name:string)=>Deno.env.get(name),
   request:async(key:string,method:string,path:string,body:unknown)=>{
    const response=await fetch('https://api-sandbox.asaas.com/v3'+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{access_token:key,'Content-Type':'application/json','User-Agent':'TamoOn-Monthly-Sandbox'},body:body?JSON.stringify(body):undefined});
    if(!response.ok)throw Error('PLAN_PROVIDER_UNAVAILABLE');return response.json();
   }}));
 }catch(e){const code=e instanceof Error&&/^PLAN_[A-Z_]+$/.test(e.message)?e.message:'PLAN_CHECKOUT_UNAVAILABLE';return reply({error:code},409);}
});

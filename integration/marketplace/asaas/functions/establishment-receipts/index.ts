import {corsHeaders,jsonResponse} from '../_shared/cors.ts';
import {adminClient,requireUser} from '../_shared/supabase.ts';
import {openingFee} from './fee.mjs';
import {provision} from './provision.mjs';

Deno.serve(async req => {
  if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST') return jsonResponse({error:'METHOD_NOT_ALLOWED'},405);
  try {
    const {client}=await requireUser(req);
    const {venueId,action}=await req.json();
    const admin=adminClient();
    const rpc=async(name:string,args:Record<string,unknown>)=>{
      const {data,error}=await admin.rpc(name,args);
      if(error) throw new Error('RECEIPT_STATE_CHANGED');
      return data;
    };
    if(action==='fee'){
      const {data:partner,error}=await client.rpc('receipt_fee_authorize',{p_venue_id:venueId});
      if(error)return jsonResponse({error:'RECEIPT_APPROVAL_DENIED'},403);
      return jsonResponse(await openingFee(venueId,partner,{env:(key:string)=>Deno.env.get(key),rpc,fetch}));
    }
    const {error}=await client.rpc('establishment_receipt_change',{p_venue_id:venueId,p_action:'approve'});
    if(error)return jsonResponse({error:'RECEIPT_APPROVAL_DENIED'},403);
    return jsonResponse(await provision(venueId,{env:(key:string)=>Deno.env.get(key),rpc,fetch}));
  } catch(e) {
    const code=String((e as Error).message);
    return jsonResponse({error:/^(RECEIPT_[A-Z_]+|UNAUTHORIZED)$/.test(code)?code:'RECEIPT_PROVIDER_UNAVAILABLE'},code==='UNAUTHORIZED'?401:409);
  }
});

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { adminClient, requireUser } from '../_shared/supabase.ts';
import { refundOperation } from '../_shared/asaas-refund.mjs';
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST') return jsonResponse({error:'METHOD_NOT_ALLOWED'},405);
  try {
    const {user}=await requireUser(req);
    const body=await req.json();
    return jsonResponse(await refundOperation(body,user.id,adminClient(),{env:(name:string)=>Deno.env.get(name)}));
  } catch(error) {
    const raw=String((error as Error)?.message||'');
    const code=/^(REFUND_[A-Z0-9_]+|UNAUTHORIZED|PARTNER_PREVIEW_READ_ONLY)$/.test(raw)?raw:'REFUND_UNAVAILABLE';
    return jsonResponse({error:code},code==='UNAUTHORIZED'?401:code==='REFUND_FORBIDDEN'?403:400);
  }
});

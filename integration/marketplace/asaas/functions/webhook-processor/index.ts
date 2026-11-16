import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { adminClient, requireUser } from '../_shared/supabase.ts';
import { processWebhookEvent } from '../_shared/webhook-processing.ts';

Deno.serve(async (req) => {
  if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders});
  try{
    const {user}=await requireUser(req);
    const admin=adminClient();
    const {data:adminMembership}=await admin.from('platform_admins').select('profile_id').eq('profile_id',user.id).maybeSingle();
    if(!adminMembership) return jsonResponse({error:'FORBIDDEN'},403);
    const body=req.method==='POST' ? await req.json().catch(()=>({})) : {};
    const limit=Math.min(Math.max(Number(body?.limit||25),1),100);
    const {data:events,error}=await admin.from('webhook_events').select('*').in('status',['pending','failed']).order('received_at').limit(limit);
    if(error) throw error;
    const results=[];
    for(const event of events||[]) results.push({id:event.id,provider:event.provider,eventId:event.provider_event_id,...await processWebhookEvent(admin,event)});
    return jsonResponse({processed:results.length,results});
  }catch(error){
    return jsonResponse({error:String((error as any)?.message||error)},401);
  }
});


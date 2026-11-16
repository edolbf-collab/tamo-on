import {accountRegistry} from '../_shared/asaas-accounts.mjs';
export async function handleAsaasWebhook(req, {env, adminClient, processWebhookEvent, jsonResponse, corsHeaders}) {
  if (req.method === 'OPTIONS') return new Response('ok',{headers:corsHeaders});
  if (req.method !== 'POST') return jsonResponse({received:false},405);
  let payload;
  try { payload=await req.json(); } catch { return jsonResponse({received:false,error:'INVALID_JSON'},400); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || typeof payload.id !== 'string' || !payload.id || typeof payload.event !== 'string' || !payload.event) {
    return jsonResponse({received:false,error:'EVENT_ID_AND_TYPE_REQUIRED'},400);
  }
  let subaccount=false;
  try{subaccount=accountRegistry(env).some(a=>a.accountId===payload.account?.id);}catch{return jsonResponse({received:false,error:'WEBHOOK_CONFIG_INVALID'},503);}
  const expected=env(subaccount?'ASAAS_SUBACCOUNT_WEBHOOK_TOKEN':'ASAAS_WEBHOOK_TOKEN');
  if(!expected||expected.length<32)return jsonResponse({received:false,error:'WEBHOOK_TOKEN_NOT_CONFIGURED'},503);
  if(req.headers.get('asaas-access-token')!==expected)return jsonResponse({received:false,error:'INVALID_WEBHOOK_TOKEN'},401);
  try {
    const admin=adminClient();
    // The first durable payload wins. Duplicate deliveries never rewrite history.
    const {error:saveError}=await admin.from('webhook_events').upsert({provider:'asaas',provider_event_id:payload.id,
      event_type:payload.event,payload,status:'pending',attempts:1},
      {onConflict:'provider,provider_event_id',ignoreDuplicates:true});
    if (saveError) throw saveError;
    const {data:event,error:readError}=await admin.from('webhook_events').select('*')
      .eq('provider','asaas').eq('provider_event_id',payload.id).single();
    if (readError || !event) throw readError || new Error('EVENT_NOT_PERSISTED');
    if (['processed','ignored'].includes(event.status)) return jsonResponse({received:true,duplicate:true});
    // Sandbox keeps inline processing enabled. Return 503 on failure so Asaas retries;
    // the persisted queue is also available to the existing admin processor.
    const result=await processWebhookEvent(admin,event);
    if (result.status==='failed') return jsonResponse({received:true,queued:true,error:'PROCESSING_PENDING'},503);
    return jsonResponse({received:true,processed:result.status==='processed',ignored:result.status==='ignored'});
  } catch {
    return jsonResponse({received:false,error:'WEBHOOK_RETRY_REQUIRED'},503);
  }
}

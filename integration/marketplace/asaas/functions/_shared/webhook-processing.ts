import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.110.7';
import { processAsaasEvent } from './asaas-event-processing.mjs';

export async function processWebhookEvent(admin: SupabaseClient, event: any) {
  const payload = event.payload || {};
  try {
    if (event.provider === 'asaas') {
      const status=await processAsaasEvent(admin,event,{env:(name:string)=>Deno.env.get(name)});
      await updateEvent(admin,event.id,{status,processed_at:new Date().toISOString(),last_error:null});
      return {status};
    } else if (['sicoob','sicredi','bb','inter','generic_manual'].includes(event.provider)) {
      const n = payload.normalized || payload;
      const txid = String(n.txid || '');
      const amount = Number(n.amount || n.valor || 0);
      const e2eid = String(n.endToEndId || n.e2eid || event.provider_event_id);
      if (!txid || !(amount > 0)) throw new Error('PIX_NORMALIZED_DATA_REQUIRED');
      const { error } = await admin.rpc('apply_pix_installment_payment', {
        p_txid: txid,
        p_amount: amount,
        p_end_to_end_id: e2eid,
        p_provider: event.provider,
        p_metadata: payload,
      });
      if (error) throw error;
    } else {
      await updateEvent(admin,event.id,{ status: 'ignored', processed_at: new Date().toISOString(), last_error: null });
      return { status: 'ignored' };
    }

    await updateEvent(admin,event.id,{ status: 'processed', processed_at: new Date().toISOString(), last_error: null });
    return { status: 'processed' };
  } catch (error) {
    await updateEvent(admin,event.id,{ status: 'failed', last_error: String((error as any)?.message || error) });
    return { status: 'failed', error: String((error as any)?.message || error) };
  }
}

async function updateEvent(admin: SupabaseClient, id: string, values: any) {
  // Concurrent deliveries may finish in either order. A failed attempt cannot
  // regress an already processed event. SQL payment application is idempotent.
  const {error} = await admin.from('webhook_events').update(values).eq('id',id)
    .neq('status','processed').neq('status','ignored');
  if (error) throw error;
}

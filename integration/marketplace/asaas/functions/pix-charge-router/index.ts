import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { adminClient, requireUser } from '../_shared/supabase.ts';
import { openAsaasCheckout } from '../_shared/asaas-checkout.ts';
import { openInlinePix } from '../_shared/asaas-inline-pix.mjs';

type PixProvider = 'sicoob' | 'sicredi' | 'bb' | 'inter' | 'generic_manual';

function stagingSimulation() {
  return (Deno.env.get('MARKETPLACE_STAGING_SIMULATION') || 'false').toLowerCase() === 'true';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const { user } = await requireUser(req);
    const { reservationId, retryToken = null, payer = null } = await req.json();
    if (!reservationId) return jsonResponse({ error: 'reservationId obrigatório' }, 400);
    if (Deno.env.get('ASAAS_SANDBOX_ENABLED') === 'true' && Deno.env.get('MARKETPLACE_STAGING_SIMULATION') === 'true') return jsonResponse({error:'ASAAS_MODE_CONFLICT'},409);
    const admin = adminClient();

    const { data: reservation } = await admin.from('reservations')
      .select('id,user_id,partner_id,payment_method,payment_provider,payment_responsible_id,split_pix,status,monthly_cycle_id,payment_configured_at,payment_expires_at')
      .eq('id', reservationId).maybeSingle();
    if (!reservation) return jsonResponse({ error: 'RESERVATION_NOT_FOUND' }, 404);
    if (!reservation.payment_configured_at || !reservation.payment_method) return jsonResponse({ error: 'PAYMENT_NOT_CONFIGURED' }, 409);
    if (!reservation.monthly_cycle_id && reservation.payment_expires_at && new Date(reservation.payment_expires_at).getTime() <= Date.now()) return jsonResponse({ error:'PAYMENT_WINDOW_EXPIRED' },409);
    const { data: intent } = await admin.from('payment_intents').select('*')
      .eq('reservation_id',reservation.id).in('status',['created','pending'])
      .order('created_at',{ascending:true}).limit(1).maybeSingle();
    if (!intent) return jsonResponse({ error:'PAYMENT_INTENT_NOT_FOUND' },404);
    const { data: monthlyStage } = intent.monthly_payment_stage_id
      ? await admin.from('monthly_payment_stages').select('*').eq('id',intent.monthly_payment_stage_id).maybeSingle()
      : { data:null };
    if (monthlyStage && (['expired','cancelled'].includes(monthlyStage.status) || new Date(monthlyStage.due_at).getTime() <= Date.now())) return jsonResponse({ error:'MONTHLY_STAGE_EXPIRED' },409);
    let participantQuery=admin.from('reservation_participants').select('id')
      .eq('reservation_id', reservation.id).eq('profile_id', user.id);
    if(intent.monthly_payment_stage_id) participantQuery=participantQuery.eq('monthly_payment_stage_id',intent.monthly_payment_stage_id);
    else participantQuery=participantQuery.is('monthly_payment_stage_id',null);
    const { data: ownParticipants }=await participantQuery;
    const ownParticipant=ownParticipants?.[0] || null;
    if (reservation.payment_method !== 'pix_direct_partner') return jsonResponse({ error: 'NOT_PIX_DIRECT' }, 409);
    if (reservation.status !== 'pending_payment') return jsonResponse({ error: 'RESERVATION_NOT_PENDING' }, 409);
    if ((reservation.split_pix || intent.monthly_payment_stage_id) && !ownParticipant) return jsonResponse({ error: 'ONLY_SHARE_OWNER_CAN_PAY' }, 403);
    if (!reservation.split_pix && !intent.monthly_payment_stage_id && (reservation.payment_responsible_id || reservation.user_id) !== user.id) return jsonResponse({ error: 'ONLY_PAYMENT_RESPONSIBLE_CAN_PAY' }, 403);

    if (!stagingSimulation()) return await openInlinePix(admin, reservation.id, user.id, {env:(name:string)=>Deno.env.get(name),fetchImpl:fetch,jsonResponse,legacyCheckout:()=>openAsaasCheckout(admin,reservation.id,user.id,retryToken)}, retryToken, payer);

    const provider = String(reservation.payment_provider || 'generic_manual') as PixProvider;
    const { data: bank } = await admin.from('partner_bank_connections').select('*')
      .eq('partner_id', reservation.partner_id).eq('is_primary', true).maybeSingle();
    let installmentQuery = admin.from('pix_installments').select('*').eq('reservation_id', reservation.id).in('status',['pending','generated']).order('created_at');
    if (intent.monthly_payment_stage_id) installmentQuery=installmentQuery
      .eq('monthly_payment_stage_id',intent.monthly_payment_stage_id).eq('participant_id',ownParticipant.id);
    else if (reservation.split_pix) installmentQuery = installmentQuery.eq('participant_id', ownParticipant.id);
    else installmentQuery = installmentQuery.is('participant_id',null);
    const { data: installments } = await installmentQuery;

    if (!installments?.length) return jsonResponse({ error: 'PIX_INSTALLMENTS_NOT_FOUND' }, 409);

    if (stagingSimulation()) {
      const generated = [];
      for (const item of installments) {
        // Não é um BR Code pagável. Serve apenas para testar o fluxo e a conciliação.
        const simulationReference = `PIX-STAGING:${provider}:${item.txid}:${Number(item.amount_due).toFixed(2)}`;
        const { error: updateError } = await admin.from('pix_installments').update({
          status: 'generated',
          qr_code_text: simulationReference,
          qr_code_image_url: null,
        }).eq('id', item.id).in('status',['pending','generated']);
        if(updateError) throw updateError;
        generated.push({ id: item.id, txid: item.txid, amount: item.amount_due, provider, simulationReference, payable: false });
      }
      return jsonResponse({ mode: 'staging_simulation', provider,
        monthlyStage:monthlyStage ? {id:monthlyStage.id,stage:monthlyStage.stage,amount:monthlyStage.amount_required,
          earlyPaymentAllowed:true,dueAt:monthlyStage.due_at}:null,
        bank: null, installments: generated });
    }

    // Contrato já definido; chamadas reais entram após homologação/credenciais de cada instituição.
    if (!bank || bank.integration_status !== 'connected' || !bank.automatic_reconciliation) {
      return jsonResponse({
        error: 'BANK_API_NOT_CONNECTED',
        provider,
        message: 'Conta do parceiro ainda não está homologada para geração automática de Pix.',
      }, 422);
    }

    return jsonResponse({
      error: 'PROVIDER_ADAPTER_NOT_HOMOLOGATED',
      provider,
      message: `O adaptador ${provider} está estruturalmente preparado, mas a chamada bancária real só será ativada após homologação.`
    }, 501);
  } catch (error) {
    return jsonResponse({ error: String(error?.message || error) }, 401);
  }
});

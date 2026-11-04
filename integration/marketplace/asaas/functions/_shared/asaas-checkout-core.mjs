import {accountRegistry, accountKey, publicAccount, verifyPartnerAccount} from './asaas-accounts.mjs';
const SANDBOX = 'https://api-sandbox.asaas.com/v3';

export function asaasCheckoutPayload(context, callbacks, at = Date.now()) {
  const amount = Number(context.amount);
  if (!['PIX','CREDIT_CARD'].includes(context.billing_type) || !Number.isFinite(amount) || amount <= 0
      || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001
      || !context.external_reference || !(context.installment_id || context.intent_id)) {
    throw new Error('INVALID_CHECKOUT_CONTEXT');
  }
  // Reserve 30 seconds for transport; never extend the reservation deadline.
  const remaining = Math.floor((Date.parse(context.due_at) - at - 30000) / 60000);
  if (!Number.isFinite(remaining) || remaining < 10) throw new Error('CHECKOUT_MINIMUM_WINDOW');
  return {
    billingTypes: [context.billing_type], chargeTypes: ['DETACHED'], minutesToExpire: Math.min(remaining, 30),
    externalReference: context.external_reference, callback: callbacks,
    ...(context.issuer_account_id && Number(context.split_commission_amount)>0 ? {splits:[{walletId:context.split_wallet_id,fixedValue:Number(context.split_commission_amount)}]}:{}),
    items: [{ externalReference: context.installment_id || context.intent_id,
      name: `${context.participant_id ? 'Cota da reserva' : 'Reserva'} ${context.reservation_code}`,
      description: 'Tâmo On - teste Sandbox', quantity: 1, value: amount }],
  };
}

export function sandboxCheckoutUrl(result) {
  if (typeof result?.id !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(result.id)) throw new Error('ASAAS_INCOMPLETE_RESPONSE');
  const fallback = `https://sandbox.asaas.com/checkoutSession/show?id=${encodeURIComponent(result.id)}`;
  if (!result.link) return fallback;
  let url; try { url = new URL(result.link); } catch { throw new Error('ASAAS_INCOMPLETE_RESPONSE'); }
  if (url.protocol !== 'https:' || url.hostname !== 'sandbox.asaas.com' || url.port || url.username || url.password) throw new Error('ASAAS_INCOMPLETE_RESPONSE');
  if (!(url.pathname === '/checkoutSession/show' && url.searchParams.get('id') === result.id)
      && url.pathname !== `/checkoutSession/show/${result.id}`
      && url.pathname !== `/000/checkoutSession/show/${result.id}`) throw new Error('ASAAS_INCOMPLETE_RESPONSE');
  return url.href;
}

export function sandboxConfig(env) {
  if (env('ASAAS_SANDBOX_ENABLED') !== 'true') throw new Error('ASAAS_SANDBOX_DISABLED');
  if (env('MARKETPLACE_STAGING_SIMULATION') !== 'false') throw new Error('ASAAS_MODE_CONFLICT');
  if ((env('ASAAS_BASE_URL') || SANDBOX).replace(/\/$/, '') !== SANDBOX) throw new Error('PRODUCTION_PAYMENTS_DISABLED');
  const apiKey=env('ASAAS_API_KEY');
  const callbacks={successUrl:env('ASAAS_SUCCESS_URL'),cancelUrl:env('ASAAS_CANCEL_URL'),expiredUrl:env('ASAAS_EXPIRED_URL')};
  if (!apiKey || Object.values(callbacks).some(value=>!value)) throw new Error('ASAAS_NOT_CONFIGURED');
  for (const value of Object.values(callbacks)) {
    let url; try { url=new URL(value); } catch { throw new Error('ASAAS_NOT_CONFIGURED'); }
    const loopback=url.protocol==='http:' && ['127.0.0.1','localhost'].includes(url.hostname);
    if ((!loopback && url.protocol!=='https:') || url.username || url.password) throw new Error('ASAAS_NOT_CONFIGURED');
  }
  return {apiKey,callbacks};
}

export function definitiveCheckoutRejection(status,result) {
  return [400,401,403,404,422].includes(status) && !result?.id && !result?.link
    && Array.isArray(result?.errors) && result.errors.length>0
    && result.errors.every(e=>typeof e?.code==='string' && /^[a-z_]{1,80}$/.test(e.code)
      && typeof e?.description==='string' && e.description.trim().length>0);
}

export async function openSandboxCheckout(admin,reservationId,profileId,{env,fetchImpl=fetch,jsonResponse,checkoutDiagnostic,reportCheckoutDiagnostic,now=Date.now},retryToken=null) {
  if(retryToken!==null && (typeof retryToken!=='string'||! /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(retryToken)))
    return jsonResponse({error:'CHECKOUT_RETRY_INVALID'},400);
  let config;try {config=sandboxConfig(env);} catch(error){return jsonResponse({error:error.message},503);}
  const {data:r,error:reservationError}=await admin.from('reservations')
    .select('partner_id,booking_mode,monthly_cycle_id,split_pix,payment_method,payment_expires_at').eq('id',reservationId).single();
  if(reservationError)throw reservationError;
  if(!r || r.booking_mode!=='single' || r.monthly_cycle_id || !['pix_direct_partner','credit_card_asaas'].includes(r.payment_method)
      || (r.payment_method==='credit_card_asaas' && r.split_pix))return jsonResponse({error:'ASAAS_CHECKOUT_SCOPE'},409);
  const useSplit=env('ASAAS_SPLIT_ENABLED')==='true';
  let partner=null;
  try{
    partner=useSplit?accountRegistry(env).find(x=>x.partnerId===r.partner_id&&x.active!==false):null;
    if(partner)await verifyPartnerAccount(partner,{env,fetch:fetchImpl});
  }catch(error){return jsonResponse({error:error.message},503);}
  const {data:context,error}=await admin.rpc('claim_asaas_checkout_attempt',{p_reservation_id:reservationId,p_profile_id:profileId,
    p_routing:publicAccount(partner),p_require_split:useSplit,p_retry_token:retryToken});
  if(error){
    if(error.message==='ASAAS_PARTNER_ACCOUNT_REQUIRED')return jsonResponse({error:'ASAAS_PARTNER_ACCOUNT_REQUIRED'},409);
    if(['CHECKOUT_MINIMUM_WINDOW','CHECKOUT_RETRY_STALE'].includes(error.message))return jsonResponse({error:error.message},409);
    throw error;
  }
  const response=(url,id,reused)=>jsonResponse({mode:'asaas_checkout',provider:'asaas',billingType:context.billing_type,
    intentId:context.intent_id,installmentId:context.installment_id,participantId:context.participant_id,
    amount:Number(context.amount),checkoutId:id,checkoutUrl:url,reused});
  if(!context.claimed){
    if(context.status==='failed' && context.retry_allowed===true && context.retry_token)
      return jsonResponse({error:'CHECKOUT_RETRY_AVAILABLE',retryAllowed:true,retryToken:context.retry_token},409);
    if(context.status==='ready'){
      let url;try{url=sandboxCheckoutUrl({id:context.checkout_id,link:context.checkout_url});}
      catch{return jsonResponse({error:'CHECKOUT_AWAITING_RECONCILIATION'},409);}
      return response(url,context.checkout_id,true);
    }
    const error=({failed:'CHECKOUT_PREVIOUS_FAILED',creating:'CHECKOUT_IN_PROGRESS',unknown:'CHECKOUT_RESULT_UNKNOWN',
      paid:'CHECKOUT_ALREADY_PAID',cancelled:'CHECKOUT_CLOSED',expired:'CHECKOUT_CLOSED'})[context.status]||'CHECKOUT_AWAITING_RECONCILIATION';
    return jsonResponse({error},409);
  }
  const finish=async(outcome,id=null,url=null,status=null,diagnostic=null)=>{
    const {data,error:e}=await admin.rpc('finish_asaas_checkout_attempt',{p_session_key:context.session_key,p_claim_token:context.claim_token,
      p_outcome:outcome,p_checkout_id:id,p_checkout_url:url,p_provider_status:status,p_diagnostic_id:diagnostic?.diagnosticId||null});if(e)throw e;
    return data||{};
  };
  let body;try{body=asaasCheckoutPayload(context,config.callbacks,now());config.apiKey=accountKey(env,context.issuer_account_id);}
  catch(error){const retry=await finish('not_sent');return jsonResponse({error:error.message,...retry},409);}
  const {error:sendError}=await admin.rpc('start_asaas_checkout_attempt',{p_session_key:context.session_key,p_claim_token:context.claim_token});
  if(sendError){
    if(sendError.message==='CHECKOUT_MINIMUM_WINDOW'){
      await finish('not_sent');return jsonResponse({error:'CHECKOUT_MINIMUM_WINDOW'},409);
    }
    // A lost RPC response may have persisted the sending fence. Never resend.
    return jsonResponse({error:'CHECKOUT_AWAITING_RECONCILIATION'},409);
  }
  let res;
  try{res=await fetchImpl(`${SANDBOX}/checkouts`,{method:'POST',redirect:'error',
    headers:{accept:'application/json','content-type':'application/json','User-Agent':'TamoOn-Marketplace-Sandbox/22BB-C19',access_token:config.apiKey},
    body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});}
  catch{const diagnostic=reportCheckoutDiagnostic(context,checkoutDiagnostic(null,null,'transport'),'unknown');
    await finish('unknown',null,null,null,diagnostic);return jsonResponse({error:'CHECKOUT_RESULT_UNKNOWN',diagnostic},502);}
  let result;try{result=await res.json();}catch{
    const diagnostic=reportCheckoutDiagnostic(context,checkoutDiagnostic(res.status,null,'invalid_response'),'unknown');
    await finish('unknown',null,null,res.status,diagnostic);return jsonResponse({error:'ASAAS_INVALID_RESPONSE',diagnostic},502);
  }
  if(!res.ok){
    const rejected=definitiveCheckoutRejection(res.status,result);
    const state=rejected?'failed':'unknown';
    const diagnostic=reportCheckoutDiagnostic(context,checkoutDiagnostic(res.status,result),state);
    const retry=await finish(rejected?'rejected':'unknown',null,null,res.status,diagnostic);
    return jsonResponse({error:'ASAAS_CHECKOUT_ERROR',providerStatus:res.status,diagnostic,...retry},502);
  }
  let url;try{url=sandboxCheckoutUrl(result);}catch{
    const diagnostic=reportCheckoutDiagnostic(context,checkoutDiagnostic(res.status,null,'incomplete_response'),'unknown');
    await finish('unknown',null,null,res.status,diagnostic);return jsonResponse({error:'ASAAS_INCOMPLETE_RESPONSE',diagnostic},502);
  }
  await finish('ready',result.id,url);
  return response(url,result.id,false);
}

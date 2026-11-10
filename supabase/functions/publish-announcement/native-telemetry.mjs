// Persist sanitized delivery evidence without recording tokens, endpoints or message content.
export async function recordNativeAttempt(client, options) {
  return client.rpc('record_native_push_attempt', {p_event:{
    platform:options.subscription.android?'android':'ios',
    subscription_id:options.subscription.id,
    user_id:options.subscription.user_id,
    registered_at:options.subscription.updated_at,
    group_id:options.deliveryGroupId||null,
    delivery_id:options.deliveryId,
    attempt_number:options.attemptNumber,
    max_attempts:options.maxAttempts,
    is_final:options.isFinal,
    success:options.success,
    status_code:options.statusCode||null,
    duration_ms:Math.max(0,Math.min(Number(options.durationMs)||0,120000)),
    error_category:options.category||null,
    event_type:String(options.eventType||'push').slice(0,80)
  }});
}

// Only fixed categories/codes leave this module. Provider descriptions can
// contain credentials or personal data and must never be returned or logged.
const knownCodes = new Set(['invalid_object','invalid_value','invalid_action','invalid_api_key',
  'invalid_access_token','access_token_not_found','invalid_environment','unauthorized','forbidden',
  'invalid_customer','invalid_billing_type','invalid_charge_type','invalid_url','invalid_callback',
  'invalid_pix_key','pix_key_not_found','invalid_account','account_not_approved','not_found','rate_limit_exceeded']);

export function checkoutDiagnostic(status: number | null, payload: any = null, forced: string | null = null) {
  const errors = Array.isArray(payload?.errors) ? payload.errors.slice(0, 10) : [];
  const providerCodes = [...new Set(errors.map((item: any) => item?.code)
    .filter((code: any) => typeof code === 'string' && knownCodes.has(code)))];
  const text = errors.map((item: any) => typeof item?.description === 'string' ? item.description.slice(0, 2000) : '')
    .join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let category = forced || 'provider_rejection';
  let field: string | null = null;
  if (!forced) {
    if (status === 401 || providerCodes.some(code => /api_key|access_token|environment|unauthorized/.test(code))) category = 'authentication';
    else if (status === 403 || providerCodes.includes('forbidden')) category = 'access_denied';
    else if (status === 429) category = 'rate_limit';
    else if (status === 408 || (status !== null && status >= 500)) category = 'provider_unavailable';
    else if (/callback|successurl|cancelurl|expiredurl|redirecion|redirect/.test(text) || providerCodes.includes('invalid_callback')) {
      category = 'callback';
      field = ['successurl','cancelurl','expiredurl'].find(key => text.includes(key)) || 'callback';
    } else if (/chave.{0,25}pix|pix.{0,25}key|pix.{0,25}chave/.test(text) || providerCodes.some(code => /pix_key/.test(code))) category = 'pix_configuration';
    else if (/minutes.?to.?expire|expiracao|expiration/.test(text)) {category = 'expiration'; field = 'minutesToExpire';}
    else if (/customer|cliente|cpf|cnpj/.test(text)) {category = 'customer'; field = 'customerData';}
    else if (/billingtypes|chargetypes|items|quantidade|quantity|valor|value/.test(text)) category = 'request_data';
    else if (/conta|account|cadastro|aprovacao/.test(text)) category = 'account_configuration';
  }
  return {providerStatus:status,category,field,providerCodes};
}

export function reportCheckoutDiagnostic(context: any, diagnostic: ReturnType<typeof checkoutDiagnostic>, state: string) {
  const diagnosticId = crypto.randomUUID();
  const reservationCode = typeof context?.reservation_code === 'string' && /^RES-[A-Z0-9-]{1,32}$/.test(context.reservation_code)
    ? context.reservation_code : null;
  console.warn(JSON.stringify({event:'asaas_checkout_diagnostic',release:'22BB-C19',diagnosticId,
    reservationCode,checkoutState:state,...diagnostic}));
  return {...diagnostic,diagnosticId};
}


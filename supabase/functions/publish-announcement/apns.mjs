// APNs provider tokens stay server-side. Destinations never come from arbitrary URLs.
const encode = value => btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const json64 = value => encode(new TextEncoder().encode(JSON.stringify(value)));
export function apnsDestination(endpoint) {
  const match = /^apns:\/\/(production|sandbox)\/([a-f0-9]{64,512})$/.exec(endpoint);
  if (!match) throw Error('INVALID_APNS_ENDPOINT');
  return `https://${match[1] === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com'}/3/device/${match[2]}`;
}
export function apnsPayload(notification) {
  const url = new URL(notification.data?.url || '/', 'https://app.tamoon.app.br');
  if (url.origin !== 'https://app.tamoon.app.br' || !['/', '/index.html'].includes(url.pathname)) throw Error('INVALID_NOTIFICATION_URL');
  return {aps:{alert:{title:String(notification.title || 'Tâmo On').slice(0,160), body:String(notification.body || '').slice(0,240)}, sound:'default'}, url:url.href};
}
export function createApnsSender({env, request = fetch, now = () => Date.now()}) {
  let cached, signing;
  async function authorization() {
    if (cached && now() - cached.at < 45 * 60 * 1000) return cached.jwt;
    if (signing) return signing;
    signing = (async () => {
      const keyId = env('APNS_KEY_ID'), teamId = env('APNS_TEAM_ID'), pem = env('APNS_PRIVATE_KEY');
      if (!/^[A-Z0-9]{10}$/.test(keyId || '') || !/^[A-Z0-9]{10}$/.test(teamId || '') || !pem) {
        throw Object.assign(Error('O serviço de notificações do iPhone ainda não está configurado.'), {statusCode:503, body:'APNS_NOT_CONFIGURED'});
      }
      const bytes = Uint8Array.from(atob(pem.replaceAll('\\n','\n').replace(/-----[^-]+-----|\s/g,'')), c => c.charCodeAt(0));
      const key = await crypto.subtle.importKey('pkcs8', bytes, {name:'ECDSA', namedCurve:'P-256'}, false, ['sign']);
      const at = now();
      const message = `${json64({alg:'ES256',kid:keyId})}.${json64({iss:teamId,iat:Math.floor(at/1000)})}`;
      const signature = await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'}, key, new TextEncoder().encode(message));
      cached = {at, jwt:`${message}.${encode(signature)}`};
      return cached.jwt;
    })();
    try { return await signing; } finally { signing = null; }
  }
  return async (endpoint, notification, deliveryId) => {
    const target = apnsDestination(endpoint);
    const body = JSON.stringify(apnsPayload(notification));
    const jwt = await authorization();
    const response = await request(target, {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(18000),
      headers:{authorization:`bearer ${jwt}`, 'apns-topic':'br.app.tamoon', 'apns-push-type':'alert', 'apns-priority':'10', 'apns-expiration':'0', 'apns-id':deliveryId, 'content-type':'application/json'}, body
    });
    if (response.status === 200) return;
    const result = await response.json().catch(() => ({}));
    const reason = String(result.reason || 'APNS_REJECTED').slice(0,120);
    // A malformed/stale token is not retried; configuration failures retain registration.
    const invalid = response.status === 410 || ['BadDeviceToken','DeviceTokenNotForTopic','Unregistered'].includes(reason);
    if (reason === 'ExpiredProviderToken') cached = null;
    throw Object.assign(Error('A Apple não aceitou a notificação.'), {statusCode:invalid ? 410 : response.status, body:reason});
  };
}

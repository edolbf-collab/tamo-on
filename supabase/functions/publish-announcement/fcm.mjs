// HTTP v1 only. Service-account credentials never enter the app package.
const encode = value => btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const json64 = value => encode(new TextEncoder().encode(JSON.stringify(value)));
const failure = (statusCode, body) => Object.assign(Error('Não foi possível enviar a notificação Android.'), {statusCode, body});
export function fcmToken(endpoint) {
  const match = /^fcm:\/\/([A-Za-z0-9_:-]{20,2048})$/.exec(endpoint);
  if (!match) throw failure(400,'INVALID_FCM_ENDPOINT');
  return match[1];
}
export function fcmPayload(endpoint, notification) {
  let url;
  try { url = new URL(notification.data?.url || '/', 'https://app.tamoon.app.br'); }
  catch { throw failure(400,'INVALID_NOTIFICATION_URL'); }
  if (url.origin !== 'https://app.tamoon.app.br' || !['/', '/index.html'].includes(url.pathname)) throw failure(400,'INVALID_NOTIFICATION_URL');
  // Each tray entry represents one event. A global unread total on every entry
  // would be added repeatedly by Android launchers. iOS uses its app-wide badge.
  return {message:{
    token:fcmToken(endpoint),
    notification:{title:String(notification.title || 'Tâmo On').slice(0,160),body:String(notification.body || '').slice(0,240)},
    data:{url:url.href},
    android:{priority:'high',ttl:'86400s',restricted_package_name:'br.app.tamoon',notification:{channel_id:'tamoon-alerts',sound:'default',icon:'ic_stat_notification',color:'#00A878',visibility:'PRIVATE',notification_count:1,
      ...(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(notification.data?.notificationId || '') ? {tag:`tamoon-inbox:${notification.data.notificationId}`} : {})}}
  }};
}
export function createFcmSender({env, request=fetch, now=()=>Date.now()}) {
  let cached, signing;
  function credentials() {
    let value;
    try { value=JSON.parse(env('FCM_SERVICE_ACCOUNT_JSON') || 'null'); } catch {}
    if (!value || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(value.project_id || '') ||
        !/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com$/.test(value.client_email || '') || !value.private_key?.includes('BEGIN PRIVATE KEY')) {
      throw failure(503,'FCM_NOT_CONFIGURED');
    }
    return value;
  }
  async function authorization(account) {
    if (cached && cached.expires > now()+60000) return cached.token;
    if (signing) return signing;
    signing=(async()=>{
      const at=Math.floor(now()/1000);
      const bytes=Uint8Array.from(atob(account.private_key.replaceAll('\\n','\n').replace(/-----[^-]+-----|\s/g,'')),c=>c.charCodeAt(0));
      const key=await crypto.subtle.importKey('pkcs8',bytes,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
      const message=`${json64({alg:'RS256',typ:'JWT'})}.${json64({iss:account.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:at,exp:at+3600})}`;
      const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(message));
      const response=await request('https://oauth2.googleapis.com/token',{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(18000),
        headers:{'content-type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${message}.${encode(signature)}`}).toString()
      });
      const result=await response.json().catch(()=>({}));
      if (!response.ok || !result.access_token) throw failure(response.status>=500?503:401,'FCM_AUTH_FAILED');
      cached={token:result.access_token,expires:now()+Math.min(Number(result.expires_in)||300,3600)*1000};
      return cached.token;
    })();
    try { return await signing; } finally { signing=null; }
  }
  return async(endpoint,notification)=>{
    const body=JSON.stringify(fcmPayload(endpoint,notification));
    const account=credentials();
    const token=await authorization(account);
    const response=await request(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(18000),
      headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body
    });
    if(response.ok)return;
    const result=await response.json().catch(()=>({}));
    const detail=result.error?.details?.find(item=>item['@type']==='type.googleapis.com/google.firebase.fcm.v1.FcmError');
    const reason=String(detail?.errorCode || result.error?.status || 'FCM_REJECTED').replace(/[^A-Z0-9_]/g,'').slice(0,100);
    if(response.status===401)cached=null;
    // Never delete registrations for a missing project, wrong credentials or invalid payload.
    throw failure(reason==='UNREGISTERED'?410:(response.status===404?503:response.status),reason);
  };
}

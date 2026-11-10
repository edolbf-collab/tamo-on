// Native Apple login/linking. No account merge or client-selected target UUID.
export function createAppleHandler({createClient,env,publicKey,serviceKey,exchangeAppleCode,encryptToken}) {
  const headers={'access-control-allow-origin':'capacitor://localhost','access-control-allow-headers':'authorization,x-client-info,apikey,content-type','access-control-allow-methods':'POST,OPTIONS','content-type':'application/json','cache-control':'no-store'};
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
  return async request=>{
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(request.method!=='POST')return reply({error:'Método não permitido.'},405);
    if(Number(request.headers.get('content-length')||0)>8192)return reply({error:'Pedido inválido.'},413);
    try {
      const text=await request.text();if(text.length>8192)return reply({error:'Pedido inválido.'},413);
      const body=JSON.parse(text),action=body.action||'login';
      if(!['login','link'].includes(action)||typeof body.code!=='string'||body.code.length<10||body.code.length>4096||typeof body.nonce!=='string'||!/^[a-f0-9]{64}$/.test(body.nonce))return reply({error:'Pedido inválido.'},400);
      const bearer=request.headers.get('authorization')||'';
      const auth=createClient(env('SUPABASE_URL'),publicKey(),{auth:{persistSession:false,autoRefreshToken:false},
        ...(action==='link'?{global:{headers:{Authorization:bearer}}}:{})});
      let expected;
      if(action==='link') {
        if(!/^Bearer \S+$/.test(bearer))return reply({code:'AUTH_REQUIRED'},401);
        const {data,error}=await auth.auth.getUser(bearer.slice(7));
        if(error||!data?.user)return reply({code:'AUTH_REQUIRED'},401);
        expected=data.user.id;
      }
      const credential=await exchangeAppleCode(body.code);
      const input={provider:'apple',token:credential.idToken,nonce:body.nonce};
      const {data,error}=action==='link'?await auth.auth.linkIdentity(input):await auth.auth.signInWithIdToken(input);
      if(error||!data?.user||!data?.session)return reply({code:error?.code==='identity_already_exists'?'identity_already_exists':'APPLE_AUTH_FAILED'},400);
      if(expected&&data.user.id!==expected)return reply({code:'ACCOUNT_CHANGED'},403);
      if(!data.user.identities?.some(i=>i.provider==='apple'&&i.identity_data?.sub===credential.subject))return reply({code:'APPLE_AUTH_FAILED'},403);
      const admin=createClient(env('SUPABASE_URL'),serviceKey(),{auth:{persistSession:false,autoRefreshToken:false}});
      const {error:saveError}=await admin.from('apple_auth_grants').upsert({user_id:data.user.id,apple_subject:credential.subject,encrypted_refresh_token:await encryptToken(credential.refreshToken),revoked_at:null,updated_at:new Date().toISOString()});
      if(saveError){await admin.auth.admin.signOut(data.session.access_token,'global');throw Error('APPLE_GRANT_SAVE_FAILED');}
      // Preserve an existing profile when adding Apple. Names are never authorization data.
      const name=typeof body.name==='string'?body.name.trim().slice(0,100):'';
      if(action==='login'&&name&&!data.user.user_metadata?.full_name)await admin.auth.admin.updateUserById(data.user.id,{user_metadata:{...data.user.user_metadata,full_name:name}});
      return reply({user_id:data.user.id,session:{access_token:data.session.access_token,refresh_token:data.session.refresh_token}});
    }catch{return reply({code:'APPLE_AUTH_FAILED',error:'Não foi possível concluir o acesso Apple. Tente novamente.'},400);}
  };
}

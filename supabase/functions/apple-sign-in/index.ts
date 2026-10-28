import {createClient} from 'npm:@supabase/supabase-js@2.110.7';
import {env,serviceKey,publicKey,exchangeAppleCode,encryptToken} from '../_shared/apple.ts';

const headers={'access-control-allow-origin':'capacitor://localhost','access-control-allow-headers':'authorization,x-client-info,apikey,content-type','access-control-allow-methods':'POST,OPTIONS','content-type':'application/json','cache-control':'no-store'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply({error:'Método não permitido.'},405);
  // Endpoint de login: não recebe uma sessão prévia. Autorização vem do código Apple de uso único,
  // assinatura/audience validadas, e nonce conferido novamente pelo Supabase Auth.
  if(Number(request.headers.get('content-length')||0)>8192)return reply({error:'Pedido inválido.'},413);
  try{
    const bodyText=await request.text();if(bodyText.length>8192)return reply({error:'Pedido inválido.'},413);
    const body=JSON.parse(bodyText);
    if(typeof body.code!=='string'||body.code.length<10||body.code.length>4096||typeof body.nonce!=='string'||!/^[a-f0-9]{64}$/.test(body.nonce))return reply({error:'Pedido de autenticação inválido.'},400);
    const credential=await exchangeAppleCode(body.code);
    const auth=createClient(env('SUPABASE_URL'),publicKey(),{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await auth.auth.signInWithIdToken({provider:'apple',token:credential.idToken,nonce:body.nonce});
    if(error||!data.user||!data.session)return reply({error:'Não foi possível confirmar o acesso Apple. Tente novamente.'},401);
    const admin=createClient(env('SUPABASE_URL'),serviceKey(),{auth:{persistSession:false,autoRefreshToken:false}});
    const {error:saveError}=await admin.from('apple_auth_grants').upsert({user_id:data.user.id,apple_subject:credential.subject,encrypted_refresh_token:await encryptToken(credential.refreshToken),revoked_at:null,updated_at:new Date().toISOString()});
    if(saveError){await admin.auth.admin.signOut(data.session.access_token,'global');throw new Error('APPLE_GRANT_SAVE_FAILED');}
    // Nome é apenas dado de perfil, nunca uma autorização. A Apple só o fornece na primeira entrada.
    const name=typeof body.name==='string'?body.name.trim().slice(0,100):'';
    if(name)await admin.auth.admin.updateUserById(data.user.id,{user_metadata:{...data.user.user_metadata,full_name:name}});
    return reply({session:{access_token:data.session.access_token,refresh_token:data.session.refresh_token}});
  }catch{
    // Nunca registrar códigos Apple, tokens, resposta do provedor ou secrets em logs.
    return reply({error:'Não foi possível concluir o acesso Apple. Tente novamente. Se persistir, contate o suporte.'},400);
  }
});

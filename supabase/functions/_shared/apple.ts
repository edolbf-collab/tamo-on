import { SignJWT, importPKCS8, createRemoteJWKSet, jwtVerify } from 'npm:jose@6.2.13';

const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
export function env(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Configuração Apple ausente: ${name}`);
  return value;
}
export function serviceKey(): string {
  const value = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (value) return value;
  const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
  const key = keys.default || Object.values(keys)[0];
  if (typeof key !== 'string') throw new Error('Chave do serviço indisponível.');
  return key;
}
export function publicKey(): string {
  const value = Deno.env.get('SUPABASE_ANON_KEY');
  if (value) return value;
  const keys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
  const key = keys.default || Object.values(keys)[0];
  if (typeof key !== 'string') throw new Error('Chave pública indisponível.');
  return key;
}
async function secret() {
  const key = await importPKCS8(env('APPLE_PRIVATE_KEY').replace(/\\n/g,'\n'),'ES256');
  return new SignJWT({}).setProtectedHeader({alg:'ES256',kid:env('APPLE_KEY_ID')})
    .setIssuer(env('APPLE_TEAM_ID')).setSubject(env('APPLE_CLIENT_ID'))
    .setAudience('https://appleid.apple.com').setIssuedAt().setExpirationTime('5m').sign(key);
}
const b64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const from64 = (value: string) => Uint8Array.from(atob(value),c=>c.charCodeAt(0));
async function encryptionKey() {
  const bytes=from64(env('APPLE_TOKEN_ENCRYPTION_KEY'));
  if(bytes.length!==32) throw new Error('A chave de proteção Apple precisa ter 32 bytes.');
  return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);
}
export async function encryptToken(token: string) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(),new TextEncoder().encode(token));
  return `v1.${b64(iv)}.${b64(new Uint8Array(encrypted))}`;
}
async function decryptToken(encrypted: string) {
  const [version,iv,value]=encrypted.split('.');
  if(version!=='v1'||!iv||!value) throw new Error('Credencial Apple inválida.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:from64(iv)},await encryptionKey(),from64(value)));
}
export async function exchangeAppleCode(code: string) {
  const response=await fetch('https://appleid.apple.com/auth/token',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:env('APPLE_CLIENT_ID'),client_secret:await secret(),code,grant_type:'authorization_code'}),
    signal:AbortSignal.timeout(15000)
  });
  if(!response.ok) throw new Error('APPLE_CODE_EXCHANGE_FAILED');
  const result=await response.json();
  if(typeof result.id_token!=='string'||typeof result.refresh_token!=='string') throw new Error('APPLE_TOKEN_MISSING');
  const {payload}=await jwtVerify(result.id_token,appleKeys,{issuer:'https://appleid.apple.com',audience:env('APPLE_CLIENT_ID'),algorithms:['RS256']});
  if(!payload.sub) throw new Error('APPLE_SUBJECT_MISSING');
  return {idToken:result.id_token as string,refreshToken:result.refresh_token as string,subject:payload.sub};
}
export async function revokeAppleGrant(admin: any, userId: string) {
  const {data:userData,error:userError}=await admin.auth.admin.getUserById(userId);
  if(userError) throw new Error('Não foi possível verificar a identidade da conta.');
  const apple=userData.user?.identities?.some((i: any)=>i.provider==='apple');
  const {data:grant,error}=await admin.from('apple_auth_grants').select('encrypted_refresh_token,revoked_at').eq('user_id',userId).maybeSingle();
  if(error) throw new Error('Não foi possível consultar a credencial Apple.');
  if(!apple&&!grant)return {status:'not_applicable'};
  // A ausência de credencial nunca pode impedir o direito de excluir a conta.
  // O protocolo informa como revogar o vínculo na Apple, depois da remoção dos dados.
  if(!grant)return {status:'manual_revocation_required'};
  if(grant.revoked_at)return {status:'revoked'};
  const token=await decryptToken(grant.encrypted_refresh_token);
  const response=await fetch('https://appleid.apple.com/auth/revoke',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:env('APPLE_CLIENT_ID'),client_secret:await secret(),token,token_type_hint:'refresh_token'}),
    signal:AbortSignal.timeout(15000)
  });
  if(!response.ok)throw new Error('A Apple não confirmou a revogação. Tente novamente antes de concluir a exclusão.');
  const {error:updateError}=await admin.from('apple_auth_grants').update({revoked_at:new Date().toISOString()}).eq('user_id',userId);
  if(updateError)throw new Error('Não foi possível registrar a revogação Apple.');
  return {status:'revoked'};
}

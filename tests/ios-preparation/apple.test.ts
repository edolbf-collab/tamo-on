import {encryptToken,revokeAppleGrant} from '../../supabase/functions/_shared/apple.ts';
import {generateKeyPair,exportPKCS8,jwtVerify} from '../../supabase/functions/node_modules/jose/dist/webapi/index.js';
const assert=(value:unknown,message:string)=>{if(!value)throw new Error(message);};
const keys=await generateKeyPair('ES256',{extractable:true});
Deno.env.set('APPLE_PRIVATE_KEY',await exportPKCS8(keys.privateKey));
Deno.env.set('APPLE_TEAM_ID','TESTTEAM01');Deno.env.set('APPLE_KEY_ID','TESTKEY001');Deno.env.set('APPLE_CLIENT_ID','br.app.tamoon');
Deno.env.set('APPLE_TOKEN_ENCRYPTION_KEY',btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))));
function admin(grant:any,apple=true){
  return {updates:[] as any[],auth:{admin:{getUserById:async()=>({data:{user:{identities:apple?[{provider:'apple'}]:[{provider:'google'}]}}})}},from(){return {
    select:()=>({eq:()=>({maybeSingle:async()=>({data:grant})})}),
    update:(value:any)=>({eq:async()=>{this.updates.push(value);return {};}})
  };}};
}
Deno.test('Apple credential is encrypted and authenticated; revocation uses a signed, short-lived client secret',async()=>{
 const token='fake-refresh-token-for-test-only',encrypted=await encryptToken(token);
 assert(!encrypted.includes(token),'Plaintext leaked');assert(encrypted.startsWith('v1.'),'Missing cipher version');
 const service=admin({encrypted_refresh_token:encrypted,revoked_at:null});const original=globalThis.fetch;
 let calls=0;
 globalThis.fetch=async(input,init)=>{
   calls++;assert(String(input)==='https://appleid.apple.com/auth/revoke','Unexpected endpoint');
   const form=init?.body as URLSearchParams;assert(form.get('token')===token,'Cipher roundtrip failed');
   const {payload}=await jwtVerify(form.get('client_secret')!,keys.publicKey,{issuer:'TESTTEAM01',audience:'https://appleid.apple.com',subject:'br.app.tamoon'});
   assert(Number(payload.exp)-Number(payload.iat)===300,'Secret lifetime too long');return new Response(null,{status:200});
 };
 try{const result=await revokeAppleGrant(service,'test-user');assert(result.status==='revoked'&&calls===1,'Revocation not confirmed');assert(service.updates[0].revoked_at,'Revocation not recorded');}
 finally{globalThis.fetch=original;}
});
Deno.test('Provider failure never marks a grant revoked',async()=>{
 const service=admin({encrypted_refresh_token:await encryptToken('fake'),revoked_at:null});const original=globalThis.fetch;globalThis.fetch=async()=>new Response(null,{status:503});
 let failed=false;try{await revokeAppleGrant(service,'test');}catch{failed=true;}finally{globalThis.fetch=original;}
 assert(failed&&service.updates.length===0,'Failed revocation treated as success');
});
Deno.test('Missing Apple grant permits deletion with explicit manual-revocation followup',async()=>{
 const result=await revokeAppleGrant(admin(null),'test');assert(result.status==='manual_revocation_required','Missing credential blocked deletion');
});
Deno.test('Google-only account does not require Apple configuration',async()=>{
 const result=await revokeAppleGrant(admin(null,false),'test');assert(result.status==='not_applicable','Google deletion incorrectly requires Apple');
});
Deno.test('Already revoked credential is idempotent',async()=>{
 const result=await revokeAppleGrant(admin({encrypted_refresh_token:'not-needed',revoked_at:'2026-10-27'}),'test');assert(result.status==='revoked','Revoked credential retried');
});
Deno.test('Tampered ciphertext fails before contacting Apple',async()=>{
 const encoded=await encryptToken('test');const parts=encoded.split('.');const bytes=Uint8Array.from(atob(parts[2]),c=>c.charCodeAt(0));bytes[0]^=1;parts[2]=btoa(String.fromCharCode(...bytes));
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return new Response(null,{status:200});};
 let failed=false;try{await revokeAppleGrant(admin({encrypted_refresh_token:parts.join('.'),revoked_at:null}),'test');}catch{failed=true;}finally{globalThis.fetch=original;}
 assert(failed&&calls===0,'Tampered credential was accepted');
});

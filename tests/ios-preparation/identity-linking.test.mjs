import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createAppleHandler} from '../../supabase/functions/apple-sign-in/handler.mjs';
const {createClient}=createRequire(new URL('../../mobile/package.json',import.meta.url))('@supabase/supabase-js');
const expected='11111111-1111-4111-8111-111111111111';
const user={id:expected,aud:'authenticated',role:'authenticated',email:'original@example.test',user_metadata:{full_name:'Nome preservado'},identities:[{provider:'google'},{provider:'apple',identity_data:{sub:'apple-subject'}}]};
const token='test-session';
const input={code:'single-use-code',nonce:'a'.repeat(64),action:'link',name:'New name'};
const request=(body=input,authorization='Bearer '+token)=>new Request('https://edge.test',{method:'POST',headers:{authorization},body:JSON.stringify(body)});
function fixture({authError=false,conflict=false,other=false,subject='apple-subject'}={}){
 const calls=[];
 const auth={getUser:async()=>{calls.push('verify');return authError?{error:{message:'expired'}}:{data:{user}};},linkIdentity:async payload=>{calls.push(['link',payload]);return conflict?{error:{code:'identity_already_exists'}}:{data:{user:other?{...user,id:'other'}:user,session:{access_token:'access',refresh_token:'refresh'}}};},signInWithIdToken:async()=>{calls.push('login');return {data:{user,session:{access_token:'access',refresh_token:'refresh'}}};}};
 const admin={from:()=>({upsert:async row=>{calls.push(['save',row]);return {};}}),auth:{admin:{updateUserById:async()=>{calls.push('rename');},signOut:async()=>{calls.push('signout');}}}};
 const handler=createAppleHandler({createClient:(_,key)=>key==='service'?admin:{auth},env:()=> 'https://project.supabase.co',publicKey:()=> 'public',serviceKey:()=> 'service',exchangeAppleCode:async()=>{calls.push('exchange');return {idToken:'apple-token',refreshToken:'secret-refresh',subject};},encryptToken:async()=> 'encrypted'});
 return {calls,handler};
}
test('native link verifies the active account, links instead of signing in and preserves profile',async()=>{
 const f=fixture();const r=await f.handler(request());assert.equal(r.status,200);const body=await r.json();assert.equal(body.user_id,expected);
 assert.equal(f.calls[0],'verify');assert.equal(f.calls[1],'exchange');assert.equal(f.calls[2][0],'link');assert.equal(f.calls.includes('login'),false);assert.equal(f.calls.includes('rename'),false);assert.equal(f.calls.at(-1)[1].user_id,expected);assert.equal(f.calls.at(-1)[1].encrypted_refresh_token,'encrypted');
});
test('missing or expired session cannot exchange an Apple code for linking',async()=>{
 for(const authorization of ['', 'Bearer expired']){const f=fixture({authError:true});assert.equal((await f.handler(request(input,authorization))).status,401);assert.equal(f.calls.includes('exchange'),false);}
});
test('conflicting account, UUID mismatch and wrong Apple subject cannot save a grant or return tokens',async()=>{
 for(const options of [{conflict:true},{other:true},{subject:'wrong-subject'}]){const f=fixture(options);const r=await f.handler(request());assert.ok(r.status>=400);assert.equal((await r.json()).session,undefined);assert.equal(f.calls.some(c=>c[0]==='save'),false);}
});
test('unknown action and malformed nonce are refused before any provider call',async()=>{
 for(const body of [{...input,action:'merge'},{...input,nonce:'invalid'}]){const f=fixture();assert.equal((await f.handler(request(body))).status,400);assert.equal(f.calls.length,0);}
});
test('normal native Apple login remains available without an existing session',async()=>{
 const f=fixture();assert.equal((await f.handler(request({...input,action:'login'},''))).status,200);assert.equal(f.calls.includes('login'),true);assert.equal(f.calls.includes('verify'),false);
});
test('real pinned SDK forwards the verified bearer for native linkIdentity with an ID token',async()=>{
 const calls=[];
 const client=createClient('https://project.supabase.co','sb_publishable_test',{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:'Bearer '+token},fetch:async(url,init)=>{
  calls.push({url:String(url),authorization:new Headers(init.headers).get('authorization'),body:init.body&&JSON.parse(init.body)});
  return new Response(JSON.stringify(String(url).includes('/user')?user:{access_token:'fake',refresh_token:'fake',expires_in:3600,token_type:'bearer',user}),{status:200,headers:{'Content-Type':'application/json'}});
 }}});
 assert.equal((await client.auth.getUser(token)).error,null);
 const {error}=await client.auth.linkIdentity({provider:'apple',token:'apple-token',nonce:'nonce'});assert.equal(error,null);
 const call=calls.find(c=>c.url.includes('/token'));assert.equal(call.authorization,'Bearer '+token);assert.equal(call.body.link_identity,true);assert.equal(call.body.provider,'apple');
});

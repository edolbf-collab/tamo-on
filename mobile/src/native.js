import {Capacitor,registerPlugin} from '@capacitor/core';
import {Share} from '@capacitor/share';
import {Clipboard} from '@capacitor/clipboard';
import {createClient} from '@supabase/supabase-js';

window.supabase={createClient};
const Bridge=registerPlugin('TamoonNative');
const isIOS=Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='ios';
const callback='br.app.tamoon://auth/callback';
window.TamoonNative={
  isIOS,
  storage:{
    getItem:async key=>(await Bridge.storageGet({key})).value ?? null,
    setItem:async(key,value)=>{await Bridge.storageSet({key,value});},
    removeItem:async key=>{await Bridge.storageRemove({key});}
  },
  async finishOAuth(client,url,provider,linking){
    const expected=new URL(window.TAMOON_CONFIG.supabaseUrl);
    const authURL=new URL(url);
    const authEndpoint=authURL.origin===expected.origin&&authURL.pathname==='/auth/v1/authorize';
    const googleLink=linking&&provider==='google'&&authURL.hostname==='accounts.google.com'&&/^\/o\/oauth2\/(v2\/)?auth$/.test(authURL.pathname);
    if(authURL.protocol!=='https:'||authURL.username||authURL.password||(!authEndpoint&&!googleLink))throw new Error('Endereço de login inválido.');
    const result=await Bridge.authenticate({url,callbackScheme:'br.app.tamoon'});
    const returned=new URL(result.url);
    if(`${returned.protocol}//${returned.host}${returned.pathname}`!==callback)throw new Error('Retorno de login inválido.');
    if(returned.searchParams.has('error'))throw {code:returned.searchParams.get('error_code')||returned.searchParams.get('error')};
    const code=returned.searchParams.get('code');
    if(!code)throw new Error('O login não retornou a confirmação esperada.');
    const {error}=await client.auth.exchangeCodeForSession(code);
    if(error)throw error;
    if(!linking)await this.storage.setItem('tamoon-native-auth-provider',provider);
  },
  async appleAuth(client,linking){
    const before=linking?await client.auth.getUser():null;
    if(linking&&(before.error||!before.data?.user))throw Error('AUTH_REQUIRED');
    const credential=await Bridge.signInWithApple();
    const {data,error}=await client.functions.invoke('apple-sign-in',{body:{code:credential.code,nonce:credential.nonce,name:credential.name,action:linking?'link':'login'}});
    if(error||!data?.session){
      const detail=error?.context?.json?await error.context.json().catch(()=>null):null;
      throw {code:detail?.code||data?.code||'APPLE_AUTH_FAILED'};
    }
    // Server checks the same UUID before saving a grant. Check again before setting a session.
    if(linking&&data.user_id!==before.data.user.id)throw Error('ACCOUNT_CHANGED');
    const {error:sessionError}=await client.auth.setSession(data.session);
    if(sessionError)throw sessionError;
    if(!linking)await this.storage.setItem('tamoon-native-auth-provider','apple');
  },
  async checkAppleCredential(client){
    if(!isIOS||await this.storage.getItem('tamoon-native-auth-provider')!=='apple')return;
    const {data}=await client.auth.getSession();
    const identity=data.session?.user?.identities?.find(i=>i.provider==='apple');
    const subject=identity?.identity_data?.sub;
    if(!subject)return;
    const result=await Bridge.appleCredentialState({userId:subject});
    if(result.state==='revoked')await client.auth.signOut({scope:'local'});
  },
  async saveJson(data,name){await Bridge.shareFile({name,contents:JSON.stringify(data,null,2)});}
};
if(isIOS){
  Bridge.addListener('appleCredentialRevoked',async()=>{
    if(!window.App?.repo)return;
    await window.TamoonNative.checkAppleCredential(App.repo.client);
    location.reload();
  }).catch(()=>{});
  Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{await Share.share({title:data.title,text:data.text,url:data.url});}});
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async string=>{await Clipboard.write({string});}}});
  const openExternal=async href=>{
    let url=new URL(href,location.href);
    if(url.protocol==='capacitor:')url=new URL(url.pathname+url.search+url.hash,'https://app.tamoon.app.br');
    if(!['https:','mailto:','whatsapp:'].includes(url.protocol))return;
    await Bridge.openExternal({url:url.href});
  };
  const report=error=>window.App?.toast(error.message||'Não foi possível abrir o endereço.',true);
  window.open=href=>{openExternal(href).catch(report);return null;};
  document.addEventListener('click',event=>{
    const link=event.target.closest?.('a[href]');if(!link)return;
    if(link.hasAttribute('download'))return;
    const url=new URL(link.href,location.href);
    if(link.target==='_blank'||url.protocol==='mailto:'||url.protocol==='https:'||url.pathname.startsWith('/legal/')){
      event.preventDefault();openExternal(link.href).catch(report);
    }
  });
}

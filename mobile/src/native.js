import {Capacitor,registerPlugin} from '@capacitor/core';
import {App as NativeApp} from '@capacitor/app';
import {Share} from '@capacitor/share';
import {Clipboard} from '@capacitor/clipboard';
import {PushNotifications} from '@capacitor/push-notifications';
import {createNativePush} from './push.mjs';
import {nativeBack} from './back.mjs';
import {createInviteReceiver} from './invite.mjs';
import {createClient} from '@supabase/supabase-js';

window.supabase={createClient};
const Bridge=registerPlugin('TamoonNative');
const isNative=Capacitor.isNativePlatform();
const isIOS=isNative&&Capacitor.getPlatform()==='ios';
const isAndroid=isNative&&Capacitor.getPlatform()==='android';
const callback='br.app.tamoon://auth/callback';
window.TamoonNative={
  isIOS, isAndroid, isNative,
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
    if(isAndroid){
      const before=linking?await client.auth.getUser():null;
      if(linking&&(before.error||!before.data?.user))throw Error('AUTH_REQUIRED');
      await this.storage.setItem('tamoon-pending-native-oauth',JSON.stringify({provider,linking,userId:before?.data?.user?.id,at:Date.now()}));
    }
    let result;
    try { result=await Bridge.authenticate({url,callbackScheme:'br.app.tamoon'}); }
    catch(error){if(isAndroid)await this.storage.removeItem('tamoon-pending-native-oauth');throw error;}
    await this.completeOAuth(client,result.url,provider,linking);
  },
  async completeOAuth(client,url,provider,linking){
    const returned=new URL(url);
    if(`${returned.protocol}//${returned.host}${returned.pathname}`!==callback)throw new Error('Retorno de login inválido.');
    if(returned.searchParams.has('error'))throw {code:returned.searchParams.get('error_code')||returned.searchParams.get('error')};
    const code=returned.searchParams.get('code');
    if(!code)throw new Error('O login não retornou a confirmação esperada.');
    const {error}=await client.auth.exchangeCodeForSession(code);
    if(error)throw error;
    if(isAndroid)await this.storage.removeItem('tamoon-pending-native-oauth');
    if(!linking)await this.storage.setItem('tamoon-native-auth-provider',provider);
  },
  async resumeOAuth(client){
    if(!isAndroid||this.oauthResumed)return;
    this.oauthResumed=true;
    const launched=await NativeApp.getLaunchUrl();
    if(!launched?.url?.startsWith(callback))return;
    let pending;
    try { pending=JSON.parse(await this.storage.getItem('tamoon-pending-native-oauth')||'null'); } catch {}
    if(!pending||Date.now()-pending.at>20*60*1000||pending.provider!=='google')return;
    try {
      if(pending.linking){const before=await client.auth.getUser();if(before.error||before.data?.user?.id!==pending.userId)throw Error('ACCOUNT_CHANGED');}
      await this.completeOAuth(client,launched.url,pending.provider,pending.linking);
      if(pending.linking){const after=await client.auth.getUser();if(after.error||after.data?.user?.id!==pending.userId){await client.auth.signOut({scope:'local'});throw Error('ACCOUNT_CHANGED');}}
    }
    finally { await this.storage.removeItem('tamoon-pending-native-oauth'); }
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
if(isNative){
  const receiveInvite=createInviteReceiver({storage:localStorage,session:sessionStorage,getApp:()=>window.App,location});
  NativeApp.addListener('appUrlOpen',({url})=>receiveInvite(url)).catch(()=>{});
  NativeApp.getLaunchUrl().then(launch=>{if(launch?.url)receiveInvite(launch.url,{launch:true});}).catch(()=>{});
  NativeApp.getInfo().then(info=>{window.TamoonNative.appInfo=info;}).catch(()=>{});
  if(isAndroid)NativeApp.addListener('backButton',({canGoBack})=>nativeBack({document,app:window.App,marketplace:window.TamoonMarketplacePilot,location,history,canGoBack,minimize:()=>NativeApp.minimizeApp()}).catch(()=>{})).catch(()=>{});
  const push = createNativePush({plugin:PushNotifications, storage:window.TamoonNative.storage, environment:'production', platform:Capacitor.getPlatform(), origin:isAndroid?'https://localhost':'capacitor://localhost', notificationStatus:()=>Bridge.notificationStatus(), navigate:url=>{if(location.pathname.startsWith('/marketplace/')){location.assign(url);return true;}return false;}, getApp:()=>window.App});
  window.TamoonNative.push = push;
  push.listen().catch(()=>{});
  if(isIOS)Bridge.addListener('appleCredentialRevoked',async()=>{
    if(!window.App?.repo)return;
    await window.TamoonNative.checkAppleCredential(App.repo.client);
    location.reload();
  }).catch(()=>{});
  Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{await Share.share({title:data.title,text:data.text,url:data.url});}});
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async string=>{await Clipboard.write({string});}}});
  const openExternal=async href=>{
    let url=new URL(href,location.href);
    if(url.protocol==='capacitor:'||url.origin===location.origin)url=new URL(url.pathname+url.search+url.hash,'https://app.tamoon.app.br');
    if(!['https:','mailto:','whatsapp:'].includes(url.protocol))return;
    await Bridge.openExternal({url:url.href});
  };
  const report=error=>window.App?.toast(error.message||'Não foi possível abrir o endereço.',true);
  window.open=href=>{openExternal(href).catch(report);return null;};
  document.addEventListener('click',event=>{
    const link=event.target.closest?.('a[href]');if(!link)return;
    if(link.hasAttribute('download'))return;
    const url=new URL(link.href,location.href);
    if(link.target==='_blank'||url.protocol==='mailto:'||url.protocol==='whatsapp:'||(url.protocol==='https:'&&url.origin!==location.origin)||url.pathname.startsWith('/legal/')){
      event.preventDefault();openExternal(link.href).catch(report);
    }
  });
}

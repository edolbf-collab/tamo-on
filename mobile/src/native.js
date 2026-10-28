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
  async finishGoogleLogin(client,url){
    const expected=new URL(window.TAMOON_CONFIG.supabaseUrl);
    const authURL=new URL(url);
    if(authURL.origin!==expected.origin||authURL.pathname!=='/auth/v1/authorize')throw new Error('Endereço de login inválido.');
    const result=await Bridge.authenticate({url,callbackScheme:'br.app.tamoon'});
    const returned=new URL(result.url);
    if(`${returned.protocol}//${returned.host}${returned.pathname}`!==callback)throw new Error('Retorno de login inválido.');
    if(returned.searchParams.has('error'))throw new Error('O login foi cancelado ou recusado. Tente novamente.');
    const code=returned.searchParams.get('code');
    if(!code)throw new Error('O login não retornou a confirmação esperada.');
    const {error}=await client.auth.exchangeCodeForSession(code);
    if(error)throw error;
    await this.storage.setItem('tamoon-native-auth-provider','google');
  },
  mountAppleLogin(app){
    if(!isIOS)return;
    const card=document.querySelector('.google-card');if(!card)return;
    const button=document.createElement('button');button.type='button';button.className='apple-login-button';button.id='appleLoginButton';
    button.innerHTML='<svg viewBox="0 0 24 28" aria-hidden="true"><path d="M19.5 14.8c0-3.2 2.6-4.7 2.7-4.8-1.5-2.2-3.8-2.5-4.6-2.5-2-.2-3.9 1.2-4.9 1.2s-2.5-1.2-4.1-1.1c-2.1 0-4.1 1.3-5.2 3.1-2.2 3.8-.6 9.4 1.6 12.5 1.1 1.5 2.3 3.2 3.9 3.1 1.6-.1 2.2-1 4.2-1s2.6 1 4.3 1c1.8 0 2.8-1.5 3.8-3 1.2-1.7 1.7-3.4 1.8-3.5-.1 0-3.5-1.3-3.5-5zM16.2 5.5c.9-1.1 1.5-2.6 1.3-4.1-1.3.1-2.9.9-3.8 2-.8.9-1.5 2.5-1.3 4 1.4.1 2.9-.7 3.8-1.9z"/></svg><span>Continuar com Apple</span>';
    card.insertBefore(button,document.querySelector('#googleLoginMessage'));
    const message=document.querySelector('#googleLoginMessage');message.textContent='Escolha Google ou Apple para continuar.';
    button.onclick=async()=>{
      const google=document.querySelector('#googleLoginButton');button.disabled=true;google.disabled=true;
      try{
        const credential=await Bridge.signInWithApple();
        const {data,error}=await app.repo.client.functions.invoke('apple-sign-in',{body:{code:credential.code,nonce:credential.nonce,name:credential.name}});
        if(error||!data?.session)throw new Error('Não foi possível concluir o acesso Apple. Tente novamente.');
        const {error:sessionError}=await app.repo.client.auth.setSession(data.session);
        if(sessionError)throw sessionError;
        await this.storage.setItem('tamoon-native-auth-provider','apple');
        location.reload();
      }catch(error){message.textContent=error.code==='CANCELLED'?'Login cancelado.':error.message;button.disabled=false;google.disabled=false;}
    };
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

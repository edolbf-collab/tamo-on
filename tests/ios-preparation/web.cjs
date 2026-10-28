const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const root=path.resolve(__dirname,'../..'),checks=[];
const check=(v,n)=>{assert(v,n);checks.push(n);};
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:process.env.TAMOON_TEST_BROWSER});
const context=await browser.newContext({viewport:{width:390,height:844}});
await context.route('**/*',async route=>{
 const url=new URL(route.request().url());if(url.hostname!=='local.test')return route.abort();
 let file=path.join(root,url.pathname);if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
 if(!fs.existsSync(file))return route.fulfill({status:404,body:'missing'});
 await route.fulfill({status:200,contentType:({'.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.html':'text/html'})[path.extname(file)]||'text/plain',body:fs.readFileSync(file)});
});
const page=await context.newPage();await page.goto('http://local.test/offline.html');
await page.setContent('<html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/legal/legal.css"></head><body><div id="modalRoot"></div></body></html>');
const appSource=fs.readFileSync(path.join(root,'app.js'),'utf8').replace('document.addEventListener("DOMContentLoaded", boot);','window.TestRepository=SupabaseRepository;');
await page.addScriptTag({content:appSource});
await page.addScriptTag({path:path.join(root,'account-deletion.js')});
await page.addScriptTag({path:path.join(root,'legal/acceptance.js')});
await page.evaluate(()=>{
 window.calls=[];window.submitFailure=true;
 window.receipt={id:'55555555-5555-4555-8555-555555555555',status:'requested',requested_at:'2026-10-27T12:00:00Z',due_at:'2026-11-26T12:00:00Z',completed_at:null};
 App.repo={client:{rpc:async(name,args)=>{calls.push({name,args});if(name==='get_my_account_deletion_request')return {data:null};if(name==='request_my_account_deletion')return submitFailure?{error:{message:'Falha simulada. Tente novamente.'}}:{data:receipt};return {error:{message:'Offline'}};}},state:{profile:{email:'ficticio@example.test'}}};
 App.state={is_platform_admin:false};
});
await page.evaluate(()=>TamoonLegal.openCenter(App));
check(await page.locator('#legalCenterDelete').count()===1,'Deletion remains accessible when legal document fetch fails');
await page.locator('#legalCenterDelete').click();await page.locator('#deletionForm').waitFor();
check((await page.locator('#deletionContent').innerText()).includes('30 dias'),'Deadline shown before confirmation');
await page.locator('#deletionForm button').click();
check(await page.evaluate(()=>calls.filter(c=>c.name==='request_my_account_deletion').length)===0,'Unchecked confirmation cannot submit');
await page.locator('#deletionForm input').check();await page.locator('#deletionForm button').click();
await page.getByText('Falha simulada. Tente novamente.').waitFor();
check(await page.locator('#deletionForm button').isEnabled(),'Failure preserves retry without false confirmation');
await page.evaluate(()=>{submitFailure=false;});await page.locator('#deletionForm button').click();await page.getByText('Pedido registrado',{exact:true}).waitFor();
check(await page.locator('.deletion-protocol').innerText()==='55555555-5555-4555-8555-555555555555','Server receipt displayed');
check(await page.evaluate(()=>localStorage.getItem('tamoon-deletion-receipt'))==='55555555-5555-4555-8555-555555555555','Receipt retained for post-deletion lookup');
for(const width of [320,390,430]){await page.setViewportSize({width,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Deletion has no horizontal overflow at '+width);}
await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(__dirname,'deletion-receipt.png')});
await page.locator('.deletion-close').click();await page.evaluate(()=>App.renderBetaAccessDenied(new Error('Acesso bloqueado.')));
check(await page.locator('#deniedDelete').count()===1,'Blocked account has deletion entry point');
await page.evaluate(()=>{App.renderAuth();});check(await page.locator('#googleLoginButton').count()===1,'Web Google login preserved');
check(await page.locator('#appleLoginButton').count()===0,'Apple not offered on web without native configuration');
check(await page.getByText('Consultar meu pedido de exclusão').count()===1,'Logged-out screen links to receipt');

// Execute actual native adapter logic with only the operating-system bridges mocked.
let native=fs.readFileSync(path.join(root,'mobile/src/native.js'),'utf8');
native=native.replace(/^import .*;$/gm,'');
native='const {Capacitor,registerPlugin,Share,Clipboard,createClient}=window.nativeMocks;\n'+native;
await page.evaluate(()=>{
 window.nativeMocks={Capacitor:{isNativePlatform:()=>true,getPlatform:()=> 'ios'},registerPlugin:()=>window.nativeBridge,Share:{share:async()=>{}},Clipboard:{write:async()=>{}},createClient:()=>({})};
 window.nativeBridge={addListener:async()=>({remove:async()=>{}}),authenticate:async()=>({url:window.callbackURL}),storageGet:async()=>({value:'secure'}),storageSet:async()=>{},storageRemove:async()=>{},signInWithApple:async()=>({code:'fake-code',nonce:'a'.repeat(64),name:'Pessoa Fictícia'}),openExternal:async()=>{},shareFile:async()=>{}};
 window.TAMOON_CONFIG={supabaseUrl:'https://xvwgrpnioaqyijhzqxqh.supabase.co'};
});
await page.addScriptTag({content:native});
const outcomes=await page.evaluate(async()=>{
 const client={auth:{exchangeCodeForSession:async code=>{window.exchangedCode=code;return {};}}};
 const valid='https://xvwgrpnioaqyijhzqxqh.supabase.co/auth/v1/authorize?provider=google';
 window.callbackURL='br.app.tamoon://auth/callback?code=valid-code';await TamoonNative.finishGoogleLogin(client,valid);
 const ok=window.exchangedCode;
 let foreign=false,path=false,error=false;
 try{await TamoonNative.finishGoogleLogin(client,'https://example.test/auth/v1/authorize');}catch{foreign=true;}
 window.callbackURL='br.app.tamoon://evil/callback?code=stolen';try{await TamoonNative.finishGoogleLogin(client,valid);}catch{path=true;}
 window.callbackURL='br.app.tamoon://auth/callback?error=denied';try{await TamoonNative.finishGoogleLogin(client,valid);}catch{error=true;}
 return {ok,foreign,path,error,stored:await TamoonNative.storage.getItem('session')};
});
check(outcomes.ok==='valid-code','Native Google callback exchanges PKCE code');check(outcomes.foreign,'Foreign authorization URL rejected');check(outcomes.path,'Wrong callback rejected');check(outcomes.error,'Provider denial handled');check(outcomes.stored==='secure','Native session adapter reads Keychain bridge');
await page.evaluate(()=>{App.repo.client.functions={invoke:async()=>({error:{message:'simulated'}})};TamoonNative.mountAppleLogin(App);});
check(await page.locator('#appleLoginButton').count()===1,'Native Apple and Google offered together');
await page.screenshot({path:path.join(__dirname,'ios-login-preview.png')});
await page.locator('#appleLoginButton').click();await page.getByText('Não foi possível concluir o acesso Apple. Tente novamente.',{exact:true}).waitFor();
check(await page.locator('#appleLoginButton').isEnabled()&&await page.locator('#googleLoginButton').isEnabled(),'Apple failure restores both login controls');
await browser.close();fs.writeFileSync(path.join(__dirname,'web-results.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(`${checks.length} browser checks passed`);
})().catch(error=>{console.error(error);process.exit(1);});

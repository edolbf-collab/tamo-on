const {webkit}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..');
const sdk=fs.readFileSync(process.env.AUTH_TEST_SDK||'/tmp/r18-supabase-sdk.js','utf8');
const id='11111111-1111-4111-8111-111111111111';
const jwt=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url'),'test-only'].join('.');
function user(identities=['google']){return {id,email:'original@example.test',email_confirmed_at:'2026-01-01',aud:'authenticated',role:'authenticated',app_metadata:{provider:identities[0],providers:identities},user_metadata:{name:'Pessoa de teste'},identities:identities.map(provider=>({id:provider,identity_id:provider,provider,identity_data:{sub:provider,email:provider==='apple'?'hidden@privaterelay.appleid.com':'original@example.test'}})),created_at:'2026-01-01T00:00:00Z'};}
const session=u=>({access_token:jwt,refresh_token:'test-only',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:u});
(async()=>{
 const server=require('node:http').createServer((req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://test').pathname.replace(/\/$/,'/index.html'));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  try {const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'}[path.extname(file)]||'text/plain';res.writeHead(200,{'Content-Type':type});res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(8778,'127.0.0.1',resolve));
 const browser=await webkit.launch({headless:true});
 const base='http://127.0.0.1:8778';
 async function scenario({platform='ios',enabled=true,loggedIn=false,width=390}={}){
  const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block',userAgent:platform.startsWith('android')?'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36':platform==='ios'?'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1':'Mozilla/5.0 Macintosh Safari'});
  if(platform==='android-app')await context.addInitScript(()=>{const original=window.matchMedia.bind(window);window.matchMedia=q=>q==='(display-mode: standalone)'?{matches:true}:original(q);});
  const page=await context.newPage(),errors=[],calls=[];let current=user(),conflict=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:sdk}));
  await page.route('https://static.cloudflareinsights.com/**',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await page.route('**/auth-config.js?*',r=>r.fulfill({contentType:'text/javascript',body:`window.TAMOON_AUTH_CONFIG={appleEnabled:${enabled},linkingEnabled:${enabled}};`}));
  await page.route('**/supabase-config.js?*',r=>r.fulfill({contentType:'text/javascript',body:`window.TAMOON_CONFIG={supabaseUrl:'https://xvwgrpnioaqyijhzqxqh.supabase.co',supabasePublishableKey:'sb_publishable_test',authRedirectUrl:'${base}/'};`}));
  await page.route('https://*.supabase.co/**',async r=>{
   const url=new URL(r.request().url());calls.push({url:url.href,body:r.request().postDataJSON?.(),headers:r.request().headers()});let data=[],status=200;
   if(url.pathname==='/auth/v1/user')data=current;
   else if(url.pathname==='/auth/v1/user/identities/authorize'){
    if(conflict){status=422;data={code:'identity_already_exists',msg:'Already linked'};}
    else data={url:'https://appleid.apple.com/auth/authorize?state=test-only'};
   }else if(url.pathname==='/auth/v1/token'){current=user(['google','apple']);data=session(current);}
   else if(url.pathname.endsWith('/claim_beta_access'))data={status:'active'};
   else if(url.pathname.endsWith('/get_community_legal_access_status'))data={allowed:true,enabled:true};
   else if(url.pathname.endsWith('/community_safety_state'))data={blocks:[]};
   else if(url.pathname.endsWith('/is_platform_admin'))data=false;
   else if(url.pathname.includes('/functions/v1/community-marketplace-session')){status=403;data={error:'PILOT_RESTRICTED'};}
   await r.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.route('https://appleid.apple.com/**',r=>r.fulfill({body:'Apple confirmation (test fixture)'}));
  if(loggedIn)await page.addInitScript(s=>localStorage.setItem('sb-xvwgrpnioaqyijhzqxqh-auth-token',JSON.stringify(s)),session(current));
  await page.goto(base+'/');
  return {context,page,errors,calls,conflict:value=>{conflict=value;}};
 }
 try{
  for(const platform of ['ios','desktop','android-browser','android-app'])for(const width of [320,390]){
   const f=await scenario({platform,width});const {page}=f;
   await page.locator('#googleLoginButton').waitFor();
   assert.equal(await page.locator('#appleLoginButton').isVisible(),platform!=='android-app');
   if(platform==='android-app'){await page.getByText('Outras formas de entrar',{exact:true}).click();assert.equal(await page.locator('#appleLoginButton').isVisible(),true);}
   const widths=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));assert.ok(widths.scroll<=widths.width);
   if(platform==='ios'&&width===390)await page.screenshot({path:'/tmp/r18-login-ios.png',fullPage:true});
   if(platform==='android-app'&&width===390)await page.screenshot({path:'/tmp/r18-login-android.png',fullPage:true});
   assert.deepEqual(f.errors,[]);await f.context.close();
  }
  const disabled=await scenario({enabled:false});await disabled.page.locator('#googleLoginButton').waitFor();assert.equal(await disabled.page.locator('#appleLoginButton').count(),0);
  await disabled.page.locator('#googleLoginButton').click();await disabled.page.waitForURL('https://xvwgrpnioaqyijhzqxqh.supabase.co/auth/v1/authorize?*');
  const oauth=new URL(disabled.page.url());assert.equal(oauth.searchParams.get('provider'),'google');assert.equal(oauth.searchParams.get('code_challenge_method'),'s256');assert.ok(oauth.searchParams.get('code_challenge'));await disabled.context.close();
  const f=await scenario({loggedIn:true});await f.page.waitForFunction(()=>window.App?.ready);
  await f.page.evaluate(()=>App.openProfileModal());await f.page.locator('#profileAccessButton').click();
  await f.page.getByRole('button',{name:'Vincular Apple',exact:true}).waitFor();
  await f.page.screenshot({path:'/tmp/r18-access-methods.png',fullPage:true});
  f.conflict(true);await f.page.getByRole('button',{name:'Vincular Apple',exact:true}).click();
  await f.page.getByText('Os cadastros não foram unidos.',{exact:false}).waitFor();
  assert.equal(await f.page.evaluate(()=>App.state.profile.id),id);
  f.conflict(false);await f.page.getByRole('button',{name:'Vincular Apple',exact:true}).click();await f.page.waitForURL('https://appleid.apple.com/**');
  const linking=f.calls.filter(c=>c.url.includes('/user/identities/authorize')).at(-1);assert.equal(linking.headers.authorization,'Bearer '+jwt);assert.ok(new URL(linking.url).searchParams.get('code_challenge'));
  await f.page.goto(base+'/?code=test-only');await f.page.getByText('Apple vinculado à sua conta.',{exact:false}).waitFor();
  assert.equal(await f.page.evaluate(()=>App.state.profile.id),id);assert.equal(await f.page.evaluate(()=>App.state.profile.email),'original@example.test');
  assert.equal(await f.page.getByText('Vinculado',{exact:true}).count(),2);assert.deepEqual(f.errors,[]);await f.context.close();
  console.log('Auth browser: 8 platform/width presentations, disabled Apple, real SDK Google PKCE, duplicate-account refusal and Apple linking callback with preserved UUID: PASS');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

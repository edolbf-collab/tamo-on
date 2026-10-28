const { chromium } = require('playwright');
const fs=require('node:fs'); const assert=require('node:assert/strict'); const path=require('node:path');
const repo=path.resolve(__dirname,'../../..');
const communityId='11111111-1111-4111-8111-111111111111', marketId='22222222-2222-4222-8222-222222222222';
const jwt=id=>[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url'),'test-signature'].join('.');
const user=id=>({id,email:'pilot@example.test',aud:'authenticated',role:'authenticated',app_metadata:{provider:'google'},user_metadata:{},created_at:'2026-01-01T00:00:00Z'});
const session=id=>({access_token:jwt(id),refresh_token:'mock-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:user(id)});
const bootstrap={profile:{id:marketId,display_name:'Conta de teste',status:'active'},is_admin:true,settings:{real_money_enabled:false,marketplace_enabled:true},generated_at:new Date().toISOString()};
for(const key of ['chats','events','groups','spaces','venues','partners','payments','schedule','vouchers','chat_unread','occurrences','reservations','venue_photos','chat_messages','group_members','notifications','voucher_usages','payment_intents','pix_installments','partner_memberships','chat_effective_state','partner_applications','group_member_directory','reservation_participants'])bootstrap[key]=[];
(async()=>{
 const sdk=process.env.PILOT_TEST_SDK ? fs.readFileSync(process.env.PILOT_TEST_SDK,'utf8')
   : await fetch('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/dist/umd/supabase.min.js').then(r=>{if(!r.ok)throw new Error('SDK download failed');return r.text()});
 const server=require('node:http').createServer((req,res)=>{
   const pathname=decodeURIComponent(new URL(req.url,'http://test').pathname);
   const file=path.resolve(repo,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
   if(!file.startsWith(repo+path.sep)){res.writeHead(403);return res.end()}
   const types={'.js':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
   const csp=fs.readFileSync(path.join(repo,'_headers'),'utf8').split('\n').find(x=>x.trim().startsWith('Content-Security-Policy:')).trim().replace('Content-Security-Policy: ','');
   try {res.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain','Content-Security-Policy':csp});res.end(fs.readFileSync(file))}
   catch{res.writeHead(404);res.end()}
 });
 await new Promise(resolve=>server.listen(8766,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try {
 for(const scenario of ['anonymous','denied','owner']) {
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage(); const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:sdk}));
  await page.route('https://*.supabase.co/**',async r=>{
   const url=new URL(r.request().url());requests.push(url.pathname);
   let data=[],status=200;
   if(url.pathname.includes('/functions/v1/community-marketplace-session')) {
    if(scenario==='denied') {status=403;data={error:'PILOT_RESTRICTED'}}
    else data={session:session(marketId),allowed:true};
   } else if(url.pathname==='/auth/v1/user')data=user(marketId);
   else if(url.pathname.endsWith('/partner_readonly_status'))data={available:true,active:false};
   else if(url.pathname.endsWith('/marketplace_bootstrap'))data=bootstrap;
   else if(url.pathname.endsWith('/assert_marketplace_writable'))data=true;
   await r.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  });
  if(scenario!=='anonymous') await page.addInitScript(({session})=>localStorage.setItem('sb-xvwgrpnioaqyijhzqxqh-auth-token',JSON.stringify(session)),{session:session(communityId)});
  await page.goto('http://127.0.0.1:8766/marketplace/');
  if(scenario==='anonymous')await page.getByText('Entre na Comunidade com sua conta autorizada').waitFor();
  if(scenario==='denied')await page.getByText('Sua conta ainda não tem acesso.',{exact:false}).waitFor();
  if(scenario==='owner') {
    await page.waitForFunction(()=>!document.body.classList.contains('pilot-locked'),null,{timeout:15000});
    assert.equal(await page.evaluate(()=>localStorage.getItem('tamoon-marketplace-pilot-session')),null);
    assert.equal(await page.evaluate(()=>localStorage.getItem('sb-owybghlwcohfyapvsfdo-auth-token')),null);
    assert.equal(await page.evaluate(()=>navigator.serviceWorker.controller),null);
    assert.ok(await page.getByText('Pagamentos simulados',{exact:false}).isVisible());
    await page.getByRole('button',{name:'Administração',exact:true}).click();
    if(process.env.PILOT_TEST_SCREENSHOT)await page.screenshot({path:process.env.PILOT_TEST_SCREENSHOT,fullPage:true});
    await page.evaluate(()=>window.MarketplaceBackend.client.auth.signOut({scope:'local'}));
    assert.ok(await page.locator('#pilotGate').isVisible());
    // A refresh callback after access failure cannot uncover the UI again.
    await page.evaluate(()=>{window.TamoonMarketplacePilot.fail();window.TamoonMarketplacePilot.ready()});
    assert.ok(await page.locator('#pilotGate').isVisible());
  } else {
    assert.equal(await page.evaluate(()=>typeof window.MarketplaceBackend),'undefined');
    assert.equal(requests.some(p=>p.startsWith('/rest/')),false);
  }
  assert.deepEqual(errors,[]);
  console.log(`${scenario}: PASS`);await context.close();
 }
 } finally {await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exit(1)});

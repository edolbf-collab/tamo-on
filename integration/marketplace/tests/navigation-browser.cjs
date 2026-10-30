const {webkit,chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'../../..'),market=path.join(repo,'marketplace');
const read=name=>fs.readFileSync(path.join(market,name),'utf8');
const source=read('app.js'),index=read('index.html');
const css=[...index.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m=>read(m[1].split('?')[0])).join('\n');
const c={state:{activePage:{admin:'finance',user:'shares',partner:'finance'}},esc:String,partnerAccessPending:false,
 navigationUnreadCount:(role,page)=>page==='shares'?2:0,messageBadge:count=>count?`<span class="message-badge">${count}</span>`:'',partnerPageAllowed:page=>page!=='team'};
vm.createContext(c);
vm.runInContext(source.slice(source.indexOf('  const menus ='),source.indexOf('  function initialState()')),c);
vm.runInContext(source.slice(source.indexOf('  function navigationItems('),source.indexOf('  function pageHeader(')),c);
const financial='<header class="page-header"><div><span class="eyebrow">Administração</span><h1>Financeiro</h1><p>Reservas, taxas, comissão e valores dos parceiros.</p></div></header><div style="height:1400px"></div>';
(async()=>{
 const engine=process.env.PILOT_TEST_BROWSER==='chromium'?chromium:webkit;
 const browser=await engine.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.abort());
  await page.setContent(index.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*>/g,''));
  await page.addStyleTag({content:css});
  await page.addScriptTag({content:read('marketplace-ui.js')});
  await page.addScriptTag({content:read('marketplace-navigation.js')});
  await page.evaluate(({markup,items})=>{
   document.body.classList.remove('pilot-locked');document.getElementById('app').innerHTML=markup;
   for(const id of ['openNotifications','toggleNotificationSound','marketplaceSessionButton'])document.getElementById(id).hidden=false;
   window.visits=[];window.soundClicks=0;
   document.getElementById('toggleNotificationSound').addEventListener('click',()=>window.soundClicks++);
   document.getElementById('toggleMarketplaceTheme').addEventListener('click',()=>document.documentElement.dataset.theme=document.documentElement.dataset.theme==='light'?'dark':'light');
   document.getElementById('openReleaseNotes').addEventListener('click',()=>document.getElementById('infoDialog').showModal());
   window.drawer=window.MarketplaceNavigation.create({onNavigate:page=>window.visits.push(page)});
   window.drawer.update({heading:'Administração',markup:items});
  },{markup:c.navShell('admin',financial),items:c.navigationItems('admin')});
  const open=()=>page.locator('#openMarketplaceMenu').click();
  const isOpen=()=>page.locator('#marketplaceMenu').evaluate(node=>node.open);
  const headerControls=()=>page.locator('.header-actions > button:visible').evaluateAll(nodes=>nodes.map(n=>n.id));
  for(const width of [320,360,390,430,768,980]){
   await page.setViewportSize({width,height:844});
   assert.deepEqual(await headerControls(),['openNotifications','marketplaceSessionButton']);
   assert.equal(await page.locator('.role-layout > .subnav').isVisible(),false);
   assert.ok(await page.locator('#openMarketplaceMenu').isVisible());
   const bounds=await page.locator('.app-header').evaluate(node=>[...node.querySelectorAll('button,.brand-lockup')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}}));
   assert.ok(bounds.every(r=>r.left>=0&&r.right<=width),`header bounds at ${width}`);
   assert.ok(Math.max(...bounds.map(r=>r.bottom))-Math.min(...bounds.map(r=>r.top))<=48,`single header row at ${width}`);
   await open();assert.equal(await isOpen(),true);
   assert.equal(await page.locator('#openMarketplaceMenu').getAttribute('aria-expanded'),'true');
   const panel=await page.locator('.marketplace-menu-panel').boundingBox();assert.ok(panel.width<width);
   await page.locator('#marketplaceMenu [data-nav="finance"]').click();assert.equal(await isOpen(),false);
  }
  console.log('mobile layout 320–980px, destinations, close on navigation: PASS');
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.scrollTo({top:250,behavior:'instant'}));
  const scroll=await page.evaluate(()=>window.scrollY);
  await open();assert.equal(await page.evaluate(()=>document.body.style.position),'fixed');
  for(let i=0;i<18;i++)await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.getElementById('marketplaceMenu').contains(document.activeElement)),true);
  await page.keyboard.press('Escape');assert.equal(await isOpen(),false);
  assert.equal(await page.evaluate(()=>window.scrollY),scroll);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'openMarketplaceMenu');
  await open();const panel=await page.locator('.marketplace-menu-panel').boundingBox();
  await page.mouse.click(385,panel.y+80);assert.equal(await isOpen(),false);
  console.log('focus containment, Escape, scrim and scroll restoration: PASS');
  await open();await page.locator('#toggleNotificationSound').click();assert.equal(await page.evaluate(()=>window.soundClicks),1);
  await page.locator('#toggleMarketplaceTheme').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  await page.locator('#openReleaseNotes').click();assert.equal(await isOpen(),false);
  assert.equal(await page.evaluate(()=>document.getElementById('infoDialog').open),true);
  assert.equal(await page.evaluate(()=>document.body.style.position),'');await page.keyboard.press('Escape');
  console.log('existing preference handlers and handover to Help dialog: PASS');
  for(const [role,heading,count] of [['user','Usuário',6],['partner','Parceiro',8],['admin','Administração',7]]){
   await page.evaluate(({heading,markup})=>window.drawer.update({heading,markup}),{heading,markup:c.navigationItems(role)});
   await open();assert.equal(await page.locator('#marketplaceMenu [data-nav]').count(),count);
   if(role==='partner')assert.equal(await page.locator('#marketplaceMenu .is-restricted').isDisabled(),true);
   await page.keyboard.press('Escape');
  }
  await open();await page.evaluate(()=>window.drawer.update({heading:'Quero ser parceiro',markup:''}));
  assert.equal(await isOpen(),false);await open();assert.equal(await page.locator('#marketplaceMenuLinks').isVisible(),false);
  assert.ok(await page.locator('#openReleaseNotes').isVisible());
  await page.setViewportSize({width:1280,height:900});assert.equal(await isOpen(),false);
  assert.equal(await page.locator('#openMarketplaceMenu').isVisible(),false);
  assert.deepEqual(await headerControls(),['openNotifications','toggleNotificationSound','marketplaceSessionButton','toggleMarketplaceTheme','openReleaseNotes']);
  assert.equal(await page.locator('.role-layout > .subnav').isVisible(),true);
  await page.locator('#toggleNotificationSound').click();assert.equal(await page.evaluate(()=>window.soundClicks),2);
  console.log('roles, restricted destination, candidate and desktop restoration: PASS');
  await page.setViewportSize({width:390,height:844});await open();
  await page.evaluate(()=>window.drawer.update({heading:'Usuário',markup:'',allowed:false}));
  assert.equal(await isOpen(),false);assert.equal(await page.locator('#openMarketplaceMenu').isDisabled(),true);
  await page.evaluate(()=>window.drawer.update({heading:'Administração',markup:'',allowed:true}));await open();
  await page.evaluate(()=>document.body.classList.add('pilot-locked'));
  await page.waitForFunction(()=>!document.getElementById('marketplaceMenu').open);
  assert.equal(await page.evaluate(()=>document.body.style.position),'');
  assert.deepEqual(errors,[]);console.log('access revocation and session failure release the modal: PASS');
  await context.close();
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

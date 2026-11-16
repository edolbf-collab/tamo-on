import {chromium} from 'playwright';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const root=new URL('../../',import.meta.url),fixture=JSON.parse(await readFile('/tmp/monthly-fixture.json','utf8'));
const browser=await chromium.launch();
try{
 for(const role of ['admin','partner']){
  const page=await browser.newPage();await page.clock.install();
  await page.setContent('<main><div id="monthly"></div></main>');
  await page.addScriptTag({content:await readFile(new URL('marketplace/monthly-finance.js',root),'utf8')});
  await page.evaluate(({fixture,role})=>{
   window.fixture=structuredClone(fixture);window.fixture.admin=role==='admin';window.who=role;window.reads=0;window.hold=false;window.pending=[];window.fail=false;window.hiddenForTest=false;
   Object.defineProperty(document,'hidden',{configurable:true,get:()=>hiddenForTest});
   window.controller=TamoonMonthlyFinance.mount(document.querySelector('#monthly'),{identity:()=>who,partnerId:fixture.venues[0].partner_id,
    rpc:async()=>{reads++;if(fail)throw Error('NETWORK_ERROR');if(hold)return new Promise(resolve=>pending.push(resolve));return structuredClone(window.fixture);},invoke:async()=>({mode:'simulation',status:'pending'})});
  },{fixture,role});
  await page.getByRole('heading',{name:'Mensalidades Tâmo On'}).waitFor();
  await page.locator('[name=monthly-venue]').selectOption(fixture.invoices[0].venue_id);await page.locator('[name=monthly-month]').fill(fixture.invoices[0].competence.slice(0,7));
  await page.evaluate(()=>{document.activeElement.blur();window.filterNode=document.querySelector('[name=monthly-month]');filterNode.focus();fixture.invoices[0].status='paid';fixture.invoices[0].paid_at=new Date().toISOString();});
  await page.clock.runFor(10001);
  assert.match(await page.locator('.plan-invoice').innerText(),/Pagamento registrado/);assert.equal(await page.evaluate(()=>filterNode.isConnected&&document.activeElement===filterNode),true);
  assert.equal(await page.locator('[name=monthly-venue]').inputValue(),fixture.invoices[0].venue_id);
  assert.equal(await page.locator('[name=monthly-month]').inputValue(),fixture.invoices[0].competence.slice(0,7));
  assert.match(await page.locator('.plan-summary').innerText(),/300,00/);
  // Hidden pages pause reads, and returning to the tab refreshes immediately.
  const reads=await page.evaluate(()=>{hiddenForTest=true;return window.reads;});
  await page.clock.runFor(20001);assert.equal(await page.evaluate(()=>window.reads),reads);
  await page.evaluate(()=>{fixture.invoices[0].status='refunded';hiddenForTest=false;document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(()=>document.querySelector('.plan-invoice').textContent.includes('Devolvida'));
  // Transient errors preserve the last successful view.
  await page.evaluate(()=>fail=true);await page.clock.runFor(10001);assert.match(await page.locator('.plan-invoice').innerText(),/Devolvida/);await page.evaluate(()=>fail=false);
  if(role==='partner'){
   await page.evaluate(()=>{fixture.invoices[0].status='planned';fixture.invoices[0].paid_at=null;window.dispatchEvent(new Event('focus'));});
   await page.getByRole('button',{name:'Pagar mensalidade',exact:true}).waitFor();await page.getByRole('button',{name:'Pagar mensalidade',exact:true}).click();
   await page.getByRole('button',{name:'Simular pagamento desta mensalidade'}).waitFor();const before=await page.evaluate(()=>reads);await page.clock.runFor(10001);assert.equal(await page.evaluate(()=>reads),before);assert.equal(await page.locator('dialog[open]').count(),1);
   await page.getByRole('button',{name:'Fechar',exact:true}).click();
  }
  // Late replies cannot put another account's data back after identity changes.
  await page.evaluate(()=>{hold=true;document.activeElement.blur();window.dispatchEvent(new Event('focus'));});await page.waitForFunction(()=>pending.length===1);
  await page.evaluate(()=>{who='other';pending.shift()(structuredClone(fixture));document.body.append(document.createElement('span'));});
  await page.waitForFunction(()=>document.querySelector('#monthly').innerHTML==='');
  const stopped=await page.evaluate(()=>reads);await page.clock.runFor(30001);assert.equal(await page.evaluate(()=>reads),stopped);
  await page.close();
 }
 console.log('Monthly live finance passed: admin/partner refresh, filters, totals, visibility, modal, failures, stale account and disposal');
}finally{await browser.close();}

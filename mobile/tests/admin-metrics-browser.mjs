import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../../',import.meta.url),fixture=JSON.parse(await readFile(process.env.METRICS_FIXTURE||'/tmp/metrics-fixture.json','utf8'));
const browser=await chromium.launch(process.env.TAMOON_TEST_EXECUTABLE?{executablePath:process.env.TAMOON_TEST_EXECUTABLE}:{});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900},locale:'pt-BR',timezoneId:'America/Sao_Paulo'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<html lang="pt-BR"><body><main style="max-width:1200px;margin:auto;padding:16px"><h1>Métricas</h1><p>Ocupação, recebimentos e recorrência para acompanhar o seu espaço.</p><div id="metrics"></div></main></body></html>');
 for(const path of ['marketplace/styles.css','marketplace/metrics.css'])await page.addStyleTag({content:await readFile(new URL(path,root),'utf8')});
 await page.addScriptTag({content:await readFile(new URL('marketplace/metrics.js',root),'utf8')});
 await page.evaluate(f=>{window.fixture=f;window.who='admin';window.calls=[];window.pending=[];window.delay=false;window.fail=false;
 window.start=(admin=true)=>{window.controller?.dispose();window.controller=TamoonMetrics.mount(document.querySelector('#metrics'),{identity:()=>window.who,admin,partnerId:admin?null:f.partners[0].id,rpc:async(name,args)=>{window.calls.push({name,args});if(window.delay)return new Promise(resolve=>window.pending.push(resolve));if(window.fail)throw Error('network');return structuredClone(window.fixture);}});};window.start();},fixture);
 await page.getByText('Visão do período',{exact:true}).waitFor();assert.equal(await page.locator('.metrics-cards').first().locator('article').count(),4);
 await mkdir('/tmp/metrics-preview',{recursive:true});
 for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`No overflow at ${width}`);if([390,1280].includes(width))await page.screenshot({path:`/tmp/metrics-preview/metrics-${width}.png`,fullPage:true});}
 await page.locator('[name=from]').fill('2026-10-01');await page.locator('[name=to]').fill('2026-10-31');assert.equal(await page.locator('.metrics-results').innerText(),'');await page.getByRole('button',{name:'Atualizar métricas'}).click();await page.getByText('Visão do período',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>calls.at(-1).args.p_from),'2026-10-01');
 await page.locator('[name=partner]').selectOption(fixture.partners[0].id);await page.getByRole('button',{name:'Atualizar métricas'}).click();await page.getByText('Visão do período',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>calls.at(-1).args.p_partner_id),fixture.partners[0].id);
 await page.locator('[name=space]').selectOption(fixture.spaces[0].id);await page.getByRole('button',{name:'Atualizar métricas'}).click();await page.getByText('Visão do período',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>calls.at(-1).args.p_space_id),fixture.spaces[0].id);
 await page.evaluate(()=>window.fail=true);await page.getByRole('button',{name:'Atualizar métricas'}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByText('Visão do período',{exact:true}).count(),0);
 await page.evaluate(()=>window.fail=false);await page.getByRole('button',{name:'Atualizar métricas'}).click();await page.getByText('Visão do período',{exact:true}).waitFor();
 await page.evaluate(()=>window.delay=true);await page.getByRole('button',{name:'Atualizar métricas'}).click();await page.locator('[name=to]').fill('2026-10-15');await page.evaluate(()=>window.pending.shift()(window.fixture));assert.equal(await page.locator('.metrics-results').innerText(),'');
 await page.evaluate(()=>{window.delay=false;window.start(false);});await page.getByText('Visão do período',{exact:true}).waitFor();assert.equal(await page.locator('[name=partner]').count(),0);assert.equal(await page.evaluate(()=>calls.at(-1).args.p_partner_id),fixture.partners[0].id);
 await page.evaluate(()=>{window.fixture.current.hours.occupancy=null;window.fixture.current.hours.available=0;window.fixture.current.heat=[];});await page.getByRole('button',{name:'Atualizar métricas'}).click();await page.getByText('Nenhuma hora ofertada neste período.',{exact:false}).waitFor();
 await page.evaluate(()=>window.delay=true);await page.getByRole('button',{name:'Atualizar métricas'}).click();await page.evaluate(()=>{window.who='other';window.pending.shift()(window.fixture);document.body.append(document.createElement('span'));});await page.waitForFunction(()=>document.querySelector('#metrics').textContent==='');assert.equal(await page.locator('#metrics').innerText(),'');
 assert.deepEqual(errors,[]);console.log('PASS: metrics desktop/mobile, filters, partner mode, empty, failure/retry, stale responses and account switch');
}finally{await browser.close();}

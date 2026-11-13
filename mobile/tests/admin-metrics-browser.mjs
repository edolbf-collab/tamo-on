import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../../',import.meta.url),fixture=JSON.parse(await readFile(process.env.METRICS_FIXTURE||'/tmp/metrics-fixture.json','utf8'));
const browser=await chromium.launch(process.env.TAMOON_TEST_EXECUTABLE?{executablePath:process.env.TAMOON_TEST_EXECUTABLE}:{});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900},locale:'pt-BR',timezoneId:'America/Sao_Paulo'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<html lang="pt-BR"><body><main style="max-width:1200px;margin:auto;padding:16px"><h1>Métricas</h1><p>Ocupação, recebimentos e recorrência para acompanhar o seu espaço.</p><div id="metrics"></div></main></body></html>');
 for(const path of ['marketplace/styles.css','marketplace/metrics.css','marketplace/admin-daily.css','marketplace/admin-operations.css'])await page.addStyleTag({content:await readFile(new URL(path,root),'utf8')});
 await page.addScriptTag({content:await readFile(new URL('marketplace/metrics.js',root),'utf8')});
 await page.evaluate(f=>{window.fixture=f;window.who='admin';window.calls=[];window.pending=[];window.delay=false;window.fail=false;
 window.start=(admin=true)=>{window.controller?.dispose();window.controller=TamoonMetrics.mount(document.querySelector('#metrics'),{identity:()=>window.who,admin,partnerId:admin?null:f.partners[0].id,rpc:async(name,args)=>{window.calls.push({name,args});if(window.delay)return new Promise(resolve=>window.pending.push(resolve));if(window.fail)throw Error('network');const d=structuredClone(window.fixture);d.current.from=args.p_from;d.current.to=args.p_to;d.month_open=args.p_from.slice(0,7)===TamoonMetrics.currentMonth();return d;}});};window.start();},fixture);
 await page.getByText('Visão do período',{exact:true}).waitFor();assert.equal(await page.locator('.metrics-cards').first().locator('article').count(),4);
 assert.equal(await page.locator('input[type=date]').count(),0);
 assert.equal(await page.getByRole('button',{name:'Próximo mês',exact:true}).isDisabled(),true);
 assert.equal(await page.locator('.metrics-grid>article').count(),2);
 assert.equal(await page.locator('.metrics-bookings .metrics-cards>article').count(),4);
 const quiet=await page.locator('.metrics-quiet tbody tr').allTextContents();assert.ok(quiet[0].includes('0%'));assert.ok(!quiet.some(t=>t.includes('Sem agenda')));
 const sections=await page.locator('.metrics-results h2').allTextContents();assert.ok(sections.indexOf('Dias e horários menos ocupados')<sections.indexOf('Reservas e cancelamentos'));assert.ok(sections.indexOf('Reservas e cancelamentos')<sections.indexOf('Financeiro do período'));
 await mkdir('/tmp/metrics-preview',{recursive:true});
 for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`No overflow at ${width}`);if([390,1280].includes(width))await page.screenshot({path:`/tmp/metrics-preview/metrics-${width}.png`,fullPage:true});}
 await page.locator('[name=month]').fill('2026-10');assert.equal(await page.locator('.metrics-results').innerText(),'');await page.getByRole('button',{name:'Atualizar métricas'}).click();await page.getByText('Visão do período',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>calls.at(-1).args.p_from),'2026-10-01');
 await page.locator('[name=partner]').selectOption(fixture.partners[0].id);await page.getByRole('button',{name:'Atualizar métricas'}).click();await page.getByText('Visão do período',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>calls.at(-1).args.p_partner_id),fixture.partners[0].id);
 await page.locator('[name=space]').selectOption(fixture.spaces[0].id);await page.getByRole('button',{name:'Atualizar métricas'}).click();await page.getByText('Visão do período',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>calls.at(-1).args.p_space_id),fixture.spaces[0].id);
 await page.locator('[name=month]').fill('2024-02');await page.getByRole('button',{name:'Atualizar métricas',exact:true}).click();await page.getByText('Visão do período',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>calls.at(-1).args.p_to),'2024-02-29');
 await page.getByRole('button',{name:'Mês anterior',exact:true}).click();await page.getByText('Visão do período',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>calls.at(-1).args.p_from),'2024-01-01');
 await page.getByRole('button',{name:'Mês atual',exact:true}).click();await page.getByText('Mês em andamento:',{exact:false}).waitFor();
 await page.evaluate(()=>window.fail=true);await page.getByRole('button',{name:'Atualizar métricas'}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByText('Visão do período',{exact:true}).count(),0);
 await page.evaluate(()=>window.fail=false);await page.getByRole('button',{name:'Atualizar métricas'}).click();await page.getByText('Visão do período',{exact:true}).waitFor();
 await page.evaluate(()=>window.delay=true);await page.getByRole('button',{name:'Atualizar métricas'}).click();await page.locator('[name=month]').fill('2026-09');await page.evaluate(()=>window.pending.shift()(window.fixture));assert.equal(await page.locator('.metrics-results').innerText(),'');
 await page.evaluate(()=>{window.delay=false;window.start(false);});await page.getByText('Visão do período',{exact:true}).waitFor();assert.equal(await page.locator('[name=partner]').count(),0);assert.equal(await page.evaluate(()=>calls.at(-1).args.p_partner_id),fixture.partners[0].id);
 await page.evaluate(()=>{window.fixture.current.hours.occupancy=null;window.fixture.current.hours.available=0;window.fixture.current.heat=[];});await page.getByRole('button',{name:'Atualizar métricas'}).click();await page.getByText('Nenhuma hora ofertada neste período.',{exact:false}).waitFor();
 await page.evaluate(()=>window.delay=true);await page.getByRole('button',{name:'Atualizar métricas'}).click();await page.evaluate(()=>{window.who='other';window.pending.shift()(window.fixture);document.body.append(document.createElement('span'));});await page.waitForFunction(()=>document.querySelector('#metrics').textContent==='');assert.equal(await page.locator('#metrics').innerText(),'');
 // The central operations summary and embedded detailed console must follow both themes.
 await page.setContent('<html><body><main><div class="daily-root"><h2>Gestão do dia a dia</h2><nav class="daily-tabs"><button>Resumo</button><button aria-current="page">Consultas detalhadas</button></nav><div class="daily-metrics"><article><strong>2</strong><span>Parceiros</span></article></div><div class="ops-layout"><div class="ops-main"><h2>Parceiros</h2><div class="ops-filters"><label>Buscar<input></label></div><button class="ops-row">Arena de teste</button></div></div></div></main></body></html>');
 for(const path of ['marketplace/styles.css','marketplace/admin-daily.css','marketplace/admin-operations.css'])await page.addStyleTag({content:await readFile(new URL(path,root),'utf8')});
 const dark=await page.locator('.daily-root').evaluate(el=>getComputedStyle(el).backgroundColor);
 await page.evaluate(()=>document.documentElement.dataset.theme='light');
 assert.notEqual(await page.locator('.daily-root').evaluate(el=>getComputedStyle(el).backgroundColor),dark);
 for(const sel of ['.daily-root','.ops-layout'])assert.equal(await page.locator(sel).evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
 assert.equal(await page.locator('.daily-root').evaluate(el=>getComputedStyle(el).color),'rgb(16, 37, 27)');
 await page.screenshot({path:'/tmp/metrics-preview/operations-light.png',fullPage:true});
 await page.evaluate(()=>delete document.documentElement.dataset.theme);assert.equal(await page.locator('.daily-root').evaluate(el=>getComputedStyle(el).backgroundColor),dark);
 assert.deepEqual(errors,[]);console.log('PASS: metrics desktop/mobile, filters, partner mode, empty, failure/retry, stale responses and account switch');
}finally{await browser.close();}

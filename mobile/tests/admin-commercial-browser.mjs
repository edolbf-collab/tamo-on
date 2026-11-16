import {chromium} from 'playwright';import {readFile,mkdir} from 'node:fs/promises';import assert from 'node:assert/strict';
const root=new URL('../../',import.meta.url),fixture=JSON.parse(await readFile('/tmp/commercial-fixture.json','utf8'));
fixture.venues.sort((a,b)=>b.groups.length-a.groups.length);
const browser=await chromium.launch(process.env.TAMOON_TEST_EXECUTABLE?{executablePath:process.env.TAMOON_TEST_EXECUTABLE,args:['--no-sandbox']}:{});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900},locale:'pt-BR'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<html lang="pt-BR"><body><main style="max-width:1150px;margin:auto;padding:16px"><h1>Planos e mensalidades</h1><div id="plans"></div></main></body></html>');
 for(const file of ['marketplace/styles.css','marketplace/commercial-plans.css'])await page.addStyleTag({content:await readFile(new URL(file,root),'utf8')});
 await page.addScriptTag({content:await readFile(new URL('marketplace/commercial-plans.js',root),'utf8')});
 await page.evaluate(f=>{window.fixture=f;window.who='admin';window.calls=[];window.delay=false;window.pending=[];window.fail=false;
 window.start=()=>{window.controller?.dispose();window.controller=TamoonCommercialPlans.mount(document.querySelector('#plans'),{identity:()=>window.who,rpc:async(name,args)=>{calls.push({name,args});if(window.delay)return new Promise(resolve=>pending.push(resolve));if(window.fail)throw Error('network');if(name==='establishment_plan_activate'){fixture.venues.find(v=>v.id===args.p_venue_id).plan.state='ready';return {ok:true};}return structuredClone(fixture);}});};window.start();},fixture);
 await page.getByRole('heading',{name:'Mensalidades do estabelecimento'}).waitFor();assert.equal(await page.getByText('Aguardando associação do grupo',{exact:false}).count(),2);assert.equal(await page.getByRole('button',{name:'Simular primeiro pagamento (teste)'}).count(),0);
 await mkdir('/tmp/commercial-preview',{recursive:true});
 for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Overflow at ${width}`);await page.screenshot({path:`/tmp/commercial-preview/plans-${width}.png`,fullPage:true});}
 await page.evaluate(()=>{fixture.venues[0].plan.state='draft';window.start();});await page.getByRole('button',{name:'Salvar preparação'}).waitFor();
 await page.getByRole('button',{name:'Selecionar vínculos já importados'}).click();assert.equal(await page.locator('[name=group]:checked').count(),1);
 await page.locator('[name=reviewed]').check();await page.getByRole('button',{name:'Salvar preparação'}).click();await page.getByRole('button',{name:'Salvar preparação'}).waitFor();assert.ok(await page.evaluate(()=>calls.some(c=>c.name==='establishment_plan_save'&&c.args.p_groups.length===1)));
 await page.getByRole('button',{name:'Fechar carteira inicial'}).click();assert.match(await page.getByRole('status').innerText(),/Confirme/);assert.ok(!await page.evaluate(()=>calls.some(c=>c.name==='establishment_plan_activate')));
 await page.locator('[name=group]:checked').uncheck();await page.locator('[name=freeze]').check();await page.getByRole('button',{name:'Fechar carteira inicial'}).click();assert.match(await page.getByRole('status').innerText(),/Salve a preparação/);assert.ok(!await page.evaluate(()=>calls.some(c=>c.name==='establishment_plan_activate')));
 await page.getByRole('button',{name:'Selecionar vínculos já importados'}).click();
 await page.locator('[name=freeze]').check();await page.evaluate(()=>window.fail=true);await page.getByRole('button',{name:'Fechar carteira inicial'}).click();
 await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('Não foi possível'));
 assert.equal(await page.getByRole('button',{name:'Fechar carteira inicial'}).count(),1,'Failure keeps closing action available');
 await page.waitForFunction(()=>{const r=document.querySelector('[role=status]').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;});
 await page.evaluate(()=>window.fail=false);await page.getByRole('button',{name:'Fechar carteira inicial'}).click();
 await page.getByRole('heading',{name:'Importados preservados na carteira inicial'}).waitFor();
 await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('Carteira inicial fechada'));
 assert.equal(await page.getByRole('button',{name:'Fechar carteira inicial'}).count(),0);
 assert.ok(await page.evaluate(()=>calls.some(c=>c.name==='establishment_plan_activate')));
 assert.equal(await page.getByText('Aguardando associação do grupo',{exact:false}).count(),2,'Closing never accepts group associations');
 await page.screenshot({path:'/tmp/commercial-preview/plans-closed-pending.png',fullPage:true});
 await page.evaluate(()=>{fixture.admin=false;fixture.group_options=[];window.start();});await page.getByRole('heading',{name:'Mensalidades do estabelecimento'}).waitFor();assert.equal(await page.locator('.plan-form').count(),0);assert.equal(await page.getByRole('button',{name:'Simular primeiro pagamento (teste)'}).count(),0);
 await page.evaluate(()=>window.fail=true);await page.getByRole('button',{name:'Atualizar',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('Não foi possível'));assert.equal(await page.locator('.plan-content').innerText(),'');
 await page.evaluate(()=>{window.fail=false;window.delay=true;window.start();});await page.evaluate(()=>{window.who='other';pending.shift()(fixture);document.body.append(document.createElement('span'));});await page.waitForFunction(()=>document.querySelector('#plans').innerText==='');assert.deepEqual(errors,[]);
 console.log('Commercial UI passed: desktop/mobile, admin/partner, confirmation, errors and stale identity');
}finally{await browser.close();}

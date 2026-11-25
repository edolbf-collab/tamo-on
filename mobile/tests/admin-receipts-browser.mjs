import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch(process.env.TAMOON_TEST_EXECUTABLE?{executablePath:process.env.TAMOON_TEST_EXECUTABLE,args:['--no-sandbox']}: {});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.setContent('<main></main>');
 await page.addScriptTag({path:new URL('../../marketplace/monthly-finance.js',import.meta.url).pathname});
 await page.evaluate(()=>{
  window.model={admin:false,test_mode:true,readonly:false,today:'2026-11-25',invoices:[],venues:[{id:'arena',name:'Arena Central',partner:'Parceiro',receipts:'off'}]};
  window.calls=[];
  window.consoleView=window.TamoonMonthlyFinance.mount(document.querySelector('main'),{
    identity:()=>'test',rpc:async(name,args)=>{
     if(name==='establishment_finance_read')return structuredClone(window.model);
     window.calls.push(args);window.model.venues[0].receipts=args.p_action==='off'?'off':'requested';
     return {state:window.model.venues[0].receipts};
    },invoke:async(name,args)=>{window.calls.push({name,...args});window.model.venues[0].receipts='on';return {state:'on'};}
  });
 });
 await page.getByText('Solicitar ativação',{exact:true}).click();
 await page.getByRole('button',{name:'Solicitar recebimentos'}).click();
 assert.equal(await page.evaluate(()=>window.calls.length),0);
 await page.getByLabel('Tipo de empresa').selectOption('LIMITED');
 await page.getByLabel('Faturamento mensal declarado').fill('14500');
 await page.getByLabel('Aceito os custos').check();
 await page.getByRole('button',{name:'Solicitar recebimentos'}).click();
 await page.getByText('Aguardando autorização',{exact:true}).first().waitFor();
 assert.equal(await page.evaluate(()=>window.calls[0].p_terms),'receipts-v1');
 await page.evaluate(()=>{window.model.admin=true;});
 await page.getByRole('button',{name:'Atualizar mensalidades'}).click();
 await page.getByRole('button',{name:'Autorizar ativação'}).click();
 await page.getByText('Ativo',{exact:true}).first().waitFor();
 await page.getByText('Desligar recebimentos',{exact:true}).click();
 await page.getByRole('button',{name:'Confirmar',exact:true}).click();
 await page.getByText('Desativado',{exact:true}).first().waitFor();
 await page.evaluate(()=>{window.model.readonly=true;window.model.admin=false;});
 await page.getByRole('button',{name:'Atualizar mensalidades'}).click();
 assert.equal(await page.getByText('Solicitar ativação',{exact:true}).count(),0);
 console.log('Financeiro em tela móvel: aceite, solicitação, autorização, desligamento e perfil de consulta verificados.');
} finally {await browser.close();}

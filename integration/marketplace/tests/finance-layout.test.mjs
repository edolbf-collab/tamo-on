import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=name=>fs.readFileSync(new URL('../../../marketplace/'+name,import.meta.url),'utf8');
const app=read('app.js');
const between=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));
const ui={};vm.runInNewContext(read('partner-finance-view.js'),ui);
const money=value=>`R$ ${Number(value||0).toFixed(2)}`;
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function model(admin,partnerId=null){
 return {admin,finance:{partnerId,reservationBreakdown:[]},period:'2026-10',tab:'reservations',position:{},reservations:[],
  data:{basis:'payment_date',entries:[],receipts:[
   {payment_id:'p1',reservation_id:'r1',partner_id:'a',reservation_code:'RES-A',received_total:100,asaas_fee_total:2,commission_total:6,partner_net:92},
   {payment_id:'p2',reservation_id:'r2',partner_id:'b',reservation_code:'RES-B',received_total:200,asaas_fee_total:3,commission_total:12,partner_net:185,fee_source:'estimated'}]},
  helpers:{esc:escape,money,periodLabel:()=> 'outubro de 2026',channelLabel:String,statusLabel:String,holds:()=>[]}};
}
test('the four financial cards keep the selected partner scope and estimated-fee disclosure',()=>{
 const combined=ui.PartnerFinanceView.render({...model(true),summaryOnly:true});
 assert.equal((combined.match(/<article /g)||[]).length,4);
 assert.match(combined,/R\$ 300\.00/);assert.match(combined,/R\$ 277\.00/);
 assert.match(combined,/Inclui R\$ 3\.00 estimados/);assert.match(combined,/outubro de 2026/);
 const selected=ui.PartnerFinanceView.render({...model(true,'a'),summaryOnly:true});
 const partner=ui.PartnerFinanceView.render({...model(false,'a'),summaryOnly:true});
 for(const markup of [selected,partner]){
  assert.match(markup,/R\$ 100\.00/);assert.match(markup,/R\$ 92\.00/);assert.doesNotMatch(markup,/R\$ 300\.00/);
 }
});
test('moving the cards leaves financial tabs and actions available without duplicate indicators',()=>{
 const m=model(true),body=ui.PartnerFinanceView.render({...m,omitSummary:true});
 assert.doesNotMatch(body,/class="pf-metric /);assert.match(body,/Créditos no Asaas/);
 assert.equal((body.match(/role="tab"/g)||[]).length,4);
 assert.match(body,/finance-reservation-open/);assert.match(body,/export-reservation-payment-audit/);
});
test('both financial pages put the metrics before exports and filters in document order',()=>{
 const c={state:{filters:{},adminPartners:[]},esc:escape,backendIsOnline:()=>true,
  financeScreenIdentity:()=> 'owner',financialPeriodPanel:summary=>summary?'METRICS':'DETAILS',financePeriodToolbar:()=>'<div>PERIOD</div>'};
 vm.createContext(c);
 for(const [start,end] of [['  function pageHeader(', '  function stat('],['  function partnerFinance(', '  function partnerUploadDocumentTypes('],['  function adminFinance(', '  function adminSettings(']])vm.runInContext(between(start,end),c);
 for(const render of [c.partnerFinance,c.adminFinance]){
  const html=render();assert.ok(html.indexOf('Financeiro')<html.indexOf('METRICS'));
  assert.ok(html.indexOf('METRICS')<html.indexOf('Exportar posição atual'));
  assert.ok(html.indexOf('METRICS')<html.indexOf('PERIOD'));
  assert.equal((html.match(/METRICS/g)||[]).length,1);assert.match(html,/Cancelamentos e restituições/);
 }
});
test('changing period or receiving an error never shows metrics from an old financial query',()=>{
 const queued=[],c={financePeriodSelection:()=> '2026-11',financePeriodKey:()=> 'new',
  financialPeriodRuntime:{key:'old',data:{},error:''},queueMicrotask:fn=>queued.push(fn),loadFinancialPeriod(){},esc:escape};
 vm.createContext(c);vm.runInContext(between('  function financialPeriodPanel(', '  function exportFinancialPeriod('),c);
 assert.equal(c.financialPeriodPanel(true),'');assert.equal(queued.length,0);
 assert.match(c.financialPeriodPanel(),/Carregando pagamentos/);assert.equal(queued.length,1);
 c.financialPeriodRuntime={key:'new',data:null,error:'Falha temporária'};
 assert.equal(c.financialPeriodPanel(true),'');assert.match(c.financialPeriodPanel(),/Tentar novamente/);
});
test('a changed summary refreshes independently while preserving open details and focus',()=>{
 const root={style:{},getBoundingClientRect:()=>({height:400})},host={financeMarkup:'DETAILS',innerHTML:'DETAILS',closest:()=>root};
 const summary={financeMarkup:'OLD',innerHTML:'OLD'};let restored=0;
 const c={state:{activePage:{admin:'finance'},role:'admin'},document:{getElementById:id=>id==='financeMovementsHost'?host:summary},
  financialPeriodPanel:only=>only?'NEW':'DETAILS',captureFinanceScreen:()=>({open:['reservation'],focus:'export'}),
  restoreFinanceScreen:(r,previous)=>{assert.equal(r,root);assert.equal(previous.focus,'export');restored++}};
 vm.createContext(c);vm.runInContext(between('  function refreshFinancialPeriodPanel(', '  function financePeriodSelection('),c);
 c.refreshFinancialPeriodPanel();assert.equal(summary.innerHTML,'NEW');assert.equal(host.innerHTML,'DETAILS');assert.equal(restored,1);
 c.refreshFinancialPeriodPanel();assert.equal(restored,1);
});

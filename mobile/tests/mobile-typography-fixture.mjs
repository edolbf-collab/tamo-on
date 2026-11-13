// Synthetic QA only. Uses production styles, navigation and metric/finance renderers.
import {readFile} from 'node:fs/promises';
const root=new URL('../../',import.meta.url);
export const read=p=>readFile(new URL(p,root),'utf8');
export async function typographyFixture(mode='market',withFix=true){
 const entry=mode==='market'?'marketplace/index.html':'index.html';
 const html=await read(entry),base=mode==='market'?'marketplace/':'';
 const paths=[...html.matchAll(/<link rel="stylesheet" href="([^"?]+)(?:[^" ]*)"/g)].map(m=>m[1].startsWith('/')?m[1].slice(1):base+m[1]);
 const css=await Promise.all(paths.filter(p=>withFix||!p.endsWith('mobile-layout.css')).map(read));
 const scripts=await Promise.all(['marketplace/admin-operations.js','marketplace/admin-daily.js','marketplace/metrics.js','marketplace/partner-finance-view.js'].map(read));
 const fixture=JSON.parse(await readFile(process.env.METRICS_FIXTURE||'/tmp/metrics-fixture.json','utf8'));
 const money='R$\u00a01.234.567,89';
 const community=`<section><h2>Comunidade · Caixa e indicadores</h2>
 <div class="metrics"><article class="card metric"><strong>123.456</strong><small>Participações</small></article><article class="card metric"><strong>98,5%</strong><small>Confirmações</small></article></div>
 <div class="admin-stats"><article class="admin-stat"><strong>123.456</strong><small>Notificações</small></article><article class="admin-stat"><strong>123.456</strong><small>Participações</small></article></div>
 <article class="card balance-card"><small>Saldo da comunidade</small><h2>${money}</h2><div class="balance-grid"><div><small>Recebimentos previstos</small><strong>${money}</strong></div><div><small>Total de despesas</small><strong>- ${money}</strong></div></div></article>
 <div class="finance-summary-grid"><div><small>Recebimentos do mês</small><strong>${money}</strong></div><div><small>Saldo a receber</small><strong>- ${money}</strong></div></div>
 <div class="card finance-row"><div class="finance-icon">$</div><div class="list-main"><strong>Cobrança do grupo</strong><small>Conferência dos membros</small></div><div class="finance-value-bubble"><strong class="money">${money}</strong><small>Pagamento confirmado</small></div></div>
 </section>`;
 const market=`<section id="metrics"></section><section id="finance"></section>
 <section class="refund-page"><h2>Devoluções</h2><div class="stats-grid refund-summary"><div class="stat"><strong>${money}</strong><span>Restituições pendentes</span></div><div class="stat"><strong>123.456</strong><span>Solicitações em análise</span></div></div><article class="card refund-row"><h3>Reserva de teste</h3><div class="refund-row-dates"><span>Solicitação</span><strong>13/11/2026</strong></div><div class="refund-row-value"><span>Valor solicitado</span><strong>${money}</strong></div><button class="button">Consultar devolução</button></article></section>
 <section class="reservation-list"><h2>Reservas e cotas</h2><article class="reservation-card"><div class="reservation-date">13</div><div class="reservation-card-main"><div class="reservation-card-heading"><h2>Quadra de teste</h2><span class="status">Aguardando pagamento</span></div><div class="reservation-total-line"><span>Valor total</span><strong>${money}</strong></div></div><div class="reservation-card-actions"><button class="button">Confirmar e pagar depois</button><button class="button">Pagar minha cota</button><button class="button">Consultar mensalidade</button></div></article></section>
 <div class="monthly-period-card"><div class="monthly-period-heading"><h3>Mensalidade da quadra</h3><div class="monthly-period-price"><span>Valor mensal</span><strong>${money}</strong></div></div><div class="monthly-period-next"><p>Próximo pagamento da reserva.</p><div class="item-actions"><button class="button">Pagar antecipadamente</button><button class="button">Consultar condições</button></div></div></div>
 <div class="finance-period-toolbar"><div class="item-actions"><button class="button">‹</button><button class="button">Mês atual</button><button class="button">›</button><button class="button">Todo o período</button></div></div>`;
 return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(s=>'<style>'+s+'</style>').join('')}</head><body><div class="app-shell"><main class="${mode==='market'?'content':'main-content'}"><h1>Revisão mobile · ${mode==='market'?'Marketplace':'Comunidade'}</h1><div id="daily"></div>${mode==='market'?market:community}<p class="qa-prose">As descrições continuam legíveis e podem ocupar mais de uma linha. Esta é uma mensagem de exemplo para conferir o conteúdo explicativo.</p></main></div>${scripts.map(s=>'<script>'+s+'</script>').join('')}<script>
 const mode=${JSON.stringify(mode)};
 const rpc=async(name,args)=> name==='admin_operations_directory'?{items:[],total:0,page:1}: {counts:{},items:[],total:0};
 TamoonAdminDaily.mount(document.querySelector('#daily'),{mode,rpc,identity:()=> 'synthetic-admin'});
 document.querySelector('[data-daily-view="details"]').click();
 if(mode==='community'){const modal=document.createElement('div');modal.className='modal';modal.style.margin='0 auto';const content=document.createElement('div');content.className='modal-content';modal.append(content);content.append(document.querySelector('#daily'));document.body.prepend(modal);}
 if(mode==='market'){
 const fixture=${JSON.stringify(fixture)};
 fixture.current.cash.received=1234567.89;fixture.current.balances.pending=1234567.89;fixture.current.cash.refunded=2469135.78;
 TamoonMetrics.mount(document.querySelector('#metrics'),{admin:true,rpc:async()=>fixture,identity:()=> 'synthetic-admin'});
 const model={admin:true,summaryOnly:true,finance:{reservationBreakdown:[]},period:'2026-11',position:{},data:{basis:'payment_date',entries:[],receipts:[{payment_id:'test',reservation_id:'test-reservation',received_total:1234567.89,partner_net:1234567.89}]},helpers:{esc:String,money:v=>Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),periodLabel:()=> 'Novembro de 2026'}};
 document.querySelector('#finance').innerHTML=PartnerFinanceView.render(model);
 }
 </script></body></html>`;
}
export const lineSelectors=[
 '.ops-nav button','.daily-tabs button','.reservation-card-heading .status','.metrics-cards .card>span','.metrics-cards strong',
 '.pf-metric>span','.pf-metric>strong','.stat strong','.stat>span','.refund-row-value strong',
 '.reservation-card-actions .button','.monthly-period-next .button','.monthly-period-price>strong',
 '.reservation-total-line strong','.finance-period-toolbar .button','.metric strong','.metric small',
 '.admin-stat strong','.admin-stat small','.balance-card h2','.balance-grid strong','.balance-grid small',
 '.finance-summary-grid strong','.finance-summary-grid small','.finance-value-bubble strong','.finance-value-bubble small'
].join(',');

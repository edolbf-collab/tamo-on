(function(root){
 'use strict';
 const labels={pending_review:'Em análise',waiting_funds:'Aguardando saldo',approved:'Aprovada para execução',processing:'Em processamento',completed:'Concluída'};
 const defaults=()=>({status:'pending',partner:'',period:'all',search:''});
 const amount=value=>Math.max(0,Number(value)||0);
 const pending=row=>row.status!=='completed';
 const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim();
 const day=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
 function select(rows,filters=defaults(),now=Date.now()){
  const query=normalize(filters.search);
  return rows.filter(row=>{
   if(filters.status==='pending'&&!pending(row))return false;
   if(filters.status!=='pending'&&filters.status!=='all'&&row.status!==filters.status)return false;
   if(filters.partner&&row.partner_name!==filters.partner)return false;
   if(query&&!normalize(row.reservation_code).includes(query))return false;
   const requested=Date.parse(row.requested_at);
   if(filters.period==='today'&&(!Number.isFinite(requested)||day(requested)!==day(now)))return false;
   if(['7','30','90'].includes(filters.period)&&(!Number.isFinite(requested)||requested<now-Number(filters.period)*86400000||requested>now))return false;
   return true;
  }).sort((a,b)=>Number(!!(pending(b)&&b.attention))-Number(!!(pending(a)&&a.attention))
    ||(Date.parse(a.requested_at)||0)-(Date.parse(b.requested_at)||0)
    ||String(a.reservation_id).localeCompare(String(b.reservation_id)));
 }
 function summary(rows){
  const open=rows.filter(pending);
  return {pending:open.length,waiting:open.filter(r=>r.status==='waiting_funds').length,
   processing:open.filter(r=>r.status==='processing').length,
   amount:open.reduce((n,r)=>n+Math.round(amount(r.pending)*100),0)/100};
 }
 // Private data and filters stay in memory, scoped to the current admin identity.
 // Losing access also invalidates outstanding reads, including A -> B -> A switches.
 function createStore({context,fetchRows,onChange,errorMessage=()=> 'Não foi possível atualizar as devoluções.'}){
  let epoch=0,scope='',task=null;
  let state;
  function reset(key=''){epoch++;scope=key;task=null;state={rows:null,loading:false,error:'',filters:defaults(),page:1,updatedAt:null};}
  reset();
  function sync(){
   const key=context()||'';
   if(key!==scope)reset(key);
   return key;
  }
  function get(){sync();return state;}
  function clear(){reset();onChange();}
  function setFilters(changes){
   if(!sync())return;
   const next={...state.filters};
   if('search' in changes)next.search=String(changes.search).slice(0,80);
   if('partner' in changes)next.partner=String(changes.partner);
   if(['pending','all',...Object.keys(labels)].includes(changes.status))next.status=changes.status;
   if(['all','today','7','30','90'].includes(changes.period))next.period=changes.period;
   state.filters=next;state.page=1;onChange();
  }
  function setPage(page){if(!sync())return;state.page=Math.max(1,Math.floor(Number(page)||1));onChange();}
  async function load(force=false){
   const key=sync();
   if(!key)return;
   if(task)return task;
   if(!force&&(state.rows!==null||state.error))return;
   const version=++epoch;
   state.loading=true;state.error='';
   // Install the pending request before notifying the view, which may render again.
   task=Promise.resolve().then(fetchRows).then(rows=>{
    if(sync()!==key||epoch!==version)return;
    if(!Array.isArray(rows))throw Error('Invalid refund directory');
    state.rows=rows;state.updatedAt=new Date().toISOString();
   }).catch(error=>{
    if(sync()!==key||epoch!==version)return;
    state.rows=null;state.updatedAt=null;state.error=errorMessage(error);
   }).finally(()=>{
    if(sync()!==key||epoch!==version)return;
    task=null;state.loading=false;onChange();
   });
   onChange();
   return task;
  }
  return {get,load,setFilters,setPage,clear};
 }
 function status(row,esc){
  const style={waiting_funds:'warning',approved:'ok',processing:'info',completed:'ok'}[row.status]||'neutral';
  return '<span class="status status-'+style+'">'+esc(labels[row.status]||'Em conferência')+'</span>';
 }
 function renderPage(model,{esc,money,date,now=Date.now()}){
  const rows=model.rows||[],filters=model.filters||defaults(),visible=select(rows,filters,now),totals=summary(visible);
  const pageSize=15,pages=Math.max(1,Math.ceil(visible.length/pageSize)),page=Math.min(model.page||1,pages);
  const slice=visible.slice((page-1)*pageSize,page*pageSize);
  const option=(value,label,selected)=>'<option value="'+esc(value)+'"'+(selected===value?' selected':'')+'>'+esc(label)+'</option>';
  const partners=[...new Set(rows.map(r=>r.partner_name).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  if(filters.partner&&!partners.includes(filters.partner))partners.unshift(filters.partner);
  const known=model.rows!==null;
  const metric=(value,label)=>'<div class="stat"><strong>'+esc(known?value:'—')+'</strong><span>'+label+'</span></div>';
  const filtersActive=Object.keys(defaults()).some(k=>filters[k]!==defaults()[k]);
  return '<section class="refund-page" aria-label="Acompanhamento de devoluções" aria-busy="'+!!model.loading+'">'
   +'<div class="stats-grid refund-summary" aria-label="Resumo da seleção">'
   +metric(totals.pending,'Pedidos pendentes')+metric(totals.waiting,'Aguardando saldo')
   +metric(totals.processing,'Em processamento')+metric(money(totals.amount),'Total a devolver')+'</div>'
   +'<section class="card refund-filters" aria-label="Filtrar devoluções">'
   +'<label class="refund-search">Buscar reserva<input id="refundSearch" data-refund-filter="search" type="search" maxlength="80" placeholder="Código da reserva" value="'+esc(filters.search)+'"></label>'
   +'<label>Situação<select id="refundStatus" data-refund-filter="status">'+option('pending','Todas as pendentes',filters.status)+option('all','Todas as situações',filters.status)+Object.entries(labels).map(([value,label])=>option(value,label,filters.status)).join('')+'</select></label>'
   +'<label>Parceiro<select id="refundPartner" data-refund-filter="partner">'+option('','Todos os parceiros',filters.partner)+partners.map(p=>option(p,p,filters.partner)).join('')+'</select></label>'
   +'<label>Solicitado em<select id="refundPeriod" data-refund-filter="period">'+[['all','Todo o período'],['today','Hoje'],['7','Últimos 7 dias'],['30','Últimos 30 dias'],['90','Últimos 90 dias']].map(([v,l])=>option(v,l,filters.period)).join('')+'</select></label>'
   +'<div class="refund-filter-note"><span>O resumo acompanha os filtros selecionados.</span>'+(filtersActive?'<button class="button ghost small" data-action="admin-refund-clear">Limpar filtros</button>':'')+'</div></section>'
   +'<div class="refund-list-heading"><div><h2>Pedidos de devolução</h2><p role="status">'+(model.loading?'Atualizando devoluções…':model.error?'Consulta indisponível':visible.length+' pedido(s) nesta seleção')+'</p></div>'
   +(model.updatedAt?'<small>Atualizado em '+esc(date(model.updatedAt))+'</small>':'')+'</div>'
   +(model.error?'<div class="callout" role="alert"><p>'+esc(model.error)+'</p><button class="button secondary" data-action="admin-refund-refresh">Tentar novamente</button></div>':'')
   +(known?'<div class="refund-list">'+slice.map(r=>'<article class="card refund-row" data-ui-key="refund-'+esc(r.reservation_id)+'">'
    +'<div class="refund-row-title"><h3>'+esc(r.reservation_code)+'</h3><p>'+esc(r.partner_name)+'</p>'+status(r,esc)+'</div>'
    +'<div class="refund-row-dates"><span>Solicitado em</span><strong>'+esc(date(r.requested_at))+'</strong>'
    +(pending(r)&&r.attention?'<span class="refund-attention">Acompanhamento pendente</span>':r.follow_up_at&&pending(r)?'<small>Próximo acompanhamento: '+esc(date(r.follow_up_at))+'</small>':'')+'</div>'
    +'<div class="refund-row-value"><span>Valor pendente</span><strong>'+money(amount(r.pending))+'</strong></div>'
    +'<button class="button secondary small" data-action="admin-refund-details" data-reservation-id="'+esc(r.reservation_id)+'" aria-label="Ver detalhes de '+esc(r.reservation_code)+'">Ver detalhes</button></article>').join('')
    +(!visible.length?'<div class="card refund-empty"><h3>'+(rows.length?'Nenhum pedido nesta seleção':'Nenhuma devolução registrada')+'</h3><p>'+(rows.length?'Ajuste os filtros para consultar outros pedidos.':'Os pedidos aparecerão aqui quando houver valores a devolver.')+'</p>'+(rows.length?'<button class="button secondary small" data-action="admin-refund-clear">Ver pendentes</button>':'')+'</div>':'')+'</div>':'')
   +(pages>1?'<nav class="refund-pagination" aria-label="Páginas de devoluções"><button class="button secondary small" data-action="admin-refund-page" data-page="'+(page-1)+'"'+(page===1?' disabled':'')+'>Anterior</button><span>Página '+page+' de '+pages+'</span><button class="button secondary small" data-action="admin-refund-page" data-page="'+(page+1)+'"'+(page===pages?' disabled':'')+'>Próxima</button></nav>':'')
   +'<p class="field-help refund-operational-note">Pedidos com acompanhamento pendente aparecem primeiro. O destaque é um alerta operacional; o prazo aplicável é conferido em cada caso.</p></section>';
 }
 function renderDetails(r,{esc,money,date}){
  const channels={asaas_pix:'Pix',asaas_card:'Cartão',external:'Pagamento externo',cash:'Dinheiro'};
  const line=(label,value)=>'<div class="detail-line"><span>'+label+'</span><strong>'+value+'</strong></div>';
  return '<section class="refund-details">'+status(r,esc)+'<p>'+esc(r.partner_name)+'</p>'
   +line('Solicitado em',esc(date(r.requested_at)))+line('Valor previsto',money(amount(r.required)))
   +line('Devolução confirmada',money(amount(r.refunded)))+line('Valor pendente',money(amount(r.pending)))
   +'<h3>Motivo do pedido</h3><p class="refund-text">'+esc(r.reason||'Restituição solicitada')+'</p>'
   +'<h3>Acompanhamento</h3>'+line('Responsável',esc(r.assigned_to||'Ainda não atribuído'))
   +(r.follow_up_at&&pending(r)?line('Próximo acompanhamento',esc(date(r.follow_up_at))):'')
   +(r.note?'<p class="refund-text">'+esc(r.note)+'</p>':'')
   +'<h3>Pagamentos envolvidos</h3><div class="refund-payments">'+(r.payments||[]).map(p=>'<article class="card"><strong>'+esc(p.payer)+'</strong><p>'+esc(channels[p.channel]||'Pagamento externo')+'</p>'+line('Pago',money(amount(p.amount)))+line('Devolvido',money(amount(p.refunded)))+'</article>').join('')+'</div>'
   +(pending(r)?'<div class="dialog-actions">'+(r.status!=='processing'?'<button class="button secondary" data-action="admin-refund-review" data-reservation-id="'+esc(r.reservation_id)+'">Registrar análise</button>':'')+'<button class="button primary" data-action="asaas-refund-open" data-reservation-id="'+esc(r.reservation_id)+'">Conferir pagamentos e saldos</button></div>':'')
   +(r.status==='approved'?(r.payments||[]).filter(p=>p.choice_id&&!['asaas_pix','asaas_card'].includes(p.channel)&&amount(p.amount)>amount(p.refunded)).map(p=>'<button class="button secondary small" data-action="cancellation-cash-refund" data-choice-id="'+esc(p.choice_id)+'">Registrar devolução externa · '+money(amount(p.amount)-amount(p.refunded))+'</button>').join(''):'')
   +((r.history||[]).length?'<details class="refund-history"><summary>Histórico administrativo ('+r.history.length+')</summary>'+r.history.map(h=>'<article><strong>'+esc(date(h.at))+' · '+esc(h.actor)+'</strong><p>'+esc(labels[h.status]||h.status)+'</p><p class="refund-text">'+esc(h.note)+'</p></article>').join('')+'</details>':'')
   +(pending(r)?'<p class="field-help">A aprovação registra a análise. A execução ocorre na conferência de pagamentos e saldos, e a conclusão depende da confirmação da devolução.</p>':'')+'</section>';
 }
 root.MarketplaceRefundReview={labels,defaults,select,summary,createStore,renderPage,renderDetails};
})(typeof window==='undefined'?globalThis:window);

(function (root) {
  'use strict';
  const amount = value => Number(value || 0);
  const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
  const tabs = [['reservations','Por reserva'],['movements','Histórico'],['returns','Devoluções e pendências'],['payouts','Créditos e taxas']];
  const channelName=(channel,h)=>channel==='external'?'Pagamento externo ao parceiro':h.channelLabel(channel);
  function receiptTotals(rows) {
    const keys=['received_total','refund_completed','asaas_fee_total','commission_total','liquidated_value','unliquidated_value','partner_net'];
    const result=Object.fromEntries(keys.map(k=>[k,0]));
    for(const row of rows)for(const key of keys)result[key]+=Math.round(amount(row[key])*100);
    for(const key of keys)result[key]/=100;
    return result;
  }
  function result(values) {
    return {base:amount(values.received_total),fee:amount(values.asaas_fee_total),commission:amount(values.commission_total),
      net:amount(values.partner_net),returned:amount(values.refund_completed),held:amount(values.unliquidated_value)};
  }
  function paymentDate(value) {
    if(!value)return 'Data não informada';
    const date=new Date(value);if(Number.isNaN(date.getTime()))return 'Data não informada';
    return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(date);
  }
  function dateOnly(value) {
    if(typeof value!=='string')return 'Não informada';
    const parts=value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!parts)return 'Não informada';
    const d=new Date(value+'T12:00:00Z');
    if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==value)return 'Não informada';
    return `${parts[3]}/${parts[2]}/${parts[1]}`;
  }
  function receiptDate(p) {
    const date=dateOnly(p.payment_date);return date==='Não informada'?'Data não informada':date;
  }
  function creditInfo(p) {
    const provider=['asaas_card','asaas_pix'].includes(p.channel);
    if(!provider)return {label:'Recebido diretamente pelo parceiro',dateLabel:'',date:'',note:'Pagamento externo; não depende de crédito no Asaas.'};
    if(p.cash_availability==='simulated'||p.credit_date_source==='simulated')return {label:'Pagamento simulado',dateLabel:'',date:'',note:'Sem previsão de crédito real.'};
    if(p.payment_status==='refunded'||(amount(p.received_total)>0&&amount(p.refund_completed)>=amount(p.received_total)))return {label:'Pagamento devolvido',dateLabel:'',date:'',note:'Não há crédito a receber deste pagamento. Consulte as taxas vinculadas.'};
    const conflict=p.credit_date_source==='conflicting_evidence';
    if(p.cash_availability==='received')return {label:p.issuer_mode==='partner'?'Crédito confirmado na subconta':'Crédito confirmado no Asaas',dateLabel:'Data do crédito',date:conflict?'A conferir':dateOnly(p.credit_received_date),note:p.issuer_mode==='partner'?'Crédito na subconta do parceiro. Os saques e movimentações posteriores são consultados no Asaas.':'Cobrança anterior ao split; a destinação ao parceiro exige conciliação.'};
    return {label:p.cash_availability==='awaiting_credit'?'Aguardando crédito do Asaas':'Disponibilidade no Asaas a confirmar',dateLabel:'Previsão de crédito',date:conflict?'A conferir':dateOnly(p.credit_expected_date),note:conflict?'O Asaas informou datas divergentes. A previsão precisa ser conferida.':p.issuer_mode==='partner'?'Previsão de crédito na subconta do parceiro. A comissão é destinada ao Tâmo On pelo split.':'Previsão informada pelo Asaas. Esta cobrança é anterior ao split.'};
  }
  function creditSummary(p) {
    const c=creditInfo(p);return c.label+(c.dateLabel?` · ${c.dateLabel}: ${c.date}`:'');
  }
  function creditHtml(p,h) {
    const c=creditInfo(p),e=h.esc;
    return `<div class="pf-credit"><strong>${e(c.label)}</strong>${c.dateLabel?`<span>${e(c.dateLabel)}: <b>${e(c.date)}</b></span>`:''}<p class="pf-note">${e(c.note)}</p></div>`;
  }
  function dateSource(p) {
    if(p.date_source==='conflicting_evidence')return 'Datas divergentes; requer conferência';
    if(p.date_source==='recorded_paid_at')return 'Data registrada no sistema';
    return p.payment_date?'Data informada pelo Asaas':'Data pendente de comprovação';
  }
  function receiptCsv(data) {
    return [['Reserva','Parceiro','Pagamento','Data do pagamento (Brasília)','Mês da entrada','Canal','Recebido','Devolvido até agora','Taxas vinculadas','Comissão vinculada','Pendente de conclusão ou devolução','Líquido calculado','Atualizado em','Origem da data','Situação do crédito','Previsão de crédito Asaas','Crédito confirmado em','Origem da data do crédito','Conta emissora','Situação do split','Comissão original do split','Comissão devolvida pelo split'],
      ...(data.receipts||[]).map(p=>[p.reservation_code,p.partner_name,p.payment_id,receiptDate(p),p.payment_month||'Sem data',p.channel,
        p.received_total,p.refund_completed,p.asaas_fee_total,p.commission_total,p.unliquidated_value,p.partner_net,paymentDate(data.generated_at),dateSource(p),creditInfo(p).label,creditInfo(p).dateLabel==='Previsão de crédito'?creditInfo(p).date:'',creditInfo(p).dateLabel==='Data do crédito'?creditInfo(p).date:'',p.credit_date_source||'unconfirmed',p.issuer_mode==='partner'?'Subconta do parceiro':(['asaas_pix','asaas_card'].includes(p.channel)?'Conta principal (histórico)':''),p.issuer_mode==='partner'?(p.split_status||'A confirmar'):'',p.issuer_mode==='partner'?p.split_commission_original:'',p.issuer_mode==='partner'?p.split_commission_refunded:''])];
  }
  function reservationCsv(data,audit,reservationId,payerName=()=>'',partnerId=null) {
    if(!reservationId||data?.basis!=='payment_date'||!Array.isArray(data.receipts)||!Array.isArray(audit?.payments)||!audit.reservation?.reservation_code)throw Error('Resposta financeira incompleta. Atualize a consulta e tente novamente.');
    const receipts=data.receipts.filter(p=>p.reservation_id===reservationId);
    if(!receipts.length)throw Error('Nenhum pagamento recebido disponível para esta reserva.');
    const ids=new Set(),sources=new Map();
    for(const p of audit.payments){
      if(!p.id||sources.has(p.id))throw Error('Pagamentos de origem inconsistentes. Atualize a consulta.');
      sources.set(p.id,p);
    }
    const cents=value=>Math.round(Number(value)*100);
    for(const p of receipts){
      if(!p.payment_id||ids.has(p.payment_id)||p.reservation_code!==audit.reservation.reservation_code||(partnerId&&p.partner_id!==partnerId))throw Error('Vínculo financeiro inconsistente. Atualize a consulta.');
      ids.add(p.payment_id);
      for(const field of ['received_total','refund_completed','asaas_fee_total','commission_total','unliquidated_value','partner_net']){
        if(p[field]==null||p[field]===''||!Number.isFinite(Number(p[field])))throw Error('Valores financeiros incompletos. Atualize a consulta.');
      }
      const origin=sources.get(p.payment_id);
      if(!origin||(origin.reservation_id&&origin.reservation_id!==reservationId)||!Number.isFinite(Number(origin.amount))||origin.amount==null||origin.amount===''||cents(origin.amount)!==cents(p.received_total)||cents(origin.refunded_amount||0)!==cents(p.refund_completed))throw Error('Os pagamentos foram atualizados durante a consulta. Tente novamente.');
    }
    // Only received/refunded payments belong in the financial export. Intents,
    // charges and lifecycle entries remain in the existing audit/history.
    if(audit.payments.some(p=>['confirmed','refunded'].includes(p.status)&&!ids.has(p.id)))throw Error('A consulta financeira ainda não contém todos os pagamentos. Atualize e tente novamente.');
    const rows=receiptCsv({...data,receipts});
    rows[0][6]='Valor recebido';rows[0][9]='Comissão Tâmo On';rows[0][11]='Líquido do parceiro';
    rows[0].push('Situação do pagamento','Pagador','ID da reserva','ID do pagamento no provedor','ID do participante','Fonte da tarifa','Conferência necessária','Motivo da conferência');
    const moneyColumns=new Set([6,7,8,9,10,11,20,21]);
    const safeText=value=>{const text=String(value??'');return /^[\s]*[=+@-]|^[\t\r\n]/.test(text)?"'"+text:text;};
    return [rows[0],...rows.slice(1).map((row,index)=>{
      const p=receipts[index],origin=sources.get(p.payment_id);
      const status=p.payment_status==='refunded'||(amount(p.received_total)>0&&amount(p.refund_completed)>=amount(p.received_total))?'Devolvido':amount(p.refund_completed)>0?'Devolvido parcialmente':p.cash_availability==='simulated'?'Simulado':'Pago';
      row.push(status,p.payer_name||payerName(p)||'',reservationId,origin.transaction_id||'',origin.participant_id||'',p.fee_source||origin.fee_source||'',origin.review_required===true||origin.review_required==='true'||p.split_divergence?'Sim':'Não',origin.review_reason||'');
      return row.map((value,col)=>{
        if(!moneyColumns.has(col))return safeText(value);
        if(value==null||value==='')return '';
        if(!Number.isFinite(Number(value)))throw Error('Valor financeiro inválido na exportação.');
        return Number(value).toFixed(2).replace('.',',');
      });
    })];
  }
  function entryTotals(entries) {
    const values={};
    const keys={liquidated:'liquidated_value',fee:'asaas_fee_total',commission:'commission_total',received:'received_total',refund:'refund_completed',partner_paid:'partner_paid'};
    for(const entry of entries){const key=keys[entry.kind];if(key)values[key]=round(amount(values[key])+amount(entry.amount));}
    return values;
  }
  function render(model) {
    const {finance,data,period,position:p,helpers:h}=model,{esc:e,money:m}=h;
    if(data.basis!=='payment_date'||!Array.isArray(data.receipts))return '<p role="alert">Atualize a consulta para carregar os pagamentos por data de recebimento.</p>';
    const all=period==='all',active=tabs.some(([key])=>key===model.tab)?model.tab:'reservations';
    const inScope=r=>(model.admin&&!finance.partnerId)||!r.partner_id||r.partner_id===finance.partnerId;
    const snapshots=(finance.reservationBreakdown||[]).filter(inScope);
    const entries=(data.entries||[]).filter(inScope);
    const receipts=data.receipts.filter(inScope),receiptGroups=new Map();
    for(const receipt of receipts){if(!receiptGroups.has(receipt.reservation_id))receiptGroups.set(receipt.reservation_id,[]);receiptGroups.get(receipt.reservation_id).push(receipt);}
    const groups=new Map();
    for(const entry of entries){if(!groups.has(entry.reservation_id))groups.set(entry.reservation_id,[]);groups.get(entry.reservation_id).push(entry);}
    const snapshotMap=new Map(snapshots.map(r=>[r.reservation_id,r]));
    const ids=[...receiptGroups.keys()];
    const periodName=all?'Todo o período':h.periodLabel(period);
    const sum=result(receiptTotals(receipts));
    const credit=data.credit_position;
    const creditValue=key=>credit&&Number.isFinite(Number(credit[key]))?m(credit[key]):'A confirmar';
    const card=(label,value,note,highlight=false)=>`<article class="pf-metric ${highlight?'pf-metric-net':''} ${amount(value)<0?'is-negative':''}"><span>${e(label)}</span><strong>${value==null?'—':m(value)}</strong><small>${e(note)}</small></article>`;
    const line=(label,value)=>`<div><dt>${e(label)}</dt><dd>${m(value)}</dd></div>`;
    const disclosure=(id,title,note,body)=>`<details class="finance-disclosure pf-reservation" data-finance-detail="pf:${e(id)}"><summary><span><strong>${e(title)}</strong><small>${e(note)}</small></span><span aria-hidden="true">⌄</span></summary><div class="finance-disclosure-body">${body}</div></details>`;
    const code=id=>{const row=receiptGroups.get(id)?.[0]||snapshotMap.get(id)||groups.get(id)?.[0];return (row?.reservation_code||'Reserva sem código')+(model.admin&&row?.partner_name?' · '+row.partner_name:'');};
    const actions=id=>`<div class="pf-actions"><button class="button secondary small" data-action="finance-reservation-open" data-reservation-id="${e(id)}">Ver reserva</button><button class="button ghost small" data-action="export-reservation-payment-audit" data-reservation-id="${e(id)}">Baixar conferência</button>${h.refundAction?h.refundAction(id,snapshotMap.get(id)):""}</div>`;
    const movements=(rows,identify=false)=>`<div class="table-wrap"><table class="finance-transaction-table"><thead><tr>${identify?'<th>Reserva / parceiro</th>':''}<th>Data</th><th>Etapa vinculada</th><th>Vínculo</th><th>Valor da etapa</th></tr></thead><tbody>${rows.map(row=>`<tr>${identify?`<td>${e(code(row.reservation_id))}</td>`:''}<td>${e(h.dateLabel(row))}<small class="field-help">${e(h.evidenceLabel(row))}</small></td><td>${e(({liquidated:'Liquidação do pagamento',commission:'Comissão reconhecida',fee:'Tarifa vinculada',refund:'Devolução do pagamento'})[row.kind]||h.kindLabel(row.kind))}<small class="field-help">${e(row.description||'')}</small></td><td>${e(row.link_scope==='reservation'?'Conjunto dos pagamentos da reserva':channelName(row.channel,h))}</td><td>${m(row.amount)}</td></tr>`).join('')}</tbody></table></div>`;
    const empty=text=>`<p class="pf-empty">${e(text)}</p>`;
    let body='';
    const paymentState=pay=>pay.payment_status==='refunded'||(amount(pay.received_total)>0&&amount(pay.refund_completed)>=amount(pay.received_total))?'Devolvido'
      :amount(pay.refund_completed)>0?'Devolvido parcialmente':pay.cash_availability==='simulated'?'Simulado':'Pago';
    const paymentList=payments=>payments.map((pay,index)=>{
      const payer=pay.payer_name||h.payerName?.(pay)||`Pagamento ${index+1}`;
      const stages=(groups.get(pay.reservation_id)||[]).filter(row=>row.payment_id===pay.payment_id);
      return `<details class="pf-payment-row" data-payment-id="${e(pay.payment_id)}" data-finance-detail="pf:payment:${e(pay.payment_id)}">
        <summary><span class="pf-payment-person"><strong>${e(payer)}</strong><small>${e(channelName(pay.channel,h)||'Pagamento')} · ${e(receiptDate(pay))}</small></span><strong class="pf-payment-amount">${m(pay.received_total)}</strong><span class="pf-payment-state">${e(paymentState(pay))}</span><span class="pf-payment-chevron" aria-hidden="true">⌄</span></summary>
        <div class="pf-payment-info">${creditHtml(pay,h)}<dl class="pf-lines">${line('Taxas deste pagamento',pay.asaas_fee_total)}${line('Comissão Tâmo On',pay.commission_total)}${line('Líquido calculado',pay.partner_net)}${amount(pay.refund_completed)!==0?line('Devolvido deste pagamento',pay.refund_completed):''}${amount(pay.unliquidated_value)!==0?line('Pendente de conclusão ou devolução',pay.unliquidated_value):''}</dl>
        ${pay.issuer_mode==='partner'?`<p class="pf-note">Split: ${e(({DONE:'comissão creditada ao Tâmo On',AWAITING_CREDIT:'aguardando crédito',PENDING:'em processamento',REFUNDED:'devolvido',REFUSED:'em conferência',CANCELLED:'cancelado',NOT_REQUIRED:'sem comissão'})[pay.split_status]||'aguardando confirmação')} · Comissão original: ${m(pay.split_commission_original)} · Comissão devolvida: ${m(pay.split_commission_refunded)}.</p>`:''}
        ${pay.split_divergence?'<p class="finance-alert" role="status">Split em conferência: consulte os valores registrados no Asaas.</p>':''}
        ${pay.fee_source==='estimated'?'<p class="pf-note">A tarifa deste pagamento é estimada.</p>':''}${pay.reservation_payment_count>1?'<p class="pf-note">Liquidação e comissão da reserva são distribuídas proporcionalmente entre seus pagamentos, com ajuste de centavos. Não representam uma nova cobrança.</p>':''}
        ${stages.length?movements(stages):''}<p class="pf-note">${e(dateSource(pay))} · Identificador do pagamento: ${e(pay.payment_id)}</p></div>
      </details>`;
    }).join('');
    const receiptDetails=(payments,id)=>`<details class="pf-payment-details" data-finance-detail="pf:payments:${e(id)}"><summary>Detalhar pagamentos <span>(${payments.length})</span><span aria-hidden="true">⌄</span></summary><div>${paymentList(payments)}</div></details>`;
    const reservationValues=r=>`<dl class="pf-reservation-values">${line('Recebido',r.base)}${line('Taxas de pagamento',r.fee)}<div class="${model.admin?'pf-value-highlight':''}"><dt>Comissão Tâmo On</dt><dd>${m(r.commission)}</dd></div><div class="${model.admin?'':'pf-value-highlight'} ${r.net<0?'is-negative':''}"><dt>Líquido do parceiro</dt><dd>${m(r.net)}</dd></div></dl>`;
    if(active==='reservations') {
      body=`<h2>Pagamentos por reserva</h2><p class="pf-note">${all?'Todos os pagamentos recebidos, cada um contabilizado uma única vez.':'Somente pagamentos efetivamente realizados no mês selecionado.'}</p>`;
      body+=ids.map(id=>{
        const f=snapshotMap.get(id),payments=receiptGroups.get(id),r=result(receiptTotals(payments));
        const channels=[...new Set(payments.map(x=>channelName(x.channel,h)))].filter(Boolean);
        const creditNotes=[...new Set(payments.filter(pay=>['asaas_card','asaas_pix'].includes(pay.channel)&&!['received','simulated'].includes(pay.cash_availability)&&creditInfo(pay).dateLabel==='Previsão de crédito').map(creditSummary))];
        const adjustments=[r.returned!==0?`Devoluções: ${m(r.returned)}`:'',r.held!==0?`Pendente de conclusão ou devolução: ${m(r.held)}`:'',f&&amount(f.balance_pending)>0?`Saldo a pagar da reserva: ${m(f.balance_pending)}`:''].filter(Boolean);
        const status=f?h.statusLabel(f.financial_status,f):'Em conciliação';
        const needsReview=payments.some(pay=>pay.split_divergence||['REFUSED','CANCELLED'].includes(pay.split_status));
        return `<details class="finance-disclosure pf-reservation pf-reservation-compact" data-finance-detail="pf:reservation:${e(id)}"><summary><span><strong>${e(code(id))}</strong><small>${e(channels.join(' · '))} · ${payments.length} pagamento${payments.length===1?'':'s'}</small>${creditNotes.length?`<small class="pf-credit-pending">${e(creditNotes.join(' | '))}</small>`:''}</span><span class="pf-reservation-status">${e(status)}</span><span class="pf-reservation-chevron" aria-hidden="true">⌄</span></summary><div class="finance-disclosure-body">
          ${reservationValues(r)}${adjustments.length?`<p class="pf-note pf-adjustments">${e(adjustments.join(' · '))}. O líquido já considera esses ajustes.</p>`:''}${needsReview?'<p class="finance-alert" role="status">Há um split em conferência. Consulte o pagamento correspondente.</p>':''}
          ${receiptDetails(payments,id)}${actions(id)}</div></details>`;
      }).join('')||empty('Nenhum pagamento recebido neste período.');
    }
    if(active==='movements') {
      body=`<h2>Histórico dos pagamentos</h2><p class="pf-note">Pagamentos recebidos em ${e(periodName)}. Liquidação, comissão, devolução e repasse permanecem vinculados à entrada original, mesmo quando acontecem depois.</p>`;
      body+=ids.map(id=>disclosure('movement:'+id,code(id),`${receiptGroups.get(id).length} pagamento(s) de origem`,
        receiptDetails(receiptGroups.get(id),id)+(groups.get(id)?.some(row=>!row.payment_id)?`<h3>Histórico da reserva</h3><p class="pf-note">Valores de referência das etapas; não somam novas entradas. Etapas da reserva abrangem o conjunto dos seus pagamentos.</p>${movements(groups.get(id).filter(row=>!row.payment_id))}`:empty(groups.get(id)?.length?'As etapas individuais estão nos detalhes de cada pagamento.':'Nenhuma etapa posterior registrada.'))+actions(id))).join('')||empty('Nenhum pagamento recebido neste período.');
      if(data.legacy_count||data.legacy_recognition_count)body+='<p class="pf-note">Algumas etapas têm data contábil histórica; a entrada continua identificada pela data do pagamento.</p>';
    }
    if(active==='returns') {
      const pending=snapshots.filter(f=>h.holds(f).length||amount(f.refund_pending)>0);
      const returns=[...receiptGroups].map(([id,rows])=>[id,rows.filter(x=>amount(x.refund_completed)>0)]).filter(([,rows])=>rows.length);
      body=`<h2>Pendências atuais por reserva</h2><p class="pf-note">Posição atual de todos os períodos. As pendências são obrigações da reserva; não significam bloqueio de saldo no Asaas.</p>`;
      body+=pending.map(f=>{
        const holds=h.holds(f),id=f.reservation_id;
        const total=round(holds.reduce((n,x)=>n+amount(x.amount),0));
        const rows=holds.map(x=>`<tr><td>${e(x.label)}</td><td>${m(x.amount)}</td><td>${m(f['asaas_blocked_'+x.key])}</td><td>${m(Math.max(0,amount(x.amount)-amount(f['asaas_blocked_'+x.key])))}</td></tr>`).join('');
        return disclosure('hold:'+id,code(id),`${m(total||f.refund_pending)} · ${h.statusLabel(f.financial_status,f)}`,`<div class="table-wrap"><table><thead><tr><th>Motivo</th><th>Valor</th><th>Cobranças Asaas</th><th>Pagamentos externos</th></tr></thead><tbody>${rows}</tbody></table></div>${!holds.length?`<p>Devolução pendente: ${m(f.refund_pending)}.</p>`:''}${actions(id)}`);
      }).join('')||empty('Nenhuma pendência financeira atual.');
      body+=`<h2>Devoluções vinculadas aos pagamentos selecionados</h2><p class="pf-note">Entradas de ${e(periodName)} · Inclui devoluções posteriores, mantendo a data de cada etapa no histórico.</p>`;
      body+=returns.map(([id,rows])=>disclosure('return:'+id,code(id),`Devoluções: ${m(receiptTotals(rows).refund_completed)}`,receiptDetails(rows,id)+actions(id))).join('')||empty('Nenhuma devolução vinculada a estes pagamentos.');
      if(model.adminHistory)body+=disclosure('admin-history','Histórico de vouchers e cancelamentos','Histórico completo dos parceiros selecionados; inclui análises excepcionais',model.adminHistory);
    }
    if(active==='payouts') {
      const paid=entries.filter(x=>x.kind==='partner_paid'||x.kind==='commission_paid');
      body=`<h2>Créditos e taxas</h2><p class="pf-note">Posição de todos os períodos. Os valores confirmados abaixo representam créditos dos pagamentos, descontadas as devoluções; não representam o saldo atual da conta.</p><dl class="pf-lines"><div><dt>Aguardando crédito · líquido do parceiro</dt><dd>${creditValue('pending_partner_net')}</dd></div><div><dt>Crédito confirmado na subconta · líquido</dt><dd>${creditValue('credited_subaccount_net')}</dd></div><div><dt>Comissão Tâmo On aguardando crédito</dt><dd>${creditValue('pending_commission')}</dd></div>${line('Recebido diretamente pelo parceiro',finance.externalReceived)}<div><dt>Cobranças anteriores ao split · líquido a conciliar</dt><dd>${creditValue('legacy_partner_net')}</dd></div></dl><p class="pf-note">Novas cobranças com split são emitidas na subconta do parceiro. O Asaas destina a comissão ao Tâmo On e mantém o restante com o parceiro. A emissão não altera as regras de cancelamento ou a obrigação de restituir cotas pagas.</p>`;
      body+=disclosure('fees','Composição e critérios','Tarifas e comissão',`<p>A comissão incide sobre o valor contratado após vouchers, antes das tarifas. Nas cobranças com split, a comissão é distribuída por pagamento. As etapas de reconhecimento da reserva continuam vinculadas ao recebimento original.</p><dl class="pf-lines">${line('Taxas dos pagamentos selecionados',sum.fee)}${line('Comissão vinculada aos pagamentos selecionados',sum.commission)}${line('Tarifas estimadas na posição atual',finance.asaasFeeEstimated)}${line('Comissão prevista pelas regras da reserva',finance.commissionProvisional)}${line('Comissão apurada para conciliação',finance.commissionRetained)}${line('Comissão creditada · após devoluções',finance.commissionSettled)}</dl>${h.feeReference?`<p class="pf-note">${e(h.feeReference)}</p>`:''}`);
      body+=`<h3>Transferências vinculadas às entradas de ${e(periodName)}</h3>`+(paid.length?movements(paid,Boolean(model.admin)):empty('Nenhuma transferência comprovada vinculada a estes pagamentos.'));
      body+=disclosure('reconciliation','Conferência completa da posição atual','Contratado, recebimentos, canais e ajustes',`<dl class="pf-lines">${line('Contratado original',finance.contractedValue)}${line('Contratado vigente',p.contracted)}${line('Encerrado ou cancelado',finance.cancelledValue)}${line('Recebido bruto',p.received)}${line('Recebido após devoluções',p.receivedNet)}${line('Recebimento fora do contrato vigente',p.outsideContract)}${line('Devoluções concluídas',p.returned)}${line('Valores bloqueados',p.blocked)}${line('Devoluções pendentes',finance.refundPending)}${line('Liquidado',p.liquidated)}${line('Ainda não liquidado',finance.unliquidatedValue)}${line('Pendente de pagamento',p.pending)}${line('Recebido pela instituição',finance.asaasProcessed)}${line('Pix',finance.asaasPixValue)}${line('Cartão',finance.asaasCardValue)}${line('Recebido diretamente',finance.externalReceived)}</dl>`);
    }
    if(active==='payouts'&&model.adminPartners)body+=disclosure('admin-partners','Conciliação por parceiro','Posição atual de todos os meses; sem compensar saldos entre parceiros',model.adminPartners);
    const estimated=round(receipts.filter(x=>x.fee_source==='estimated').reduce((n,x)=>n+amount(x.asaas_fee_total),0));
    const feeNote=estimated?`Inclui ${m(estimated)} estimados`:'Taxas vinculadas aos pagamentos';

    const alert=(Math.abs(amount(p.channelDifference))>0.009||Math.abs(amount(p.liquidationDifference))>0.009)?'<p class="finance-alert" role="status">Há uma diferença na conciliação atual. Consulte a conferência completa em Créditos e taxas.</p>':'';
    return `<section class="pf-workbench"><div class="pf-period-heading"><h2>${e(periodName)}</h2><p>Entradas pela data do pagamento. As etapas posteriores atualizam os pagamentos de origem, sem criar uma nova entrada.</p></div><div class="pf-metrics">${card('Pagamentos recebidos',sum.base,'Cada pagamento contado uma única vez')}${card('Taxas de pagamento',sum.fee,feeNote)}${card('Comissão Tâmo On',sum.commission,'Comissão reconhecida vinculada às entradas',Boolean(model.admin))}${card(model.admin&&!finance.partnerId?'Líquido dos parceiros':'Líquido do parceiro',sum.net,'Valor calculado; veja a disponibilidade abaixo',!model.admin)}</div><p class="pf-note">Composição atual das entradas selecionadas: ${m(sum.returned)} devolvidos e ${m(sum.held)} pendentes de conclusão ou devolução. O líquido calculado desconta devoluções, pendências, taxas e comissão; ainda pode aguardar crédito no Asaas.</p>${data.undated_count?`<p class="finance-alert" role="status">${e(data.undated_count)} pagamento(s) sem data confirmada: aparecem somente em Todo o período, até conferência.</p>`:""}${data.allocation_review_count?'<p class="finance-alert" role="status">Há pagamentos cuja distribuição exige conferência.</p>':""}<section class="pf-availability"><div><strong>Créditos no Asaas</strong><small>Todos os períodos · valores líquidos, sem somar novamente aos indicadores</small></div><dl><div class="${model.admin?'':'pf-to-receive'}"><dt>Aguardando crédito · parceiro</dt><dd>${creditValue('pending_partner_net')}</dd></div><div><dt>Crédito confirmado na subconta</dt><dd>${creditValue('credited_subaccount_net')}</dd></div>${model.admin?`<div><dt>Aguardando crédito · comissão Tâmo On</dt><dd>${creditValue('pending_commission')}</dd></div>`:''}</dl><p>A comissão já foi descontada do líquido do parceiro. Créditos confirmados não representam o saldo para saque; consulte movimentações e saldo no Asaas.${credit&&Number(credit.split_review_count)>0?' Há splits que exigem conferência nos detalhes da reserva.':''}</p></section>${alert}<div class="pf-tabs" role="tablist" aria-label="Detalhes financeiros">${tabs.map(([key,label])=>`<button type="button" role="tab" id="pf-tab-${key}" aria-controls="pf-panel" aria-selected="${key===active}" data-action="partner-finance-tab" data-tab="${key}">${e(label)}</button>`).join('')}</div><section id="pf-panel" class="pf-panel" role="tabpanel" aria-labelledby="pf-tab-${active}">${body}</section></section>`;
  }
  function audit(data,h) {
    const {esc:e,money:m}=h;
    const status=value=>({confirmed:'Confirmado',refunded:'Devolvido',pending:'Pendente',cancelled:'Cancelado',failed:'Falhou'})[value]||value||'Não informado';
    return `<p>Pagamentos de origem da reserva <strong>${e(data.reservation?.reservation_code||'')}</strong>. Devoluções são mostradas no pagamento correspondente.</p>${(data.payments||[]).map(p=>`<article class="pf-payment"><h3>${e(channelName(p.channel,h)||p.provider)}</h3><dl class="pf-lines"><div><dt>Situação</dt><dd>${e(status(p.status))}</dd></div><div><dt>Valor recebido</dt><dd>${m(p.amount)}</dd></div><div><dt>Devolvido</dt><dd>${m(p.refunded_amount)}</dd></div><div><dt>Tarifa</dt><dd>${m(p.fee)}${p.fee_source==='estimated'?' (estimada)':''}</dd></div><div><dt>Confirmação registrada no sistema</dt><dd>${e(h.dateTime(p.paid_at)||'Não informada')}</dd></div></dl><details><summary>Identificadores e conferência</summary><p>Pagamento: ${e(p.id)}</p><p>Transação: ${e(p.transaction_id||'Não informada')}</p>${p.participant_id?`<p>Participante: ${e(p.participant_id)}</p>`:''}${p.review_required===true||p.review_required==='true'?`<p>Conferência necessária: ${e(p.review_reason||'Consulte o registro original.')}</p>`:''}</details></article>`).join('')||'<p>Nenhum recebimento registrado.</p>'}<p class="pf-note">Cobranças e intenções não são novos recebimentos. O arquivo de conferência contém somente os pagamentos.</p>`;
  }
  root.PartnerFinanceView={render,audit,result,entryTotals,receiptTotals,receiptCsv,reservationCsv,tabs,creditInfo};
})(typeof window==='undefined'?globalThis:window);

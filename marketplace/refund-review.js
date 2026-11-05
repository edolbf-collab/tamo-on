(function(root){
 const labels={pending_review:'Em análise',waiting_funds:'Aguardando saldo',approved:'Aprovada para execução',processing:'Em processamento',completed:'Concluída'};
 function render(rows,{esc,money,date,all=false}){
  const pending=rows.filter(r=>r.status!=='completed'),visible=all?rows:pending;
  return `<p>Analise o pedido e registre a decisão antes de executar a devolução. A consulta de saldo é repetida no envio; nenhuma transferência para recompor saldo é feita automaticamente.</p>
  <div class="meta-row"><strong>${pending.length} pendente(s)</strong><span>${money(pending.reduce((n,r)=>n+Number(r.pending),0))} a devolver</span><span>${pending.filter(r=>r.attention).length} para acompanhamento</span></div>
  <p class="field-help">O destaque após 2 dias é um alerta operacional. Confira o prazo aplicável a cada caso e programe o próximo acompanhamento.</p>
  <div class="dialog-actions"><button class="button secondary small" data-action="admin-refunds" data-all="${!all}">${all?'Ver pendentes':'Ver também concluídas'}</button><button class="button ghost small" data-action="admin-refunds" data-all="${all}">Atualizar</button></div>
  <div class="cancellation-case-list">${visible.map(r=>`<article class="card"><h3>${esc(r.reservation_code)} · ${esc(r.partner_name)}</h3><span class="status ${r.status==='completed'?'status-ok':'status-neutral'}">${esc(labels[r.status]||r.status)}</span>${r.attention&&r.status!=='completed'?'<p><strong>Acompanhamento pendente</strong></p>':''}
  <p>Solicitado em ${esc(date(r.requested_at))}</p><p>${esc(r.reason||'Restituição solicitada')}</p>
  <div class="detail-line"><span>Previsto / confirmado / pendente</span><strong>${money(r.required)} / ${money(r.refunded)} / ${money(r.pending)}</strong></div>
  ${r.assigned_to?`<p>Responsável: ${esc(r.assigned_to)}</p>`:''}${r.note?`<p>${esc(r.note)}</p>`:''}${r.follow_up_at?`<p>Próximo acompanhamento: ${esc(date(r.follow_up_at))}</p>`:''}
  <details><summary>Pagamentos envolvidos</summary>${(r.payments||[]).map(p=>`<p>${esc(p.payer)} · ${esc(p.channel)} · ${money(p.amount)} pago · ${money(p.refunded)} devolvido</p>`).join('')}</details>
  ${r.status!=='completed'?`<div class="dialog-actions">${r.status!=='processing'?`<button class="button secondary small" data-action="admin-refund-review" data-reservation-id="${esc(r.reservation_id)}">Registrar análise</button>`:''}<button class="button secondary small" data-action="asaas-refund-open" data-reservation-id="${esc(r.reservation_id)}">Conferir pagamentos e saldos</button></div>`:''}
  ${r.status==='approved'?(r.payments||[]).filter(p=>p.choice_id&&!['asaas_pix','asaas_card'].includes(p.channel)&&Number(p.amount)>Number(p.refunded)).map(p=>`<button class="button secondary small" data-action="cancellation-cash-refund" data-choice-id="${esc(p.choice_id)}">Registrar devolução externa · ${money(Number(p.amount)-Number(p.refunded))}</button>`).join(''):''}
  ${(r.history||[]).length?`<details><summary>Histórico administrativo</summary>${r.history.map(h=>`<p><strong>${esc(date(h.at))} · ${esc(h.actor)} · ${esc(labels[h.status]||h.status)}</strong><br>${esc(h.note)}</p>`).join('')}</details>`:''}</article>`).join('')||'<p>Nenhuma devolução nesta fila.</p>'}</div>`;
 }
 root.MarketplaceRefundReview={render,labels};
})(typeof window==='undefined'?globalThis:window);

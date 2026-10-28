/* Datas e agregacoes puras; todos os valores financeiros vem da consulta oficial. */
(function (scope) {
  'use strict';
  const fields=['received_total','refund_completed','received_net','asaas_pix_value','asaas_card_value','external_received','asaas_fee_total','liquidated_value','commission_total','partner_paid','commission_settled','liquidated_recorded','liquidated_legacy','commission_recorded','commission_legacy'];
  function currentMonth(date=new Date()) {
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).formatToParts(date);
    return parts.find(p=>p.type==='year').value+'-'+parts.find(p=>p.type==='month').value;
  }
  function validMonth(value){return /^(20\d{2}|21\d{2})-(0[1-9]|1[0-2])$/.test(value);}
  function shiftMonth(value,delta){if(!validMonth(value))throw Error('Mes invalido');const [y,m]=value.split('-').map(Number);const d=new Date(Date.UTC(y,m-1+delta,1));const result=d.toISOString().slice(0,7);return validMonth(result)?result:value;}
  function label(value){if(value==='all')return 'Todo o período';if(!validMonth(value))return '';return new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value+'-01T12:00:00Z'));}
  function total(rows){return Object.fromEntries(fields.map(k=>[k,rows.reduce((c,r)=>c+Math.round(Number(r[k]||0)*100),0)/100]));}
  function kindLabel(kind){return ({received:'Recebimento',refund:'Restituição',fee:'Tarifa ou ajuste',liquidated:'Liquidação ou ajuste',commission:'Comissão ou ajuste',partner_paid:'Repasse comprovado',commission_paid:'Comissão transferida'})[kind]||kind;}
  function channelLabel(channel){return ({asaas_pix:'Pix Asaas',asaas_card:'Cartão Asaas',external:'Externo'})[channel]||'—';}
  function dateLabel(entry){if(entry.date_quality==='month')return label(currentMonth(new Date(entry.occurred_at)));return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(entry.occurred_at));}
  function summaryCsv(data){return [['Periodo','Parceiro','Recebido','Devolvido','Recebido menos devolucoes','Pix Asaas','Cartao Asaas','Externo','Tarifas e ajustes','Liquidacao e ajustes','Comissao e ajustes','Repasse comprovado','Comissao transferida','Liquidacao registrada apos atualizacao','Liquidacao historica importada','Comissao registrada apos atualizacao','Comissao historica importada'],...data.rows.map(r=>[data.month||'Todo o periodo',r.partner_name,...fields.map(k=>Number(r[k]||0))])];}
  // Group the complete period before limiting the displayed reservations.
  // Keep official movement order and amounts; different kinds must never be summed.
  function reservationGroups(entries=[]) {
    const groups=new Map();
    for(const entry of entries){
      const key=JSON.stringify([entry.partner_id||entry.partner_name||'',entry.reservation_id||entry.reservation_code||'unlinked']);
      if(!groups.has(key))groups.set(key,{key,partnerId:entry.partner_id,partnerName:entry.partner_name,reservationId:entry.reservation_id,reservationCode:entry.reservation_code,entries:[]});
      groups.get(key).entries.push(entry);
    }
    return [...groups.values()];
  }
  function movementsCsv(data){return [['Periodo','Data (America/Sao_Paulo)','Parceiro','Reserva','Movimento','Canal','Valor','Origem da data','Descricao','ID','Fonte financeira','Tipo da origem','ID da origem'],...data.entries.map(e=>[data.month||'Todo o periodo',dateLabel(e),e.partner_name,e.reservation_code,kindLabel(e.kind),channelLabel(e.channel),Number(e.amount),evidenceLabel(e),e.description,e.id,e.evidence_source||'event',e.source_type||'',e.source_id||''])];}
  function evidenceLabel(entry){
    if(entry.evidence_source==='legacy_ledger')return entry.date_quality==='month'?'Histórico contábil importado; somente mês conhecido':'Histórico contábil importado; data do registro';
    return ({recorded:'Data registrada',month:'Somente mês conhecido',legacy:'Data histórica disponível'})[entry.date_quality]||'Data não informada';
  }
  const holdTypes=[['refund','Restituição pendente'],['resolution','Remarcação ou restituição em análise'],['excess','Recebimento excedente a conferir'],['partial','Parcial aguardando liquidação'],['review','Recebimento em conferência']];
  function holds(row,asaas=false){return holdTypes.map(([key,label])=>({key,label,amount:Number(row[(asaas?'asaas_':'')+'blocked_'+key]||0)})).filter(x=>x.amount>0);}
  function auditCsv(data){
    const r=data.reservation;
    const header=['Reserva','Tipo','ID','Canal ou metodo','Provedor','Transacao ou referencia','Intent','Etapa','Cota','Participante','Valor','Devolvido','Tarifa','Fonte da tarifa','Situacao','Data de pagamento','Data de registro','Simulado','Conferencia necessaria','Motivo','ID pagamento no provedor','ID checkout'];
    const rows=(data.payments||[]).map(p=>[r.reservation_code,p.correction?'Simulacao neutralizada (nao somar)':'Pagamento',p.id,channelLabel(p.channel),p.provider,p.transaction_id,p.intent_id,p.stage_id,p.installment_id,p.participant_id,p.amount,p.refunded_amount,p.fee,p.fee_source,p.correction?'Simulacao repetida neutralizada':p.status,p.paid_at,p.created_at,p.simulation,p.review_required,p.correction?`${p.review_reason||''}; pagamento preservado: ${p.retained_payment_id||''}`:p.review_reason,p.transaction_id,'']);
    for(const c of data.charges||[])rows.push([r.reservation_code,c.type==='pix'?'Cobranca Pix':'Intent (nao somar como recebimento)',c.id,c.method||'Pix','',''+(c.reference||''),'',c.stage_id,c.type==='pix'?c.id:'',c.participant_id,c.amount,'','','',c.status,'','','','','',c.provider_payment_id,c.checkout_id]);
    for(const h of holds(r))rows.push([r.reservation_code,'Composicao do bloqueio','','','','','','','','',h.amount,'','','','','','','','',h.label,'','']);
    if(data.cycle){const c=data.cycle;rows.push([r.reservation_code,'Ciclo mensal (nao somar como recebimento)',c.id,'','','','','','','',c.total_paid,'','','',c.status,'','','','',`Vencimento do saldo: ${c.balance_due_at||'nao informado'}; encerramento financeiro: ${c.financial_closed_at||'nao encerrado'}; resultado da correcao: ${c.outcome||'sem correcao'}`,'','']);}
    return [header,...rows];
  }
  // Presentation only: work in cents; never recalculate provider payouts or commission.
  function position(row={}) {
    const cents=value=>Math.round(Number(value??0)*100), get=(key,fallback=0)=>cents(row[key]??fallback);
    const received=get('receivedTotal',Number(row.asaasProcessed||0)+Number(row.externalReceived||0));
    const returned=get('refundCompleted'), receivedNet=get('receivedNet',(received-returned)/100);
    const liquidated=get('liquidatedValue',row.commissionBase??receivedNet/100);
    const blocked=get('unliquidatedValue',(receivedNet-liquidated)/100);
    const contracted=get('finalDueValue',Number(row.contractedValue??row.commissionBase??0)-Number(row.cancelledValue||0));
    const pending=get('balancePending'), fee=get('asaasFeeTotal',row.asaasFeeEstimated), commission=get('commissionTotal');
    const values={contracted,received,returned,receivedNet,liquidated,blocked,pending,fee,commission,
      partnerNet:received-returned-blocked-fee-commission,
      applied:contracted-pending,outsideContract:receivedNet-(contracted-pending),
      channelDifference:received-get('asaasProcessed')-get('externalReceived'),
      liquidationDifference:received-returned-blocked-liquidated};
    return Object.fromEntries(Object.entries(values).map(([key,value])=>[key,value/100]));
  }
  scope.MarketplaceFinancePeriod={fields,currentMonth,validMonth,shiftMonth,label,total,kindLabel,channelLabel,dateLabel,summaryCsv,movementsCsv,evidenceLabel,holdTypes,holds,auditCsv,position,reservationGroups};
})(typeof window!=='undefined'?window:globalThis);

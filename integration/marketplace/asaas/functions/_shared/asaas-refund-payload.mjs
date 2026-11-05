const cents=x=>{const n=Number(x);if(!Number.isFinite(n)||n<0||Math.abs(n*100-Math.round(n*100))>0.00001)throw new Error('REFUND_INVALID_AMOUNT');return Math.round(n*100);};
export function refundPayload(c,p){
  if(p.id!==c.provider_payment_id||p.billingType!==c.billing_type||cents(p.value)!==cents(c.payment_amount)||p.deleted)throw new Error('REFUND_PAYMENT_MISMATCH');
  if(!Array.isArray(p.refunds))throw new Error('REFUND_EVIDENCE_REQUIRED');
  if(p.refunds.some(x=>!['DONE','CANCELLED','DENIED'].includes(x.status)))throw new Error('REFUND_EXISTING_PROVIDER_REQUEST');
  const done=p.refunds.filter(x=>x.status==='DONE');
  const returned=done.reduce((n,r)=>n+cents(r.value),0),value=cents(p.value),requested=cents(c.request_amount);
  if(returned!==cents(c.refunded_amount))throw new Error('REFUND_RECONCILIATION_REQUIRED');
  if(requested<=0||returned+requested>value||requested!==cents(c.amount))throw new Error('REFUND_FULL_AMOUNT_REQUIRED');
  if(!['RECEIVED','PARTIALLY_REFUNDED',...(c.billing_type==='CREDIT_CARD'?['CONFIRMED']:[])].includes(p.status))throw new Error('REFUND_PAYMENT_NOT_RECEIVED');
  const body={value:requested/100,description:`Cancelamento ${c.reservation_code} - solicitação ${c.request_id}`};
  const route=c.route||{},commission=cents(route.split_commission_amount||0),splits=p.split||[];
  if(!Array.isArray(splits))throw new Error('REFUND_SPLIT_MISMATCH');
  if(!route.issuer_account_id){if(splits.length)throw new Error('REFUND_SPLIT_MISMATCH');return body;}
  if(commission===0){if(splits.length)throw new Error('REFUND_SPLIT_MISMATCH');return body;}
  if(splits.length!==1||splits[0].walletId!==route.split_wallet_id||cents(splits[0].fixedValue)!==commission||!splits[0].id)throw new Error('REFUND_SPLIT_MISMATCH');
  const split=splits[0];let refundedSplit=0;
  let missingDoneEvidence=false;
  for(const r of p.refunds.filter(x=>['DONE','CANCELLED'].includes(x.status))){
    if(r.refundedSplits==null){if(r.status==='DONE')missingDoneEvidence=true;continue;}
    if(!Array.isArray(r.refundedSplits))throw new Error('REFUND_SPLIT_EVIDENCE_REQUIRED');
    const seen=new Set();
    for(const s of r.refundedSplits){
      if(!s||s.id!==split.id||seen.has(s.id)||typeof s.done!=='boolean')throw new Error('REFUND_SPLIT_EVIDENCE_REQUIRED');
      seen.add(s.id);
      const amount=cents(s.value);
      if(amount<=0)throw new Error('REFUND_SPLIT_EVIDENCE_REQUIRED');
      if(s.done===true)refundedSplit+=amount;
      else if(r.status==='DONE')throw new Error('REFUND_SPLIT_EVIDENCE_REQUIRED');
    }
  }
  if(refundedSplit>commission)throw new Error('REFUND_SPLIT_ALLOCATION_INVALID');
  if(missingDoneEvidence&&refundedSplit!==commission)throw new Error('REFUND_SPLIT_EVIDENCE_REQUIRED');
  // A split may already have reverted even though the payer's Pix refund
  // failed. Do not debit the commission twice or infer a returned amount
  // from status alone. Wait for the confirmed refundedSplits evidence.
  if(split.status==='REFUNDED'&&refundedSplit!==commission)throw new Error('REFUND_SPLIT_RECONCILIATION_REQUIRED');
  // Cumulative cents avoid commission drift across successive partial refunds.
  const target=Number((BigInt(returned+requested)*BigInt(commission)*2n+BigInt(value))/(BigInt(value)*2n));
  const splitAmount=target-refundedSplit;
  if(splitAmount<0||splitAmount>requested||target>commission)throw new Error('REFUND_SPLIT_ALLOCATION_INVALID');
  // Omit the field entirely when the original commission has already returned.
  if(splitAmount>0)body.splitRefunds=[{id:split.id,value:splitAmount/100}];
  return body;
}

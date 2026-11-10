-- Existing official financial calculation, read from the hosted schema on 2026-11-10.
-- Test dependency only; never deployed by this administrative feature.
CREATE OR REPLACE FUNCTION private.reservation_financial_snapshot(p_reservation_id uuid, p_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  r public.reservations%rowtype; c public.monthly_cycles%rowtype;
  v_received numeric:=0; v_refunded numeric:=0; v_asaas numeric:=0; v_external numeric:=0;
  v_asaas_refunded numeric:=0; v_fees numeric:=0; v_estimated numeric:=0; v_awaiting numeric:=0;
  v_pix numeric:=0; v_card numeric:=0; v_pix_count int:=0; v_card_count int:=0;
  v_first timestamptz; v_refund_required numeric:=0; v_choice_hold numeric:=0; v_hold numeric:=0;
  v_net_received numeric; v_liquidated numeric:=0; v_target numeric; v_closed boolean:=false; v_user_cancelled boolean:=false; v_single_expired boolean:=false;
  v_commission numeric; v_rate numeric; v_asaas_blocked numeric; v_available numeric;
  v_cancelled numeric:=0; v_refund_pending numeric:=0; v_finance_status text;
  v_contract_refunded numeric:=0; v_excess numeric:=0; v_review_hold numeric:=0; v_remaining numeric:=0;
  v_block_refund numeric:=0; v_block_resolution numeric:=0; v_block_excess numeric:=0;
  v_block_partial numeric:=0; v_block_review numeric:=0;
  v_asaas_refund numeric:=0; v_asaas_resolution numeric:=0; v_asaas_excess numeric:=0;
  v_asaas_partial numeric:=0; v_asaas_review numeric:=0;
begin
  select * into r from public.reservations where id=p_reservation_id;
  if not found then return null; end if;
  select * into c from public.monthly_cycles where id=r.monthly_cycle_id;
  select
    coalesce(sum(amount),0),coalesce(sum(refunded_amount),0),
    coalesce(sum(amount) filter(where payment_channel in ('asaas_pix','asaas_card')),0),
    coalesce(sum(amount) filter(where payment_channel='external'),0),
    coalesce(sum(refunded_amount) filter(where payment_channel in ('asaas_pix','asaas_card')),0),
    coalesce(sum(fee_amount) filter(where payment_channel in ('asaas_pix','asaas_card')),0),
    coalesce(sum(fee_amount) filter(where fee_source='estimated'),0),
    coalesce(sum(greatest(amount-refunded_amount-fee_amount,0)) filter(where payment_channel in ('asaas_pix','asaas_card') and cash_availability in ('awaiting_credit','unknown')),0),
    coalesce(sum(amount) filter(where payment_channel='asaas_pix'),0),
    coalesce(sum(amount) filter(where payment_channel='asaas_card'),0),
    count(*) filter(where payment_channel='asaas_pix'),count(*) filter(where payment_channel='asaas_card')
  into v_received,v_refunded,v_asaas,v_external,v_asaas_refunded,v_fees,v_estimated,v_awaiting,v_pix,v_card,v_pix_count,v_card_count
  from public.payments where reservation_id=r.id and status in ('confirmed','partially_refunded','refunded');
  v_net_received:=greatest(v_received-v_refunded,0);
  -- O autor efetivo do cancelamento prevalece sobre o perfil da conta logada.
  v_user_cancelled:=r.status in ('cancelled','refund_pending','refunded') and coalesce((
    select cr.requester_type='user' and (cr.resolution in ('voucher','no_compensation') or cr.resolution_details->>'flow'='cancellation_7d_v1')
    from public.cancellation_requests cr where cr.reservation_id=r.id and cr.status='processed'
    order by cr.created_at desc,cr.id desc limit 1),false);
  -- Somente avulsa encerrada pelo prazo; mensalistas mantem sua politica atual.
  v_single_expired:=r.booking_mode='single' and r.status='expired'
    and r.payment_expires_at is not null and r.payment_expires_at<=p_at;
  -- Cancelados e originais substituidos nunca comprovam prestacao do servico.
  select min(ro.ends_at) into v_first from public.reservation_occurrences ro
  where ro.reservation_id=r.id and ro.status in ('active','completed') and ro.ends_at<=p_at
    and not exists(select 1 from public.occurrence_transfer_requests tr where tr.original_occurrence_id=ro.id
      and tr.requested_by_type='partner' and tr.status not in ('accepted'));
  v_first:=coalesce(r.first_service_liquidated_at,v_first);
  select coalesce(sum(amount),0) into v_refund_required from public.accounting_ledger
    where reservation_id=r.id and entry_type='refund_required';
  select coalesce(sum(ro.allocated_value),0) into v_choice_hold
  from public.occurrence_transfer_requests tr join public.reservation_occurrences ro on ro.id=tr.original_occurrence_id
  where tr.reservation_id=r.id and tr.requested_by_type='partner' and tr.status in ('awaiting_group_choice','proposed');
  -- Uma remarcacao perde o objeto quando o proprio titular cancela o ciclo inteiro.
  if v_user_cancelled then v_choice_hold:=0; end if;
  v_refund_pending:=greatest(v_refund_required-v_refunded,0);
  select coalesce(sum(greatest(amount-refunded_amount,0)),0) into v_review_hold from public.payments
    where reservation_id=r.id and status in ('confirmed','partially_refunded','refunded')
    and (metadata->>'financial_review_required'='true'
      or (v_single_expired and coalesce(paid_at,created_at)>r.payment_expires_at));
  v_hold:=least(v_net_received,v_choice_hold+v_refund_pending+v_review_hold);
  v_contract_refunded:=least(v_refunded,v_refund_required)+greatest(v_refunded-v_refund_required-greatest(v_received-r.net_value,0),0);
  v_closed:=r.financial_closed_at is not null or coalesce(c.status in ('suspended','cancelled'),false)
    or r.status in ('cancelled','expired','refund_pending','refunded');
  v_target:=greatest(r.net_value-greatest(v_refund_required,v_contract_refunded),0);
  if not (v_user_cancelled or v_single_expired) and r.financial_closed_at is not null and r.final_due_value is not null then
    v_target:=least(v_target,r.final_due_value);
  end if;
  if v_user_cancelled or v_single_expired then
    -- Encerramento reconhece apenas o recebido dentro do prazo, sem exigir quitacao.
    -- Ignora teto derivado antigo; restitucao, conferencia e excedente ficam protegidos.
    -- Pagamento recebido apos a expiracao permanece em conferencia.
    v_target:=least(v_target,v_net_received);
    v_liquidated:=least(greatest(v_net_received-v_hold,0),v_target);
  elsif r.booking_mode='monthly' then
    if v_received>=r.net_value or (v_first is not null and v_received>=coalesce(c.guarantee_required,c.initial_required,r.net_value)) then
      v_liquidated:=least(greatest(v_net_received-v_hold,0),v_target);
    end if;
    if v_closed then
      if v_first is not null then v_target:=least(v_target,greatest(v_received-v_refund_required,0));
      else v_target:=v_liquidated; end if;
    end if;
  else
    if v_received>=r.net_value or r.status in ('confirmed','completed','cancelled','refund_pending','refunded') then
      v_liquidated:=least(greatest(v_net_received-v_hold,0),v_target);
    end if;
    if v_closed then v_target:=least(v_target,v_liquidated); end if;
  end if;
  v_cancelled:=greatest(r.net_value-v_target,0);
  select coalesce(ct.commission_rate,r.finance_commission_rate,p.commission_rate) into v_rate from public.partners p left join private.asaas_split_contracts ct on ct.reservation_id=r.id where p.id=r.partner_id;
  v_commission:=round(v_liquidated*v_rate/100,2);
  -- Saldo de outro mensal ainda bloqueado nunca cobre comissao nem repasse.
  v_asaas_blocked:=least(greatest(v_asaas-v_asaas_refunded,0),greatest(v_net_received-v_liquidated,0));
  -- Tarifas de reservas estornadas tambem reduzem o saldo agregado do parceiro.
  -- Credito pendente nao pode bloquear novamente uma parcela ja integralmente retida.
  v_awaiting:=least(v_awaiting,greatest(v_asaas-v_asaas_refunded-v_asaas_blocked-v_fees,0));
  v_available:=v_asaas-v_asaas_refunded-v_asaas_blocked-v_fees-v_awaiting;
  -- Restituicao, resolucao, excedente e parcial sao parcelas exclusivas do bloqueio.
  v_excess:=greatest(v_net_received-greatest(r.net_value-v_contract_refunded,0),0);
  v_remaining:=greatest(v_net_received-v_liquidated,0);
  v_block_refund:=least(v_remaining,v_refund_pending); v_remaining:=v_remaining-v_block_refund;
  v_block_resolution:=least(v_remaining,v_choice_hold); v_remaining:=v_remaining-v_block_resolution;
  v_block_excess:=least(v_remaining,v_excess); v_remaining:=v_remaining-v_block_excess;
  v_block_review:=least(v_remaining,v_review_hold); v_remaining:=v_remaining-v_block_review;
  if v_closed then v_block_review:=v_block_review+v_remaining; else v_block_partial:=v_remaining; end if;
  -- Mantem a alocacao conservadora existente: recursos Asaas retidos primeiro.
  v_remaining:=v_asaas_blocked;
  v_asaas_refund:=least(v_remaining,v_block_refund); v_remaining:=v_remaining-v_asaas_refund;
  v_asaas_resolution:=least(v_remaining,v_block_resolution); v_remaining:=v_remaining-v_asaas_resolution;
  v_asaas_excess:=least(v_remaining,v_block_excess); v_remaining:=v_remaining-v_asaas_excess;
  v_asaas_review:=least(v_remaining,v_block_review); v_remaining:=v_remaining-v_asaas_review;
  v_asaas_partial:=v_remaining;
  v_finance_status:=case when v_refund_pending>0 then 'refund_pending'
    when v_received>0 and v_net_received=0 then 'refunded'
    when v_block_excess>0 then 'excess_received' when v_block_review>0 then 'payment_review'
    when v_closed then 'closed' when v_hold>0 then 'resolution_pending'
    when v_liquidated>=v_target and v_received>0 then 'liquidated'
    when v_liquidated>0 then 'partial_liquidated' when v_received>0 then 'blocked' else 'awaiting_payment' end;
  return jsonb_build_object(
    'reservation_id',r.id,'reservation_code',r.public_code,'partner_id',r.partner_id,
    'gross_value',r.gross_value,'voucher_discount',r.voucher_discount,'contracted_value',r.net_value,
    'final_due_value',v_target,'cancelled_value',v_cancelled,'financial_closed',v_closed,'financial_status',v_finance_status,
    'received_total',v_received,'received_net',v_net_received,'refund_completed',v_refunded,'refund_pending',v_refund_pending,
    'balance_pending',case when v_closed then 0 else greatest(v_target-greatest(v_net_received-v_refund_pending,0),0) end,
    'liquidated_value',v_liquidated,'unliquidated_value',greatest(v_net_received-v_liquidated,0),
    'first_service_at',v_first,'asaas_processed',v_asaas,'external_received',v_external,
    'asaas_pix_value',v_pix,'asaas_card_value',v_card,'asaas_pix_count',v_pix_count,'asaas_card_count',v_card_count,
    'asaas_blocked',v_asaas_blocked,
    'blocked_refund',v_block_refund,'blocked_resolution',v_block_resolution,'blocked_excess',v_block_excess,
    'blocked_partial',v_block_partial,'blocked_review',v_block_review,
    'asaas_blocked_refund',v_asaas_refund,'asaas_blocked_resolution',v_asaas_resolution,'asaas_blocked_excess',v_asaas_excess,
    'asaas_blocked_partial',v_asaas_partial,'asaas_blocked_review',v_asaas_review,'asaas_awaiting_credit',v_awaiting,'asaas_available_after_fees',v_available,
    'asaas_fee_total',v_fees,'asaas_fee_estimated',v_estimated,'commission_base',v_liquidated,
    'commission_rate',v_rate,'commission_total',v_commission,
    'commission_provisional',case when v_closed then 0 else greatest(round(v_target*v_rate/100,2)-v_commission,0) end);
end; $function$

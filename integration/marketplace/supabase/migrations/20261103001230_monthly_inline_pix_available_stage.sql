-- A full monthly Pix installment may be available as well as scheduled or pending.
CREATE OR REPLACE FUNCTION private.inline_pix_deadline(p_reservation_id uuid, p_stage_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select case
 when r.booking_mode='single' and r.monthly_cycle_id is null and p_stage_id is null then r.payment_expires_at
 when r.booking_mode='monthly' and c.collection_mode='single_monthly_pool'
  and c.status in ('awaiting_initial','awaiting_full') and s.reservation_id=r.id
  and s.monthly_cycle_id=c.id and s.stage='full' and s.status in ('scheduled','available','pending')
 then least(r.payment_expires_at,s.due_at,c.balance_due_at,
  case when c.guarantee_reached_at is not null or c.guarantee_required<=0 then c.balance_due_at else c.initial_due_at end)
 end
 from public.reservations r left join public.monthly_cycles c on c.id=r.monthly_cycle_id
 left join public.monthly_payment_stages s on s.id=p_stage_id
 where r.id=p_reservation_id and r.status='pending_payment' and r.financial_closed_at is null
 and r.payment_method='pix_direct_partner' and r.payment_configured_at is not null;
$function$;

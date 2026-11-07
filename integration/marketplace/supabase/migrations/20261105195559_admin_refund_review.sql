-- Administrative approval is independent from cancellation eligibility.
create table private.admin_refund_reviews (
 reservation_id uuid primary key references public.reservations(id),
 status text not null check(status in ('pending_review','waiting_funds','approved')),
 basis text not null, assigned_to uuid not null references public.profiles(id),
 note text not null check(length(note) between 3 and 2000),
 follow_up_at timestamptz,updated_at timestamptz not null default now()
);
alter table private.admin_refund_reviews enable row level security;
revoke all on private.admin_refund_reviews from public,anon,authenticated;
create table private.admin_refund_history (
 id bigint generated always as identity primary key,
 reservation_id uuid not null references public.reservations(id),
 actor_id uuid not null references public.profiles(id),
 status text not null,note text not null,created_at timestamptz not null default now()
);
create index admin_refund_history_reservation_idx on private.admin_refund_history(reservation_id,created_at);
alter table private.admin_refund_history enable row level security;
revoke all on private.admin_refund_history from public,anon,authenticated;

create function private.assert_refund_admin(p_actor uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a join public.profiles p on p.id=a.profile_id where p.id=p_actor and p.status='active') then raise exception 'REFUND_FORBIDDEN';end if;
end $$;
revoke all on function private.assert_refund_admin(uuid) from public,anon,authenticated;

create function private.refund_review_basis(p_reservation uuid) returns text language sql stable security definer set search_path='' as $$
 select md5(jsonb_build_object(
 'ledger',(select coalesce(jsonb_agg(jsonb_build_array(id,amount) order by id),'[]') from public.accounting_ledger where reservation_id=p_reservation and entry_type='refund_required'),
 'payments',(select coalesce(jsonb_agg(jsonb_build_array(p.id,p.amount,p.refunded_amount,p.status,c.resolution) order by p.id),'[]') from public.payments p left join private.cancellation_payment_choices c on c.payment_id=p.id where p.reservation_id=p_reservation)
 )::text)
$$;
revoke all on function private.refund_review_basis(uuid) from public,anon,authenticated;

create function private.assert_refund_approved(p_reservation uuid,p_actor uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.assert_refund_admin(p_actor);
 perform 1 from private.admin_refund_reviews where reservation_id=p_reservation and status='approved' and basis=private.refund_review_basis(p_reservation) for update;
 if not found then raise exception 'REFUND_ADMIN_REVIEW_REQUIRED';end if;
end $$;
revoke all on function private.assert_refund_approved(uuid,uuid) from public,anon,authenticated;

create function public.admin_refund_directory() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.assert_refund_admin(auth.uid());perform public.assert_marketplace_writable();
 select coalesce(jsonb_agg(row_data order by row_data->>'requested_at'),'[]') into result from (
 select jsonb_build_object('reservation_id',r.id,'reservation_code',r.public_code,'partner_name',pt.trade_name,
 'requested_at',l.requested_at,'required',l.required,'refunded',coalesce(p.refunded,0),'pending',greatest(l.required-coalesce(p.refunded,0),0),
 'status',case when l.required<=coalesce(p.refunded,0) then 'completed' when exists(select 1 from private.asaas_refund_requests q where q.reservation_id=r.id and q.is_current and q.status in ('requesting','submitted','unknown')) then 'processing'
 when rv.basis=private.refund_review_basis(r.id) then rv.status else 'pending_review' end,
 'assigned_to',u.display_name,'note',rv.note,'follow_up_at',rv.follow_up_at,
 'attention',case when rv.follow_up_at is not null then rv.follow_up_at<=now() else l.requested_at<now()-interval '2 days' end,
 'history',coalesce((select jsonb_agg(jsonb_build_object('at',h.created_at,'actor',a.display_name,'status',h.status,'note',h.note) order by h.created_at desc,h.id desc) from private.admin_refund_history h join public.profiles a on a.id=h.actor_id where h.reservation_id=r.id),'[]'),
 'reason',coalesce((select c.reason from public.cancellation_requests c where c.reservation_id=r.id order by c.created_at desc limit 1),l.description),
 'payments',coalesce((select jsonb_agg(jsonb_build_object('payment_id',pay.id,'amount',pay.amount,'refunded',pay.refunded_amount,'channel',pay.payment_channel,'payer',coalesce(payer.display_name,'Responsável pelo pagamento'),'choice_id',c.id,'resolution',c.resolution) order by pay.id)
 from public.payments pay left join private.cancellation_payment_choices c on c.payment_id=pay.id left join public.profiles payer on payer.id=coalesce(c.beneficiary_id,r.payment_responsible_id,r.user_id)
 where pay.reservation_id=r.id and pay.status in ('confirmed','partially_refunded','refunded') and (c.id is null or c.resolution='refund')),'[]')) row_data
 from public.reservations r join public.partners pt on pt.id=r.partner_id
 join lateral(select sum(amount) required,min(created_at) requested_at,min(description) description from public.accounting_ledger where reservation_id=r.id and entry_type='refund_required') l on l.required>0
 left join lateral(select sum(refunded_amount) refunded from public.payments where reservation_id=r.id) p on true
 left join private.admin_refund_reviews rv on rv.reservation_id=r.id left join public.profiles u on u.id=rv.assigned_to
 ) rows;
 return result;
end $$;
revoke all on function public.admin_refund_directory() from public,anon;
grant execute on function public.admin_refund_directory() to authenticated;

create function public.review_admin_refund(p_reservation_id uuid,p_status text,p_note text,p_follow_up_at timestamptz default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_total numeric;v_refunded numeric;v_basis text;
begin
 perform private.assert_refund_admin(auth.uid());perform public.assert_marketplace_writable();
 if p_status is null or p_status not in ('pending_review','waiting_funds','approved') or p_note is null or length(trim(p_note)) not between 3 and 2000 then raise exception 'REFUND_INVALID_REVIEW';end if;
 perform 1 from public.reservations where id=p_reservation_id for update;
 if not found then raise exception 'REFUND_RESERVATION_NOT_FOUND';end if;
 if exists(select 1 from private.asaas_refund_requests where reservation_id=p_reservation_id and is_current and status in ('requesting','submitted','unknown')) then raise exception 'REFUND_RECONCILIATION_REQUIRED';end if;
 select coalesce(sum(amount),0) into v_total from public.accounting_ledger where reservation_id=p_reservation_id and entry_type='refund_required';
 select coalesce(sum(refunded_amount),0) into v_refunded from public.payments where reservation_id=p_reservation_id;
 if v_total<=v_refunded then raise exception 'REFUND_NOT_PENDING';end if;
 v_basis:=private.refund_review_basis(p_reservation_id);
 insert into private.admin_refund_reviews(reservation_id,status,basis,assigned_to,note,follow_up_at)
 values(p_reservation_id,p_status,v_basis,auth.uid(),trim(p_note),p_follow_up_at)
 on conflict(reservation_id) do update set status=excluded.status,basis=excluded.basis,assigned_to=excluded.assigned_to,note=excluded.note,follow_up_at=excluded.follow_up_at,updated_at=now();
 insert into private.admin_refund_history(reservation_id,actor_id,status,note) values(p_reservation_id,auth.uid(),p_status,trim(p_note));
 return jsonb_build_object('status',p_status,'reservation_id',p_reservation_id);
end $$;
revoke all on function public.review_admin_refund(uuid,text,text,timestamptz) from public,anon;
grant execute on function public.review_admin_refund(uuid,text,text,timestamptz) to authenticated;

create function private.notify_admin_refund_required() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.entry_type='refund_required' and new.amount>0 then
 if tg_op='UPDATE' and old.amount is not distinct from new.amount then return new;end if;
 insert into public.notifications(profile_id,type,title,body,entity_type,entity_id,data)
 select profile_id,'admin_refund_requested','Devolução para analisar','Há uma solicitação de devolução aguardando acompanhamento.','reservation',new.reservation_id,jsonb_build_object('reservation_id',new.reservation_id,'page','admin_refunds') from public.platform_admins;
 end if;return new;
end $$;
revoke all on function private.notify_admin_refund_required() from public,anon,authenticated;
create trigger admin_refund_required after insert or update of amount on public.accounting_ledger for each row execute function private.notify_admin_refund_required();

CREATE OR REPLACE FUNCTION public.asaas_refund_context(p_reservation_id uuid, p_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare r public.reservations%rowtype; p public.payments%rowtype;
 q private.asaas_refund_requests%rowtype; v_required numeric; v_count integer; v_allowed boolean;
begin
 perform private.assert_refund_admin(p_profile_id);
 select * into r from public.reservations where id=p_reservation_id;
 if not found then raise exception 'REFUND_RESERVATION_NOT_FOUND'; end if;
 select exists(select 1 from public.profiles u where u.id=p_profile_id and u.status='active'
  and (exists(select 1 from public.platform_admins a where a.profile_id=u.id)
   or exists(select 1 from public.partner_members m join public.partners pt on pt.id=m.partner_id
     where m.profile_id=u.id and m.partner_id=r.partner_id and m.active
       and (m.role='owner' or m.permissions->>'manage_finance'='true')
       and (pt.onboarding_version=0 or pt.status='approved')))) into v_allowed;
 if not v_allowed then raise exception 'REFUND_FORBIDDEN'; end if;
 if r.booking_mode<>'single' or r.monthly_cycle_id is not null or r.split_pix
   or r.payment_method<>'pix_direct_partner' or r.status not in ('refund_pending','refunded')
   or not exists(select 1 from public.cancellation_requests c where c.reservation_id=r.id
     and c.requester_type in ('partner','admin') and c.status='processed' and c.resolution='refund_required') then
   raise exception 'REFUND_SCOPE_UNSUPPORTED';
 end if;
 select count(*) into v_count from public.payments where reservation_id=r.id
   and status in ('confirmed','partially_refunded','refunded');
 if v_count<>1 then raise exception 'REFUND_PAYMENT_REVIEW_REQUIRED'; end if;
 select * into p from public.payments where reservation_id=r.id and status in ('confirmed','partially_refunded','refunded');
 select coalesce(sum(amount),0) into v_required from public.accounting_ledger where reservation_id=r.id and entry_type='refund_required';
 if p.provider<>'asaas' or p.payment_channel<>'asaas_pix' or p.provider_transaction_id !~ '^pay_[A-Za-z0-9_-]+$'
   or p.provider_transaction_id is null or p.metadata->>'simulation'='true'
   or p.metadata->>'financial_review_required'='true' or p.amount<>r.net_value or v_required<>p.amount
   or exists(select 1 from public.vouchers v where v.source_reservation_id=r.id)
   or exists(select 1 from public.voucher_usages u join public.vouchers v on v.id=u.voucher_id
     where u.reservation_id=r.id and u.status='used' and v.origin='cancellation') then
   raise exception 'REFUND_PAYMENT_REVIEW_REQUIRED';
 end if;
 select * into q from private.asaas_refund_requests where payment_id=p.id and is_current;
 return jsonb_build_object('reservation_id',r.id,'reservation_code',r.public_code,'payment_id',p.id,
  'provider_payment_id',p.provider_transaction_id,'payment_amount',p.amount,'refunded_amount',p.refunded_amount,
  'amount',greatest(v_required-p.refunded_amount,0),'status',case when p.refunded_amount>=p.amount then 'completed'
    when p.refunded_amount>0 then 'partial' when q.pix_status='REFUSED' then 'transfer_failed'
    when q.pix_status='CANCELLED' then 'transfer_cancelled' when q.pix_status='DONE' then 'transfer_done'
    when q.pix_status='AWAITING_CRITICAL_ACTION_AUTHORIZATION' then 'transfer_authorization'
    when q.pix_status is not null then 'submitted' when q.transfer_status='FAILED' then 'transfer_failed'
    when q.transfer_status='CANCELLED' then 'transfer_cancelled' when q.transfer_status='BLOCKED' then 'transfer_blocked'
    when q.transfer_status='DONE' then 'transfer_done' else coalesce(q.status,'not_requested') end,
  'request_id',q.id,'provider_pix_transaction_id',q.provider_pix_transaction_id,'pix_status',q.pix_status,'provider_transfer_id',q.provider_transfer_id,'request_created_at',q.created_at,
  'transfer_status',case when q.pix_status='REFUSED' then 'FAILED' when q.pix_status in ('DONE','CANCELLED') then q.pix_status when q.pix_status is not null then 'PENDING' else q.transfer_status end,
  'transfer_fail_reason',case when q.pix_status is not null then q.pix_refusal_reason else q.transfer_fail_reason end,
  'transfer_checked_at',coalesce(q.pix_observed_at,q.transfer_observed_at),'error_code',q.error_code,'attempts',coalesce(q.attempts,0),
  'can_retry',coalesce(r.status='refund_pending' and p.refunded_amount=0 and p.cash_availability='received'
    and q.status in ('submitted','unknown','rejected')
    and (q.provider_pix_transaction_id is not null or q.provider_transfer_id is not null)
    and (q.provider_pix_transaction_id is null or q.pix_status in ('REFUSED','CANCELLED'))
    and (q.provider_transfer_id is null or q.transfer_status in ('FAILED','CANCELLED')),false),
  'can_submit',r.status='refund_pending' and p.refunded_amount=0 and p.cash_availability='received'
    and q.provider_transfer_id is null and q.provider_pix_transaction_id is null and (q.id is null or q.status='rejected'));
end;$function$;

CREATE OR REPLACE FUNCTION public.asaas_refund_payments(p_reservation_id uuid, p_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.reservations%rowtype;p record;q private.asaas_refund_requests%rowtype;
 v_v2 boolean;v_required numeric;v_total numeric;v_prior numeric:=0;v_target numeric;v_left numeric;v_allowed boolean;
 v_denial private.asaas_refund_denials%rowtype;v_unmatched private.asaas_refund_denials%rowtype;v_split_review boolean;v_denial_review boolean;
 v_rows jsonb:='[]';v_status text;v_submit boolean;v_retry boolean;v_route jsonb;
begin
 perform private.assert_refund_admin(p_profile_id);
 select * into r from public.reservations where id=p_reservation_id;
 if not found then raise exception 'REFUND_RESERVATION_NOT_FOUND';end if;
 select exists(select 1 from public.profiles u where u.id=p_profile_id and u.status='active'
  and (exists(select 1 from public.platform_admins a where a.profile_id=u.id)
   or exists(select 1 from public.partner_members m join public.partners pt on pt.id=m.partner_id
     where m.profile_id=u.id and m.partner_id=r.partner_id and m.active
       and (m.role='owner' or m.permissions->>'manage_finance'='true')
       and (pt.onboarding_version=0 or pt.status='approved')))) into v_allowed;
 if not v_allowed then raise exception 'REFUND_FORBIDDEN';end if;
 v_v2:=exists(select 1 from private.cancellation_payment_choices where reservation_id=r.id);
 if (not v_v2 and (r.booking_mode<>'single' or r.monthly_cycle_id is not null)) or r.status not in ('refund_pending','refunded')
  or not exists(select 1 from public.cancellation_requests c where c.reservation_id=r.id and c.status='processed'
    and c.resolution='refund_required' and (c.requester_type in ('partner','admin') or c.resolution_details->>'flow'='cancellation_7d_v1')) then raise exception 'REFUND_SCOPE_UNSUPPORTED';end if;
 if (not v_v2 and exists(select 1 from public.vouchers where source_reservation_id=r.id))
  or exists(select 1 from public.voucher_usages u join public.vouchers v on v.id=u.voucher_id
     where u.reservation_id=r.id and u.status='used' and v.origin='cancellation') then raise exception 'REFUND_PAYMENT_REVIEW_REQUIRED';end if;
 select coalesce(sum(amount),0) into v_required from public.accounting_ledger where reservation_id=r.id and entry_type='refund_required';
 select coalesce(sum(amount),0) into v_total from public.payments where reservation_id=r.id and status in ('confirmed','partially_refunded','refunded') and (not v_v2 or id in(select payment_id from private.cancellation_payment_choices where reservation_id=r.id and resolution='refund'));
 if v_total<=0 or v_required<=0 or v_required<>v_total then raise exception 'REFUND_PAYMENT_REVIEW_REQUIRED';end if;
 for p in select pay.*,rp.profile_id payer_id,u.display_name payer_name
   from public.payments pay left join public.reservation_participants rp on rp.id::text=pay.metadata->>'participant_id' and rp.reservation_id=r.id
   left join public.profiles u on u.id=coalesce(rp.profile_id,r.payment_responsible_id,r.user_id)
   where pay.reservation_id=r.id and pay.status in ('confirmed','partially_refunded','refunded') and (not v_v2 or pay.id in(select payment_id from private.cancellation_payment_choices where reservation_id=r.id and resolution='refund')) order by pay.paid_at nulls last,pay.id loop
  if v_v2 and p.payment_channel not in ('asaas_pix','asaas_card') then continue;end if;
  if p.provider<>'asaas' or p.payment_channel not in ('asaas_pix','asaas_card') or p.provider_transaction_id is null
    or p.provider_transaction_id !~ '^pay_[A-Za-z0-9_-]+$' or p.metadata->>'simulation'='true'
    or p.metadata->>'financial_review_required'='true' then raise exception 'REFUND_PAYMENT_REVIEW_REQUIRED';end if;
  v_target:=round(v_required*(v_prior+p.amount)/v_total,2)-round(v_required*v_prior/v_total,2);v_prior:=v_prior+p.amount;
  v_left:=greatest(v_target-p.refunded_amount,0);
  select * into q from private.asaas_refund_requests where payment_id=p.id and is_current;
  v_retry:=coalesce(v_left>0 and q.status in ('submitted','unknown','rejected')
    and (q.provider_pix_transaction_id is not null or q.provider_transfer_id is not null)
    and (q.provider_pix_transaction_id is null or q.pix_status in ('REFUSED','CANCELLED'))
    and (q.provider_transfer_id is null or q.transfer_status in ('FAILED','CANCELLED')),false);
  v_submit:=v_left>0 and r.status='refund_pending' and (q.id is null or q.status in ('rejected','completed'))
    and (q.id is null or q.status='completed' or (q.provider_transfer_id is null and q.provider_pix_transaction_id is null))
    and (p.cash_availability='received' or (p.payment_channel='asaas_card' and p.cash_availability='awaiting_credit'));
  v_status:=case when v_left=0 then 'completed' when q.status='completed' then 'partial'
    when q.pix_status='REFUSED' or q.transfer_status='FAILED' then 'transfer_failed'
    when q.pix_status='CANCELLED' or q.transfer_status='CANCELLED' then 'transfer_cancelled'
    when q.pix_status='AWAITING_CRITICAL_ACTION_AUTHORIZATION' then 'transfer_authorization'
    when q.pix_status='DONE' or q.transfer_status='DONE' then 'transfer_done'
    when q.transfer_status='BLOCKED' then 'transfer_blocked'
    else coalesce(q.status,'not_requested') end;
  select * into v_denial from private.asaas_refund_denials where payment_id=p.id and request_id=q.id order by received_at desc,provider_event_id limit 1;
  select * into v_unmatched from private.asaas_refund_denials where payment_id=p.id and correlation='unmatched' order by received_at desc,provider_event_id limit 1;
  v_split_review:=coalesce(v_left>0 and p.metadata#>>'{asaas_split,status}'='REFUNDED'
    and coalesce((p.metadata#>>'{asaas_split,refunded_amount}')::numeric,0)<coalesce((p.metadata#>>'{asaas_split,commission_amount}')::numeric,0),false);
  v_denial_review:=coalesce(v_left>0 and v_denial.request_id=q.id and q.status in ('requesting','submitted','unknown')
    and not v_retry and q.pix_status is distinct from 'DONE' and q.transfer_status is distinct from 'DONE',false);
  if v_split_review or v_denial_review then v_submit:=false;v_retry:=false;end if;
  if v_denial_review then v_status:='denial_review';end if;
  v_route:=public.asaas_payment_route(jsonb_build_object('id',p.provider_transaction_id));
  v_rows:=v_rows||jsonb_build_array(jsonb_build_object('reservation_id',r.id,'reservation_code',r.public_code,
    'payment_id',p.id,'provider_payment_id',p.provider_transaction_id,'payer_name',coalesce(p.payer_name,'Responsável pelo pagamento'),
    'billing_type',case p.payment_channel when 'asaas_card' then 'CREDIT_CARD' else 'PIX' end,
    'payment_amount',p.amount,'refunded_amount',p.refunded_amount,'refund_target',v_target,'amount',v_left,
    'status',v_status,'can_submit',coalesce(v_submit,false),'can_retry',v_retry,'request_id',q.id,'request_amount',q.amount,
    'request_created_at',q.created_at,'provider_transfer_id',q.provider_transfer_id,'provider_pix_transaction_id',q.provider_pix_transaction_id,
    'transfer_status',q.transfer_status,'pix_status',q.pix_status,'transfer_fail_reason',coalesce(q.pix_refusal_reason,q.transfer_fail_reason),
    'denial_reason',coalesce(v_denial.reason,(select z->>'denialReason' from jsonb_array_elements(coalesce(q.provider_evidence->'refunds','[]'::jsonb)) z
      where z->>'status'='DENIED' and z->>'description'='Cancelamento '||r.public_code||' - solicitação '||q.id::text and z->'value'=to_jsonb(q.amount) limit 1)),
    'unmatched_denial',case when v_unmatched.provider_event_id is not null then jsonb_build_object('reason',v_unmatched.reason,'event_created_at',v_unmatched.event_created_at,'correlation','unmatched') end,
    'split_review_required',v_split_review,'denial_review_required',v_denial_review,
    'split_already_reversed',coalesce((p.metadata#>>'{asaas_split,commission_amount}')::numeric>0
      and (p.metadata#>>'{asaas_split,refunded_amount}')::numeric=(p.metadata#>>'{asaas_split,commission_amount}')::numeric,false),
    'error_code',q.error_code,'attempts',coalesce(q.attempts,0),'route',v_route));
 end loop;
 return jsonb_build_object('review_approved',exists(select 1 from private.admin_refund_reviews rv where rv.reservation_id=r.id and rv.status='approved' and rv.basis=private.refund_review_basis(r.id)),'reservation_id',r.id,'reservation_code',r.public_code,'payments',v_rows,
   'payment_amount',v_total,'refund_target',v_required,'refunded_amount',(select coalesce(sum((x->>'refunded_amount')::numeric),0) from jsonb_array_elements(v_rows) x));
end;$function$;

CREATE OR REPLACE FUNCTION public.claim_asaas_refund_payment(p_reservation_id uuid, p_profile_id uuid, p_payment_id uuid, p_amount numeric, p_expected_request_id uuid DEFAULT NULL::uuid, p_retry_evidence jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb;all_c jsonb;q private.asaas_refund_requests%rowtype;fresh private.asaas_refund_requests%rowtype;
 p jsonb;t jsonb;x jsonb;v_when timestamptz;v_done numeric;v_description text;
begin
 perform 1 from public.reservations where id=p_reservation_id for update;
 perform private.assert_refund_approved(p_reservation_id,p_profile_id);
 if exists(select 1 from private.asaas_refund_requests where reservation_id=p_reservation_id and payment_id<>p_payment_id and is_current and status in ('requesting','submitted','unknown')) then raise exception 'REFUND_RECONCILIATION_REQUIRED';end if;
 all_c:=public.asaas_refund_payments(p_reservation_id,p_profile_id);
 select value into c from jsonb_array_elements(all_c->'payments') where value->>'payment_id'=p_payment_id::text;
 if c is null then raise exception 'REFUND_PAYMENT_NOT_FOUND';end if;
 select * into q from private.asaas_refund_requests where payment_id=p_payment_id and is_current for update;
 if q.id is distinct from p_expected_request_id then return c||jsonb_build_object('claimed',false);end if;
 if p_retry_evidence is not null then
  if not (c->>'can_retry')::boolean then return c||jsonb_build_object('claimed',false);end if;
  p:=p_retry_evidence->'payment';t:=nullif(p_retry_evidence->'transfer','null'::jsonb);x:=nullif(p_retry_evidence->'pix','null'::jsonb);
  v_when:=(p_retry_evidence->>'observed_at')::timestamptz;
  if v_when is null or v_when<clock_timestamp()-interval '60 seconds' or v_when>clock_timestamp()+interval '5 seconds'
    or v_when<q.created_at then raise exception 'REFUND_RETRY_STALE_EVIDENCE';end if;
  if p->>'id' is distinct from c->>'provider_payment_id' or p->>'billingType' is distinct from c->>'billing_type'
    or (p->>'value')::numeric is distinct from (c->>'payment_amount')::numeric
    or coalesce((p->>'deleted')::boolean,false) or jsonb_typeof(p->'refunds') is distinct from 'array'
    or coalesce(p->>'status','') not in ('RECEIVED','CONFIRMED','PARTIALLY_REFUNDED') then raise exception 'REFUND_RETRY_PAYMENT_UNSAFE';end if;
  if exists(select 1 from jsonb_array_elements(p->'refunds') j(value) where coalesce(j.value->>'status','') not in ('CANCELLED','DENIED','DONE')) then raise exception 'REFUND_RETRY_PAYMENT_UNSAFE';end if;
  select coalesce(sum((j.value->>'value')::numeric),0) into v_done from jsonb_array_elements(p->'refunds') j(value) where j.value->>'status'='DONE';
  if v_done is distinct from (c->>'refunded_amount')::numeric or v_done<>q.baseline_refunded_amount then raise exception 'REFUND_RETRY_PAYMENT_UNSAFE';end if;
  v_description:='Cancelamento '||(c->>'reservation_code')||' - solicitação '||q.id::text;
  if q.provider_transfer_id is not null and (t->>'id' is distinct from q.provider_transfer_id
    or coalesce(t->>'status','') not in ('FAILED','CANCELLED') or t->>'description' is distinct from v_description
    or t->>'operationType' is distinct from 'PIX' or (t->>'value')::numeric is distinct from q.amount) then raise exception 'REFUND_RETRY_FAILURE_UNCONFIRMED';end if;
  if q.provider_pix_transaction_id is not null and (x->>'id' is distinct from q.provider_pix_transaction_id
    or coalesce(x->>'status','') not in ('REFUSED','CANCELLED') or x->>'description' is distinct from v_description
    or coalesce(x->>'type','') not in ('CREDIT_REFUND','DEBIT_REFUND') or x->>'payment' is distinct from c->>'provider_payment_id'
    or (x->>'value')::numeric is distinct from q.amount) then raise exception 'REFUND_RETRY_FAILURE_UNCONFIRMED';end if;
 else
  if not (c->>'can_submit')::boolean then return c||jsonb_build_object('claimed',false);end if;
 end if;
 -- Cancellation returns the whole outstanding amount of this payer's payment.
 -- NULL means server-calculated; legacy clients may send only that exact value.
 if p_amount is not null and (p_amount<=0 or p_amount<>round(p_amount,2)
   or p_amount is distinct from (c->>'amount')::numeric) then raise exception 'REFUND_FULL_AMOUNT_REQUIRED';end if;
 p_amount:=(c->>'amount')::numeric;
 if p_amount is null or p_amount<=0 then raise exception 'REFUND_INVALID_AMOUNT';end if;
 update private.asaas_refund_requests set is_current=false,retry_evidence=case when p_retry_evidence is not null
   then jsonb_build_object('checked_at',v_when,'transfer_status',t->>'status','pix_status',x->>'status','confirmed_by',p_profile_id) else retry_evidence end where id=q.id;
 insert into private.asaas_refund_requests(reservation_id,payment_id,requested_by,amount,status,previous_request_id,attempts,baseline_refunded_amount)
  values(p_reservation_id,p_payment_id,p_profile_id,p_amount,'requesting',q.id,coalesce(q.attempts,0)+1,(c->>'refunded_amount')::numeric) returning * into fresh;
 return c||jsonb_build_object('claimed',true,'request_id',fresh.id,'claim_token',fresh.claim_token,'request_amount',p_amount,'request_created_at',fresh.created_at);
end;$function$;

CREATE OR REPLACE FUNCTION public.claim_asaas_refund(p_reservation_id uuid, p_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare c jsonb; q private.asaas_refund_requests%rowtype; prev private.asaas_refund_requests%rowtype;
begin
 raise exception 'REFUND_USE_REVIEWED_PAYMENT_FLOW';
 perform 1 from public.reservations where id=p_reservation_id for update;
 c:=public.asaas_refund_context(p_reservation_id,p_profile_id);
 if not coalesce((c->>'can_submit')::boolean,false) then return c||jsonb_build_object('claimed',false); end if;
 select * into prev from private.asaas_refund_requests where payment_id=(c->>'payment_id')::uuid and is_current for update;
 -- Even preflight/rejected attempts keep their identity; never reuse a correlation ID.
 update private.asaas_refund_requests set is_current=false where id=prev.id;
 insert into private.asaas_refund_requests(reservation_id,payment_id,requested_by,amount,status,previous_request_id,attempts)
 values(p_reservation_id,(c->>'payment_id')::uuid,p_profile_id,(c->>'amount')::numeric,'requesting',prev.id,coalesce(prev.attempts,0)+1)
 returning * into q;
 return public.asaas_refund_context(p_reservation_id,p_profile_id)||jsonb_build_object('claimed',true,'claim_token',q.claim_token);
end;$function$;

CREATE OR REPLACE FUNCTION public.claim_asaas_refund_retry(p_reservation_id uuid, p_profile_id uuid, p_expected_request_id uuid, p_payment jsonb, p_transfer jsonb, p_pix jsonb, p_observed_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare c jsonb; q private.asaas_refund_requests%rowtype; fresh private.asaas_refund_requests%rowtype;
 v_description text;
begin
 raise exception 'REFUND_USE_REVIEWED_PAYMENT_FLOW';
 perform 1 from public.reservations where id=p_reservation_id for update;
 c:=public.asaas_refund_context(p_reservation_id,p_profile_id);
 if (c->>'request_id')::uuid is distinct from p_expected_request_id
   or not coalesce((c->>'can_retry')::boolean,false) then
   return c||jsonb_build_object('claimed',false); end if;
 select * into q from private.asaas_refund_requests where id=p_expected_request_id and is_current for update;
 if not found then return c||jsonb_build_object('claimed',false); end if;
 if p_observed_at is null or p_observed_at<clock_timestamp()-interval '60 seconds'
   or p_observed_at>clock_timestamp()+interval '5 seconds'
   or p_observed_at<q.created_at
   or p_observed_at<coalesce(q.pix_observed_at,q.created_at)
   or p_observed_at<coalesce(q.transfer_observed_at,q.created_at) then raise exception 'REFUND_RETRY_STALE_EVIDENCE'; end if;
 -- Evidence is supplied only by the authenticated Edge's server-side Asaas GETs.
 -- No pending/completed/unknown refund, even when the transfer itself failed.
 if p_payment->>'id' is distinct from c->>'provider_payment_id'
   or p_payment->>'status' is distinct from 'RECEIVED'
   or p_payment->>'billingType' is distinct from 'PIX'
   or (p_payment->>'value')::numeric is distinct from (c->>'payment_amount')::numeric
   or coalesce((p_payment->>'deleted')::boolean,false)
   or (p_payment->'split' is not null and p_payment->'split'<>'null'::jsonb and p_payment->'split'<>'[]'::jsonb)
   or jsonb_typeof(p_payment->'refunds') is distinct from 'array' then raise exception 'REFUND_RETRY_PAYMENT_UNSAFE'; end if;
 if exists(select 1 from jsonb_array_elements(p_payment->'refunds') x where x->>'status' is distinct from 'CANCELLED') then
   raise exception 'REFUND_RETRY_PAYMENT_UNSAFE'; end if;
 v_description:='Cancelamento '||(c->>'reservation_code')||' - solicitação '||q.id::text;
 if q.provider_transfer_id is not null then
   if p_transfer->>'id' is distinct from q.provider_transfer_id
     or coalesce(p_transfer->>'status','') not in ('FAILED','CANCELLED')
     or p_transfer->>'description' is distinct from v_description
     or p_transfer->>'operationType' is distinct from 'PIX'
     or (p_transfer->>'value')::numeric is distinct from q.amount then raise exception 'REFUND_RETRY_FAILURE_UNCONFIRMED'; end if;
 elsif p_transfer is not null then raise exception 'REFUND_RETRY_FAILURE_UNCONFIRMED'; end if;
 if q.provider_pix_transaction_id is not null then
   if p_pix->>'id' is distinct from q.provider_pix_transaction_id
     or coalesce(p_pix->>'status','') not in ('REFUSED','CANCELLED')
     or coalesce(p_pix->>'type','') not in ('CREDIT_REFUND','DEBIT_REFUND')
     or p_pix->>'description' is distinct from v_description
     or p_pix->>'payment' is distinct from c->>'provider_payment_id'
     or (p_pix->>'value')::numeric is distinct from q.amount then raise exception 'REFUND_RETRY_FAILURE_UNCONFIRMED'; end if;
 elsif p_pix is not null then raise exception 'REFUND_RETRY_FAILURE_UNCONFIRMED'; end if;
 update private.asaas_refund_requests set is_current=false,
   retry_evidence=jsonb_build_object('checked_at',p_observed_at,'payment_status',p_payment->>'status',
     'transfer_status',p_transfer->>'status','pix_status',p_pix->>'status','confirmed_by',p_profile_id),updated_at=now() where id=q.id;
 insert into private.asaas_refund_requests(reservation_id,payment_id,requested_by,amount,status,previous_request_id,attempts)
 values(q.reservation_id,q.payment_id,p_profile_id,(c->>'amount')::numeric,'requesting',q.id,q.attempts+1) returning * into fresh;
 return public.asaas_refund_context(p_reservation_id,p_profile_id)||jsonb_build_object('claimed',true,'claim_token',fresh.claim_token);
end;$function$;

CREATE OR REPLACE FUNCTION public.record_cash_cancellation_refund(p_choice_id uuid, p_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare x private.cancellation_payment_choices%rowtype;r public.reservations%rowtype;p public.payments%rowtype;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and status='active') then raise exception 'Autenticação ativa obrigatória';end if;
 select * into x from private.cancellation_payment_choices where id=p_choice_id;
 select * into r from public.reservations where id=x.reservation_id for update;
 select * into x from private.cancellation_payment_choices where id=p_choice_id for update;
 if not private.is_admin() and not exists(select 1 from public.partner_members where partner_id=r.partner_id and profile_id=auth.uid() and active and (role='owner' or permissions->>'manage_finance'='true')) then raise exception 'Sem permissão financeira';end if;
 perform private.assert_refund_approved(r.id,auth.uid());
 select * into p from public.payments where id=x.payment_id for update;
 if p.payment_channel in ('asaas_pix','asaas_card') or x.resolution<>'refund' then raise exception 'Utilize a conciliação do meio original';end if;
 if nullif(trim(p_reference),'') is null or length(p_reference)>500 then raise exception 'Informe o comprovante da devolução';end if;
 if p.refunded_amount=p.amount then return jsonb_build_object('completed',true);end if;
 update public.payments set refunded_amount=amount,status='refunded',refunded_at=now(),metadata=metadata||jsonb_build_object('refund_recorded_by',auth.uid(),'refund_reference',trim(p_reference)) where id=p.id;
 perform private.sync_cancellation_choices(x.request_id);
 return jsonb_build_object('completed',true);
end;$function$;

CREATE OR REPLACE FUNCTION public.cancellation_case_directory()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and status='active') then raise exception 'Autenticação ativa obrigatória';end if;
 select coalesce(jsonb_agg(x order by x.created_at desc),'[]') into v_result from (
 select c.id,c.reservation_id,r.public_code,c.created_at,c.status,c.reason,c.resolution,c.reviewed_at,c.resolution_details,
 private.is_admin() can_decide,private.is_partner_member(r.partner_id) can_comment,
 private.is_admin() can_refund,
 coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'payment_id',s.payment_id,'amount',s.amount,'resolution',s.resolution,
 'voucher_id',s.voucher_id,'mine',s.beneficiary_id=auth.uid(),'refunded_amount',p.refunded_amount,
 'can_choose',s.beneficiary_id=auth.uid() and s.resolution='refund' and p.refunded_amount=0 and not exists(select 1 from private.asaas_refund_requests q where q.payment_id=p.id and q.is_current),
 'refund_state',case when p.refunded_amount>=s.amount then 'completed' when exists(select 1 from private.asaas_refund_requests q where q.payment_id=p.id and q.is_current and q.status in ('requesting','submitted','unknown')) then 'processing' else 'review' end,
 'cash',p.payment_channel not in ('asaas_pix','asaas_card')) order by s.id)
 from private.cancellation_payment_choices s join public.payments p on p.id=s.payment_id where s.request_id=c.id
 and (s.beneficiary_id=auth.uid() or private.is_admin() or private.is_partner_member(r.partner_id))),'[]') choices
 from public.cancellation_requests c join public.reservations r on r.id=c.reservation_id
 where c.resolution_details->>'flow'='cancellation_7d_v1' and (c.requested_by=auth.uid() or private.is_admin() or private.is_partner_member(r.partner_id)
 or exists(select 1 from private.cancellation_payment_choices s where s.request_id=c.id and s.beneficiary_id=auth.uid()))
 ) x;
 return v_result;
end;$function$;

CREATE OR REPLACE FUNCTION public.finish_asaas_refund(p_request_id uuid, p_claim_token uuid, p_status text, p_error_code text DEFAULT NULL::text, p_evidence jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare q private.asaas_refund_requests%rowtype;
begin
 if p_status not in ('submitted','unknown','rejected') then raise exception 'REFUND_INVALID_RESULT'; end if;
 select * into q from private.asaas_refund_requests where id=p_request_id;
 if not found then raise exception 'REFUND_REQUEST_NOT_FOUND'; end if;
 perform 1 from public.reservations where id=q.reservation_id for update;
 select * into q from private.asaas_refund_requests where id=p_request_id for update;
 if not q.is_current then return; end if;
 if q.claim_token<>p_claim_token then raise exception 'REFUND_STALE_CLAIM'; end if;
 -- A webhook may finish before the HTTP request returns.
 if q.status in ('completed','partial') then return; end if;
 if q.status<>'requesting' then return; end if;
 update private.asaas_refund_requests set status=p_status,error_code=p_error_code,
   provider_evidence=p_evidence,updated_at=now() where id=q.id;
 if p_status='rejected' and p_error_code like '%INSUFFICIENT_BALANCE' then
 update private.admin_refund_reviews set status='waiting_funds',note='Saldo insuficiente na conferência ou na execução. Regularizar antes de aprovar novamente.',updated_at=now() where reservation_id=q.reservation_id;
 insert into private.admin_refund_history(reservation_id,actor_id,status,note) values(q.reservation_id,q.requested_by,'waiting_funds','Saldo insuficiente. Nenhuma devolução confirmada.');
 end if;
end;$function$;

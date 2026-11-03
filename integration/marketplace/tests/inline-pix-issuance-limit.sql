-- Exercise a retryable Sandbox session locally in a single rolled-back transaction.
begin;
do $$
declare
 s private.asaas_checkout_sessions%rowtype;
 route jsonb; info jsonb; retry jsonb;
begin
 select cs.* into strict s from private.asaas_checkout_sessions cs
 join private.asaas_inline_pix ip using(session_key)
 join public.pix_installments pi on pi.id=cs.installment_id
 where cs.status='failed' and cs.retry_outcome='rejected' and cs.retry_token is not null
   and ip.state='open' and ip.provider_payment_id is null
   and private.inline_pix_deadline(cs.reservation_id,pi.monthly_payment_stage_id)>now()+interval '1 minute'
 order by cs.updated_at desc limit 1;
 select jsonb_build_object('partner_id',r.partner_id,'issuer_account_id',ct.issuer_account_id,
   'issuer_wallet_id',ct.issuer_wallet_id,'split_wallet_id',ct.split_wallet_id)
 into strict route from public.reservations r join private.asaas_split_contracts ct on ct.reservation_id=r.id
 where r.id=s.reservation_id;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 info:=public.claim_asaas_inline_pix(s.reservation_id,s.owner_id,route,true,s.retry_token);
 perform public.start_asaas_inline_pix(s.session_key,(info->>'claim_token')::uuid,'cus_issuance_rollback');
 retry:=public.finish_asaas_inline_pix_attempt(s.session_key,(info->>'claim_token')::uuid,'rejected_issuance_limit',400);
 info:=public.claim_asaas_inline_pix(s.reservation_id,s.owner_id,route,true);
 if (info->>'claimed')::boolean or not (info->>'retry_issuance_limited')::boolean or info->>'retry_outcome'<>'rejected'
    or info->>'retry_token' is distinct from retry->>'retryToken' or (info->>'amount')::numeric<>s.amount then
   raise exception 'Did not preserve the refused charge and its reason'; end if;
 info:=public.claim_asaas_inline_pix(s.reservation_id,s.owner_id,route,true,(retry->>'retryToken')::uuid);
 perform public.start_asaas_inline_pix(s.session_key,(info->>'claim_token')::uuid,'cus_issuance_rollback');
 perform public.finish_asaas_inline_pix_attempt(s.session_key,(info->>'claim_token')::uuid,'unknown',503);
 if exists(select 1 from private.asaas_checkout_sessions where session_key=s.session_key
     and (status<>'unknown' or retry_issuance_limited or retry_token is not null)) then
   raise exception 'An uncertain result inherited the earlier limit or retry'; end if;
end $$;
rollback;
select 'PASS' as issuance_limit;

-- Discardable test on RES-001066, no provider calls. Stops if its real state changes.
begin;
do $$
declare r public.reservations%rowtype; mc public.monthly_cycles%rowtype;px public.pix_installments%rowtype;
 rp public.reservation_participants%rowtype;other uuid;px2 uuid;rp2 uuid;cs jsonb;cs2 jsonb;j jsonb;pay jsonb;route jsonb;
 issuer text:=gen_random_uuid()::text;wallet text:=gen_random_uuid()::text;commission_wallet text:=gen_random_uuid()::text;
 amount1 numeric;total numeric;deadline timestamptz;original_initial timestamptz;split_mode boolean:=false;
begin
 select * into strict r from public.reservations where public_code='RES-001066';
 select * into strict mc from public.monthly_cycles where id=r.monthly_cycle_id;
 select * into strict px from public.pix_installments where reservation_id=r.id and status='pending';
 select * into strict rp from public.reservation_participants where id=px.participant_id;
 if exists(select 1 from public.payments where reservation_id=r.id) or exists(select 1 from private.asaas_checkout_sessions where reservation_id=r.id) then raise exception 'Fixture has payment or checkout; use an isolated copy';end if;
 select marketplace_user_id into strict other from private.marketplace_pilot_accounts where enabled and marketplace_user_id<>r.user_id limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
 update private.asaas_inline_pix_settings set heartbeat_at=clock_timestamp() where singleton;
 total:=r.net_value;amount1:=case when split_mode then round(total*0.6,2) else total end;
 if split_mode then
  update public.reservation_participants set amount_due=amount1 where id=rp.id;
  update public.pix_installments set amount_due=amount1 where id=px.id;
  insert into public.reservation_participants(reservation_id,profile_id,amount_due,status,payment_role,monthly_payment_stage_id)
   values(r.id,other,total-amount1,'pending','pix_share',px.monthly_payment_stage_id) returning id into rp2;
  insert into public.pix_installments(partner_id,reservation_id,participant_id,amount_due,status,provider,txid,monthly_payment_stage_id)
   values(r.partner_id,r.id,rp2,total-amount1,'pending','asaas','ROLLBACK-'||replace(gen_random_uuid()::text,'-',''),px.monthly_payment_stage_id) returning id into px2;
 end if;
 route:=jsonb_build_object('partner_id',r.partner_id,'issuer_account_id',issuer,'issuer_wallet_id',wallet,'split_wallet_id',commission_wallet);
 begin perform public.claim_asaas_inline_pix(r.id,gen_random_uuid(),route,true);raise exception 'Unknown payer accepted';exception when others then if sqlerrm<>'UNAUTHORIZED' then raise;end if;end;
 if not split_mode then
  begin perform public.claim_asaas_inline_pix(r.id,other,route,true);raise exception 'Other payer accepted';exception when others then if sqlerrm<>'Somente o titular pode pagar sua cota pendente' then raise;end if;end;
 end if;
 cs:=public.claim_asaas_inline_pix(r.id,r.user_id,route,true);
 if not (cs->>'claimed')::boolean or (cs->>'amount')::numeric<>amount1 then raise exception 'Incorrect monthly charge: %',cs;end if;
 if (cs->>'due_at')::timestamptz<>mc.initial_due_at or (cs->>'provider_due_at')::timestamptz<>mc.balance_due_at then raise exception 'Incorrect guarantee/balance deadline';end if;
 if (cs->>'split_commission_amount')::numeric<>round(amount1*(cs->>'split_commission_rate')::numeric/100,2) then raise exception 'Incorrect commission';end if;
 perform public.start_asaas_inline_pix(cs->>'session_key',(cs->>'claim_token')::uuid,'cus_monthly_rollback');
 cs2:=public.claim_asaas_inline_pix(r.id,r.user_id,route,true);
 if (cs2->>'claimed')::boolean then raise exception 'Repeated monetary request allowed';end if;
 pay:=jsonb_build_object('id','pay_monthly_rollback_'||replace(gen_random_uuid()::text,'-',''),'customer','cus_monthly_rollback',
 'value',amount1,'netValue',amount1-1.99,'status','PENDING','billingType','PIX','externalReference',cs->>'external_reference',
 'split',jsonb_build_array(jsonb_build_object('id','spl_monthly_test','walletId',commission_wallet,'fixedValue',cs->'split_commission_amount','status','DONE')));
 perform public.bind_asaas_inline_pix(cs->>'session_key',pay);
 if not public.can_present_asaas_inline_pix(cs->>'session_key',r.user_id) then raise exception 'QR not available';end if;
 if public.can_present_asaas_inline_pix(cs->>'session_key',other) then raise exception 'QR leaked';end if;
 original_initial:=mc.initial_due_at;
 update public.monthly_cycles set initial_due_at=now()-interval '1 minute' where id=mc.id;
 if public.can_present_asaas_inline_pix(cs->>'session_key',r.user_id) then raise exception 'Expired guarantee QR still exposed';end if;
 update private.asaas_inline_pix set next_check_at=now()-interval '1 second' where session_key=cs->>'session_key';
 j:=public.claim_asaas_inline_pix_jobs();
 if not exists(select 1 from jsonb_array_elements(j) x where x->>'session_key'=cs->>'session_key' and (x->>'close_required')::boolean) then raise exception 'Expired guarantee not closed by worker';end if;
 update public.monthly_cycles set initial_due_at=original_initial where id=mc.id;
 -- Authenticated provider evidence exercises the normal webhook and financial reconciliation, without HTTP.
 pay:=pay||jsonb_build_object('status','RECEIVED');
 begin perform public.apply_asaas_account_event('rollback-wrong-account','PAYMENT_RECEIVED',pay,gen_random_uuid()::text);raise exception 'Wrong issuing account accepted';exception when others then if sqlerrm<>'ASAAS_EVENT_ACCOUNT_MISMATCH' then raise;end if;end;
 j:=public.apply_asaas_account_event('rollback-paid','PAYMENT_RECEIVED',pay,issuer);
 if coalesce((j->>'review_required')::boolean,false) then raise exception 'Expected regular monthly payment: %',j;end if;
 perform public.apply_asaas_account_event('rollback-paid-again','PAYMENT_RECEIVED',pay,issuer);
 if (select count(*) from public.payments where reservation_id=r.id)<>1 then raise exception 'Duplicated payment';end if;
 if (select total_paid from public.monthly_cycles where id=mc.id)<>amount1 then raise exception 'Monthly amount not reconciled';end if;
 if (select status from public.reservation_participants where id=rp.id)<>'paid' then raise exception 'Payer not confirmed';end if;
 if split_mode then
  if (select status from public.reservations where id=r.id)<>'pending_payment' then raise exception 'Monthly fully confirmed before remaining share';end if;
  if (select guarantee_reached_at from public.monthly_cycles where id=mc.id) is null then raise exception 'Guarantee not reached';end if;
  update public.monthly_cycles set initial_due_at=now()-interval '1 minute' where id=mc.id;
  cs2:=public.claim_asaas_inline_pix(r.id,other,route,true);
  if (cs2->>'amount')::numeric<>total-amount1 or (cs2->>'due_at')::timestamptz<>mc.balance_due_at then raise exception 'Remaining share or deadline incorrect';end if;
  if ((cs->>'split_commission_amount')::numeric+(cs2->>'split_commission_amount')::numeric)<>round(total*(cs->>'split_commission_rate')::numeric/100,2) then raise exception 'Split rounding diverges';end if;
  perform public.start_asaas_inline_pix(cs2->>'session_key',(cs2->>'claim_token')::uuid,'cus_monthly_other');
  pay:=pay||jsonb_build_object('id','pay_monthly_other_'||replace(gen_random_uuid()::text,'-',''),'customer','cus_monthly_other','value',total-amount1,'netValue',total-amount1-1.99,'externalReference',cs2->>'external_reference',
   'split',jsonb_build_array(jsonb_build_object('id','spl_monthly_other','walletId',commission_wallet,'fixedValue',cs2->'split_commission_amount','status','DONE')));
  perform public.bind_asaas_inline_pix(cs2->>'session_key',pay);
  perform public.apply_asaas_account_event('rollback-other-paid','PAYMENT_RECEIVED',pay,issuer);
 end if;
 if (select status from public.monthly_cycles where id=mc.id)<>'fully_paid' or (select status from public.reservations where id=r.id)<>'confirmed' then raise exception 'Monthly not fully confirmed';end if;
 if exists(select 1 from public.monthly_cycle_events where monthly_cycle_id=mc.id and financial_status not in ('confirmed','cancelled')) then raise exception 'Monthly events not confirmed';end if;
 if public.can_present_asaas_inline_pix(cs->>'session_key',r.user_id) then raise exception 'Paid QR still exposed';end if;
 if (select count(*) from public.pix_installments where reservation_id=r.id)<>(case when split_mode then 2 else 1 end) then raise exception 'Second collection created';end if;
 if has_function_privilege('authenticated','public.claim_asaas_inline_pix(uuid,uuid,jsonb,boolean,uuid)','execute') or has_function_privilege('anon','private.inline_pix_deadline(uuid,uuid)','execute') then raise exception 'Privileged RPC exposed';end if;
end $$;
rollback;
begin;
do $$
declare r public.reservations%rowtype; mc public.monthly_cycles%rowtype;px public.pix_installments%rowtype;
 rp public.reservation_participants%rowtype;other uuid;px2 uuid;rp2 uuid;cs jsonb;cs2 jsonb;j jsonb;pay jsonb;pay2 jsonb;route jsonb;
 issuer text:=gen_random_uuid()::text;wallet text:=gen_random_uuid()::text;commission_wallet text:=gen_random_uuid()::text;
 amount1 numeric;total numeric;deadline timestamptz;original_initial timestamptz;split_mode boolean:=true;
begin
 select * into strict r from public.reservations where public_code='RES-001066';
 select * into strict mc from public.monthly_cycles where id=r.monthly_cycle_id;
 select * into strict px from public.pix_installments where reservation_id=r.id and status='pending';
 select * into strict rp from public.reservation_participants where id=px.participant_id;
 if exists(select 1 from public.payments where reservation_id=r.id) or exists(select 1 from private.asaas_checkout_sessions where reservation_id=r.id) then raise exception 'Fixture has payment or checkout; use an isolated copy';end if;
 select marketplace_user_id into strict other from private.marketplace_pilot_accounts where enabled and marketplace_user_id<>r.user_id limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
 update private.asaas_inline_pix_settings set heartbeat_at=clock_timestamp() where singleton;
 total:=r.net_value;amount1:=case when split_mode then round(total*0.6,2) else total end;
 if split_mode then
  update public.reservation_participants set amount_due=amount1 where id=rp.id;
  update public.pix_installments set amount_due=amount1 where id=px.id;
  insert into public.reservation_participants(reservation_id,profile_id,amount_due,status,payment_role,monthly_payment_stage_id)
   values(r.id,other,total-amount1,'pending','pix_share',px.monthly_payment_stage_id) returning id into rp2;
  insert into public.pix_installments(partner_id,reservation_id,participant_id,amount_due,status,provider,txid,monthly_payment_stage_id)
   values(r.partner_id,r.id,rp2,total-amount1,'pending','asaas','ROLLBACK-'||replace(gen_random_uuid()::text,'-',''),px.monthly_payment_stage_id) returning id into px2;
 end if;
 route:=jsonb_build_object('partner_id',r.partner_id,'issuer_account_id',issuer,'issuer_wallet_id',wallet,'split_wallet_id',commission_wallet);
 begin perform public.claim_asaas_inline_pix(r.id,gen_random_uuid(),route,true);raise exception 'Unknown payer accepted';exception when others then if sqlerrm<>'UNAUTHORIZED' then raise;end if;end;
 if not split_mode then
  begin perform public.claim_asaas_inline_pix(r.id,other,route,true);raise exception 'Other payer accepted';exception when others then if sqlerrm<>'Somente o titular pode pagar sua cota pendente' then raise;end if;end;
 end if;
 cs:=public.claim_asaas_inline_pix(r.id,r.user_id,route,true);
 if not (cs->>'claimed')::boolean or (cs->>'amount')::numeric<>amount1 then raise exception 'Incorrect monthly charge: %',cs;end if;
 if (cs->>'due_at')::timestamptz<>mc.initial_due_at or (cs->>'provider_due_at')::timestamptz<>mc.balance_due_at then raise exception 'Incorrect guarantee/balance deadline';end if;
 if (cs->>'split_commission_amount')::numeric<>round(amount1*(cs->>'split_commission_rate')::numeric/100,2) then raise exception 'Incorrect commission';end if;
 perform public.start_asaas_inline_pix(cs->>'session_key',(cs->>'claim_token')::uuid,'cus_monthly_rollback');
 cs2:=public.claim_asaas_inline_pix(r.id,r.user_id,route,true);
 if (cs2->>'claimed')::boolean then raise exception 'Repeated monetary request allowed';end if;
 pay:=jsonb_build_object('id','pay_monthly_rollback_'||replace(gen_random_uuid()::text,'-',''),'customer','cus_monthly_rollback',
 'value',amount1,'netValue',amount1-1.99,'status','PENDING','billingType','PIX','externalReference',cs->>'external_reference',
 'split',jsonb_build_array(jsonb_build_object('id','spl_monthly_test','walletId',commission_wallet,'fixedValue',cs->'split_commission_amount','status','DONE')));
 perform public.bind_asaas_inline_pix(cs->>'session_key',pay);
 if not public.can_present_asaas_inline_pix(cs->>'session_key',r.user_id) then raise exception 'QR not available';end if;
 if public.can_present_asaas_inline_pix(cs->>'session_key',other) then raise exception 'QR leaked';end if;
 original_initial:=mc.initial_due_at;
 update public.monthly_cycles set initial_due_at=now()-interval '1 minute' where id=mc.id;
 if public.can_present_asaas_inline_pix(cs->>'session_key',r.user_id) then raise exception 'Expired guarantee QR still exposed';end if;
 update private.asaas_inline_pix set next_check_at=now()-interval '1 second' where session_key=cs->>'session_key';
 j:=public.claim_asaas_inline_pix_jobs();
 if not exists(select 1 from jsonb_array_elements(j) x where x->>'session_key'=cs->>'session_key' and (x->>'close_required')::boolean) then raise exception 'Expired guarantee not closed by worker';end if;
 update public.monthly_cycles set initial_due_at=original_initial where id=mc.id;
 -- The other payer already has a pending QR before the guarantee is reached.
 cs2:=public.claim_asaas_inline_pix(r.id,other,route,true);
 perform public.start_asaas_inline_pix(cs2->>'session_key',(cs2->>'claim_token')::uuid,'cus_monthly_other');
 pay2:=pay||jsonb_build_object('id','pay_monthly_other_'||replace(gen_random_uuid()::text,'-',''),'customer','cus_monthly_other',
  'value',total-amount1,'netValue',total-amount1-1.99,'externalReference',cs2->>'external_reference',
  'split',jsonb_build_array(jsonb_build_object('id','spl_monthly_other','walletId',commission_wallet,'fixedValue',cs2->'split_commission_amount','status','DONE')));
 perform public.bind_asaas_inline_pix(cs2->>'session_key',pay2);
 -- Authenticated provider evidence exercises the normal webhook and financial reconciliation, without HTTP.
 pay:=pay||jsonb_build_object('status','RECEIVED');
 begin perform public.apply_asaas_account_event('rollback-wrong-account','PAYMENT_RECEIVED',pay,gen_random_uuid()::text);raise exception 'Wrong issuing account accepted';exception when others then if sqlerrm<>'ASAAS_EVENT_ACCOUNT_MISMATCH' then raise;end if;end;
 j:=public.apply_asaas_account_event('rollback-paid','PAYMENT_RECEIVED',pay,issuer);
 if coalesce((j->>'review_required')::boolean,false) then raise exception 'Expected regular monthly payment: %',j;end if;
 perform public.apply_asaas_account_event('rollback-paid-again','PAYMENT_RECEIVED',pay,issuer);
 if (select count(*) from public.payments where reservation_id=r.id)<>1 then raise exception 'Duplicated payment';end if;
 if (select total_paid from public.monthly_cycles where id=mc.id)<>amount1 then raise exception 'Monthly amount not reconciled';end if;
 if (select status from public.reservation_participants where id=rp.id)<>'paid' then raise exception 'Payer not confirmed';end if;
 if split_mode then
  if (select status from public.reservations where id=r.id)<>'pending_payment' then raise exception 'Monthly fully confirmed before remaining share';end if;
  if (select guarantee_reached_at from public.monthly_cycles where id=mc.id) is null then raise exception 'Guarantee not reached';end if;
  update public.monthly_cycles set initial_due_at=now()-interval '1 minute' where id=mc.id;
  cs2:=public.claim_asaas_inline_pix(r.id,other,route,true);
  if (cs2->>'amount')::numeric<>total-amount1 or (cs2->>'due_at')::timestamptz<>mc.balance_due_at then raise exception 'Remaining share or deadline incorrect';end if;
  if ((cs->>'split_commission_amount')::numeric+(cs2->>'split_commission_amount')::numeric)<>round(total*(cs->>'split_commission_rate')::numeric/100,2) then raise exception 'Split rounding diverges';end if;
  if (cs2->>'claimed')::boolean or cs2->>'provider_payment_id' is distinct from pay2->>'id' then raise exception 'Guarantee change duplicated the existing charge';end if;
  if not public.can_present_asaas_inline_pix(cs2->>'session_key',other) then raise exception 'Existing QR did not follow balance deadline';end if;
  pay:=pay2||jsonb_build_object('status','RECEIVED');
  perform public.apply_asaas_account_event('rollback-other-paid','PAYMENT_RECEIVED',pay,issuer);
 end if;
 if (select status from public.monthly_cycles where id=mc.id)<>'fully_paid' or (select status from public.reservations where id=r.id)<>'confirmed' then raise exception 'Monthly not fully confirmed';end if;
 if exists(select 1 from public.monthly_cycle_events where monthly_cycle_id=mc.id and financial_status not in ('confirmed','cancelled')) then raise exception 'Monthly events not confirmed';end if;
 if public.can_present_asaas_inline_pix(cs->>'session_key',r.user_id) then raise exception 'Paid QR still exposed';end if;
 if (select count(*) from public.pix_installments where reservation_id=r.id)<>(case when split_mode then 2 else 1 end) then raise exception 'Second collection created';end if;
 if has_function_privilege('authenticated','public.claim_asaas_inline_pix(uuid,uuid,jsonb,boolean,uuid)','execute') or has_function_privilege('anon','private.inline_pix_deadline(uuid,uuid)','execute') then raise exception 'Privileged RPC exposed';end if;
end $$;
rollback;
select 'PASS: monthly single payer and split, early payment, ownership, dynamic deadlines, commission, webhook idempotency, guarantee/full confirmation, no second collection' result;

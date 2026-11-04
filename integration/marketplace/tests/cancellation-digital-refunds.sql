-- Marketplace staging only. All fixtures and notifications are rolled back; no provider API calls.
begin;
do $$
declare c private.community_marketplace_pilot%rowtype;sp uuid;sid uuid;rid uuid;rid2 uuid;legacy uuid;
 owner_session uuid;other uuid;intent uuid;p1 uuid;p2 uuid;rp1 uuid;rp2 uuid;req uuid;v uuid;x uuid;
 o jsonb;j jsonb;before_count int;v_contract timestamptz;v_tz text;
begin
 select * into strict c from private.community_marketplace_pilot where singleton;
 select id into strict owner_session from auth.sessions where user_id=c.marketplace_user_id and (not_after is null or not_after>now()) order by created_at desc limit 1;
 select a.marketplace_user_id into strict other from private.marketplace_pilot_accounts a where a.enabled and a.marketplace_user_id<>c.marketplace_user_id and not exists(select 1 from public.platform_admins where profile_id=a.marketplace_user_id) order by a.created_at limit 1;
 select vs.id,ve.timezone into strict sp,v_tz from public.venue_spaces vs join public.venues ve on ve.id=vs.venue_id join public.partners p on p.id=ve.partner_id where vs.active and ve.published and p.status='approved' order by vs.created_at limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',c.marketplace_user_id,'session_id',owner_session)::text,true);
 sid:=gen_random_uuid();
 insert into public.schedule_slots(id,venue_space_id,starts_at,ends_at,price,status,created_by) values(sid,sp,now()+interval '79 days',now()+interval '79 days 1 hour',100,'available',c.marketplace_user_id);
 j:=public.create_reservation_prebooking(sid,null,null,false,'marketplace-cancellation-7d-v1',true);rid:=(j->>'reservation_id')::uuid;
 select cancellation_contracted_at into v_contract from public.reservations where id=rid;
 o:=public.reservation_cancellation_options(rid);
 if not (o->>'automatic')::boolean or (o->>'legacy')::boolean then raise exception 'Same-day cancellation unavailable';end if;
 if (o->>'deadline_exclusive')::timestamptz is distinct from (((now() at time zone v_tz)::date+8)::timestamp at time zone v_tz) then raise exception 'Seven calendar day count wrong';end if;
 update public.reservations set cancellation_contracted_at=now()-interval '100 days',cancellation_flow_version=null,cancellation_policy_accepted_at=now()+interval '1 day' where id=rid;
 if (select cancellation_contracted_at from public.reservations where id=rid) is distinct from v_contract or (select cancellation_flow_version from public.reservations where id=rid) is null then raise exception 'Contract snapshot mutable';end if;
 begin perform public.cancel_reservation(rid,'cached client',null,true,null);raise exception 'Old endpoint accepted new policy';exception when others then if sqlerrm<>'Atualize a página para escolher restituição ou voucher' then raise;end if;end;
 update public.reservations set booking_mode='monthly',split_pix=true,status='confirmed',payment_responsible_id=c.marketplace_user_id where id=rid;
 insert into public.reservation_participants(reservation_id,profile_id,amount_due,amount_paid,status) values(rid,c.marketplace_user_id,60,60,'paid') returning id into rp1;
 insert into public.reservation_participants(reservation_id,profile_id,amount_due,amount_paid,status) values(rid,other,40,40,'paid') returning id into rp2;
 insert into public.payment_intents(reservation_id,method,provider,status,amount,external_reference) values(rid,'manual_external','generic_manual','confirmed',100,'test-cancel-'||rid) returning id into intent;
 insert into public.payments(payment_intent_id,reservation_id,provider,amount,status,paid_at,payment_channel,fee_source,cash_availability,metadata)
 values(intent,rid,'generic_manual',60,'confirmed',now(),'external','external','external',jsonb_build_object('participant_id',rp1)) returning id into p1;
 insert into public.payments(payment_intent_id,reservation_id,provider,amount,status,paid_at,payment_channel,fee_source,cash_availability,metadata)
 values(intent,rid,'generic_manual',40,'confirmed',now(),'external','external','external',jsonb_build_object('participant_id',rp2)) returning id into p2;
 begin perform public.submit_reservation_cancellation(rid,'stale','refund',o->>'preview_token',false);raise exception 'Stale preview accepted';exception when others then if sqlerrm<>'A reserva mudou. Abra novamente o cancelamento' then raise;end if;end;
 o:=public.reservation_cancellation_options(rid);
 begin perform public.submit_reservation_cancellation(rid,'missing consent','voucher',o->>'preview_token',false);raise exception 'Missing consent accepted';exception when others then if sqlerrm<>'Confirme o uso único e a validade de 90 dias' then raise;end if;end;
 if exists(select 1 from public.cancellation_requests where reservation_id=rid) then raise exception 'Failed transaction left case';end if;
 j:=public.submit_reservation_cancellation(rid,'Teste rateio com escolhas individuais','voucher',o->>'preview_token',true);req:=(j->>'request_id')::uuid;
 if (j->>'review')::boolean then raise exception 'Unexpected review';end if;
 if (select status from public.reservation_occurrences where reservation_id=rid)<>'cancelled' then raise exception 'Future slot not released';end if;
 if (select resolution from private.cancellation_payment_choices where payment_id=p1)<>'voucher' or (select resolution from private.cancellation_payment_choices where payment_id=p2)<>'refund' then raise exception 'Payer ownership violated';end if;
 if (select sum(amount) from public.accounting_ledger where reservation_id=rid and entry_type='refund_required')<>40 then raise exception 'Wrong refund obligation';end if;
 select voucher_id into v from private.cancellation_payment_choices where payment_id=p1;
 if (select expires_at from public.vouchers where id=v)<>now()+interval '90 days' or (select minimum_reservation_value from public.vouchers where id=v)<>60 then raise exception 'Voucher conditions wrong';end if;
 j:=public.choose_cancellation_resolution(req,'voucher',true);
 if (j->>'vouchers_issued')::int<>0 or (select count(*) from public.vouchers where source_reservation_id=rid)<>1 then raise exception 'Voucher duplicated';end if;
 j:=private.reservation_financial_snapshot(rid);
 if (j->>'blocked_refund')::numeric<>40 or (j->>'liquidated_value')::numeric<>60 or (j->>'balance_pending')::numeric<>0 then raise exception 'Mixed finance incorrect: %',j;end if;
 -- Outside requester cannot inspect/cancel another person's reservation or decide a case.
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',other)::text,true);
 if not private.is_partner_member((select partner_id from public.reservations where id=rid)) then
  begin perform public.reservation_cancellation_options(rid);raise exception 'Foreign requester allowed';exception when others then if sqlerrm<>'Sem permissão para cancelar esta reserva' then raise;end if;end;
 end if;
 j:=public.cancellation_case_directory();
 if not exists(select 1 from jsonb_array_elements(j) a where a->>'id'=req::text and jsonb_array_length(a->'choices')>=1) then raise exception 'Payer case missing';end if;
 perform public.choose_cancellation_resolution(req,'refund',false);
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',c.marketplace_user_id,'session_id',owner_session)::text,true);
 -- Move the outstanding refund payment to a synthetic Asaas charge. No HTTP request is made.
 update public.payments set provider='asaas',provider_transaction_id='pay_cancellation_rollback_'||replace(p2::text,'-',''),metadata=metadata||jsonb_build_object('billingType','PIX','status','RECEIVED','netValue',40),payment_channel='asaas_pix',cash_availability='received',fee_source='provider' where id=p2;
 j:=public.asaas_refund_payments(rid,c.marketplace_user_id);
 if jsonb_array_length(j->'payments')<>1 or (j#>>'{payments,0,amount}')::numeric<>40 then raise exception 'Digital refund included voucher amount';end if;
 j:=public.claim_asaas_refund_payment(rid,c.marketplace_user_id,p2,null,null,null);
 if not (j->>'claimed')::boolean then raise exception 'Refund claim failed';end if;
 if (public.claim_asaas_refund_payment(rid,c.marketplace_user_id,p2,null,null,null)->>'claimed')::boolean then raise exception 'Duplicate refund claim';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',other)::text,true);
 begin perform public.choose_cancellation_resolution(req,'voucher',true);raise exception 'Voucher issued after refund began';exception when others then if sqlerrm<>'Restituição já iniciada; não é possível emitir voucher' then raise;end if;end;
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',c.marketplace_user_id,'session_id',owner_session)::text,true);
 j:=jsonb_build_object('id','pay_cancellation_rollback_'||replace(p2::text,'-',''),'billingType','PIX','value',40,'refunds',jsonb_build_array(jsonb_build_object('status','DONE','value',40)));
 perform private.apply_asaas_refund_evidence('rollback-event','PAYMENT_REFUNDED',j);
 perform private.apply_asaas_refund_evidence('rollback-event','PAYMENT_REFUNDED',j);
 if (select refunded_amount from public.payments where id=p2)<>40 or (select status from public.reservations where id=rid)<>'cancelled' then raise exception 'Mixed refund/webhook reconciliation wrong';end if;
 j:=private.reservation_financial_snapshot(rid);
 if (j->>'refund_pending')::numeric<>0 or (j->>'liquidated_value')::numeric<>60 then raise exception 'Voucher value lost after digital refund';end if;
end $$;
rollback;
select 'PASS: digital refund preview/claim/webhook, mixed vouchers, idempotency, monthly finance' as result;

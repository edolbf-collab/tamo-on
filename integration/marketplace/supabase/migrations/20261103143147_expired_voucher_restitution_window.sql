-- The original voucher and payment remain traceable after an approved claim switches
-- the payment choice back to the existing refund workflow.
alter table private.cancellation_payment_choices
  add column expired_voucher_id uuid unique references public.vouchers(id),
  add column restitution_requested_at timestamptz,
  add column restitution_decision text check (restitution_decision in ('approved','declined')),
  add column restitution_reviewed_by uuid references public.profiles(id),
  add column restitution_reason text,
  add column restitution_reviewed_at timestamptz,
  add constraint expired_voucher_claim_consistency check (
    (expired_voucher_id is null) = (restitution_requested_at is null)
    and (restitution_decision is null or expired_voucher_id is not null)
    and (restitution_decision is distinct from 'approved' or resolution='refund')
  );

create or replace function public.choose_cancellation_resolution(p_request_id uuid,p_resolution text,p_voucher_accepted boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.cancellation_requests%rowtype;r public.reservations%rowtype;x record;v_id uuid;v_code public.citext;v_count int:=0;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and status='active') then raise exception 'Autenticação ativa obrigatória';end if;
 if p_resolution is null or p_resolution not in ('refund','voucher') then raise exception 'Escolha inválida';end if;
 select * into c from public.cancellation_requests where id=p_request_id;
 select * into r from public.reservations where id=c.reservation_id for update;
 if c.status<>'processed' or c.resolution_details->>'flow' is distinct from 'cancellation_7d_v1' then raise exception 'Solicitação não disponível';end if;
 if not exists(select 1 from private.cancellation_payment_choices where request_id=c.id and beneficiary_id=auth.uid()) then raise exception 'A escolha pertence ao pagador';end if;
 if p_resolution='voucher' and p_voucher_accepted is distinct from true then raise exception 'Confirme o uso único e a validade de 90 dias';end if;
 if p_resolution='refund' and exists(select 1 from private.cancellation_payment_choices where request_id=c.id and beneficiary_id=auth.uid() and resolution='voucher') then raise exception 'Voucher já emitido; solicite análise pelo atendimento';end if;
 for x in select s.*,p.refunded_amount from private.cancellation_payment_choices s join public.payments p on p.id=s.payment_id
 where s.request_id=c.id and s.beneficiary_id=auth.uid() and s.expired_voucher_id is null order by s.id for update of s,p loop
  if x.resolution=p_resolution then continue;end if;
  if x.refunded_amount>0 or exists(select 1 from private.asaas_refund_requests q where q.payment_id=x.payment_id and q.is_current) then raise exception 'Restituição já iniciada; não é possível emitir voucher';end if;
  v_code:=('CANCELA-'||replace(gen_random_uuid()::text,'-',''))::public.citext;
  insert into public.vouchers(code,title,origin,issuer_user_id,partner_id,owner_user_id,source_reservation_id,discount_type,discount_value,
   minimum_reservation_value,booking_scope,single_use,expires_at,original_booking_mode,partner_liability,cancellation_flow_version)
  values(v_code,'Crédito de cancelamento escolhido pelo pagador','cancellation',auth.uid(),r.partner_id,auth.uid(),r.id,'fixed',x.amount,x.amount,
   'any',true,now()+interval '90 days',r.booking_mode,true,'marketplace-cancellation-7d-v1') returning id into v_id;
  update private.cancellation_payment_choices set resolution='voucher',voucher_id=v_id,chosen_at=now(),chosen_by=auth.uid() where id=x.id;
  insert into public.accounting_ledger(reservation_id,partner_id,entry_type,amount,fiscal_amount,accounting_month,description,metadata)
  values(r.id,r.partner_id,'voucher_issued',x.amount,0,to_char(now() at time zone 'America/Sao_Paulo','MM/YYYY'),'Crédito integral escolhido pelo pagador',
   jsonb_build_object('voucher_id',v_id,'payment_id',x.payment_id,'beneficiary_id',auth.uid(),'cancellation_request_id',c.id,'policy_version','marketplace-cancellation-7d-v1'));
  v_count:=v_count+1;
 end loop;
 if p_resolution='refund' then update private.cancellation_payment_choices set chosen_at=coalesce(chosen_at,now()),chosen_by=auth.uid() where request_id=c.id and beneficiary_id=auth.uid();end if;
 perform private.sync_cancellation_choices(c.id);
 return jsonb_build_object('request_id',c.id,'resolution',p_resolution,'vouchers_issued',v_count);
end;$$;

create function private.voucher_restitution_deadline(expiry timestamptz) returns timestamptz
language sql immutable strict set search_path='' as $$
  select (((expiry at time zone 'America/Sao_Paulo')::date + 8)::timestamp at time zone 'America/Sao_Paulo')
$$;
revoke all on function private.voucher_restitution_deadline(timestamptz) from public,anon,authenticated;

create function public.voucher_restitution_directory() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
   'voucher_id',v.id,'code',v.code,'choice_id',x.id,'case_id',x.request_id,'reservation_code',r.public_code,
   'mine',x.beneficiary_id=auth.uid(),'amount',x.amount,'expires_at',v.expires_at,
   'deadline',private.voucher_restitution_deadline(v.expires_at),'requested_at',x.restitution_requested_at,
   'decision',x.restitution_decision,'reason',x.restitution_reason,
   'refunded',x.restitution_decision='approved' and p.refunded_amount>=x.amount,
   'unused',v.status in ('active','expired') and not exists(select 1 from public.voucher_usages u where u.voucher_id=v.id and u.status in ('used','reserved'))
 ) order by x.restitution_requested_at desc nulls last),'[]')
 from private.cancellation_payment_choices x
 join public.vouchers v on v.id=coalesce(x.expired_voucher_id,x.voucher_id)
 join public.reservations r on r.id=x.reservation_id join public.payments p on p.id=x.payment_id
 where private.marketplace_pilot_allowed() and not private.partner_readonly_active() and exists(select 1 from public.profiles where id=auth.uid() and status='active')
 and v.cancellation_flow_version='marketplace-cancellation-7d-v1' and v.origin='cancellation'
 and (x.beneficiary_id=auth.uid() or (x.restitution_requested_at is not null and
  (private.is_admin() or exists(select 1 from public.partner_members m where m.partner_id=v.partner_id and m.profile_id=auth.uid()
   and m.active and (m.role='owner' or m.permissions->>'manage_finance'='true')))))
$$;
revoke all on function public.voucher_restitution_directory() from public,anon;
grant execute on function public.voucher_restitution_directory() to authenticated;

create function public.request_expired_voucher_restitution(p_voucher_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.vouchers%rowtype; x private.cancellation_payment_choices%rowtype; receipt jsonb;
begin
 perform public.assert_marketplace_writable();
 if not exists(select 1 from public.profiles where id=auth.uid() and status='active') then raise exception 'Conta ativa obrigatória'; end if;
 select * into v from public.vouchers where id=p_voucher_id and owner_user_id=auth.uid() and origin='cancellation'
  and cancellation_flow_version='marketplace-cancellation-7d-v1' for update;
 if not found then raise exception 'Voucher indisponível para esta conta'; end if;
 select * into x from private.cancellation_payment_choices where beneficiary_id=auth.uid()
  and (voucher_id=v.id or expired_voucher_id=v.id) for update;
 if not found then raise exception 'Voucher indisponível para esta conta'; end if;
 receipt:=jsonb_build_object('protocol',x.id,'requested_at',coalesce(x.restitution_requested_at,now()));
 if x.restitution_requested_at is not null then return receipt; end if;
 if v.expires_at is null or now()<v.expires_at then raise exception 'O voucher ainda está no prazo de uso'; end if;
 if now()>=private.voucher_restitution_deadline(v.expires_at) then raise exception 'Prazo do aplicativo encerrado. Fale com o suporte para análise individual.'; end if;
 if v.status not in ('active','expired') or exists(select 1 from public.voucher_usages where voucher_id=v.id and status in ('reserved','used')) then
   raise exception 'O voucher já foi utilizado ou está vinculado a uma reserva'; end if;
 update public.vouchers set status='expired' where id=v.id and status='active';
 update private.cancellation_payment_choices set expired_voucher_id=v.id,restitution_requested_at=now() where id=x.id;
 insert into public.notifications(profile_id,type,title,body,entity_type,entity_id,data)
 select person,'voucher_restitution_requested','Restituição de voucher solicitada','Pedido registrado para o voucher '||v.code||'. Consulte Cancelamentos e restituições.',
 'voucher',v.id,jsonb_build_object('voucher_id',v.id,'request_id',x.request_id,'page','cancellation_cases')
 from (select x.beneficiary_id person union select profile_id from public.platform_admins
 union select profile_id from public.partner_members where partner_id=v.partner_id and active and (role='owner' or permissions->>'manage_finance'='true')) recipients;
 return receipt;
end;$$;
revoke all on function public.request_expired_voucher_restitution(uuid) from public,anon;
grant execute on function public.request_expired_voucher_restitution(uuid) to authenticated;

create function public.review_expired_voucher_restitution(p_voucher_id uuid,p_decision text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare x private.cancellation_payment_choices%rowtype; v public.vouchers%rowtype;
begin
 perform public.assert_marketplace_writable();
 if not private.is_admin() or not exists(select 1 from public.profiles where id=auth.uid() and status='active') then raise exception 'Somente a administração pode decidir'; end if;
 if p_decision is null or p_decision not in ('approved','declined') or nullif(btrim(p_reason),'') is null then raise exception 'Informe a decisão e o motivo';end if;
 -- Acquire the reservation lock before payment choices, as in the cancellation/refund workflow.
 perform 1 from public.reservations where id=(select reservation_id from private.cancellation_payment_choices where expired_voucher_id=p_voucher_id) for update;
 select * into v from public.vouchers where id=p_voucher_id for update;
 select * into x from private.cancellation_payment_choices where expired_voucher_id=p_voucher_id for update;
 if not found then raise exception 'Pedido não localizado';end if;
 if x.restitution_decision=p_decision then return jsonb_build_object('decision',p_decision);end if;
 if x.restitution_decision is not null then raise exception 'Pedido já analisado';end if;
 if p_decision='approved' then
   if v.status<>'expired' or exists(select 1 from public.voucher_usages where voucher_id=v.id and status in ('reserved','used')) then raise exception 'Confira o uso do voucher antes de autorizar a restituição';end if;
   update private.cancellation_payment_choices set resolution='refund',voucher_id=null where id=x.id;
 end if;
 update private.cancellation_payment_choices set restitution_decision=p_decision,restitution_reason=btrim(p_reason),
   restitution_reviewed_at=now(),restitution_reviewed_by=auth.uid() where id=x.id;
 if p_decision='approved' then perform private.sync_cancellation_choices(x.request_id);end if;
 insert into public.notifications(profile_id,type,title,body,entity_type,entity_id,data)
 values(x.beneficiary_id,'voucher_restitution_reviewed','Pedido de restituição analisado',
 case when p_decision='approved' then 'Restituição aprovada e encaminhada ao financeiro.' else 'Consulte a decisão e o motivo em Meus vouchers.' end,
 'voucher',v.id,jsonb_build_object('voucher_id',v.id,'page','promotions'));
 return jsonb_build_object('decision',p_decision);
end;$$;
revoke all on function public.review_expired_voucher_restitution(uuid,text,text) from public,anon;
grant execute on function public.review_expired_voucher_restitution(uuid,text,text) to authenticated;

create index voucher_expiry_reminder_candidates on public.vouchers(expires_at)
 where origin='cancellation' and cancellation_flow_version='marketplace-cancellation-7d-v1' and status in ('active','expired');

create function private.send_expired_voucher_restitution_notices() returns integer
language plpgsql security definer set search_path='' as $$
declare candidate record; marker integer; inserted integer; sent integer:=0; deadline timestamptz; last_day text;
begin
 for candidate in select v.id,v.code,v.owner_user_id,v.expires_at from public.vouchers v
  join private.cancellation_payment_choices x on x.voucher_id=v.id
  where v.origin='cancellation' and v.cancellation_flow_version='marketplace-cancellation-7d-v1'
  and v.status in ('expired','active') and v.expires_at<=now() and v.expires_at>now()-interval '9 days'
  and now()<private.voucher_restitution_deadline(v.expires_at) and x.restitution_requested_at is null
  and not exists(select 1 from public.voucher_usages u where u.voucher_id=v.id and u.status in ('used','reserved'))
  order by v.id for update of v skip locked loop
   deadline:=private.voucher_restitution_deadline(candidate.expires_at);
   last_day:=to_char((deadline-interval '1 second') at time zone 'America/Sao_Paulo','DD/MM/YYYY');
   marker:=case when now()>=deadline-interval '72 hours' then -3 else 0 end;
   insert into private.cancellation_voucher_reminders(voucher_id,days_remaining) values(candidate.id,marker) on conflict do nothing;
   get diagnostics inserted=row_count;
   if inserted=0 then continue;end if;
   insert into public.notifications(profile_id,type,title,body,entity_type,entity_id,data)
    values(candidate.owner_user_id,'cancellation_voucher_reminder',
      case when marker=0 then 'Seu voucher venceu' else 'Últimos dias para pedir a restituição' end,
      'Voucher '||candidate.code||'. Você pode solicitar a restituição em Meus vouchers até '||last_day||', no horário de Brasília.',
      'voucher',candidate.id,jsonb_build_object('voucher_id',candidate.id,'page','promotions','deadline',deadline,'notice',marker));
   sent:=sent+1;
 end loop;
 return sent;
end;$$;
revoke all on function private.send_expired_voucher_restitution_notices() from public,anon,authenticated;
select cron.schedule('voucher-expiry-restitution-notices','* * * * *','select private.send_expired_voucher_restitution_notices()');
notify pgrst,'reload schema';

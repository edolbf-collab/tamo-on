-- Reject missing JSON values as well as invalid strings and require explicit consent.
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
 where s.request_id=c.id and s.beneficiary_id=auth.uid() order by s.id for update of s,p loop
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

create or replace function public.submit_reservation_cancellation(p_reservation_id uuid,p_reason text,p_resolution text default 'refund',p_preview_token text default null,p_voucher_accepted boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype;o jsonb;v_request uuid;v_pending uuid;
begin
 select * into r from public.reservations where id=p_reservation_id for update;
 o:=public.reservation_cancellation_options(p_reservation_id);
 if nullif(trim(p_reason),'') is null or length(p_reason)>2000 then raise exception 'Informe um motivo com até 2000 caracteres';end if;
 if o->>'actor'<>'user' then raise exception 'Use o fluxo próprio do parceiro ou da administração';end if;
 if p_resolution is null or p_resolution not in ('refund','voucher') then raise exception 'Escolha inválida';end if;
 select id into v_pending from public.cancellation_requests where reservation_id=r.id and requested_by=auth.uid() and status='pending' and resolution_details->>'flow'='cancellation_7d_v1';
 if v_pending is not null then return jsonb_build_object('request_id',v_pending,'review',true);end if;
 if exists(select 1 from public.cancellation_requests where reservation_id=r.id and status='processed') then raise exception 'Reserva já cancelada; acompanhe a resolução financeira';end if;
 if p_preview_token is distinct from o->>'preview_token' then raise exception 'A reserva mudou. Abra novamente o cancelamento';end if;
 insert into public.cancellation_requests(reservation_id,requested_by,requester_type,reason,within_deadline,status,resolution,policy_version,policy_accepted_at,resolution_details)
 values(r.id,auth.uid(),'user',trim(p_reason),(o->>'automatic')::boolean,'pending','review_required','marketplace-cancellation-7d-v1',now(),
 jsonb_build_object('flow','cancellation_7d_v1','review_reason',o->'review_reason','contracted_at',o->'contracted_at','deadline_exclusive',o->'deadline_exclusive','starts_at',o->'starts_at','requested_resolution',p_resolution)) returning id into v_request;
 if (o->>'automatic')::boolean then
  perform private.execute_cancellation_case(v_request);
  if exists(select 1 from private.cancellation_payment_choices where request_id=v_request and beneficiary_id=auth.uid()) then
   perform public.choose_cancellation_resolution(v_request,p_resolution,p_voucher_accepted);
  end if;
  perform private.notify_cancellation_case(v_request,'Reserva cancelada','Acompanhe a restituição dos pagamentos. Cada pagador pode escolher seu próprio voucher antes do processamento do estorno.');
 else
  perform private.notify_cancellation_case(v_request,'Pedido de cancelamento em análise','O pedido foi registrado e será analisado individualmente. A reserva não foi alterada automaticamente.');
 end if;
 return jsonb_build_object('request_id',v_request,'review',not (o->>'automatic')::boolean,'resolution',p_resolution);
end;$$;

create or replace function public.review_reservation_cancellation(p_request_id uuid,p_decision text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.cancellation_requests%rowtype;r public.reservations%rowtype;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and status='active') then raise exception 'Autenticação ativa obrigatória';end if;
 select * into c from public.cancellation_requests where id=p_request_id;
 select * into r from public.reservations where id=c.reservation_id for update;
 select * into c from public.cancellation_requests where id=p_request_id for update;
 if c.resolution_details->>'flow' is distinct from 'cancellation_7d_v1' or c.status<>'pending' then raise exception 'Pedido não está em análise';end if;
 if nullif(trim(p_reason),'') is null or length(p_reason)>2000 then raise exception 'Registre a fundamentação individual, com até 2000 caracteres';end if;
 if not private.is_admin() then
  if not private.is_partner_member(r.partner_id) or p_decision<>'comment' then raise exception 'Somente a administração decide o pedido';end if;
 elsif p_decision is null or p_decision not in ('approve','deny','comment') then raise exception 'Decisão inválida';end if;
 update public.cancellation_requests set resolution_details=resolution_details||jsonb_build_object('history',coalesce(resolution_details->'history','[]'::jsonb)||jsonb_build_array(jsonb_build_object('at',now(),'by',auth.uid(),'decision',p_decision,'reason',trim(p_reason)))) where id=c.id;
 if p_decision='approve' then
  perform private.execute_cancellation_case(c.id);
  update public.cancellation_requests set reviewed_by=auth.uid(),reviewed_at=now() where id=c.id;
 elsif p_decision='deny' then
  update public.cancellation_requests set status='rejected',reviewed_by=auth.uid(),reviewed_at=now(),resolution='review_denied' where id=c.id;
 end if;
 perform private.notify_cancellation_case(c.id,case when p_decision='comment' then 'Pedido atualizado' else 'Pedido analisado' end,
 case p_decision when 'approve' then 'Pedido aprovado. Consulte a resolução dos pagamentos.' when 'deny' then 'Pedido não aprovado. Consulte a fundamentação registrada e o canal de atendimento.' else 'Uma manifestação foi registrada para análise do pedido.' end);
 return jsonb_build_object('request_id',c.id,'decision',p_decision);
end;$$;

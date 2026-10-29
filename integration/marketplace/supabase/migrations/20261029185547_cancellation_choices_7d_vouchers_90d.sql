-- 166-R11. Marketplace staging only. Existing reservations/vouchers keep their accepted policy.
alter table public.reservations add column cancellation_flow_version text;
alter table public.reservations add column cancellation_contracted_at timestamptz;
alter table public.vouchers add column cancellation_flow_version text;

create function private.capture_cancellation_contract() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.cancellation_policy_version='marketplace-cancellation-7d-v1' and new.cancellation_policy_accepted_at is not null then
   new.cancellation_flow_version:='marketplace-cancellation-7d-v1';
   new.cancellation_contracted_at:=now();
  else new.cancellation_flow_version:=null;new.cancellation_contracted_at:=null;end if;
 else
  new.cancellation_flow_version:=old.cancellation_flow_version;
  new.cancellation_contracted_at:=old.cancellation_contracted_at;
 end if;
 return new;
end;$$;
create trigger capture_cancellation_contract before insert or update on public.reservations for each row execute function private.capture_cancellation_contract();
revoke all on function private.capture_cancellation_contract() from public,anon,authenticated;

create table private.cancellation_payment_choices(
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.cancellation_requests(id),
 reservation_id uuid not null references public.reservations(id),
 payment_id uuid not null unique references public.payments(id),
 beneficiary_id uuid not null references public.profiles(id),
 amount numeric(12,2) not null check(amount>0),
 resolution text not null default 'refund' check(resolution in ('refund','voucher')),
 voucher_id uuid unique references public.vouchers(id),
 chosen_at timestamptz, chosen_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 check((resolution='voucher')=(voucher_id is not null))
);
alter table private.cancellation_payment_choices enable row level security;
revoke all on private.cancellation_payment_choices from public,anon,authenticated;
create index on private.cancellation_payment_choices(reservation_id);
create index on private.cancellation_payment_choices(beneficiary_id);
create index on private.cancellation_payment_choices(request_id);

create function private.cancellation_payment_owners(p_reservation uuid)
returns table(payment_id uuid,beneficiary_id uuid,amount numeric,review_required boolean)
language sql stable security definer set search_path='' as $$
 select p.id,case when r.split_pix then f.profile_id else coalesce(r.payment_responsible_id,r.user_id) end,
 p.amount-p.refunded_amount,
 (p.metadata->>'financial_review_required'='true') is true or (r.split_pix and (f.profile_id is null or f.review_required))
 from public.payments p join public.reservations r on r.id=p.reservation_id
 left join private.split_cancellation_payment_facts(p_reservation) f on f.payment_id=p.id
 where p.reservation_id=p_reservation and p.status in ('confirmed','partially_refunded') and p.amount>p.refunded_amount;
$$;
revoke all on function private.cancellation_payment_owners(uuid) from public,anon,authenticated;

create function public.reservation_cancellation_options(p_reservation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype; v_first timestamptz; v_deadline timestamptz; v_tz text;
 v_actor text;v_auto boolean;v_review text;v_payments jsonb;v_legacy boolean;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and status='active') then raise exception 'Autenticação ativa obrigatória';end if;
 select * into r from public.reservations where id=p_reservation_id;
 if not found then raise exception 'Reserva não encontrada';end if;
 if r.user_id=auth.uid() then v_actor:='user';
 elsif private.is_admin() then v_actor:='admin';
 elsif private.is_partner_member(r.partner_id) then v_actor:='partner';
 else raise exception 'Sem permissão para cancelar esta reserva';end if;
 select min(starts_at) into v_first from public.reservation_occurrences where reservation_id=r.id and status in ('active','completed');
 select coalesce(timezone,'America/Sao_Paulo') into v_tz from public.venues where id=r.venue_id;
 v_legacy:=r.cancellation_flow_version is distinct from 'marketplace-cancellation-7d-v1';
 if r.cancellation_contracted_at is not null then
  v_deadline:=(((r.cancellation_contracted_at at time zone v_tz)::date+8)::timestamp at time zone v_tz);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('payment_id',x.payment_id,'beneficiary_id',x.beneficiary_id,'amount',x.amount,'mine',x.beneficiary_id=auth.uid()) order by x.payment_id),'[]') into v_payments
 from private.cancellation_payment_owners(r.id) x;
 v_auto:=not v_legacy and v_actor='user' and r.status in ('pending_payment','confirmed') and v_first>now() and now()<v_deadline;
 v_review:=case when v_first<=now() then 'event_started' when v_legacy then 'previous_policy' when now()>=v_deadline then 'deadline_elapsed' else null end;
 if exists(select 1 from private.cancellation_payment_owners(r.id) where review_required or beneficiary_id is null)
   or exists(select 1 from public.voucher_usages u join public.vouchers v on v.id=u.voucher_id where u.reservation_id=r.id and u.status='used' and v.origin='cancellation')
   or exists(select 1 from public.payments where reservation_id=r.id and refunded_amount>0) then
  v_auto:=false;v_review:='financial_review';
 end if;
 if r.status not in ('pending_payment','confirmed') then v_auto:=false;v_review:='reservation_closed';end if;
 return jsonb_build_object('reservation_id',r.id,'actor',v_actor,'legacy',v_legacy,'automatic',coalesce(v_auto,false),
 'review_reason',v_review,'contracted_at',r.cancellation_contracted_at,'deadline_exclusive',v_deadline,'starts_at',v_first,
 'payments',v_payments,'policy_version','marketplace-cancellation-7d-v1',
 'preview_token',md5(jsonb_build_object('id',r.id,'status',r.status,'first',v_first,'deadline',v_deadline,'payments',v_payments,'automatic',v_auto)::text));
end;$$;
revoke all on function public.reservation_cancellation_options(uuid) from public,anon;
grant execute on function public.reservation_cancellation_options(uuid) to authenticated;

create function private.notify_cancellation_case(p_request uuid,p_title text,p_body text) returns void
language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype;c public.cancellation_requests%rowtype;
begin
 select * into c from public.cancellation_requests where id=p_request;
 select * into r from public.reservations where id=c.reservation_id;
 insert into public.notifications(profile_id,type,title,body,entity_type,entity_id,data)
 select id,'cancellation_case_updated',p_title,p_body,'reservation',r.id,
 jsonb_build_object('reservation_id',r.id,'request_id',c.id,'reservation_code',r.public_code,'page','cancellation_cases')
 from (select r.user_id id union select beneficiary_id from private.cancellation_payment_choices where request_id=c.id
 union select profile_id from public.partner_members where partner_id=r.partner_id and active
 union select profile_id from public.platform_admins) people;
end;$$;
revoke all on function private.notify_cancellation_case(uuid,text,text) from public,anon,authenticated;

create function private.sync_cancellation_choices(p_request uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c public.cancellation_requests%rowtype;r public.reservations%rowtype;v_total numeric;v_refunded numeric;v_vouchers numeric;
begin
 select * into c from public.cancellation_requests where id=p_request;
 select * into r from public.reservations where id=c.reservation_id for update;
 select coalesce(sum(x.amount) filter(where x.resolution='refund'),0),coalesce(sum(x.amount) filter(where x.resolution='voucher'),0),
 coalesce(sum(least(p.refunded_amount,x.amount)) filter(where x.resolution='refund'),0)
 into v_total,v_vouchers,v_refunded from private.cancellation_payment_choices x join public.payments p on p.id=x.payment_id where x.request_id=c.id;
 update public.accounting_ledger set amount=v_total where reservation_id=r.id and entry_type='refund_required' and metadata->>'cancellation_request_id'=c.id::text;
 update public.cancellation_requests set resolution=case when v_total>0 then 'refund_required' when v_vouchers>0 then 'voucher' else 'no_compensation' end,
 resolution_details=resolution_details||jsonb_build_object('refund_total',v_total,'voucher_total',v_vouchers,'voucher_count',(select count(*) from private.cancellation_payment_choices where request_id=c.id and resolution='voucher')) where id=c.id;
 update public.reservations set status=case when v_total>v_refunded then 'refund_pending'::public.reservation_status
 when v_total>0 and v_vouchers=0 then 'refunded'::public.reservation_status else 'cancelled'::public.reservation_status end where id=r.id;
 perform private.refresh_reservation_finance(r.id);
end;$$;
revoke all on function private.sync_cancellation_choices(uuid) from public,anon,authenticated;

create function private.execute_cancellation_case(p_request uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c public.cancellation_requests%rowtype;r public.reservations%rowtype;v_total numeric;
begin
 select * into c from public.cancellation_requests where id=p_request for update;
 select * into r from public.reservations where id=c.reservation_id for update;
 if c.status='processed' then return;end if;
 if r.status not in ('pending_payment','confirmed','completed') then raise exception 'Reserva já encerrada; confira o histórico financeiro';end if;
 if exists(select 1 from public.cancellation_requests where reservation_id=r.id and status='processed') then raise exception 'Já existe cancelamento processado';end if;
 if exists(select 1 from private.cancellation_payment_owners(r.id) where review_required or beneficiary_id is null)
 or exists(select 1 from public.payments where reservation_id=r.id and refunded_amount>0)
 or exists(select 1 from public.voucher_usages u join public.vouchers v on v.id=u.voucher_id where u.reservation_id=r.id and u.status='used' and v.origin='cancellation') then
 raise exception 'Conciliação financeira necessária; este caso não permite restituição integral automática';end if;
 insert into private.cancellation_payment_choices(request_id,reservation_id,payment_id,beneficiary_id,amount)
 select c.id,r.id,payment_id,beneficiary_id,amount from private.cancellation_payment_owners(r.id);
 select coalesce(sum(amount),0) into v_total from private.cancellation_payment_choices where request_id=c.id;
 -- A request approved after the start must not release the ongoing/past slot.
 update public.reservation_occurrences set status='cancelled' where reservation_id=r.id and status='active' and starts_at>now();
 update public.marketplace_events set status='cancelled' where source_reservation_id=r.id and status<>'cancelled' and starts_at>now()
 and exists(select 1 from public.reservation_occurrences ro where ro.reservation_id=r.id and ro.status='cancelled' and ro.starts_at>now());
 update public.reservation_chats set status='read_only',read_only_at=now() where reservation_id=r.id;
 update public.payment_intents set status='cancelled' where reservation_id=r.id and status in ('created','pending');
 update public.pix_installments set status='cancelled' where reservation_id=r.id and status not in ('paid','cancelled','expired');
 update public.reservation_participants set status='cancelled' where reservation_id=r.id and status not in ('paid','cancelled','expired');
 if r.monthly_cycle_id is not null then
  update public.monthly_payment_stages set status='cancelled' where reservation_id=r.id and status not in ('paid','cancelled','expired');
  update public.monthly_cycles set status='cancelled' where id=r.monthly_cycle_id;
  update public.monthly_cycle_events m set financial_status='cancelled' from public.reservation_occurrences ro where m.reservation_occurrence_id=ro.id and ro.reservation_id=r.id and ro.status='cancelled';
  update public.monthly_pre_reservation_slots set status='released',released_at=now() where monthly_cycle_id=r.monthly_cycle_id and status in ('pre_reserved','claimed');
 end if;
 update public.voucher_usages set status='released',released_at=now() where reservation_id=r.id and status='reserved';
 update public.vouchers set status='active' where status='reserved' and id in(select voucher_id from public.voucher_usages where reservation_id=r.id and status='released');
 insert into public.accounting_ledger(reservation_id,partner_id,entry_type,amount,fiscal_amount,accounting_month,description,metadata)
 values(r.id,r.partner_id,'refund_required',v_total,0,to_char(now() at time zone 'America/Sao_Paulo','MM/YYYY'),
 'Restituição por pagamento de origem; voucher depende de escolha do beneficiário',jsonb_build_object('cancellation_request_id',c.id,'source','cancellation_7d_v1'));
 update public.cancellation_requests set status='processed',resolution='refund_required',resolution_details=resolution_details||jsonb_build_object('flow','cancellation_7d_v1') where id=c.id;
 update public.reservations set cancelled_at=now() where id=r.id;
 perform private.sync_cancellation_choices(c.id);
end;$$;
revoke all on function private.execute_cancellation_case(uuid) from public,anon,authenticated;

create function public.choose_cancellation_resolution(p_request_id uuid,p_resolution text,p_voucher_accepted boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.cancellation_requests%rowtype;r public.reservations%rowtype;x record;v_id uuid;v_code public.citext;v_count int:=0;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and status='active') then raise exception 'Autenticação ativa obrigatória';end if;
 if p_resolution not in ('refund','voucher') then raise exception 'Escolha inválida';end if;
 select * into c from public.cancellation_requests where id=p_request_id;
 select * into r from public.reservations where id=c.reservation_id for update;
 if c.status<>'processed' or c.resolution_details->>'flow' is distinct from 'cancellation_7d_v1' then raise exception 'Solicitação não disponível';end if;
 if not exists(select 1 from private.cancellation_payment_choices where request_id=c.id and beneficiary_id=auth.uid()) then raise exception 'A escolha pertence ao pagador';end if;
 if p_resolution='voucher' and not p_voucher_accepted then raise exception 'Confirme o uso único e a validade de 90 dias';end if;
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
revoke all on function public.choose_cancellation_resolution(uuid,text,boolean) from public,anon;
grant execute on function public.choose_cancellation_resolution(uuid,text,boolean) to authenticated;

create function public.submit_reservation_cancellation(p_reservation_id uuid,p_reason text,p_resolution text default 'refund',p_preview_token text default null,p_voucher_accepted boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations%rowtype;o jsonb;v_request uuid;v_pending uuid;
begin
 select * into r from public.reservations where id=p_reservation_id for update;
 o:=public.reservation_cancellation_options(p_reservation_id);
 if nullif(trim(p_reason),'') is null or length(p_reason)>2000 then raise exception 'Informe um motivo com até 2000 caracteres';end if;
 if o->>'actor'<>'user' then raise exception 'Use o fluxo próprio do parceiro ou da administração';end if;
 if p_resolution not in ('refund','voucher') then raise exception 'Escolha inválida';end if;
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
revoke all on function public.submit_reservation_cancellation(uuid,text,text,text,boolean) from public,anon;
grant execute on function public.submit_reservation_cancellation(uuid,text,text,text,boolean) to authenticated;

create function public.review_reservation_cancellation(p_request_id uuid,p_decision text,p_reason text) returns jsonb
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
 elsif p_decision not in ('approve','deny','comment') then raise exception 'Decisão inválida';end if;
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
revoke all on function public.review_reservation_cancellation(uuid,text,text) from public,anon;
grant execute on function public.review_reservation_cancellation(uuid,text,text) to authenticated;

create function public.cancellation_case_directory() returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and status='active') then raise exception 'Autenticação ativa obrigatória';end if;
 select coalesce(jsonb_agg(x order by x.created_at desc),'[]') into v_result from (
 select c.id,c.reservation_id,r.public_code,c.created_at,c.status,c.reason,c.resolution,c.reviewed_at,c.resolution_details,
 private.is_admin() can_decide,private.is_partner_member(r.partner_id) can_comment,
 (private.is_admin() or exists(select 1 from public.partner_members m where m.partner_id=r.partner_id and m.profile_id=auth.uid() and m.active and (m.role='owner' or m.permissions->>'manage_finance'='true'))) can_refund,
 coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'payment_id',s.payment_id,'amount',s.amount,'resolution',s.resolution,
 'voucher_id',s.voucher_id,'mine',s.beneficiary_id=auth.uid(),'refunded_amount',p.refunded_amount,
 'can_choose',s.beneficiary_id=auth.uid() and s.resolution='refund' and p.refunded_amount=0 and not exists(select 1 from private.asaas_refund_requests q where q.payment_id=p.id and q.is_current),
 'cash',p.payment_channel not in ('asaas_pix','asaas_card')) order by s.id)
 from private.cancellation_payment_choices s join public.payments p on p.id=s.payment_id where s.request_id=c.id
 and (s.beneficiary_id=auth.uid() or private.is_admin() or private.is_partner_member(r.partner_id))),'[]') choices
 from public.cancellation_requests c join public.reservations r on r.id=c.reservation_id
 where c.resolution_details->>'flow'='cancellation_7d_v1' and (c.requested_by=auth.uid() or private.is_admin() or private.is_partner_member(r.partner_id)
 or exists(select 1 from private.cancellation_payment_choices s where s.request_id=c.id and s.beneficiary_id=auth.uid()))
 ) x;
 return v_result;
end;$$;
revoke all on function public.cancellation_case_directory() from public,anon;
grant execute on function public.cancellation_case_directory() to authenticated;

-- Prevent an older cached client from silently applying the old policy to new contracts.
alter function public.cancel_reservation(uuid,text,text,boolean,text) rename to cancel_reservation_legacy_r10;
alter function public.cancel_reservation_legacy_r10(uuid,text,text,boolean,text) set schema private;
revoke all on function private.cancel_reservation_legacy_r10(uuid,text,text,boolean,text) from public,anon,authenticated;
create function public.cancel_reservation(p_reservation_id uuid,p_reason text default null,p_policy_version text default null,p_policy_accepted boolean default false,p_preview_token text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.reservations where id=p_reservation_id and user_id=auth.uid() and cancellation_flow_version='marketplace-cancellation-7d-v1') then
 raise exception 'Atualize a página para escolher restituição ou voucher';end if;
 return private.cancel_reservation_legacy_r10(p_reservation_id,p_reason,p_policy_version,p_policy_accepted,p_preview_token);
end;$$;
revoke all on function public.cancel_reservation(uuid,text,text,boolean,text) from public,anon;
grant execute on function public.cancel_reservation(uuid,text,text,boolean,text) to authenticated;

-- Reuse provider reconciliation and idempotent per-payment claims for new cancellations.
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
 return jsonb_build_object('reservation_id',r.id,'reservation_code',r.public_code,'payments',v_rows,
   'payment_amount',v_total,'refund_target',v_required,'refunded_amount',(select coalesce(sum((x->>'refunded_amount')::numeric),0) from jsonb_array_elements(v_rows) x));
end;$function$;

CREATE OR REPLACE FUNCTION private.apply_asaas_refund_evidence(p_event_id text, p_event_type text, p_payment jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare p public.payments%rowtype; r public.reservations%rowtype; x jsonb;
 v_refund numeric:=0; v_old numeric; v_required numeric; v_pending boolean:=false;
 v_evidence jsonb:='[]'; v_completed boolean; v_profile uuid;
begin
 if nullif(p_payment->>'id','') is null then raise exception 'REFUND_PAYMENT_ID_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('asaas:'||(p_payment->>'id'),0));
 select * into p from public.payments where provider='asaas' and provider_transaction_id=p_payment->>'id';
 if not found then raise exception 'REFUND_ORIGINAL_PAYMENT_NOT_FOUND'; end if;
 select * into r from public.reservations where id=p.reservation_id for update;
 select * into p from public.payments where id=p.id for update;
 if p_payment->>'billingType' is distinct from (case p.payment_channel when 'asaas_pix' then 'PIX' when 'asaas_card' then 'CREDIT_CARD' else '' end)
   or (p_payment->>'value')::numeric is distinct from p.amount then raise exception 'REFUND_PAYMENT_MISMATCH'; end if;
 if jsonb_typeof(p_payment->'refunds') is distinct from 'array' then raise exception 'REFUND_EVIDENCE_REQUIRED'; end if;
 for x in select value from jsonb_array_elements(p_payment->'refunds') loop
   if x->>'status' is null or (x->>'value')::numeric is null or (x->>'value')::numeric<=0
      or round((x->>'value')::numeric,2)<>(x->>'value')::numeric then raise exception 'REFUND_INVALID_EVIDENCE'; end if;
   if x->>'status'='DONE' then v_refund:=v_refund+(x->>'value')::numeric;
   elsif x->>'status' not in ('CANCELLED','DENIED') then v_pending:=true; end if;
   v_evidence:=v_evidence||jsonb_build_array(jsonb_build_object('status',x->>'status','value',x->'value',
     'description',x->>'description','denialReason',case when jsonb_typeof(x#>'{additionalInfo,denialReason}')='string' then left(x#>>'{additionalInfo,denialReason}',500) end,'refundedSplits',x->'refundedSplits','dateCreated',x->>'dateCreated','transactionReceiptUrl',x->>'transactionReceiptUrl','endToEndIdentifier',x->>'endToEndIdentifier'));
 end loop;
 if v_refund>p.amount then raise exception 'REFUND_EXCEEDS_PAYMENT'; end if;
 if p_event_type in ('PAYMENT_REFUNDED','PAYMENT_PARTIALLY_REFUNDED') and v_refund<=0 then
   raise exception 'REFUND_DONE_EVIDENCE_REQUIRED'; end if;
 v_old:=p.refunded_amount;
 if v_refund>v_old then
   update public.payments set refunded_amount=v_refund,
     status=case when v_refund=amount then 'refunded'::public.payment_status else 'partially_refunded'::public.payment_status end,
     refunded_at=now(),metadata=metadata||jsonb_build_object('refund_event_id',p_event_id,'asaas_refunds',v_evidence)
     where id=p.id;
 end if;
 v_refund:=greatest(v_refund,v_old);
 v_completed:=v_refund>=p.amount;
 update private.asaas_refund_requests set status=case when v_refund>=baseline_refunded_amount+amount then 'completed'
   when v_refund>baseline_refunded_amount then 'partial' when v_pending then 'submitted'
   when exists(select 1 from jsonb_array_elements(p_payment->'refunds') z where z->>'status' in ('CANCELLED','DENIED')
    and z->>'description'=('Cancelamento '||r.public_code||' - solicitação '||private.asaas_refund_requests.id::text)
    and (z->>'value')::numeric=private.asaas_refund_requests.amount) then 'rejected' else status end,
   provider_evidence=jsonb_build_object('event_id',p_event_id,'event_type',p_event_type,'refunds',v_evidence),
   updated_at=now()
 where payment_id=p.id and is_current and status<>'completed';
 select coalesce(sum(amount),0) into v_required from public.accounting_ledger where reservation_id=r.id and entry_type='refund_required';
 if r.status='refund_pending' and v_required>0
   and (select coalesce(sum(refunded_amount),0) from public.payments where reservation_id=r.id and status in ('confirmed','partially_refunded','refunded'))>=v_required
 then
   update public.reservations set status='refunded' where id=r.id;
 end if;
 if exists(select 1 from private.cancellation_payment_choices where reservation_id=r.id) then
  perform private.sync_cancellation_choices((select request_id from private.cancellation_payment_choices where reservation_id=r.id limit 1));
 else perform private.refresh_reservation_finance(r.id);end if;
 if v_refund>v_old then
   for v_profile in select r.user_id
     union select coalesce(r.payment_responsible_id,r.user_id) where p.payment_channel='asaas_card' or p.metadata->>'participant_id' is null
     union select rp.profile_id from public.reservation_participants rp where rp.reservation_id=r.id and rp.id::text=p.metadata->>'participant_id'
     union select profile_id from public.partner_members where partner_id=r.partner_id and active loop
     insert into public.notifications(profile_id,type,title,body,entity_type,entity_id,data)
     values(v_profile,'reservation_refund_updated','Devolução confirmada',
       case when v_completed then 'O Asaas confirmou a devolução integral do pagamento.' else 'O Asaas confirmou uma devolução parcial. O restante continua pendente.' end,
       'reservation',r.id,jsonb_build_object('reservation_id',r.id,'reservation_code',r.public_code,'payment_id',p.id,'refunded_amount',v_refund));
   end loop;
 end if;
 return jsonb_build_object('payment_id',p.id,'refunded_amount',v_refund,'status',case when v_completed then 'completed' when v_refund>0 then 'partial' else 'pending' end);
end;$function$;

CREATE OR REPLACE FUNCTION public.refresh_marketplace_vouchers()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_voucher public.vouchers%rowtype;
  v_minimum integer;
  v_extension_days integer;
  v_compatible integer;
  v_extended integer := 0;
  v_expired integer := 0;
begin
  if auth.uid() is null then raise exception 'Autenticação obrigatória'; end if;

  select voucher_minimum_compatible_dates,voucher_extension_days
    into v_minimum,v_extension_days
  from public.marketplace_settings where id=true;

  for v_voucher in
    select *
    from public.vouchers
    where status='active' and expires_at<=now()
      and (
        owner_user_id=auth.uid()
        or private.is_admin()
        or (partner_id is not null and private.is_partner_member(partner_id))
      )
    for update
  loop
    if v_voucher.cancellation_flow_version='marketplace-cancellation-7d-v1' then
      update public.vouchers set status='expired' where id=v_voucher.id;
      v_expired:=v_expired+1;continue;
    end if;
    v_compatible := case
      when v_voucher.origin='cancellation' then private.voucher_compatible_dates(v_voucher.id)
      else v_minimum
    end;

    if v_voucher.origin='cancellation'
       and v_compatible<v_minimum
       and v_extension_days>0 then
      update public.vouchers
      set expires_at=greatest(expires_at,now())+make_interval(days=>v_extension_days),
          extension_count=extension_count+1,
          last_extended_at=now(),
          extension_reason=format('Disponibilidade compatível insuficiente: %s de %s datas.',v_compatible,v_minimum)
      where id=v_voucher.id;
      v_extended := v_extended+1;
    else
      update public.vouchers set status='expired' where id=v_voucher.id;
      v_expired := v_expired+1;
    end if;
  end loop;

  return jsonb_build_object('extended',v_extended,'expired',v_expired);
end;
$function$;

create table private.cancellation_voucher_reminders(
 voucher_id uuid not null references public.vouchers(id),days_remaining integer not null,
 created_at timestamptz not null default now(),primary key(voucher_id,days_remaining)
);
alter table private.cancellation_voucher_reminders enable row level security;
revoke all on private.cancellation_voucher_reminders from public,anon,authenticated;
create function private.send_cancellation_voucher_reminders() returns integer language plpgsql security definer set search_path='' as $$
declare v record;n integer:=0;added integer;
begin
 update public.vouchers set status='expired' where cancellation_flow_version='marketplace-cancellation-7d-v1' and status='active' and expires_at<=now();
 for v in select vo.*,((vo.expires_at at time zone coalesce(ve.timezone,'America/Sao_Paulo'))::date-(now() at time zone coalesce(ve.timezone,'America/Sao_Paulo'))::date) days_left
 from public.vouchers vo join public.reservations r on r.id=vo.source_reservation_id join public.venues ve on ve.id=r.venue_id
 where vo.cancellation_flow_version='marketplace-cancellation-7d-v1' and vo.status='active' and vo.expires_at>now() loop
  if v.days_left in (60,30,15,5) then
   insert into private.cancellation_voucher_reminders(voucher_id,days_remaining) values(v.id,v.days_left) on conflict do nothing;
   get diagnostics added=row_count;
   if added=1 then
    insert into public.notifications(profile_id,type,title,body,entity_type,entity_id,data)
    values(v.owner_user_id,'cancellation_voucher_reminder','Você tem um voucher disponível',
     'Faltam '||v.days_left||' dias para o vencimento do voucher '||v.code||'. Consulte Meus vouchers para utilizar o crédito.',
     'voucher',v.id,jsonb_build_object('voucher_id',v.id,'days_remaining',v.days_left,'page','promotions'));
    n:=n+1;
   end if;
  end if;
 end loop;
 return n;
end;$$;
revoke all on function private.send_cancellation_voucher_reminders() from public,anon,authenticated;
select cron.schedule('cancellation-voucher-reminders-90d','15 * * * *','select private.send_cancellation_voucher_reminders()');

create function public.record_cash_cancellation_refund(p_choice_id uuid,p_reference text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare x private.cancellation_payment_choices%rowtype;r public.reservations%rowtype;p public.payments%rowtype;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and status='active') then raise exception 'Autenticação ativa obrigatória';end if;
 select * into x from private.cancellation_payment_choices where id=p_choice_id;
 select * into r from public.reservations where id=x.reservation_id for update;
 select * into x from private.cancellation_payment_choices where id=p_choice_id for update;
 if not private.is_admin() and not exists(select 1 from public.partner_members where partner_id=r.partner_id and profile_id=auth.uid() and active and (role='owner' or permissions->>'manage_finance'='true')) then raise exception 'Sem permissão financeira';end if;
 select * into p from public.payments where id=x.payment_id for update;
 if p.payment_channel in ('asaas_pix','asaas_card') or x.resolution<>'refund' then raise exception 'Utilize a conciliação do meio original';end if;
 if nullif(trim(p_reference),'') is null or length(p_reference)>500 then raise exception 'Informe o comprovante da devolução';end if;
 if p.refunded_amount=p.amount then return jsonb_build_object('completed',true);end if;
 update public.payments set refunded_amount=amount,status='refunded',refunded_at=now(),metadata=metadata||jsonb_build_object('refund_recorded_by',auth.uid(),'refund_reference',trim(p_reference)) where id=p.id;
 perform private.sync_cancellation_choices(x.request_id);
 return jsonb_build_object('completed',true);
end;$$;
revoke all on function public.record_cash_cancellation_refund(uuid,text) from public,anon;
grant execute on function public.record_cash_cancellation_refund(uuid,text) to authenticated;
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
;
notify pgrst,'reload schema';

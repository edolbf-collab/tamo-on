-- Shared deadline for monthly single-pool Pix; no staged/card scope expansion.
create function private.inline_pix_deadline(p_reservation_id uuid,p_stage_id uuid) returns timestamptz
language sql stable security definer set search_path='' as $$
 select case
 when r.booking_mode='single' and r.monthly_cycle_id is null and p_stage_id is null then r.payment_expires_at
 when r.booking_mode='monthly' and c.collection_mode='single_monthly_pool'
  and c.status in ('awaiting_initial','awaiting_full') and s.reservation_id=r.id
  and s.monthly_cycle_id=c.id and s.stage='full' and s.status in ('scheduled','pending')
 then least(r.payment_expires_at,s.due_at,c.balance_due_at,
  case when c.guarantee_reached_at is not null or c.guarantee_required<=0 then c.balance_due_at else c.initial_due_at end)
 end
 from public.reservations r left join public.monthly_cycles c on c.id=r.monthly_cycle_id
 left join public.monthly_payment_stages s on s.id=p_stage_id
 where r.id=p_reservation_id and r.status='pending_payment' and r.financial_closed_at is null
 and r.payment_method='pix_direct_partner' and r.payment_configured_at is not null;
$$;
revoke all on function private.inline_pix_deadline(uuid,uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.claim_inline_pix_base(p_reservation_id uuid, p_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare r public.reservations%rowtype; pi public.payment_intents%rowtype; px public.pix_installments%rowtype;
  st public.monthly_payment_stages%rowtype; mc public.monthly_cycles%rowtype;
  cs private.asaas_checkout_sessions%rowtype; v_key text; v_due timestamptz; v_amount numeric; v_type text; v_new boolean:=false;
begin
  select * into r from public.reservations where id=p_reservation_id for update;
  if not found or r.status<>'pending_payment' or r.payment_configured_at is null then raise exception 'Reserva sem cobranca pendente'; end if;
  if r.payment_method<>'pix_direct_partner' then raise exception 'NOT_PIX_DIRECT'; end if;

  if r.financial_closed_at is not null then raise exception 'Cobranca encerrada'; end if;
  if p_profile_id is null then raise exception 'Titular obrigatorio'; end if;
  if r.payment_provider<>'asaas' then raise exception 'Cobranca historica externa; nao pode ser reclassificada como Asaas'; end if;
  select * into pi from public.payment_intents where reservation_id=r.id and status in ('created','pending') order by created_at limit 1 for update;
  if pi.id is null then raise exception 'Cobranca pendente nao encontrada'; end if;
  if r.booking_mode='monthly' then
    select * into mc from public.monthly_cycles where id=r.monthly_cycle_id;
    select * into st from public.monthly_payment_stages where id=pi.monthly_payment_stage_id;
    if mc.collection_mode is distinct from 'single_monthly_pool' or st.stage is distinct from 'full'
      or st.monthly_cycle_id is distinct from mc.id or st.reservation_id is distinct from r.id then
      raise exception 'ASAAS_MONTHLY_PIX_SCOPE';end if;
  elsif r.monthly_cycle_id is not null or pi.monthly_payment_stage_id is not null then raise exception 'ASAAS_CHECKOUT_SCOPE';end if;
  v_due:=private.inline_pix_deadline(r.id,pi.monthly_payment_stage_id);
  if v_due is null or v_due<=clock_timestamp() then raise exception 'PAYMENT_WINDOW_EXPIRED';end if;
  if pi.method='pix_direct_partner' then
    select * into px from public.pix_installments x where x.reservation_id=r.id
      and x.monthly_payment_stage_id is not distinct from pi.monthly_payment_stage_id
      and x.status in ('pending','generated') and (
        (x.participant_id is null and coalesce(r.payment_responsible_id,r.user_id)=p_profile_id)
        or exists(select 1 from public.reservation_participants rp where rp.id=x.participant_id and rp.reservation_id=r.id and rp.profile_id=p_profile_id and rp.payment_role='pix_share' and rp.status<>'paid'))
      order by x.created_at limit 1 for update;
    if px.id is null then raise exception 'Somente o titular pode pagar sua cota pendente'; end if;
    if px.provider<>'asaas' then raise exception 'Provedor da cota nao e Asaas'; end if;
    v_key:='PIX:'||px.id; v_amount:=px.amount_due; v_type:='PIX';
  else
    if pi.method<>'credit_card_asaas' or coalesce(r.payment_responsible_id,r.user_id)<>p_profile_id then
      raise exception 'Somente o responsavel pode pagar no cartao';
    end if;
    v_key:='CARD:'||pi.id; v_amount:=pi.amount; v_type:='CREDIT_CARD';
  end if;
  perform private.assert_payment_capacity(r.id,v_amount,pi.monthly_payment_stage_id);
  perform private.assert_collection_capacity(r.id);
  -- A new checkout cannot outlive the existing reservation deadline.
  -- Existing ready sessions remain reusable close to the deadline.
  if not exists(select 1 from private.asaas_checkout_sessions where session_key=v_key)
    and (v_due is null or v_due < clock_timestamp() + interval '30 seconds') then
    raise exception 'PIX_PAYMENT_WINDOW_TOO_SHORT';
  end if;
  insert into private.asaas_checkout_sessions(session_key,reservation_id,intent_id,installment_id,owner_id,amount,billing_type,external_reference,status)
  values(v_key,r.id,pi.id,px.id,p_profile_id,v_amount,v_type,'TAMOON:'||v_key,'creating') on conflict do nothing;
  v_new:=found;
  select * into cs from private.asaas_checkout_sessions where session_key=v_key for update;
  if cs.owner_id is distinct from p_profile_id or cs.reservation_id is distinct from r.id
    or cs.intent_id is distinct from pi.id or cs.installment_id is distinct from px.id
    or cs.billing_type is distinct from v_type or cs.amount is distinct from v_amount then
    raise exception 'CHECKOUT_BINDING_MISMATCH';
  end if;
  return to_jsonb(cs)||jsonb_build_object('claimed',v_new,'due_at',v_due,'reservation_code',r.public_code,
    'participant_id',px.participant_id,'split_pix',r.split_pix,
    'provider_due_at',case when r.booking_mode='monthly' then least(r.payment_expires_at,st.due_at,mc.balance_due_at) else v_due end);
end; $function$
;

CREATE OR REPLACE FUNCTION private.claim_inline_pix_split(p_reservation_id uuid, p_profile_id uuid, p_routing jsonb DEFAULT NULL::jsonb, p_require_split boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb;r public.reservations%rowtype;ct private.asaas_split_contracts%rowtype;v_rate numeric;v_before numeric;v_all numeric;v_comm numeric;
begin
 perform 1 from public.reservations where id=p_reservation_id for update;
 c:=private.claim_inline_pix_base(p_reservation_id,p_profile_id);
 if not (c->>'claimed')::boolean then return c;end if;
 select * into r from public.reservations where id=p_reservation_id;
 -- A reservation started under the previous model finishes under that issuer.
 if exists(select 1 from private.asaas_checkout_sessions where reservation_id=r.id
   and session_key<>c->>'session_key' and issuer_account_id is null) then return c;end if;
 select * into ct from private.asaas_split_contracts where reservation_id=r.id;
 if ct.reservation_id is null and p_routing is null then
  if p_require_split then raise exception 'ASAAS_PARTNER_ACCOUNT_REQUIRED';end if;return c;end if;
 if ct.reservation_id is null then
  if p_routing->>'partner_id' is distinct from r.partner_id::text
    or coalesce(p_routing->>'issuer_account_id','')!~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    or coalesce(p_routing->>'issuer_wallet_id','')!~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    or coalesce(p_routing->>'split_wallet_id','')!~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    or p_routing->>'issuer_wallet_id'=p_routing->>'split_wallet_id' then raise exception 'ASAAS_SPLIT_ROUTING_INVALID';end if;
  select coalesce(r.finance_commission_rate,p.commission_rate) into v_rate from public.partners p where p.id=r.partner_id;
  if v_rate is null or v_rate<0 or v_rate>100 then raise exception 'ASAAS_COMMISSION_INVALID';end if;
  insert into private.asaas_split_contracts(reservation_id,issuer_account_id,issuer_wallet_id,split_wallet_id,commission_rate)
   values(r.id,p_routing->>'issuer_account_id',p_routing->>'issuer_wallet_id',p_routing->>'split_wallet_id',v_rate) returning * into ct;
 end if;
 if c->>'billing_type'='PIX' then
  select coalesce(sum(x.amount_due) filter(where (x.created_at,x.id)<(target.created_at,target.id)),0),sum(x.amount_due)
   into v_before,v_all from public.pix_installments x cross join public.pix_installments target
   where target.id=(c->>'installment_id')::uuid and x.reservation_id=r.id and x.monthly_payment_stage_id is not distinct from target.monthly_payment_stage_id;
  if v_all is distinct from r.net_value then raise exception 'ASAAS_SPLIT_ALLOCATION_INVALID';end if;
  v_comm:=round((v_before+(c->>'amount')::numeric)*ct.commission_rate/100,2)-round(v_before*ct.commission_rate/100,2);
 else v_comm:=round((c->>'amount')::numeric*ct.commission_rate/100,2);end if;
 update public.reservations set finance_commission_rate=ct.commission_rate where id=r.id and finance_commission_rate is null;
 update private.asaas_checkout_sessions set issuer_account_id=ct.issuer_account_id,issuer_wallet_id=ct.issuer_wallet_id,
   split_wallet_id=ct.split_wallet_id,split_commission_amount=v_comm,split_commission_rate=ct.commission_rate where session_key=c->>'session_key';
 update public.partner_payment_configs set asaas_subaccount_id=ct.issuer_account_id,asaas_wallet_id=ct.issuer_wallet_id,
   asaas_status='connected',updated_at=now() where partner_id=r.partner_id;
 return c||jsonb_build_object('issuer_account_id',ct.issuer_account_id,'issuer_wallet_id',ct.issuer_wallet_id,
   'split_wallet_id',ct.split_wallet_id,'split_commission_amount',v_comm,'split_commission_rate',ct.commission_rate);
end;$function$
;

CREATE OR REPLACE FUNCTION public.start_asaas_inline_pix(p_session_key text, p_claim_token uuid, p_customer_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cs private.asaas_checkout_sessions%rowtype; r public.reservations%rowtype; ip private.asaas_inline_pix%rowtype; v_due timestamptz;
begin
 if coalesce(p_customer_id,'')!~'^cus_[a-zA-Z0-9_-]+$' then raise exception 'PIX_CUSTOMER_INVALID';end if;
 select * into cs from private.asaas_checkout_sessions where session_key=p_session_key;
 select * into r from public.reservations where id=cs.reservation_id for update;
 select * into cs from private.asaas_checkout_sessions where session_key=p_session_key for update;
 select * into ip from private.asaas_inline_pix where session_key=p_session_key for update;
 if cs.claim_token is distinct from p_claim_token or cs.status<>'creating' or ip.session_key is null
    or ip.state<>'open' or ip.provider_payment_id is not null then raise exception 'CHECKOUT_ATTEMPT_STALE';end if;
 v_due:=private.inline_pix_deadline(r.id,(select monthly_payment_stage_id from public.payment_intents where id=cs.intent_id));
 if v_due is null or v_due<clock_timestamp()+interval '30 seconds' then raise exception 'PIX_PAYMENT_WINDOW_TOO_SHORT';end if;
 if not exists(select 1 from private.asaas_inline_pix_settings where enabled and heartbeat_at>clock_timestamp()-interval '90 seconds') then raise exception 'PIX_MAINTENANCE_UNAVAILABLE';end if;
 update private.asaas_checkout_attempts set sent_at=clock_timestamp()
   where session_key=p_session_key and claim_token=p_claim_token and sent_at is null and outcome is null;
 if not found then raise exception 'CHECKOUT_ATTEMPT_ALREADY_SENT';end if;
 insert into private.asaas_pix_customers(profile_id,issuer_key,customer_id) values(cs.owner_id,coalesce(cs.issuer_account_id,'main'),p_customer_id)
   on conflict(profile_id,issuer_key) do nothing;
 update private.asaas_inline_pix set customer_id=p_customer_id,next_check_at=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp()
   where session_key=p_session_key;
end;$function$
;

CREATE OR REPLACE FUNCTION public.can_present_asaas_inline_pix(p_session_key text, p_profile_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from private.asaas_inline_pix x join private.asaas_checkout_sessions c using(session_key)
  join public.reservations r on r.id=c.reservation_id join public.profiles p on p.id=c.owner_id
  where x.session_key=p_session_key and c.owner_id=p_profile_id and p.status='active'
   and x.state='open' and c.status='ready' and r.status='pending_payment'
   and private.inline_pix_deadline(r.id,(select monthly_payment_stage_id from public.payment_intents where id=c.intent_id))>clock_timestamp());
$function$
;

CREATE OR REPLACE FUNCTION public.claim_asaas_inline_pix_jobs()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_result jsonb;
begin
 update private.asaas_inline_pix_settings set heartbeat_at=clock_timestamp() where singleton;
 with jobs as (
   select session_key from private.asaas_inline_pix where state='open' and next_check_at<=clock_timestamp()
     and (lease_until is null or lease_until<clock_timestamp()) order by next_check_at limit 10 for update skip locked
 ), claimed as (
   update private.asaas_inline_pix x set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes'
     from jobs j where j.session_key=x.session_key returning x.*
 ) select coalesce(jsonb_agg(to_jsonb(cs)||to_jsonb(x)||jsonb_build_object('due_at',private.inline_pix_deadline(r.id,pi.monthly_payment_stage_id),
     'close_required',coalesce(private.inline_pix_deadline(r.id,pi.monthly_payment_stage_id)<=clock_timestamp(),true),
     'sent_at',a.sent_at,'attempt_outcome',a.outcome)),'[]'::jsonb) into v_result
   from claimed x join private.asaas_checkout_sessions cs using(session_key)
   join public.reservations r on r.id=cs.reservation_id
   join public.payment_intents pi on pi.id=cs.intent_id
   left join private.asaas_checkout_attempts a on a.session_key=cs.session_key and a.claim_token=cs.claim_token;
 return v_result;
end;$function$
;

CREATE OR REPLACE FUNCTION public.finish_asaas_inline_pix_job(p_session_key text, p_lease_token uuid, p_state text, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cs private.asaas_checkout_sessions%rowtype; r public.reservations%rowtype; v_due timestamptz;
begin
 if p_state not in ('open','closed','paid') or p_state is null or (p_error is not null and p_error!~'^[A-Z0-9_]{1,80}$') then raise exception 'PIX_JOB_INVALID';end if;
 select * into cs from private.asaas_checkout_sessions where session_key=p_session_key;
 select * into r from public.reservations where id=cs.reservation_id for update;
 perform 1 from private.asaas_checkout_sessions where session_key=p_session_key for update;
 v_due:=private.inline_pix_deadline(r.id,(select monthly_payment_stage_id from public.payment_intents where id=cs.intent_id));
 update private.asaas_inline_pix set state=p_state,lease_token=null,lease_until=null,
   failures=case when p_error is null then 0 else failures+1 end,last_error_code=p_error,updated_at=clock_timestamp(),
   next_check_at=case when v_due>clock_timestamp() then least(clock_timestamp()+interval '30 seconds',v_due) else clock_timestamp()+interval '15 seconds' end
   where session_key=p_session_key and lease_token=p_lease_token;
 if not found then raise exception 'PIX_JOB_STALE';end if;
 if p_state='paid' then update private.asaas_checkout_sessions set status='paid',retry_token=null,retry_outcome=null,updated_at=clock_timestamp() where session_key=p_session_key;end if;
 if p_state='closed' then update private.asaas_checkout_sessions set status=case when r.status='expired' then 'expired' else 'cancelled' end,
   updated_at=clock_timestamp() where session_key=p_session_key and status<>'paid';end if;
end;$function$
;

CREATE OR REPLACE FUNCTION public.claim_asaas_inline_pix(p_reservation_id uuid, p_profile_id uuid, p_routing jsonb DEFAULT NULL::jsonb, p_require_split boolean DEFAULT false, p_retry_token uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb; cs private.asaas_checkout_sessions%rowtype; ip private.asaas_inline_pix%rowtype;
 a private.asaas_checkout_attempts%rowtype; v_claimed boolean; v_customer text; v_name text;
begin
 if not exists(select 1 from private.asaas_inline_pix_settings where singleton and enabled
   and heartbeat_at>clock_timestamp()-interval '90 seconds') then raise exception 'PIX_MAINTENANCE_UNAVAILABLE';end if;
 if exists(select 1 from private.asaas_inline_pix x join private.asaas_checkout_sessions s using(session_key)
   join public.reservations r on r.id=s.reservation_id where x.state='open' and x.failures>0
   and coalesce(private.inline_pix_deadline(r.id,(select monthly_payment_stage_id from public.payment_intents where id=s.intent_id))<clock_timestamp()-interval '90 seconds',true)) then raise exception 'PIX_MAINTENANCE_UNAVAILABLE';end if;
 select display_name into v_name from public.profiles where id=p_profile_id and status='active';
 if not found then raise exception 'UNAUTHORIZED';end if;
 c:=private.claim_inline_pix_split(p_reservation_id,p_profile_id,p_routing,p_require_split);
 select * into cs from private.asaas_checkout_sessions where session_key=c->>'session_key' for update;
 v_claimed:=(c->>'claimed')::boolean;
 if not v_claimed and not exists(select 1 from private.asaas_inline_pix where session_key=cs.session_key) then
   return c||jsonb_build_object('delivery_mode','checkout'); -- never replace a historical checkout
 end if;
 if v_claimed and p_retry_token is not null then raise exception 'CHECKOUT_RETRY_STALE';end if;
 insert into private.asaas_inline_pix(session_key,next_check_at) values(cs.session_key,(c->>'due_at')::timestamptz) on conflict do nothing;
 select * into ip from private.asaas_inline_pix where session_key=cs.session_key for update;
 if ip.state<>'open' then raise exception 'CHECKOUT_CLOSED';end if;
 if not v_claimed and cs.status='failed' and cs.retry_outcome in ('not_sent','rejected')
   and ip.provider_payment_id is null and p_retry_token=cs.retry_token then
   if (c->>'due_at')::timestamptz<clock_timestamp()+interval '30 seconds' then raise exception 'PIX_PAYMENT_WINDOW_TOO_SHORT';end if;
   update private.asaas_checkout_sessions set status='creating',claim_token=gen_random_uuid(),
     attempt_number=attempt_number+1,retry_outcome=null,retry_token=null,updated_at=clock_timestamp()
     where session_key=cs.session_key returning * into cs;
   v_claimed:=true;
 end if;
 if v_claimed then
   insert into private.asaas_checkout_attempts(session_key,attempt_number,claim_token,evidence_source)
     values(cs.session_key,cs.attempt_number,cs.claim_token,'edge_c33');
 elsif cs.status='creating' and ip.provider_payment_id is null then
   select * into a from private.asaas_checkout_attempts where session_key=cs.session_key and claim_token=cs.claim_token for update;
   if a.session_key is not null and a.sent_at is null and a.outcome is null then
     -- A payer form may be reopened. Rotate ownership before any monetary POST.
     update private.asaas_checkout_sessions set claim_token=gen_random_uuid(),updated_at=clock_timestamp()
       where session_key=cs.session_key returning * into cs;
     update private.asaas_checkout_attempts set claim_token=cs.claim_token where session_key=cs.session_key and attempt_number=cs.attempt_number;
     v_claimed:=true;
   end if;
 end if;
 select customer_id into v_customer from private.asaas_pix_customers
   where profile_id=p_profile_id and issuer_key=coalesce(cs.issuer_account_id,'main');
 return c||to_jsonb(cs)||jsonb_build_object('delivery_mode','inline_pix','claimed',v_claimed,
   'customer_id',coalesce(ip.customer_id,v_customer),'payer_name',v_name,'provider_payment_id',ip.provider_payment_id,
   'retry_allowed',cs.status='failed' and cs.retry_token is not null and ip.provider_payment_id is null);
end;$function$
;

notify pgrst,'reload schema';

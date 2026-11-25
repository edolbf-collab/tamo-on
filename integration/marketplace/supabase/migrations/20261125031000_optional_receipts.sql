-- Existing reservation contracts and issued monthly invoices are not repriced.
alter table private.establishment_plans drop constraint establishment_plans_new_group_rate_check;
alter table private.establishment_plans alter column new_group_rate set default 0;
update private.establishment_plans set new_group_rate=0;
alter table private.establishment_plans add check(new_group_rate=0);

create table private.establishment_receipts (
 venue_id uuid references public.venues primary key,
 state text not null default 'off' check (state in ('off','requested','activating','on')),
 requested_by uuid references public.profiles, approved_by uuid references public.profiles,
 requested_at timestamptz, checked_at timestamptz, terms text, company_type text, income numeric,
 operation_id uuid not null default gen_random_uuid()
);
create table private.receipt_accounts (
 partner_id uuid primary key references public.partners,
 account_id uuid unique, wallet_id uuid unique, main_wallet uuid, key_id uuid, attempted_at timestamptz,
 opening_fee numeric(8,2) not null default 0, fee_attempted_at timestamptz, fee_payment text unique, fee_customer text, fee_status text, fee_url text, fee_venue_id uuid references public.venues
);
alter table private.establishment_receipts enable row level security;
alter table private.receipt_accounts enable row level security;
revoke all on private.establishment_receipts,private.receipt_accounts from public,anon,authenticated;
alter table public.reservations add column receipt_mode text check(receipt_mode in ('external','asaas'));
-- NULL identifies contracts made before rollout, including those with an open charge.
create function public.establishment_receipt_change(p_venue_id uuid,p_action text,p_terms text default null,
 p_company_type text default null,p_income numeric default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare partner uuid; r private.establishment_receipts; new_state text; is_admin boolean;
begin
 if auth.uid() is null or private.partner_readonly_active() then raise exception 'PLAN_READ_ONLY'; end if;
 select partner_id into strict partner from public.venues where id=p_venue_id;
 -- Reuse the finance permission, active identity and preview restrictions.
 perform public.establishment_plans_read(partner);
 is_admin:=exists(select from public.platform_admins where profile_id=auth.uid());
 if p_action='approve' then perform private.plan_assert_admin();
 elsif p_action='request' and is_admin then raise exception 'PLAN_PARTNER_CONFIRMATION_REQUIRED';
 elsif p_action is null or p_action not in ('request','off') then raise exception 'RECEIPT_INVALID_ACTION'; end if;
 perform 1 from private.establishment_plans where venue_id=p_venue_id and state='ready' for update;
 if not found then raise exception 'RECEIPT_PLAN_REQUIRED'; end if;
 insert into private.establishment_receipts(venue_id) values(p_venue_id) on conflict do nothing;
 select * into strict r from private.establishment_receipts where venue_id=p_venue_id for update;
 if p_action='request' then
   if p_terms is distinct from 'receipts-v1' or p_income is null or p_income<=0 or p_income>999999999999
    or p_company_type is null or p_company_type not in ('MEI','LIMITED','INDIVIDUAL','ASSOCIATION') then raise exception 'RECEIPT_TERMS_REQUIRED';end if;
   if r.state='off' then
    update private.establishment_receipts set state='requested',terms=p_terms,requested_by=auth.uid(),requested_at=now(),
      company_type=p_company_type,income=p_income,approved_by=null,operation_id=gen_random_uuid(),checked_at=null where venue_id=p_venue_id;
   end if;
 elsif p_action='approve' then
   if r.state not in ('requested','activating') then raise exception 'RECEIPT_REQUEST_REQUIRED';end if;
   update private.establishment_receipts set state='activating',approved_by=auth.uid() where venue_id=p_venue_id;
 else
   update private.establishment_receipts set state='off',operation_id=gen_random_uuid() where venue_id=p_venue_id;
 end if;
 select state into new_state from private.establishment_receipts where venue_id=p_venue_id;
 if new_state<>r.state then insert into private.establishment_plan_audit(venue_id,actor_id,action,detail)
 values(p_venue_id,auth.uid(),'receipt_'||new_state,jsonb_build_object('previous',r.state,'terms',p_terms));end if;
 return jsonb_build_object('state',new_state);
end;$$;
revoke all on function public.establishment_receipt_change(uuid,text,text,text,numeric) from public,anon;
grant execute on function public.establishment_receipt_change(uuid,text,text,text,numeric) to authenticated;

create function public.receipt_provision_claim(p_venue_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.establishment_receipts; a private.receipt_accounts; p public.partners; v public.venues; create_new boolean;
begin
 if exists(select from public.marketplace_settings where real_money_enabled) then raise exception 'RECEIPT_PROVIDER_ENVIRONMENT_MISMATCH';end if;
 select * into strict r from private.establishment_receipts where venue_id=p_venue_id and state='activating' and approved_by is not null for update;
 select * into strict v from public.venues where id=p_venue_id;
 select * into strict p from public.partners where id=v.partner_id and status='approved';
 insert into private.receipt_accounts(partner_id) values(p.id) on conflict do nothing;
 select * into strict a from private.receipt_accounts where partner_id=p.id for update;
 create_new:=a.attempted_at is null and a.account_id is null;
 if create_new then update private.receipt_accounts set attempted_at=now(),fee_venue_id=v.id where partner_id=p.id;end if;
 return jsonb_build_object('partner',p.id,'operation',r.operation_id,'account',a.account_id,'wallet',a.wallet_id,'create',create_new,
 'customer',jsonb_build_object('name',p.legal_name,'cpfCnpj',p.cnpj,'email',p.email,'mobilePhone',p.phone,'address',v.street,
 'addressNumber',v.street_number,'province',v.neighborhood,'postalCode',v.zip,'companyType',r.company_type,'incomeValue',r.income));
end;$$;

create function public.receipt_account_store(p_partner uuid,p_account uuid,p_wallet uuid,p_key text,p_main_wallet uuid,p_existing boolean) returns void
language plpgsql security definer set search_path='' as $$
declare a private.receipt_accounts; secret uuid;
begin
 select * into strict a from private.receipt_accounts where partner_id=p_partner for update;
 if a.account_id is not null then
  if a.account_id<>p_account or a.wallet_id<>p_wallet then raise exception 'RECEIPT_ACCOUNT_CONFLICT';end if;
  return;
 end if;
 if a.attempted_at is null or p_account is null or p_wallet is null or length(coalesce(p_key,''))<20 then raise exception 'RECEIPT_ACCOUNT_INVALID';end if;
 select vault.create_secret(p_key) into secret;
 update private.receipt_accounts set account_id=p_account,wallet_id=p_wallet,main_wallet=p_main_wallet,key_id=secret,opening_fee=case when p_existing then 0 else 12.90 end where partner_id=p_partner;
end;$$;

create function public.receipt_account_route(p_partner uuid default null,p_account uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('partnerId',a.partner_id,'accountId',a.account_id,'walletId',a.wallet_id,'apiKey',s.decrypted_secret,'commissionWalletId',a.main_wallet)
 from private.receipt_accounts a join vault.decrypted_secrets s on s.id=a.key_id
 where (p_partner is not null and a.partner_id=p_partner or p_account is not null and a.account_id=p_account)
 and (p_partner is null or p_account is null);
$$;
create function public.receipt_provision_finish(p_venue_id uuid,p_operation uuid,p_account uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from private.establishment_plans where venue_id=p_venue_id for update;
 update private.establishment_receipts r set state='on',checked_at=now()
 from public.venues v join private.receipt_accounts a on a.partner_id=v.partner_id
 where r.venue_id=v.id and r.venue_id=p_venue_id and r.operation_id=p_operation and r.state='activating' and a.account_id=p_account;
 if not found then return false;end if;
 insert into private.establishment_plan_audit(venue_id,action) values(p_venue_id,'receipt_on');
 return true;
end;$$;
revoke all on function public.receipt_provision_claim(uuid),public.receipt_account_store(uuid,uuid,uuid,text,uuid,boolean),
 public.receipt_account_route(uuid,uuid),public.receipt_provision_finish(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.receipt_provision_claim(uuid),public.receipt_account_store(uuid,uuid,uuid,text,uuid,boolean),
 public.receipt_account_route(uuid,uuid),public.receipt_provision_finish(uuid,uuid,uuid) to service_role;

-- This state reserves the agenda without recording a settlement or paying any participant.
alter table public.monthly_cycles drop constraint monthly_cycles_status_check;
alter table public.monthly_cycles add check(status in ('pending_acceptance','pre_reserved','awaiting_initial','initial_confirmed','awaiting_full','fully_paid','suspended','cancelled','completed','external'));
create function private.confirm_external_booking(p_id uuid) returns void language plpgsql set search_path='' as $$
declare r public.reservations;
begin
 select * into strict r from public.reservations where id=p_id and receipt_mode='external' for update;
 update public.reservations set status='confirmed',confirmed_at=now(),payment_method='manual_external',payment_expires_at=null,
 event_publication_status=case when event_mode='new' then 'published'::public.event_status else event_publication_status end where id=p_id;
 update public.marketplace_events set status='published',published_at=now() where source_reservation_id=p_id and status='standby_payment';
 update public.reservation_chats set unlocked_at=now(),status='active' where reservation_id=p_id and status='locked';
 if r.monthly_cycle_id is not null then
  update public.monthly_cycles set status='external',payment_plan=jsonb_build_object('mode','external') where id=r.monthly_cycle_id;
 end if;
end;$$;
revoke all on function private.confirm_external_booking(uuid) from public,anon,authenticated;

create function private.guard_external_payment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select from public.reservations where id=new.reservation_id and receipt_mode='external') then raise exception 'RECEIPT_PAY_AT_VENUE';end if;
 return new;
end;$$;
revoke all on function private.guard_external_payment() from public,anon,authenticated;
create trigger guard_external_payment before insert on public.payment_intents for each row execute function private.guard_external_payment();
create trigger guard_external_collection before insert on public.monthly_payment_stages for each row execute function private.guard_external_payment();

CREATE OR REPLACE FUNCTION private.capture_establishment_rate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v private.establishment_plans; actual_venue uuid; actual_partner uuid; today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if tg_op='UPDATE' then
  if new.receipt_mode is distinct from old.receipt_mode then raise exception 'PLAN_RESERVATION_CONTRACT_IMMUTABLE';end if;
  if old.commercial_plan_venue_id is not null and (new.finance_commission_rate is distinct from old.finance_commission_rate
   or new.group_id is distinct from old.group_id or new.venue_id is distinct from old.venue_id or new.partner_id is distinct from old.partner_id
   or new.commercial_basis is distinct from old.commercial_basis or new.commercial_plan_venue_id is distinct from old.commercial_plan_venue_id) then
   raise exception 'PLAN_RESERVATION_CONTRACT_IMMUTABLE';end if;
  if old.commercial_plan_venue_id is not null and not exists(select 1 from public.venue_spaces s where s.id=new.venue_space_id and s.venue_id=old.commercial_plan_venue_id) then raise exception 'PLAN_VENUE_MISMATCH';end if;
  return new;
 end if;
 new.receipt_mode:=null;
 select s.venue_id,vv.partner_id into actual_venue,actual_partner from public.venue_spaces s join public.venues vv on vv.id=s.venue_id where s.id=new.venue_space_id;
 select * into v from private.establishment_plans where venue_id=coalesce(actual_venue,new.venue_id) for share;
 if not found then
  if exists(select 1 from public.marketplace_settings where real_money_enabled) then raise exception 'PLAN_REQUIRED';end if;
  return new;
 end if;
 if new.venue_id is distinct from actual_venue or new.partner_id is distinct from actual_partner then raise exception 'PLAN_VENUE_MISMATCH';end if;
 if v.state<>'ready' then
  if exists(select 1 from public.marketplace_settings where real_money_enabled) then raise exception 'PLAN_REVIEW_REQUIRED';end if;
  return new;
 end if;
 if today<v.starts_on then raise exception 'PLAN_NOT_STARTED';end if;
 if not exists(select 1 from private.establishment_invoices where venue_id=v.venue_id and competence=v.starts_on and status='paid'
 and (case when exists(select 1 from public.marketplace_settings where real_money_enabled)
 then environment='production' and not simulated else environment='sandbox' end)) then raise exception 'PLAN_FIRST_PAYMENT_REQUIRED';end if;
 new.commercial_plan_venue_id:=v.venue_id;
 if exists(select from public.marketplace_settings where real_money_enabled) and exists(select from private.establishment_receipts where venue_id=v.venue_id and state='on') then
  raise exception 'RECEIPT_PROVIDER_ENVIRONMENT_MISMATCH';
 end if;
 new.commercial_basis:='fixed_establishment';
 new.finance_commission_rate:=0;
 new.receipt_mode:=case when exists(select from private.establishment_receipts where venue_id=v.venue_id and state='on') then 'asaas' else 'external' end;
 return new;
end;$function$;

CREATE OR REPLACE FUNCTION public.establishment_finance_read(p_partner_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare base jsonb; result jsonb;
begin
 -- Reuse the audited admin/partner/preview scope, without expanding it.
 base:=public.establishment_plans_read(p_partner_id);
 select jsonb_build_object('admin',base->'admin','today',base->'today','test_mode',base->'test_mode',
 'readonly',private.partner_readonly_active(),'venues',coalesce((select jsonb_agg(jsonb_build_object('id',v->>'id','name',v->>'name','partner',v->>'partner','partner_id',v->>'partner_id','has_plan',v->'plan'<>'null'::jsonb,'receipts',case when v->'plan'->>'state'='ready' then coalesce(
 (select state from private.establishment_receipts where venue_id=(v->>'id')::uuid),'off') end,
 'fee_status',(select fee_status from private.receipt_accounts where fee_venue_id=(v->>'id')::uuid),
 'fee_url',(select fee_url from private.receipt_accounts where fee_venue_id=(v->>'id')::uuid),
 'opening_fee',(select opening_fee from private.receipt_accounts where fee_venue_id=(v->>'id')::uuid))) from jsonb_array_elements(base->'venues') v),'[]'),
 'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'venue_id',i.venue_id,'venue',v->>'name','partner',v->>'partner',
 'competence',i.competence,'due_on',i.due_on,'amount',i.amount,'status',i.status,'paid_at',i.paid_at,
 'environment',i.environment,'simulated',i.simulated,'provider_issued',i.provider_id is not null,
 'payment_method',coalesce(i.payment_method,case when i.provider_id is not null and i.status='paid' then 'pix' end),
 'attempt_state',a.state) order by i.competence desc,v->>'partner',v->>'name')
 from jsonb_array_elements(base->'venues') v join private.establishment_invoices i on i.venue_id=(v->>'id')::uuid
 left join private.establishment_payment_attempts a on a.invoice_id=i.id),'[]')) into result;
 return result;
end;$function$;

CREATE OR REPLACE FUNCTION public.create_reservation_prebooking(p_schedule_slot_id uuid, p_group_id uuid, p_event_id uuid DEFAULT NULL::uuid, p_create_event boolean DEFAULT false, p_policy_version text DEFAULT 'marketplace-0.2.0-part-22p-r7'::text, p_policy_accepted boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_slot public.schedule_slots%rowtype;
  v_space public.venue_spaces%rowtype;
  v_venue public.venues%rowtype;
  v_partner public.partners%rowtype;
  v_res_id uuid:=gen_random_uuid();
  v_code text:=private.next_reservation_code();
  v_event_id uuid:=p_event_id;
  v_event_mode text:=case when p_event_id is not null then 'existing' when coalesce(p_create_event,false) then 'new' else 'none' end;
  v_deadline timestamptz;
  v_chat_deadline timestamptz;
  v_partner_member record;
begin
  if auth.uid() is null then raise exception 'Autenticação obrigatória'; end if;
  if not coalesce(p_policy_accepted,false) then raise exception 'Aceite das regras da pré-reserva é obrigatório'; end if;
  if nullif(trim(coalesce(p_policy_version,'')),'') is null then raise exception 'Versão da política é obrigatória'; end if;
  perform public.assert_marketplace_writable();
  if not exists(select 1 from public.profiles where id=auth.uid() and status='active') then raise exception 'Conta sem acesso para reservar'; end if;
  if p_group_id is null and (p_event_id is not null or coalesce(p_create_event,false)) then raise exception 'Reserva pessoal não permite evento de grupo'; end if;
  if p_group_id is not null and not private.can_book_for_group(p_group_id) then
    raise exception 'A pré-reserva deve estar vinculada a grupo administrado pelo usuário';
  end if;
  if p_event_id is not null and coalesce(p_create_event,false) then
    raise exception 'Escolha apenas uma opção: criar novo evento ou vincular evento existente';
  end if;

  select * into v_slot from public.schedule_slots where id=p_schedule_slot_id for update;
  if not found then raise exception 'Horário não encontrado'; end if;
  if v_slot.status<>'available' then raise exception 'Horário indisponível'; end if;
  if exists(select 1 from public.reservation_occurrences where schedule_slot_id=v_slot.id and status='active') then
    raise exception 'Horário já reservado';
  end if;

  select * into v_space from public.venue_spaces where id=v_slot.venue_space_id and active;
  if not found then raise exception 'Espaço não encontrado ou inativo'; end if;
  select * into v_venue from public.venues where id=v_space.venue_id and published;
  if not found then raise exception 'Estabelecimento não publicado'; end if;
  select * into v_partner from public.partners where id=v_venue.partner_id and status='approved';
  if not found then raise exception 'Parceiro não aprovado'; end if;

  if p_event_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_event_id::text,0));
  end if;

  if p_event_id is not null and not exists(
    select 1
    from public.marketplace_events me
    where me.id=p_event_id
      and me.group_id=p_group_id
      and me.status='published'
      and me.starts_at=v_slot.starts_at
      and me.ends_at=v_slot.ends_at
      and me.source_reservation_id is null
      and not exists(
        select 1 from public.reservations existing_reservation
        where existing_reservation.event_id=me.id
          and existing_reservation.status not in ('cancelled','expired')
      )
  ) then
    raise exception 'Evento deve estar publicado no grupo, coincidir com a reserva e não estar vinculado a outra reserva ativa';
  end if;

  v_deadline:=private.single_prebooking_deadline(now(),v_slot.starts_at);
  if v_deadline<=now() then raise exception 'Horário muito próximo para criar pré-reserva'; end if;

  insert into public.reservations(
    id,public_code,user_id,partner_id,venue_id,venue_space_id,group_id,event_id,booking_mode,status,
    gross_value,voucher_discount,net_value,payment_due,payment_method,payment_provider,split_pix,
    cancellation_policy_version,cancellation_policy_accepted_at,event_mode,event_publication_status,
    payment_expires_at,payment_responsible_id,payment_responsibility_mode,payment_configured_at,payment_configured_by
  ) values (
    v_res_id,v_code,auth.uid(),v_partner.id,v_venue.id,v_space.id,p_group_id,p_event_id,'single','pending_payment',
    v_slot.price,0,v_slot.price,v_slot.price,null,null,false,
    p_policy_version,now(),v_event_mode,
    case when v_event_mode='existing' then 'linked_existing'::public.event_status when v_event_mode='new' then 'standby_payment'::public.event_status else null end,
    v_deadline,null,'creator',null,null
  );

  if v_event_mode='new' then
    insert into public.marketplace_events(
      group_id,title,starts_at,ends_at,venue_name,status,source,source_reservation_id,created_by
    ) values (
      p_group_id,v_venue.name||' · '||to_char(v_slot.starts_at at time zone v_venue.timezone,'DD/MM HH24:MI'),
      v_slot.starts_at,v_slot.ends_at,v_venue.name,'standby_payment','reservation',v_res_id,auth.uid()
    ) returning id into v_event_id;
    update public.reservations set event_id=v_event_id where id=v_res_id;
  end if;

  insert into public.reservation_occurrences(reservation_id,schedule_slot_id,starts_at,ends_at,allocated_value)
  values (v_res_id,v_slot.id,v_slot.starts_at,v_slot.ends_at,v_slot.price);

  v_chat_deadline:=private.reservation_chat_deadline(v_res_id);
  insert into public.reservation_chats(reservation_id,user_id,partner_id,unlocked_at,read_only_at,status)
  values (v_res_id,auth.uid(),v_partner.id,null,v_chat_deadline,'locked');

  if exists(select from public.reservations where id=v_res_id and receipt_mode='external') then
    perform private.confirm_external_booking(v_res_id);
    insert into public.notifications(profile_id,type,title,body,entity_type,entity_id)
    select recipient,'reservation_confirmed','Reserva confirmada','Pagamento direto ao estabelecimento.','reservation',v_res_id
    from (select auth.uid() recipient union select profile_id from public.partner_members where partner_id=v_partner.id and active) recipients;
    return jsonb_build_object('reservation_id',v_res_id,'public_code',v_code,'gross_value',v_slot.price,'receipt_mode','external','booking_mode','single','occurrences',1,'event_id',v_event_id);
  end if;

  insert into public.notifications(profile_id,type,title,body,entity_type,entity_id,data)
  values (auth.uid(),'reservation_prebooked','Pré-reserva criada',
    'O horário foi protegido. Defina e conclua o pagamento em Minhas reservas dentro do prazo informado.',
    'reservation',v_res_id,jsonb_build_object('reservation_code',v_code,'payment_deadline',v_deadline,'payment_configured',false));

  for v_partner_member in select profile_id from public.partner_members where partner_id=v_partner.id and active loop
    insert into public.notifications(profile_id,type,title,body,entity_type,entity_id,data)
    values (v_partner_member.profile_id,'reservation_prebooked_partner','Nova pré-reserva',
      'Um horário foi pré-reservado e aguarda definição e confirmação do pagamento.',
      'reservation',v_res_id,jsonb_build_object('reservation_code',v_code,'payment_deadline',v_deadline));
  end loop;

  return jsonb_build_object(
    'reservation_id',v_res_id,'public_code',v_code,'gross_value',v_slot.price,
    'payment_due',v_slot.price,'payment_configured',false,'payment_deadline',v_deadline,
    'event_id',v_event_id,'event_mode',v_event_mode,
    'occurrences',1,'booking_mode','single'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.activate_monthly_cycle_prebooking(p_monthly_cycle_id uuid, p_policy_version text, p_policy_accepted boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_cycle public.monthly_cycles%rowtype;
  v_link public.monthly_customer_links%rowtype;
  v_venue public.venues%rowtype;
  v_res_id uuid:=gen_random_uuid();
  v_code text:=private.next_reservation_code();
  v_first_event uuid;
  v_occurrence_id uuid;
  v_event_id uuid;
  v_slot record;
  v_slot_count integer:=0;
  v_index integer:=0;
  v_allocated numeric(12,2):=0;
  v_slot_amount numeric(12,2);
begin
  if auth.uid() is null then raise exception 'Autenticação obrigatória'; end if;
  if not coalesce(p_policy_accepted,false) then raise exception 'Aceite das regras mensalistas é obrigatório'; end if;
  if nullif(trim(coalesce(p_policy_version,'')),'') is null then raise exception 'Versão da política é obrigatória'; end if;

  select * into v_cycle from public.monthly_cycles where id=p_monthly_cycle_id for update;
  if not found then raise exception 'Ciclo mensalista não encontrado'; end if;
  select * into v_link from public.monthly_customer_links where id=v_cycle.monthly_link_id for update;
  select * into v_venue from public.venues where id=v_link.venue_id;
  if not (private.owns_personal_monthly_link(v_link.id) or private.can_book_for_group(v_link.group_id)) then raise exception 'Sem permissão para ativar o ciclo mensalista'; end if;
  if v_link.status<>'active' or v_link.accepted_at is null then raise exception 'Vínculo mensalista ainda não foi aceito ou está suspenso'; end if;
  if v_cycle.reservation_id is not null then raise exception 'Ciclo mensalista já ativado'; end if;
  if v_cycle.occurrence_count<1 then raise exception 'Ciclo mensalista sem horários protegidos'; end if;

  insert into public.reservations(
    id,public_code,user_id,partner_id,venue_id,venue_space_id,group_id,booking_mode,status,
    gross_value,voucher_discount,net_value,payment_due,payment_method,payment_provider,split_pix,
    cancellation_policy_version,cancellation_policy_accepted_at,event_mode,event_publication_status,payment_expires_at,
    payment_responsible_id,payment_responsibility_mode,monthly_cycle_id,payment_configured_at,payment_configured_by
  ) values (
    v_res_id,v_code,auth.uid(),v_link.partner_id,v_link.venue_id,v_link.venue_space_id,v_link.group_id,'monthly','pending_payment',
    v_cycle.monthly_total,0,v_cycle.monthly_total,v_cycle.monthly_total,null,null,false,
    p_policy_version,now(),case when v_link.group_id is null then 'none' else 'new' end,case when v_link.group_id is null then null else 'published'::public.event_status end,v_cycle.balance_due_at,
    null,'creator',v_cycle.id,null,null
  );

  select count(*) into v_slot_count from public.monthly_pre_reservation_slots
  where monthly_cycle_id=v_cycle.id and status='pre_reserved';

  for v_slot in
    select ss.*,mprs.id pre_id
    from public.monthly_pre_reservation_slots mprs
    join public.schedule_slots ss on ss.id=mprs.schedule_slot_id
    where mprs.monthly_cycle_id=v_cycle.id and mprs.status='pre_reserved'
    order by ss.starts_at for update of ss
  loop
    v_index:=v_index+1;
    if exists(select 1 from public.reservation_occurrences where schedule_slot_id=v_slot.id and status='active') then
      raise exception 'Um horário protegido recebeu outra reserva';
    end if;
    v_slot_amount:=case when v_index=v_slot_count then v_cycle.monthly_total-v_allocated
      else round(v_cycle.monthly_total/v_slot_count,2) end;
    insert into public.reservation_occurrences(reservation_id,schedule_slot_id,starts_at,ends_at,allocated_value)
    values (v_res_id,v_slot.id,v_slot.starts_at,v_slot.ends_at,v_slot_amount)
    returning id into v_occurrence_id;
    v_allocated:=v_allocated+v_slot_amount;
    v_event_id:=null;
    if v_link.group_id is not null then
    insert into public.marketplace_events(
      group_id,title,starts_at,ends_at,venue_name,status,source,source_reservation_id,published_at,created_by
    ) values (
      v_link.group_id,v_venue.name||' · '||to_char(v_slot.starts_at at time zone v_link.timezone,'DD/MM HH24:MI'),
      v_slot.starts_at,v_slot.ends_at,v_venue.name,'published','monthly_cycle',v_res_id,now(),auth.uid()
    ) returning id into v_event_id;
    end if;
    if v_first_event is null then v_first_event:=v_event_id; end if;
    insert into public.monthly_cycle_events(monthly_cycle_id,reservation_occurrence_id,marketplace_event_id,financial_status)
    values (v_cycle.id,v_occurrence_id,v_event_id,'guarantee_pending');
    update public.monthly_pre_reservation_slots set status='claimed' where id=v_slot.pre_id;
  end loop;

  update public.reservations set event_id=v_first_event where id=v_res_id;
  update public.monthly_cycles set
    reservation_id=v_res_id,activated_by=auth.uid(),activated_at=now(),
    payment_plan=jsonb_build_object('configured',false),
    status=case when initial_required>0 then 'awaiting_initial' else 'awaiting_full' end
  where id=v_cycle.id;

  insert into public.reservation_chats(reservation_id,user_id,partner_id,unlocked_at,read_only_at,status)
  values (v_res_id,auth.uid(),v_link.partner_id,null,v_cycle.last_occurrence_at,'locked');

  if exists(select from public.reservations where id=v_res_id and receipt_mode='external') then
    perform private.confirm_external_booking(v_res_id);
    return jsonb_build_object('monthly_cycle_id',v_cycle.id,'reservation_id',v_res_id,'public_code',v_code,'status','external','receipt_mode','external','monthly_total',v_cycle.monthly_total);
  end if;
  if v_cycle.initial_required>0 then
    insert into public.monthly_payment_stages(monthly_cycle_id,reservation_id,stage,status,amount_required,available_from,due_at)
    values (v_cycle.id,v_res_id,'initial','scheduled',v_cycle.initial_required,v_cycle.payment_available_at,v_cycle.initial_due_at);
    insert into public.monthly_payment_stages(monthly_cycle_id,reservation_id,stage,status,amount_required,available_from,due_at)
    values (v_cycle.id,v_res_id,'balance','scheduled',v_cycle.balance_required,v_cycle.payment_available_at,v_cycle.balance_due_at);
  else
    insert into public.monthly_payment_stages(monthly_cycle_id,reservation_id,stage,status,amount_required,available_from,due_at)
    values (v_cycle.id,v_res_id,'full','scheduled',v_cycle.monthly_total,v_cycle.payment_available_at,v_cycle.balance_due_at);
  end if;

  return jsonb_build_object(
    'monthly_cycle_id',v_cycle.id,'reservation_id',v_res_id,'public_code',v_code,
    'status',case when v_cycle.initial_required>0 then 'awaiting_initial' else 'awaiting_full' end,
    'monthly_total',v_cycle.monthly_total,'initial_required',v_cycle.initial_required,
    'balance_required',v_cycle.balance_required,'payment_available_at',v_cycle.payment_available_at,
    'initial_due_at',v_cycle.initial_due_at,'balance_due_at',v_cycle.balance_due_at,
    'events_published',case when v_link.group_id is null then 0 else v_cycle.occurrence_count end,'payment_configured',false
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.contract_direct_monthly_prebooking(p_schedule_slot_id uuid, p_group_id uuid, p_policy_version text DEFAULT 'marketplace-0.2.0-part-22p'::text, p_policy_accepted boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_slot public.schedule_slots%rowtype;
  v_space public.venue_spaces%rowtype;
  v_venue public.venues%rowtype;
  v_partner public.partners%rowtype;
  v_group public.marketplace_groups%rowtype;
  v_local_start timestamp;
  v_local_end timestamp;
  v_service_month date;
  v_weekday smallint;
  v_link_id uuid;
  v_cycle_id uuid;
  v_protected integer:=0;
  v_activated jsonb;
  v_expected_date date;
  v_expected_ids uuid[] := '{}';
  v_candidate_id uuid;
begin
  perform public.assert_marketplace_writable();
  if auth.uid() is null then raise exception 'Autenticação obrigatória'; end if;
  if not coalesce(p_policy_accepted,false) then raise exception 'Aceite das regras mensalistas é obrigatório'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and status='active') then raise exception 'Conta sem acesso para reservar'; end if;
  if p_group_id is not null and not private.can_book_for_group(p_group_id) then
    raise exception 'Somente administrador autorizado do grupo pode contratar mensalista';
  end if;
  if p_group_id is not null then
    select * into v_group from public.marketplace_groups where id=p_group_id and active;
    if not found then raise exception 'Grupo não encontrado ou inativo'; end if;
  end if;

  select * into v_slot from public.schedule_slots where id=p_schedule_slot_id for update;
  if not found then raise exception 'Horário não encontrado'; end if;
  if v_slot.status<>'available' then raise exception 'Horário indisponível'; end if;
  if v_slot.ends_at<=now() then raise exception 'Horário mensalista já encerrado'; end if;
  if not v_slot.monthly_eligible or coalesce(v_slot.monthly_package_price,0)<=0 then
    raise exception 'Horário sem oferta mensalista direta';
  end if;
  if exists(
    select 1 from public.reservation_occurrences ro join public.reservations r on r.id=ro.reservation_id
    where ro.schedule_slot_id=v_slot.id and ro.status='active' and r.status in ('pending_payment','confirmed')
  ) or exists(
    select 1 from public.monthly_pre_reservation_slots
    where schedule_slot_id=v_slot.id and status in ('pre_reserved','claimed')
  ) then raise exception 'Horário indisponível'; end if;

  select * into v_space from public.venue_spaces where id=v_slot.venue_space_id and active;
  if not found then raise exception 'Espaço não encontrado ou inativo'; end if;
  select * into v_venue from public.venues where id=v_space.venue_id and published;
  if not found then raise exception 'Estabelecimento não publicado'; end if;
  select * into v_partner from public.partners where id=v_venue.partner_id and status='approved';
  if not found then raise exception 'Parceiro não aprovado'; end if;

  v_local_start:=v_slot.starts_at at time zone v_venue.timezone;
  v_local_end:=v_slot.ends_at at time zone v_venue.timezone;
  v_service_month:=date_trunc('month',v_local_start)::date;
  v_weekday:=extract(isodow from v_local_start)::smallint;

  perform pg_advisory_xact_lock(hashtextextended(
    v_space.id::text||'|'||v_weekday::text||'|'||v_local_start::time::text||'|'||private.schedule_end_time(v_local_start,v_local_end)::text,0
  ));
  if exists(
    select 1 from public.monthly_customer_links ml
    where ml.venue_space_id=v_space.id and ml.weekday=v_weekday
      and ml.start_time<private.schedule_end_time(v_local_start,v_local_end) and ml.end_time>v_local_start::time
      and ml.status in ('pending_acceptance','active')
      and coalesce(ml.end_month,'infinity'::date)>=v_service_month
  ) then raise exception 'MONTHLY_LINK_TIME_CONFLICT'; end if;

  -- O calendário, e não apenas os slots encontrados, define o primeiro ciclo.
  -- Bloqueia as linhas antes de conferir reservas e antes de criar o vínculo.
  for v_expected_date in
    select d::date from generate_series(v_local_start::date::timestamp,
      (v_service_month + interval '1 month' - interval '1 day')::timestamp,interval '7 days') d
  loop
    select ss.id into v_candidate_id
    from public.schedule_slots ss
    where ss.venue_space_id=v_space.id and ss.status='available' and ss.monthly_eligible
      and ss.starts_at=(v_expected_date+v_local_start::time) at time zone v_venue.timezone
      and ss.ends_at=(v_expected_date+v_local_start::time+(v_local_end-v_local_start)) at time zone v_venue.timezone
    for update;
    if v_candidate_id is null or exists(
      select 1 from public.reservation_occurrences ro join public.reservations r on r.id=ro.reservation_id
      where ro.schedule_slot_id=v_candidate_id and ro.status='active' and r.status in ('pending_payment','confirmed')
    ) or exists(
      select 1 from public.monthly_pre_reservation_slots
      where schedule_slot_id=v_candidate_id and status in ('pre_reserved','claimed')
    ) then
      raise exception 'MONTHLY_OFFER_DISCONTINUOUS';
    end if;
    v_expected_ids:=array_append(v_expected_ids,v_candidate_id);
  end loop;

  insert into public.monthly_customer_links(
    partner_id,venue_id,venue_space_id,group_id,customer_profile_id,weekday,start_time,end_time,timezone,
    monthly_price,start_month,end_month,origin,status,require_renewal_confirmation,
    accepted_by,accepted_at,created_by
  ) values (
    v_partner.id,v_venue.id,v_space.id,v_group.id,case when p_group_id is null then auth.uid() else null end,v_weekday,v_local_start::time,private.schedule_end_time(v_local_start,v_local_end),v_venue.timezone,
    round(v_slot.monthly_package_price,2),v_service_month,null,'marketplace','active',false,
    auth.uid(),now(),auth.uid()
  ) returning id into v_link_id;

  v_protected:=private.sync_monthly_customer_link(v_link_id);
  select id into v_cycle_id from public.monthly_cycles
  where monthly_link_id=v_link_id and service_month=v_service_month for update;
  if v_cycle_id is null then raise exception 'Ciclo mensalista sem horários disponíveis'; end if;
  if not exists(
    select 1 from public.monthly_pre_reservation_slots
    where monthly_cycle_id=v_cycle_id and schedule_slot_id=v_slot.id and status='pre_reserved'
  ) then raise exception 'Horário selecionado não foi protegido'; end if;

  update public.monthly_pre_reservation_slots mprs set
    status='released',released_at=now(),release_reason='Ocorrência anterior à contratação direta'
  from public.schedule_slots ss
  where mprs.monthly_cycle_id=v_cycle_id and mprs.schedule_slot_id=ss.id
    and mprs.status='pre_reserved' and ss.starts_at<v_slot.starts_at;
  perform private.recalculate_monthly_cycle(v_cycle_id);
  select count(*)::integer into v_protected
  from public.monthly_pre_reservation_slots
  where monthly_cycle_id=v_cycle_id and status in ('pre_reserved','claimed');

  -- Se alguma proteção não foi criada, reverte integralmente a contratação.
  if v_protected<>cardinality(v_expected_ids) or exists(
    select 1 from unnest(v_expected_ids) expected_id where not exists(
      select 1 from public.monthly_pre_reservation_slots mprs
      where mprs.monthly_cycle_id=v_cycle_id and mprs.schedule_slot_id=expected_id
        and mprs.status in ('pre_reserved','claimed')
    )
  ) then raise exception 'MONTHLY_OFFER_DISCONTINUOUS'; end if;

  v_activated:=private.activate_monthly_cycle_prebooking(v_cycle_id,p_policy_version,p_policy_accepted);

  update public.monthly_link_requests set
    status='converted',monthly_link_id=v_link_id,closed_at=now(),
    partner_response=coalesce(partner_response,'Oferta mensalista publicada e pré-reservada diretamente pelo grupo')
  where group_id=v_group.id and venue_space_id=v_space.id and weekday=v_weekday
    and start_time=v_local_start::time and end_time=private.schedule_end_time(v_local_start,v_local_end)
    and status in ('pending_partner','in_conversation','proposal_sent');

  insert into public.notifications(profile_id,type,title,body,entity_type,entity_id,data)
  select pm.profile_id,'monthly_direct_offer_prebooked','Novo mensalista pré-reservado',
    case when v_activated->>'receipt_mode'='external' then 'Reserva mensalista confirmada. Pagamento direto ao estabelecimento.' else 'Um cliente protegeu o horário mensalista e definirá o pagamento em Minhas reservas.' end,
    'monthly_customer_link',v_link_id,
    jsonb_build_object('monthly_link_id',v_link_id,'monthly_cycle_id',v_cycle_id,'group_id',v_group.id,
      'direct_offer',true,'reservation_id',v_activated->>'reservation_id','payment_configured',false)
  from public.partner_members pm where pm.partner_id=v_partner.id and pm.active;

  insert into public.notifications(profile_id,type,title,body,entity_type,entity_id,data)
  values (auth.uid(),'monthly_direct_offer_prebooked','Horário mensalista pré-reservado',
    case when v_activated->>'receipt_mode'='external' then 'Reserva mensalista confirmada. Combine o pagamento com o estabelecimento.' else 'O vínculo protegido foi criado. Defina o pagamento em Minhas reservas dentro do prazo informado.' end,
    'monthly_customer_link',v_link_id,
    jsonb_build_object('monthly_link_id',v_link_id,'monthly_cycle_id',v_cycle_id,'group_id',v_group.id,
      'direct_offer',true,'reservation_id',v_activated->>'reservation_id','payment_configured',false));

  return v_activated||jsonb_build_object(
    'monthly_link_id',v_link_id,'monthly_cycle_id',v_cycle_id,'protected_slots',v_protected,
    'direct_offer',true,'link_status','active','payment_configured',false,
    'chat_available_after_confirmation',true
  );
end;
$function$;

create function public.receipt_awaiting_venues(p_account uuid) returns setof uuid
language sql stable security definer set search_path='' as $$
 select v.id from private.receipt_accounts a join public.venues v on v.partner_id=a.partner_id
 join private.establishment_receipts r on r.venue_id=v.id where a.account_id=p_account and r.state='activating'
$$;
revoke all on function public.receipt_awaiting_venues(uuid) from public,anon,authenticated;
grant execute on function public.receipt_awaiting_venues(uuid) to service_role;

create function public.reservation_receipt_mode(p_venue_id uuid) returns text language sql stable security definer set search_path='' as $$
 select case when p.state is distinct from 'ready' then 'legacy' when r.state='on' then 'asaas' else 'external' end
 from public.venues v left join private.establishment_plans p on p.venue_id=v.id
 left join private.establishment_receipts r on r.venue_id=v.id where v.id=p_venue_id and v.published and auth.uid() is not null
$$;
revoke all on function public.reservation_receipt_mode(uuid) from public,anon;
grant execute on function public.reservation_receipt_mode(uuid) to authenticated;

alter table public.reservations add column external_received_at timestamptz;
create function public.reservation_record_external(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.reservations;
begin
 select * into strict r from public.reservations where id=p_id and receipt_mode='external' for update;
 if auth.uid() is null or private.partner_readonly_active() or not private.has_partner_permission(r.partner_id,'manage_finance')
 or not exists(select from public.profiles where id=auth.uid() and status='active') then raise exception 'PLAN_ACCESS_DENIED';end if;
 if r.status not in ('confirmed','completed') then raise exception 'RECEIPT_STATE_CHANGED';end if;
 if r.external_received_at is null then
  update public.reservations set external_received_at=now() where id=p_id;
  insert into private.establishment_plan_audit(venue_id,actor_id,action,detail) values(r.venue_id,auth.uid(),'received_externally',jsonb_build_object('reservation',r.id));
 end if;
end;$$;
revoke all on function public.reservation_record_external(uuid) from public,anon;
grant execute on function public.reservation_record_external(uuid) to authenticated;

-- External receipts are acknowledgements only. No provider payment, voucher or refund can be created from them.
create trigger guard_external_provider_payment before insert on public.payments for each row execute function private.guard_external_payment();
create function private.guard_external_voucher() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select from public.reservations where id=new.source_reservation_id and receipt_mode='external') then raise exception 'RECEIPT_PAY_AT_VENUE';end if;
 return new;
end;$$;
revoke all on function private.guard_external_voucher() from public,anon,authenticated;
create trigger guard_external_voucher before insert on public.vouchers for each row execute function private.guard_external_voucher();
create function public.cancel_external_reservation(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare r public.reservations; actor text;
begin
 select * into strict r from public.reservations where id=p_id and receipt_mode='external' for update;
 if auth.uid() is null or private.partner_readonly_active() or not exists(select from public.profiles where id=auth.uid() and status='active') then raise exception 'PLAN_ACCESS_DENIED';end if;
 actor:=case when r.user_id=auth.uid() then 'user' when private.is_admin() then 'admin' when private.is_partner_member(r.partner_id) then 'partner' end;
 if actor is null then raise exception 'PLAN_ACCESS_DENIED';end if;
 if r.status='cancelled' then return;end if;
 if r.status<>'confirmed' or coalesce(length(trim(p_reason)),0) not between 1 and 1000 then raise exception 'RECEIPT_STATE_CHANGED';end if;
 if exists(select from public.reservation_occurrences where reservation_id=r.id and status in ('active','completed') and starts_at<=now()) then raise exception 'RESERVATION_ALREADY_STARTED';end if;
 update public.reservation_occurrences set status='cancelled' where reservation_id=r.id and status='active';
 update public.marketplace_events set status='cancelled' where source_reservation_id=r.id and status<>'cancelled';
 update public.reservation_chats set status='read_only',read_only_at=now() where reservation_id=r.id;
 update public.monthly_cycles set status='cancelled' where id=r.monthly_cycle_id;
 update public.monthly_pre_reservation_slots set status='released',released_at=now() where monthly_cycle_id=r.monthly_cycle_id and status in ('claimed','pre_reserved');
 insert into public.cancellation_requests(reservation_id,requested_by,requester_type,reason,within_deadline,status,resolution)
 values(r.id,auth.uid(),actor,trim(p_reason),false,'processed','no_compensation');
 update public.reservations set status='cancelled',cancelled_at=now() where id=r.id;
 insert into public.notifications(profile_id,type,title,body,entity_type,entity_id)
 select recipient,'reservation_cancelled','Reserva cancelada','Ajuste eventuais pagamentos diretamente com o estabelecimento.','reservation',r.id
 from(select r.user_id recipient union select profile_id from public.partner_members where active and partner_id=r.partner_id) people;
end;$$;
revoke all on function public.cancel_external_reservation(uuid,text) from public,anon;
grant execute on function public.cancel_external_reservation(uuid,text) to authenticated;

-- Compare the terms shown to the customer with the contract actually inserted.
-- A concurrent venue switch rolls the entire booking back rather than changing its terms.
create function public.book_with_receipt_mode(p_slot uuid,p_group uuid,p_event uuid,p_create_event boolean,p_monthly boolean,
 p_policy text,p_accepted boolean,p_expected text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; mode text;
begin
 if p_monthly then result:=public.contract_direct_monthly_prebooking(p_slot,p_group,p_policy,p_accepted);
 else result:=public.create_reservation_prebooking(p_slot,p_group,p_event,p_create_event,p_policy,p_accepted);end if;
 select coalesce(receipt_mode,'legacy') into strict mode from public.reservations where id=(result->>'reservation_id')::uuid;
 if p_expected is distinct from mode then raise exception 'RECEIPT_MODE_CHANGED';end if;
 return result||jsonb_build_object('receipt_mode',mode);
end;$$;
revoke all on function public.book_with_receipt_mode(uuid,uuid,uuid,boolean,boolean,text,boolean,text) from public,anon;
grant execute on function public.book_with_receipt_mode(uuid,uuid,uuid,boolean,boolean,text,boolean,text) to authenticated;

create function public.receipt_fee_authorize(p_venue_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare partner uuid;
begin
 select partner_id into strict partner from public.venues where id=p_venue_id;
 perform public.establishment_plans_read(partner);
 if private.partner_readonly_active() or exists(select from public.platform_admins where profile_id=auth.uid()) then raise exception 'PLAN_PARTNER_CONFIRMATION_REQUIRED';end if;
 return partner;
end;$$;
create function public.receipt_fee_claim(p_partner uuid,p_venue_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.receipt_accounts; customer text; create_new boolean;
begin
 if exists(select from public.marketplace_settings where real_money_enabled) then raise exception 'RECEIPT_PROVIDER_ENVIRONMENT_MISMATCH';end if;
 select * into strict a from private.receipt_accounts where partner_id=p_partner and fee_venue_id=p_venue_id and opening_fee>0 for update;
 select i.provider_customer into customer from private.establishment_invoices i where i.venue_id=p_venue_id and environment='sandbox'
 and provider_customer is not null and not simulated order by created_at desc limit 1;
 if customer is null then raise exception 'RECEIPT_BILLING_CUSTOMER_REQUIRED';end if;
 create_new:=a.fee_attempted_at is null;
 if create_new then update private.receipt_accounts set fee_attempted_at=now(),fee_customer=customer where partner_id=p_partner;end if;
 return jsonb_build_object('create',create_new,'customer',coalesce(a.fee_customer,customer),'id',a.fee_payment,'amount',a.opening_fee,
 'reference','tamoon-opening:'||a.account_id::text,'due',((coalesce(a.fee_attempted_at,now())) at time zone 'America/Sao_Paulo')::date);
end;$$;
create function public.receipt_fee_result(p_payment jsonb) returns void language plpgsql security definer set search_path='' as $$
declare a private.receipt_accounts;
begin
 select * into strict a from private.receipt_accounts where 'tamoon-opening:'||account_id::text=p_payment->>'externalReference' for update;
 if a.fee_attempted_at is null or a.fee_customer is distinct from p_payment->>'customer' or a.opening_fee is distinct from (p_payment->>'value')::numeric
 or coalesce(p_payment->>'id','')!~'^pay_[a-zA-Z0-9_]+$' or p_payment->>'billingType' is distinct from 'PIX'
 or (a.fee_payment is not null and a.fee_payment is distinct from p_payment->>'id')
 or coalesce(p_payment->>'invoiceUrl','')!~'^https://sandbox\.asaas\.com/i/[a-zA-Z0-9_-]+$' then raise exception 'RECEIPT_BILLING_MISMATCH';end if;
 update private.receipt_accounts set fee_payment=p_payment->>'id',fee_url=p_payment->>'invoiceUrl',fee_status=p_payment->>'status' where partner_id=a.partner_id;
end;$$;
revoke all on function public.receipt_fee_authorize(uuid) from public,anon;
grant execute on function public.receipt_fee_authorize(uuid) to authenticated;
revoke all on function public.receipt_fee_claim(uuid,uuid), public.receipt_fee_result(jsonb) from public,anon,authenticated;
grant execute on function public.receipt_fee_claim(uuid,uuid), public.receipt_fee_result(jsonb) to service_role;

create function public.book_cycle_with_receipt_mode(p_cycle uuid,p_total numeric,p_policy text,p_accepted boolean,p_expected text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; mode text;
begin
 result:=public.activate_monthly_cycle_reviewed(p_cycle,p_total,p_policy,p_accepted);
 select coalesce(receipt_mode,'legacy') into strict mode from public.reservations where id=(result->>'reservation_id')::uuid;
 if p_expected is distinct from mode then raise exception 'RECEIPT_MODE_CHANGED';end if;
 return result||jsonb_build_object('receipt_mode',mode);
end;$$;
revoke all on function public.book_cycle_with_receipt_mode(uuid,numeric,text,boolean,text) from public,anon;
grant execute on function public.book_cycle_with_receipt_mode(uuid,numeric,text,boolean,text) to authenticated;

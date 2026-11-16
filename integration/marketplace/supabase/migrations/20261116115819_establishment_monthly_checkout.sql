-- Subscription receivables remain separate from reservation commissions and GMV.
alter table private.establishment_invoices add column payment_method text check(payment_method in('pix','balance'));
create table private.establishment_payment_attempts (
 id uuid primary key default gen_random_uuid(), invoice_id uuid not null unique references private.establishment_invoices(id),
 actor_id uuid not null references public.profiles(id), state text not null default 'submitting' check(state in('submitting','processing','review','done','failed')),
 transaction_id text unique, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table private.establishment_payment_attempts enable row level security;
revoke all on private.establishment_payment_attempts from public,anon,authenticated;

create function public.establishment_finance_read(p_partner_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base jsonb; result jsonb;
begin
 -- Reuse the audited admin/partner/preview scope, without expanding it.
 base:=public.establishment_plans_read(p_partner_id);
 select jsonb_build_object('admin',base->'admin','today',base->'today','test_mode',base->'test_mode',
 'readonly',private.partner_readonly_active(),'venues',coalesce((select jsonb_agg(jsonb_build_object('id',v->>'id','name',v->>'name','partner',v->>'partner','partner_id',v->>'partner_id','has_plan',v->'plan'<>'null'::jsonb)) from jsonb_array_elements(base->'venues') v),'[]'),
 'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'venue_id',i.venue_id,'venue',v->>'name','partner',v->>'partner',
 'competence',i.competence,'due_on',i.due_on,'amount',i.amount,'status',i.status,'paid_at',i.paid_at,
 'environment',i.environment,'simulated',i.simulated,'provider_issued',i.provider_id is not null,
 'payment_method',coalesce(i.payment_method,case when i.provider_id is not null and i.status='paid' then 'pix' end),
 'attempt_state',a.state) order by i.competence desc,v->>'partner',v->>'name')
 from jsonb_array_elements(base->'venues') v join private.establishment_invoices i on i.venue_id=(v->>'id')::uuid
 left join private.establishment_payment_attempts a on a.invoice_id=i.id),'[]')) into result;
 return result;
end;$$;

create function public.establishment_payment_context(p_invoice_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare i private.establishment_invoices; partner uuid; base jsonb;
begin
 if private.partner_readonly_active() then raise exception 'PLAN_READ_ONLY';end if;
 if auth.uid() is null or not exists(select 1 from auth.sessions where id::text=auth.jwt()->>'session_id' and user_id=auth.uid()) then raise exception 'PLAN_SESSION_REQUIRED';end if;
 select * into i from private.establishment_invoices where id=p_invoice_id;
 if not found then raise exception 'PLAN_ACCESS_DENIED';end if;
 select partner_id into partner from public.venues where id=i.venue_id;
 base:=public.establishment_plans_read(partner);
 if not exists(select 1 from jsonb_array_elements(base->'venues') v where v->>'id'=i.venue_id::text) then raise exception 'PLAN_ACCESS_DENIED';end if;
 if (i.environment='sandbox') is distinct from (base->>'test_mode')::boolean then raise exception 'PLAN_ENVIRONMENT_MISMATCH';end if;
 return to_jsonb(i)-'last_error'||jsonb_build_object('reference','tamoon-plan:'||i.id,'partner_id',partner,
 'admin',base->'admin','test_mode',base->'test_mode','today',base->'today',
 'venue',(select name from public.venues where id=i.venue_id),
 'attempt',(select jsonb_build_object('id',id,'state',state,'transaction_id',transaction_id) from private.establishment_payment_attempts where invoice_id=i.id));
end;$$;

create function public.establishment_invoice_issue_claim(p_id uuid,p_environment text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i private.establishment_invoices; plan_row private.establishment_plans; today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 select * into i from private.establishment_invoices where id=p_id for update;
 if not found or p_environment is distinct from 'sandbox' or i.environment is distinct from p_environment or exists(select 1 from public.marketplace_settings where real_money_enabled) then raise exception 'PLAN_CHECKOUT_SANDBOX_ONLY';end if;
 if i.status<>'planned' or i.attempted_at is not null or i.simulated then return null;end if;
 select * into plan_row from private.establishment_plans where venue_id=i.venue_id;
 if plan_row.state<>'ready' or i.competence>date_trunc('month',today)::date or not(extract(year from i.competence)::int=any(plan_row.calendar_years)) then raise exception 'PLAN_ISSUANCE_NOT_AVAILABLE';end if;
 update private.establishment_invoices set status='issuing',attempted_at=now(),updated_at=now() where id=i.id;
 return (select jsonb_build_object('id',i.id,'reference','tamoon-plan:'||i.id,'amount',i.amount,'due_on',i.due_on,'competence',i.competence,
 'venue',v.name,'partner_id',p.id,'name',p.legal_name,'cpfCnpj',p.cnpj,'email',p.email,'environment',i.environment)
 from public.venues v join public.partners p on p.id=v.partner_id where v.id=i.venue_id);
end;$$;

create function public.establishment_balance_claim(p_invoice_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c jsonb; a private.establishment_payment_attempts;
begin
 perform 1 from private.establishment_invoices where id=p_invoice_id for update;
 c:=public.establishment_payment_context(p_invoice_id);
 if (c->>'admin')::boolean then raise exception 'PLAN_PARTNER_CONFIRMATION_REQUIRED';end if;
 if c->>'environment'<>'sandbox' or not(c->>'test_mode')::boolean then raise exception 'PLAN_CHECKOUT_SANDBOX_ONLY';end if;
 if c->>'status' not in('pending','overdue') or c->>'provider_id' is null or (c->>'simulated')::boolean then raise exception 'PLAN_NOT_PAYABLE';end if;
 select * into a from private.establishment_payment_attempts where invoice_id=p_invoice_id;
 if found then return jsonb_build_object('send',false,'id',a.id,'state',a.state);end if;
 insert into private.establishment_payment_attempts(invoice_id,actor_id) values(p_invoice_id,auth.uid()) returning * into a;
 insert into private.establishment_plan_audit(venue_id,actor_id,action,detail) values((c->>'venue_id')::uuid,auth.uid(),'balance_requested',jsonb_build_object('invoice',p_invoice_id,'attempt',a.id));
 return jsonb_build_object('send',true,'id',a.id,'state',a.state);
end;$$;

create function public.establishment_balance_result(p_attempt_id uuid,p_transaction_id text,p_state text) returns void
language plpgsql security definer set search_path='' as $$
declare a private.establishment_payment_attempts;
begin
 select * into a from private.establishment_payment_attempts where id=p_attempt_id for update;
 if not found or p_state is null or p_state not in('processing','review','done','failed') or (a.transaction_id is not null and a.transaction_id is distinct from p_transaction_id)
 or (p_state in('processing','done','failed') and nullif(p_transaction_id,'') is null) then raise exception 'PLAN_ATTEMPT_MISMATCH';end if;
 -- A payout transaction is evidence of submission, never proof of invoice receipt.
 update private.establishment_payment_attempts set transaction_id=coalesce(transaction_id,p_transaction_id),state=p_state,updated_at=now() where id=a.id;
 update private.establishment_invoices set payment_method='balance' where id=a.invoice_id;
 insert into private.establishment_plan_audit(venue_id,actor_id,action,detail)
 select venue_id,a.actor_id,'balance_reconciled',jsonb_build_object('invoice',id,'attempt',a.id,'state',p_state) from private.establishment_invoices where id=a.invoice_id;
end;$$;

create function public.establishment_invoice_simulate(p_invoice_id uuid,p_method text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c jsonb;
begin
 perform 1 from private.establishment_invoices where id=p_invoice_id for update;
 c:=public.establishment_payment_context(p_invoice_id);
 if p_method not in('pix','balance') or p_method is null then raise exception 'PLAN_INVALID_METHOD';end if;
 if not(c->>'test_mode')::boolean or c->>'environment'<>'sandbox' then raise exception 'PLAN_SIMULATION_DISABLED';end if;
 if c->>'status'='paid' and (c->>'simulated')::boolean then return jsonb_build_object('ok',true);end if;
 if c->>'status'<>'planned' or c->>'provider_id' is not null or c->>'attempted_at' is not null or c->'attempt'<>'null'::jsonb then raise exception 'PLAN_NOT_SIMULATABLE';end if;
 update private.establishment_invoices set status='paid',simulated=true,payment_method=p_method,paid_at=now(),updated_at=now() where id=p_invoice_id;
 insert into private.establishment_plan_audit(venue_id,actor_id,action,detail) values((c->>'venue_id')::uuid,auth.uid(),'monthly_payment_simulated',jsonb_build_object('invoice',p_invoice_id,'method',p_method));
 return jsonb_build_object('ok',true);
end;$$;
revoke all on function public.establishment_finance_read(uuid),public.establishment_payment_context(uuid),public.establishment_balance_claim(uuid),public.establishment_invoice_simulate(uuid,text) from public,anon;
grant execute on function public.establishment_finance_read(uuid),public.establishment_payment_context(uuid),public.establishment_balance_claim(uuid),public.establishment_invoice_simulate(uuid,text) to authenticated;
revoke all on function public.establishment_invoice_issue_claim(uuid,text),public.establishment_balance_result(uuid,text,text) from public,anon,authenticated;
grant execute on function public.establishment_invoice_issue_claim(uuid,text),public.establishment_balance_result(uuid,text,text) to service_role;

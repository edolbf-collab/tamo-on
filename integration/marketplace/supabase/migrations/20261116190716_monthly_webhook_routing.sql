-- Service-only routing separates platform monthly receivables from reservations.
create function public.establishment_webhook_context(p_payment jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare i private.establishment_invoices; reference text:=p_payment->>'externalReference'; invoice_id uuid;
begin
 if reference like 'tamoon-plan:%' then
  if reference !~ '^tamoon-plan:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'PLAN_PAYMENT_MISMATCH';end if;
  invoice_id:=substring(reference from 13)::uuid;
  select * into i from private.establishment_invoices where id=invoice_id;
  if not found then raise exception 'PLAN_INVOICE_MISMATCH';end if;
 else
  select * into i from private.establishment_invoices where provider_id=p_payment->>'id';
  if not found then return null;end if;
 end if;
 if i.environment<>'sandbox' or i.simulated or exists(select 1 from public.marketplace_settings where real_money_enabled) then raise exception 'PLAN_CHECKOUT_SANDBOX_ONLY';end if;
 if i.provider_id is null and (i.attempted_at is null or i.status not in('issuing','review')) then raise exception 'PLAN_INVOICE_MISMATCH';end if;
 if reference is distinct from 'tamoon-plan:'||i.id or coalesce(p_payment->>'id','') !~ '^pay_[A-Za-z0-9_-]+$'
 or (i.provider_id is not null and i.provider_id is distinct from p_payment->>'id')
 or nullif(p_payment->>'customer','') is null or (i.provider_customer is not null and i.provider_customer is distinct from p_payment->>'customer')
 or (p_payment->>'value')::numeric is distinct from i.amount or (p_payment->>'dueDate')::date is distinct from i.due_on
 or p_payment->>'billingType' is distinct from 'PIX' then raise exception 'PLAN_PAYMENT_MISMATCH';end if;
 return jsonb_build_object('id',i.id,'environment',i.environment,'reference','tamoon-plan:'||i.id,'amount',i.amount,'due_on',i.due_on,
 'provider_id',coalesce(i.provider_id,p_payment->>'id'),'provider_customer',coalesce(i.provider_customer,p_payment->>'customer'));
end;$$;
revoke all on function public.establishment_webhook_context(jsonb) from public,anon,authenticated;
grant execute on function public.establishment_webhook_context(jsonb) to service_role;

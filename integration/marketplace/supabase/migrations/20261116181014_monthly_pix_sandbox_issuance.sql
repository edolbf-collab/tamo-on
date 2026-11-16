-- Allow the initial Sandbox Pix to be prepared before the agreed start date.
-- Recurring invoices remain limited to the current/past month.
create or replace function public.establishment_invoice_issue_claim(p_id uuid,p_environment text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i private.establishment_invoices; plan_row private.establishment_plans; today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 select * into i from private.establishment_invoices where id=p_id for update;
 if not found or p_environment is distinct from 'sandbox' or i.environment is distinct from p_environment or exists(select 1 from public.marketplace_settings where real_money_enabled) then raise exception 'PLAN_CHECKOUT_SANDBOX_ONLY';end if;
 if i.status<>'planned' or i.attempted_at is not null or i.simulated then return null;end if;
 select * into plan_row from private.establishment_plans where venue_id=i.venue_id;
 if plan_row.state<>'ready' or (i.competence>date_trunc('month',today)::date and i.competence<>plan_row.starts_on) or not(extract(year from i.competence)::int=any(plan_row.calendar_years)) then raise exception 'PLAN_ISSUANCE_NOT_AVAILABLE';end if;
 update private.establishment_invoices set status='issuing',attempted_at=now(),updated_at=now() where id=i.id;
 return (select jsonb_build_object('id',i.id,'reference','tamoon-plan:'||i.id,'amount',i.amount,'due_on',i.due_on,'competence',i.competence,
 'venue',v.name,'partner_id',p.id,'name',p.legal_name,'cpfCnpj',p.cnpj,'email',p.email,'environment',i.environment)
 from public.venues v join public.partners p on p.id=v.partner_id where v.id=i.venue_id);
end;$$;

revoke all on function public.establishment_invoice_issue_claim(uuid,text) from public,anon,authenticated;
grant execute on function public.establishment_invoice_issue_claim(uuid,text) to service_role;

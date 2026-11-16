-- Administrators prepare and monitor receivables; only the partner tests payment.
-- Keep the old endpoint as an explicit refusal for already-open older clients.
create or replace function public.establishment_plan_simulate(p_venue_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform private.plan_assert_admin();
 raise exception 'PLAN_PARTNER_CONFIRMATION_REQUIRED';
end;$$;
revoke all on function public.establishment_plan_simulate(uuid) from public,anon;
grant execute on function public.establishment_plan_simulate(uuid) to authenticated;

create or replace function public.establishment_invoice_simulate(p_invoice_id uuid,p_method text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c jsonb;
begin
 perform 1 from private.establishment_invoices where id=p_invoice_id for update;
 c:=public.establishment_payment_context(p_invoice_id);
 if (c->>'admin')::boolean then raise exception 'PLAN_PARTNER_CONFIRMATION_REQUIRED';end if;
 if p_method not in('pix','balance') or p_method is null then raise exception 'PLAN_INVALID_METHOD';end if;
 if not(c->>'test_mode')::boolean or c->>'environment'<>'sandbox' then raise exception 'PLAN_SIMULATION_DISABLED';end if;
 if c->>'status'='paid' and (c->>'simulated')::boolean then return jsonb_build_object('ok',true);end if;
 if c->>'status'<>'planned' or c->>'provider_id' is not null or c->>'attempted_at' is not null or c->'attempt'<>'null'::jsonb then raise exception 'PLAN_NOT_SIMULATABLE';end if;
 update private.establishment_invoices set status='paid',simulated=true,payment_method=p_method,paid_at=now(),updated_at=now() where id=p_invoice_id;
 insert into private.establishment_plan_audit(venue_id,actor_id,action,detail) values((c->>'venue_id')::uuid,auth.uid(),'monthly_payment_simulated',jsonb_build_object('invoice',p_invoice_id,'method',p_method));
 return jsonb_build_object('ok',true);
end;$$;
revoke all on function public.establishment_invoice_simulate(uuid,text) from public,anon;
grant execute on function public.establishment_invoice_simulate(uuid,text) to authenticated;

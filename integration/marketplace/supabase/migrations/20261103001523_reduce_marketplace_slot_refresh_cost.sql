-- Short-circuit empty slots before evaluating the same visibility predicates.
CREATE OR REPLACE FUNCTION private.schedule_slot_is_reserved(p_schedule_slot_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
  select case when exists (
        select 1 from public.reservation_occurrences ro
        join public.reservations r on r.id=ro.reservation_id
        where ro.schedule_slot_id=p_schedule_slot_id and ro.status='active'
          and r.status in ('pending_payment','confirmed')
      ) then exists (
    select 1 from public.schedule_slots ss
    join public.venue_spaces s on s.id=ss.venue_space_id
    join public.venues v on v.id=s.venue_id
    join public.partners p on p.id=v.partner_id
    where ss.id=p_schedule_slot_id
      and exists(select 1 from public.profiles where id=auth.uid() and status='active')
      and (private.is_admin() or private.is_partner_member(v.partner_id)
        or (ss.starts_at::date>=current_date and s.active and v.published and p.status='approved'))
  ) else false end;
$function$;

CREATE OR REPLACE FUNCTION private.monthly_slot_context(p_schedule_slot_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_row record;
  v_authorized boolean;
begin
  -- Most slots do not have a monthly hold. Use the existing slot index before joining directories.
  if not exists(select 1 from public.monthly_pre_reservation_slots
    where schedule_slot_id=p_schedule_slot_id and status in ('pre_reserved','claimed')) then
    return jsonb_build_object('protected',false);
  end if;
  select mprs.status,mc.id monthly_cycle_id,mc.status cycle_status,mc.service_month,
    mc.payment_available_at,mc.initial_due_at,mc.balance_due_at,mc.monthly_total,
    mc.initial_required,mc.balance_required,mc.reservation_id,
    ml.id monthly_link_id,ml.group_id,ml.partner_id,ml.customer_profile_id,ml.accepted_by,coalesce(g.name,customer.display_name||' · Reserva pessoal','Reserva pessoal') group_name
  into v_row
  from public.monthly_pre_reservation_slots mprs
  join public.monthly_cycles mc on mc.id=mprs.monthly_cycle_id
  join public.monthly_customer_links ml on ml.id=mc.monthly_link_id
  left join public.marketplace_groups g on g.id=ml.group_id
  left join public.profiles customer on customer.id=ml.customer_profile_id
  where mprs.schedule_slot_id=p_schedule_slot_id
    and mprs.status in ('pre_reserved','claimed')
  order by mprs.created_at desc
  limit 1;

  if not found then return jsonb_build_object('protected',false); end if;
  v_authorized := private.is_admin() or private.is_partner_member(v_row.partner_id) or private.is_group_member(v_row.group_id) or private.owns_personal_monthly_link(v_row.monthly_link_id);
  if not v_authorized then
    return jsonb_build_object('protected',true,'authorized',false,'marketplace_status','unavailable');
  end if;
  return jsonb_build_object(
    'protected',true,'authorized',true,'marketplace_status','monthly_pre_reserved',
    'owned_by_current_user',case when v_row.reservation_id is not null then
      exists(select 1 from public.reservations r where r.id=v_row.reservation_id and r.user_id=auth.uid())
      else coalesce(v_row.customer_profile_id,v_row.accepted_by)=auth.uid() end,
    'monthly_cycle_id',v_row.monthly_cycle_id,'monthly_cycle_status',v_row.cycle_status,
    'monthly_link_id',v_row.monthly_link_id,'monthly_group_id',v_row.group_id,
    'monthly_group_name',v_row.group_name,'monthly_service_month',v_row.service_month,
    'monthly_payment_available_at',v_row.payment_available_at,'monthly_initial_due_at',v_row.initial_due_at,
    'monthly_balance_due_at',v_row.balance_due_at,'monthly_total',v_row.monthly_total,
    'monthly_initial_required',v_row.initial_required,'monthly_balance_required',v_row.balance_required,
    'monthly_reservation_id',v_row.reservation_id,'pre_reservation_status',v_row.status
  );
end;
$function$;

-- Evaluate the reusable monthly context once per slot. Preserve invoker RLS.
CREATE OR REPLACE VIEW public.marketplace_slot_availability WITH (security_invoker=true) AS
 SELECT ss.id AS schedule_slot_id,
    ss.venue_space_id,
    s.venue_id,
    v.partner_id,
    ss.starts_at,
    ss.ends_at,
    ss.price,
    ss.monthly_eligible,
    ss.monthly_package_price,
    ss.status AS operational_status,
        CASE
            WHEN ss.status = 'blocked'::schedule_slot_status THEN 'blocked'::text
            WHEN ar.id IS NOT NULL OR private.schedule_slot_is_reserved(ss.id) THEN 'reserved'::text
            WHEN COALESCE((mc.context ->> 'protected'::text)::boolean, false) THEN COALESCE(mc.context ->> 'marketplace_status'::text, 'unavailable'::text)
            ELSE 'available'::text
        END AS marketplace_status,
    ar.id AS active_reservation_id,
    COALESCE(mc.context, jsonb_build_object('protected', false)) AS monthly_context
   FROM schedule_slots ss
     JOIN venue_spaces s ON s.id = ss.venue_space_id
     JOIN venues v ON v.id = s.venue_id
     LEFT JOIN LATERAL ( SELECT r.id
           FROM reservation_occurrences ro
             JOIN reservations r ON r.id = ro.reservation_id
          WHERE ro.schedule_slot_id = ss.id AND ro.status = 'active'::reservation_occurrence_status AND (r.status = ANY (ARRAY['pending_payment'::reservation_status, 'confirmed'::reservation_status]))
         LIMIT 1) ar ON true
     LEFT JOIN LATERAL ( SELECT private.monthly_slot_context(ss.id) AS context OFFSET 0) mc ON true;

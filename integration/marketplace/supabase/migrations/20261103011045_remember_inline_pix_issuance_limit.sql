-- Keep the last definitive issuer-limit refusal available when the payer reopens a Pix.
alter table private.asaas_checkout_sessions add column retry_issuance_limited boolean not null default false;

CREATE OR REPLACE FUNCTION public.finish_asaas_inline_pix_attempt(p_session_key text, p_claim_token uuid, p_outcome text, p_provider_status integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cs private.asaas_checkout_sessions%rowtype; a private.asaas_checkout_attempts%rowtype;
 v_issuance_limited boolean := p_outcome = 'rejected_issuance_limit';
begin
 select * into cs from private.asaas_checkout_sessions where session_key=p_session_key;
 perform 1 from public.reservations where id=cs.reservation_id for update;
 select * into cs from private.asaas_checkout_sessions where session_key=p_session_key for update;
 if cs.claim_token is distinct from p_claim_token or not exists(select 1 from private.asaas_inline_pix where session_key=p_session_key) then raise exception 'CHECKOUT_ATTEMPT_STALE';end if;
 select * into a from private.asaas_checkout_attempts where session_key=p_session_key and claim_token=p_claim_token for update;
 if a.session_key is null or a.outcome is not null then return '{}'::jsonb;end if;
 if v_issuance_limited then
   if p_provider_status is distinct from 400 and p_provider_status is distinct from 422 then raise exception 'CHECKOUT_OUTCOME_INVALID';end if;
   p_outcome := 'rejected';
 end if;
 if p_outcome is null or p_outcome not in ('unknown','rejected','not_sent')
    or (p_outcome='not_sent' and a.sent_at is not null)
    or (p_outcome='rejected' and (a.sent_at is null or p_provider_status is null or p_provider_status not in (400,401,403,404,422))) then raise exception 'CHECKOUT_OUTCOME_INVALID';end if;
 update private.asaas_checkout_attempts set outcome=p_outcome,finished_at=clock_timestamp(),provider_status=p_provider_status
   where session_key=p_session_key and claim_token=p_claim_token;
 update private.asaas_checkout_sessions set status=case when p_outcome='unknown' then 'unknown' else 'failed' end,
   retry_issuance_limited=v_issuance_limited,
   retry_outcome=case when p_outcome<>'unknown' then p_outcome end,
   retry_token=case when p_outcome<>'unknown' then gen_random_uuid() end,updated_at=clock_timestamp()
   where session_key=p_session_key and status in ('creating','unknown') returning * into cs;
 return jsonb_build_object('retryAllowed',cs.retry_token is not null,'retryToken',cs.retry_token);
end;$function$;

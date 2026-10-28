-- Server delivery for the existing owner/Teste FC pilot only.
-- The shared signing key is provisioned in Vault separately, never in source control.
create table marketplace_pilot.deliveries (
 nonce uuid primary key, received_at timestamptz not null default now(), result jsonb not null
);
alter table marketplace_pilot.deliveries enable row level security;
revoke all on marketplace_pilot.deliveries from public,anon,authenticated;

create function marketplace_pilot.apply_items(p_actor uuid,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c marketplace_pilot.config%rowtype; e jsonb; old marketplace_pilot.events%rowtype;
  v_id uuid; v_match uuid; v_group uuid; v_version timestamptz; v_start timestamptz; v_end timestamptz;
  v_state text; v_managed boolean; n integer:=0; history integer:=0;
begin
  select * into strict c from marketplace_pilot.config where singleton and enabled and user_id=p_actor for update;
  if not exists(select 1 from public.group_members where user_id=p_actor and group_id=c.group_id and role::text in ('owner','admin','organizer')) then raise exception 'PILOT_GROUP_DENIED'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>200 then raise exception 'INVALID_BATCH'; end if;
  for e in select value from jsonb_array_elements(p_items) loop
    v_group:=(e->>'group_id')::uuid;
    if v_group is distinct from c.group_id then raise sqlstate 'PT403' using message='PILOT_GROUP_DENIED'; end if;
    v_id:=(e->>'occurrence_id')::uuid;v_version:=(e->>'source_updated_at')::timestamptz;
    v_start:=(e->>'starts_at')::timestamptz;v_end:=(e->>'ends_at')::timestamptz;
    v_state:=e->>'state';v_managed:=e->>'mode'='new';
    if v_id is null or v_version is null or v_start is null or v_end is null or v_end-v_start<interval '15 minutes' or v_end-v_start>interval '8 hours'
       or v_state not in ('standby_payment','published','cancelled') or e->>'mode' not in ('new','existing') then raise exception 'INVALID_EVENT'; end if;
    select * into old from marketplace_pilot.events where occurrence_id=v_id for update;
    if found and (old.group_id<>v_group or old.reservation_id<>(e->>'reservation_id')::uuid or old.managed<>v_managed) then raise exception 'SOURCE_IDENTITY_CONFLICT'; end if;
    if found and old.source_updated_at>=v_version then continue; end if;
    v_match:=old.match_id;
    if not v_managed then
      v_match:=nullif(e->>'existing_match_id','')::uuid;
      if not exists(select 1 from public.matches where id=v_match and group_id=c.group_id) then raise exception 'EXISTING_MATCH_DENIED'; end if;
      -- A reservation never overwrites or cancels a game created manually in Community.
    elsif v_match is not null then
      if exists(select 1 from public.matches where id=v_match and starts_at<=now()) then history:=history+1;
      else
        update public.matches set status=case when v_state='published' then 'scheduled' else 'cancelled' end,
          starts_at=v_start,duration_minutes=extract(epoch from(v_end-v_start))::integer/60,location=left(e->>'location',200)
          where id=v_match and group_id=c.group_id;
      end if;
    elsif v_state='published' and v_start>now() then
      insert into public.matches(group_id,title,starts_at,duration_minutes,location,status,notes,created_by)
      values(c.group_id,'[TESTE Marketplace] '||left(coalesce(e->>'title',e->>'code','Reserva'),100),v_start,
        extract(epoch from(v_end-v_start))::integer/60,coalesce(nullif(e->>'location',''),'Local de teste'),'scheduled',
        'Reserva de sandbox '||coalesce(e->>'code','')||'. Pagamento simulado; sem lançamento no caixa.',c.user_id)
      returning id into v_match;
    end if;
    insert into marketplace_pilot.events(occurrence_id,reservation_id,event_id,group_id,match_id,managed,state,source_updated_at,payload)
    values(v_id,(e->>'reservation_id')::uuid,(e->>'event_id')::uuid,c.group_id,v_match,v_managed,v_state,v_version,e)
    on conflict(occurrence_id) do update set match_id=excluded.match_id,state=excluded.state,source_updated_at=excluded.source_updated_at,payload=excluded.payload,synced_at=now();
    n:=n+1;
  end loop;
  return jsonb_build_object('updated',n,'history_preserved',history,'group_id',c.group_id);
end $$;

revoke all on function marketplace_pilot.apply_items(uuid,jsonb) from public,anon,authenticated;
create or replace function public.community_marketplace_pilot_apply(p_actor uuid,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise sqlstate 'PT403' using message='SERVICE_REQUIRED'; end if;
 return marketplace_pilot.apply_items(p_actor,p_items);
end $$;
revoke all on function public.community_marketplace_pilot_apply(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.community_marketplace_pilot_apply(uuid,jsonb) to service_role;

create function public.community_marketplace_pilot_receive(p_payload text,p_signature text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare secret text; expected bytea; envelope jsonb; c marketplace_pilot.config%rowtype;
 delivery_id uuid; sent_at timestamptz; result jsonb;
begin
 if p_payload is null or octet_length(p_payload)>1048576 or p_signature is null or p_signature !~ '^[0-9a-f]{64}$' then
  raise sqlstate 'PT403' using message='DELIVERY_DENIED';
 end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='tamoon_community_sync_hmac_v1';
 if secret is null then raise sqlstate 'PT503' using message='DELIVERY_UNAVAILABLE'; end if;
 expected:=extensions.hmac(convert_to(p_payload,'UTF8'),decode(secret,'hex'),'sha256');
 -- Hash both MACs before comparison, so a matching prefix reveals no MAC bytes.
 if extensions.digest(expected,'sha256')<>extensions.digest(decode(p_signature,'hex'),'sha256') then
  raise sqlstate 'PT403' using message='DELIVERY_DENIED';
 end if;
 envelope:=p_payload::jsonb;
 delivery_id:=(envelope->>'nonce')::uuid;sent_at:=(envelope->>'sent_at')::timestamptz;
 if envelope->>'version' is distinct from '1' or delivery_id is null or sent_at is null
   or sent_at<clock_timestamp()-interval '5 minutes' or sent_at>clock_timestamp()+interval '1 minute' then
  raise sqlstate 'PT403' using message='DELIVERY_EXPIRED';
 end if;
 select * into strict c from marketplace_pilot.config where singleton and enabled for update;
 if (envelope->>'actor')::uuid is distinct from c.user_id
   or (envelope->>'marketplace_user_id')::uuid is distinct from c.marketplace_user_id
   or (envelope->>'group_id')::uuid is distinct from c.group_id then
  raise sqlstate 'PT403' using message='PILOT_GROUP_DENIED';
 end if;
 select d.result into result from marketplace_pilot.deliveries d where nonce=delivery_id;
 if found then return result; end if;
 if jsonb_typeof(envelope->'items') is distinct from 'array' then raise exception 'INVALID_BATCH'; end if;
 result:=marketplace_pilot.apply_items(c.user_id,envelope->'items')||jsonb_build_object('ok',true,'nonce',delivery_id);
 insert into marketplace_pilot.deliveries(nonce,result) values(delivery_id,result);
 delete from marketplace_pilot.deliveries where received_at<now()-interval '7 days';
 return result;
end $$;
revoke all on function public.community_marketplace_pilot_receive(text,text) from public;
-- A public API key identifies the endpoint; the HMAC authenticates the sending server.
grant execute on function public.community_marketplace_pilot_receive(text,text) to anon,authenticated,service_role;

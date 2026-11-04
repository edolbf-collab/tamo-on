-- Marketplace staging only. The group bridge remains owner-only in the existing config.
create table private.marketplace_pilot_accounts (
 marketplace_user_id uuid primary key references auth.users(id),
 email text not null unique check(email=lower(email)),
 community_user_id uuid unique,
 enabled boolean not null default true,
 last_exchange_at timestamptz,
 created_at timestamptz not null default now()
);
alter table private.marketplace_pilot_accounts enable row level security;
revoke all on private.marketplace_pilot_accounts from public,anon,authenticated;
insert into private.marketplace_pilot_accounts(marketplace_user_id,email,community_user_id,last_exchange_at)
select c.marketplace_user_id,lower(u.email),c.community_user_id,c.last_exchange_at
from private.community_marketplace_pilot c join auth.users u on u.id=c.marketplace_user_id;

create or replace function private.marketplace_pilot_allowed() returns boolean
language sql stable security definer set search_path='' as $$
 select exists (
  select 1 from private.marketplace_pilot_accounts a
  join public.profiles p on p.id=a.marketplace_user_id and p.status='active'
  join auth.users u on u.id=p.id and lower(u.email)=a.email and u.email_confirmed_at is not null
  join auth.sessions s on s.user_id=u.id
  where a.enabled and a.marketplace_user_id=auth.uid()
    and exists(select 1 from private.community_marketplace_pilot c where c.singleton and c.enabled)
    and s.id::text=auth.jwt()->>'session_id' and (s.not_after is null or s.not_after>now())
    and (u.banned_until is null or u.banned_until<now())
 );
$$;
revoke all on function private.marketplace_pilot_allowed() from public;
grant execute on function private.marketplace_pilot_allowed() to anon,authenticated,service_role;

-- Only the trusted Edge Function may supply an email, after getUser verifies Google identity.
-- Defaults preserve calls from the previous Edge version for an already-bound account.
drop function public.community_marketplace_pilot_identity(uuid,boolean);
create function public.community_marketplace_pilot_identity(
 p_community_id uuid,p_exchange boolean default false,p_verified_email text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.marketplace_pilot_accounts%rowtype; c private.community_marketplace_pilot%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise sqlstate 'PT403' using message='SERVICE_REQUIRED'; end if;
 select * into c from private.community_marketplace_pilot where singleton and enabled;
 if not found or p_community_id is null then raise sqlstate 'PT403' using message='MARKETPLACE_PILOT_RESTRICTED'; end if;
 select * into a from private.marketplace_pilot_accounts
 where enabled and (community_user_id=p_community_id or
  (community_user_id is null and p_verified_email is not null and email=lower(p_verified_email))) for update;
 if not found or (p_verified_email is not null and a.email<>lower(p_verified_email)) then
  raise sqlstate 'PT403' using message='MARKETPLACE_PILOT_RESTRICTED';
 end if;
 if not exists(select 1 from auth.users u join public.profiles p on p.id=u.id and p.status='active'
  where u.id=a.marketplace_user_id and lower(u.email)=a.email and u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until<now())) then
  raise sqlstate 'PT403' using message='MARKETPLACE_PILOT_RESTRICTED';
 end if;
 if p_exchange and a.last_exchange_at>now()-interval '3 seconds' then raise sqlstate 'PT429' using message='RETRY_LATER'; end if;
 update private.marketplace_pilot_accounts set community_user_id=p_community_id,
  last_exchange_at=case when p_exchange then clock_timestamp() else last_exchange_at end
 where marketplace_user_id=a.marketplace_user_id;
 return jsonb_build_object('marketplace_id',a.marketplace_user_id,'email',a.email,
  'can_sync_community',a.marketplace_user_id=c.marketplace_user_id and p_community_id=c.community_user_id);
end $$;
revoke all on function public.community_marketplace_pilot_identity(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.community_marketplace_pilot_identity(uuid,boolean,text) to service_role;
notify pgrst,'reload schema';

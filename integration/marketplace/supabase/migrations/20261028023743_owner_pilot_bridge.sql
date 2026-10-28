-- Apply ONLY to Tamo On Marketplace Staging (owybghlwcohfyapvsfdo).
-- Community production has no database migration in build 166.
create table private.community_marketplace_pilot (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  community_user_id uuid not null unique,
  marketplace_user_id uuid not null unique references auth.users(id),
  last_exchange_at timestamptz,
  created_at timestamptz not null default now()
);
alter table private.community_marketplace_pilot enable row level security;
revoke all on private.community_marketplace_pilot from public, anon, authenticated;

-- Denies by default, including before the verified account mapping is provisioned.
create function private.marketplace_pilot_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.community_marketplace_pilot c
    join public.profiles p on p.id=c.marketplace_user_id and p.status='active'
    join public.platform_admins a on a.profile_id=p.id
    join auth.users u on u.id=p.id
    join auth.sessions s on s.user_id=u.id
    where c.enabled and c.marketplace_user_id=auth.uid()
      and s.id::text=auth.jwt()->>'session_id'
      and (s.not_after is null or s.not_after>now())
      and (u.banned_until is null or u.banned_until<now())
  );
$$;
revoke all on function private.marketplace_pilot_allowed() from public;
grant execute on function private.marketplace_pilot_allowed() to anon, authenticated, service_role;

create function public.marketplace_pilot_check_request() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.role()='service_role' then return; end if;
  if not private.marketplace_pilot_allowed() then
    raise sqlstate 'PT403' using message='MARKETPLACE_PILOT_RESTRICTED';
  end if;
end;
$$;
revoke all on function public.marketplace_pilot_check_request() from public;
grant execute on function public.marketplace_pilot_check_request() to anon, authenticated, service_role;

-- Restrictive policies compose with C39 policies rather than replacing them.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='public' loop
    execute format('create policy marketplace_owner_pilot on public.%I as restrictive for all to anon, authenticated using ((select private.marketplace_pilot_allowed())) with check ((select private.marketplace_pilot_allowed()))',t.tablename);
  end loop;
end $$;
create policy marketplace_owner_pilot on storage.objects as restrictive
for all to anon, authenticated
using ((select private.marketplace_pilot_allowed()))
with check ((select private.marketplace_pilot_allowed()));
update storage.buckets set public=false where id='marketplace-venue-photos';

create function public.community_marketplace_pilot_identity(p_community_id uuid, p_exchange boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c private.community_marketplace_pilot%rowtype; v_email text;
begin
  if auth.role() is distinct from 'service_role' then raise sqlstate 'PT403' using message='SERVICE_REQUIRED'; end if;
  select * into c from private.community_marketplace_pilot where singleton for update;
  if not found or not c.enabled or c.community_user_id<>p_community_id then
    raise sqlstate 'PT403' using message='MARKETPLACE_PILOT_RESTRICTED';
  end if;
  select u.email into v_email from auth.users u
    join public.profiles p on p.id=u.id and p.status='active'
    join public.platform_admins a on a.profile_id=u.id
    where u.id=c.marketplace_user_id and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<now());
  if v_email is null then raise sqlstate 'PT403' using message='MARKETPLACE_PILOT_RESTRICTED'; end if;
  if p_exchange then
    if c.last_exchange_at>now()-interval '3 seconds' then raise sqlstate 'PT429' using message='RETRY_LATER'; end if;
    update private.community_marketplace_pilot set last_exchange_at=clock_timestamp() where singleton;
  end if;
  return jsonb_build_object('marketplace_id',c.marketplace_user_id,'email',v_email);
end;
$$;
revoke all on function public.community_marketplace_pilot_identity(uuid,boolean) from public, anon, authenticated;
grant execute on function public.community_marketplace_pilot_identity(uuid,boolean) to service_role;

create or replace function public.assert_marketplace_writable() returns boolean
language plpgsql security definer set search_path = public, private, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not private.marketplace_pilot_allowed() then raise sqlstate 'PT403' using message='MARKETPLACE_PILOT_RESTRICTED'; end if;
  if private.partner_readonly_active() then raise exception 'PARTNER_PREVIEW_READ_ONLY'; end if;
  if exists(select 1 from public.profiles where id=auth.uid() and status='blocked') then raise exception 'MARKETPLACE_ACCOUNT_BLOCKED'; end if;
  return true;
end;
$$;

create function private.enforce_marketplace_pilot_simulation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.real_money_enabled or new.notification_emails then
    raise exception 'PILOT_SIMULATION_ONLY';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_marketplace_pilot_simulation() from public, anon, authenticated;
update public.marketplace_settings set real_money_enabled=false, notification_emails=false where id;
create trigger enforce_marketplace_pilot_simulation before insert or update on public.marketplace_settings
for each row execute function private.enforce_marketplace_pilot_simulation();

alter role authenticator set pgrst.db_pre_request = 'public.marketplace_pilot_check_request';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';

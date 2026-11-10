-- Separate native device registrations; existing Web Push registrations remain unchanged.
create schema if not exists tamoon_push;
revoke all on schema tamoon_push from public, anon;
grant usage on schema tamoon_push to authenticated, service_role;

create table public.native_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id uuid not null unique,
  token text not null check (token ~ '^[a-f0-9]+$' and char_length(token) between 64 and 512),
  environment text not null check (environment in ('production', 'sandbox')),
  endpoint text generated always as ('apns://' || environment || '/' || token) stored,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_failure_reason text,
  last_failure_status integer,
  consecutive_failures integer not null default 0,
  unique (environment, token)
);
create index native_push_user_enabled on public.native_push_subscriptions(user_id) where enabled;
alter table public.native_push_subscriptions enable row level security;
revoke all on public.native_push_subscriptions from public, anon, authenticated;
grant select on public.native_push_subscriptions to authenticated;
grant all on public.native_push_subscriptions to service_role;
create policy native_push_own_read on public.native_push_subscriptions for select to authenticated using (user_id = (select auth.uid()));

create function tamoon_push.save_subscription(p_token text, p_environment text, p_installation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_id uuid;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  perform tamoon_legal.require_access();
  if not public.has_beta_access() then raise exception 'ACCESS_DENIED'; end if;
  if p_token is null or (p_token !~ '^[a-f0-9]+$' or char_length(p_token) not between 64 and 512) or p_environment is null
     or p_environment not in ('production', 'sandbox') or p_installation_id is null then
    raise exception 'INVALID_DEVICE_REGISTRATION';
  end if;
  -- Serialize rotation, logout and account changes for this installation.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_installation_id::text, 0));
  delete from public.native_push_subscriptions where installation_id = p_installation_id
    and (token <> p_token or environment <> p_environment);
  insert into public.native_push_subscriptions(user_id, installation_id, token, environment)
  values(v_user, p_installation_id, p_token, p_environment)
  on conflict(environment, token) do update set user_id = excluded.user_id,
    installation_id = excluded.installation_id, enabled = true, updated_at = now(),
    consecutive_failures = 0, last_failure_reason = null, last_failure_status = null
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function tamoon_push.save_subscription(text,text,uuid) from public, anon;
grant execute on function tamoon_push.save_subscription(text,text,uuid) to authenticated;
create function public.save_native_push_subscription(p_token text, p_environment text, p_installation_id uuid)
returns uuid language sql security invoker set search_path = '' as $$
  select tamoon_push.save_subscription(p_token, p_environment, p_installation_id);
$$;
revoke all on function public.save_native_push_subscription(text,text,uuid) from public, anon;
grant execute on function public.save_native_push_subscription(text,text,uuid) to authenticated;

create function tamoon_push.remove_subscription(p_installation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_installation_id::text, 0));
  delete from public.native_push_subscriptions where user_id = auth.uid() and installation_id = p_installation_id;
end;
$$;
revoke all on function tamoon_push.remove_subscription(uuid) from public, anon;
grant execute on function tamoon_push.remove_subscription(uuid) to authenticated;
create function public.remove_native_push_subscription(p_installation_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select tamoon_push.remove_subscription(p_installation_id);
$$;
revoke all on function public.remove_native_push_subscription(uuid) from public, anon;
grant execute on function public.remove_native_push_subscription(uuid) to authenticated;

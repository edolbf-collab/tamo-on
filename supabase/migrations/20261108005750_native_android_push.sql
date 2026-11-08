-- Android FCM is additive: existing APNs and Web Push registrations are unchanged.
create table public.android_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id uuid not null unique,
  token text not null unique check (token ~ '^[A-Za-z0-9_:-]+$' and char_length(token) between 20 and 2048),
  endpoint text generated always as ('fcm://' || token) stored,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_failure_reason text,
  last_failure_status integer,
  consecutive_failures integer not null default 0
);
create index android_push_user_enabled on public.android_push_subscriptions(user_id) where enabled;
alter table public.android_push_subscriptions enable row level security;
revoke all on public.android_push_subscriptions from public, anon, authenticated;
grant select on public.android_push_subscriptions to authenticated;
grant all on public.android_push_subscriptions to service_role;
create policy android_push_own_read on public.android_push_subscriptions for select to authenticated using (user_id = (select auth.uid()));

create function tamoon_push.save_android_subscription(p_token text, p_installation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_id uuid;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  perform tamoon_legal.require_access();
  if not public.has_beta_access() then raise exception 'ACCESS_DENIED'; end if;
  if p_token is null or (p_token !~ '^[A-Za-z0-9_:-]+$' or char_length(p_token) not between 20 and 2048) or p_installation_id is null then
    raise exception 'INVALID_DEVICE_REGISTRATION';
  end if;
  -- Serialize rotation, logout and account changes for this installation.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_installation_id::text, 0));
  delete from public.android_push_subscriptions where installation_id = p_installation_id
    and token <> p_token;
  insert into public.android_push_subscriptions(user_id, installation_id, token)
  values(v_user, p_installation_id, p_token)
  on conflict(token) do update set user_id = excluded.user_id,
    installation_id = excluded.installation_id, enabled = true, updated_at = now(),
    consecutive_failures = 0, last_failure_reason = null, last_failure_status = null
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function tamoon_push.save_android_subscription(text,uuid) from public, anon;
grant execute on function tamoon_push.save_android_subscription(text,uuid) to authenticated;
create function public.save_android_push_subscription(p_token text, p_installation_id uuid)
returns uuid language sql security invoker set search_path = '' as $$
  select tamoon_push.save_android_subscription(p_token, p_installation_id);
$$;
revoke all on function public.save_android_push_subscription(text,uuid) from public, anon;
grant execute on function public.save_android_push_subscription(text,uuid) to authenticated;

create function tamoon_push.remove_android_subscription(p_installation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_installation_id::text, 0));
  delete from public.android_push_subscriptions where user_id = auth.uid() and installation_id = p_installation_id;
end;
$$;
revoke all on function tamoon_push.remove_android_subscription(uuid) from public, anon;
grant execute on function tamoon_push.remove_android_subscription(uuid) to authenticated;
create function public.remove_android_push_subscription(p_installation_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select tamoon_push.remove_android_subscription(p_installation_id);
$$;
revoke all on function public.remove_android_push_subscription(uuid) from public, anon;
grant execute on function public.remove_android_push_subscription(uuid) to authenticated;

-- Tâmo On — Beta 1.0 Build 151 / Database Build 148
-- Retenção de notificações e leitura híbrida por clique ou abertura da Central.

begin;

alter table public.user_notifications
  add column if not exists read_method text;

update public.user_notifications
set read_method = 'legacy'
where read_at is not null
  and read_method is null;

alter table public.user_notifications
  drop constraint if exists user_notifications_read_state_check;

alter table public.user_notifications
  add constraint user_notifications_read_state_check
  check (
    (read_at is null and read_method is null)
    or
    (
      read_at is not null
      and read_method in (
        'clicked',
        'notification_center_opened',
        'legacy'
      )
    )
  );

create table if not exists public.notification_retention_holds (
  id uuid primary key default gen_random_uuid(),
  record_type text not null
    check (record_type in ('user_notification', 'announcement')),
  record_id uuid not null,
  reason text not null
    check (char_length(trim(reason)) between 5 and 1000),
  hold_until timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  unique(record_type, record_id)
);

create index if not exists notification_retention_holds_active_idx
  on public.notification_retention_holds(record_type, record_id, hold_until)
  where released_at is null;

alter table public.notification_retention_holds enable row level security;

revoke all on table public.notification_retention_holds from public;
revoke all on table public.notification_retention_holds from anon;
revoke all on table public.notification_retention_holds from authenticated;
grant select, insert, update, delete
  on table public.notification_retention_holds
  to service_role;

create table if not exists public.data_retention_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  result jsonb not null default '{}'::jsonb
);

alter table public.data_retention_runs enable row level security;

revoke all on table public.data_retention_runs from public;
revoke all on table public.data_retention_runs from anon;
revoke all on table public.data_retention_runs from authenticated;
grant select, insert on table public.data_retention_runs to service_role;

create or replace function public.guard_notification_retention_hold()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.notification_retention_holds h
    where h.record_type = tg_argv[0]
      and h.record_id = old.id
      and h.released_at is null
      and h.hold_until > now()
  ) then
    raise exception
      'Registro protegido por preservação excepcional até o prazo informado';
  end if;

  return old;
end;
$$;

revoke all on function public.guard_notification_retention_hold()
from public;
revoke all on function public.guard_notification_retention_hold()
from anon;
revoke all on function public.guard_notification_retention_hold()
from authenticated;

drop trigger if exists user_notifications_retention_hold_guard
  on public.user_notifications;

create trigger user_notifications_retention_hold_guard
before delete on public.user_notifications
for each row execute function public.guard_notification_retention_hold(
  'user_notification'
);

drop trigger if exists announcements_retention_hold_guard
  on public.announcements;

create trigger announcements_retention_hold_guard
before delete on public.announcements
for each row execute function public.guard_notification_retention_hold(
  'announcement'
);

create or replace function public.mark_user_notifications_read(
  p_notification_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_read_at timestamptz := now();
  v_marked_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  select array_agg(item.notification_id order by item.notification_id)
  into v_ids
  from (
    select distinct notification_id
    from unnest(
      coalesce(p_notification_ids, array[]::uuid[])
    ) as selected(notification_id)
    where notification_id is not null
  ) item;

  if coalesce(cardinality(v_ids), 0) = 0 then
    return jsonb_build_object(
      'marked_count', 0,
      'read_at', v_read_at,
      'read_method', 'clicked'
    );
  end if;

  update public.user_notifications
  set read_at = v_read_at,
      read_method = 'clicked'
  where user_id = auth.uid()
    and id = any(v_ids)
    and read_at is null;

  get diagnostics v_marked_count = row_count;

  return jsonb_build_object(
    'marked_count', v_marked_count,
    'read_at', v_read_at,
    'read_method', 'clicked'
  );
end;
$$;

-- Mantém o nome da RPC anterior para proteger também clientes ainda em cache.
-- A partir desta build, abrir a Central baixa somente os dois tipos de presença.
create or replace function public.mark_all_user_notifications_read()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_read_at timestamptz := now();
  v_marked_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  update public.user_notifications
  set read_at = v_read_at,
      read_method = 'notification_center_opened'
  where user_id = auth.uid()
    and read_at is null
    and created_at >= now() - interval '90 days'
    and notification_type in (
      'attendance-confirmed',
      'attendance-declined'
    );

  get diagnostics v_marked_count = row_count;

  return jsonb_build_object(
    'marked_count', v_marked_count,
    'read_at', v_read_at,
    'read_method', 'notification_center_opened',
    'notification_types', jsonb_build_array(
      'attendance-confirmed',
      'attendance-declined'
    )
  );
end;
$$;

revoke all on function public.mark_user_notifications_read(uuid[])
from public;
revoke all on function public.mark_user_notifications_read(uuid[])
from anon;
revoke all on function public.mark_user_notifications_read(uuid[])
from authenticated;
grant execute on function public.mark_user_notifications_read(uuid[])
to authenticated;

revoke all on function public.mark_all_user_notifications_read()
from public;
revoke all on function public.mark_all_user_notifications_read()
from anon;
revoke all on function public.mark_all_user_notifications_read()
from authenticated;
grant execute on function public.mark_all_user_notifications_read()
to authenticated;

create or replace function public.purge_expired_notification_data()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_notifications integer := 0;
  v_announcements integer := 0;
  v_receipts integer := 0;
  v_push_attempts integer := 0;
  v_push_subscriptions integer := 0;
  v_holds integer := 0;
  v_runs integer := 0;
  v_row_count integer := 0;
  v_table text;
  v_result jsonb;
begin
  delete from public.user_notifications n
  where n.created_at < now() - interval '180 days'
    and not exists (
      select 1
      from public.notification_retention_holds h
      where h.record_type = 'user_notification'
        and h.record_id = n.id
        and h.released_at is null
        and h.hold_until > now()
    )
    and not exists (
      select 1
      from public.announcements a
      join public.notification_retention_holds h
        on h.record_type = 'announcement'
       and h.record_id = a.id
       and h.released_at is null
       and h.hold_until > now()
      where a.id = n.source_id
        and n.notification_type in ('announcement', 'announcement-resend')
    );
  get diagnostics v_user_notifications = row_count;

  delete from public.notification_receipts r
  where r.read_at < now() - interval '24 months'
    and not exists (
      select 1
      from public.notification_retention_holds h
      where h.record_type = 'announcement'
        and h.record_id = r.source_id
        and h.released_at is null
        and h.hold_until > now()
    );
  get diagnostics v_receipts = row_count;

  delete from public.announcements a
  where a.created_at < now() - interval '24 months'
    and not exists (
      select 1
      from public.notification_retention_holds h
      where h.record_type = 'announcement'
        and h.record_id = a.id
        and h.released_at is null
        and h.hold_until > now()
    );
  get diagnostics v_announcements = row_count;

  foreach v_table in array array[
    'push_delivery_attempts',
    'push_delivery_attempts_v2'
  ] loop
    if to_regclass(format('public.%I', v_table)) is not null
       and exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name = v_table
           and column_name = 'created_at'
       ) then
      execute format(
        'delete from public.%I where created_at < now() - interval ''180 days''',
        v_table
      );
      get diagnostics v_row_count = row_count;
      v_push_attempts := v_push_attempts + v_row_count;
    end if;
  end loop;

  if to_regclass('public.push_subscriptions') is not null
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'push_subscriptions'
         and column_name = 'enabled'
     )
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'push_subscriptions'
         and column_name = 'invalidated_at'
     ) then
    execute $cleanup$
      delete from public.push_subscriptions
      where enabled is not true
        and coalesce(invalidated_at, updated_at, created_at)
          < now() - interval '30 days'
    $cleanup$;
    get diagnostics v_push_subscriptions = row_count;
  end if;

  delete from public.notification_retention_holds
  where (
      released_at is not null
      and released_at < now() - interval '180 days'
    )
    or (
      released_at is null
      and hold_until < now() - interval '180 days'
    );
  get diagnostics v_holds = row_count;

  delete from public.data_retention_runs
  where ran_at < now() - interval '24 months';
  get diagnostics v_runs = row_count;

  v_result := jsonb_build_object(
    'user_notifications_deleted', v_user_notifications,
    'announcements_deleted', v_announcements,
    'notification_receipts_deleted', v_receipts,
    'push_attempts_deleted', v_push_attempts,
    'invalid_push_subscriptions_deleted', v_push_subscriptions,
    'expired_holds_deleted', v_holds,
    'old_run_logs_deleted', v_runs,
    'completed_at', now()
  );

  insert into public.data_retention_runs(result)
  values (v_result);

  return v_result;
end;
$$;

revoke all on function public.purge_expired_notification_data()
from public;
revoke all on function public.purge_expired_notification_data()
from anon;
revoke all on function public.purge_expired_notification_data()
from authenticated;
grant execute on function public.purge_expired_notification_data()
to service_role;

create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'tamoon-notification-retention-daily';

select cron.schedule(
  'tamoon-notification-retention-daily',
  '17 3 * * *',
  'select public.purge_expired_notification_data();'
);

insert into public.app_releases(
  channel,
  version,
  build,
  database_build,
  edge_build,
  active,
  mandatory,
  notes
)
values (
  'beta',
  'Beta 1.0',
  151,
  148,
  112,
  true,
  false,
  'Leitura híbrida das notificações, registro do método de baixa e política automática de retenção.'
)
on conflict (channel, build) do update
set version = excluded.version,
    database_build = excluded.database_build,
    edge_build = excluded.edge_build,
    active = excluded.active,
    mandatory = excluded.mandatory,
    notes = excluded.notes,
    released_at = now();

update public.app_releases
set active = false
where channel = 'beta'
  and build < 151;

commit;

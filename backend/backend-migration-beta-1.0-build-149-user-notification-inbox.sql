-- Tâmo On — Beta 1.0 Build 149 / Database Build 146
-- Caixa individual de notificações para todas as mensagens do aplicativo.

begin;

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  notification_type text not null
    check (char_length(notification_type) between 2 and 80),
  title text not null
    check (char_length(title) between 2 and 160),
  body text not null default ''
    check (char_length(body) <= 1000),
  target_url text not null default ''
    check (char_length(target_url) <= 2000),
  source_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists user_notifications_user_created_idx
  on public.user_notifications(user_id, created_at desc);

create index if not exists user_notifications_user_unread_idx
  on public.user_notifications(user_id, created_at desc)
  where read_at is null;

create index if not exists user_notifications_group_idx
  on public.user_notifications(group_id, created_at desc)
  where group_id is not null;

alter table public.user_notifications enable row level security;

drop policy if exists "user notifications own read"
  on public.user_notifications;

create policy "user notifications own read"
on public.user_notifications for select to authenticated
using (user_id = auth.uid());

revoke all on table public.user_notifications from public;
revoke all on table public.user_notifications from anon;
revoke all on table public.user_notifications from authenticated;
grant select on table public.user_notifications to authenticated;
grant select, insert on table public.user_notifications to service_role;

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
      'read_at', v_read_at
    );
  end if;

  update public.user_notifications
  set read_at = v_read_at
  where user_id = auth.uid()
    and id = any(v_ids)
    and read_at is null;

  get diagnostics v_marked_count = row_count;

  return jsonb_build_object(
    'marked_count', v_marked_count,
    'read_at', v_read_at
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

-- Mantém os avisos existentes disponíveis no histórico, mas já lidos.
-- Assim a primeira abertura da Build 149 não cria alertas antigos.
insert into public.user_notifications(
  user_id,
  group_id,
  notification_type,
  title,
  body,
  target_url,
  source_id,
  metadata,
  created_by,
  read_at,
  created_at
)
select
  gm.user_id,
  a.group_id,
  'announcement',
  a.title,
  a.body,
  '/?group=' || a.group_id::text
    || '&page=home&announcement=' || a.id::text,
  a.id,
  jsonb_build_object('legacy_backfill', true),
  a.created_by,
  now(),
  a.created_at
from public.announcements a
join public.group_members gm
  on gm.group_id = a.group_id
where gm.user_id is distinct from a.created_by
  and not exists (
    select 1
    from public.user_notifications n
    where n.user_id = gm.user_id
      and n.notification_type = 'announcement'
      and n.source_id = a.id
      and n.metadata ->> 'legacy_backfill' = 'true'
  );

do $$
begin
  alter publication supabase_realtime
    add table public.user_notifications;
exception
  when duplicate_object then null;
end $$;

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
  149,
  146,
  112,
  true,
  false,
  'Caixa individual de notificações e contador no sino para todas as mensagens do aplicativo.'
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
  and build < 149;

commit;

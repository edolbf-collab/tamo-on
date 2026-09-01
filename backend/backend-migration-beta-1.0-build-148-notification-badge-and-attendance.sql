-- Tâmo On — Beta 1.0 Build 148 / Database Build 145
-- Contador individual de avisos não lidos e remoção do status legado
-- "Talvez" da interface de gestão de presença.

begin;

-- Estrutura genérica de leitura. Hoje registra avisos da comunidade; novas
-- fontes, como o Marketplace, poderão utilizar outros valores em source_type.
create table if not exists public.notification_receipts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (char_length(source_type) between 2 and 40),
  source_id uuid not null,
  read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(user_id, group_id, source_type, source_id)
);

create index if not exists notification_receipts_group_user_idx
  on public.notification_receipts(group_id, user_id, read_at desc);

alter table public.notification_receipts enable row level security;

drop policy if exists "notification receipts own read"
  on public.notification_receipts;

create policy "notification receipts own read"
on public.notification_receipts for select to authenticated
using (
  user_id = auth.uid()
  and public.is_group_member(group_id)
);

revoke all on table public.notification_receipts from public;
revoke all on table public.notification_receipts from anon;
revoke all on table public.notification_receipts from authenticated;
grant select on table public.notification_receipts to authenticated;

create or replace function public.mark_group_announcements_read(
  p_group_id uuid,
  p_announcement_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_marked_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  if not public.is_group_member(p_group_id) then
    raise exception 'Sem acesso aos avisos deste grupo';
  end if;

  select array_agg(item.announcement_id order by item.announcement_id)
  into v_ids
  from (
    select distinct announcement_id
    from unnest(
      coalesce(p_announcement_ids, array[]::uuid[])
    ) as selected(announcement_id)
    where announcement_id is not null
  ) item;

  if coalesce(cardinality(v_ids), 0) = 0 then
    return jsonb_build_object('marked_count', 0);
  end if;

  insert into public.notification_receipts(
    group_id,
    user_id,
    source_type,
    source_id,
    read_at
  )
  select
    a.group_id,
    auth.uid(),
    'announcement',
    a.id,
    now()
  from public.announcements a
  where a.group_id = p_group_id
    and a.id = any(v_ids)
  on conflict (user_id, group_id, source_type, source_id)
  do update set read_at = excluded.read_at;

  get diagnostics v_marked_count = row_count;

  return jsonb_build_object(
    'group_id', p_group_id,
    'marked_count', v_marked_count
  );
end;
$$;

revoke all on function public.mark_group_announcements_read(uuid, uuid[])
from public;

revoke all on function public.mark_group_announcements_read(uuid, uuid[])
from anon;

revoke all on function public.mark_group_announcements_read(uuid, uuid[])
from authenticated;

grant execute on function public.mark_group_announcements_read(uuid, uuid[])
to authenticated;

-- Os avisos anteriores à implantação começam como lidos, evitando um contador
-- artificialmente cheio na primeira abertura da nova versão.
insert into public.notification_receipts(
  group_id,
  user_id,
  source_type,
  source_id,
  read_at
)
select
  a.group_id,
  gm.user_id,
  'announcement',
  a.id,
  now()
from public.announcements a
join public.group_members gm
  on gm.group_id = a.group_id
on conflict (user_id, group_id, source_type, source_id)
do nothing;

-- A compatibilidade do tipo "maybe" permanece apenas no banco durante o beta,
-- para não descartar dados auxiliares de registros antigos. A Build 148 não
-- exibe nem envia esse status; visualmente ele equivale a "Sem resposta".

do $$
begin
  alter publication supabase_realtime
    add table public.notification_receipts;
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
  148,
  145,
  111,
  true,
  false,
  'Contador de novos avisos no sino e gestão de presença alinhada a Vou e Não vou.'
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
  and build < 148;

commit;

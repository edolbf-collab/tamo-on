-- Tâmo On — Beta 1.0 Build 150 / Database Build 147
-- Leitura coletiva das notificações ao abrir o sino. O compartilhamento da
-- lista final do evento utiliza os dados já existentes e não altera o banco.

begin;

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
  set read_at = v_read_at
  where user_id = auth.uid()
    and read_at is null;

  get diagnostics v_marked_count = row_count;

  return jsonb_build_object(
    'marked_count', v_marked_count,
    'read_at', v_read_at
  );
end;
$$;

revoke all on function public.mark_all_user_notifications_read()
from public;

revoke all on function public.mark_all_user_notifications_read()
from anon;

revoke all on function public.mark_all_user_notifications_read()
from authenticated;

grant execute on function public.mark_all_user_notifications_read()
to authenticated;

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
  150,
  147,
  112,
  true,
  false,
  'Leitura coletiva ao abrir o sino e compartilhamento da lista final do evento pelo WhatsApp.'
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
  and build < 150;

commit;

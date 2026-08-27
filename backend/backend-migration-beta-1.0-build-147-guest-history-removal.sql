-- Tâmo On — Beta 1.0 Build 147 / Database Build 144
-- Remoção segura de convidados da lista histórica, bloqueio durante toda a
-- duração do evento e preservação dos registros reais da partida.

begin;

alter table public.players
  add column if not exists guest_history_archived_at timestamptz;

create index if not exists players_guest_history_active_idx
  on public.players(group_id, guest_match_id)
  where guest_match_id is not null
    and guest_history_archived_at is null;

create or replace function public.protect_match_guest_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_id uuid;
  v_player_group_id uuid;
  v_match_group_id uuid;
  v_starts_at timestamptz;
  v_duration_minutes integer;
  v_ends_at timestamptz;
  v_history_at timestamptz;
  v_status text;
  v_event_in_progress boolean;
begin
  if tg_op = 'INSERT' then
    v_match_id := new.guest_match_id;
    v_player_group_id := new.group_id;
  else
    v_match_id := old.guest_match_id;
    v_player_group_id := old.group_id;
  end if;

  if v_match_id is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.guest_match_id is distinct from new.guest_match_id then
      raise exception 'O evento de uma participação já cadastrada não pode ser alterado';
    end if;

    if old.guest_profile_id is distinct from new.guest_profile_id then
      raise exception 'A identidade histórica do convidado não pode ser alterada';
    end if;
  end if;

  select
    m.group_id,
    m.starts_at,
    coalesce(m.duration_minutes, 60),
    m.status
  into
    v_match_group_id,
    v_starts_at,
    v_duration_minutes,
    v_status
  from public.matches m
  where m.id = v_match_id;

  if not found then
    if tg_op = 'DELETE' then
      return old;
    end if;
    raise exception 'O evento do convidado não existe mais';
  end if;

  if v_match_group_id is distinct from v_player_group_id then
    raise exception 'O convidado e o evento devem pertencer ao mesmo grupo';
  end if;

  v_ends_at := v_starts_at
    + (v_duration_minutes * interval '1 minute');
  v_history_at := v_starts_at
    + (v_duration_minutes * interval '1 minute' / 2);
  v_event_in_progress := v_status <> 'cancelled'
    and now() >= v_starts_at
    and now() < v_ends_at;

  if tg_op = 'DELETE' then
    -- Exclusões em cascata continuam permitidas quando o grupo pai já está
    -- sendo removido ou quando o evento pai já deixou de existir.
    if not exists (
      select 1
      from public.groups g
      where g.id = v_player_group_id
    ) then
      return old;
    end if;

    if v_event_in_progress then
      raise exception 'O convidado não pode ser excluído enquanto o evento está acontecendo';
    end if;

    if v_status = 'finished' or now() >= v_ends_at then
      raise exception 'Registros de partidas realizadas devem ser removidos pela função de arquivamento';
    end if;

    return old;
  end if;

  if tg_op = 'UPDATE'
     and old.guest_history_archived_at
       is distinct from new.guest_history_archived_at then
    if to_jsonb(old) - 'guest_history_archived_at'
       is distinct from to_jsonb(new) - 'guest_history_archived_at' then
      raise exception 'O arquivamento não pode alterar os dados históricos do convidado';
    end if;

    if v_event_in_progress then
      raise exception 'O convidado não pode ser excluído enquanto o evento está acontecendo';
    end if;

    if now() < v_ends_at then
      raise exception 'O convidado só pode ser removido do histórico após o término do evento';
    end if;

    return new;
  end if;

  if v_status = 'finished' or now() >= v_history_at then
    raise exception 'O histórico do convidado está encerrado e não pode ser editado';
  end if;

  return new;
end;
$$;

create or replace function public.remove_match_guest_record(
  p_player_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest public.players%rowtype;
  v_match public.matches%rowtype;
  v_ends_at timestamptz;
  v_event_in_progress boolean;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  select p.*
  into v_guest
  from public.players p
  where p.id = p_player_id
    and p.guest_match_id is not null
    and p.guest_history_archived_at is null
  for update;

  if not found then
    raise exception 'Convidado não encontrado ou já removido do histórico';
  end if;

  if not public.can_manage_matches(v_guest.group_id) then
    raise exception 'Sem permissão para excluir este convidado';
  end if;

  select m.*
  into v_match
  from public.matches m
  where m.id = v_guest.guest_match_id
  for update;

  if not found then
    raise exception 'Evento do convidado não encontrado';
  end if;

  v_ends_at := v_match.starts_at
    + (coalesce(v_match.duration_minutes, 60) * interval '1 minute');
  v_event_in_progress := v_match.status <> 'cancelled'
    and now() >= v_match.starts_at
    and now() < v_ends_at;

  if v_event_in_progress then
    raise exception 'O convidado não pode ser excluído enquanto o evento está acontecendo';
  end if;

  if v_match.status = 'cancelled' or now() < v_match.starts_at then
    delete from public.players
    where id = p_player_id;

    return jsonb_build_object(
      'player_id', p_player_id,
      'match_id', v_guest.guest_match_id,
      'action', 'deleted'
    );
  end if;

  update public.players
  set guest_history_archived_at = now()
  where id = p_player_id;

  return jsonb_build_object(
    'player_id', p_player_id,
    'match_id', v_guest.guest_match_id,
    'action', 'archived'
  );
end;
$$;

-- Um registro removido da lista de gerenciamento não pode ser usado como
-- fonte de um novo convite. Os demais registros históricos do mesmo perfil
-- continuam disponíveis normalmente.
create or replace function public.reinvite_match_guest(
  p_source_player_id uuid,
  p_match_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_profile_id uuid;
  v_group_id uuid;
  v_source public.players%rowtype;
  v_target public.matches%rowtype;
  v_new_player_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  select p.guest_profile_id, p.group_id
  into v_source_profile_id, v_group_id
  from public.players p
  join public.matches m on m.id = p.guest_match_id
  where p.id = p_source_player_id
    and p.guest_match_id is not null
    and p.guest_history_archived_at is null
    and (
      m.status = 'finished'
      or now() >= m.starts_at
        + (coalesce(m.duration_minutes, 60) * interval '1 minute' / 2)
    );

  if not found or v_source_profile_id is null then
    raise exception 'Selecione um convidado disponível no histórico';
  end if;

  if not public.can_manage_matches(v_group_id) then
    raise exception 'Sem permissão para incluir convidados neste grupo';
  end if;

  select m.*
  into v_target
  from public.matches m
  where m.id = p_match_id
  for update;

  if not found or v_target.group_id <> v_group_id then
    raise exception 'O novo evento não pertence ao grupo do convidado';
  end if;

  if v_target.starts_at <= now()
     or v_target.status in ('cancelled', 'finished') then
    raise exception 'Escolha um evento futuro e disponível';
  end if;

  select p.*
  into v_source
  from public.players p
  join public.matches m on m.id = p.guest_match_id
  where p.group_id = v_group_id
    and p.guest_profile_id = v_source_profile_id
    and p.guest_history_archived_at is null
    and (
      m.status = 'finished'
      or now() >= m.starts_at
        + (coalesce(m.duration_minutes, 60) * interval '1 minute' / 2)
    )
  order by m.starts_at desc, p.created_at desc
  limit 1;

  if exists (
    select 1
    from public.players p
    where p.guest_match_id = p_match_id
      and p.guest_history_archived_at is null
      and (
        p.guest_profile_id = v_source_profile_id
        or (
          lower(regexp_replace(trim(p.name), '[[:space:]]+', ' ', 'g'))
            = lower(regexp_replace(trim(v_source.name), '[[:space:]]+', ' ', 'g'))
          and lower(regexp_replace(trim(coalesce(p.nickname, '')), '[[:space:]]+', ' ', 'g'))
            = lower(regexp_replace(trim(coalesce(v_source.nickname, '')), '[[:space:]]+', ' ', 'g'))
        )
      )
  ) then
    raise exception 'Este convidado já está incluído no evento selecionado';
  end if;

  insert into public.players(
    group_id,
    user_id,
    name,
    nickname,
    primary_position,
    secondary_position,
    goalkeeper,
    active,
    guest_match_id,
    guest_profile_id
  )
  values (
    v_group_id,
    null,
    v_source.name,
    v_source.nickname,
    v_source.primary_position,
    v_source.secondary_position,
    v_source.goalkeeper,
    true,
    p_match_id,
    v_source_profile_id
  )
  returning id into v_new_player_id;

  insert into public.match_attendance(
    group_id,
    match_id,
    player_id,
    status
  )
  values (
    v_group_id,
    p_match_id,
    v_new_player_id,
    'confirmed'
  );

  return jsonb_build_object(
    'player_id', v_new_player_id,
    'source_player_id', v_source.id,
    'guest_profile_id', v_source_profile_id,
    'match_id', p_match_id,
    'name', v_source.name,
    'primary_position', v_source.primary_position,
    'goalkeeper', v_source.goalkeeper
  );
end;
$$;

revoke all on function public.protect_match_guest_history() from public;
revoke all on function public.protect_match_guest_history() from anon;
revoke all on function public.protect_match_guest_history() from authenticated;

revoke all on function public.remove_match_guest_record(uuid) from public;
revoke all on function public.remove_match_guest_record(uuid) from anon;
revoke all on function public.remove_match_guest_record(uuid) from authenticated;
grant execute on function public.remove_match_guest_record(uuid) to authenticated;

revoke all on function public.reinvite_match_guest(uuid, uuid) from public;
revoke all on function public.reinvite_match_guest(uuid, uuid) from anon;
revoke all on function public.reinvite_match_guest(uuid, uuid) from authenticated;
grant execute on function public.reinvite_match_guest(uuid, uuid) to authenticated;

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
  147,
  144,
  111,
  true,
  false,
  'Exclusão de convidados antes e depois do evento, bloqueio durante a partida e retorno à tela de Convidados.'
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
  and build < 147;

commit;

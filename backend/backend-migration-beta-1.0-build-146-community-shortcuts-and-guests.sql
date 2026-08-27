-- Tâmo On — Beta 1.0 Build 146 / Database Build 143
-- Atalhos práticos da Comunidade, histórico imutável de convidados
-- e reutilização segura do último cadastro em um novo evento.

begin;

-- Cada convidado passa a ter uma identidade estável entre participações.
-- A participação continua sendo um registro separado por evento.
alter table public.players
  add column if not exists guest_profile_id uuid;

with normalized_guests as (
  select
    p.group_id,
    lower(regexp_replace(trim(p.name), '[[:space:]]+', ' ', 'g')) as normalized_name,
    lower(regexp_replace(trim(coalesce(p.nickname, '')), '[[:space:]]+', ' ', 'g')) as normalized_nickname
  from public.players p
  where p.guest_match_id is not null
    and p.guest_profile_id is null
  group by
    p.group_id,
    lower(regexp_replace(trim(p.name), '[[:space:]]+', ' ', 'g')),
    lower(regexp_replace(trim(coalesce(p.nickname, '')), '[[:space:]]+', ' ', 'g'))
), guest_identities as (
  select
    n.group_id,
    n.normalized_name,
    n.normalized_nickname,
    gen_random_uuid() as guest_profile_id
  from normalized_guests n
)
update public.players p
set guest_profile_id = i.guest_profile_id
from guest_identities i
where p.guest_match_id is not null
  and p.guest_profile_id is null
  and p.group_id = i.group_id
  and lower(regexp_replace(trim(p.name), '[[:space:]]+', ' ', 'g')) = i.normalized_name
  and lower(regexp_replace(trim(coalesce(p.nickname, '')), '[[:space:]]+', ' ', 'g')) = i.normalized_nickname;

create index if not exists players_guest_profile_idx
  on public.players(group_id, guest_profile_id)
  where guest_profile_id is not null;

-- Novos cadastros manuais reutilizam a identidade conhecida quando nome e
-- apelido coincidem; caso contrário, recebem uma nova identidade.
create or replace function public.assign_match_guest_profile_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_profile_id uuid;
begin
  if new.guest_match_id is null or new.guest_profile_id is not null then
    return new;
  end if;

  select p.guest_profile_id
  into v_existing_profile_id
  from public.players p
  where p.group_id = new.group_id
    and p.guest_match_id is not null
    and p.guest_profile_id is not null
    and lower(regexp_replace(trim(p.name), '[[:space:]]+', ' ', 'g'))
      = lower(regexp_replace(trim(new.name), '[[:space:]]+', ' ', 'g'))
    and lower(regexp_replace(trim(coalesce(p.nickname, '')), '[[:space:]]+', ' ', 'g'))
      = lower(regexp_replace(trim(coalesce(new.nickname, '')), '[[:space:]]+', ' ', 'g'))
  order by p.created_at desc
  limit 1;

  new.guest_profile_id := coalesce(v_existing_profile_id, gen_random_uuid());
  return new;
end;
$$;

drop trigger if exists players_assign_match_guest_profile_id
  on public.players;

create trigger players_assign_match_guest_profile_id
before insert on public.players
for each row
execute function public.assign_match_guest_profile_id();

-- Proteção central: depois do marco que transfere o evento ao histórico
-- (início + 50% da duração), nenhum dado da participação pode ser alterado.
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
  v_status text;
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
    -- Permite somente a limpeza automática provocada pela exclusão do
    -- evento ou do grupo pai. Inserções e alterações exigem evento válido.
    if tg_op = 'DELETE' then
      return old;
    end if;
    raise exception 'O evento do convidado não existe mais';
  end if;

  if v_match_group_id is distinct from v_player_group_id then
    raise exception 'O convidado e o evento devem pertencer ao mesmo grupo';
  end if;

  if v_status = 'finished'
     or now() >= v_starts_at
       + (v_duration_minutes * interval '1 minute' / 2) then
    raise exception 'O histórico do convidado está encerrado e não pode ser alterado ou excluído';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists players_protect_match_guest_history
  on public.players;

create trigger players_protect_match_guest_history
before insert or update or delete on public.players
for each row
execute function public.protect_match_guest_history();

-- Cria uma nova participação confirmada copiando os dados da participação
-- histórica mais recente daquele convidado no grupo.
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
    and (
      m.status = 'finished'
      or now() >= m.starts_at
        + (coalesce(m.duration_minutes, 60) * interval '1 minute' / 2)
    );

  if not found or v_source_profile_id is null then
    raise exception 'Selecione um convidado de um evento já encerrado';
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

revoke all on function public.assign_match_guest_profile_id()
from public;

revoke all on function public.protect_match_guest_history()
from public;

revoke all on function public.reinvite_match_guest(uuid, uuid)
from public;

grant execute on function public.reinvite_match_guest(uuid, uuid)
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
  146,
  143,
  111,
  true,
  false,
  'Atalhos Onde jogar e Convidados, histórico imutável e reutilização do último cadastro do convidado.'
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
  and build < 146;

commit;

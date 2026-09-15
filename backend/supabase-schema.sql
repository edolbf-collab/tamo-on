-- Tâmo On v0.3.2.1
-- Esquema completo para um projeto Supabase novo.
-- Execute este arquivo integralmente no SQL Editor.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tabelas principais
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 80),
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 8)),
  default_players_per_team integer not null default 6 check (default_players_per_team between 2 and 11),
  monthly_fee numeric(12,2) not null default 0 check (monthly_fee >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (char_length(trim(name)) between 2 and 100),
  nickname text,
  avatar_url text,
  primary_position text not null default 'Meia' check (primary_position in ('Goleiro','Zagueiro','Lateral','Meia','Atacante','Coringa')),
  secondary_position text,
  goalkeeper boolean not null default false,
  skill numeric(3,2) not null default 3.5 check (skill between 1 and 5),
  fair_play numeric(3,2) not null default 4 check (fair_play between 1 and 5),
  conditioning numeric(3,2) not null default 3.5 check (conditioning between 1 and 5),
  active boolean not null default true,
  games integer not null default 0 check (games >= 0),
  wins integer not null default 0 check (wins >= 0),
  goals integer not null default 0 check (goals >= 0),
  assists integer not null default 0 check (assists >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists players_group_user_unique
  on public.players(group_id, user_id)
  where user_id is not null;

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  role text not null default 'member' check (role in ('owner','admin','treasurer','organizer','member')),
  joined_at timestamptz not null default now(),
  unique(group_id, user_id)
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null default 'Pelada semanal',
  starts_at timestamptz not null,
  duration_minutes integer not null default 60 check (duration_minutes between 15 and 480),
  location text not null,
  max_players integer not null default 12 check (max_players between 4 and 60),
  players_per_team integer not null default 6 check (players_per_team between 2 and 11),
  status text not null default 'scheduled' check (status in ('draft','scheduled','in_progress','finished','cancelled')),
  bbq_enabled boolean not null default false,
  bbq_price numeric(12,2) not null default 0 check (bbq_price >= 0),
  confirmation_deadline timestamptz,
  notes text not null default '',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- group_id também é armazenado nas tabelas filhas para permitir filtros seguros
-- e eficientes no Realtime. Um trigger o preenche a partir da partida.
create table if not exists public.match_attendance (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  status text not null check (status in ('confirmed','maybe','out','waitlist')),
  bbq boolean not null default false,
  bbq_guests integer not null default 0 check (bbq_guests between 0 and 20),
  bbq_note text not null default '',
  responded_at timestamptz not null default now(),
  unique(match_id, player_id)
);

create table if not exists public.team_assignments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  team_name text not null,
  slot integer not null default 1 check (slot > 0),
  assigned_goalkeeper boolean not null default false,
  created_at timestamptz not null default now(),
  unique(match_id, player_id)
);

create table if not exists public.match_events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  type text not null check (type in ('goal','own_goal','assist','yellow_card','red_card','substitution','note')),
  player_id uuid references public.players(id) on delete set null,
  assist_player_id uuid references public.players(id) on delete set null,
  minute integer check (minute between 0 and 300),
  team_name text,
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.player_ratings (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  rated_player_id uuid not null references public.players(id) on delete cascade,
  rater_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  technical numeric(3,2) not null check (technical between 1 and 5),
  fair_play numeric(3,2) not null check (fair_play between 1 and 5),
  conditioning numeric(3,2) not null check (conditioning between 1 and 5),
  comment text not null default '',
  created_at timestamptz not null default now(),
  unique(match_id, rated_player_id, rater_user_id)
);

create table if not exists public.charges (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  due_date date not null,
  status text not null default 'open' check (status in ('open','partial','paid','cancelled','overdue')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  charge_id uuid references public.charges(id) on delete set null,
  description text not null default 'Pagamento',
  amount numeric(12,2) not null check (amount > 0),
  method text not null default 'manual' check (method in ('pix','cash','transfer','card','manual')),
  paid_at timestamptz not null default now(),
  recorded_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  category text not null default 'outros',
  occurred_at timestamptz not null default now(),
  recorded_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null,
  body text not null,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------------

create index if not exists idx_group_members_user on public.group_members(user_id);
create index if not exists idx_group_members_group on public.group_members(group_id);
create index if not exists idx_players_group on public.players(group_id);
create index if not exists idx_matches_group_starts on public.matches(group_id, starts_at);
create index if not exists idx_attendance_group_match on public.match_attendance(group_id, match_id);
create index if not exists idx_assignments_group_match on public.team_assignments(group_id, match_id);
create index if not exists idx_events_group_match on public.match_events(group_id, match_id);
create index if not exists idx_ratings_group_match on public.player_ratings(group_id, match_id);
create index if not exists idx_charges_group_status on public.charges(group_id, status);
create index if not exists idx_payments_group_paid on public.payments(group_id, paid_at);
create index if not exists idx_expenses_group_occurred on public.expenses(group_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Triggers de consistência
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_match_child_group_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  select m.group_id into v_group_id
  from public.matches m
  where m.id = new.match_id;

  if v_group_id is null then
    raise exception 'Partida não encontrada';
  end if;

  new.group_id = v_group_id;
  return new;
end;
$$;

create or replace function public.validate_match_player()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.player_id is not null and not exists (
    select 1 from public.players p
    where p.id = new.player_id and p.group_id = new.group_id
  ) then
    raise exception 'Jogador não pertence ao grupo da partida';
  end if;

  return new;
end;
$$;

create or replace function public.validate_match_event_players()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.player_id is not null and not exists (
    select 1 from public.players p
    where p.id = new.player_id and p.group_id = new.group_id
  ) then
    raise exception 'Jogador não pertence ao grupo da partida';
  end if;

  if new.assist_player_id is not null and not exists (
    select 1 from public.players p
    where p.id = new.assist_player_id and p.group_id = new.group_id
  ) then
    raise exception 'Jogador da assistência não pertence ao grupo da partida';
  end if;

  return new;
end;
$$;

create or replace function public.validate_rating_player()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.players p
    where p.id = new.rated_player_id and p.group_id = new.group_id
  ) then
    raise exception 'Jogador avaliado não pertence ao grupo da partida';
  end if;

  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'name'), ''),
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(concat_ws(' ', new.raw_user_meta_data->>'given_name', new.raw_user_meta_data->>'family_name')), ''),
      split_part(coalesce(new.email, 'Jogador'), '@', 1)
    ),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do update set
    name = case when trim(profiles.name) = '' then excluded.name else profiles.name end,
    avatar_url = coalesce(profiles.avatar_url, excluded.avatar_url);
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists groups_set_updated_at on public.groups;
create trigger groups_set_updated_at before update on public.groups
for each row execute function public.set_updated_at();

drop trigger if exists players_set_updated_at on public.players;
create trigger players_set_updated_at before update on public.players
for each row execute function public.set_updated_at();

drop trigger if exists matches_set_updated_at on public.matches;
create trigger matches_set_updated_at before update on public.matches
for each row execute function public.set_updated_at();

drop trigger if exists attendance_set_group on public.match_attendance;
create trigger attendance_set_group before insert or update on public.match_attendance
for each row execute function public.set_match_child_group_id();

drop trigger if exists assignments_set_group on public.team_assignments;
create trigger assignments_set_group before insert or update on public.team_assignments
for each row execute function public.set_match_child_group_id();

drop trigger if exists events_set_group on public.match_events;
create trigger events_set_group before insert or update on public.match_events
for each row execute function public.set_match_child_group_id();

drop trigger if exists ratings_set_group on public.player_ratings;
create trigger ratings_set_group before insert or update on public.player_ratings
for each row execute function public.set_match_child_group_id();

drop trigger if exists attendance_validate_player on public.match_attendance;
create trigger attendance_validate_player before insert or update on public.match_attendance
for each row execute function public.validate_match_player();

drop trigger if exists assignments_validate_player on public.team_assignments;
create trigger assignments_validate_player before insert or update on public.team_assignments
for each row execute function public.validate_match_player();

drop trigger if exists events_validate_player on public.match_events;
create trigger events_validate_player before insert or update on public.match_events
for each row execute function public.validate_match_event_players();

drop trigger if exists ratings_validate_player on public.player_ratings;
create trigger ratings_validate_player before insert or update on public.player_ratings
for each row execute function public.validate_rating_player();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Funções de autorização
-- ---------------------------------------------------------------------------

create or replace function public.has_group_role(p_group_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
      and gm.role = any(p_roles)
  );
$$;

create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = auth.uid()
  );
$$;

create or replace function public.can_manage_group(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_group_role(p_group_id, array['owner','admin']);
$$;

create or replace function public.can_manage_matches(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_group_role(p_group_id, array['owner','admin','organizer']);
$$;

create or replace function public.can_manage_finance(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_group_role(p_group_id, array['owner','admin','treasurer']);
$$;

create or replace function public.owns_player(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.players p
    where p.id = p_player_id and p.user_id = auth.uid()
  );
$$;

create or replace function public.match_group_id(p_match_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.group_id from public.matches m where m.id = p_match_id;
$$;

-- ---------------------------------------------------------------------------
-- Operações transacionais expostas ao aplicativo
-- ---------------------------------------------------------------------------

create or replace function public.create_group(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_player uuid;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  if char_length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Nome do grupo inválido';
  end if;

  select coalesce(
    nullif(trim((select p.name from public.profiles p where p.id = auth.uid())), ''),
    split_part(coalesce(auth.jwt()->>'email', 'Jogador'), '@', 1),
    'Jogador'
  ) into v_name;

  insert into public.profiles(id, name)
  values(auth.uid(), v_name)
  on conflict(id) do nothing;

  insert into public.groups(name, created_by)
  values(trim(p_name), auth.uid())
  returning id into v_group;

  insert into public.players(group_id, user_id, name, nickname)
  values(v_group, auth.uid(), v_name, split_part(v_name, ' ', 1))
  returning id into v_player;

  insert into public.group_members(group_id, user_id, player_id, role)
  values(v_group, auth.uid(), v_player, 'owner');

  return v_group;
end;
$$;

create or replace function public.join_group_by_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_player uuid;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  select g.id into v_group
  from public.groups g
  where g.invite_code = upper(trim(coalesce(p_code, '')));

  if v_group is null then
    raise exception 'Código de convite não encontrado';
  end if;

  if exists (
    select 1 from public.group_members gm
    where gm.group_id = v_group and gm.user_id = auth.uid()
  ) then
    return v_group;
  end if;

  select coalesce(
    nullif(trim((select p.name from public.profiles p where p.id = auth.uid())), ''),
    split_part(coalesce(auth.jwt()->>'email', 'Jogador'), '@', 1),
    'Jogador'
  ) into v_name;

  insert into public.profiles(id, name)
  values(auth.uid(), v_name)
  on conflict(id) do nothing;

  insert into public.players(group_id, user_id, name, nickname)
  values(v_group, auth.uid(), v_name, split_part(v_name, ' ', 1))
  returning id into v_player;

  insert into public.group_members(group_id, user_id, player_id, role)
  values(v_group, auth.uid(), v_player, 'member');

  return v_group;
end;
$$;

create or replace function public.update_my_profile(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 100 then
    raise exception 'Nome inválido';
  end if;

  insert into public.profiles(id, name)
  values(auth.uid(), v_name)
  on conflict(id) do update set name = excluded.name;

  update public.players
  set name = v_name,
      nickname = case
        when nickname is null or trim(nickname) = '' then split_part(v_name, ' ', 1)
        else nickname
      end
  where user_id = auth.uid();

  return v_name;
end;
$$;

create or replace function public.replace_match_assignments(
  p_match_id uuid,
  p_assignments jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_expected integer;
  v_inserted integer;
begin
  select m.group_id into v_group
  from public.matches m
  where m.id = p_match_id;

  if v_group is null then
    raise exception 'Partida não encontrada';
  end if;

  if not public.can_manage_matches(v_group) then
    raise exception 'Sem permissão para montar os times';
  end if;

  if jsonb_typeof(coalesce(p_assignments, '[]'::jsonb)) <> 'array' then
    raise exception 'Formato de escalação inválido';
  end if;

  v_expected := jsonb_array_length(coalesce(p_assignments, '[]'::jsonb));

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) item
    left join public.players p on p.id = (item->>'player_id')::uuid
    where p.id is null or p.group_id <> v_group
  ) then
    raise exception 'A escalação contém jogador inválido';
  end if;

  delete from public.team_assignments where match_id = p_match_id;

  insert into public.team_assignments(id, group_id, match_id, player_id, team_name, slot)
  select
    coalesce(nullif(item->>'id', '')::uuid, gen_random_uuid()),
    v_group,
    p_match_id,
    (item->>'player_id')::uuid,
    trim(item->>'team_name'),
    greatest(coalesce((item->>'slot')::integer, 1), 1)
  from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) item;

  get diagnostics v_inserted = row_count;
  if v_inserted <> v_expected then
    raise exception 'Não foi possível salvar toda a escalação';
  end if;
end;
$$;

create or replace function public.record_payment(
  p_group_id uuid,
  p_player_id uuid,
  p_charge_id uuid,
  p_description text,
  p_amount numeric,
  p_method text default 'manual',
  p_paid_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment uuid;
  v_charge_amount numeric(12,2);
  v_paid_before numeric(12,2) := 0;
  v_paid_after numeric(12,2) := 0;
  v_remaining numeric(12,2);
begin
  if not public.can_manage_finance(p_group_id) then
    raise exception 'Sem permissão para registrar pagamentos';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Valor inválido';
  end if;

  if p_player_id is not null and not exists (
    select 1 from public.players p
    where p.id = p_player_id and p.group_id = p_group_id
  ) then
    raise exception 'Jogador inválido';
  end if;

  if p_charge_id is not null then
    select c.amount
      into v_charge_amount
    from public.charges c
    where c.id = p_charge_id
      and c.group_id = p_group_id
      and (p_player_id is null or c.player_id = p_player_id)
      and c.status not in ('paid','cancelled')
    for update;

    if not found then
      raise exception 'Cobrança inválida ou já encerrada';
    end if;

    select coalesce(sum(p.amount), 0)
      into v_paid_before
    from public.payments p
    where p.charge_id = p_charge_id
      and p.group_id = p_group_id;

    v_remaining := greatest(v_charge_amount - v_paid_before, 0);

    if p_amount > v_remaining then
      raise exception 'O pagamento excede o saldo restante da cobrança: %', v_remaining;
    end if;
  end if;

  insert into public.payments(
    group_id, player_id, charge_id, description, amount, method, paid_at, recorded_by
  ) values (
    p_group_id,
    p_player_id,
    p_charge_id,
    coalesce(nullif(trim(p_description), ''), 'Pagamento'),
    p_amount,
    case when p_method in ('pix','cash','transfer','card','manual') then p_method else 'manual' end,
    coalesce(p_paid_at, now()),
    auth.uid()
  ) returning id into v_payment;

  if p_charge_id is not null then
    v_paid_after := v_paid_before + p_amount;

    update public.charges
       set status = case
         when v_paid_after >= amount then 'paid'
         else 'partial'
       end
     where id = p_charge_id
       and group_id = p_group_id;
  end if;

  return v_payment;
end;
$$;

create or replace function public.record_batch_payments(
  p_group_id uuid,
  p_charge_ids uuid[],
  p_description text default null,
  p_method text default 'pix',
  p_paid_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_charge_ids uuid[];
  v_charge_id uuid;
  v_player_id uuid;
  v_charge_description text;
  v_charge_amount numeric(12,2);
  v_charge_status text;
  v_paid_before numeric(12,2);
  v_remaining numeric(12,2);
  v_payment_id uuid;
  v_description text;
  v_method text;
  v_paid_at timestamptz;
  v_created_count integer := 0;
  v_total_amount numeric(12,2) := 0;
  v_payments jsonb := '[]'::jsonb;
begin
  if not public.can_manage_finance(p_group_id) then
    raise exception 'Sem permissão para registrar pagamentos em lote';
  end if;

  select array_agg(item.charge_id order by item.charge_id)
    into v_charge_ids
  from (
    select distinct charge_id
    from unnest(coalesce(p_charge_ids, array[]::uuid[])) as selected(charge_id)
    where charge_id is not null
  ) item;

  if coalesce(cardinality(v_charge_ids), 0) = 0 then
    raise exception 'Selecione ao menos uma pendência';
  end if;

  v_description := nullif(trim(coalesce(p_description, '')), '');
  if v_description is not null and char_length(v_description) > 200 then
    raise exception 'A descrição deve ter no máximo 200 caracteres';
  end if;

  v_method := lower(trim(coalesce(p_method, 'pix')));
  if v_method not in ('pix', 'cash', 'card') then
    raise exception 'Forma de pagamento inválida. Use Pix, Dinheiro ou Cartão';
  end if;
  v_paid_at := coalesce(p_paid_at, now());

  foreach v_charge_id in array v_charge_ids loop
    select
      c.player_id,
      c.description,
      c.amount,
      c.status
    into
      v_player_id,
      v_charge_description,
      v_charge_amount,
      v_charge_status
    from public.charges c
    where c.id = v_charge_id
      and c.group_id = p_group_id
    for update;

    if not found then
      raise exception 'Uma das pendências selecionadas não pertence ao grupo ou não existe';
    end if;

    if v_player_id is null then
      raise exception 'A pendência "%" não possui membro vinculado', v_charge_description;
    end if;

    if v_charge_status in ('paid', 'cancelled') then
      raise exception 'A pendência "%" já está encerrada', v_charge_description;
    end if;

    if not exists (
      select 1
      from public.players p
      where p.id = v_player_id
        and p.group_id = p_group_id
    ) then
      raise exception 'O membro vinculado à pendência "%" não é válido', v_charge_description;
    end if;

    select coalesce(sum(p.amount), 0)
      into v_paid_before
    from public.payments p
    where p.group_id = p_group_id
      and p.charge_id = v_charge_id;

    v_remaining := greatest(v_charge_amount - v_paid_before, 0);

    if v_remaining <= 0 then
      raise exception 'A pendência "%" não possui saldo restante', v_charge_description;
    end if;

    insert into public.payments(
      group_id, player_id, charge_id, description, amount, method, paid_at, recorded_by
    ) values (
      p_group_id,
      v_player_id,
      v_charge_id,
      coalesce(v_description, v_charge_description),
      v_remaining,
      v_method,
      v_paid_at,
      auth.uid()
    ) returning id into v_payment_id;

    update public.charges
       set status = 'paid'
     where id = v_charge_id
       and group_id = p_group_id;

    v_created_count := v_created_count + 1;
    v_total_amount := v_total_amount + v_remaining;
    v_payments := v_payments || jsonb_build_array(jsonb_build_object(
      'id', v_payment_id,
      'charge_id', v_charge_id,
      'player_id', v_player_id,
      'amount', v_remaining
    ));
  end loop;

  return jsonb_build_object(
    'created_count', v_created_count,
    'total_amount', v_total_amount,
    'payments', v_payments
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.match_attendance enable row level security;
alter table public.team_assignments enable row level security;
alter table public.match_events enable row level security;
alter table public.player_ratings enable row level security;
alter table public.charges enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;
alter table public.announcements enable row level security;

-- Reexecução segura das políticas.
drop policy if exists "profiles own select" on public.profiles;
drop policy if exists "profiles own update" on public.profiles;
drop policy if exists "groups members read" on public.groups;
drop policy if exists "groups managers update" on public.groups;
drop policy if exists "groups owner delete" on public.groups;
drop policy if exists "members group read" on public.group_members;
drop policy if exists "members managers insert" on public.group_members;
drop policy if exists "members managers update" on public.group_members;
drop policy if exists "members managers delete" on public.group_members;
drop policy if exists "players group read" on public.players;
drop policy if exists "players organizers insert" on public.players;
drop policy if exists "players organizers update" on public.players;
drop policy if exists "players organizers delete" on public.players;
drop policy if exists "matches group read" on public.matches;
drop policy if exists "matches organizers insert" on public.matches;
drop policy if exists "matches organizers update" on public.matches;
drop policy if exists "matches organizers delete" on public.matches;
drop policy if exists "attendance group read" on public.match_attendance;
drop policy if exists "attendance own or organizer insert" on public.match_attendance;
drop policy if exists "attendance own or organizer update" on public.match_attendance;
drop policy if exists "attendance own or organizer delete" on public.match_attendance;
drop policy if exists "teams group read" on public.team_assignments;
drop policy if exists "teams organizers insert" on public.team_assignments;
drop policy if exists "teams organizers update" on public.team_assignments;
drop policy if exists "teams organizers delete" on public.team_assignments;
drop policy if exists "events group read" on public.match_events;
drop policy if exists "events organizers insert" on public.match_events;
drop policy if exists "events organizers update" on public.match_events;
drop policy if exists "events organizers delete" on public.match_events;
drop policy if exists "ratings group read" on public.player_ratings;
drop policy if exists "ratings own insert" on public.player_ratings;
drop policy if exists "ratings own update" on public.player_ratings;
drop policy if exists "ratings own delete" on public.player_ratings;
drop policy if exists "charges group read" on public.charges;
drop policy if exists "charges finance insert" on public.charges;
drop policy if exists "charges finance update" on public.charges;
drop policy if exists "charges finance delete" on public.charges;
drop policy if exists "payments group read" on public.payments;
drop policy if exists "payments finance insert" on public.payments;
drop policy if exists "payments finance update" on public.payments;
drop policy if exists "payments finance delete" on public.payments;
drop policy if exists "expenses group read" on public.expenses;
drop policy if exists "expenses finance insert" on public.expenses;
drop policy if exists "expenses finance update" on public.expenses;
drop policy if exists "expenses finance delete" on public.expenses;
drop policy if exists "announcements group read" on public.announcements;
drop policy if exists "announcements organizers insert" on public.announcements;
drop policy if exists "announcements organizers update" on public.announcements;
drop policy if exists "announcements organizers delete" on public.announcements;

create policy "profiles own select"
on public.profiles for select to authenticated
using (id = auth.uid());

create policy "profiles own update"
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "groups members read"
on public.groups for select to authenticated
using (public.is_group_member(id));

create policy "groups managers update"
on public.groups for update to authenticated
using (public.can_manage_group(id))
with check (public.can_manage_group(id));

create policy "groups owner delete"
on public.groups for delete to authenticated
using (public.has_group_role(id, array['owner']));

create policy "members group read"
on public.group_members for select to authenticated
using (public.is_group_member(group_id));

create policy "members managers insert"
on public.group_members for insert to authenticated
with check (public.can_manage_group(group_id));

create policy "members managers update"
on public.group_members for update to authenticated
using (public.can_manage_group(group_id))
with check (public.can_manage_group(group_id));

create policy "members managers delete"
on public.group_members for delete to authenticated
using (public.can_manage_group(group_id) and user_id <> auth.uid());

create policy "players group read"
on public.players for select to authenticated
using (public.is_group_member(group_id));

create policy "players organizers insert"
on public.players for insert to authenticated
with check (public.can_manage_matches(group_id));

create policy "players organizers update"
on public.players for update to authenticated
using (public.can_manage_matches(group_id))
with check (public.can_manage_matches(group_id));

create policy "players organizers delete"
on public.players for delete to authenticated
using (public.can_manage_matches(group_id));

create policy "matches group read"
on public.matches for select to authenticated
using (public.is_group_member(group_id));

create policy "matches organizers insert"
on public.matches for insert to authenticated
with check (public.can_manage_matches(group_id));

create policy "matches organizers update"
on public.matches for update to authenticated
using (public.can_manage_matches(group_id))
with check (public.can_manage_matches(group_id));

create policy "matches organizers delete"
on public.matches for delete to authenticated
using (public.can_manage_matches(group_id));

create policy "attendance group read"
on public.match_attendance for select to authenticated
using (public.is_group_member(group_id));

create policy "attendance own or organizer insert"
on public.match_attendance for insert to authenticated
with check (
  public.is_group_member(group_id)
  and (public.owns_player(player_id) or public.can_manage_matches(group_id))
);

create policy "attendance own or organizer update"
on public.match_attendance for update to authenticated
using (public.owns_player(player_id) or public.can_manage_matches(group_id))
with check (
  public.is_group_member(group_id)
  and (public.owns_player(player_id) or public.can_manage_matches(group_id))
);

create policy "attendance own or organizer delete"
on public.match_attendance for delete to authenticated
using (public.owns_player(player_id) or public.can_manage_matches(group_id));

create policy "teams group read"
on public.team_assignments for select to authenticated
using (public.is_group_member(group_id));

create policy "teams organizers insert"
on public.team_assignments for insert to authenticated
with check (public.can_manage_matches(group_id));

create policy "teams organizers update"
on public.team_assignments for update to authenticated
using (public.can_manage_matches(group_id))
with check (public.can_manage_matches(group_id));

create policy "teams organizers delete"
on public.team_assignments for delete to authenticated
using (public.can_manage_matches(group_id));

create policy "events group read"
on public.match_events for select to authenticated
using (public.is_group_member(group_id));

create policy "events organizers insert"
on public.match_events for insert to authenticated
with check (public.can_manage_matches(group_id));

create policy "events organizers update"
on public.match_events for update to authenticated
using (public.can_manage_matches(group_id))
with check (public.can_manage_matches(group_id));

create policy "events organizers delete"
on public.match_events for delete to authenticated
using (public.can_manage_matches(group_id));

create policy "ratings group read"
on public.player_ratings for select to authenticated
using (public.is_group_member(group_id));

create policy "ratings own insert"
on public.player_ratings for insert to authenticated
with check (
  rater_user_id = auth.uid()
  and public.is_group_member(group_id)
  and not public.owns_player(rated_player_id)
);

create policy "ratings own update"
on public.player_ratings for update to authenticated
using (rater_user_id = auth.uid())
with check (
  rater_user_id = auth.uid()
  and public.is_group_member(group_id)
  and not public.owns_player(rated_player_id)
);

create policy "ratings own delete"
on public.player_ratings for delete to authenticated
using (rater_user_id = auth.uid());

create policy "charges group read"
on public.charges for select to authenticated
using (public.is_group_member(group_id));

create policy "charges finance insert"
on public.charges for insert to authenticated
with check (public.can_manage_finance(group_id));

create policy "charges finance update"
on public.charges for update to authenticated
using (public.can_manage_finance(group_id))
with check (public.can_manage_finance(group_id));

create policy "charges finance delete"
on public.charges for delete to authenticated
using (public.can_manage_finance(group_id));

create policy "payments group read"
on public.payments for select to authenticated
using (public.is_group_member(group_id));

create policy "payments finance insert"
on public.payments for insert to authenticated
with check (public.can_manage_finance(group_id));

create policy "payments finance update"
on public.payments for update to authenticated
using (public.can_manage_finance(group_id))
with check (public.can_manage_finance(group_id));

create policy "payments finance delete"
on public.payments for delete to authenticated
using (public.can_manage_finance(group_id));

create policy "expenses group read"
on public.expenses for select to authenticated
using (public.is_group_member(group_id));

create policy "expenses finance insert"
on public.expenses for insert to authenticated
with check (public.can_manage_finance(group_id));

create policy "expenses finance update"
on public.expenses for update to authenticated
using (public.can_manage_finance(group_id))
with check (public.can_manage_finance(group_id));

create policy "expenses finance delete"
on public.expenses for delete to authenticated
using (public.can_manage_finance(group_id));

create policy "announcements group read"
on public.announcements for select to authenticated
using (public.is_group_member(group_id));

create policy "announcements organizers insert"
on public.announcements for insert to authenticated
with check (public.can_manage_matches(group_id));

create policy "announcements organizers update"
on public.announcements for update to authenticated
using (public.can_manage_matches(group_id))
with check (public.can_manage_matches(group_id));

create policy "announcements organizers delete"
on public.announcements for delete to authenticated
using (public.can_manage_matches(group_id));

-- ---------------------------------------------------------------------------
-- Permissões da Data API e RPC
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

revoke all on function public.has_group_role(uuid, text[]) from public;
revoke all on function public.is_group_member(uuid) from public;
revoke all on function public.can_manage_group(uuid) from public;
revoke all on function public.can_manage_matches(uuid) from public;
revoke all on function public.can_manage_finance(uuid) from public;
revoke all on function public.owns_player(uuid) from public;
revoke all on function public.match_group_id(uuid) from public;
revoke all on function public.create_group(text) from public;
revoke all on function public.join_group_by_code(text) from public;
revoke all on function public.update_my_profile(text) from public;
revoke all on function public.replace_match_assignments(uuid, jsonb) from public;
revoke all on function public.record_payment(uuid, uuid, uuid, text, numeric, text, timestamptz) from public;
revoke all on function public.record_batch_payments(uuid, uuid[], text, text, timestamptz) from public;

grant execute on function public.has_group_role(uuid, text[]) to authenticated;
grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.can_manage_group(uuid) to authenticated;
grant execute on function public.can_manage_matches(uuid) to authenticated;
grant execute on function public.can_manage_finance(uuid) to authenticated;
grant execute on function public.owns_player(uuid) to authenticated;
grant execute on function public.match_group_id(uuid) to authenticated;
grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group_by_code(text) to authenticated;
grant execute on function public.update_my_profile(text) to authenticated;
grant execute on function public.replace_match_assignments(uuid, jsonb) to authenticated;
grant execute on function public.record_payment(uuid, uuid, uuid, text, numeric, text, timestamptz) to authenticated;
grant execute on function public.record_batch_payments(uuid, uuid[], text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'public.groups',
    'public.group_members',
    'public.players',
    'public.matches',
    'public.match_attendance',
    'public.team_assignments',
    'public.match_events',
    'public.player_ratings',
    'public.charges',
    'public.payments',
    'public.expenses',
    'public.announcements'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table %s', v_table);
    exception
      when duplicate_object then null;
    end;
  end loop;
end $$;

commit;

-- ===========================================================================
-- Extensões da versão 0.3.0
-- ===========================================================================

-- Tâmo On v0.3.0
-- Migração incremental para projetos que já executaram o esquema v0.2.x.
-- Execute uma única vez no SQL Editor do Supabase, como role postgres.

begin;

-- ---------------------------------------------------------------------------
-- Novos dados de identidade do grupo e posições
-- ---------------------------------------------------------------------------

alter table public.groups
  add column if not exists avatar_key text not null default 'badge-01';

alter table public.groups
  drop constraint if exists groups_avatar_key_check;

alter table public.groups
  add constraint groups_avatar_key_check
  check (avatar_key ~ '^badge-(0[1-9]|1[0-9]|20)$');

alter table public.players
  drop constraint if exists players_primary_position_check;

alter table public.players
  add constraint players_primary_position_check
  check (primary_position in ('Goleiro','Zagueiro','Lateral','Volante','Meia','Atacante','Coringa'));

-- ---------------------------------------------------------------------------
-- Avaliações permanentes entre membros (independentes de uma partida)
-- ---------------------------------------------------------------------------

create table if not exists public.member_ratings (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  rated_player_id uuid not null references public.players(id) on delete cascade,
  rater_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  score numeric(4,2) not null check (score between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(group_id, rated_player_id, rater_user_id)
);

create index if not exists idx_member_ratings_group_player
  on public.member_ratings(group_id, rated_player_id);

alter table public.member_ratings enable row level security;

drop trigger if exists member_ratings_set_updated_at on public.member_ratings;
create trigger member_ratings_set_updated_at
before update on public.member_ratings
for each row execute function public.set_updated_at();

create or replace function public.validate_member_rating_player()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.players p
    where p.id = new.rated_player_id
      and p.group_id = new.group_id
      and p.active is true
  ) then
    raise exception 'Jogador avaliado não pertence ao grupo';
  end if;

  if exists (
    select 1 from public.players p
    where p.id = new.rated_player_id
      and p.user_id = auth.uid()
  ) then
    raise exception 'Não é permitido avaliar a si mesmo';
  end if;

  new.rater_user_id = auth.uid();
  return new;
end;
$$;

drop trigger if exists member_ratings_validate_player on public.member_ratings;
create trigger member_ratings_validate_player
before insert or update on public.member_ratings
for each row execute function public.validate_member_rating_player();

-- ---------------------------------------------------------------------------
-- RPC: criação e personalização de grupo
-- ---------------------------------------------------------------------------

drop function if exists public.create_group(text);
drop function if exists public.create_group(text, text);

create function public.create_group(
  p_name text,
  p_avatar_key text default 'badge-01'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_player uuid;
  v_name text;
  v_profile_avatar text;
  v_avatar text := lower(trim(coalesce(p_avatar_key, 'badge-01')));
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  if char_length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Nome do grupo inválido';
  end if;

  if v_avatar !~ '^badge-(0[1-9]|1[0-9]|20)$' then
    v_avatar := 'badge-01';
  end if;

  select
    coalesce(nullif(trim(p.name), ''), split_part(coalesce(auth.jwt()->>'email', 'Jogador'), '@', 1), 'Jogador'),
    p.avatar_url
  into v_name, v_profile_avatar
  from public.profiles p
  where p.id = auth.uid();

  if v_name is null then
    v_name := split_part(coalesce(auth.jwt()->>'email', 'Jogador'), '@', 1);
  end if;

  insert into public.profiles(id, name)
  values(auth.uid(), v_name)
  on conflict(id) do nothing;

  insert into public.groups(name, avatar_key, created_by)
  values(trim(p_name), v_avatar, auth.uid())
  returning id into v_group;

  insert into public.players(group_id, user_id, name, nickname, avatar_url)
  values(v_group, auth.uid(), v_name, split_part(v_name, ' ', 1), v_profile_avatar)
  returning id into v_player;

  insert into public.group_members(group_id, user_id, player_id, role)
  values(v_group, auth.uid(), v_player, 'owner');

  return v_group;
end;
$$;


-- Atualiza a função de ingresso para copiar nome e foto da conta Google.
drop function if exists public.join_group_by_code(text);
create function public.join_group_by_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_player uuid;
  v_name text;
  v_profile_avatar text;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  select g.id into v_group
  from public.groups g
  where g.invite_code = upper(trim(coalesce(p_code, '')));

  if v_group is null then
    raise exception 'Código de convite não encontrado';
  end if;

  if exists (
    select 1 from public.group_members gm
    where gm.group_id = v_group and gm.user_id = auth.uid()
  ) then
    return v_group;
  end if;

  select
    coalesce(nullif(trim(p.name), ''), split_part(coalesce(auth.jwt()->>'email', 'Jogador'), '@', 1), 'Jogador'),
    p.avatar_url
  into v_name, v_profile_avatar
  from public.profiles p
  where p.id = auth.uid();

  if v_name is null then
    v_name := split_part(coalesce(auth.jwt()->>'email', 'Jogador'), '@', 1);
  end if;

  insert into public.profiles(id, name)
  values(auth.uid(), v_name)
  on conflict(id) do nothing;

  insert into public.players(group_id, user_id, name, nickname, avatar_url)
  values(v_group, auth.uid(), v_name, split_part(v_name, ' ', 1), v_profile_avatar)
  returning id into v_player;

  insert into public.group_members(group_id, user_id, player_id, role)
  values(v_group, auth.uid(), v_player, 'member');

  return v_group;
end;
$$;

update public.players p
set avatar_url = pr.avatar_url
from public.profiles pr
where p.user_id = pr.id
  and p.avatar_url is null
  and pr.avatar_url is not null;

create or replace function public.update_group_settings(
  p_group_id uuid,
  p_name text,
  p_avatar_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avatar text := lower(trim(coalesce(p_avatar_key, 'badge-01')));
begin
  if not public.can_manage_group(p_group_id) then
    raise exception 'Sem permissão para alterar o grupo';
  end if;

  if char_length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Nome do grupo inválido';
  end if;

  if v_avatar !~ '^badge-(0[1-9]|1[0-9]|20)$' then
    raise exception 'Avatar do grupo inválido';
  end if;

  update public.groups
  set name = trim(p_name), avatar_key = v_avatar
  where id = p_group_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: funções e transferência de propriedade
-- ---------------------------------------------------------------------------

create or replace function public.set_member_role(
  p_group_id uuid,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_target_role text;
  v_role text := lower(trim(coalesce(p_role, '')));
begin
  select gm.role into v_actor_role
  from public.group_members gm
  where gm.group_id = p_group_id and gm.user_id = auth.uid();

  select gm.role into v_target_role
  from public.group_members gm
  where gm.group_id = p_group_id and gm.user_id = p_user_id;

  if v_actor_role is null or v_target_role is null then
    raise exception 'Membro ou grupo não encontrado';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Sua própria função não pode ser alterada por esta opção';
  end if;

  if v_target_role = 'owner' then
    raise exception 'Use a transferência de propriedade para alterar o proprietário';
  end if;

  if v_actor_role = 'owner' then
    if v_role not in ('admin','organizer','treasurer','member') then
      raise exception 'Função inválida';
    end if;
  elsif v_actor_role = 'admin' then
    if v_target_role = 'admin' then
      raise exception 'Somente o proprietário pode alterar outro administrador';
    end if;
    if v_role not in ('organizer','treasurer','member') then
      raise exception 'O administrador pode delegar organizador, tesoureiro ou membro';
    end if;
  else
    raise exception 'Sem permissão para delegar funções';
  end if;

  update public.group_members
  set role = v_role
  where group_id = p_group_id and user_id = p_user_id;
end;
$$;

create or replace function public.transfer_group_ownership(
  p_group_id uuid,
  p_new_owner_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_group_role(p_group_id, array['owner']) then
    raise exception 'Somente o proprietário pode transferir o grupo';
  end if;

  if p_new_owner_user_id = auth.uid() then
    return;
  end if;

  if not exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = p_new_owner_user_id
  ) then
    raise exception 'O novo proprietário precisa ser membro do grupo';
  end if;

  update public.group_members
  set role = 'admin'
  where group_id = p_group_id and role = 'owner';

  update public.group_members
  set role = 'owner'
  where group_id = p_group_id and user_id = p_new_owner_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: perfil esportivo do próprio usuário
-- ---------------------------------------------------------------------------

create or replace function public.update_my_player_profile(
  p_group_id uuid,
  p_nickname text,
  p_primary_position text,
  p_secondary_position text default '',
  p_goalkeeper boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_position text := trim(coalesce(p_primary_position, ''));
  v_secondary text := trim(coalesce(p_secondary_position, ''));
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'Você não pertence a este grupo';
  end if;

  if v_position not in ('Goleiro','Zagueiro','Lateral','Volante','Meia','Atacante','Coringa') then
    raise exception 'Posição principal inválida';
  end if;

  if v_secondary <> '' and v_secondary not in ('Goleiro','Zagueiro','Lateral','Volante','Meia','Atacante','Coringa') then
    raise exception 'Posição secundária inválida';
  end if;

  update public.players p
  set nickname = nullif(trim(coalesce(p_nickname, '')), ''),
      primary_position = v_position,
      secondary_position = v_secondary,
      goalkeeper = coalesce(p_goalkeeper, false) or v_position = 'Goleiro'
  where p.group_id = p_group_id
    and p.user_id = auth.uid();

  if not found then
    raise exception 'Perfil de jogador não encontrado';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: avaliação privada entre membros
-- ---------------------------------------------------------------------------

create or replace function public.upsert_member_rating(
  p_group_id uuid,
  p_rated_player_id uuid,
  p_score numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'Você não pertence a este grupo';
  end if;

  if p_score is null or p_score < 1 or p_score > 10 then
    raise exception 'A nota deve estar entre 1 e 10';
  end if;

  if not exists (
    select 1 from public.players p
    where p.id = p_rated_player_id
      and p.group_id = p_group_id
      and p.active is true
  ) then
    raise exception 'Jogador não encontrado';
  end if;

  if public.owns_player(p_rated_player_id) then
    raise exception 'Não é permitido avaliar a si mesmo';
  end if;

  insert into public.member_ratings(group_id, rated_player_id, rater_user_id, score)
  values(p_group_id, p_rated_player_id, auth.uid(), p_score)
  on conflict(group_id, rated_player_id, rater_user_id)
  do update set score = excluded.score, updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: exclusão de partida somente antes do horário marcado
-- ---------------------------------------------------------------------------

create or replace function public.delete_scheduled_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_starts_at timestamptz;
begin
  select m.group_id, m.starts_at into v_group, v_starts_at
  from public.matches m
  where m.id = p_match_id;

  if v_group is null then
    raise exception 'Jogo não encontrado';
  end if;

  if not public.can_manage_matches(v_group) then
    raise exception 'Sem permissão para excluir o jogo';
  end if;

  if v_starts_at <= now() then
    raise exception 'Jogos já iniciados permanecem no histórico e não podem ser apagados';
  end if;

  delete from public.matches where id = p_match_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: separação de times no servidor sem expor as notas aos organizadores
-- ---------------------------------------------------------------------------

alter table public.team_assignments
  add column if not exists assigned_goalkeeper boolean not null default false;

create or replace function public.balance_match_teams(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_players_per_team integer;
  v_player_count integer;
  v_team_count integer;
  v_team_no integer;
  v_team_name text;
  v_designated boolean;
  rec record;
begin
  select m.group_id, m.players_per_team
  into v_group, v_players_per_team
  from public.matches m
  where m.id = p_match_id;

  if v_group is null then
    raise exception 'Jogo não encontrado';
  end if;

  if not public.can_manage_matches(v_group) then
    raise exception 'Sem permissão para formar os times';
  end if;

  select count(*) into v_player_count
  from public.match_attendance a
  join public.players p on p.id = a.player_id
  where a.match_id = p_match_id
    and a.status = 'confirmed'
    and p.active is true;

  if v_player_count < 2 then
    raise exception 'São necessários pelo menos dois jogadores confirmados';
  end if;

  v_team_count := greatest(2, ceil(v_player_count::numeric / greatest(v_players_per_team, 2))::integer);

  create temporary table tmp_tamoon_teams (
    team_no integer primary key,
    team_name text not null,
    player_count integer not null default 0,
    total_score numeric not null default 0,
    goalkeeper_filled integer not null default 0
  ) on commit drop;

  create temporary table tmp_tamoon_assignments (
    player_id uuid primary key,
    team_no integer not null,
    primary_position text,
    score numeric not null,
    assigned_goalkeeper boolean not null default false
  ) on commit drop;

  for v_team_no in 1..v_team_count loop
    v_team_name := case v_team_no
      when 1 then 'Time Verde'
      when 2 then 'Time Azul'
      when 3 then 'Time Laranja'
      when 4 then 'Time Branco'
      when 5 then 'Time Preto'
      when 6 then 'Time Amarelo'
      else 'Time ' || v_team_no::text
    end;
    insert into tmp_tamoon_teams(team_no, team_name) values(v_team_no, v_team_name);
  end loop;

  -- Primeira prioridade: goleiros de posição principal.
  for rec in
    select
      p.id as player_id,
      p.primary_position,
      coalesce(avg(mr.score), p.skill * 2, 7)::numeric(6,3) as balance_score
    from public.match_attendance a
    join public.players p on p.id = a.player_id
    left join public.member_ratings mr
      on mr.group_id = p.group_id and mr.rated_player_id = p.id
    where a.match_id = p_match_id
      and a.status = 'confirmed'
      and p.active is true
      and p.primary_position = 'Goleiro'
    group by p.id, p.primary_position, p.skill, p.name
    order by balance_score desc, p.name
  loop
    select t.team_no, (t.goalkeeper_filled = 0)
    into v_team_no, v_designated
    from tmp_tamoon_teams t
    order by
      t.goalkeeper_filled asc,
      t.player_count asc,
      (select count(*) from tmp_tamoon_assignments a
       where a.team_no = t.team_no and a.primary_position = rec.primary_position) asc,
      t.total_score asc,
      t.team_no asc
    limit 1;

    insert into tmp_tamoon_assignments(player_id, team_no, primary_position, score, assigned_goalkeeper)
    values(rec.player_id, v_team_no, rec.primary_position, rec.balance_score, v_designated);

    update tmp_tamoon_teams
    set player_count = player_count + 1,
        total_score = total_score + rec.balance_score,
        goalkeeper_filled = goalkeeper_filled + case when v_designated then 1 else 0 end
    where team_no = v_team_no;
  end loop;

  -- Segunda prioridade: jogadores de linha que marcaram que também podem jogar no gol.
  for rec in
    select
      p.id as player_id,
      p.primary_position,
      coalesce(avg(mr.score), p.skill * 2, 7)::numeric(6,3) as balance_score
    from public.match_attendance a
    join public.players p on p.id = a.player_id
    left join public.member_ratings mr
      on mr.group_id = p.group_id and mr.rated_player_id = p.id
    where a.match_id = p_match_id
      and a.status = 'confirmed'
      and p.active is true
      and p.primary_position <> 'Goleiro'
      and p.goalkeeper is true
    group by p.id, p.primary_position, p.skill, p.name
    order by balance_score desc, p.name
  loop
    select t.team_no, (t.goalkeeper_filled = 0)
    into v_team_no, v_designated
    from tmp_tamoon_teams t
    order by
      t.goalkeeper_filled asc,
      t.player_count asc,
      (select count(*) from tmp_tamoon_assignments a
       where a.team_no = t.team_no and a.primary_position = rec.primary_position) asc,
      t.total_score asc,
      t.team_no asc
    limit 1;

    insert into tmp_tamoon_assignments(player_id, team_no, primary_position, score, assigned_goalkeeper)
    values(rec.player_id, v_team_no, rec.primary_position, rec.balance_score, v_designated);

    update tmp_tamoon_teams
    set player_count = player_count + 1,
        total_score = total_score + rec.balance_score,
        goalkeeper_filled = goalkeeper_filled + case when v_designated then 1 else 0 end
    where team_no = v_team_no;
  end loop;

  -- Demais jogadores: equilíbrio normal por quantidade, repetição de posição e nota.
  for rec in
    select
      p.id as player_id,
      p.primary_position,
      coalesce(avg(mr.score), p.skill * 2, 7)::numeric(6,3) as balance_score
    from public.match_attendance a
    join public.players p on p.id = a.player_id
    left join public.member_ratings mr
      on mr.group_id = p.group_id and mr.rated_player_id = p.id
    where a.match_id = p_match_id
      and a.status = 'confirmed'
      and p.active is true
      and p.primary_position <> 'Goleiro'
      and p.goalkeeper is not true
    group by p.id, p.primary_position, p.skill, p.name
    order by balance_score desc, p.name
  loop
    select t.team_no
    into v_team_no
    from tmp_tamoon_teams t
    order by
      t.player_count asc,
      (select count(*) from tmp_tamoon_assignments a
       where a.team_no = t.team_no and a.primary_position = rec.primary_position) asc,
      t.total_score asc,
      t.team_no asc
    limit 1;

    insert into tmp_tamoon_assignments(player_id, team_no, primary_position, score, assigned_goalkeeper)
    values(rec.player_id, v_team_no, rec.primary_position, rec.balance_score, false);

    update tmp_tamoon_teams
    set player_count = player_count + 1,
        total_score = total_score + rec.balance_score
    where team_no = v_team_no;
  end loop;

  delete from public.team_assignments where match_id = p_match_id;

  insert into public.team_assignments(
    group_id,
    match_id,
    player_id,
    team_name,
    slot,
    assigned_goalkeeper
  )
  select
    v_group,
    p_match_id,
    a.player_id,
    t.team_name,
    (row_number() over(
      partition by a.team_no
      order by a.assigned_goalkeeper desc, a.score desc, a.player_id
    ))::integer,
    a.assigned_goalkeeper
  from tmp_tamoon_assignments a
  join tmp_tamoon_teams t on t.team_no = a.team_no;
end;
$$;

-- ---------------------------------------------------------------------------
-- Políticas de privacidade e operações sensíveis
-- ---------------------------------------------------------------------------

drop policy if exists "member ratings private read" on public.member_ratings;
drop policy if exists "member ratings own insert" on public.member_ratings;
drop policy if exists "member ratings own update" on public.member_ratings;
drop policy if exists "member ratings own delete" on public.member_ratings;

create policy "member ratings private read"
on public.member_ratings for select to authenticated
using (rater_user_id = auth.uid() or public.can_manage_group(group_id));

create policy "member ratings own insert"
on public.member_ratings for insert to authenticated
with check (
  rater_user_id = auth.uid()
  and public.is_group_member(group_id)
  and not public.owns_player(rated_player_id)
);

create policy "member ratings own update"
on public.member_ratings for update to authenticated
using (rater_user_id = auth.uid())
with check (
  rater_user_id = auth.uid()
  and public.is_group_member(group_id)
  and not public.owns_player(rated_player_id)
);

create policy "member ratings own delete"
on public.member_ratings for delete to authenticated
using (rater_user_id = auth.uid());

-- Avaliações antigas de partidas também deixam de ser públicas ao grupo.
drop policy if exists "ratings group read" on public.player_ratings;
drop policy if exists "ratings private read" on public.player_ratings;
create policy "ratings private read"
on public.player_ratings for select to authenticated
using (rater_user_id = auth.uid() or public.can_manage_group(group_id));

-- Alterações de função, grupo e exclusão de jogo passam exclusivamente pelas RPCs.
drop policy if exists "members managers update" on public.group_members;
drop policy if exists "groups managers update" on public.groups;
drop policy if exists "matches organizers delete" on public.matches;

-- ---------------------------------------------------------------------------
-- Data API, RPC e Realtime
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.member_ratings to authenticated;

revoke all on function public.create_group(text, text) from public;
revoke all on function public.join_group_by_code(text) from public;
revoke all on function public.update_group_settings(uuid, text, text) from public;
revoke all on function public.set_member_role(uuid, uuid, text) from public;
revoke all on function public.transfer_group_ownership(uuid, uuid) from public;
revoke all on function public.update_my_player_profile(uuid, text, text, text, boolean) from public;
revoke all on function public.upsert_member_rating(uuid, uuid, numeric) from public;
revoke all on function public.delete_scheduled_match(uuid) from public;
revoke all on function public.balance_match_teams(uuid) from public;

grant execute on function public.create_group(text, text) to authenticated;
grant execute on function public.join_group_by_code(text) to authenticated;
grant execute on function public.update_group_settings(uuid, text, text) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.transfer_group_ownership(uuid, uuid) to authenticated;
grant execute on function public.update_my_player_profile(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.upsert_member_rating(uuid, uuid, numeric) to authenticated;
grant execute on function public.delete_scheduled_match(uuid) to authenticated;
grant execute on function public.balance_match_teams(uuid) to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.member_ratings;
  exception
    when duplicate_object then null;
  end;
end $$;

commit;
-- Tâmo On v0.3.2
-- Exclusão permanente de grupos e programação semanal de peladas.
-- Execute este arquivo depois da migração v0.3.0.

begin;

-- ---------------------------------------------------------------------------
-- Identificação de séries semanais
-- ---------------------------------------------------------------------------

alter table public.matches
  add column if not exists recurrence_series_id uuid;

alter table public.matches
  add column if not exists recurrence_index integer not null default 1;

alter table public.matches
  add column if not exists recurrence_total integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'matches_recurrence_index_check'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_recurrence_index_check
      check (recurrence_index between 1 and 52);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'matches_recurrence_total_check'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_recurrence_total_check
      check (recurrence_total between 1 and 52);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'matches_recurrence_order_check'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_recurrence_order_check
      check (recurrence_index <= recurrence_total);
  end if;
end $$;

create index if not exists idx_matches_recurrence_series
  on public.matches(group_id, recurrence_series_id, starts_at)
  where recurrence_series_id is not null;

-- ---------------------------------------------------------------------------
-- RPC: criação transacional de uma pelada ou série semanal
-- ---------------------------------------------------------------------------

create or replace function public.create_match_schedule(
  p_group_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_location text,
  p_max_players integer default 12,
  p_players_per_team integer default 6,
  p_bbq_enabled boolean default false,
  p_bbq_price numeric default 0,
  p_notes text default '',
  p_occurrences integer default 1
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series_id uuid;
  v_match_id uuid;
  v_ids uuid[] := array[]::uuid[];
  v_occurrences integer := coalesce(p_occurrences, 1);
  v_index integer;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  if not public.can_manage_matches(p_group_id) then
    raise exception 'Sem permissão para criar peladas neste grupo';
  end if;

  if char_length(trim(coalesce(p_title, ''))) < 2 then
    raise exception 'Título da pelada inválido';
  end if;

  if p_starts_at is null or p_starts_at <= now() then
    raise exception 'A primeira pelada deve ter data futura';
  end if;

  if char_length(trim(coalesce(p_location, ''))) < 2 then
    raise exception 'Local da pelada inválido';
  end if;

  if p_max_players not between 4 and 60 then
    raise exception 'Quantidade máxima de jogadores inválida';
  end if;

  if p_players_per_team not between 2 and 11 then
    raise exception 'Quantidade de jogadores por time inválida';
  end if;

  if coalesce(p_bbq_price, 0) < 0 then
    raise exception 'Valor do churrasco inválido';
  end if;

  if v_occurrences not between 1 and 52 then
    raise exception 'A série deve ter entre 1 e 52 peladas';
  end if;

  if v_occurrences > 1 then
    v_series_id := gen_random_uuid();
  end if;

  for v_index in 1..v_occurrences loop
    insert into public.matches(
      group_id,
      title,
      starts_at,
      location,
      max_players,
      players_per_team,
      status,
      bbq_enabled,
      bbq_price,
      notes,
      created_by,
      recurrence_series_id,
      recurrence_index,
      recurrence_total
    ) values (
      p_group_id,
      trim(p_title),
      p_starts_at + ((v_index - 1) * interval '7 days'),
      trim(p_location),
      p_max_players,
      p_players_per_team,
      'scheduled',
      coalesce(p_bbq_enabled, false),
      coalesce(p_bbq_price, 0),
      coalesce(p_notes, ''),
      auth.uid(),
      v_series_id,
      v_index,
      v_occurrences
    ) returning id into v_match_id;

    v_ids := array_append(v_ids, v_match_id);
  end loop;

  return v_ids;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: exclusão da ocorrência selecionada e das próximas da mesma série
-- ---------------------------------------------------------------------------

create or replace function public.delete_scheduled_match_series(p_match_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_starts_at timestamptz;
  v_series_id uuid;
  v_deleted integer := 0;
begin
  select m.group_id, m.starts_at, m.recurrence_series_id
  into v_group, v_starts_at, v_series_id
  from public.matches m
  where m.id = p_match_id;

  if v_group is null then
    raise exception 'Jogo não encontrado';
  end if;

  if not public.can_manage_matches(v_group) then
    raise exception 'Sem permissão para excluir a série';
  end if;

  if v_starts_at <= now() then
    raise exception 'Peladas já iniciadas permanecem no histórico e não podem ser apagadas';
  end if;

  if v_series_id is null then
    delete from public.matches
    where id = p_match_id
      and starts_at > now();
  else
    delete from public.matches
    where group_id = v_group
      and recurrence_series_id = v_series_id
      and starts_at >= v_starts_at
      and starts_at > now();
  end if;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: exclusão permanente do grupo pelo proprietário
-- ---------------------------------------------------------------------------

create or replace function public.delete_group_permanently(
  p_group_id uuid,
  p_confirmation text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_name text;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  if upper(trim(coalesce(p_confirmation, ''))) <> 'EXCLUIR' then
    raise exception 'Confirmação de exclusão inválida';
  end if;

  select g.name into v_group_name
  from public.groups g
  where g.id = p_group_id;

  if v_group_name is null then
    raise exception 'Grupo não encontrado';
  end if;

  if not public.has_group_role(p_group_id, array['owner']) then
    raise exception 'Somente o proprietário pode excluir o grupo';
  end if;

  delete from public.groups
  where id = p_group_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões da Data API
-- ---------------------------------------------------------------------------

revoke all on function public.create_match_schedule(uuid, text, timestamptz, text, integer, integer, boolean, numeric, text, integer) from public;
revoke all on function public.delete_scheduled_match_series(uuid) from public;
revoke all on function public.delete_group_permanently(uuid, text) from public;

grant execute on function public.create_match_schedule(uuid, text, timestamptz, text, integer, integer, boolean, numeric, text, integer) to authenticated;
grant execute on function public.delete_scheduled_match_series(uuid) to authenticated;
grant execute on function public.delete_group_permanently(uuid, text) to authenticated;

commit;


-- Tâmo On v0.3.2.1
-- Administração única por grupo e configuração de churrasco por pelada.
-- Execute depois da migration-v0.3.2.sql.

begin;

-- ---------------------------------------------------------------------------
-- Funções: um único administrador por grupo
-- ---------------------------------------------------------------------------

-- Escolhe um único administrador por grupo antes de normalizar os papéis.
create temporary table tmp_tamoon_group_admins
on commit drop
as
select
  g.id as group_id,
  coalesce(
    (
      select gm.user_id
      from public.group_members gm
      where gm.group_id = g.id
        and gm.role = 'owner'
      order by gm.joined_at, gm.id
      limit 1
    ),
    (
      select gm.user_id
      from public.group_members gm
      where gm.group_id = g.id
        and gm.role = 'admin'
      order by gm.joined_at, gm.id
      limit 1
    ),
    (
      select gm.user_id
      from public.group_members gm
      where gm.group_id = g.id
        and gm.user_id = g.created_by
      order by gm.joined_at, gm.id
      limit 1
    ),
    (
      select gm.user_id
      from public.group_members gm
      where gm.group_id = g.id
      order by gm.joined_at, gm.id
      limit 1
    )
  ) as user_id
from public.groups g;

update public.group_members
set role = 'member'
where role in ('owner','admin');

update public.group_members gm
set role = 'admin'
from tmp_tamoon_group_admins chosen
where gm.group_id = chosen.group_id
  and gm.user_id = chosen.user_id
  and chosen.user_id is not null;

alter table public.group_members
  drop constraint if exists group_members_role_check;

alter table public.group_members
  add constraint group_members_role_check
  check (role in ('admin','treasurer','organizer','member'));

create unique index if not exists group_members_one_admin_per_group
  on public.group_members(group_id)
  where role = 'admin';

create or replace function public.can_manage_group(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_group_role(p_group_id, array['admin']);
$$;

create or replace function public.can_manage_matches(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_group_role(p_group_id, array['admin','organizer']);
$$;

create or replace function public.can_manage_finance(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_group_role(p_group_id, array['admin','treasurer']);
$$;

-- ---------------------------------------------------------------------------
-- Criação de grupo: o criador é o único administrador
-- ---------------------------------------------------------------------------

create or replace function public.create_group(
  p_name text,
  p_avatar_key text default 'badge-01'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_player uuid;
  v_name text;
  v_profile_avatar text;
  v_avatar text := lower(trim(coalesce(p_avatar_key, 'badge-01')));
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  if char_length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Nome do grupo inválido';
  end if;

  if v_avatar !~ '^badge-(0[1-9]|1[0-9]|20)$' then
    v_avatar := 'badge-01';
  end if;

  select
    coalesce(nullif(trim(p.name), ''), split_part(coalesce(auth.jwt()->>'email', 'Jogador'), '@', 1), 'Jogador'),
    p.avatar_url
  into v_name, v_profile_avatar
  from public.profiles p
  where p.id = auth.uid();

  if v_name is null then
    v_name := split_part(coalesce(auth.jwt()->>'email', 'Jogador'), '@', 1);
  end if;

  insert into public.profiles(id, name)
  values(auth.uid(), v_name)
  on conflict(id) do nothing;

  insert into public.groups(name, avatar_key, created_by)
  values(trim(p_name), v_avatar, auth.uid())
  returning id into v_group;

  insert into public.players(group_id, user_id, name, nickname, avatar_url)
  values(v_group, auth.uid(), v_name, split_part(v_name, ' ', 1), v_profile_avatar)
  returning id into v_player;

  insert into public.group_members(group_id, user_id, player_id, role)
  values(v_group, auth.uid(), v_player, 'admin');

  return v_group;
end;
$$;

-- ---------------------------------------------------------------------------
-- Delegação e transferência da administração
-- ---------------------------------------------------------------------------

create or replace function public.set_member_role(
  p_group_id uuid,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_target_role text;
  v_role text := lower(trim(coalesce(p_role, '')));
begin
  select gm.role into v_actor_role
  from public.group_members gm
  where gm.group_id = p_group_id
    and gm.user_id = auth.uid();

  select gm.role into v_target_role
  from public.group_members gm
  where gm.group_id = p_group_id
    and gm.user_id = p_user_id;

  if v_actor_role is null or v_target_role is null then
    raise exception 'Membro ou grupo não encontrado';
  end if;

  if v_actor_role <> 'admin' then
    raise exception 'Somente o administrador pode delegar funções';
  end if;

  if p_user_id = auth.uid() or v_target_role = 'admin' then
    raise exception 'Use a transferência de administração para alterar o administrador';
  end if;

  if v_role not in ('organizer','treasurer','member') then
    raise exception 'Função inválida';
  end if;

  update public.group_members
  set role = v_role
  where group_id = p_group_id
    and user_id = p_user_id;
end;
$$;

create or replace function public.transfer_group_administration(
  p_group_id uuid,
  p_new_admin_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_group_role(p_group_id, array['admin']) then
    raise exception 'Somente o administrador atual pode transferir a administração';
  end if;

  if p_new_admin_user_id = auth.uid() then
    return;
  end if;

  if not exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = p_new_admin_user_id
  ) then
    raise exception 'O novo administrador precisa ser membro do grupo';
  end if;

  update public.group_members
  set role = 'member'
  where group_id = p_group_id
    and role = 'admin';

  update public.group_members
  set role = 'admin'
  where group_id = p_group_id
    and user_id = p_new_admin_user_id;
end;
$$;

-- Compatibilidade com versões antigas do frontend.
create or replace function public.transfer_group_ownership(
  p_group_id uuid,
  p_new_owner_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.transfer_group_administration(p_group_id, p_new_owner_user_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Churrasco configurado separadamente em cada pelada
-- ---------------------------------------------------------------------------

create or replace function public.update_match_bbq_settings(
  p_match_id uuid,
  p_enabled boolean,
  p_price numeric default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_starts_at timestamptz;
begin
  select m.group_id, m.starts_at
  into v_group_id, v_starts_at
  from public.matches m
  where m.id = p_match_id;

  if v_group_id is null then
    raise exception 'Pelada não encontrada';
  end if;

  if not public.has_group_role(v_group_id, array['admin']) then
    raise exception 'Somente o administrador pode configurar o churrasco';
  end if;

  if v_starts_at <= now() then
    raise exception 'Não é possível alterar o churrasco de uma pelada já iniciada';
  end if;

  if coalesce(p_price, 0) < 0 then
    raise exception 'Valor do churrasco inválido';
  end if;

  update public.matches
  set
    bbq_enabled = coalesce(p_enabled, false),
    bbq_price = case when coalesce(p_enabled, false) then coalesce(p_price, 0) else 0 end,
    updated_at = now()
  where id = p_match_id;

  if not coalesce(p_enabled, false) then
    update public.match_attendance
    set bbq = false,
        bbq_guests = 0,
        bbq_note = ''
    where match_id = p_match_id;
  end if;
end;
$$;

-- O frontend usa RPCs para alterar partidas. Isso impede que organizadores
-- modifiquem diretamente as colunas de churrasco pela Data API.
revoke update on public.matches from authenticated;

-- ---------------------------------------------------------------------------
-- Exclusão do grupo: privilégio do administrador único
-- ---------------------------------------------------------------------------

drop policy if exists "groups owner delete" on public.groups;
drop policy if exists "groups admin delete" on public.groups;
create policy "groups admin delete"
on public.groups for delete to authenticated
using (public.has_group_role(id, array['admin']));

create or replace function public.delete_group_permanently(
  p_group_id uuid,
  p_confirmation text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_name text;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  if upper(trim(coalesce(p_confirmation, ''))) <> 'EXCLUIR' then
    raise exception 'Confirmação de exclusão inválida';
  end if;

  select g.name into v_group_name
  from public.groups g
  where g.id = p_group_id;

  if v_group_name is null then
    raise exception 'Grupo não encontrado';
  end if;

  if not public.has_group_role(p_group_id, array['admin']) then
    raise exception 'Somente o administrador pode excluir o grupo';
  end if;

  delete from public.groups
  where id = p_group_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões da Data API
-- ---------------------------------------------------------------------------

revoke all on function public.transfer_group_administration(uuid, uuid) from public;
revoke all on function public.update_match_bbq_settings(uuid, boolean, numeric) from public;

grant execute on function public.transfer_group_administration(uuid, uuid) to authenticated;
grant execute on function public.update_match_bbq_settings(uuid, boolean, numeric) to authenticated;

commit;


-- ===========================================================================
-- INTEGRAÇÃO BETA 1.0 BUILD 131
-- ===========================================================================

-- Tâmo On — Beta 1.0 Build 131
-- Exclusão do sorteio da espera, edição operacional do evento,
-- jogadores por time opcional e quantidade de times configurável.

begin;

-- A quantidade por time passa a ser apenas uma referência opcional.
alter table public.matches
  alter column players_per_team drop not null,
  alter column players_per_team drop default;

alter table public.matches
  drop constraint if exists matches_players_per_team_check;

alter table public.matches
  add constraint matches_players_per_team_check
  check (players_per_team is null or players_per_team between 2 and 11);

-- Quantidade efetiva de times escolhida na aba Times.
alter table public.matches
  add column if not exists team_count integer;

alter table public.matches
  drop constraint if exists matches_team_count_check;

alter table public.matches
  add constraint matches_team_count_check
  check (team_count is null or team_count between 2 and 12);

alter table public.matches
  add column if not exists duration_minutes integer not null default 60;

alter table public.matches
  drop constraint if exists matches_duration_minutes_check;

alter table public.matches
  add constraint matches_duration_minutes_check
  check (duration_minutes between 15 and 480);

-- Criação de uma pelada ou série semanal com jogadores por time opcional.
drop function if exists public.create_match_schedule(uuid,text,timestamptz,text,integer,integer,boolean,numeric,text,integer);

create or replace function public.create_match_schedule(
  p_group_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_duration_minutes integer,
  p_location text,
  p_max_players integer default 12,
  p_players_per_team integer default null,
  p_bbq_enabled boolean default false,
  p_bbq_price numeric default 0,
  p_notes text default '',
  p_occurrences integer default 1
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series_id uuid;
  v_match_id uuid;
  v_ids uuid[] := array[]::uuid[];
  v_occurrences integer := coalesce(p_occurrences, 1);
  v_index integer;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  if not public.can_manage_matches(p_group_id) then
    raise exception 'Sem permissão para criar peladas neste grupo';
  end if;

  if char_length(trim(coalesce(p_title, ''))) < 2 then
    raise exception 'Título da pelada inválido';
  end if;

  if p_starts_at is null or p_starts_at <= now() then
    raise exception 'A primeira pelada deve ter data futura';
  end if;

  if p_duration_minutes not between 15 and 480 then
    raise exception 'A duração do evento deve ficar entre 15 e 480 minutos';
  end if;

  if char_length(trim(coalesce(p_location, ''))) < 2 then
    raise exception 'Local da pelada inválido';
  end if;

  if p_max_players not between 4 and 60 then
    raise exception 'Quantidade máxima de jogadores inválida';
  end if;

  if p_players_per_team is not null and p_players_per_team not between 2 and 11 then
    raise exception 'Quantidade de jogadores por time inválida';
  end if;

  if coalesce(p_bbq_price, 0) < 0 then
    raise exception 'Valor do churrasco inválido';
  end if;

  if v_occurrences not between 1 and 52 then
    raise exception 'A série deve ter entre 1 e 52 peladas';
  end if;

  if v_occurrences > 1 then
    v_series_id := gen_random_uuid();
  end if;

  for v_index in 1..v_occurrences loop
    insert into public.matches(
      group_id,
      title,
      starts_at,
      duration_minutes,
      location,
      max_players,
      players_per_team,
      status,
      bbq_enabled,
      bbq_price,
      notes,
      created_by,
      recurrence_series_id,
      recurrence_index,
      recurrence_total
    ) values (
      p_group_id,
      trim(p_title),
      p_starts_at + ((v_index - 1) * interval '7 days'),
      p_duration_minutes,
      trim(p_location),
      p_max_players,
      p_players_per_team,
      'scheduled',
      coalesce(p_bbq_enabled, false),
      coalesce(p_bbq_price, 0),
      coalesce(p_notes, ''),
      auth.uid(),
      v_series_id,
      v_index,
      v_occurrences
    ) returning id into v_match_id;

    v_ids := array_append(v_ids, v_match_id);
  end loop;

  return v_ids;
end;
$$;

-- Edição limitada aos dados operacionais solicitados para uma ocorrência futura.
drop function if exists public.update_match_settings(uuid,integer,integer,text);

create or replace function public.update_match_settings(
  p_match_id uuid,
  p_max_players integer,
  p_players_per_team integer default null,
  p_duration_minutes integer default 60,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_starts_at timestamptz;
  v_old_max_players integer;
  v_old_players_per_team integer;
  v_assignments_cleared boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  select m.group_id, m.starts_at, m.max_players, m.players_per_team
  into v_group_id, v_starts_at, v_old_max_players, v_old_players_per_team
  from public.matches m
  where m.id = p_match_id
  for update;

  if v_group_id is null then
    raise exception 'Evento não encontrado';
  end if;

  if not public.can_manage_matches(v_group_id) then
    raise exception 'Sem permissão para editar este evento';
  end if;

  if v_starts_at <= now() then
    raise exception 'Eventos já iniciados não podem ser editados';
  end if;

  if p_max_players not between 4 and 60 then
    raise exception 'Quantidade máxima de jogadores inválida';
  end if;

  if p_players_per_team is not null and p_players_per_team not between 2 and 11 then
    raise exception 'Quantidade de jogadores por time inválida';
  end if;

  if p_duration_minutes not between 15 and 480 then
    raise exception 'A duração do evento deve ficar entre 15 e 480 minutos';
  end if;

  update public.matches
  set max_players = p_max_players,
      players_per_team = p_players_per_team,
      duration_minutes = p_duration_minutes,
      notes = left(coalesce(p_notes, ''), 2000),
      updated_at = now()
  where id = p_match_id;

  -- Apenas mudanças de capacidade invalidam separações antigas. Alterar somente observações preserva os times.
  if v_old_max_players is distinct from p_max_players
     or v_old_players_per_team is distinct from p_players_per_team then
    delete from public.team_assignments where match_id = p_match_id;
    v_assignments_cleared := true;
  end if;

  insert into public.app_logs(user_id, group_id, event_type, severity, metadata)
  values (
    auth.uid(), v_group_id, 'match_settings_updated', 'info',
    jsonb_build_object(
      'match_id', p_match_id,
      'max_players', p_max_players,
      'players_per_team', p_players_per_team,
      'duration_minutes', p_duration_minutes,
      'assignments_cleared', v_assignments_cleared
    )
  );

  return jsonb_build_object(
    'match_id', p_match_id,
    'max_players', p_max_players,
    'players_per_team', p_players_per_team,
    'duration_minutes', p_duration_minutes,
    'assignments_cleared', v_assignments_cleared
  );
end;
$$;

-- Exclui o resultado do sorteio sem excluir o evento.
create or replace function public.clear_match_waitlist_draw(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_starts_at timestamptz;
  v_draw_id uuid;
  v_restored integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  select m.group_id, m.starts_at, m.waitlist_draw_id
  into v_group_id, v_starts_at, v_draw_id
  from public.matches m
  where m.id = p_match_id
  for update;

  if v_group_id is null then
    raise exception 'Evento não encontrado';
  end if;

  if not public.can_manage_matches(v_group_id) then
    raise exception 'Sem permissão para excluir este sorteio';
  end if;

  if v_starts_at <= now() then
    raise exception 'O sorteio de um evento já iniciado não pode ser excluído';
  end if;

  if v_draw_id is null then
    raise exception 'Este evento não possui sorteio realizado';
  end if;

  update public.match_attendance
  set status = 'confirmed',
      waitlist_position = null,
      waitlist_reason = null,
      waitlist_draw_id = null,
      status_changed_by = auth.uid(),
      status_changed_at = now(),
      status_change_source = 'system'
  where match_id = p_match_id
    and status = 'waitlist';

  get diagnostics v_restored = row_count;

  update public.matches
  set waitlist_draw_id = null,
      waitlist_drawn_at = null,
      waitlist_drawn_by = null,
      updated_at = now()
  where id = p_match_id;

  delete from public.team_assignments where match_id = p_match_id;

  insert into public.app_logs(user_id, group_id, event_type, severity, metadata)
  values (
    auth.uid(), v_group_id, 'waitlist_draw_cleared', 'info',
    jsonb_build_object(
      'match_id', p_match_id,
      'draw_id', v_draw_id,
      'restored_players', v_restored
    )
  );

  return jsonb_build_object(
    'match_id', p_match_id,
    'cleared_draw_id', v_draw_id,
    'restored_players', v_restored
  );
end;
$$;

-- A separação passa a respeitar a quantidade de times salva no evento.
create or replace function public.balance_match_teams(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_players_per_team integer;
  v_requested_team_count integer;
  v_player_count integer;
  v_team_count integer;
  v_team_no integer;
  v_team_name text;
  v_designated boolean;
  rec record;
begin
  select m.group_id, m.players_per_team, m.team_count
  into v_group, v_players_per_team, v_requested_team_count
  from public.matches m
  where m.id = p_match_id;

  if v_group is null then
    raise exception 'Jogo não encontrado';
  end if;

  if not public.can_manage_matches(v_group) then
    raise exception 'Sem permissão para formar os times';
  end if;

  select count(*) into v_player_count
  from public.match_attendance a
  join public.players p on p.id = a.player_id
  where a.match_id = p_match_id
    and a.status = 'confirmed'
    and p.active is true;

  if v_player_count < 2 then
    raise exception 'São necessários pelo menos dois jogadores confirmados';
  end if;

  v_team_count := coalesce(
    v_requested_team_count,
    case
      when v_players_per_team is not null then greatest(2, ceil(v_player_count::numeric / greatest(v_players_per_team, 2))::integer)
      else 2
    end
  );

  if v_team_count not between 2 and 12 then
    raise exception 'Quantidade de times inválida';
  end if;

  if v_team_count > v_player_count then
    raise exception 'A quantidade de times não pode superar a quantidade de jogadores confirmados';
  end if;

  create temporary table tmp_tamoon_teams (
    team_no integer primary key,
    team_name text not null,
    player_count integer not null default 0,
    total_score numeric not null default 0,
    goalkeeper_filled integer not null default 0
  ) on commit drop;

  create temporary table tmp_tamoon_assignments (
    player_id uuid primary key,
    team_no integer not null,
    primary_position text,
    score numeric not null,
    assigned_goalkeeper boolean not null default false
  ) on commit drop;

  for v_team_no in 1..v_team_count loop
    v_team_name := case v_team_no
      when 1 then 'Time Verde'
      when 2 then 'Time Azul'
      when 3 then 'Time Laranja'
      when 4 then 'Time Branco'
      when 5 then 'Time Preto'
      when 6 then 'Time Amarelo'
      when 7 then 'Time Vermelho'
      when 8 then 'Time Roxo'
      when 9 then 'Time Cinza'
      when 10 then 'Time Rosa'
      when 11 then 'Time Marrom'
      when 12 then 'Time Ciano'
      else 'Time ' || v_team_no::text
    end;
    insert into tmp_tamoon_teams(team_no, team_name) values(v_team_no, v_team_name);
  end loop;

  -- Primeira prioridade: goleiros de posição principal.
  for rec in
    select
      p.id as player_id,
      p.primary_position,
      coalesce(avg(mr.score), p.skill * 2, 7)::numeric(6,3) as balance_score
    from public.match_attendance a
    join public.players p on p.id = a.player_id
    left join public.member_ratings mr
      on mr.group_id = p.group_id and mr.rated_player_id = p.id
    where a.match_id = p_match_id
      and a.status = 'confirmed'
      and p.active is true
      and p.primary_position = 'Goleiro'
    group by p.id, p.primary_position, p.skill, p.name
    order by balance_score desc, p.name
  loop
    select t.team_no, (t.goalkeeper_filled = 0)
    into v_team_no, v_designated
    from tmp_tamoon_teams t
    order by
      t.goalkeeper_filled asc,
      t.player_count asc,
      (select count(*) from tmp_tamoon_assignments a
       where a.team_no = t.team_no and a.primary_position = rec.primary_position) asc,
      t.total_score asc,
      t.team_no asc
    limit 1;

    insert into tmp_tamoon_assignments(player_id, team_no, primary_position, score, assigned_goalkeeper)
    values(rec.player_id, v_team_no, rec.primary_position, rec.balance_score, v_designated);

    update tmp_tamoon_teams
    set player_count = player_count + 1,
        total_score = total_score + rec.balance_score,
        goalkeeper_filled = goalkeeper_filled + case when v_designated then 1 else 0 end
    where team_no = v_team_no;
  end loop;

  -- Segunda prioridade: jogadores de linha que também podem jogar no gol.
  for rec in
    select
      p.id as player_id,
      p.primary_position,
      coalesce(avg(mr.score), p.skill * 2, 7)::numeric(6,3) as balance_score
    from public.match_attendance a
    join public.players p on p.id = a.player_id
    left join public.member_ratings mr
      on mr.group_id = p.group_id and mr.rated_player_id = p.id
    where a.match_id = p_match_id
      and a.status = 'confirmed'
      and p.active is true
      and p.primary_position <> 'Goleiro'
      and p.goalkeeper is true
    group by p.id, p.primary_position, p.skill, p.name
    order by balance_score desc, p.name
  loop
    select t.team_no, (t.goalkeeper_filled = 0)
    into v_team_no, v_designated
    from tmp_tamoon_teams t
    order by
      t.goalkeeper_filled asc,
      t.player_count asc,
      (select count(*) from tmp_tamoon_assignments a
       where a.team_no = t.team_no and a.primary_position = rec.primary_position) asc,
      t.total_score asc,
      t.team_no asc
    limit 1;

    insert into tmp_tamoon_assignments(player_id, team_no, primary_position, score, assigned_goalkeeper)
    values(rec.player_id, v_team_no, rec.primary_position, rec.balance_score, v_designated);

    update tmp_tamoon_teams
    set player_count = player_count + 1,
        total_score = total_score + rec.balance_score,
        goalkeeper_filled = goalkeeper_filled + case when v_designated then 1 else 0 end
    where team_no = v_team_no;
  end loop;

  -- Demais jogadores: equilíbrio por quantidade, repetição de posição e nota.
  for rec in
    select
      p.id as player_id,
      p.primary_position,
      coalesce(avg(mr.score), p.skill * 2, 7)::numeric(6,3) as balance_score
    from public.match_attendance a
    join public.players p on p.id = a.player_id
    left join public.member_ratings mr
      on mr.group_id = p.group_id and mr.rated_player_id = p.id
    where a.match_id = p_match_id
      and a.status = 'confirmed'
      and p.active is true
      and p.primary_position <> 'Goleiro'
      and p.goalkeeper is not true
    group by p.id, p.primary_position, p.skill, p.name
    order by balance_score desc, p.name
  loop
    select t.team_no
    into v_team_no
    from tmp_tamoon_teams t
    order by
      t.player_count asc,
      (select count(*) from tmp_tamoon_assignments a
       where a.team_no = t.team_no and a.primary_position = rec.primary_position) asc,
      t.total_score asc,
      t.team_no asc
    limit 1;

    insert into tmp_tamoon_assignments(player_id, team_no, primary_position, score, assigned_goalkeeper)
    values(rec.player_id, v_team_no, rec.primary_position, rec.balance_score, false);

    update tmp_tamoon_teams
    set player_count = player_count + 1,
        total_score = total_score + rec.balance_score
    where team_no = v_team_no;
  end loop;

  delete from public.team_assignments where match_id = p_match_id;

  insert into public.team_assignments(
    group_id,
    match_id,
    player_id,
    team_name,
    slot,
    assigned_goalkeeper
  )
  select
    v_group,
    p_match_id,
    a.player_id,
    t.team_name,
    (row_number() over(
      partition by a.team_no
      order by a.assigned_goalkeeper desc, a.score desc, a.player_id
    ))::integer,
    a.assigned_goalkeeper
  from tmp_tamoon_assignments a
  join tmp_tamoon_teams t on t.team_no = a.team_no;
end;
$$;

-- Salva a escolha da aba Times e executa a separação na mesma transação.
create or replace function public.balance_match_teams_with_count(
  p_match_id uuid,
  p_team_count integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_player_count integer;
  v_starts_at timestamptz;
  v_duration_minutes integer;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  select m.group_id, m.starts_at, m.duration_minutes, m.status
  into v_group_id, v_starts_at, v_duration_minutes, v_status
  from public.matches m
  where m.id = p_match_id
  for update;

  if v_group_id is null then
    raise exception 'Evento não encontrado';
  end if;

  if not public.can_manage_matches(v_group_id) then
    raise exception 'Sem permissão para formar os times';
  end if;

  if v_status in ('cancelled', 'finished') then
    raise exception 'O evento não está disponível para separar times';
  end if;

  if now() >= v_starts_at + (v_duration_minutes * interval '1 minute' / 2) then
    raise exception 'O prazo para separar os times foi encerrado';
  end if;

  select count(*)::integer
  into v_player_count
  from public.match_attendance a
  join public.players p on p.id = a.player_id
  where a.match_id = p_match_id
    and a.status = 'confirmed'
    and p.active is true;

  if p_team_count not between 2 and 12 then
    raise exception 'A quantidade de times deve ficar entre 2 e 12';
  end if;

  if p_team_count > v_player_count then
    raise exception 'A quantidade de times não pode superar a quantidade de jogadores confirmados';
  end if;

  update public.matches
  set team_count = p_team_count,
      updated_at = now()
  where id = p_match_id;

  perform public.balance_match_teams(p_match_id);

  insert into public.app_logs(user_id, group_id, event_type, severity, metadata)
  values (
    auth.uid(), v_group_id, 'match_teams_balanced', 'info',
    jsonb_build_object(
      'match_id', p_match_id,
      'team_count', p_team_count,
      'confirmed_players', v_player_count
    )
  );
end;
$$;

revoke all on function public.create_match_schedule(uuid,text,timestamptz,integer,text,integer,integer,boolean,numeric,text,integer) from public;
grant execute on function public.create_match_schedule(uuid,text,timestamptz,integer,text,integer,integer,boolean,numeric,text,integer) to authenticated;

revoke all on function public.update_match_settings(uuid,integer,integer,integer,text) from public;
grant execute on function public.update_match_settings(uuid,integer,integer,integer,text) to authenticated;

revoke all on function public.clear_match_waitlist_draw(uuid) from public;
grant execute on function public.clear_match_waitlist_draw(uuid) to authenticated;

revoke all on function public.balance_match_teams(uuid) from public;
revoke execute on function public.balance_match_teams(uuid) from authenticated;

revoke all on function public.balance_match_teams_with_count(uuid,integer) from public;
grant execute on function public.balance_match_teams_with_count(uuid,integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Beta 1.0 Build 146 — convidados reutilizáveis e histórico imutável
-- ---------------------------------------------------------------------------

-- A participação do convidado continua vinculada a um único evento, enquanto
-- guest_profile_id preserva a identidade entre convites sucessivos.
alter table public.players
  add column if not exists guest_match_id uuid
  references public.matches(id) on delete cascade;

alter table public.players
  add column if not exists guest_profile_id uuid;

alter table public.players
  add column if not exists guest_history_archived_at timestamptz;

create index if not exists players_guest_match_idx
  on public.players(group_id, guest_match_id)
  where guest_match_id is not null;

create index if not exists players_guest_profile_idx
  on public.players(group_id, guest_profile_id)
  where guest_profile_id is not null;

create index if not exists players_guest_history_active_idx
  on public.players(group_id, guest_match_id)
  where guest_match_id is not null
    and guest_history_archived_at is null;

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

drop trigger if exists players_protect_match_guest_history
  on public.players;

create trigger players_protect_match_guest_history
before insert or update or delete on public.players
for each row
execute function public.protect_match_guest_history();

-- RPCs completos para instalações novas do banco consolidado.
create or replace function public.create_match_guest(
  p_match_id uuid,
  p_name text,
  p_nickname text default '',
  p_primary_position text default 'Coringa',
  p_goalkeeper boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_player_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  select m.* into v_match
  from public.matches m
  where m.id = p_match_id;

  if not found then
    raise exception 'Evento não encontrado';
  end if;

  if not public.can_manage_matches(v_match.group_id) then
    raise exception 'Sem permissão para incluir convidados neste evento';
  end if;

  if v_match.status in ('cancelled', 'finished')
     or now() >= v_match.starts_at
       + (coalesce(v_match.duration_minutes, 60) * interval '1 minute' / 2) then
    raise exception 'O evento não aceita mais convidados';
  end if;

  if char_length(trim(coalesce(p_name, ''))) not between 2 and 80 then
    raise exception 'Nome do convidado inválido';
  end if;

  if char_length(trim(coalesce(p_nickname, ''))) > 40 then
    raise exception 'Apelido do convidado inválido';
  end if;

  if p_primary_position not in ('Goleiro','Zagueiro','Lateral','Meia','Atacante','Coringa') then
    raise exception 'Posição do convidado inválida';
  end if;

  insert into public.players(
    group_id,
    user_id,
    name,
    nickname,
    primary_position,
    goalkeeper,
    active,
    guest_match_id
  )
  values (
    v_match.group_id,
    null,
    trim(p_name),
    nullif(trim(coalesce(p_nickname, '')), ''),
    p_primary_position,
    coalesce(p_goalkeeper, false) or p_primary_position = 'Goleiro',
    true,
    p_match_id
  )
  returning id into v_player_id;

  insert into public.match_attendance(group_id, match_id, player_id, status)
  values (v_match.group_id, p_match_id, v_player_id, 'confirmed');

  return v_player_id;
end;
$$;

create or replace function public.update_match_guest(
  p_player_id uuid,
  p_name text,
  p_nickname text default '',
  p_primary_position text default 'Coringa',
  p_goalkeeper boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest public.players%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  select p.* into v_guest
  from public.players p
  where p.id = p_player_id
    and p.guest_match_id is not null
  for update;

  if not found then
    raise exception 'Convidado não encontrado';
  end if;

  if not public.can_manage_matches(v_guest.group_id) then
    raise exception 'Sem permissão para alterar este convidado';
  end if;

  if char_length(trim(coalesce(p_name, ''))) not between 2 and 80 then
    raise exception 'Nome do convidado inválido';
  end if;

  if char_length(trim(coalesce(p_nickname, ''))) > 40 then
    raise exception 'Apelido do convidado inválido';
  end if;

  if p_primary_position not in ('Goleiro','Zagueiro','Lateral','Meia','Atacante','Coringa') then
    raise exception 'Posição do convidado inválida';
  end if;

  update public.players
  set name = trim(p_name),
      nickname = nullif(trim(coalesce(p_nickname, '')), ''),
      primary_position = p_primary_position,
      goalkeeper = coalesce(p_goalkeeper, false) or p_primary_position = 'Goleiro',
      updated_at = now()
  where id = p_player_id;

  return p_player_id;
end;
$$;

create or replace function public.delete_match_guest(p_player_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest public.players%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  select p.* into v_guest
  from public.players p
  where p.id = p_player_id
    and p.guest_match_id is not null
  for update;

  if not found then
    raise exception 'Convidado não encontrado';
  end if;

  if not public.can_manage_matches(v_guest.group_id) then
    raise exception 'Sem permissão para excluir este convidado';
  end if;

  delete from public.players
  where id = p_player_id;

  return p_player_id;
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
    raise exception 'Selecione um convidado de um evento já encerrado';
  end if;

  if not public.can_manage_matches(v_group_id) then
    raise exception 'Sem permissão para incluir convidados neste grupo';
  end if;

  select m.* into v_target
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

  select p.* into v_source
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

  insert into public.match_attendance(group_id, match_id, player_id, status)
  values (v_group_id, p_match_id, v_new_player_id, 'confirmed');

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

revoke all on function public.assign_match_guest_profile_id() from public;
revoke all on function public.assign_match_guest_profile_id() from anon;
revoke all on function public.assign_match_guest_profile_id() from authenticated;
revoke all on function public.protect_match_guest_history() from public;
revoke all on function public.protect_match_guest_history() from anon;
revoke all on function public.protect_match_guest_history() from authenticated;

revoke all on function public.create_match_guest(uuid,text,text,text,boolean) from public;
grant execute on function public.create_match_guest(uuid,text,text,text,boolean) to authenticated;

revoke all on function public.update_match_guest(uuid,text,text,text,boolean) from public;
grant execute on function public.update_match_guest(uuid,text,text,text,boolean) to authenticated;

revoke all on function public.delete_match_guest(uuid) from public;
grant execute on function public.delete_match_guest(uuid) to authenticated;

revoke all on function public.remove_match_guest_record(uuid) from public;
revoke all on function public.remove_match_guest_record(uuid) from anon;
revoke all on function public.remove_match_guest_record(uuid) from authenticated;
grant execute on function public.remove_match_guest_record(uuid) to authenticated;

revoke all on function public.reinvite_match_guest(uuid,uuid) from public;
revoke all on function public.reinvite_match_guest(uuid,uuid) from anon;
revoke all on function public.reinvite_match_guest(uuid,uuid) from authenticated;
grant execute on function public.reinvite_match_guest(uuid,uuid) to authenticated;

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
on conflict (channel, build) do update set
  version = excluded.version,
  database_build = excluded.database_build,
  edge_build = excluded.edge_build,
  active = excluded.active,
  mandatory = excluded.mandatory,
  notes = excluded.notes,
  released_at = now();

update public.app_releases
set active = false
where channel = 'beta' and build < 147;

commit;

-- ===========================================================================
-- Beta 1.0 Build 148 — contador de avisos e presença sem "Talvez"
-- ===========================================================================

begin;

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

-- O tipo "maybe" permanece aceito somente para compatibilidade com registros
-- antigos; a Build 148 não o apresenta nem o envia pela interface.

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
on conflict (channel, build) do update set
  version = excluded.version,
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

-- ===========================================================================
-- Beta 1.0 Build 149 — caixa individual para todas as notificações
-- ===========================================================================

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
on conflict (channel, build) do update set
  version = excluded.version,
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

-- ===========================================================================
-- Beta 1.0 Build 150 — leitura coletiva e compartilhamento da lista
-- ===========================================================================

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
on conflict (channel, build) do update set
  version = excluded.version,
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


-- Build 157 / Banco 149 — documentos e aceite
-- Tâmo On Build 157 / Banco 149. Instalação sem ativar a exigência jurídica.
-- A ativação depende da data de vigência e da publicação do frontend e das Edges.
begin;
create schema if not exists tamoon_legal;
revoke all on schema tamoon_legal from public;
grant usage on schema tamoon_legal to anon, authenticated, service_role;

create table if not exists tamoon_legal.settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 previous_hook regprocedure,
 activated_at timestamptz
);
insert into tamoon_legal.settings(singleton) values(true) on conflict do nothing;
create table if not exists tamoon_legal.documents (
 id uuid primary key default gen_random_uuid(),
 document_type text not null check(document_type in ('terms','privacy','conduct')),
 version text not null,
 title text not null,
 content_html text not null,
 content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
 source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 source_filename text not null,
 locale text not null default 'pt-BR',
 public_url text not null check(public_url like '/legal/%'),
 effective_at timestamptz,
 published_at timestamptz,
 active boolean not null default false,
 created_at timestamptz not null default now(),
 unique(document_type,version),
 check(not active or (effective_at is not null and published_at is not null))
);
create unique index if not exists legal_one_active_type on tamoon_legal.documents(document_type) where active;
-- Sem FK destrutiva para auth.users: preservar a prova após encerramento da conta.
create table if not exists tamoon_legal.subjects (
 user_id uuid primary key,
 adult_declared_at timestamptz not null,
 age_statement text not null default 'Declaro ter 18 anos completos ou mais.',
 relationship_ended_at timestamptz,
 retention_hold boolean not null default false
);
create table if not exists tamoon_legal.acceptances (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references tamoon_legal.subjects(user_id),
 legal_document_id uuid not null references tamoon_legal.documents(id),
 accepted_at timestamptz not null default now(),
 app_build integer not null check(app_build >= 157),
 document_type text not null,
 document_version text not null,
 content_hash text not null,
 effective_at timestamptz not null,
 user_agent text,
 locale text not null default 'pt-BR',
 source text not null check(source in ('web','pwa','mobile')),
 evidence_metadata jsonb not null,
 unique(user_id,legal_document_id)
);
create table if not exists tamoon_legal.audit (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid,
 subject_id uuid,
 event_type text not null,
 purpose text not null,
 created_at timestamptz not null default now()
);
-- Sem permissões diretas, inclusive para a chave de serviço. Somente as RPCs previstas.
revoke all on all tables in schema tamoon_legal from public, anon, authenticated, service_role;
alter table tamoon_legal.settings enable row level security;
alter table tamoon_legal.documents enable row level security;
alter table tamoon_legal.subjects enable row level security;
alter table tamoon_legal.acceptances enable row level security;
alter table tamoon_legal.audit enable row level security;

create or replace function tamoon_legal.protect_document()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
 if TG_OP = 'DELETE' then raise exception 'Versões jurídicas devem permanecer arquivadas'; end if;
 if old.published_at is not null and
   (to_jsonb(new) - 'active') is distinct from (to_jsonb(old) - 'active') then
   raise exception 'Documento publicado é imutável; crie nova versão';
 end if;
 return new;
end; $$;
drop trigger if exists legal_document_immutable on tamoon_legal.documents;
create trigger legal_document_immutable before update or delete on tamoon_legal.documents
for each row execute function tamoon_legal.protect_document();

create or replace function tamoon_legal.protect_acceptance()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
 if TG_OP = 'DELETE' and current_user = 'postgres' and exists(
   select 1 from tamoon_legal.subjects s where s.user_id=old.user_id
   and s.relationship_ended_at < now()-interval '5 years' and not s.retention_hold
 ) then return old; end if;
 raise exception 'Registro de aceite é imutável durante a retenção';
end; $$;
drop trigger if exists legal_acceptance_immutable on tamoon_legal.acceptances;
create trigger legal_acceptance_immutable before update or delete on tamoon_legal.acceptances
for each row execute function tamoon_legal.protect_acceptance();

create or replace function tamoon_legal.has_access(p_user_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select (not coalesce((select enabled from tamoon_legal.settings where singleton),true)) or (
 p_user_id is not null and exists(select 1 from tamoon_legal.subjects where user_id=p_user_id and relationship_ended_at is null)
 and (select count(*) from tamoon_legal.documents where active and effective_at<=now())=3
 and not exists(select 1 from tamoon_legal.documents d where d.active and d.effective_at<=now()
   and not exists(select 1 from tamoon_legal.acceptances a where a.user_id=p_user_id
   and a.legal_document_id=d.id and a.content_hash=d.content_hash))
 );
$$;
create or replace function tamoon_legal.current_user_has_access()
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select tamoon_legal.has_access(auth.uid());
$$;
revoke all on function tamoon_legal.has_access(uuid) from public,anon,authenticated,service_role;
revoke all on function tamoon_legal.current_user_has_access() from public;
grant execute on function tamoon_legal.current_user_has_access() to anon,authenticated;

-- Monitor periódico leve: não transfere os textos completos a cada verificação.
create or replace function public.get_community_legal_access_status()
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('enabled',s.enabled,'allowed',tamoon_legal.has_access(auth.uid()))
 from tamoon_legal.settings s where singleton;
$$;
revoke all on function public.get_community_legal_access_status() from public,anon;
grant execute on function public.get_community_legal_access_status() to authenticated;

create or replace function public.get_community_legal_status()
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('enabled',s.enabled,'allowed',tamoon_legal.has_access(auth.uid()),
 'adult_declared',exists(select 1 from tamoon_legal.subjects where user_id=auth.uid() and relationship_ended_at is null),
 'documents',coalesce((select jsonb_agg(jsonb_build_object(
   'id',d.id,'document_type',d.document_type,'version',d.version,'title',d.title,
   'content_html',d.content_html,'content_hash',d.content_hash,'public_url',d.public_url,
   'effective_at',d.effective_at,'locale',d.locale,'published',d.published_at is not null,
   'accepted_at',(select a.accepted_at from tamoon_legal.acceptances a where a.user_id=auth.uid() and a.legal_document_id=d.id)
 ) order by d.document_type) from tamoon_legal.documents d
 where (d.active and d.effective_at<=now()) or
 (not s.enabled and d.version='1.2' and d.published_at is null)), '[]'::jsonb))
 from tamoon_legal.settings s where singleton;
$$;

create or replace function public.get_community_legal_document(p_document_type text,p_version text)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('document_type',d.document_type,'version',d.version,'title',d.title,
   'content_hash',d.content_hash,'effective_at',d.effective_at,'published',d.published_at is not null)
 from tamoon_legal.documents d where d.document_type=p_document_type and d.version=p_version
 and (d.published_at is not null or d.version='1.2');
$$;
revoke all on function public.get_community_legal_document(text,text) from public;
grant execute on function public.get_community_legal_document(text,text) to anon,authenticated;

create or replace function public.accept_community_legal_documents(
 p_documents jsonb, p_adult boolean, p_terms boolean, p_privacy boolean, p_conduct boolean,
 p_app_build integer, p_source text default 'web'
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_user uuid := auth.uid(); v_doc tamoon_legal.documents; v_headers jsonb;
begin
 if v_user is null then raise exception 'Sessão não autenticada'; end if;
 perform 1 from tamoon_legal.settings where singleton and enabled for share;
 if not found then raise exception 'A exigência de aceite ainda não foi ativada'; end if;
 if p_adult is distinct from true then raise exception 'Uso permitido somente a pessoas com 18 anos completos ou mais'; end if;
 if p_terms is distinct from true or p_privacy is distinct from true or p_conduct is distinct from true then
   raise exception 'Confirme os três documentos obrigatórios'; end if;
 if p_app_build is null or p_app_build<157 or p_source is null or p_source not in ('web','pwa','mobile') then
   raise exception 'Origem do aceite inválida'; end if;
 if p_documents is null or jsonb_typeof(p_documents)<>'array' then raise exception 'Documentos inválidos'; end if;
 if jsonb_array_length(p_documents)<>3 then raise exception 'São necessários os três documentos vigentes'; end if;
 -- Bloqueio consistente com a ativação e com tentativas simultâneas do mesmo usuário.
 perform pg_advisory_xact_lock(hashtextextended(v_user::text,157));
 perform 1 from tamoon_legal.documents where active for share;
 if (select count(*) from tamoon_legal.documents where active and effective_at<=now())<>3 then
   raise exception 'Documentos vigentes indisponíveis'; end if;
 for v_doc in select * from tamoon_legal.documents where active and effective_at<=now() loop
  if (select count(*) from jsonb_array_elements(p_documents) x
    where x->>'id'=v_doc.id::text and x->>'content_hash'=v_doc.content_hash and x->>'version'=v_doc.version)<>1 then
    raise exception 'Os documentos foram atualizados. Reabra a tela antes de aceitar'; end if;
 end loop;
 v_headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 insert into tamoon_legal.subjects(user_id,adult_declared_at) values(v_user,now()) on conflict do nothing;
 if exists(select 1 from tamoon_legal.subjects where user_id=v_user and relationship_ended_at is not null) then
   raise exception 'Conta encerrada'; end if;
 insert into tamoon_legal.acceptances(user_id,legal_document_id,app_build,document_type,document_version,content_hash,effective_at,user_agent,source,evidence_metadata)
 select v_user,d.id,p_app_build,d.document_type,d.version,d.content_hash,d.effective_at,
   left(v_headers->>'user-agent',300),p_source,
   jsonb_build_object('adult_self_declaration',true,'statement','Declaro ter 18 anos completos ou mais.',
     'terms_agreed',true,'privacy_acknowledged',true,'conduct_agreed',true,'source_docx_hash',d.source_hash)
 from tamoon_legal.documents d where d.active and d.effective_at<=now()
 on conflict(user_id,legal_document_id) do nothing;
 return public.get_community_legal_status();
end; $$;

-- Função para Edge Functions; o cliente não pode consultar o aceite de terceiros.
create or replace function public.community_legal_access_for_user(p_user_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select tamoon_legal.has_access(p_user_id);
$$;
revoke all on function public.community_legal_access_for_user(uuid) from public,anon,authenticated;
grant execute on function public.community_legal_access_for_user(uuid) to service_role;

create or replace function tamoon_legal.export_evidence(p_user_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('user_id',p_user_id,'adult_declaration',
 (select jsonb_build_object('declared_at',adult_declared_at,'statement',age_statement,'relationship_ended_at',relationship_ended_at)
 from tamoon_legal.subjects where user_id=p_user_id), 'acceptances',coalesce((
 select jsonb_agg(to_jsonb(a)||jsonb_build_object('title',d.title,'public_url',d.public_url,'content_html',d.content_html,'source_filename',d.source_filename,'source_hash',d.source_hash) order by a.accepted_at)
 from tamoon_legal.acceptances a join tamoon_legal.documents d on d.id=a.legal_document_id where a.user_id=p_user_id),'[]'::jsonb));
$$;
create or replace function public.export_my_legal_acceptances()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 if auth.uid() is null then raise exception 'Sessão não autenticada'; end if;
 return tamoon_legal.export_evidence(auth.uid());
end; $$;
create or replace function public.platform_export_legal_acceptances(p_user_id uuid,p_purpose text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 if auth.uid() is null or not public.is_platform_admin() or not tamoon_legal.has_access(auth.uid()) then
   raise exception 'Acesso restrito à administração com aceite vigente'; end if;
 if p_user_id is null or char_length(trim(coalesce(p_purpose,''))) not between 10 and 500 then
   raise exception 'Informe o usuário e o motivo da consulta (10 a 500 caracteres)'; end if;
 insert into tamoon_legal.audit(actor_id,subject_id,event_type,purpose)
 values(auth.uid(),p_user_id,'evidence_export',trim(p_purpose));
 return tamoon_legal.export_evidence(p_user_id);
end; $$;

create or replace function tamoon_legal.end_relationship()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 update tamoon_legal.subjects set relationship_ended_at=coalesce(relationship_ended_at,now()) where user_id=old.id;
 return old;
end; $$;
drop trigger if exists legal_end_relationship on auth.users;
create trigger legal_end_relationship before delete on auth.users for each row execute function tamoon_legal.end_relationship();
create or replace function tamoon_legal.purge_expired_evidence()
returns bigint language plpgsql security definer set search_path=pg_catalog as $$
declare v_count bigint;
begin
 delete from tamoon_legal.acceptances a using tamoon_legal.subjects s
 where s.user_id=a.user_id and s.relationship_ended_at<now()-interval '5 years' and not s.retention_hold;
 get diagnostics v_count=row_count;
 delete from tamoon_legal.audit a using tamoon_legal.subjects s
 where s.user_id=a.subject_id and s.relationship_ended_at<now()-interval '5 years' and not s.retention_hold;
 delete from tamoon_legal.subjects s where relationship_ended_at<now()-interval '5 years' and not retention_hold;
 return v_count;
end; $$;

-- Gate de todas as rotas REST, inclusive RPCs SECURITY DEFINER e views legadas.
create or replace function tamoon_legal.check_request()
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare v_previous regprocedure; v_name text; v_path text;
begin
 select previous_hook into v_previous from tamoon_legal.settings where singleton;
 if v_previous is not null then
  select format('%I.%I',n.nspname,p.proname) into v_name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid=v_previous::oid;
  if v_name is not null then execute 'select '||v_name||'()'; end if;
 end if;
 if auth.role()='service_role' then return; end if;
 v_path:=trim(both '/' from coalesce(current_setting('request.path',true),''));
 if v_path in ('rpc/get_community_legal_access_status','rpc/get_community_legal_status','rpc/get_community_legal_document','rpc/accept_community_legal_documents','rpc/export_my_legal_acceptances','rpc/claim_beta_access') then return; end if;
 if not tamoon_legal.has_access(auth.uid()) then
   raise sqlstate 'PT403' using message='LEGAL_ACCEPTANCE_REQUIRED',hint='Confirme a maioridade e os documentos vigentes no Tâmo On';
 end if;
end; $$;

-- Preserva o hook anterior, sem substituir silenciosamente validações já existentes.
do $$
declare v_previous text;
begin
 select substr(setting,length('pgrst.db_pre_request=')+1) into v_previous
 from pg_db_role_setting s cross join lateral unnest(s.setconfig) setting
 where s.setrole=(select oid from pg_roles where rolname='authenticator')
 and s.setdatabase in (0,(select oid from pg_database where datname=current_database()))
 and setting like 'pgrst.db_pre_request=%' order by s.setdatabase desc limit 1;
 if nullif(v_previous,'') is not null and v_previous<>'tamoon_legal.check_request' then
  if to_regprocedure(v_previous||'()') is null then raise exception 'Hook REST anterior não localizado: %',v_previous; end if;
  update tamoon_legal.settings set previous_hook=to_regprocedure(v_previous||'()') where singleton;
 end if;
 execute format('alter role authenticator in database %I set pgrst.db_pre_request = %L',current_database(),'tamoon_legal.check_request');
end; $$;

-- RLS também protege assinaturas Realtime; as permissões existentes continuam valendo.
do $$
declare t record;
begin
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity
 and c.relname not in ('app_releases','beta_access','platform_admins') loop
   execute format('drop policy if exists community_legal_gate on public.%I',t.relname);
   execute format('create policy community_legal_gate on public.%I as restrictive for all to authenticated using ((select tamoon_legal.current_user_has_access())) with check ((select tamoon_legal.current_user_has_access()))',t.relname);
 end loop;
end; $$;

revoke all on all functions in schema tamoon_legal from public,anon,authenticated,service_role;
grant execute on function tamoon_legal.current_user_has_access() to authenticated,anon;
grant execute on function tamoon_legal.check_request() to authenticated,anon,service_role;
revoke all on function public.get_community_legal_status() from public;
grant execute on function public.get_community_legal_status() to anon,authenticated;
revoke all on function public.accept_community_legal_documents(jsonb,boolean,boolean,boolean,boolean,integer,text) from public,anon;
grant execute on function public.accept_community_legal_documents(jsonb,boolean,boolean,boolean,boolean,integer,text) to authenticated;
revoke all on function public.export_my_legal_acceptances() from public,anon;
grant execute on function public.export_my_legal_acceptances() to authenticated;
revoke all on function public.platform_export_legal_acceptances(uuid,text) from public,anon;
grant execute on function public.platform_export_legal_acceptances(uuid,text) to authenticated;

-- Defesa adicional nas RPCs PL/pgSQL usadas pelo app, inclusive chamadas sem REST.
create or replace function tamoon_legal.require_access()
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if auth.role()='service_role' then return; end if;
 if not tamoon_legal.has_access(auth.uid()) then
   raise sqlstate 'PT403' using message='LEGAL_ACCEPTANCE_REQUIRED';
 end if;
end; $$;
revoke all on function tamoon_legal.require_access() from public,anon,authenticated,service_role;
create table if not exists tamoon_legal.guarded_rpcs(signature text primary key);
revoke all on tamoon_legal.guarded_rpcs from public,anon,authenticated,service_role;
alter table tamoon_legal.guarded_rpcs enable row level security;
do $guard$
declare p record; v_source text;
begin
 for p in select f.oid,f.prosrc,pg_get_functiondef(f.oid) as definition,f.oid::regprocedure::text as signature
 from pg_proc f join pg_namespace n on n.oid=f.pronamespace join pg_language l on l.oid=f.prolang
 where n.nspname='public' and l.lanname='plpgsql' and f.prosecdef
 and f.proname=any(array['balance_match_teams_with_count','clear_match_team_assignments','clear_match_waitlist_draw','create_batch_charges','create_group','create_match_guest','create_match_schedule','delete_announcement','delete_finance_entry','delete_group_permanently','delete_scheduled_match','delete_scheduled_match_series','draw_match_waitlist_v2','join_group_by_code','manage_match_attendance_batch','mark_all_user_notifications_read','mark_group_announcements_read','mark_user_notifications_read','platform_beta_access_invite','platform_beta_access_list','platform_beta_access_set_status','platform_beta_summary','platform_error_details','platform_error_groups','platform_group_export','platform_operational_export','platform_push_delivery_attempts_v2','platform_push_health_list_v2','platform_recent_feedback','platform_recent_logs','platform_security_summary','record_batch_payments','record_payment','reinvite_match_guest','remove_group_member','remove_match_guest_record','remove_push_subscription','save_push_subscription','set_member_role','set_my_match_attendance','set_my_match_bbq_response','set_my_match_game_response','submit_beta_feedback','transfer_group_administration','update_group_settings','update_match_bbq_settings','update_match_guest','update_match_settings','update_my_player_profile','update_my_profile','upsert_member_rating']) loop
  if position('perform tamoon_legal.require_access();' in p.prosrc)=0 then
   v_source:=regexp_replace(p.prosrc,'(^|\n)([ \t]*)begin([ \t]*\r?\n)',E'\\1\\2begin\\3  perform tamoon_legal.require_access();\n','i');
   if v_source=p.prosrc then raise exception 'Não foi possível proteger a RPC %',p.signature; end if;
   execute replace(p.definition,p.prosrc,v_source);
  end if;
  insert into tamoon_legal.guarded_rpcs(signature) values(p.signature) on conflict do nothing;
 end loop;
end; $guard$;

-- Somente SQL Editor/operador do banco pode ativar a versão. Sem acesso via cliente.
create or replace function tamoon_legal.activate_v1_2(p_effective_at timestamptz)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if p_effective_at is null then raise exception 'Defina expressamente a data de vigência antes de ativar'; end if;
 if p_effective_at>now() then raise exception 'Execute a ativação a partir da data de vigência'; end if;
 if p_effective_at<'2026-09-11 00:00:00-03'::timestamptz then raise exception 'A vigência não pode anteceder os documentos v1.2'; end if;
 perform 1 from tamoon_legal.settings where singleton for update;
 if (select count(*) from tamoon_legal.documents where version='1.2')<>3 then raise exception 'Os três documentos v1.2 são necessários'; end if;
 if exists(select 1 from tamoon_legal.documents where version='1.2' and published_at is not null and effective_at is distinct from p_effective_at) then raise exception 'Vigência publicada é imutável'; end if;
 if exists(select 1 from tamoon_legal.documents where active and version<>'1.2') then raise exception 'Uma versão posterior já está ativa'; end if;
 update tamoon_legal.documents set effective_at=p_effective_at,published_at=now(),active=true where version='1.2' and published_at is null;
 if (select count(*) from tamoon_legal.documents where version='1.2' and active)<>3 then raise exception 'Não reative uma versão arquivada'; end if;
 update tamoon_legal.settings set enabled=true,activated_at=coalesce(activated_at,now()) where singleton;
 insert into tamoon_legal.audit(event_type,purpose) values('legal_activation','Ativação v1.2 com vigência '||p_effective_at::text);
end; $$;
revoke all on function tamoon_legal.activate_v1_2(timestamptz) from public,anon,authenticated,service_role;

insert into tamoon_legal.documents(document_type,version,title,content_html,content_hash,source_hash,source_filename,locale,public_url)
select j->>'document_type',j->>'version',j->>'title',j->>'content_html',j->>'content_hash',j->>'source_hash',j->>'source_filename',j->>'locale',j->>'public_url'
from (select $legaljson${"document_type": "terms", "version": "1.2", "title": "Termos de Uso", "content_html": "<h2>1. Identificação do responsável</h2>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Campo</th><th>Informação</th></tr><tr><td>Nome empresarial / controlador</td><td>TAMO ON TECNOLOGIA E INTERMEDIACAO LTDA</td></tr><tr><td>Nome fantasia</td><td>Tâmo On</td></tr><tr><td>CNPJ</td><td>69.074.880/0001-47</td></tr><tr><td>Endereço</td><td>Rua Visconde de Abaeté, nº 34, apto. 101, térreo, Bloco A, Condomínio Ilha das Peças Residencial, Bairro Alto, Curitiba/PR, CEP 82820-210</td></tr><tr><td>Domínio oficial</td><td>tamoon.app.br</td></tr><tr><td>Canal institucional</td><td>contato@tamoon.app.br</td></tr><tr><td>Canal de suporte</td><td>suporte@tamoon.app.br</td></tr><tr><td>Canal de privacidade/LGPD</td><td>privacidade@tamoon.app.br</td></tr><tr><td>Encarregado ou canal equivalente</td><td>Canal equivalente: privacidade@tamoon.app.br. Encarregado formal não indicado nesta fase, sujeito à confirmação do enquadramento regulatório aplicável.</td></tr></table></div>\n<h2>2. Aceitação e vínculo contratual</h2>\n<p>Ao criar ou acessar uma conta e marcar as opções de aceite, o usuário declara que leu e concorda com estes Termos, com o Código de Conduta e que tomou ciência da Política de Privacidade. O aceite eletrônico será registrado com versão, data, usuário, hash do conteúdo e informações técnicas proporcionais à comprovação.</p>\n<p>O acesso poderá ser bloqueado até que o usuário aceite a versão vigente. Consentimentos opcionais, como notificações push ou comunicações promocionais futuras, serão tratados separadamente.</p>\n<h2>3. Elegibilidade</h2>\n<p>O Tâmo On será disponibilizado, no lançamento, exclusivamente para pessoas com 18 anos ou mais e capazes de praticar atos da vida civil. A admissão de menores dependerá de alteração formal destes documentos e implantação de salvaguardas específicas.</p>\n<h2>4. Conta e autenticação</h2>\n<p>o acesso é individual e vinculado à conta autenticada admitida pela plataforma;</p>\n<p>o usuário deve manter sua conta e dispositivo protegidos e não compartilhar acesso;</p>\n<p>informações de perfil devem ser verdadeiras, atualizadas e não podem imitar terceiros;</p>\n<p>atividades realizadas por conta autenticada poderão ser atribuídas ao respectivo titular, sem prejuízo da investigação de fraude;</p>\n<p>o usuário deve comunicar perda, invasão, uso indevido ou mudança de controle da conta.</p>\n<h2>5. Finalidade e funcionalidades</h2>\n<p>O Tâmo On é uma ferramenta de organização de grupos esportivos, especialmente partidas e eventos recreativos. Pode oferecer criação de grupos, convites, papéis administrativos, agenda, confirmações, lista de espera, convidados, sorteio, separação de times, churrasco, avaliações, avisos, notificações e registros financeiros internos.</p>\n<p>Na versão Comunidade atualmente prevista para o beta aberto, o Tâmo On não organiza fisicamente os eventos, não administra quadras, não presta serviço médico, não garante presença, desempenho ou segurança esportiva e não substitui acordos legítimos entre os participantes.</p>\n<h2>6. Papéis e permissões nos grupos</h2>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Papel</th><th>Responsabilidades gerais</th></tr><tr><td>Administrador</td><td>Controla o grupo, funções, integrantes, configurações e permissões disponíveis.</td></tr><tr><td>Organizador</td><td>Gerencia eventos, presença, convidados, espera, times e avisos conforme permissões.</td></tr><tr><td>Tesoureiro</td><td>Registra e consulta cobranças, pagamentos e despesas do grupo.</td></tr><tr><td>Membro</td><td>Participa de grupos, responde presença, consulta informações permitidas e utiliza recursos liberados.</td></tr></table></div>\n<h2>7. Responsabilidades de administradores e organizadores</h2>\n<p>convidar apenas pessoas legitimamente relacionadas ao grupo e proteger códigos de convite;</p>\n<p>informar convidados sobre o cadastro e inserir somente o mínimo necessário;</p>\n<p>não utilizar posições, avaliações ou presença para constranger, discriminar ou expor membros;</p>\n<p>usar cobranças e despesas apenas para finalidades reais do grupo;</p>\n<p>aplicar regras internas de forma proporcional e compatível com o Código de Conduta;</p>\n<p>cumprir regras do local, segurança, horários e obrigações assumidas fora da plataforma.</p>\n<h2>8. Convidados e dados de terceiros</h2>\n<p>Ao cadastrar convidado ou inserir dado de terceiro, o usuário declara possuir autorização ou fundamento legítimo para fazê-lo e deverá informar a pessoa, de forma razoável, sobre o uso dos dados. O cadastro deve ser mínimo e vinculado à finalidade específica. O convidado poderá exercer direitos de correção, exclusão, oposição e informação pelo canal de privacidade/LGPD.</p>\n<h2>9. Módulo financeiro da Comunidade</h2>\n<p>Na versão atual, o módulo Caixa é um registro organizacional. O Tâmo On não recebe, guarda ou transfere dinheiro por esse módulo, não processa cartão ou Pix, não atua como instituição financeira, cobrador, bureau de crédito ou garantidor de dívida. Os usuários são responsáveis por conferir valores, comprovantes e pagamentos realizados fora da plataforma.</p>\n<p>A futura ativação de marketplace, reservas comerciais e processamento de pagamentos constituirá alteração material do serviço e dependerá de termos específicos ou atualização destes Termos, da Política de Privacidade e dos demais instrumentos, com novo aceite quando aplicável.</p>\n<h2>10. Avaliações e formação de times</h2>\n<p>Avaliações devem refletir critérios esportivos e ser feitas de boa-fé. É proibido usar notas para humilhar, retaliar, discriminar ou perseguir. O algoritmo pode considerar posições, goleiros e médias para sugerir equilíbrio, sem garantia de resultado perfeito. Pedidos de revisão poderão ser encaminhados ao suporte quando houver indício de abuso, erro ou impacto indevido.</p>\n<h2>11. Notificações e comunicações</h2>\n<p>Notificações dependem do sistema operacional, dispositivo, conexão, permissões e serviços de terceiros. A plataforma não garante entrega instantânea ou integral. Mensagens essenciais poderão ser exibidas dentro do aplicativo.</p>\n<h2>12. Fase beta, disponibilidade e alterações</h2>\n<p>Durante a fase beta, funcionalidades podem ser alteradas, suspensas ou removidas, podendo ocorrer erros, indisponibilidades e necessidade de atualização. Serão adotadas medidas razoáveis de continuidade e segurança, sem garantia de disponibilidade ininterrupta. Mudanças materiais serão comunicadas quando possível.</p>\n<h2>13. Conteúdo e propriedade intelectual</h2>\n<p>A marca Tâmo On, identidade visual, código, interfaces, textos e demais elementos protegidos pertencem ao responsável ou a seus licenciantes. O usuário recebe licença limitada, revogável, não exclusiva e intransferível para uso legítimo da plataforma.</p>\n<p>Conteúdos inseridos pelo usuário permanecem sob sua responsabilidade. O usuário concede ao Tâmo On licença limitada para armazenar, processar, exibir e transmitir esses conteúdos exclusivamente na medida necessária para operar, proteger e melhorar o serviço.</p>\n<h2>14. Condutas proibidas</h2>\n<p>É obrigatório cumprir o Código de Conduta. São vedados, entre outros, fraude, assédio, discriminação, ameaças, exposição indevida de dados, invasão, manipulação de registros, spam, conteúdo ilegal, falsidade de identidade, uso automatizado não autorizado e tentativas de contornar sanções.</p>\n<h2>15. Moderação, exclusão de grupo, restrição, suspensão e banimento</h2>\n<p>As medidas abaixo têm naturezas e consequências distintas:</p>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Medida</th><th>Alcance</th></tr><tr><td>Exclusão de um grupo</td><td>Remove o usuário apenas daquele grupo. Não implica, por si só, suspensão da conta ou banimento do Tâmo On.</td></tr><tr><td>Restrição funcional</td><td>Limita temporariamente uma ou mais funções específicas, como publicar, convidar, cobrar, avaliar ou administrar.</td></tr><tr><td>Suspensão temporária da conta</td><td>Impede o acesso à plataforma por prazo determinado, conforme gravidade, risco e reincidência.</td></tr><tr><td>Banimento definitivo</td><td>Encerra o acesso à plataforma e pode impedir nova conta quando houver fundamento proporcional e compatível com o Código de Conduta.</td></tr></table></div>\n<p>Em situações graves ou de risco concreto poderá haver suspensão preventiva enquanto os fatos são apurados. Sempre que razoável e seguro, será informado o motivo e disponibilizada possibilidade de revisão humana.</p>\n<h2>16. Encerramento da conta e dados</h2>\n<p>O usuário poderá solicitar encerramento da conta. A eliminação dos dados observará a Política de Privacidade, direitos de terceiros, registros de segurança, prazos de retenção e obrigações legais aplicáveis.</p>\n<h2>17. Responsabilidade e limites legais</h2>\n<p>Cada usuário e grupo é responsável por suas decisões, eventos, relações financeiras externas e condutas. O Tâmo On responderá nos limites da legislação aplicável e não exclui responsabilidades que não possam ser legalmente afastadas. Não haverá responsabilidade por danos decorrentes exclusivamente de informações falsas inseridas por usuários, falhas de terceiros, uso indevido do dispositivo ou descumprimento destas regras, salvo quando houver dever legal de indenizar.</p>\n<h2>18. Privacidade</h2>\n<p>O tratamento de dados pessoais é regido pela Política de Privacidade e Uso de Dados. O usuário poderá exercer seus direitos pelo canal de privacidade/LGPD.</p>\n<h2>19. Alterações dos Termos</h2>\n<p>Estes Termos poderão ser atualizados para refletir mudanças legais, técnicas ou comerciais. Alterações materiais exigirão novo aceite. A ativação de marketplace, reservas comerciais, pagamentos integrados ou mudança relevante de responsabilidade será tratada como alteração material.</p>\n<h2>20. Lei aplicável e solução de conflitos</h2>\n<p>Aplica-se a legislação brasileira. As partes buscarão solução amigável pelos canais oficiais. Quando houver relação de consumo, serão preservados os direitos do consumidor e a competência do foro legalmente aplicável, inclusive o domicílio do consumidor. Nos demais casos e quando permitido, poderá ser eleito o foro de Curitiba/PR.</p>\n<h2>21. Contato</h2>\n<p>Canal institucional: contato@tamoon.app.br</p>\n<p>Suporte: suporte@tamoon.app.br</p>\n<p>Privacidade/LGPD: privacidade@tamoon.app.br</p>\n<h2>Referências normativas consideradas</h2>\n<p>Lei nº 13.709/2018 - Lei Geral de Proteção de Dados Pessoais (LGPD).</p>\n<p>Lei nº 12.965/2014 - Marco Civil da Internet.</p>\n<p>Decreto nº 8.771/2016 - regulamentação do Marco Civil da Internet.</p>\n<p>Lei nº 8.078/1990 - Código de Defesa do Consumidor, quando caracterizada relação de consumo.</p>\n<p>Resolução CD/ANPD nº 15/2024 - Comunicação de Incidente de Segurança.</p>\n<p>Resolução CD/ANPD nº 18/2024 - Atuação do encarregado pelo tratamento de dados pessoais.</p>\n<p>Resolução CD/ANPD nº 19/2024 e alterações aplicáveis - Transferência Internacional de Dados.</p>\n<p>Resolução CD/ANPD nº 2/2022 - Agentes de tratamento de pequeno porte, quando aplicável.</p>\n<p>Enunciado CD/ANPD nº 1/2023 - tratamento de dados de crianças e adolescentes.</p>\n<p>Orientações e guias vigentes da ANPD sobre direitos dos titulares, avisos de privacidade, legítimo interesse e segurança da informação.</p>", "content_hash": "874d70951a2b6037717cae9dd937175ec16380139f37c53400b3b8faae9c5000", "source_hash": "0796522629d92e6bc2af8d8db65ec0f51e52686db2f73424da067e951a805bd6", "source_filename": "02-Termos-de-Uso-Tamo-On-v1.2.docx", "public_url": "/legal/termos-de-uso-v1.2.html", "locale": "pt-BR"}$legaljson$::jsonb j) s
on conflict(document_type,version) do nothing;
insert into tamoon_legal.documents(document_type,version,title,content_html,content_hash,source_hash,source_filename,locale,public_url)
select j->>'document_type',j->>'version',j->>'title',j->>'content_html',j->>'content_hash',j->>'source_hash',j->>'source_filename',j->>'locale',j->>'public_url'
from (select $legaljson${"document_type": "privacy", "version": "1.2", "title": "Política de Privacidade e Uso de Dados", "content_html": "<h2>1. Identificação do responsável</h2>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Campo</th><th>Informação</th></tr><tr><td>Nome empresarial / controlador</td><td>TAMO ON TECNOLOGIA E INTERMEDIACAO LTDA</td></tr><tr><td>Nome fantasia</td><td>Tâmo On</td></tr><tr><td>CNPJ</td><td>69.074.880/0001-47</td></tr><tr><td>Endereço</td><td>Rua Visconde de Abaeté, nº 34, apto. 101, térreo, Bloco A, Condomínio Ilha das Peças Residencial, Bairro Alto, Curitiba/PR, CEP 82820-210</td></tr><tr><td>Domínio oficial</td><td>tamoon.app.br</td></tr><tr><td>Canal institucional</td><td>contato@tamoon.app.br</td></tr><tr><td>Canal de suporte</td><td>suporte@tamoon.app.br</td></tr><tr><td>Canal de privacidade/LGPD</td><td>privacidade@tamoon.app.br</td></tr><tr><td>Encarregado ou canal equivalente</td><td>Canal equivalente: privacidade@tamoon.app.br. Encarregado formal não indicado nesta fase, sujeito à confirmação do enquadramento regulatório aplicável.</td></tr></table></div>\n<h2>2. Objetivo e abrangência</h2>\n<p>Esta Política explica como o Tâmo On coleta, utiliza, compartilha, armazena, protege e elimina dados pessoais de usuários, administradores de grupos, organizadores, tesoureiros, membros, convidados e pessoas que utilizem os canais oficiais. Aplica-se ao aplicativo móvel, à versão web/PWA enquanto disponibilizada, ao site institucional e aos serviços diretamente relacionados à plataforma.</p>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Resumo da fase atual<br>O Tâmo On não vende dados pessoais. Na versão atual destinada à Comunidade, o módulo Caixa possui finalidade organizacional e não processa Pix, cartão ou transferências bancárias. A futura ativação de marketplace, reservas comerciais ou processamento de pagamentos será considerada alteração material e exigirá revisão desta Política, da Matriz Interna e dos demais documentos antes da disponibilização da funcionalidade.</th></tr></table></div>\n<h2>3. Princípios de proteção de dados</h2>\n<p>O tratamento observará finalidade, adequação, necessidade, livre acesso, qualidade dos dados, transparência, segurança, prevenção, não discriminação e responsabilização. O Tâmo On buscará tratar apenas dados compatíveis com funcionalidades legítimas e informadas, com acesso limitado às pessoas e sistemas que necessitem dessas informações.</p>\n<h2>4. Dados pessoais tratados</h2>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Categoria</th><th>Exemplos</th><th>Origem</th></tr><tr><td>Conta e autenticação</td><td>Nome, e-mail, identificador Google, foto de perfil e metadados mínimos de autenticação.</td><td>Usuário e provedor de autenticação.</td></tr><tr><td>Perfil esportivo</td><td>Nome, apelido, posições, indicação de goleiro, papel no grupo e foto.</td><td>Usuário ou administrador autorizado.</td></tr><tr><td>Grupos e eventos</td><td>Grupo, integrantes, funções, datas, locais, presença, espera, times, churrasco, acompanhantes, avisos e observações.</td><td>Usuários e administradores/organizadores.</td></tr><tr><td>Avaliações e balanceamento</td><td>Notas confidenciais, médias internas e resultados usados para sugestões de equilíbrio.</td><td>Membros autorizados e processamento interno.</td></tr><tr><td>Convidados</td><td>Nome ou apelido, posição e vínculo com evento específico; outros dados somente se estritamente necessários.</td><td>Administrador ou organizador que cadastra o convidado.</td></tr><tr><td>Registros financeiros internos</td><td>Cobranças, pagamentos, despesas, valores, vencimentos, descrições e vínculo com participante.</td><td>Administrador ou tesoureiro.</td></tr><tr><td>Notificações</td><td>Token/endpoint push, chaves técnicas, dispositivo, sistema, status de autorização e histórico técnico de envio.</td><td>Dispositivo, sistema operacional e usuário.</td></tr><tr><td>Dados técnicos e segurança</td><td>IP quando registrado, data/hora, user-agent, versão/build, erros, diagnósticos, eventos de segurança e auditoria.</td><td>Uso da plataforma e infraestrutura.</td></tr><tr><td>Suporte e beta</td><td>Relatos, sugestões, anexos, categoria do problema, autorização de contato e contexto técnico.</td><td>Usuário.</td></tr><tr><td>Armazenamento local</td><td>Sessão, preferências, grupo selecionado, cache e dados necessários à experiência.</td><td>Dispositivo/aplicativo.</td></tr></table></div>\n<h2>5. Finalidades e bases legais</h2>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Finalidade</th><th>Base legal principal</th></tr><tr><td>Criar e manter a conta, autenticar, controlar acesso, integridade e segurança.</td><td>Execução de contrato/procedimentos preliminares; legítimo interesse; prevenção à fraude; exercício regular de direitos.</td></tr><tr><td>Criar grupos, gerenciar membros, eventos, presença, espera, times e convidados.</td><td>Execução de contrato; legítimo interesse relacionado à organização do grupo.</td></tr><tr><td>Manter registros financeiros internos do grupo.</td><td>Execução de contrato; legítimo interesse; exercício regular de direitos.</td></tr><tr><td>Enviar notificações solicitadas pelo usuário.</td><td>Consentimento/ação específica para ativação e execução do serviço solicitado.</td></tr><tr><td>Atender suporte, corrigir erros, gerar métricas de produto e prevenir abusos.</td><td>Legítimo interesse, sujeito a teste de balanceamento e minimização; execução de contrato.</td></tr><tr><td>Cumprir deveres legais, atender autoridades e defender direitos.</td><td>Cumprimento de obrigação legal/regulatória; exercício regular de direitos.</td></tr><tr><td>Produzir estatísticas agregadas.</td><td>Legítimo interesse; quando efetivamente anonimizadas, fora do escopo da LGPD.</td></tr></table></div>\n<p>O aceite desta Política comprova ciência e transparência, mas não transforma todas as operações em tratamento baseado em consentimento. Consentimentos opcionais, como push ou futuras comunicações promocionais, serão solicitados separadamente e poderão ser revogados.</p>\n<h2>6. Dados sensíveis e informações não solicitadas</h2>\n<p>O Tâmo On não solicita deliberadamente dados pessoais sensíveis para as funcionalidades atuais. O usuário não deve inserir, em campos livres ou suporte, informações de saúde, biometria, religião, origem racial ou étnica, opinião política, filiação sindical, vida sexual ou outras informações sensíveis, salvo quando houver orientação específica, finalidade legítima e base legal adequada.</p>\n<h2>7. Cadastro de convidados</h2>\n<p>O cadastro de convidado deve utilizar a menor quantidade de dados possível e permanecer vinculado a evento ou finalidade determinada. Quem realizar o cadastro deverá possuir autorização ou fundamento legítimo e informar o convidado, de forma razoável, de que seus dados foram inseridos no Tâmo On.</p>\n<p>o convidado poderá solicitar correção, exclusão, oposição ou esclarecimentos pelos canais de privacidade/LGPD;</p>\n<p>dados de convidado não poderão ser reutilizados para marketing, perseguição, exposição ou finalidade incompatível;</p>\n<p>encerrada a finalidade, os dados serão eliminados ou reduzidos ao mínimo necessário para histórico legítimo, segurança ou exercício de direitos;</p>\n<p>se o convidado posteriormente criar conta, a vinculação de dados deverá ocorrer de forma controlada, evitando duplicidade ou atribuição incorreta.</p>\n<h2>8. Avaliações, perfilamento esportivo e revisão humana</h2>\n<p>Posições, disponibilidade de goleiros e médias de avaliações podem ser utilizadas para sugerir ou formar times. Trata-se de perfilamento recreativo/esportivo, sem finalidade jurídica, trabalhista, creditícia ou de saúde.</p>\n<p>as avaliações individuais devem permanecer confidenciais e acessíveis apenas a quem possua permissão compatível;</p>\n<p>o titular poderá solicitar correção de dados objetivos e esclarecimento sobre o funcionamento geral do balanceamento;</p>\n<p>quando houver alegação plausível de erro, abuso, discriminação ou impacto indevido, será disponibilizada revisão humana;</p>\n<p>é vedado utilizar avaliações para discriminar, retaliar, humilhar ou produzir exposição indevida.</p>\n<h2>9. Compartilhamento, operadores e fornecedores</h2>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Fornecedor/categoria</th><th>Finalidade</th><th>Dados típicos</th><th>Situação</th></tr><tr><td>Google</td><td>Autenticação e serviços associados.</td><td>Dados básicos autorizados de conta e metadados técnicos.</td><td>Fornecedor atual; condições e documentos contratuais devem ser mantidos arquivados.</td></tr><tr><td>Supabase</td><td>Banco de dados, autenticação complementar, backend e funções.</td><td>Dados de conta, grupos, eventos, registros e logs conforme a função.</td><td>Fornecedor atual; acessos e região contratada devem ser documentados.</td></tr><tr><td>Cloudflare</td><td>Hospedagem, distribuição, segurança e desempenho.</td><td>IP, requisições, conteúdo estático e metadados técnicos.</td><td>Fornecedor atual; configurações e mecanismos de transferência devem ser documentados.</td></tr><tr><td>Provedores de push / sistema operacional</td><td>Entrega de notificações.</td><td>Token/endpoint e metadados técnicos necessários.</td><td>Tratamento limitado à entrega e diagnóstico.</td></tr><tr><td>Google Play / Apple App Store</td><td>Distribuição do aplicativo e serviços próprios da loja.</td><td>Dados tratados pelas lojas conforme suas políticas e, quando aplicável, diagnósticos técnicos.</td><td>Cada provedor possui responsabilidades próprias; integrações do app devem ser inventariadas.</td></tr><tr><td>Prestadores jurídicos, contábeis, técnicos e de segurança</td><td>Suporte profissional necessário.</td><td>Somente dados pertinentes à demanda.</td><td>Acesso pontual, com confidencialidade e necessidade.</td></tr></table></div>\n<p>O Tâmo On não comercializa bancos de dados pessoais. Autoridades públicas poderão receber informações quando houver obrigação legal, ordem válida ou necessidade de exercício regular de direitos.</p>\n<h2>10. Transferências internacionais</h2>\n<p>Alguns fornecedores de nuvem, autenticação, distribuição, hospedagem e notificação podem tratar dados fora do Brasil. Antes da abertura pública, o controlador manterá inventário dos fluxos internacionais, identificará o papel de cada fornecedor e documentará o mecanismo jurídico aplicável, conforme a LGPD e a regulamentação da ANPD. A transferência deverá observar necessidade, segurança e limitação de finalidade.</p>\n<h2>11. Retenção e exclusão</h2>\n<p>A tabela abaixo representa a política operacional pretendida e deverá corresponder às rotinas efetivamente implementadas no sistema antes da publicação.</p>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Dado/registro</th><th>Prazo ou evento principal</th><th>Evento de exclusão</th><th>Exceções</th></tr><tr><td>Conta e perfil</td><td>Enquanto a conta estiver ativa.</td><td>Pedido válido de exclusão ou encerramento; exclusão operacional em até 30 dias após conclusão do fluxo.</td><td>Obrigação legal, prevenção à fraude, segurança e exercício de direitos.</td></tr><tr><td>Associação a grupos e papéis</td><td>Enquanto houver vínculo ativo + até 12 meses para auditoria mínima.</td><td>Fim do vínculo + decurso do prazo.</td><td>Registros indispensáveis a direitos de terceiros ou apuração de abuso.</td></tr><tr><td>Eventos, presença e histórico</td><td>Até 24 meses após o evento, salvo histórico necessário ao grupo.</td><td>Fim do prazo ou exclusão válida do grupo.</td><td>Litígio, fraude, segurança ou obrigação legal.</td></tr><tr><td>Convidados</td><td>Até 90 dias após o evento.</td><td>Fim do prazo ou solicitação válida anterior.</td><td>Necessidade comprovada de histórico, segurança ou exercício de direitos.</td></tr><tr><td>Avaliações esportivas</td><td>Enquanto houver vínculo ativo + até 12 meses.</td><td>Fim do vínculo e do prazo.</td><td>Apuração de abuso ou defesa de direitos.</td></tr><tr><td>Financeiro interno</td><td>Até 5 anos após o último registro relacionado, como política conservadora de defesa de direitos, sujeita à validação contábil/jurídica.</td><td>Fim do prazo.</td><td>Obrigação legal ou disputa em curso.</td></tr><tr><td>Push</td><td>Até revogação, logout definitivo, endpoint inválido ou encerramento da conta.</td><td>Evento técnico ou revogação.</td><td>Logs mínimos de segurança, quando necessários.</td></tr><tr><td>Logs de acesso à aplicação</td><td>6 meses quando aplicável o art. 15 do Marco Civil.</td><td>Decurso do prazo.</td><td>Ordem legal, investigação de fraude ou exercício de direitos.</td></tr><tr><td>Feedback e diagnóstico beta</td><td>Até 12 meses.</td><td>Fim do prazo.</td><td>Investigação, segurança ou correção ainda em curso.</td></tr><tr><td>Backups</td><td>Ciclo técnico com expurgo preferencial em até 90 dias após exclusão operacional.</td><td>Substituição/expurgo do backup.</td><td>Necessidade técnica temporária, com acesso restrito.</td></tr><tr><td>Aceites legais</td><td>Durante a relação + 5 anos após encerramento, como política de defesa contratual.</td><td>Fim do prazo.</td><td>Litígio ou obrigação legal.</td></tr></table></div>\n<h2>12. Segurança da informação</h2>\n<p>Serão adotadas medidas técnicas e administrativas proporcionais aos riscos, incluindo autenticação por provedor confiável, criptografia em trânsito, segregação de permissões, políticas de acesso ao banco, registros de auditoria, atualização do aplicativo, proteção de credenciais e limitação de privilégios. A existência dessas medidas será validada tecnicamente antes da abertura pública.</p>\n<h2>13. Incidentes de segurança</h2>\n<p>O Tâmo On manterá procedimento interno de resposta a incidentes com as etapas: identificação, contenção, preservação de evidências, análise, classificação de risco, comunicação, correção, registro e lições aprendidas. Quando houver risco ou dano relevante e forem preenchidos os requisitos legais, serão realizadas as comunicações aplicáveis à ANPD e aos titulares.</p>\n<h2>14. Direitos dos titulares</h2>\n<p>confirmação da existência de tratamento e acesso;</p>\n<p>correção de dados incompletos, inexatos ou desatualizados;</p>\n<p>anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade;</p>\n<p>portabilidade, quando regulamentada e tecnicamente aplicável;</p>\n<p>informação sobre compartilhamentos e sobre consequências da recusa quando o dado for necessário;</p>\n<p>revogação de consentimento e eliminação dos dados tratados com essa base, ressalvadas exceções legais;</p>\n<p>oposição a tratamento irregular baseado em outra hipótese legal;</p>\n<p>revisão e explicação de decisões exclusivamente automatizadas que afetem interesses relevantes;</p>\n<p>petição perante a ANPD e órgãos de defesa do consumidor, quando cabível.</p>\n<p>Solicitações serão recebidas pelo canal de privacidade/LGPD. Poderá ser exigida verificação proporcional de identidade. O procedimento interno registrará pedido, identidade verificada, categoria do direito, responsáveis, prazo, resposta e eventual fundamento para retenção.</p>\n<h2>15. Armazenamento local, cookies e notificações</h2>\n<p>O aplicativo poderá utilizar armazenamento local, cache, service worker enquanto aplicável, tokens de sessão e tecnologias equivalentes para autenticação, preferências, funcionamento e desempenho. Notificações push somente serão ativadas após ação expressa do usuário e poderão ser desativadas no aplicativo ou no sistema operacional.</p>\n<h2>16. Crianças e adolescentes</h2>\n<p>No lançamento, o Tâmo On será destinado exclusivamente a pessoas com 18 anos ou mais. A admissão de menores dependerá de revisão prévia do produto e desta documentação, com salvaguardas específicas, linguagem apropriada, mecanismos relacionados a responsáveis e observância do melhor interesse.</p>\n<h2>17. Alterações e futuras funcionalidades</h2>\n<p>Esta Política possui versão e data de vigência. Alterações materiais serão comunicadas e poderão exigir novo aceite. A ativação de marketplace, reservas comerciais, processamento de Pix/cartão, compartilhamento de dados com instituição de pagamento, publicidade comportamental ou nova finalidade relevante exigirá revisão jurídica e técnica prévia e atualização da Matriz Interna.</p>\n<h2>18. Contato</h2>\n<p>Canal institucional: contato@tamoon.app.br</p>\n<p>Suporte: suporte@tamoon.app.br</p>\n<p>Privacidade e direitos LGPD: privacidade@tamoon.app.br</p>\n<h2>Referências normativas consideradas</h2>\n<p>Lei nº 13.709/2018 - Lei Geral de Proteção de Dados Pessoais (LGPD).</p>\n<p>Lei nº 12.965/2014 - Marco Civil da Internet.</p>\n<p>Decreto nº 8.771/2016 - regulamentação do Marco Civil da Internet.</p>\n<p>Lei nº 8.078/1990 - Código de Defesa do Consumidor, quando caracterizada relação de consumo.</p>\n<p>Resolução CD/ANPD nº 15/2024 - Comunicação de Incidente de Segurança.</p>\n<p>Resolução CD/ANPD nº 18/2024 - Atuação do encarregado pelo tratamento de dados pessoais.</p>\n<p>Resolução CD/ANPD nº 19/2024 e alterações aplicáveis - Transferência Internacional de Dados.</p>\n<p>Resolução CD/ANPD nº 2/2022 - Agentes de tratamento de pequeno porte, quando aplicável.</p>\n<p>Enunciado CD/ANPD nº 1/2023 - tratamento de dados de crianças e adolescentes.</p>\n<p>Orientações e guias vigentes da ANPD sobre direitos dos titulares, avisos de privacidade, legítimo interesse e segurança da informação.</p>", "content_hash": "b219aabcfeaf7f60ff93735457ce7d9e77507d4d7c7f62a16175ca689e47e8fa", "source_hash": "410ea5f15e1b6ad91acb91b0f90b36b9a1440415a1bc1f388652b90c95290a76", "source_filename": "01-Politica-de-Privacidade-e-Uso-de-Dados-Tamo-On-v1.2.docx", "public_url": "/legal/privacidade-v1.2.html", "locale": "pt-BR"}$legaljson$::jsonb j) s
on conflict(document_type,version) do nothing;
insert into tamoon_legal.documents(document_type,version,title,content_html,content_hash,source_hash,source_filename,locale,public_url)
select j->>'document_type',j->>'version',j->>'title',j->>'content_html',j->>'content_hash',j->>'source_hash',j->>'source_filename',j->>'locale',j->>'public_url'
from (select $legaljson${"document_type": "conduct", "version": "1.2", "title": "Código de Conduta, Moderação e Banimento", "content_html": "<h2>1. Identificação do responsável</h2>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Campo</th><th>Informação</th></tr><tr><td>Nome empresarial / controlador</td><td>TAMO ON TECNOLOGIA E INTERMEDIACAO LTDA</td></tr><tr><td>Nome fantasia</td><td>Tâmo On</td></tr><tr><td>CNPJ</td><td>69.074.880/0001-47</td></tr><tr><td>Endereço</td><td>Rua Visconde de Abaeté, nº 34, apto. 101, térreo, Bloco A, Condomínio Ilha das Peças Residencial, Bairro Alto, Curitiba/PR, CEP 82820-210</td></tr><tr><td>Domínio oficial</td><td>tamoon.app.br</td></tr><tr><td>Canal institucional</td><td>contato@tamoon.app.br</td></tr><tr><td>Canal de suporte</td><td>suporte@tamoon.app.br</td></tr><tr><td>Canal de privacidade/LGPD</td><td>privacidade@tamoon.app.br</td></tr><tr><td>Encarregado ou canal equivalente</td><td>Canal equivalente: privacidade@tamoon.app.br. Encarregado formal não indicado nesta fase, sujeito à confirmação do enquadramento regulatório aplicável.</td></tr></table></div>\n<h2>2. Objetivo</h2>\n<p>Este Código busca manter o Tâmo On seguro, respeitoso e confiável. Aplica-se a contas, grupos, eventos, avaliações, avisos, convidados, registros financeiros internos, suporte e condutas externas diretamente relacionadas à plataforma quando produzirem risco concreto para usuários ou para o serviço.</p>\n<h2>3. Valores esperados</h2>\n<p>respeito e espírito esportivo</p>\n<p>honestidade e boa-fé</p>\n<p>inclusão e não discriminação</p>\n<p>privacidade e uso responsável de dados</p>\n<p>segurança física e digital</p>\n<p>responsabilidade financeira</p>\n<p>colaboração na solução de conflitos</p>\n<h2>4. Condutas esperadas</h2>\n<p>usar nome e informações verdadeiras</p>\n<p>cumprir confirmações ou avisar mudanças com antecedência razoável</p>\n<p>respeitar decisões legítimas dos responsáveis pelo grupo</p>\n<p>avaliar membros de forma esportiva, objetiva e confidencial</p>\n<p>registrar cobranças e pagamentos internos com descrição e valor corretos</p>\n<p>proteger códigos de convite, contas e dados pessoais</p>\n<p>reportar falhas de segurança sem explorá-las ou divulgá-las indevidamente</p>\n<h2>5. Proibições</h2>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Categoria</th><th>Exemplos</th></tr><tr><td>Assédio e violência</td><td>Ameaças, intimidação, perseguição, chantagem, humilhação reiterada, incentivo à violência ou exposição de endereço/rotina.</td></tr><tr><td>Discriminação e ódio</td><td>Ataques ou exclusão abusiva por característica protegida ou condição pessoal.</td></tr><tr><td>Exploração sexual ou de menores</td><td>Conteúdo sexual envolvendo menores, aliciamento, exploração ou material ilegal.</td></tr><tr><td>Fraude e falsidade</td><td>Perfis falsos, personificação, cobranças inexistentes, comprovantes falsos ou manipulação de presenças, avaliações e funções.</td></tr><tr><td>Privacidade e exposição</td><td>Coletar ou divulgar dados, fotos, mensagens, localização, documentos ou informações financeiras sem legitimidade.</td></tr><tr><td>Ataques técnicos</td><td>Invadir, extrair dados, usar bots, burlar permissões, explorar vulnerabilidades, distribuir malware ou prejudicar disponibilidade.</td></tr><tr><td>Spam e abuso comercial</td><td>Mensagens repetitivas, propaganda não autorizada, links enganosos ou uso da plataforma para esquema ilícito.</td></tr><tr><td>Conteúdo ilegal ou perigoso</td><td>Extorsão, atividade criminosa, incitação a violência grave ou uso da plataforma para finalidade ilícita.</td></tr><tr><td>Evasão de sanção</td><td>Criar nova conta, usar conta de terceiro ou manipular identidade para contornar suspensão ou banimento.</td></tr><tr><td>Retaliação</td><td>Punir, ameaçar ou perseguir pessoa que tenha reportado problema de boa-fé.</td></tr></table></div>\n<h2>6. Avaliações e times</h2>\n<p>notas devem considerar desempenho esportivo e contribuição para a partida</p>\n<p>é proibida avaliação retaliatória, discriminatória ou coordenada para prejudicar alguém</p>\n<p>não se deve revelar nota individual confidencial nem tentar identificar avaliadores por intimidação</p>\n<p>administradores não podem manipular dados ou times mediante vantagem indevida</p>\n<p>erros ou suspeitas devem ser tratados pelos canais apropriados, evitando exposição pública desnecessária</p>\n<h2>7. Integridade financeira</h2>\n<p>cobranças devem corresponder a despesas ou acordos reais do grupo</p>\n<p>pagamentos não devem ser marcados como realizados sem confirmação razoável</p>\n<p>é proibido usar o módulo Caixa para empréstimos ilegais, pirâmides, apostas ou cobrança abusiva</p>\n<p>divergências devem ser documentadas e tratadas de forma respeitosa</p>\n<p>o módulo financeiro da Comunidade não realiza cobrança extrajudicial, protesto ou negativação</p>\n<h2>8. Administração dos grupos</h2>\n<p>Administradores podem moderar conteúdo e excluir membros do grupo conforme regras internas, desde que não pratiquem discriminação ilícita, fraude, exposição indevida ou abuso. A exclusão de um participante de determinado grupo é uma medida local e não equivale automaticamente a sanção da conta perante o Tâmo On.</p>\n<h2>9. Princípios de moderação</h2>\n<p>proporcionalidade entre gravidade, contexto, dano, intenção e reincidência</p>\n<p>proteção preventiva quando houver risco concreto</p>\n<p>registro de evidências e motivo da medida</p>\n<p>comunicação ao usuário quando isso não aumentar o risco</p>\n<p>possibilidade de revisão humana</p>\n<p>não discriminação e tratamento consistente de casos semelhantes</p>\n<h2>10. Medidas aplicáveis e diferenças de alcance</h2>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Medida</th><th>Aplicação e alcance</th></tr><tr><td>Orientação</td><td>Esclarecimento de regra para situação leve ou inicial.</td></tr><tr><td>Advertência</td><td>Registro formal de violação e determinação de cessação.</td></tr><tr><td>Remoção/correção</td><td>Exclusão ou correção de conteúdo, cobrança, convidado, aviso ou dado irregular.</td></tr><tr><td>Exclusão de grupo</td><td>Retirada do usuário de um grupo específico por decisão legítima do administrador ou medida localizada. Não suspende a conta global.</td></tr><tr><td>Restrição funcional</td><td>Bloqueio temporário de função específica, como publicar, convidar, cobrar, avaliar ou administrar.</td></tr><tr><td>Suspensão preventiva</td><td>Bloqueio global temporário enquanto fatos graves são apurados.</td></tr><tr><td>Suspensão temporária</td><td>Perda de acesso global por prazo proporcional à violação.</td></tr><tr><td>Banimento permanente</td><td>Encerramento global da conta e proibição de novo acesso quando proporcional e justificável.</td></tr><tr><td>Comunicação externa</td><td>Preservação de provas e comunicação a autoridades, vítimas ou provedores quando necessária ou obrigatória.</td></tr></table></div>\n<h2>11. Hipóteses que podem levar a banimento imediato</h2>\n<p>exploração sexual infantil, aliciamento ou material envolvendo menores</p>\n<p>ameaça crível de morte, violência grave ou perseguição com risco concreto</p>\n<p>invasão, furto de dados, malware ou sabotagem deliberada da plataforma</p>\n<p>fraude financeira relevante, extorsão ou apropriação indevida usando o serviço</p>\n<p>divulgação maliciosa de dados pessoais que exponha alguém a risco</p>\n<p>ódio ou assédio grave, coordenado ou reincidente</p>\n<p>evasão deliberada de suspensão grave</p>\n<p>ordem judicial ou obrigação legal incompatível com a manutenção da conta</p>\n<p>A lista não é exaustiva. A plataforma avaliará gravidade, provas, contexto, risco e legislação aplicável.</p>\n<h2>12. Denúncias e preservação de provas</h2>\n<p>Denúncias devem indicar, quando possível, conta ou grupo, data, descrição e evidências. Não se deve obter prova por invasão, ameaça ou exposição adicional. O Tâmo On poderá preservar logs e conteúdos necessários à apuração, segurança e exercício de direitos.</p>\n<p>Canal de denúncia/moderação: suporte@tamoon.app.br</p>\n<h2>13. Direito de revisão</h2>\n<p>O usuário poderá pedir revisão de advertência, restrição funcional, suspensão ou banimento, apresentando contexto e evidências. O pedido deverá ser feito preferencialmente em até 15 dias da comunicação. A análise será humana e realizada em prazo razoável, sem garantia de restauração enquanto persistir risco à segurança.</p>\n<h2>14. Medidas urgentes e sigilo</h2>\n<p>Em situações de risco, a plataforma poderá agir antes de ouvir o usuário. Informações detalhadas poderão ser limitadas para proteger vítimas, denunciantes, investigações, segredos de segurança ou determinações legais.</p>\n<h2>15. Alterações</h2>\n<p>Mudanças materiais deste Código serão comunicadas e poderão exigir novo aceite. A versão aplicável será aquela vigente na data da conduta, sem prejuízo de medidas protetivas urgentes.</p>\n<h2>16. Contato</h2>\n<p>Canal institucional: contato@tamoon.app.br</p>\n<p>Suporte e moderação: suporte@tamoon.app.br</p>\n<p>Privacidade/LGPD: privacidade@tamoon.app.br</p>\n<h2>Referências normativas consideradas</h2>\n<p>Lei nº 13.709/2018 - Lei Geral de Proteção de Dados Pessoais (LGPD).</p>\n<p>Lei nº 12.965/2014 - Marco Civil da Internet.</p>\n<p>Decreto nº 8.771/2016 - regulamentação do Marco Civil da Internet.</p>\n<p>Lei nº 8.078/1990 - Código de Defesa do Consumidor, quando caracterizada relação de consumo.</p>\n<p>Resolução CD/ANPD nº 15/2024 - Comunicação de Incidente de Segurança.</p>\n<p>Resolução CD/ANPD nº 18/2024 - Atuação do encarregado pelo tratamento de dados pessoais.</p>\n<p>Resolução CD/ANPD nº 19/2024 e alterações aplicáveis - Transferência Internacional de Dados.</p>\n<p>Resolução CD/ANPD nº 2/2022 - Agentes de tratamento de pequeno porte, quando aplicável.</p>\n<p>Enunciado CD/ANPD nº 1/2023 - tratamento de dados de crianças e adolescentes.</p>\n<p>Orientações e guias vigentes da ANPD sobre direitos dos titulares, avisos de privacidade, legítimo interesse e segurança da informação.</p>", "content_hash": "14ce9b7b6993a7f6e4f991f9f74817f0786dc5fd1a3c3934a8d6ade45e0dd2fb", "source_hash": "cdf9e159a0565f81334dc7b2510f09d440891ce5634c91c939e354ff4a23acc8", "source_filename": "03-Codigo-de-Conduta-Moderacao-e-Banimento-Tamo-On-v1.2.docx", "public_url": "/legal/codigo-de-conduta-v1.2.html", "locale": "pt-BR"}$legaljson$::jsonb j) s
on conflict(document_type,version) do nothing;

do $$ begin
 if exists(select 1 from tamoon_legal.documents where encode(sha256(convert_to(content_html,'UTF8')),'hex')<>content_hash) then raise exception 'Hash jurídico divergente'; end if;
end; $$;

do $$ begin
if not exists(select 1 from tamoon_legal.documents where document_type='terms' and version='1.2' and content_hash='874d70951a2b6037717cae9dd937175ec16380139f37c53400b3b8faae9c5000' and source_hash='0796522629d92e6bc2af8d8db65ec0f51e52686db2f73424da067e951a805bd6') then raise exception 'Documento v1.2 divergente: terms'; end if;
if not exists(select 1 from tamoon_legal.documents where document_type='privacy' and version='1.2' and content_hash='b219aabcfeaf7f60ff93735457ce7d9e77507d4d7c7f62a16175ca689e47e8fa' and source_hash='410ea5f15e1b6ad91acb91b0f90b36b9a1440415a1bc1f388652b90c95290a76') then raise exception 'Documento v1.2 divergente: privacy'; end if;
if not exists(select 1 from tamoon_legal.documents where document_type='conduct' and version='1.2' and content_hash='14ce9b7b6993a7f6e4f991f9f74817f0786dc5fd1a3c3934a8d6ade45e0dd2fb' and source_hash='cdf9e159a0565f81334dc7b2510f09d440891ce5634c91c939e354ff4a23acc8') then raise exception 'Documento v1.2 divergente: conduct'; end if;
end; $$;

-- Expurgo apenas da prova jurídica após encerramento + cinco anos, sem retenção excepcional.
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
   if not exists(select 1 from cron.job where jobname='tamoon-legal-retention') then
     perform cron.schedule('tamoon-legal-retention','20 4 * * *','select tamoon_legal.purge_expired_evidence()');
   end if;
 end if;
end; $$;
insert into public.app_releases(channel,version,build,database_build,edge_build,active,mandatory,notes)
values('beta','Beta 1.0',157,149,113,true,false,'Documentos v1.2, registro de aceite e maioridade. Ativação jurídica separada.')
on conflict(channel,build) do update set database_build=excluded.database_build,edge_build=excluded.edge_build,notes=excluded.notes;
update public.app_releases set active=false where channel='beta' and build<157;
notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;

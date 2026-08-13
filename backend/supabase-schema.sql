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

-- Criação de uma pelada ou série semanal com jogadores por time opcional.
create or replace function public.create_match_schedule(
  p_group_id uuid,
  p_title text,
  p_starts_at timestamptz,
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

-- Edição limitada aos dados operacionais solicitados para uma ocorrência futura.
create or replace function public.update_match_settings(
  p_match_id uuid,
  p_max_players integer,
  p_players_per_team integer default null,
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

  update public.matches
  set max_players = p_max_players,
      players_per_team = p_players_per_team,
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
      'assignments_cleared', v_assignments_cleared
    )
  );

  return jsonb_build_object(
    'match_id', p_match_id,
    'max_players', p_max_players,
    'players_per_team', p_players_per_team,
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
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  select m.group_id
  into v_group_id
  from public.matches m
  where m.id = p_match_id
  for update;

  if v_group_id is null then
    raise exception 'Evento não encontrado';
  end if;

  if not public.can_manage_matches(v_group_id) then
    raise exception 'Sem permissão para formar os times';
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

revoke all on function public.create_match_schedule(uuid,text,timestamptz,text,integer,integer,boolean,numeric,text,integer) from public;
grant execute on function public.create_match_schedule(uuid,text,timestamptz,text,integer,integer,boolean,numeric,text,integer) to authenticated;

revoke all on function public.update_match_settings(uuid,integer,integer,text) from public;
grant execute on function public.update_match_settings(uuid,integer,integer,text) to authenticated;

revoke all on function public.clear_match_waitlist_draw(uuid) from public;
grant execute on function public.clear_match_waitlist_draw(uuid) to authenticated;

revoke all on function public.balance_match_teams(uuid) from public;
grant execute on function public.balance_match_teams(uuid) to authenticated;

revoke all on function public.balance_match_teams_with_count(uuid,integer) from public;
grant execute on function public.balance_match_teams_with_count(uuid,integer) to authenticated;

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
  131,
  131,
  106,
  true,
  false,
  'Administrador e organizador podem excluir sorteios, editar capacidade e observações, deixar jogadores por time em branco e escolher a quantidade de times na aba Times.'
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
where channel = 'beta' and build < 131;

commit;

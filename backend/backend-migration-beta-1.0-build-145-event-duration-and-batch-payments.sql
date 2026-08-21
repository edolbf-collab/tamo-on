-- Tâmo On — Beta 1.0 Build 145 / Database Build 142
-- Duração dos eventos, janela operacional até 50% da duração e ajustes
-- dos pagamentos em lote.

begin;

-- Eventos já existentes recebem a duração padrão de 60 minutos.
alter table public.matches
  add column if not exists duration_minutes integer not null default 60;

alter table public.matches
  drop constraint if exists matches_duration_minutes_check;

alter table public.matches
  add constraint matches_duration_minutes_check
  check (duration_minutes between 15 and 480);

-- Substitui a assinatura anterior para evitar RPCs ambíguas no PostgREST.
drop function if exists public.create_match_schedule(
  uuid, text, timestamptz, text, integer, integer, boolean, numeric, text, integer
);

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

drop function if exists public.update_match_settings(uuid, integer, integer, text);

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

-- A separação permanece disponível do início até metade da duração.
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

-- Descrição vazia herda a descrição individual de cada cobrança.
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
      group_id,
      player_id,
      charge_id,
      description,
      amount,
      method,
      paid_at,
      recorded_by
    ) values (
      p_group_id,
      v_player_id,
      v_charge_id,
      coalesce(v_description, v_charge_description),
      v_remaining,
      v_method,
      v_paid_at,
      auth.uid()
    )
    returning id into v_payment_id;

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

revoke all on function public.create_match_schedule(
  uuid, text, timestamptz, integer, text, integer, integer, boolean, numeric, text, integer
) from public;
grant execute on function public.create_match_schedule(
  uuid, text, timestamptz, integer, text, integer, integer, boolean, numeric, text, integer
) to authenticated;

revoke all on function public.update_match_settings(uuid, integer, integer, integer, text) from public;
grant execute on function public.update_match_settings(uuid, integer, integer, integer, text) to authenticated;

-- A função interna continua acessível à wrapper SECURITY DEFINER, mas não ao cliente.
revoke all on function public.balance_match_teams(uuid) from public;
revoke execute on function public.balance_match_teams(uuid) from authenticated;
revoke all on function public.balance_match_teams_with_count(uuid, integer) from public;
grant execute on function public.balance_match_teams_with_count(uuid, integer) to authenticated;

revoke all on function public.record_batch_payments(uuid, uuid[], text, text, timestamptz) from public;
grant execute on function public.record_batch_payments(uuid, uuid[], text, text, timestamptz) to authenticated;

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
  145,
  142,
  111,
  true,
  false,
  'Duração dos eventos, janela para separar times até 50% do tempo e ajustes nos pagamentos em lote.'
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
  and build < 145;

commit;

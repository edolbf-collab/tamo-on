-- Tâmo On — Beta 1.0 Build 140
-- Higienização definitiva da identidade no código persistido e registro da nova release.

begin;

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

insert into public.app_releases(channel, version, build, database_build, edge_build, active, mandatory, notes)
values ('beta', 'Beta 1.0', 140, 140, 110, true, false,
        'Identidade Tâmo On consolidada no aplicativo, PWA, assets, configuração, notificações e código operacional persistido.')
on conflict (channel, build) do update set
  version = excluded.version, database_build = excluded.database_build, edge_build = excluded.edge_build,
  active = excluded.active, mandatory = excluded.mandatory, notes = excluded.notes, released_at = now();

update public.app_releases set active = false where channel = 'beta' and build < 140;

commit;

-- Additive API: older clients keep using update_match_settings unchanged.
-- Definer rights are required to inspect the private Marketplace linkage. Every
-- entry point checks the legal gate, current identity and organizer permission.
create or replace function public.community_match_edit_context(p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m public.matches%rowtype; linked boolean;
begin
  perform tamoon_legal.require_access();
  if auth.uid() is null then raise exception 'Usuário não autenticado'; end if;
  select * into m from public.matches where id=p_match_id;
  if not found or not public.can_manage_matches(m.group_id) then
    raise exception 'Sem permissão para editar este evento';
  end if;
  select exists(select 1 from marketplace_pilot.events e where e.match_id=m.id
    and (e.managed or e.state<>'cancelled')) into linked;
  return jsonb_build_object('match',to_jsonb(m),'can_reschedule',
    m.status='scheduled' and m.starts_at>now() and not linked,'marketplace_linked',linked);
end $$;
revoke all on function public.community_match_edit_context(uuid) from public,anon;
grant execute on function public.community_match_edit_context(uuid) to authenticated;

create or replace function public.reschedule_manual_match(
  p_match_id uuid,p_group_id uuid,p_starts_at timestamptz,p_expected_starts_at timestamptz,
  p_max_players integer,p_players_per_team integer,p_duration_minutes integer,p_notes text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.matches%rowtype; settings jsonb; changed boolean; change_id bigint;
begin
  perform tamoon_legal.require_access();
  if auth.uid() is null then raise exception 'Usuário não autenticado'; end if;
  select * into m from public.matches where id=p_match_id for update;
  if not found or m.group_id is distinct from p_group_id or not public.can_manage_matches(m.group_id) then
    raise exception 'Sem permissão para editar este evento';
  end if;
  if m.status<>'scheduled' or m.starts_at<=now() then
    raise exception 'Somente eventos agendados e ainda não iniciados podem ser remarcados';
  end if;
  if p_starts_at is null or not isfinite(p_starts_at) or p_starts_at<=now() then
    raise exception 'Informe uma data e um horário futuros';
  end if;
  if p_expected_starts_at is distinct from m.starts_at then
    raise exception 'A data deste evento mudou. Reabra a edição para conferir os dados atuais';
  end if;
  if exists(select 1 from marketplace_pilot.events e where e.match_id=m.id
    and (e.managed or e.state<>'cancelled')) then
    raise exception 'Este evento está vinculado ao Marketplace. Altere a data pela reserva';
  end if;
  if p_max_players is null or p_duration_minutes is null then
    raise exception 'Informe a duração e a quantidade máxima de jogadores';
  end if;
  -- Reuse validated settings/team rules; all writes commit or roll back together.
  settings:=public.update_match_settings(p_match_id,p_max_players,p_players_per_team,p_duration_minutes,p_notes);
  changed:=p_starts_at is distinct from m.starts_at;
  if changed then
    update public.matches set starts_at=p_starts_at,
      confirmation_deadline=case when m.confirmation_deadline is null then null
        else m.confirmation_deadline+(p_starts_at-m.starts_at) end
      where id=m.id;
    insert into public.app_logs(user_id,group_id,event_type,severity,metadata)
      values(auth.uid(),m.group_id,'match_rescheduled','info',jsonb_build_object(
        'match_id',m.id,'previous_starts_at',m.starts_at,'starts_at',p_starts_at,
        'recurrence_series_id',m.recurrence_series_id)) returning id into change_id;
  end if;
  return settings||jsonb_build_object('group_id',m.group_id,'title',m.title,
    'previous_starts_at',m.starts_at,'starts_at',p_starts_at,'schedule_changed',changed,'change_id',change_id::text);
end $$;
revoke all on function public.reschedule_manual_match(uuid,uuid,timestamptz,timestamptz,integer,integer,integer,text) from public,anon;
grant execute on function public.reschedule_manual_match(uuid,uuid,timestamptz,timestamptz,integer,integer,integer,text) to authenticated;

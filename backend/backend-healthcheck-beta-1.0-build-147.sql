-- Tâmo On — Healthcheck Beta 1.0 Build 147 / Database Build 144
-- Execute depois da migration da Build 147. Todos os resultados devem ser true.

select
  exists (
    select 1
    from public.app_releases
    where channel = 'beta'
      and build = 147
      and database_build = 144
      and edge_build = 111
      and active is true
  ) as release_147_active,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'players'
      and column_name = 'guest_history_archived_at'
      and data_type = 'timestamp with time zone'
  ) as guest_archive_column_ok,
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'players'
      and indexname = 'players_guest_history_active_idx'
  ) as guest_archive_index_ok,
  to_regprocedure(
    'public.remove_match_guest_record(uuid)'
  ) is not null as guest_removal_function_ok,
  has_function_privilege(
    'authenticated',
    'public.remove_match_guest_record(uuid)',
    'EXECUTE'
  ) as guest_removal_permission_ok;

select
  position(
    'evento está acontecendo' in pg_get_functiondef(
      'public.protect_match_guest_history()'::regprocedure
    )
  ) > 0 as deletion_during_event_blocked_ok,
  position(
    'v_duration_minutes * interval ''1 minute''' in pg_get_functiondef(
      'public.protect_match_guest_history()'::regprocedure
    )
  ) > 0 as full_event_duration_used_ok,
  position(
    '''action'', ''deleted''' in pg_get_functiondef(
      'public.remove_match_guest_record(uuid)'::regprocedure
    )
  ) > 0 as pre_event_delete_ok,
  position(
    'guest_history_archived_at = now()' in pg_get_functiondef(
      'public.remove_match_guest_record(uuid)'::regprocedure
    )
  ) > 0 as post_event_archive_ok,
  position(
    'guest_history_archived_at is null' in pg_get_functiondef(
      'public.reinvite_match_guest(uuid,uuid)'::regprocedure
    )
  ) > 0 as archived_guest_reinvite_blocked_ok,
  not has_function_privilege(
    'authenticated',
    'public.protect_match_guest_history()',
    'EXECUTE'
  ) as history_guard_not_directly_callable_ok;

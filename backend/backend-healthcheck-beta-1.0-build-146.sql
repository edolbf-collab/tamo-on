-- Tâmo On — Healthcheck Beta 1.0 Build 146 / Database Build 143
-- Execute depois da migration da Build 146. Todos os resultados devem ser true.

select
  exists (
    select 1
    from public.app_releases
    where channel = 'beta'
      and build = 146
      and database_build = 143
      and edge_build = 111
      and active is true
  ) as release_146_active,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'players'
      and column_name = 'guest_profile_id'
      and data_type = 'uuid'
  ) as guest_profile_column_ok,
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'players'
      and indexname = 'players_guest_profile_idx'
  ) as guest_profile_index_ok,
  to_regprocedure(
    'public.reinvite_match_guest(uuid,uuid)'
  ) is not null as reinvite_guest_function_ok,
  has_function_privilege(
    'authenticated',
    'public.reinvite_match_guest(uuid,uuid)',
    'EXECUTE'
  ) as reinvite_guest_permission_ok;

select
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.players'::regclass
      and tgname = 'players_assign_match_guest_profile_id'
      and tgenabled <> 'D'
  ) as guest_identity_trigger_ok,
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.players'::regclass
      and tgname = 'players_protect_match_guest_history'
      and tgenabled <> 'D'
  ) as guest_history_trigger_ok,
  not exists (
    select 1
    from public.players
    where guest_match_id is not null
      and guest_profile_id is null
  ) as existing_guests_identified_ok,
  position(
    'não pode ser alterado ou excluído' in pg_get_functiondef(
      'public.protect_match_guest_history()'::regprocedure
    )
  ) > 0 as immutable_history_source_ok,
  position(
    'v_source.primary_position' in pg_get_functiondef(
      'public.reinvite_match_guest(uuid,uuid)'::regprocedure
    )
  ) > 0
  and position(
    'v_source.goalkeeper' in pg_get_functiondef(
      'public.reinvite_match_guest(uuid,uuid)'::regprocedure
    )
  ) > 0 as last_guest_conditions_copied_ok,
  not has_function_privilege(
    'authenticated',
    'public.protect_match_guest_history()',
    'EXECUTE'
  ) as history_guard_not_directly_callable_ok;

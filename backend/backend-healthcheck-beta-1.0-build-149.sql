-- Tâmo On — Healthcheck Beta 1.0 Build 149 / Database Build 146
-- Execute depois da migration da Build 149. Todos os resultados devem ser true.

select
  exists (
    select 1
    from public.app_releases
    where channel = 'beta'
      and build = 149
      and database_build = 146
      and edge_build = 112
      and active is true
  ) as release_149_active,
  to_regclass(
    'public.user_notifications'
  ) is not null as user_notifications_table_ok,
  exists (
    select 1
    from pg_class
    where oid = 'public.user_notifications'::regclass
      and relrowsecurity is true
  ) as user_notifications_rls_ok,
  to_regprocedure(
    'public.mark_user_notifications_read(uuid[])'
  ) is not null as mark_notifications_read_function_ok;

select
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'user_notifications'
      and indexname = 'user_notifications_user_unread_idx'
  ) as unread_index_ok,
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'user_notifications'
      and indexname = 'user_notifications_user_created_idx'
  ) as recent_index_ok,
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_notifications'
      and policyname = 'user notifications own read'
      and cmd = 'SELECT'
  ) as own_notifications_policy_ok,
  exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_notifications'
  ) as notification_realtime_ok;

select
  has_table_privilege(
    'authenticated',
    'public.user_notifications',
    'SELECT'
  ) as authenticated_notifications_read_ok,
  not has_table_privilege(
    'authenticated',
    'public.user_notifications',
    'INSERT'
  ) as direct_notification_insert_blocked_ok,
  not has_table_privilege(
    'authenticated',
    'public.user_notifications',
    'UPDATE'
  ) as direct_notification_update_blocked_ok,
  has_table_privilege(
    'service_role',
    'public.user_notifications',
    'INSERT'
  ) as edge_notification_insert_ok,
  has_function_privilege(
    'authenticated',
    'public.mark_user_notifications_read(uuid[])',
    'EXECUTE'
  ) as mark_notifications_read_permission_ok,
  not has_function_privilege(
    'anon',
    'public.mark_user_notifications_read(uuid[])',
    'EXECUTE'
  ) as anonymous_mark_read_blocked_ok;

select
  position(
    'user_id = auth.uid()' in pg_get_functiondef(
      'public.mark_user_notifications_read(uuid[])'::regprocedure
    )
  ) > 0 as mark_read_restricted_to_owner_ok,
  not exists (
    select 1
    from public.user_notifications
    where char_length(notification_type) < 2
       or char_length(title) < 2
       or user_id is null
  ) as existing_notifications_valid_ok;

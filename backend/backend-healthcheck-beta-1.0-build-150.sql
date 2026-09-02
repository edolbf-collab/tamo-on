-- Tâmo On — Healthcheck Beta 1.0 Build 150 / Database Build 147
-- Execute depois da migration da Build 150. Todos os resultados devem ser true.

select
  exists (
    select 1
    from public.app_releases
    where channel = 'beta'
      and build = 150
      and database_build = 147
      and edge_build = 112
      and active is true
  ) as release_150_active,
  to_regclass(
    'public.user_notifications'
  ) is not null as user_notifications_table_ok,
  to_regprocedure(
    'public.mark_all_user_notifications_read()'
  ) is not null as mark_all_notifications_read_function_ok;

select
  has_function_privilege(
    'authenticated',
    'public.mark_all_user_notifications_read()',
    'EXECUTE'
  ) as authenticated_mark_all_read_ok,
  not has_function_privilege(
    'anon',
    'public.mark_all_user_notifications_read()',
    'EXECUTE'
  ) as anonymous_mark_all_read_blocked_ok,
  not has_table_privilege(
    'authenticated',
    'public.user_notifications',
    'UPDATE'
  ) as direct_notification_update_still_blocked_ok;

select
  position(
    'user_id = auth.uid()' in pg_get_functiondef(
      'public.mark_all_user_notifications_read()'::regprocedure
    )
  ) > 0 as mark_all_read_restricted_to_owner_ok,
  position(
    'read_at is null' in lower(pg_get_functiondef(
      'public.mark_all_user_notifications_read()'::regprocedure
    ))
  ) > 0 as only_unread_notifications_updated_ok;

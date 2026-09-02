-- Tâmo On — Healthcheck Beta 1.0 Build 151 / Database Build 148
-- Execute depois da migration da Build 151. Todos os resultados devem ser true.

select
  exists (
    select 1
    from public.app_releases
    where channel = 'beta'
      and build = 151
      and database_build = 148
      and edge_build = 112
      and active is true
  ) as release_151_active,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_notifications'
      and column_name = 'read_method'
  ) as read_method_column_ok,
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_notifications'::regclass
      and conname = 'user_notifications_read_state_check'
  ) as read_state_constraint_ok,
  to_regclass(
    'public.notification_retention_holds'
  ) is not null as retention_holds_table_ok,
  to_regclass(
    'public.data_retention_runs'
  ) is not null as retention_runs_table_ok;

select
  to_regprocedure(
    'public.mark_user_notifications_read(uuid[])'
  ) is not null as click_read_function_ok,
  to_regprocedure(
    'public.mark_all_user_notifications_read()'
  ) is not null as center_open_read_function_ok,
  to_regprocedure(
    'public.purge_expired_notification_data()'
  ) is not null as retention_cleanup_function_ok,
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.user_notifications'::regclass
      and tgname = 'user_notifications_retention_hold_guard'
      and not tgisinternal
  ) as notification_hold_guard_ok,
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.announcements'::regclass
      and tgname = 'announcements_retention_hold_guard'
      and not tgisinternal
  ) as announcement_hold_guard_ok;

select
  has_function_privilege(
    'authenticated',
    'public.mark_user_notifications_read(uuid[])',
    'EXECUTE'
  ) as authenticated_click_read_ok,
  has_function_privilege(
    'authenticated',
    'public.mark_all_user_notifications_read()',
    'EXECUTE'
  ) as authenticated_center_open_read_ok,
  not has_function_privilege(
    'authenticated',
    'public.purge_expired_notification_data()',
    'EXECUTE'
  ) as direct_cleanup_blocked_ok,
  not has_table_privilege(
    'authenticated',
    'public.notification_retention_holds',
    'SELECT'
  ) as retention_reasons_private_ok;

select
  position(
    'read_method = ''clicked''' in pg_get_functiondef(
      'public.mark_user_notifications_read(uuid[])'::regprocedure
    )
  ) > 0 as click_method_recorded_ok,
  position(
    '''attendance-confirmed''' in pg_get_functiondef(
      'public.mark_all_user_notifications_read()'::regprocedure
    )
  ) > 0
  and position(
    '''attendance-declined''' in pg_get_functiondef(
      'public.mark_all_user_notifications_read()'::regprocedure
    )
  ) > 0
  and position(
    'interval ''90 days''' in pg_get_functiondef(
      'public.mark_all_user_notifications_read()'::regprocedure
    )
  ) > 0 as attendance_types_auto_read_ok,
  position(
    '''announcement''' in pg_get_functiondef(
      'public.mark_all_user_notifications_read()'::regprocedure
    )
  ) = 0
  and position(
    '''match-created''' in pg_get_functiondef(
      'public.mark_all_user_notifications_read()'::regprocedure
    )
  ) = 0
  and position(
    '''attendance-reminder''' in pg_get_functiondef(
      'public.mark_all_user_notifications_read()'::regprocedure
    )
  ) = 0
  and position(
    '''charge-created''' in pg_get_functiondef(
      'public.mark_all_user_notifications_read()'::regprocedure
    )
  ) = 0
  and position(
    '''system-announcement''' in pg_get_functiondef(
      'public.mark_all_user_notifications_read()'::regprocedure
    )
  ) = 0 as click_only_types_not_auto_read_ok;

select
  position(
    'interval ''180 days''' in pg_get_functiondef(
      'public.purge_expired_notification_data()'::regprocedure
    )
  ) > 0 as notification_retention_180_days_ok,
  position(
    'interval ''24 months''' in pg_get_functiondef(
      'public.purge_expired_notification_data()'::regprocedure
    )
  ) > 0 as announcement_retention_24_months_ok,
  position(
    'interval ''30 days''' in pg_get_functiondef(
      'public.purge_expired_notification_data()'::regprocedure
    )
  ) > 0 as invalid_subscription_retention_30_days_ok,
  exists (
    select 1
    from cron.job
    where jobname = 'tamoon-notification-retention-daily'
      and schedule = '17 3 * * *'
      and active is true
  ) as daily_retention_job_ok;

select
  not exists (
    select 1
    from public.user_notifications
    where (read_at is null) <> (read_method is null)
       or read_method not in (
         'clicked',
         'notification_center_opened',
         'legacy'
       )
  ) as existing_read_states_valid_ok;

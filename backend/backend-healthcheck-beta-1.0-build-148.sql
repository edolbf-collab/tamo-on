-- Tâmo On — Healthcheck Beta 1.0 Build 148 / Database Build 145
-- Execute depois da migration da Build 148. Todos os resultados devem ser true.

select
  exists (
    select 1
    from public.app_releases
    where channel = 'beta'
      and build = 148
      and database_build = 145
      and edge_build = 111
      and active is true
  ) as release_148_active,
  to_regclass(
    'public.notification_receipts'
  ) is not null as notification_receipts_table_ok,
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'notification_receipts'
      and indexname = 'notification_receipts_group_user_idx'
  ) as notification_receipts_index_ok,
  exists (
    select 1
    from pg_class
    where oid = 'public.notification_receipts'::regclass
      and relrowsecurity is true
  ) as notification_receipts_rls_ok,
  to_regprocedure(
    'public.mark_group_announcements_read(uuid,uuid[])'
  ) is not null as mark_announcements_read_function_ok;

select
  has_function_privilege(
    'authenticated',
    'public.mark_group_announcements_read(uuid,uuid[])',
    'EXECUTE'
  ) as mark_announcements_read_permission_ok,
  not has_function_privilege(
    'anon',
    'public.mark_group_announcements_read(uuid,uuid[])',
    'EXECUTE'
  ) as anonymous_mark_read_blocked_ok,
  has_table_privilege(
    'authenticated',
    'public.notification_receipts',
    'SELECT'
  ) as authenticated_receipts_read_ok,
  not has_table_privilege(
    'authenticated',
    'public.notification_receipts',
    'INSERT'
  ) as direct_receipt_insert_blocked_ok,
  position(
    '''announcement''' in pg_get_functiondef(
      'public.mark_group_announcements_read(uuid,uuid[])'::regprocedure
    )
  ) > 0 as generic_announcement_source_ok;

select
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'notification_receipts'
      and policyname = 'notification receipts own read'
  ) as own_receipts_policy_ok;

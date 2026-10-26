-- Somente leitura. Execute após a migration 162. Todos os resultados devem ser true.
-- A publicação da Edge 115 e o comportamento no aparelho são verificados separadamente.
select
  exists(select 1 from public.app_releases where channel='beta' and build=162 and database_build=150 and edge_build=115 and active) as release_162_ok,
  (select count(*)=4 and bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='tamoon_safety' and c.relkind='r' and c.relname in ('user_blocks','reports','hidden_announcements','report_actions')) as safety_tables_rls_ok,
  not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='tamoon_safety' and c.relkind='r' and (
      has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') or
      has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'))) as private_tables_protected_ok,
  exists(select 1 from pg_policies where schemaname='public' and tablename='announcements' and policyname='safety_announcements_read' and permissive='RESTRICTIVE' and cmd='SELECT') as announcement_policy_ok,
  exists(select 1 from pg_policies where schemaname='public' and tablename='user_notifications' and policyname='safety_notifications_read' and permissive='RESTRICTIVE' and cmd='SELECT') as notification_policy_ok,
  exists(select 1 from pg_trigger where tgrelid=to_regclass('public.user_notifications') and tgname='safety_notification_guard' and tgenabled='O') as notification_trigger_ok,
  exists(select 1 from pg_trigger where tgrelid=to_regclass('public.member_ratings') and tgname='safety_rating_guard' and tgenabled='O') as rating_trigger_ok;

select
  (select count(*)=5 and bool_and(not p.prosecdef and has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE'))
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
     and p.proname in ('community_safety_state','community_set_user_block','community_report','community_reports','community_review_report')) as authenticated_rpc_permissions_ok,
  (select count(*)=1 and bool_and(has_function_privilege('service_role',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE'))
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='community_push_recipients') as push_service_only_ok,
  (select count(*)=4 and bool_and(not has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE'))
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='tamoon_safety' and p.proname in ('guard_notification','guard_rating','pair_blocked','require_user')) as internal_functions_protected_ok,
  not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='tamoon_safety' and (not p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'],false))) as definer_search_path_ok,
  exists(select 1 from pg_indexes where schemaname='tamoon_safety' and indexname='safety_reports_pending_idx' and indexdef like 'CREATE UNIQUE INDEX%') as duplicate_reports_guard_ok,
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='tamoon_safety' and p.proname='require_user'
    and p.prosrc like '%tamoon_legal.has_access%' and p.prosrc like '%public.beta_access%' and p.prosrc like '%auth.uid()%') as legal_and_active_account_gate_ok;

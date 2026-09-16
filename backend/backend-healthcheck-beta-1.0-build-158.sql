-- Tâmo On Build 158 / Banco 149: somente leitura, sem migration nesta atualização.
-- Todos os campos da primeira consulta devem ser true.
select
  exists (select 1 from public.app_releases where channel = 'beta' and active and database_build >= 149) as database_149_ok,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_notifications' and column_name = 'read_method') as read_method_column_ok,
  exists (select 1 from pg_proc where oid = to_regprocedure('public.mark_user_notifications_read(uuid[])') and prosecdef
    and position('read_method = ''clicked''' in prosrc) > 0
    and position('user_id = auth.uid()' in prosrc) > 0) as individual_read_function_ok,
  exists (select 1 from pg_proc where oid = to_regprocedure('public.mark_all_user_notifications_read()')
    and position('attendance-confirmed' in prosrc) > 0
    and position('attendance-declined' in prosrc) > 0
    and position('notification_center_opened' in prosrc) > 0) as attendance_read_rules_ok,
  coalesce(has_function_privilege('authenticated', to_regprocedure('public.mark_user_notifications_read(uuid[])'), 'EXECUTE'), false) as read_rpc_permission_ok,
  exists (select 1 from pg_proc where oid = to_regprocedure('public.mark_user_notifications_read(uuid[])')
    and position('perform tamoon_legal.require_access();' in prosrc) > 0) as legal_guard_preserved_ok,
  not has_table_privilege('authenticated', 'public.user_notifications', 'UPDATE') as direct_update_blocked_ok;

-- Informativo: a ativação jurídica permanece uma etapa independente da Build 157.
select enabled as legal_requirement_active, activated_at
from tamoon_legal.settings where singleton;

-- Somente leitura. Todos os campos da primeira consulta devem ser true.
-- A segunda consulta informa o estágio: enabled=false é esperado ANTES da ativação.
select
 exists(select 1 from public.app_releases where channel='beta' and build=157 and database_build=149 and edge_build=113) as release_157_ok,
 (select count(*)=3 from tamoon_legal.documents where version='1.2') as three_documents_ok,
 not exists(select 1 from tamoon_legal.documents where encode(sha256(convert_to(content_html,'UTF8')),'hex')<>content_hash) as document_hashes_ok,
 to_regprocedure('public.get_community_legal_access_status()') is not null as lightweight_status_rpc_ok,
 to_regprocedure('public.get_community_legal_status()') is not null as legal_status_rpc_ok,
 to_regprocedure('public.get_community_legal_document(text,text)') is not null as archived_metadata_rpc_ok,
 to_regprocedure('public.accept_community_legal_documents(jsonb,boolean,boolean,boolean,boolean,integer,text)') is not null as acceptance_rpc_ok,
 exists(select 1 from pg_db_role_setting s cross join lateral unnest(s.setconfig) c
   where s.setrole=(select oid from pg_roles where rolname='authenticator')
   and s.setdatabase=(select oid from pg_database where datname=current_database())
   and c='pgrst.db_pre_request=tamoon_legal.check_request') as rest_gate_configured_ok,
 not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity
   and c.relname not in ('app_releases','beta_access','platform_admins')
   and not exists(select 1 from pg_policy p where p.polrelid=c.oid and p.polname='community_legal_gate' and not p.polpermissive)) as restrictive_rls_ok,
 exists(select 1 from tamoon_legal.guarded_rpcs) and not exists(
   select 1 from tamoon_legal.guarded_rpcs g where to_regprocedure(g.signature) is null
     or position('perform tamoon_legal.require_access();' in pg_get_functiondef(to_regprocedure(g.signature)))=0
 ) as registered_rpc_guards_ok,
 not has_table_privilege('authenticated','tamoon_legal.acceptances','INSERT,UPDATE,DELETE,SELECT') as direct_acceptance_access_blocked_ok,
 not has_table_privilege('anon','tamoon_legal.acceptances','SELECT') as anonymous_evidence_blocked_ok,
 not has_function_privilege('authenticated','public.community_legal_access_for_user(uuid)','EXECUTE') as third_party_lookup_blocked_ok,
 has_function_privilege('service_role','public.community_legal_access_for_user(uuid)','EXECUTE') as edge_lookup_allowed_ok,
 not has_function_privilege('authenticated','tamoon_legal.activate_v1_2(timestamptz)','EXECUTE') as client_activation_blocked_ok,
 not has_function_privilege('authenticated','tamoon_legal.protect_acceptance()','EXECUTE') as acceptance_trigger_not_callable_ok,
 exists(select 1 from pg_trigger where tgrelid='tamoon_legal.documents'::regclass and tgname='legal_document_immutable' and not tgisinternal and tgenabled='O') as immutable_documents_trigger_ok,
 exists(select 1 from pg_trigger where tgrelid='tamoon_legal.acceptances'::regclass and tgname='legal_acceptance_immutable' and not tgisinternal and tgenabled='O') as immutable_evidence_trigger_ok,
 exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass and tgname='legal_end_relationship' and not tgisinternal and tgenabled='O') as account_deletion_retention_ok;

select s.enabled as legal_requirement_active,s.activated_at,
 (select min(effective_at) from tamoon_legal.documents where active) as effective_at,
 (select count(*) from tamoon_legal.documents where active) as active_documents,
 (select count(*) from tamoon_legal.guarded_rpcs) as protected_rpc_count,
 exists(select 1 from pg_extension where extname='pg_cron') as scheduler_available,
 case when s.enabled then 'Exigência ativada: testar conta sem aceite e conta com aceite.'
 else 'Preparado: aguarda vigência e publicação do app e das duas Edge Functions.' end as stage
from tamoon_legal.settings s where singleton;

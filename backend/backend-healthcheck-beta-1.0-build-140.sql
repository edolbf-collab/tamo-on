-- Tâmo On — Healthcheck Beta 1.0 Build 140
select
  exists (select 1 from public.app_releases where channel='beta' and build=140 and database_build=140 and edge_build=110 and active is true) as release_140_active,
  to_regprocedure('public.balance_match_teams(uuid)') is not null as balance_match_teams_ok,
  to_regprocedure('public.platform_push_delivery_attempts_v2(uuid,integer,integer)') is not null as push_telemetry_ok,
  to_regprocedure('public.platform_group_export(uuid)') is not null as group_export_ok;

select
  position(lower(chr(114)||chr(101)||chr(115)||chr(101)||chr(110)||chr(104)||chr(97)) in lower(pg_get_functiondef('public.balance_match_teams(uuid)'::regprocedure))) = 0 as function_source_brand_clean;

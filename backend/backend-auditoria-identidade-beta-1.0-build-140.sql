-- Tâmo On — auditoria técnica da identidade ativa
select channel, version, build, database_build, edge_build, active, notes from public.app_releases where channel='beta' order by build desc limit 5;
select position(lower(chr(114)||chr(101)||chr(115)||chr(101)||chr(110)||chr(104)||chr(97)) in lower(pg_get_functiondef('public.balance_match_teams(uuid)'::regprocedure))) as legacy_marker_position;

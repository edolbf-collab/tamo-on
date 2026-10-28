-- Applied on 2026-10-28 only after the production Pages deploy was verified.
-- This records the web release; it does not submit an Android bundle to Google Play.
begin;
insert into public.app_releases(channel,version,build,database_build,edge_build,active,mandatory,notes)
values('beta','Beta 1.0',166,151,115,true,false,
       'Build 166-R2: piloto privado do Marketplace com integração ao Teste FC e pagamentos simulados.')
on conflict(channel,build) do update set database_build=excluded.database_build,
  edge_build=excluded.edge_build,active=true,mandatory=false,notes=excluded.notes;
update public.app_releases set active=false where channel='beta' and build<166;
commit;

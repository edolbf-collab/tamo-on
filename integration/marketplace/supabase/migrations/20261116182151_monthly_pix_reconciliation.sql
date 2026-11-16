-- Reuse the existing server-only Vault credential; never expose it to clients.
create function private.dispatch_establishment_pix_reconciliation() returns void
language plpgsql security definer set search_path='' as $$
declare endpoint text; job_secret text;
begin
 if exists(select 1 from public.marketplace_settings where real_money_enabled) then return;end if;
 select s.endpoint into endpoint from private.asaas_inline_pix_settings s where singleton;
 if endpoint is null or endpoint !~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/asaas-pix-maintenance$' then return;end if;
 select decrypted_secret into job_secret from vault.decrypted_secrets where name='marketplace_monthly_cron_secret';
 if nullif(job_secret,'') is null then return;end if;
 perform net.http_post(url:=regexp_replace(endpoint,'/asaas-pix-maintenance$','/establishment-billing'),
  headers:=jsonb_build_object('Content-Type','application/json','x-marketplace-cron-secret',job_secret),
  body:='{"action":"run"}'::jsonb,timeout_milliseconds:=55000);
end;$$;
revoke all on function private.dispatch_establishment_pix_reconciliation() from public,anon,authenticated;
grant execute on function private.dispatch_establishment_pix_reconciliation() to service_role;
select cron.schedule('tamoon-establishment-pix-sandbox','*/5 * * * *','select private.dispatch_establishment_pix_reconciliation()');

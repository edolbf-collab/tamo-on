-- The server relay is authenticated by the payload signature; direct browser RPC is disabled.
revoke all on function public.community_marketplace_pilot_receive(text,text) from public,anon,authenticated;
grant execute on function public.community_marketplace_pilot_receive(text,text) to service_role;

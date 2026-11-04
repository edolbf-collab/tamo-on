-- Marketplace staging only; keeps the validated C39 financial engine intact.
alter table private.community_marketplace_pilot add column community_group_id uuid;
create unique index pilot_external_group_unique on public.marketplace_groups(owner_profile_id,external_group_id) where external_group_id is not null;

create function public.pilot_import_community_group(p_context jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare c private.community_marketplace_pilot%rowtype; g uuid; e jsonb;
begin
  if auth.jwt()->>'role' is distinct from 'service_role' then raise sqlstate 'PT403' using message='SERVICE_REQUIRED'; end if;
  select * into strict c from private.community_marketplace_pilot where singleton and enabled;
  if c.community_group_id is null or (p_context->>'group_id')::uuid is distinct from c.community_group_id
     or (p_context->>'user_id')::uuid is distinct from c.community_user_id then raise sqlstate 'PT403' using message='PILOT_GROUP_DENIED'; end if;
  insert into public.marketplace_groups(owner_profile_id,name,external_group_id,member_count,active)
  values(c.marketplace_user_id,left(p_context->>'name',80)||' · Comunidade',c.community_group_id::text,1,true)
  on conflict(owner_profile_id,external_group_id) where external_group_id is not null do update set name=excluded.name,active=true
  returning id into g;
  insert into public.marketplace_group_members(group_id,profile_id,role,can_create_events,can_edit_events,active)
  values(g,c.marketplace_user_id,'admin',true,true,true)
  on conflict(group_id,profile_id) do update set role='admin',can_create_events=true,can_edit_events=true,active=true;
  -- Existing Community games are references; importing them never alters the source.
  for e in select value from jsonb_array_elements(coalesce(p_context->'events','[]')) loop
    if not exists(select 1 from public.marketplace_events where group_id=g and external_event_id=e->>'id') then
      insert into public.marketplace_events(group_id,external_event_id,title,starts_at,ends_at,venue_name,status,source,created_by)
      values(g,e->>'id',e->>'title',(e->>'starts_at')::timestamptz,(e->>'ends_at')::timestamptz,e->>'location','linked_existing','community',c.marketplace_user_id);
    end if;
  end loop;
  return g;
end $$;
revoke all on function public.pilot_import_community_group(jsonb) from public,anon,authenticated;
grant execute on function public.pilot_import_community_group(jsonb) to service_role;

create function public.pilot_export_community_events() returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.community_marketplace_pilot%rowtype; result jsonb;
begin
  perform public.marketplace_pilot_check_request();
  select * into strict c from private.community_marketplace_pilot where singleton and enabled and marketplace_user_id=auth.uid();
  select coalesce(jsonb_agg(x.item order by x.occurred_at),'[]') into result from (
    select o.starts_at occurred_at,jsonb_build_object(
      'group_id',g.external_group_id,'reservation_id',r.id,'occurrence_id',o.id,'event_id',e.id,
      'existing_match_id',case when r.event_mode='existing' then e.external_event_id else null end,
      'mode',r.event_mode,'code',r.public_code,'title',e.title,'starts_at',o.starts_at,'ends_at',o.ends_at,
      'location',v.name,'amount',o.allocated_value,
      'source_updated_at',greatest(r.updated_at,o.updated_at,e.updated_at),
      'state',case when r.status in ('cancelled','expired','refund_pending','refunded') or o.status='cancelled' then 'cancelled'
        when r.status in ('confirmed','completed') and (e.status in ('published','completed','linked_existing') or r.event_publication_status='published') then 'published'
        else 'standby_payment' end
    ) item
    from public.reservations r join public.marketplace_groups g on g.id=r.group_id
    join public.reservation_occurrences o on o.reservation_id=r.id
    join public.marketplace_events e on e.id=r.event_id
    join public.venues v on v.id=r.venue_id
    where r.user_id=c.marketplace_user_id and g.owner_profile_id=c.marketplace_user_id
      and g.external_group_id=c.community_group_id::text and r.event_mode in ('new','existing')
  ) x;
  if jsonb_array_length(result)>200 then raise exception 'PILOT_BATCH_LIMIT'; end if;
  return result;
end $$;
revoke all on function public.pilot_export_community_events() from public,anon;
grant execute on function public.pilot_export_community_events() to authenticated;

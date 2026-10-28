-- Community: additive bridge, restricted to the configured operator and test group.
create schema if not exists marketplace_pilot;
revoke all on schema marketplace_pilot from public,anon,authenticated;
create table marketplace_pilot.config (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 user_id uuid not null references auth.users(id), marketplace_user_id uuid not null,
 group_id uuid not null references public.groups(id)
);
create table marketplace_pilot.events (
 occurrence_id uuid primary key,reservation_id uuid not null,event_id uuid not null,
 group_id uuid not null references public.groups(id),match_id uuid references public.matches(id) on delete set null,
 managed boolean not null,state text not null check(state in ('standby_payment','published','cancelled')),
 source_updated_at timestamptz not null,payload jsonb not null,synced_at timestamptz not null default now()
);
create index pilot_events_group on marketplace_pilot.events(group_id);
alter table marketplace_pilot.config enable row level security;
alter table marketplace_pilot.events enable row level security;
revoke all on all tables in schema marketplace_pilot from public,anon,authenticated;

create function public.community_marketplace_pilot_context() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c marketplace_pilot.config%rowtype; g public.groups%rowtype;
begin
  select * into c from marketplace_pilot.config where singleton and enabled and user_id=auth.uid();
  if not found or not public.can_manage_matches(c.group_id) or not public.is_platform_admin()
    or not exists(select 1 from auth.sessions where user_id=auth.uid() and id::text=auth.jwt()->>'session_id' and (not_after is null or not_after>now())) then
    raise sqlstate 'PT403' using message='PILOT_GROUP_DENIED';
  end if;
  perform tamoon_legal.require_access();
  select * into strict g from public.groups where id=c.group_id;
  return jsonb_build_object('user_id',c.user_id,'marketplace_user_id',c.marketplace_user_id,'group_id',g.id,'name',g.name,
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'title',m.title,'starts_at',m.starts_at,'ends_at',m.starts_at+make_interval(mins=>m.duration_minutes),'location',m.location))
      from public.matches m where m.group_id=g.id and m.status='scheduled' and m.starts_at>now()
      and not exists(select 1 from marketplace_pilot.events pe where pe.match_id=m.id and pe.managed)),'[]'));
end $$;
revoke all on function public.community_marketplace_pilot_context() from public,anon;
grant execute on function public.community_marketplace_pilot_context() to authenticated;

create function public.community_marketplace_pilot_apply(p_actor uuid,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c marketplace_pilot.config%rowtype; e jsonb; old marketplace_pilot.events%rowtype;
  v_id uuid; v_match uuid; v_group uuid; v_version timestamptz; v_start timestamptz; v_end timestamptz;
  v_state text; v_managed boolean; n integer:=0; history integer:=0;
begin
  if auth.jwt()->>'role' is distinct from 'service_role' then raise sqlstate 'PT403' using message='SERVICE_REQUIRED'; end if;
  select * into strict c from marketplace_pilot.config where singleton and enabled and user_id=p_actor for update;
  if not exists(select 1 from public.group_members where user_id=p_actor and group_id=c.group_id and role::text in ('owner','admin','organizer')) then raise exception 'PILOT_GROUP_DENIED'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>200 then raise exception 'INVALID_BATCH'; end if;
  for e in select value from jsonb_array_elements(p_items) loop
    v_group:=(e->>'group_id')::uuid;
    if v_group is distinct from c.group_id then raise sqlstate 'PT403' using message='PILOT_GROUP_DENIED'; end if;
    v_id:=(e->>'occurrence_id')::uuid;v_version:=(e->>'source_updated_at')::timestamptz;
    v_start:=(e->>'starts_at')::timestamptz;v_end:=(e->>'ends_at')::timestamptz;
    v_state:=e->>'state';v_managed:=e->>'mode'='new';
    if v_id is null or v_version is null or v_start is null or v_end is null or v_end-v_start<interval '15 minutes' or v_end-v_start>interval '8 hours'
       or v_state not in ('standby_payment','published','cancelled') or e->>'mode' not in ('new','existing') then raise exception 'INVALID_EVENT'; end if;
    select * into old from marketplace_pilot.events where occurrence_id=v_id for update;
    if found and (old.group_id<>v_group or old.reservation_id<>(e->>'reservation_id')::uuid or old.managed<>v_managed) then raise exception 'SOURCE_IDENTITY_CONFLICT'; end if;
    if found and old.source_updated_at>=v_version then continue; end if;
    v_match:=old.match_id;
    if not v_managed then
      v_match:=nullif(e->>'existing_match_id','')::uuid;
      if not exists(select 1 from public.matches where id=v_match and group_id=c.group_id) then raise exception 'EXISTING_MATCH_DENIED'; end if;
      -- A reservation never overwrites or cancels a game created manually in Community.
    elsif v_match is not null then
      if exists(select 1 from public.matches where id=v_match and starts_at<=now()) then history:=history+1;
      else
        update public.matches set status=case when v_state='published' then 'scheduled' else 'cancelled' end,
          starts_at=v_start,duration_minutes=extract(epoch from(v_end-v_start))::integer/60,location=left(e->>'location',200)
          where id=v_match and group_id=c.group_id;
      end if;
    elsif v_state='published' and v_start>now() then
      insert into public.matches(group_id,title,starts_at,duration_minutes,location,status,notes,created_by)
      values(c.group_id,'[TESTE Marketplace] '||left(coalesce(e->>'title',e->>'code','Reserva'),100),v_start,
        extract(epoch from(v_end-v_start))::integer/60,coalesce(nullif(e->>'location',''),'Local de teste'),'scheduled',
        'Reserva de sandbox '||coalesce(e->>'code','')||'. Pagamento simulado; sem lançamento no caixa.',c.user_id)
      returning id into v_match;
    end if;
    insert into marketplace_pilot.events(occurrence_id,reservation_id,event_id,group_id,match_id,managed,state,source_updated_at,payload)
    values(v_id,(e->>'reservation_id')::uuid,(e->>'event_id')::uuid,c.group_id,v_match,v_managed,v_state,v_version,e)
    on conflict(occurrence_id) do update set match_id=excluded.match_id,state=excluded.state,source_updated_at=excluded.source_updated_at,payload=excluded.payload,synced_at=now();
    n:=n+1;
  end loop;
  return jsonb_build_object('updated',n,'history_preserved',history,'group_id',c.group_id);
end $$;
revoke all on function public.community_marketplace_pilot_apply(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.community_marketplace_pilot_apply(uuid,jsonb) to service_role;

create function public.community_marketplace_pilot_overview() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c jsonb;
begin
 c:=public.community_marketplace_pilot_context();
 return jsonb_build_object('group_id',c->'group_id','name',c->'name','events',coalesce((select jsonb_agg(jsonb_build_object(
   'code',payload->>'code','state',state,'starts_at',payload->>'starts_at','amount',payload->'amount','match_id',match_id,'synced_at',synced_at) order by synced_at desc)
   from marketplace_pilot.events where group_id=(c->>'group_id')::uuid),'[]'));
end $$;
revoke all on function public.community_marketplace_pilot_overview() from public,anon;
grant execute on function public.community_marketplace_pilot_overview() to authenticated;

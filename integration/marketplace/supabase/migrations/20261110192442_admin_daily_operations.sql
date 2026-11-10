-- Internal administrative follow-up. Never changes payments, refunds or moderation decisions.
create function tamoon_admin.require_admin() returns void language plpgsql stable security definer set search_path='' as $$ begin
 if auth.uid() is null or not coalesce((exists(select 1 from public.platform_admins a join public.profiles p on p.id=a.profile_id join auth.users u on u.id=p.id where a.profile_id=auth.uid() and p.status::text='active')) ,false) then raise sqlstate '42501' using message='Acesso restrito à administração.';end if;
end $$;
revoke all on function tamoon_admin.require_admin() from public,anon,authenticated;
create table tamoon_admin.work_items(
 id uuid primary key, title text not null check(length(btrim(title)) between 3 and 160),description text not null default '' check(length(description)<=2000),
 status text not null default 'open' check(status in ('open','working','waiting','resolved')),
 created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table tamoon_admin.followups(
 source_key text primary key,owner_id uuid references auth.users(id) on delete set null,due_at timestamptz,
 stage text not null default 'open' check(stage in ('open','working','waiting')),note text not null default '' check(length(note)<=2000),
 version bigint not null default 1,updated_by uuid references auth.users(id) on delete set null,updated_at timestamptz not null default now());
create index admin_followups_due on tamoon_admin.followups(due_at) where due_at is not null;
create index admin_followups_owner on tamoon_admin.followups(owner_id) where owner_id is not null;
create table tamoon_admin.work_history(id bigint generated always as identity primary key,source_key text not null,actor_id uuid references auth.users(id) on delete set null,action text not null,changes jsonb not null default '{}',created_at timestamptz not null default now());
create index admin_work_history_source on tamoon_admin.work_history(source_key,id desc);
alter table tamoon_admin.work_items enable row level security;
alter table tamoon_admin.followups enable row level security;
alter table tamoon_admin.work_history enable row level security;
revoke all on tamoon_admin.work_items,tamoon_admin.followups,tamoon_admin.work_history from public,anon,authenticated;
create view tamoon_admin.daily_admins as select p.id,coalesce(p.display_name,p.email::text) name from public.platform_admins a join public.profiles p on p.id=a.profile_id join auth.users u on u.id=p.id where p.status::text='active';
revoke all on tamoon_admin.daily_admins from public,anon,authenticated;
create view tamoon_admin.daily_sources as
select 'task:'||w.id id,'support'::text kind,w.title,'Atendimento interno'::text subtitle,w.status,w.status<>'resolved' active,w.created_at,w.updated_at,
 null::uuid scope_id,''::text target_section,''::text target_id,w.description
from tamoon_admin.work_items w
union all select 'finance:'||f.id,'finance',f.title,f.subtitle,f.status,f.attention,f.created_at,(f.details->>'Atualizado em')::timestamptz,null::uuid,'finance',f.id,'Consulte a ficha financeira para conferir valores e devoluções.' from tamoon_admin.finance f where f.attention or exists(select 1 from tamoon_admin.followups x where x.source_key='finance:'||f.id)
union all select 'partner:'||p.id,'partner',p.trade_name,'Cadastro de parceiro',p.status::text,p.status::text in ('pending','under_review'),p.created_at,p.updated_at,p.id,'partners',p.id::text,'Cadastro aguardando análise da administração.' from public.partners p where p.status::text in ('pending','under_review') or exists(select 1 from tamoon_admin.followups x where x.source_key='partner:'||p.id)
union all select 'webhook:'||w.id,'integration',w.event_type,w.provider::text,w.status::text,w.status::text='failed' or (w.status::text in ('pending','processing') and w.received_at<now()-interval '15 minutes'),w.received_at,coalesce(w.processed_at,w.received_at),null::uuid,'webhooks',w.id::text,'Retorno do provedor com falha ou aguardando processamento há mais de 15 minutos.' from public.webhook_events w where w.status::text='failed' or (w.status::text in ('pending','processing') and w.received_at<now()-interval '15 minutes') or exists(select 1 from tamoon_admin.followups x where x.source_key='webhook:'||w.id);
revoke all on tamoon_admin.daily_sources from public,anon,authenticated;
create view tamoon_admin.daily_queue as select s.*,f.owner_id,a.name owner_name,f.due_at,coalesce(f.stage,'open') stage,coalesce(f.note,'') note,coalesce(f.version,0) version,
 coalesce((s.active and f.due_at<now()),false) overdue from tamoon_admin.daily_sources s left join tamoon_admin.followups f on f.source_key=s.id left join tamoon_admin.daily_admins a on a.id=f.owner_id;
revoke all on tamoon_admin.daily_queue from public,anon,authenticated;
create view tamoon_admin.daily_agenda as select o.id::text id,r.public_code title,concat_ws(' · ',p.trade_name,v.name) subtitle,o.starts_at,o.ends_at,case when r.status::text in ('cancelled','expired','refunded') then r.status::text else o.status::text end status,o.status::text='active' and r.status::text not in ('cancelled','expired','refunded') active,r.partner_id scope_id,'reservations'::text target_section,r.id::text target_id,concat_ws(' · ',v.name,p.city) location from public.reservation_occurrences o join public.reservations r on r.id=o.reservation_id left join public.partners p on p.id=r.partner_id left join public.venue_spaces v on v.id=r.venue_space_id;
revoke all on tamoon_admin.daily_agenda from public,anon,authenticated;
create view tamoon_admin.daily_scopes as select id,trade_name name from public.partners;
revoke all on tamoon_admin.daily_scopes from public,anon,authenticated;
create function tamoon_admin.daily_read(p_view text,p_from timestamptz,p_to timestamptz,p_search text,p_scope uuid,p_status text,p_page integer,p_id text,p_kind text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_rows jsonb;v_total bigint;v_admins jsonb;v_scopes jsonb;v_history jsonb;v_stats jsonb;v_from timestamptz:=coalesce(p_from,now());v_to timestamptz:=coalesce(p_to,now()+interval '7 days');
begin
 perform tamoon_admin.require_admin();
 if p_view is null or p_view not in ('overview','queue','agenda') or p_page is null or p_page<1 or p_page>100000 or length(coalesce(p_search,''))>120 or v_to<=v_from or v_to-v_from>interval '366 days' or p_status is null or p_status not in ('pending','all','closed','overdue','mine','unassigned') then raise exception 'INVALID_FILTERS';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id),'[]') into v_admins from tamoon_admin.daily_admins;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id),'[]') into v_scopes from (select * from tamoon_admin.daily_scopes order by name,id limit 200) s;
 if p_view='overview' then
  v_stats:=jsonb_build_object('partners',(select count(*) from public.partners where status::text='approved'),'users',(select count(*) from public.profiles),'reservations',(select count(*) from public.reservations where status::text='confirmed'),'upcoming',(select count(*) from tamoon_admin.daily_agenda where active and starts_at>=now() and starts_at<now()+interval '7 days'));
  select jsonb_build_object('pending',count(*) filter(where active),'overdue',count(*) filter(where overdue),'unassigned',count(*) filter(where active and owner_id is null))||v_stats into v_stats from tamoon_admin.daily_queue;
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into v_rows from (select id,kind,title,subtitle,status,created_at,due_at,owner_name,overdue from tamoon_admin.daily_queue where active order by overdue desc,due_at asc nulls last,created_at,id limit 5) q;
  return jsonb_build_object('stats',v_stats,'items',v_rows,'checked_at',now());
 elsif p_view='queue' then
  select count(*) into v_total from tamoon_admin.daily_queue q where (p_id is null or q.id=p_id) and (p_id is not null or case p_status when 'all' then true when 'closed' then not q.active when 'overdue' then q.overdue when 'mine' then q.active and q.owner_id=auth.uid() when 'unassigned' then q.active and q.owner_id is null else q.active end)
   and (p_kind is null or q.kind=p_kind) and (coalesce(p_search,'')='' or strpos(lower(q.title||' '||coalesce(q.subtitle,'')||' '||q.id),lower(p_search))>0);
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into v_rows from (select * from tamoon_admin.daily_queue q where (p_id is null or q.id=p_id) and (p_id is not null or case p_status when 'all' then true when 'closed' then not q.active when 'overdue' then q.overdue when 'mine' then q.active and q.owner_id=auth.uid() when 'unassigned' then q.active and q.owner_id is null else q.active end)
   and (p_kind is null or q.kind=p_kind) and (coalesce(p_search,'')='' or strpos(lower(q.title||' '||coalesce(q.subtitle,'')||' '||q.id),lower(p_search))>0)
   order by q.active desc,q.overdue desc,q.due_at asc nulls last,q.created_at,q.id limit 20 offset (p_page::bigint-1)*20) q;
  if p_id is not null then
   select coalesce(jsonb_agg(to_jsonb(h)),'[]') into v_history from (select h.action,h.changes,h.created_at,coalesce(a.name,'Administrador removido') actor from tamoon_admin.work_history h left join tamoon_admin.daily_admins a on a.id=h.actor_id where h.source_key=p_id order by h.id desc limit 20) h;
  end if;
 else
  select count(*) into v_total from tamoon_admin.daily_agenda a where a.starts_at<v_to and a.ends_at>v_from and (p_scope is null or a.scope_id=p_scope) and (p_status='all' or case when p_status='closed' then not a.active else a.active end)
   and (coalesce(p_search,'')='' or strpos(lower(a.title||' '||a.subtitle),lower(p_search))>0);
  select coalesce(jsonb_agg(to_jsonb(a)),'[]') into v_rows from (select * from tamoon_admin.daily_agenda a where a.starts_at<v_to and a.ends_at>v_from and (p_scope is null or a.scope_id=p_scope) and (p_status='all' or case when p_status='closed' then not a.active else a.active end)
   and (coalesce(p_search,'')='' or strpos(lower(a.title||' '||a.subtitle),lower(p_search))>0) order by starts_at,id limit 20 offset (p_page::bigint-1)*20) a;
 end if;
 return jsonb_build_object('items',v_rows,'total',v_total,'page',p_page,'size',20,'admins',v_admins,'scopes',v_scopes,'history',coalesce(v_history,'[]'),'checked_at',now());
end $$;
revoke all on function tamoon_admin.daily_read(text,timestamptz,timestamptz,text,uuid,text,integer,text,text) from public,anon;
grant execute on function tamoon_admin.daily_read(text,timestamptz,timestamptz,text,uuid,text,integer,text,text) to authenticated;
create function public.admin_daily_read(p_view text,p_from timestamptz default null,p_to timestamptz default null,p_search text default '',p_scope uuid default null,p_status text default 'pending',p_page integer default 1,p_id text default null,p_kind text default null)
returns jsonb language sql stable security invoker set search_path='' as $$select tamoon_admin.daily_read(p_view,p_from,p_to,p_search,p_scope,p_status,p_page,p_id,p_kind);$$;
revoke all on function public.admin_daily_read(text,timestamptz,timestamptz,text,uuid,text,integer,text,text) from public,anon;
grant execute on function public.admin_daily_read(text,timestamptz,timestamptz,text,uuid,text,integer,text,text) to authenticated;
create function tamoon_admin.daily_save(p_command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_key text:=p_command->>'id';v_id uuid;v_source tamoon_admin.daily_sources%rowtype;v_old tamoon_admin.followups%rowtype;v_owner uuid:=nullif(p_command->>'owner_id','')::uuid;v_due timestamptz:=nullif(p_command->>'due_at','')::timestamptz;v_stage text:=coalesce(p_command->>'stage','open');v_note text:=coalesce(p_command->>'note','');v_status text:=p_command->>'status';v_version bigint;
begin
 perform tamoon_admin.require_admin();
 if p_command is null or jsonb_typeof(p_command)<>'object' or length(v_note)>2000 or v_stage not in ('open','working','waiting') then raise exception 'INVALID_INPUT';end if;
 if p_command->>'action'='create' then
  v_id:=(p_command->>'id')::uuid;
  if v_id is null or length(btrim(coalesce(p_command->>'title',''))) not between 3 and 160 or length(coalesce(p_command->>'description',''))>2000 then raise exception 'INVALID_INPUT';end if;
  insert into tamoon_admin.work_items(id,title,description,created_by) values(v_id,btrim(p_command->>'title'),coalesce(p_command->>'description',''),auth.uid()) on conflict(id) do nothing;
  if not found then
   if exists(select 1 from tamoon_admin.work_items where id=v_id and created_by=auth.uid() and title=btrim(p_command->>'title') and description=coalesce(p_command->>'description','')) then return jsonb_build_object('id','task:'||v_id);end if;
   raise exception 'CONFLICT';
  end if;
  insert into tamoon_admin.work_history(source_key,actor_id,action) values('task:'||v_id,auth.uid(),'created');
  return jsonb_build_object('id','task:'||v_id);
 end if;
 if p_command->>'action' is distinct from 'update' or v_key is null or length(v_key)>150 then raise exception 'INVALID_INPUT';end if;
 perform pg_advisory_xact_lock(hashtextextended('admin-followup:'||v_key,0));
 select * into v_source from tamoon_admin.daily_sources where id=v_key;
 if not found then raise exception 'NOT_FOUND';end if;
 if v_source.updated_at is distinct from nullif(p_command->>'source_updated_at','')::timestamptz then raise exception 'CONFLICT';end if;
 select * into v_old from tamoon_admin.followups where source_key=v_key for update;
 if coalesce(v_old.version,0) is distinct from (p_command->>'version')::bigint then raise exception 'CONFLICT';end if;
 if v_owner is not null and not exists(select 1 from tamoon_admin.daily_admins where id=v_owner) then raise exception 'INVALID_OWNER';end if;
 if v_status is not null then
  if v_source.kind not in ('support','feedback') or v_status not in ('open','working','waiting','resolved') then raise exception 'INVALID_STATUS';end if;
  if v_source.kind='support' then update tamoon_admin.work_items set status=v_status,updated_at=clock_timestamp() where id=substring(v_key from 6)::uuid and updated_at is not distinct from v_source.updated_at; if not found then raise exception 'CONFLICT';end if;
  else raise exception 'INVALID_STATUS'; end if;
 end if;
 insert into tamoon_admin.followups(source_key,owner_id,due_at,stage,note,updated_by) values(v_key,v_owner,v_due,v_stage,v_note,auth.uid())
 on conflict(source_key) do update set owner_id=excluded.owner_id,due_at=excluded.due_at,stage=excluded.stage,note=excluded.note,version=tamoon_admin.followups.version+1,updated_by=auth.uid(),updated_at=clock_timestamp() returning version into v_version;
 insert into tamoon_admin.work_history(source_key,actor_id,action,changes) values(v_key,auth.uid(),'updated',jsonb_build_object('stage',v_stage,'status',v_status,'owner_id',v_owner,'due_at',v_due,'note_changed',v_note is distinct from coalesce(v_old.note,'')));
 return jsonb_build_object('id',v_key,'version',v_version);
end $$;
revoke all on function tamoon_admin.daily_save(jsonb) from public,anon;
grant execute on function tamoon_admin.daily_save(jsonb) to authenticated;
create function public.admin_daily_save(p_command jsonb) returns jsonb language sql security invoker set search_path='' as $$select tamoon_admin.daily_save(p_command);$$;
revoke all on function public.admin_daily_save(jsonb) from public,anon;
grant execute on function public.admin_daily_save(jsonb) to authenticated;

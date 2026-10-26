-- Tâmo On — Aplicativo 162 / Banco 150 / publish-announcement 115
-- Executar uma vez no SQL Editor, sobre a Build 161 (Banco 149).
begin;

create schema if not exists tamoon_safety;
revoke all on schema tamoon_safety from public, anon, authenticated;
grant usage on schema tamoon_safety to authenticated, service_role;

create table if not exists tamoon_safety.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists safety_blocks_reverse_idx on tamoon_safety.user_blocks(blocked_id, blocker_id);

create table if not exists tamoon_safety.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  group_id uuid references public.groups(id) on delete set null,
  target_type text not null check (target_type in ('player','announcement','match','group','notification')),
  target_id uuid not null,
  target_user_id uuid references auth.users(id) on delete set null,
  reason text not null check (reason in ('harassment','hate','sexual','violence','fraud','privacy','other')),
  details text not null check (char_length(details) between 10 and 2000),
  snapshot jsonb not null,
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  response text not null default '',
  reviewed_by uuid references auth.users(id) on delete set null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists safety_reports_owner_idx on tamoon_safety.reports(reporter_id, created_at desc);
create index if not exists safety_reports_queue_idx on tamoon_safety.reports(status, created_at);
create index if not exists safety_reports_target_user_idx on tamoon_safety.reports(target_user_id);
create index if not exists safety_reports_reviewer_idx on tamoon_safety.reports(reviewed_by);
create index if not exists safety_reports_group_idx on tamoon_safety.reports(group_id);
create unique index if not exists safety_reports_pending_idx on tamoon_safety.reports(reporter_id, target_type, target_id) where status in ('open','reviewing');

create table if not exists tamoon_safety.hidden_announcements (
  announcement_id uuid primary key,
  report_id uuid not null references tamoon_safety.reports(id),
  hidden_at timestamptz not null default now()
);
create index if not exists safety_hidden_report_idx on tamoon_safety.hidden_announcements(report_id);
create table if not exists tamoon_safety.report_actions (
  id bigint generated always as identity primary key,
  report_id uuid not null references tamoon_safety.reports(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  response text not null,
  created_at timestamptz not null default now()
);
create index if not exists safety_actions_report_idx on tamoon_safety.report_actions(report_id, created_at);
create index if not exists safety_actions_actor_idx on tamoon_safety.report_actions(actor_id);
alter table tamoon_safety.user_blocks enable row level security;
alter table tamoon_safety.reports enable row level security;
alter table tamoon_safety.hidden_announcements enable row level security;
alter table tamoon_safety.report_actions enable row level security;
revoke all on all tables in schema tamoon_safety from public, anon, authenticated, service_role;
revoke all on all sequences in schema tamoon_safety from public, anon, authenticated, service_role;

-- Todas as escritas passam por funções com autorização explícita.
create or replace function tamoon_safety.require_user() returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or tamoon_legal.has_access(v_user) is not true
     or not exists(select 1 from public.beta_access b where b.user_id = v_user and b.status = 'active') then
    raise exception 'Entre com uma conta ativa e conclua o aceite dos termos.';
  end if;
  return v_user;
end; $$;

create or replace function tamoon_safety.pair_blocked(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from tamoon_safety.user_blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b)
       or (b.blocker_id = p_b and b.blocked_id = p_a));
$$;

-- Helper de RLS limitado à pessoa autenticada; não expõe a lista de terceiros.
create or replace function tamoon_safety.visible_to_me(p_author uuid, p_announcement uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and not tamoon_safety.pair_blocked(auth.uid(), p_author)
    and not exists(select 1 from tamoon_safety.hidden_announcements h where h.announcement_id = p_announcement)
    and not exists(select 1 from public.announcements a where a.id=p_announcement and tamoon_safety.pair_blocked(auth.uid(),a.created_by));
$$;

create or replace function tamoon_safety.state() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := tamoon_safety.require_user();
begin
  return jsonb_build_object('blocks', coalesce((
    select jsonb_agg(jsonb_build_object('user_id', b.blocked_id, 'name', coalesce(p.name, 'Participante'), 'created_at', b.created_at) order by b.created_at desc)
    from tamoon_safety.user_blocks b left join public.profiles p on p.id = b.blocked_id where b.blocker_id = v_user
  ), '[]'::jsonb), 'pending_reports', case when public.is_platform_admin() then (select count(*) from tamoon_safety.reports where status in ('open','reviewing')) else 0 end);
end; $$;

create or replace function tamoon_safety.set_block(p_user_id uuid, p_blocked boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := tamoon_safety.require_user();
begin
  if p_user_id is null or p_user_id = v_user or p_blocked is null then raise exception 'Participante inválido.'; end if;
  if p_blocked then
    if not exists(select 1 from public.group_members a join public.group_members b on b.group_id = a.group_id
      where a.user_id = v_user and b.user_id = p_user_id) then
      raise exception 'Você só pode bloquear participantes de um grupo em comum.';
    end if;
    insert into tamoon_safety.user_blocks(blocker_id, blocked_id) values(v_user, p_user_id) on conflict do nothing;
  else
    delete from tamoon_safety.user_blocks where blocker_id = v_user and blocked_id = p_user_id;
  end if;
end; $$;

create or replace function tamoon_safety.report(p_type text, p_id uuid, p_reason text, p_details text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := tamoon_safety.require_user(); v_group uuid; v_author uuid;
  v_snapshot jsonb; v_id uuid; v_details text := btrim(coalesce(p_details, ''));
begin
  if p_reason is null or p_reason not in ('harassment','hate','sexual','violence','fraud','privacy','other')
     or char_length(v_details) not between 10 and 2000 then raise exception 'Informe o motivo e um relato de 10 a 2000 caracteres.'; end if;
  -- A evidência é capturada do registro autorizado, nunca enviada pelo cliente.
  case p_type
    when 'player' then
      select p.group_id, p.user_id, jsonb_build_object('name',p.name,'nickname',p.nickname,'avatar_url',p.avatar_url)
      into v_group,v_author,v_snapshot from public.players p where p.id=p_id;
    when 'announcement' then
      select a.group_id,a.created_by,jsonb_build_object('title',a.title,'body',a.body)
      into v_group,v_author,v_snapshot from public.announcements a where a.id=p_id;
    when 'match' then
      select m.group_id,null::uuid,jsonb_build_object('title',m.title,'notes',m.notes,'location',m.location)
      into v_group,v_author,v_snapshot from public.matches m where m.id=p_id;
    when 'group' then
      select g.id,null::uuid,jsonb_build_object('name',g.name)
      into v_group,v_author,v_snapshot from public.groups g where g.id=p_id;
    when 'notification' then
      select n.group_id,n.created_by,jsonb_build_object('title',n.title,'body',n.body,'notification_type',n.notification_type,'source_id',n.source_id)
      into v_group,v_author,v_snapshot from public.user_notifications n where n.id=p_id and n.user_id=v_user;
    else raise exception 'Tipo de denúncia inválido.';
  end case;
  if v_snapshot is null or (p_type <> 'notification' and (v_group is null or public.is_group_member(v_group) is not true)) then
    raise exception 'Registro não disponível para denúncia.';
  end if;
  if p_type='player' and v_author=v_user then raise exception 'Não é possível denunciar o próprio perfil.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text,162));
  select id into v_id from tamoon_safety.reports where reporter_id=v_user and target_type=p_type and target_id=p_id and status in ('open','reviewing');
  if v_id is not null then return v_id; end if;
  if (select count(*) from tamoon_safety.reports where reporter_id=v_user and created_at>now()-interval '24 hours') >= 10 then
    raise exception 'Você atingiu o limite de 10 denúncias em 24 horas. Para urgências, use o canal de suporte dos documentos do app.';
  end if;
  insert into tamoon_safety.reports(reporter_id,group_id,target_type,target_id,target_user_id,reason,details,snapshot)
  values(v_user,v_group,p_type,p_id,v_author,p_reason,v_details,v_snapshot) returning id into v_id;
  return v_id;
end; $$;

create or replace function tamoon_safety.list_reports(p_admin boolean default false, p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := tamoon_safety.require_user();
begin
  if p_admin is null or p_offset is null or p_offset < 0 then raise exception 'Consulta inválida.'; end if;
  if p_admin and public.is_platform_admin() is not true then raise exception 'Acesso restrito à administração do Tâmo On.'; end if;
  return coalesce((select jsonb_agg(item order by priority, created_at desc, id) from (
    select r.id, r.created_at, case when p_admin and r.status in ('open','reviewing') then 0 else 1 end as priority, jsonb_build_object('id',r.id,'target_type',r.target_type,'reason',r.reason,'details',r.details,
      'target_label',coalesce(r.snapshot->>'name',r.snapshot->>'title','Registro denunciado'),'status',r.status,'response',r.response,'created_at',r.created_at,'version',r.version)
      || case when p_admin then jsonb_build_object('snapshot',r.snapshot,'target_id',r.target_id,'target_user_id',r.target_user_id,'group_id',r.group_id,
         'actions',coalesce((select jsonb_agg(jsonb_build_object('action',a.action,'response',a.response,'created_at',a.created_at) order by a.created_at)
          from tamoon_safety.report_actions a where a.report_id=r.id),'[]'::jsonb)) else '{}'::jsonb end as item
    from tamoon_safety.reports r where p_admin or r.reporter_id=v_user
    order by priority,r.created_at desc,r.id limit 30 offset p_offset
  ) rows), '[]'::jsonb);
end; $$;

create or replace function tamoon_safety.review(p_id uuid,p_version integer,p_status text,p_response text,p_action text default 'none') returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := tamoon_safety.require_user(); v_report tamoon_safety.reports; v_email text; v_announcement uuid;
begin
  if public.is_platform_admin() is not true then raise exception 'Acesso restrito à administração do Tâmo On.'; end if;
  if p_status is null or p_status not in ('reviewing','resolved','dismissed') or p_action is null or p_action not in ('none','hide_announcement','restore_announcement','suspend_account')
    or char_length(btrim(coalesce(p_response,''))) not between 10 and 2000 then raise exception 'Informe o andamento e uma resposta de 10 a 2000 caracteres.'; end if;
  if p_action <> 'none' and p_status <> 'resolved' then raise exception 'Para aplicar uma medida, selecione Concluída.'; end if;
  select * into v_report from tamoon_safety.reports where id=p_id for update;
  if not found then raise exception 'Denúncia não encontrada.'; end if;
  if p_version is distinct from v_report.version then raise exception 'Esta denúncia foi atualizada. Reabra a lista antes de salvar.'; end if;
  if p_action in ('hide_announcement','restore_announcement') then
    if v_report.target_type='announcement' then v_announcement := v_report.target_id;
    elsif v_report.target_type='notification' and v_report.snapshot->>'notification_type' in ('announcement','announcement-resend') then
      v_announcement := (v_report.snapshot->>'source_id')::uuid;
    end if;
    if v_announcement is null then raise exception 'Esta medida só se aplica a avisos do grupo.'; end if;
    if p_action='hide_announcement' then
      insert into tamoon_safety.hidden_announcements(announcement_id,report_id) values(v_announcement,p_id) on conflict do nothing;
    else
      delete from tamoon_safety.hidden_announcements where announcement_id=v_announcement;
    end if;
  elsif p_action='suspend_account' then
    if v_report.target_user_id is null or v_report.target_user_id=v_user then raise exception 'Conta indisponível para esta medida.'; end if;
    select email into v_email from auth.users where id=v_report.target_user_id;
    if v_email is null then raise exception 'Conta não encontrada.'; end if;
    if exists(select 1 from public.platform_admins where lower(email)=lower(v_email)) then raise exception 'Contas da administração exigem revisão pelo responsável da plataforma.'; end if;
    perform public.platform_beta_access_set_status(v_email,'blocked');
  end if;
  update tamoon_safety.reports set status=p_status,response=btrim(p_response),reviewed_by=v_user,updated_at=now(),version=version+1 where id=p_id;
  insert into tamoon_safety.report_actions(report_id,actor_id,action,response) values(p_id,v_user,p_status||':'||p_action,btrim(p_response));
end; $$;

-- Policies restritivas somam-se às políticas de grupo, titular e aceite existentes.
drop policy if exists safety_announcements_read on public.announcements;
create policy safety_announcements_read on public.announcements as restrictive for select to authenticated
using (tamoon_safety.visible_to_me(created_by,id));
drop policy if exists safety_notifications_read on public.user_notifications;
create policy safety_notifications_read on public.user_notifications as restrictive for select to authenticated
using (notification_type='system-announcement' or tamoon_safety.visible_to_me(created_by,
  case when notification_type in ('announcement','announcement-resend') then source_id else null end));

create or replace function tamoon_safety.guard_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.notification_type <> 'system-announcement' and (
    tamoon_safety.pair_blocked(new.user_id,new.created_by) or
    (new.notification_type in ('announcement','announcement-resend') and (exists(select 1 from tamoon_safety.hidden_announcements where announcement_id=new.source_id) or exists(select 1 from public.announcements a where a.id=new.source_id and tamoon_safety.pair_blocked(new.user_id,a.created_by))))
  ) then return null; end if;
  return new;
end; $$;
drop trigger if exists safety_notification_guard on public.user_notifications;
create trigger safety_notification_guard before insert on public.user_notifications for each row execute function tamoon_safety.guard_notification();

create or replace function tamoon_safety.guard_rating() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.players p where p.id=new.rated_player_id and tamoon_safety.pair_blocked(new.rater_user_id,p.user_id)) then
    raise exception 'Avaliação indisponível entre esses participantes.';
  end if;
  return new;
end; $$;
drop trigger if exists safety_rating_guard on public.member_ratings;
create trigger safety_rating_guard before insert or update on public.member_ratings for each row execute function tamoon_safety.guard_rating();

-- Somente a Edge autenticada como service_role pode filtrar destinatários arbitrários.
create or replace function tamoon_safety.push_recipients(p_author uuid,p_recipients uuid[],p_announcement uuid default null) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct recipient),'{}'::uuid[]) from unnest(p_recipients) recipient
  where recipient is not null and not tamoon_safety.pair_blocked(p_author,recipient)
    and not exists(select 1 from tamoon_safety.hidden_announcements where announcement_id=p_announcement)
    and not exists(select 1 from public.announcements a where a.id=p_announcement and tamoon_safety.pair_blocked(recipient,a.created_by));
$$;

create or replace function public.community_safety_state() returns jsonb language sql security invoker set search_path='' as $$ select tamoon_safety.state(); $$;
create or replace function public.community_set_user_block(p_user_id uuid,p_blocked boolean) returns void language sql security invoker set search_path='' as $$ select tamoon_safety.set_block(p_user_id,p_blocked); $$;
create or replace function public.community_report(p_type text,p_id uuid,p_reason text,p_details text) returns uuid language sql security invoker set search_path='' as $$ select tamoon_safety.report(p_type,p_id,p_reason,p_details); $$;
create or replace function public.community_reports(p_admin boolean default false,p_offset integer default 0) returns jsonb language sql security invoker set search_path='' as $$ select tamoon_safety.list_reports(p_admin,p_offset); $$;
create or replace function public.community_review_report(p_id uuid,p_version integer,p_status text,p_response text,p_action text default 'none') returns void language sql security invoker set search_path='' as $$ select tamoon_safety.review(p_id,p_version,p_status,p_response,p_action); $$;
create or replace function public.community_push_recipients(p_author uuid,p_recipients uuid[],p_announcement uuid default null) returns uuid[] language sql security invoker set search_path='' as $$ select tamoon_safety.push_recipients(p_author,p_recipients,p_announcement); $$;

revoke all on all functions in schema tamoon_safety from public,anon,authenticated,service_role;
grant execute on function tamoon_safety.visible_to_me(uuid,uuid),tamoon_safety.state(),tamoon_safety.set_block(uuid,boolean),tamoon_safety.report(text,uuid,text,text),tamoon_safety.list_reports(boolean,integer),tamoon_safety.review(uuid,integer,text,text,text) to authenticated;
grant execute on function tamoon_safety.push_recipients(uuid,uuid[],uuid) to service_role;
revoke all on function public.community_safety_state(),public.community_set_user_block(uuid,boolean),public.community_report(text,uuid,text,text),public.community_reports(boolean,integer),public.community_review_report(uuid,integer,text,text,text),public.community_push_recipients(uuid,uuid[],uuid) from public,anon,authenticated,service_role;
grant execute on function public.community_safety_state(),public.community_set_user_block(uuid,boolean),public.community_report(text,uuid,text,text),public.community_reports(boolean,integer),public.community_review_report(uuid,integer,text,text,text) to authenticated;
grant execute on function public.community_push_recipients(uuid,uuid[],uuid) to service_role;

insert into public.app_releases(channel,version,build,database_build,edge_build,active,mandatory,notes)
values('beta','Beta 1.0',162,150,115,true,false,'Denúncias, acompanhamento pela administração e bloqueio pessoal na Comunidade.')
on conflict(channel,build) do update set database_build=excluded.database_build,edge_build=excluded.edge_build,active=true,notes=excluded.notes,released_at=now();
update public.app_releases set active=false where channel='beta' and build<162;
notify pgrst, 'reload schema';
commit;

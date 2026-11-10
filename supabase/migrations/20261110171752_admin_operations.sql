-- Read-only administrative projections. No tokens, arbitrary metadata or audit payloads.
create schema if not exists tamoon_admin;
revoke all on schema tamoon_admin from public,anon;
grant usage on schema tamoon_admin to authenticated;

create table tamoon_admin.group_origins(group_id uuid primary key references public.groups(id) on delete cascade,creator_id uuid references auth.users(id) on delete set null,verified boolean not null default false);
alter table tamoon_admin.group_origins enable row level security;
revoke all on tamoon_admin.group_origins from public,anon,authenticated;
-- Existing created_by may have changed during account deletion; never fabricate provenance.
insert into tamoon_admin.group_origins select id,created_by,false from public.groups;
create function tamoon_admin.record_group_origin() returns trigger language plpgsql security definer set search_path='' as $$ begin insert into tamoon_admin.group_origins values(new.id,new.created_by,true);return new;end $$;
revoke all on function tamoon_admin.record_group_origin() from public,anon,authenticated;
create trigger admin_group_origin after insert on public.groups for each row execute function tamoon_admin.record_group_origin();
create view tamoon_admin.groups as select g.id::text id,g.name title,coalesce(p.name,'Conta removida') subtitle,case when exists(select 1 from public.matches m where m.group_id=g.id and m.starts_at>=now() and m.status<>'cancelled') then 'with_upcoming' else 'without_upcoming' end status,g.created_at,array[g.created_by] related_ids,
jsonb_build_object('Responsável registrado',p.name,'E-mail do responsável',u.email,'Criador original',case when o.verified then coalesce(cp.name,'Conta removida') else 'Não comprovado no histórico anterior' end,'Participantes cadastrados',(select count(*) from public.group_members gm where gm.group_id=g.id),'Administradores atuais',(select coalesce(string_agg(coalesce(mp.name,'Conta removida'),', ' order by mp.name),'Nenhum') from public.group_members gm left join public.profiles mp on mp.id=gm.user_id where gm.group_id=g.id and gm.role in ('owner','admin')),'Eventos',(select count(*) from public.matches m where m.group_id=g.id),'Atualizado em',g.updated_at) details from public.groups g left join public.profiles p on p.id=g.created_by left join auth.users u on u.id=g.created_by left join tamoon_admin.group_origins o on o.group_id=g.id left join public.profiles cp on cp.id=o.creator_id;
revoke all on tamoon_admin.groups from public,anon,authenticated;
create view tamoon_admin.users as select u.id::text id,coalesce(p.name,'Sem nome') title,u.email::text subtitle,coalesce(b.status,'unregistered') status,u.created_at,array[u.id] related_ids,jsonb_build_object('Nome',p.name,'E-mail',u.email,'Último acesso',b.last_seen_at,'Grupos',(select count(*) from public.group_members gm where gm.user_id=u.id),'Cadastro',u.created_at) details from auth.users u left join public.profiles p on p.id=u.id left join public.beta_access b on b.email=lower(u.email);
revoke all on tamoon_admin.users from public,anon,authenticated;
create view tamoon_admin.members as select gm.id::text id,coalesce(p.name,'Conta removida') title,g.name subtitle,gm.role status,gm.joined_at created_at,array[gm.group_id,gm.user_id] related_ids,jsonb_build_object('Participante',p.name,'E-mail',u.email,'Grupo',g.name,'Grupo ID',g.id,'Papel',gm.role,'Entrada',gm.joined_at) details from public.group_members gm join public.groups g on g.id=gm.group_id left join public.profiles p on p.id=gm.user_id left join auth.users u on u.id=gm.user_id;
revoke all on tamoon_admin.members from public,anon,authenticated;
create view tamoon_admin.events as select m.id::text id,m.title title,g.name subtitle,m.status,m.created_at,array[m.group_id,m.created_by] related_ids,jsonb_build_object('Grupo',g.name,'Organizador',p.name,'Início',m.starts_at,'Local',m.location,'Duração (min)',m.duration_minutes,'Limite de jogadores',m.max_players,'Atualizado em',m.updated_at) details from public.matches m join public.groups g on g.id=m.group_id left join public.profiles p on p.id=m.created_by;
revoke all on tamoon_admin.events from public,anon,authenticated;
create view tamoon_admin.devices as select d.platform||':'||d.id::text id,coalesce(p.name,u.email,'Conta removida') title,d.platform subtitle,case when not d.enabled then 'disabled' when d.consecutive_failures>0 then 'attention' when d.last_success_at is not null then 'accepted' else 'untested' end status,d.created_at,array[d.user_id] related_ids,jsonb_build_object('Usuário',p.name,'E-mail',u.email,'Plataforma',d.platform,'Última tentativa',d.last_attempt_at,'Último aceite pelo provedor',d.last_success_at,'Última falha',d.last_failure_at,'Código da falha',d.last_failure_status,'Falhas consecutivas',d.consecutive_failures) details from (select 'Android' platform,id,user_id,enabled,created_at,last_attempt_at,last_success_at,last_failure_at,last_failure_status,consecutive_failures from public.android_push_subscriptions union all select 'iOS',id,user_id,enabled,created_at,last_attempt_at,last_success_at,last_failure_at,last_failure_status,consecutive_failures from public.native_push_subscriptions union all select 'Web',id,user_id,enabled,created_at,last_attempt_at,last_success_at,last_failure_at,last_failure_status,consecutive_failures from public.push_subscriptions) d left join public.profiles p on p.id=d.user_id left join auth.users u on u.id=d.user_id;
revoke all on tamoon_admin.devices from public,anon,authenticated;

create function tamoon_admin.directory(p_section text,p_search text,p_status text,p_from timestamptz,p_to timestamptz,p_scope uuid,p_page integer,p_size integer,p_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_total bigint;v_rows jsonb;v_statuses jsonb;v_sql text;
begin
 if auth.uid() is null or not (public.is_platform_admin() and exists(select 1 from public.platform_admins a join auth.users u on lower(u.email)=a.email where u.id=auth.uid())) then raise sqlstate '42501' using message='Acesso restrito à administração.';end if;
 if p_section is null or p_section not in ('groups','users','members','events','devices') then raise exception 'INVALID_SECTION';end if;
 if p_page is null or p_page<1 or p_size is null or p_size<1 or p_size>50 or char_length(coalesce(p_search,''))>120 or (p_from is not null and p_to is not null and p_to<=p_from) then raise exception 'INVALID_FILTERS';end if;
 -- Whitelist and identifier quoting; search terms remain bound literal values.
 v_sql:=format(' from tamoon_admin.%I where ($1='''' or strpos(lower(coalesce(title,'''')||'' ''||coalesce(subtitle,'''')||'' ''||id||'' ''||details::text),lower($1))>0) and ($2 is null or status=$2) and ($3 is null or created_at>=$3) and ($4 is null or created_at<$4) and ($5 is null or $5=any(related_ids)) and ($6 is null or id=$6)',p_section);
 execute 'select count(*)'||v_sql into v_total using coalesce(p_search,''),p_status,p_from,p_to,p_scope,p_id;
 execute 'select coalesce(jsonb_agg(row_data),''[]''::jsonb) from (select jsonb_build_object(''id'',id,''title'',title,''subtitle'',subtitle,''status'',status,''created_at'',created_at,''details'',details) row_data'||v_sql||' order by created_at desc nulls last,id limit $7 offset $8) q' into v_rows using coalesce(p_search,''),p_status,p_from,p_to,p_scope,p_id,p_size,(p_page::bigint-1)*p_size;
 execute 'select coalesce(jsonb_object_agg(status,n),''{}''::jsonb) from (select coalesce(status,''unknown'') status,count(*) n'||v_sql||' group by status) q' into v_statuses using coalesce(p_search,''),null::text,p_from,p_to,p_scope,p_id;
 return jsonb_build_object('items',v_rows,'total',v_total,'statuses',v_statuses,'page',p_page,'size',p_size,'checked_at',now());
end $$;
revoke all on function tamoon_admin.directory(text,text,text,timestamptz,timestamptz,uuid,integer,integer,text) from public,anon;
grant execute on function tamoon_admin.directory(text,text,text,timestamptz,timestamptz,uuid,integer,integer,text) to authenticated;
create function public.admin_operations_directory(p_section text,p_search text default '',p_status text default null,p_from timestamptz default null,p_to timestamptz default null,p_scope uuid default null,p_page integer default 1,p_size integer default 20,p_id text default null)
returns jsonb language sql stable security invoker set search_path='' as $$ select tamoon_admin.directory(p_section,p_search,p_status,p_from,p_to,p_scope,p_page,p_size,p_id);$$;
revoke all on function public.admin_operations_directory(text,text,text,timestamptz,timestamptz,uuid,integer,integer,text) from public,anon;
grant execute on function public.admin_operations_directory(text,text,text,timestamptz,timestamptz,uuid,integer,integer,text) to authenticated;

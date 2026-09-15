-- Tâmo On Build 157 / Banco 149. Instalação sem ativar a exigência jurídica.
-- A ativação depende da data de vigência e da publicação do frontend e das Edges.
begin;
create schema if not exists tamoon_legal;
revoke all on schema tamoon_legal from public;
grant usage on schema tamoon_legal to anon, authenticated, service_role;

create table if not exists tamoon_legal.settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 previous_hook regprocedure,
 activated_at timestamptz
);
insert into tamoon_legal.settings(singleton) values(true) on conflict do nothing;
create table if not exists tamoon_legal.documents (
 id uuid primary key default gen_random_uuid(),
 document_type text not null check(document_type in ('terms','privacy','conduct')),
 version text not null,
 title text not null,
 content_html text not null,
 content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
 source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 source_filename text not null,
 locale text not null default 'pt-BR',
 public_url text not null check(public_url like '/legal/%'),
 effective_at timestamptz,
 published_at timestamptz,
 active boolean not null default false,
 created_at timestamptz not null default now(),
 unique(document_type,version),
 check(not active or (effective_at is not null and published_at is not null))
);
create unique index if not exists legal_one_active_type on tamoon_legal.documents(document_type) where active;
-- Sem FK destrutiva para auth.users: preservar a prova após encerramento da conta.
create table if not exists tamoon_legal.subjects (
 user_id uuid primary key,
 adult_declared_at timestamptz not null,
 age_statement text not null default 'Declaro ter 18 anos completos ou mais.',
 relationship_ended_at timestamptz,
 retention_hold boolean not null default false
);
create table if not exists tamoon_legal.acceptances (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references tamoon_legal.subjects(user_id),
 legal_document_id uuid not null references tamoon_legal.documents(id),
 accepted_at timestamptz not null default now(),
 app_build integer not null check(app_build >= 157),
 document_type text not null,
 document_version text not null,
 content_hash text not null,
 effective_at timestamptz not null,
 user_agent text,
 locale text not null default 'pt-BR',
 source text not null check(source in ('web','pwa','mobile')),
 evidence_metadata jsonb not null,
 unique(user_id,legal_document_id)
);
create table if not exists tamoon_legal.audit (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid,
 subject_id uuid,
 event_type text not null,
 purpose text not null,
 created_at timestamptz not null default now()
);
-- Sem permissões diretas, inclusive para a chave de serviço. Somente as RPCs previstas.
revoke all on all tables in schema tamoon_legal from public, anon, authenticated, service_role;
alter table tamoon_legal.settings enable row level security;
alter table tamoon_legal.documents enable row level security;
alter table tamoon_legal.subjects enable row level security;
alter table tamoon_legal.acceptances enable row level security;
alter table tamoon_legal.audit enable row level security;

create or replace function tamoon_legal.protect_document()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
 if TG_OP = 'DELETE' then raise exception 'Versões jurídicas devem permanecer arquivadas'; end if;
 if old.published_at is not null and
   (to_jsonb(new) - 'active') is distinct from (to_jsonb(old) - 'active') then
   raise exception 'Documento publicado é imutável; crie nova versão';
 end if;
 return new;
end; $$;
drop trigger if exists legal_document_immutable on tamoon_legal.documents;
create trigger legal_document_immutable before update or delete on tamoon_legal.documents
for each row execute function tamoon_legal.protect_document();

create or replace function tamoon_legal.protect_acceptance()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
 if TG_OP = 'DELETE' and current_user = 'postgres' and exists(
   select 1 from tamoon_legal.subjects s where s.user_id=old.user_id
   and s.relationship_ended_at < now()-interval '5 years' and not s.retention_hold
 ) then return old; end if;
 raise exception 'Registro de aceite é imutável durante a retenção';
end; $$;
drop trigger if exists legal_acceptance_immutable on tamoon_legal.acceptances;
create trigger legal_acceptance_immutable before update or delete on tamoon_legal.acceptances
for each row execute function tamoon_legal.protect_acceptance();

create or replace function tamoon_legal.has_access(p_user_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select (not coalesce((select enabled from tamoon_legal.settings where singleton),true)) or (
 p_user_id is not null and exists(select 1 from tamoon_legal.subjects where user_id=p_user_id and relationship_ended_at is null)
 and (select count(*) from tamoon_legal.documents where active and effective_at<=now())=3
 and not exists(select 1 from tamoon_legal.documents d where d.active and d.effective_at<=now()
   and not exists(select 1 from tamoon_legal.acceptances a where a.user_id=p_user_id
   and a.legal_document_id=d.id and a.content_hash=d.content_hash))
 );
$$;
create or replace function tamoon_legal.current_user_has_access()
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select tamoon_legal.has_access(auth.uid());
$$;
revoke all on function tamoon_legal.has_access(uuid) from public,anon,authenticated,service_role;
revoke all on function tamoon_legal.current_user_has_access() from public;
grant execute on function tamoon_legal.current_user_has_access() to anon,authenticated;

-- Monitor periódico leve: não transfere os textos completos a cada verificação.
create or replace function public.get_community_legal_access_status()
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('enabled',s.enabled,'allowed',tamoon_legal.has_access(auth.uid()))
 from tamoon_legal.settings s where singleton;
$$;
revoke all on function public.get_community_legal_access_status() from public,anon;
grant execute on function public.get_community_legal_access_status() to authenticated;

create or replace function public.get_community_legal_status()
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('enabled',s.enabled,'allowed',tamoon_legal.has_access(auth.uid()),
 'adult_declared',exists(select 1 from tamoon_legal.subjects where user_id=auth.uid() and relationship_ended_at is null),
 'documents',coalesce((select jsonb_agg(jsonb_build_object(
   'id',d.id,'document_type',d.document_type,'version',d.version,'title',d.title,
   'content_html',d.content_html,'content_hash',d.content_hash,'public_url',d.public_url,
   'effective_at',d.effective_at,'locale',d.locale,'published',d.published_at is not null,
   'accepted_at',(select a.accepted_at from tamoon_legal.acceptances a where a.user_id=auth.uid() and a.legal_document_id=d.id)
 ) order by d.document_type) from tamoon_legal.documents d
 where (d.active and d.effective_at<=now()) or
 (not s.enabled and d.version='1.2' and d.published_at is null)), '[]'::jsonb))
 from tamoon_legal.settings s where singleton;
$$;

create or replace function public.get_community_legal_document(p_document_type text,p_version text)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('document_type',d.document_type,'version',d.version,'title',d.title,
   'content_hash',d.content_hash,'effective_at',d.effective_at,'published',d.published_at is not null)
 from tamoon_legal.documents d where d.document_type=p_document_type and d.version=p_version
 and (d.published_at is not null or d.version='1.2');
$$;
revoke all on function public.get_community_legal_document(text,text) from public;
grant execute on function public.get_community_legal_document(text,text) to anon,authenticated;

create or replace function public.accept_community_legal_documents(
 p_documents jsonb, p_adult boolean, p_terms boolean, p_privacy boolean, p_conduct boolean,
 p_app_build integer, p_source text default 'web'
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_user uuid := auth.uid(); v_doc tamoon_legal.documents; v_headers jsonb;
begin
 if v_user is null then raise exception 'Sessão não autenticada'; end if;
 perform 1 from tamoon_legal.settings where singleton and enabled for share;
 if not found then raise exception 'A exigência de aceite ainda não foi ativada'; end if;
 if p_adult is distinct from true then raise exception 'Uso permitido somente a pessoas com 18 anos completos ou mais'; end if;
 if p_terms is distinct from true or p_privacy is distinct from true or p_conduct is distinct from true then
   raise exception 'Confirme os três documentos obrigatórios'; end if;
 if p_app_build is null or p_app_build<157 or p_source is null or p_source not in ('web','pwa','mobile') then
   raise exception 'Origem do aceite inválida'; end if;
 if p_documents is null or jsonb_typeof(p_documents)<>'array' then raise exception 'Documentos inválidos'; end if;
 if jsonb_array_length(p_documents)<>3 then raise exception 'São necessários os três documentos vigentes'; end if;
 -- Bloqueio consistente com a ativação e com tentativas simultâneas do mesmo usuário.
 perform pg_advisory_xact_lock(hashtextextended(v_user::text,157));
 perform 1 from tamoon_legal.documents where active for share;
 if (select count(*) from tamoon_legal.documents where active and effective_at<=now())<>3 then
   raise exception 'Documentos vigentes indisponíveis'; end if;
 for v_doc in select * from tamoon_legal.documents where active and effective_at<=now() loop
  if (select count(*) from jsonb_array_elements(p_documents) x
    where x->>'id'=v_doc.id::text and x->>'content_hash'=v_doc.content_hash and x->>'version'=v_doc.version)<>1 then
    raise exception 'Os documentos foram atualizados. Reabra a tela antes de aceitar'; end if;
 end loop;
 v_headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 insert into tamoon_legal.subjects(user_id,adult_declared_at) values(v_user,now()) on conflict do nothing;
 if exists(select 1 from tamoon_legal.subjects where user_id=v_user and relationship_ended_at is not null) then
   raise exception 'Conta encerrada'; end if;
 insert into tamoon_legal.acceptances(user_id,legal_document_id,app_build,document_type,document_version,content_hash,effective_at,user_agent,source,evidence_metadata)
 select v_user,d.id,p_app_build,d.document_type,d.version,d.content_hash,d.effective_at,
   left(v_headers->>'user-agent',300),p_source,
   jsonb_build_object('adult_self_declaration',true,'statement','Declaro ter 18 anos completos ou mais.',
     'terms_agreed',true,'privacy_acknowledged',true,'conduct_agreed',true,'source_docx_hash',d.source_hash)
 from tamoon_legal.documents d where d.active and d.effective_at<=now()
 on conflict(user_id,legal_document_id) do nothing;
 return public.get_community_legal_status();
end; $$;

-- Função para Edge Functions; o cliente não pode consultar o aceite de terceiros.
create or replace function public.community_legal_access_for_user(p_user_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select tamoon_legal.has_access(p_user_id);
$$;
revoke all on function public.community_legal_access_for_user(uuid) from public,anon,authenticated;
grant execute on function public.community_legal_access_for_user(uuid) to service_role;

create or replace function tamoon_legal.export_evidence(p_user_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('user_id',p_user_id,'adult_declaration',
 (select jsonb_build_object('declared_at',adult_declared_at,'statement',age_statement,'relationship_ended_at',relationship_ended_at)
 from tamoon_legal.subjects where user_id=p_user_id), 'acceptances',coalesce((
 select jsonb_agg(to_jsonb(a)||jsonb_build_object('title',d.title,'public_url',d.public_url,'content_html',d.content_html,'source_filename',d.source_filename,'source_hash',d.source_hash) order by a.accepted_at)
 from tamoon_legal.acceptances a join tamoon_legal.documents d on d.id=a.legal_document_id where a.user_id=p_user_id),'[]'::jsonb));
$$;
create or replace function public.export_my_legal_acceptances()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 if auth.uid() is null then raise exception 'Sessão não autenticada'; end if;
 return tamoon_legal.export_evidence(auth.uid());
end; $$;
create or replace function public.platform_export_legal_acceptances(p_user_id uuid,p_purpose text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 if auth.uid() is null or not public.is_platform_admin() or not tamoon_legal.has_access(auth.uid()) then
   raise exception 'Acesso restrito à administração com aceite vigente'; end if;
 if p_user_id is null or char_length(trim(coalesce(p_purpose,''))) not between 10 and 500 then
   raise exception 'Informe o usuário e o motivo da consulta (10 a 500 caracteres)'; end if;
 insert into tamoon_legal.audit(actor_id,subject_id,event_type,purpose)
 values(auth.uid(),p_user_id,'evidence_export',trim(p_purpose));
 return tamoon_legal.export_evidence(p_user_id);
end; $$;

create or replace function tamoon_legal.end_relationship()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 update tamoon_legal.subjects set relationship_ended_at=coalesce(relationship_ended_at,now()) where user_id=old.id;
 return old;
end; $$;
drop trigger if exists legal_end_relationship on auth.users;
create trigger legal_end_relationship before delete on auth.users for each row execute function tamoon_legal.end_relationship();
create or replace function tamoon_legal.purge_expired_evidence()
returns bigint language plpgsql security definer set search_path=pg_catalog as $$
declare v_count bigint;
begin
 delete from tamoon_legal.acceptances a using tamoon_legal.subjects s
 where s.user_id=a.user_id and s.relationship_ended_at<now()-interval '5 years' and not s.retention_hold;
 get diagnostics v_count=row_count;
 delete from tamoon_legal.audit a using tamoon_legal.subjects s
 where s.user_id=a.subject_id and s.relationship_ended_at<now()-interval '5 years' and not s.retention_hold;
 delete from tamoon_legal.subjects s where relationship_ended_at<now()-interval '5 years' and not retention_hold;
 return v_count;
end; $$;

-- Gate de todas as rotas REST, inclusive RPCs SECURITY DEFINER e views legadas.
create or replace function tamoon_legal.check_request()
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare v_previous regprocedure; v_name text; v_path text;
begin
 select previous_hook into v_previous from tamoon_legal.settings where singleton;
 if v_previous is not null then
  select format('%I.%I',n.nspname,p.proname) into v_name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid=v_previous::oid;
  if v_name is not null then execute 'select '||v_name||'()'; end if;
 end if;
 if auth.role()='service_role' then return; end if;
 v_path:=trim(both '/' from coalesce(current_setting('request.path',true),''));
 if v_path in ('rpc/get_community_legal_access_status','rpc/get_community_legal_status','rpc/get_community_legal_document','rpc/accept_community_legal_documents','rpc/export_my_legal_acceptances','rpc/claim_beta_access') then return; end if;
 if not tamoon_legal.has_access(auth.uid()) then
   raise sqlstate 'PT403' using message='LEGAL_ACCEPTANCE_REQUIRED',hint='Confirme a maioridade e os documentos vigentes no Tâmo On';
 end if;
end; $$;

-- Preserva o hook anterior, sem substituir silenciosamente validações já existentes.
do $$
declare v_previous text;
begin
 select substr(setting,length('pgrst.db_pre_request=')+1) into v_previous
 from pg_db_role_setting s cross join lateral unnest(s.setconfig) setting
 where s.setrole=(select oid from pg_roles where rolname='authenticator')
 and s.setdatabase in (0,(select oid from pg_database where datname=current_database()))
 and setting like 'pgrst.db_pre_request=%' order by s.setdatabase desc limit 1;
 if nullif(v_previous,'') is not null and v_previous<>'tamoon_legal.check_request' then
  if to_regprocedure(v_previous||'()') is null then raise exception 'Hook REST anterior não localizado: %',v_previous; end if;
  update tamoon_legal.settings set previous_hook=to_regprocedure(v_previous||'()') where singleton;
 end if;
 execute format('alter role authenticator in database %I set pgrst.db_pre_request = %L',current_database(),'tamoon_legal.check_request');
end; $$;

-- RLS também protege assinaturas Realtime; as permissões existentes continuam valendo.
do $$
declare t record;
begin
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity
 and c.relname not in ('app_releases','beta_access','platform_admins') loop
   execute format('drop policy if exists community_legal_gate on public.%I',t.relname);
   execute format('create policy community_legal_gate on public.%I as restrictive for all to authenticated using ((select tamoon_legal.current_user_has_access())) with check ((select tamoon_legal.current_user_has_access()))',t.relname);
 end loop;
end; $$;

revoke all on all functions in schema tamoon_legal from public,anon,authenticated,service_role;
grant execute on function tamoon_legal.current_user_has_access() to authenticated,anon;
grant execute on function tamoon_legal.check_request() to authenticated,anon,service_role;
revoke all on function public.get_community_legal_status() from public;
grant execute on function public.get_community_legal_status() to anon,authenticated;
revoke all on function public.accept_community_legal_documents(jsonb,boolean,boolean,boolean,boolean,integer,text) from public,anon;
grant execute on function public.accept_community_legal_documents(jsonb,boolean,boolean,boolean,boolean,integer,text) to authenticated;
revoke all on function public.export_my_legal_acceptances() from public,anon;
grant execute on function public.export_my_legal_acceptances() to authenticated;
revoke all on function public.platform_export_legal_acceptances(uuid,text) from public,anon;
grant execute on function public.platform_export_legal_acceptances(uuid,text) to authenticated;

-- Defesa adicional nas RPCs PL/pgSQL usadas pelo app, inclusive chamadas sem REST.
create or replace function tamoon_legal.require_access()
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if auth.role()='service_role' then return; end if;
 if not tamoon_legal.has_access(auth.uid()) then
   raise sqlstate 'PT403' using message='LEGAL_ACCEPTANCE_REQUIRED';
 end if;
end; $$;
revoke all on function tamoon_legal.require_access() from public,anon,authenticated,service_role;
create table if not exists tamoon_legal.guarded_rpcs(signature text primary key);
revoke all on tamoon_legal.guarded_rpcs from public,anon,authenticated,service_role;
alter table tamoon_legal.guarded_rpcs enable row level security;
do $guard$
declare p record; v_source text;
begin
 for p in select f.oid,f.prosrc,pg_get_functiondef(f.oid) as definition,f.oid::regprocedure::text as signature
 from pg_proc f join pg_namespace n on n.oid=f.pronamespace join pg_language l on l.oid=f.prolang
 where n.nspname='public' and l.lanname='plpgsql' and f.prosecdef
 and f.proname=any(array['balance_match_teams_with_count','clear_match_team_assignments','clear_match_waitlist_draw','create_batch_charges','create_group','create_match_guest','create_match_schedule','delete_announcement','delete_finance_entry','delete_group_permanently','delete_scheduled_match','delete_scheduled_match_series','draw_match_waitlist_v2','join_group_by_code','manage_match_attendance_batch','mark_all_user_notifications_read','mark_group_announcements_read','mark_user_notifications_read','platform_beta_access_invite','platform_beta_access_list','platform_beta_access_set_status','platform_beta_summary','platform_error_details','platform_error_groups','platform_group_export','platform_operational_export','platform_push_delivery_attempts_v2','platform_push_health_list_v2','platform_recent_feedback','platform_recent_logs','platform_security_summary','record_batch_payments','record_payment','reinvite_match_guest','remove_group_member','remove_match_guest_record','remove_push_subscription','save_push_subscription','set_member_role','set_my_match_attendance','set_my_match_bbq_response','set_my_match_game_response','submit_beta_feedback','transfer_group_administration','update_group_settings','update_match_bbq_settings','update_match_guest','update_match_settings','update_my_player_profile','update_my_profile','upsert_member_rating']) loop
  if position('perform tamoon_legal.require_access();' in p.prosrc)=0 then
   v_source:=regexp_replace(p.prosrc,'(^|\n)([ \t]*)begin([ \t]*\r?\n)',E'\\1\\2begin\\3  perform tamoon_legal.require_access();\n','i');
   if v_source=p.prosrc then raise exception 'Não foi possível proteger a RPC %',p.signature; end if;
   execute replace(p.definition,p.prosrc,v_source);
  end if;
  insert into tamoon_legal.guarded_rpcs(signature) values(p.signature) on conflict do nothing;
 end loop;
end; $guard$;

-- Somente SQL Editor/operador do banco pode ativar a versão. Sem acesso via cliente.
create or replace function tamoon_legal.activate_v1_2(p_effective_at timestamptz)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if p_effective_at is null then raise exception 'Defina expressamente a data de vigência antes de ativar'; end if;
 if p_effective_at>now() then raise exception 'Execute a ativação a partir da data de vigência'; end if;
 if p_effective_at<'2026-09-11 00:00:00-03'::timestamptz then raise exception 'A vigência não pode anteceder os documentos v1.2'; end if;
 perform 1 from tamoon_legal.settings where singleton for update;
 if (select count(*) from tamoon_legal.documents where version='1.2')<>3 then raise exception 'Os três documentos v1.2 são necessários'; end if;
 if exists(select 1 from tamoon_legal.documents where version='1.2' and published_at is not null and effective_at is distinct from p_effective_at) then raise exception 'Vigência publicada é imutável'; end if;
 if exists(select 1 from tamoon_legal.documents where active and version<>'1.2') then raise exception 'Uma versão posterior já está ativa'; end if;
 update tamoon_legal.documents set effective_at=p_effective_at,published_at=now(),active=true where version='1.2' and published_at is null;
 if (select count(*) from tamoon_legal.documents where version='1.2' and active)<>3 then raise exception 'Não reative uma versão arquivada'; end if;
 update tamoon_legal.settings set enabled=true,activated_at=coalesce(activated_at,now()) where singleton;
 insert into tamoon_legal.audit(event_type,purpose) values('legal_activation','Ativação v1.2 com vigência '||p_effective_at::text);
end; $$;
revoke all on function tamoon_legal.activate_v1_2(timestamptz) from public,anon,authenticated,service_role;

insert into tamoon_legal.documents(document_type,version,title,content_html,content_hash,source_hash,source_filename,locale,public_url)
select j->>'document_type',j->>'version',j->>'title',j->>'content_html',j->>'content_hash',j->>'source_hash',j->>'source_filename',j->>'locale',j->>'public_url'
from (select $legaljson${"document_type": "terms", "version": "1.2", "title": "Termos de Uso", "content_html": "<h2>1. Identificação do responsável</h2>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Campo</th><th>Informação</th></tr><tr><td>Nome empresarial / controlador</td><td>TAMO ON TECNOLOGIA E INTERMEDIACAO LTDA</td></tr><tr><td>Nome fantasia</td><td>Tâmo On</td></tr><tr><td>CNPJ</td><td>69.074.880/0001-47</td></tr><tr><td>Endereço</td><td>Rua Visconde de Abaeté, nº 34, apto. 101, térreo, Bloco A, Condomínio Ilha das Peças Residencial, Bairro Alto, Curitiba/PR, CEP 82820-210</td></tr><tr><td>Domínio oficial</td><td>tamoon.app.br</td></tr><tr><td>Canal institucional</td><td>contato@tamoon.app.br</td></tr><tr><td>Canal de suporte</td><td>suporte@tamoon.app.br</td></tr><tr><td>Canal de privacidade/LGPD</td><td>privacidade@tamoon.app.br</td></tr><tr><td>Encarregado ou canal equivalente</td><td>Canal equivalente: privacidade@tamoon.app.br. Encarregado formal não indicado nesta fase, sujeito à confirmação do enquadramento regulatório aplicável.</td></tr></table></div>\n<h2>2. Aceitação e vínculo contratual</h2>\n<p>Ao criar ou acessar uma conta e marcar as opções de aceite, o usuário declara que leu e concorda com estes Termos, com o Código de Conduta e que tomou ciência da Política de Privacidade. O aceite eletrônico será registrado com versão, data, usuário, hash do conteúdo e informações técnicas proporcionais à comprovação.</p>\n<p>O acesso poderá ser bloqueado até que o usuário aceite a versão vigente. Consentimentos opcionais, como notificações push ou comunicações promocionais futuras, serão tratados separadamente.</p>\n<h2>3. Elegibilidade</h2>\n<p>O Tâmo On será disponibilizado, no lançamento, exclusivamente para pessoas com 18 anos ou mais e capazes de praticar atos da vida civil. A admissão de menores dependerá de alteração formal destes documentos e implantação de salvaguardas específicas.</p>\n<h2>4. Conta e autenticação</h2>\n<p>o acesso é individual e vinculado à conta autenticada admitida pela plataforma;</p>\n<p>o usuário deve manter sua conta e dispositivo protegidos e não compartilhar acesso;</p>\n<p>informações de perfil devem ser verdadeiras, atualizadas e não podem imitar terceiros;</p>\n<p>atividades realizadas por conta autenticada poderão ser atribuídas ao respectivo titular, sem prejuízo da investigação de fraude;</p>\n<p>o usuário deve comunicar perda, invasão, uso indevido ou mudança de controle da conta.</p>\n<h2>5. Finalidade e funcionalidades</h2>\n<p>O Tâmo On é uma ferramenta de organização de grupos esportivos, especialmente partidas e eventos recreativos. Pode oferecer criação de grupos, convites, papéis administrativos, agenda, confirmações, lista de espera, convidados, sorteio, separação de times, churrasco, avaliações, avisos, notificações e registros financeiros internos.</p>\n<p>Na versão Comunidade atualmente prevista para o beta aberto, o Tâmo On não organiza fisicamente os eventos, não administra quadras, não presta serviço médico, não garante presença, desempenho ou segurança esportiva e não substitui acordos legítimos entre os participantes.</p>\n<h2>6. Papéis e permissões nos grupos</h2>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Papel</th><th>Responsabilidades gerais</th></tr><tr><td>Administrador</td><td>Controla o grupo, funções, integrantes, configurações e permissões disponíveis.</td></tr><tr><td>Organizador</td><td>Gerencia eventos, presença, convidados, espera, times e avisos conforme permissões.</td></tr><tr><td>Tesoureiro</td><td>Registra e consulta cobranças, pagamentos e despesas do grupo.</td></tr><tr><td>Membro</td><td>Participa de grupos, responde presença, consulta informações permitidas e utiliza recursos liberados.</td></tr></table></div>\n<h2>7. Responsabilidades de administradores e organizadores</h2>\n<p>convidar apenas pessoas legitimamente relacionadas ao grupo e proteger códigos de convite;</p>\n<p>informar convidados sobre o cadastro e inserir somente o mínimo necessário;</p>\n<p>não utilizar posições, avaliações ou presença para constranger, discriminar ou expor membros;</p>\n<p>usar cobranças e despesas apenas para finalidades reais do grupo;</p>\n<p>aplicar regras internas de forma proporcional e compatível com o Código de Conduta;</p>\n<p>cumprir regras do local, segurança, horários e obrigações assumidas fora da plataforma.</p>\n<h2>8. Convidados e dados de terceiros</h2>\n<p>Ao cadastrar convidado ou inserir dado de terceiro, o usuário declara possuir autorização ou fundamento legítimo para fazê-lo e deverá informar a pessoa, de forma razoável, sobre o uso dos dados. O cadastro deve ser mínimo e vinculado à finalidade específica. O convidado poderá exercer direitos de correção, exclusão, oposição e informação pelo canal de privacidade/LGPD.</p>\n<h2>9. Módulo financeiro da Comunidade</h2>\n<p>Na versão atual, o módulo Caixa é um registro organizacional. O Tâmo On não recebe, guarda ou transfere dinheiro por esse módulo, não processa cartão ou Pix, não atua como instituição financeira, cobrador, bureau de crédito ou garantidor de dívida. Os usuários são responsáveis por conferir valores, comprovantes e pagamentos realizados fora da plataforma.</p>\n<p>A futura ativação de marketplace, reservas comerciais e processamento de pagamentos constituirá alteração material do serviço e dependerá de termos específicos ou atualização destes Termos, da Política de Privacidade e dos demais instrumentos, com novo aceite quando aplicável.</p>\n<h2>10. Avaliações e formação de times</h2>\n<p>Avaliações devem refletir critérios esportivos e ser feitas de boa-fé. É proibido usar notas para humilhar, retaliar, discriminar ou perseguir. O algoritmo pode considerar posições, goleiros e médias para sugerir equilíbrio, sem garantia de resultado perfeito. Pedidos de revisão poderão ser encaminhados ao suporte quando houver indício de abuso, erro ou impacto indevido.</p>\n<h2>11. Notificações e comunicações</h2>\n<p>Notificações dependem do sistema operacional, dispositivo, conexão, permissões e serviços de terceiros. A plataforma não garante entrega instantânea ou integral. Mensagens essenciais poderão ser exibidas dentro do aplicativo.</p>\n<h2>12. Fase beta, disponibilidade e alterações</h2>\n<p>Durante a fase beta, funcionalidades podem ser alteradas, suspensas ou removidas, podendo ocorrer erros, indisponibilidades e necessidade de atualização. Serão adotadas medidas razoáveis de continuidade e segurança, sem garantia de disponibilidade ininterrupta. Mudanças materiais serão comunicadas quando possível.</p>\n<h2>13. Conteúdo e propriedade intelectual</h2>\n<p>A marca Tâmo On, identidade visual, código, interfaces, textos e demais elementos protegidos pertencem ao responsável ou a seus licenciantes. O usuário recebe licença limitada, revogável, não exclusiva e intransferível para uso legítimo da plataforma.</p>\n<p>Conteúdos inseridos pelo usuário permanecem sob sua responsabilidade. O usuário concede ao Tâmo On licença limitada para armazenar, processar, exibir e transmitir esses conteúdos exclusivamente na medida necessária para operar, proteger e melhorar o serviço.</p>\n<h2>14. Condutas proibidas</h2>\n<p>É obrigatório cumprir o Código de Conduta. São vedados, entre outros, fraude, assédio, discriminação, ameaças, exposição indevida de dados, invasão, manipulação de registros, spam, conteúdo ilegal, falsidade de identidade, uso automatizado não autorizado e tentativas de contornar sanções.</p>\n<h2>15. Moderação, exclusão de grupo, restrição, suspensão e banimento</h2>\n<p>As medidas abaixo têm naturezas e consequências distintas:</p>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Medida</th><th>Alcance</th></tr><tr><td>Exclusão de um grupo</td><td>Remove o usuário apenas daquele grupo. Não implica, por si só, suspensão da conta ou banimento do Tâmo On.</td></tr><tr><td>Restrição funcional</td><td>Limita temporariamente uma ou mais funções específicas, como publicar, convidar, cobrar, avaliar ou administrar.</td></tr><tr><td>Suspensão temporária da conta</td><td>Impede o acesso à plataforma por prazo determinado, conforme gravidade, risco e reincidência.</td></tr><tr><td>Banimento definitivo</td><td>Encerra o acesso à plataforma e pode impedir nova conta quando houver fundamento proporcional e compatível com o Código de Conduta.</td></tr></table></div>\n<p>Em situações graves ou de risco concreto poderá haver suspensão preventiva enquanto os fatos são apurados. Sempre que razoável e seguro, será informado o motivo e disponibilizada possibilidade de revisão humana.</p>\n<h2>16. Encerramento da conta e dados</h2>\n<p>O usuário poderá solicitar encerramento da conta. A eliminação dos dados observará a Política de Privacidade, direitos de terceiros, registros de segurança, prazos de retenção e obrigações legais aplicáveis.</p>\n<h2>17. Responsabilidade e limites legais</h2>\n<p>Cada usuário e grupo é responsável por suas decisões, eventos, relações financeiras externas e condutas. O Tâmo On responderá nos limites da legislação aplicável e não exclui responsabilidades que não possam ser legalmente afastadas. Não haverá responsabilidade por danos decorrentes exclusivamente de informações falsas inseridas por usuários, falhas de terceiros, uso indevido do dispositivo ou descumprimento destas regras, salvo quando houver dever legal de indenizar.</p>\n<h2>18. Privacidade</h2>\n<p>O tratamento de dados pessoais é regido pela Política de Privacidade e Uso de Dados. O usuário poderá exercer seus direitos pelo canal de privacidade/LGPD.</p>\n<h2>19. Alterações dos Termos</h2>\n<p>Estes Termos poderão ser atualizados para refletir mudanças legais, técnicas ou comerciais. Alterações materiais exigirão novo aceite. A ativação de marketplace, reservas comerciais, pagamentos integrados ou mudança relevante de responsabilidade será tratada como alteração material.</p>\n<h2>20. Lei aplicável e solução de conflitos</h2>\n<p>Aplica-se a legislação brasileira. As partes buscarão solução amigável pelos canais oficiais. Quando houver relação de consumo, serão preservados os direitos do consumidor e a competência do foro legalmente aplicável, inclusive o domicílio do consumidor. Nos demais casos e quando permitido, poderá ser eleito o foro de Curitiba/PR.</p>\n<h2>21. Contato</h2>\n<p>Canal institucional: contato@tamoon.app.br</p>\n<p>Suporte: suporte@tamoon.app.br</p>\n<p>Privacidade/LGPD: privacidade@tamoon.app.br</p>\n<h2>Referências normativas consideradas</h2>\n<p>Lei nº 13.709/2018 - Lei Geral de Proteção de Dados Pessoais (LGPD).</p>\n<p>Lei nº 12.965/2014 - Marco Civil da Internet.</p>\n<p>Decreto nº 8.771/2016 - regulamentação do Marco Civil da Internet.</p>\n<p>Lei nº 8.078/1990 - Código de Defesa do Consumidor, quando caracterizada relação de consumo.</p>\n<p>Resolução CD/ANPD nº 15/2024 - Comunicação de Incidente de Segurança.</p>\n<p>Resolução CD/ANPD nº 18/2024 - Atuação do encarregado pelo tratamento de dados pessoais.</p>\n<p>Resolução CD/ANPD nº 19/2024 e alterações aplicáveis - Transferência Internacional de Dados.</p>\n<p>Resolução CD/ANPD nº 2/2022 - Agentes de tratamento de pequeno porte, quando aplicável.</p>\n<p>Enunciado CD/ANPD nº 1/2023 - tratamento de dados de crianças e adolescentes.</p>\n<p>Orientações e guias vigentes da ANPD sobre direitos dos titulares, avisos de privacidade, legítimo interesse e segurança da informação.</p>", "content_hash": "874d70951a2b6037717cae9dd937175ec16380139f37c53400b3b8faae9c5000", "source_hash": "0796522629d92e6bc2af8d8db65ec0f51e52686db2f73424da067e951a805bd6", "source_filename": "02-Termos-de-Uso-Tamo-On-v1.2.docx", "public_url": "/legal/termos-de-uso-v1.2.html", "locale": "pt-BR"}$legaljson$::jsonb j) s
on conflict(document_type,version) do nothing;
insert into tamoon_legal.documents(document_type,version,title,content_html,content_hash,source_hash,source_filename,locale,public_url)
select j->>'document_type',j->>'version',j->>'title',j->>'content_html',j->>'content_hash',j->>'source_hash',j->>'source_filename',j->>'locale',j->>'public_url'
from (select $legaljson${"document_type": "privacy", "version": "1.2", "title": "Política de Privacidade e Uso de Dados", "content_html": "<h2>1. Identificação do responsável</h2>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Campo</th><th>Informação</th></tr><tr><td>Nome empresarial / controlador</td><td>TAMO ON TECNOLOGIA E INTERMEDIACAO LTDA</td></tr><tr><td>Nome fantasia</td><td>Tâmo On</td></tr><tr><td>CNPJ</td><td>69.074.880/0001-47</td></tr><tr><td>Endereço</td><td>Rua Visconde de Abaeté, nº 34, apto. 101, térreo, Bloco A, Condomínio Ilha das Peças Residencial, Bairro Alto, Curitiba/PR, CEP 82820-210</td></tr><tr><td>Domínio oficial</td><td>tamoon.app.br</td></tr><tr><td>Canal institucional</td><td>contato@tamoon.app.br</td></tr><tr><td>Canal de suporte</td><td>suporte@tamoon.app.br</td></tr><tr><td>Canal de privacidade/LGPD</td><td>privacidade@tamoon.app.br</td></tr><tr><td>Encarregado ou canal equivalente</td><td>Canal equivalente: privacidade@tamoon.app.br. Encarregado formal não indicado nesta fase, sujeito à confirmação do enquadramento regulatório aplicável.</td></tr></table></div>\n<h2>2. Objetivo e abrangência</h2>\n<p>Esta Política explica como o Tâmo On coleta, utiliza, compartilha, armazena, protege e elimina dados pessoais de usuários, administradores de grupos, organizadores, tesoureiros, membros, convidados e pessoas que utilizem os canais oficiais. Aplica-se ao aplicativo móvel, à versão web/PWA enquanto disponibilizada, ao site institucional e aos serviços diretamente relacionados à plataforma.</p>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Resumo da fase atual<br>O Tâmo On não vende dados pessoais. Na versão atual destinada à Comunidade, o módulo Caixa possui finalidade organizacional e não processa Pix, cartão ou transferências bancárias. A futura ativação de marketplace, reservas comerciais ou processamento de pagamentos será considerada alteração material e exigirá revisão desta Política, da Matriz Interna e dos demais documentos antes da disponibilização da funcionalidade.</th></tr></table></div>\n<h2>3. Princípios de proteção de dados</h2>\n<p>O tratamento observará finalidade, adequação, necessidade, livre acesso, qualidade dos dados, transparência, segurança, prevenção, não discriminação e responsabilização. O Tâmo On buscará tratar apenas dados compatíveis com funcionalidades legítimas e informadas, com acesso limitado às pessoas e sistemas que necessitem dessas informações.</p>\n<h2>4. Dados pessoais tratados</h2>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Categoria</th><th>Exemplos</th><th>Origem</th></tr><tr><td>Conta e autenticação</td><td>Nome, e-mail, identificador Google, foto de perfil e metadados mínimos de autenticação.</td><td>Usuário e provedor de autenticação.</td></tr><tr><td>Perfil esportivo</td><td>Nome, apelido, posições, indicação de goleiro, papel no grupo e foto.</td><td>Usuário ou administrador autorizado.</td></tr><tr><td>Grupos e eventos</td><td>Grupo, integrantes, funções, datas, locais, presença, espera, times, churrasco, acompanhantes, avisos e observações.</td><td>Usuários e administradores/organizadores.</td></tr><tr><td>Avaliações e balanceamento</td><td>Notas confidenciais, médias internas e resultados usados para sugestões de equilíbrio.</td><td>Membros autorizados e processamento interno.</td></tr><tr><td>Convidados</td><td>Nome ou apelido, posição e vínculo com evento específico; outros dados somente se estritamente necessários.</td><td>Administrador ou organizador que cadastra o convidado.</td></tr><tr><td>Registros financeiros internos</td><td>Cobranças, pagamentos, despesas, valores, vencimentos, descrições e vínculo com participante.</td><td>Administrador ou tesoureiro.</td></tr><tr><td>Notificações</td><td>Token/endpoint push, chaves técnicas, dispositivo, sistema, status de autorização e histórico técnico de envio.</td><td>Dispositivo, sistema operacional e usuário.</td></tr><tr><td>Dados técnicos e segurança</td><td>IP quando registrado, data/hora, user-agent, versão/build, erros, diagnósticos, eventos de segurança e auditoria.</td><td>Uso da plataforma e infraestrutura.</td></tr><tr><td>Suporte e beta</td><td>Relatos, sugestões, anexos, categoria do problema, autorização de contato e contexto técnico.</td><td>Usuário.</td></tr><tr><td>Armazenamento local</td><td>Sessão, preferências, grupo selecionado, cache e dados necessários à experiência.</td><td>Dispositivo/aplicativo.</td></tr></table></div>\n<h2>5. Finalidades e bases legais</h2>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Finalidade</th><th>Base legal principal</th></tr><tr><td>Criar e manter a conta, autenticar, controlar acesso, integridade e segurança.</td><td>Execução de contrato/procedimentos preliminares; legítimo interesse; prevenção à fraude; exercício regular de direitos.</td></tr><tr><td>Criar grupos, gerenciar membros, eventos, presença, espera, times e convidados.</td><td>Execução de contrato; legítimo interesse relacionado à organização do grupo.</td></tr><tr><td>Manter registros financeiros internos do grupo.</td><td>Execução de contrato; legítimo interesse; exercício regular de direitos.</td></tr><tr><td>Enviar notificações solicitadas pelo usuário.</td><td>Consentimento/ação específica para ativação e execução do serviço solicitado.</td></tr><tr><td>Atender suporte, corrigir erros, gerar métricas de produto e prevenir abusos.</td><td>Legítimo interesse, sujeito a teste de balanceamento e minimização; execução de contrato.</td></tr><tr><td>Cumprir deveres legais, atender autoridades e defender direitos.</td><td>Cumprimento de obrigação legal/regulatória; exercício regular de direitos.</td></tr><tr><td>Produzir estatísticas agregadas.</td><td>Legítimo interesse; quando efetivamente anonimizadas, fora do escopo da LGPD.</td></tr></table></div>\n<p>O aceite desta Política comprova ciência e transparência, mas não transforma todas as operações em tratamento baseado em consentimento. Consentimentos opcionais, como push ou futuras comunicações promocionais, serão solicitados separadamente e poderão ser revogados.</p>\n<h2>6. Dados sensíveis e informações não solicitadas</h2>\n<p>O Tâmo On não solicita deliberadamente dados pessoais sensíveis para as funcionalidades atuais. O usuário não deve inserir, em campos livres ou suporte, informações de saúde, biometria, religião, origem racial ou étnica, opinião política, filiação sindical, vida sexual ou outras informações sensíveis, salvo quando houver orientação específica, finalidade legítima e base legal adequada.</p>\n<h2>7. Cadastro de convidados</h2>\n<p>O cadastro de convidado deve utilizar a menor quantidade de dados possível e permanecer vinculado a evento ou finalidade determinada. Quem realizar o cadastro deverá possuir autorização ou fundamento legítimo e informar o convidado, de forma razoável, de que seus dados foram inseridos no Tâmo On.</p>\n<p>o convidado poderá solicitar correção, exclusão, oposição ou esclarecimentos pelos canais de privacidade/LGPD;</p>\n<p>dados de convidado não poderão ser reutilizados para marketing, perseguição, exposição ou finalidade incompatível;</p>\n<p>encerrada a finalidade, os dados serão eliminados ou reduzidos ao mínimo necessário para histórico legítimo, segurança ou exercício de direitos;</p>\n<p>se o convidado posteriormente criar conta, a vinculação de dados deverá ocorrer de forma controlada, evitando duplicidade ou atribuição incorreta.</p>\n<h2>8. Avaliações, perfilamento esportivo e revisão humana</h2>\n<p>Posições, disponibilidade de goleiros e médias de avaliações podem ser utilizadas para sugerir ou formar times. Trata-se de perfilamento recreativo/esportivo, sem finalidade jurídica, trabalhista, creditícia ou de saúde.</p>\n<p>as avaliações individuais devem permanecer confidenciais e acessíveis apenas a quem possua permissão compatível;</p>\n<p>o titular poderá solicitar correção de dados objetivos e esclarecimento sobre o funcionamento geral do balanceamento;</p>\n<p>quando houver alegação plausível de erro, abuso, discriminação ou impacto indevido, será disponibilizada revisão humana;</p>\n<p>é vedado utilizar avaliações para discriminar, retaliar, humilhar ou produzir exposição indevida.</p>\n<h2>9. Compartilhamento, operadores e fornecedores</h2>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Fornecedor/categoria</th><th>Finalidade</th><th>Dados típicos</th><th>Situação</th></tr><tr><td>Google</td><td>Autenticação e serviços associados.</td><td>Dados básicos autorizados de conta e metadados técnicos.</td><td>Fornecedor atual; condições e documentos contratuais devem ser mantidos arquivados.</td></tr><tr><td>Supabase</td><td>Banco de dados, autenticação complementar, backend e funções.</td><td>Dados de conta, grupos, eventos, registros e logs conforme a função.</td><td>Fornecedor atual; acessos e região contratada devem ser documentados.</td></tr><tr><td>Cloudflare</td><td>Hospedagem, distribuição, segurança e desempenho.</td><td>IP, requisições, conteúdo estático e metadados técnicos.</td><td>Fornecedor atual; configurações e mecanismos de transferência devem ser documentados.</td></tr><tr><td>Provedores de push / sistema operacional</td><td>Entrega de notificações.</td><td>Token/endpoint e metadados técnicos necessários.</td><td>Tratamento limitado à entrega e diagnóstico.</td></tr><tr><td>Google Play / Apple App Store</td><td>Distribuição do aplicativo e serviços próprios da loja.</td><td>Dados tratados pelas lojas conforme suas políticas e, quando aplicável, diagnósticos técnicos.</td><td>Cada provedor possui responsabilidades próprias; integrações do app devem ser inventariadas.</td></tr><tr><td>Prestadores jurídicos, contábeis, técnicos e de segurança</td><td>Suporte profissional necessário.</td><td>Somente dados pertinentes à demanda.</td><td>Acesso pontual, com confidencialidade e necessidade.</td></tr></table></div>\n<p>O Tâmo On não comercializa bancos de dados pessoais. Autoridades públicas poderão receber informações quando houver obrigação legal, ordem válida ou necessidade de exercício regular de direitos.</p>\n<h2>10. Transferências internacionais</h2>\n<p>Alguns fornecedores de nuvem, autenticação, distribuição, hospedagem e notificação podem tratar dados fora do Brasil. Antes da abertura pública, o controlador manterá inventário dos fluxos internacionais, identificará o papel de cada fornecedor e documentará o mecanismo jurídico aplicável, conforme a LGPD e a regulamentação da ANPD. A transferência deverá observar necessidade, segurança e limitação de finalidade.</p>\n<h2>11. Retenção e exclusão</h2>\n<p>A tabela abaixo representa a política operacional pretendida e deverá corresponder às rotinas efetivamente implementadas no sistema antes da publicação.</p>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Dado/registro</th><th>Prazo ou evento principal</th><th>Evento de exclusão</th><th>Exceções</th></tr><tr><td>Conta e perfil</td><td>Enquanto a conta estiver ativa.</td><td>Pedido válido de exclusão ou encerramento; exclusão operacional em até 30 dias após conclusão do fluxo.</td><td>Obrigação legal, prevenção à fraude, segurança e exercício de direitos.</td></tr><tr><td>Associação a grupos e papéis</td><td>Enquanto houver vínculo ativo + até 12 meses para auditoria mínima.</td><td>Fim do vínculo + decurso do prazo.</td><td>Registros indispensáveis a direitos de terceiros ou apuração de abuso.</td></tr><tr><td>Eventos, presença e histórico</td><td>Até 24 meses após o evento, salvo histórico necessário ao grupo.</td><td>Fim do prazo ou exclusão válida do grupo.</td><td>Litígio, fraude, segurança ou obrigação legal.</td></tr><tr><td>Convidados</td><td>Até 90 dias após o evento.</td><td>Fim do prazo ou solicitação válida anterior.</td><td>Necessidade comprovada de histórico, segurança ou exercício de direitos.</td></tr><tr><td>Avaliações esportivas</td><td>Enquanto houver vínculo ativo + até 12 meses.</td><td>Fim do vínculo e do prazo.</td><td>Apuração de abuso ou defesa de direitos.</td></tr><tr><td>Financeiro interno</td><td>Até 5 anos após o último registro relacionado, como política conservadora de defesa de direitos, sujeita à validação contábil/jurídica.</td><td>Fim do prazo.</td><td>Obrigação legal ou disputa em curso.</td></tr><tr><td>Push</td><td>Até revogação, logout definitivo, endpoint inválido ou encerramento da conta.</td><td>Evento técnico ou revogação.</td><td>Logs mínimos de segurança, quando necessários.</td></tr><tr><td>Logs de acesso à aplicação</td><td>6 meses quando aplicável o art. 15 do Marco Civil.</td><td>Decurso do prazo.</td><td>Ordem legal, investigação de fraude ou exercício de direitos.</td></tr><tr><td>Feedback e diagnóstico beta</td><td>Até 12 meses.</td><td>Fim do prazo.</td><td>Investigação, segurança ou correção ainda em curso.</td></tr><tr><td>Backups</td><td>Ciclo técnico com expurgo preferencial em até 90 dias após exclusão operacional.</td><td>Substituição/expurgo do backup.</td><td>Necessidade técnica temporária, com acesso restrito.</td></tr><tr><td>Aceites legais</td><td>Durante a relação + 5 anos após encerramento, como política de defesa contratual.</td><td>Fim do prazo.</td><td>Litígio ou obrigação legal.</td></tr></table></div>\n<h2>12. Segurança da informação</h2>\n<p>Serão adotadas medidas técnicas e administrativas proporcionais aos riscos, incluindo autenticação por provedor confiável, criptografia em trânsito, segregação de permissões, políticas de acesso ao banco, registros de auditoria, atualização do aplicativo, proteção de credenciais e limitação de privilégios. A existência dessas medidas será validada tecnicamente antes da abertura pública.</p>\n<h2>13. Incidentes de segurança</h2>\n<p>O Tâmo On manterá procedimento interno de resposta a incidentes com as etapas: identificação, contenção, preservação de evidências, análise, classificação de risco, comunicação, correção, registro e lições aprendidas. Quando houver risco ou dano relevante e forem preenchidos os requisitos legais, serão realizadas as comunicações aplicáveis à ANPD e aos titulares.</p>\n<h2>14. Direitos dos titulares</h2>\n<p>confirmação da existência de tratamento e acesso;</p>\n<p>correção de dados incompletos, inexatos ou desatualizados;</p>\n<p>anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade;</p>\n<p>portabilidade, quando regulamentada e tecnicamente aplicável;</p>\n<p>informação sobre compartilhamentos e sobre consequências da recusa quando o dado for necessário;</p>\n<p>revogação de consentimento e eliminação dos dados tratados com essa base, ressalvadas exceções legais;</p>\n<p>oposição a tratamento irregular baseado em outra hipótese legal;</p>\n<p>revisão e explicação de decisões exclusivamente automatizadas que afetem interesses relevantes;</p>\n<p>petição perante a ANPD e órgãos de defesa do consumidor, quando cabível.</p>\n<p>Solicitações serão recebidas pelo canal de privacidade/LGPD. Poderá ser exigida verificação proporcional de identidade. O procedimento interno registrará pedido, identidade verificada, categoria do direito, responsáveis, prazo, resposta e eventual fundamento para retenção.</p>\n<h2>15. Armazenamento local, cookies e notificações</h2>\n<p>O aplicativo poderá utilizar armazenamento local, cache, service worker enquanto aplicável, tokens de sessão e tecnologias equivalentes para autenticação, preferências, funcionamento e desempenho. Notificações push somente serão ativadas após ação expressa do usuário e poderão ser desativadas no aplicativo ou no sistema operacional.</p>\n<h2>16. Crianças e adolescentes</h2>\n<p>No lançamento, o Tâmo On será destinado exclusivamente a pessoas com 18 anos ou mais. A admissão de menores dependerá de revisão prévia do produto e desta documentação, com salvaguardas específicas, linguagem apropriada, mecanismos relacionados a responsáveis e observância do melhor interesse.</p>\n<h2>17. Alterações e futuras funcionalidades</h2>\n<p>Esta Política possui versão e data de vigência. Alterações materiais serão comunicadas e poderão exigir novo aceite. A ativação de marketplace, reservas comerciais, processamento de Pix/cartão, compartilhamento de dados com instituição de pagamento, publicidade comportamental ou nova finalidade relevante exigirá revisão jurídica e técnica prévia e atualização da Matriz Interna.</p>\n<h2>18. Contato</h2>\n<p>Canal institucional: contato@tamoon.app.br</p>\n<p>Suporte: suporte@tamoon.app.br</p>\n<p>Privacidade e direitos LGPD: privacidade@tamoon.app.br</p>\n<h2>Referências normativas consideradas</h2>\n<p>Lei nº 13.709/2018 - Lei Geral de Proteção de Dados Pessoais (LGPD).</p>\n<p>Lei nº 12.965/2014 - Marco Civil da Internet.</p>\n<p>Decreto nº 8.771/2016 - regulamentação do Marco Civil da Internet.</p>\n<p>Lei nº 8.078/1990 - Código de Defesa do Consumidor, quando caracterizada relação de consumo.</p>\n<p>Resolução CD/ANPD nº 15/2024 - Comunicação de Incidente de Segurança.</p>\n<p>Resolução CD/ANPD nº 18/2024 - Atuação do encarregado pelo tratamento de dados pessoais.</p>\n<p>Resolução CD/ANPD nº 19/2024 e alterações aplicáveis - Transferência Internacional de Dados.</p>\n<p>Resolução CD/ANPD nº 2/2022 - Agentes de tratamento de pequeno porte, quando aplicável.</p>\n<p>Enunciado CD/ANPD nº 1/2023 - tratamento de dados de crianças e adolescentes.</p>\n<p>Orientações e guias vigentes da ANPD sobre direitos dos titulares, avisos de privacidade, legítimo interesse e segurança da informação.</p>", "content_hash": "b219aabcfeaf7f60ff93735457ce7d9e77507d4d7c7f62a16175ca689e47e8fa", "source_hash": "410ea5f15e1b6ad91acb91b0f90b36b9a1440415a1bc1f388652b90c95290a76", "source_filename": "01-Politica-de-Privacidade-e-Uso-de-Dados-Tamo-On-v1.2.docx", "public_url": "/legal/privacidade-v1.2.html", "locale": "pt-BR"}$legaljson$::jsonb j) s
on conflict(document_type,version) do nothing;
insert into tamoon_legal.documents(document_type,version,title,content_html,content_hash,source_hash,source_filename,locale,public_url)
select j->>'document_type',j->>'version',j->>'title',j->>'content_html',j->>'content_hash',j->>'source_hash',j->>'source_filename',j->>'locale',j->>'public_url'
from (select $legaljson${"document_type": "conduct", "version": "1.2", "title": "Código de Conduta, Moderação e Banimento", "content_html": "<h2>1. Identificação do responsável</h2>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Campo</th><th>Informação</th></tr><tr><td>Nome empresarial / controlador</td><td>TAMO ON TECNOLOGIA E INTERMEDIACAO LTDA</td></tr><tr><td>Nome fantasia</td><td>Tâmo On</td></tr><tr><td>CNPJ</td><td>69.074.880/0001-47</td></tr><tr><td>Endereço</td><td>Rua Visconde de Abaeté, nº 34, apto. 101, térreo, Bloco A, Condomínio Ilha das Peças Residencial, Bairro Alto, Curitiba/PR, CEP 82820-210</td></tr><tr><td>Domínio oficial</td><td>tamoon.app.br</td></tr><tr><td>Canal institucional</td><td>contato@tamoon.app.br</td></tr><tr><td>Canal de suporte</td><td>suporte@tamoon.app.br</td></tr><tr><td>Canal de privacidade/LGPD</td><td>privacidade@tamoon.app.br</td></tr><tr><td>Encarregado ou canal equivalente</td><td>Canal equivalente: privacidade@tamoon.app.br. Encarregado formal não indicado nesta fase, sujeito à confirmação do enquadramento regulatório aplicável.</td></tr></table></div>\n<h2>2. Objetivo</h2>\n<p>Este Código busca manter o Tâmo On seguro, respeitoso e confiável. Aplica-se a contas, grupos, eventos, avaliações, avisos, convidados, registros financeiros internos, suporte e condutas externas diretamente relacionadas à plataforma quando produzirem risco concreto para usuários ou para o serviço.</p>\n<h2>3. Valores esperados</h2>\n<p>respeito e espírito esportivo</p>\n<p>honestidade e boa-fé</p>\n<p>inclusão e não discriminação</p>\n<p>privacidade e uso responsável de dados</p>\n<p>segurança física e digital</p>\n<p>responsabilidade financeira</p>\n<p>colaboração na solução de conflitos</p>\n<h2>4. Condutas esperadas</h2>\n<p>usar nome e informações verdadeiras</p>\n<p>cumprir confirmações ou avisar mudanças com antecedência razoável</p>\n<p>respeitar decisões legítimas dos responsáveis pelo grupo</p>\n<p>avaliar membros de forma esportiva, objetiva e confidencial</p>\n<p>registrar cobranças e pagamentos internos com descrição e valor corretos</p>\n<p>proteger códigos de convite, contas e dados pessoais</p>\n<p>reportar falhas de segurança sem explorá-las ou divulgá-las indevidamente</p>\n<h2>5. Proibições</h2>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Categoria</th><th>Exemplos</th></tr><tr><td>Assédio e violência</td><td>Ameaças, intimidação, perseguição, chantagem, humilhação reiterada, incentivo à violência ou exposição de endereço/rotina.</td></tr><tr><td>Discriminação e ódio</td><td>Ataques ou exclusão abusiva por característica protegida ou condição pessoal.</td></tr><tr><td>Exploração sexual ou de menores</td><td>Conteúdo sexual envolvendo menores, aliciamento, exploração ou material ilegal.</td></tr><tr><td>Fraude e falsidade</td><td>Perfis falsos, personificação, cobranças inexistentes, comprovantes falsos ou manipulação de presenças, avaliações e funções.</td></tr><tr><td>Privacidade e exposição</td><td>Coletar ou divulgar dados, fotos, mensagens, localização, documentos ou informações financeiras sem legitimidade.</td></tr><tr><td>Ataques técnicos</td><td>Invadir, extrair dados, usar bots, burlar permissões, explorar vulnerabilidades, distribuir malware ou prejudicar disponibilidade.</td></tr><tr><td>Spam e abuso comercial</td><td>Mensagens repetitivas, propaganda não autorizada, links enganosos ou uso da plataforma para esquema ilícito.</td></tr><tr><td>Conteúdo ilegal ou perigoso</td><td>Extorsão, atividade criminosa, incitação a violência grave ou uso da plataforma para finalidade ilícita.</td></tr><tr><td>Evasão de sanção</td><td>Criar nova conta, usar conta de terceiro ou manipular identidade para contornar suspensão ou banimento.</td></tr><tr><td>Retaliação</td><td>Punir, ameaçar ou perseguir pessoa que tenha reportado problema de boa-fé.</td></tr></table></div>\n<h2>6. Avaliações e times</h2>\n<p>notas devem considerar desempenho esportivo e contribuição para a partida</p>\n<p>é proibida avaliação retaliatória, discriminatória ou coordenada para prejudicar alguém</p>\n<p>não se deve revelar nota individual confidencial nem tentar identificar avaliadores por intimidação</p>\n<p>administradores não podem manipular dados ou times mediante vantagem indevida</p>\n<p>erros ou suspeitas devem ser tratados pelos canais apropriados, evitando exposição pública desnecessária</p>\n<h2>7. Integridade financeira</h2>\n<p>cobranças devem corresponder a despesas ou acordos reais do grupo</p>\n<p>pagamentos não devem ser marcados como realizados sem confirmação razoável</p>\n<p>é proibido usar o módulo Caixa para empréstimos ilegais, pirâmides, apostas ou cobrança abusiva</p>\n<p>divergências devem ser documentadas e tratadas de forma respeitosa</p>\n<p>o módulo financeiro da Comunidade não realiza cobrança extrajudicial, protesto ou negativação</p>\n<h2>8. Administração dos grupos</h2>\n<p>Administradores podem moderar conteúdo e excluir membros do grupo conforme regras internas, desde que não pratiquem discriminação ilícita, fraude, exposição indevida ou abuso. A exclusão de um participante de determinado grupo é uma medida local e não equivale automaticamente a sanção da conta perante o Tâmo On.</p>\n<h2>9. Princípios de moderação</h2>\n<p>proporcionalidade entre gravidade, contexto, dano, intenção e reincidência</p>\n<p>proteção preventiva quando houver risco concreto</p>\n<p>registro de evidências e motivo da medida</p>\n<p>comunicação ao usuário quando isso não aumentar o risco</p>\n<p>possibilidade de revisão humana</p>\n<p>não discriminação e tratamento consistente de casos semelhantes</p>\n<h2>10. Medidas aplicáveis e diferenças de alcance</h2>\n<div class=\"legal-table-scroll\" tabindex=\"0\"><table><tr><th>Medida</th><th>Aplicação e alcance</th></tr><tr><td>Orientação</td><td>Esclarecimento de regra para situação leve ou inicial.</td></tr><tr><td>Advertência</td><td>Registro formal de violação e determinação de cessação.</td></tr><tr><td>Remoção/correção</td><td>Exclusão ou correção de conteúdo, cobrança, convidado, aviso ou dado irregular.</td></tr><tr><td>Exclusão de grupo</td><td>Retirada do usuário de um grupo específico por decisão legítima do administrador ou medida localizada. Não suspende a conta global.</td></tr><tr><td>Restrição funcional</td><td>Bloqueio temporário de função específica, como publicar, convidar, cobrar, avaliar ou administrar.</td></tr><tr><td>Suspensão preventiva</td><td>Bloqueio global temporário enquanto fatos graves são apurados.</td></tr><tr><td>Suspensão temporária</td><td>Perda de acesso global por prazo proporcional à violação.</td></tr><tr><td>Banimento permanente</td><td>Encerramento global da conta e proibição de novo acesso quando proporcional e justificável.</td></tr><tr><td>Comunicação externa</td><td>Preservação de provas e comunicação a autoridades, vítimas ou provedores quando necessária ou obrigatória.</td></tr></table></div>\n<h2>11. Hipóteses que podem levar a banimento imediato</h2>\n<p>exploração sexual infantil, aliciamento ou material envolvendo menores</p>\n<p>ameaça crível de morte, violência grave ou perseguição com risco concreto</p>\n<p>invasão, furto de dados, malware ou sabotagem deliberada da plataforma</p>\n<p>fraude financeira relevante, extorsão ou apropriação indevida usando o serviço</p>\n<p>divulgação maliciosa de dados pessoais que exponha alguém a risco</p>\n<p>ódio ou assédio grave, coordenado ou reincidente</p>\n<p>evasão deliberada de suspensão grave</p>\n<p>ordem judicial ou obrigação legal incompatível com a manutenção da conta</p>\n<p>A lista não é exaustiva. A plataforma avaliará gravidade, provas, contexto, risco e legislação aplicável.</p>\n<h2>12. Denúncias e preservação de provas</h2>\n<p>Denúncias devem indicar, quando possível, conta ou grupo, data, descrição e evidências. Não se deve obter prova por invasão, ameaça ou exposição adicional. O Tâmo On poderá preservar logs e conteúdos necessários à apuração, segurança e exercício de direitos.</p>\n<p>Canal de denúncia/moderação: suporte@tamoon.app.br</p>\n<h2>13. Direito de revisão</h2>\n<p>O usuário poderá pedir revisão de advertência, restrição funcional, suspensão ou banimento, apresentando contexto e evidências. O pedido deverá ser feito preferencialmente em até 15 dias da comunicação. A análise será humana e realizada em prazo razoável, sem garantia de restauração enquanto persistir risco à segurança.</p>\n<h2>14. Medidas urgentes e sigilo</h2>\n<p>Em situações de risco, a plataforma poderá agir antes de ouvir o usuário. Informações detalhadas poderão ser limitadas para proteger vítimas, denunciantes, investigações, segredos de segurança ou determinações legais.</p>\n<h2>15. Alterações</h2>\n<p>Mudanças materiais deste Código serão comunicadas e poderão exigir novo aceite. A versão aplicável será aquela vigente na data da conduta, sem prejuízo de medidas protetivas urgentes.</p>\n<h2>16. Contato</h2>\n<p>Canal institucional: contato@tamoon.app.br</p>\n<p>Suporte e moderação: suporte@tamoon.app.br</p>\n<p>Privacidade/LGPD: privacidade@tamoon.app.br</p>\n<h2>Referências normativas consideradas</h2>\n<p>Lei nº 13.709/2018 - Lei Geral de Proteção de Dados Pessoais (LGPD).</p>\n<p>Lei nº 12.965/2014 - Marco Civil da Internet.</p>\n<p>Decreto nº 8.771/2016 - regulamentação do Marco Civil da Internet.</p>\n<p>Lei nº 8.078/1990 - Código de Defesa do Consumidor, quando caracterizada relação de consumo.</p>\n<p>Resolução CD/ANPD nº 15/2024 - Comunicação de Incidente de Segurança.</p>\n<p>Resolução CD/ANPD nº 18/2024 - Atuação do encarregado pelo tratamento de dados pessoais.</p>\n<p>Resolução CD/ANPD nº 19/2024 e alterações aplicáveis - Transferência Internacional de Dados.</p>\n<p>Resolução CD/ANPD nº 2/2022 - Agentes de tratamento de pequeno porte, quando aplicável.</p>\n<p>Enunciado CD/ANPD nº 1/2023 - tratamento de dados de crianças e adolescentes.</p>\n<p>Orientações e guias vigentes da ANPD sobre direitos dos titulares, avisos de privacidade, legítimo interesse e segurança da informação.</p>", "content_hash": "14ce9b7b6993a7f6e4f991f9f74817f0786dc5fd1a3c3934a8d6ade45e0dd2fb", "source_hash": "cdf9e159a0565f81334dc7b2510f09d440891ce5634c91c939e354ff4a23acc8", "source_filename": "03-Codigo-de-Conduta-Moderacao-e-Banimento-Tamo-On-v1.2.docx", "public_url": "/legal/codigo-de-conduta-v1.2.html", "locale": "pt-BR"}$legaljson$::jsonb j) s
on conflict(document_type,version) do nothing;

do $$ begin
 if exists(select 1 from tamoon_legal.documents where encode(sha256(convert_to(content_html,'UTF8')),'hex')<>content_hash) then raise exception 'Hash jurídico divergente'; end if;
end; $$;

do $$ begin
if not exists(select 1 from tamoon_legal.documents where document_type='terms' and version='1.2' and content_hash='874d70951a2b6037717cae9dd937175ec16380139f37c53400b3b8faae9c5000' and source_hash='0796522629d92e6bc2af8d8db65ec0f51e52686db2f73424da067e951a805bd6') then raise exception 'Documento v1.2 divergente: terms'; end if;
if not exists(select 1 from tamoon_legal.documents where document_type='privacy' and version='1.2' and content_hash='b219aabcfeaf7f60ff93735457ce7d9e77507d4d7c7f62a16175ca689e47e8fa' and source_hash='410ea5f15e1b6ad91acb91b0f90b36b9a1440415a1bc1f388652b90c95290a76') then raise exception 'Documento v1.2 divergente: privacy'; end if;
if not exists(select 1 from tamoon_legal.documents where document_type='conduct' and version='1.2' and content_hash='14ce9b7b6993a7f6e4f991f9f74817f0786dc5fd1a3c3934a8d6ade45e0dd2fb' and source_hash='cdf9e159a0565f81334dc7b2510f09d440891ce5634c91c939e354ff4a23acc8') then raise exception 'Documento v1.2 divergente: conduct'; end if;
end; $$;

-- Expurgo apenas da prova jurídica após encerramento + cinco anos, sem retenção excepcional.
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
   if not exists(select 1 from cron.job where jobname='tamoon-legal-retention') then
     perform cron.schedule('tamoon-legal-retention','20 4 * * *','select tamoon_legal.purge_expired_evidence()');
   end if;
 end if;
end; $$;
insert into public.app_releases(channel,version,build,database_build,edge_build,active,mandatory,notes)
values('beta','Beta 1.0',157,149,113,true,false,'Documentos v1.2, registro de aceite e maioridade. Ativação jurídica separada.')
on conflict(channel,build) do update set database_build=excluded.database_build,edge_build=excluded.edge_build,notes=excluded.notes;
update public.app_releases set active=false where channel='beta' and build<157;
notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;

-- Preparação Build 165. Aplicar apenas após revisão e antes de publicar o cliente 165.
-- Incremental: não recria tabelas existentes nem muda os aceites/documentos vigentes.
begin;

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  email text,
  status text not null default 'requested' check (status in ('requested','completed')),
  requested_at timestamptz not null default now(),
  due_at timestamptz not null default (now() + interval '30 days'),
  completed_at timestamptz,
  apple_revocation_followup boolean not null default false,
  app_build integer not null default 165
);
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from public, anon, authenticated;
grant all on public.account_deletion_requests to service_role;
create index if not exists account_deletion_requests_pending_idx
  on public.account_deletion_requests(requested_at) where status='requested';

-- A chave AES permanece exclusivamente em secrets da Edge Function.
create table if not exists public.apple_auth_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  apple_subject text not null,
  encrypted_refresh_token text not null,
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.apple_auth_grants enable row level security;
revoke all on public.apple_auth_grants from public, anon, authenticated;
grant all on public.apple_auth_grants to service_role;

create or replace function public.account_deletion_session_user()
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid := auth.uid();
begin
  -- JWT antigo, conta excluída ou sessão encerrada não autorizam novas operações.
  if v_id is null or not exists(select 1 from auth.users u where u.id=v_id and not coalesce(u.is_anonymous,false))
     or not exists(select 1 from auth.sessions s where s.user_id=v_id and s.id::text=auth.jwt()->>'session_id') then
    raise sqlstate 'PT401' using message='Entre novamente para gerenciar a exclusão da conta.';
  end if;
  return v_id;
end $$;
revoke all on function public.account_deletion_session_user() from public, anon, authenticated;

create or replace function public.request_my_account_deletion(p_confirm boolean, p_app_build integer default 165)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_request public.account_deletion_requests;
begin
  v_id := public.account_deletion_session_user();
  if p_confirm is distinct from true then
    raise sqlstate 'PT400' using message='Confirme que deseja excluir permanentemente sua conta.';
  end if;
  insert into public.account_deletion_requests(user_id,email,app_build)
    select v_id,u.email,greatest(165,least(coalesce(p_app_build,165),999999)) from auth.users u where u.id=v_id
    on conflict(user_id) do nothing;
  select * into v_request from public.account_deletion_requests where user_id=v_id;
  return jsonb_build_object('id',v_request.id,'status',v_request.status,
    'requested_at',v_request.requested_at,'due_at',v_request.due_at,'completed_at',v_request.completed_at);
end $$;
revoke all on function public.request_my_account_deletion(boolean,integer) from public, anon;
grant execute on function public.request_my_account_deletion(boolean,integer) to authenticated;

create or replace function public.get_my_account_deletion_request()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid := public.account_deletion_session_user(); v_request public.account_deletion_requests;
begin
  select * into v_request from public.account_deletion_requests where user_id=v_id;
  if not found then return null; end if;
  return jsonb_build_object('id',v_request.id,'status',v_request.status,
    'requested_at',v_request.requested_at,'due_at',v_request.due_at,'completed_at',v_request.completed_at);
end $$;
revoke all on function public.get_my_account_deletion_request() from public, anon;
grant execute on function public.get_my_account_deletion_request() to authenticated;

-- Protocolo aleatório funciona como segredo de consulta: nunca retorna e-mail, ID de usuário ou conteúdo.
create or replace function public.get_account_deletion_receipt(p_receipt uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',r.id,'status',r.status,'requested_at',r.requested_at,
    'due_at',r.due_at,'completed_at',r.completed_at,'apple_revocation_followup',r.apple_revocation_followup)
    from public.account_deletion_requests r where r.id=p_receipt;
$$;
revoke all on function public.get_account_deletion_receipt(uuid) from public;
grant execute on function public.get_account_deletion_receipt(uuid) to anon, authenticated;

create or replace function public.platform_list_account_deletion_requests()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform public.account_deletion_session_user();
  if not public.is_platform_admin() then raise sqlstate 'PT403' using message='Acesso restrito à administração.'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(r) order by r.requested_at),'[]'::jsonb)
    from (select d.id,d.user_id,coalesce(u.email,d.email) email,d.status,d.requested_at,d.due_at
      from public.account_deletion_requests d join auth.users u on u.id=d.user_id
      where d.status='requested' order by d.requested_at limit 200) r);
end $$;
revoke all on function public.platform_list_account_deletion_requests() from public, anon;
grant execute on function public.platform_list_account_deletion_requests() to authenticated;

create or replace function public.finalize_account_deletion_165()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- Além da limpeza administrativa existente, remova comunicados e cópias na caixa de entrada.
  delete from public.user_notifications where created_by=old.id;
  delete from public.announcements where created_by=old.id;
  delete from public.system_announcements where created_by=old.id;
  update public.account_deletion_requests set status='completed', completed_at=now(),email=null,user_id=null where user_id=old.id;
  return old;
end $$;
revoke all on function public.finalize_account_deletion_165() from public, anon, authenticated;
drop trigger if exists finalize_account_deletion_165 on auth.users;
create trigger finalize_account_deletion_165 before delete on auth.users
for each row execute function public.finalize_account_deletion_165();

comment on table public.account_deletion_requests is 'Build 165: solicitação autenticada; protocolo sem PII após conclusão. Monitorar diariamente e concluir até due_at.';
comment on table public.apple_auth_grants is 'Build 165: credencial Apple cifrada, acessível somente pelo serviço. Nunca exportar para clientes.';
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
 if v_path in ('rpc/get_community_legal_access_status','rpc/get_community_legal_status','rpc/get_community_legal_document','rpc/accept_community_legal_documents','rpc/export_my_legal_acceptances','rpc/claim_beta_access','rpc/request_my_account_deletion','rpc/get_my_account_deletion_request','rpc/get_account_deletion_receipt') then return; end if;
 if not tamoon_legal.has_access(auth.uid()) then
   raise sqlstate 'PT403' using message='LEGAL_ACCEPTANCE_REQUIRED',hint='Confirme a maioridade e os documentos vigentes no Tâmo On';
 end if;
end; $$;


commit;

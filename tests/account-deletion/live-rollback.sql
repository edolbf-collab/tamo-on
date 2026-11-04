-- Synthetic fixtures only. ROLLBACK is mandatory; no real account is changed or deleted.
begin;
do $$
declare
  v_user uuid:=gen_random_uuid(); v_admin uuid:=gen_random_uuid();
  v_session uuid:=gen_random_uuid(); v_admin_session uuid:=gen_random_uuid();
  v_email text; v_admin_email text; v_request jsonb; v_repeat jsonb;
begin
  v_email:='deletion-test-'||v_user||'@example.invalid';
  v_admin_email:='deletion-test-'||v_admin||'@example.invalid';
  insert into auth.users(id,email,role,aud,is_anonymous,raw_user_meta_data)
    values(v_user,v_email,'authenticated','authenticated',false,'{}'),
      (v_admin,v_admin_email,'authenticated','authenticated',false,'{}');
  insert into auth.sessions(id,user_id) values(v_session,v_user),(v_admin_session,v_admin);
  insert into public.beta_access(email,user_id,status) values(v_admin_email,v_admin,'active');
  insert into public.platform_admins(email) values(v_admin_email);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated','email',v_email,'session_id',v_session)::text,true);
  begin
    perform public.request_my_account_deletion(false,168);
    raise exception 'Confirmation was not required';
  exception when sqlstate 'PT400' then null; end;
  v_request:=public.request_my_account_deletion(true,168);
  v_repeat:=public.request_my_account_deletion(true,168);
  assert v_request->>'id'=v_repeat->>'id','Retry must preserve protocol';
  assert not(v_request?'email') and not(v_request?'user_id'),'Receipt must not expose identity';
  assert (v_request->>'due_at')::timestamptz-(v_request->>'requested_at')::timestamptz=interval '30 days','Stored deadline';
  begin
    perform public.platform_list_account_deletion_requests();
    raise exception 'Ordinary user was allowed to read queue';
  exception when sqlstate 'PT403' then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated','email',v_email,'session_id',gen_random_uuid())::text,true);
  begin
    perform public.get_my_account_deletion_request();
    raise exception 'Stale session accepted';
  exception when sqlstate 'PT401' then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated','email',v_admin_email,'session_id',v_admin_session)::text,true);
  perform public.platform_review_account_deletion((v_request->>'id')::uuid,'not_applicable','Não há retenções adicionais neste teste sintético.',true);
  assert jsonb_array_length(public.platform_list_account_deletion_requests())>=1,'Admin queue';
  begin
    perform public.platform_complete_account_deletion((v_request->>'id')::uuid);
    raise exception 'Completion accepted while Auth account exists';
  exception when sqlstate 'PT409' then null; end;
  assert exists(select 1 from auth.users where id=v_user),'Workflow must not delete account';
  assert not has_table_privilege('anon','public.account_deletion_requests','select'),'No direct anonymous access';
  assert not has_table_privilege('authenticated','public.account_deletion_requests','update'),'No direct user mutation';
  assert not has_function_privilege('anon','public.request_my_account_deletion(boolean,integer)','execute'),'No anonymous requests';
end $$;
rollback;
select '12 live assertions passed; all synthetic fixtures rolled back' as result;

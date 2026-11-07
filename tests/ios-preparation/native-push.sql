-- Transactional verification only: no notifications sent; fixture rows roll back.
begin;
do $$
declare a uuid; b uuid; email_a text; email_b text; install uuid := gen_random_uuid(); token_a text := repeat('a1',32); token_b text := repeat('b2',32); n integer;
begin
  select user_id into a from public.beta_access where status='active' and user_id is not null
    and public.community_legal_access_for_user(user_id) order by user_id limit 1;
  select user_id into b from public.beta_access where status='active' and user_id is not null
    and user_id<>a and public.community_legal_access_for_user(user_id) order by user_id limit 1;
  if a is null or b is null then raise exception 'Two authorized fixture accounts required'; end if;
  select email into email_a from auth.users where id=a;
  select email into email_b from auth.users where id=b;
  perform set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated','email',email_a)::text,true);
  set local role authenticated;
  perform public.save_native_push_subscription(token_a,'production',install);
  perform public.save_native_push_subscription(token_b,'production',install);
  select count(*) into n from public.native_push_subscriptions where installation_id=install;
  if n<>1 then raise exception 'Rotation must leave exactly one token'; end if;
  begin
    perform public.save_native_push_subscription('invalid','production',install);
    raise exception 'Invalid token accepted';
  exception when raise_exception then
    if sqlerrm<>'INVALID_DEVICE_REGISTRATION' then raise; end if;
  end;
  perform set_config('request.jwt.claims',json_build_object('sub',b,'role','authenticated','email',email_b)::text,true);
  select count(*) into n from public.native_push_subscriptions where installation_id=install;
  if n<>0 then raise exception 'Another account can read the token'; end if;
  perform public.remove_native_push_subscription(install);
  reset role;
  select count(*) into n from public.native_push_subscriptions where installation_id=install;
  if n<>1 then raise exception 'Another account removed the token'; end if;
  set local role authenticated;
  perform public.save_native_push_subscription(token_b,'production',install);
  perform set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated','email',email_a)::text,true);
  select count(*) into n from public.native_push_subscriptions where installation_id=install;
  if n<>0 then raise exception 'Previous account retained access after rebind'; end if;
  perform set_config('request.jwt.claims',json_build_object('sub',b,'role','authenticated','email',email_b)::text,true);
  perform public.remove_native_push_subscription(install);
  reset role;
  select count(*) into n from public.native_push_subscriptions where installation_id=install;
  if n<>0 then raise exception 'Logout did not remove token'; end if;
  set local role anon;
  begin
    perform public.save_native_push_subscription(token_a,'production',install);
    raise exception 'Anonymous registration accepted';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;
rollback;

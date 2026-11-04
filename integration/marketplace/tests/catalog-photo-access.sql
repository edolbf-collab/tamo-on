-- Staging pilot fixture. Only assertions leave the transaction.
begin;
do $$
declare subject record; checked_viewer boolean := false;
begin
  for subject in
    select a.marketplace_user_id, s.id as session_id
    from private.marketplace_pilot_accounts a
    cross join lateral (
      select id from auth.sessions
      where user_id = a.marketplace_user_id and (not_after is null or not_after > now())
      order by created_at desc limit 1
    ) s
    where a.enabled
  loop
    perform set_config('request.jwt.claims', jsonb_build_object('role','authenticated',
      'sub',subject.marketplace_user_id,'session_id',subject.session_id)::text,true);
    execute 'set local role authenticated';
    if not private.marketplace_pilot_allowed() then execute 'reset role'; continue; end if;
    if exists (select 1 from public.venue_photos ph join public.venues v on v.id=ph.venue_id
      where not private.has_partner_permission(v.partner_id,'manage_profile')) then checked_viewer := true; end if;
    if exists (
      select 1 from public.venue_photos ph join public.venues v on v.id=ph.venue_id
      join public.partners p on p.id=v.partner_id
      where v.published and p.status='approved' and not exists (
        select 1 from storage.objects o where o.bucket_id='marketplace-venue-photos' and o.name=ph.storage_path
      )
    ) then raise exception 'Missing registered catalog photo'; end if;
    if exists (
      select 1 from storage.objects o
      where o.bucket_id='marketplace-venue-photos'
        and not private.has_partner_permission(split_part(o.name,'/',1)::uuid,'manage_profile')
        and not exists (
          select 1 from public.venue_photos ph join public.venues v on v.id=ph.venue_id
          join public.partners p on p.id=v.partner_id where ph.storage_path=o.name and v.published and p.status='approved'
            and split_part(o.name,'/',1)=p.id::text and split_part(o.name,'/',2)=v.id::text
        )
    ) then raise exception 'File outside visible catalog'; end if;
    execute 'reset role';
  end loop;
  if not checked_viewer then raise exception 'Requires an active pilot viewer without partner management access'; end if;
end $$;
set local role anon;
do $$ begin
 if exists(select 1 from storage.objects where bucket_id='marketplace-venue-photos') then
   raise exception 'Anonymous catalog photo access'; end if;
end $$;
rollback;
select 'catalog photo access passed' as result;
